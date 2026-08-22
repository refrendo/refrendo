import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { renderMarkdownReport, renderOneLiner, runCommand, type RunResult } from "@forge/core";
import { finishCi, commitMessage } from "../ci.js";
import { branchNameFor, changedFiles, commitOnNewBranch, currentBranch, isGitRepo } from "../git.js";

let repo: string;
let scratch: string;
let outputFile: string;

const sh = (cwd: string, command: string) => runCommand(command, { cwd, timeoutMs: 30_000 });

beforeEach(async () => {
  repo = await fs.mkdtemp(path.join(os.tmpdir(), "forge-git-"));
  await sh(repo, "git init -b main");
  await sh(repo, "git config user.name Prueba");
  await sh(repo, "git config user.email prueba@ejemplo.dev");
  await fs.writeFile(path.join(repo, "README.md"), "inicial\n");
  await sh(repo, "git add -A");
  await sh(repo, "git commit -m inicial");

  // Fuera del repositorio a proposito: dentro contaria como cambio sin comitear.
  scratch = await fs.mkdtemp(path.join(os.tmpdir(), "forge-ci-out-"));
  outputFile = path.join(scratch, "outputs.txt");
  process.env["GITHUB_OUTPUT"] = outputFile;
  delete process.env["GITHUB_STEP_SUMMARY"];
});

afterEach(async () => {
  delete process.env["GITHUB_OUTPUT"];
  await fs.rm(repo, { recursive: true, force: true });
  await fs.rm(scratch, { recursive: true, force: true });
});

const result = (over: Partial<RunResult> = {}): RunResult => ({
  status: "verified",
  contract: { goal: "Añadir paginación al endpoint", acceptance: ["acepta page y limit"] },
  plan: null,
  summary: "Se añadió paginación.",
  changes: [{ path: "src/a.ts", kind: "modified", linesAdded: 10, linesRemoved: 2 }],
  verification: {
    passed: true,
    ranAt: "2026-08-22T10:00:00.000Z",
    gates: [
      { name: "test", command: "npm test", passed: true, skipped: false, durationMs: 4000, exitCode: 0, output: "" },
    ],
  },
  repairAttempts: 1,
  usage: {
    inputTokens: 1000,
    outputTokens: 500,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    costUsd: 0.41,
    requests: 4,
  },
  durationMs: 60_000,
  ...over,
});

const readOutputs = async (): Promise<Record<string, string>> => {
  const raw = await fs.readFile(outputFile, "utf8");
  return Object.fromEntries(
    raw
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const index = line.indexOf("=");
        return [line.slice(0, index), line.slice(index + 1)];
      }),
  );
};

describe("nombres de rama", () => {
  it("quita acentos y caracteres que Git rechaza", () => {
    const branch = branchNameFor("Añadir paginación: ¿página o límite?");
    expect(branch).toMatch(/^forge\/anadir-paginacion-pagina-o-limite-[a-z0-9]+$/);
  });

  it("respeta el prefijo y acorta objetivos largos", () => {
    const branch = branchNameFor("x".repeat(200), "bot");
    expect(branch.startsWith("bot/")).toBe(true);
    expect(branch.length).toBeLessThan(64);
  });

  it("no deja una rama sin nombre cuando el objetivo no tiene letras", () => {
    expect(branchNameFor("¿?¡!")).toMatch(/^forge\/cambio-/);
  });

  it("no repite el mismo nombre en llamadas distintas", () => {
    // Un objetivo repetido no debe chocar con la rama del intento anterior.
    expect(branchNameFor("mismo objetivo")).not.toBe(branchNameFor("mismo objetivo"));
  });
});

