import { describe, expect, it } from "vitest";
import type { RunResult } from "@forge/core";
import { escapeHtml, html, join, raw } from "../html.js";
import { renderRecord, verificationRounds } from "../render/record.js";
import { renderIndex } from "../render/index-page.js";
import type { RunRow, StoredEvent } from "../store.js";

const XSS = `<script>alert(1)</script>`;

describe("escapado", () => {
  it("neutraliza los cinco caracteres peligrosos", () => {
    expect(escapeHtml(`<>&"'`)).toBe("&lt;&gt;&amp;&quot;&#39;");
  });

  it("escapa por defecto en la plantilla", () => {
    expect(html`<p>${XSS}</p>`.value).toBe("<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>");
  });

  it("no vuelve a escapar lo que ya viene marcado como seguro", () => {
    const inner = html`<b>${"a & b"}</b>`;
    expect(html`<div>${inner}</div>`.value).toBe("<div><b>a &amp; b</b></div>");
  });

  it("respeta raw() como única vía de escape deliberado", () => {
    expect(html`${raw("<hr>")}`.value).toBe("<hr>");
  });

  it("aplana arrays escapando cada elemento", () => {
    expect(html`${["<a>", "<b>"]}`.value).toBe("&lt;a&gt;&lt;b&gt;");
  });

  it("join no reescapa fragmentos ya construidos", () => {
    expect(join([html`<i>${"x&y"}</i>`, html`<i>z</i>`]).value).toBe("<i>x&amp;y</i><i>z</i>");
  });
});

const baseRun: RunRow = {
  id: "11111111-1111-1111-1111-111111111111",
  createdAt: "2026-08-22T10:00:00.000Z",
  finishedAt: "2026-08-22T10:02:00.000Z",
  status: "reverted",
  goal: "arreglar el login",
  workspace: "/repos/api",
  repo: "api",
  actor: "ana",
  model: "claude-opus-5",
  costUsd: 0.41,
  result: null,
};

const resultWith = (over: Partial<RunResult> = {}): RunResult => ({
  status: "reverted",
  contract: { goal: "arreglar el login" },
  plan: null,
  summary: "no se pudo",
  changes: [],
  verification: null,
  repairAttempts: 2,
  usage: {
    inputTokens: 1000,
    outputTokens: 500,
    cacheReadTokens: 200,
    cacheWriteTokens: 0,
    costUsd: 0.41,
    requests: 4,
  },
  durationMs: 120_000,
  ...over,
});

describe("página del run", () => {
  it("neutraliza la salida de comandos, que es texto no confiable", () => {
    const run: RunRow = {
      ...baseRun,
      result: resultWith({
        verification: {
          passed: false,
          ranAt: "2026-08-22T10:01:00.000Z",
          gates: [
            {
              name: "test",
              command: "npm test",
              passed: false,
              skipped: false,
              durationMs: 3000,
              exitCode: 1,
              output: `FAIL ${XSS}`,
            },
          ],
        },
      }),
    };

    const page = renderRecord(run, []);
    expect(page).not.toContain("<script>alert(1)</script>");
    expect(page).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
  });

  it("neutraliza también el objetivo y las rutas de fichero", () => {
    const run: RunRow = {
      ...baseRun,
      goal: XSS,
      result: resultWith({
        changes: [{ path: `src/${XSS}.ts`, kind: "modified", linesAdded: 1, linesRemoved: 0 }],
      }),
    };

    const page = renderRecord(run, []);
    expect(page).not.toContain("<script>alert(1)</script>");
  });

  it("muestra el veredicto y lo que significa, no solo una etiqueta", () => {
    const page = renderRecord({ ...baseRun, result: resultWith() }, []);
    expect(page).toContain("Revertido");
    expect(page).toContain("revirtieron");
  });

  it("dice explícitamente cuando no hay nada que demuestre el resultado", () => {
    const page = renderRecord({ ...baseRun, status: "unverified", result: resultWith({ status: "unverified" }) }, []);
    expect(page).toContain("no declara puertas de verificacion");
  });

  it("recupera puertas y plan de la traza mientras el run sigue vivo", () => {
    const events: StoredEvent[] = [
      {
        seq: 1,
        at: "2026-08-22T10:00:30.000Z",
        event: {
          type: "gate_completed",
          gate: {
            name: "typecheck",
            command: "npm run typecheck",
            passed: true,
            skipped: false,
            durationMs: 2000,
            exitCode: 0,
            output: "",
          },
        },
      },
    ];

    const page = renderRecord({ ...baseRun, status: "running", result: null }, events);
    expect(page).toContain("typecheck");
    expect(page).toContain("live-dot");
    expect(page).toContain("EventSource");
  });

  it("no arrastra a la traza los fragmentos de texto en streaming", () => {
    const events: StoredEvent[] = [
      { seq: 1, at: "2026-08-22T10:00:01.000Z", event: { type: "text_delta", text: "hola" } },
      { seq: 2, at: "2026-08-22T10:00:02.000Z", event: { type: "warning", message: "aviso real" } },
    ];
    const page = renderRecord({ ...baseRun, result: resultWith() }, events);
    expect(page).toContain("aviso real");
    expect(page).not.toContain(">hola<");
  });
});

