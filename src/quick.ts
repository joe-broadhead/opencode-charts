import { ChartsError } from "./errors.js"
import type { Json } from "./engines/common.js"

/**
 * Basic charts from a type and a few field names: the deterministic path for the common cases. Each produces an
 * ordinary Vega-Lite spec, which the result returns, so the agent can refine it with charts_render.
 */
export const QUICK_TYPES = ["bar", "horizontal_bar", "grouped_bar", "stacked_bar", "line", "area", "stacked_area", "scatter", "bubble", "pie", "donut", "histogram", "box_plot", "heatmap"] as const
export type QuickType = (typeof QUICK_TYPES)[number]

export interface QuickInput {
  readonly type: QuickType
  /** Category or time field (x), or the slice field for pie/donut. */
  readonly x?: string
  /** Value field (y), or the measure for pie/donut/histogram. */
  readonly y?: string
  /** Series / group field. */
  readonly color?: string
  /** Bubble size field. */
  readonly size?: string
  /** Aggregate y per x: sum, mean, median, min, max, count. Default: none (one row per mark). */
  readonly aggregate?: "sum" | "mean" | "median" | "min" | "max" | "count"
  /** Sort categories by value (descending) instead of data order. */
  readonly sort?: boolean
  /** Treat x as dates. Default: guessed from the values. */
  readonly temporal?: boolean
  readonly xTitle?: string
  readonly yTitle?: string
  readonly bins?: number
}

const need = (value: string | undefined, name: string, type: string): string => {
  if (!value) throw new ChartsError("FIELD_MISSING", `A ${type} chart needs "${name}".`, `Name the field for ${name}.`)
  return value
}

export function quickSpec(input: QuickInput, rows: readonly Record<string, unknown>[]): Json {
  const { type } = input
  const isDate = (f: string) => input.temporal ?? rows.slice(0, 50).every(r => typeof r[f] === "string" && /^\d{4}-\d{2}(-\d{2})?/.test(r[f] as string))
  const y = (field: string): Json => ({ field, type: "quantitative", ...(input.aggregate && input.aggregate !== "count" ? { aggregate: input.aggregate } : {}), ...(input.yTitle ? { title: input.yTitle } : {}) })
  const countY: Json = { aggregate: "count", type: "quantitative", title: input.yTitle ?? "Count" }
  const xEnc = (field: string, sortBy?: string): Json => isDate(field) ? { field, type: "temporal", title: input.xTitle ?? null } : { field, type: "nominal", ...(input.sort && sortBy ? { sort: `-${sortBy}` } : {}), ...(input.xTitle ? { title: input.xTitle } : {}) }
  const color = input.color ? { color: { field: input.color, type: "nominal" } } : {}
  const yField = () => input.aggregate === "count" ? countY : y(need(input.y, "y", type))
  switch (type) {
    case "bar": return { mark: "bar", encoding: { x: xEnc(need(input.x, "x", type), "y"), y: yField(), ...color } }
    case "horizontal_bar": return { mark: "bar", encoding: { y: { field: need(input.x, "x", type), type: "nominal", ...(input.sort !== false ? { sort: "-x" } : {}), ...(input.xTitle ? { title: input.xTitle } : {}) }, x: yField(), ...color } }
    case "grouped_bar": return { mark: "bar", encoding: { x: xEnc(need(input.x, "x", type)), xOffset: { field: need(input.color, "color", type) }, y: yField(), color: { field: input.color!, type: "nominal" } } }
    case "stacked_bar": return { mark: "bar", encoding: { x: isDate(need(input.x, "x", type)) ? { field: input.x, type: "ordinal", timeUnit: "yearmonth", title: input.xTitle ?? null } : xEnc(input.x!), y: { ...yField(), aggregate: input.aggregate ?? "sum" }, ...color } }
    case "line": return { mark: { type: "line", point: rows.length <= 40 }, encoding: { x: xEnc(need(input.x, "x", type)), y: yField(), ...color } }
    case "area": return { mark: { type: "area", line: true }, encoding: { x: xEnc(need(input.x, "x", type)), y: yField(), ...color } }
    case "stacked_area": return { mark: "area", encoding: { x: xEnc(need(input.x, "x", type)), y: { ...yField(), stack: "zero" }, ...(input.color ? color : {}) } }
    case "scatter": return { mark: { type: "point", filled: true, opacity: rows.length > 500 ? 0.35 : 0.8 }, encoding: { x: { field: need(input.x, "x", type), type: "quantitative", ...(input.xTitle ? { title: input.xTitle } : {}) }, y: y(need(input.y, "y", type)), ...color } }
    case "bubble": return { mark: { type: "circle", opacity: 0.6 }, encoding: { x: { field: need(input.x, "x", type), type: "quantitative", ...(input.xTitle ? { title: input.xTitle } : {}) }, y: y(need(input.y, "y", type)), size: { field: need(input.size, "size", type), type: "quantitative", scale: { range: [30, 900] } }, ...color } }
    case "pie": case "donut": return { mark: { type: "arc", ...(type === "donut" ? { innerRadius: 70 } : {}) }, encoding: { theta: { field: need(input.y, "y", type), type: "quantitative", stack: true, ...(input.aggregate ? { aggregate: input.aggregate } : {}) }, color: { field: need(input.x, "x", type), type: "nominal", sort: { field: input.y, order: "descending" } }, order: { field: input.y, sort: "descending" } } }
    case "histogram": return { mark: "bar", encoding: { x: { field: need(input.x ?? input.y, "x", type), type: "quantitative", bin: { maxbins: input.bins ?? 24 }, ...(input.xTitle ? { title: input.xTitle } : {}) }, y: countY, ...color } }
    case "box_plot": return { mark: { type: "boxplot", extent: 1.5 }, encoding: { x: { field: need(input.x, "x", type), type: "nominal", ...(input.xTitle ? { title: input.xTitle } : {}) }, y: y(need(input.y, "y", type)) } }
    case "heatmap": return { mark: "rect", encoding: { x: { field: need(input.x, "x", type), type: "ordinal" }, y: { field: need(input.color, "color (the row field)", type), type: "ordinal" }, color: { field: need(input.y, "y (the value)", type), type: "quantitative", ...(input.aggregate ? { aggregate: input.aggregate } : {}) } } }
  }
}
