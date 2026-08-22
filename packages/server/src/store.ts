import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { promises as fs } from "node:fs";
import type { RefrendoEvent, RunResult, TaskContract } from "@refrendo/core";

/** Un run en curso todavia no tiene veredicto. */
export type StoredStatus = RunResult["status"] | "running";

export interface RunRow {
  id: string;
  createdAt: string;
  finishedAt: string | null;
  status: StoredStatus;
  goal: string;
  workspace: string;
  repo: string;
  actor: string | null;
  model: string | null;
  costUsd: number;
  result: RunResult | null;
}

export interface StoredEvent {
  seq: number;
  at: string;
  event: RefrendoEvent;
}

export interface CreateRunInput {
  contract: TaskContract;
  workspace: string;
  repo: string;
  actor?: string | null;
  model?: string | null;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS runs (
  id          TEXT PRIMARY KEY,
  created_at  TEXT NOT NULL,
  finished_at TEXT,
  status      TEXT NOT NULL,
  goal        TEXT NOT NULL,
  contract    TEXT NOT NULL,
  workspace   TEXT NOT NULL,
  repo        TEXT NOT NULL,
  actor       TEXT,
  model       TEXT,
  cost_usd    REAL NOT NULL DEFAULT 0,
  result      TEXT
);

CREATE TABLE IF NOT EXISTS events (
  run_id  TEXT NOT NULL,
  seq     INTEGER NOT NULL,
  at      TEXT NOT NULL,
  type    TEXT NOT NULL,
  payload TEXT NOT NULL,
  PRIMARY KEY (run_id, seq)
);

CREATE INDEX IF NOT EXISTS idx_runs_created ON runs (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_runs_repo    ON runs (repo, created_at DESC);
`;

/**
 * Almacen de runs y de su traza.
 *
 * La tabla `events` es de solo anexado y es la fuente de verdad: la fila de
 * `runs` es una proyeccion que se puede reconstruir reproduciendo los eventos.
 * Esa asimetria es deliberada — el valor que se vende es la evidencia, y la
 * evidencia no se actualiza en su sitio, se acumula.
 */
export class RunStore {
  private readonly db: DatabaseSync;

  private constructor(db: DatabaseSync) {
    this.db = db;
    this.db.exec("PRAGMA journal_mode = WAL");
    this.db.exec("PRAGMA foreign_keys = ON");
    this.db.exec(SCHEMA);
  }

  /** `:memory:` crea un almacen efimero, util en tests. */
  static async open(file: string): Promise<RunStore> {
    if (file !== ":memory:") {
      await fs.mkdir(path.dirname(path.resolve(file)), { recursive: true });
    }
    return new RunStore(new DatabaseSync(file));
  }

  createRun(input: CreateRunInput): RunRow {
    const id = randomUUID();
    const createdAt = new Date().toISOString();

    this.db
      .prepare(
        `INSERT INTO runs (id, created_at, status, goal, contract, workspace, repo, actor, model)
         VALUES (?, ?, 'running', ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        createdAt,
        input.contract.goal,
        JSON.stringify(input.contract),
        input.workspace,
        input.repo,
        input.actor ?? null,
        input.model ?? null,
      );

    return {
      id,
      createdAt,
      finishedAt: null,
      status: "running",
      goal: input.contract.goal,
      workspace: input.workspace,
      repo: input.repo,
      actor: input.actor ?? null,
      model: input.model ?? null,
      costUsd: 0,
      result: null,
    };
  }

