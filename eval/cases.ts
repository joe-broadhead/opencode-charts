import { catalogueEntry, exampleCall } from "../src/catalogue.ts"

/**
 * Natural-language chart requests, each with a scripted tool call (what a good agent would send) and the
 * properties the result must have. `bun eval/run.ts` checks the scripted calls; `--answers file.jsonl` checks a
 * model's calls instead (one {"id","tool","input"} per line), so the same expectations grade a real model.
 */
export interface Expect {
  /** Vega-Lite marks, Vega/Plot mark types or ECharts series types that must appear in the resolved spec. */
  readonly marks?: readonly string[]
  readonly engine?: "vega-lite" | "vega" | "echarts" | "plot" | "table" | "diagram" | "board"
  readonly theme?: string
  /** Strings that must appear in the SVG (formatting such as €, %, k). */
  readonly svgContains?: readonly string[]
  /** Paths into the resolved spec that must exist, e.g. "encoding.xOffset", "projection.type=albersUsa". */
  readonly specHas?: readonly string[]
  readonly formats?: readonly ("svg" | "png" | "gif" | "html" | "spec" | "document" | "board")[]
  /** Strings that must appear in a diagram's Unicode outline. */
  readonly asciiContains?: readonly string[]
  /** A dashboard's published panel count. */
  readonly panels?: number
  /** A generation folder was published (or reused) with the files in it, rather than flat files beside them. */
  readonly generation?: boolean
  /** charts_update's own report: a revision that moved, and the authored fields it says changed. */
  readonly update?: { readonly changed?: readonly string[] }
  /** Warning codes that are acceptable for this request (all others fail the case). */
  readonly allowWarnings?: readonly string[]
}
export interface Case { readonly id: string; readonly request: string; readonly tool: "render" | "quick" | "table" | "diagram" | "board" | "update"; readonly input: Record<string, unknown>; readonly expect: Expect }

const fromCatalogue = (id: string, extra: Record<string, unknown> = {}) => ({ ...exampleCall(catalogueEntry(id)!), ...extra })

