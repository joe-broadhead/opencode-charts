import * as z from "zod"
import { CATALOGUE, catalogueEntry } from "./catalogue.js"
import { loadData } from "./data.js"
import { ATLASES, type Json } from "./engines/common.js"
import { ChartsError, SpecInvalid, formatIssues, suggest, type Issue } from "./errors.js"
import { localeIds } from "./locale.js"
import { renderChart, type Environment, type RenderRequest, type RenderResult } from "./pipeline.js"
import { QUICK_TYPES, quickSpec } from "./quick.js"
import { builtinThemes, resolveTheme, saveTheme, savedThemeNames, THEME_DIR } from "./themes/store.js"

/** Tool names (without the `charts_` namespace prefix) and whether each only reads. */
export const TOOLS = {
  render: { readOnly: false },
  quick: { readOnly: false },
  validate: { readOnly: true },
  catalogue: { readOnly: true },
  themes: { readOnly: true },
  theme_save: { readOnly: false },
} as const
export type ToolName = keyof typeof TOOLS
export const NAMESPACE = "charts"
export const NAMESPACE_DESCRIPTION = "Deterministic charts from a spec: Vega-Lite, Vega or ECharts in; themed SVG, PNG and interactive HTML out, under outputs/charts. Validates and lints before drawing; never loads anything from the network."

const row = z.record(z.string(), z.unknown())
const dataSchema = z.strictObject({
  rows: z.array(row).max(100_000).optional().describe("Inline rows: [{\"region\":\"North\",\"revenue\":12}, …]."),
  path: z.string().max(1024).optional().describe("A workspace file instead of rows: .csv, .tsv, .json, .jsonl or .parquet (relative path, inside the workspace)."),
  format: z.enum(["csv", "tsv", "json", "jsonl", "parquet"]).optional().describe("Only when the extension does not say."),
  transform: z.array(row).max(50).optional().describe("Vega-Lite transforms applied to the rows first: filter, calculate, aggregate, joinaggregate, window, pivot, fold, bin, timeUnit."),
  name: z.string().regex(/^[A-Za-z][\w-]{0,63}$/).optional().describe("The name the spec uses for these rows ({\"name\": \"table\"}); default table."),
}).describe("Data, kept out of the spec: rows or a workspace file.")
const outputs = {
  theme: z.union([z.string(), row]).optional().describe("A theme name (light, dark, high-contrast, print, presentation, toqan, toqan-night, or a saved one), or tokens with \"extends\"."),
  locale: z.string().max(16).optional().describe("Number and date formats, such as en-GB or de-DE. Default en-US."),
  currency: z.string().length(3).optional().describe("ISO 4217 code (EUR, USD, GBP…): money-like fields get it, in compact form (€1.2M)."),
  currencyFields: z.array(z.string()).max(50).optional().describe("Exactly which fields are money; default: fields whose names look like money."),
  formats: z.array(z.enum(["svg", "png", "html", "spec"])).max(4).optional().describe("Files to write. Default svg, png and spec; add html for an interactive, offline page."),
  scales: z.array(z.union([z.literal(1), z.literal(2), z.literal(3)])).max(3).optional().describe("PNG pixel densities. Default [2]."),
  name: z.string().max(80).optional().describe("File name stem; default from the title."),
  title: z.string().max(200).optional(),
  description: z.string().max(1000).optional().describe("Alt text. Default: generated from the spec and the data."),
  outDir: z.string().max(512).optional().describe("Workspace folder for the files; default outputs/charts."),
  svgText: z.enum(["text", "paths", "embed"]).optional().describe("SVG text as text (default, small, selectable), paths (exact anywhere) or embed (fonts inside the SVG)."),
  seed: z.number().int().min(0).max(2 ** 31).optional().describe("Seed for force and word-cloud layouts; same seed, same picture."),
  width: z.number().int().min(20).max(4000).optional(),
  height: z.number().int().min(20).max(4000).optional(),
  inspect: z.boolean().optional().describe("Return the rendered PNG for you to look at. Default: only when there are warnings."),
}

export const INPUTS = {
  render: z.strictObject({
    spec: row.describe("A Vega-Lite spec (mark/encoding/layer/facet…), a Vega spec (marks/scales/signals) or an ECharts option (series). Leave data out and pass it in data; use {\"name\": \"table\"} where the spec names it, {\"atlas\": \"world-110m\"} for maps, and \"theme:positive\"-style colour tokens."),
    engine: z.enum(["vega-lite", "vega", "echarts"]).optional().describe("Default: detected from the spec."),
    data: dataSchema.optional(),
    ...outputs,
  }),
  quick: z.strictObject({
    type: z.enum(QUICK_TYPES).describe("The chart type."),
    data: dataSchema,
    x: z.string().optional().describe("Category or date field (the slice field for pie/donut; the measured field for histogram)."),
    y: z.string().optional().describe("Value field (the measure for pie/donut)."),
    color: z.string().optional().describe("Series or group field (the row field for heatmap)."),
    size: z.string().optional().describe("Bubble size field."),
    aggregate: z.enum(["sum", "mean", "median", "min", "max", "count"]).optional(),
    sort: z.boolean().optional().describe("Rank categories by value."),
    temporal: z.boolean().optional().describe("x holds dates (default: guessed)."),
    xTitle: z.string().max(120).optional(),
    yTitle: z.string().max(120).optional().describe("Include the unit, such as \"Revenue (€k)\"."),
    bins: z.number().int().min(2).max(200).optional(),
    ...outputs,
  }),
  validate: z.strictObject({
    spec: row,
    engine: z.enum(["vega-lite", "vega", "echarts"]).optional(),
    data: dataSchema.optional(),
    theme: outputs.theme, locale: outputs.locale, currency: outputs.currency, width: outputs.width, height: outputs.height,
    inspect: z.boolean().optional().describe("Return the rendered PNG. Default true."),
  }),
  catalogue: z.strictObject({
    id: z.string().max(64).optional().describe("One chart type, with its full example spec and data."),
    family: z.enum(["comparison", "trend", "distribution", "part-to-whole", "relationship", "flow", "hierarchy", "map", "text"]).optional(),
  }),
  themes: z.strictObject({ name: z.string().max(64).optional().describe("Show one theme's full tokens (to copy into a custom theme).") }),
  theme_save: z.strictObject({
    name: z.string().regex(/^[a-z0-9][a-z0-9-]{0,47}$/).describe("Lowercase name, such as acme-brand."),
    theme: row.describe("Tokens to override, with \"extends\" naming the base theme (default light): colors (background, text, muted, grid, axis, categorical[], sequential[], diverging[], positive, negative, neutral, highlight), font (family, mono, size, titleSize, labelSize, titleWeight, files[{family, weight, path}]), layout, axis, marks, legend."),
  }),
} as const

