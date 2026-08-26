#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { createInterface } from "node:readline/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import {
  CONFIG_FILENAME,
  DEFAULT_CONFIG,
  EventBus,
  RefrendoAgent,
  Policy,
  Workspace,
  defaultPolicyConfig,
  detectGates,
  loadConfig,
  verify,
  type ApprovalRequest,
  type Effort,
  type TaskContract,
  noGatesHelp,
  RefrendoError,
} from "@refrendo/core";
import { c, createRenderer, renderResult } from "./render.js";

const USAGE = `
${c.bold("refrendo")} — agente de trabajo verificado

  refrendo run <objetivo>      Planifica, aplica y verifica un cambio
  refrendo ci <objetivo>       Como 'run', pero comitea en una rama solo si queda verificado
  refrendo plan <objetivo>     Solo planifica; no toca nada
  refrendo verify              Ejecuta las puertas de calidad del proyecto
  refrendo init                Crea ${CONFIG_FILENAME} con la configuracion por defecto
  refrendo serve               Arranca el servidor: historial, trazas y la pagina de cada run

Opciones
  -C, --dir <ruta>          Raiz del workspace (por defecto: directorio actual)
  -a, --accept <criterio>   Criterio de aceptacion (repetible)
  -k, --constraint <regla>  Restriccion dura (repetible)
  -f, --context <ruta>      Ruta relevante a mirar primero (repetible)
      --model <id>          Modelo (por defecto: ${DEFAULT_CONFIG.model})
      --effort <nivel>      low | medium | high | xhigh | max
      --max-cost <usd>      Tope de gasto del run
      --max-iterations <n>  Tope de iteraciones del bucle
      --port <n>            Puerto de 'serve' (por defecto 4317)
      --root <ruta>         Repositorio que 'serve' puede tocar (repetible)
      --demo                Siembra un run de ejemplo si el historial esta vacio
      --branch-prefix <p>   Prefijo de rama en 'ci' (por defecto: refrendo)
      --no-commit           En 'ci', no crear rama ni commit
      --report <fichero>    Escribe el informe en Markdown
      --no-record           No guardar el run en el historial local
      --run-url <url>       Enlace a la pagina del run, para el informe
  -y, --yes                 Aprueba automaticamente los comandos no destructivos
      --no-verify           Salta las puertas de verificacion
      --keep                No revertir los cambios si el run no queda en verde
      --json                Emite el resultado como JSON en stdout
  -v, --verbose             Muestra razonamiento, iteraciones y consumo
  -q, --quiet               Solo el informe final
  -h, --help                Esta ayuda
      --version             Version instalada

Antes del primer run hace falta una clave de la API de Anthropic, en un
fichero .env en la raiz del proyecto o en la variable de entorno:

  ANTHROPIC_API_KEY=sk-ant-...

Se saca de https://console.anthropic.com -> API Keys. Ojo: esa consola es
distinta de claude.ai y se factura aparte.

Los comandos destructivos (rm -rf, git push, npm publish...) estan bloqueados
siempre, incluso con --yes.
`;

