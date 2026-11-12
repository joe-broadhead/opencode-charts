import type { Issue } from "../errors.js"
import { LIMITS } from "../safety.js"
import { humanise } from "../engines/common.js"
import type { CategoryValue } from "../document/category.js"
import type { EffectiveSettings } from "../document/prepare.js"
import { DocumentInvalid } from "../document/issues.js"
import type { CategoryDomainV1 } from "../document/types.js"
import { compilePresets, tooltipFields, type RuntimeControls } from "../interactions/vegalite.js"
import { combinationIssues, interactionReport, type InteractionReport } from "../interactions/presets.js"
import type { RecipeCompilation } from "../recipes/types.js"
import type { ThemeTokens } from "../themes/tokens.js"
import type { ResolvedAppearance } from "./appearance.js"
import { dateCategories, timeAxis, type TimeAxis } from "./time.js"
import { planLayout, SIGNALS, type Conflict, type Plan, type PlannerAxis, type PlannerInput, type PlannerLegend, type TimeUnit } from "./planner.js"

/**
 * A recipe compilation made into the chart that is drawn: the outer size (autosize fit, so the SVG is exactly the
 * requested width and height, title, axes, legend and padding included), the plan's guide placement as signals the
 * live page can change, the resolved appearance (typography, colour range by captured domain position), and the
 * interaction presets. The marks and their rows are the compiler's, unchanged; only fields the compiler added for its
 * own use leave the data (a pie's slice order is computed in the spec instead), so no export or tooltip shows them.
 */

type Json = Record<string, unknown>
const isObject = (v: unknown): v is Json => !!v && typeof v === "object" && !Array.isArray(v)

/** What text measurement needs on either side: a width for a string at a size, bold for the title. */
export type TextMeasure = (text: string, size: number, bold?: boolean) => number

export interface PresentInput {
  readonly compilation: RecipeCompilation
  readonly settings: EffectiveSettings
  readonly title?: string
  readonly appearance: ResolvedAppearance
  readonly categories?: CategoryDomainV1
  readonly measure: TextMeasure
  /** The lowest candidate to consider: the server moves past a candidate whose render failed its checks. */
  readonly from?: number
}

/** What the page's runtime needs to plan again at another width, and to offer its controls. */
export interface RuntimePresentation {
  readonly mode: "fixed" | "responsive"
  /** The planner's input at every width but the outer width itself. */
  readonly planner: Omit<PlannerInput, "width">
  readonly font: { readonly family: string; readonly titleWeight: number }
  readonly controls: RuntimeControls
  /** The width the static chart was drawn at: the export width, and the live view's first width. */
  readonly width: number
}

export interface RecipePresentation {
  readonly spec: Json
  readonly rows: Json[]
  readonly dataName: string
  readonly tokens: ThemeTokens
  readonly plan: Plan
  readonly candidates: readonly Plan[]
  readonly runtime: RuntimePresentation
  readonly interactions: InteractionReport
  readonly issues: readonly Issue[]
}

const label = (v: unknown) => (v === null || v === undefined ? "null" : String(v))

/** A tick label as wide as the widest the axis is likely to draw, for estimating guide space. */
function numberSamples(values: readonly unknown[]): string[] {
  const nums = values.filter((v): v is number => typeof v === "number" && Number.isFinite(v))
  if (!nums.length) return ["0"]
  const max = Math.max(...nums.map(Math.abs))
  const negative = nums.some(n => n < 0)
  const body = max >= 10_000 ? "999.9k" : max >= 1000 ? "9,999" : max >= 100 ? "999" : max >= 1 ? "9.9" : "0.99"
  return [negative ? `−${body}` : body]
}
/**
 * The tick interval for a time unit and the plan's step, as a Vega expression. Days past one go by weeks: d3's day
 * steps restart every month (the 29th, then the 1st), while week steps stay even. Vega calls its hour interval hours.
 */
