import * as Plot from "@observablehq/plot"
import { withSeededRandom } from "../prng.js"

/**
 * The Plot runtime inlined into interactive HTML: `window.chartsPlot.render(container, spec, rows, theme)` builds the
 * chart in the page's own DOM, so marks can answer the pointer (Plot's `tip: true`) and the browser can refit it.
 *
 * The static renderer in `engines/plot.ts` is the same set of marks; this module is the page half, free of file access
 * and of a headless document, so the bundle stays small.
 */

/** The tokens the page needs: the canvas, text and the two colour ramps. */
export interface BrowserPlotTheme {
  readonly colors: {
    readonly background: string
    readonly text: string
    readonly muted: string
    readonly grid: string
    readonly axis: string
    readonly categorical: readonly string[]
    readonly sequential: readonly string[]
  }
  readonly font: { readonly family: string; readonly size: number; readonly labelSize: number }
}

/** A mark as the spec carries it: a Plot mark type, its channels and options, and optional transforms. */
export interface BrowserPlotMark {
  readonly type: string
  readonly data?: readonly unknown[]
  readonly transform?: readonly { readonly type: string; readonly args?: unknown; readonly [option: string]: unknown }[]
  readonly outputs?: Record<string, unknown>
  readonly [option: string]: unknown
}

export interface BrowserPlotSpec {
  readonly marks: readonly BrowserPlotMark[]
  readonly width?: number
  readonly height?: number
  readonly seed?: number
  readonly [option: string]: unknown
}

const MARKS_WITHOUT_DATA = new Set(["frame", "graticule", "sphere"])

const plotFunction = (name: string): ((...args: unknown[]) => unknown) => {
  const fn = (Plot as unknown as Record<string, unknown>)[name]
  if (typeof fn !== "function") throw new Error(`chartsPlot: Observable Plot has no "${name}".`)
  return fn as (...args: unknown[]) => unknown
}

/** One mark, built the way the static renderer builds it: transforms wrap the mark's options, outermost last. */
function buildMark(mark: BrowserPlotMark, rows: readonly unknown[] | undefined): unknown {
  const options: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(mark)) {
    if (key === "type" || key === "data" || key === "atlas" || key === "transform" || key === "outputs") continue
    options[key] = value
  }
  const data: unknown = mark.data !== undefined ? mark.data : rows
  if (mark.type === "hexbin") {
    const outputs = mark.outputs ?? { fill: "count" }
    return plotFunction("dot")(data, plotFunction("hexbin")(outputs, { ...options, tip: true }))
  }
  let built: Record<string, unknown> = mark.type === "geo" || mark.type === "text" || mark.type === "ruleX" || mark.type === "ruleY" || mark.type === "line" ? { ...options } : { ...options, tip: true }
  for (const transform of Array.isArray(mark.transform) ? mark.transform : []) {
    const fn = plotFunction(transform.type)
    const rest: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(transform)) if (key !== "type" && key !== "args") rest[key] = value
    const args = transform.args ?? {}
    built = transform.type === "centroid" ? (fn({ ...(args as Record<string, unknown>), ...rest, ...built }) as Record<string, unknown>) : (fn(args, { ...rest, ...built }) as Record<string, unknown>)
  }
  const factory = plotFunction(mark.type)
  if (MARKS_WITHOUT_DATA.has(mark.type)) return factory(built)
  return data === undefined ? factory(built) : factory(data, built)
}

/**
 * Draws a spec in `container`, replacing whatever it held, and returns the element Plot made. Rows given here are the
 * plot's data; marks may carry their own. `tip: true` is on every mark, so a pointer over a mark shows its values.
 */
export function render(container: Element, spec: BrowserPlotSpec, rows?: readonly unknown[], theme?: BrowserPlotTheme): Element {
  const width = spec.width ?? (container.clientWidth > 0 ? container.clientWidth : 640)
  const height = spec.height ?? (container.clientHeight > 0 ? container.clientHeight : 360)
  const categorical = theme ? [...theme.colors.categorical] : undefined
  const options: Record<string, unknown> = {
    width,
    height,
    tip: true,
    ...(theme ? { background: theme.colors.background, style: { color: theme.colors.text, fontFamily: `${theme.font.family}, sans-serif`, fontSize: `${theme.font.size}px` } } : {}),
    ...(categorical ? { color: { range: categorical } } : {}),
  }
  for (const [key, value] of Object.entries(spec)) if (key !== "marks" && key !== "seed" && key !== "data" && key !== "width" && key !== "height") options[key] = value
  if (spec.width !== undefined) options.width = spec.width
  if (spec.height !== undefined) options.height = spec.height
  const data = rows ?? (Array.isArray(spec.data as unknown[]) ? spec.data : undefined)
  if (data) options.data = data
  options.marks = spec.marks.map(mark => buildMark(mark, data as readonly unknown[] | undefined))
  // The server renderer's own seeded generator, at the seed the pipeline wrote into the spec, so the marks land where
  // the static SVG put them; a spec with no seed falls back to 1, the same default the server uses.
  const element = withSeededRandom(spec.seed ?? 1, () => Plot.plot(options as never)) as Element
  container.replaceChildren(element)
  return element
}

/** The browser entry point the interactive page calls. */
;(globalThis as Record<string, unknown>).chartsPlot = { render }
