import { join } from "node:path"
import { injectAnnotations, type Annotation } from "./annotations.js"
import { applyTransforms, describeProfile, loadData, type DataInput, type Profile, type Row } from "./data.js"
import { compactSpec, isObject, substituteThemeColours, type Json } from "./engines/common.js"
import { prepareECharts, renderECharts, serialisableOption } from "./engines/echarts.js"
import { extractTimelineFrameSvgOptions } from "./engines/echarts-custom.js"
import { DiagramSpecSchema, renderDiagram, type DiagramSpec } from "./engines/diagram.js"
import { atlasFeatures, compilePlotRecipe, renderPlot } from "./engines/plot.js"
import { renderTable, TableSpecSchema, type TableSpec } from "./engines/table.js"
import { prepareVega, renderVega } from "./engines/vega.js"
import { compileVegaLite, prepareVegaLite, units } from "./engines/vegalite.js"
import { publish, publishGeneration, type Artifact, type Generation } from "./artifacts.js"
import { detectEngine } from "./document/engine.js"
import { ChartsError, pointer, SpecInvalid, type Issue } from "./errors.js"
import { wrapFigureSvg } from "./figure-frame.js"
import { bundledFonts, readCustomFonts, withCustomFonts, type FontBook, type FontResource } from "./fonts.js"
import { buildHtml, htmlProblem } from "./html.js"
import { generateProgressiveRevealFrames, renderSvgFramesToGif } from "./motion/gif.js"
import { buildStoryHtml } from "./motion/story-html.js"
import { animateSvg, type MotionMode } from "./motion/svg-animate.js"
import { resolveLocale } from "./locale.js"
import { confine, slug, type Workspace } from "./paths.js"
import { pngProblem, svgTextToPaths, svgToPng } from "./png.js"
import { checkRenderedSvg, checkSpec, LIMITS } from "./safety.js"
import { figureOf, markedSvg, type Figure } from "./figure.js"
import { accessible, embedFonts, layoutFacts, normaliseIds, textBoxes, textProblems, type LayoutFacts } from "./svg.js"
import { echartsTheme } from "./themes/adapters.js"
import { makeAdaptiveSvg } from "./themes/adaptive-svg.js"
import { themeContrastIssues } from "./themes/contrast.js"
import { resolveThemePairAsked } from "./themes/chain.js"
import type { ThemeSources } from "./themes/store.js"
import type { ThemeOverrides, ThemeTokens } from "./themes/tokens.js"
import type { RuntimePresentation } from "./layout/present.js"
import { patchRecipeVega, plotBounds, type PlotBounds } from "./layout/vega.js"

export type Format = "svg" | "png" | "gif" | "html" | "spec"

/**
 * Every engine a render can dispatch to: the three chart engines plus the three offline drawing engines (Plot, a
 * publication table and a diagram). One pipeline validates, themes, measures and publishes all six alike.
 */
export type PipelineEngine = "vega-lite" | "vega" | "echarts" | "plot" | "table" | "diagram"

export interface RenderRequest {
  readonly spec: Json
  readonly engine?: PipelineEngine
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
  /** The small uppercase label above the headline: the editorial frame's first part. */
  readonly kicker?: string
  /** The standfirst below the headline: measure, period, population. */
  readonly subtitle?: string
  /** The footer's attribution line. */
  readonly source?: string
  /** The footer's definitions, revisions or cautions. */
  readonly notes?: string
  /** Reference lines, shaded bands and callouts drawn over the plot. */
  readonly annotations?: readonly Annotation[]
  /** Portable CSS motion added to the written SVG (never to the PNG). */
  readonly motion?: MotionMode
  /** A GIF's frames per second. */
  readonly fps?: number
  /** Also render a 1x PNG for the model to look at. */
  readonly preview?: boolean
  /** Which labels to number on the preview PNG: those that collide or clip (default), all, or none. */
  readonly marks?: "problems" | "all" | "none"
  /**
   * A chart document's resolved theme (its captured base with its overrides), used instead of resolving `theme`. Not a
   * tool field: only the document adapter sets it.
   */
  readonly themeTokens?: ThemeTokens
  /** A chart document's custom fonts, already read and checked against their captured digests; never read again here. */
  readonly fontResources?: readonly FontResource[]
  /** A saved chart artifact's text, written as `<name>.chart.json` in the same staged publication as the other files. */
  readonly document?: string
  /** A recipe document's layout plan and controls: the legend follows the plan's signals, and HTML can re-plan live. */
  readonly presentation?: RuntimePresentation
  /**
   * Publish the files as a new immutable generation folder, `<outDir>/<name>-<bundle digest prefix>/`, instead of the
   * flat legacy layout: charts_update's publication. Not a tool field.
   */
  readonly generation?: boolean
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
  readonly probe?: (step: "svg" | "png" | "html" | "spec" | "document" | "preview" | "commit", file?: string) => void
  /** Asks the host for permission on workspace files; a tool call always has it, so a theme's font files are asserted before they are read. */
  readonly assertFiles?: (action: "read" | "edit", resources: readonly string[]) => Promise<void>
}

