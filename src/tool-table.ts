import type { ToolClass, ToolName } from "./registry.js"
export type { ToolName }
import { toolTable } from "./tool-table-source.js"

/**
 * What the plugin registers at every engine start: each tool's name, class, description and JSON Schemas, as plain
 * data, with no zod and no engine behind it.
 *
 * In the bundle this table is the one the build computed from the registry (scripts/build.mjs puts it in place of
 * ./tool-table-source.js); from source it is computed from the registry. Either way it is the registry's own: the
 * tools' zod schemas stay the one definition, and test/lazy-start.test.ts checks the bundle's table equals them.
 */
export interface ToolTable {
  readonly namespace: string
  readonly namespaceDescription: string
  readonly tools: readonly ToolEntry[]
}
export interface ToolEntry {
  readonly name: ToolName
  readonly class: ToolClass
  readonly readOnly: boolean
  readonly description: string
  /** The input's JSON Schema (zod's, for its input side), which the model and the tools RPC are given. */
  readonly input: Record<string, unknown>
  readonly output: Record<string, unknown>
}

const TABLE = toolTable()
const BY_NAME = new Map(TABLE.tools.map(tool => [tool.name, tool]))

export const NAMESPACE = TABLE.namespace
export const NAMESPACE_DESCRIPTION = TABLE.namespaceDescription
export const TOOL_ENTRIES = TABLE.tools
export const toolEntry = (name: ToolName): ToolEntry => BY_NAME.get(name)!

/** The tool names and whether each only reads: what `src/plugin.ts`, `src/permissions.ts` and `src/status.ts` iterate. */
export const TOOLS: Readonly<Record<ToolName, { readonly readOnly: boolean; readonly class: ToolClass }>> = Object.fromEntries(
  TABLE.tools.map(tool => [tool.name, { readOnly: tool.readOnly, class: tool.class }]),
) as Readonly<Record<ToolName, { readonly readOnly: boolean; readonly class: ToolClass }>>

export const DESCRIPTIONS: Readonly<Record<ToolName, string>> = Object.fromEntries(TABLE.tools.map(tool => [tool.name, tool.description])) as Readonly<Record<ToolName, string>>

/** A tool input's JSON Schema, a fresh copy each time. */
export const inputJsonSchema = (name: ToolName): Record<string, unknown> => structuredClone(toolEntry(name).input)

/** One Standard Schema result: the parsed value, or the issues. */
type Validated = { readonly value: unknown; readonly issues?: undefined } | { readonly issues: readonly { readonly message: string; readonly path?: readonly unknown[] }[] }

/**
 * A tool's input as OpenCode takes it, a Standard Schema with its JSON Schema, without building the zod schema at start.
 *
 * OpenCode reads the JSON Schema to describe the tool (`jsonSchema.input`, which is the table's: zod's own for the same
 * schema, with the draft-2020-12 target OpenCode asks for and zod's default), and validates each call with `validate`,
 * which hands the value to the tool's real zod schema: `load` brings it in on the first call, so the issues, the parsed
 * value and its defaults are exactly zod's.
 */
export function deferredInput(name: ToolName, load: () => Promise<Readonly<Record<ToolName, { readonly "~standard": { validate(value: unknown): Validated | Promise<Validated> } }>>>) {
  const json = () => inputJsonSchema(name)
  return {
    "~standard": {
      version: 1 as const,
      vendor: "zod",
      validate: async (value: unknown): Promise<Validated> => (await load())[name]["~standard"].validate(value),
      jsonSchema: { input: json, output: json },
    },
  }
}
