import { createServer, type Server } from "node:http";
import type { BudgetLimits, Effort } from "@forge/core";
import { createHandler } from "./api.js";
import { RunManager } from "./runner.js";
import { RunStore } from "./store.js";

export * from "./api.js";
export * from "./runner.js";
export * from "./store.js";
export { seedDemoRun } from "./demo.js";
export { renderRecord } from "./render/record.js";
export { renderIndex } from "./render/index-page.js";
export { escapeHtml, html, raw } from "./html.js";

export interface ServerConfig {
  port?: number;
  host?: string;
  /** Fichero SQLite. `:memory:` para un servidor efimero. */
  dbFile?: string;
  /** Repositorios que este servidor puede tocar. Obligatorio y sin comodines. */
  allowedRoots: string[];
  token?: string | undefined;
  model?: string | undefined;
  effort?: Effort | undefined;
  limits?: Partial<BudgetLimits> | undefined;
}

export interface RunningServer {
  url: string;
  port: number;
  store: RunStore;
  runs: RunManager;
  close(): Promise<void>;
}

export async function startServer(config: ServerConfig): Promise<RunningServer> {
  if (config.allowedRoots.length === 0) {
    throw new Error(
      "Hay que declarar al menos una raiz permitida: sin ella el servidor no puede ejecutar nada.",
    );
  }

  // Sin token no se acepta trafico externo, asi que escuchar en 0.0.0.0 solo
  // seria una invitacion a que alguien descubra el puerto y no pueda usarlo.
  const host = config.host ?? (config.token ? "0.0.0.0" : "127.0.0.1");
  const store = await RunStore.open(config.dbFile ?? ".forge/runs.db");
  const runs = new RunManager({
    store,
    allowedRoots: config.allowedRoots,
    ...(config.model ? { model: config.model } : {}),
    ...(config.effort ? { effort: config.effort } : {}),
    ...(config.limits ? { limits: config.limits } : {}),
  });

  const handler = createHandler({ store, runs, token: config.token });
  const server: Server = createServer((req, res) => void handler(req, res));

  const port = await new Promise<number>((resolve, reject) => {
    server.once("error", reject);
    server.listen(config.port ?? 4317, host, () => {
      const address = server.address();
      resolve(typeof address === "object" && address ? address.port : (config.port ?? 4317));
    });
  });

  return {
    url: `http://${host === "0.0.0.0" ? "localhost" : host}:${port}`,
    port,
    store,
    runs,
    async close() {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      store.close();
    },
  };
}
