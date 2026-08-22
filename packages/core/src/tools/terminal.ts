import { z } from "zod";
import type { ToolDefinition, ToolOutcome } from "../types.js";

/**
 * Herramientas terminales: cierran una fase del bucle.
 *
 * Que el agente termine llamando a una herramienta con esquema estricto, y no
 * escribiendo prosa que luego hay que parsear, es lo que convierte la salida en
 * un dato tipado. El bucle valida el input y termina; no hay heuristica de "ha
 * dicho que ha acabado".
 */

export const submitPlanSchema = z.object({
  summary: z.string().describe("Que se va a hacer, en dos o tres frases."),
  steps: z
    .array(
      z.object({
        description: z.string().describe("Accion concreta y verificable."),
        files: z.array(z.string()).describe("Ficheros que toca este paso."),
        rationale: z.string().describe("Por que este paso es necesario."),
      }),
    )
    .min(1)
    .describe("Pasos en orden de ejecucion."),
  risks: z.array(z.string()).describe("Que podria romperse. Vacio si no hay riesgos reales."),
  acceptance_checks: z
    .array(z.string())
    .describe("Comprobaciones concretas que demuestran que la tarea esta hecha."),
});

export const submitPlan: ToolDefinition = {
  name: "submit_plan",
  description:
    "Entrega el plan de ejecucion. Llamala una sola vez, cuando ya hayas inspeccionado el codigo suficiente para que el plan sea concreto. No inventes rutas: solo ficheros que hayas visto.",
  terminal: true,
  schema: submitPlanSchema,
  async run(): Promise<ToolOutcome> {
    return { ok: true, content: "Plan registrado." };
  },
};

export const finishSchema = z.object({
  summary: z
    .string()
    .describe("Que has cambiado y por que, para alguien que revisara el diff sin mas contexto."),
  acceptance_met: z
    .array(z.string())
    .describe("Criterios de aceptacion cumplidos, con la evidencia concreta de cada uno."),
  outstanding: z
    .array(z.string())
    .describe("Lo que queda pendiente o no has podido hacer. Vacio si no queda nada."),
});

export const finish: ToolDefinition = {
  name: "finish",
  description:
    "Declara el trabajo terminado. Solo despues de haber aplicado los cambios. Tras esta llamada se ejecutan automaticamente las puertas de verificacion del proyecto: si fallan, volveras a tener el control con los errores concretos.",
  terminal: true,
  schema: finishSchema,
  async run(): Promise<ToolOutcome> {
    return { ok: true, content: "Trabajo declarado terminado. Verificando..." };
  },
};
