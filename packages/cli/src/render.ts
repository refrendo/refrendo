import type { ForgeEvent, Phase, RunResult, UsageTotals } from "@forge/core";

const useColor = process.stdout.isTTY === true && !process.env["NO_COLOR"];

/** ESC (0x1B). Se construye asi para no dejar un byte de control crudo en el fuente. */
const ESC = String.fromCharCode(27);

const paint = (code: string) => (text: string) =>
  useColor ? `${ESC}[${code}m${text}${ESC}[0m` : text;

export const c = {
  dim: paint("2"),
  bold: paint("1"),
  red: paint("31"),
  green: paint("32"),
  yellow: paint("33"),
  blue: paint("34"),
  magenta: paint("35"),
  cyan: paint("36"),
};

const PHASE_LABEL: Record<Phase, string> = {
  plan: "PLANIFICAR",
  execute: "EJECUTAR",
  verify: "VERIFICAR",
  repair: "REPARAR",
  finalize: "CERRAR",
};

export interface RendererOptions {
  /** Muestra el razonamiento resumido del modelo. */
  verbose?: boolean;
  /** Silencia todo excepto errores y el informe final. */
  quiet?: boolean;
}

/**
 * Pinta el stream de eventos en la terminal.
 *
 * El renderizador solo consume `ForgeEvent`, nunca llama al motor. Esa frontera
 * es lo que permite que la futura UI web y la sesion compartida de equipo se
 * construyan sobre el mismo stream sin tocar el nucleo.
 */
export function createRenderer(options: RendererOptions = {}) {
  let streamingText = false;

  const endStream = () => {
    if (streamingText) {
      process.stdout.write("\n");
      streamingText = false;
    }
  };

  const line = (text: string) => {
    endStream();
    process.stdout.write(`${text}\n`);
  };

  return (event: ForgeEvent): void => {
    switch (event.type) {
      case "run_started":
        if (options.quiet) break;
        line(`${c.bold("forge")} ${c.dim(event.workspace)}`);
        line(`${c.cyan("objetivo")} ${event.contract.goal}`);
        break;

      case "phase_started":
        if (options.quiet) break;
        line("");
        line(c.bold(c.blue(`── ${PHASE_LABEL[event.phase]} ${"─".repeat(Math.max(0, 50 - PHASE_LABEL[event.phase].length))}`)));
        break;

      case "iteration_started":
        if (options.quiet || !options.verbose) break;
        line(c.dim(`  iteracion ${event.iteration}/${event.max}`));
        break;

      case "thinking_delta":
        if (!options.verbose || options.quiet) break;
        line(c.dim(indent(event.text, "  · ")));
        break;

      case "text_delta":
        if (options.quiet) break;
        process.stdout.write(c.dim(event.text));
        streamingText = true;
        break;

      case "tool_requested":
        if (options.quiet) break;
        line(`  ${c.magenta("→")} ${event.name} ${c.dim(summarizeInput(event.input))}`);
        break;

      case "tool_completed": {
        if (options.quiet) break;
        const mark = event.ok ? c.green("✓") : c.red("✗");
        line(`  ${mark} ${c.dim(`${event.summary} (${event.durationMs} ms)`)}`);
        break;
      }

      case "approval_requested":
        endStream();
        break;

      case "file_changed":
        if (options.quiet) break;
        line(`  ${c.yellow("±")} ${event.change.path} ${c.dim(`+${event.change.linesAdded}/-${event.change.linesRemoved}`)}`);
        break;

      case "plan_ready":
        if (options.quiet) break;
        line("");
        line(c.bold(event.plan.summary));
        for (const step of event.plan.steps) {
          line(`  ${c.cyan(String(step.id))}. ${step.description}`);
          if (step.files.length > 0) line(`     ${c.dim(step.files.join(", "))}`);
        }
        if (event.plan.risks.length > 0) {
          line(`  ${c.yellow("riesgos")}`);
          for (const risk of event.plan.risks) line(`     ${c.dim(`- ${risk}`)}`);
        }
        break;

      case "verification_started":
        if (options.quiet) break;
        line(`  puertas: ${event.gates.join(", ") || "(ninguna)"}`);
        break;

      case "gate_completed": {
        const mark = event.gate.passed ? c.green("✓") : c.red("✗");
        line(`  ${mark} ${c.bold(event.gate.name)} ${c.dim(`${event.gate.command} · ${(event.gate.durationMs / 1000).toFixed(1)} s`)}`);
        if (!event.gate.passed) line(c.red(indent(event.gate.output, "    │ ")));
        break;
      }

      case "repair_started":
        line(c.yellow(`  reparando (intento ${event.attempt}/${event.max}): ${event.failing.join(", ")}`));
        break;

      case "rollback_started":
        line(c.yellow(`  revirtiendo cambios — ${event.reason}`));
        break;

      case "warning":
        line(c.yellow(`  aviso: ${event.message}`));
        break;

      case "usage_updated":
        if (!options.verbose || options.quiet) break;
        line(c.dim(`  ${formatUsage(event.usage)}`));
        break;

      case "run_finished":
        endStream();
        break;
    }
  };
}

