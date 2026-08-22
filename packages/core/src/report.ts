import type { RunResult } from "./types.js";

export interface ReportOptions {
  /** Enlace a la pagina del run, si hay servidor. */
  runUrl?: string;
  /** Incluye el plan. En el cuerpo de un PR suele sobrar; en el resumen del job, no. */
  includePlan?: boolean;
}

const VERDICT: Record<RunResult["status"], { icon: string; label: string; meaning: string }> = {
  verified: {
    icon: "✅",
    label: "Verificado",
    meaning: "Las puertas de calidad del proyecto pasaron.",
  },
  unverified: {
    icon: "⚠️",
    label: "Sin verificar",
    meaning: "El agente termino, pero el proyecto no declara puertas que lo demuestren.",
  },
  reverted: {
    icon: "↩️",
    label: "Revertido",
    meaning: "No se consiguio dejar el arbol en verde. Los cambios se revirtieron enteros.",
  },
  exhausted: {
    icon: "⏳",
    label: "Agotado",
    meaning: "Se agoto el presupuesto o las iteraciones antes de terminar.",
  },
  failed: { icon: "💥", label: "Fallido", meaning: "El run murio por un error no recuperable." },
};

/**
 * Informe en Markdown de un run.
 *
 * Es el formato en el que Refrendo entra en el sitio donde ya trabaja el equipo:
 * el cuerpo de un pull request, el resumen de un job de CI, un mensaje de chat.
 * Se escribe para alguien que no vio el run y tiene que decidir si se fia.
 */
export function renderMarkdownReport(result: RunResult, options: ReportOptions = {}): string {
  const verdict = VERDICT[result.status];
  const out: string[] = [];

  out.push(`## ${verdict.icon} ${verdict.label} — ${result.contract.goal}`, "", verdict.meaning, "");

  if (options.runUrl) out.push(`[Ver la traza completa](${options.runUrl})`, "");

  if (result.summary) out.push("### Que se hizo", "", result.summary, "");

  if (result.contract.acceptance?.length) {
    out.push("### Criterios de aceptacion", "");
    for (const item of result.contract.acceptance) out.push(`- ${item}`);
    out.push("");
  }

  // La evidencia es la seccion que justifica el veredicto: va antes que el
  // detalle de los cambios porque es lo que decide si merece la pena mirarlos.
  if (result.verification) {
    out.push("### Evidencia", "", "| Puerta | Comando | Resultado | Tiempo |", "|---|---|---|---|");
    for (const gate of result.verification.gates) {
      out.push(
        `| ${gate.name} | \`${gate.command}\` | ${gate.passed ? "✅ pasa" : `❌ exit ${gate.exitCode ?? "—"}`} | ${(gate.durationMs / 1000).toFixed(1)} s |`,
      );
    }
    out.push("");

    const failing = result.verification.gates.filter((gate) => !gate.passed && gate.output);
    for (const gate of failing) {
      out.push(`<details><summary>Salida de <code>${gate.name}</code></summary>`, "", "```");
      out.push(gate.output);
      out.push("```", "", "</details>", "");
    }
  }

  if (result.repairAttempts > 0) {
    out.push(
      `> El primer intento no paso la verificacion. El agente corrigio y volvio a verificar ${result.repairAttempts} vez/veces.`,
      "",
    );
  }

  if (result.changes.length > 0) {
    const added = result.changes.reduce((sum, change) => sum + change.linesAdded, 0);
    const removed = result.changes.reduce((sum, change) => sum + change.linesRemoved, 0);
    out.push(`### Cambios — ${result.changes.length} fichero(s), +${added}/−${removed}`, "");
    for (const change of result.changes) {
      const kind = change.kind === "created" ? "nuevo" : change.kind === "deleted" ? "borrado" : "editado";
      out.push(`- \`${change.path}\` _(${kind})_ +${change.linesAdded}/−${change.linesRemoved}`);
    }
    out.push("");
  }

  if (options.includePlan && result.plan) {
    out.push("### Plan", "", result.plan.summary, "");
    for (const step of result.plan.steps) {
      out.push(`${step.id}. ${step.description}${step.files.length > 0 ? ` — \`${step.files.join("`, `")}\`` : ""}`);
    }
    out.push("");
  }

  out.push(
    "---",
    "",
    `<sub>Refrendo · $${result.usage.costUsd.toFixed(4)} · ${result.usage.requests} peticiones · ${(result.durationMs / 1000).toFixed(0)} s</sub>`,
  );

  return out.join("\n");
}

/** Linea de una sola frase, para un comentario breve o una notificacion. */
export function renderOneLiner(result: RunResult): string {
  const verdict = VERDICT[result.status];
  const files = result.changes.length;
  return `${verdict.icon} ${verdict.label} · ${files} fichero(s) · $${result.usage.costUsd.toFixed(4)}`;
}