function tickInterval(unit: TimeUnit): string {
  const step = SIGNALS.xTimeStep
  if (unit === "day") return `${step} === 1 ? {interval: 'day', step: 1} : {interval: 'week', step: ${step} / 7}`
  return `{interval: '${unit === "hour" ? "hours" : unit}', step: ${step}}`
}

/** A planner axis, and how the axis writes its labels when they are dates (a time format, or date categories). */
interface AxisReading { readonly axis: PlannerAxis; readonly time?: TimeAxis; readonly dateFormat?: string }

function axisInput(def: unknown, rows: readonly Json[]): AxisReading | undefined {
  if (!isObject(def)) return undefined
  const title = typeof def.title === "string" ? def.title : undefined
  const field = typeof def.field === "string" ? def.field : undefined
  if ((def.type === "nominal" || def.type === "ordinal") && !def.bin && field) {
    const order = Array.isArray(def.sort) ? def.sort : [...new Map(rows.map(r => [JSON.stringify(r[field] ?? null), r[field] ?? null])).values()]
    const labels = order.map(label)
    // ISO dates as categories (a stacked bar per month, say) read as dates, not as 2024-01-01.
    const dates = dateCategories(labels)
    return { axis: { kind: "discrete", labels: dates ? [...dates.display] : labels, ...(title ? { title } : {}) }, ...(dates ? { dateFormat: dates.format } : {}) }
  }
  if (def.type === "temporal") {
    const time = field ? timeAxis(rows.map(r => r[field])) : undefined
    return { axis: { kind: "continuous", labels: time ? [...time.labels] : ["September", "2024"], temporal: true, ...(time ? { time: { unit: time.unit, intervals: time.intervals, labels: time.labels } } : {}), ...(title ? { title } : {}) }, ...(time ? { time } : {}) }
  }
  return { axis: { kind: "continuous", labels: field ? numberSamples(rows.map(r => r[field])) : ["9,999"], ...(title ? { title } : {}) } }
}

/** Every axis and legend gets an explicit title, so the planner measures the text Vega draws. */
function titleChannels(encoding: Json, options: Json) {
  for (const [channel, option] of [["x", "xTitle"], ["y", "yTitle"]] as const) {
    const def = encoding[channel]
    if (!isObject(def)) continue
    if (typeof options[option] === "string") def.title = options[option]
    else if (def.title === undefined && typeof def.field === "string") def.title = humanise(def.field)
  }
  for (const channel of ["color", "theta", "size"]) {
    const def = encoding[channel]
    if (isObject(def) && def.title === undefined && typeof def.field === "string") def.title = humanise(def.field)
  }
}

/**
 * Guides draw all of their text. Vega's defaults would otherwise elide it: axis labels past 180 px and legend labels
 * past 200 px end in an ellipsis, a legend title past 180 px too, and a symbol legend shows 30 entries and then
 * "…N entries". Nothing is cut here; the planner and the drawn check decide whether it fits, and refuse when not.
 */
// Vega also caps the room an axis keeps for its labels at maxExtent (default 200 px): longer labels, or turned ones
// deeper than that, run under the axis title and past the fitted bounds. The planner budgets that room itself.
const WHOLE_AXIS = { labelLimit: 0, titleLimit: 0, maxExtent: LIMITS.dimension }
const WHOLE_LEGEND = { labelLimit: 0, titleLimit: 0, symbolLimit: 0 }

export class LayoutUnsatisfiable extends DocumentInvalid {}

/** What the refusal's alternatives are computed from: the planner's view of the chart, and the text measurements. */
export interface AlternativeContext {
  readonly recipe: string
  readonly planner: Omit<PlannerInput, "width">
  readonly measure: TextMeasure
}

