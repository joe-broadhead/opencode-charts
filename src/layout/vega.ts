import { CLEAR_EVENTS, PARAMS } from "../interactions/vegalite.js"
import { SIGNALS } from "./planner.js"

/**
 * The two places a recipe's layout touches the compiled Vega spec and its drawing.
 *
 * Vega-Lite takes no expression for a legend's orient or direction, but Vega does: the compiled legends read the
 * plan's orient signal, so the live page moves the legend by setting one signal on the same view, and the static
 * render (whose signal holds the server's plan) draws it in the same place.
 */

type Json = Record<string, unknown>

const ORIENT = { signal: SIGNALS.legendOrient }
const DIRECTION = { signal: `${SIGNALS.legendOrient} === 'right' || ${SIGNALS.legendOrient} === 'left' ? 'vertical' : 'horizontal'` }

/**
 * Points every top-level legend of a compiled recipe spec at the plan's orient signal, and makes the legend-highlight
 * selection the legend's alone: Vega-Lite's legend binding also clears on any click in the view, which would let a
 * brush gesture wipe the highlight. Here the highlight changes only through the legend (or the page's controls) and
 * clears only on its own clear event.
 */
export function patchRecipeVega(vega: Json): void {
  const legends = Array.isArray(vega.legends) ? vega.legends as Json[] : []
  for (const legend of legends) {
    legend.orient = ORIENT
    // A gradient runs along the side it sits on; a symbol legend keeps its columns, so its direction stays.
    if (legend.type === "gradient" || legend.gradientLength !== undefined) legend.direction = DIRECTION
  }
  const signals = Array.isArray(vega.signals) ? vega.signals as Json[] : []
  for (const signal of signals) {
    if (typeof signal.name !== "string" || !LEGEND_BINDING.test(signal.name) || !Array.isArray(signal.on)) continue
    signal.on = [
      ...(signal.on as Json[]).filter(handler => !isViewClick(handler.events)),
      { events: [{ source: "window", type: CLEAR_EVENTS.legend }], update: "null", force: true },
    ]
  }
}

/** The signal Vega-Lite's legend binding writes the clicked legend value to: charts_legend_<field>_legend. */
export const LEGEND_BINDING = new RegExp(`^${PARAMS.legend}_.+_legend$`)

const isViewClick = (events: unknown) => {
  const list = Array.isArray(events) ? events : [events]
  return list.length === 1 && !!list[0] && typeof list[0] === "object" && (list[0] as Json).source === "view" && (list[0] as Json).type === "click" && (list[0] as Json).markname === undefined
}

export interface PlotBounds { readonly x: number; readonly y: number; readonly width: number; readonly height: number }

/**
 * The plot's bounds in a Vega drawing: its size is the view's width and height signals after layout, and its origin is
 * the root group's translation (padding plus the space the left and top guides take).
 */
export function plotBounds(svg: string, width: number, height: number): PlotBounds | undefined {
  const origin = /<svg\b[^>]*>(?:<rect\b[^>]*\/>)?<g\b[^>]*\btransform="translate\(([-\d.]+),([-\d.]+)\)"/.exec(svg)
  if (!origin || !Number.isFinite(width) || !Number.isFinite(height)) return undefined
  const round = (n: number) => Math.round(n * 100) / 100
  return { x: round(Number(origin[1])), y: round(Number(origin[2])), width: round(width), height: round(height) }
}

/**
 * The legend labels a drawing shows (every legend: colour, and size for a bubble chart), and whether Vega elided any
 * entries ("…N entries"). The layout check requires every category of the colour domain among them, so a legend that
 * cut entries never passes. An interactive legend's label group also has its mark name as a class.
 */
export function legendEntries(svg: string): { labels: string[]; elided: boolean } {
  const labels: string[] = []
  for (const group of svg.matchAll(/class="mark-text role-legend-label(?: [^"]*)?"[^>]*>([\s\S]*?)<\/g>/g)) {
    for (const text of group[1]!.matchAll(/<text\b[^>]*>([\s\S]*?)<\/text>/g)) labels.push(unescapeXml(text[1]!.replace(/<[^>]+>/g, "")))
  }
  return { labels, elided: /<text\b[^>]*>…\d+ entr(?:y|ies)<\/text>/.test(svg) }
}

const unescapeXml = (s: string) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, "\"").replace(/&#39;/g, "'").replace(/&amp;/g, "&")
