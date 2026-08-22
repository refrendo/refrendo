import type Anthropic from "@anthropic-ai/sdk";
import { Budget, DEFAULT_LIMITS, type BudgetLimits } from "./budget.js";
import { EventBus, type EmitFn } from "./events.js";
import { ChangeJournal } from "./journal.js";
import { runLoop, type LoopResult } from "./loop.js";
import { Policy, defaultPolicyConfig, type PolicyConfig } from "./policy.js";
import { AnthropicProvider, type ProviderOptions } from "./provider/anthropic.js";
import {
  EXECUTOR_SYSTEM,
  PLANNER_SYSTEM,
  executorBrief,
  plannerBrief,
  repairBrief,
} from "./prompts.js";
import { EXECUTOR_TOOLS, PLANNER_TOOLS } from "./tools/index.js";
import type {
  Plan,
  RunResult,
  RunStatus,
  TaskContract,
  ToolContext,
  VerificationReport,
} from "./types.js";
import { detectGates, verify, type Gate } from "./verify.js";
import { Workspace } from "./workspace.js";

export interface AgentOptions {
  workspace: Workspace | string;
  provider?: AnthropicProvider | ProviderOptions;
  policy?: Policy | Partial<PolicyConfig>;
  limits?: Partial<BudgetLimits>;
  bus?: EventBus;
  /** Puertas explicitas. Si se omite, se detectan del propio proyecto. */
  gates?: Gate[];
  /**
   * Puertas que tienen que existir y pasar. Si falta alguna, el run no queda
   * verificado aunque todo lo demas este en verde.
   */
  requiredGates?: string[];
  /** Termina tras la fase de planificacion, sin tocar nada. */
  planOnly?: boolean;
  /** Salta la verificacion. Solo para exploracion: el resultado sera "unverified". */
  skipVerification?: boolean;
  /**
   * Revierte los cambios si el arbol no queda en verde. Activado por defecto:
   * un run fallido no debe dejar deuda que alguien tenga que limpiar a mano.
   */
  rollbackOnFailure?: boolean;
  signal?: AbortSignal;
}

/**
 * Orquestador de un contrato de tarea.
 *
 * El ciclo es planificar -> ejecutar -> verificar -> reparar -> consolidar o
 * revertir. La fase de verificacion es lo que separa a Refrendo de un asistente
 * de codigo: el agente no decide si ha terminado, lo decide el proyecto.
 */
export class RefrendoAgent {
  private readonly workspace: Workspace;
  private readonly provider: AnthropicProvider;
  private readonly policy: Policy;
  private readonly budget: Budget;
  private readonly bus: EventBus;
  private readonly emit: EmitFn;
  private readonly options: AgentOptions;

  constructor(options: AgentOptions) {
    this.options = options;
    this.workspace =
      options.workspace instanceof Workspace ? options.workspace : new Workspace(options.workspace);
    // El bus se crea antes que el proveedor: este necesita un canal por el que
    // avisar si tiene que degradar sus funciones beta a mitad del run.
    this.bus = options.bus ?? new EventBus();
    this.emit = this.bus.emit;
    this.provider =
      options.provider instanceof AnthropicProvider
        ? options.provider
        : new AnthropicProvider({
            ...(options.provider ?? {}),
            onWarning: (message) => this.emit({ type: "warning", message }),
          });
    this.policy =
      options.policy instanceof Policy
        ? options.policy
        : new Policy(defaultPolicyConfig(options.policy ?? {}));
    this.budget = new Budget({ ...DEFAULT_LIMITS, ...options.limits });
  }

  get events(): EventBus {
    return this.bus;
  }

