import * as Plot from "@observablehq/plot"
import { parseHTML } from "linkedom"
import { feature } from "topojson-client"
import * as z from "zod"
import { ChartsError, SpecInvalid, pointer, suggest, type Issue } from "../errors.js"
import type { FontBook } from "../fonts.js"
import type { Row } from "../data.js"
import { checkRenderedSvg } from "../safety.js"
import { normaliseIds } from "../svg.js"
import { inkOn } from "../themes/palette.js"
import type { ThemeTokens } from "../themes/tokens.js"
import { ATLASES, atlasData, isObject, type Json } from "./common.js"
import { EU_COUNTRY_TILE_GRID, US_STATE_HEX_GRID, computeFlowArcs, hexGridExtent, hexPolygon, swarmOffsets, type FlowInput } from "../geo/cartograms.js"
import { withSeededRandom } from "../prng.js"

/**
 * Observable Plot, server-side.
 *
 * Plot builds an SVG through the DOM, so a headless document (`linkedom`) stands in for the browser, and the marks a
 * spec names are the ones Plot publishes. Two things make the output usable here:
 *
 * 1. The plot is built inside a seeded `Math.random`, so a mark that jitters or dodges places everything the same way
 *    on every run and the same input is the same bytes.
 * 2. The SVG Plot returns is post-processed: numeric width and height, a themed background, the bundled Inter family
 *    in place of `system-ui`, and every `em` offset resolved to pixels, so the bundled metrics measure exactly what
 *    resvg draws.
 *
 * A `PlotSpec` is plain JSON: marks with their channels, optional transforms, an optional bundled atlas for `geo`
 * marks, and Plot's own top-level scale and axis options.
 */

// ---------------------------------------------------------------------------------------------------------------
// What a spec may name.

const MARK_NAMES = [
  "dot", "barY", "barX", "lineY", "lineX", "areaY", "areaX", "rectY", "rectX", "rect", "cell",
  "ruleX", "ruleY", "text", "tickX", "tickY", "link", "arrow", "vector", "frame", "graticule", "sphere",
  "geo", "bollingerY", "bollingerX", "differenceY", "differenceX", "linearRegressionY", "linearRegressionX",
  "hexbin", "contour", "density", "waffleY", "waffleX", "delaunayLink", "delaunayMesh", "voronoi", "voronoiMesh",
  "hull", "tree",
] as const
export type PlotMarkName = (typeof MARK_NAMES)[number]
export const PLOT_MARKS: readonly string[] = MARK_NAMES

const TRANSFORM_NAMES = [
  "binX", "binY", "groupX", "groupY", "groupZ", "stackY", "stackX", "dodgeX", "dodgeY", "hexbin",
  "normalizeX", "normalizeY", "windowX", "windowY", "centroid",
] as const
export type PlotTransformName = (typeof TRANSFORM_NAMES)[number]
export const PLOT_TRANSFORMS: readonly string[] = TRANSFORM_NAMES

/** The bundled atlases a `geo` mark may name, all shipped as TopoJSON and converted offline. */
export const PLOT_ATLASES: readonly string[] = Object.keys(ATLASES)

/** Mark options a spec may use: Plot's channels, its per-mark options, and the shared mark options. */
const MARK_OPTIONS = [
  // channels
  "x", "y", "x1", "x2", "y1", "y2", "z", "r", "rx", "ry", "fill", "stroke", "opacity", "fillOpacity", "strokeOpacity",
  "strokeWidth", "strokeDash", "strokeLinecap", "strokeLinejoin", "width", "height", "text", "title", "href", "length",
  "rotate", "symbol", "curve", "marker", "markerStart", "markerEnd", "markerMid", "bend", "shape", "channels",
  // mark options
  "dx", "dy", "textAnchor", "fontSize", "fontFamily", "fontWeight", "fontStyle", "textDecoration", "lineAnchor",
  "lineHeight", "bend", "inset", "insetX", "insetY", "padding", "binWidth", "thresholds", "geometry", "fillPositive",
  "fillNegative", "positiveFill", "negativeFill", "n", "k", "unit", "gap", "step", "interval", "sort", "reverse",
  "filter", "tip", "initializer", "ariaLabel", "ariaDescription", "clip", "borderRadius", "strokeDasharray",
  "tension", "path", "delimiter", "treeHeight", "treeAnchor", "treeSort", "curve", "reduce", "outputs", "notch",
  "smooth", "arrow", "sweep", "levels", "value", "label", "axis", "legend", "scale", "transform",
  // where a text mark sits when it names no data point: the frame's own corner
  "frameAnchor",
] as const

const TOP_LEVEL = [
  "marks", "data", "width", "height", "margin", "marginTop", "marginRight", "marginBottom", "marginLeft", "inset",
  "insetX", "insetY", "padding", "background", "style", "color", "className", "title", "subtitle",
  "projection", "x", "y", "fx", "fy", "axis", "grid", "legend", "clip", "aspectRatio", "ariaLabel", "ariaDescription",
  // this engine's own
  "seed", "atlas",
] as const

/** One transform inside a mark: its type, its own first argument, and any other options it merges into the mark. */
export interface PlotTransformSpec {
  readonly type: string
  /** The transform's own first argument: bin or group outputs, dodge options, or a normalization basis. */
  readonly args?: Json | string | number
  readonly [option: string]: unknown
}

/** One mark: a Plot mark type, its channels and options, optional transforms, and optional inline data. */
export interface PlotMarkSpec {
  readonly type: string
  /** Inline rows for this mark only; without it the mark reads the plot-level data. */
  readonly data?: readonly unknown[]
  /** A bundled atlas, which makes this a `geo` mark over those features. */
  readonly atlas?: string
  /** Hexbin's outputs, such as `{ fill: "count" }`. */
  readonly outputs?: Json
  readonly transform?: readonly PlotTransformSpec[]
  readonly [option: string]: unknown
}

export interface PlotSpec {
  readonly marks: readonly PlotMarkSpec[]
  readonly width?: number
  readonly height?: number
  readonly seed?: number
  readonly atlas?: string
  readonly [option: string]: unknown
}

const PlotSpecSchema = z.looseObject({
  marks: z.array(z.looseObject({ type: z.string().min(1) })).min(1),
  data: z.array(z.unknown()).optional(),
  width: z.number().int().min(50).max(4000).optional(),
  height: z.number().int().min(50).max(4000).optional(),
  seed: z.number().int().min(0).max(2 ** 31 - 1).optional(),
  projection: z.union([z.string().min(1), z.record(z.string(), z.unknown())]).optional(),
})

// ---------------------------------------------------------------------------------------------------------------
// Determinism: the one seeded Mulberry32 in `src/prng.ts` stands in for Math.random while Plot builds the chart, so
// the same seed places jitter, dodging and sampling the same way on every run, in the server renderer and the page.

// ---------------------------------------------------------------------------------------------------------------
// Validation.

/** The supported mark type closest to `name`, or undefined. */
const closestMark = (name: string) => suggest(name, MARK_NAMES)[0]

