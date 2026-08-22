import Anthropic from "@anthropic-ai/sdk";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { RefrendoAgent } from "../agent.js";
import { EventBus, type RefrendoEvent } from "../events.js";
import { AnthropicProvider } from "../provider/anthropic.js";
import { Workspace } from "../workspace.js";
import type { Gate } from "../verify.js";

let root: string;
let workspace: Workspace;
let bus: EventBus;
let events: RefrendoEvent[];

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "refrendo-agent-"));
  workspace = new Workspace(root);
  bus = new EventBus();
  events = [];
  bus.on((event) => events.push(event));
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

/**
 * Puerta que solo pasa cuando existe `arreglado.txt` en el workspace.
 *
 * Deja que el test dirija el veredicto de la verificacion con un efecto real
 * en disco, en vez de simulando el verificador: asi lo que se ejercita es el
 * ciclo completo, subproceso incluido.
 */
const CONDITIONAL_GATE: Gate = {
  name: "test",
  command: "node -e \"process.exit(require('fs').existsSync('arreglado.txt') ? 0 : 1)\"",
};

const ALWAYS_FAILS: Gate = { name: "test", command: "node -e \"process.exit(1)\"" };

/** Proveedor de mentira: devuelve turnos preprogramados sin tocar la red. */
function fakeProvider(turns: Anthropic.Beta.BetaMessage[]): AnthropicProvider {
  const provider = new AnthropicProvider({ client: new Anthropic({ apiKey: "clave-de-prueba" }) });
  let index = 0;
  // El ultimo turno se repite: si el agente insiste, recibe siempre lo mismo.
  (provider as unknown as { turn: () => Promise<Anthropic.Beta.BetaMessage> }).turn = async () => {
    const message = turns[Math.min(index, turns.length - 1)];
    index++;
    if (!message) throw new Error("El proveedor de prueba se quedo sin turnos.");
    return message;
  };
  return provider;
}

function message(content: unknown[]): Anthropic.Beta.BetaMessage {
  return {
    id: `msg_${Math.random().toString(36).slice(2)}`,
    type: "message",
    role: "assistant",
    model: "claude-opus-5",
    content,
    stop_reason: "tool_use",
    stop_sequence: null,
    usage: {
      input_tokens: 100,
      output_tokens: 50,
      cache_read_input_tokens: 0,
      cache_creation_input_tokens: 0,
    },
  } as unknown as Anthropic.Beta.BetaMessage;
}

const toolUse = (name: string, input: unknown) => ({
  type: "tool_use",
  id: `tu_${name}_${Math.random().toString(36).slice(2)}`,
  name,
  input,
});

const PLAN = toolUse("submit_plan", {
  summary: "Crear un fichero",
  steps: [{ description: "escribir", files: ["a.txt"], rationale: "porque si" }],
  risks: [],
  acceptance_checks: ["existe a.txt"],
});

const FINISH = toolUse("finish", { summary: "hecho", acceptance_met: [], outstanding: [] });

const agentWith = (provider: AnthropicProvider, overrides = {}) =>
  new RefrendoAgent({
    workspace,
    provider,
    policy: { autoApprove: true },
    bus,
    limits: { maxCostUsd: 5, maxIterations: 6, maxRepairAttempts: 1 },
    ...overrides,
  });

