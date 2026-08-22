import { BudgetExceeded } from "./errors.js";
import type { UsageTotals } from "./types.js";

/**
 * Forma minima del `usage` que devuelve la API.
 *
 * Se declara estructuralmente en vez de importar `Anthropic.Usage` para que la
 * contabilidad no quede atada a si el turno salio por la ruta beta o la
 * estable: los dos tipos tienen estos campos y aqui no hace falta nada mas.
 */
export interface UsageLike {
  input_tokens?: number | null;
  output_tokens?: number | null;
  cache_read_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
}

/** USD por millon de tokens. Tarifas de la API de Anthropic (primera parte). */
export const PRICING: Record<string, { input: number; output: number }> = {
  "claude-fable-5": { input: 10, output: 50 },
  "claude-opus-5": { input: 5, output: 25 },
  "claude-opus-4-8": { input: 5, output: 25 },
  "claude-sonnet-5": { input: 3, output: 15 },
  "claude-sonnet-4-6": { input: 3, output: 15 },
  "claude-haiku-4-5": { input: 1, output: 5 },
};

/** Multiplicadores de cache respecto al precio de entrada. */
const CACHE_WRITE_MULTIPLIER = 1.25;
const CACHE_READ_MULTIPLIER = 0.1;

export interface BudgetLimits {
  /** Tope duro de gasto. Al superarlo el run para de forma ordenada. */
  maxCostUsd: number;
  /** Iteraciones maximas del bucle de ejecucion. */
  maxIterations: number;
  /** Intentos de reparacion tras un fallo de verificacion. */
  maxRepairAttempts: number;
}

export const DEFAULT_LIMITS: BudgetLimits = {
  maxCostUsd: 2,
  maxIterations: 25,
  maxRepairAttempts: 3,
};

/**
 * Contabilidad real de consumo, derivada de `usage` de cada respuesta.
 * No estima: suma lo que la API reporta.
 */
export class Budget {
  private totals: UsageTotals = {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    costUsd: 0,
    requests: 0,
  };

  constructor(readonly limits: BudgetLimits = DEFAULT_LIMITS) {}

  record(model: string, usage: UsageLike): UsageTotals {
    const price = PRICING[model] ?? PRICING["claude-opus-5"]!;
    const input = usage.input_tokens ?? 0;
    const output = usage.output_tokens ?? 0;
    const cacheRead = usage.cache_read_input_tokens ?? 0;
    const cacheWrite = usage.cache_creation_input_tokens ?? 0;

    const cost =
      (input * price.input +
        cacheWrite * price.input * CACHE_WRITE_MULTIPLIER +
        cacheRead * price.input * CACHE_READ_MULTIPLIER +
        output * price.output) /
      1_000_000;

    this.totals = {
      inputTokens: this.totals.inputTokens + input,
      outputTokens: this.totals.outputTokens + output,
      cacheReadTokens: this.totals.cacheReadTokens + cacheRead,
      cacheWriteTokens: this.totals.cacheWriteTokens + cacheWrite,
      costUsd: this.totals.costUsd + cost,
      requests: this.totals.requests + 1,
    };
    return this.snapshot();
  }

  /** Se comprueba antes de cada peticion, no despues: evita el gasto sorpresa. */
  assertWithinBudget(): void {
    if (this.totals.costUsd >= this.limits.maxCostUsd) {
      throw new BudgetExceeded("cost", this.limits.maxCostUsd, this.totals.costUsd);
    }
  }

  /** Fraccion de presupuesto consumida, para avisar al modelo de que cierre. */
  pressure(): number {
    return this.limits.maxCostUsd > 0 ? this.totals.costUsd / this.limits.maxCostUsd : 0;
  }

  snapshot(): UsageTotals {
    return { ...this.totals };
  }
}
