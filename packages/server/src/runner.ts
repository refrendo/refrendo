import path from "node:path";
import {
  EventBus,
  RefrendoAgent,
  Policy,
  Workspace,
  defaultPolicyConfig,
  type BudgetLimits,
  type Effort,
  type TaskContract,
} from "@refrendo/core";
import type { RunRow, RunStore, StoredEvent } from "./store.js";

export class WorkspaceNotAllowed extends Error {
  constructor(requested: string) {
    super(`El workspace "${requested}" no esta entre las raices permitidas del servidor.`);
    this.name = "WorkspaceNotAllowed";
  }
}

export interface RunManagerOptions {
  store: RunStore;
  /**
   * Raices de repositorio que el servidor puede tocar.
   *
   * Sin esta lista el endpoint de creacion de runs seria ejecucion de codigo
   * arbitrario sobre toda la maquina. Es la frontera de seguridad del servidor,
   * equivalente al confinamiento de rutas dentro de un run.
   */
  allowedRoots: string[];
  model?: string;
  effort?: Effort;
  limits?: Partial<BudgetLimits>;
  /** Puertas obligatorias de la organizacion. Aplican a todos los runs del servidor. */
  requiredGates?: string[];
  /** Rutas protegidas de la organizacion, ademas de las de serie. */
  protectedPaths?: string[];
}

export interface StartRunInput {
  contract: TaskContract;
  /** Ruta del repositorio. Debe estar dentro de una raiz permitida. */
  workspace: string;
  actor?: string;
  planOnly?: boolean;
  /**
   * Preaprueba los comandos que no estan en la allowlist. Por defecto `false`:
   * en un servidor no hay nadie en la terminal para contestar, asi que lo que
   * requiera aprobacion se deniega en vez de quedarse colgado.
   */
  autoApprove?: boolean;
}

/** `null` significa fin de la traza: el run termino y no habra mas eventos. */
type Listener = (event: StoredEvent | null) => void;

/**
 * Ejecuta runs y reparte su traza.
 *
 * Cada evento del agente se persiste antes de emitirse a los espectadores: si
 * el proceso muere entre ambas cosas, se pierde un fotograma en vivo pero nunca
 * una linea de la evidencia.
 */
export class RunManager {
  private readonly store: RunStore;
  private readonly allowedRoots: string[];
  private readonly options: RunManagerOptions;
  private readonly listeners = new Map<string, Set<Listener>>();
  private readonly active = new Map<string, AbortController>();

  constructor(options: RunManagerOptions) {
    this.store = options.store;
    this.options = options;
    this.allowedRoots = options.allowedRoots.map((root) => path.resolve(root));
  }

  /** Comprueba y normaliza un workspace contra las raices permitidas. */
  resolveWorkspace(requested: string): string {
    const absolute = path.resolve(requested);
    const allowed = this.allowedRoots.some((root) => {
      const rel = path.relative(root, absolute);
      return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
    });
    if (!allowed) throw new WorkspaceNotAllowed(requested);
    return absolute;
  }

  start(input: StartRunInput): RunRow {
    const workspace = this.resolveWorkspace(input.workspace);
    const row = this.store.createRun({
      contract: input.contract,
      workspace,
      repo: path.basename(workspace),
      actor: input.actor ?? null,
      model: this.options.model ?? null,
    });

    const bus = new EventBus();
    bus.on((event) => {
      const seq = this.store.appendEvent(row.id, event);
      this.broadcast(row.id, { seq, at: new Date().toISOString(), event });
    });

    const controller = new AbortController();
    this.active.set(row.id, controller);

    const agent = new RefrendoAgent({
      workspace: new Workspace(workspace),
      bus,
      signal: controller.signal,
      policy: new Policy(
        defaultPolicyConfig({
          autoApprove: input.autoApprove === true,
          // Sin manejador, `requestApproval` deniega. Es lo correcto aqui:
          // no hay humano al otro lado de un run lanzado por API.
          ...(this.options.protectedPaths
            ? {
                protectedPaths: [
                  ...defaultPolicyConfig().protectedPaths,
                  ...this.options.protectedPaths,
                ],
              }
            : {}),
        }),
      ),
      provider: {
        ...(this.options.model ? { model: this.options.model } : {}),
        ...(this.options.effort ? { effort: this.options.effort } : {}),
      },
      ...(this.options.limits ? { limits: this.options.limits } : {}),
      ...(this.options.requiredGates ? { requiredGates: this.options.requiredGates } : {}),
      planOnly: input.planOnly === true,
    });

    // Deliberadamente sin await: la peticion HTTP devuelve el id y el cliente
    // sigue el run por el stream.
    void agent
      .run(input.contract)
      .then((result) => this.store.finishRun(row.id, result))
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        this.store.appendEvent(row.id, { type: "warning", message: `Run abortado: ${message}` });
        this.store.failRun(row.id, message);
      })
      .finally(() => {
        this.active.delete(row.id);
        this.closeStream(row.id);
      });

    return row;
  }

  /** Cancela un run en curso. La reversion la hace el propio agente al fallar. */
  cancel(runId: string): boolean {
    const controller = this.active.get(runId);
    if (!controller) return false;
    controller.abort();
    return true;
  }

  /**
   * Cancela todos los runs vivos y los cierra con su motivo.
   *
   * Abortar la senal no basta: el agente tarda en reaccionar y el almacen se
   * cierra antes, asi que la fila se marca aqui mismo.
   */
  cancelAll(motivo: string): number {
    const vivos = [...this.active.keys()];
    for (const runId of vivos) {
      this.active.get(runId)?.abort();
      this.store.markInterrupted(runId, motivo);
    }
    this.active.clear();
    return vivos.length;
  }

  isActive(runId: string): boolean {
    return this.active.has(runId);
  }

  subscribe(runId: string, listener: Listener): () => void {
    let set = this.listeners.get(runId);
    if (!set) {
      set = new Set();
      this.listeners.set(runId, set);
    }
    set.add(listener);
    return () => {
      set.delete(listener);
      if (set.size === 0) this.listeners.delete(runId);
    };
  }

  private broadcast(runId: string, event: StoredEvent | null): void {
    const set = this.listeners.get(runId);
    if (!set) return;
    for (const listener of set) {
      try {
        listener(event);
      } catch {
        // Un espectador con la conexion rota no puede tumbar el run.
      }
    }
  }

  /** Avisa a los espectadores de que ya no habra mas eventos. */
  private closeStream(runId: string): void {
    this.broadcast(runId, null);
  }
}