/** Validates a PlotSpec, returning the parsed spec and every problem found, each with a JSON path and a fix. */
export function validatePlotSpec(input: unknown): { spec: PlotSpec; issues: Issue[] } {
  const issues: Issue[] = []
  const parsed = PlotSpecSchema.safeParse(input)
  if (!parsed.success) {
    for (const problem of parsed.error.issues) issues.push({ level: "error", code: "SPEC_INVALID", message: problem.message, path: pointer(problem.path as (string | number)[]), fix: "Plot specs are marks with channels; charts can show a working example." })
    return { spec: { marks: [] }, issues }
  }
  const spec = parsed.data as unknown as PlotSpec
  for (const key of Object.keys(spec)) {
    if (!(TOP_LEVEL as readonly string[]).includes(key)) {
      const close = suggest(key, TOP_LEVEL)[0]
      issues.push({ level: "error", code: "UNKNOWN_PROPERTY", message: `"${key}" is not a Plot property.`, path: pointer([key]), fix: close ? `Did you mean "${close}"?` : "Remove it." })
    }
  }
  if (typeof spec.atlas === "string" && !PLOT_ATLASES.includes(spec.atlas)) {
    issues.push({ level: "error", code: "ATLAS_UNKNOWN", message: `There is no bundled map "${spec.atlas}".`, path: pointer(["atlas"]), fix: `Use one of: ${PLOT_ATLASES.join(", ")}.` })
  }
  spec.marks.forEach((mark, index) => {
    if (!isObject(mark)) {
      issues.push({ level: "error", code: "SPEC_INVALID", message: "A mark must be an object.", path: pointer(["marks", index]), fix: "Give each mark a type and its channels." })
      return
    }
    const at = (...parts: (string | number)[]) => pointer(["marks", index, ...parts])
    if (!(MARK_NAMES as readonly string[]).includes(mark.type)) {
      const close = closestMark(mark.type)
      issues.push({ level: "error", code: "UNKNOWN_MARK", message: `"${mark.type}" is not an Observable Plot mark.`, path: at("type"), fix: close ? `Did you mean "${close}"?` : `Use one of: ${MARK_NAMES.join(", ")}.` })
    }
    if (mark.atlas !== undefined && (typeof mark.atlas !== "string" || !PLOT_ATLASES.includes(mark.atlas))) {
      issues.push({ level: "error", code: "ATLAS_UNKNOWN", message: `There is no bundled map "${String(mark.atlas)}" for this mark.`, path: at("atlas"), fix: `Use one of: ${PLOT_ATLASES.join(", ")}.` })
    }
    if (mark.data !== undefined && !Array.isArray(mark.data)) issues.push({ level: "error", code: "DATA_INVALID", message: "A mark's data must be an array of rows.", path: at("data"), fix: "Pass rows as data, or drop data and use the plot's rows." })
    for (const [key, value] of Object.entries(mark)) {
      if (["type", "data", "atlas", "outputs", "transform"].includes(key)) continue
      if (!(MARK_OPTIONS as readonly string[]).includes(key)) {
        const close = suggest(key, MARK_OPTIONS)[0]
        issues.push({ level: "warning", code: "UNKNOWN_PROPERTY", message: `"${key}" is not a mark option this engine knows.`, path: at(key), fix: close ? `Did you mean "${close}"?` : "Remove it; Plot ignores options it does not use." })
      }
      if (value === undefined) issues.push({ level: "warning", code: "VALUE_MISSING", message: `"${key}" is undefined.`, path: at(key), fix: "Remove it, or give it a value." })
    }
    if (mark.transform !== undefined) {
      if (!Array.isArray(mark.transform)) issues.push({ level: "error", code: "TRANSFORM_INVALID", message: "transform must be an array of transforms.", path: at("transform"), fix: "Write one object per transform, such as [{\"type\": \"dodgeY\"}]." })
      else mark.transform.forEach((transform, t) => {
        if (!isObject(transform) || typeof transform.type !== "string") {
          issues.push({ level: "error", code: "TRANSFORM_INVALID", message: "A transform needs a type.", path: at("transform", t), fix: `Use one of: ${TRANSFORM_NAMES.join(", ")}.` })
          return
        }
        if (!(TRANSFORM_NAMES as readonly string[]).includes(transform.type)) {
          const close = suggest(transform.type, TRANSFORM_NAMES)[0]
          issues.push({ level: "error", code: "TRANSFORM_INVALID", message: `"${transform.type}" is not a Plot transform this engine supports.`, path: at("transform", t, "type"), fix: close ? `Did you mean "${close}"?` : `Use one of: ${TRANSFORM_NAMES.join(", ")}.` })
        }
      })
      const initializers = mark.transform.filter(transform => isObject(transform) && ["dodgeX", "dodgeY", "hexbin"].includes(String(transform.type)))
      if (initializers.length > 1) issues.push({ level: "error", code: "TRANSFORM_INVALID", message: "Two placement transforms cannot be stacked: each one positions the marks itself.", path: at("transform"), fix: "Keep one of dodgeX, dodgeY or hexbin." })
    }
  })
  return { spec, issues }
}

// ---------------------------------------------------------------------------------------------------------------
// Compiling a spec into Plot's own options.

const plotFunction = (name: string): ((...args: unknown[]) => unknown) => {
  const fn = (Plot as unknown as Record<string, unknown>)[name]
  if (typeof fn !== "function") throw new ChartsError("RENDER_FAILED", `Observable Plot has no "${name}".`, "Use a mark from charts_capabilities; the plot engine lists the marks it supports.")
  return fn as (...args: unknown[]) => unknown
}

const atlasCache = new Map<string, Json>()
/** A bundled TopoJSON atlas as GeoJSON features, ready for a `geo` mark. */
export function atlasFeatures(packageRoot: string, name: string): Json {
  const cached = atlasCache.get(name)
  if (cached) return cached
  const atlas = ATLASES[name]
  if (!atlas) throw new ChartsError("ATLAS_UNKNOWN", `There is no bundled map "${name}".`, `Use one of: ${PLOT_ATLASES.join(", ")}.`)
  const data = atlasData(packageRoot, name) as Json
  const topo = data.values as Json
  const objects = topo && isObject(topo.objects) ? topo.objects : {}
  const geometry = objects[atlas.feature]
  if (!geometry) throw new ChartsError("ATLAS_UNKNOWN", `The bundled map "${name}" has no "${atlas.feature}".`, "Use one of: " + PLOT_ATLASES.join(", ") + ".")
  const collection = feature(topo as never, geometry as never) as unknown as Json
  atlasCache.set(name, collection)
  return collection
}

/** The transform's own first argument, as Plot expects it. */
function transformArgs(transform: PlotTransformSpec): unknown {
  const args = transform.args
  if (typeof args === "number" || typeof args === "string") return args
  return isObject(args) ? { ...args } : {}
}

const transformOptions = (transform: PlotTransformSpec): Json => {
  const out: Json = {}
  for (const [key, value] of Object.entries(transform)) if (key !== "type" && key !== "args") out[key] = value
  return out
}

/** Marks that draw the plot's own furniture and take options only, never data. */
const NO_DATA_MARKS: ReadonlySet<string> = new Set(["frame", "graticule", "sphere"])

/**
 * Wraps mark options in a transform, the way Plot composes them: each transform takes its own options and the mark
 * options built so far, and returns new mark options with the transform attached.
 */
function applyTransform(transform: PlotTransformSpec, options: Json): Json {
  const fn = plotFunction(transform.type)
  const rest = transformOptions(transform)
  const args = transformArgs(transform)
  if (transform.type === "centroid") return fn({ ...(isObject(args) ? args : {}), ...rest, ...options }) as Json
  return fn(args, { ...rest, ...options }) as Json
}

/** One mark, compiled: a Plot mark over the plot's rows (or its own), with its transforms applied. */
function compileMark(mark: PlotMarkSpec, rows: readonly Row[] | undefined, specAtlas: string | undefined, packageRoot: string): unknown {
  const options: Json = {}
  for (const [key, value] of Object.entries(mark)) {
    if (["type", "data", "atlas", "outputs", "transform"].includes(key)) continue
    options[key] = value
  }
  let data: unknown = Array.isArray(mark.data) ? mark.data : rows
  const atlas = typeof mark.atlas === "string" ? mark.atlas : typeof specAtlas === "string" && mark.type === "geo" ? specAtlas : undefined
  if (atlas) {
    try {
      data = atlasFeatures(packageRoot, atlas)
    } catch (error) {
      throw error instanceof ChartsError ? error : new ChartsError("ATLAS_UNKNOWN", `The bundled map "${atlas}" could not be read.`, "Use one of: " + PLOT_ATLASES.join(", ") + ".")
    }
  }
  // hexbin is a placement transform in Plot, not a mark of its own: it turns a dot mark into a binned one.
  if (mark.type === "hexbin") {
    const outputs = isObject(mark.outputs) ? mark.outputs : { fill: "count" }
    return plotFunction("dot")(data, plotFunction("hexbin")(outputs, options))
  }
  let built = options
  for (const transform of Array.isArray(mark.transform) ? mark.transform : []) {
    if (!isObject(transform) || typeof transform.type !== "string") continue
    try {
      built = applyTransform(transform as PlotTransformSpec, built)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      throw new ChartsError("TRANSFORM_INVALID", `The ${transform.type} transform could not be applied: ${message}`, "Check the transform's channels and options; two placement transforms cannot be stacked.")
    }
  }
  const factory = plotFunction(mark.type)
  // A few marks are the plot's own furniture and take no data at all: their only argument is their options.
  if (NO_DATA_MARKS.has(mark.type)) return factory(built)
  return data === undefined ? factory(built) : factory(data, built)
}

// ---------------------------------------------------------------------------------------------------------------
// Field diagnostics: a channel that names a field the rows do not have draws nothing, so say so with the closest name.

