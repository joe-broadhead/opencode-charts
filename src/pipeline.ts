import { join } from "node:path"
import { applyTransforms, describeProfile, loadData, type DataInput, type Profile, type Row } from "./data.js"
import { compactSpec, isObject, substituteThemeColours, type Json } from "./engines/common.js"
import { prepareECharts, renderECharts, serialisableOption } from "./engines/echarts.js"
import { prepareVega, renderVega } from "./engines/vega.js"
import { compileVegaLite, prepareVegaLite, units } from "./engines/vegalite.js"
import { publish, type Artifact } from "./artifacts.js"
import { ChartsError, SpecInvalid, type Issue } from "./errors.js"
import { bundledFonts, readCustomFonts, withCustomFonts, type FontBook } from "./fonts.js"
import { buildHtml, htmlProblem } from "./html.js"
import { resolveLocale } from "./locale.js"
import { confine, slug, type Workspace } from "./paths.js"
import { pngProblem, svgTextToPaths, svgToPng } from "./png.js"
import { checkRenderedSvg, checkSpec, LIMITS, type Engine } from "./safety.js"
import { figureOf, markedSvg, type Figure } from "./figure.js"
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
  /**
   * A test seam for failure injection, never set by the plugin: called before each output is prepared (`svg`, `png`,
   * `html`, `spec`, `preview`) and before each file is moved into place (`commit`, with its name). Throwing simulates
   * that step failing.
   */
  readonly probe?: (step: "svg" | "png" | "html" | "spec" | "preview" | "commit", file?: string) => void
  /** Asks the host for permission on workspace files; a tool call always has it, so a theme's font files are asserted before they are read. */
  readonly assertFiles?: (action: "read" | "edit", resources: readonly string[]) => Promise<void>
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

/** The approved faces to embed in SVG and HTML: the ones the drawing names plus the theme's families. */
const embeddable = (fonts: FontBook, svg: string, theme: ThemeTokens) => fonts.resourcesFor(svg, [theme.font.family, theme.font.mono])

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

  // Preflight, before any work: the formats and scales asked for, the runtimes they need, and the output folder. A
  // render stops at the first problem; a check reports each one as an invalid result. Nothing here touches the disk.
  const formats = new Set<Format>(request.formats ?? ["svg", "png", "spec"])
  const checked = write ? formats : new Set<Format>(request.formats ?? [])
  const scales = [...new Set(request.scales ?? [2])]
  const preflight: { problem: ChartsError; path: string }[] = []
  for (const scale of scales) if (![1, 2, 3].includes(scale)) preflight.push({ problem: new ChartsError("SCALE_INVALID", `PNG scale ${scale} is not 1, 2 or 3.`, "Use scales such as [1, 2, 3].", "/scales"), path: "/scales" })
  const outDir = request.outDir ?? env.defaults.outDir
  try { confine(env.workspace, outDir, "write") } catch (error) { if (error instanceof ChartsError) preflight.push({ problem: error, path: "/outDir" }); else throw error }
  if (checked.has("html")) { const problem = htmlProblem(env.packageRoot); if (problem) preflight.push({ problem, path: "/formats" }) }
  if (checked.has("png") || request.preview || (write && request.svgText === "paths")) { const problem = pngProblem(env.packageRoot); if (problem) preflight.push({ problem, path: checked.has("png") ? "/formats" : "/inspect" }) }
  if (write && preflight.length) throw preflight[0]!.problem

  // Data.
  let rows: Row[] | undefined, dataSource: string | undefined
  if (request.data && (request.data.rows || request.data.path)) {
    const loaded = await loadData(env.workspace, request.data)
    rows = loaded.rows; dataSource = loaded.source
  } else if (request.data?.transform) throw new ChartsError("DATA_MISSING", "data.transform was given without data.rows or data.path.", "Put the transform in the spec, or pass the rows it applies to.")
  const dataName = request.data?.name ?? "table"

  // Theme and fonts.
  const theme = resolveTheme({ workspace: env.workspace, configured: env.configuredThemes }, request.theme ?? env.defaults.theme)
  let fonts: FontBook = bundledFonts(env.packageRoot)
  if (theme.font.files.length) fonts = withCustomFonts(fonts, await readCustomFonts(env.workspace, theme.font.files, env.assertFiles ? paths => env.assertFiles!("read", paths) : undefined))
  const locale = resolveLocale(env.packageRoot, request.locale ?? env.defaults.locale ?? "en-US", request.currency)
  const issues: Issue[] = [...preflight.map(({ problem, path }): Issue => ({ level: "error", code: problem.code, message: problem.detail, path, fix: problem.hint })), ...themeContrastIssues(theme), ...sizeOverrides(request, engine)]
  const notes: string[] = []
  if (!fonts.has(theme.font.family)) issues.push({ level: "warning", code: "FONT_NOT_BUNDLED", message: `The font "${theme.font.family}" is not available, so Inter is used.`, path: "/theme/font/family", fix: `Use Inter or JetBrains Mono, or add the font file with theme.font.files.` })

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
    for (const w of compiled.warnings) issues.push({ level: "warning", code: "VEGA_LITE_WARNING", message: w, ...(FIT_WARNING.test(w) ? { fix: FIT_FIX } : {}) })
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
  const name = slug(request.name ?? title)
  const defaultFamily = fonts.has(theme.font.family) ? theme.font.family : "Inter"
  // A PNG over the pixel limit is known from the drawing's size: refuse it before any file is made.
  if (checked.has("png")) for (const scale of scales) if (width! * height! * scale * scale > LIMITS.pngPixels) {
    const problem = new ChartsError("PNG_TOO_LARGE", `A ${Math.round(width! * scale)}×${Math.round(height! * scale)} PNG is over the size limit.`, "Use a smaller scale or a smaller chart.")
    if (write) throw problem
    throw new SpecInvalid([...issues, { level: "error", code: problem.code, message: problem.detail, path: "/scales", fix: problem.hint }])
  }

  // Every requested file, and the preview, is made in memory first; only then is anything written.
  const artifacts: Artifact[] = []
  const step = (kind: "svg" | "png" | "html" | "spec" | "preview") => env.probe?.(kind)
  if (write) {
    if (formats.has("svg")) {
      step("svg")
      let svgOut = svg
      if (request.svgText === "paths") svgOut = normaliseIds(accessible(await svgTextToPaths(env.packageRoot, svg, fonts, defaultFamily), title, description))
      else if (request.svgText === "embed") svgOut = embedFonts(svg, embeddable(fonts, svg, theme))
      artifacts.push({ kind: "svg", file: `${name}.svg`, bytes: svgOut })
    }
    if (formats.has("png")) for (const [i, scale] of scales.entries()) {
      step("png")
      const { png } = await svgToPng(env.packageRoot, svg, fonts, scale, defaultFamily)
      artifacts.push({ kind: "png", file: i === 0 ? `${name}.png` : `${name}@${scale}x.png`, bytes: png })
    }
    if (formats.has("html")) {
      step("html")
      artifacts.push({ kind: "html", file: `${name}.html`, bytes: buildHtml(env.packageRoot, engine === "echarts"
        ? { engine: "echarts", spec: serialisableOption(echartsOption!), svg, title, description, theme, echartsTheme: echartsTheme(theme), fonts: embeddable(fonts, svg, theme), compactSpec: compactSpec(locale.currency ? locale.number.currency : undefined, locale.number.decimal), localeId: locale.id }
        : { engine: "vega", spec: vegaSpec!, svg, title, description, theme, fonts: embeddable(fonts, svg, theme), compactSpec: "", localeId: locale.id }) })
    }
    if (formats.has("spec")) {
      step("spec")
      artifacts.push({ kind: "spec", file: `${name}.${engine === "vega-lite" ? "vl" : engine === "vega" ? "vg" : "echarts"}.json`, bytes: JSON.stringify(resolvedSpec, null, 1) + "\n" })
    }
  }
  if (request.preview) {
    step("preview")
    // The same ids the figure tree names, drawn on the picture, so "n7 runs past the edge" points at one label.
    const marked = request.marks === "none" ? svg : markedSvg(svg, figure, { which: request.marks ?? "problems", font: `${defaultFamily}, sans-serif` })
    preview = (await svgToPng(env.packageRoot, marked, fonts, 1, defaultFamily)).png
  }
  if (write && artifacts.length) {
    const written = publish(env.workspace, outDir, artifacts, file => env.probe?.("commit", file))
    artifacts.forEach((artifact, i) => {
      if (artifact.kind === "png") files.png.push(written[i]!)
      else files[artifact.kind] = written[i]!
    })
  }
  const shown = files.png[0] ?? files.svg
  return {
    engine, theme: theme.name, title, description, width: width!, height: height!, files,
    ...(shown ? { markdown: `![${title.replace(/[\[\]]/g, "")}](${shown})` } : {}),
    summary: [description, profile ? `Data: ${dataSource ?? "inline"}; ${describeProfile(profile)}` : ""].filter(Boolean).join(" "),
    issues, notes, layout, ms: Math.round(performance.now() - started), ...(preview ? { preview } : {}), svg, resolvedSpec, figure,
  }
}

