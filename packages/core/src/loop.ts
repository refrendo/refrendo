import type Anthropic from "@anthropic-ai/sdk";
import type { Budget } from "./budget.js";
import { BudgetExceeded } from "./errors.js";
import type { EmitFn, Phase } from "./events.js";
import type { AnthropicProvider } from "./provider/anthropic.js";
import { toolByName } from "./tools/index.js";
import type { ToolContext, ToolDefinition, ToolOutcome } from "./types.js";

export type LoopStop = "terminal" | "end_turn" | "max_iterations" | "budget";

export interface LoopOptions {
  provider: AnthropicProvider;
  tools: ToolDefinition[];
  system: string;
  messages: Anthropic.Beta.BetaMessageParam[];
  ctx: ToolContext;
  budget: Budget;
  emit: EmitFn;
  phase: Phase;
  maxIterations: number;
}

export interface LoopResult {
  messages: Anthropic.Beta.BetaMessageParam[];
  /** Input validado de la herramienta terminal, si el bucle cerro por ahi. */
  terminal: { name: string; input: unknown } | null;
  finalText: string;
  stop: LoopStop;
}

/**
 * El bucle agentico.
 *
 * Se escribe a mano en vez de usar el tool runner del SDK porque cada iteracion
 * tiene que pasar por cosas que el runner no expone: comprobacion de presupuesto
 * antes de gastar, serializacion de las herramientas que mutan, aprobacion
 * humana, emision de eventos y cierre por herramienta terminal tipada.
 */
export async function runLoop(options: LoopOptions): Promise<LoopResult> {
  const { provider, tools, system, ctx, budget, emit, phase, maxIterations } = options;
  const messages = [...options.messages];
  let finalText = "";

  for (let iteration = 1; iteration <= maxIterations; iteration++) {
    try {
      budget.assertWithinBudget();
    } catch (error) {
      if (error instanceof BudgetExceeded) {
        return { messages, terminal: null, finalText, stop: "budget" };
      }
      throw error;
    }

    emit({ type: "iteration_started", phase, iteration, max: maxIterations });

    let turnText = "";
    const message = await provider.turn({
      system,
      messages,
      tools,
      onText: (delta) => {
        turnText += delta;
        emit({ type: "text_delta", text: delta });
      },
      ...(ctx.signal ? { signal: ctx.signal } : {}),
    });

    emit({ type: "usage_updated", usage: budget.record(provider.model, message.usage) });

    for (const block of message.content) {
      if (block.type === "thinking" && block.thinking) {
        emit({ type: "thinking_delta", text: block.thinking });
      }
      // El rescate por rechazo es silencioso salvo por este bloque. Sin
      // registrarlo, un run acabaria servido por otro modelo sin que nadie lo
      // supiera al revisar la traza.
      if (block.type === "fallback") {
        emit({
          type: "warning",
          message: `${block.from.model} declino la peticion; ${block.to.model} continuo el turno.`,
        });
      }
    }
    if (turnText.trim()) finalText = turnText.trim();

    messages.push({ role: "assistant", content: message.content });

    // Una herramienta de servidor agoto su cupo de iteraciones: se reenvia el
    // turno tal cual para que continue donde lo dejo.
    if (message.stop_reason === "pause_turn") continue;

    if (message.stop_reason === "refusal") {
      emit({
        type: "warning",
        message: "El modelo declino la peticion por politica de seguridad.",
      });
      return { messages, terminal: null, finalText, stop: "end_turn" };
    }

    const toolUses = message.content.filter(
      (block): block is Anthropic.Beta.BetaToolUseBlock => block.type === "tool_use",
    );

    if (toolUses.length === 0) {
      if (message.stop_reason === "max_tokens") {
        messages.push({
          role: "user",
          content: "Te has quedado sin espacio de respuesta. Continua de forma mas concisa.",
        });
        continue;
      }
      return { messages, terminal: null, finalText, stop: "end_turn" };
    }

    const { results, terminal } = await executeToolUses(toolUses, tools, ctx, emit);

    const content: Anthropic.Beta.BetaContentBlockParam[] = [...results];
    const pressureNote = budgetPressureNote(budget);
    if (pressureNote) content.push({ type: "text", text: pressureNote });
    messages.push({ role: "user", content });

    if (terminal) return { messages, terminal, finalText, stop: "terminal" };
  }

  return { messages, terminal: null, finalText, stop: "max_iterations" };
}