describe("listado", () => {
  it("encabeza con la tasa de verificación", () => {
    const page = renderIndex([baseRun], { total: 4, verified: 3, reverted: 1, costUsd: 1.5 });
    expect(page).toContain("Tasa de verificacion");
    expect(page).toContain("75 %");
  });

  it("no divide por cero sin runs", () => {
    const page = renderIndex([], { total: 0, verified: 0, reverted: 0, costUsd: 0 });
    expect(page).toContain("0 %");
    expect(page).toContain("Todavia no hay runs");
  });
});

describe("ciclos de reparación", () => {
  const round = (gates: Array<{ name: string; passed: boolean; output?: string }>, passed: boolean): StoredEvent[] => [
    { seq: 0, at: "2026-08-22T10:00:00.000Z", event: { type: "verification_started", gates: gates.map((g) => g.name) } },
    ...gates.map((g, i) => ({
      seq: i + 1,
      at: "2026-08-22T10:00:01.000Z",
      event: {
        type: "gate_completed" as const,
        gate: {
          name: g.name,
          command: `npm run ${g.name}`,
          passed: g.passed,
          skipped: false,
          durationMs: 100,
          exitCode: g.passed ? 0 : 1,
          output: g.output ?? "",
        },
      },
    })),
    { seq: 99, at: "2026-08-22T10:00:02.000Z", event: { type: "verification_completed", passed } },
  ];

  it("agrupa las puertas por ronda de verificación", () => {
    const events = [
      ...round([{ name: "test", passed: false, output: "boom" }], false),
      ...round([{ name: "test", passed: true }], true),
    ];
    const rounds = verificationRounds(events);
    expect(rounds).toHaveLength(2);
    expect(rounds[0]!.passed).toBe(false);
    expect(rounds[1]!.passed).toBe(true);
  });

  it("muestra la salida real del fallo que el agente corrigió", () => {
    const events = [
      ...round([{ name: "test", passed: false, output: "AssertionError: expected 500 to be 400" }], false),
      ...round([{ name: "test", passed: true }], true),
    ];
    const page = renderRecord({ ...baseRun, status: "verified", result: resultWith({ status: "verified" }) }, events);
    expect(page).toContain("Lo que fallo por el camino");
    expect(page).toContain("expected 500 to be 400");
  });

  it("no aparece cuando todo pasó a la primera", () => {
    const events = round([{ name: "test", passed: true }], true);
    const page = renderRecord({ ...baseRun, status: "verified", result: resultWith({ status: "verified" }) }, events);
    expect(page).not.toContain("Lo que fallo por el camino");
  });

  it("escapa la salida del fallo igual que la del veredicto final", () => {
    const events = [...round([{ name: "test", passed: false, output: XSS }], false), ...round([{ name: "test", passed: true }], true)];
    const page = renderRecord({ ...baseRun, result: resultWith() }, events);
    expect(page).not.toContain("<script>alert(1)</script>");
  });
});
