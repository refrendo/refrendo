import { describe, expect, it } from "vitest";
import { lastLines } from "../tools/shell.js";

/**
 * `lastLines` recorta la cola de un log: es lo que se le acaba ensenando al
 * modelo, asi que conviene fijar por escrito cuanto conserva y que descarta.
 */
describe("lastLines", () => {
  it("devuelve el texto entero cuando hay menos lineas que el limite", () => {
    expect(lastLines("una\ndos\ntres", 10)).toBe("una\ndos\ntres");
  });

  it("se queda solo con las ultimas lineas cuando sobran", () => {
    expect(lastLines("uno\ndos\ntres\ncuatro\ncinco", 2)).toBe("cuatro\ncinco");
  });

  it("conserva todas las lineas cuando el limite coincide con su numero", () => {
    expect(lastLines("una\ndos\ntres", 3)).toBe("una\ndos\ntres");
  });

  it("descarta el salto de linea final", () => {
    expect(lastLines("una\ndos\n", 10)).toBe("una\ndos");
    expect(lastLines("una\ndos\n\n\n", 10)).toBe("una\ndos");
  });

  it("no cuenta el salto final como linea al aplicar el limite", () => {
    expect(lastLines("uno\ndos\ntres\n", 2)).toBe("dos\ntres");
  });

  it("devuelve cadena vacia para un texto vacio", () => {
    expect(lastLines("", 10)).toBe("");
  });
});
