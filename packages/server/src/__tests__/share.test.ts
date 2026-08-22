import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { shareSecret, signShare, verifyShare } from "../share.js";
import { renderTeam } from "../render/team.js";
import { startServer, type RunningServer } from "../index.js";
import { seedDemoRun } from "../demo.js";

const RUN_A = "11111111-1111-1111-1111-111111111111";
const RUN_B = "22222222-2222-2222-2222-222222222222";

describe("enlaces firmados", () => {
  const secret = shareSecret("token-del-servidor");

  it("acepta el enlace del run para el que se emitio", () => {
    const { token } = signShare(secret, RUN_A);
    expect(verifyShare(secret, RUN_A, token)).toBe(true);
  });

  it("no sirve para otro run — la firma cubre el identificador", () => {
    const { token } = signShare(secret, RUN_A);
    expect(verifyShare(secret, RUN_B, token)).toBe(false);
  });

  it("no vale con otro secreto", () => {
    const { token } = signShare(secret, RUN_A);
    expect(verifyShare(shareSecret("otro-token"), RUN_A, token)).toBe(false);
  });

  it("caduca", () => {
    const { token } = signShare(secret, RUN_A, 60);
    vi.useFakeTimers();
    try {
      vi.setSystemTime(Date.now() + 61_000);
      expect(verifyShare(secret, RUN_A, token)).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("rechaza una fecha de caducidad manipulada", () => {
    const { token } = signShare(secret, RUN_A, 60);
    const signature = token.slice(token.indexOf(".") + 1);
    const estirado = `${Math.floor(Date.now() / 1000) + 999_999}.${signature}`;
    expect(verifyShare(secret, RUN_A, estirado)).toBe(false);
  });

  it("rechaza basura y ausencia", () => {
    expect(verifyShare(secret, RUN_A, null)).toBe(false);
    expect(verifyShare(secret, RUN_A, "")).toBe(false);
    expect(verifyShare(secret, RUN_A, "sinpunto")).toBe(false);
    expect(verifyShare(secret, RUN_A, ".firma")).toBe(false);
  });

  it("deriva el mismo secreto del mismo token del servidor, para sobrevivir a un reinicio", () => {
    const { token } = signShare(shareSecret("estable"), RUN_A);
    expect(verifyShare(shareSecret("estable"), RUN_A, token)).toBe(true);
  });
});

describe("plano de equipo", () => {
  it("calcula tasa y coste por run verificado", () => {
    const page = renderTeam({
      byRepo: [{ key: "api", runs: 4, verified: 3, reverted: 1, costUsd: 1.2 }],
      byActor: [{ key: "ana", runs: 4, verified: 3, reverted: 1, costUsd: 1.2 }],
      summary: { total: 4, verified: 3, reverted: 1, costUsd: 1.2 },
    });

    expect(page).toContain("75 %");
    expect(page).toContain("$0.4000"); // 1.2 / 3 verificados
  });

  it("no divide por cero cuando nada quedo verificado", () => {
    const page = renderTeam({
      byRepo: [{ key: "api", runs: 2, verified: 0, reverted: 2, costUsd: 0.5 }],
      byActor: [],
      summary: { total: 2, verified: 0, reverted: 2, costUsd: 0.5 },
    });
    expect(page).toContain("0 %");
    expect(page).toContain("—");
  });

  it("dice que no hay datos en vez de pintar una tabla vacia", () => {
    const page = renderTeam({
      byRepo: [],
      byActor: [],
      summary: { total: 0, verified: 0, reverted: 0, costUsd: 0 },
    });
    expect(page).toContain("Sin datos todavia");
  });
});

describe("comparticion sobre el servidor", () => {
  let server: RunningServer;
  let repo: string;
  let runId: string;

  beforeEach(async () => {
    repo = await fs.mkdtemp(path.join(os.tmpdir(), "refrendo-share-"));
    server = await startServer({
      allowedRoots: [repo],
      dbFile: ":memory:",
      port: 0,
      host: "127.0.0.1",
      token: "token-de-prueba-largo",
    });
    runId = seedDemoRun(server.store);
  });

  afterEach(async () => {
    await server.close();
    await fs.rm(repo, { recursive: true, force: true });
  });

  const auth = { Authorization: "Bearer token-de-prueba-largo" };

  it("emite un enlace que abre el run sin token", async () => {
    const created = await fetch(`${server.url}/api/runs/${runId}/share`, { method: "POST", headers: auth });
    expect(created.status).toBe(200);
    const { url } = (await created.json()) as { url: string };

    // Sin cabecera de autorizacion: es justo la gracia del enlace.
    const shared = await fetch(url);
    expect(shared.status).toBe(200);
    await expect(shared.text()).resolves.toContain("Verificado");
  });

  it("el enlace no abre el listado ni el plano de equipo", async () => {
    const created = await fetch(`${server.url}/api/runs/${runId}/share`, { method: "POST", headers: auth });
    const { url } = (await created.json()) as { url: string };
    const query = new URL(url).search;

    expect((await fetch(`${server.url}/${query}`)).status).toBe(401);
    expect((await fetch(`${server.url}/team${query}`)).status).toBe(401);
  });

  it("emitir un enlace exige estar autenticado", async () => {
    const response = await fetch(`${server.url}/api/runs/${runId}/share`, { method: "POST" });
    expect(response.status).toBe(401);
  });

  it("una firma de otro run no abre este", async () => {
    const created = await fetch(`${server.url}/api/runs/${runId}/share`, { method: "POST", headers: auth });
    const { url } = (await created.json()) as { url: string };
    const token = new URL(url).searchParams.get("s")!;

    const otro = await fetch(`${server.url}/r/${RUN_A}?s=${encodeURIComponent(token)}`);
    expect(otro.status).toBe(401);
  });

  it("sirve el plano de equipo con token", async () => {
    const response = await fetch(`${server.url}/team`, { headers: auth });
    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain("Por repositorio");
    expect(html).toContain("api");
  });
});