async function main(argv: string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      dir: { type: "string", short: "C" },
      accept: { type: "string", short: "a", multiple: true },
      constraint: { type: "string", short: "k", multiple: true },
      context: { type: "string", short: "f", multiple: true },
      model: { type: "string" },
      effort: { type: "string" },
      "max-cost": { type: "string" },
      "max-iterations": { type: "string" },
      port: { type: "string" },
      demo: { type: "boolean" },
      "branch-prefix": { type: "string" },
      "no-commit": { type: "boolean" },
      "run-url": { type: "string" },
      report: { type: "string" },
      actor: { type: "string" },
      "actor-email": { type: "string" },
      "no-record": { type: "boolean" },
      root: { type: "string", multiple: true },
      yes: { type: "boolean", short: "y" },
      "no-verify": { type: "boolean" },
      keep: { type: "boolean" },
      json: { type: "boolean" },
      verbose: { type: "boolean", short: "v" },
      quiet: { type: "boolean", short: "q" },
      help: { type: "boolean", short: "h" },
      // `-v` es --verbose desde el principio y ya hay quien lo usa, asi que
      // --version se queda sin forma corta en vez de robarsela.
      version: { type: "boolean" },
    },
  });

  const command = positionals[0];

  if (values.version === true) {
    process.stdout.write(`${await packageVersion()}\n`);
    return 0;
  }

  // Pedir ayuda no es un error: sale con 0. Invocar sin comando si lo es,
  // porque nadie quiso eso y un script que lo haga tiene que enterarse.
  if (values.help === true) {
    process.stdout.write(`${USAGE}\n`);
    return 0;
  }
  if (!command) {
    process.stdout.write(`${USAGE}\n`);
    return 1;
  }

  const root = path.resolve(values.dir ?? process.cwd());
  loadDotEnv(root);
  const workspace = new Workspace(root);
  const config = await loadConfig(root);
  const bus = new EventBus();
  const render = createRenderer({
    verbose: values.verbose === true,
    quiet: values.quiet === true || values.json === true,
  });
  bus.on(render);

  switch (command) {
    case "init":
      return initConfig(workspace);

    case "serve": {
      const { startServer, seedDemoRun } = await import("@refrendo/server");
      const server = await startServer({
        allowedRoots: values.root && values.root.length > 0 ? values.root.map((r) => path.resolve(r)) : [root],
        port: values.port ? Number(values.port) : 4317,
        dbFile: path.join(root, ".refrendo", "runs.db"),
        token: process.env["REFRENDO_TOKEN"],
        model: values.model ?? config.model,
        effort: (values.effort as Effort | undefined) ?? config.effort,
        limits: config.limits,
        // La politica del fichero es de organizacion: aplica a todos los runs
        // que entren por la API, los lance quien los lance.
        ...(config.requiredGates ? { requiredGates: config.requiredGates } : {}),
        ...(config.protectedPaths ? { protectedPaths: config.protectedPaths } : {}),
      });

      // El run de ejemplo solo se siembra en un almacen vacio: nunca ensucia
      // el historial real de un equipo.
      let demoUrl = "";
      if (values.demo && server.store.summary().total === 0) {
        demoUrl = `${server.url}/r/${seedDemoRun(server.store)}`;
      }

      process.stdout.write(
        `${c.bold("refrendo serve")} ${c.dim(server.url)}\n` +
          `  repositorios: ${(values.root ?? [root]).join(", ")}\n` +
          `  acceso: ${process.env["REFRENDO_TOKEN"] ? c.green("token requerido") : c.yellow("solo local (define REFRENDO_TOKEN para abrirlo)")}\n` +
          (demoUrl ? `  ejemplo: ${c.cyan(demoUrl)}\n` : "") +
          `\n  Ctrl+C para parar.\n`,
      );

      // El proceso vive hasta que lo maten; cerrar limpio evita dejar el
      // fichero SQLite a medias.
      await new Promise<void>((resolve) => {
        const stop = () => void server.close().then(resolve);
        process.once("SIGINT", stop);
        process.once("SIGTERM", stop);
      });
      return 0;
    }

    case "verify": {
      const gates = config.gates ?? (await detectGates(workspace));
      if (gates.length === 0) {
        process.stdout.write(`${c.yellow(noGatesHelp(CONFIG_FILENAME))}\n`);
        return 1;
      }
      const report = await verify(workspace, bus.emit, { gates });
      return report.passed ? 0 : 1;
    }

    case "ci":
    case "run":
    case "plan": {
      const goal = positionals.slice(1).join(" ").trim();
      if (!goal) {
        process.stderr.write(`${c.red("Falta el objetivo.")}\nEjemplo: refrendo run "anade paginacion al endpoint de usuarios"\n`);
        return 1;
      }

      const contract: TaskContract = {
        goal,
        ...(values.accept ? { acceptance: values.accept } : {}),
        ...(values.constraint ? { constraints: values.constraint } : {}),
        ...(values.context ? { context: values.context } : {}),
      };

      const policy = new Policy(
        defaultPolicyConfig({
          autoApprove: values.yes === true,
          onApprovalRequest: askForApproval,
          ...(config.allowedCommands
            ? { allowedCommands: [...defaultPolicyConfig().allowedCommands, ...config.allowedCommands] }
            : {}),
          // Las rutas protegidas del fichero se suman a las de serie; no las sustituyen.
          ...(config.protectedPaths
            ? { protectedPaths: [...defaultPolicyConfig().protectedPaths, ...config.protectedPaths] }
            : {}),
        }),
      );

      let lastResult: import("@refrendo/core").RunResult | null = null;

      const agent = new RefrendoAgent({
        workspace,
        provider: {
          model: values.model ?? config.model,
          effort: (values.effort as Effort | undefined) ?? config.effort,
        },
        policy,
        limits: {
          maxCostUsd: numberOr(values["max-cost"], config.limits.maxCostUsd),
          maxIterations: numberOr(values["max-iterations"], config.limits.maxIterations),
          maxRepairAttempts: config.limits.maxRepairAttempts,
        },
        bus,
        ...(config.gates ? { gates: config.gates } : {}),
        ...(config.requiredGates ? { requiredGates: config.requiredGates } : {}),
        planOnly: command === "plan",
        skipVerification: values["no-verify"] === true,
        rollbackOnFailure: values.keep !== true,
      });

      // El recibo no depende de por donde entraste: un run de terminal se
      // graba igual que uno lanzado por la API.
      let receiptUrl = "";
      let closeStore: (() => void) | null = null;
      if (values["no-record"] !== true) {
        try {
          const { RunStore, recordRun } = await import("@refrendo/server");
          const store = await RunStore.open(path.join(root, ".refrendo", "runs.db"));
          const recording = recordRun(store, {
            contract,
            workspace: root,
            repo: path.basename(root),
            actor: process.env["GITHUB_ACTOR"] ?? values.actor ?? os.userInfo().username,
            model: values.model ?? config.model,
          });
          bus.on(recording.listener);
          receiptUrl = `/r/${recording.id}`;

          // Un Ctrl+C a mitad de run dejaba la fila marcada como en curso para
          // siempre, contando en el total del plano de equipo pero nunca entre
          // los verificados. Se cierra con su motivo antes de salir.
          const alInterrumpir = (senal: string) => () => {
            recording.interrupt(`Run interrumpido (${senal}) antes de emitir veredicto.`);
            store.close();
            process.exit(130);
          };
          process.once("SIGINT", alInterrumpir("SIGINT"));
          process.once("SIGTERM", alInterrumpir("SIGTERM"));

          closeStore = () => {
            // Sin resultado no hay veredicto que registrar: el run murio.
            if (lastResult) recording.finish(lastResult);
            else recording.interrupt("El run termino sin producir resultado.");
            store.close();
          };
        } catch (error) {
          process.stderr.write(
            `${c.yellow("aviso:")} no se pudo abrir el historial local; el run no dejara recibo. ${error instanceof Error ? error.message : String(error)}\n`,
          );
        }
      }

      const result = await agent.run(contract);
      lastResult = result;
      closeStore?.();

      if (values.json) {
        process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      } else {
        process.stdout.write(`${renderResult(result)}\n`);
      }

      if (receiptUrl && !values.json) {
        process.stdout.write(
          `${c.dim("recibo")} ${c.cyan(receiptUrl)} ${c.dim("— arranca `refrendo serve` para abrirlo")}\n`,
        );
      }

      if (command === "ci") {
        const { finishCi } = await import("./ci.js");
        const outcome = await finishCi(result, {
          cwd: root,
          branchPrefix: values["branch-prefix"] ?? "refrendo",
          commit: values["no-commit"] !== true,
          actorName: process.env["GITHUB_ACTOR"] ?? values.actor,
          actorEmail: values["actor-email"],
          runUrl: values["run-url"],
        });

        process.stdout.write(`\n${outcome.code === 0 ? c.green("CI") : c.yellow("CI")} ${outcome.reason}\n`);
        if (values["report"]) await writeReport(values["report"], outcome.report);
        return outcome.code;
      }

      // El codigo de salida es la senal para CI: solo "verified" es un exito.
      return result.status === "verified" || (command === "plan" && result.plan) ? 0 : 1;
    }

    default:
      process.stderr.write(`${c.red(`Comando desconocido: ${command}`)}\n${USAGE}\n`);
      return 1;
  }
}

