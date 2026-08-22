import { formatCost, html, join, type Raw } from "../html.js";
import { page } from "./layout.js";

export interface BreakdownRow {
  key: string;
  runs: number;
  verified: number;
  reverted: number;
  costUsd: number;
}

export interface TeamData {
  byRepo: BreakdownRow[];
  byActor: BreakdownRow[];
  summary: { total: number; verified: number; reverted: number; costUsd: number };
}

/**
 * Plano de equipo.
 *
 * Responde a las tres preguntas que hace quien paga: cuanto estamos gastando,
 * que fraccion de eso produjo algo que se pudo enviar, y donde se concentra.
 * Deliberadamente **no** hay ranking de personas por numero de runs: medir
 * actividad individual convierte la herramienta en un instrumento de vigilancia
 * y cambia el comportamiento del equipo antes de que aporte nada.
 */
export function renderTeam(data: TeamData): string {
  const rate = data.summary.total > 0 ? Math.round((data.summary.verified / data.summary.total) * 100) : 0;

  const body = html`
<div class="metrics" style="margin-top:0">
  <div class="metric"><span class="k">Tasa de verificacion</span><span class="v">${rate} %</span></div>
  <div class="metric"><span class="k">Runs</span><span class="v">${data.summary.total}</span></div>
  <div class="metric"><span class="k">Revertidos</span><span class="v">${data.summary.reverted}</span></div>
  <div class="metric"><span class="k">Coste total</span><span class="v">${formatCost(data.summary.costUsd)}</span></div>
  <div class="metric"><span class="k">Coste por verificado</span><span class="v">${
    data.summary.verified > 0 ? formatCost(data.summary.costUsd / data.summary.verified) : "—"
  }</span></div>
</div>

<section>
  <h2>Por repositorio</h2>
  <div class="panel tscroll">${breakdownTable(data.byRepo, "Repositorio")}</div>
</section>

<section>
  <h2>Por persona</h2>
  <div class="panel tscroll">${breakdownTable(data.byActor, "Quien lo lanzo")}</div>
</section>

<p class="subline" style="max-width:60ch">
  El coste por run verificado es la cifra que hay que vigilar: si sube, el agente
  esta gastando en intentos que no llegan a nada, y eso se corrige con mejores
  criterios de aceptacion o con puertas mas rapidas — no con mas presupuesto.
</p>`;

  return page("Equipo — Forge", body);
}

function breakdownTable(rows: BreakdownRow[], label: string): Raw {
  if (rows.length === 0) return html`<div class="empty">Sin datos todavia.</div>`;

  return html`<table>
  <thead>
    <tr>
      <th>${label}</th>
      <th>Runs</th>
      <th>Verificados</th>
      <th>Revertidos</th>
      <th>Tasa</th>
      <th>Coste</th>
      <th>Coste/verificado</th>
    </tr>
  </thead>
  <tbody>
    ${join(
      rows.map((row) => {
        const rate = row.runs > 0 ? Math.round((row.verified / row.runs) * 100) : 0;
        return html`<tr>
      <td class="goal">${row.key}</td>
      <td class="num">${row.runs}</td>
      <td class="num">${row.verified}</td>
      <td class="num">${row.reverted}</td>
      <td class="num">${rate} %</td>
      <td class="num">${formatCost(row.costUsd)}</td>
      <td class="num">${row.verified > 0 ? formatCost(row.costUsd / row.verified) : "—"}</td>
    </tr>`;
      }),
    )}
  </tbody>
</table>`;
}