const POSITIONAL = ["x", "y", "x1", "x2", "y1", "y2", "text", "z", "r", "length", "weight"] as const
const CSS_KEYWORD = /^(?:none|transparent|currentcolor|black|white|red|green|blue|gray|grey|orange|purple|yellow|pink|brown|cyan|magenta|steelblue)$/i
const isPaint = (value: string) => /^(?:#|rgb|hsl|oklch|color\(|var\()/i.test(value) || CSS_KEYWORD.test(value)

/** Names a mark's transforms produce (their outputs, arguments and channel values), which are fields by then. */
function transformedNames(mark: PlotMarkSpec): Set<string> {
  const names = new Set<string>()
  const add = (value: unknown) => {
    if (typeof value === "string") names.add(value)
    else if (Array.isArray(value)) value.forEach(add)
    else if (isObject(value)) Object.values(value).forEach(add)
  }
  for (const transform of Array.isArray(mark.transform) ? mark.transform : []) {
    add(transform.args)
    for (const [key, value] of Object.entries(transform)) if (key !== "type" && key !== "args") add(value)
  }
  if (isObject(mark.outputs)) Object.values(mark.outputs).forEach(add)
  return names
}

/** Warnings for channel values that name no field in the rows the mark draws. */
export function fieldIssues(spec: PlotSpec, rows: readonly Row[] | undefined): Issue[] {
  if (!rows || rows.length === 0) return []
  const known = new Set<string>()
  for (const row of rows) for (const key of Object.keys(row)) known.add(key)
  const issues: Issue[] = []
  spec.marks.forEach((mark, index) => {
    if (!isObject(mark) || typeof mark.atlas === "string") return
    const data = Array.isArray(mark.data) ? (mark.data as readonly unknown[]) : rows
    const fields = Array.isArray(mark.data) ? new Set(data.flatMap(row => (isObject(row) ? Object.keys(row) : []))) : known
    const produced = transformedNames(mark)
    for (const channel of POSITIONAL) {
      const value = mark[channel]
      if (typeof value !== "string" || value === "" || isPaint(value) || produced.has(value) || fields.has(value)) continue
      const close = suggest(value, [...fields])[0]
      issues.push({
        level: "warning",
        code: "UNKNOWN_FIELD",
        message: `The ${channel} channel names "${value}", which the rows do not have, so that mark draws nothing.`,
        path: pointer(["marks", index, channel]),
        fix: close ? `Set ${channel} to "${close}".` : `Use one of: ${[...fields].slice(0, 20).join(", ")}.`,
      })
    }
  })
  return issues
}

// ---------------------------------------------------------------------------------------------------------------
// Theme and output.

/** Plot's own options for the theme: the canvas, the grid and the bundled family. */
function themeOptions(theme: ThemeTokens, width: number, height: number, family: string): Json {
  const c = theme.colors
  return {
    width,
    height,
    background: c.background,
    style: { fontFamily: family },
    color: { range: [...c.categorical] },
    grid: theme.axis.grid,
  }
}

const escapeAttribute = (value: string) => value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;")

/**
 * Turns a Plot-built SVG into the plugin's SVG: explicit numeric width and height, a background rect, the bundled
 * family, resolved `currentColor` and `--plot-background`, and every `em` offset written as pixels. Plot's `<style>`
 * block is dropped: it only restates display rules a static SVG does not need, and a static chart carries no style
 * sheet at all.
 */
export function finalisePlotSvg(raw: string, theme: ThemeTokens, family: string, fallbackWidth: number, fallbackHeight: number, headings: { title?: string; subtitle?: string } = {}): string {
  const c = theme.colors
  const svg = raw.replace(/<style\b[^>]*>[\s\S]*?<\/style>/g, "")
  const root = /^<svg\b([^>]*)>/.exec(svg)
  if (!root) throw new ChartsError("RENDER_FAILED", "Observable Plot did not return an SVG document.", "Check the marks and channels; charts_catalogue has a working example for each chart type.")
  const attribute = (name: string) => new RegExp(`(?:^|\\s)${name}="([^"]*)"`).exec(root[1]!)?.[1]
  const width = Math.round(Number(attribute("width") ?? fallbackWidth) || fallbackWidth)
  const height = Math.round(Number(attribute("height") ?? fallbackHeight) || fallbackHeight)
  const rest = root[1]!
    .replace(/(?:^|\s)(?:class|style|font-family|font-size|fill|width|height|viewBox|aria-label|role)="[^"]*"/g, "")
    .replace(/\s+/g, " ")
    .trim()
  let content = svg.slice(root[0].length).replace(/<\/svg>\s*$/, "")
  content = content.replace(/currentColor/g, c.text).replace(/var\(--plot-background\)/g, c.background)
  // Plot's stylesheet centres text marks and x-axis tick labels unless the mark's group sets its own text-anchor.
  content = content.replace(/<g\b([^>]*aria-label="(?:text|x-axis tick label)"[^>]*)>/g, (whole, attrs: string) => (/\btext-anchor=/.test(attrs) ? whole : `<g${attrs} text-anchor="middle">`))
  content = content.replace(/<g\b([^>]*aria-label="y-axis tick label"[^>]*)>/g, (whole, attrs: string) => (/\btext-anchor=/.test(attrs) ? whole : `<g${attrs} text-anchor="end">`))
  content = axisTitleOffsets(content, theme.font.size)
  // Plot spaces axis titles for 10 px text. At a larger theme size the titles need more room, so the canvas grows by
  // the same amount and the drawing shifts right, keeping the leftmost title inside the image.
  const ratio = theme.font.size / 10
  const axisGrow = ratio > 1 && /aria-label="[xy]-axis label"/.test(content) ? Math.ceil((ratio - 1) * 27) : 0
  const titleSize = theme.font.titleSize, subtitleSize = theme.font.subtitleSize
  const headHeight = (headings.title ? titleSize + 10 : 0) + (headings.subtitle ? subtitleSize + 8 : 0)
  const outWidth = width + axisGrow, outHeight = height + axisGrow + headHeight
  const tag = `<svg${rest ? ` ${rest}` : ""} xmlns="http://www.w3.org/2000/svg" width="${outWidth}" height="${outHeight}" viewBox="0 0 ${outWidth} ${outHeight}" font-family="${escapeAttribute(family)}" font-size="${theme.font.size}" fill="${c.text}" style="--plot-background: ${c.background}" role="img"`
  const head = headHeight > 0 || axisGrow > 0 ? ` transform="translate(${axisGrow},${headHeight})"` : ""
  const heading = (headings.title ? `<text x="${axisGrow + 8}" y="${titleSize}" text-anchor="start" font-size="${titleSize}" font-weight="${theme.font.titleWeight}" fill="${c.text}">${escapeText(headings.title)}</text>` : "") +
    (headings.subtitle ? `<text x="${axisGrow + 8}" y="${(headings.title ? titleSize + 10 : 0) + subtitleSize}" text-anchor="start" font-size="${subtitleSize}" fill="${c.muted}">${escapeText(headings.subtitle)}</text>` : "")
  const body = head ? `<g${head}>${content}</g>` : content
  return emToPixels(`${tag}><rect x="0" y="0" width="${outWidth}" height="${outHeight}" fill="${c.background}"/>${heading}${body}</svg>`, theme.font.size)
}

const escapeText = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")

/**
 * Plot spaces an axis title for its own 10 px default text. The theme draws text at its own size, so the title moves
 * out by the same ratio, which keeps the title clear of the tick labels at every theme size.
 */
function axisTitleOffsets(svg: string, fontSize: number): string {
  const ratio = fontSize / 10
  if (Math.abs(ratio - 1) < 0.01) return svg
  return svg.replace(/<g\b([^>]*aria-label="(x|y)-axis label"[^>]*)>/g, (whole, attrs: string, axis: string) => whole.replace(/transform="translate\(([^)]*)\)"/, (_all, args: string) => {
    const parts = args.split(/[\s,]+/).filter(Boolean).map(Number)
    if (parts.some(part => !Number.isFinite(part))) return _all
    const [x = 0, y = 0] = parts
    return `transform="translate(${axis === "y" ? x * ratio : x},${axis === "x" ? y * ratio : y})"`
  }))
}

/** Rewrites `y="0.32em"` and `dy="0.71em"` as pixels, tracking the font size each element inherits. */
function emToPixels(svg: string, rootSize: number): string {
  const sizes: number[] = []
  let out = ""
  let last = 0
  const tag = /<(\/?)([A-Za-z][\w:-]*)([^>]*?)(\/?)>/g
  for (const match of svg.matchAll(tag)) {
    out += svg.slice(last, match.index)
    last = match.index! + match[0].length
    const [whole, close, name, attrs = "", selfClose] = match
    if (close) {
      sizes.pop()
      out += whole
      continue
    }
    const own = /(?:^|\s)font-size="([^"]*)"/.exec(attrs)?.[1]
    const inherited = sizes[sizes.length - 1] ?? rootSize
    const size = own === undefined ? inherited : Number(own) || inherited
    if (!selfClose) sizes.push(size)
    if (name === "text") out += whole.replace(/\s(?:y|dy)="(-?[\d.]+)em"/g, (_all, value: string) => ` y="${(Number(value) * size).toFixed(3).replace(/\.?0+$/, "")}"`)
    else out += whole
  }
  out += svg.slice(last)
  return out
}

