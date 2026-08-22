import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SandboxViolation } from "../errors.js";
import { Workspace, globToRegExp } from "../workspace.js";

let root: string;
let workspace: Workspace;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "refrendo-ws-"));
  workspace = new Workspace(root);
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

describe("confinamiento de rutas", () => {
  it("resuelve rutas dentro de la raiz", () => {
    expect(workspace.resolve("src/index.ts")).toBe(path.join(root, "src", "index.ts"));
  });

  it("bloquea el escape por rutas relativas", () => {
    expect(() => workspace.resolve("../secreto.txt")).toThrow(SandboxViolation);
    expect(() => workspace.resolve("src/../../fuera")).toThrow(SandboxViolation);
  });

  it("bloquea rutas absolutas fuera de la raiz", () => {
    const outside = process.platform === "win32" ? "C:\\Windows\\System32" : "/etc/passwd";
    expect(() => workspace.resolve(outside)).toThrow(SandboxViolation);
  });

  it("acepta la propia raiz", () => {
    expect(workspace.resolve(".")).toBe(root);
  });

  it("bloquea el escape a traves de un enlace simbolico", async () => {
    const outside = await fs.mkdtemp(path.join(os.tmpdir(), "refrendo-fuera-"));
    try {
      // En Windows los enlaces de directorio requieren privilegios; el tipo
      // "junction" no, y sirve igual para el caso que nos importa.
      await fs.symlink(outside, path.join(root, "puerta"), "junction");
    } catch {
      // Sin permisos para crear enlaces no hay nada que comprobar aqui.
      await fs.rm(outside, { recursive: true, force: true });
      return;
    }

    try {
      // La aritmetica de rutas da el visto bueno: "puerta/robado.txt" parece
      // estar dentro. Es al resolver el enlace cuando se ve que no lo esta.
      expect(() => workspace.resolve("puerta/robado.txt")).not.toThrow();
      await expect(workspace.writeFile("puerta/robado.txt", "datos")).rejects.toThrow(SandboxViolation);
      expect(await fs.readdir(outside)).toEqual([]);
    } finally {
      await fs.rm(outside, { recursive: true, force: true });
    }
  });
});

describe("operaciones de fichero", () => {
  it("escribe creando directorios intermedios y vuelve a leer", async () => {
    await workspace.writeFile("a/b/c.txt", "hola");
    expect(await workspace.readFile("a/b/c.txt")).toBe("hola");
    expect(await workspace.exists("a/b/c.txt")).toBe(true);
  });

  it("rechaza ficheros por encima del limite de tamano", async () => {
    const small = new Workspace(root, { maxFileBytes: 8 });
    await small.writeFile("grande.txt", "0123456789");
    await expect(small.readFile("grande.txt")).rejects.toThrow(/limite/);
  });

  it("omite directorios ruidosos al listar", async () => {
    await workspace.writeFile("src/app.ts", "");
    await workspace.writeFile("node_modules/paquete/index.js", "");
    const entries = await workspace.list();
    expect(entries).toContain("src/app.ts");
    expect(entries.some((entry) => entry.includes("node_modules"))).toBe(false);
  });

  it("no lista ficheros de entorno", async () => {
    await workspace.writeFile(".env", "SECRETO=1");
    await workspace.writeFile("visible.txt", "");
    const entries = await workspace.list();
    expect(entries).toEqual(["visible.txt"]);
  });
});

describe("busqueda", () => {
  it("devuelve fichero, linea y texto", async () => {
    await workspace.writeFile("src/a.ts", "const x = 1;\nexport function objetivo() {}\n");
    const hits = await workspace.grep("function objetivo");
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ file: "src/a.ts", line: 2 });
  });

  it("respeta el filtro glob", async () => {
    await workspace.writeFile("src/a.ts", "necesario");
    await workspace.writeFile("docs/b.md", "necesario");
    const hits = await workspace.grep("necesario", { glob: "src/**/*.ts" });
    expect(hits.map((hit) => hit.file)).toEqual(["src/a.ts"]);
  });
});

describe("globToRegExp", () => {
  it("traduce comodines de un solo segmento y multisegmento", () => {
    expect(globToRegExp("src/**/*.ts").test("src/a/b/c.ts")).toBe(true);
    expect(globToRegExp("src/**/*.ts").test("src/c.ts")).toBe(true);
    expect(globToRegExp("src/*.ts").test("src/a/b.ts")).toBe(false);
    expect(globToRegExp("*.md").test("README.md")).toBe(true);
    expect(globToRegExp("*.md").test("docs/README.md")).toBe(false);
  });
});
