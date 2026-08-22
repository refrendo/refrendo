/**
 * Plantillas HTML con escapado por defecto.
 *
 * La pagina del run muestra la salida literal de comandos de shell: stack
 * traces, diffs, mensajes de compilador. Todo eso es texto no confiable que
 * acaba en una pagina que se comparte por enlace. El escapado tiene que ser lo
 * que ocurre si no haces nada, no algo que haya que acordarse de llamar.
 */

const ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

export function escapeHtml(value: unknown): string {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ESCAPES[char] ?? char);
}

/** Marca contenido ya seguro para que no se vuelva a escapar. */
export class Raw {
  constructor(readonly value: string) {}
  toString(): string {
    return this.value;
  }
}

export function raw(value: string): Raw {
  return new Raw(value);
}

function interpolate(value: unknown): string {
  if (value instanceof Raw) return value.value;
  if (Array.isArray(value)) return value.map(interpolate).join("");
  if (value === null || value === undefined || value === false) return "";
  return escapeHtml(value);
}

/** Interpola escapando todo lo que no venga envuelto en `raw()`. */
export function html(strings: TemplateStringsArray, ...values: unknown[]): Raw {
  let out = strings[0] ?? "";
  for (let i = 0; i < values.length; i++) {
    out += interpolate(values[i]) + (strings[i + 1] ?? "");
  }
  return new Raw(out);
}

/** Une fragmentos ya construidos sin volver a escaparlos. */
export function join(parts: Array<Raw | string>, separator = ""): Raw {
  return new Raw(parts.map((part) => (part instanceof Raw ? part.value : escapeHtml(part))).join(separator));
}

export function formatCost(usd: number): string {
  return `$${usd.toFixed(4)}`;
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`;
  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.round((ms % 60_000) / 1000);
  return `${minutes} min ${seconds} s`;
}

export function formatTokens(value: number): string {
  if (value < 1000) return String(value);
  if (value < 1_000_000) return `${(value / 1000).toFixed(1)}k`;
  return `${(value / 1_000_000).toFixed(2)}M`;
}

/** Fecha corta y estable, sin depender del locale del servidor. */
export function formatTimestamp(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
