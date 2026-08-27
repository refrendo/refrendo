#!/usr/bin/env node
/**
 * Auditor del sistema de control del agente.
 *
 * Comprueba la coherencia estructural de DECISIONS.md. Es lo unico de todo el
 * sistema que no depende de que Claude se porte bien: corre en CI, sin que nadie
 * lo invoque, y rompe el build.
 *
 * Lo que NO puede hacer, y conviene no olvidarlo: no detecta suposiciones
 * semanticas. Una decision puede estar perfectamente formada y ser falsa. El
 * auditor mira la forma del registro, no la verdad de lo registrado.
 *
 * Uso:
 *   node scripts/auditar-control.mjs            estructura + ficheros locales
 *   node scripts/auditar-control.mjs --con-red  ademas, las que consultan la red
 */

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CON_RED = process.argv.includes("--con-red");

const ESTADOS = ["DECIDIDO", "PROPUESTO", "DESCONOCIDO", "DESCARTADO", "REEMPLAZADO"];
const ORIGENES = ["USUARIO", "CLAUDE", "REPOSITORIO", "VERIFICACIÓN"];
const FUENTES = ["commit", "documentación", "comando", "conversación", "UNVERIFIED"];
const OBLIGATORIOS = [
  "ESTADO", "FECHA_DECISION", "FECHA_REGISTRO", "FECHA_FUENTE", "FECHA_REF",
  "ORIGEN", "ORIGEN_REF", "ORIGEN_VERIFICABLE",
  "MOTIVO", "IMPACTO", "CHECK",
];

const errores = [];
const avisos = [];
const pasadas = [];
const err = (m) => errores.push(m);
const avi = (m) => avisos.push(m);
const ok = (m) => pasadas.push(m);

/* ------------------------------------------------------------------ *
 * CHECKS: lista cerrada.
 *
 * Ningun texto de DECISIONS.md llega nunca a un shell. El fichero solo
 * puede nombrar una clave de este objeto; un nombre que no este aqui es
 * un error, no una invitacion a ejecutarlo.
 * ------------------------------------------------------------------ */
const CHECKS = {
  "n/a": { red: false, fn: () => ({ ok: true, detalle: "sin comprobación automatizable" }) },

  "stack-typescript": {
    red: false,
    fn: () => {
      const pkg = leerJson("package.json");
      const tsc = existsSync(path.join(RAIZ, "tsconfig.json"));
      const vitest = JSON.stringify(pkg?.devDependencies ?? {}).includes("vitest");
      return { ok: tsc && vitest, detalle: `tsconfig.json=${tsc} vitest=${vitest}` };
    },
  },

  "verify-existe": {
    red: false,
    fn: () => {
      const f = "packages/core/src/verify.ts";
      const hay = existsSync(path.join(RAIZ, f));
      const detecta = hay && readFileSync(path.join(RAIZ, f), "utf8").includes("detectGates");
      return { ok: detecta, detalle: `${f} con detectGates = ${detecta}` };
    },
  },

  "licencia-apache": {
    red: false,
    fn: () => {
      const f = path.join(RAIZ, "LICENSE");
      if (!existsSync(f)) return { ok: false, detalle: "no existe LICENSE" };
      const apache = readFileSync(f, "utf8").includes("Apache License");
      return { ok: apache, detalle: `LICENSE contiene "Apache License" = ${apache}` };
    },
  },

  "accion-en-ingles": {
    red: false,
    fn: () => {
      const f = path.join(RAIZ, "action.yml");
      if (!existsSync(f)) return { ok: false, detalle: "no existe action.yml" };
      const t = readFileSync(f, "utf8");
      const d = /description:\s*"([^"]+)"/.exec(t)?.[1] ?? "";
      // Marcador barato pero suficiente: la descripcion del catalogo esta en ingles.
      return { ok: /\b(the|your|only|if)\b/i.test(d), detalle: `description = "${d.slice(0, 60)}..."` };
    },
  },

  "assets-marca": {
    red: false,
    fn: () => {
      const faltan = ["docs/logo.svg", "docs/favicon.svg", "docs/og.png"]
        .filter((f) => !existsSync(path.join(RAIZ, f)));
      return { ok: faltan.length === 0, detalle: faltan.length ? `faltan ${faltan.join(", ")}` : "los 3 presentes" };
    },
  },

  "precio-en-web": {
    red: false,
    fn: () => {
      const f = path.join(RAIZ, "docs/index.html");
      if (!existsSync(f)) return { ok: false, detalle: "no existe docs/index.html" };
      const t = readFileSync(f, "utf8");
      const hay = t.includes("89") && /1[.,]20/.test(t);
      return { ok: hay, detalle: `89 y 1,20 presentes en la web = ${hay}` };
    },
  },

  "github-pages-dns": {
    red: true,
    fn: () => {
      const salida = dns("A", "refrendo.dev");
      const n = (salida.match(/185\.199\.1(08|09|10|11)\.153/g) ?? []).length;
      return { ok: n === 4, detalle: `${n} registros A de GitHub Pages (esperados 4)` };
    },
  },

  "correo-sin-configurar": {
    red: true,
    fn: () => {
      // Comprueba que DEC-012 sigue sin resolverse. Si algun dia aparece un MX,
      // esta comprobacion falla a proposito: el fichero se habra quedado atras.
      const salida = dns("MX", "refrendo.dev");
      const n = (salida.match(/mail exchanger/gi) ?? []).length;
      return { ok: n === 0, detalle: `${n} registros MX (DEC-012 dice DESCONOCIDO; si hay MX, actualiza la decisión)` };
    },
  },
};

