import type { EmitFn } from "./events.js";
import { lastLines, runCommand } from "./tools/shell.js";
import type { GateResult, VerificationReport } from "./types.js";
import type { Workspace } from "./workspace.js";

export interface Gate {
  name: string;
  command: string;
  /** Un fallo aqui no invalida el run, solo se reporta (p. ej. formato). */
  advisory?: boolean;
}

export interface VerifyOptions {
  gates?: Gate[];
  timeoutMs?: number;
  signal?: AbortSignal;
  /**
   * Puertas que tienen que existir y pasar. Si falta alguna, el run no puede
   * quedar verificado.
   *
   * Cierra el agujero mas grande de todo el diseno: si las puertas se detectan
   * del proyecto y el agente puede editar el proyecto, borrar el script de
   * tests deja un arbol que "pasa" porque ya no hay nada que ejecutar. Con esto,
   * la ausencia de una puerta obligatoria es un fallo, no un silencio.
   */
  requiredGates?: string[];
}

/** Gestores de paquetes de JS que sabemos reconocer. */
export type PackageManager = "npm" | "pnpm" | "yarn" | "bun";

/**
 * Averigua con que gestor se ejecutan los scripts del proyecto.
 *
 * Importa mas de lo que parece: en un repositorio pnpm o yarn, `npm test`
 * resuelve los binarios donde npm los busca, que no es donde estan. La puerta
 * falla por el gestor y no por el codigo, y eso es peor que no verificar,
 * porque parece un fallo del agente.
 *
 * El campo `packageManager` manda sobre el lockfile: es la declaracion
 * explicita del equipo —la que lee Corepack—, mientras que un lockfile puede
 * quedarse olvidado en el arbol despues de una migracion.
 */
export async function detectPackageManager(workspace: Workspace): Promise<PackageManager> {
  const pkg = await readPackageJson(workspace);
  const declarado = pkg?.packageManager?.split("@")[0];
  if (declarado === "pnpm" || declarado === "yarn" || declarado === "bun" || declarado === "npm") {
    return declarado;
  }
  if (await workspace.exists("pnpm-lock.yaml")) return "pnpm";
  if (await workspace.exists("yarn.lock")) return "yarn";
  if (await workspace.exists("bun.lockb")) return "bun";
  if (await workspace.exists("bun.lock")) return "bun";
  return "npm";
}

/** `<gestor> run <script>` vale en los cuatro, incluidos yarn 1 y yarn berry. */
function scriptCommand(pm: PackageManager, script: string): string {
  return `${pm} run ${script}`;
}

/**
 * Descubre las puertas de calidad del propio proyecto.
 *
 * La clave es que no inventamos criterios: usamos los que el equipo ya tiene
 * definidos en su package.json. Si su `test` pasa, para ellos esta bien; y
 * si no lo tienen, lo decimos en vez de fingir que verificamos algo.
 */
export async function detectGates(workspace: Workspace): Promise<Gate[]> {
  const gates: Gate[] = [];
  const pkg = await readPackageJson(workspace);
  const scripts = pkg?.scripts ?? {};
  const pm = await detectPackageManager(workspace);

  if (scripts["typecheck"]) {
    gates.push({ name: "typecheck", command: scriptCommand(pm, "typecheck") });
  } else if (await workspace.exists("tsconfig.json")) {
    // `npx --yes` a proposito y no el gestor detectado: aqui no hay script que
    // ejecutar, hay que traer un tsc. npx se descarga el suyo, asi que no
    // depende de como este montado el node_modules del proyecto.
    gates.push({ name: "typecheck", command: "npx --yes tsc --noEmit" });
  }

  if (scripts["test"] && !isPlaceholderTestScript(scripts["test"])) {
    gates.push({ name: "test", command: scriptCommand(pm, "test") });
  }

  if (scripts["lint"]) {
    gates.push({ name: "lint", command: scriptCommand(pm, "lint") });
  }

  if (scripts["build"]) {
    gates.push({ name: "build", command: scriptCommand(pm, "build") });
  }

  // Sin puerta de tests no hay verificacion que valga la pena, asi que se busca
  // fuera del mundo JS antes de rendirse. Solo si JS no aporto tests: en un
  // monorepo poliglota mandan los scripts, que son lo que el equipo ya usa.
  if (!gates.some((gate) => gate.name === "test")) {
    gates.push(...(await detectNonJsGates(workspace)));
  }

  return gates;
}

/**
 * Ecosistemas fuera de JS, reconocidos por su fichero de manifiesto.
 *
 * El manifiesto es la senal mas fiable que existe: esta en todos los proyectos
 * del ecosistema y no aparece fuera de el. Los comandos son los canonicos, los
 * que cualquiera de esos equipos ya ejecuta a mano.
 */
async function detectNonJsGates(workspace: Workspace): Promise<Gate[]> {
  if (await hasPythonTests(workspace)) {
    return [{ name: "test", command: "python -m pytest -q" }];
  }

  if (await workspace.exists("go.mod")) {
    return [
      { name: "test", command: "go test ./..." },
      { name: "build", command: "go build ./..." },
      { name: "lint", command: "go vet ./..." },
    ];
  }

  if (await workspace.exists("Cargo.toml")) {
    // Sin clippy: no viene en toda instalacion de Rust, y una puerta que falla
    // por no estar instalada es ruido, no verificacion.
    return [
      { name: "test", command: "cargo test" },
      { name: "build", command: "cargo build" },
    ];
  }

  if (await workspace.exists("pom.xml")) {
    return [{ name: "test", command: "mvn -B test" }];
  }

  if ((await workspace.exists("build.gradle")) || (await workspace.exists("build.gradle.kts"))) {
    return [{ name: "test", command: "./gradlew test" }];
  }

  return [];
}

