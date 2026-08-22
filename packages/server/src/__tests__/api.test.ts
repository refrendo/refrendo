import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { startServer, type RunningServer } from "../index.js";

let server: RunningServer;
let repo: string;
let outside: string;

beforeEach(async () => {
  repo = await fs.mkdtemp(path.join(os.tmpdir(), "refrendo-repo-"));
  outside = await fs.mkdtemp(path.join(os.tmpdir(), "refrendo-outside-"));
  server = await startServer({ allowedRoots: [repo], dbFile: ":memory:", port: 0 });
});

afterEach(async () => {
  await server.close();
  await fs.rm(repo, { recursive: true, force: true });
  await fs.rm(outside, { recursive: true, force: true });
});

const get = (route: string) => fetch(`${server.url}${route}`);
const post = (route: string, body: unknown) =>
  fetch(`${server.url}${route}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

describe("rutas", () => {
  it("responde al chequeo de salud sin autenticación", async () => {
    const response = await get("/healthz");
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true });
  });

  it("sirve el listado vacío", async () => {
    const response = await get("/");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/html");
    await expect(response.text()).resolves.toContain("Todavia no hay runs");
  });

  it("devuelve 404 en un run inexistente", async () => {
    const response = await get("/r/11111111-1111-1111-1111-111111111111");
    expect(response.status).toBe(404);
  });

  it("ignora rutas desconocidas", async () => {
    expect((await get("/../etc/passwd")).status).toBe(404);
  });

  it("declara una política de contenido en las páginas", async () => {
    const csp = (await get("/")).headers.get("content-security-policy");
    expect(csp).toContain("default-src 'none'");
  });
});

describe("creación de runs", () => {
  it("rechaza un workspace fuera de las raíces permitidas", async () => {
    const response = await post("/api/runs", { goal: "haz algo", workspace: outside });
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      error: expect.stringContaining("raices permitidas"),
    });
  });

  it("rechaza un escape por ruta relativa desde una raíz permitida", async () => {
    const response = await post("/api/runs", { goal: "haz algo", workspace: path.join(repo, "..") });
    expect(response.status).toBe(403);
  });

  it("exige objetivo y workspace", async () => {
    expect((await post("/api/runs", { workspace: repo })).status).toBe(400);
    expect((await post("/api/runs", { goal: "x" })).status).toBe(400);
  });

  it("rechaza un cuerpo que no es JSON", async () => {
    const response = await fetch(`${server.url}/api/runs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "esto no es json",
    });
    expect(response.status).toBe(400);
  });

  it("no permite otros métodos en la colección", async () => {
    const response = await fetch(`${server.url}/api/runs`, { method: "DELETE" });
    expect(response.status).toBe(405);
  });
});

describe("autenticación", () => {
  it("con token configurado, rechaza sin cabecera", async () => {
    const guarded = await startServer({
      allowedRoots: [repo],
      dbFile: ":memory:",
      port: 0,
      host: "127.0.0.1",
      token: "secreto-largo-de-prueba",
    });
    try {
      expect((await fetch(`${guarded.url}/`)).status).toBe(401);

      const ok = await fetch(`${guarded.url}/`, {
        headers: { Authorization: "Bearer secreto-largo-de-prueba" },
      });
      expect(ok.status).toBe(200);

      const wrong = await fetch(`${guarded.url}/`, {
        headers: { Authorization: "Bearer secreto-largo-de-pruebA" },
      });
      expect(wrong.status).toBe(401);
    } finally {
      await guarded.close();
    }
  });
});

describe("configuración", () => {
  it("se niega a arrancar sin ninguna raíz permitida", async () => {
    await expect(startServer({ allowedRoots: [], dbFile: ":memory:", port: 0 })).rejects.toThrow(
      /raiz permitida/,
    );
  });
});