export interface PlotRenderContext {
  readonly packageRoot: string
  readonly theme: ThemeTokens
  readonly fonts: FontBook
  readonly rows?: readonly Row[]
  readonly width?: number
  readonly height?: number
  readonly seed?: number
  readonly family?: string
}

export interface PlotRender {
  readonly svg: string
  readonly width: number
  readonly height: number
  readonly issues: readonly Issue[]
}

/** The seed a render uses when neither the caller nor the spec names one: the same value the page's runtime defaults to,
 * so a spec rendered to SVG and the same spec drawn live in the browser place their jitter identically. */
const DEFAULT_SEED = 1

/**
 * Renders a validated PlotSpec to SVG. The plot is built inside `withSeededRandom`, so two calls with one seed give
 * the same bytes; the result is checked for safety and its ids are renumbered, exactly as the other engines' output.
 */
export function renderPlot(input: unknown, ctx: PlotRenderContext): PlotRender {
  const { spec, issues } = validatePlotSpec(input)
  if (issues.some(issue => issue.level === "error")) throw new SpecInvalid(issues)
  const family = ctx.family ?? `${ctx.theme.font.family}, sans-serif`
  const width = Math.round(ctx.width ?? spec.width ?? ctx.theme.layout.width)
  const height = Math.round(ctx.height ?? spec.height ?? ctx.theme.layout.height)
  const seed = ctx.seed ?? spec.seed ?? DEFAULT_SEED
  const { document } = parseHTML("<html><body></body></html>")
  const options: Json = { ...themeOptions(ctx.theme, width, height, family) }
  for (const [key, value] of Object.entries(spec)) {
    if (["marks", "seed", "atlas", "width", "height", "title", "subtitle"].includes(key)) continue
    options[key] = value
  }
  if (spec.width !== undefined) options.width = spec.width
  if (spec.height !== undefined) options.height = spec.height
  const rows = ctx.rows ?? (Array.isArray(spec.data) ? (spec.data as Row[]) : undefined)
  if (rows && options.data === undefined) options.data = rows
  options.marks = spec.marks.map(mark => compileMark(mark, rows, typeof spec.atlas === "string" ? spec.atlas : undefined, ctx.packageRoot))
  options.document = document
  let element: unknown
  try {
    element = withSeededRandom(seed, () => Plot.plot(options as never))
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new ChartsError("RENDER_FAILED", `Observable Plot could not render the spec: ${message}`, "Check each mark's channels and the fields they name; charts_catalogue has a working example for each chart type.")
  }
  const raw = (element as { outerHTML?: string }).outerHTML
  if (typeof raw !== "string") throw new ChartsError("RENDER_FAILED", "Observable Plot did not return an SVG element.", "Render a spec with at least one mark.")
  const headings = {
    ...(typeof spec.title === "string" ? { title: spec.title } : {}),
    ...(typeof spec.subtitle === "string" ? { subtitle: spec.subtitle } : {}),
  }
  issues.push(...fieldIssues(spec, rows))
  const svg = normalisePlot(finalisePlotSvg(raw, ctx.theme, family, width, height, headings))
  const measured = /<svg\b[^>]*\swidth="(\d+)"[^>]*\sheight="(\d+)"/.exec(svg)
  return { svg, width: measured ? Number(measured[1]) : width, height: measured ? Number(measured[2]) : height, issues }
}

/** The safety check and id renumbering every rendered chart gets, applied where the SVG is made. */
function normalisePlot(svg: string): string {
  checkRenderedSvg(svg)
  return normaliseIds(svg)
}

// ---------------------------------------------------------------------------------------------------------------
// Turn-key recipes: one call from rows to a finished, themed plot.

const bound = (bindings: Json, key: string, fallback: string): string => {
  const value = bindings[key]
  return typeof value === "string" && value.trim() ? value.trim() : fallback
}

const numberOption = (options: Json, key: string, fallback: number): number => {
  const value = options[key]
  return typeof value === "number" && Number.isFinite(value) ? value : fallback
}

const textOption = (options: Json, key: string): string | undefined => {
  const value = options[key]
  return typeof value === "string" && value.trim() ? value.trim() : undefined
}

const numeric = (value: unknown): number | undefined => {
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : undefined
  }
  return undefined
}

/** The size a recipe asks for, honouring the caller's width and height. */
const sizeOf = (options: Json, width: number, height: number) => ({ width: Math.round(numberOption(options, "width", width)), height: Math.round(numberOption(options, "height", height)) })

/** Axis titles, only when the caller names them: an unneeded title is one more label to clip. */
const axisTitles = (options: Json): Json => {
  const x = textOption(options, "xLabel"), y = textOption(options, "yLabel")
  return { ...(x ? { x: { label: x } } : {}), ...(y ? { y: { label: y } } : {}) }
}

export interface PlotRecipe {
  readonly id: string
  /** The chart a caller asks for. */
  readonly title: string
  readonly description: string
  /** Binding roles this recipe reads, as `role: default field`. */
  readonly bindings: readonly string[]
  /** Options this recipe reads, as `name: default`. */
  readonly options: readonly string[]
}

const RECIPE_META: readonly PlotRecipe[] = [
  { id: "hexbin", title: "Hexbin scatter", description: "Two numeric fields binned into hexagons, shaded by how many rows land in each.", bindings: ["x: x", "y: y"], options: ["binWidth: 16", "width: 560", "height: 340", "xLabel", "yLabel"] },
  { id: "contour", title: "Density contours", description: "A two-dimensional kernel density estimate drawn as filled contour bands, so where the points pile up reads at a glance.", bindings: ["x: x", "y: y"], options: ["thresholds: 10", "width: 560", "height: 340", "xLabel", "yLabel"] },
  { id: "beeswarm", title: "Beeswarm", description: "One dot per row, dodged sideways where values collide, so a distribution is readable at a glance.", bindings: ["group: group", "value: value"], options: ["radius: 3", "width: 560", "height: 340", "xLabel", "yLabel"] },
  { id: "bollinger", title: "Bollinger band", description: "A moving average with a volatility band around it, for a time series.", bindings: ["x: date", "y: value"], options: ["window: 20", "k: 2", "width: 560", "height: 340", "xLabel", "yLabel"] },
  { id: "difference_area", title: "Difference area", description: "Two series shaded by which one is ahead: gains one colour, gaps the other.", bindings: ["x: date", "y1: plan", "y2: actual"], options: ["width: 560", "height: 340", "xLabel", "yLabel"] },
  { id: "waffle", title: "Waffle", description: "A part-to-whole composition as a 100-square grid, one colour per category and a legend beside it.", bindings: ["category: category", "value: value"], options: ["grid: 10", "cell: 30", "width", "height"] },
  { id: "arrow_change", title: "Arrow change", description: "Each row as an arrow from its before point to its after point, labelled at the head.", bindings: ["x1: start", "y1: from", "x2: end", "y2: to", "label: label"], options: ["bend: 18", "width: 560", "height: 340", "xLabel", "yLabel"] },
  { id: "voronoi", title: "Voronoi tessellation", description: "The plane split into the region nearest each point, so local density and gaps read at once.", bindings: ["x: x", "y: y"], options: ["width: 560", "height: 340", "xLabel", "yLabel"] },
  { id: "ridgeline", title: "Ridgeline", description: "A smoothed density curve per category, stacked so categories can be compared by shape.", bindings: ["value: value", "category: group"], options: ["bins: 48", "width: 560", "height: 360", "xLabel"] },
  { id: "horizon", title: "Horizon", description: "A time series folded into colour bands, so a long run fits in a short strip.", bindings: ["x: date", "value: value", "series: series"], options: ["levels: 4", "width: 560", "height: 220", "xLabel"] },
  { id: "cartogram_us_hex", title: "US state hex cartogram", description: "All 51 states and DC as equal hexagons, shaded by a value, labelled with postal codes and a colour legend.", bindings: ["code: postal", "value: value"], options: ["width: 620", "height: 420", "legendTitle", "fontSize"] },
  { id: "cartogram_eu_tile", title: "Europe tile cartogram", description: "The 27 EU members plus the UK, Switzerland, Norway, Iceland and Ukraine as equal tiles, shaded by a value.", bindings: ["code: iso3", "value: value"], options: ["width: 620", "height: 440", "cell: 56", "legendTitle", "fontSize"] },
  { id: "flow_map", title: "Geodesic flow map", description: "Origin-to-destination flows as great-circle arcs over a world land base in an Equal Earth projection, with hubs and optional labels.", bindings: ["originLat: originLat", "originLon: originLon", "destLat: destLat", "destLon: destLon", "value: value", "label: label"], options: ["width: 640", "height: 360", "labels: false", "fontSize"] },
] as const

