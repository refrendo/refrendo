/**
 * Pruebas del auditor.
 *
 * Que el auditor pase sobre un fichero valido no demuestra nada: un script que
 * siempre devuelve 0 tambien pasaria. Lo que hay que demostrar es que DETECTA
 * los errores, asi que cada test corrompe algo a proposito.
 *
 * Se trabaja sobre ficheros temporales. El DECISIONS.md real no se toca.
 */

import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, copyFileSync, mkdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const AUDITOR = path.join(RAIZ, "scripts", "auditar-control.mjs");

const VALIDA = `## DEC-001 — Decisión de ejemplo
ESTADO: DECIDIDO
FECHA_DECISION: UNVERIFIED
FECHA_REGISTRO: UNVERIFIED
FECHA_FUENTE: UNVERIFIED
FECHA_REF: n/a
ORIGEN: USUARIO
ORIGEN_REF: conversación
ORIGEN_VERIFICABLE: NO
MOTIVO: existe para probar el auditor.
IMPACTO: producto
CHECK: n/a
`;

let dir;

/** Monta un repo de mentira con su CLAUDE.md y su DECISIONS.md. */
function montar(contenidoDecisiones) {
  writeFileSync(path.join(dir, "CLAUDE.md"), "# reglas de prueba\n");
  writeFileSync(path.join(dir, "DECISIONS.md"), `# cabecera\n\n${contenidoDecisiones}`);
}

/** Ejecuta el auditor contra el repo de mentira y devuelve codigo y salida. */
function auditar() {
  try {
    const salida = execFileSync(process.execPath, [path.join(dir, "scripts", "auditar-control.mjs")], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { codigo: 0, salida };
  } catch (e) {
    return { codigo: e.status ?? -1, salida: `${e.stdout ?? ""}${e.stderr ?? ""}` };
  }
}

beforeEach(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), "refrendo-auditor-"));
  mkdirSync(path.join(dir, "scripts"), { recursive: true });
  copyFileSync(AUDITOR, path.join(dir, "scripts", "auditar-control.mjs"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("el auditor acepta lo correcto", () => {
  it("una decisión bien formada PASA con código 0", () => {
    montar(VALIDA);
    const { codigo, salida } = auditar();
    expect(salida).toContain("PASA");
    expect(codigo).toBe(0);
  });
});

describe("el auditor detecta lo incorrecto", () => {
  it("estado fuera del vocabulario → FALLA", () => {
    montar(VALIDA.replace("ESTADO: DECIDIDO", "ESTADO: RIESGO CONOCIDO"));
    const { codigo, salida } = auditar();
    expect(salida).toMatch(/ESTADO .* fuera del vocabulario/);
    expect(codigo).toBe(1);
  });

  it("ID duplicado → FALLA", () => {
    montar(`${VALIDA}\n${VALIDA}`);
    const { codigo, salida } = auditar();
    expect(salida).toContain("ID duplicado");
    expect(codigo).toBe(1);
  });

  // El fallo que motivo todo esto: 13 de 14 decisiones llevaban una fecha
  // concreta deducida de memoria, presentada como si fuera un hecho.
  it("fecha de registro concreta con fuente UNVERIFIED → FALLA", () => {
    montar(VALIDA.replace("FECHA_REGISTRO: UNVERIFIED", "FECHA_REGISTRO: 2026-08-20"));
    const { codigo, salida } = auditar();
    expect(salida).toMatch(/presenta FECHA_REGISTRO 2026-08-20 como hecho/);
    expect(codigo).toBe(1);
  });

  // GATE 2: un commit demuestra cuando se ESCRIBIO algo, jamas cuando se
  // DECIDIO. Presentar lo uno como lo otro es fortalecer la evidencia por
  // encima de lo que sostiene.
  it("fecha de DECISIÓN apoyada en un commit → FALLA", () => {
    const sha = execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: RAIZ, encoding: "utf8" }).trim();
    montar(VALIDA
      .replace("FECHA_DECISION: UNVERIFIED", "FECHA_DECISION: 2026-08-22")
      .replace("FECHA_FUENTE: UNVERIFIED", "FECHA_FUENTE: commit")
      .replace("FECHA_REF: n/a", `FECHA_REF: ${sha}`));
    const { codigo, salida } = auditar();
    expect(salida).toMatch(/demuestra cuándo se registró, no cuándo se decidió/);
    expect(codigo).toBe(1);
  });

  it("fecha de registro que no coincide con su commit → FALLA", () => {
    const sha = execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: RAIZ, encoding: "utf8" }).trim();
    montar(VALIDA
      .replace("FECHA_REGISTRO: UNVERIFIED", "FECHA_REGISTRO: 1999-01-01")
      .replace("FECHA_FUENTE: UNVERIFIED", "FECHA_FUENTE: commit")
      .replace("FECHA_REF: n/a", `FECHA_REF: ${sha}`));
    // El auditor resuelve el commit contra SU repositorio, no contra el
    // temporal: rechazar por desajuste o por commit inexistente son ambas
    // salidas correctas.
    const { codigo, salida } = auditar();
    expect(salida).toMatch(/pero el commit .* es del|que no existe en este repositorio/);
    expect(codigo).toBe(1);
  });

  // El auditor se rompio de verdad con esto: Python en Windows convirtio el
  // fichero a CRLF y `(.*)$` dejo de encontrar un solo campo, con lo que el
  // auditor acuso al fichero de un fallo que era suyo.
  it("un fichero con finales de línea CRLF se parsea igual → PASA", () => {
    montar(VALIDA.split("\n").join("\r\n"));
    const { codigo, salida } = auditar();
    expect(salida).not.toMatch(/falta el campo obligatorio/);
    expect(codigo).toBe(0);
  });

  it("referencia a una decisión inexistente → FALLA", () => {
    montar(`${VALIDA}REEMPLAZA: DEC-999\n`);
    const { codigo, salida } = auditar();
    expect(salida).toMatch(/apunta a DEC-999, que no existe/);
    expect(codigo).toBe(1);
  });

  // Corrección 1 del usuario: DECISIONS.md no puede nombrar nada que no este
  // en la lista cerrada, y desde luego nada que parezca un comando.
  it("CHECK fuera de la lista cerrada → FALLA", () => {
    montar(VALIDA.replace("CHECK: n/a", "CHECK: inventado-que-no-existe"));
    const { codigo, salida } = auditar();
    expect(salida).toMatch(/no está en la lista cerrada/);
    expect(codigo).toBe(1);
  });

  it("un CHECK con forma de comando de shell nunca se ejecuta → FALLA", () => {
    montar(VALIDA.replace("CHECK: n/a", "CHECK: n/a; rm -rf /"));
    const { codigo, salida } = auditar();
    expect(salida).toMatch(/no está en la lista cerrada|metacaracteres/);
    expect(codigo).toBe(1);
  });

  it("campo obligatorio ausente → FALLA", () => {
    montar(VALIDA.replace("MOTIVO: existe para probar el auditor.\n", ""));
    const { codigo, salida } = auditar();
    expect(salida).toMatch(/falta el campo obligatorio MOTIVO/);
    expect(codigo).toBe(1);
  });

  it("BLOQUEA sin NO_BLOQUEA → FALLA", () => {
    montar(`${VALIDA}BLOQUEA: algo\n`);
    const { codigo, salida } = auditar();
    expect(salida).toMatch(/BLOQUEA y NO_BLOQUEA van siempre juntos/);
    expect(codigo).toBe(1);
  });

  it("REEMPLAZADO sin HISTORIAL → FALLA", () => {
    montar(VALIDA.replace("ESTADO: DECIDIDO", "ESTADO: REEMPLAZADO"));
    const { codigo, salida } = auditar();
    expect(salida).toMatch(/exige HISTORIAL/);
    expect(codigo).toBe(1);
  });

  it("falta DECISIONS.md → FALLA", () => {
    writeFileSync(path.join(dir, "CLAUDE.md"), "# solo reglas\n");
    const { codigo, salida } = auditar();
    expect(salida).toMatch(/falta el fichero requerido DECISIONS.md/);
    expect(codigo).toBe(1);
  });
});