  async run(contract: TaskContract): Promise<RunResult> {
    const startedAt = Date.now();
    const journal = new ChangeJournal(this.workspace);
    const ctx: ToolContext = {
      workspace: this.workspace,
      policy: this.policy,
      journal,
      emit: this.emit,
      signal: this.options.signal ?? new AbortController().signal,
    };

    this.emit({
      type: "run_started",
      contract,
      workspace: this.workspace.root,
      at: new Date().toISOString(),
    });

    let plan: Plan | null = null;
    let verification: VerificationReport | null = null;
    let repairAttempts = 0;
    let summary = "";

    try {
      const gates = this.options.gates ?? (await detectGates(this.workspace));
      if (gates.length === 0) {
        this.emit({
          type: "warning",
          message:
            "El proyecto no declara puertas de verificacion (typecheck, test, lint o build). El resultado no se podra verificar automaticamente.",
        });
      }

      // --- Fase 1: planificar -------------------------------------------------
      this.emit({ type: "phase_started", phase: "plan" });
      const planResult = await runLoop({
        provider: this.provider,
        tools: PLANNER_TOOLS,
        system: PLANNER_SYSTEM,
        messages: [{ role: "user", content: plannerBrief(contract, gates) }],
        ctx,
        budget: this.budget,
        emit: this.emit,
        phase: "plan",
        maxIterations: Math.max(4, Math.floor(this.budget.limits.maxIterations / 2)),
      });

      plan = toPlan(planResult);
      if (plan) {
        this.emit({ type: "plan_ready", plan });
      } else {
        this.emit({
          type: "warning",
          message: `La fase de planificacion termino sin plan (motivo: ${planResult.stop}). Se ejecutara con el objetivo en crudo.`,
        });
      }

      if (this.options.planOnly) {
        return this.finalize({
          status: plan ? "unverified" : "exhausted",
          contract,
          plan,
          summary: plan?.summary ?? planResult.finalText,
          journal,
          verification: null,
          repairAttempts: 0,
          startedAt,
        });
      }

      if (planResult.stop === "budget") {
        return this.finalize({
          status: "exhausted",
          contract,
          plan,
          summary: "Presupuesto agotado durante la planificacion.",
          journal,
          verification: null,
          repairAttempts: 0,
          startedAt,
        });
      }

      // --- Fase 2: ejecutar ---------------------------------------------------
      this.emit({ type: "phase_started", phase: "execute" });
      let messages: Anthropic.Beta.BetaMessageParam[] = [
        { role: "user", content: executorBrief(contract, renderPlan(plan, contract), gates) },
      ];

      let execution = await runLoop({
        provider: this.provider,
        tools: EXECUTOR_TOOLS,
        system: EXECUTOR_SYSTEM,
        messages,
        ctx,
        budget: this.budget,
        emit: this.emit,
        phase: "execute",
        maxIterations: this.budget.limits.maxIterations,
      });
      messages = execution.messages;
      summary = describeOutcome(execution);

      // --- Fase 3: verificar y reparar ---------------------------------------
      const maxRepairs = this.budget.limits.maxRepairAttempts;

      // Con puertas obligatorias se verifica aunque no se detecte ninguna: si
      // el arbol se quedo sin puertas, eso mismo es el fallo que hay que
      // reportar, y saltarse la verificacion lo dejaria pasar como "sin verificar".
      const mustVerify = gates.length > 0 || (this.options.requiredGates?.length ?? 0) > 0;
      if (!this.options.skipVerification && mustVerify) {
        this.emit({ type: "phase_started", phase: "verify" });
        verification = await verify(this.workspace, this.emit, {
          gates,
          ...(this.options.requiredGates ? { requiredGates: this.options.requiredGates } : {}),
          ...(this.options.signal ? { signal: this.options.signal } : {}),
        });

        while (!verification.passed && repairAttempts < maxRepairs) {
          repairAttempts++;
          this.emit({
            type: "repair_started",
            attempt: repairAttempts,
            max: maxRepairs,
            failing: verification.gates.filter((gate) => !gate.passed).map((gate) => gate.name),
          });
          this.emit({ type: "phase_started", phase: "repair" });

          messages.push({
            role: "user",
            content: repairBrief(verification, repairAttempts, maxRepairs),
          });

          execution = await runLoop({
            provider: this.provider,
            tools: EXECUTOR_TOOLS,
            system: EXECUTOR_SYSTEM,
            messages,
            ctx,
            budget: this.budget,
            emit: this.emit,
            phase: "repair",
            maxIterations: this.budget.limits.maxIterations,
          });
          messages = execution.messages;
          summary = describeOutcome(execution);

          if (execution.stop === "budget") break;

          this.emit({ type: "phase_started", phase: "verify" });
          verification = await verify(this.workspace, this.emit, {
            gates,
            ...(this.options.requiredGates ? { requiredGates: this.options.requiredGates } : {}),
            ...(this.options.signal ? { signal: this.options.signal } : {}),
          });
        }
      }

      // --- Fase 4: consolidar o revertir -------------------------------------
      this.emit({ type: "phase_started", phase: "finalize" });
      const status = decideStatus(verification, execution, this.options);

      if (status === "reverted") {
        this.emit({
          type: "rollback_started",
          reason: verification?.passed === false
            ? "la verificacion no llego a verde tras agotar los intentos de reparacion"
            : `la ejecucion no completo (${execution.stop})`,
        });
        const restored = await journal.rollback();
        return this.finalize({
          status,
          contract,
          plan,
          summary: `${summary}\n\nSe revirtieron ${restored.length} fichero(s): el arbol quedo como estaba.`,
          journal: null,
          verification,
          repairAttempts,
          startedAt,
          changesOverride: [],
        });
      }

      return this.finalize({
        status,
        contract,
        plan,
        summary,
        journal,
        verification,
        repairAttempts,
        startedAt,
      });
    } catch (error) {
      const failure = normalizeError(error);
      if (this.options.rollbackOnFailure !== false && !journal.isEmpty) {
        this.emit({ type: "rollback_started", reason: failure.message });
        await journal.rollback();
      }
      return this.finalize({
        status: "failed",
        contract,
        plan,
        summary: summary || failure.message,
        journal: null,
        verification,
        repairAttempts,
        startedAt,
        changesOverride: [],
        error: failure,
      });
    }
  }

