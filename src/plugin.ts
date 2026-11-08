import { readFile } from "node:fs/promises"
import { join } from "node:path"
import type { Plugin } from "@opencode/plugin"
import { Error as ToolError } from "@opencode/plugin/promise/tool"
import { ChartsError } from "./errors.js"
import { closeVegaWorker } from "./engines/vega-pool.js"
import { registerChartsRpc } from "./host/rpc.js"
import { formatFailure, isChartsError } from "./errors.js"
import type { Access } from "./permissions.js"
import { permissionOf, registerDefaultRules, type Rule } from "./permissions.js"
import { registerStatusRpc } from "./status-rpc.js"
import { buildStatus, commandTransform, formatStatus } from "./status.js"
import { DESCRIPTIONS, INPUTS, NAMESPACE, NAMESPACE_DESCRIPTION, TOOLS, runTool, type ToolName } from "./tools.js"
import { descriptor } from "./registry.js"
import type { ThemeOverrides } from "./themes/tokens.js"

export { PLUGIN_ID } from "./constants.js"
import { PLUGIN_ID } from "./constants.js"
export const SKILLS = ["charts", "charts-cookbook"] as const

/** Plugin options (opencode.json `plugin` entry options). */
export interface ChartsOptions {
  /** Default theme for every chart. */
  readonly theme?: string
  /** Default locale for numbers and dates. */
  readonly locale?: string
  /** Default output folder, relative to the workspace. */
  readonly outDir?: string
  /** Named themes from configuration: { "acme": { "extends": "light", "colors": { … } } }. */
  readonly themes?: Record<string, ThemeOverrides>
  /** What the plugin's own tools may do without asking: everything, ask for changes, or reads only. */
  readonly access: Access
}

function options(raw: unknown): ChartsOptions {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>
  const access = o.access ?? "all"
  if (access !== "all" && access !== "ask-changes" && access !== "read-only") {
    throw new ChartsError("OPTIONS_INVALID", `The option "access" must be "all", "ask-changes" or "read-only", found ${JSON.stringify(access)}.`, 'Set it to "ask-changes" to be asked before each write, or "read-only" to turn writes off.')
  }
  return {
    access: access as Access,
    ...(typeof o.theme === "string" ? { theme: o.theme } : {}),
    ...(typeof o.locale === "string" ? { locale: o.locale } : {}),
    ...(typeof o.outDir === "string" ? { outDir: o.outDir } : {}),
    ...(o.themes && typeof o.themes === "object" ? { themes: o.themes as Record<string, ThemeOverrides> } : {}),
  }
}

async function loadSkill(packageRoot: string, id: string) {
  const path = join(packageRoot, "skills", id, "SKILL.md")
  try {
    const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/.exec(await readFile(path, "utf8"))
    const fields = Object.fromEntries((match?.[1] ?? "").split(/\r?\n/).map(line => /^(\w+):\s*(.+?)\s*$/.exec(line)).filter(m => m !== null).map(m => [m[1], m[2]]))
    if (!match || fields.name !== id || !fields.description) throw new Error("bad front matter")
    return { id, name: id, description: fields.description, path, content: match[2]!.trim(), autoinvoke: true }
  } catch {
    console.warn(formatFailure("SKILLS_INVALID", `The skill ${id} is missing or malformed, so it was skipped.`, "Reinstall the plugin."))
    return undefined
  }
}

/** The installed package's version, from its package.json, which every tarball ships. */
async function packageVersion(packageRoot: string): Promise<string> {
  try { return String((JSON.parse(await readFile(join(packageRoot, "package.json"), "utf8")) as { version?: unknown }).version ?? "unknown") }
  catch { return "unknown" }
}