/** The planner's view of the same data drawn as a horizontal bar chart: the category axis on y, the measure on x. */
function asHorizontalBar(planner: Omit<PlannerInput, "width">): Omit<PlannerInput, "width"> | undefined {
  if (planner.x?.kind !== "discrete" || planner.y?.kind !== "continuous") return undefined
  const { x, y, ...rest } = planner
  return { ...rest, x: { kind: "continuous", labels: y.labels, ...(y.title ? { title: y.title } : {}) }, y: { kind: "discrete", labels: x.labels, ...(x.title ? { title: x.title } : {}) } }
}

const STEP = 10
/** The smallest size (in STEP px, above `after`) along one dimension at which the planner fits the chart, if any. */
function smallest(fits: (size: number) => boolean, after: number): number | undefined {
  const max = LIMITS.dimension
  if (!fits(max)) return undefined
  let lo = Math.floor(after / STEP), hi = Math.ceil(max / STEP)
  // Fitting is monotone in the size (a tested property): the first fitting step is found by bisection.
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (fits(mid * STEP)) hi = mid; else lo = mid }
  return Math.min(max, hi * STEP)
}

/**
 * Alternatives that keep the chart's meaning, each checked with the planner at the requested size: the same chart at
 * the smallest width (at this height) and height (at this width) that fit, and, for a vertical bar chart, the
 * horizontal bar chart of the same data, suggested only if it fits this size, otherwise with the size it needs.
 */
export function layoutAlternatives(context: AlternativeContext, width: number, height: number, measured: boolean): string[] {
  const fits = (planner: Omit<PlannerInput, "width">, w: number, h: number) => planLayout({ ...planner, width: w, height: h }, context.measure).ok
  // A drawing that failed its check at this size needs more room than the planner's estimate of it.
  const sizes = (planner: Omit<PlannerInput, "width">) => {
    const w = smallest(size => fits(planner, size, height), measured || fits(planner, width, height) ? width : 0)
    const h = smallest(size => fits(planner, width, size), measured || fits(planner, width, height) ? height : 0)
    return { w, h }
  }
  const out: string[] = []
  const own = sizes(context.planner)
  const parts = [own.w !== undefined ? `${own.w} px wide at ${height} px tall` : undefined, own.h !== undefined ? `${own.h} px tall at ${width} px wide` : undefined].filter(Boolean)
  out.push(parts.length ? `This chart fits from ${parts.join(", or from ")} (layout.width, layout.height).` : `No size up to ${LIMITS.dimension} px fits this chart as it is: shorten the labels or the title, or use fewer categories.`)
  if (context.recipe === "bar") {
    const horizontal = asHorizontalBar(context.planner)
    if (horizontal && fits(horizontal, width, height)) out.push(`A horizontal_bar of the same data fits ${width}×${height} px: its long category labels run down the side.`)
    else if (horizontal) {
      const need = { w: smallest(size => fits(horizontal, size, height), 0), h: smallest(size => fits(horizontal, width, size), 0) }
      const at = [need.w !== undefined ? `${need.w} px wide at ${height} px tall` : undefined, need.h !== undefined ? `${need.h} px tall at ${width} px wide` : undefined].filter(Boolean)
      out.push(at.length ? `A horizontal_bar does not fit ${width}×${height} px either; it needs ${at.join(", or ")}.` : `A horizontal_bar does not fit at any size up to ${LIMITS.dimension} px either.`)
    }
  }
  return out
}