export interface RenderResult {
  readonly engine: PipelineEngine
  readonly theme: string
  readonly title: string
  readonly description: string
  readonly width: number
  readonly height: number
  readonly files: { readonly svg?: string; readonly png: readonly string[]; readonly gif?: string; readonly html?: string; readonly spec?: string; readonly document?: string }
  readonly markdown?: string
  readonly summary: string
  readonly issues: readonly Issue[]
  readonly notes: readonly string[]
  readonly layout: LayoutFacts
  readonly ms: number
  /** The 1x PNG, for the model to look at; not written anywhere. */
  readonly preview?: Uint8Array
  readonly svg: string
  /** The written HTML page's own text, so a caller can hand it to the host's artifact surface without reading the file. */
  readonly html?: string
  /** A diagram's Unicode outline, for a terminal. */
  readonly ascii?: string
  readonly resolvedSpec: Json
  /** What the drawing contains, with an id per label that the marked preview repeats. */
  readonly figure: Figure
  /** The plot's measured bounds in the drawing (Vega and Vega-Lite): its origin and size, guides outside it. */
  readonly plot?: PlotBounds
  /** The generation folder the files were published in, when the request asked for one. */
  readonly generation?: Omit<Generation, "files">
}

/** One engine detection rule, shared with chart documents: Vega-Lite has `mark` or a composition; Vega has `marks`; ECharts has `series`. */
export { detectEngine }

/**
 * The engine a spec is drawn by, over all six the pipeline dispatches to: a Plot recipe (or a list of Plot marks) is
 * `plot`, a column list with no mark is a `table`, Mermaid source or a diagram kind is a `diagram`, and anything else
 * follows the chart engines' own rule.
 */