export function createPlugin({ packageRoot }: { packageRoot: string }): Plugin.Plugin {
  return {
    id: PLUGIN_ID,
    async setup(ctx) {
      const opts = options(ctx.options)
      const skills = (await Promise.all(SKILLS.map(id => loadSkill(packageRoot, id)))).filter(s => s !== undefined)
      const version = await packageVersion(packageRoot)
      const workspace = { directory: ctx.location.directory, projectDirectory: ctx.location.project.directory }
      const defaults = { ...(opts.theme ? { theme: opts.theme } : {}), ...(opts.locale ? { locale: opts.locale } : {}), outDir: opts.outDir ?? "outputs/charts" }
      const location = { location: { directory: ctx.location.directory } }
      // The environment every tool runs with, whether the model calls it or a script reaches it over the tools RPC.
      const toolEnv = { workspace, packageRoot, configuredThemes: opts.themes ?? {}, defaults }
      const status = () => buildStatus({
        version, hostVersion: ctx.app.version, packageRoot, defaults, access: opts.access,
        themes: { workspace, packageRoot, configured: opts.themes ?? {} },
        agents: async () => (await ctx.agent.list(location)).data as readonly { id: string; permissions: Rule[] }[],
        tools: () => ctx.tool.list(),
        skills: { listed: async () => (await ctx.skill.list(location)).data.map(skill => ({ id: String(skill.id), path: String(skill.path) })), own: skills.map(skill => ({ id: skill.id, path: skill.path })) },
        shipped: SKILLS,
      })
      await registerDefaultRules(ctx.agent, opts.access)
      await ctx.tool.transform(editor => {
        editor.namespace({ name: NAMESPACE, description: NAMESPACE_DESCRIPTION })
        for (const name of Object.keys(TOOLS) as ToolName[]) {
          editor.add({
            name,
            description: DESCRIPTIONS[name],
            input: INPUTS[name],
            // Each tool returns structured output, so it declares its output schema: OpenCode 2.2.5 fails a result
            // that carries `output` from a tool that declares none. The schema is the registry's, which the tools RPC
            // validates the same result against.
            output: descriptor(name).output,
            options: { namespace: NAMESPACE, permission: `${NAMESPACE}_${name}` },
            execute: async (input: unknown, context: { sessionID: string; agent: string; messageID: string; id: string }) => {
              const assert = (action: string, resources: readonly string[]) =>
                ctx.permission.assert({ sessionID: context.sessionID, agent: context.agent, source: { type: "tool", messageID: context.messageID, id: context.id }, action, resources: [...resources], save: ["*"] } as never)
              const assertFiles = async (action: "read" | "edit", resources: readonly string[]) => { await assert(action, resources) }
              const env = { ...toolEnv, assertFiles }
              // The tool's own action first, on every call: every tool is allowed by default, and access or a rule can narrow it.
              await assert(permissionOf(name), ["*"])
              try {
                const result = await runTool(env, name, input)
                return { output: result.output, content: result.content }
              } catch (error) {
                if (isChartsError(error)) throw new ToolError({ message: error.message, metadata: { code: error.code, hint: error.hint, ...(error.path ? { path: error.path } : {}) } })
                if (error && typeof error === "object" && "issues" in error && (error as { name?: string }).name === "ZodError") throw new ToolError({ message: formatFailure("INPUT_INVALID", `The input does not match the tool's parameters: ${(error as unknown as Error).message}`, "Check the tool's parameters and call it again."), metadata: { code: "INPUT_INVALID" } })
                throw error
              }
            },
          } as never)
        }
      })
      // The tools RPC: every tool, callable by a script with no model, with each method's class from the registry.
      const stopRpc = await registerChartsRpc(ctx as never, { ctx, env: toolEnv, version })
      await ctx.command.transform(commandTransform({ synthetic: input => ctx.session.synthetic(input), status }))
      // The status RPC: the same model the command prints, so the dialog and a script read one source.
      const stopStatus = await registerStatusRpc(ctx.rpc, status, formatStatus)
      await ctx.skill.transform(editor => { for (const skill of skills) editor.add(skill as never) })
      return async () => {
        await stopStatus()
        await stopRpc()
        await closeVegaWorker()
      }
    },
  }
}