/** The LAYOUT_UNSATISFIABLE issue for a set of conflicts, with alternatives that keep the chart's meaning. */
export function unsatisfiable(settings: EffectiveSettings, conflicts: readonly Conflict[], measured = false, context?: AlternativeContext): LayoutUnsatisfiable {
  const l = settings.layout!
  const list = conflicts.slice(0, 6).map(c => `${c.what} (needs ${c.needed}, has ${c.available}, at ${c.path})`).join("; ")
  const alternatives = context ? layoutAlternatives(context, l.width, l.height, measured) : []
  return new LayoutUnsatisfiable([{
    level: "error", code: "LAYOUT_UNSATISFIABLE",
    message: `The chart does not fit ${l.width}×${l.height} px with every label at ${l.minLabelSize} px or more, in any of the three layout candidates${measured ? " (measured on the drawn chart)" : ""}: ${list}.`,
    path: "/layout",
    fix: `${conflicts.some(c => c.path.startsWith("/encoding/color/legend")) ? "The legend cannot show every series: draw fewer series (combine the small ones into one with an explicit data.transform, or split the chart), or give it more room. " : ""}${alternatives.length ? `${alternatives.join(" ")} ` : "Give it more room (a larger layout.width or layout.height, or a layout.target such as report). "}Otherwise shorten the title or the category labels in the data, or use fewer categories with an explicit data.transform filter. Labels are never shrunk below ${l.minLabelSize} px, and no category, series or legend entry is dropped to fit.`,
  }])
}

