import { PolicyDenied } from "./errors.js";
import { globToRegExp } from "./workspace.js";

export interface ApprovalRequest {
  operation: string;
  detail: string;
}

export type ApprovalHandler = (request: ApprovalRequest) => Promise<boolean>;

export interface PolicyConfig {
  /**
   * Prefijos de comando que se ejecutan sin preguntar. Cualquier otro comando
   * requiere aprobacion explicita — el modo por defecto es "pregunta", no "adelante".
   */
  allowedCommands: string[];
  /** Patrones prohibidos sin excepcion: ninguna aprobacion los desbloquea. */
  deniedPatterns: RegExp[];
  /** Escrituras permitidas en el workspace. */
  allowWrite: boolean;
  /**
   * Rutas que el agente no puede escribir nunca, como globs.
   *
   * Es la respuesta a una pregunta que hace todo comprador con auditoria: "¿y
   * si el agente se toca el pipeline de CI, o los tests que lo estan juzgando?".
   * Decirle en el prompt que no lo haga es una peticion; esto es un cerrojo.
   */
  protectedPaths: string[];
  /** Aprobacion automatica de todo lo que no este en la denylist (modo `--yes`). */
  autoApprove: boolean;
  /** Timeout por comando de shell. */
  commandTimeoutMs: number;
  onApprovalRequest?: ApprovalHandler;
}

/**
 * Comandos destructivos o de efecto externo. Se bloquean siempre, incluso con
 * `--yes`: son irreversibles o publican fuera de la maquina, y ninguna de las
 * dos cosas es decision de un agente.
 */
/**
 * Inicio de comando: principio de la cadena, o detras de una tuberia, un punto
 * y coma o un operador de encadenamiento.
 *
 * Los nombres de utilidades peligrosas tienen que anclarse a esta posicion. Sin
 * el ancla, `format` caza cualquier ruta que contenga esa palabra — y eso no es
 * teorico: bloqueo `npx vitest run .../format.test.ts` en el primer run real.
 * Un falso positivo aqui no protege de nada y deja al agente sin poder ejecutar
 * los tests del proyecto, que es justo lo que le da sentido.
 */
const CMD = String.raw`(?:^|[|;&]\s*)`;

export const HARD_DENY: RegExp[] = [
  /\brm\s+(-[a-zA-Z]*\s+)*-[a-zA-Z]*[rf]/, // rm -rf y variantes
  /\bgit\s+push\b/,
  /\bgit\s+reset\s+--hard\b/,
  /\bgit\s+clean\s+-[a-zA-Z]*f/,
  /\bnpm\s+publish\b/,
  new RegExp(`${CMD}(shutdown|reboot|halt|poweroff)\\b`),
  new RegExp(`${CMD}(mkfs|diskpart|fdisk)\\b`),
  // `format` solo es peligroso como comando y con un destino detras: `format C:`.
  new RegExp(`${CMD}format\\s+[a-zA-Z]:`),
  /\bcurl\b[^|]*\|\s*(ba)?sh\b/, // curl ... | sh
  /\bchmod\s+777\b/,
  // Con espacio y argumento detras, para no cazar rutas como `src/sudo-helper.ts`.
  /\b(sudo|runas)\s+\S/,
  />\s*\/dev\/[a-z]/,
  /\bDROP\s+(TABLE|DATABASE)\b/i,
];

/**
 * Rutas protegidas por defecto.
 *
 * Son las que permiten a un agente falsear su propio veredicto: si puede
 * reescribir el workflow que lo ejecuta o la configuracion de las puertas, la
 * verificacion deja de significar nada. Un equipo puede ampliar la lista; poder
 * vaciarla es decision suya, pero el valor por defecto no es la lista vacia.
 */
export const DEFAULT_PROTECTED_PATHS = [
  ".github/workflows/**",
  ".github/actions/**",
  "forge.config.json",
  "action.yml",
  ".git/**",
];

/** Lectura y build local: seguro por defecto, sin efectos fuera del workspace. */
export const DEFAULT_ALLOWED_COMMANDS = [
  "npm test",
  "npm run",
  "npm ci",
  "npm install",
  "npx tsc",
  "npx vitest",
  "npx eslint",
  "npx prettier",
  "pnpm test",
  "pnpm run",
  "yarn test",
  "yarn run",
  "node ",
  "tsc",
  "vitest",
  "eslint",
  "pytest",
  "python -m pytest",
  "go test",
  "cargo test",
  "cargo check",
  "git status",
  "git diff",
  "git log",
  "git add",
  "ls",
  "cat",
];

export function defaultPolicyConfig(overrides: Partial<PolicyConfig> = {}): PolicyConfig {
  return {
    allowedCommands: DEFAULT_ALLOWED_COMMANDS,
    deniedPatterns: HARD_DENY,
    allowWrite: true,
    protectedPaths: DEFAULT_PROTECTED_PATHS,
    autoApprove: false,
    commandTimeoutMs: 120_000,
    ...overrides,
  };
}

/**
 * Puerta de permisos. Decide en tres niveles: prohibido siempre, permitido
 * siempre, o requiere que un humano diga que si.
 */
export class Policy {
  constructor(readonly config: PolicyConfig) {}

  /** Lanza `PolicyDenied` si el comando esta en la denylist dura. */
  assertCommandAllowed(command: string): void {
    const normalized = command.trim();
    for (const pattern of this.config.deniedPatterns) {
      if (pattern.test(normalized)) {
        throw new PolicyDenied(normalized, `coincide con un patron prohibido (${pattern.source})`);
      }
    }
  }

  isPreapprovedCommand(command: string): boolean {
    const normalized = command.trim();
    return this.config.allowedCommands.some((prefix) => normalized.startsWith(prefix));
  }

  /**
   * Resuelve una peticion de aprobacion. Sin manejador configurado y sin
   * `autoApprove`, la respuesta es "no": el fallo abierto seria un fallo de diseno.
   */
  async requestApproval(request: ApprovalRequest): Promise<boolean> {
    if (this.config.autoApprove) return true;
    if (!this.config.onApprovalRequest) return false;
    return this.config.onApprovalRequest(request);
  }

  assertWriteAllowed(path: string): void {
    if (!this.config.allowWrite) {
      throw new PolicyDenied(`escritura en ${path}`, "el run es de solo lectura");
    }
    const normalized = path.split("\\").join("/");
    for (const pattern of this.config.protectedPaths) {
      if (globToRegExp(pattern).test(normalized)) {
        throw new PolicyDenied(
          `escritura en ${path}`,
          `la ruta esta protegida por politica (${pattern})`,
        );
      }
    }
  }
}
