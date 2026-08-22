import { spawn } from "node:child_process";
import { z } from "zod";
import { PolicyDenied } from "../errors.js";
import type { ToolDefinition, ToolOutcome } from "../types.js";
import type { Policy } from "../policy.js";
import { asMessage } from "./fs.js";

export interface CommandResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  durationMs: number;
}

const MAX_CAPTURE_CHARS = 20_000;

/**
 * Ejecuta un comando en el workspace con timeout y captura acotada.
 *
 * Se usa `shell: true` a proposito — los comandos reales de un proyecto llevan
 * tuberias y operadores. El control no esta en el parser, esta en la politica:
 * la denylist se evalua antes de llegar aqui.
 */
export function runCommand(
  command: string,
  options: { cwd: string; timeoutMs: number; signal?: AbortSignal; stdin?: string },
): Promise<CommandResult> {
  const startedAt = Date.now();

  return new Promise((resolve) => {
    const child = spawn(command, {
      cwd: options.cwd,
      shell: true,
      windowsHide: true,
      env: { ...process.env, CI: "1", FORCE_COLOR: "0", NO_COLOR: "1" },
    });

    // Pasar texto por stdin evita tener que escaparlo para el shell. Se cierra
    // siempre: un proceso que espera entrada que no llega se cuelga hasta el
    // timeout, y el sintoma no se parece en nada a la causa.
    if (options.stdin !== undefined) child.stdin?.end(options.stdin);
    else child.stdin?.end();

    let stdout = "";
    let stderr = "";
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, options.timeoutMs);

    const onAbort = () => child.kill("SIGKILL");
    options.signal?.addEventListener("abort", onAbort, { once: true });

    child.stdout?.on("data", (chunk: Buffer) => {
      if (stdout.length < MAX_CAPTURE_CHARS) stdout += chunk.toString();
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      if (stderr.length < MAX_CAPTURE_CHARS) stderr += chunk.toString();
    });

    const finish = (exitCode: number | null) => {
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", onAbort);
      resolve({
        exitCode,
        stdout: stdout.slice(0, MAX_CAPTURE_CHARS),
        stderr: stderr.slice(0, MAX_CAPTURE_CHARS),
        timedOut,
        durationMs: Date.now() - startedAt,
      });
    };

    child.on("error", (error) => {
      stderr += `\n${asMessage(error)}`;
      finish(null);
    });
    child.on("close", finish);
  });
}

/** Resuelve permiso: denylist dura, allowlist, o aprobacion humana. */
async function authorize(command: string, policy: Policy, emit: ToolCtx["emit"]): Promise<boolean> {
  policy.assertCommandAllowed(command); // lanza PolicyDenied si esta prohibido
  if (policy.isPreapprovedCommand(command)) return true;

  const id = `approval_${Date.now().toString(36)}`;
  emit({
    type: "approval_requested",
    id,
    operation: "run_command",
    detail: command,
  });
  const approved = await policy.requestApproval({
    operation: "Ejecutar comando",
    detail: command,
  });
  emit({ type: "approval_resolved", id, approved });
  return approved;
}

type ToolCtx = Parameters<ToolDefinition["run"]>[1];

export const runCommandTool: ToolDefinition = {
  name: "run_command",
  description:
    "Ejecuta un comando de shell en la raiz del workspace y devuelve codigo de salida, stdout y stderr. Usalo para instalar dependencias, ejecutar tests o inspeccionar el estado del repositorio. Los comandos destructivos o que publican fuera de la maquina estan bloqueados.",
  mutating: true,
  schema: z.object({
    command: z.string().describe("Comando completo, tal cual se escribiria en la terminal."),
    reason: z.string().describe("Para que lo ejecutas. Se muestra al humano al pedir aprobacion."),
  }),
  async run(input, ctx): Promise<ToolOutcome> {
    const { command } = input as { command: string; reason: string };
    try {
      const approved = await authorize(command, ctx.policy, ctx.emit);
      if (!approved) {
        return {
          ok: false,
          content: `El humano denego "${command}". No lo reintentes: busca otra via o pide una alternativa.`,
        };
      }

      const result = await runCommand(command, {
        cwd: ctx.workspace.root,
        timeoutMs: ctx.policy.config.commandTimeoutMs,
        ...(ctx.signal ? { signal: ctx.signal } : {}),
      });

      if (result.timedOut) {
        return {
          ok: false,
          content: `"${command}" excedio el timeout de ${ctx.policy.config.commandTimeoutMs} ms y fue abortado.\n\n${tail(result.stdout, result.stderr)}`,
        };
      }

      const ok = result.exitCode === 0;
      return {
        ok,
        content: `exit=${result.exitCode} (${result.durationMs} ms)\n\n${tail(result.stdout, result.stderr)}`,
        meta: { command, exitCode: result.exitCode },
      };
    } catch (error) {
      if (error instanceof PolicyDenied) {
        return { ok: false, content: `${error.message} Este bloqueo no es negociable.` };
      }
      return { ok: false, content: `Fallo al ejecutar "${command}": ${asMessage(error)}` };
    }
  },
};

function tail(stdout: string, stderr: string): string {
  const parts: string[] = [];
  if (stdout.trim()) parts.push(`--- stdout ---\n${lastLines(stdout, 120)}`);
  if (stderr.trim()) parts.push(`--- stderr ---\n${lastLines(stderr, 120)}`);
  return parts.join("\n\n") || "[sin salida]";
}

/** La cola es lo util de un log de build: el error suele estar al final. */
export function lastLines(text: string, count: number): string {
  const lines = text.trimEnd().split("\n");
  return lines.length <= count ? lines.join("\n") : lines.slice(-count).join("\n");
}
