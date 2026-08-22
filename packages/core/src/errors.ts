/** Errores de dominio. Todo fallo esperable tiene un tipo; nada se comunica por string matching. */

export class ForgeError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly detail?: unknown,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

/** Una ruta intento salir de la raiz del workspace. */
export class SandboxViolation extends ForgeError {
  constructor(requested: string, root: string) {
    super(
      `La ruta "${requested}" queda fuera del workspace (${root}). Operacion bloqueada.`,
      "sandbox_violation",
      { requested, root },
    );
  }
}

/** La politica de permisos rechazo la operacion (denylist o aprobacion denegada). */
export class PolicyDenied extends ForgeError {
  constructor(operation: string, reason: string) {
    super(`Operacion denegada por politica: ${operation} — ${reason}`, "policy_denied", {
      operation,
      reason,
    });
  }
}

/** Se agoto el presupuesto de coste, tokens o iteraciones. */
export class BudgetExceeded extends ForgeError {
  constructor(readonly kind: "cost" | "tokens" | "iterations", limit: number, actual: number) {
    super(
      `Presupuesto agotado (${kind}): limite ${limit}, consumido ${actual}.`,
      "budget_exceeded",
      { kind, limit, actual },
    );
  }
}

/** El modelo pidio una herramienta inexistente o con argumentos invalidos. */
export class ToolInvocationError extends ForgeError {
  constructor(tool: string, reason: string) {
    super(`Herramienta "${tool}": ${reason}`, "tool_invocation_error", { tool, reason });
  }
}

/**
 * No hay credenciales utilizables.
 *
 * El SDK lanza un mensaje sobre metodos de autenticacion que no le dice nada a
 * quien acaba de instalar la herramienta. Este es el primer error que ve casi
 * todo el mundo, y de el depende que siga o abandone.
 */
export class MissingCredentials extends ForgeError {
  constructor(detail: string) {
    super(
      [
        "No hay credenciales de la API de Anthropic.",
        "",
        "Elige una de estas dos vias:",
        "",
        "  1. Crea un fichero .env en la raiz del proyecto con:",
        "       ANTHROPIC_API_KEY=sk-ant-...",
        "     La clave se saca de https://console.anthropic.com -> API Keys.",
        "     Ojo: la consola es distinta de claude.ai y se factura aparte;",
        "     hace falta saldo en Billing para que las llamadas funcionen.",
        "",
        "  2. O ejecuta `ant auth login`, que deja un perfil que el SDK lee solo.",
        "",
        `Detalle tecnico: ${detail}`,
      ].join("\n"),
      "missing_credentials",
      { detail },
    );
  }
}
