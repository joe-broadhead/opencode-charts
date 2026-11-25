import { renderer } from "../renderer-load.js"
import type { ToolName } from "../registry.js"

/**
 * The checked input of a tool call.
 *
 * The register checks the input against the handler's JSON Schema before it runs; parsing it again with the lazy zod
 * schema gives the defaults and the types the renderer works with, without loading the renderer at engine start.
 */
export async function parseInput(name: ToolName, raw: unknown): Promise<Record<string, unknown>> {
  return (await renderer()).INPUTS[name].parse(raw) as Record<string, unknown>
}