export const DESCRIPTIONS: Record<ToolName, string> = {
  render: "Render any chart from a spec: Vega-Lite for statistical charts (bar, line, area, scatter, facets, layers, maps), Vega for treemap, sunburst, tree, force network and word cloud, ECharts for Sankey, chord, gauge, funnel, calendar, candlestick, radar and parallel. Validates first and explains each problem with its JSON path and a fix; lints for misleading or unreadable charts; writes SVG, PNG (and optional interactive HTML) under outputs/charts and returns a markdown image line to show it inline. Start from charts_catalogue's examples.",
  quick: "A standard chart from a type and field names — bar, horizontal_bar, grouped_bar, stacked_bar, line, area, stacked_area, scatter, bubble, pie, donut, histogram, box_plot, heatmap — with the same theme, checks and files as charts_render. Returns the spec it built, to refine with charts_render.",
  validate: "Check a spec without writing files: the same validation, lint and layout checks as charts_render (unknown fields with did-you-mean, overlapping or clipped labels, too many slices…), and by default the rendered PNG to look at. Use it to fix a chart before rendering the final files.",
  catalogue: "List every chart type this plugin draws, by family, with when to use it, its engine and a tiny example; with an id, the full working example (spec and data) to adapt.",
  themes: "List the built-in and saved themes; with a name, that theme's full tokens (colours, fonts, sizes) to copy into a custom theme.",
  theme_save: `Save a custom theme (a brand) by name in the workspace (${THEME_DIR}/<name>.json), so every chart can use it with theme: "<name>". Checks the tokens and their contrast first.`,
}

// ---------------------------------------------------------------------------------------------------------------

export interface ToolEnvironment extends Environment {
  /** Asks the host for permission on workspace files: `read` for inputs, `edit` for outputs. */
  readonly assertFiles: (action: "read" | "edit", resources: readonly string[]) => Promise<void>
}
export type Content = { type: "text"; text: string } | { type: "file"; uri: string; mime: string; name?: string }
export interface ToolOutput { readonly output: Json; readonly content: Content[] }

const ARTIFACT_HINT = "To hand a file to the person, save it with your host's artifact tool (in Jelly: jelly_artifact_save with the path); files under outputs/ are also kept when the turn ends."

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
    ...(wrote ? [ARTIFACT_HINT] : []),
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
      warnings: result.issues.filter(i => i.level === "warning"), notes: result.notes, layout: result.layout, ms: result.ms, ...extra,
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
  const keys = ["theme", "locale", "currency", "currencyFields", "formats", "scales", "name", "title", "description", "outDir", "svgText", "seed", "width", "height"] as const
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
      const sources = { workspace: env.workspace, packageRoot: env.packageRoot, configured: env.configuredThemes }
      if (input.name) {
        const theme = resolveTheme(sources, String(input.name))
        return { output: { theme } as unknown as Json, content: [{ type: "text", text: `Theme ${theme.name}: ${theme.description ?? ""}\nTokens (copy any subset into a custom theme with "extends": "${theme.name}"):\n${JSON.stringify(theme, null, 1)}` }] }
      }
      const builtins = builtinThemes(env.packageRoot)
      const saved = savedThemeNames(sources)
      return { output: { builtin: Object.values(builtins).map(t => ({ name: t.name, mode: t.mode, description: t.description })), saved, locales: localeIds(env.packageRoot) }, content: [{ type: "text", text: `Built-in themes:\n${Object.values(builtins).map(t => `- ${t.name} (${t.mode}): ${t.description}`).join("\n")}\nSaved themes: ${saved.length ? saved.join(", ") : "none"} (charts_theme_save makes one).\nFonts bundled: Inter, Geist, JetBrains Mono. A theme can add workspace .ttf/.otf files with font.files.` }] }
    }
    case "theme_save": {
      await env.assertFiles("edit", [`${THEME_DIR}/${input.name}.json`])
      const sources = { workspace: env.workspace, packageRoot: env.packageRoot, configured: env.configuredThemes }
      const { file, theme } = saveTheme(sources, String(input.name), input.theme as never)
      const { themeContrastIssues } = await import("./themes/contrast.js")
      const issues: Issue[] = themeContrastIssues(theme)
      return { output: { file, theme: theme as unknown as Json, warnings: issues as unknown as Json }, content: [{ type: "text", text: `Saved theme "${theme.name}" to ${file}. Use it with theme: "${theme.name}".${issues.length ? `\nContrast warnings:\n${formatIssues(issues)}` : " Contrast checks pass."}` }] }
    }
  }
}
