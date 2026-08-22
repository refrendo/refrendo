import { promises as fs } from "node:fs";
import path from "node:path";
import { SandboxViolation } from "./errors.js";

const DEFAULT_IGNORED = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  "coverage",
  ".next",
  ".turbo",
  ".forge",
  "__pycache__",
  ".venv",
]);

export interface WorkspaceOptions {
  /** Tope por fichero al leer/escribir. Evita meter un binario de 40 MB en contexto. */
  maxFileBytes?: number;
  ignored?: Set<string>;
}

/**
 * Raiz de trabajo con confinamiento de rutas.
 *
 * Toda ruta que toca el agente pasa por `resolve`. Es la frontera de seguridad
 * del proceso: sin esto, un `../../.ssh/id_rsa` en un argumento de herramienta
 * es suficiente para salir del proyecto.
 *
 * El confinamiento tiene dos capas, y hacen falta las dos: `resolve` hace
 * aritmetica de rutas (barata, sincrona) y `assertContained` resuelve enlaces
 * simbolicos antes de tocar el disco. Solo con la primera, un enlace dentro del
 * workspace apuntando fuera basta para escapar — la ruta pasa la comprobacion y
 * el sistema de ficheros sigue el enlace de todas formas.
 */
export class Workspace {
  readonly root: string;
  private readonly maxFileBytes: number;
  private readonly ignored: Set<string>;
  private realRoot: Promise<string> | null = null;

  constructor(root: string, options: WorkspaceOptions = {}) {
    this.root = path.resolve(root);
    this.maxFileBytes = options.maxFileBytes ?? 1_000_000;
    this.ignored = options.ignored ?? DEFAULT_IGNORED;
  }

  /**
   * Comprueba que la ruta real —ya resueltos los enlaces— sigue dentro de la
   * raiz real. Para ficheros que aun no existen se valida el primer ancestro
   * que si exista: si el directorio contenedor esta dentro, el fichero nuevo
   * tambien lo estara.
   */
  private async assertContained(absolute: string, requested: string): Promise<void> {
    // La propia raiz puede ser un enlace (p. ej. /tmp en macOS), asi que la
    // referencia de comparacion tambien tiene que estar resuelta.
    this.realRoot ??= fs.realpath(this.root).catch(() => this.root);
    const realRoot = await this.realRoot;

    let probe = absolute;
    for (;;) {
      let real: string;
      try {
        real = await fs.realpath(probe);
      } catch {
        const parent = path.dirname(probe);
        // Se llego al tope del volumen sin encontrar nada existente: no hay
        // enlace que seguir y la aritmetica de `resolve` ya dio el visto bueno.
        if (parent === probe) return;
        probe = parent;
        continue;
      }

      const rel = path.relative(realRoot, real);
      if (rel !== "" && (rel.startsWith("..") || path.isAbsolute(rel))) {
        throw new SandboxViolation(requested, this.root);
      }
      return;
    }
  }

  /** Resuelve una ruta relativa contra la raiz, o lanza si se escapa. */
  resolve(relativePath: string): string {
    const absolute = path.resolve(this.root, relativePath);
    const rel = path.relative(this.root, absolute);
    const escapes = rel.startsWith("..") || path.isAbsolute(rel);
    if (escapes) throw new SandboxViolation(relativePath, this.root);
    return absolute;
  }

  /** Forma canonica relativa a la raiz, con separadores POSIX para la traza. */
  relative(absolutePath: string): string {
    return path.relative(this.root, absolutePath).split(path.sep).join("/");
  }

  async exists(relativePath: string): Promise<boolean> {
    try {
      await fs.access(this.resolve(relativePath));
      return true;
    } catch {
      return false;
    }
  }

  async readFile(relativePath: string): Promise<string> {
    const absolute = this.resolve(relativePath);
    await this.assertContained(absolute, relativePath);
    const stat = await fs.stat(absolute);
    if (stat.size > this.maxFileBytes) {
      throw new Error(
        `El fichero ocupa ${stat.size} bytes y el limite es ${this.maxFileBytes}. Lee un rango concreto en vez del fichero entero.`,
      );
    }
    return fs.readFile(absolute, "utf8");
  }

  async writeFile(relativePath: string, content: string): Promise<void> {
    const absolute = this.resolve(relativePath);
    await this.assertContained(absolute, relativePath);
    await fs.mkdir(path.dirname(absolute), { recursive: true });
    await fs.writeFile(absolute, content, "utf8");
  }

  async deleteFile(relativePath: string): Promise<void> {
    const absolute = this.resolve(relativePath);
    await this.assertContained(absolute, relativePath);
    await fs.rm(absolute, { force: true });
  }

  /** Listado recursivo con poda de directorios ruidosos. */
  async list(relativePath = ".", maxDepth = 3): Promise<string[]> {
    const base = this.resolve(relativePath);
    const out: string[] = [];

    const walk = async (dir: string, depth: number): Promise<void> => {
      if (depth > maxDepth) return;
      let entries;
      try {
        entries = await fs.readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        if (this.ignored.has(entry.name) || entry.name.startsWith(".env")) continue;
        // Un enlace puede apuntar fuera del workspace: recorrerlo sacaria del
        // sandbox rutas que el agente no deberia ni ver.
        if (entry.isSymbolicLink()) continue;
        const abs = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          out.push(`${this.relative(abs)}/`);
          await walk(abs, depth + 1);
        } else if (entry.isFile()) {
          out.push(this.relative(abs));
        }
      }
    };

    await walk(base, 0);
    return out.sort();
  }

  /** Busqueda literal o por regex sobre los ficheros de texto del workspace. */
  async grep(
    pattern: string,
    options: { glob?: string; maxResults?: number } = {},
  ): Promise<Array<{ file: string; line: number; text: string }>> {
    const maxResults = options.maxResults ?? 100;
    const regex = new RegExp(pattern);
    const globRegex = options.glob ? globToRegExp(options.glob) : null;
    const files = (await this.list(".", 8)).filter((f) => !f.endsWith("/"));
    const hits: Array<{ file: string; line: number; text: string }> = [];

    for (const file of files) {
      if (globRegex && !globRegex.test(file)) continue;
      if (hits.length >= maxResults) break;
      let content: string;
      try {
        content = await this.readFile(file);
      } catch {
        continue; // binario o demasiado grande: se ignora en busqueda
      }
      const lines = content.split("\n");
      for (let i = 0; i < lines.length; i++) {
        const text = lines[i]!;
        if (regex.test(text)) {
          hits.push({ file, line: i + 1, text: text.slice(0, 300) });
          if (hits.length >= maxResults) break;
        }
      }
    }
    return hits;
  }
}

/** Traduce un glob sencillo (`**`, `*`, `?`) a RegExp. */
export function globToRegExp(glob: string): RegExp {
  const escaped = glob.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  const body = escaped
    .replace(/\*\*\//g, "\u0000SLASHSTAR\u0000")
    .replace(/\*\*/g, "\u0000DOUBLESTAR\u0000")
    .replace(/\*/g, "[^/]*")
    .replace(/\?/g, "[^/]")
    .replace(/\u0000SLASHSTAR\u0000/g, "(?:.*/)?")
    .replace(/\u0000DOUBLESTAR\u0000/g, ".*");
  return new RegExp(`^${body}$`);
}
