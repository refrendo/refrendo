import type { ToolDefinition } from "../types.js";
import { editFile, listFiles, readFile, searchCode, writeFile } from "./fs.js";
import { runCommandTool } from "./shell.js";
import { finish, submitPlan } from "./terminal.js";

export * from "./fs.js";
export * from "./shell.js";
export * from "./terminal.js";

/**
 * El orden es deterministico y estable a proposito: el bloque `tools` se
 * renderiza antes que `system` en el prompt cacheado, asi que reordenarlo
 * invalidaria la cache en cada peticion.
 */
export const READ_ONLY_TOOLS: ToolDefinition[] = [listFiles, readFile, searchCode];

export const PLANNER_TOOLS: ToolDefinition[] = [...READ_ONLY_TOOLS, submitPlan];

export const EXECUTOR_TOOLS: ToolDefinition[] = [
  ...READ_ONLY_TOOLS,
  writeFile,
  editFile,
  runCommandTool,
  finish,
];

export function toolByName(tools: ToolDefinition[], name: string): ToolDefinition | undefined {
  return tools.find((tool) => tool.name === name);
}