  /**
   * Anexa un evento y devuelve su numero de secuencia.
   *
   * La secuencia se calcula dentro de una transaccion porque es la que usa el
   * cliente para reanudar el stream: un hueco o un duplicado significaria que
   * un espectador se pierde parte de la traza sin enterarse.
   */
  appendEvent(runId: string, event: RefrendoEvent): number {
    // `BEGIN IMMEDIATE` toma el bloqueo de escritura ya: con el `DEFERRED` por
    // defecto, dos runs simultaneos podrian leer el mismo MAX(seq) y chocar en
    // la clave primaria.
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const row = this.db
        .prepare("SELECT COALESCE(MAX(seq), 0) AS last FROM events WHERE run_id = ?")
        .get(runId) as { last: number } | undefined;
      const seq = (row?.last ?? 0) + 1;

      this.db
        .prepare("INSERT INTO events (run_id, seq, at, type, payload) VALUES (?, ?, ?, ?, ?)")
        .run(runId, seq, new Date().toISOString(), event.type, JSON.stringify(event));

      // El coste se proyecta en caliente para poder listar runs sin releer la traza.
      if (event.type === "usage_updated") {
        this.db.prepare("UPDATE runs SET cost_usd = ? WHERE id = ?").run(event.usage.costUsd, runId);
      }

      this.db.exec("COMMIT");
      return seq;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  finishRun(runId: string, result: RunResult): void {
    this.db
      .prepare(
        `UPDATE runs SET status = ?, finished_at = ?, result = ?, cost_usd = ? WHERE id = ?`,
      )
      .run(result.status, new Date().toISOString(), JSON.stringify(result), result.usage.costUsd, runId);
  }

  /** Marca un run que murio por un fallo del propio servidor, no del agente. */
  failRun(runId: string, message: string): void {
    this.db
      .prepare(
        `UPDATE runs SET status = 'failed', finished_at = ?, result = ? WHERE id = ? AND finished_at IS NULL`,
      )
      .run(new Date().toISOString(), JSON.stringify({ error: { code: "server_error", message } }), runId);
  }

  getRun(id: string): RunRow | null {
    const row = this.db.prepare("SELECT * FROM runs WHERE id = ?").get(id) as
      | Record<string, unknown>
      | undefined;
    return row ? toRunRow(row) : null;
  }

  listRuns(options: { limit?: number; repo?: string } = {}): RunRow[] {
    const limit = Math.min(options.limit ?? 50, 200);
    const rows = options.repo
      ? this.db
          .prepare("SELECT * FROM runs WHERE repo = ? ORDER BY created_at DESC LIMIT ?")
          .all(options.repo, limit)
      : this.db.prepare("SELECT * FROM runs ORDER BY created_at DESC LIMIT ?").all(limit);
    return (rows as Record<string, unknown>[]).map(toRunRow);
  }

  getEvents(runId: string, afterSeq = 0): StoredEvent[] {
    const rows = this.db
      .prepare("SELECT seq, at, payload FROM events WHERE run_id = ? AND seq > ? ORDER BY seq")
      .all(runId, afterSeq) as Array<{ seq: number; at: string; payload: string }>;

    return rows.map((row) => ({
      seq: row.seq,
      at: row.at,
      event: JSON.parse(row.payload) as RefrendoEvent,
    }));
  }

  /** Metricas agregadas. Es lo que justifica la factura y lo que mira un jefe de equipo. */
  summary(): { total: number; verified: number; reverted: number; costUsd: number } {
    const row = this.db
      .prepare(
        `SELECT COUNT(*) AS total,
                SUM(CASE WHEN status = 'verified' THEN 1 ELSE 0 END) AS verified,
                SUM(CASE WHEN status = 'reverted' THEN 1 ELSE 0 END) AS reverted,
                COALESCE(SUM(cost_usd), 0) AS cost
         FROM runs`,
      )
      .get() as { total: number; verified: number | null; reverted: number | null; cost: number };

    return {
      total: row.total,
      verified: row.verified ?? 0,
      reverted: row.reverted ?? 0,
      costUsd: row.cost,
    };
  }

  /**
   * Agregados por repositorio y por persona.
   *
   * La columna que importa no es cuantos runs se lanzaron sino que fraccion
   * quedo verificada: mide resultado, no actividad. Y es la que se factura.
   */
  breakdown(dimension: "repo" | "actor"): Array<{
    key: string;
    runs: number;
    verified: number;
    reverted: number;
    costUsd: number;
  }> {
    const column = dimension === "repo" ? "repo" : "actor";
    const rows = this.db
      .prepare(
        `SELECT COALESCE(${column}, '(sin identificar)') AS key,
                COUNT(*) AS runs,
                SUM(CASE WHEN status = 'verified' THEN 1 ELSE 0 END) AS verified,
                SUM(CASE WHEN status = 'reverted' THEN 1 ELSE 0 END) AS reverted,
                COALESCE(SUM(cost_usd), 0) AS cost
         FROM runs
         GROUP BY key
         ORDER BY cost DESC, runs DESC`,
      )
      .all() as Array<{ key: string; runs: number; verified: number | null; reverted: number | null; cost: number }>;

    return rows.map((row) => ({
      key: row.key,
      runs: row.runs,
      verified: row.verified ?? 0,
      reverted: row.reverted ?? 0,
      costUsd: row.cost,
    }));
  }

  close(): void {
    this.db.close();
  }
}

function toRunRow(row: Record<string, unknown>): RunRow {
  return {
    id: String(row["id"]),
    createdAt: String(row["created_at"]),
    finishedAt: row["finished_at"] === null ? null : String(row["finished_at"]),
    status: String(row["status"]) as StoredStatus,
    goal: String(row["goal"]),
    workspace: String(row["workspace"]),
    repo: String(row["repo"]),
    actor: row["actor"] === null ? null : String(row["actor"]),
    model: row["model"] === null ? null : String(row["model"]),
    costUsd: Number(row["cost_usd"] ?? 0),
    result: row["result"] ? (JSON.parse(String(row["result"])) as RunResult) : null,
  };
}
