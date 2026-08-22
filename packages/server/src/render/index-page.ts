import { formatCost, formatTimestamp, html, join } from "../html.js";
import type { RunRow } from "../store.js";
import { page } from "./layout.js";

const VERDICT_LABEL: Record<string, string> = {
  running: "En curso",
  verified: "Verificado",
  unverified: "Sin verificar",
  reverted: "Revertido",
  exhausted: "Agotado",
  failed: "Fallido",
};

export interface IndexSummary {
  total: number;
  verified: number;
  reverted: number;
  costUsd: number;
}

/**
 * Listado de runs.
 *
 * La metrica que encabeza la pagina es la tasa de verificacion, no el numero de
 * runs: es la unica que dice si el agente esta aportando algo, y es la que se
 * factura. Contar runs mediria actividad; esto mide resultado.
 */
export function renderIndex(runs: RunRow[], summary: IndexSummary): string {
  const rate = summary.total > 0 ? Math.round((summary.verified / summary.total) * 100) : 0;

  const body = html`
<div class="metrics" style="margin-top:0">
  <div class="metric"><span class="k">Tasa de verificacion</span><span class="v">${rate} %</span></div>
  <div class="metric"><span class="k">Runs</span><span class="v">${summary.total}</span></div>
  <div class="metric"><span class="k">Verificados</span><span class="v">${summary.verified}</span></div>
  <div class="metric"><span class="k">Revertidos</span><span class="v">${summary.reverted}</span></div>
  <div class="metric"><span class="k">Coste total</span><span class="v">${formatCost(summary.costUsd)}</span></div>
</div>

<section>
  <h2>Runs recientes</h2>
  <div class="panel tscroll">
    ${runs.length === 0 ? html`<div class="empty">Todavia no hay runs. Lanza uno con <code>refrendo run</code> o por la API.</div>` : runsTable(runs)}
  </div>
</section>`;

  return page("Runs — Refrendo", body);
}

function runsTable(runs: RunRow[]) {
  return html`<table>
  <thead>
    <tr>
      <th>Estado</th>
      <th>Objetivo</th>
      <th>Repositorio</th>
      <th>Quien</th>
      <th>Coste</th>
      <th>Cuando</th>
    </tr>
  </thead>
  <tbody>
    ${join(
      runs.map(
        (run) => html`<tr>
      <td><span class="badge ${run.status}" style="font-size:.66rem;padding:.25rem .5rem">${VERDICT_LABEL[run.status] ?? run.status}</span></td>
      <td class="goal"><a href="/r/${run.id}">${run.goal}</a></td>
      <td class="num">${run.repo}</td>
      <td class="num">${run.actor ?? "—"}</td>
      <td class="num">${formatCost(run.costUsd)}</td>
      <td class="num">${formatTimestamp(run.createdAt)}</td>
    </tr>`,
      ),
    )}
  </tbody>
</table>`;
}