/**
 * El vocabulario de FECHA_FUENTE no sabia representar la procedencia real de una
 * decision tomada por el usuario en conversacion: obligaba a elegir entre
 * UNVERIFIED —que el auditor rechaza junto a una fecha concreta— y disfrazarla de
 * "comando" porque una cabecera Date demostrase el dia. Una cabecera prueba que
 * era ese dia, no que decidiera el usuario.
 */
describe("FECHA_FUENTE: conversación", () => {
  /** VALIDA con fechas concretas y la fuente que se quiera probar. */
  const conFuente = (fuente) => VALIDA
    .replace("FECHA_DECISION: UNVERIFIED", "FECHA_DECISION: 2026-08-27")
    .replace("FECHA_REGISTRO: UNVERIFIED", "FECHA_REGISTRO: 2026-08-27")
    .replace("FECHA_FUENTE: UNVERIFIED", `FECHA_FUENTE: ${fuente}`);

  it("es una fuente aceptada junto a fechas concretas → PASA", () => {
    montar(conFuente("conversación"));
    const { codigo, salida } = auditar();
    expect(salida).not.toMatch(/no es válida/);
    expect(codigo).toBe(0);
  });

  // Ampliar el vocabulario no puede convertirlo en una lista abierta.
  it("una fuente inventada sigue rechazándose → FALLA", () => {
    montar(conFuente("instrucción del usuario"));
    const { codigo, salida } = auditar();
    expect(salida).toMatch(/FECHA_FUENTE .* no es válida/);
    expect(codigo).toBe(1);
  });

  // Las cuatro fuentes anteriores no cambian de comportamiento. Las puertas de
  // `commit` y `UNVERIFIED` ya tienen sus propios tests mas arriba; aqui quedan
  // las dos que se aceptan sin comprobacion adicional.
  it.each(["documentación", "comando"])("la fuente %s sigue aceptándose → PASA", (fuente) => {
    montar(conFuente(fuente));
    const { codigo, salida } = auditar();
    expect(salida).not.toMatch(/no es válida/);
    expect(codigo).toBe(0);
  });

  // La conversacion registra la procedencia; no la vuelve reproducible desde un
  // clon del repositorio.
  it("con ORIGEN_VERIFICABLE: SI el auditor avisa de que no puede comprobarla", () => {
    montar(conFuente("conversación").replace("ORIGEN_VERIFICABLE: NO", "ORIGEN_VERIFICABLE: SI"));
    const { salida } = auditar();
    expect(salida).toMatch(/no es comprobable por el auditor/);
  });
});
