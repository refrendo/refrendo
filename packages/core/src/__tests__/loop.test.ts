import type Anthropic from "@anthropic-ai/sdk";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Budget } from "../budget.js";
import { EventBus, type ForgeEvent } from "../events.js";
import { ChangeJournal } from "../journal.js";
import { runLoop } from "../loop.js";
import { Policy, defaultPolicyConfig } from "../policy.js";
import type { AnthropicProvider } from "../provider/anthropic.js";
import { EXECUTOR_TOOLS } from "../tools/index.js";
import type { ToolContext } from "../types.js";
import { Workspace } from "../workspace.js";

let root: string;
let ctx: ToolContext;
let bus: EventBus;
let events: ForgeEvent[];

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "forge-loop-"));
  const workspace = new Workspace(root);
  bus = new EventBus();
  events = [];
  bus.on((event) => events.push(event));
  ctx = {
    workspace,
    policy: new Policy(defaultPolicyConfig({ autoApprove: true })),
    journal: new ChangeJournal(workspace),
    emit: bus.emit,
    signal: new AbortController().signal,
  };
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

/** Proveedor de mentira: devuelve turnos preprogramados sin tocar la red. */
function fakeProvider(turns: Anthropic.Beta.BetaMessage[]): AnthropicProvider {
  let index = 0;
  return {
    model: "claude-opus-5",
    effort: "high",
    async turn() {
      const message = turns[Math.min(index, turns.length - 1)];
      index++;
      if (!message) throw new Error("El proveedor de prueba se quedo sin turnos.");
      return message;
    },
  } as unknown as AnthropicProvider;
}

function message(content: Anthropic.Beta.BetaContentBlock[], stopReason: Anthropic.Beta.BetaMessage["stop_reason"]): Anthropic.Beta.BetaMessage {
  return {
    id: `msg_${Math.random().toString(36).slice(2)}`,
    type: "message",
    role: "assistant",
    model: "claude-opus-5",
    content,
    stop_reason: stopReason,
    stop_sequence: null,
    usage: {
      input_tokens: 100,
      output_tokens: 50,
      cache_read_input_tokens: 0,
      cache_creation_input_tokens: 0,
    },
  } as unknown as Anthropic.Beta.BetaMessage;
}

function toolUse(name: string, input: unknown, id = `tu_${name}`): Anthropic.Beta.BetaContentBlock {
  return { type: "tool_use", id, name, input } as unknown as Anthropic.Beta.BetaContentBlock;
}

const baseOptions = () => ({
  tools: EXECUTOR_TOOLS,
  system: "sistema",
  messages: [{ role: "user" as const, content: "haz algo" }],
  ctx,
  budget: new Budget({ maxCostUsd: 10, maxIterations: 10, maxRepairAttempts: 2 }),
  emit: bus.emit,
  phase: "execute" as const,
  maxIterations: 5,
});

describe("runLoop", () => {
  it("ejecuta herramientas y cierra en la herramienta terminal", async () => {
    const provider = fakeProvider([
      message([toolUse("write_file", { path: "hola.txt", content: "mundo" })], "tool_use"),
      message(
        [toolUse("finish", { summary: "hecho", acceptance_met: ["a"], outstanding: [] })],
        "tool_use",
      ),
    ]);

    const result = await runLoop({ ...baseOptions(), provider });

    expect(result.stop).toBe("terminal");
    expect(result.terminal?.name).toBe("finish");
    expect(await ctx.workspace.readFile("hola.txt")).toBe("mundo");
    expect(ctx.journal.touchedFiles).toEqual(["hola.txt"]);
  });

  it("devuelve un error al modelo si los argumentos no validan, sin abortar", async () => {
    const provider = fakeProvider([
      message([toolUse("read_file", { ruta_mal: 1 })], "tool_use"),
      message([toolUse("finish", { summary: "s", acceptance_met: [], outstanding: [] })], "tool_use"),
    ]);

    const result = await runLoop({ ...baseOptions(), provider });

    expect(result.stop).toBe("terminal");
    const failed = events.find((event) => event.type === "tool_completed" && !event.ok);
    expect(failed).toBeDefined();
  });

  it("informa de herramientas inexistentes en vez de romper", async () => {
    const provider = fakeProvider([
      message([toolUse("herramienta_fantasma", {})], "tool_use"),
      message([toolUse("finish", { summary: "s", acceptance_met: [], outstanding: [] })], "tool_use"),
    ]);

    await runLoop({ ...baseOptions(), provider });

    const failure = events.find(
      (event) => event.type === "tool_completed" && event.summary === "herramienta desconocida",
    );
    expect(failure).toBeDefined();
  });

  it("termina cuando el modelo deja de pedir herramientas", async () => {
    const provider = fakeProvider([
      message([{ type: "text", text: "ya esta", citations: null } as unknown as Anthropic.Beta.BetaContentBlock], "end_turn"),
    ]);

    const result = await runLoop({ ...baseOptions(), provider });

    expect(result.stop).toBe("end_turn");
    expect(result.terminal).toBeNull();
  });

  it("respeta el limite de iteraciones", async () => {
    const provider = fakeProvider([message([toolUse("list_files", { path: ".", max_depth: 1 })], "tool_use")]);

    const result = await runLoop({ ...baseOptions(), provider, maxIterations: 3 });

    expect(result.stop).toBe("max_iterations");
    const iterations = events.filter((event) => event.type === "iteration_started");
    expect(iterations).toHaveLength(3);
  });

  it("para en seco cuando el presupuesto esta agotado", async () => {
    const budget = new Budget({ maxCostUsd: 0.0001, maxIterations: 10, maxRepairAttempts: 1 });
    budget.record("claude-opus-5", {
      input_tokens: 1_000_000,
      output_tokens: 0,
      cache_read_input_tokens: 0,
      cache_creation_input_tokens: 0,
    } as never);

    const provider = fakeProvider([message([toolUse("list_files", { path: ".", max_depth: 1 })], "tool_use")]);
    const result = await runLoop({ ...baseOptions(), provider, budget });

    expect(result.stop).toBe("budget");
    expect(events.some((event) => event.type === "iteration_started")).toBe(false);
  });

  it("reenvia el turno cuando una herramienta de servidor lo pausa", async () => {
    const provider = fakeProvider([
      message([{ type: "text", text: "pausa", citations: null } as unknown as Anthropic.Beta.BetaContentBlock], "pause_turn"),
      message([toolUse("finish", { summary: "s", acceptance_met: [], outstanding: [] })], "tool_use"),
    ]);

    const result = await runLoop({ ...baseOptions(), provider });

    expect(result.stop).toBe("terminal");
  });
});
