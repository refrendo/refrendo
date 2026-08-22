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

/**
 * Descubre las puertas de calidad del propio proyecto.
 *
 * La clave es que no inventamos criterios: usamos los que el equipo ya tiene
 * definidos en su package.json. Si su `npm test` pasa, para ellos esta bien; y
 * si no lo tienen, lo decimos en vez de fingir que verificamos algo.
 */
export async function detectGates(workspace: Workspace): Promise<Gate[]> {
  const gates: Gate[] = [];
  const pkg = await readPackageJson(workspace);
  const scripts = pkg?.scripts ?? {};

  if (scripts["typecheck"]) {
    gates.push({ name: "typecheck", command: "npm run typecheck" });
  } else if (await workspace.exists("tsconfig.json")) {
    gates.push({ name: "typecheck", command: "npx --yes tsc --noEmit" });
  }

  if (scripts["test"] && !isPlaceholderTestScript(scripts["test"])) {
    gates.push({ name: "test", command: "npm test" });
  } else if (await hasPythonTests(workspace)) {
    gates.push({ name: "test", command: "python -m pytest -q" });
  }

  if (scripts["lint"]) {
    gates.push({ name: "lint", command: "npm run lint" });
  }

  if (scripts["build"]) {
    gates.push({ name: "build", command: "npm run build" });
  }

  return gates;
}

/** `npm init` deja un script de test que siempre falla; no es una puerta real. */
function isPlaceholderTestScript(script: string): boolean {
  return /no test specified/i.test(script);
}

async function hasPythonTests(workspace: Workspace): Promise<boolean> {
  if (await workspace.exists("pytest.ini")) return true;
  if (await workspace.exists("tests")) return true;
  return false;
}

async function readPackageJson(
  workspace: Workspace,
): Promise<{ scripts?: Record<string, string> } | null> {
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