export function detectSpecEngine(spec: Json): PipelineEngine {
  const schema = typeof spec.$schema === "string" ? spec.$schema : ""
  const isVega = /vega\/v\d/.test(schema) || Array.isArray(spec.scales) || Array.isArray(spec.signals)
  if (spec.plotRecipe !== undefined || (!isVega && Array.isArray(spec.marks) && spec.marks.some(mark => isObject(mark) && (typeof (mark as Json).mark === "string" || (typeof (mark as Json).type === "string" && (mark as Json).from === undefined && (mark as Json).encode === undefined))))) return "plot"
  if (Array.isArray(spec.columns) && spec.mark === undefined && spec.facet === undefined && spec.spec === undefined) return "table"
  if (typeof spec.dsl === "string" || (typeof spec.kind === "string" && ["mindmap", "org_chart", "fishbone", "architecture"].includes(spec.kind))) return "diagram"
  return detectEngine(spec)
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
  if (!isObject(request.spec)) throw new ChartsError("SPEC_INVALID", "spec must be a JSON object.", "Pass a Vega-Lite spec, a Vega spec, an ECharts option, a Plot spec, a table spec or a diagram spec as an object.")
  const engine = request.engine ?? detectSpecEngine(request.spec)
  checkSpec(request.spec, engine)
  for (const [k, v] of [["width", request.width], ["height", request.height]] as const) if (v !== undefined && (v < 20 || v > LIMITS.dimension)) throw new ChartsError("SIZE_INVALID", `${k} ${v} is outside 20–${LIMITS.dimension}.`, "Pick a size in pixels within that range.")
  // An ECharts timeline option is a story: its frames become a GIF and an interactive page with one step per frame.
  const timeline = engine === "echarts" && isObject(request.spec.timeline) && Array.isArray(request.spec.options) ? request.spec : undefined

  // Preflight, before any work: the formats and scales asked for, the runtimes they need, and the output folder. A
  // render stops at the first problem; a check reports each one as an invalid result. Nothing here touches the disk.
  const formats = new Set<Format>(request.formats ?? ["svg", "png", "spec"])
  const checked = write ? formats : new Set<Format>(request.formats ?? [])
  const scales = [...new Set(request.scales ?? [2])]
  const preflight: { problem: ChartsError; path: string }[] = []
  for (const scale of scales) if (![1, 2, 3].includes(scale)) preflight.push({ problem: new ChartsError("SCALE_INVALID", `PNG scale ${scale} is not 1, 2 or 3.`, "Use scales such as [1, 2, 3].", "/scales"), path: "/scales" })
  const outDir = request.outDir ?? env.defaults.outDir
  try { confine(env.workspace, outDir, "write") } catch (error) { if (error instanceof ChartsError) preflight.push({ problem: error, path: "/outDir" }); else throw error }
  // An interactive page needs the browser runtimes for the chart engines; the three drawing engines' page is static.
  if (checked.has("html") && (engine === "vega-lite" || engine === "vega" || engine === "plot" || (engine === "echarts" && !timeline))) { const problem = htmlProblem(env.packageRoot); if (problem) preflight.push({ problem, path: "/formats" }) }
  const raster = checked.has("png") || checked.has("gif") || (!write && formats.has("gif"))
  if (raster || request.preview || (write && request.svgText === "paths")) { const problem = pngProblem(env.packageRoot); if (problem) preflight.push({ problem, path: checked.has("png") || checked.has("gif") ? "/formats" : "/inspect" }) }
  if (write && preflight.length) throw preflight[0]!.problem

  // Data.
  let rows: Row[] | undefined, dataSource: string | undefined
  if (request.data && (request.data.rows || request.data.path)) {
    const loaded = await loadData(env.workspace, request.data)
    rows = loaded.rows; dataSource = loaded.source
  } else if (request.data?.transform) throw new ChartsError("DATA_MISSING", "data.transform was given without data.rows or data.path.", "Put the transform in the spec, or pass the rows it applies to.")
  const dataName = request.data?.name ?? "table"

  // Theme and fonts.
  // A saved theme, and every theme it extends, is asked for (by the real path read) before it is read.
  const resolvedTheme = request.themeTokens
    ? { active: request.themeTokens }
    : await resolveThemePairAsked({ workspace: env.workspace, configured: env.configuredThemes }, (request.theme ?? env.defaults.theme) as never, env.assertFiles ? paths => env.assertFiles!("read", paths) : undefined)
  const theme = resolvedTheme.active
  const pairedThemes = resolvedTheme.paired
  let fonts: FontBook = bundledFonts(env.packageRoot)
  if (request.fontResources) { if (request.fontResources.length) fonts = withCustomFonts(fonts, request.fontResources) }
  else if (theme.font.files.length) fonts = withCustomFonts(fonts, await readCustomFonts(env.workspace, theme.font.files, env.assertFiles ? paths => env.assertFiles!("read", paths) : undefined))
  const locale = resolveLocale(env.packageRoot, request.locale ?? env.defaults.locale ?? "en-US", request.currency)
  const issues: Issue[] = [...preflight.map(({ problem, path }): Issue => ({ level: "error", code: problem.code, message: problem.detail, path, fix: problem.hint })), ...themeContrastIssues(theme), ...sizeOverrides(request, engine)]
  const notes: string[] = []
  if (!fonts.has(theme.font.family)) issues.push({ level: "warning", code: "FONT_NOT_BUNDLED", message: `The font "${theme.font.family}" is not available, so Inter is used.`, path: "/theme/font/family", fix: `Use Inter, Geist, JetBrains Mono or Geist Mono, or add the font file with theme.font.files.` })

  const spec = substituteThemeColours(request.spec, { ...theme.colors, font: theme.font.family, mono: theme.font.mono }) as Json

  // Prepare, validate, lint, compile, render.
  let svg!: string, width!: number, height!: number
  let plot: PlotBounds | undefined, resolvedSpec: Json, vegaSpec: Json | undefined, echartsOption: Json | undefined, profile: Profile | undefined
  let echartsTimeline: Json | undefined
  let echartsFrames: { readonly option: Json; readonly width: number; readonly height: number; readonly profile?: Profile; readonly issues: Issue[] }[] | undefined
  let ascii: string | undefined, tableHtml: string | undefined
  let description = request.description
  const title = request.title ?? (typeof request.spec.title === "string" ? request.spec.title : isObject(request.spec.title) && typeof (request.spec.title as Json).text === "string" ? String((request.spec.title as Json).text) : undefined) ?? "Chart"
  // The editorial frame draws the kicker, headline, standfirst and footer itself, so every engine's drawing keeps only
  // its marks: the frame composes the five parts around it once, whichever engine made it.
  const headline = Boolean(request.kicker?.trim() || request.subtitle?.trim() || request.source?.trim() || request.notes?.trim())
  const drawSpec = headline ? withoutHeadings(spec) : spec
  const innerTitle = headline ? {} : request.title ? { title: request.title } : {}
  if (engine === "vega-lite") {
    const prepared = prepareVegaLite(drawSpec, { packageRoot: env.packageRoot, theme, fonts, locale, ...(rows ? { rows } : {}), dataName, ...innerTitle, ...(request.description ? { description: request.description } : {}), currencyFields: request.currencyFields ?? true, ...(request.width ? { width: request.width } : {}), ...(request.height ? { height: request.height } : {}) })
    issues.push(...prepared.issues); notes.push(...prepared.notes)
    if (issues.some(i => i.level === "error")) throw new SpecInvalid(issues)
    profile = prepared.profile
    const compiled = compileVegaLite(prepared.spec)
    for (const w of compiled.warnings) issues.push({ level: "warning", code: "VEGA_LITE_WARNING", message: w, ...(FIT_WARNING.test(w) ? { fix: FIT_FIX } : {}) })
    resolvedSpec = prepared.spec
    vegaSpec = compiled.vega
    if (request.presentation) patchRecipeVega(vegaSpec)
    const values = isObject(prepared.spec.data) && Array.isArray(prepared.spec.data.values) ? prepared.spec.data.values as Row[] : rows
    description ??= describeVegaLite(prepared.spec, values)
    if (!prepared.spec.description) { vegaSpec.description = description }
  } else if (engine === "vega") {
    const prepared = prepareVega(drawSpec, { packageRoot: env.packageRoot, theme, locale, ...(rows ? { rows } : {}), dataName, ...innerTitle, ...(request.description ? { description: request.description } : {}), ...(request.width ? { width: request.width } : {}), ...(request.height ? { height: request.height } : {}) })
    issues.push(...prepared.issues)
    if (issues.some(i => i.level === "error")) throw new SpecInvalid(issues)
    profile = prepared.profile
    resolvedSpec = prepared.spec
    vegaSpec = prepared.spec
  } else if (engine === "echarts") {
    // A timeline option is a story: every frame is prepared (and validated) on its own, and the static drawing is the
    // first frame, because a still picture has no scrubber to click.
    echartsTimeline = timeline
    const frameContext = { theme, locale, ...(request.width ? { width: request.width } : {}), ...(request.height ? { height: request.height } : {}) }
    if (timeline) echartsFrames = extractTimelineFrameSvgOptions(drawSpec).map(frame => prepareECharts(withoutTimeline(frame), frameContext))
    const prepared = echartsFrames?.[0] ?? prepareECharts(drawSpec, { ...frameContext, ...(rows ? { rows } : {}), ...innerTitle, ...(request.description ? { description: request.description } : {}) })
    issues.push(...(echartsFrames ? echartsFrames.flatMap(frame => frame.issues) : prepared.issues))
    if (issues.some(i => i.level === "error")) throw new SpecInvalid(issues)
    profile = prepared.profile
    echartsOption = prepared.option
    resolvedSpec = timeline ? spec : { ...serialisableOption(prepared.option), width: prepared.width, height: prepared.height }
    svg = renderECharts(prepared.option, theme, fonts, prepared.width, prepared.height, request.seed ?? 1)
    width = prepared.width; height = prepared.height
  } else if (engine === "plot") {
    // A recipe compiles rows and bindings to a Plot spec; anything else is the spec itself.
    let plotSpec: Json = drawSpec
    if (typeof drawSpec.plotRecipe === "string") {
      const bindings = isObject(drawSpec.bindings) ? drawSpec.bindings as Json : {}
      const options = isObject(drawSpec.options) ? drawSpec.options as Json : {}
      const recipeRows = rows ?? (Array.isArray(drawSpec.data) ? drawSpec.data as Row[] : [])
      plotSpec = compilePlotRecipe(drawSpec.plotRecipe, recipeRows, bindings, options, theme) as unknown as Json
    } else if (!headline && request.title !== undefined && plotSpec.title === undefined) plotSpec = { ...plotSpec, title: request.title }
    // One seed decides the drawing, and it is written into the spec: the `.plot.json` a caller reads back and the HTML
    // page's own spec both carry it, so the page redraws the marks where the static SVG put them.
    const plotSeed = request.seed ?? (typeof plotSpec.seed === "number" ? plotSpec.seed : 1)
    plotSpec = { ...plotSpec, seed: plotSeed }
    const out = renderPlot(plotSpec as never, { packageRoot: env.packageRoot, theme, fonts, ...(rows ? { rows } : {}), ...(request.width ? { width: request.width } : {}), ...(request.height ? { height: request.height } : {}), seed: plotSeed })
    issues.push(...out.issues)
    resolvedSpec = plotSpec
    svg = out.svg; width = out.width; height = out.height
  } else if (engine === "table") {
    const parsed = parsedOrThrow<TableSpec>(TableSpecSchema.safeParse(drawSpec), "The table spec")
    const tableRows = rows ?? (Array.isArray(drawSpec.rows) ? drawSpec.rows as Row[] : [])
    const out = renderTable(parsed, tableRows, { theme, fonts, locale })
    issues.push(...out.issues)
    resolvedSpec = parsed as unknown as Json
    svg = out.svg; width = out.width; height = out.height; tableHtml = out.html
    description ??= `${title}. A table of ${tableRows.length} rows and ${parsed.columns.length} columns.`
  } else {
    const parsed = parsedOrThrow<DiagramSpec>(DiagramSpecSchema.safeParse(drawSpec), "The diagram spec")
    const out = await renderDiagram(parsed, { theme, fonts, ...(request.width ? { width: request.width } : {}), ...(request.height ? { height: request.height } : {}) })
    issues.push(...out.issues)
    resolvedSpec = parsed as unknown as Json
    svg = out.svg; width = out.width; height = out.height; ascii = out.ascii
    description ??= `${title}. A diagram${out.ascii ? `: ${out.ascii.split("\n")[0]!.trim()}` : ""}.`
  }
  if (vegaSpec) {
    const out = await renderVega(vegaSpec, fonts, request.seed ?? 1)
    svg = out.svg
    width = Math.round(Number(/<svg[^>]*\swidth="([\d.]+)"/.exec(svg)?.[1] ?? out.width))
    height = Math.round(Number(/<svg[^>]*\sheight="([\d.]+)"/.exec(svg)?.[1] ?? out.height))
    for (const w of out.warnings) issues.push({ level: "warning", code: "VEGA_WARNING", message: w })
    plot = plotBounds(svg, out.width, out.height)
  }
  description ??= `${title}.${profile ? ` ${describeProfile(profile)}` : ""}`
  // Annotations go over the finished drawing, in the plot's own box (the whole drawing when the engine measures none).
  if (request.annotations?.length) svg = injectAnnotations(svg, request.annotations, plot ?? plotBoxOf(width, height), theme, fonts)
  // The five-part frame composes around the finished drawing without touching a mark of it.
  if (headline) {
    const framedOut = wrapFigureSvg(svg, { ...(request.kicker ? { kicker: request.kicker } : {}), title, ...(request.subtitle ? { subtitle: request.subtitle } : {}), ...(request.source ? { source: request.source } : {}), ...(request.notes ? { notes: request.notes } : {}) }, theme, fonts)
    svg = framedOut.svg; width = framedOut.width; height = framedOut.height
    issues.push(...framedOut.warnings)
  }
  checkRenderedSvg(svg)
  svg = normaliseIds(accessible(svg, title, description))

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

  const files: { svg?: string; png: string[]; gif?: string; html?: string; spec?: string; document?: string } = { png: [] }
  let preview: Uint8Array | undefined, htmlText: string | undefined
  const name = slug(request.name ?? title)
  const defaultFamily = fonts.resolveFamily(theme.font.family)
  // A PNG over the pixel limit is known from the drawing's size: refuse it before any file is made.
  if (checked.has("png")) for (const scale of scales) if (width * height * scale * scale > LIMITS.pngPixels) {
    const problem = new ChartsError("PNG_TOO_LARGE", `A ${Math.round(width * scale)}×${Math.round(height * scale)} PNG is over the size limit.`, "Use a smaller scale or a smaller chart.")
    if (write) throw problem
    throw new SpecInvalid([...issues, { level: "error", code: problem.code, message: problem.detail, path: "/scales", fix: problem.hint }])
  }
  /** The timeline's frames, drawn once for the GIF and once for the story page, each with its own label. */
  const storyFrames = (): { title: string; svg: string }[] => {
    if (!echartsFrames?.length) return []
    const meta = isObject(echartsTimeline?.timeline) ? echartsTimeline!.timeline as Json : {}
    const labels = Array.isArray(meta.data) ? meta.data as Json[] : []
    return echartsFrames.map((frame, index) => {
      const label = labels[index]
      const stepTitle = typeof label === "string" ? label : isObject(label) && (typeof label.value === "string" || typeof label.value === "number") ? String(label.value) : `Frame ${index + 1}`
      return { title: stepTitle, svg: renderECharts(frame.option, theme, fonts, frame.width, frame.height, request.seed ?? 1) }
    })
  }
  /** The interactive page for this engine: the chart runtimes where they exist, a story for a timeline, a static page otherwise. */
  const page = (): string => {
    // A spec drawn from a paired theme ships the drawing with both polarities in `--cs-*` variables, so the page can
    // follow the reader's own light or dark setting instead of pinning the theme it was rendered in.
    const pageSvg = pairedThemes ? makeAdaptiveSvg(svg, pairedThemes.light, pairedThemes.dark, theme.mode) : svg
    const faces = embeddable(fonts, pageSvg, theme)
    const paired = pairedThemes ? { pairedThemes } : {}
    if (engine === "vega-lite" || engine === "vega") return buildHtml(env.packageRoot, { engine: "vega", spec: vegaSpec!, svg: pageSvg, title, description, theme, fonts: faces, compactSpec: "", localeId: locale.id, ...paired, ...(request.presentation ? { presentation: request.presentation } : {}) })
    if (engine === "echarts" && !timeline) return buildHtml(env.packageRoot, { engine: "echarts", spec: serialisableOption(echartsOption!), svg: pageSvg, title, description, theme, echartsTheme: echartsTheme(theme), fonts: faces, compactSpec: compactSpec(locale.currency ? locale.number.currency : undefined, locale.number.decimal), localeId: locale.id, ...paired })
    if (engine === "echarts" && timeline) return buildStoryHtml({ title, description, theme, fonts: faces, frameMs: Math.max(200, Math.round(1000 / (request.fps ?? 1))), steps: storyFrames() })
    if (engine === "plot") return buildHtml(env.packageRoot, { engine: "plot", spec: inlinePlotAtlases(resolvedSpec, env.packageRoot), ...(rows ? { rows } : {}), svg: pageSvg, title, description, theme, fonts: faces, compactSpec: "", localeId: locale.id, ...paired })
    // A table's own accessible page keeps its sorting, filtering and Copy TSV, with each of its scripts hashed into the policy.
    if (engine === "table" && tableHtml) return buildHtml(env.packageRoot, { engine: "static", htmlBody: extractTableBody(tableHtml), svg: pageSvg, title, description, theme, fonts: faces, compactSpec: "", localeId: locale.id, ...paired })
    return buildHtml(env.packageRoot, { engine: "static", svg: pageSvg, title, description, theme, fonts: faces, compactSpec: "", localeId: locale.id, ...paired })
  }

  // Every requested file, and the preview, is made in memory first; only then is anything written.
  const artifacts: Artifact[] = []
  const step = (kind: "svg" | "png" | "html" | "spec" | "document" | "preview") => env.probe?.(kind)
  if (write) {
    if (formats.has("svg")) {
      step("svg")
      let svgOut = svg
      // Text as paths and fonts embedded are two ways of making the file stand alone; the adaptive theme variables are
      // a third and apply either way, so a "paths" or "embed" SVG follows the reader's polarity too.
      if (request.svgText === "paths") svgOut = normaliseIds(accessible(await svgTextToPaths(env.packageRoot, svg, fonts, defaultFamily), title, description))
      else if (request.svgText === "embed") svgOut = embedFonts(svgOut, embeddable(fonts, svgOut, theme))
      if (pairedThemes) svgOut = makeAdaptiveSvg(svgOut, pairedThemes.light, pairedThemes.dark, theme.mode)
      // Motion is CSS inside the drawing, so the SVG animates and the PNG of the same chart stays a still picture.
      if (request.motion && request.motion !== "none") svgOut = animateSvg(svgOut, { mode: request.motion })
      artifacts.push({ kind: "svg", file: `${name}.svg`, bytes: svgOut })
    }
    if (formats.has("png")) for (const [i, scale] of scales.entries()) {
      step("png")
      const { png } = await svgToPng(env.packageRoot, svg, fonts, scale, defaultFamily)
      artifacts.push({ kind: "png", file: i === 0 ? `${name}.png` : `${name}@${scale}x.png`, bytes: png })
    }
    if (formats.has("gif")) {
      step("png")
      // A timeline animates through its own frames; any other drawing is revealed left to right.
      const frames = timeline ? storyFrames().map(frame => frame.svg) : generateProgressiveRevealFrames(svg, 14)
      const gif = await renderSvgFramesToGif(env.packageRoot, frames, fonts, { scale: 1, fps: request.fps ?? 8, defaultFamily })
      artifacts.push({ kind: "gif", file: `${name}.gif`, bytes: gif.gif })
    }
    if (formats.has("html")) {
      step("html")
      htmlText = page()
      artifacts.push({ kind: "html", file: `${name}.html`, bytes: htmlText })
    }
    if (formats.has("spec")) {
      step("spec")
      artifacts.push({ kind: "spec", file: `${name}.${SPEC_SUFFIX[engine]}.json`, bytes: JSON.stringify(resolvedSpec, null, 1) + "\n" })
    }
    if (request.document !== undefined) {
      step("document")
      artifacts.push({ kind: "document", file: `${name}.chart.json`, bytes: request.document })
    }
  }
  if (request.preview) {
    step("preview")
    // The same ids the figure tree names, drawn on the picture, so "n7 runs past the edge" points at one label.
    const marked = request.marks === "none" ? svg : markedSvg(svg, figure, { which: request.marks ?? "problems", font: `${defaultFamily}, sans-serif` })
    preview = (await svgToPng(env.packageRoot, marked, fonts, 1, defaultFamily)).png
  }
  let generation: Omit<Generation, "files"> | undefined
  if (write && artifacts.length) {
    let written: readonly string[]
    if (request.generation) {
      const published = publishGeneration(env.workspace, outDir, name, artifacts, file => env.probe?.("commit", file))
      written = published.files
      generation = { directory: published.directory, digest: published.digest, reused: published.reused }
    } else written = publish(env.workspace, outDir, artifacts, file => env.probe?.("commit", file))
    artifacts.forEach((artifact, i) => {
      if (artifact.kind === "png") files.png.push(written[i]!)
      else if (artifact.kind === "svg" || artifact.kind === "gif" || artifact.kind === "html" || artifact.kind === "spec" || artifact.kind === "document") files[artifact.kind] = written[i]!
    })
  }
  const shown = files.png[0] ?? files.svg
  return {
    engine, theme: theme.name, title, description, width, height, files,
    ...(shown ? { markdown: `![${title.replace(/[\[\]]/g, "")}](${shown})` } : {}),
    summary: [description, profile ? `Data: ${dataSource ?? "inline"}; ${describeProfile(profile)}` : ""].filter(Boolean).join(" "),
    issues, notes, layout, ms: Math.round(performance.now() - started), ...(preview ? { preview } : {}), svg,
    ...(htmlText ? { html: htmlText } : {}), ...(ascii ? { ascii } : {}),
    resolvedSpec, figure, ...(plot ? { plot } : {}), ...(generation ? { generation } : {}),
  }
}