export const PLOT_RECIPES: readonly PlotRecipe[] = RECIPE_META

/** Rows with numeric fields coerced, so a CSV's numbers and a typed row list both work. */
const groupRows = (rows: readonly Row[], field: string, value: string): Map<string, number[]> => {
  const groups = new Map<string, number[]>()
  for (const row of rows) {
    const key = row[field]
    const number = numeric(row[value])
    if (key === undefined || key === null || number === undefined) continue
    const name = String(key)
    const list = groups.get(name)
    if (list) list.push(number)
    else groups.set(name, [number])
  }
  return groups
}

/** A Gaussian kernel density on a shared grid, normalised to a fixed ridge height. */
function ridgeRows(rows: readonly Row[], value: string, category: string, bins: number): { rows: Row[]; labels: Row[]; min: number; max: number } {
  const groups = groupRows(rows, category, value)
  const names = [...groups.keys()].sort().reverse()
  const all = [...groups.values()].flat()
  if (all.length === 0) return { rows: [], labels: [], min: 0, max: 1 }
  const min = Math.min(...all), max = Math.max(...all)
  const span = max - min || 1
  const steps = Math.max(8, Math.min(200, Math.round(bins)))
  const bandwidth = Math.max(span / 60, span / (Math.log2(all.length + 2) * 3.5))
  const grid = Array.from({ length: steps }, (_, i) => min + (i / (steps - 1)) * span)
  const height = 1
  let peak = 0
  const curves = names.map(name => {
    const values = groups.get(name)!
    const density = grid.map(x => values.reduce((sum, v) => sum + Math.exp(-0.5 * ((x - v) / bandwidth) ** 2), 0) / (values.length * bandwidth * Math.sqrt(2 * Math.PI)))
    for (const d of density) peak = Math.max(peak, d)
    return density
  })
  const norm = peak || 1
  const out: Row[] = [], labels: Row[] = []
  names.forEach((name, index) => {
    const base = (names.length - 1 - index) * height
    grid.forEach((x, i) => { out.push({ x, base, ridge: base + (curves[index]![i]! / norm) * height * 0.92, category: name }) })
    labels.push({ x: min + span * 0.015, ridge: base + height * 0.34, category: name })
  })
  return { rows: out, labels, min, max }
}

/** A horizon strip: each value folded into `levels` bands that share the same vertical space. */
function horizonRows(rows: readonly Row[], x: string, value: string, series: string | undefined, levels: number): Row[] {
  const usable = rows.flatMap(row => {
    const at = numeric(row[x]), v = numeric(row[value])
    return at === undefined || v === undefined ? [] : [{ x: at, v, series: series === undefined ? "all" : String(row[series] ?? "") }]
  })
  if (usable.length === 0) return []
  const top = Math.max(...usable.map(row => row.v), 0) || 1
  const levelCount = Math.max(1, Math.min(8, Math.round(levels)))
  const step = top / levelCount
  const out: Row[] = []
  for (const row of usable) for (let band = 0; band < levelCount; band++) {
    const filled = Math.min(Math.max((row.v - band * step) / step, 0), 1)
    if (filled <= 0) continue
    out.push({ x: row.x, y0: band, y1: band + filled, band, series: row.series, group: `${row.series}\u0000${band}` })
  }
  return out
}

/** The two inks a cartogram label chooses between: dark ink on a light tile, light ink on a dark one. */
function cartogramInks(theme: ThemeTokens): { dark: string; light: string } {
  return theme.mode === "dark" ? { dark: theme.colors.background, light: theme.colors.text } : { dark: theme.colors.text, light: "#FFFFFF" }
}

/** Which of the two inks a label on `fill` takes. */
const inkFor = (fill: string, theme: ThemeTokens): "dark" | "light" => {
  const inks = cartogramInks(theme)
  return inkOn(fill, inks.dark, inks.light) === inks.dark ? "dark" : "light"
}

/** The quantize bucket a value falls in, matching the scale Plot draws for the same domain and range. */
const bucketFor = (value: number, min: number, max: number, count: number): number => {
  const t = max === min ? 0.5 : (value - min) / (max - min)
  return Math.min(count - 1, Math.max(0, Math.floor(t * count)))
}

/** A compact number for a legend tick: thousands grouped, whole numbers as they are, fractions to two decimals. */
const formatNumber = (value: number): string => {
  if (!Number.isFinite(value)) return ""
  if (value === 0) return "0"
  if (Math.abs(value) >= 1000) return String(Math.round(value)).replace(/\B(?=(\d{3})+(?!\d))/g, ",")
  if (Number.isInteger(value)) return String(value)
  return (Math.abs(value) >= 10 ? value.toFixed(1) : value.toFixed(2)).replace(/0+$/, "").replace(/\.$/, "")
}

/**
 * A colour-scale legend drawn with ordinary marks. Plot's own continuous legend paints a canvas ramp, which a
 * headless document has no context for, so the swatches and their ticks are geometry like everything else: a column
 * of the theme's sequential colours, the range at the top and bottom, and a title.
 */
function legendMarks(theme: ThemeTokens, options: { x: number; top: number; width: number; height: number; min: number; max: number; title?: string; fontSize: number }): PlotMarkSpec[] {
  const ramp = [...theme.colors.sequential]
  const swatch = options.height / ramp.length
  const marks: PlotMarkSpec[] = []
  ramp.forEach((colour, index) => {
    const y2 = options.top - index * swatch
    const y1 = y2 - swatch
    marks.push({ type: "rect", data: [{ x1: options.x, x2: options.x + options.width, y1, y2 }], x1: "x1", x2: "x2", y1: "y1", y2: "y2", fill: colour, stroke: theme.colors.background, strokeWidth: 0.5 })
  })
  const ticks = [options.max, options.min === options.max ? options.min : (options.min + options.max) / 2, options.min]
  const at = [options.top, options.top - options.height / 2, options.top - options.height]
  ticks.forEach((tick, index) => {
    marks.push({ type: "text", data: [{ x: options.x + options.width + 6, y: at[index], text: formatNumber(tick) }], x: "x", y: "y", text: "text", textAnchor: "start", fill: theme.colors.muted, fontSize: options.fontSize })
  })
  if (options.title) marks.push({ type: "text", data: [{ x: options.x, y: options.top + 16, text: options.title }], x: "x", y: "y", text: "text", textAnchor: "start", fill: theme.colors.text, fontSize: options.fontSize + 1, fontWeight: 600 })
  return marks
}

/** A categorical legend drawn with marks: a swatch and a label per series, inside the chart's own coordinates. */
function categoryLegendMarks(theme: ThemeTokens, options: { x: number; top: number; entries: readonly { label: string; colour: string }[]; fontSize: number; step?: number }): PlotMarkSpec[] {
  const step = options.step ?? Math.round(options.fontSize * 1.5)
  const marks: PlotMarkSpec[] = []
  options.entries.forEach((entry, index) => {
    const y = options.top - index * step
    marks.push({ type: "rect", data: [{ x1: options.x, x2: options.x + step * 0.66, y1: y - step * 0.66, y2: y }], x1: "x1", x2: "x2", y1: "y1", y2: "y2", fill: entry.colour, stroke: "none" })
    marks.push({ type: "text", data: [{ x: options.x + step * 0.66 + 5, y: y - step * 0.33, text: entry.label }], x: "x", y: "y", text: "text", textAnchor: "start", fill: theme.colors.muted, fontSize: options.fontSize })
  })
  return marks
}

/** Shared sizing for the two cartograms: a map area plus a legend column, in pixels, with a small outer pad. */
const CARTOGRAM_PAD = 10
const CARTOGRAM_LEGEND = 104

