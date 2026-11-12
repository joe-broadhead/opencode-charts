import { ChartsError, pointer, type Issue } from "./errors.js"
import { ECHARTS_SERIES_TYPES } from "./runtime-support.js"
import { findTooltipMarkup, TOOLTIP_TAGS, type TooltipMarkup } from "./engines/echarts-markup.js"

/**
 * Spec safety. A spec is untrusted model output, rendered inside the OpenCode process, so it may not reach the
 * network or the disk, and it may not make Vega's synchronous dataflow run long enough to freeze the host.
 *
 * Three layers, each refusing with a reason and a fix:
 * 1. `checkSpec` before anything is compiled: size caps, no external resources, expression limits.
 * 2. `checkCardinality` on the compiled Vega spec, before `vega.parse`: generative transforms are bounded statically.
 *    (Carried over from open-cowork's desktop `chart-spec-safety.ts`, audit issue #865.) Behind it, Vega runs in a
 *    worker thread with a time limit and a heap cap (engines/vega-pool.ts), which open-cowork lacked.
 * 3. `checkRenderedSvg` on the output: no image, foreignObject, script or external reference survived.
 * The Vega view also gets a loader that refuses every load, so a missed key still cannot fetch anything.
 */

export const LIMITS = {
  specBytes: 512 * 1024,
  arrayItems: 20_000,
  objectNodes: 20_000,
  depth: 40,
  expressionChars: 1_000,
  expressions: 400,
  dataRows: 100_000,
  dataBytes: 32 * 1024 * 1024,
  dimension: 4_000,
  pngPixels: 40_000_000,
  generatedRows: 20_000,
  estimatedRows: 250_000,
  gridCells: 4_000_000,
} as const

/**
 * Keys that name an object's prototype. JSON data never needs them, and in JavaScript `__proto__` changes an object's
 * prototype instead of adding a property, so a copy would silently drop it. They are refused wherever JSON comes in.
 */
export const PROTOTYPE_KEYS: ReadonlySet<string> = new Set(["__proto__", "constructor", "prototype"])

// Keys that name an external resource in Vega, Vega-Lite or ECharts. `url` also covers ECharts' title links.
const RESOURCE_KEYS = new Set(["url", "href", "src", "link", "sublink", "loader", "backgroundImage"])
const EXPRESSION_KEYS = new Set(["expr", "signal", "calculate", "update", "test", "filter", "as_expr"])
const EXTERNAL_STRING = /^\s*(?:https?:|ftp:|file:|data:(?!image\/svg\+xml)|javascript:|image:\/\/|\/\/)/i

export type Engine = "vega-lite" | "vega" | "echarts"

function refuse(detail: string, path: (string | number)[], hint: string): never {
  throw new ChartsError("SPEC_UNSAFE", detail, hint, pointer(path))
}

