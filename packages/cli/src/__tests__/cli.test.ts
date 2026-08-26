import { execFileSync, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";

/**
 * Estos tests ejercitan el binario tal y como lo recibe un cliente: un proceso
 * de verdad, con sus codigos de salida y su salida estandar.
 *
 * Se hace asi porque los fallos que cubren viven exactamente en esa frontera y
 * ninguna prueba de unidad los habria visto: `--version` reventaba con el error
 * crudo de `parseArgs`, `--help` salia con 1 y el error de credenciales se
 * imprimia dos veces. Todos aparecieron auditando el CLI instalado desde npm.
 */
const aqui = path.dirname(fileURLToPath(import.meta.url));
const raizCli = path.resolve(aqui, "..", "..");
const binario = path.join(raizCli, "dist", "index.js");

interface Salida {
  codigo: number;
  stdout: string;
  stderr: string;
}

function refrendo(args: string[], cwd = raizCli): Salida {
  const r = spawnSync(process.execPath, [binario, ...args], {
    cwd,
    encoding: "utf8",
    // Sin clave heredada: varios casos comprueban justo el camino sin credenciales.
    env: { ...process.env, ANTHROPIC_API_KEY: "", FORCE_COLOR: "0" },
  });
  return { codigo: r.status ?? -1, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

beforeAll(() => {
  // En CI el build ya ha pasado por delante. En local puede que no, y saltarse
  // el test en silencio seria peor que tardar un minuto en compilarlo.
  if (!existsSync(binario)) {
    execFileSync("npm", ["run", "build"], {
      cwd: path.resolve(raizCli, "..", ".."),
      stdio: "inherit",
      shell: process.platform === "win32",
    });
  }
  expect(existsSync(binario)).toBe(true);
}, 300_000);

describe("contrato de linea de comandos", () => {
  // Lo primero que teclea cualquiera despues de instalar algo.
  it("--version imprime la version publicada y sale con 0", () => {
    const { codigo, stdout } = refrendo(["--version"]);
    expect(codigo).toBe(0);
    expect(stdout.trim()).toMatch(/^\d+\.\d+\.\d+/);
  });

  it("la version que imprime es la del package.json que se publica", async () => {
    const pkg = JSON.parse(
      await import("node:fs/promises").then((fs) =>
        fs.readFile(path.join(raizCli, "package.json"), "utf8"),
      ),
    ) as { version: string };
    expect(refrendo(["--version"]).stdout.trim()).toBe(pkg.version);
  });

  // Pedir ayuda no es un error: un `refrendo --help && echo ok` tiene que
  // llegar al `echo`.
  it("--help y -h salen con 0", () => {
    for (const bandera of ["--help", "-h"]) {
      const { codigo, stdout } = refrendo([bandera]);
      expect(codigo, bandera).toBe(0);
      expect(stdout).toContain("refrendo run");
    }
  });

  // Invocar sin nada si es un error: nadie quiso eso.
  it("sin argumentos muestra la ayuda pero sale con 1", () => {
    const { codigo, stdout } = refrendo([]);
    expect(codigo).toBe(1);
    expect(stdout).toContain("refrendo run");
  });

  it("un comando desconocido sale con 1 y lo dice", () => {
    const { codigo, stdout, stderr } = refrendo(["inventado"]);
    expect(codigo).toBe(1);
    expect(`${stdout}${stderr}`).toContain("inventado");
  });

  it("la ayuda explica que hace falta una clave de la API", () => {
    const { stdout } = refrendo(["--help"]);
    expect(stdout).toContain("ANTHROPIC_API_KEY");
    expect(stdout).toContain("console.anthropic.com");
  });

  // Ninguna de las dos vias que se ofrecen puede ser inventada: la que habia
  // antes, `ant auth login`, no existe — el paquete `ant` de npm es un adaptador
  // de Apache Ant de 2012 y no instala ningun binario.
  it("no propone comandos que no existen para autenticarse", () => {
    const texto = refrendo(["--help"]).stdout;
    expect(texto).not.toMatch(/\bant\s+auth\b/);
  });
});

describe("errores previstos", () => {
  it("sin clave explica como conseguirla y no repite el mensaje", () => {
    const { codigo, stdout, stderr } = refrendo(["run", "algo", "--max-cost", "0.01"]);
    const todo = `${stdout}${stderr}`;

    expect(codigo).toBe(1);
    expect(todo).toContain("ANTHROPIC_API_KEY");

    // El renderer ya lo pinta con formato; el catch de arriba lo repetia en
    // crudo y un fallo previsto parecia ademas una averia.
    const veces = todo.split("No hay credenciales de la API de Anthropic").length - 1;
    expect(veces).toBe(1);
    expect(todo).not.toContain("Error fatal:");
  });
});
