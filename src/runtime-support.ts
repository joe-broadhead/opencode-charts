/**
 * What each chart runtime has, in one place: the ECharts modules registered on the server and in the browser, and the
 * option keys that name an ECharts component neither bundles.
 *
 * Data only, with no ECharts import, so the safety checks (which the Vega worker also bundles) can read it. The
 * classes are attached in `engines/echarts-install.ts`, whose table must name exactly these modules (the type
 * checker holds it), and both the server renderer and the browser runtime register from that one table.
 */

export interface EChartsModule {
  readonly name: string
  readonly kind: "chart" | "component" | "renderer"
  /** Series types a chart module draws. */
  readonly series?: readonly string[]
  /** Top-level option keys a component module reads. */
  readonly options?: readonly string[]
  /** Registered for the static SVG (server-side rendering, no DOM). */
  readonly server: boolean
  /** Registered in the browser runtime inlined into interactive HTML. */
  readonly browser: boolean
}

export const ECHARTS_MODULES = [
  { name: "BarChart", kind: "chart", series: ["bar"], server: true, browser: true },
  { name: "BoxplotChart", kind: "chart", series: ["boxplot"], server: true, browser: true },
  { name: "CandlestickChart", kind: "chart", series: ["candlestick"], server: true, browser: true },
  { name: "ChordChart", kind: "chart", series: ["chord"], server: true, browser: true },
  { name: "EffectScatterChart", kind: "chart", series: ["effectScatter"], server: true, browser: true },
  { name: "FunnelChart", kind: "chart", series: ["funnel"], server: true, browser: true },
  { name: "GaugeChart", kind: "chart", series: ["gauge"], server: true, browser: true },
  { name: "GraphChart", kind: "chart", series: ["graph"], server: true, browser: true },
  { name: "HeatmapChart", kind: "chart", series: ["heatmap"], server: true, browser: true },
  { name: "LineChart", kind: "chart", series: ["line"], server: true, browser: true },
  { name: "ParallelChart", kind: "chart", series: ["parallel"], server: true, browser: true },
  { name: "PictorialBarChart", kind: "chart", series: ["pictorialBar"], server: true, browser: true },
  { name: "PieChart", kind: "chart", series: ["pie"], server: true, browser: true },
  { name: "RadarChart", kind: "chart", series: ["radar"], server: true, browser: true },
  { name: "SankeyChart", kind: "chart", series: ["sankey"], server: true, browser: true },
  { name: "ScatterChart", kind: "chart", series: ["scatter"], server: true, browser: true },
  { name: "SunburstChart", kind: "chart", series: ["sunburst"], server: true, browser: true },
  { name: "ThemeRiverChart", kind: "chart", series: ["themeRiver"], server: true, browser: true },
  { name: "TreeChart", kind: "chart", series: ["tree"], server: true, browser: true },
  { name: "TreemapChart", kind: "chart", series: ["treemap"], server: true, browser: true },
  { name: "AriaComponent", kind: "component", options: ["aria"], server: true, browser: true },
  { name: "CalendarComponent", kind: "component", options: ["calendar"], server: true, browser: true },
  { name: "DatasetComponent", kind: "component", options: ["dataset"], server: true, browser: true },
  { name: "GraphicComponent", kind: "component", options: ["graphic"], server: true, browser: true },
  { name: "GridComponent", kind: "component", options: ["grid", "xAxis", "yAxis"], server: true, browser: true },
  { name: "LegendComponent", kind: "component", options: ["legend"], server: true, browser: true },
  { name: "MarkAreaComponent", kind: "component", server: true, browser: true },
  { name: "MarkLineComponent", kind: "component", server: true, browser: true },
  { name: "MarkPointComponent", kind: "component", server: true, browser: true },
  { name: "ParallelComponent", kind: "component", options: ["parallel", "parallelAxis"], server: true, browser: true },
  { name: "PolarComponent", kind: "component", options: ["polar", "angleAxis", "radiusAxis"], server: true, browser: true },
  { name: "RadarComponent", kind: "component", options: ["radar"], server: true, browser: true },
  { name: "SingleAxisComponent", kind: "component", options: ["singleAxis"], server: true, browser: true },
  { name: "TitleComponent", kind: "component", options: ["title"], server: true, browser: true },
  // Hover only exists in a browser; the static SVG has no tooltip to draw.
  { name: "TooltipComponent", kind: "component", options: ["tooltip"], server: false, browser: true },
  { name: "TransformComponent", kind: "component", server: true, browser: true },
  { name: "VisualMapComponent", kind: "component", options: ["visualMap"], server: true, browser: true },
  { name: "SVGRenderer", kind: "renderer", server: true, browser: true },
] as const satisfies readonly EChartsModule[]

export type EChartsModuleName = (typeof ECHARTS_MODULES)[number]["name"]

/** The series types both runtimes draw. */
export const ECHARTS_SERIES_TYPES: ReadonlySet<string> = new Set(ECHARTS_MODULES.flatMap(m => ("series" in m ? [...m.series] : [])))

/**
 * Top-level ECharts option keys that name a component neither runtime bundles, with what to do instead. An option
 * that uses one is refused (`ECHARTS_COMPONENT_UNSUPPORTED`) rather than drawn without it. `geo` and `bmap` are
 * refused earlier by the safety checks, as map components.
 */
export const ECHARTS_UNBUNDLED: Readonly<Record<string, string>> = {
  dataZoom: "Remove dataZoom: zooming and panning are not in this build's ECharts runtime. Draw the full range, or filter the rows to the period to show.",
  brush: "Remove brush: brushing is not in this build's ECharts runtime. For a brushable chart use Vega-Lite with params: [{\"name\": \"brush\", \"select\": \"interval\"}] (charts_catalogue id interactive_brush).",
  toolbox: "Remove toolbox: its zoom, brush, restore and save tools are not in this build's ECharts runtime; ask for png or svg output to save the chart.",
  timeline: "Remove timeline: animated timelines are not in this build's ECharts runtime. Draw one chart per period, or use small multiples.",
  matrix: "Remove matrix: the matrix coordinate system is not in this build's ECharts runtime. Use a heatmap on xAxis and yAxis instead.",
  thumbnail: "Remove thumbnail: the overview thumbnail is not in this build's ECharts runtime.",
}