/** Layer 1: the spec as given, before compilation. */
export function checkSpec(spec: unknown, engine: Engine) {
  if (!spec || typeof spec !== "object" || Array.isArray(spec)) throw new ChartsError("SPEC_INVALID", "The spec must be a JSON object.", "Pass a Vega-Lite, Vega or ECharts spec object.")
  let serialized: string
  try { serialized = JSON.stringify(spec) } catch { throw new ChartsError("SPEC_INVALID", "The spec is not JSON-serialisable.", "Pass plain JSON: objects, arrays, strings, numbers, booleans and null.") }
  const bytes = Buffer.byteLength(serialized)
  if (bytes > LIMITS.specBytes) throw new ChartsError("SPEC_TOO_LARGE", `The spec is ${bytes} bytes, over ${LIMITS.specBytes}.`, "Pass large data through data.rows or data.path instead of inside the spec.")
  let arrays = 0, objects = 0, expressions = 0
  const visit = (value: unknown, path: (string | number)[], depth: number): void => {
    if (depth > LIMITS.depth) refuse(`The spec is nested deeper than ${LIMITS.depth} levels.`, path, "Flatten the spec.")
    if (typeof value === "string") {
      if (EXTERNAL_STRING.test(value) && path[path.length - 1] !== "$schema" && !isDataValue(path)) refuse(`"${value.slice(0, 60)}" is an external reference.`, path, "Charts cannot load anything: inline the values, or read a workspace file with data.path.")
      return
    }
    if (Array.isArray(value)) {
      arrays += value.length
      if (arrays > LIMITS.arrayItems) refuse(`The spec has more than ${LIMITS.arrayItems} array items.`, path, "Pass large data through data.rows or data.path.")
      value.forEach((item, i) => visit(item, [...path, i], depth + 1))
      return
    }
    if (!value || typeof value !== "object") return
    if (++objects > LIMITS.objectNodes) refuse(`The spec has more than ${LIMITS.objectNodes} objects.`, path, "Simplify the spec or move data to data.rows.")
    const record = value as Record<string, unknown>
    const mark = record.mark ?? (engine === "vega" ? record.type : undefined)
    const markType = typeof mark === "string" ? mark : mark && typeof mark === "object" ? (mark as Record<string, unknown>).type : undefined
    if (typeof markType === "string" && markType.toLowerCase() === "image" && (engine !== "echarts")) refuse("Image marks are not allowed.", [...path, "mark"], "Use symbols, text or shapes instead of images.")
    if (engine === "echarts" && path[path.length - 2] === "series" && typeof record.type === "string" && !ECHARTS_SERIES_TYPES.has(record.type)) {
      const hint = record.type === "map" ? "For maps use Vega-Lite geoshape with data {\"atlas\": \"world-110m\"}." : record.type === "custom" ? "Custom series need JavaScript functions, which a JSON spec cannot carry; use Vega instead." : `Use one of: ${[...ECHARTS_SERIES_TYPES].join(", ")}.`
      refuse(`The ECharts series type "${record.type}" is not available.`, [...path, "type"], hint)
    }
    if (engine === "echarts" && record.type === "image") refuse("Image graphics are not allowed.", [...path, "type"], "Use shapes or text instead of images.")
    if (engine === "echarts" && (path[path.length - 1] === "geo" || path[path.length - 1] === "bmap")) refuse("ECharts geo components are not available.", path, "For maps use Vega-Lite geoshape with data {\"atlas\": \"world-110m\"}.")
    for (const [key, child] of Object.entries(record)) {
      const childPath = [...path, key]
      if (PROTOTYPE_KEYS.has(key)) refuse(`"${key}" is not allowed as a key: it names an object's prototype.`, childPath, "Rename that key; a spec never needs __proto__, constructor or prototype.")
      if (RESOURCE_KEYS.has(key) && child !== null && child !== undefined && child !== false && !(key === "url" && isAtlasData(record))) refuse(`"${key}" loads or links an external resource.`, childPath, key === "url" ? "Inline the rows with data.rows, read a workspace file with data.path, or use {\"atlas\": \"world-110m\"} for a map." : "Remove it; charts are static and self-contained.")
      if (EXPRESSION_KEYS.has(key) && typeof child === "string") {
        if (++expressions > LIMITS.expressions) refuse(`The spec has more than ${LIMITS.expressions} expressions.`, childPath, "Simplify the spec.")
        if (child.length > LIMITS.expressionChars) refuse(`An expression is ${child.length} characters, over ${LIMITS.expressionChars}.`, childPath, "Split it into several calculate steps.")
      }
      visit(child, childPath, depth + 1)
    }
  }
  visit(spec, [], 0)
}

const isAtlasData = (record: Record<string, unknown>) => typeof record.atlas === "string"
/** Strings inside inline data rows are data, not references: a column of website addresses is fine. */
const isDataValue = (path: (string | number)[]) => path.includes("values") || (path.includes("dataset") && path.includes("source")) || path.includes("data") && path.some(p => typeof p === "number")

/** A loader that refuses everything, for every Vega view. */
export function deniedLoader() {
  const deny = (uri?: unknown) => Promise.reject(new ChartsError("SPEC_UNSAFE", `Loading "${String(uri ?? "")}" is not allowed.`, "Inline the data, or read a workspace file with data.path."))
  return { options: {}, fileAccess: false, sanitize: deny, load: deny, file: deny, http: deny }
}

// ---------------------------------------------------------------------------------------------------------------
// ECharts tooltip text that the browser runtime would insert as HTML: the check is engines/echarts-markup.ts, which the
// page runs again before ECharts starts.

export { tooltipMarkupProblem } from "./engines/echarts-markup.js"
const FIXES: Record<TooltipMarkup["kind"], string> = {
  formatter: `Use plain text with the {a}, {b}, {c} and {d} placeholders; only ${TOOLTIP_TAGS.map(t => `<${t}>`).join(", ")} without attributes are allowed (such as "{b}<br/>{c}").`,
  css: "Use plain declarations such as \"padding: 8px; box-shadow: none\", with no url(), expression(), at-rule import or backslash.",
  className: "Use a class name of letters, digits, dashes and underscores.",
}

/** The tooltip text in an ECharts option that ECharts would insert as HTML and that is not inert, as spec errors. */
export function echartsMarkupIssues(option: unknown): Issue[] {
  return findTooltipMarkup(option).map(found => ({ level: "error", code: "ECHARTS_MARKUP_REFUSED", message: `The ECharts tooltip text at ${found.path} has ${found.what}, which ECharts would insert into the page as HTML.`, path: found.path, fix: FIXES[found.kind] }))
}

