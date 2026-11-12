import * as echarts from "echarts/core"
import { echartsModules } from "./echarts-install.js"
import { formatLocale } from "d3-format"
import { ChartsError, suggest, type Issue, pointer } from "../errors.js"
import { ECHARTS_UNBUNDLED } from "../runtime-support.js"
import type { FontBook } from "../fonts.js"
import { profile as profileRows, type Profile, type Row } from "../data.js"
import type { ResolvedLocale } from "../locale.js"
import { echartsTheme } from "../themes/adapters.js"
import type { ThemeTokens } from "../themes/tokens.js"
import { compactFormat, compactSpec, deepMerge, isObject, type Json } from "./common.js"

echarts.use(echartsModules("server"))

let metrics: FontBook | undefined
function installMetrics(fonts: FontBook) {
  if (metrics === fonts) return
  echarts.setPlatformAPI({ measureText: (text: string, font?: string) => ({ width: fonts.measureCss(text ?? "", font ?? "12px Inter") }) } as never)
  metrics = fonts
}

const CARTESIAN = new Set(["line", "bar", "scatter", "effectScatter", "candlestick", "boxplot", "heatmap", "pictorialBar"])

export interface EChartsContext {
  readonly theme: ThemeTokens
  readonly locale: ResolvedLocale
  readonly rows?: Row[]
  readonly title?: string
  readonly description?: string
  readonly width?: number
  readonly height?: number
}