describe("ciclo completo", () => {
  it("marca VERIFICADO cuando las puertas pasan a la primera", async () => {
    const provider = fakeProvider([
      message([PLAN]),
      message([toolUse("write_file", { path: "arreglado.txt", content: "ok" })]),
      message([FINISH]),
    ]);

    const result = await agentWith(provider, { gates: [CONDITIONAL_GATE] }).run({ goal: "haz algo" });

    expect(result.status).toBe("verified");
    expect(result.verification?.passed).toBe(true);
    expect(result.repairAttempts).toBe(0);
    expect(result.changes.map((change) => change.path)).toEqual(["arreglado.txt"]);
    expect(await workspace.exists("arreglado.txt")).toBe(true);
  });

  it("repara tras un fallo de verificacion y vuelve a verificar", async () => {
    const provider = fakeProvider([
      message([PLAN]),
      message([toolUse("write_file", { path: "roto.txt", content: "x" })]),
      message([FINISH]),
      // Aqui la verificacion ya ha fallado y el agente recibe el error.
      message([toolUse("write_file", { path: "arreglado.txt", content: "ok" })]),
      message([FINISH]),
    ]);

    const result = await agentWith(provider, { gates: [CONDITIONAL_GATE] }).run({ goal: "haz algo" });

    expect(result.status).toBe("verified");
    expect(result.repairAttempts).toBe(1);
    expect(events.some((event) => event.type === "repair_started")).toBe(true);
    // Se verifico dos veces: la fallida y la que cerro en verde.
    expect(events.filter((event) => event.type === "verification_completed")).toHaveLength(2);
  });

  it("revierte los cambios cuando se agotan los intentos de reparacion", async () => {
    const provider = fakeProvider([
      message([PLAN]),
      message([toolUse("write_file", { path: "basura.txt", content: "no compila" })]),
      message([FINISH]),
    ]);

    const result = await agentWith(provider, { gates: [ALWAYS_FAILS] }).run({ goal: "haz algo" });

    expect(result.status).toBe("reverted");
    expect(result.repairAttempts).toBe(1);
    expect(result.changes).toEqual([]);
    // Lo importante: el arbol queda como estaba, sin restos que limpiar.
    expect(await workspace.exists("basura.txt")).toBe(false);
    expect(events.some((event) => event.type === "rollback_started")).toBe(true);
  });

  it("conserva los cambios con rollbackOnFailure desactivado", async () => {
    const provider = fakeProvider([
      message([PLAN]),
      message([toolUse("write_file", { path: "basura.txt", content: "no compila" })]),
      message([FINISH]),
    ]);

    const result = await agentWith(provider, {
      gates: [ALWAYS_FAILS],
      rollbackOnFailure: false,
    }).run({ goal: "haz algo" });

    expect(result.status).toBe("exhausted");
    expect(await workspace.exists("basura.txt")).toBe(true);
    expect(result.changes.map((change) => change.path)).toEqual(["basura.txt"]);
  });
});

describe("proyectos sin puertas", () => {
  it("avisa y marca SIN VERIFICAR en vez de fingir que verifico", async () => {
    const provider = fakeProvider([
      message([PLAN]),
      message([toolUse("write_file", { path: "a.txt", content: "x" })]),
      message([FINISH]),
    ]);

    const result = await agentWith(provider).run({ goal: "haz algo" });

    expect(result.status).toBe("unverified");
    expect(result.verification).toBeNull();
    expect(await workspace.exists("a.txt")).toBe(true);
    expect(
      events.some((event) => event.type === "warning" && event.message.includes("no declara puertas")),
    ).toBe(true);
  });

  it("revierte si el agente ni siquiera llega a declarar el trabajo terminado", async () => {
    const provider = fakeProvider([
      message([PLAN]),
      message([toolUse("write_file", { path: "a medias.txt", content: "x" })]),
    ]);

    const result = await agentWith(provider, { limits: { maxCostUsd: 5, maxIterations: 2, maxRepairAttempts: 1 } }).run({
      goal: "haz algo",
    });

    expect(result.status).toBe("reverted");
    expect(await workspace.exists("a medias.txt")).toBe(false);
  });
});

describe("modo plan", () => {
  it("entrega el plan sin tocar el disco", async () => {
    const provider = fakeProvider([message([PLAN])]);

    const result = await agentWith(provider, { planOnly: true }).run({ goal: "haz algo" });

    expect(result.plan?.summary).toBe("Crear un fichero");
    expect(result.plan?.steps[0]).toMatchObject({ id: 1, description: "escribir" });
    expect(result.changes).toEqual([]);
    expect(events.some((event) => event.type === "plan_ready")).toBe(true);
    // No debe haberse llegado nunca a la fase de ejecucion.
    expect(events.some((event) => event.type === "phase_started" && event.phase === "execute")).toBe(false);
  });
});

describe("contabilidad y traza", () => {
  it("acumula el consumo de todos los turnos del run", async () => {
    const provider = fakeProvider([message([PLAN]), message([FINISH])]);

    const result = await agentWith(provider).run({ goal: "haz algo" });

    expect(result.usage.requests).toBe(2);
    expect(result.usage.inputTokens).toBe(200);
    expect(result.usage.costUsd).toBeGreaterThan(0);
  });

  it("deja una traza reproducible que empieza y acaba donde debe", async () => {
    const provider = fakeProvider([message([PLAN]), message([FINISH])]);

    await agentWith(provider).run({ goal: "haz algo" });

    const transcript = bus.transcript();
    expect(transcript[0]?.type).toBe("run_started");
    expect(transcript.at(-1)?.type).toBe("run_finished");
  });
});
