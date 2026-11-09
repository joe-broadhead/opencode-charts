import { CATALOGUE, catalogueEntry } from "./catalogue.js"
import { loadData } from "./data.js"
import { ATLASES, type Json } from "./engines/common.js"
import { ChartsError, SpecInvalid, formatIssues, suggest, type Issue } from "./errors.js"
import { capabilities, describeCapabilities } from "./capabilities.js"
import { localeIds } from "./locale.js"
import { renderChart, type Environment, type RenderRequest, type RenderResult } from "./pipeline.js"
import { quickSpec } from "./quick.js"
import { recommend } from "./recommend/rank.js"
import { figureJson, figureText } from "./figure.js"
import { DESCRIPTIONS, INPUTS, NAMESPACE, NAMESPACE_DESCRIPTION, TOOLS, type ToolName } from "./registry.js"
import { builtinThemes, resolveTheme, saveTheme, savedThemeNames, THEME_DIR } from "./themes/store.js"

export { DESCRIPTIONS, INPUTS, NAMESPACE, NAMESPACE_DESCRIPTION, TOOLS, type ToolName }

// ---------------------------------------------------------------------------------------------------------------

export interface ToolEnvironment extends Environment {
  /** Asks the host for permission on workspace files: `read` for inputs, `edit` for outputs. */
  readonly assertFiles: (action: "read" | "edit", resources: readonly string[]) => Promise<void>
}
export type Content = { type: "text"; text: string } | { type: "file"; uri: string; mime: string; name?: string }
export interface ToolOutput { readonly output: Json; readonly content: Content[] }

const SAVE_HINT = "To hand a file to the person, save it with your host's file-saving tool (in Jelly: jelly_file_save with the path); files under outputs/ are also kept when the turn ends."

function describeResult(r: RenderResult, wrote: boolean): string {
  const warnings = r.issues.filter(i => i.level === "warning")
  const lines = [
    `${wrote ? "Rendered" : "Checked"} "${r.title}" (${r.engine}, theme ${r.theme}, ${r.width}×${r.height}px) in ${r.ms} ms.`,
    ...(r.markdown ? [`Show it inline: ${r.markdown}`] : []),
    ...(wrote ? [`Files: ${[r.files.svg, ...r.files.png, r.files.html, r.files.spec].filter(Boolean).join(", ")}`] : []),
    `What it shows: ${r.summary}`,
    ...(r.notes.length ? [`Defaults applied: ${r.notes.join(" ")}`] : []),
    warnings.length ? `Warnings (${warnings.length}) — fix these before showing it:\n${formatIssues(warnings)}` : "No warnings.",
    `Layout: ${r.layout.texts} labels; ${r.layout.overlaps.length ? `${r.layout.overlaps.length} overlapping` : "none overlapping"}; ${r.layout.clipped.length ? `${r.layout.clipped.length} clipped` : "none clipped"}.`,
    figureText(r.figure),
    ...(wrote ? [SAVE_HINT] : []),
  ]
  return lines.join("\n")
}

const image = (png: Uint8Array, name: string): Content => ({ type: "file", uri: `data:image/png;base64,${Buffer.from(png).toString("base64")}`, mime: "image/png", name })

async function run(env: ToolEnvironment, request: RenderRequest, write: boolean, inspect: boolean | undefined, extra: Json = {}): Promise<ToolOutput> {
  if (request.data?.path) await env.assertFiles("read", [request.data.path])
  try {
    if (write) await env.assertFiles("edit", [`${request.outDir ?? env.defaults.outDir}/*`])
    // The 1x preview costs little; it is sent only when asked for, or when there is something to look at.
    const result = await renderChart({ ...request, preview: inspect !== false }, env, write)
    const show = inspect ?? (!write || result.issues.some(i => i.level === "warning"))
    const output: Json = {
      engine: result.engine, theme: result.theme, title: result.title, description: result.description, width: result.width, height: result.height,
      files: result.files, ...(result.markdown ? { markdown: result.markdown } : {}), summary: result.summary,
      warnings: result.issues.filter(i => i.level === "warning"), notes: result.notes, layout: result.layout,
      figure: figureJson(result.figure), ms: result.ms, ...extra,
    }
    const content: Content[] = [{ type: "text", text: describeResult(result, write) + (extra.spec ? `\nSpec used (refine it with charts_render):\n${JSON.stringify(extra.spec)}` : "") }]
    if (show && result.preview) content.push(image(result.preview, `${result.title}.png`))
    return { output, content }
  } catch (error) {
    if (error instanceof SpecInvalid && !write) return { output: { valid: false, issues: error.issues as unknown as Json }, content: [{ type: "text", text: `Not valid yet:\n${formatIssues(error.issues)}` }] }
    throw error
  }
}

const pickOutputs = (input: Record<string, unknown>): Partial<RenderRequest> => {
  const keys = ["theme", "locale", "currency", "currencyFields", "formats", "scales", "name", "title", "description", "outDir", "svgText", "seed", "width", "height", "marks"] as const
  return Object.fromEntries(keys.filter(k => input[k] !== undefined).map(k => [k, input[k]])) as Partial<RenderRequest>
}