describe("operaciones de Git", () => {
  it("reconoce un repositorio y un directorio suelto", async () => {
    expect(await isGitRepo(repo)).toBe(true);
    const plain = await fs.mkdtemp(path.join(os.tmpdir(), "forge-plain-"));
    try {
      expect(await isGitRepo(plain)).toBe(false);
    } finally {
      await fs.rm(plain, { recursive: true, force: true });
    }
  });

  it("detecta ficheros modificados y nuevos", async () => {
    await fs.writeFile(path.join(repo, "README.md"), "cambiado\n");
    await fs.writeFile(path.join(repo, "nuevo.txt"), "hola\n");
    expect((await changedFiles(repo)).sort()).toEqual(["README.md", "nuevo.txt"]);
  });

  it("crea la rama y comitea todo", async () => {
    await fs.writeFile(path.join(repo, "nuevo.txt"), "hola\n");
    const commit = await commitOnNewBranch(repo, { branch: "forge/prueba", message: "un cambio" });

    expect(commit.branch).toBe("forge/prueba");
    expect(commit.sha).toMatch(/^[0-9a-f]{40}$/);
    expect(await currentBranch(repo)).toBe("forge/prueba");
    expect(await changedFiles(repo)).toEqual([]);
  });

  it("acepta mensajes con comillas, saltos de línea y acentos", async () => {
    await fs.writeFile(path.join(repo, "nuevo.txt"), "hola\n");
    const message = `Añadir "paginación"\n\nCon 'comillas' y $variables\n`;
    await commitOnNewBranch(repo, { branch: "forge/raro", message });

    const log = await sh(repo, "git log -1 --pretty=%B");
    expect(log.stdout).toContain('Añadir "paginación"');
    expect(log.stdout).toContain("$variables");
  });

  it("atribuye el commit a quien lanzó el run", async () => {
    await fs.writeFile(path.join(repo, "nuevo.txt"), "hola\n");
    await commitOnNewBranch(repo, {
      branch: "forge/autoria",
      message: "cambio",
      authorName: "Ana Pérez",
      authorEmail: "ana@equipo.dev",
    });

    // Dos consultas separadas: un '|' en la cadena de formato lo interpretaria
    // el shell del helper como una tuberia.
    const name = await sh(repo, "git log -1 --pretty=%an");
    const email = await sh(repo, "git log -1 --pretty=%ae");
    expect(name.stdout.trim()).toBe("Ana Pérez");
    expect(email.stdout.trim()).toBe("ana@equipo.dev");
  });

  it("se niega a comitear si no hay cambios", async () => {
    await expect(commitOnNewBranch(repo, { branch: "forge/vacio", message: "nada" })).rejects.toThrow(
      /no hay cambios/,
    );
  });
});

