import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import type { ToolDefinition } from "../types.js";

export type Effort = "low" | "medium" | "high" | "xhigh" | "max";

/** Rescate del servidor cuando el modelo declina por politica. */
const BETA_REFUSAL_FALLBACK = "server-side-fallback-2026-07-01";
/** Compactacion de contexto en servidor para conversaciones largas. */
const BETA_COMPACTION = "compact-2026-01-12";

export interface ProviderOptions {
  model?: string;
  effort?: Effort;
  maxTokens?: number;
  client?: Anthropic;
  /**
   * Reintenta en otro modelo si este declina la peticion por politica.
   * Activado por defecto: un run abortado a mitad por un falso positivo del
   * clasificador deja el arbol a medias.
   */
  refusalFallback?: boolean;
  /**
   * Compactacion de contexto en servidor. Activada por defecto: un ciclo largo
   * de reparaciones acumula toda la salida de los tests en la conversacion.
   */
  compaction?: boolean;
  /** Canal para avisos que el motor reenvia al stream de eventos. */
  onWarning?: (message: string) => void;
}

export interface TurnRequest {
  /** Prefijo estable del prompt. Se cachea; no debe llevar nada volatil. */
  system: string;
  messages: Anthropic.Beta.BetaMessageParam[];
  tools: ToolDefinition[];
  /** Callbacks de streaming para pintar la respuesta segun llega. */
  onText?: (delta: string) => void;
  signal?: AbortSignal;
}

interface Features {
  refusalFallback: boolean;
  compaction: boolean;
}

/**
 * Capa fina sobre el SDK de Anthropic.
 *
 * Concentra cuatro decisiones que el resto del motor no deberia repetir: como se
 * declaran las herramientas, donde se ponen los puntos de cache, como se traduce
 * un esquema Zod al formato de la API y que hacer cuando una funcion beta no
 * esta disponible.
 */
export class AnthropicProvider {
  readonly model: string;
  readonly effort: Effort;
  private readonly maxTokens: number;
  private readonly client: Anthropic;
  private readonly onWarning: ((message: string) => void) | undefined;
  private features: Features;
  private degraded = false;

  constructor(options: ProviderOptions = {}) {
    this.model = options.model ?? "claude-opus-5";
    this.effort = options.effort ?? "high";
    this.maxTokens = options.maxTokens ?? 32_000;
    this.onWarning = options.onWarning;
    this.features = {
      refusalFallback: options.refusalFallback !== false,
      compaction: options.compaction !== false,
    };
    // El SDK resuelve credenciales solo: ANTHROPIC_API_KEY, ANTHROPIC_AUTH_TOKEN
    // o el perfil de `ant auth login`. No hay que inyectar la clave a mano.
    this.client = options.client ?? new Anthropic({ maxRetries: 4 });
  }

  /** Funciones beta activas ahora mismo. Util para la traza y los tests. */
  get activeFeatures(): Readonly<Features> {
    return { ...this.features };
  }

  /**
   * Ejecuta un turno con streaming.
   *
   * Si la API rechaza las funciones beta —porque el modelo o la cuenta no las
   * tienen— se desactivan y se reintenta una sola vez. Degradar es preferible a
   * abortar: el nucleo del agente no depende de ninguna de las dos.
   */
  async turn(request: TurnRequest): Promise<Anthropic.Beta.BetaMessage> {
    try {
      return await this.stream(request, this.features);
    } catch (error) {
      if (!this.canDegrade(error)) throw error;

      this.degraded = true;
      this.features = { refusalFallback: false, compaction: false };
      this.onWarning?.(
        `La API rechazo las funciones beta (${error instanceof Error ? error.message : String(error)}). Se continua sin rescate por rechazo ni compactacion de contexto.`,
      );
      return this.stream(request, this.features);
    }
  }

  private canDegrade(error: unknown): boolean {
    if (this.degraded) return false;
    if (!this.features.refusalFallback && !this.features.compaction) return false;
    // Solo un 400 indica "esto no lo soporto". Un 401, un 429 o un 5xx no se
    // arreglan quitando betas y reintentar solo gastaria otra peticion.
    if (!(error instanceof Anthropic.BadRequestError)) return false;

    // Y ademas el 400 tiene que hablar de las betas. Un esquema de herramienta
    // mal formado tambien es un 400, y degradar por eso apagaba funciones que no
    // tenian nada que ver y ocultaba la causa real detras de un aviso enganoso.
    return /beta|fallback|compact|context_management/i.test(error.message);
  }

