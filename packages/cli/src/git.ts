import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";

/**
 * Operaciones de Git para el modo CI.
 *
 * Aqui hay una linea deliberada: Forge crea la rama y el commit, pero **no
 * publica**. `git push` sigue en la denylist dura del agente, y la publicacion
 * se deja como un paso explicito del workflow, con las credenciales del propio
 * pipeline. Asi cualquiera que lea el fichero del workflow ve exactamente donde
 * el codigo sale de la maquina — que es la clase de cosa que no debe estar
 * escondida dentro de un binario.
 *
 * Todo se invoca **sin shell**, pasando los argumentos como lista. Los datos
 * que llegan aqui —nombres de rama, mensajes de commit, nombres de autor— son
 * texto libre, y hacerlos pasar por un shell obliga a escapar para cmd.exe y
 * para POSIX a la vez. No es una preferencia de estilo: con `shell: true`, un
 * `checkout -b 'rama'` crea en Windows una rama que se llama literalmente
 * `'rama'`, comillas incluidas.
 */

const GIT_TIMEOUT_MS = 60_000;

export class GitError extends Error {
  constructor(command: string, detail: string) {
    super(`git ${command} fallo: ${detail}`);
    this.name = "GitError";
  }
}

interface GitResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
}

function spawnGit(cwd: string, args: string[], stdin?: string): Promise<GitResult> {
  return new Promise((resolve) => {
    const child = spawn("git", args, {
      cwd,
      shell: false,
      windowsHide: true,
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
    });

    let stdout = "";
    let stderr = "";

    // Un git que espera entrada que no llega se queda colgado hasta el timeout,
    // y el sintoma no se parece en nada a la causa.
    child.stdin.end(stdin ?? "");

    const timer = setTimeout(() => child.kill("SIGKILL"), GIT_TIMEOUT_MS);
    child.stdout.on("data", (chunk: Buffer) => (stdout += chunk.toString("utf8")));
    child.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString("utf8")));
    child.on("error", (error) => {
      clearTimeout(timer);
      resolve({ exitCode: null, stdout, stderr: `${stderr}\n${error.message}` });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ exitCode: code, stdout, stderr });
    });
  });
}

async function git(cwd: string, args: string[], options: { allowFailure?: boolean; stdin?: string } = {}) {
  const result = await spawnGit(cwd, args, options.stdin);
  if (result.exitCode !== 0 && !options.allowFailure) {
    throw new GitError(args.join(" "), (result.stderr || result.stdout).trim() || `exit ${result.exitCode}`);
  }
  return result;
}

export async function isGitRepo(cwd: string): Promise<boolean> {
  const result = await git(cwd, ["rev-parse", "--is-inside-work-tree"], { allowFailure: true });
  return result.exitCode === 0 && result.stdout.trim() === "true";
}

/** Ficheros con cambios sin comitear, incluidos los no rastreados. */
export async function changedFiles(cwd: string): Promise<string[]> {
  const result = await git(cwd, ["status", "--porcelain"]);
  return result.stdout
    .split("\n")
    .map((line) => line.slice(3).trim())
    .filter((line) => line.length > 0);
}

export async function currentBranch(cwd: string): Promise<string> {
  const result = await git(cwd, ["rev-parse", "--abbrev-ref", "HEAD"]);
  return result.stdout.trim();
}

export async function headSha(cwd: string): Promise<string> {
  const result = await git(cwd, ["rev-parse", "HEAD"]);
  return result.stdout.trim();
}

/**
 * Convierte un objetivo en un nombre de rama valido.
 *
 * Git rechaza bastantes cosas en un nombre de referencia y un objetivo escrito
 * por una persona las lleva casi todas: espacios, acentos, dos puntos, tildes.
 *
 * El sufijo es aleatorio y no una marca de tiempo: dos runs lanzados en el
 * mismo milisegundo —lo normal en una matriz de CI— chocarian con un reloj.
 */
export function branchNameFor(goal: string, prefix = "forge"): string {
  const slug = goal
    .normalize("NFD")
    // Marcas diacriticas combinantes: "añadir" -> "anadir", "límite" -> "limite".
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48)
    .replace(/-+$/g, "");

  return `${prefix}/${slug || "cambio"}-${randomBytes(3).toString("hex")}`;
}

export interface CommitOptions {
  branch: string;
  message: string;
  authorName?: string;
  authorEmail?: string;
}

export interface CommitResult {
  branch: string;
  sha: string;
  files: string[];
}

/**
 * Crea la rama, anade todo lo modificado y comitea.
 *
 * La autoria queda a nombre de quien lanzo el run, no de "Forge": el
 * responsable de un cambio es una persona, y el historial tiene que reflejarlo
 * aunque lo haya tecleado un agente. La procedencia se registra en el pie del
 * mensaje, no falseando el autor.
 */
export async function commitOnNewBranch(cwd: string, options: CommitOptions): Promise<CommitResult> {
  const files = await changedFiles(cwd);
  if (files.length === 0) {
    throw new GitError("commit", "no hay cambios que comitear");
  }

  await git(cwd, ["checkout", "-b", options.branch]);
  await git(cwd, ["add", "-A"]);

  const identity: string[] = [];
  if (options.authorName) identity.push("-c", `user.name=${options.authorName}`);
  if (options.authorEmail) identity.push("-c", `user.email=${options.authorEmail}`);

  // El mensaje va por stdin (`-F -`): lleva comillas, saltos de linea y
  // acentos, y no tiene por que caber comodo en un argumento.
  await git(cwd, [...identity, "commit", "-F", "-"], { stdin: options.message });

  return { branch: options.branch, sha: await headSha(cwd), files };
}
