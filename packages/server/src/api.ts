import type { IncomingMessage, ServerResponse } from "node:http";
import { timingSafeEqual } from "node:crypto";
import type { TaskContract } from "@refrendo/core";
import { renderIndex } from "./render/index-page.js";
import { renderTeam } from "./render/team.js";
import { shareSecret, signShare, verifyShare } from "./share.js";
import { renderEvent, renderRecord } from "./render/record.js";
import { WorkspaceNotAllowed, type RunManager } from "./runner.js";
import type { RunStore, StoredEvent } from "./store.js";

export interface ApiOptions {
  store: RunStore;
  runs: RunManager;
  /**
   * Token de acceso. Si no se define, solo se atiende a peticiones locales:
   * un servidor que ejecuta agentes con acceso al shell no puede quedar abierto
   * por omision.
   */
  token?: string | undefined;
}

const MAX_BODY_BYTES = 64 * 1024;
const KEEPALIVE_MS = 20_000;

export function createHandler(options: ApiOptions) {
  const secret = shareSecret(options.token);

  return async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
    const method = req.method ?? "GET";

    try {
      if (url.pathname === "/healthz") return sendJson(res, 200, { ok: true });

      // Un enlace firmado abre exactamente un run, en solo lectura. Se
      // comprueba antes que el token porque su gracia es funcionar sin el.
      const shared = url.pathname.match(/^\/r\/([0-9a-f-]{36})$/);
      if (method === "GET" && shared && verifyShare(secret, shared[1]!, url.searchParams.get("s"))) {
        const run = options.store.getRun(shared[1]!);
        if (!run) return sendHtml(res, 404, notFoundPage());
        return sendHtml(res, 200, renderRecord(run, options.store.getEvents(run.id)));
      }

      if (!authorized(req, options.token)) {
        return sendJson(res, 401, {
          error: options.token
            ? "Falta la cabecera Authorization: Bearer <token>."
            : "Sin token configurado el servidor solo atiende peticiones locales.",
        });
      }

      // --- paginas ---
      if (method === "GET" && url.pathname === "/") {
        const runs = options.store.listRuns({ limit: 50 });
        return sendHtml(res, 200, renderIndex(runs, options.store.summary()));
      }

      if (method === "GET" && url.pathname === "/team") {
        return sendHtml(
          res,
          200,
          renderTeam({
            byRepo: options.store.breakdown("repo"),
            byActor: options.store.breakdown("actor"),
            summary: options.store.summary(),
          }),
        );
      }

      const record = url.pathname.match(/^\/r\/([0-9a-f-]{36})$/);
      if (method === "GET" && record) {
        const run = options.store.getRun(record[1]!);
        if (!run) return sendHtml(res, 404, notFoundPage());
        return sendHtml(res, 200, renderRecord(run, options.store.getEvents(run.id)));
      }

      // --- api ---
      if (url.pathname === "/api/runs") {
        if (method === "GET") {
          const repo = url.searchParams.get("repo");
          return sendJson(res, 200, {
            runs: options.store.listRuns({
              limit: Number(url.searchParams.get("limit") ?? 50),
              ...(repo ? { repo } : {}),
            }),
            summary: options.store.summary(),
          });
        }
        if (method === "POST") return createRun(req, res, options);
        return sendJson(res, 405, { error: "Metodo no permitido." });
      }

      const runPath = url.pathname.match(/^\/api\/runs\/([0-9a-f-]{36})(\/[a-z]+)?$/);
      if (runPath) {
        const id = runPath[1]!;
        const sub = runPath[2];
        const run = options.store.getRun(id);
        if (!run) return sendJson(res, 404, { error: "Run no encontrado." });

        if (method === "GET" && !sub) return sendJson(res, 200, run);
        if (method === "GET" && sub === "/events") {
          return sendJson(res, 200, {
            events: options.store.getEvents(id, Number(url.searchParams.get("after") ?? 0)),
          });
        }
        if (method === "GET" && sub === "/stream") return streamRun(req, res, options, id);
        if (method === "POST" && sub === "/share") {
          const share = signShare(secret, id);
          return sendJson(res, 200, {
            url: `${url.origin}/r/${id}?s=${share.token}`,
            expiresAt: new Date(share.expiresAt * 1000).toISOString(),
          });
        }
        if (method === "POST" && sub === "/cancel") {
          return sendJson(res, 200, { cancelled: options.runs.cancel(id) });
        }
      }

      return sendJson(res, 404, { error: "Ruta no encontrada." });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!res.headersSent) sendJson(res, 500, { error: message });
      else res.end();
    }
  };
}

