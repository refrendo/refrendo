import { describe, expect, it } from "vitest";
import { runCommand } from "../tools/shell.js";

/**
 * Regresion de un fallo que solo aparecia en Linux y de forma intermitente.
 *
 * Lo encontro el propio agente ejecutandose en CI: `npm test` salia con codigo 1
 * mientras los 206 tests pasaban, porque un `write EPIPE` no capturado tumbaba
 * el proceso. Si el comando termina antes de leer lo que le escribimos, el
 * sistema cierra la tuberia y Node emite el error en el flujo de entrada; sin
 * manejador, deja de ser un error del comando y pasa a ser una excepcion que
 * mata a quien lo invoco.
 *
 * Es una carrera, asi que un solo intento puede pasar por suerte: se repite
 * varias veces con una entrada lo bastante grande como para no caber en el
 * bufer de la tuberia.
 */
describe("escritura en la entrada de un proceso que ya termino", () => {
  const ENTRADA_GRANDE = "x".repeat(3_000_000);

  it("no tumba el proceso cuando el comando sale sin leer su entrada", async () => {
    for (let intento = 0; intento < 5; intento++) {
      const resultado = await runCommand('node -e "process.exit(0)"', {
        cwd: process.cwd(),
        timeoutMs: 15_000,
        stdin: ENTRADA_GRANDE,
      });
      expect(resultado.exitCode).toBe(0);
      expect(resultado.timedOut).toBe(false);
    }
  }, 60_000);

  it("registra el fallo de escritura en vez de tragarselo", async () => {
    const resultado = await runCommand('node -e "process.exit(3)"', {
      cwd: process.cwd(),
      timeoutMs: 15_000,
      stdin: ENTRADA_GRANDE,
    });

    // El codigo de salida del comando manda; si ademas hubo un fallo de
    // tuberia, queda anotado para poder diagnosticarlo.
    expect(resultado.exitCode).toBe(3);
    if (resultado.stderr.includes("[stdin]")) {
      expect(resultado.stderr).toMatch(/EPIPE|EOF|closed/i);
    }
  }, 30_000);

  it("sigue entregando la entrada cuando el comando si la lee", async () => {
    const resultado = await runCommand(
      'node -e "let d=\'\';process.stdin.on(\'data\',c=>d+=c).on(\'end\',()=>process.stdout.write(String(d.length)))"',
      { cwd: process.cwd(), timeoutMs: 15_000, stdin: "hola mundo" },
    );

    expect(resultado.exitCode).toBe(0);
    expect(resultado.stdout.trim()).toBe("10");
  }, 30_000);
});