  private async finalize(input: {
    status: RunStatus;
    contract: TaskContract;
    plan: Plan | null;
    summary: string;
    journal: ChangeJournal | null;
    verification: VerificationReport | null;
    repairAttempts: number;
    startedAt: number;
    changesOverride?: RunResult["changes"];
    error?: { code: string; message: string };
  }): Promise<RunResult> {
    const changes = input.changesOverride ?? (input.journal ? await input.journal.summarize() : []);

    const result: RunResult = {
      status: input.status,
      contract: input.contract,
      plan: input.plan,
      summary: input.summary,
      changes,
      verification: input.verification,
      repairAttempts: input.repairAttempts,
      usage: this.budget.snapshot(),
      durationMs: Date.now() - input.startedAt,
      ...(input.error ? { error: input.error } : {}),
    };

    if (input.status === "verified" && input.journal) input.journal.commit();
    this.emit({ type: "run_finished", result });
    return result;
  }
}

function decideStatus(
  verification: VerificationReport | null,
  execution: LoopResult,
  options: AgentOptions,
): RunStatus {
  const rollback = options.rollbackOnFailure !== false;

  // Hubo verificacion: manda ella. Es el unico camino que produce "verified".
  if (verification) {
    if (verification.passed) return "verified";
    return rollback ? "reverted" : "exhausted";
  }

  // Sin verificacion (proyecto sin puertas o --no-verify): lo maximo que se
  // puede afirmar es que el agente declaro el trabajo terminado. Si ni siquiera
  // llego ahi, quedo a medias y se revierte.
  if (execution.stop === "terminal") return "unverified";
  return rollback ? "reverted" : "exhausted";
}

/** Convierte el input de submit_plan (ya validado por Zod) en un Plan. */
function toPlan(result: LoopResult): Plan | null {
  if (!result.terminal || result.terminal.name !== "submit_plan") return null;
  const input = result.terminal.input as {
    summary: string;
    steps: Array<{ description: string; files: string[]; rationale: string }>;
    risks: string[];
    acceptance_checks: string[];
  };
  return {
    summary: input.summary,
    steps: input.steps.map((step, index) => ({ id: index + 1, ...step })),
    risks: input.risks,
    acceptanceChecks: input.acceptance_checks,
  };
}

function renderPlan(plan: Plan | null, contract: TaskContract): string {
  if (!plan) {
    return `No hubo plan formal. Trabaja directamente sobre el objetivo: ${contract.goal}`;
  }
  const steps = plan.steps
    .map(
      (step) =>
        `${step.id}. ${step.description}\n   Ficheros: ${step.files.join(", ") || "(por determinar)"}\n   Motivo: ${step.rationale}`,
    )
    .join("\n");
  const risks = plan.risks.length > 0 ? `\n\nRiesgos identificados:\n${plan.risks.map((risk) => `- ${risk}`).join("\n")}` : "";
  return `${plan.summary}\n\n${steps}${risks}`;
}

function describeOutcome(execution: LoopResult): string {
  if (execution.terminal?.name === "finish") {
    const input = execution.terminal.input as {
      summary: string;
      acceptance_met: string[];
      outstanding: string[];
    };
    const met =
      input.acceptance_met.length > 0
        ? `\n\nCriterios cumplidos:\n${input.acceptance_met.map((item) => `- ${item}`).join("\n")}`
        : "";
    const pending =
      input.outstanding.length > 0
        ? `\n\nPendiente:\n${input.outstanding.map((item) => `- ${item}`).join("\n")}`
        : "";
    return `${input.summary}${met}${pending}`;
  }

  const reasons: Record<string, string> = {
    max_iterations: "Se alcanzo el limite de iteraciones sin que el agente declarara el trabajo terminado.",
    budget: "Se agoto el presupuesto antes de terminar.",
    end_turn: "El agente dejo de actuar sin llamar a finish.",
    terminal: "El agente termino.",
  };
  const reason = reasons[execution.stop] ?? "Ejecucion interrumpida.";
  return execution.finalText ? `${reason}\n\n${execution.finalText}` : reason;
}

function normalizeError(error: unknown): { code: string; message: string } {
  if (error && typeof error === "object" && "code" in error && "message" in error) {
    return { code: String(error.code), message: String(error.message) };
  }
  return { code: "unexpected", message: error instanceof Error ? error.message : String(error) };
}
