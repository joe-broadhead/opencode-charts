import type { Plugin } from "@opencode/plugin"
import type { Environment } from "../pipeline.js"
import type { ToolName } from "../registry.js"
import { inputJsonSchema, NAMESPACE, TOOL_ENTRIES, type ToolEntry } from "../tool-table.js"
import { renderer } from "../renderer-load.js"
import { registerToolsRpc, type ToolCall, type ToolsRpcContext } from "@we-the-rebel-alliance/source-contract/tools-rpc"
import { METHODS, PLUGIN } from "../tools-rpc.js"

export { pluginError, TOOLS_RPC_ID } from "../tools-rpc.js"

/**
 * Charts' tools as RPC methods, so a script can draw or check a chart with no model.
 *
 * Every tool is plugin-owned, so each method is a `kind: "plugin"` spec built here, where the plugin's context is: a
 * call asserts its own action exactly as a model's call does, and the file rules are asserted by the environment the
 * tool runs with. Nothing about a call differs from the model path except the source of the permission.
 *
 * The classes come from the registry (`read` for the five that write nothing, `export` for the four that write a
 * file), so `describe`, the model's tool list and `charts_capabilities` cannot disagree.
 */

export interface OwnedSpecOptions {
  readonly ctx: Pick<Plugin.Context, "permission">
  readonly env: Environment
  readonly envForSession?: (sessionID: string) => Environment
  /** The package version, reported by `describe`. */
  readonly version: string
}

/** What a script gets: the structured output and the text. Images are written to the workspace, never inlined here. */
const forScript = (result: { readonly output: unknown; readonly content: readonly { readonly type: string; readonly text?: string }[] }) => ({
  output: result.output ?? null,
  text: result.content.flatMap(part => (part.type === "text" && typeof part.text === "string" ? [part.text] : [])).join("\n\n"),
})

/**
 * A method's result: the tool's own output, under the schema the model path declares, and its text.
 *
 * Nesting the tool's schema here is deliberate. The RPC validates every result against this object on the way out, so
 * a host test calling the method proves two things at once: the tool's real result satisfies the schema OpenCode will
 * apply to it, and the schema itself is one the RPC accepts (no `pattern`, which Effect's importer disables).
 */
const outputEnvelope = (schema: Record<string, unknown>) => ({
  type: "object",
  properties: { output: { anyOf: [schema, { type: "null" }] }, text: { type: "string" } },
  required: ["output", "text"],
  additionalProperties: false,
})

export function ownedSpecs({ ctx, env, envForSession }: OwnedSpecOptions) {
  // The tool table is the registry's, as plain data (src/tool-table.ts), so registering reads no zod schema.
  const known = new Set<string>(TOOL_ENTRIES.map((tool: ToolEntry) => tool.name))
  return TOOL_ENTRIES.map((descriptor: ToolEntry) => {
    const name: ToolName = descriptor.name
    const action = `${NAMESPACE}_${name}`
    return {
      kind: "plugin" as const,
      class: descriptor.class,
      name,
      action,
      description: descriptor.description,
      input: inputJsonSchema(name) as never,
      output: outputEnvelope(descriptor.output) as never,
      async run(input: unknown, call: ToolCall) {
        const assert = (what: string, resources: readonly string[]) =>
          ctx.permission.assert({ sessionID: call.sessionID, agent: call.agent, source: { type: "tool", messageID: call.messageID, id: call.id }, action: what, resources: [...resources], save: ["*"] } as never)
        const assertFiles = async (kind: "read" | "edit", resources: readonly string[]) => { await assert(kind, resources) }
        // The tool's own action first, as on the model path. A script reaches this line only for an allowed call: the
        // shared module refuses an `ask` or a `deny` before dispatch.
        await assert(action, ["*"])
        const { runTool } = await renderer()
        return forScript(await runTool({ ...(envForSession ? envForSession(call.sessionID) : env), assertFiles }, name, input))
      },
      /** `describe` reports a method as available unless the registry and the running build disagree. */
      available: () => (known.has(name) ? undefined : "NOT_REGISTERED"),
    }
  })
}

/** Registers `<plugin id>.tools` and returns its stop function. */
export async function registerChartsRpc(ctx: ToolsRpcContext, options: OwnedSpecOptions) {
  return registerToolsRpc(ctx, { plugin: PLUGIN, methods: [...METHODS, ...ownedSpecs(options)] })
}
