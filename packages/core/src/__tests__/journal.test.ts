import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ChangeJournal } from "../journal.js";
import { Workspace } from "../workspace.js";

let root: string;
let workspace: Workspace;
let journal: ChangeJournal;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "forge-journal-"));
  workspace = new Workspace(root);
  journal = new ChangeJournal(workspace);
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

describe("rollback", () => {
  it("restaura el contenido previo de un fichero modificado", async () => {
    await workspace.writeFile("a.txt", "original");
    await journal.capture("a.txt");
    await workspace.writeFile("a.txt", "roto");

    await journal.rollback();

    expect(await workspace.readFile("a.txt")).toBe("original");
  });

  it("elimina los ficheros que no existian antes", async () => {
    await journal.capture("nuevo.txt");
    await workspace.writeFile("nuevo.txt", "contenido");

    await journal.rollback();

    expect(await workspace.exists("nuevo.txt")).toBe(false);
  });

  it("conserva el primer estado capturado aunque se capture de nuevo", async () => {
    await workspace.writeFile("a.txt", "v1");
    await journal.capture("a.txt");
    await workspace.writeFile("a.txt", "v2");
    await journal.capture("a.txt"); // no debe pisar la linea base
    await workspace.writeFile("a.txt", "v3");

    await journal.rollback();

    expect(await workspace.readFile("a.txt")).toBe("v1");
  });

  it("revierte varios ficheros a la vez", async () => {
    await workspace.writeFile("a.txt", "a");
    await workspace.writeFile("b.txt", "b");
    await journal.capture("a.txt");
    await journal.capture("b.txt");
    await workspace.writeFile("a.txt", "A");
    await workspace.writeFile("b.txt", "B");

    const restored = await journal.rollback();

    expect(restored.sort()).toEqual(["a.txt", "b.txt"]);
    expect(await workspace.readFile("a.txt")).toBe("a");
    expect(await workspace.readFile("b.txt")).toBe("b");
  });
});

describe("summarize", () => {
  it("clasifica creaciones y modificaciones con recuento de lineas", async () => {
    await workspace.writeFile("mod.txt", "uno\ndos\ntres");
    await journal.capture("mod.txt");
    await journal.capture("nuevo.txt");
    await workspace.writeFile("mod.txt", "uno\ndos-cambiado\ntres\ncuatro");
    await workspace.writeFile("nuevo.txt", "a\nb");

    const changes = await journal.summarize();

    expect(changes).toEqual([
      { path: "mod.txt", kind: "modified", linesAdded: 2, linesRemoved: 1 },
      { path: "nuevo.txt", kind: "created", linesAdded: 2, linesRemoved: 0 },
    ]);
  });

  it("ignora los ficheros capturados que no cambiaron", async () => {
    await workspace.writeFile("igual.txt", "sin cambios");
    await journal.capture("igual.txt");

    expect(await journal.summarize()).toEqual([]);
  });

  it("commit limpia la linea base", async () => {
    await workspace.writeFile("a.txt", "x");
    await journal.capture("a.txt");
    expect(journal.isEmpty).toBe(false);

    journal.commit();

    expect(journal.isEmpty).toBe(true);
    expect(await journal.summarize()).toEqual([]);
  });
});
