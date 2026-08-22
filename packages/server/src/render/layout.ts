import { Raw, html, raw } from "../html.js";

/**
 * Identidad visual compartida por el servidor.
 *
 * Es la misma familia tipografica y la misma paleta que el resto del producto:
 * la pagina de un run se comparte fuera del equipo que lo lanzo, asi que es
 * material de marca tanto como interfaz.
 */
const STYLES = `
:root {
  --ground: #F2F5F6;
  --surface: #FFFFFF;
  --sunk: #E8EEEF;
  --ink: #0F171B;
  --muted: #566A74;
  --rule: #CFDADE;
  --accent: #0C6C69;
  --accent-soft: #DBEBEA;
  --pass: #1C7146;
  --pass-soft: #DCEFE4;
  --fail: #A8382C;
  --fail-soft: #F7E2DF;
  --warn: #8C6414;
  --warn-soft: #F6EDD8;
  --display: "IBM Plex Sans Condensed", "Helvetica Neue", Arial, sans-serif;
  --body: "IBM Plex Sans", -apple-system, "Segoe UI", Roboto, sans-serif;
  --data: "IBM Plex Mono", "SFMono-Regular", Consolas, monospace;
}

@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    --ground: #0A1013; --surface: #121A1E; --sunk: #0E1519;
    --ink: #E4EDF0; --muted: #90A5AE; --rule: #24323A;
    --accent: #45B8AE; --accent-soft: #16302F;
    --pass: #52C088; --pass-soft: #12291E;
    --fail: #E88375; --fail-soft: #2C1613;
    --warn: #D6A741; --warn-soft: #2A2110;
  }
}
:root[data-theme="dark"] {
  --ground: #0A1013; --surface: #121A1E; --sunk: #0E1519;
  --ink: #E4EDF0; --muted: #90A5AE; --rule: #24323A;
  --accent: #45B8AE; --accent-soft: #16302F;
  --pass: #52C088; --pass-soft: #12291E;
  --fail: #E88375; --fail-soft: #2C1613;
  --warn: #D6A741; --warn-soft: #2A2110;
}

* { box-sizing: border-box; }

body {
  margin: 0;
  background: var(--ground);
  color: var(--ink);
  font-family: var(--body);
  font-size: 15px;
  line-height: 1.55;
  -webkit-font-smoothing: antialiased;
}

.wrap { max-width: 68rem; margin: 0 auto; padding: 0 1.5rem 5rem; }

a { color: var(--accent); text-underline-offset: .18em; }
a:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; border-radius: 2px; }

/* --- cabecera --- */
.top {
  display: flex; align-items: center; justify-content: space-between;
  gap: 1rem; flex-wrap: wrap;
  padding: 1.15rem 0; border-bottom: 1px solid var(--rule); margin-bottom: 2rem;
}
.brand {
  font-family: var(--display); font-weight: 700; font-size: 1.15rem;
  letter-spacing: -.01em; text-decoration: none; color: var(--ink);
}
.brand span { color: var(--accent); }
.top nav { display: flex; gap: 1.25rem; font-family: var(--data); font-size: .78rem; }

/* --- veredicto --- */
.verdict { display: flex; align-items: flex-start; gap: 1.25rem; flex-wrap: wrap; margin-bottom: 1.5rem; }
.badge {
  font-family: var(--data); font-size: .78rem; font-weight: 600;
  letter-spacing: .12em; text-transform: uppercase;
  padding: .5rem .85rem; border: 1px solid currentColor; white-space: nowrap;
}
.badge.verified  { color: var(--pass); background: var(--pass-soft); }
.badge.unverified{ color: var(--warn); background: var(--warn-soft); }
.badge.reverted, .badge.failed { color: var(--fail); background: var(--fail-soft); }
.badge.exhausted { color: var(--warn); background: var(--warn-soft); }
.badge.running   { color: var(--accent); background: var(--accent-soft); }

h1 {
  font-family: var(--display); font-weight: 600;
  font-size: clamp(1.5rem, 4vw, 2.15rem); line-height: 1.15;
  letter-spacing: -.015em; margin: 0 0 .4rem; text-wrap: balance; flex: 1 1 22rem;
}
.subline { font-family: var(--data); font-size: .78rem; color: var(--muted); margin: 0; }
.subline span + span::before { content: "·"; margin: 0 .5rem; }

/* --- metricas --- */
.metrics {
  display: grid; grid-template-columns: repeat(auto-fit, minmax(8.5rem, 1fr));
  gap: 1px; background: var(--rule); border: 1px solid var(--rule); margin: 1.75rem 0 2.5rem;
}
.metric { background: var(--surface); padding: .85rem 1rem; }
.metric .k {
  font-family: var(--data); font-size: .66rem; letter-spacing: .1em;
  text-transform: uppercase; color: var(--muted); display: block; margin-bottom: .3rem;
}
.metric .v {
  font-family: var(--display); font-weight: 600; font-size: 1.4rem;
  font-variant-numeric: tabular-nums; line-height: 1;
}

/* --- secciones --- */
section { margin-bottom: 2.75rem; }
h2 {
  font-family: var(--data); font-size: .74rem; font-weight: 600;
  letter-spacing: .12em; text-transform: uppercase; color: var(--muted);
  margin: 0 0 .9rem; padding-bottom: .5rem; border-bottom: 1px solid var(--rule);
}
.panel { background: var(--surface); border: 1px solid var(--rule); }

/* --- puertas --- */
.gate { border-bottom: 1px solid var(--rule); }
.gate:last-child { border-bottom: none; }
.gate-head {
  display: flex; align-items: center; gap: .85rem; padding: .85rem 1.1rem; flex-wrap: wrap;
}
.mark { font-weight: 700; font-size: 1.05rem; width: 1.1rem; text-align: center; }
.mark.ok { color: var(--pass); }
.mark.ko { color: var(--fail); }
.gate-name { font-family: var(--display); font-weight: 600; font-size: 1.02rem; }
.gate-cmd {
  font-family: var(--data); font-size: .76rem; color: var(--muted);
  background: var(--sunk); padding: .15rem .45rem; overflow-wrap: anywhere;
}
.gate-meta { font-family: var(--data); font-size: .72rem; color: var(--muted); margin-left: auto; white-space: nowrap; }
.gate-out {
  margin: 0; padding: .9rem 1.1rem; background: var(--sunk);
  border-top: 1px solid var(--rule);
  font-family: var(--data); font-size: .76rem; line-height: 1.5;
  white-space: pre-wrap; overflow-wrap: anywhere; max-height: 22rem; overflow-y: auto;
}

/* --- cambios --- */
.change {
  display: flex; align-items: center; gap: .85rem;
  padding: .6rem 1.1rem; border-bottom: 1px solid var(--rule); flex-wrap: wrap;
}
.change:last-child { border-bottom: none; }
.change .path { font-family: var(--data); font-size: .82rem; overflow-wrap: anywhere; }
.change .kind {
  font-family: var(--data); font-size: .64rem; letter-spacing: .08em; text-transform: uppercase;
  color: var(--muted); border: 1px solid var(--rule); padding: .1rem .4rem;
}
.change .delta { font-family: var(--data); font-size: .78rem; margin-left: auto; font-variant-numeric: tabular-nums; white-space: nowrap; }
.plus { color: var(--pass); }
.minus { color: var(--fail); }

/* --- plan --- */
.step { padding: .85rem 1.1rem; border-bottom: 1px solid var(--rule); display: grid; grid-template-columns: 1.75rem 1fr; gap: .25rem .75rem; }
.step:last-child { border-bottom: none; }
.step .n { font-family: var(--data); font-size: .8rem; color: var(--muted); font-variant-numeric: tabular-nums; }
.step .d { font-weight: 600; }
.step .f { grid-column: 2; font-family: var(--data); font-size: .74rem; color: var(--muted); overflow-wrap: anywhere; }

/* --- traza --- */
.trace { max-height: 34rem; overflow-y: auto; }
.ev {
  display: grid; grid-template-columns: 5.5rem 1fr; gap: .75rem;
  padding: .3rem 1.1rem; font-size: .82rem; border-bottom: 1px solid transparent;
}
.ev:hover { background: var(--sunk); }
.ev .t { font-family: var(--data); font-size: .7rem; color: var(--muted); font-variant-numeric: tabular-nums; }
.ev .m { overflow-wrap: anywhere; }
.ev .m code { font-family: var(--data); font-size: .78rem; background: var(--sunk); padding: .05rem .3rem; }
.ev.phase { background: var(--accent-soft); font-family: var(--display); font-weight: 600; letter-spacing: .02em; }
.ev.bad .m { color: var(--fail); }
.ev.good .m { color: var(--pass); }
.ev.warn .m { color: var(--warn); }

.empty { padding: 1.5rem 1.1rem; color: var(--muted); font-size: .9rem; }

/* --- listado --- */
table { border-collapse: collapse; width: 100%; font-size: .88rem; }
th, td { text-align: left; padding: .7rem 1.1rem; border-bottom: 1px solid var(--rule); }
th {
  font-family: var(--data); font-size: .66rem; letter-spacing: .1em; text-transform: uppercase;
  color: var(--muted); background: var(--sunk); white-space: nowrap;
}
tbody tr:last-child td { border-bottom: none; }
tbody tr:hover { background: var(--sunk); }
td.goal { font-weight: 600; }
td.goal a { text-decoration: none; color: inherit; }
td.goal a:hover { color: var(--accent); }
.num { font-family: var(--data); font-variant-numeric: tabular-nums; white-space: nowrap; }
.tscroll { overflow-x: auto; }

.live-dot {
  display: inline-block; width: .5rem; height: .5rem; border-radius: 50%;
  background: var(--accent); margin-right: .4rem; animation: pulse 1.6s ease-in-out infinite;
}
@keyframes pulse { 0%,100% { opacity: 1 } 50% { opacity: .25 } }
@media (prefers-reduced-motion: reduce) { .live-dot { animation: none } }
`;

export function page(title: string, body: Raw): string {
  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title.replace(/[<>&]/g, "")}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&family=IBM+Plex+Sans+Condensed:wght@600;700&family=IBM+Plex+Sans:wght@400;600&display=swap">
<style>${STYLES}</style>
</head>
<body>
<div class="wrap">
${header().value}
${body.value}
</div>
</body>
</html>`;
}

function header(): Raw {
  return html`<div class="top">
  <a class="brand" href="/">refrendo<span>.</span></a>
  <nav>
    <a href="/">Runs</a>
    <a href="/team">Equipo</a>
  </nav>
</div>`;
}

export { raw };