/** An ECharts option without its timeline wrapper: what one frame is prepared and drawn from. */
function withoutTimeline(option: Json): Json {
  const out = { ...option }
  delete out.timeline
  return out
}

/** The spec file's suffix per engine: `<name>.vl.json`, `<name>.vg.json`, `<name>.plot.json`, … */
const SPEC_SUFFIX: Readonly<Record<PipelineEngine, string>> = { "vega-lite": "vl", vega: "vg", echarts: "echarts", plot: "plot", table: "table", diagram: "diagram" }

/**
 * A spec without its own headline, so the figure frame is the only thing drawing a header: title, subtitle, kicker and
 * both footer lines go, for every engine that can draw one. A table or a diagram that keeps its kicker while the frame
 * adds one draws the header twice; the mark engines have always been stripped, and now all six are.
 */
function withoutHeadings(spec: Json): Json {
  const out = { ...spec }
  delete out.title
  delete out.subtitle
  delete out.kicker
  delete out.source
  delete out.notes
  return out
}

/** The drawing's whole box, inset a little: where annotations sit when the engine measures no plot area of its own. */
const plotBoxOf = (width: number, height: number) => ({ x: Math.round(width * 0.08), y: Math.round(height * 0.06), width: Math.round(width * 0.86), height: Math.round(height * 0.82) })