/** Prepares an ECharts option: rows as the dataset, theme defaults, locale number formats; checks dimensions. */
export function prepareECharts(input: Json, ctx: EChartsContext): { option: Json; width: number; height: number; profile?: Profile; issues: Issue[] } {
  const issues: Issue[] = []
  const option = structuredClone(input) as Json
  const width = typeof option.width === "number" ? option.width : ctx.width ?? ctx.theme.layout.width
  const height = typeof option.height === "number" ? option.height : ctx.height ?? ctx.theme.layout.height
  delete option.width; delete option.height; delete option.$schema
  option.animation = false
  const series = Array.isArray(option.series) ? option.series as Json[] : isObject(option.series) ? [option.series as Json] : []
  // A component neither runtime bundles would be dropped without a word, on the server and in the browser alike.
  for (const key of Object.keys(input)) if (Object.hasOwn(ECHARTS_UNBUNDLED, key) && input[key] !== undefined && input[key] !== null && input[key] !== false)
    issues.push({ level: "error", code: "ECHARTS_COMPONENT_UNSUPPORTED", message: `The ECharts option uses ${key}, which this build's ECharts runtime does not include, so it would be ignored.`, path: pointer([key]), fix: ECHARTS_UNBUNDLED[key]! })
  if (series.length === 0) issues.push({ level: "error", code: "NO_SERIES", message: "The ECharts option has no series.", path: "/series", fix: "Add series: [{\"type\": \"sankey\", …}]; charts_catalogue has an example for each type." })
  option.series = series

  if (ctx.rows) {
    if (option.dataset !== undefined) issues.push({ level: "error", code: "DATA_TWICE", message: "Rows were passed in data, and the option has its own dataset.", path: "/dataset", fix: "Remove one of them." })
    else option.dataset = { source: ctx.rows }
  }
  const datasetRows = isObject(option.dataset) && Array.isArray(option.dataset.source) && isObject((option.dataset.source as unknown[])[0]) ? option.dataset.source as Row[] : undefined
  const dims = datasetRows ? Object.keys(datasetRows[0] ?? {}) : undefined
  series.forEach((s, i) => {
    if (!isObject(s)) return
    if (typeof s.type !== "string") issues.push({ level: "error", code: "SERIES_TYPE_MISSING", message: `Series ${i} has no type.`, path: pointer(["series", i, "type"]), fix: "Set type, such as \"sankey\", \"gauge\" or \"funnel\"." })
    if (dims && isObject(s.encode)) for (const [k, v] of Object.entries(s.encode)) for (const dim of Array.isArray(v) ? v : [v]) if (typeof dim === "string" && !dims.includes(dim)) {
      const close = suggest(dim, dims)
      issues.push({ level: "error", code: "UNKNOWN_FIELD", message: `encode.${k} names "${dim}", which is not in the data.${close.length ? ` Did you mean "${close[0]}"?` : ""} The fields are: ${dims.join(", ")}.`, path: pointer(["series", i, "encode", k]), fix: close.length ? `Use "${close[0]}".` : "Use one of the listed fields." })
    }
    if (typeof s.type === "string" && CARTESIAN.has(s.type) && s.coordinateSystem === undefined && option.xAxis === undefined && option.yAxis === undefined && option.calendar === undefined && option.polar === undefined)
      issues.push({ level: "error", code: "AXES_MISSING", message: `A ${s.type} series needs xAxis and yAxis.`, path: "/xAxis", fix: "Add \"xAxis\": {\"type\": \"category\"} and \"yAxis\": {\"type\": \"value\"} (or use Vega-Lite for standard charts)." })
    if (s.type === "pie" && Array.isArray(s.data) && s.data.length > 7) issues.push({ level: "warning", code: "PIE_TOO_MANY_SLICES", message: `A pie with ${s.data.length} slices: angles this close cannot be compared.`, path: pointer(["series", i, "data"]), fix: "Use a bar chart sorted by value, or group small slices as Other." })
    if (s.type === "sankey" && Array.isArray(s.links)) {
      const graph = new Map<string, string[]>()
      for (const l of s.links as Json[]) if (isObject(l)) graph.set(String(l.source), [...(graph.get(String(l.source)) ?? []), String(l.target)])
      const seen = new Set<string>(), stack = new Set<string>()
      const cyclic = (n: string): boolean => { if (stack.has(n)) return true; if (seen.has(n)) return false; seen.add(n); stack.add(n); for (const m of graph.get(n) ?? []) if (cyclic(m)) return true; stack.delete(n); return false }
      if ([...graph.keys()].some(cyclic)) issues.push({ level: "error", code: "SANKEY_CYCLE", message: "The Sankey links form a cycle; a Sankey must flow one way.", path: pointer(["series", i, "links"]), fix: "Rename the node on the way back (\"Signup (return)\"), or use a chord diagram for two-way flows." })
    }
    // Nodes take the palette in data order, so the same node keeps its colour across charts and themes.
    if ((s.type === "sankey" || s.type === "graph" || s.type === "chord") && Array.isArray(s.data) && s.color === undefined) {
      const palette = ctx.theme.colors.categorical
      s.data = (s.data as unknown[]).map((n, j) => isObject(n) && !(isObject(n.itemStyle) && (n.itemStyle as Json).color) ? { ...n, itemStyle: { ...(isObject(n.itemStyle) ? n.itemStyle : {}), color: palette[j % palette.length] } } : n)
    }
    if (s.type === "sankey" && s.emphasis === undefined) s.emphasis = { focus: "adjacency" }
  })

  // Titles, accessibility, a grid that leaves room for the title and legend.
  const hasTitle = option.title !== undefined || !!ctx.title
  if (ctx.title && option.title === undefined) option.title = { text: ctx.title, ...(ctx.description ? {} : {}) }
  option.aria = deepMerge({ enabled: true, ...(ctx.description ? { label: { description: ctx.description } } : {}) }, option.aria) as Json
  if (option.legend !== undefined && isObject(option.legend) && option.legend.top === undefined && option.legend.bottom === undefined) option.legend = { bottom: 8, ...option.legend }
  // Box-laid-out series start below a title; round ones centre a little lower.
  for (const s of series) if (isObject(s) && hasTitle) {
    if (["sankey", "funnel", "tree", "treemap", "themeRiver", "graph"].includes(String(s.type)) && s.top === undefined) s.top = 64
    if (["pie", "gauge", "sunburst", "chord"].includes(String(s.type)) && s.center === undefined) s.center = ["50%", "56%"]
    if (s.type === "sankey" && s.bottom === undefined) s.bottom = 16
  }
  if (hasTitle && isObject(option.radar) && option.radar.center === undefined) option.radar.center = ["50%", "56%"]
  if (hasTitle && option.calendar !== undefined) for (const cal of Array.isArray(option.calendar) ? option.calendar as Json[] : [option.calendar as Json]) if (cal.top === undefined) cal.top = 80
  const needsGrid = series.some(s => isObject(s) && CARTESIAN.has(String(s.type)))
  if (needsGrid && option.grid === undefined) option.grid = { left: ctx.theme.layout.padding + 8, right: ctx.theme.layout.padding + 8, top: hasTitle ? 64 : 24, bottom: option.legend !== undefined ? 56 : 32 }

  // Number formats on value axes: locale grouping, compact above 10,000.
  const fmt = formatLocale(ctx.locale.number as never)
  const plain = fmt.format(",~r"), compact = compactSpec(ctx.locale.currency ? ctx.locale.number.currency : undefined, ctx.locale.number.decimal)
  const formatter = (v: number) => Math.abs(v) >= 10_000 ? compactFormat(v, compact) : plain(v)
  for (const key of ["xAxis", "yAxis", "radiusAxis", "singleAxis"]) {
    const axes = Array.isArray(option[key]) ? option[key] as Json[] : isObject(option[key]) ? [option[key] as Json] : []
    for (const axis of axes) if (axis.type === "value" || axis.type === "log") axis.axisLabel = { formatter, ...(isObject(axis.axisLabel) ? axis.axisLabel : {}) }
  }
  return { option, width, height, ...(datasetRows ? { profile: profileRows(datasetRows) } : {}), issues }
}

/** Renders an ECharts option to SVG on the server (no DOM), with the bundled font metrics. */
export function renderECharts(option: Json, theme: ThemeTokens, fonts: FontBook, width: number, height: number): string {
  installMetrics(fonts)
  const name = `charts-${theme.name}`
  echarts.registerTheme(name, echartsTheme(theme))
  const chart = echarts.init(null as never, name, { renderer: "svg", ssr: true, width, height })
  try {
    chart.setOption(option as never)
    return chart.renderToSVGString()
  } catch (error) {
    throw new ChartsError("RENDER_FAILED", `ECharts could not render the option: ${(error as Error).message}`, "Check series types, data shapes and axes; charts_catalogue has a working example for each type.")
  } finally {
    chart.dispose()
  }
}

/** The ECharts option as interactive HTML needs it: functions dropped (the page re-creates the axis formats). */
export function serialisableOption(option: Json): Json {
  return JSON.parse(JSON.stringify(option, (_k, v) => (typeof v === "function" ? undefined : v))) as Json
}