export const CASES: readonly Case[] = [
  { id: "stacked-area-dark-eur", request: "Revenue by region as a stacked area, dark theme, euros.", tool: "render", input: fromCatalogue("stacked_area", { theme: "dark", currency: "EUR" }), expect: { marks: ["area"], theme: "dark", svgContains: ["€"], specHas: ["encoding.y.stack=zero"] } },
  { id: "ranked-countries", request: "Which countries have the most active users? Rank them.", tool: "render", input: fromCatalogue("horizontal_bar"), expect: { marks: ["bar"], specHas: ["encoding.y.sort=-x"], allowWarnings: ["MISSING_UNITS"] } },
  { id: "dau-line", request: "Plot daily active users over 2024.", tool: "render", input: fromCatalogue("line"), expect: { marks: ["line"], specHas: ["encoding.x.type=temporal", "encoding.x.scale.type=utc"], svgContains: ["k<"] } },
  { id: "traffic-donut", request: "Show the budget split as a donut with the total in the middle.", tool: "render", input: fromCatalogue("donut"), expect: { marks: ["arc", "text"], svgContains: ["€4.2M"] } },
  { id: "latency-histogram", request: "What does checkout latency look like?", tool: "render", input: fromCatalogue("histogram"), expect: { marks: ["bar"], specHas: ["encoding.x.bin.maxbins=24"] } },
  { id: "latency-boxplot", request: "Compare latency across services with a box plot.", tool: "render", input: fromCatalogue("box_plot"), expect: { marks: ["boxplot"] } },
  { id: "spend-trend", request: "Is spend correlated with conversions? Add a trend line.", tool: "render", input: fromCatalogue("regression"), expect: { marks: ["point", "line"], specHas: ["layer.1.transform.0.regression=conversions"] } },
  { id: "orders-heatmap", request: "Orders by weekday and hour as a heatmap.", tool: "render", input: fromCatalogue("heatmap"), expect: { marks: ["rect"], specHas: ["encoding.color.type=quantitative"] } },
  { id: "world-internet", request: "Map internet penetration by country.", tool: "render", input: fromCatalogue("choropleth_world"), expect: { marks: ["geoshape"], specHas: ["projection.type=equalEarth"], svgContains: ["%"] } },
  { id: "us-unemployment", request: "Unemployment rate by US state on a map.", tool: "render", input: fromCatalogue("choropleth_us"), expect: { marks: ["geoshape"], specHas: ["projection.type=albersUsa"] } },
  { id: "signup-sankey", request: "Where do sign-ups come from and where do they end up?", tool: "render", input: fromCatalogue("sankey"), expect: { engine: "echarts", marks: ["sankey"], svgContains: ["Trial"] } },
  { id: "checkout-funnel", request: "Show our checkout funnel.", tool: "render", input: fromCatalogue("funnel"), expect: { engine: "echarts", marks: ["funnel"] } },
  { id: "uptime-gauge", request: "A gauge of uptime this month.", tool: "render", input: fromCatalogue("gauge"), expect: { engine: "echarts", marks: ["gauge"], svgContains: ["99.94%"] } },
  { id: "commit-calendar", request: "Commits per day in 2024 as a calendar.", tool: "render", input: fromCatalogue("calendar_heatmap"), expect: { engine: "echarts", marks: ["heatmap"], specHas: ["calendar.range=2024"] } },
  { id: "acme-candles", request: "ACME's share price in March as candlesticks.", tool: "render", input: fromCatalogue("candlestick"), expect: { engine: "echarts", marks: ["candlestick"] } },
  { id: "headcount-treemap", request: "Headcount by team as a treemap.", tool: "render", input: fromCatalogue("treemap"), expect: { engine: "vega", marks: ["rect", "text"] } },
  { id: "org-tree", request: "Draw the org chart.", tool: "render", input: fromCatalogue("tree"), expect: { engine: "vega", marks: ["path", "symbol", "text"] } },
  { id: "collab-network", request: "Who works with whom? A network graph.", tool: "render", input: fromCatalogue("network"), expect: { engine: "vega", marks: ["symbol", "path"] } },
  { id: "feedback-cloud", request: "A word cloud of what customers mention.", tool: "render", input: fromCatalogue("word_cloud"), expect: { engine: "vega", marks: ["text"], svgContains: ["delivery"] } },
  { id: "profit-waterfall", request: "Walk from revenue to profit in euros.", tool: "render", input: fromCatalogue("waterfall"), expect: { marks: ["bar", "text"], specHas: ["layer.0.encoding.y2.field=end"] } },
  { id: "signup-multiples", request: "Sign-ups by region, one small chart each.", tool: "render", input: fromCatalogue("small_multiples"), expect: { marks: ["area"], specHas: ["facet.field=region"] } },
  { id: "quarterly-presentation", request: "Quarterly revenue by region, grouped bars, for a slide.", tool: "render", input: fromCatalogue("grouped_bar", { theme: "presentation" }), expect: { marks: ["bar"], theme: "presentation", specHas: ["encoding.xOffset.field=quarter"] } },
  { id: "high-contrast-line", request: "Conversion by channel, accessible for low vision.", tool: "render", input: fromCatalogue("multi_line", { theme: "high-contrast" }), expect: { marks: ["line"], theme: "high-contrast", svgContains: ["%"] } },
  { id: "print-stacked", request: "Monthly orders by channel, to print.", tool: "render", input: fromCatalogue("stacked_bar", { theme: "print" }), expect: { marks: ["bar"], theme: "print" } },
  { id: "plan-chord", request: "How customers move between plans.", tool: "render", input: fromCatalogue("chord"), expect: { engine: "echarts", marks: ["chord"] } },
  { id: "product-radar", request: "Compare the two models' profiles.", tool: "render", input: fromCatalogue("radar"), expect: { engine: "echarts", marks: ["radar"] } },
  { id: "quick-csv-german", request: "Bar chart of revenue_eur by region from data/sales.csv, German formatting, euros.", tool: "quick", input: { type: "bar", data: { path: "data/sales.csv" }, x: "region", y: "revenue_eur", sort: true, yTitle: "Umsatz (€)", currency: "EUR", locale: "de-DE", title: "Umsatz nach Region" }, expect: { marks: ["bar"], svgContains: [" €"], specHas: ["encoding.x.sort=-y"] } },
  { id: "brush-html", request: "An interactive scatter I can drag to select, as a web page.", tool: "render", input: fromCatalogue("interactive_brush", { formats: ["svg", "png", "html"] }), expect: { marks: ["point"], formats: ["html"], specHas: ["params.0.select=interval"] } },
  { id: "plot-hexbin-geist", request: "Hexbin density plot of spend vs conversions in Geist theme.", tool: "render", input: fromCatalogue("hexbin", { theme: "geist" }), expect: { engine: "plot", marks: ["hexbin"], theme: "geist" } },
  { id: "cartogram-us-ft", request: "US state hex cartogram in the Financial Times editorial theme.", tool: "render", input: fromCatalogue("cartogram_us_hex", { theme: "editorial-ft" }), expect: { engine: "plot", theme: "editorial-ft", svgContains: ["CA", "NY"] } },
  { id: "flow-map-geist-dark", request: "World geodesic flow map in Geist Dark.", tool: "render", input: fromCatalogue("flow_map", { theme: "geist-dark" }), expect: { engine: "plot", theme: "geist-dark", marks: ["geo", "lineY", "dot"] } },
  { id: "echarts-matrix-sparklines", request: "Sparkline matrix of regional metrics.", tool: "render", input: fromCatalogue("sparkline_matrix"), expect: { engine: "echarts", marks: ["line"] } },
  { id: "publication-data-table", request: "Publication table with inline bars, sparklines and deltas.", tool: "render", input: fromCatalogue("data_table", { formats: ["svg", "png", "html", "spec"] }), expect: { engine: "table", formats: ["html", "png"] } },
  { id: "mermaid-flowchart", request: "Offline flowchart diagram of invoice approval.", tool: "render", input: fromCatalogue("flowchart"), expect: { engine: "diagram", svgContains: ["Invoice"] } },
  { id: "ishikawa-fishbone", request: "Fishbone root-cause diagram of late deliveries.", tool: "render", input: fromCatalogue("fishbone"), expect: { engine: "diagram", svgContains: ["Late deliveries"] } },
  { id: "editorial-animated-gif", request: "Editorial line chart with kicker, source footer, CSS draw motion and animated GIF.", tool: "render", input: fromCatalogue("line", { theme: "editorial-economist", kicker: "Growth", subtitle: "Monthly active user trajectory", source: "Source: Internal telemetry", motion: "draw", formats: ["svg", "png", "gif", "spec"] }), expect: { theme: "editorial-economist", formats: ["gif", "png"], svgContains: ["GROWTH", "Source: Internal telemetry"] } },

  // The v2 surfaces: the table, diagram and board tools, a saved document, its update, and a host seed theme.
  { id: "table-inline-nanoplots", request: "A regional scorecard table with inline bars, a delta pill, a status badge and a total row.", tool: "table", input: { data: { rows: [{ region: "North", revenue: 120, growth: 0.12, status: "Ahead" }, { region: "South", revenue: 95, growth: -0.04, status: "Behind" }, { region: "East", revenue: 140, growth: 0.08, status: "Ahead" }] }, columns: [{ field: "region", label: "Region" }, { field: "revenue", label: "Revenue (€k)", format: "currency", cell: "bar" }, { field: "growth", label: "Growth", format: "percent", cell: "delta" }, { field: "status", label: "Status", cell: "badge", badgeColors: { Ahead: "#228833", Behind: "#CC3344" } }], summaryRow: { label: "Total", operations: { revenue: "sum" } }, formats: ["svg", "png", "html"] }, expect: { engine: "table", svgContains: ["Total", "Ahead"], formats: ["svg", "png", "html"] } },
  { id: "diagram-fishbone-ascii", request: "A fishbone of late deliveries with its causes, and a terminal outline to paste into a ticket.", tool: "diagram", input: { kind: "fishbone", effect: "Late deliveries", categories: [{ category: "People", causes: ["Thin crew", "Training"] }, { category: "Systems", causes: ["Old scanner", "No alerts"] }], formats: ["svg", "png"] }, expect: { engine: "diagram", svgContains: ["Late deliveries", "Old scanner"], asciiContains: ["Cause-and-effect: Late deliveries", "Old scanner"], formats: ["svg", "png"] } },
  { id: "board-kpi-select-filter", request: "A revenue dashboard with one KPI, a region filter and two panels.", tool: "board", input: { board: { version: 1, title: "Revenue command centre", kicker: "FY 2026", datasets: { sales: { rows: [{ month: "2026-01-01", region: "North", revenue: 120 }, { month: "2026-02-01", region: "South", revenue: 95 }, { month: "2026-03-01", region: "East", revenue: 140 }, { month: "2026-04-01", region: "North", revenue: 160 }] } }, filters: [{ id: "region", label: "Region", field: "region", control: "select" }], kpis: [{ id: "revenue", label: "Total revenue", dataset: "sales", field: "revenue", aggregate: "sum", format: "currency", delta: { value: 12.4, label: "vs last year" } }], panels: [{ id: "trend", title: "Revenue by month", dataset: "sales", chart: { quick: { type: "line", x: "month", y: "revenue", aggregate: "sum" } } }, { id: "region", title: "Revenue by region", dataset: "sales", chart: { quick: { type: "bar", x: "region", y: "revenue", aggregate: "sum" } } }] } }, expect: { engine: "board", panels: 2, svgContains: ["Total revenue", "Revenue by region"], formats: ["png", "html", "board"] } },
  { id: "quick-grouped-bar-document", request: "Quarterly revenue by region as grouped bars, saved as a document I can restyle later.", tool: "quick", input: { document: { version: 1, title: "Revenue by region and quarter", chart: { kind: "recipe", recipe: "grouped_bar", data: { rows: [{ region: "North", quarter: "Q1", revenue: 120 }, { region: "North", quarter: "Q2", revenue: 140 }, { region: "South", quarter: "Q1", revenue: 95 }, { region: "South", quarter: "Q2", revenue: 110 }] }, bindings: { category: "region", series: "quarter", value: "revenue" } } }, formats: ["svg", "document"] }, expect: { marks: ["bar"], specHas: ["encoding.xOffset.field=quarter"], formats: ["svg", "document"], generation: true } },
  { id: "update-theme-geist-dark", request: "Restyle the saved quarterly chart in Geist Dark, keeping its data.", tool: "update", input: { document: { version: 1, title: "Revenue by region and quarter", chart: { kind: "recipe", recipe: "grouped_bar", data: { rows: [{ region: "North", quarter: "Q1", revenue: 120 }, { region: "North", quarter: "Q2", revenue: 140 }, { region: "South", quarter: "Q1", revenue: 95 }, { region: "South", quarter: "Q2", revenue: 110 }] }, bindings: { category: "region", series: "quarter", value: "revenue" } } }, patch: { appearance: { theme: "geist-dark" } }, formats: ["svg", "document"] }, expect: { theme: "geist-dark", update: { changed: ["appearance.theme"] }, formats: ["svg", "document"], generation: true } },
  { id: "seed-host-palette-adaptive", request: "Draw revenue in the host's warm palette, following the reader's light or dark setting.", tool: "render", input: { title: "Host palette", spec: { mark: "bar", encoding: { x: { field: "k", type: "nominal" }, y: { field: "v", type: "quantitative", title: "Revenue (€k)" } } }, data: { rows: [{ k: "a", v: 1 }, { k: "b", v: 2 }] }, theme: { seed: { background: "#FAF8F5", foreground: "#1A1A18", accent: "#C2410C" }, variants: { light: { seed: { background: "#FAF8F5", foreground: "#1A1A18", accent: "#C2410C" } }, dark: { seed: { background: "#141413", foreground: "#F5F3EE", accent: "#FB923C" } } } }, formats: ["svg", "html"] }, expect: { engine: "vega-lite", svgContains: ["--cs-", "@media (prefers-color-scheme: dark)", "#141413"], formats: ["svg", "html"] } },
]
