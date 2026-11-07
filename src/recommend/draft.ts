import { catalogueEntry } from "../catalogue.js"
import type { Row } from "../data.js"
import type { Json } from "../engines/common.js"
import type { Shape } from "./traits.js"

/**
 * The draft: a complete, ready call that draws the recommended chart on the columns the advice named.
 *
 * A recommendation is advice until something renders, so each one carries the call that draws it. When the data and
 * the columns allow it, the draft is built on the caller's own columns, not on an example's; when they do not, it is
 * the catalogue's example, and the draft says so. Nothing here renders: `charts_render` does.
 */

const VL = "https://vega.github.io/schema/vega-lite/v6.json"
const vl = (spec: Json): Json => ({ $schema: VL, ...spec })

export interface Draft {
  readonly call?: Json
  readonly warnings: readonly string[]
}

/** The labels a draft uses, from the request and the columns rather than from the prose. */
function titleFor(id: string, shape: Shape | undefined, encoding: Readonly<Record<string, string>>): string | undefined {
  const m = encoding.measure ?? shape?.measures[0]
  const t = encoding.temporal
  const d = encoding.dimension ?? encoding.part
  const s = encoding.series
  const measure = m ? label(m) : undefined
  if (t && measure) return `${measure} over ${t.replaceAll("_", " ")}${s ? `, by ${s}` : ""}`
  if (measure && d && (id === "pie" || id === "donut")) return `Share of ${measure.toLowerCase()} by ${d.replaceAll("_", " ")}`
  if (measure && d) return `${measure} by ${d.replaceAll("_", " ")}`
  if (measure) return measure
  return undefined
}

const label = (field: string) => field.replaceAll("_", " ").replace(/^./, c => c.toUpperCase())
const quantitative = (field: string, extra: Json = {}): Json => ({ field, type: "quantitative", ...extra })
const nominal = (field: string, extra: Json = {}): Json => ({ field, type: "nominal", ...extra })
const temporal = (field: string, extra: Json = {}): Json => ({ field, type: "temporal", ...extra })

/** Whether the dimension repeats, so a bar must aggregate rather than draw one mark per row. */
const repeats = (shape: Shape | undefined, dimension: string | undefined) => {
  const column = shape?.columns.find(c => c.name === dimension)
  return Boolean(column && shape && shape.rows > column.distinct)
}

/**
 * Builds the draft for `id` on the caller's columns. `undefined` means this builder does not cover the type, and the
 * caller falls back to the catalogue's example.
 */
