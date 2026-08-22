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
