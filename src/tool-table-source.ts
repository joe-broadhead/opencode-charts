import { DESCRIPTORS, inputSchema, NAMESPACE, NAMESPACE_DESCRIPTION, type ToolName } from "./registry.js"
import type { ToolTable } from "./tool-table.js"

/**
 * The tool table, computed from the registry. Source and tests read it from here; the bundle never does: the build
 * evaluates this function once and compiles its result into dist/index.js in this module's place (scripts/build.mjs),
 * so an engine start reads plain data instead of building the registry's zod schemas.
 */
export function toolTable(): ToolTable {
  return {
    namespace: NAMESPACE,
    namespaceDescription: NAMESPACE_DESCRIPTION,
    tools: DESCRIPTORS.map(tool => ({
      name: tool.name as ToolName,
      class: tool.class,
      readOnly: tool.readOnly,
      description: tool.description,
      input: inputSchema(tool.name as ToolName),
      output: tool.output,
    })),
  }
}
