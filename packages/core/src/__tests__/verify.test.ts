import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { EventBus } from "../events.js";
import Anthropic from "@anthropic-ai/sdk";
import { AnthropicProvider, normalizeSchemaForApi, toApiTool, withConversationCacheBreakpoint } from "../provider/anthropic.js";
import { EXECUTOR_TOOLS, PLANNER_TOOLS } from "../tools/index.js";
import { editFile, readFile } from "../tools/fs.js";
import { detectGates, formatFailures, verify } from "../verify.js";
import { Workspace } from "../workspace.js";
import { ChangeJournal } from "../journal.js";
import { Policy, defaultPolicyConfig } from "../policy.js";
import type { ToolContext } from "../types.js";

let root: string;
let workspace: Workspace;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "forge-verify-"));
  workspace = new Workspace(root);
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

const writePackageJson = (scripts: Record<string, string>) =>
  workspace.writeFile("package.json", JSON.stringify({ name: "x", scripts }));

describe("deteccion de puertas", () => {
  it("no inventa puertas en un proyecto que no las tiene", async () => {
    expect(await detectGates(workspace)).toEqual([]);
  });

  it("usa los scripts del proyecto", async () => {
    await writePackageJson({ typecheck: "tsc --noEmit", test: "vitest run", lint: "eslint .", build: "tsup" });
    const gates = await detectGates(workspace);
    expect(gates.map((gate) => gate.name)).toEqual(["typecheck", "test", "lint", "build"]);
    expect(gates[0]!.command).toBe("npm run typecheck");
  });

  it("cae a tsc cuando hay tsconfig pero no script de typecheck", async () => {
    await writePackageJson({});
    await workspace.writeFile("tsconfig.json", "{}");
    const gates = await detectGates(workspace);
    expect(gates.map((gate) => gate.name)).toEqual(["typecheck"]);
    expect(gates[0]!.command).toContain("tsc --noEmit");
  });

  it("ignora el script de test de relleno que deja npm init", async () => {
    await writePackageJson({ test: 'echo "Error: no test specified" && exit 1' });
    expect(await detectGates(workspace)).toEqual([]);
  });
});

describe("ejecucion de puertas", () => {
  it("marca el informe como fallido si una puerta devuelve codigo distinto de cero", async () => {
    const bus = new EventBus();
    const report = await verify(workspace, bus.emit, {
      gates: [
        { name: "ok", command: "node -e \"process.exit(0)\"" },
        { name: "roto", command: "node -e \"console.error('fallo concreto'); process.exit(1)\"" },
      ],
    });

    expect(report.passed).toBe(false);
    expect(report.gates.map((gate) => gate.passed)).toEqual([true, false]);
    expect(formatFailures(report)).toContain("fallo concreto");
  });

  it("pasa cuando todas las puertas devuelven cero", async () => {
    const bus = new EventBus();
    const report = await verify(workspace, bus.emit, {
      gates: [{ name: "ok", command: "node -e \"process.exit(0)\"" }],
    });
    expect(report.passed).toBe(true);
    expect(formatFailures(report)).toBe("");
  });
});

describe("herramientas de edicion", () => {
  const context = (): ToolContext => ({
    workspace,
    policy: new Policy(defaultPolicyConfig({ autoApprove: true })),
    journal: new ChangeJournal(workspace),
    emit: new EventBus().emit,
    signal: new AbortController().signal,
  });

  it("rechaza una sustitucion ambigua en vez de elegir por su cuenta", async () => {
    await workspace.writeFile("a.ts", "const x = 1;\nconst x = 1;\n");
    const outcome = await editFile.run({ path: "a.ts", old_string: "const x = 1;", new_string: "const x = 2;" }, context());

    expect(outcome.ok).toBe(false);
    expect(outcome.content).toContain("2 veces");
    expect(await workspace.readFile("a.ts")).toBe("const x = 1;\nconst x = 1;\n");
  });

  it("explica que hacer cuando old_string no aparece", async () => {
    await workspace.writeFile("a.ts", "hola");
    const outcome = await editFile.run({ path: "a.ts", old_string: "adios", new_string: "x" }, context());
    expect(outcome.ok).toBe(false);
    expect(outcome.content).toContain("no aparece");
  });

  it("lee con numeros de linea y respeta el rango pedido", async () => {
    await workspace.writeFile("a.ts", "uno\ndos\ntres\ncuatro");
    const outcome = await readFile.run({ path: "a.ts", start_line: 2, end_line: 3 }, context());
    expect(outcome.ok).toBe(true);
    expect(outcome.content).toContain("dos");
    expect(outcome.content).toContain("tres");
    expect(outcome.content).not.toContain("cuatro");
  });
});

