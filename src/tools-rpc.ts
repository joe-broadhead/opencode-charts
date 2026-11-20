/**
 * Charts' part of the tools RPC (`charts.tools`): the plugin value and the method table that the source contract's
 * `tools-rpc` module takes. The module (`@we-the-rebel-alliance/source-contract/tools-rpc`, bundled into
 * `dist/index.js`) is the transport the plugin family shares:
 *
 *   POST /api/rpc/charts.tools/<method>
 *   { "input": { "sessionID": "<session>", "input": <the method's input> } }
 *
 * A script runs as a session and the agent it names; the rule for the method's permission action is resolved before
 * dispatch, and only `allow` runs. Charts exposes no MCP server: every method is plugin-owned and built where it has
 * a context.
 */
import { toolsRpcId, type Failure, type McpResult, type MethodSpec, type NextSteps, type ShapeCall, type ToolsRpcPlugin } from "@we-the-rebel-alliance/source-contract/tools-rpc"

/** The plugin's id. The RPC id is `<PLUGIN_ID>.tools`. */
export const PLUGIN_ID = "charts"

/** The RPC's id: the plugin's id and `.tools`. Scripts call it by name, so it never changes. */
export const TOOLS_RPC_ID = toolsRpcId(PLUGIN_ID)

/**
 * Charts exposes no MCP server: every tool is plugin-owned, so the table below is empty and the owned methods are
 * built in `setup`, where they have a context for their own `permission.assert` calls.
 */
export const METHODS: readonly MethodSpec[] = []

/** The model path's `execute.before` hooks: this plugin edits no arguments before dispatch. */
export function shapeInput(_method: string, input: unknown, _call: ShapeCall): unknown {
  return input
}

/** The model path's `execute.after` hooks: this plugin rewrites no results after dispatch. */
export function shapeResult(_method: string, result: McpResult, _call: ShapeCall): McpResult {
  return result
}

/** The next step for each code a table with no MCP method can raise. Each is one sentence that ends with a full stop. */
export const NEXT_STEPS: NextSteps = {
  SESSION_UNKNOWN: `Create a session in the location you mean, such as POST /api/session with {"agent":"build"} sent with the header "x-opencode-directory: <dir>" or the location[directory] query, and pass its id.`,
  SESSION_AGENT_REQUIRED: `Create a session that names an agent this project has, with its project as the location, such as POST /api/session with {"agent":"build","location":{"directory":"/path/to/project"}}, and pass its id.`,
  PERMISSION_DENIED: "Add an allow rule for the action to the session's agent or to the session, or use a session whose agent allows it; charts_render, charts_quick and charts_theme_save write files, so a script needs an allow for them.",
  CANCELLED: "Call the method again if you still need the result.",
}

/**
 * Charts' own failure, as the family's three fields. Every tool raises `ChartsError`, whose message already reads
 * `CODE: what happened. Next step: what to do.`, so the code and the next step are carried over rather than guessed.
 */
export function pluginError(error: unknown): Failure | undefined {
  if (!error || typeof error !== "object") return undefined
  const code = (error as { code?: unknown }).code
  const detail = (error as { detail?: unknown }).detail
  const hint = (error as { hint?: unknown }).hint
  if (typeof code !== "string" || !/^[A-Z][A-Z0-9_]{2,}$/.test(code) || typeof hint !== "string") return undefined
  // `what` carries no final full stop: the message form adds it, and the family's shape is `CODE: what. Next step:`.
  return { code, what: typeof detail === "string" ? detail.trimEnd().replace(/\.$/, "") : "The call failed", next: hint }
}

/** The plugin value the transport takes. */
export const PLUGIN: ToolsRpcPlugin = { id: PLUGIN_ID, nextSteps: NEXT_STEPS, shapeInput, shapeResult, pluginError }