/** Vega-Lite's warnings about autosize "fit", which needs a single or layered view with continuous size. */
const FIT_WARNING = /autosize|"fit|\bfit-[xy]\b/i
const FIT_FIX = "Autosize \"fit\" works only for a single or layered view with a continuous width and height: give numeric width and height, or leave autosize out (the default pads)."

/**
 * Where the spec's own size beats the tool's. The precedence is unchanged (the spec's size wins in Vega-Lite and Vega,
 * and a number in an ECharts option wins), but the caller hears about it, with both values and the path, instead of a
 * silent miss. A size that is not a pixel count (a signal, a step, "container") is quoted as written, never turned
 * into a number. Equal sizes say nothing.
 */
export function sizeOverrides(request: RenderRequest, engine: Engine): Issue[] {
  const issues: Issue[] = []
  for (const dim of ["width", "height"] as const) {
    const own = request.spec[dim]
    if (own === undefined) continue
    const path = `/spec/${dim}`
    const quoted = typeof own === "number" ? String(own) : JSON.stringify(own).slice(0, 120)
    const tool = request[dim]
    if (engine === "echarts" && typeof own !== "number") {
      // ECharts reads only a number here; anything else is dropped, so say which size was drawn instead.
      issues.push({ level: "warning", code: "SIZE_OVERRIDE_IGNORED", path, message: `The spec's ${dim} ${quoted} is not a pixel count, so it is ignored and the chart is drawn at the ${tool !== undefined ? `tool's ${dim} ${tool}` : `theme's default ${dim}`}.`, fix: `Pass ${dim} as a number of pixels, at ${path} or as the tool's ${dim}.` })
      continue
    }
    if (tool === undefined || own === tool) continue
    const what = typeof own === "number" ? `${dim} ${own}` : `${dim} ${quoted}, which is not a pixel count, so the engine sizes the chart from it`
    issues.push({ level: "warning", code: "SIZE_OVERRIDE_IGNORED", path, message: `The tool's ${dim} ${tool} is ignored: the spec sets ${what} at ${path}, and the spec's own size takes precedence.`, fix: `To draw at ${tool}, remove ${dim} from the spec (or set ${path} to ${tool}); to keep the spec's size, drop the tool's ${dim}.` })
  }
  return issues
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
