import type { FileChange, GateResult, Plan, RunResult, TaskContract, UsageTotals } from "./types.js";

/**
 * Stream de eventos tipado. Es la unica superficie de observabilidad del motor:
 * la CLI lo pinta, el futuro servidor lo reenvia por SSE y la sesion compartida
 * de equipo se reconstruye reproduciendolo. Por eso todo evento es serializable.
 */
export type RefrendoEvent =
  | { type: "run_started"; contract: TaskContract; workspace: string; at: string }
  | { type: "phase_started"; phase: Phase }
  | { type: "plan_ready"; plan: Plan }
  | { type: "iteration_started"; phase: Phase; iteration: number; max: number }
  | { type: "thinking_delta"; text: string }
  | { type: "text_delta"; text: string }
  | { type: "tool_requested"; id: string; name: string; input: unknown }
  | { type: "approval_requested"; id: string; operation: string; detail: string }
  | { type: "approval_resolved"; id: string; approved: boolean }
  | { type: "tool_completed"; id: string; name: string; ok: boolean; summary: string; durationMs: number }
  | { type: "file_changed"; change: FileChange }
  | { type: "verification_started"; gates: string[] }
  | { type: "gate_completed"; gate: GateResult }
  | { type: "verification_completed"; passed: boolean }
  | { type: "repair_started"; attempt: number; max: number; failing: string[] }
  | { type: "rollback_started"; reason: string }
  | { type: "usage_updated"; usage: UsageTotals }
  | { type: "warning"; message: string }
  | { type: "run_finished"; result: RunResult };

export type Phase = "plan" | "execute" | "verify" | "repair" | "finalize";

export type EmitFn = (event: RefrendoEvent) => void;

export type Listener = (event: RefrendoEvent) => void;

/** Bus sincrono minimo. Un listener que lanza no puede tumbar la ejecucion. */
export class EventBus {
  private readonly listeners = new Set<Listener>();
  private readonly history: RefrendoEvent[] = [];

  on(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  readonly emit: EmitFn = (event) => {
    this.history.push(event);
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
        // Un consumidor roto nunca aborta el run.
      }
    }
  };

  /** Traza completa del run, lista para persistir o reproducir. */
  transcript(): readonly RefrendoEvent[] {
    return this.history;
  }
}