export async function runTool(env: ToolEnvironment, name: ToolName, raw: unknown): Promise<ToolOutput> {
  const input = INPUTS[name].parse(raw) as Record<string, unknown> & { data?: RenderRequest["data"] }
  switch (name) {
    case "render": return run(env, { spec: input.spec as Json, ...(input.engine ? { engine: input.engine as RenderRequest["engine"] } : {}), ...(input.data ? { data: input.data } : {}), ...pickOutputs(input) }, true, input.inspect as boolean | undefined)
    case "validate": return run(env, { spec: input.spec as Json, ...(input.engine ? { engine: input.engine as RenderRequest["engine"] } : {}), ...(input.data ? { data: input.data } : {}), ...pickOutputs(input) }, false, (input.inspect as boolean | undefined) ?? true)
    case "quick": {
      if (input.data?.path) await env.assertFiles("read", [input.data.path])
      const loaded = await loadData(env.workspace, input.data!)
      const spec = quickSpec(input as never, loaded.rows)
      return run(env, { spec, data: { rows: loaded.rows }, ...pickOutputs(input) }, true, input.inspect as boolean | undefined, { spec })
    }
    case "recommend": {
      if (input.data?.path) await env.assertFiles("read", [input.data.path])
      const outcome = await recommend(input as never, env)
      return { output: outcome.result as unknown as Json, content: [{ type: "text", text: outcome.text }] }
    }
    case "capabilities": {
      const view = capabilities(env)
      return { output: view as unknown as Json, content: [{ type: "text", text: describeCapabilities(view) }] }
    }
    case "catalogue": {
      if (input.id) {
        const entry = catalogueEntry(String(input.id))
        if (!entry) throw new ChartsError("CHART_TYPE_UNKNOWN", `There is no chart type "${input.id}".${suggest(String(input.id), CATALOGUE.map(c => c.id)).map(s => ` Did you mean ${s}?`).join("")}`, "Call charts_catalogue without an id to list them.")
        const ex = entry.example()
        const call = { spec: ex.spec, ...(ex.rows ? { data: { rows: ex.rows } } : {}), title: ex.title, ...(ex.currency ? { currency: ex.currency } : {}) }
        return { output: { ...entry, example: call } as unknown as Json, content: [{ type: "text", text: `${entry.name} (${entry.engine}, ${entry.family}). Use it for: ${entry.when}${entry.avoid ? ` Avoid when: ${entry.avoid}` : ""}\nA working charts_render call — swap in your data and fields:\n${JSON.stringify(call)}` }] }
      }
      const list = CATALOGUE.filter(c => !input.family || c.family === input.family)
      const text = [`${list.length} chart types. Call charts_catalogue with an id for a full working example.`, ...[...new Set(list.map(c => c.family))].map(f => `\n${f}:\n${list.filter(c => c.family === f).map(c => `- ${c.id} — ${c.name} [${c.engine}]: ${c.when}${c.avoid ? ` Avoid: ${c.avoid}` : ""}`).join("\n")}`), `\nMaps use bundled atlases, never the network: ${Object.entries(ATLASES).map(([k, a]) => `${k} (${a.about} Join keys: ${a.keys})`).join("; ")}.`]
      return { output: { types: list.map(c => ({ id: c.id, name: c.name, engine: c.engine, family: c.family, when: c.when, ...(c.avoid ? { avoid: c.avoid } : {}) })) }, content: [{ type: "text", text: text.join("\n") }] }
    }
    case "themes": {
      const sources = { workspace: env.workspace, configured: env.configuredThemes }
      if (input.name) {
        const theme = resolveTheme(sources, String(input.name))
        return { output: { theme } as unknown as Json, content: [{ type: "text", text: `Theme ${theme.name}: ${theme.description ?? ""}\nTokens (copy any subset into a custom theme with "extends": "${theme.name}"):\n${JSON.stringify(theme, null, 1)}` }] }
      }
      const builtins = builtinThemes()
      const saved = savedThemeNames(sources)
      return { output: { builtin: Object.values(builtins).map(t => ({ name: t.name, mode: t.mode, description: t.description })), saved, locales: localeIds(env.packageRoot) }, content: [{ type: "text", text: `Built-in themes:\n${Object.values(builtins).map(t => `- ${t.name} (${t.mode}): ${t.description}`).join("\n")}\nSaved themes: ${saved.length ? saved.join(", ") : "none"} (charts_theme_save makes one).\nFonts bundled: Inter, JetBrains Mono. A theme can add workspace .ttf/.otf files with font.files.` }] }
    }
    case "theme_save": {
      await env.assertFiles("edit", [`${THEME_DIR}/${input.name}.json`])
      const sources = { workspace: env.workspace, configured: env.configuredThemes }
      const { file, theme } = saveTheme(sources, String(input.name), input.theme as never)
      const { themeContrastIssues } = await import("./themes/contrast.js")
      const issues: Issue[] = themeContrastIssues(theme)
      return { output: { file, theme: theme as unknown as Json, warnings: issues as unknown as Json }, content: [{ type: "text", text: `Saved theme "${theme.name}" to ${file}. Use it with theme: "${theme.name}".${issues.length ? `\nContrast warnings:\n${formatIssues(issues)}` : " Contrast checks pass."}` }] }
    }
  }
}