async function createRun(req: IncomingMessage, res: ServerResponse, options: ApiOptions): Promise<void> {
  let payload: Record<string, unknown>;
  try {
    payload = await readJson(req);
  } catch (error) {
    return sendJson(res, 400, { error: error instanceof Error ? error.message : "Cuerpo invalido." });
  }

  const goal = typeof payload["goal"] === "string" ? payload["goal"].trim() : "";
  const workspace = typeof payload["workspace"] === "string" ? payload["workspace"] : "";
  if (!goal) return sendJson(res, 400, { error: "Falta 'goal'." });
  if (!workspace) return sendJson(res, 400, { error: "Falta 'workspace'." });

  const contract: TaskContract = {
    goal,
    ...(Array.isArray(payload["acceptance"]) ? { acceptance: payload["acceptance"].map(String) } : {}),
    ...(Array.isArray(payload["constraints"]) ? { constraints: payload["constraints"].map(String) } : {}),
    ...(Array.isArray(payload["context"]) ? { context: payload["context"].map(String) } : {}),
  };

  try {
    const run = options.runs.start({
      contract,
      workspace,
      ...(typeof payload["actor"] === "string" ? { actor: payload["actor"] } : {}),
      planOnly: payload["planOnly"] === true,
      autoApprove: payload["autoApprove"] === true,
    });
    return sendJson(res, 201, { run, url: `/r/${run.id}` });
  } catch (error) {
    if (error instanceof WorkspaceNotAllowed) return sendJson(res, 403, { error: error.message });
    throw error;
  }
}

/**
 * Stream de la traza por SSE.
 *
 * Primero se reproduce lo ya ocurrido desde `Last-Event-ID` y solo despues se
 * conecta el suscriptor. Al reves habria una ventana en la que un evento se
 * emite entre la consulta y la suscripcion, y el espectador nunca lo veria.
 */
function streamRun(req: IncomingMessage, res: ServerResponse, options: ApiOptions, runId: string): void {
  const lastId = Number(req.headers["last-event-id"] ?? 0);
  const after = Number.isFinite(lastId) && lastId > 0 ? lastId : 0;

  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });

  const send = (entry: StoredEvent): void => {
    const line = renderEvent(entry);
    res.write(`id: ${entry.seq}\n`);
    res.write("event: refrendo\n");
    res.write(
      `data: ${JSON.stringify({ seq: entry.seq, type: entry.event.type, html: line ? line.value : null })}\n\n`,
    );
  };

  for (const entry of options.store.getEvents(runId, after)) send(entry);

  if (!options.runs.isActive(runId)) {
    res.write("event: end\ndata: {}\n\n");
    res.end();
    return;
  }

  const unsubscribe = options.runs.subscribe(runId, (entry) => {
    if (entry === null) {
      res.write("event: end\ndata: {}\n\n");
      cleanup();
      res.end();
      return;
    }
    send(entry);
  });

  // Sin trafico, un proxy intermedio corta la conexion en silencio.
  const keepalive = setInterval(() => res.write(": ping\n\n"), KEEPALIVE_MS);

  const cleanup = () => {
    clearInterval(keepalive);
    unsubscribe();
  };

  req.on("close", cleanup);
}

/** Con token, cabecera valida. Sin token, solo bucle local. */
function authorized(req: IncomingMessage, token: string | undefined): boolean {
  if (!token) return isLoopback(req);

  const header = req.headers.authorization ?? "";
  const provided = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (provided.length !== token.length) return false;
  // Comparacion en tiempo constante: con `===`, el tiempo de respuesta filtra
  // cuantos caracteres del token son correctos.
  return timingSafeEqual(Buffer.from(provided), Buffer.from(token));
}

function isLoopback(req: IncomingMessage): boolean {
  const address = req.socket.remoteAddress ?? "";
  return address === "127.0.0.1" || address === "::1" || address === "::ffff:127.0.0.1";
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY_BYTES) throw new Error("El cuerpo de la peticion es demasiado grande.");
    chunks.push(chunk as Buffer);
  }
  if (chunks.length === 0) return {};
  try {
    const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("Se esperaba un objeto JSON.");
    }
    return parsed as Record<string, unknown>;
  } catch (error) {
    throw new Error(`JSON invalido: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function sendJson(res: ServerResponse, status: number, payload: unknown): void {
  const body = JSON.stringify(payload, null, 2);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
  });
  res.end(body);
}

function sendHtml(res: ServerResponse, status: number, body: string): void {
  res.writeHead(status, {
    "Content-Type": "text/html; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    // La pagina incrusta salida de comandos: sin esto, un nombre de fichero
    // malicioso en un repositorio podria ejecutar script en el navegador de
    // quien revisa. El escapado ya lo impide; esto es la segunda cerradura.
    "Content-Security-Policy":
      "default-src 'none'; style-src 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; script-src 'unsafe-inline'; connect-src 'self'",
    "X-Content-Type-Options": "nosniff",
  });
  res.end(body);
}

function notFoundPage(): string {
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Run no encontrado</title></head>
<body style="font-family:system-ui;padding:3rem;max-width:40rem;margin:0 auto">
<h1>Run no encontrado</h1>
<p>Ese identificador no existe en este servidor. <a href="/">Ver todos los runs</a>.</p>
</body></html>`;
}
