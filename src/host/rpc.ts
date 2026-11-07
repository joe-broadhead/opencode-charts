import type { Plugin } from "@opencode/plugin"
import type { Environment } from "../pipeline.js"
import { DESCRIPTORS, inputSchema, manifest, permissionOfTool, type ToolDescriptor, type ToolName } from "../registry.js"
import { runTool } from "../tools.js"
import { METHODS, registerToolsRpc, TOOLS_RPC_ID, type ToolCall, type ToolsRpcContext } from "./tools-rpc.js"

export { pluginError, TOOLS_RPC_ID } from "./tools-rpc.js"

/**
 * Charts' tools as RPC methods, so a script can draw or check a chart with no model.
 *
 * Every tool is plugin-owned, so each method is a `kind: "plugin"` spec built here, where the plugin's context is: a
 * call asserts its own action exactly as a model's call does, and the file rules are asserted by the environment the
 * tool runs with. Nothing about a call differs from the model path except the source of the permission.
 *
 * The classes come from the registry (`read` for the five that write nothing, `export` for the three that write a
 * file), so `describe`, the model's tool list and `charts_capabilities` cannot disagree.
 */

export interface OwnedSpecOptions {
  readonly ctx: Pick<Plugin.Context, "permission">
  readonly env: Environment
  /** The package version, reported by `describe`. */
  readonly version: string
}

/** What a script gets: the structured output and the text. Images are written to the workspace, never inlined here. */
const forScript = (result: { readonly output: unknown; readonly content: readonly { readonly type: string; readonly text?: string }[] }) => ({
  output: result.output ?? null,
  text: result.content.flatMap(part => (part.type === "text" && typeof part.text === "string" ? [part.text] : [])).join("\n\n"),
})

const OUTPUT_SCHEMA = {
  type: "object",
  properties: { output: { type: ["object", "null"] }, text: { type: "string" } },
  required: ["output", "text"],
} as const

export function ownedSpecs({ ctx, env, version }: OwnedSpecOptions) {
  const known = new Set(manifest(version).tools.map(tool => tool.name))
  return DESCRIPTORS.map((descriptor: ToolDescriptor) => {
    const name = descriptor.name as ToolName
    const action = permissionOfTool(name)
    return {
      kind: "plugin" as const,
      class: descriptor.class,
      name,
      action,
      description: descriptor.description,
      input: inputSchema(name) as never,
      output: OUTPUT_SCHEMA as never,
      async run(input: unknown, call: ToolCall) {
        const assert = (what: string, resources: readonly string[]) =>
          ctx.permission.assert({ sessionID: call.sessionID, agent: call.agent, source: { type: "tool", messageID: call.messageID, id: call.id }, action: what, resources: [...resources], save: ["*"] } as never)
        const assertFiles = async (kind: "read" | "edit", resources: readonly string[]) => { await assert(kind, resources) }
        // The tool's own action first, as on the model path. A script reaches this line only for an allowed call: the
        // shared module refuses an `ask` or a `deny` before dispatch.
        await assert(action, ["*"])
        return forScript(await runTool({ ...env, assertFiles }, name, input))
      },
      /** `describe` reports a method as available unless the registry and the running build disagree. */
      available: () => (known.has(name) ? undefined : "NOT_REGISTERED"),
    }
  })
}

/** Registers `<plugin id>.tools` and returns its stop function. */
export async function registerChartsRpc(ctx: ToolsRpcContext, options: OwnedSpecOptions) {
  return registerToolsRpc(ctx, { methods: [...METHODS, ...ownedSpecs(options)] })
}