interface ExecutionOutput {
  results: Anthropic.Beta.BetaToolResultBlockParam[];
  terminal: { name: string; input: unknown } | null;
}

/**
 * Ejecuta las herramientas de un turno.
 *
 * Las de solo lectura van en paralelo; las que mutan, en serie. Dos ediciones
 * concurrentes sobre el mismo fichero se pisan la una a la otra y el resultado
 * depende del orden de finalizacion — un no-determinismo que no queremos en un
 * agente que promete resultados reproducibles.
 */
async function executeToolUses(
  toolUses: Anthropic.Beta.BetaToolUseBlock[],
  tools: ToolDefinition[],
  ctx: ToolContext,
  emit: EmitFn,
): Promise<ExecutionOutput> {
  const byId = new Map<string, Anthropic.Beta.BetaToolResultBlockParam>();
  let terminal: { name: string; input: unknown } | null = null;

  const readOnly = toolUses.filter((use) => !toolByName(tools, use.name)?.mutating);
  const mutating = toolUses.filter((use) => toolByName(tools, use.name)?.mutating);

  const invoke = async (use: Anthropic.Beta.BetaToolUseBlock): Promise<void> => {
    emit({ type: "tool_requested", id: use.id, name: use.name, input: use.input });
    const startedAt = Date.now();
    const definition = toolByName(tools, use.name);

    if (!definition) {
      byId.set(use.id, errorResult(use.id, `La herramienta "${use.name}" no existe.`));
      emit({
        type: "tool_completed",
        id: use.id,
        name: use.name,
        ok: false,
        summary: "herramienta desconocida",
        durationMs: 0,
      });
      return;
    }

    const parsed = definition.schema.safeParse(use.input);
    if (!parsed.success) {
      const detail = parsed.error.issues
        .map((issue) => `${issue.path.join(".") || "(raiz)"}: ${issue.message}`)
        .join("; ");
      byId.set(use.id, errorResult(use.id, `Argumentos invalidos — ${detail}`));
      emit({
        type: "tool_completed",
        id: use.id,
        name: use.name,
        ok: false,
        summary: "argumentos invalidos",
        durationMs: Date.now() - startedAt,
      });
      return;
    }

    let outcome: ToolOutcome;
    try {
      outcome = await definition.run(parsed.data, ctx);
    } catch (error) {
      outcome = { ok: false, content: error instanceof Error ? error.message : String(error) };
    }

    if (definition.terminal && outcome.ok) {
      terminal = { name: definition.name, input: parsed.data };
    }

    byId.set(use.id, {
      type: "tool_result",
      tool_use_id: use.id,
      content: outcome.content,
      ...(outcome.ok ? {} : { is_error: true }),
    });
    emit({
      type: "tool_completed",
      id: use.id,
      name: use.name,
      ok: outcome.ok,
      summary: firstLine(outcome.content),
      durationMs: Date.now() - startedAt,
    });
  };

  await Promise.all(readOnly.map(invoke));
  for (const use of mutating) await invoke(use);

  // El orden de los resultados debe reflejar el de las llamadas del modelo.
  const results = toolUses.map(
    (use) => byId.get(use.id) ?? errorResult(use.id, "La herramienta no produjo resultado."),
  );
  return { results, terminal };
}

function errorResult(toolUseId: string, message: string): Anthropic.Beta.BetaToolResultBlockParam {
  return { type: "tool_result", tool_use_id: toolUseId, content: message, is_error: true };
}

function firstLine(text: string): string {
  const line = text.split("\n", 1)[0] ?? "";
  return line.length > 140 ? `${line.slice(0, 140)}...` : line;
}

/**
 * Aviso de presion de presupuesto.
 *
 * Cortar en seco a mitad de una edicion deja el arbol inconsistente. Avisando
 * al agente de que le queda poco margen, este cierra ordenadamente: termina el
 * fichero que tiene entre manos y llama a finish.
 */
function budgetPressureNote(budget: Budget): string | null {
  const pressure = budget.pressure();
  if (pressure < 0.75) return null;
  const remaining = Math.max(0, budget.limits.maxCostUsd - budget.snapshot().costUsd);
  return `[presupuesto] Has consumido el ${Math.round(pressure * 100)} % del limite (quedan $${remaining.toFixed(3)}). Cierra lo que tengas a medias y llama a finish.`;
}