/**
 * Where a cartogram's pieces land: the map's extent in pixels, the legend column beside it, and the plot size that
 * keeps one data unit equal to one pixel so hexagons stay regular and tiles stay square.
 */
function cartogramLayout(spanX: number, spanY: number, legend: number): { width: number; height: number; pad: number } {
  return { width: Math.round(spanX + legend + 2 * CARTOGRAM_PAD), height: Math.round(spanY + 2 * CARTOGRAM_PAD), pad: CARTOGRAM_PAD }
}

/** A US state hex cartogram: 51 equal hexagons, a postal code in each, shaded by value. */
function usHexRecipe(rows: readonly Row[], bindings: Json, options: Json, theme: ThemeTokens): PlotSpec {
  const code = bound(bindings, "code", "postal"), value = bound(bindings, "value", "value")
  const values = new Map<string, number>()
  for (const row of rows) {
    const key = String(row[code] ?? "").trim().toUpperCase()
    const number = numeric(row[value])
    if (key && number !== undefined) values.set(key, number)
  }
  const known = US_STATE_HEX_GRID.map(cell => values.get(cell.postal)).filter((v): v is number => v !== undefined)
  const min = known.length ? Math.min(...known) : 0
  const max = known.length ? Math.max(...known) : 1
  const ramp = [...theme.colors.sequential]
  const unit = hexGridExtent(US_STATE_HEX_GRID, 1)
  const target = sizeOf(options, 620, 420)
  const radius = Math.max(8, Math.min((target.width - CARTOGRAM_LEGEND - 2 * CARTOGRAM_PAD) / unit.width, (target.height - 2 * CARTOGRAM_PAD) / unit.height))
  const polygons = US_STATE_HEX_GRID.map(cell => ({ cell, points: hexPolygon(cell.col, cell.row, radius) }))
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
  for (const { points } of polygons) for (const [x, y] of points) {
    minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y)
  }
  const spanX = maxX - minX, spanY = maxY - minY
  const { width, height, pad } = cartogramLayout(spanX, spanY, CARTOGRAM_LEGEND)
  const place = (x: number, y: number) => ({ x: x - minX, y: maxY - y })
  const points: Row[] = [], dark: Row[] = [], light: Row[] = []
  for (const { cell, points: hex } of polygons) {
    const v = values.get(cell.postal)
    const shown = v ?? min
    const colour = ramp[bucketFor(shown, min, max, ramp.length)]!
    const ink = inkFor(colour, theme)
    const title = v === undefined ? `${cell.name}: no data` : `${cell.name}: ${v}`
    for (const [x, y] of hex) points.push({ ...place(x, y), code: cell.postal, value: shown, title })
    const [cx, cy] = hex.reduce((sum, [x, y]) => [sum[0] + x / hex.length, sum[1] + y / hex.length], [0, 0])
    ;(ink === "dark" ? dark : light).push({ ...place(cx, cy), text: cell.postal })
  }
  const fontSize = Math.round(Math.max(8, Math.min(15, radius * 0.8)))
  const labelFont = numberOption(options, "fontSize", fontSize)
  const labelMark = (data: Row[], fill: string) => ({ type: "text", data, x: "x", y: "y", text: "text", textAnchor: "middle", fill, fontSize: labelFont, fontWeight: 500 })
  return {
    width, height,
    marginTop: pad, marginRight: pad, marginBottom: pad, marginLeft: pad,
    x: { domain: [0, spanX + CARTOGRAM_LEGEND], axis: null },
    y: { domain: [0, spanY], axis: null },
    color: { type: "quantize", domain: [min, max > min ? max : min + 1], range: ramp, legend: false },
    marks: [
      { type: "lineY", data: points, x: "x", y: "y", z: "code", fill: "value", stroke: theme.colors.background, strokeWidth: 1, curve: "linear-closed" },
      labelMark(dark, cartogramInks(theme).dark),
      labelMark(light, cartogramInks(theme).light),
      ...legendMarks(theme, { x: spanX + 22, top: spanY - 26, width: 20, height: Math.max(60, Math.min(150, spanY * 0.45)), min, max, ...(textOption(options, "legendTitle") ? { title: textOption(options, "legendTitle")! } : {}), fontSize: Math.min(12, labelFont) }),
    ],
  }
}

/** A Europe tile cartogram: one square per country, ISO code inside, shaded by value. */
function euTileRecipe(rows: readonly Row[], bindings: Json, options: Json, theme: ThemeTokens): PlotSpec {
  const code = bound(bindings, "code", "iso3"), value = bound(bindings, "value", "value")
  const values = new Map<string, number>()
  for (const row of rows) {
    const key = String(row[code] ?? "").trim().toUpperCase()
    const number = numeric(row[value])
    if (key && number !== undefined) values.set(key, number)
  }
  const joined = EU_COUNTRY_TILE_GRID.map(cell => ({ cell, match: values.get(cell.iso3) ?? values.get(cell.iso2) }))
  const known = joined.flatMap(entry => (entry.match === undefined ? [] : [entry.match]))
  const min = known.length ? Math.min(...known) : 0
  const max = known.length ? Math.max(...known) : 1
  const ramp = [...theme.colors.sequential]
  const cellSize = Math.max(28, numberOption(options, "cell", 56))
  const cols = Math.max(...EU_COUNTRY_TILE_GRID.map(cell => cell.col)) + 1
  const rowCount = Math.max(...EU_COUNTRY_TILE_GRID.map(cell => cell.row)) + 1
  const spanX = cols * cellSize, spanY = rowCount * cellSize
  const { width, height, pad } = cartogramLayout(spanX, spanY, CARTOGRAM_LEGEND)
  const inset = 1.5
  const tiles: Row[] = [], dark: Row[] = [], light: Row[] = []
  for (const { cell, match } of joined) {
    const shown = match ?? min
    const colour = ramp[bucketFor(shown, min, max, ramp.length)]!
    const ink = inkFor(colour, theme)
    const title = match === undefined ? `${cell.name}: no data` : `${cell.name}: ${match}`
    const left = cell.col * cellSize, right = left + cellSize
    const bottom = (rowCount - 1 - cell.row) * cellSize, top = bottom + cellSize
    tiles.push({ x1: left + inset, x2: right - inset, y1: bottom + inset, y2: top - inset, value: shown, title })
    const label = { x: (left + right) / 2, y: (bottom + top) / 2, text: cell.iso2 }
    ;(ink === "dark" ? dark : light).push(label)
  }
  const labelFont = Math.round(Math.max(8, Math.min(18, cellSize * 0.32)))
  const labelMark = (data: Row[], fill: string) => ({ type: "text", data, x: "x", y: "y", text: "text", textAnchor: "middle", fill, fontSize: labelFont, fontWeight: 500 })
  return {
    width, height,
    marginTop: pad, marginRight: pad, marginBottom: pad, marginLeft: pad,
    x: { domain: [0, spanX + CARTOGRAM_LEGEND], axis: null },
    y: { domain: [0, spanY], axis: null },
    color: { type: "quantize", domain: [min, max > min ? max : min + 1], range: ramp, legend: false },
    marks: [
      { type: "rect", data: tiles, x1: "x1", x2: "x2", y1: "y1", y2: "y2", fill: "value", stroke: theme.colors.background, strokeWidth: 1 },
      labelMark(dark, cartogramInks(theme).dark),
      labelMark(light, cartogramInks(theme).light),
      ...legendMarks(theme, { x: spanX + 22, top: spanY - 26, width: 20, height: Math.max(60, Math.min(150, spanY * 0.5)), min, max, ...(textOption(options, "legendTitle") ? { title: textOption(options, "legendTitle")! } : {}), fontSize: Math.min(12, labelFont) }),
    ],
  }
}

