import type { RefrendoEvent, GateResult, RunResult } from "@refrendo/core";
import {
  Raw,
  formatCost,
  formatDuration,
  formatTimestamp,
  formatTokens,
  html,
  join,
  raw,
} from "../html.js";
import type { RunRow, StoredEvent } from "../store.js";
import { page } from "./layout.js";

const VERDICT_LABEL: Record<string, string> = {
  running: "En curso",
  verified: "Verificado",
  unverified: "Sin verificar",
  reverted: "Revertido",
  exhausted: "Agotado",
  failed: "Fallido",
};

const VERDICT_MEANING: Record<string, string> = {
  running: "El agente esta trabajando ahora mismo.",
  verified: "Las puertas de calidad del proyecto pasaron. Los cambios estan aplicados.",
  unverified: "El agente termino, pero el proyecto no declara puertas que lo demuestren.",
  reverted: "No se consiguio dejar el arbol en verde. Los cambios se revirtieron enteros.",
  exhausted: "Se agoto el presupuesto o las iteraciones antes de terminar.",
  failed: "El run murio por un error no recuperable.",
};

/**
 * La pagina del run: el recibo.
 *
 * Es lo que un revisor abre en lugar de leer un diff a ciegas. El orden no es
 * cronologico sino de confianza: primero el veredicto y la evidencia que lo
 * sostiene, despues lo que cambio, y solo al final el detalle de como se llego
 * ahi. Quien confia en el veredicto no baja; quien no, tiene todo para auditar.
 */
export function renderRecord(run: RunRow, events: StoredEvent[]): string {
  const result = run.result;
  const live = run.status === "running";

  const body = html`
${verdictBlock(run, live)}
${metricsBlock(run, result, events)}
${result?.summary ? section("Resumen del agente", html`<div class="panel"><div class="empty" style="color:var(--ink)">${result.summary}</div></div>`) : ""}
${gatesSection(result, events)}
${repairSection(events)}
${changesSection(result)}
${planSection(result, events)}
${traceSection(events, live)}
${live ? liveScript(run.id) : ""}
`;

  return page(`${VERDICT_LABEL[run.status] ?? run.status} — ${run.goal.slice(0, 60)}`, body);
}

function verdictBlock(run: RunRow, live: boolean): Raw {
  const label = VERDICT_LABEL[run.status] ?? run.status;
  return html`<div class="verdict">
  <span class="badge ${run.status}" id="verdict">${live ? raw('<span class="live-dot"></span>') : ""}${label}</span>
  <div style="flex:1 1 22rem">
    <h1>${run.goal}</h1>
    <p class="subline">
      <span>${run.repo}</span>
      ${run.actor ? html`<span>${run.actor}</span>` : ""}
      <span>${formatTimestamp(run.createdAt)}</span>
      ${run.model ? html`<span>${run.model}</span>` : ""}
    </p>
  </div>
</div>
<p style="color:var(--muted);margin:0 0 .5rem;max-width:62ch" id="verdict-meaning">${VERDICT_MEANING[run.status] ?? ""}</p>`;
}

function metricsBlock(run: RunRow, result: RunResult | null, events: StoredEvent[]): Raw {
  // Mientras el run vive no hay resultado: el consumo se toma del ultimo evento.
  const usage =
    result?.usage ??
    lastOfType(events, "usage_updated")?.usage ?? {
      costUsd: run.costUsd,
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      requests: 0,
    };

  const metrics: Array<[string, string]> = [
    ["Coste", formatCost(usage.costUsd)],
    ["Duracion", result ? formatDuration(result.durationMs) : "—"],
    ["Peticiones", String(usage.requests)],
    ["Tokens ent.", formatTokens(usage.inputTokens)],
    ["De cache", formatTokens(usage.cacheReadTokens)],
    ["Tokens sal.", formatTokens(usage.outputTokens)],
    ["Reparaciones", result ? String(result.repairAttempts) : "—"],
  ];

  return html`<div class="metrics">
  ${join(metrics.map(([k, v]) => html`<div class="metric"><span class="k">${k}</span><span class="v">${v}</span></div>`))}
</div>`;
}

function gatesSection(result: RunResult | null, events: StoredEvent[]): Raw {
  // Si el run sigue vivo, las puertas ya ejecutadas estan en la traza.
  const gates: GateResult[] =
    result?.verification?.gates ??
    events
      .map((entry) => entry.event)
      .filter((event): event is Extract<RefrendoEvent, { type: "gate_completed" }> => event.type === "gate_completed")
      .map((event) => event.gate);

  if (gates.length === 0) {
    return section(
      "Evidencia",
      html`<div class="panel"><div class="empty">
        Este proyecto no declara puertas de verificacion, asi que no hay nada que demuestre el
        resultado automaticamente. Anade scripts de <code>typecheck</code>, <code>test</code> o
        <code>lint</code> a su <code>package.json</code>.
      </div></div>`,
    );
  }

  return section(
    "Evidencia — puertas ejecutadas",
    html`<div class="panel">${join(gates.map(renderGate))}</div>`,
  );
}