describe("cierre de CI — solo se comitea lo verificado", () => {
  it("comitea y sale con 0 cuando el run está verificado", async () => {
    await fs.writeFile(path.join(repo, "src.ts"), "cambio\n");
    const outcome = await finishCi(result(), { cwd: repo, branchPrefix: "forge", commit: true });

    expect(outcome.code).toBe(0);
    expect(outcome.commit?.branch).toMatch(/^forge\//);
    expect(await currentBranch(repo)).toBe(outcome.commit!.branch);
  });

  it.each(["reverted", "exhausted", "failed", "unverified"] as const)(
    "no comitea nada y sale con 1 cuando el run acaba como %s",
    async (status) => {
      await fs.writeFile(path.join(repo, "basura.ts"), "no compila\n");
      const outcome = await finishCi(result({ status }), { cwd: repo, branchPrefix: "forge", commit: true });

      expect(outcome.code).toBe(1);
      expect(outcome.commit).toBeNull();
      expect(await currentBranch(repo)).toBe("main");
      expect(await changedFiles(repo)).toEqual(["basura.ts"]);
    },
  );

  it("verificado sin cambios no crea una rama vacía", async () => {
    const outcome = await finishCi(result({ changes: [] }), { cwd: repo, branchPrefix: "forge", commit: true });
    expect(outcome.code).toBe(0);
    expect(outcome.commit).toBeNull();
    expect(outcome.reason).toContain("nada que comitear");
  });

  it("respeta --no-commit", async () => {
    await fs.writeFile(path.join(repo, "src.ts"), "cambio\n");
    const outcome = await finishCi(result(), { cwd: repo, branchPrefix: "forge", commit: false });
    expect(outcome.code).toBe(0);
    expect(outcome.commit).toBeNull();
    expect(await currentBranch(repo)).toBe("main");
  });

  it("no revienta fuera de un repositorio Git", async () => {
    const plain = await fs.mkdtemp(path.join(os.tmpdir(), "forge-plain-"));
    try {
      const outcome = await finishCi(result(), { cwd: plain, branchPrefix: "forge", commit: true });
      expect(outcome.code).toBe(0);
      expect(outcome.reason).toContain("no es un repositorio Git");
    } finally {
      await fs.rm(plain, { recursive: true, force: true });
    }
  });

  it("publica las variables que consume el resto del workflow", async () => {
    await fs.writeFile(path.join(repo, "src.ts"), "cambio\n");
    await finishCi(result(), { cwd: repo, branchPrefix: "forge", commit: true });

    const outputs = await readOutputs();
    expect(outputs["status"]).toBe("verified");
    expect(outputs["verified"]).toBe("true");
    expect(outputs["cost-usd"]).toBe("0.4100");
    expect(outputs["files-changed"]).toBe("1");
    expect(outputs["repair-attempts"]).toBe("1");
    expect(outputs["branch"]).toMatch(/^forge\//);
    expect(outputs["sha"]).toMatch(/^[0-9a-f]{40}$/);
  });

  it("nunca escribe una variable multilínea, que rompería el fichero de salidas", async () => {
    await fs.writeFile(path.join(repo, "src.ts"), "cambio\n");
    await finishCi(result({ summary: "linea uno\nlinea dos" }), {
      cwd: repo,
      branchPrefix: "forge",
      commit: true,
    });

    const raw = await fs.readFile(outputFile, "utf8");
    for (const line of raw.split("\n").filter(Boolean)) {
      expect(line).toMatch(/^[a-z-]+=/);
    }
  });
});

describe("mensaje de commit", () => {
  it("registra la procedencia: objetivo, puertas y traza", () => {
    const message = commitMessage(result(), "https://forge.local/r/abc");
    expect(message.startsWith("Añadir paginación al endpoint")).toBe(true);
    expect(message).toContain("Verificado con: test (npm test)");
    expect(message).toContain("Ciclos de reparacion: 1");
    expect(message).toContain("https://forge.local/r/abc");
  });

  it("no inventa una traza que no existe", () => {
    expect(commitMessage(result())).not.toContain("Traza:");
  });
});

describe("informe en Markdown", () => {
  it("encabeza con el veredicto y su significado", () => {
    const report = renderMarkdownReport(result());
    expect(report).toContain("✅ Verificado");
    expect(report).toContain("Las puertas de calidad del proyecto pasaron.");
  });

  it("incluye la tabla de evidencia con el comando real", () => {
    expect(renderMarkdownReport(result())).toContain("| test | `npm test` | ✅ pasa |");
  });

  it("pliega la salida de una puerta fallida en un desplegable", () => {
    const failing = result({
      status: "reverted",
      verification: {
        passed: false,
        ranAt: "2026-08-22T10:00:00.000Z",
        gates: [
          {
            name: "test",
            command: "npm test",
            passed: false,
            skipped: false,
            durationMs: 4000,
            exitCode: 1,
            output: "AssertionError: expected 500 to be 400",
          },
        ],
      },
    });

    const report = renderMarkdownReport(failing);
    expect(report).toContain("↩️ Revertido");
    expect(report).toContain("<details>");
    expect(report).toContain("expected 500 to be 400");
  });

  it("menciona los ciclos de reparación en vez de esconderlos", () => {
    expect(renderMarkdownReport(result())).toContain("volvio a verificar 1");
  });

  it("añade el enlace a la traza solo si se le da", () => {
    expect(renderMarkdownReport(result(), { runUrl: "https://x/y" })).toContain("(https://x/y)");
    expect(renderMarkdownReport(result())).not.toContain("Ver la traza completa");
  });

  it("resume en una línea para un comentario breve", () => {
    expect(renderOneLiner(result())).toBe("✅ Verificado · 1 fichero(s) · $0.4100");
  });
});
