import type { Issue } from "../errors.js"
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
import { planLayout, SIGNALS, type Conflict, type Plan, type PlannerAxis, type PlannerInput, type PlannerLegend } from "./planner.js"

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
const TIME_SAMPLES = ["September", "2024"]

function axisInput(def: unknown, rows: readonly Json[]): PlannerAxis | undefined {
  if (!isObject(def)) return undefined
  const title = typeof def.title === "string" ? def.title : undefined
  const field = typeof def.field === "string" ? def.field : undefined
  if ((def.type === "nominal" || def.type === "ordinal") && !def.bin && field) {
    const order = Array.isArray(def.sort) ? def.sort : [...new Map(rows.map(r => [JSON.stringify(r[field] ?? null), r[field] ?? null])).values()]
    return { kind: "discrete", labels: order.map(label), ...(title ? { title } : {}) }
  }
  if (def.type === "temporal") return { kind: "continuous", labels: TIME_SAMPLES, temporal: true, ...(title ? { title } : {}) }
  return { kind: "continuous", labels: field ? numberSamples(rows.map(r => r[field])) : ["9,999"], ...(title ? { title } : {}) }
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

export class LayoutUnsatisfiable extends DocumentInvalid {}

/** The LAYOUT_UNSATISFIABLE issue for a set of conflicts, with alternatives that keep the chart's meaning. */
export function unsatisfiable(settings: EffectiveSettings, conflicts: readonly Conflict[], measured = false): LayoutUnsatisfiable {
  const l = settings.layout!
  const list = conflicts.slice(0, 6).map(c => `${c.what} (needs ${c.needed}, has ${c.available}, at ${c.path})`).join("; ")
  return new LayoutUnsatisfiable([{
    level: "error", code: "LAYOUT_UNSATISFIABLE",
    message: `The chart does not fit ${l.width}×${l.height} px with every label at ${l.minLabelSize} px or more, in any of the three layout candidates${measured ? " (measured on the drawn chart)" : ""}: ${list}.`,
    path: "/layout",
    fix: `Give it more room (a larger layout.width or layout.height, or a layout.target such as report), shorten the title or the category labels in the data, or use fewer categories with an explicit data.transform filter; for long category labels a horizontal_bar reads better. Labels are never shrunk below ${l.minLabelSize} px, and no category or series is dropped to fit.`,
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
  const x = radial ? undefined : axisInput(encoding.x, rows)
  const y = radial ? undefined : axisInput(encoding.y, rows)
  const planner: Omit<PlannerInput, "width"> = {
    height: layout.height, padding: tokens.layout.padding, floor: layout.minLabelSize,
    labelSize: tokens.font.labelSize, axisTitleSize: tokens.font.size, titleSize: tokens.font.titleSize, labelPadding: tokens.axis.labelPadding,
    legendOrient: tokens.legend.orient,
    ...(input.title ? { title: input.title } : {}),
    ...(x ? { x } : {}), ...(y ? { y } : {}), ...(legend ? { legend } : {}), ...(radial ? { radial: true } : {}),
  }
  const outcome = planLayout({ ...planner, width: layout.width }, input.measure)
  if (!outcome.ok) throw unsatisfiable(settings, outcome.conflicts)
  const from = input.from ?? 0
  const plan = outcome.candidates.find(p => p.feasible && p.candidate >= from)
  if (!plan) throw unsatisfiable(settings, outcome.candidates[outcome.candidates.length - 1]!.conflicts)

  // The outer size, exactly; guides read the plan's signals.
  spec.width = layout.width
  spec.height = layout.height
  spec.autosize = { type: "fit", contains: "padding", resize: true }
  if (input.title) spec.title = { text: { expr: SIGNALS.title } }
  const params: Json[] = Object.entries(plan.signals).map(([name, value]) => ({ name, value }))
  const wrapExpr = (keys: string, lines: string) => `indexof(${keys}, datum.label) >= 0 ? ${lines}[indexof(${keys}, datum.label)] : datum.label`
  if (isObject(encoding.x)) {
    const def = encoding.x as Json
    const axis = isObject(def.axis) ? def.axis as Json : {}
    if (x?.kind === "discrete") def.axis = { ...axis, labelAngle: { expr: SIGNALS.xAngle }, labelAlign: { expr: `${SIGNALS.xAngle} === 0 ? 'center' : 'right'` }, labelBaseline: { expr: `${SIGNALS.xAngle} === -90 ? 'middle' : 'top'` }, labelExpr: wrapExpr(SIGNALS.xKeys, SIGNALS.xLines), labelLimit: 0, labelOverlap: false }
    else if (x) def.axis = { ...axis, tickCount: { expr: `max(2, ceil(width / ${SIGNALS.xTickStep}))` } }
  }
  if (isObject(encoding.y)) {
    const def = encoding.y as Json
    const axis = isObject(def.axis) ? def.axis as Json : {}
    if (y?.kind === "discrete") def.axis = { ...axis, labelExpr: wrapExpr(SIGNALS.yKeys, SIGNALS.yLines), labelLimit: 0, labelOverlap: false }
    else if (y) def.axis = { ...axis, tickCount: { expr: `max(2, ceil(height / ${SIGNALS.yTickStep}))` } }
  }
  if (color && legend) {
    const own = isObject(color.legend) ? color.legend as Json : {}
    color.legend = legend.kind === "gradient"
      ? { ...own, orient: plan.signals.charts_legend_orient, gradientLength: { expr: `${SIGNALS.legendOrient} === 'right' || ${SIGNALS.legendOrient} === 'left' ? clamp(height * 0.8, 40, 200) : clamp(width * 0.5, 60, 240)` } }
      : { ...own, orient: plan.signals.charts_legend_orient, columns: { expr: SIGNALS.legendColumns }, labelLimit: 0 }
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
