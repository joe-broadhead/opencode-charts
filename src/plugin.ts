import { readFile } from "node:fs/promises"
import { join } from "node:path"
import type { Plugin } from "@opencode/plugin"
import { Error as ToolError } from "@opencode/plugin/promise/tool"
import { closeVegaWorker } from "./engines/vega-pool.js"
import { isChartsError } from "./errors.js"
import { DESCRIPTIONS, INPUTS, NAMESPACE, NAMESPACE_DESCRIPTION, TOOLS, runTool, type ToolName } from "./tools.js"
import type { ThemeOverrides } from "./themes/tokens.js"

export const PLUGIN_ID = "charts"
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
}

function options(raw: unknown): ChartsOptions {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>
  return {
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
    console.warn(`SKILLS_INVALID: The skill ${id} is missing or malformed, so it was skipped. Reinstall the plugin.`)
    return undefined
  }
}

export function createPlugin({ packageRoot }: { packageRoot: string }): Plugin.Plugin {
  return {
    id: PLUGIN_ID,
    async setup(ctx) {
      const opts = options(ctx.options)
      const skills = (await Promise.all(SKILLS.map(id => loadSkill(packageRoot, id)))).filter(s => s !== undefined)
      await ctx.tool.transform(editor => {
        editor.namespace({ name: NAMESPACE, description: NAMESPACE_DESCRIPTION })
        for (const name of Object.keys(TOOLS) as ToolName[]) {
          editor.add({
            name,
            description: DESCRIPTIONS[name],
            input: INPUTS[name],
            options: { namespace: NAMESPACE, permission: `${NAMESPACE}_${name}`, ...(name === "render" || name === "quick" ? { pinned: true } : {}) },
            execute: async (input: unknown, context: { sessionID: string; agent: string; messageID: string; id: string }) => {
              const assertFiles = async (action: "read" | "edit", resources: readonly string[]) => {
                await ctx.permission.assert({ sessionID: context.sessionID, agent: context.agent, source: { type: "tool", messageID: context.messageID, id: context.id }, action, resources: [...resources], save: ["*"] } as never)
              }
              const env = {
                workspace: { directory: ctx.location.directory, projectDirectory: ctx.location.project.directory },
                packageRoot,
                configuredThemes: opts.themes ?? {},
                defaults: { ...(opts.theme ? { theme: opts.theme } : {}), ...(opts.locale ? { locale: opts.locale } : {}), outDir: opts.outDir ?? "outputs/charts" },
                assertFiles,
              }
              try {
                const result = await runTool(env, name, input)
                return { output: result.output, content: result.content }
              } catch (error) {
                if (isChartsError(error)) throw new ToolError({ message: error.message, metadata: { code: error.code, hint: error.hint, ...(error.path ? { path: error.path } : {}) } })
                if (error && typeof error === "object" && "issues" in error && (error as { name?: string }).name === "ZodError") throw new ToolError({ message: `INPUT_INVALID: ${(error as unknown as Error).message} Check the tool's parameters.`, metadata: { code: "INPUT_INVALID" } })
                throw error
              }
            },
          } as never)
        }
      })
      await ctx.skill.transform(editor => { for (const skill of skills) editor.add(skill as never) })
      return async () => { await closeVegaWorker() }
    },
  }
}
