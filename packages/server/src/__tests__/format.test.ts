import { describe, expect, it } from "vitest";
import { formatCost, formatDuration, formatTokens } from "../html.js";

describe("formatDuration", () => {
  it("usa milisegundos por debajo del segundo", () => {
    expect(formatDuration(0)).toBe("0 ms");
    expect(formatDuration(999)).toBe("999 ms");
  });

  it("usa segundos con un decimal por debajo del minuto", () => {
    expect(formatDuration(1000)).toBe("1.0 s");
    expect(formatDuration(1500)).toBe("1.5 s");
    expect(formatDuration(59_999)).toBe("60.0 s");
  });

  it("usa minutos y segundos a partir del minuto", () => {
    expect(formatDuration(60_000)).toBe("1 min 0 s");
    expect(formatDuration(90_000)).toBe("1 min 30 s");
    expect(formatDuration(3_600_000)).toBe("60 min 0 s");
  });
});

describe("formatTokens", () => {
  it("deja el valor tal cual por debajo de mil", () => {
    expect(formatTokens(0)).toBe("0");
    expect(formatTokens(999)).toBe("999");
  });

  it("abrevia en miles por debajo del millón", () => {
    expect(formatTokens(1000)).toBe("1.0k");
    expect(formatTokens(12_500)).toBe("12.5k");
    expect(formatTokens(999_999)).toBe("1000.0k");
  });

  it("abrevia en millones a partir del millón", () => {
    expect(formatTokens(1_000_000)).toBe("1.00M");
    expect(formatTokens(2_500_000)).toBe("2.50M");
  });
});

describe("formatCost", () => {
  it("siempre muestra cuatro decimales", () => {
    expect(formatCost(0)).toBe("$0.0000");
    expect(formatCost(0.5)).toBe("$0.5000");
  });

  it("redondea a la cuarta cifra decimal", () => {
    expect(formatCost(1.23456)).toBe("$1.2346");
  });
});
