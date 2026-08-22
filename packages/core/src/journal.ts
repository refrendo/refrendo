import { promises as fs } from "node:fs";
import type { FileChange } from "./types.js";
import type { Workspace } from "./workspace.js";

interface JournalEntry {
  /** Ruta relativa al workspace. */
  path: string;
  /** Contenido previo; `null` si el fichero no existia. */
  before: string | null;
}

/**
 * Diario transaccional de cambios.
 *
 * El agente escribe libremente, pero cada primera escritura sobre un fichero
 * captura su estado anterior. Si la verificacion final no consigue dejar el
 * arbol en verde, `rollback()` devuelve el workspace exactamente a como estaba.
 * Sin esto, un run fallido deja al equipo limpiando a mano — que es justo la
 * tarea tediosa que veniamos a eliminar.
 */
export class ChangeJournal {
  private readonly entries = new Map<string, JournalEntry>();

  constructor(private readonly workspace: Workspace) {}

  /** Captura el estado previo de un fichero. Idempotente: solo la primera vez cuenta. */
  async capture(relativePath: string): Promise<void> {
    if (this.entries.has(relativePath)) return;
    let before: string | null = null;
    try {
      before = await this.workspace.readFile(relativePath);
    } catch {
      before = null; // no existia, o no es texto legible
    }
    this.entries.set(relativePath, { path: relativePath, before });
  }

  get touchedFiles(): string[] {
    return [...this.entries.keys()];
  }

  get isEmpty(): boolean {
    return this.entries.size === 0;
  }

  /** Diferencia entre el estado capturado y el actual, con recuento de lineas. */
  async summarize(): Promise<FileChange[]> {
    const changes: FileChange[] = [];
    for (const entry of this.entries.values()) {
      let after: string | null = null;
      try {
        after = await this.workspace.readFile(entry.path);
      } catch {
        after = null;
      }
      if (entry.before === after) continue;

      const beforeLines = entry.before === null ? [] : entry.before.split("\n");
      const afterLines = after === null ? [] : after.split("\n");
      const { added, removed } = lineDelta(beforeLines, afterLines);

      changes.push({
        path: entry.path,
        kind: entry.before === null ? "created" : after === null ? "deleted" : "modified",
        linesAdded: added,
        linesRemoved: removed,
      });
    }
    return changes.sort((a, b) => a.path.localeCompare(b.path));
  }

  /** Restaura todos los ficheros tocados a su estado inicial. */
  async rollback(): Promise<string[]> {
    const restored: string[] = [];
    for (const entry of this.entries.values()) {
      try {
        if (entry.before === null) {
          await fs.rm(this.workspace.resolve(entry.path), { force: true });
        } else {
          await this.workspace.writeFile(entry.path, entry.before);
        }
        restored.push(entry.path);
      } catch {
        // Un fichero irrecuperable no debe impedir revertir el resto.
      }
    }
    return restored;
  }

  /** Consolida el estado actual como nueva linea base (tras verificacion en verde). */
  commit(): void {
    this.entries.clear();
  }
}

/**
 * Recuento de lineas anadidas/eliminadas por diferencia de multiconjuntos.
 * No es un diff de Myers: solo alimenta la estadistica que se muestra al usuario,
 * y a esa escala la aproximacion es indistinguible y mucho mas barata.
 */
function lineDelta(before: string[], after: string[]): { added: number; removed: number } {
  const counts = new Map<string, number>();
  for (const line of before) counts.set(line, (counts.get(line) ?? 0) + 1);

  let added = 0;
  for (const line of after) {
    const remaining = counts.get(line) ?? 0;
    if (remaining > 0) counts.set(line, remaining - 1);
    else added++;
  }
  let removed = 0;
  for (const remaining of counts.values()) removed += remaining;

  return { added, removed };
}