interface ParseProblem { readonly message: string; readonly path: readonly PropertyKey[] }

/** A parsed spec, or every schema problem as a SPEC_INVALID issue with its JSON path. */
function parsedOrThrow<T>(result: { success: true; data: T } | { success: false; error: { issues: readonly ParseProblem[] } }, what: string): T {
  if (result.success) return result.data
  throw new SpecInvalid(result.error.issues.map(problem => ({
    level: "error" as const,
    code: "SPEC_INVALID" as const,
    message: `${what} has a problem: ${problem.message}.`,
    path: pointer(problem.path.map(String)),
    fix: "Fix the field named above and render again; charts_catalogue has a working example for each type.",
  })))
}

/** Materialises any Plot `atlas` mark reference into inline GeoJSON features so the offline page needs no file read. */
function inlinePlotAtlases(spec: Json, packageRoot: string): Json {
  if (!Array.isArray(spec.marks)) return spec
  return {
    ...spec,
    marks: spec.marks.map(mark => {
      if (!isObject(mark) || typeof mark.atlas !== "string") return mark
      const { atlas, ...rest } = mark
      return { ...rest, data: atlasFeatures(packageRoot, atlas) }
    }),
  }
}

/** Extracts `<style>…</style>` and inner `<body>…</body>` from `renderTable`'s standalone HTML so `buildHtml` embeds and signs it. */
function extractTableBody(page: string): string {
  const styles = [...page.matchAll(/<style>[\s\S]*?<\/style>/gi)].map(match => match[0]).join("\n")
  const body = /<body>([\s\S]*?)<\/body>/i.exec(page)?.[1]?.trim() ?? page
  return `${styles}\n${body}`
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
export function sizeOverrides(request: RenderRequest, engine: PipelineEngine): Issue[] {
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
