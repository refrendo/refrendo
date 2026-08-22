import type { RefrendoEvent, RunResult } from "@refrendo/core";
import type { CreateRunInput, RunStore } from "./store.js";

export interface Recording {
  id: string;
  /** Se engancha al bus del agente con `bus.on(recording.listener)`. */
  listener: (event: RefrendoEvent) => void;
  finish(result: RunResult): void;
}

/**
 * Graba en el almacen un run que ejecuta otro, sin orquestarlo.
 *
 * `RunManager` lanza el agente y ademas lo graba; esto solo graba. Existe
 * porque el recibo es el producto y hasta ahora solo lo producian los runs
 * lanzados por la API — un `refrendo run` desde la terminal, que es la puerta de
 * entrada mas usada, no dejaba rastro. La evidencia no puede depender de por
 * donde entraste.
 */
export function recordRun(store: RunStore, input: CreateRunInput): Recording {
  const row = store.createRun(input);

  return {
    id: row.id,
    listener: (event) => {
      try {
        store.appendEvent(row.id, event);
      } catch {
        // Un fallo al grabar no puede tumbar el run que se esta ejecutando:
        // perder la traza es malo, perder el trabajo es peor.
      }
    },
    finish: (result) => {
      try {
        store.finishRun(row.id, result);
      } catch {
        // Idem.
      }
    },
  };
}
