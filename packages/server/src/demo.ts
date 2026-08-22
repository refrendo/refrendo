import type { RefrendoEvent, RunResult } from "@refrendo/core";
import type { RunStore } from "./store.js";

/**
 * Siembra un run de ejemplo completo.
 *
 * Existe por una razon comercial, no de desarrollo: alguien que descubre Refrendo
 * tiene que poder ver que hace en treinta segundos, sin clave de API, sin
 * conectar un repositorio y sin esperar a que un agente termine. La pagina del
 * run es el producto, y esto la pone delante de sus ojos de inmediato.
 *
 * Los datos son de un caso real y aburrido a proposito: el agente se equivoca a
 * la primera, la puerta lo caza, lo arregla y entonces pasa. Ese es el ciclo que
 * hay que enseñar — un ejemplo que sale bien a la primera no demuestra nada.
 */
export function seedDemoRun(store: RunStore): string {
  const contract = {
    goal: "Añadir paginación al endpoint GET /users",
    acceptance: [
      "El endpoint acepta los parámetros page y limit",
      "Una página fuera de rango devuelve 400, no 500",
      "Hay test para el caso límite",
    ],
  };

  const run = store.createRun({
    contract,
    workspace: "/repos/api",
    repo: "api",
    actor: "ana@equipo.dev",
    model: "claude-opus-5",
  });

  const failingGate = {
    name: "test",
    command: "npm test",
    passed: false,
    skipped: false,
    durationMs: 4120,
    exitCode: 1,
    output: [
      "FAIL  src/routes/users.test.ts > paginación > página fuera de rango",
      "",
      "AssertionError: expected 500 to be 400",
      "",
      "  ❯ src/routes/users.test.ts:48:32",
      "    46|   it('devuelve 400 si la página no existe', async () => {",
      "    47|     const res = await request(app).get('/users?page=0');",
      "    48|     expect(res.status).toBe(400);",
      "      |                                ^",
      "",
      "Test Files  1 failed | 6 passed (7)",
      "     Tests  1 failed | 43 passed (44)",
    ].join("\n"),
  };

  const passingTest = { ...failingGate, passed: true, exitCode: 0, durationMs: 3980, output: "Test Files  7 passed (7)\n     Tests  44 passed (44)" };
  const typecheck = {
    name: "typecheck",
    command: "npm run typecheck",
    passed: true,
    skipped: false,
    durationMs: 3510,
    exitCode: 0,
    output: "",
  };

  const events: RefrendoEvent[] = [
    { type: "run_started", contract, workspace: "/repos/api", at: new Date().toISOString() },
    { type: "phase_started", phase: "plan" },
    { type: "tool_requested", id: "t1", name: "list_files", input: { path: "src" } },
    { type: "tool_completed", id: "t1", name: "list_files", ok: true, summary: "34 entradas", durationMs: 12 },
    { type: "tool_requested", id: "t2", name: "read_file", input: { path: "src/routes/users.ts" } },
    { type: "tool_completed", id: "t2", name: "read_file", ok: true, summary: "82 líneas", durationMs: 8 },
    {
      type: "plan_ready",
      plan: {
        summary: "Parsear page y limit en el endpoint, validar el rango y cubrirlo con un test.",
        steps: [
          {
            id: 1,
            description: "Parsear y validar los parámetros de consulta",
            files: ["src/routes/users.ts"],
            rationale: "Es donde ya se resuelve la consulta a base de datos",
          },
          {
            id: 2,
            description: "Devolver 400 cuando la página está fuera de rango",
            files: ["src/routes/users.ts"],
            rationale: "Hoy revienta con 500 porque el offset sale negativo",
          },
          {
            id: 3,
            description: "Añadir test del caso límite",
            files: ["src/routes/users.test.ts"],
            rationale: "El criterio de aceptación lo pide explícitamente",
          },
        ],
        risks: ["Tres llamadores usan este endpoint sin parámetros; el comportamiento por defecto no debe cambiar"],
        acceptanceChecks: ["npm test pasa", "GET /users?page=0 devuelve 400"],
      },
    },
    { type: "phase_started", phase: "execute" },
    { type: "tool_requested", id: "t3", name: "edit_file", input: { path: "src/routes/users.ts" } },
    { type: "file_changed", change: { path: "src/routes/users.ts", kind: "modified", linesAdded: 24, linesRemoved: 6 } },
    { type: "tool_completed", id: "t3", name: "edit_file", ok: true, summary: "Editado src/routes/users.ts", durationMs: 21 },
    { type: "tool_requested", id: "t4", name: "write_file", input: { path: "src/routes/users.test.ts" } },
    { type: "file_changed", change: { path: "src/routes/users.test.ts", kind: "modified", linesAdded: 31, linesRemoved: 0 } },
    { type: "tool_completed", id: "t4", name: "write_file", ok: true, summary: "Actualizado src/routes/users.test.ts", durationMs: 15 },
    {
      type: "usage_updated",
      usage: { inputTokens: 96_400, outputTokens: 7_180, cacheReadTokens: 71_200, cacheWriteTokens: 12_100, costUsd: 0.2814, requests: 9 },
    },
    { type: "phase_started", phase: "verify" },
    { type: "verification_started", gates: ["typecheck", "test"] },
    { type: "gate_completed", gate: typecheck },
    { type: "gate_completed", gate: failingGate },
    { type: "verification_completed", passed: false },
    { type: "repair_started", attempt: 1, max: 3, failing: ["test"] },
    { type: "phase_started", phase: "repair" },
    { type: "tool_requested", id: "t5", name: "edit_file", input: { path: "src/routes/users.ts" } },
    { type: "file_changed", change: { path: "src/routes/users.ts", kind: "modified", linesAdded: 3, linesRemoved: 1 } },
    { type: "tool_completed", id: "t5", name: "edit_file", ok: true, summary: "Editado src/routes/users.ts", durationMs: 18 },
    { type: "phase_started", phase: "verify" },
    { type: "verification_started", gates: ["typecheck", "test"] },
    { type: "gate_completed", gate: typecheck },
    { type: "gate_completed", gate: passingTest },
    { type: "verification_completed", passed: true },
    { type: "phase_started", phase: "finalize" },
    {
      type: "usage_updated",
      usage: { inputTokens: 186_400, outputTokens: 11_340, cacheReadTokens: 142_100, cacheWriteTokens: 12_100, costUsd: 0.4127, requests: 14 },
    },
  ];

  for (const event of events) store.appendEvent(run.id, event);

  const result: RunResult = {
    status: "verified",
    contract,
    plan: (events.find((event) => event.type === "plan_ready") as Extract<RefrendoEvent, { type: "plan_ready" }>).plan,
    summary:
      "Añadida paginación a GET /users con parámetros page y limit. El primer intento devolvía 500 cuando page era 0 porque el offset salía negativo; ahora se valida el rango antes de consultar y se responde 400 con un mensaje explícito. Añadido test del caso límite.",
    changes: [
      { path: "src/routes/users.ts", kind: "modified", linesAdded: 27, linesRemoved: 7 },
      { path: "src/routes/users.test.ts", kind: "modified", linesAdded: 31, linesRemoved: 0 },
    ],
    verification: {
      passed: true,
      ranAt: new Date().toISOString(),
      gates: [typecheck, passingTest],
    },
    repairAttempts: 1,
    usage: {
      inputTokens: 186_400,
      outputTokens: 11_340,
      cacheReadTokens: 142_100,
      cacheWriteTokens: 12_100,
      costUsd: 0.4127,
      requests: 14,
    },
    durationMs: 78_400,
  };

  store.appendEvent(run.id, { type: "run_finished", result });
  store.finishRun(run.id, result);

  return run.id;
}