/** Great-circle flows over a world land base, in an Equal Earth projection. */
function flowRecipe(rows: readonly Row[], bindings: Json, options: Json, theme: ThemeTokens): PlotSpec {
  const originLat = bound(bindings, "originLat", "originLat"), originLon = bound(bindings, "originLon", "originLon")
  const destLat = bound(bindings, "destLat", "destLat"), destLon = bound(bindings, "destLon", "destLon")
  const valueField = bound(bindings, "value", "value"), labelField = bound(bindings, "label", "label")
  const flows: FlowInput[] = []
  for (const row of rows) {
    const oLat = numeric(row[originLat]), oLon = numeric(row[originLon]), dLat = numeric(row[destLat]), dLon = numeric(row[destLon])
    if (oLat === undefined || oLon === undefined || dLat === undefined || dLon === undefined) continue
    const label = row[labelField]
    flows.push({ originLat: oLat, originLon: oLon, destLat: dLat, destLon: dLon, value: numeric(row[valueField]) ?? 1, ...(typeof label === "string" ? { label } : {}) })
  }
  const arcs = computeFlowArcs(flows, { steps: 32 })
  const values = arcs.map(arc => arc.value)
  const min = values.length ? Math.min(...values) : 0
  const max = values.length ? Math.max(...values) : 1
  const base = 1.1, extra = 2.4
  const weight = (v: number) => (max === min ? base + extra / 2 : base + ((v - min) / (max - min)) * extra)
  const points: Row[] = []
  arcs.forEach((arc, index) => {
    const w = weight(arc.value)
    const label = arc.label ?? `flow ${index + 1}`
    arc.segments.forEach((segment, s) => {
      segment.forEach(([lon, lat], i) => {
        const t = segment.length === 1 ? 0.5 : i / (segment.length - 1)
        points.push({ lon, lat, flow: `${index}-${s}`, label, value: arc.value, weight: w * (0.4 + 0.6 * Math.sin(Math.PI * Math.min(1, Math.max(0, t)))) })
      })
    })
  })
  const hubs = new Map<string, Row>()
  for (const arc of arcs) {
    for (const [lon, lat] of [arc.origin, arc.dest]) {
      const key = `${lon.toFixed(3)},${lat.toFixed(3)}`
      if (!hubs.has(key)) hubs.set(key, { lon, lat, value: arc.value })
    }
  }
  const hubRows = [...hubs.values()]
  const marks: PlotMarkSpec[] = [
    { type: "sphere", fill: "none", stroke: theme.colors.grid, strokeWidth: 1 },
    { type: "graticule", stroke: theme.colors.grid, strokeWidth: 0.5, strokeOpacity: 0.7 },
    { type: "geo", atlas: "world-land-110m", fill: theme.colors.grid, stroke: theme.colors.background, strokeWidth: 0.4 },
    { type: "lineY", data: points, x: "lon", y: "lat", z: "flow", stroke: theme.colors.categorical[0], strokeWidth: "weight", strokeOpacity: 0.85, curve: "linear" },
    { type: "dot", data: hubRows, x: "lon", y: "lat", r: 2.6, fill: theme.colors.categorical[0], stroke: theme.colors.background, strokeWidth: 0.8 },
  ]
  if (options.labels === true) {
    const fontSize = numberOption(options, "fontSize", theme.font.labelSize)
    const east = hubRows.filter(hub => Number(hub.lon) >= 0), west = hubRows.filter(hub => Number(hub.lon) < 0)
    const labeller = (data: Row[], anchor: string, dx: number) => ({ type: "text", data, x: "lon", y: "lat", text: "label", dx, dy: -5, textAnchor: anchor, fill: theme.colors.text, fontSize, stroke: theme.colors.background, strokeWidth: 2 })
    marks.push(labeller(east, "start", 6), labeller(west, "end", -6))
  }
  return { ...sizeOf(options, 640, 360), projection: "equal-earth", margin: 6, marks }
}