/** Builds the drawn chart from a recipe compilation, with the first feasible layout candidate from `from` on. */
export function presentRecipe(input: PresentInput): RecipePresentation {
  const { compilation, settings, appearance } = input
  const layout = settings.layout!
  const tokens = appearance.tokens
  const spec = structuredClone(compilation.spec) as Json
  const encoding = spec.encoding as Json
  titleChannels(encoding, compilation.options as Json)

  // Internal fields leave the data; a pie's slice order is numbered in the spec, in the rows' (already sorted) order.
  const internal = compilation.internalFields
  const rows = compilation.values.map(row => {
    if (!internal.length) return { ...row }
    const out: Json = {}
    for (const [k, v] of Object.entries(row)) if (!internal.includes(k)) Object.defineProperty(out, k, { value: v, enumerable: true, writable: true, configurable: true })
    return out
  })
  if (internal.length) spec.transform = [{ window: internal.map(as => ({ op: "row_number", as })) }, ...(Array.isArray(spec.transform) ? spec.transform as Json[] : [])]

  // Colours: the captured domain, and the resolved range by position.
  const color = isObject(encoding.color) ? encoding.color as Json : undefined
  if (color && appearance.colorRange && input.categories) color.scale = { ...(isObject(color.scale) ? color.scale as Json : {}), domain: [...input.categories.domain], range: [...appearance.colorRange] }

  // The planner's view of the chart.
  const radial = compilation.recipe === "pie" || compilation.recipe === "donut"
  let legend: PlannerLegend | undefined
  if (color && typeof color.field === "string") {
    const title = typeof color.title === "string" ? color.title : undefined
    if (color.type === "quantitative") legend = { kind: "gradient", labels: numberSamples(rows.map(r => r[color.field as string])), ...(title ? { title } : {}) }
    else legend = { kind: "symbol", labels: (input.categories?.domain ?? []).map(label), ...(title ? { title } : {}) }
  }
  const xReading = radial ? undefined : axisInput(encoding.x, rows)
  const yReading = radial ? undefined : axisInput(encoding.y, rows)
  const x = xReading?.axis, y = yReading?.axis
  const planner: Omit<PlannerInput, "width"> = {
    height: layout.height, padding: tokens.layout.padding, floor: layout.minLabelSize,
    labelSize: tokens.font.labelSize, axisTitleSize: tokens.font.size, titleSize: tokens.font.titleSize, labelPadding: tokens.axis.labelPadding,
    legendOrient: tokens.legend.orient,
    ...(input.title ? { title: input.title } : {}),
    ...(x ? { x } : {}), ...(y ? { y } : {}), ...(legend ? { legend } : {}), ...(radial ? { radial: true } : {}),
  }
  const outcome = planLayout({ ...planner, width: layout.width }, input.measure)
  const context: AlternativeContext = { recipe: compilation.recipe, planner, measure: input.measure }
  if (!outcome.ok) throw unsatisfiable(settings, outcome.conflicts, false, context)
  const from = input.from ?? 0
  const plan = outcome.candidates.find(p => p.feasible && p.candidate >= from)
  if (!plan) throw unsatisfiable(settings, outcome.candidates[outcome.candidates.length - 1]!.conflicts, false, context)

  // The outer size, exactly; guides read the plan's signals.
  spec.width = layout.width
  spec.height = layout.height
  spec.autosize = { type: "fit", contains: "padding", resize: true }
  if (input.title) spec.title = { text: { expr: SIGNALS.title } }
  const params: Json[] = Object.entries(plan.signals).map(([name, value]) => ({ name, value }))
  // The text an axis draws for a label: the label itself, or a date category written as a date; wrapped when the
  // plan wraps that text.
  const shown = (reading?: AxisReading) => (reading?.dateFormat ? `utcFormat(toDate(datum.label), ${JSON.stringify(reading.dateFormat)})` : "datum.label")
  const wrapExpr = (keys: string, lines: string, reading?: AxisReading) => `indexof(${keys}, ${shown(reading)}) >= 0 ? ${lines}[indexof(${keys}, ${shown(reading)})] : ${shown(reading)}`
  if (isObject(encoding.x)) {
    const def = encoding.x as Json
    const axis = isObject(def.axis) ? def.axis as Json : {}
    if (x?.kind === "discrete") def.axis = { ...axis, ...WHOLE_AXIS, labelAngle: { expr: SIGNALS.xAngle }, labelAlign: { expr: `${SIGNALS.xAngle} === 0 ? 'center' : 'right'` }, labelBaseline: { expr: `${SIGNALS.xAngle} === -90 ? 'middle' : 'top'` }, labelExpr: wrapExpr(SIGNALS.xKeys, SIGNALS.xLines, xReading), labelOverlap: false }
    // A time axis: ticks on calendar boundaries, the plan's number of units per tick, one format for every label.
    else if (xReading?.time) def.axis = { ...axis, ...WHOLE_AXIS, format: xReading.time.format, tickCount: { expr: tickInterval(xReading.time.unit) }, labelOverlap: false }
    else if (x) def.axis = { ...axis, ...WHOLE_AXIS, tickCount: { expr: `max(2, ceil(width / ${SIGNALS.xTickStep}))` } }
  }
  if (isObject(encoding.y)) {
    const def = encoding.y as Json
    const axis = isObject(def.axis) ? def.axis as Json : {}
    if (y?.kind === "discrete") def.axis = { ...axis, ...WHOLE_AXIS, labelExpr: wrapExpr(SIGNALS.yKeys, SIGNALS.yLines, yReading), labelOverlap: false }
    // Flush: the end labels sit inside the axis, so the bottom one never meets the x axis's first label at the corner.
    else if (y) def.axis = { ...axis, ...WHOLE_AXIS, labelFlush: true, tickCount: { expr: `max(2, ceil(height / ${SIGNALS.yTickStep}))` } }
  }
  if (color && legend) {
    const own = isObject(color.legend) ? color.legend as Json : {}
    color.legend = legend.kind === "gradient"
      ? { ...own, ...WHOLE_LEGEND, orient: plan.signals.charts_legend_orient, gradientLength: { expr: `${SIGNALS.legendOrient} === 'right' || ${SIGNALS.legendOrient} === 'left' ? clamp(height * 0.8, 40, 200) : clamp(width * 0.5, 60, 240)` } }
      : { ...own, ...WHOLE_LEGEND, orient: plan.signals.charts_legend_orient, columns: { expr: SIGNALS.legendColumns } }
  }
  // A size key (bubble) has no colour scale: its symbols are drawn in the theme's muted text colour, fully opaque, so they
  // read on a dark canvas as well as a light one.
  if (isObject(encoding.size)) {
    const size = encoding.size as Json
    size.legend = { ...(isObject(size.legend) ? size.legend as Json : {}), ...WHOLE_LEGEND, symbolOpacity: 1 }
  }
  spec.params = [...params, ...(Array.isArray(spec.params) ? spec.params as Json[] : [])]

  // Interaction presets. A combination no recipe offers is refused here too, whatever let it through.
  const combination = combinationIssues(settings.interactions!)
  if (combination.length) throw new DocumentInvalid(combination)
  const seriesField = color && color.type !== "quantitative" && typeof color.field === "string" && !radial ? color.field : undefined
  const mark = isObject(spec.mark) ? spec.mark as Json : { type: spec.mark }
  const restingOpacity = typeof mark.opacity === "number" ? mark.opacity : mark.type === "area" ? (tokens.marks.opacity < 1 ? tokens.marks.opacity : 0.85) : 1
  const interactions = settings.interactions!
  const xDef = isObject(encoding.x) ? encoding.x as Json : undefined
  const instants = xDef?.type === "temporal" && typeof xDef.field === "string" ? rows.map(r => r[xDef.field as string]) : []
  const temporalFormat = instants.length && instants.every(v => typeof v === "string" && v.endsWith("T00:00:00.000Z")) ? "%Y-%m-%d" : "%Y-%m-%d %H:%M UTC"
  const presets = compilePresets(spec, {
    recipe: compilation.recipe, effective: interactions, opacity: restingOpacity, internalFields: internal, temporalFormat,
    ...(seriesField ? { seriesField, series: (input.categories?.domain ?? []).map((value: CategoryValue) => ({ value, label: label(value) })) } : {}),
  })

  // Vega-Lite describes each mark (its aria-label) from every encoded field, the internal order included; with an
  // internal field the description is written out from the visible fields instead.
  if (internal.length) {
    const visible = tooltipFields(presets.spec.encoding as Json, internal)
    const parts = visible.filter(f => typeof f.field === "string").map(f => `${JSON.stringify(`${typeof f.title === "string" ? f.title : f.field}: `)} + datum[${JSON.stringify(f.field)}]`)
    const as = `${internal[0]}_description`
    presets.spec.transform = [...(presets.spec.transform as Json[]), { calculate: parts.join(" + '; ' + "), as }]
    ;(presets.spec.encoding as Json).description = { field: as, type: "nominal" }
  }

  return {
    spec: presets.spec,
    rows,
    dataName: compilation.dataName,
    tokens,
    plan,
    candidates: outcome.candidates,
    runtime: { mode: layout.mode, planner, font: { family: tokens.font.family, titleWeight: tokens.font.titleWeight }, controls: presets.controls, width: layout.width },
    interactions: interactionReport(interactions, settings.explicitInteractions ?? []),
    issues: appearance.issues,
  }
}