/**
 * Aprobacion humana en la terminal.
 *
 * Sin TTY (CI, pipe) se deniega en vez de preguntar: un prompt que nadie puede
 * contestar colgaria el proceso, y aprobar por defecto seria peor.
 */
async function askForApproval(request: ApprovalRequest): Promise<boolean> {
  if (!process.stdin.isTTY) {
    process.stderr.write(
      `${c.yellow("Aprobacion necesaria sin terminal interactiva; se deniega.")} ${request.detail}\n`,
    );
    return false;
  }

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    process.stdout.write(`\n${c.yellow("Aprobacion necesaria")}\n  ${request.operation}: ${c.bold(request.detail)}\n`);
    const answer = await rl.question(`  ${c.dim("[s/N]")} `);
    return /^(s|si|sí|y|yes)$/i.test(answer.trim());
  } finally {
    rl.close();
  }
}

async function initConfig(workspace: Workspace): Promise<number> {
  if (await workspace.exists(CONFIG_FILENAME)) {
    process.stdout.write(`${c.yellow(`${CONFIG_FILENAME} ya existe; no se toca.`)}\n`);
    return 0;
  }
  const gates = await detectGates(workspace);
  const config = {
    model: DEFAULT_CONFIG.model,
    effort: DEFAULT_CONFIG.effort,
    limits: DEFAULT_CONFIG.limits,
    gates,
  };
  await workspace.writeFile(CONFIG_FILENAME, `${JSON.stringify(config, null, 2)}\n`);
  process.stdout.write(
    `${c.green("Creado")} ${CONFIG_FILENAME}\n${gates.length > 0 ? `Puertas detectadas: ${gates.map((gate) => gate.name).join(", ")}\n` : `${c.yellow("No se detectaron puertas: anade scripts typecheck/test/lint a package.json.")}\n`}`,
  );
  return 0;
}