const RECIPES: Record<string, (rows: readonly Row[], bindings: Json, options: Json, theme: ThemeTokens) => PlotSpec> = {
  hexbin: (rows, bindings, options, theme) => ({
    ...sizeOf(options, 560, 340),
    ...axisTitles(options),
    color: { type: "linear", range: [...theme.colors.sequential], legend: false },
    // A hair of overlap between neighbouring hexagons closes the one-pixel seam a rasteriser leaves between them.
    marks: [{ type: "hexbin", x: bound(bindings, "x", "x"), y: bound(bindings, "y", "y"), outputs: { fill: "count" }, binWidth: numberOption(options, "binWidth", 16), inset: -0.4 }],
  }),
  contour: (rows, bindings, options, theme) => ({
    ...sizeOf(options, 560, 340),
    clip: true,
    ...axisTitles(options),
    color: { type: "linear", range: [...theme.colors.sequential], legend: false },
    marks: [{ type: "density", x: bound(bindings, "x", "x"), y: bound(bindings, "y", "y"), fill: "density", thresholds: numberOption(options, "thresholds", 10), stroke: theme.colors.background, strokeWidth: 0.5 }],
  }),
  beeswarm: (rows, bindings, options, theme) => {
    const radius = numberOption(options, "radius", 3)
    const size = sizeOf(options, 560, 340)
    const group = bound(bindings, "group", "group"), value = bound(bindings, "value", "value")
    const names = [...new Set(rows.map(row => String(row[group] ?? "")))]
    const known = rows.flatMap(row => {
      const number = numeric(row[value])
      return number === undefined ? [] : [number]
    })
    const low = known.length ? Math.min(...known) : 0
    // The band each group owns, and the plot area its dots are packed in, in pixels; the x axis is the band scale
    // written out as numbers, so a dot can sit anywhere within its own band.
    const band = Math.max(2 * radius + 8, (size.width - 56) / Math.max(1, names.length))
    const maxOffset = Math.max(radius, band / 2 - radius - 3)
    // The plot area the values are drawn in: the canvas less its margins, the axis and the two inset bands.
    const plotHeight = Math.max(60, size.height - 20 - 50 - 24)
    const swarmed: Row[] = []
    const labels: Row[] = []
    names.forEach((name, index) => {
      const members = rows.filter(row => String(row[group] ?? "") === name)
      const offsets = swarmOffsets(members.map(row => ({ value: numeric(row[value]) ?? low })), { radius, height: plotHeight, minOffset: -maxOffset, maxOffset, padding: 2 })
      members.forEach((row, position) => swarmed.push({ ...row, swarmX: index + offsets[position]! / band, swarmBase: low }))
      labels.push({ swarmX: index, swarmBase: low, name })
    })
    const xLabel = textOption(options, "xLabel"), yLabel = textOption(options, "yLabel")
    return {
      ...size,
      marginBottom: 50,
      x: { domain: [-0.5, Math.max(0.5, names.length - 0.5)], axis: null },
      y: { ...(yLabel ? { label: yLabel } : {}), insetTop: 12, insetBottom: 12 },
      marks: [
        { type: "dot", data: swarmed, x: "swarmX", y: value, r: radius, fill: theme.colors.categorical[0], fillOpacity: 0.65 },
        // The group names stand where a band axis would put them, under their own band.
        { type: "text", data: labels, x: "swarmX", y: "swarmBase", text: "name", textAnchor: "middle", dy: 18, fill: theme.colors.muted, fontSize: theme.font.labelSize },
        ...(xLabel ? [{ type: "text", data: [{ swarmX: (names.length - 1) / 2, swarmBase: low, text: xLabel }], x: "swarmX", y: "swarmBase", text: "text", textAnchor: "middle", dy: 35, fill: theme.colors.muted, fontSize: theme.font.labelSize }] : []),
      ],
    }
  },
  bollinger: (rows, bindings, options, theme) => ({
    ...sizeOf(options, 560, 340),
    ...axisTitles(options),
    marks: [{
      type: "bollingerY",
      x: bound(bindings, "x", "date"),
      y: bound(bindings, "y", "value"),
      n: Math.max(3, Math.min(numberOption(options, "window", 20), Math.max(3, Math.floor(rows.length / 2)))),
      k: numberOption(options, "k", 2),
      fill: theme.colors.categorical[0],
      fillOpacity: 0.2,
      stroke: theme.colors.categorical[0],
      strokeWidth: theme.marks.strokeWidth,
    }],
  }),
  difference_area: (rows, bindings, options, theme) => ({
    ...sizeOf(options, 560, 340),
    ...axisTitles(options),
    marks: [
      { type: "differenceY", x: bound(bindings, "x", "date"), y1: bound(bindings, "y1", "plan"), y2: bound(bindings, "y2", "actual"), positiveFill: theme.colors.positive, negativeFill: theme.colors.negative, fillOpacity: 0.75 },
      { type: "lineY", x: bound(bindings, "x", "date"), y: bound(bindings, "y1", "plan"), stroke: theme.colors.text, strokeWidth: 1.5 },
      { type: "lineY", x: bound(bindings, "x", "date"), y: bound(bindings, "y2", "actual"), stroke: theme.colors.muted, strokeWidth: 1.5 },
    ],
  }),
  waffle: (rows, bindings, options, theme) => {
    const category = bound(bindings, "category", "category"), value = bound(bindings, "value", "value")
    const grid = Math.max(4, Math.min(22, Math.round(numberOption(options, "grid", 10))))
    const totals = new Map<string, number>()
    for (const row of rows) {
      const key = row[category]
      const number = numeric(row[value])
      if (key === undefined || key === null || number === undefined) continue
      totals.set(String(key), (totals.get(String(key)) ?? 0) + Math.max(0, number))
    }
    const order = [...totals.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([key]) => key)
    const squares = grid * grid
    const total = [...totals.values()].reduce((sum, v) => sum + v, 0) || 1
    // Largest remainder, so the squares always add up to the whole grid and the shares stay as close as possible.
    const exact = order.map(name => (totals.get(name)! / total) * squares)
    const counts = exact.map(v => Math.floor(v))
    let left = squares - counts.reduce((sum, v) => sum + v, 0)
    const byRemainder = exact.map((v, i) => ({ i, remainder: v - Math.floor(v) })).sort((a, b) => b.remainder - a.remainder || a.i - b.i)
    for (const { i } of byRemainder) { if (left <= 0) break; counts[i]! += 1; left -= 1 }
    const palette = theme.colors.categorical
    const colours = order.map((_, i) => palette[i % palette.length]!)
    const cell = Math.max(12, numberOption(options, "cell", 30))
    const inset = Math.max(1, cell * 0.06)
    const span = grid * cell
    const legend = 132, pad = 8, fontSize = Math.min(13, Math.max(9, Math.round(cell * 0.42)))
    const cells: Row[] = []
    let index = 0
    order.forEach((_, i) => {
      for (let n = 0; n < counts[i]!; n++, index++) {
        // Column-major from the bottom left, the way a waffle fills: up a column, then the next one right.
        const column = Math.floor(index / grid), row = index % grid
        cells.push({ x1: column * cell + inset, x2: (column + 1) * cell - inset, y1: row * cell + inset, y2: (row + 1) * cell - inset, series: i })
      }
    })
    return {
      width: Math.round(span + legend + 2 * pad),
      height: Math.round(span + 2 * pad),
      marginTop: pad, marginRight: pad, marginBottom: pad, marginLeft: pad,
      x: { domain: [0, span + legend], axis: null },
      y: { domain: [0, span], axis: null },
      marks: [
        ...order.map((name, i) => ({ type: "rect", data: cells.filter(row => row.series === i), x1: "x1", x2: "x2", y1: "y1", y2: "y2", fill: colours[i]!, stroke: "none", title: name } as PlotMarkSpec)),
        ...categoryLegendMarks(theme, { x: span + 18, top: span - 6, entries: order.map((label, i) => ({ label, colour: colours[i]! })), fontSize, step: Math.round(fontSize * 1.7) }),
      ],
    }
  },
  arrow_change: (rows, bindings, options, theme) => {
    const x1 = bound(bindings, "x1", "start"), y1 = bound(bindings, "y1", "from"), x2 = bound(bindings, "x2", "end"), y2 = bound(bindings, "y2", "to"), label = bound(bindings, "label", "label")
    const xs = rows.map(row => numeric(row[x2])).filter((v): v is number => v !== undefined)
    const ys = rows.map(row => numeric(row[y2])).filter((v): v is number => v !== undefined)
    const minX = xs.length ? Math.min(...xs) : 0, maxX = xs.length ? Math.max(...xs) : 1
    const minY = ys.length ? Math.min(...ys) : 0, maxY = ys.length ? Math.max(...ys) : 1
    // A label goes where there is room: left of a head near the right edge, below a head near the top, and the
    // reverse on the other sides, so no label runs off the canvas.
    const place = (row: Row) => {
      const atX = (numeric(row[x2]) ?? minX) - minX, atY = (numeric(row[y2]) ?? minY) - minY
      const right = maxX === minX ? false : atX / (maxX - minX) > 0.72
      const low = maxY === minY ? true : atY / (maxY - minY) < 0.25
      return { right, low }
    }
    const groups = new Map<string, Row[]>()
    for (const row of rows) {
      const { right, low } = place(row)
      const key = `${right ? "end" : "start"}|${low ? "below" : "above"}`
      const list = groups.get(key)
      if (list) list.push(row)
      else groups.set(key, [row])
    }
    const labels: PlotMarkSpec[] = [...groups.entries()].map(([key, data]) => {
      const [anchor, side] = key.split("|")
      return { type: "text", data, x: x2, y: y2, text: label, dx: anchor === "end" ? -8 : 8, dy: side === "below" ? 15 : -7, textAnchor: anchor, fill: theme.colors.text, fontSize: theme.font.labelSize }
    })
    return {
      ...sizeOf(options, 560, 340),
      ...axisTitles(options),
      marks: [
        { type: "arrow", x1, y1, x2, y2, bend: numberOption(options, "bend", 18), stroke: theme.colors.axis, strokeWidth: 1.5 },
        { type: "dot", x: x1, y: y1, r: 2.5, fill: theme.colors.muted },
        { type: "dot", x: x2, y: y2, r: 2.5, fill: theme.colors.categorical[0] },
        ...labels,
      ],
    }
  },
  voronoi: (rows, bindings, options, theme) => ({
    ...sizeOf(options, 560, 340),
    ...axisTitles(options),
    marks: [
      { type: "voronoi", x: bound(bindings, "x", "x"), y: bound(bindings, "y", "y"), fill: theme.colors.categorical[0], fillOpacity: 0.14, stroke: theme.colors.grid, strokeOpacity: 0.85, strokeWidth: 1 },
      { type: "dot", x: bound(bindings, "x", "x"), y: bound(bindings, "y", "y"), r: 3, fill: theme.colors.categorical[1] },
    ],
  }),
  ridgeline: (rows, bindings, options, theme) => {
    const value = bound(bindings, "value", "value"), category = bound(bindings, "category", "group")
    const ridge = ridgeRows(rows, value, category, numberOption(options, "bins", 48))
    const names = [...new Set(ridge.rows.map(row => String(row.category)))]
    const top = names.length
    return {
      ...sizeOf(options, 560, 360),
      x: { label: textOption(options, "xLabel") },
      y: { domain: [0, top], axis: null },
      color: { type: "ordinal", domain: names, range: [...theme.colors.categorical], legend: false },
      marks: [
        { type: "areaY", data: ridge.rows, x: "x", y1: "base", y2: "ridge", z: "category", fill: "category", fillOpacity: 0.85, curve: "basis" },
        { type: "ruleY", data: names.map((name, index) => ({ y: (names.length - 1 - index) * 1, category: name })), y: "y", stroke: theme.colors.grid, strokeWidth: 0.75 },
        { type: "text", data: ridge.labels, x: "x", y: "ridge", text: "category", textAnchor: "start", dx: 2, fill: theme.colors.muted, fontSize: theme.font.labelSize },
      ],
    }
  },
  horizon: (rows, bindings, options, theme) => {
    const x = bound(bindings, "x", "date"), value = bound(bindings, "value", "value")
    const series = typeof bindings.series === "string" ? bindings.series : undefined
    const levels = numberOption(options, "levels", 4)
    const folded = horizonRows(rows, x, value, series, levels)
    return {
      ...sizeOf(options, 560, 220),
      x: { label: textOption(options, "xLabel") },
      y: { domain: [0, Math.max(1, Math.round(levels))], axis: null },
      color: { type: "linear", domain: [0, Math.max(1, Math.round(levels) - 1)], range: [...theme.colors.sequential], legend: false },
      marks: [
        { type: "areaY", data: folded, x: "x", y1: "y0", y2: "y1", z: "group", fill: "band", fillOpacity: 0.95, stroke: "none" },
      ],
    }
  },
  cartogram_us_hex: usHexRecipe,
  cartogram_eu_tile: euTileRecipe,
  flow_map: flowRecipe,
}

/**
 * Compiles a recipe: rows plus field bindings, options and a theme to a PlotSpec that `renderPlot` draws. An unknown
 * recipe id is refused with the closest known id, so a model can correct itself in one step.
 */
export function compilePlotRecipe(recipeId: string, rows: readonly Row[], bindings: Json = {}, options: Json = {}, theme: ThemeTokens): PlotSpec {
  const recipe = RECIPES[recipeId]
  if (!recipe) {
    const close = suggest(recipeId, Object.keys(RECIPES))[0]
    throw new ChartsError("CHART_TYPE_UNKNOWN", `There is no plot recipe "${recipeId}".`, close ? `Did you mean "${close}"?` : `Use one of: ${Object.keys(RECIPES).join(", ")}.`)
  }
  return recipe(rows, bindings, options, theme)
}
