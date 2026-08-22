import { promises as fs } from "node:fs";
import path from "node:path";
import type { BudgetLimits } from "./budget.js";
import type { Effort } from "./provider/anthropic.js";
import type { Gate } from "./verify.js";

export interface ForgeConfig {
  model: string;
  effort: Effort;
  limits: BudgetLimits;
  /** Puertas explicitas. Si se omite, se detectan del proyecto. */
  gates?: Gate[];
  /** Prefijos de comando adicionales que no requieren aprobacion. */
  allowedCommands?: string[];
  /**
   * Puertas que tienen que existir y pasar. Es la clausula de gobierno del
   * fichero: sin ella, un proyecto que pierde sus tests sigue produciendo runs
   * que nadie marca como sospechosos.
   */
  requiredGates?: string[];
  /** Rutas que el agente no puede escribir nunca, como globs. */
  protectedPaths?: string[];
}

export const CONFIG_FILENAME = "forge.config.json";

export const DEFAULT_CONFIG: ForgeConfig = {
  model: "claude-opus-5",
  effort: "high",
  limits: { maxCostUsd: 2, maxIterations: 25, maxRepairAttempts: 3 },
};

/**
 * Resolucion de configuracion en tres capas: valores por defecto, fichero del
 * proyecto y variables de entorno. Gana la ultima que se aplica.
 *
 * El fichero se versiona con el repositorio a proposito — las puertas de calidad
 * y el tope de gasto son decisiones de equipo, no preferencias de cada maquina.
 */
export async function loadConfig(workspaceRoot: string): Promise<ForgeConfig> {
  const fromFile = await readConfigFile(path.join(workspaceRoot, CONFIG_FILENAME));

  return {
    model: process.env["FORGE_MODEL"] ?? fromFile.model ?? DEFAULT_CONFIG.model,
    effort: (process.env["FORGE_EFFORT"] as Effort | undefined) ?? fromFile.effort ?? DEFAULT_CONFIG.effort,
    limits: {
      maxCostUsd: numberFromEnv("FORGE_MAX_COST_USD") ?? fromFile.limits?.maxCostUsd ?? DEFAULT_CONFIG.limits.maxCostUsd,
      maxIterations:
        numberFromEnv("FORGE_MAX_ITERATIONS") ?? fromFile.limits?.maxIterations ?? DEFAULT_CONFIG.limits.maxIterations,
      maxRepairAttempts:
        numberFromEnv("FORGE_MAX_REPAIRS") ?? fromFile.limits?.maxRepairAttempts ?? DEFAULT_CONFIG.limits.maxRepairAttempts,
    },
    ...(fromFile.gates ? { gates: fromFile.gates } : {}),
    ...(fromFile.allowedCommands ? { allowedCommands: fromFile.allowedCommands } : {}),
    ...(fromFile.requiredGates ? { requiredGates: fromFile.requiredGates } : {}),
    ...(fromFile.protectedPaths ? { protectedPaths: fromFile.protectedPaths } : {}),
  };
}

async function readConfigFile(file: string): Promise<Partial<ForgeConfig>> {
  try {
    const raw = await fs.readFile(file, "utf8");
    return JSON.parse(raw) as Partial<ForgeConfig>;
  } catch {
    // Sin fichero de configuracion se trabaja con los valores por defecto;
    // un JSON invalido se ignora igual para no bloquear el run por un typo.
    return {};
  }
}

function numberFromEnv(name: string): number | undefined {
  const raw = process.env[name];
  if (!raw) return undefined;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : undefined;
}