/** `npm init` deja un script de test que siempre falla; no es una puerta real. */
function isPlaceholderTestScript(script: string): boolean {
  return /no test specified/i.test(script);
}

async function hasPythonTests(workspace: Workspace): Promise<boolean> {
  if (await workspace.exists("pytest.ini")) return true;
  if (await workspace.exists("tests")) return true;

  // Los proyectos modernos configuran pytest en pyproject.toml y reparten los
  // tests junto al codigo, sin directorio `tests/` que delate nada.
  for (const fichero of ["pyproject.toml", "setup.cfg", "tox.ini"]) {
    if (!(await workspace.exists(fichero))) continue;
    try {
      if (/\[tool\.pytest|\[tool:pytest\]/.test(await workspace.readFile(fichero))) return true;
    } catch {
      // Ilegible o demasiado grande: se ignora y se sigue buscando.
    }
  }

  return false;
}

/**
 * Lo que se le dice a quien no tiene ninguna puerta detectable.
 *
 * Va con el fichero ya escrito y listo para pegar. Quien llega aqui usa
 * herramientas que no sabemos reconocer, y responderle solo "no puedo
 * verificar" lo deja sin salida y sin producto. Con esto vale cualquier
 * ecosistema, incluidos los que no hemos previsto — que son la mayoria.
 */
export function noGatesHelp(configFilename = "refrendo.config.json"): string {
  return [
    "No se ha detectado ninguna puerta de verificacion en este proyecto.",
    "",
    `Declara las tuyas en ${configFilename} y se usaran tal cual:`,
    "",
    "{",
    '  "gates": [',
    '    { "name": "test",  "command": "<el comando que ejecuta vuestros tests>" },',
    '    { "name": "build", "command": "<el comando que compila el proyecto>" }',
    "  ]",
    "}",
    "",
    "Sirve cualquier comando: make test, bazel test //..., dotnet test, tox, rake.",
    "La regla es la de siempre: si sale con codigo 0, la puerta pasa.",
  ].join("\n");
}

async function readPackageJson(
  workspace: Workspace,
): Promise<{ scripts?: Record<string, string>; packageManager?: string } | null> {
  try {
    return JSON.parse(await workspace.readFile("package.json"));
  } catch {
    return null;
  }
}

/**
 * Ejecuta las puertas en serie y devuelve un informe.
 *
 * En serie y no en paralelo: `tsc` y `vitest` compitiendo por CPU y por el
 * mismo directorio de cache producen fallos fantasma que cuestan mas caros que
 * los segundos que ahorra el paralelismo.
 */
export async function verify(
  workspace: Workspace,
  emit: EmitFn,
  options: VerifyOptions = {},
): Promise<VerificationReport> {
  const gates = options.gates ?? (await detectGates(workspace));
  const timeoutMs = options.timeoutMs ?? 300_000;

  emit({ type: "verification_started", gates: gates.map((gate) => gate.name) });

  const results: GateResult[] = [];
  for (const gate of gates) {
    const execution = await runCommand(gate.command, {
      cwd: workspace.root,
      timeoutMs,
      ...(options.signal ? { signal: options.signal } : {}),
    });

    const output = [execution.stdout, execution.stderr].filter((part) => part.trim()).join("\n");
    const result: GateResult = {
      name: gate.name,
      command: gate.command,
      passed: execution.exitCode === 0 && !execution.timedOut,
      skipped: false,
      durationMs: execution.durationMs,
      exitCode: execution.exitCode,
      output: lastLines(output, 80),
    };
    results.push(result);
    emit({ type: "gate_completed", gate: result });
  }

  // Una puerta obligatoria que no aparece se registra como fallo explicito, no
  // como ausencia: quien lea el informe tiene que ver por que no esta.
  for (const required of options.requiredGates ?? []) {
    if (results.some((result) => result.name === required)) continue;
    const missing: GateResult = {
      name: required,
      command: "(no encontrada)",
      passed: false,
      skipped: false,
      durationMs: 0,
      exitCode: null,
      output: `La puerta obligatoria "${required}" no existe en este proyecto. Puede que se haya eliminado el script que la define. Sin ella el run no puede darse por verificado.`,
    };
    results.push(missing);
    emit({ type: "gate_completed", gate: missing });
  }

  const blocking = results.filter((result) => {
    const gate = gates.find((candidate) => candidate.name === result.name);
    return !gate?.advisory;
  });
  const passed = blocking.every((result) => result.passed);

  emit({ type: "verification_completed", passed });

  return { passed, gates: results, ranAt: new Date().toISOString() };
}

/** Rehace el contexto de fallo que se reinyecta al agente para que repare. */
export function formatFailures(report: VerificationReport): string {
  const failing = report.gates.filter((gate) => !gate.passed);
  if (failing.length === 0) return "";

  return failing
    .map(
      (gate) =>
        `### Puerta "${gate.name}" FALLIDA\nComando: ${gate.command}\nCodigo de salida: ${gate.exitCode}\n\n${gate.output || "[sin salida]"}`,
    )
    .join("\n\n");
}