/** Informe final. Es lo que un revisor lee sin haber visto el run. */
export function renderResult(result: RunResult): string {
  const badge: Record<RunResult["status"], string> = {
    verified: c.green(c.bold(" VERIFICADO ")),
    unverified: c.yellow(c.bold(" SIN VERIFICAR ")),
    reverted: c.red(c.bold(" REVERTIDO ")),
    exhausted: c.yellow(c.bold(" AGOTADO ")),
    failed: c.red(c.bold(" FALLIDO ")),
  };

  const lines: string[] = ["", badge[result.status], ""];

  if (result.summary) lines.push(result.summary, "");

  if (result.changes.length > 0) {
    lines.push(c.bold("Cambios"));
    for (const change of result.changes) {
      const kind = change.kind === "created" ? "nuevo" : change.kind === "deleted" ? "borrado" : "editado";
      lines.push(`  ${change.path} ${c.dim(`(${kind}) +${change.linesAdded}/-${change.linesRemoved}`)}`);
    }
    lines.push("");
  } else if (result.status !== "failed") {
    lines.push(c.dim("Sin cambios en el arbol de ficheros."), "");
  }

  if (result.verification) {
    lines.push(c.bold("Verificacion"));
    for (const gate of result.verification.gates) {
      lines.push(`  ${gate.passed ? c.green("✓") : c.red("✗")} ${gate.name} ${c.dim(gate.command)}`);
    }
    if (result.repairAttempts > 0) {
      lines.push(c.dim(`  ${result.repairAttempts} ciclo(s) de reparacion`));
    }
    lines.push("");
  }

  if (result.error) lines.push(c.red(`Error [${result.error.code}] ${result.error.message}`), "");

  lines.push(c.dim(`${formatUsage(result.usage)} · ${(result.durationMs / 1000).toFixed(1)} s`));
  return lines.join("\n");
}

export function formatUsage(usage: UsageTotals): string {
  const cached = usage.cacheReadTokens > 0 ? `, ${compact(usage.cacheReadTokens)} de cache` : "";
  return `$${usage.costUsd.toFixed(4)} · ${usage.requests} peticiones · ${compact(usage.inputTokens)} in${cached} / ${compact(usage.outputTokens)} out`;
}

function compact(value: number): string {
  if (value < 1000) return String(value);
  if (value < 1_000_000) return `${(value / 1000).toFixed(1)}k`;
  return `${(value / 1_000_000).toFixed(2)}M`;
}

function summarizeInput(input: unknown): string {
  if (!input || typeof input !== "object") return "";
  const record = input as Record<string, unknown>;
  for (const key of ["path", "command", "pattern", "summary"]) {
    const value = record[key];
    if (typeof value === "string") return truncate(value, 80);
  }
  return "";
}

function truncate(text: string, limit: number): string {
  const single = text.replace(/\s+/g, " ").trim();
  return single.length > limit ? `${single.slice(0, limit)}...` : single;
}

function indent(text: string, prefix: string): string {
  return text
    .trimEnd()
    .split("\n")
    .map((line) => `${prefix}${line}`)
    .join("\n");
}
