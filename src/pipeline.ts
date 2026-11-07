import { readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { applyTransforms, describeProfile, loadData, type DataInput, type Profile, type Row } from "./data.js"
import { compactSpec, isObject, substituteThemeColours, type Json } from "./engines/common.js"
import { prepareECharts, renderECharts, serialisableOption } from "./engines/echarts.js"
import { prepareVega, renderVega } from "./engines/vega.js"
import { compileVegaLite, prepareVegaLite, units } from "./engines/vegalite.js"
import { ChartsError, SpecInvalid, type Issue } from "./errors.js"
import { BUNDLED, bundledFonts, withCustomFonts, type FontBook } from "./fonts.js"
import { buildHtml } from "./html.js"
import { resolveLocale } from "./locale.js"
import { confine, ensureDirectory, slug, type Workspace } from "./paths.js"
import { svgTextToPaths, svgToPng } from "./png.js"
import { checkRenderedSvg, checkSpec, LIMITS, type Engine } from "./safety.js"
import { figureOf, figureJson, markedSvg, type Figure } from "./figure.js"
import { accessible, embedFonts, layoutFacts, normaliseIds, textBoxes, textProblems, type LayoutFacts } from "./svg.js"
import { echartsTheme } from "./themes/adapters.js"
import { themeContrastIssues } from "./themes/contrast.js"
import { resolveTheme, type ThemeSources } from "./themes/store.js"
import type { ThemeOverrides, ThemeTokens } from "./themes/tokens.js"

export type Format = "svg" | "png" | "html" | "spec"

export interface RenderRequest {
  readonly spec: Json
  readonly engine?: Engine
  readonly data?: DataInput & { readonly name?: string }
  readonly theme?: string | ThemeOverrides
  readonly locale?: string
  readonly currency?: string
  readonly currencyFields?: readonly string[]
  readonly formats?: readonly Format[]
  readonly scales?: readonly number[]
  readonly name?: string
  readonly title?: string
  readonly description?: string
  readonly outDir?: string
  readonly svgText?: "text" | "paths" | "embed"
  readonly seed?: number
  readonly width?: number
  readonly height?: number
  /** Also render a 1x PNG for the model to look at. */
  readonly preview?: boolean
  /** Which labels to number on the preview PNG: those that collide or clip (default), all, or none. */
  readonly marks?: "problems" | "all" | "none"
}

export interface Environment {
  readonly workspace: Workspace
  readonly packageRoot: string
  readonly configuredThemes: ThemeSources["configured"]
  readonly defaults: { readonly theme?: string; readonly locale?: string; readonly outDir: string }
}

export interface RenderResult {
  readonly engine: Engine
  readonly theme: string
  readonly title: string
  readonly description: string
  readonly width: number
  readonly height: number
  readonly files: { readonly svg?: string; readonly png: readonly string[]; readonly html?: string; readonly spec?: string }
  readonly markdown?: string
  readonly summary: string
  readonly issues: readonly Issue[]
  readonly notes: readonly string[]
  readonly layout: LayoutFacts
  readonly ms: number
  /** The 1x PNG, for the model to look at; not written anywhere. */
  readonly preview?: Uint8Array
  readonly svg: string
  readonly resolvedSpec: Json
  /** What the drawing contains, with an id per label that the marked preview repeats. */
  readonly figure: Figure
}

/** Vega-Lite has `mark` or a composition; Vega has `marks`; ECharts has `series`. */
export function detectEngine(spec: Json): Engine {
  const schema = typeof spec.$schema === "string" ? spec.$schema : ""
  if (/vega-lite/.test(schema)) return "vega-lite"
  if (/vega\/v\d/.test(schema)) return "vega"
  if (spec.series !== undefined) return "echarts"
  if (Array.isArray(spec.marks) || Array.isArray(spec.signals) || Array.isArray(spec.scales)) return "vega"
  return "vega-lite"
}

const fontFiles = (packageRoot: string, theme: ThemeTokens) => {
  const families = new Set([theme.font.family.toLowerCase(), theme.font.mono.toLowerCase()])
  return BUNDLED.filter(f => families.has(f.family.toLowerCase())).map(f => ({ family: f.family, weight: f.weight, woff2: new Uint8Array(readFileSync(join(packageRoot, "assets", "fonts", f.file.replace(/\.ttf$/, ".woff2")))) }))
}

function describeVegaLite(spec: Json, rows: readonly Row[] | undefined): string {
  const u = units(spec)[0]
  if (!u) return "A composite chart."
  const kinds: Record<string, string> = { bar: "Bar chart", line: "Line chart", area: "Area chart", point: "Scatter plot", circle: "Scatter plot", square: "Scatter plot", arc: "Pie chart", rect: "Heatmap", tick: "Strip plot", boxplot: "Box plot", geoshape: "Map", text: "Text chart", rule: "Rule chart", trail: "Trail chart", errorbar: "Error bars", errorband: "Error band" }
  const enc = (c: string) => (isObject(u.encoding[c]) ? (u.encoding[c] as Json) : undefined)
  const name = (d?: Json) => (d ? String(d.title ?? (d.aggregate === "count" ? "count" : d.aggregate ? `${d.aggregate} of ${d.field}` : d.field ?? "")) : "")
  const x = enc("x"), y = enc("y"), color = enc("color") ?? enc("theta")
  let text = kinds[u.mark ?? ""] ?? "Chart"
  const quant = [y, x].find(d => d?.type === "quantitative" || d?.aggregate), cat = [x, y].find(d => d && d !== quant)
  if (u.mark === "arc") text += ` of ${name(enc("theta"))} by ${name(enc("color"))}`
  else if (quant && cat) text += ` of ${name(quant)} by ${name(cat)}`
  else if (x || y) text += ` of ${[name(y), name(x)].filter(Boolean).join(" against ")}`
  if (color && u.mark !== "arc" && color.field) text += `, coloured by ${name(color)}`
  text += "."
  if (rows && quant && cat && typeof quant.field === "string" && typeof cat.field === "string" && (!quant.aggregate || quant.aggregate === "sum")) {
    const qf = quant.field, cf = cat.field
    const totals = new Map<string, number>()
    for (const r of rows) if (typeof r[qf] === "number") totals.set(String(r[cf]), (totals.get(String(r[cf])) ?? 0) + (r[qf] as number))
    if (totals.size >= 2 && cat.type !== "temporal") {
      const sorted = [...totals.entries()].sort((a, b) => b[1] - a[1])
      text += ` Highest: ${sorted[0]![0]} (${round(sorted[0]![1])}); lowest: ${sorted[sorted.length - 1]![0]} (${round(sorted[sorted.length - 1]![1])}).`
    } else if (totals.size >= 2) {
      const ordered = [...totals.entries()].sort((a, b) => a[0].localeCompare(b[0]))
      const first = ordered[0]!, last = ordered[ordered.length - 1]!
      const change = first[1] !== 0 ? ((last[1] - first[1]) / Math.abs(first[1])) * 100 : undefined
      text += ` From ${first[0]} (${round(first[1])}) to ${last[0]} (${round(last[1])})${change !== undefined ? `, ${change >= 0 ? "+" : ""}${change.toFixed(1)}%` : ""}.`
    }
  }
  return text
}
const round = (n: number) => (Math.abs(n) >= 100 ? Math.round(n).toLocaleString("en-US") : Number(n.toPrecision(3)).toString())

/** Validates and renders. With `write: false`, checks only (no files): the same issues, the same layout facts. */
export async function renderChart(request: RenderRequest, env: Environment, write = true): Promise<RenderResult> {
  const started = performance.now()
  if (!isObject(request.spec)) throw new ChartsError("SPEC_INVALID", "spec must be a JSON object.", "Pass a Vega-Lite spec, a Vega spec or an ECharts option as an object.")
  const engine = request.engine ?? detectEngine(request.spec)
  checkSpec(request.spec, engine)
  for (const [k, v] of [["width", request.width], ["height", request.height]] as const) if (v !== undefined && (v < 20 || v > LIMITS.dimension)) throw new ChartsError("SIZE_INVALID", `${k} ${v} is outside 20–${LIMITS.dimension}.`, "Pick a size in pixels within that range.")

  // Data.
  let rows: Row[] | undefined, dataSource: string | undefined
  if (request.data && (request.data.rows || request.data.path)) {
    const loaded = await loadData(env.workspace, request.data)
    rows = loaded.rows; dataSource = loaded.source
  } else if (request.data?.transform) throw new ChartsError("DATA_MISSING", "data.transform was given without data.rows or data.path.", "Put the transform in the spec, or pass the rows it applies to.")
  const dataName = request.data?.name ?? "table"

  // Theme and fonts.
  const theme = resolveTheme({ workspace: env.workspace, packageRoot: env.packageRoot, configured: env.configuredThemes }, request.theme ?? env.defaults.theme)
  let fonts: FontBook = bundledFonts(env.packageRoot)
  if (theme.font.files.length) fonts = withCustomFonts(fonts, theme.font.files.map(f => ({ family: f.family, weight: f.weight, bytes: new Uint8Array(readFileSync(confine(env.workspace, f.path, "read").absolute)) })))
  const locale = resolveLocale(env.packageRoot, request.locale ?? env.defaults.locale ?? "en-US", request.currency)
  const issues: Issue[] = [...themeContrastIssues(theme)]
  const notes: string[] = []
  if (!fonts.has(theme.font.family)) issues.push({ level: "warning", code: "FONT_NOT_BUNDLED", message: `The font "${theme.font.family}" is not available, so Inter is used.`, path: "/theme/font/family", fix: `Use Inter, Geist or JetBrains Mono, or add the font file with theme.font.files.` })

  const spec = substituteThemeColours(request.spec, { ...theme.colors, font: theme.font.family, mono: theme.font.mono }) as Json

  // Prepare, validate, lint, compile, render.
  let svg: string, width: number, height: number, resolvedSpec: Json, vegaSpec: Json | undefined, echartsOption: Json | undefined, profile: Profile | undefined
  let description = request.description
  const title = request.title ?? (typeof request.spec.title === "string" ? request.spec.title : isObject(request.spec.title) && typeof (request.spec.title as Json).text === "string" ? String((request.spec.title as Json).text) : undefined) ?? "Chart"
  if (engine === "vega-lite") {
    const prepared = prepareVegaLite(spec, { packageRoot: env.packageRoot, theme, fonts, locale, ...(rows ? { rows } : {}), dataName, ...(request.title ? { title: request.title } : {}), ...(request.description ? { description: request.description } : {}), currencyFields: request.currencyFields ?? true, ...(request.width ? { width: request.width } : {}), ...(request.height ? { height: request.height } : {}) })
    issues.push(...prepared.issues); notes.push(...prepared.notes)
    if (issues.some(i => i.level === "error")) throw new SpecInvalid(issues)
    profile = prepared.profile
    const compiled = compileVegaLite(prepared.spec)
    for (const w of compiled.warnings) issues.push({ level: "warning", code: "VEGA_LITE_WARNING", message: w })
    resolvedSpec = prepared.spec
    vegaSpec = compiled.vega
    const values = isObject(prepared.spec.data) && Array.isArray(prepared.spec.data.values) ? prepared.spec.data.values as Row[] : rows
    description ??= describeVegaLite(prepared.spec, values)
    if (!prepared.spec.description) { vegaSpec.description = description }
  } else if (engine === "vega") {
    const prepared = prepareVega(spec, { packageRoot: env.packageRoot, theme, locale, ...(rows ? { rows } : {}), dataName, ...(request.title ? { title: request.title } : {}), ...(request.description ? { description: request.description } : {}), ...(request.width ? { width: request.width } : {}), ...(request.height ? { height: request.height } : {}) })
    issues.push(...prepared.issues)
    if (issues.some(i => i.level === "error")) throw new SpecInvalid(issues)
    profile = prepared.profile
    resolvedSpec = prepared.spec
    vegaSpec = prepared.spec
  } else {
    const prepared = prepareECharts(spec, { theme, locale, ...(rows ? { rows } : {}), ...(request.title ? { title: request.title } : {}), ...(request.description ? { description: request.description } : {}), ...(request.width ? { width: request.width } : {}), ...(request.height ? { height: request.height } : {}) })
    issues.push(...prepared.issues)
    if (issues.some(i => i.level === "error")) throw new SpecInvalid(issues)
    profile = prepared.profile
    echartsOption = prepared.option
    resolvedSpec = { ...serialisableOption(prepared.option), width: prepared.width, height: prepared.height }
    svg = renderECharts(prepared.option, theme, fonts, prepared.width, prepared.height)
    width = prepared.width; height = prepared.height
  }
  if (vegaSpec) {
    const out = await renderVega(vegaSpec, fonts, request.seed ?? 1)
    svg = out.svg
    width = Math.round(Number(/<svg[^>]*\swidth="([\d.]+)"/.exec(svg)?.[1] ?? out.width))
    height = Math.round(Number(/<svg[^>]*\sheight="([\d.]+)"/.exec(svg)?.[1] ?? out.height))
    for (const w of out.warnings) issues.push({ level: "warning", code: "VEGA_WARNING", message: w })
  }
  description ??= `${title}.${profile ? ` ${describeProfile(profile)}` : ""}`
  checkRenderedSvg(svg!)
  svg = normaliseIds(accessible(svg!, title, description))

  // One measurement of the drawing feeds both the figure tree and the layout facts, and every pair is tested once.
  const measured = textBoxes(svg!, fonts)
  const problems = textProblems(measured.boxes, measured.width, measured.height)
  const figure = figureOf(svg!, fonts, measured, problems)
  const layout = layoutFacts(svg!, fonts, measured, problems)
  // A glyph no bundled face draws becomes a blank box unless the reader brings a font; say so, with the characters.
  const uncovered = uncoveredGlyphs(svg!, fonts)
  if (uncovered.length) issues.push({ level: "warning", code: "FONT_GLYPH_MISSING", message: `The bundled fonts have no glyph for ${uncovered.slice(0, 8).map(c => `"${c}"`).join(", ")}${uncovered.length > 8 ? ` and ${uncovered.length - 8} more` : ""}, so they draw as blank boxes.`, fix: "Add a font that covers the script with theme.font.files, or translate the labels." })
  if (layout.overlaps.length) issues.push({ level: "warning", code: "LABEL_COLLISION", message: `${layout.overlaps.length} pair(s) of labels overlap, e.g. "${layout.overlaps[0]![0]}" and "${layout.overlaps[0]![1]}".`, fix: "Angle or thin the labels (axis.labelAngle, labelOverlap), shorten them, widen the chart, or switch to horizontal bars." })
  if (layout.clipped.length) issues.push({ level: "warning", code: "LABEL_CLIPPED", message: `${layout.clipped.length} label(s) run past the edge, e.g. "${layout.clipped[0]}".`, fix: "Add padding, shorten the labels, or set a larger width/height." })

  // Axis labels that repeat ("7% 7% 8%") mean the format is too coarse for the tick step.
  for (const group of svg.matchAll(/class="mark-text role-axis-label"[^>]*>(.*?)<\/g>/g)) {
    const labels = [...group[1]!.matchAll(/<text\b[^>]*>([^<]*)<\/text>/g)].map(m => m[1])
    const repeated = labels.find((l, i) => i > 0 && l === labels[i - 1])
    if (repeated !== undefined) { issues.push({ level: "warning", code: "DUPLICATE_TICKS", message: `An axis repeats the label "${repeated}": its format is coarser than the tick step.`, fix: "Use a finer format (\".1%\", \",.1f\") or fewer ticks (axis.tickCount)." }); break }
  }

  const files: { svg?: string; png: string[]; html?: string; spec?: string } = { png: [] }
  let preview: Uint8Array | undefined
  const formats = new Set(request.formats ?? ["svg", "png", "spec"])
  const name = slug(request.name ?? title)
  const defaultFamily = fonts.has(theme.font.family) ? theme.font.family : "Inter"
  if (write) {
    const dir = ensureDirectory(env.workspace, request.outDir ?? env.defaults.outDir)
    const out = (file: string, bytes: string | Uint8Array) => { writeFileSync(join(dir.absolute, file), bytes); return `${dir.relative === "." ? "" : dir.relative + "/"}${file}` }
    let svgOut = svg
    if (request.svgText === "paths") svgOut = normaliseIds(accessible(await svgTextToPaths(env.packageRoot, svg, fonts, defaultFamily), title, description))
    else if (request.svgText === "embed") svgOut = embedFonts(svg, fontFiles(env.packageRoot, theme))
    if (formats.has("svg")) files.svg = out(`${name}.svg`, svgOut)
    if (formats.has("png")) {
      const scales = [...new Set(request.scales ?? [2])]
      for (const [i, scale] of scales.entries()) {
        if (![1, 2, 3].includes(scale)) throw new ChartsError("SCALE_INVALID", `PNG scale ${scale} is not 1, 2 or 3.`, "Use scales such as [1, 2, 3].")
        const { png } = await svgToPng(env.packageRoot, svg, fonts, scale, defaultFamily)
        files.png.push(out(i === 0 ? `${name}.png` : `${name}@${scale}x.png`, png))
      }
    }
    if (formats.has("html")) {
      files.html = out(`${name}.html`, buildHtml(env.packageRoot, engine === "echarts"
        ? { engine: "echarts", spec: serialisableOption(echartsOption!), svg, title, description, theme, echartsTheme: echartsTheme(theme), fonts: fontFiles(env.packageRoot, theme), compactSpec: compactSpec(locale.currency ? locale.number.currency : undefined, locale.number.decimal), localeId: locale.id }
        : { engine: "vega", spec: vegaSpec!, svg, title, description, theme, fonts: fontFiles(env.packageRoot, theme), compactSpec: "", localeId: locale.id }))
    }
    if (formats.has("spec")) files.spec = out(`${name}.${engine === "vega-lite" ? "vl" : engine === "vega" ? "vg" : "echarts"}.json`, JSON.stringify(resolvedSpec, null, 1) + "\n")
  }
  if (request.preview) {
    // The same ids the figure tree names, drawn on the picture, so "n7 runs past the edge" points at one label.
    const marked = request.marks === "none" ? svg : markedSvg(svg, figure, { which: request.marks ?? "problems", font: `${defaultFamily}, sans-serif` })
    preview = (await svgToPng(env.packageRoot, marked, fonts, 1, defaultFamily)).png
  }
  const shown = files.png[0] ?? files.svg
  return {
    engine, theme: theme.name, title, description, width: width!, height: height!, files,
    ...(shown ? { markdown: `![${title.replace(/[\[\]]/g, "")}](${shown})` } : {}),
    summary: [description, profile ? `Data: ${dataSource ?? "inline"}; ${describeProfile(profile)}` : ""].filter(Boolean).join(" "),
    issues, notes, layout, ms: Math.round(performance.now() - started), ...(preview ? { preview } : {}), svg, resolvedSpec, figure,
  }
}

/** The distinct characters the SVG draws that no face in the book can: the ones that become blank boxes. */
function uncoveredGlyphs(svg: string, fonts: FontBook): string[] {
  const seen = new Set<string>()
  for (const match of svg.matchAll(/<text\b[^>]*>([\s\S]*?)<\/text>/g)) {
    const text = match[1]!.replace(/<[^>]+>/g, "")
    for (const char of text) {
      const cp = char.codePointAt(0)!
      if (cp < 0x20 || cp === 0x20 || seen.has(char)) continue
      if (!fonts.covers(cp)) seen.add(char)
    }
  }
  return [...seen].slice(0, 40)
}

export { applyTransforms }