function renderGate(gate: GateResult): Raw {
  return html`<div class="gate">
  <div class="gate-head">
    <span class="mark ${gate.passed ? "ok" : "ko"}">${gate.passed ? "✓" : "✗"}</span>
    <span class="gate-name">${gate.name}</span>
    <code class="gate-cmd">${gate.command}</code>
    <span class="gate-meta">exit ${gate.exitCode ?? "—"} · ${formatDuration(gate.durationMs)}</span>
  </div>
  ${gate.passed || !gate.output ? "" : html`<pre class="gate-out">${gate.output}</pre>`}
</div>`;
}

interface VerificationRound {
  gates: GateResult[];
  passed: boolean | null;
}

/** Reconstruye las rondas de verificacion a partir de la traza. */
export function verificationRounds(events: StoredEvent[]): VerificationRound[] {
  const rounds: VerificationRound[] = [];
  let current: VerificationRound | null = null;

  for (const { event } of events) {
    if (event.type === "verification_started") {
      current = { gates: [], passed: null };
      rounds.push(current);
    } else if (event.type === "gate_completed" && current) {
      current.gates.push(event.gate);
    } else if (event.type === "verification_completed" && current) {
      current.passed = event.passed;
      current = null;
    }
  }
  return rounds;
}

/**
 * Lo que fallo por el camino y como se arreglo.
 *
 * La seccion de evidencia solo muestra el veredicto final, y eso deja fuera la
 * parte que de verdad demuestra que el sistema funciona: el agente se equivoco,
 * una puerta lo caza con su salida literal, y el siguiente intento pasa. Quien
 * audita necesita ver ese ciclo; quien evalua comprar el producto, tambien.
 */
function repairSection(events: StoredEvent[]): Raw {
  const failed = verificationRounds(events).filter((round) => round.passed === false);
  if (failed.length === 0) return raw("");

  return section(
    `Lo que fallo por el camino — ${failed.length} ciclo(s) de reparacion`,
    html`<div class="panel">${join(
      failed.map((round, index) => {
        const failing = round.gates.filter((gate) => !gate.passed);
        return html`<div class="gate">
        <div class="gate-head">
          <span class="mark ko">✗</span>
          <span class="gate-name">Intento ${index + 1}</span>
          <span class="gate-cmd">${failing.map((gate) => gate.name).join(", ") || "sin detalle"}</span>
          <span class="gate-meta">corregido en la siguiente iteracion</span>
        </div>
        ${join(
          failing
            .filter((gate) => gate.output)
            .map((gate) => html`<pre class="gate-out">${gate.output}</pre>`),
        )}
      </div>`;
      }),
    )}</div>`,
  );
}

function changesSection(result: RunResult | null): Raw {
  const changes = result?.changes ?? [];
  if (changes.length === 0) {
    return section(
      "Cambios",
      html`<div class="panel"><div class="empty">Ningun fichero quedo modificado.</div></div>`,
    );
  }

  const totalAdded = changes.reduce((sum, change) => sum + change.linesAdded, 0);
  const totalRemoved = changes.reduce((sum, change) => sum + change.linesRemoved, 0);

  return section(
    `Cambios — ${changes.length} fichero(s), +${totalAdded}/−${totalRemoved}`,
    html`<div class="panel">${join(
      changes.map(
        (change) => html`<div class="change">
      <span class="kind">${change.kind === "created" ? "nuevo" : change.kind === "deleted" ? "borrado" : "editado"}</span>
      <span class="path">${change.path}</span>
      <span class="delta"><span class="plus">+${change.linesAdded}</span> <span class="minus">−${change.linesRemoved}</span></span>
    </div>`,
      ),
    )}</div>`,
  );
}

function planSection(result: RunResult | null, events: StoredEvent[]): Raw {
  const plan = result?.plan ?? lastOfType(events, "plan_ready")?.plan ?? null;
  if (!plan) return raw("");

  return section(
    "Plan aprobado",
    html`<div class="panel">
    <div class="step"><span class="n"></span><span class="d">${plan.summary}</span></div>
    ${join(
      plan.steps.map(
        (step) => html`<div class="step">
        <span class="n">${step.id}</span>
        <span class="d">${step.description}</span>
        ${step.files.length > 0 ? html`<span class="f">${step.files.join(" · ")}</span>` : ""}
      </div>`,
      ),
    )}
  </div>`,
  );
}

function traceSection(events: StoredEvent[], live: boolean): Raw {
  const lines = events.map(renderEvent).filter((line): line is Raw => line !== null);

  return section(
    "Traza completa",
    html`<div class="panel trace" id="trace">${
      lines.length > 0 ? join(lines) : html`<div class="empty">Sin eventos todavia.</div>`
    }</div>
    ${live ? html`<p class="subline" style="margin-top:.6rem"><span class="live-dot"></span>Siguiendo en directo</p>` : ""}`,
  );
}

