import { execFileSync, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

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

/**
 * `--report` se aceptaba en cualquier comando y solo se honraba en `ci`. En
 * `run`, `plan` y `verify` se parseaba y se descartaba en silencio: exit 0, sin
 * fichero y sin aviso. Se descubrio al pedir un informe de un run real.
 *
 * `verify` no puede producirlo: el informe describe un RunResult y `verify` solo
 * devuelve un VerificationReport. Fabricar los campos que faltan seria inventar
 * un run que no existio, asi que se rechaza en voz alta.
 */
describe("--report", () => {
  let proyecto: string;

  beforeEach(async () => {
    const fs = await import("node:fs/promises");
    proyecto = await fs.mkdtemp(path.join(os.tmpdir(), "refrendo-report-"));
    await fs.writeFile(
      path.join(proyecto, "package.json"),
      JSON.stringify({ name: "p", private: true, scripts: { test: 'node -e "process.exit(0)"' } }),
    );
  });

  afterEach(async () => {
    const fs = await import("node:fs/promises");
    await fs.rm(proyecto, { recursive: true, force: true });
  });

  it("verify --report falla explicitamente y no crea el fichero", async () => {
    const fs = await import("node:fs/promises");
    const destino = path.join(proyecto, "informe.md");

    const { codigo, stdout, stderr } = refrendo(["verify", "--report", destino], proyecto);
    const todo = `${stdout}${stderr}`;

    expect(codigo).not.toBe(0);
    expect(todo).toContain("--report no esta soportado por");
    expect(todo).toContain("refrendo run --report");
    await expect(fs.access(destino)).rejects.toThrow();
  });

  it("verify --report no llega a ejecutar las puertas", () => {
    // Falla antes de nada: ni ejecuta tests ni toca la API.
    const { stdout } = refrendo(["verify", "--report", path.join(proyecto, "x.md")], proyecto);
    expect(stdout).not.toContain("puertas:");
  });

  it("verify sin --report sigue funcionando igual", () => {
    const { codigo, stdout } = refrendo(["verify"], proyecto);
    expect(codigo).toBe(0);
    expect(stdout).toContain("puertas:");
  });

  it("la ayuda dice que comandos soportan --report", () => {
    const { stdout } = refrendo(["--help"]);
    expect(stdout).toMatch(/--report .*\(run, ci y plan\)/);
  });

  // `run` y `plan` no pueden llegar a escribir el informe sin una llamada real
  // al modelo, asi que eso queda sin cubrir. Lo que si se puede demostrar sin
  // gasto es que la bandera NO los rechaza: mueren por falta de credencial, que
  // es un paso posterior. Si alguien extendiera el rechazo de `verify` a estos
  // comandos por error, este test lo caza.
  // `writeReport` no captura sus errores a proposito: si no se puede escribir el
  // informe que alguien pidio, tiene que enterarse. Esa garantia depende de que
  // una excepcion dentro de main() acabe en exit != 0, no en un exit 0 callado.
  //
  // Provocar el fallo desde el propio writeReport exigiria un run real, asi que
  // aqui se prueba el MECANISMO con una ruta que ya lanza: no cubre la escritura
  // del informe en concreto, cubre que ninguna excepcion se pierda.
  it("una excepcion dentro de main no termina en exit 0", () => {
    const { codigo, stderr } = refrendo(["serve", "--port", "abc"]);
    expect(codigo).not.toBe(0);
    expect(stderr).toContain("Error fatal:");
  });

  it.each(["run", "plan"])("%s acepta --report y no lo rechaza como verify", (comando) => {
    const { stdout, stderr } = refrendo(
      [comando, "un objetivo", "--report", path.join(proyecto, "informe.md")],
      proyecto,
    );
    const todo = `${stdout}${stderr}`;
    expect(todo).not.toContain("--report no esta soportado");
    expect(todo).toContain("ANTHROPIC_API_KEY");
  });
});