/** Layer 3: the rendered SVG. */
export function checkRenderedSvg(svg: string) {
  if (/<(?:image|foreignObject|script|iframe|object|embed)\b/i.test(svg)) throw new ChartsError("SPEC_UNSAFE", "The rendered chart contains an image, script or embedded object.", "Remove image marks, href channels and embedded content from the spec.")
  // Attributes are read from the tags themselves, quoted values included, so text that merely reads like markup (a
  // label "<img onerror=…>", escaped in the SVG as &lt;img …) is data, not an attribute. Anything left over that still
  // looks like a tag means the markup could not be read, and is refused rather than passed.
  const rest = svg.replace(SVG_TAG, (_tag, attributes: string) => {
    for (const attribute of attributes.matchAll(SVG_ATTRIBUTE)) {
      const name = attribute[1]!.toLowerCase(), value = (attribute[2] ?? "").replace(/^["']|["']$/g, "").trim()
      if (/^on[a-z]+$/.test(name)) throw new ChartsError("SPEC_UNSAFE", "The rendered chart contains an event handler attribute.", "Remove it from the spec.")
      if ((name === "href" || name === "xlink:href") && !value.startsWith("#")) throw new ChartsError("SPEC_UNSAFE", "The rendered chart links to an external resource.", "Remove the href channel from the spec.")
    }
    return ""
  })
  if (rest.replace(/<\/[A-Za-z][^\s>]*\s*>|<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<\?xml[^>]*\?>/g, "").includes("<")) throw new ChartsError("SPEC_UNSAFE", "The rendered chart contains markup that could not be checked.", "Simplify the labels and titles, then render again.")
}
const SVG_TAG = /<[A-Za-z][^\s/<>]*((?:\s+[^\s=/<>"']+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'<>]+))?)*)\s*\/?>/g
const SVG_ATTRIBUTE = /([^\s=/<>"']+)(?:\s*=\s*("[^"]*"|'[^']*'|[^\s"'<>]+))?/g

// ---------------------------------------------------------------------------------------------------------------
// Layer 2: static cardinality bounds on a compiled Vega spec (from open-cowork apps/desktop/src/main/chart-spec-safety.ts).

const ROW_SAFE = new Set([
  "aggregate", "bin", "collect", "countpattern", "dotbin", "extent", "filter", "formula", "identifier", "joinaggregate", "lookup", "pivot", "project",
  "sample", "stack", "timeunit", "window", "loess", "regression", "crossfilter", "resolvefilter",
  "nest", "stratify", "treemap", "partition", "tree", "treelinks", "pack", "force", "label", "linkpath", "pie", "voronoi", "wordcloud",
  "geojson", "geopath", "geopoint", "geoshape", "graticule_safe",
])

function blocked(detail: string): never {
  throw new ChartsError("SPEC_TOO_EXPENSIVE", detail, "Reduce generated or folded data, or use fewer, coarser steps.")
}
const finite = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : null)
const hasGroupby = (t: Record<string, unknown>) => Array.isArray(t.groupby) ? t.groupby.length > 0 : t.groupby !== undefined && t.groupby !== null && t.groupby !== ""

// Vega-Lite's own facet layout emits sequences whose stop is a count of another dataset's rows; that is bounded.
const DATA_LENGTH_SIGNAL = /^(?:[\s\d+\-*/().,]|ceil\(|floor\(|min\(|max\(|length\(data\((?:"[\w-]+"|'[\w-]+')\)\))*$/
function sequenceRows(t: Record<string, unknown>, inlineRows: number) {
  const signal = t.stop && typeof t.stop === "object" ? (t.stop as Record<string, unknown>).signal : undefined
  if (typeof signal === "string" && DATA_LENGTH_SIGNAL.test(signal) && signal.includes("length(data(")) return Math.min(inlineRows, LIMITS.generatedRows)
  const start = t.start === undefined ? 0 : finite(t.start), stop = finite(t.stop), step = t.step === undefined ? 1 : finite(t.step)
  if (start === null || stop === null || step === null || step === 0) blocked("A sequence transform needs finite numeric start, stop and step.")
  const rows = Math.max(0, Math.ceil((stop - start) / step))
  if (rows > LIMITS.generatedRows) blocked(`A sequence transform would make ${rows} rows (at most ${LIMITS.generatedRows}).`)
  return rows
}
function generatorRows(type: string, t: Record<string, unknown>) {
  if (type === "density" || type === "kde") {
    let steps = 200
    for (const key of ["steps", "minsteps", "maxsteps"]) {
      if (t[key] === undefined) continue
      const v = finite(t[key])
      if (v === null || v > LIMITS.generatedRows) blocked(`The ${type} transform's ${key} must be a number of at most ${LIMITS.generatedRows}.`)
      steps = Math.max(steps, v)
    }
    return steps
  }
  if (t.step !== undefined) {
    const step = finite(t.step)
    if (step === null || step <= 0 || 1 / step > LIMITS.generatedRows) blocked(`The quantile step implies more than ${LIMITS.generatedRows} rows.`)
    return Math.ceil(1 / step)
  }
  return Array.isArray(t.probs) ? t.probs.length : 100
}
function grid(type: string, t: Record<string, unknown>) {
  if (t.size === undefined) return
  if (!Array.isArray(t.size) || t.size.length < 2) blocked(`The ${type} transform needs a static [width, height] size.`)
  const w = finite(t.size[0]), h = finite(t.size[1])
  if (w === null || h === null || w < 0 || h < 0) blocked(`The ${type} transform's size must be finite, non-negative numbers.`)
  if (w * h > LIMITS.gridCells) blocked(`The ${type} transform would compute ${w * h} grid cells (at most ${LIMITS.gridCells}).`)
}

interface Estimate { rows: number; duplication: number }
function pipeline(dataset: Record<string, unknown>, known: Map<string, Estimate>, inlineRows: number): Estimate {
  let rows = 0, duplication = 1
  if (Array.isArray(dataset.values)) rows = dataset.values.length
  else if (dataset.values && typeof dataset.values === "object") rows = inlineRows
  else if (typeof dataset.source === "string") { const s = known.get(dataset.source); rows = s?.rows ?? inlineRows; duplication = s?.duplication ?? 1 }
  else if (Array.isArray(dataset.source)) for (const name of dataset.source) { const s = typeof name === "string" ? known.get(name) : undefined; rows += s?.rows ?? inlineRows; duplication = Math.max(duplication, s?.duplication ?? 1) }
  for (const entry of Array.isArray(dataset.transform) ? dataset.transform : []) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue
    const t = entry as Record<string, unknown>
    const type = typeof t.type === "string" ? t.type.toLowerCase() : ""
    switch (type) {
      case "sequence": rows = Math.max(rows, sequenceRows(t, inlineRows) * (hasGroupby(t) ? Math.max(1, rows) : 1)); break
      case "cross": blocked("Cross transforms are not allowed: their output is the product of both inputs.")
      case "graticule": {
        const step = Array.isArray(t.step) ? t.step : t.step === undefined ? [10, 10] : [t.step, t.step]
        const sx = finite(step[0]), sy = finite(step[1])
        if (sx === null || sy === null || sx < 1 || sy < 1) blocked("A graticule's step must be at least 1 degree.")
        rows = Math.max(rows, Math.ceil(360 / sx) + Math.ceil(180 / sy))
        break
      }
      case "fold": {
        if (!Array.isArray(t.fields)) blocked("A fold transform needs a static fields array.")
        rows *= Math.max(1, t.fields.length); duplication *= Math.max(1, t.fields.length)
        break
      }
      case "flatten": rows = Math.max(rows, duplication * LIMITS.arrayItems); break
      case "density": case "kde": case "quantile": rows = Math.max(rows, generatorRows(type, t) * (hasGroupby(t) ? Math.max(1, rows) : 1)); break
      case "kde2d": case "contour": case "isocontour": case "heatmap": grid(type, t); break
      // impute fills a key × group grid. Its true size depends on distinct values, which a static pass cannot see;
      // the render worker's time and memory limits stop a runaway one, so it is not multiplied here.
      case "impute": break
      case "": break
      default: if (!ROW_SAFE.has(type)) blocked(`The transform type "${type}" is not recognised, so its cost cannot be bounded.`)
    }
    if (rows > LIMITS.estimatedRows) blocked(`Derived data would reach about ${rows} rows (at most ${LIMITS.estimatedRows}).`)
  }
  return { rows, duplication }
}

/** Layer 2: call on the compiled Vega spec, after Vega-Lite compilation and before `vega.parse`. */
export function checkCardinality(spec: Record<string, unknown>, inlineRows: number = LIMITS.arrayItems) {
  const known = new Map<string, Estimate>()
  const visit = (node: unknown) => {
    if (Array.isArray(node)) { for (const item of node) visit(item); return }
    if (!node || typeof node !== "object") return
    const record = node as Record<string, unknown>
    if (Array.isArray(record.data)) for (const entry of record.data) {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue
      const d = entry as Record<string, unknown>
      const estimate = pipeline(d, known, inlineRows)
      if (typeof d.name === "string") known.set(d.name, estimate)
    }
    for (const [key, child] of Object.entries(record)) if (key !== "values") visit(child)
  }
  visit(spec)
}