/** Traduce un evento a una linea legible. Devuelve `null` para los que solo hacen ruido. */
export function renderEvent(entry: StoredEvent): Raw | null {
  const time = formatTimestamp(entry.at).slice(11);
  const event = entry.event;

  const line = (cssClass: string, content: Raw): Raw =>
    html`<div class="ev ${cssClass}"><span class="t">${time}</span><span class="m">${content}</span></div>`;

  switch (event.type) {
    case "phase_started":
      return line("phase", html`${phaseLabel(event.phase)}`);
    case "plan_ready":
      return line("", html`Plan entregado: ${event.plan.steps.length} paso(s)`);
    case "tool_requested":
      return line("", html`<code>${event.name}</code> ${describeInput(event.input)}`);
    case "tool_completed":
      return line(event.ok ? "" : "bad", html`${event.ok ? "✓" : "✗"} ${event.summary}`);
    case "approval_requested":
      return line("warn", html`Aprobacion solicitada: <code>${event.detail}</code>`);
    case "approval_resolved":
      return line(event.approved ? "good" : "bad", html`Aprobacion ${event.approved ? "concedida" : "denegada"}`);
    case "file_changed":
      return line(
        "",
        html`± ${event.change.path} <span class="plus">+${event.change.linesAdded}</span> <span class="minus">−${event.change.linesRemoved}</span>`,
      );
    case "verification_started":
      return line("", html`Verificando: ${event.gates.join(", ") || "(sin puertas)"}`);
    case "gate_completed":
      return line(
        event.gate.passed ? "good" : "bad",
        html`${event.gate.passed ? "✓" : "✗"} ${event.gate.name} (exit ${event.gate.exitCode ?? "—"})`,
      );
    case "verification_completed":
      return line(event.passed ? "good" : "bad", html`Verificacion ${event.passed ? "en verde" : "en rojo"}`);
    case "repair_started":
      return line("warn", html`Reparando ${event.attempt}/${event.max}: ${event.failing.join(", ")}`);
    case "rollback_started":
      return line("bad", html`Revirtiendo — ${event.reason}`);
    case "warning":
      return line("warn", html`${event.message}`);
    case "run_finished":
      return line(
        event.result.status === "verified" ? "good" : "bad",
        html`Run terminado: ${VERDICT_LABEL[event.result.status] ?? event.result.status}`,
      );
    case "run_started":
      return line("phase", html`Run iniciado`);
    // El texto y el razonamiento en streaming llegan troceados: en la traza
    // persistida solo aportarian miles de lineas de una palabra.
    default:
      return null;
  }
}

function phaseLabel(phase: string): string {
  const labels: Record<string, string> = {
    plan: "PLANIFICAR",
    execute: "EJECUTAR",
    verify: "VERIFICAR",
    repair: "REPARAR",
    finalize: "CERRAR",
  };
  return labels[phase] ?? phase.toUpperCase();
}

function describeInput(input: unknown): string {
  if (!input || typeof input !== "object") return "";
  const record = input as Record<string, unknown>;
  for (const key of ["path", "command", "pattern"]) {
    const value = record[key];
    if (typeof value === "string") return value.length > 90 ? `${value.slice(0, 90)}…` : value;
  }
  return "";
}

function lastOfType<T extends RefrendoEvent["type"]>(
  events: StoredEvent[],
  type: T,
): Extract<RefrendoEvent, { type: T }> | null {
  for (let i = events.length - 1; i >= 0; i--) {
    const event = events[i]!.event;
    if (event.type === type) return event as Extract<RefrendoEvent, { type: T }>;
  }
  return null;
}

function section(title: string, content: Raw | string): Raw {
  return html`<section><h2>${title}</h2>${content}</section>`;
}

/**
 * Sigue el run en directo.
 *
 * Se reanuda por `Last-Event-ID`, asi que una reconexion no repite ni se salta
 * eventos. Al terminar recarga una vez para pintar el veredicto y las metricas
 * finales, que vienen del resultado y no de la traza.
 */
function liveScript(runId: string): Raw {
  return raw(`<script>
(function () {
  var trace = document.getElementById("trace");
  if (!trace) return;
  var source = new EventSource("/api/runs/${runId}/stream");
  source.addEventListener("refrendo", function (message) {
    var payload = JSON.parse(message.data);
    if (payload.html) {
      var empty = trace.querySelector(".empty");
      if (empty) empty.remove();
      trace.insertAdjacentHTML("beforeend", payload.html);
      trace.scrollTop = trace.scrollHeight;
    }
  });
  source.addEventListener("end", function () {
    source.close();
    setTimeout(function () { location.reload(); }, 400);
  });
})();
</script>`);
}