/**
 * The presets the interactive HTML of a recipe carries, as compiled: each with the browser-tested interaction it is
 * (RECIPE_INTERACTIONS' id), its selection parameter, and the keyboard controls the page offers for it. A generated
 * page has not run anywhere, so the format report beside it says verified: false.
 */
export function htmlPresets(presentation: RecipePresentation): Json[] {
  const e = presentation.interactions.effective
  const c = presentation.runtime.controls
  const out: Json[] = []
  if (e.tooltip === "auto") out.push({ preset: "tooltip", value: "auto", id: "recipe-tooltip", controls: ["Data table"] })
  if (c.legend) out.push({ preset: "legend", value: "highlight", id: "recipe-legend-highlight", param: c.legend.param, controls: ["a button per series", "Clear highlight"] })
  if (c.zoom) out.push({ preset: "zoom", value: "x", id: "recipe-x-zoom", param: c.zoom.param, controls: ["Reset zoom"] })
  if (c.brush) out.push({ preset: "brush", value: "interval", id: "recipe-interval-brush", param: c.brush.param, controls: ["Clear selection"] })
  if ([c.legend, c.zoom, c.brush].filter(Boolean).length > 1) out[out.length - 1] = { ...out[out.length - 1], controls: [...(out[out.length - 1]!.controls as string[]), "Reset all"] }
  if (presentation.runtime.mode === "responsive") out.push({ preset: "layout", value: "responsive", id: "recipe-responsive" })
  return out
}
