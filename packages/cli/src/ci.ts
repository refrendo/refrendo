import { promises as fs } from "node:fs";
import { renderMarkdownReport, type RunResult } from "@refrendo/core";
import { branchNameFor, commitOnNewBranch, isGitRepo, type CommitResult } from "./git.js";

export interface CiOptions {
  cwd: string;
  branchPrefix: string;
  /** Crea rama y commit cuando el run queda verificado. */
  commit: boolean;
  actorName?: string | undefined;
  actorEmail?: string | undefined;
  /** Enlace a la pagina del run, si hay servidor. */
  runUrl?: string | undefined;
}

export interface CiOutcome {
  /** Solo un run verificado produce codigo de salida 0. Es el contrato con CI. */
  code: number;
  commit: CommitResult | null;
  report: string;
  reason: string;
}

/**
 * Cierre del modo CI.
 *
 * Toda la logica cabe en una frase: **solo se comitea lo verificado**. Un run
 * revertido, agotado o sin puertas no genera rama, no genera PR y sale con
 * codigo distinto de cero. Es lo que convierte a Refrendo en algo que se puede
 * dejar corriendo sin vigilancia — el pipeline no propaga nada que no tenga
 * evidencia detras.
 */
export async function finishCi(result: RunResult, options: CiOptions): Promise<CiOutcome> {
  const report = renderMarkdownReport(result, {
    ...(options.runUrl ? { runUrl: options.runUrl } : {}),
    includePlan: true,
  });

  let commit: CommitResult | null = null;
  let reason: string;

  if (result.status !== "verified") {
    reason = `El run termino como "${result.status}"; no se comitea nada.`;
  } else if (result.changes.length === 0) {
    reason = "Verificado, pero sin cambios en el arbol: no hay nada que comitear.";
  } else if (!options.commit) {
    reason = "Verificado. No se comitea porque el commit esta desactivado.";
  } else if (!(await isGitRepo(options.cwd))) {
    reason = "Verificado, pero el directorio no es un repositorio Git.";
  } else {
    commit = await commitOnNewBranch(options.cwd, {
      branch: branchNameFor(result.contract.goal, options.branchPrefix),
      message: commitMessage(result, options.runUrl),
      ...(options.actorName ? { authorName: options.actorName } : {}),
      ...(options.actorEmail ? { authorEmail: options.actorEmail } : {}),
    });
    reason = `Verificado y comiteado en ${commit.branch}.`;
  }

  await writeGithubOutputs(result, commit);
  await appendStepSummary(report);

  return { code: result.status === "verified" ? 0 : 1, commit, report, reason };
}

/**
 * Mensaje de commit con procedencia.
 *
 * El pie no es decoracion: es la respuesta a "que agente cambio esto, bajo que
 * objetivo y que demostro que era seguro", que es exactamente lo que pide un
 * auditor y lo que hoy nadie puede contestar.
 */
export function commitMessage(result: RunResult, runUrl?: string): string {
  const lines = [result.contract.goal, ""];

  if (result.summary) lines.push(result.summary, "");

  const gates = result.verification?.gates ?? [];
  if (gates.length > 0) {
    lines.push(`Verificado con: ${gates.map((gate) => `${gate.name} (${gate.command})`).join(", ")}`);
  }
  if (result.repairAttempts > 0) {
    lines.push(`Ciclos de reparacion: ${result.repairAttempts}`);
  }
  if (runUrl) lines.push(`Traza: ${runUrl}`);

  lines.push("", "Generado por Refrendo — agente de trabajo verificado.");
  return lines.join("\n");
}

/** Variables que consume el resto del workflow. */
async function writeGithubOutputs(result: RunResult, commit: CommitResult | null): Promise<void> {
  const file = process.env["GITHUB_OUTPUT"];
  if (!file) return;

  const outputs: Record<string, string> = {
    status: result.status,
    verified: String(result.status === "verified"),
    "cost-usd": result.usage.costUsd.toFixed(4),
    "files-changed": String(result.changes.length),
    "repair-attempts": String(result.repairAttempts),
    branch: commit?.branch ?? "",
    sha: commit?.sha ?? "",
  };

  const body = Object.entries(outputs)
    .map(([key, value]) => `${key}=${value.replace(/\r?\n/g, " ")}`)
    .join("\n");
  await fs.appendFile(file, `${body}\n`, "utf8");
}

/** El informe aparece en la pestana de resumen del job, sin abrir logs. */
async function appendStepSummary(report: string): Promise<void> {
  const file = process.env["GITHUB_STEP_SUMMARY"];
  if (!file) return;
  await fs.appendFile(file, `${report}\n`, "utf8");
}
