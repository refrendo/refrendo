import { z } from "zod";
import type { ToolDefinition, ToolOutcome } from "../types.js";

const MAX_OUTPUT_CHARS = 30_000;

function truncate(text: string, limit = MAX_OUTPUT_CHARS): string {
  if (text.length <= limit) return text;
  return `${text.slice(0, limit)}\n\n[...recortado: ${text.length - limit} caracteres mas. Acota la peticion.]`;
}

export const listFiles: ToolDefinition = {
  name: "list_files",
  description:
    "Lista ficheros y directorios del workspace. Ignora node_modules, .git, dist y similares. Usalo para orientarte antes de leer nada.",
  schema: z.object({
    path: z.string().default(".").describe("Ruta relativa a la raiz del workspace."),
    max_depth: z.number().int().min(1).max(8).default(3).describe("Profundidad de recursion."),
  }),
  async run(input, ctx): Promise<ToolOutcome> {
    const { path, max_depth } = input as { path: string; max_depth: number };
    const entries = await ctx.workspace.list(path, max_depth);
    if (entries.length === 0) {
      return { ok: true, content: `Sin entradas visibles en "${path}".` };
    }
    return {
      ok: true,
      content: truncate(entries.join("\n")),
      meta: { count: entries.length },
    };
  },
};

export const readFile: ToolDefinition = {
  name: "read_file",
  description:
    "Lee un fichero de texto del workspace con numeros de linea. Si solo necesitas una parte, usa start_line y end_line en vez de traerte el fichero entero.",
  schema: z.object({
    path: z.string().describe("Ruta relativa del fichero."),
    start_line: z.number().int().min(1).nullable().default(null),
    end_line: z.number().int().min(1).nullable().default(null),
  }),
  async run(input, ctx): Promise<ToolOutcome> {
    const { path, start_line, end_line } = input as {
      path: string;
      start_line: number | null;
      end_line: number | null;
    };
    try {
      const content = await ctx.workspace.readFile(path);
      const lines = content.split("\n");
      const from = Math.max(1, start_line ?? 1);
      const to = Math.min(lines.length, end_line ?? lines.length);
      const numbered = lines
        .slice(from - 1, to)
        .map((line, index) => `${String(from + index).padStart(5)}  ${line}`)
        .join("\n");
      return {
        ok: true,
        content: truncate(numbered || "[fichero vacio]"),
        meta: { path, totalLines: lines.length },
      };
    } catch (error) {
      return { ok: false, content: `No se pudo leer "${path}": ${asMessage(error)}` };
    }
  },
};

export const searchCode: ToolDefinition = {
  name: "search",
  description:
    "Busca un patron (expresion regular de JavaScript) en los ficheros de texto del workspace. Devuelve fichero, linea y contenido. Es la via rapida para localizar simbolos.",
  schema: z.object({
    pattern: z.string().describe("Expresion regular."),
    glob: z.string().nullable().default(null).describe("Filtro de ruta, p. ej. 'src/**/*.ts'."),
    max_results: z.number().int().min(1).max(200).default(60),
  }),
  async run(input, ctx): Promise<ToolOutcome> {
    const { pattern, glob, max_results } = input as {
      pattern: string;
      glob: string | null;
      max_results: number;
    };
    try {
      const hits = await ctx.workspace.grep(pattern, {
        ...(glob ? { glob } : {}),
        maxResults: max_results,
      });
      if (hits.length === 0) return { ok: true, content: `Sin coincidencias para /${pattern}/.` };
      const rendered = hits.map((hit) => `${hit.file}:${hit.line}: ${hit.text}`).join("\n");
      return { ok: true, content: truncate(rendered), meta: { count: hits.length } };
    } catch (error) {
      return { ok: false, content: `Patron invalido o busqueda fallida: ${asMessage(error)}` };
    }
  },
};

export const writeFile: ToolDefinition = {
  name: "write_file",
  description:
    "Crea un fichero o reemplaza su contenido completo. Para cambios puntuales sobre un fichero existente usa edit_file: es menos destructivo y mas barato.",
  mutating: true,
  schema: z.object({
    path: z.string(),
    content: z.string(),
  }),
  async run(input, ctx): Promise<ToolOutcome> {
    const { path, content } = input as { path: string; content: string };
    try {
      ctx.policy.assertWriteAllowed(path);
      await ctx.journal.capture(path);
      const existed = await ctx.workspace.exists(path);
      await ctx.workspace.writeFile(path, content);
      const lines = content.split("\n").length;
      ctx.emit({
        type: "file_changed",
        change: {
          path,
          kind: existed ? "modified" : "created",
          linesAdded: lines,
          linesRemoved: 0,
        },
      });
      return {
        ok: true,
        content: `${existed ? "Actualizado" : "Creado"} ${path} (${lines} lineas).`,
        meta: { path },
      };
    } catch (error) {
      return { ok: false, content: `No se pudo escribir "${path}": ${asMessage(error)}` };
    }
  },
};

export const editFile: ToolDefinition = {
  name: "edit_file",
  description:
    "Sustituye una cadena exacta dentro de un fichero. old_string debe aparecer exactamente una vez: si aparece varias, amplia el contexto hasta que sea unica. Incluye la indentacion literal.",
  mutating: true,
  schema: z.object({
    path: z.string(),
    old_string: z.string().describe("Texto exacto a reemplazar, incluida la indentacion."),
    new_string: z.string().describe("Texto de sustitucion."),
  }),
  async run(input, ctx): Promise<ToolOutcome> {
    const { path, old_string, new_string } = input as {
      path: string;
      old_string: string;
      new_string: string;
    };
    try {
      ctx.policy.assertWriteAllowed(path);
      const content = await ctx.workspace.readFile(path);
      const occurrences = countOccurrences(content, old_string);

      // Un reemplazo ambiguo es un fallo silencioso esperando a ocurrir:
      // preferimos devolver el error al modelo y que desambigue.
      if (occurrences === 0) {
        return {
          ok: false,
          content: `old_string no aparece en ${path}. Lee el fichero y copia el fragmento literal, con su indentacion.`,
        };
      }
      if (occurrences > 1) {
        return {
          ok: false,
          content: `old_string aparece ${occurrences} veces en ${path}. Anade lineas de contexto hasta que sea unica.`,
        };
      }

      await ctx.journal.capture(path);
      await ctx.workspace.writeFile(path, content.replace(old_string, new_string));

      const added = new_string.split("\n").length;
      const removed = old_string.split("\n").length;
      ctx.emit({
        type: "file_changed",
        change: { path, kind: "modified", linesAdded: added, linesRemoved: removed },
      });
      return { ok: true, content: `Editado ${path}.`, meta: { path } };
    } catch (error) {
      return { ok: false, content: `No se pudo editar "${path}": ${asMessage(error)}` };
    }
  },
};

function countOccurrences(haystack: string, needle: string): number {
  if (needle === "") return 0;
  let count = 0;
  let index = haystack.indexOf(needle);
  while (index !== -1) {
    count++;
    index = haystack.indexOf(needle, index + needle.length);
  }
  return count;
}

export function asMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
