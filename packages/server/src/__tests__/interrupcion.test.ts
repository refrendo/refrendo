import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RunStore } from "../store.js";
import { recordRun } from "../record.js";

/**
 * Un run que nadie cierra es peor que un run fallido.
 *
 * Queda en curso para siempre y cuenta en el total del plano de equipo sin
 * contar nunca entre los verificados, asi que rebaja la tasa de verificacion
 * — que es la cifra sobre la que se factura y con la que se vende. Un fallo
 * silencioso en una metrica es mas caro que uno ruidoso en el codigo.
 */

let store: RunStore;

const contrato = { goal: "hacer algo" };
const nuevo = () => store.createRun({ contract: contrato, workspace: "/repo", repo: "repo" });

beforeEach(async () => {
  store = await RunStore.open(":memory:");
});

afterEach(() => {
  store.close();
  vi.useRealTimers();
});

describe("runs interrumpidos", () => {
  it("un run sin cerrar arrastra la tasa de verificacion hacia abajo", () => {
    const abandonado = nuevo();
    expect(store.getRun(abandonado.id)?.status).toBe("running");

    // Con un run eterno en curso, el total sube y los verificados no.
    expect(store.summary()).toMatchObject({ total: 1, verified: 0 });
  });

  it("marcar la interrupcion deja constancia del motivo", () => {
    const run = nuevo();
    store.markInterrupted(run.id, "Run interrumpido (SIGINT) antes de emitir veredicto.");

    const cerrado = store.getRun(run.id)!;
    expect(cerrado.status).toBe("failed");
    expect(cerrado.finishedAt).not.toBeNull();
    expect(JSON.stringify(cerrado.result)).toContain("SIGINT");
  });

  it("no pisa un run que ya tenia veredicto", () => {
    const run = nuevo();
    store.finishRun(run.id, {
      status: "verified",
      contract: contrato,
      plan: null,
      summary: "hecho",
      changes: [],
      verification: null,
      repairAttempts: 0,
      usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, costUsd: 0, requests: 1 },
      durationMs: 10,
    });

    store.markInterrupted(run.id, "llega tarde");
    expect(store.getRun(run.id)?.status).toBe("verified");
  });
});

describe("reconciliacion de huerfanos al arrancar", () => {
  it("no toca los runs recientes, que pueden estar vivos de verdad", () => {
    nuevo();
    expect(store.reconcileStaleRuns()).toBe(0);
    expect(store.summary().total).toBe(1);
  });

  it("cierra los que llevan demasiado tiempo sin terminar", () => {
    const run = nuevo();

    // Se adelanta el reloj en vez de tocar la fila a mano: asi se ejercita la
    // comparacion de fechas real, que es donde estaria el fallo.
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 7 * 3600_000);

    expect(store.reconcileStaleRuns(6)).toBe(1);
    const cerrado = store.getRun(run.id)!;
    expect(cerrado.status).toBe("failed");
    expect(JSON.stringify(cerrado.result)).toContain("interrupted");
  });

  it("es idempotente: pasar dos veces no cambia nada", () => {
    nuevo();
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 7 * 3600_000);

    expect(store.reconcileStaleRuns(6)).toBe(1);
    expect(store.reconcileStaleRuns(6)).toBe(0);
  });

  it("respeta a los que ya terminaron", () => {
    const run = nuevo();
    store.failRun(run.id, "fallo normal");

    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 99 * 3600_000);

    expect(store.reconcileStaleRuns(6)).toBe(0);
  });
});

describe("grabacion", () => {
  it("expone interrupt junto a finish", () => {
    const grabacion = recordRun(store, { contract: contrato, workspace: "/repo", repo: "repo" });
    grabacion.interrupt("cortado");

    expect(store.getRun(grabacion.id)?.status).toBe("failed");
  });

  it("no revienta si el almacen ya esta cerrado", () => {
    const grabacion = recordRun(store, { contract: contrato, workspace: "/repo", repo: "repo" });
    store.close();

    // Perder la traza es malo; tumbar el proceso del usuario al salir, peor.
    expect(() => grabacion.interrupt("cortado")).not.toThrow();
    expect(() => grabacion.listener({ type: "warning", message: "x" })).not.toThrow();
  });
});

describe("cierre del almacen", () => {
  it("cerrar dos veces no lanza", async () => {
    const otro = await RunStore.open(":memory:");
    otro.close();
    expect(() => otro.close()).not.toThrow();
  });
});
