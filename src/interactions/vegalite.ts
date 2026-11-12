import type { CategoryValue } from "../document/category.js"
import type { InteractionDefaults } from "../document/defaults.js"
import type { RecipeId } from "../recipes/types.js"

/**
 * Interaction presets compiled into a recipe's Vega-Lite spec, by trusted code with fixed, collision-safe parameter
 * names: no callback, expression or action from the caller is ever compiled.
 *
 * - tooltip auto: the values each mark draws (one row per mark, already aggregated by the recipe), titled like the
 *   axes, formatted like them, temporal values in UTC. Internal fields (a pie's slice order) are never listed.
 * - legend highlight: a point selection over the series, bound to the legend. Emphasis is opacity only, so every mark,
 *   scale, domain and stacked total stays as drawn.
 * - x zoom: an interval over x bound to the x scale, so only the x domain changes; y keeps its domain policy. Marks
 *   outside the zoomed domain are clipped to the plot.
 * - interval brush: an interval over x and y; marks inside keep full emphasis.
 *
 * Legend highlight and the brush each select a subset; with both, full emphasis is their intersection (an empty
 * selection matches everything). Each persistent selection clears on its own window event, which the page's controls
 * dispatch, so clearing one leaves the others; double-click also clears the zoom and the brush, not the highlight.
 */

export const PARAMS = { legend: "charts_legend", zoom: "charts_zoom", brush: "charts_brush" } as const
/** Window events that clear one selection each (Vega listens for them through the selection's `clear`). */
export const CLEAR_EVENTS = { legend: "chartsclearlegend", zoom: "chartsclearzoom", brush: "chartsclearbrush" } as const
/** An event no page sends: the legend-highlight selection's mark trigger, so only the legend selects. */
const PICK_EVENT = "chartsnopick"
/** The opacity of marks outside the emphasised subset. */
export const DIMMED_OPACITY = 0.15

type Json = Record<string, unknown>
const isObject = (v: unknown): v is Json => !!v && typeof v === "object" && !Array.isArray(v)

export interface PresetTarget {
  readonly recipe: RecipeId
  readonly effective: InteractionDefaults
  /** The series field, when the chart has one. */
  readonly seriesField?: string
  /** The series categories, in colour-domain order, with the text the legend draws for each. */
  readonly series?: readonly { readonly value: CategoryValue; readonly label: string }[]
  /** The marks' resting opacity, kept for emphasised marks. */
  readonly opacity: number
  /** Fields the compiler added for its own use; never shown. */
  readonly internalFields: readonly string[]
  /** The tooltip's UTC time format: dates alone when every instant is a UTC midnight. */
  readonly temporalFormat?: string
}

/** What the page's runtime needs to offer keyboard controls for each preset. */
export interface RuntimeControls {
  /** Tooltips are on: the page offers the same values as a table. */
  readonly details: boolean
  readonly legend?: { readonly param: string; readonly clear: string; readonly field: string; readonly series: readonly { readonly value: CategoryValue; readonly label: string }[] }
  readonly zoom?: { readonly param: string; readonly clear: string }
  readonly brush?: { readonly param: string; readonly clear: string }
}

/** The tooltip entries for a unit's encoding: the positional and colour channels with a field, in reading order. */
export function tooltipFields(encoding: Json, internal: readonly string[], temporalFormat = "%Y-%m-%d %H:%M UTC"): Json[] {
  const out: Json[] = []
  const seen = new Set<string>()
  for (const channel of ["x", "y", "color", "theta", "size"]) {
    const def = encoding[channel]
    if (!isObject(def)) continue
    const field = typeof def.field === "string" ? def.field : undefined
    if (field && internal.includes(field)) continue
    if (!field && def.aggregate !== "count") continue
    const key = field ?? "count"
    if (seen.has(key)) continue
    seen.add(key)
    const entry: Json = { type: def.type }
    if (field) entry.field = field
    for (const k of ["aggregate", "bin", "title", "format", "formatType"]) if (def[k] !== undefined) entry[k] = def[k]
    if (def.type === "temporal") { entry.formatType = "utc"; entry.format ??= temporalFormat }
    out.push(entry)
  }
  return out
}

/** Adds the effective presets to a recipe's Vega-Lite unit spec (a copy is returned). */
export function compilePresets(input: Json, target: PresetTarget): { spec: Json; controls: RuntimeControls } {
  const spec = structuredClone(input) as Json
  const encoding = (isObject(spec.encoding) ? spec.encoding : (spec.encoding = {})) as Json
  const mark: Json = isObject(spec.mark) ? spec.mark as Json : { type: spec.mark }
  const params: Json[] = Array.isArray(spec.params) ? [...spec.params as Json[]] : []
  const e = target.effective
  let controls: RuntimeControls = { details: e.tooltip === "auto" }

  if (e.tooltip === "auto") {
    // A box plot's marks are summaries: Vega-Lite's own box plot tooltip lists each part's statistics.
    if (target.recipe === "box_plot") mark.tooltip = true
    else encoding.tooltip = tooltipFields(encoding, target.internalFields, target.temporalFormat)
  } else mark.tooltip = false

  const emphasis: Json[] = []
  if (e.legend === "highlight" && target.seriesField) {
    // Selected from the legend only: `on` names an event nothing sends (marks in the plot never select a series).
    params.push({ name: PARAMS.legend, select: { type: "point", fields: [target.seriesField], on: `window:${PICK_EVENT}`, clear: `window:${CLEAR_EVENTS.legend}` }, bind: "legend" })
    emphasis.push({ param: PARAMS.legend })
    controls = { ...controls, legend: { param: PARAMS.legend, clear: CLEAR_EVENTS.legend, field: target.seriesField, series: target.series ?? [] } }
  }
  if (e.zoom === "x") {
    params.push({ name: PARAMS.zoom, select: { type: "interval", encodings: ["x"], clear: `dblclick, window:${CLEAR_EVENTS.zoom}` }, bind: "scales" })
    mark.clip = true
    controls = { ...controls, zoom: { param: PARAMS.zoom, clear: CLEAR_EVENTS.zoom } }
  }
  if (e.brush === "interval") {
    params.push({ name: PARAMS.brush, select: { type: "interval", encodings: ["x", "y"], clear: `dblclick, window:${CLEAR_EVENTS.brush}` } })
    emphasis.push({ param: PARAMS.brush })
    controls = { ...controls, brush: { param: PARAMS.brush, clear: CLEAR_EVENTS.brush } }
  }
  if (emphasis.length) {
    const test = emphasis.length === 1 ? emphasis[0]! : { and: emphasis }
    encoding.opacity = { condition: { test, value: target.opacity }, value: DIMMED_OPACITY }
  }
  spec.mark = mark
  if (params.length) spec.params = params
  return { spec, controls }
}