/**
 * Carga el `.env` del workspace si existe.
 *
 * Sin esto, la primera ejecucion de casi todo el mundo falla por credenciales
 * pese a tener el fichero delante. Se usa el cargador nativo de Node en vez de
 * una dependencia, y no es un error que el fichero no exista.
 */
async function writeReport(file: string, report: string): Promise<void> {
  const { promises: fs } = await import("node:fs");
  await fs.writeFile(path.resolve(file), report, "utf8");
}

function loadDotEnv(root: string): void {
  try {
    process.loadEnvFile(path.join(root, ".env"));
  } catch {
    // Sin .env se sigue con las variables del entorno o el perfil de `ant`.
  }
}

function numberOr(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/**
 * Version instalada, leida del package.json que viaja en el propio paquete.
 *
 * No es una constante en el fuente a proposito: una constante se queda vieja
 * en cuanto alguien publica sin tocarla, y entonces `refrendo --version` miente
 * — que es peor que no tener el comando.
 */
async function packageVersion(): Promise<string> {
  try {
    const aqui = path.dirname(fileURLToPath(import.meta.url));
    const crudo = await readFile(path.join(aqui, "..", "package.json"), "utf8");
    return (JSON.parse(crudo) as { version?: string }).version ?? "desconocida";
  } catch {
    return "desconocida";
  }
}

main(process.argv.slice(2))
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    // Los RefrendoError ya los ha pintado el renderer con su formato y su
    // explicacion. Repetirlos aqui en crudo hace que un fallo previsto
    // —no tener clave, por ejemplo— parezca que ademas se ha roto algo.
    if (!(error instanceof RefrendoError)) {
      process.stderr.write(`${c.red("Error fatal:")} ${error instanceof Error ? error.message : String(error)}\n`);
    }
    process.exitCode = 1;
  });