function leerJson(rel) {
  try {
    return JSON.parse(readFileSync(path.join(RAIZ, rel), "utf8"));
  } catch {
    return null;
  }
}

/** nslookup con argumentos fijos. El dominio no viene de DECISIONS.md. */
function dns(tipo, dominio) {
  try {
    return execFileSync("nslookup", [`-type=${tipo}`, dominio, "8.8.8.8"], {
      encoding: "utf8",
      timeout: 20_000,
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch {
    return "";
  }
}

/** Fecha de un commit. El sha se valida antes; nunca se interpola texto libre. */
function fechaDeCommit(sha) {
  if (!/^[0-9a-f]{7,40}$/i.test(sha)) return null;
  try {
    return execFileSync("git", ["show", "-s", "--format=%ad", "--date=short", sha], {
      cwd: RAIZ,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ *
 * Parseo
 * ------------------------------------------------------------------ */
function parsear(crudo) {
  // Normaliza CRLF antes de nada. Un fichero de control editado en Windows los
  // lleva, y `(.*)$` en JS no cruza un CR: sin esto el parser ve las lineas
  // pero no encuentra ni un solo campo, y el auditor acaba culpando al fichero
  // de un fallo que es suyo.
  const texto = crudo.split("\r\n").join("\n").split("\r").join("\n");
  const decisiones = [];
  const trozos = texto.split(/^## (?=DEC-)/m).slice(1);
  for (const trozo of trozos) {
    const cabecera = trozo.split("\n")[0];
    const id = /^(DEC-\d{3})/.exec(cabecera)?.[1] ?? null;
    const campos = {};
    for (const linea of trozo.split("\n")) {
      const m = /^([A-ZÁÉÍÓÚ_]+):\s*(.*)$/.exec(linea);
      if (m && !campos[m[1]]) campos[m[1]] = m[2].trim();
    }
    decisiones.push({
      id,
      titulo: cabecera.replace(/^DEC-\d{3}\s*—\s*/, "").trim(),
      campos,
      historial: /^HISTORIAL:/m.test(trozo),
      crudo: trozo,
    });
  }
  return decisiones;
}

/* ------------------------------------------------------------------ *
 * Comprobaciones
 * ------------------------------------------------------------------ */
function auditar(ficheroDecisiones = "DECISIONS.md", ficheroReglas = "CLAUDE.md") {
  // 1. Ficheros requeridos
  for (const f of [ficheroReglas, ficheroDecisiones]) {
    if (!existsSync(path.join(RAIZ, f))) return err(`falta el fichero requerido ${f}`);
  }
  ok("los ficheros de control existen");

  const texto = readFileSync(path.join(RAIZ, ficheroDecisiones), "utf8");
  const decisiones = parsear(texto);
  if (decisiones.length === 0) return err(`${ficheroDecisiones} no contiene ninguna decisión`);
  ok(`${decisiones.length} decisiones parseadas`);

  const vistos = new Map();

  for (const d of decisiones) {
    const donde = d.id ?? "(sin id)";

    // 2. ID valido y unico
    if (!d.id) { err(`cabecera sin ID válido: "${d.titulo.slice(0, 40)}"`); continue; }
    if (vistos.has(d.id)) err(`${d.id}: ID duplicado`);
    vistos.set(d.id, d);

    // 3. Campos obligatorios
    for (const campo of OBLIGATORIOS) {
      if (!d.campos[campo]) err(`${donde}: falta el campo obligatorio ${campo}`);
    }

    const estado = d.campos["ESTADO"];
    const fuente = d.campos["FECHA_FUENTE"];
    const origen = d.campos["ORIGEN"];
    const verificable = d.campos["ORIGEN_VERIFICABLE"];
    const check = d.campos["CHECK"];

    // 4. Vocabulario de estados
    if (estado && !ESTADOS.includes(estado)) {
      err(`${donde}: ESTADO "${estado}" fuera del vocabulario (${ESTADOS.join(", ")})`);
    }
    if (origen && !ORIGENES.includes(origen)) {
      err(`${donde}: ORIGEN "${origen}" fuera del vocabulario (${ORIGENES.join(", ")})`);
    }
    if (verificable && !["SI", "NO"].includes(verificable)) {
      err(`${donde}: ORIGEN_VERIFICABLE debe ser SI o NO, no "${verificable}"`);
    }

    // 5. Fechas. Se separan dos cosas que no son la misma:
    //      FECHA_DECISION  cuando el usuario decidio
    //      FECHA_REGISTRO  cuando quedo escrito en el repositorio
    //    Un commit demuestra lo segundo y NUNCA lo primero. Presentar un
    //    registro como decision es fortalecer la evidencia por encima de lo
    //    que sostiene, y es exactamente el error que este bloque impide.
    const fDecision = d.campos["FECHA_DECISION"];
    const fRegistro = d.campos["FECHA_REGISTRO"];
    const esISO = (v) => /^\d{4}-\d{2}-\d{2}$/.test(v ?? "");

    if (fuente && !FUENTES.includes(fuente)) {
      err(`${donde}: FECHA_FUENTE "${fuente}" no es válida (${FUENTES.join("/")})`);
    }
    for (const [campo, valor] of [["FECHA_DECISION", fDecision], ["FECHA_REGISTRO", fRegistro]]) {
      if (valor && !esISO(valor) && valor !== "UNVERIFIED") {
        err(`${donde}: ${campo} "${valor}" no es ni fecha ISO ni UNVERIFIED`);
      }
    }

    // La regla semantica del GATE 2.
    if (esISO(fDecision) && fuente === "commit") {
      err(`${donde}: FECHA_DECISION concreta apoyada en un commit. Un commit demuestra cuándo se registró, no cuándo se decidió. Usa FECHA_REGISTRO.`);
    }
    if (esISO(fDecision) && fuente === "UNVERIFIED") {
      err(`${donde}: presenta FECHA_DECISION ${fDecision} como hecho con fuente UNVERIFIED`);
    }
    if (esISO(fRegistro) && fuente === "UNVERIFIED") {
      err(`${donde}: presenta FECHA_REGISTRO ${fRegistro} como hecho con fuente UNVERIFIED`);
    }

    // Unica fuente que el auditor puede comprobar de verdad.
    if (fuente === "commit") {
      const ref = d.campos["FECHA_REF"];
      if (!ref || ref === "n/a") err(`${donde}: FECHA_FUENTE=commit exige FECHA_REF con el sha`);
      else if (!/^[0-9a-f]{7,40}$/i.test(ref)) err(`${donde}: FECHA_REF "${ref}" no es un sha válido`);
      else if (esISO(fRegistro)) {
        const real = fechaDeCommit(ref);
        if (real === null) err(`${donde}: FECHA_REF apunta al commit ${ref}, que no existe en este repositorio`);
        else if (real !== fRegistro) err(`${donde}: FECHA_REGISTRO dice ${fRegistro} pero el commit ${ref} es del ${real}`);
        else ok(`${donde}: registro ${fRegistro} confirmado contra el commit ${ref} (no prueba la fecha de decisión)`);
      }
    } else if (verificable === "SI") {
      avi(`${donde}: ORIGEN_VERIFICABLE=SI pero la fuente "${fuente}" no es comprobable por el auditor`);
    }

    // 6. DECIDIDO exige origen y motivo
    if (estado === "DECIDIDO") {
      if (!d.campos["ORIGEN_REF"]) err(`${donde}: DECIDIDO sin ORIGEN_REF`);
      if (!d.campos["MOTIVO"]) err(`${donde}: DECIDIDO sin MOTIVO`);
    }

    // 7. CHECK dentro de la lista cerrada
    if (check) {
      if (!Object.hasOwn(CHECKS, check)) {
        err(`${donde}: CHECK "${check}" no está en la lista cerrada (${Object.keys(CHECKS).join(", ")})`);
      } else if (/[;&|`$(){}<>]/.test(check)) {
        err(`${donde}: CHECK contiene metacaracteres de shell`);
      }
    }

    // 8. BLOQUEA / NO_BLOQUEA
    const bloquea = d.campos["BLOQUEA"];
    const noBloquea = d.campos["NO_BLOQUEA"];
    if ((bloquea && !noBloquea) || (noBloquea && !bloquea)) {
      err(`${donde}: BLOQUEA y NO_BLOQUEA van siempre juntos; falta uno de los dos`);
    }
    if (estado === "DESCONOCIDO" && !bloquea) {
      avi(`${donde}: DESCONOCIDO sin BLOQUEA — no se puede saber qué paraliza (CLAUDE.md §4)`);
    }

    // 9. Historial obligatorio en estados terminales de cambio
    if ((estado === "REEMPLAZADO" || estado === "DESCARTADO") && !d.historial) {
      err(`${donde}: ${estado} exige HISTORIAL; una decisión no se sobrescribe en silencio`);
    }
  }

  // 10. Referencias entre decisiones
  for (const d of decisiones) {
    for (const campo of ["REEMPLAZA", "REEMPLAZADO_POR"]) {
      const ref = d.campos[campo];
      if (!ref) continue;
      const destino = /DEC-\d{3}/.exec(ref)?.[0];
      if (!destino) err(`${d.id}: ${campo} "${ref}" no nombra ningún DEC-XXX`);
      else if (!vistos.has(destino)) err(`${d.id}: ${campo} apunta a ${destino}, que no existe`);
      else ok(`${d.id}: ${campo} → ${destino} resuelve`);
    }
  }

  // 11. Contradicciones ESTRUCTURALES.
  //     Solo eso: dos DECIDIDO sobre el mismo impacto sin enlace de reemplazo.
  //     Una contradiccion de significado no la ve un script, y no se vende como
  //     si la viera.
  const porImpacto = new Map();
  for (const d of decisiones) {
    if (d.campos["ESTADO"] !== "DECIDIDO") continue;
    for (const ambito of (d.campos["IMPACTO"] ?? "").split(",").map((s) => s.trim()).filter(Boolean)) {
      porImpacto.set(ambito, [...(porImpacto.get(ambito) ?? []), d]);
    }
  }
  for (const [ambito, lista] of porImpacto) {
    if (lista.length > 3) {
      avi(`${lista.length} decisiones DECIDIDO comparten el impacto "${ambito}" (${lista.map((d) => d.id).join(", ")}) — revisa que no se contradigan`);
    }
  }

  // 12. Ejecucion de los CHECK declarados
  for (const d of decisiones) {
    const nombre = d.campos["CHECK"];
    if (!nombre || !Object.hasOwn(CHECKS, nombre) || nombre === "n/a") continue;
    const c = CHECKS[nombre];
    if (c.red && !CON_RED) { avi(`${d.id}: CHECK ${nombre} omitido (necesita red; usa --con-red)`); continue; }
    let r;
    try { r = c.fn(); } catch (e) { r = { ok: false, detalle: `excepción: ${e.message}` }; }
    if (r.ok) ok(`${d.id}: CHECK ${nombre} → ${r.detalle}`);
    else err(`${d.id}: CHECK ${nombre} FALLA → ${r.detalle}`);
  }
}

/* ------------------------------------------------------------------ *
 * Salida
 * ------------------------------------------------------------------ */
export function ejecutar(ficheroDecisiones, ficheroReglas) {
  errores.length = 0; avisos.length = 0; pasadas.length = 0;
  auditar(ficheroDecisiones, ficheroReglas);
  return { errores: [...errores], avisos: [...avisos], pasadas: [...pasadas] };
}

const invocadoDirectamente = process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invocadoDirectamente) {
  const r = ejecutar();
  for (const p of r.pasadas) console.log(`  ok    ${p}`);
  for (const a of r.avisos) console.log(`  aviso ${a}`);
  for (const e of r.errores) console.error(`  ERROR ${e}`);
  console.log();
  console.log(`  ${r.pasadas.length} correctas · ${r.avisos.length} avisos · ${r.errores.length} errores`);
  if (!CON_RED) console.log("  (comprobaciones de red omitidas; añade --con-red para incluirlas)");
  console.log();
  if (r.errores.length > 0) {
    console.error("  Auditoría de control: FALLA. Corrige los errores antes de comitear.");
    process.exit(1);
  }
  console.log("  Auditoría de control: PASA.");
  console.log("  Alcance: coherencia ESTRUCTURAL. No detecta suposiciones semánticas.");
}