describe("preparacion de la peticion", () => {
  it("declara las herramientas en modo estricto y con esquema cerrado", () => {
    const tool = toApiTool(readFile);
    expect(tool.strict).toBe(true);
    expect(tool.input_schema.type).toBe("object");
    expect((tool.input_schema as { additionalProperties?: boolean }).additionalProperties).toBe(false);
  });

  it("deja un unico punto de cache, en el ultimo bloque", () => {
    const messages = withConversationCacheBreakpoint([
      { role: "user", content: [{ type: "text", text: "a", cache_control: { type: "ephemeral" } }] },
      { role: "assistant", content: [{ type: "text", text: "b" }] },
      { role: "user", content: [{ type: "text", text: "c" }] },
    ]);

    const marked = messages.flatMap((entry) =>
      (entry.content as Array<{ cache_control?: unknown }>).filter((block) => block.cache_control),
    );
    expect(marked).toHaveLength(1);
    const last = messages.at(-1)!.content as Array<{ text?: string; cache_control?: unknown }>;
    expect(last.at(-1)!.text).toBe("c");
    expect(last.at(-1)!.cache_control).toEqual({ type: "ephemeral" });
  });
});

describe("puertas obligatorias", () => {
  it("falla si falta una puerta obligatoria, aunque el resto pase", async () => {
    const bus = new EventBus();
    const report = await verify(workspace, bus.emit, {
      gates: [{ name: "typecheck", command: "node -e \"process.exit(0)\"" }],
      requiredGates: ["test"],
    });

    expect(report.passed).toBe(false);
    const missing = report.gates.find((gate) => gate.name === "test")!;
    expect(missing.passed).toBe(false);
    expect(missing.command).toBe("(no encontrada)");
    expect(missing.output).toContain("no existe en este proyecto");
  });

  it("pasa cuando la puerta obligatoria existe y esta en verde", async () => {
    const bus = new EventBus();
    const report = await verify(workspace, bus.emit, {
      gates: [{ name: "test", command: "node -e \"process.exit(0)\"" }],
      requiredGates: ["test"],
    });
    expect(report.passed).toBe(true);
  });

  it("registra la ausencia como un evento mas, no como un silencio", async () => {
    const bus = new EventBus();
    const eventos: string[] = [];
    bus.on((event) => {
      if (event.type === "gate_completed") eventos.push(event.gate.name);
    });

    await verify(workspace, bus.emit, { gates: [], requiredGates: ["test", "lint"] });
    expect(eventos).toEqual(["test", "lint"]);
  });
});