export function buildDraft(id: string, shape: Shape, rows: readonly Row[], encoding: Readonly<Record<string, string>>): Draft | undefined {
  const title = titleFor(id, shape, encoding)
  const withTitle = (spec: Json): Json => (title ? { ...spec, title } : spec)
  const measure = encoding.measure
  const temporalField = encoding.temporal
  const dimension = encoding.dimension ?? encoding.part ?? shape.categories?.name
  const series = encoding.series
  const measure2 = encoding.measure2 ?? shape.measures[1]
  const data: Json = { data: { rows } }
  const aggregate = repeats(shape, dimension) ? { aggregate: "sum" } : {}

  const build = (spec: Json): Draft => ({ call: { tool: "render", input: { spec: withTitle(spec), ...data } }, warnings: [] })

  switch (id) {
    case "line":
    case "step_line":
    case "area": {
      if (!temporalField || !measure) return undefined
      const mark = id === "step_line" ? { type: "line", interpolate: "step-after" } : id === "area" ? { type: "area", line: true } : { type: "line", point: rows.length <= 40 }
      return build(vl({ mark, encoding: { x: temporal(temporalField, { title: null }), y: quantitative(measure, { ...aggregate, title: label(measure) }), ...(series ? { color: nominal(series, { title: label(series) }) } : {}) } }))
    }
    case "multi_line": {
      if (!temporalField || !measure || !series) return undefined
      return build(vl({ mark: { type: "line", point: rows.length / Math.max(1, shape.series?.distinct ?? 1) <= 40 }, encoding: { x: temporal(temporalField, { title: null }), y: quantitative(measure, { title: label(measure) }), color: nominal(series, { title: label(series) }) } }))
    }
    case "stacked_area": {
      if (!temporalField || !measure || !series) return undefined
      return build(vl({ mark: "area", encoding: { x: temporal(temporalField, { title: null }), y: quantitative(measure, { aggregate: "sum", stack: "zero", title: measure }), color: nominal(series, { title: label(series) }) } }))
    }
    case "bar":
    case "horizontal_bar": {
      if (!measure || !dimension) return undefined
      const bar = vl({ mark: "bar", encoding: { x: nominal(dimension), y: quantitative(measure, { ...aggregate, title: label(measure) }) } })
      if (id === "horizontal_bar") return build(vl({ mark: "bar", encoding: { y: nominal(dimension, { sort: "-x" }), x: quantitative(measure, { ...aggregate, title: label(measure) }) } }))
      return build(bar)
    }
    case "lollipop": {
      if (!measure || !dimension) return undefined
      return build(vl({ layer: [{ mark: { type: "rule", strokeWidth: 2, color: "theme:axis" }, encoding: { x: { datum: 0 }, x2: { field: measure } } }, { mark: { type: "point", filled: true, size: 120 } }], encoding: { y: nominal(dimension, { sort: "-x" }), x: quantitative(measure, { ...aggregate, title: label(measure) }) } }))
    }
    case "grouped_bar":
    case "stacked_bar":
    case "normalized_bar": {
      if (!measure || !dimension || !series) return undefined
      const stack = id === "normalized_bar" ? { stack: "normalize" } : id === "stacked_bar" ? { stack: "zero" } : {}
      const encoding_: Json = id === "grouped_bar"
        ? { x: nominal(dimension), xOffset: nominal(series), y: quantitative(measure, { aggregate: "sum" }), color: nominal(series, { title: label(series) }) }
        : { x: nominal(dimension), y: quantitative(measure, { aggregate: "sum", ...stack }), color: nominal(series, { title: label(series) }) }
      return build(vl({ mark: "bar", encoding: encoding_ }))
    }
    case "scatter":
    case "regression": {
      if (!measure || !measure2) return undefined
      const layers = id === "regression"
        ? [{ mark: { type: "point", filled: true, opacity: 0.7 }, encoding: {} }, { mark: { type: "line", color: "theme:categorical.1" }, encoding: {}, transform: [{ regression: measure, on: measure2 }] }]
        : [{ mark: { type: "point", filled: true, opacity: rows.length > 500 ? 0.35 : 0.8 }, encoding: {} }]
      const spec = vl({ encoding: { x: quantitative(measure, { title: label(measure) }), y: quantitative(measure2, { title: label(measure2) }), ...(series ? { color: nominal(series, { title: label(series) }) } : {}) }, layer: layers })
      return build(spec)
    }
    case "bubble": {
      if (!measure || !measure2) return undefined
      const size = shape.measures[2]
      return build(vl({ mark: { type: "circle", opacity: 0.6 }, encoding: { x: quantitative(measure), y: quantitative(measure2), ...(size ? { size: quantitative(size, { scale: { range: [30, 900] } }) } : {}), ...(series ? { color: nominal(series, { title: label(series) }) } : {}) } }))
    }
    case "pie":
    case "donut": {
      if (!measure || !dimension) return undefined
      return build(vl({ mark: { type: "arc", ...(id === "donut" ? { innerRadius: 70 } : {}) }, encoding: { theta: quantitative(measure, { aggregate: "sum", stack: true }), color: nominal(dimension, { sort: { field: measure, order: "descending" } }), order: { field: measure, sort: "descending" } } }))
    }
    case "histogram":
    case "density": {
      if (!measure) return undefined
      const mark = id === "density" ? { type: "area", opacity: 0.5, line: true } : "bar"
      return build(vl({ mark, encoding: { x: quantitative(measure, { bin: { maxbins: 24 }, title: label(measure) }), y: { aggregate: "count", type: "quantitative", title: "Count" }, ...(id === "density" && series ? { color: nominal(series, { title: label(series) }) } : {}) } }))
    }
    case "box_plot":
    case "strip": {
      if (!measure) return undefined
      const y = quantitative(measure, { title: label(measure) })
      const mark = id === "strip" ? { type: "tick", thickness: 1.5 } : { type: "boxplot", extent: 1.5 }
      const x = dimension ? nominal(dimension) : undefined
      return build(vl({ mark, encoding: { ...(x ? { x } : {}), ...(dimension ? {} : { x: quantitative(measure) }), y: dimension ? y : { aggregate: "count", type: "quantitative", title: "Count" } } }))
    }
    case "heatmap":
    case "binned_heatmap": {
      if (!measure) return undefined
      if (id === "binned_heatmap" && measure2) return build(vl({ mark: "rect", encoding: { x: quantitative(measure, { bin: { maxbins: 20 } }), y: quantitative(measure2, { bin: { maxbins: 20 } }), color: { aggregate: "count", type: "quantitative", title: "Count" } } }))
      const second = shape.dimensions.find(d => d !== dimension && d !== series) ?? series
      if (!dimension || !second) return undefined
      return build(vl({ mark: "rect", encoding: { x: nominal(dimension, { title: null }), y: nominal(second, { title: null }), color: quantitative(measure, { ...aggregate, title: measure }) } }))
    }
    case "small_multiples": {
      if (!measure || !series) return undefined
      const x = temporalField ? temporal(temporalField, { title: null }) : nominal(series, { title: null })
      return build(vl({ facet: { field: series, type: "nominal", title: null }, columns: Math.min(4, shape.series?.distinct ?? 2), spec: { width: 200, height: 110, mark: temporalField ? "line" : "bar", encoding: { x, y: quantitative(measure, { ...(temporalField ? {} : { aggregate: "sum" }), title: label(measure) }) } } }))
    }
    case "sankey": {
      if (!shape.edges || !measure) return undefined
      const nodes = [...new Set(rows.flatMap(r => [String(r[shape.edges!.source] ?? ""), String(r[shape.edges!.target] ?? "")]))].filter(Boolean)
      const links = new Map<string, { source: string; target: string; value: number }>()
      for (const row of rows) {
        const source = String(row[shape.edges.source] ?? ""), target = String(row[shape.edges.target] ?? "")
        const value = typeof row[measure] === "number" ? (row[measure] as number) : 1
        if (!source || !target) continue
        const key = `${source}\u0000${target}`
        const found = links.get(key)
        if (found) found.value += value
        else links.set(key, { source, target, value })
      }
      return build({ series: [{ type: "sankey", nodeGap: 12, label: { position: "right" }, data: nodes.map(name => ({ name })), links: [...links.values()] }] } as Json)
    }
    case "treemap":
    case "tree": {
      if (!shape.hierarchy || !measure) return undefined
      const vega = { $schema: "https://vega.github.io/schema/vega/v6.json", data: [{ name: "table", values: rows, transform: [{ type: "stratify", key: shape.hierarchy.key, parentKey: shape.hierarchy.parent }] }, { name: "tree", source: "table", transform: [{ type: "treemap", field: measure, method: "squarify", ratio: 1.6 }] }], marks: [{ type: "rect", from: { data: "tree" }, encode: { enter: { x: { field: "x0" }, y: { field: "y0" }, x2: { field: "x1" }, y2: { field: "y1" }, fill: { scale: "color", field: "depth" } }, update: { fill: { value: "transparent" } } } }], scales: [{ name: "color", type: "ordinal", range: { scheme: "tableau10" }, domain: { data: "tree", field: "depth" } }] }
      return build(vega as Json)
    }
    default: return undefined
  }
}

/** The catalogue's own example, for a type no builder covers. */
export function exampleDraft(id: string): Draft {
  const entry = catalogueEntry(id)
  if (!entry) return { warnings: [] }
  const example = entry.example()
  return {
    call: { tool: "render", input: { spec: example.spec, ...(example.rows ? { data: { rows: example.rows } } : {}), title: example.title, ...(example.currency ? { currency: example.currency } : {}), ...(example.width ? { width: example.width } : {}), ...(example.height ? { height: example.height } : {}) } },
    warnings: ["The draft uses this type's own example rows; its example fields are named above, so swap in yours."],
  }
}
