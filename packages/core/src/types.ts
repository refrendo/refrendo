import type { z } from "zod";
import type { Workspace } from "./workspace.js";
import type { Policy } from "./policy.js";
import type { ChangeJournal } from "./journal.js";
import type { EmitFn } from "./events.js";

/**
 * Un contrato de tarea, no un mensaje de chat.
 *
 * La diferencia importa: un chat termina cuando el modelo deja de escribir; un
 * contrato termina cuando los criterios de aceptacion se cumplen y las puertas
 * de verificacion pasan. Todo el motor se apoya en esta distincion.
 */
export interface TaskContract {
  /** Que hay que conseguir, en lenguaje natural. */
  goal: string;
  /** Criterios explicitos que el resultado debe cumplir. */
  acceptance?: string[];
  /** Restricciones duras (ficheros intocables, estilo, dependencias prohibidas...). */
  constraints?: string[];
  /** Rutas relevantes que se inyectan como contexto inicial. */
  context?: string[];
}

/** Resultado de ejecutar una herramienta. `ok:false` vuelve al modelo como `is_error`. */
export interface ToolOutcome {
  ok: boolean;
  /** Texto que ve el modelo. Debe ser accionable, no un volcado crudo. */
  content: string;
  /** Metadatos para la traza y la UI; el modelo no los ve. */
  meta?: Record<string, unknown>;
}

export interface ToolContext {
  workspace: Workspace;
  policy: Policy;
  journal: ChangeJournal;
  emit: EmitFn;
  signal: AbortSignal;
}

export interface ToolDefinition<S extends z.ZodType = z.ZodType> {
  name: string;
  description: string;
  schema: S;
  /** Herramientas que escriben: pasan por journal + politica de aprobacion. */
  mutating?: boolean;
  /** Herramienta terminal: su invocacion cierra el bucle y devuelve su input. */
  terminal?: boolean;
  run(input: z.infer<S>, ctx: ToolContext): Promise<ToolOutcome>;
}

export interface PlanStep {
  id: number;
  description: string;
  files: string[];
  rationale: string;
}

export interface Plan {
  summary: string;
  steps: PlanStep[];
  risks: string[];
  /** Puertas de verificacion que el propio agente considera necesarias. */
  acceptanceChecks: string[];
}

export interface GateResult {
  name: string;
  command: string;
  passed: boolean;
  skipped: boolean;
  durationMs: number;
  exitCode: number | null;
  /** Cola de salida, recortada. Es lo que se reinyecta al reparar. */
  output: string;
}

export interface VerificationReport {
  passed: boolean;
  gates: GateResult[];
  ranAt: string;
}

export interface FileChange {
  path: string;
  kind: "created" | "modified" | "deleted";
  linesAdded: number;
  linesRemoved: number;
}

export type RunStatus =
  /** Cambios aplicados y todas las puertas en verde. */
  | "verified"
  /** Cambios aplicados pero sin puertas que ejecutar (proyecto sin checks). */
  | "unverified"
  /** No se pudo dejar el arbol en verde; los cambios se revirtieron. */
  | "reverted"
  /** Se agoto presupuesto o iteraciones antes de terminar. */
  | "exhausted"
  /** Error no recuperable. */
  | "failed";

export interface UsageTotals {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  costUsd: number;
  requests: number;
}

export interface RunResult {
  status: RunStatus;
  contract: TaskContract;
  plan: Plan | null;
  /** Resumen en prosa que escribe el agente al terminar. */
  summary: string;
  changes: FileChange[];
  verification: VerificationReport | null;
  /** Intentos de reparacion consumidos tras un fallo de verificacion. */
  repairAttempts: number;
  usage: UsageTotals;
  durationMs: number;
  error?: { code: string; message: string };
}