describe("poda del esquema para la API", () => {
  it("quita minimum y maximum de las propiedades enteras", () => {
    const podado = normalizeSchemaForApi({
      type: "object",
      properties: {
        max_depth: { type: "integer", minimum: 1, maximum: 8, default: 3 },
      },
    }) as { properties: { max_depth: Record<string, unknown> } };

    expect(podado.properties.max_depth).toEqual({ type: "integer", default: 3 });
  });

  it("los conserva en tipos que si los admiten", () => {
    const podado = normalizeSchemaForApi({
      type: "object",
      properties: {
        ratio: { type: "number", minimum: 0, maximum: 1 },
        nombre: { type: "string", minLength: 1 },
      },
    }) as { properties: Record<string, Record<string, unknown>> };

    expect(podado.properties["ratio"]).toEqual({ type: "number", minimum: 0, maximum: 1 });
    expect(podado.properties["nombre"]).toEqual({ type: "string", minLength: 1 });
  });

  it("baja por objetos anidados, arrays y uniones", () => {
    const podado = normalizeSchemaForApi({
      type: "object",
      properties: {
        pasos: { type: "array", items: { type: "integer", minimum: 1 } },
        anidado: { type: "object", properties: { n: { type: "integer", maximum: 9 } } },
        union: { anyOf: [{ type: "integer", minimum: 2 }, { type: "string" }] },
      },
    }) as Record<string, never>;

    expect(JSON.stringify(podado)).not.toContain("minimum");
    expect(JSON.stringify(podado)).not.toContain("maximum");
  });

  it("no deja rastro de las palabras prohibidas en ninguna herramienta real", () => {
    for (const tool of EXECUTOR_TOOLS) {
      const serialized = JSON.stringify(toApiTool(tool).input_schema);
      // Solo importan dentro de un bloque `"type":"integer"`, pero la forma
      // barata de comprobarlo es que no aparezcan si hay algun entero.
      if (serialized.includes('"type":"integer"')) {
        expect(serialized).not.toMatch(/"(minimum|maximum|exclusiveMinimum|exclusiveMaximum)"/);
      }
    }
  });
});

describe("degradacion de funciones beta", () => {
  const provider = () => new AnthropicProvider({ client: new Anthropic({ apiKey: "prueba" }) });

  const degradable = (p: AnthropicProvider, error: unknown): boolean =>
    (p as unknown as { canDegrade(e: unknown): boolean }).canDegrade(error);

  const badRequest = (message: string) =>
    new Anthropic.BadRequestError(400, { message }, message, new Headers());

  it("degrada cuando el 400 habla de las betas", () => {
    expect(degradable(provider(), badRequest("betas: compact-2026-01-12 is not available"))).toBe(true);
    expect(degradable(provider(), badRequest("fallbacks not supported for this model"))).toBe(true);
  });

  it("no degrada por un 400 que no tiene nada que ver", () => {
    expect(
      degradable(provider(), badRequest("tools.0.custom: For 'integer' type, properties maximum, minimum are not supported")),
    ).toBe(false);
  });

  it("no degrada por errores que no son 400", () => {
    expect(degradable(provider(), new Error("timeout"))).toBe(false);
  });
});

describe("objetos anidados en modo estricto", () => {
  it("cierra todos los objetos, no solo el de la raiz", () => {
    const normalizado = normalizeSchemaForApi({
      type: "object",
      properties: {
        pasos: {
          type: "array",
          items: { type: "object", properties: { d: { type: "string" } }, required: ["d"] },
        },
      },
    }) as Record<string, never>;

    const texto = JSON.stringify(normalizado);
    // Dos objetos: la raiz y el de dentro del array.
    expect(texto.match(/"additionalProperties":false/g)).toHaveLength(2);
  });

  it("ninguna herramienta real deja un objeto abierto", () => {
    for (const tool of [...EXECUTOR_TOOLS, ...PLANNER_TOOLS]) {
      const schema = toApiTool(tool).input_schema as unknown;
      const abiertos: string[] = [];
      const recorrer = (node: unknown, ruta: string): void => {
        if (Array.isArray(node)) return node.forEach((n, i) => recorrer(n, `${ruta}[${i}]`));
        if (!node || typeof node !== "object") return;
        const o = node as Record<string, unknown>;
        if (o["type"] === "object" && o["additionalProperties"] !== false) abiertos.push(ruta);
        for (const [k, v] of Object.entries(o)) recorrer(v, `${ruta}.${k}`);
      };
      recorrer(schema, tool.name);
      expect(abiertos).toEqual([]);
    }
  });
});
