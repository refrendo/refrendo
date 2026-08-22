import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { RunResult } from "@forge/core";
import { RunStore } from "../store.js";

let store: RunStore;

beforeEach(async () => {
  store = await RunStore.open(":memory:");
});

afterEach(() => {
  store.close();
});

const contract = { goal: "añadir paginación" };

const createRun = () =>
  store.createRun({ contract, workspace: "/repos/api", repo: "api", actor: "ana", model: "claude-opus-5" });

const result = (over: Partial<RunResult> = {}): RunResult => ({
  status: "verified",
  contract,
  plan: null,
  summary: "hecho",
  changes: [],
  verification: null,
  repairAttempts: 0,
  usage: {
    inputTokens: 100,
    outputTokens: 50,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    costUsd: 0.42,
    requests: 3,
  },
  durationMs: 1000,
  ...over,
});

describe("ciclo de vida del run", () => {
  it("nace en curso y sin coste", () => {
    const run = createRun();
    expect(run.status).toBe("running");
    expect(run.costUsd).toBe(0);
    expect(store.getRun(run.id)?.goal).toBe("añadir paginación");
  });

  it("guarda el veredicto y el resultado completo al terminar", () => {
    const run = createRun();
    store.finishRun(run.id, result());

    const stored = store.getRun(run.id)!;
    expect(stored.status).toBe("verified");
    expect(stored.finishedAt).not.toBeNull();
    expect(stored.costUsd).toBeCloseTo(0.42, 6);
    expect(stored.result?.summary).toBe("hecho");
  });

  it("devuelve null para un identificador que no existe", () => {
    expect(store.getRun("00000000-0000-0000-0000-000000000000")).toBeNull();
  });
});

describe("traza de eventos", () => {
  it("asigna secuencias consecutivas empezando en 1", () => {
    const run = createRun();
    expect(store.appendEvent(run.id, { type: "warning", message: "a" })).toBe(1);
    expect(store.appendEvent(run.id, { type: "warning", message: "b" })).toBe(2);
    expect(store.appendEvent(run.id, { type: "warning", message: "c" })).toBe(3);
  });

  it("numera cada run por separado", () => {
    const a = createRun();
    const b = createRun();
    store.appendEvent(a.id, { type: "warning", message: "a1" });
    store.appendEvent(a.id, { type: "warning", message: "a2" });
    expect(store.appendEvent(b.id, { type: "warning", message: "b1" })).toBe(1);
  });

  it("permite reanudar desde una secuencia, que es lo que hace el stream", () => {
    const run = createRun();
    for (const message of ["a", "b", "c", "d"]) {
      store.appendEvent(run.id, { type: "warning", message });
    }

    const rest = store.getEvents(run.id, 2);
    expect(rest.map((entry) => entry.seq)).toEqual([3, 4]);
    expect(rest[0]!.event).toMatchObject({ type: "warning", message: "c" });
  });

  it("proyecta el coste en caliente para poder listar sin releer la traza", () => {
    const run = createRun();
    store.appendEvent(run.id, {
      type: "usage_updated",
      usage: {
        inputTokens: 10,
        outputTokens: 5,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        costUsd: 0.13,
        requests: 1,
      },
    });
    expect(store.getRun(run.id)?.costUsd).toBeCloseTo(0.13, 6);
  });

  it("conserva el evento entero, no solo su tipo", () => {
    const run = createRun();
    store.appendEvent(run.id, {
      type: "gate_completed",
      gate: {
        name: "test",
        command: "npm test",
        passed: false,
        skipped: false,
        durationMs: 1200,
        exitCode: 1,
        output: "FAIL src/a.test.ts",
      },
    });

    const [entry] = store.getEvents(run.id);
    expect(entry!.event).toMatchObject({
      type: "gate_completed",
      gate: { name: "test", exitCode: 1, output: "FAIL src/a.test.ts" },
    });
  });
});

describe("listado y agregados", () => {
  it("ordena por fecha descendente y filtra por repositorio", () => {
    store.createRun({ contract, workspace: "/repos/api", repo: "api" });
    store.createRun({ contract, workspace: "/repos/web", repo: "web" });

    expect(store.listRuns()).toHaveLength(2);
    expect(store.listRuns({ repo: "web" }).map((run) => run.repo)).toEqual(["web"]);
  });

  it("calcula la tasa de verificación, que es la métrica que se factura", () => {
    const verified = createRun();
    const reverted = createRun();
    createRun(); // sigue en curso

    store.finishRun(verified.id, result());
    store.finishRun(reverted.id, result({ status: "reverted", usage: { ...result().usage, costUsd: 0.1 } }));

    const summary = store.summary();
    expect(summary.total).toBe(3);
    expect(summary.verified).toBe(1);
    expect(summary.reverted).toBe(1);
    expect(summary.costUsd).toBeCloseTo(0.52, 6);
  });
});

describe("fallos del servidor", () => {
  it("marca como fallido un run que murió sin veredicto", () => {
    const run = createRun();
    store.failRun(run.id, "el proceso se quedó sin memoria");
    expect(store.getRun(run.id)?.status).toBe("failed");
  });

  it("no pisa el veredicto de un run que ya había terminado", () => {
    const run = createRun();
    store.finishRun(run.id, result());
    store.failRun(run.id, "llega tarde");
    expect(store.getRun(run.id)?.status).toBe("verified");
  });
});