  private async stream(
    request: TurnRequest,
    features: Features,
  ): Promise<Anthropic.Beta.BetaMessage> {
    const betas: string[] = [];
    if (features.refusalFallback) betas.push(BETA_REFUSAL_FALLBACK);
    if (features.compaction) betas.push(BETA_COMPACTION);

    const stream = this.client.beta.messages.stream(
      {
        model: this.model,
        max_tokens: this.maxTokens,
        // Pensamiento adaptativo: el modelo decide cuanto razonar por turno.
        // `summarized` es opt-in; por defecto llegaria vacio y la UI pareceria colgada.
        thinking: { type: "adaptive", display: "summarized" },
        output_config: { effort: this.effort },
        // El prefijo estable (rol + reglas) se cachea a 1 h: en un run con 20
        // iteraciones se reenvia identico cada vez.
        system: [
          { type: "text", text: request.system, cache_control: { type: "ephemeral", ttl: "1h" } },
        ],
        tools: request.tools.map(toApiTool),
        messages: withConversationCacheBreakpoint(request.messages),
        ...(betas.length > 0 ? { betas } : {}),
        ...(features.refusalFallback ? { fallbacks: "default" as const } : {}),
        ...(features.compaction
          ? { context_management: { edits: [{ type: "compact_20260112" as const }] } }
          : {}),
      },
      request.signal ? { signal: request.signal } : undefined,
    );

    if (request.onText) stream.on("text", request.onText);

    return stream.finalMessage();
  }
}

/**
 * Palabras clave que la API rechaza en propiedades de tipo `integer` cuando la
 * herramienta va en modo estricto.
 */
const UNSUPPORTED_ON_INTEGER = [
  "minimum",
  "maximum",
  "exclusiveMinimum",
  "exclusiveMaximum",
] as const;

/**
 * Adapta el esquema que emite Zod al que acepta la API en modo estricto.
 *
 * Hace dos cosas, y las dos hay que hacerlas **en todos los niveles**, no solo
 * en la raiz — un objeto anidado dentro de un array las necesita igual:
 *
 * 1. Quita `minimum`/`maximum` de los enteros. `z.number().int().min(1).max(8)`
 *    produce `{type:"integer", minimum:1, maximum:8}` y eso devuelve un 400.
 *    Se quitan aqui y **no** del esquema Zod: la validacion local los sigue
 *    aplicando, que es donde sirven — si el modelo manda un valor fuera de
 *    rango recibe un error concreto en vez de ejecutar una barbaridad.
 * 2. Fuerza `additionalProperties: false` y un `required` presente en cada
 *    objeto, que es lo que exige el modo estricto.
 */
export function normalizeSchemaForApi(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(normalizeSchemaForApi);
  if (!node || typeof node !== "object") return node;

  const source = node as Record<string, unknown>;
  const out: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(source)) {
    if (source["type"] === "integer" && (UNSUPPORTED_ON_INTEGER as readonly string[]).includes(key)) {
      continue;
    }
    out[key] = normalizeSchemaForApi(value);
  }

  if (out["type"] === "object") {
    out["additionalProperties"] = false;
    if (!Array.isArray(out["required"])) out["required"] = [];
  }
  return out;
}

/** Traduce una herramienta del motor al formato de la API, en modo estricto. */
export function toApiTool(tool: ToolDefinition): Anthropic.Beta.BetaTool {
  const jsonSchema = normalizeSchemaForApi(
    z.toJSONSchema(tool.schema, { target: "draft-7", io: "input" }),
  ) as Record<string, unknown>;

  // `strict: true` exige un esquema cerrado; Zod no siempre emite
  // `additionalProperties`, asi que lo forzamos.
  const inputSchema = {
    ...jsonSchema,
    type: "object" as const,
    additionalProperties: false,
    required: (jsonSchema["required"] as string[] | undefined) ?? [],
  };

  return {
    name: tool.name,
    description: tool.description,
    strict: true,
    input_schema: inputSchema as Anthropic.Beta.BetaTool.InputSchema,
  };
}

/**
 * Punto de cache movil al final de la conversacion.
 *
 * El cacheo es por coincidencia de prefijo: marcando el ultimo bloque de cada
 * turno, la siguiente peticion reutiliza toda la historia previa. Se mantiene
 * un unico punto movil para no gastar los cuatro que permite la API.
 */
export function withConversationCacheBreakpoint(
  messages: Anthropic.Beta.BetaMessageParam[],
): Anthropic.Beta.BetaMessageParam[] {
  if (messages.length === 0) return messages;

  return messages.map((message, index) => {
    const isLast = index === messages.length - 1;
    if (!Array.isArray(message.content)) {
      return isLast
        ? {
            role: message.role,
            content: [
              {
                type: "text" as const,
                text: message.content,
                cache_control: { type: "ephemeral" as const },
              },
            ],
          }
        : message;
    }

    const blocks = message.content.map((block) => stripCacheControl(block));
    if (!isLast) return { role: message.role, content: blocks };

    const lastIndex = blocks.length - 1;
    const last = blocks[lastIndex];
    if (last && isCacheable(last)) {
      blocks[lastIndex] = { ...last, cache_control: { type: "ephemeral" } } as typeof last;
    }
    return { role: message.role, content: blocks };
  });
}

type Block = Anthropic.Beta.BetaContentBlockParam;

function stripCacheControl(block: Block): Block {
  if ("cache_control" in block && block.cache_control) {
    const { cache_control: _ignored, ...rest } = block as Block & { cache_control?: unknown };
    return rest as Block;
  }
  return block;
}

/**
 * Los bloques de razonamiento y los de compactacion no admiten `cache_control`,
 * y ponerselo devuelve un 400.
 */
function isCacheable(block: Block): boolean {
  return (
    block.type !== "thinking" && block.type !== "redacted_thinking" && block.type !== "compaction"
  );
}
