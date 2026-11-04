import { catalogueEntry } from "../src/catalogue.ts"

/**
 * Natural-language chart requests, each with a scripted tool call (what a good agent would send) and the
 * properties the result must have. `bun eval/run.ts` checks the scripted calls; `--answers file.jsonl` checks a
 * model's calls instead (one {"id","tool","input"} per line), so the same expectations grade a real model.
 */
export interface Expect {
  /** Vega-Lite marks, Vega mark types or ECharts series types that must appear in the resolved spec. */
  readonly marks?: readonly string[]
  readonly engine?: "vega-lite" | "vega" | "echarts"
  readonly theme?: string
  /** Strings that must appear in the SVG (formatting such as €, %, k). */
  readonly svgContains?: readonly string[]
  /** Paths into the resolved spec that must exist, e.g. "encoding.xOffset", "projection.type=albersUsa". */
  readonly specHas?: readonly string[]
  readonly formats?: readonly ("svg" | "png" | "html" | "spec")[]
  /** Warning codes that are acceptable for this request (all others fail the case). */
  readonly allowWarnings?: readonly string[]
}
export interface Case { readonly id: string; readonly request: string; readonly tool: "render" | "quick"; readonly input: Record<string, unknown>; readonly expect: Expect }

const fromCatalogue = (id: string, extra: Record<string, unknown> = {}) => {
  const ex = catalogueEntry(id)!.example()
  return { spec: ex.spec, ...(ex.rows ? { data: { rows: ex.rows } } : {}), title: ex.title, ...(ex.currency ? { currency: ex.currency } : {}), ...(ex.width ? { width: ex.width } : {}), ...(ex.height ? { height: ex.height } : {}), ...extra }
}

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
  { id: "toqan-product", request: "Revenue by product in the Toqan brand.", tool: "render", input: fromCatalogue("bar", { theme: "toqan" }), expect: { marks: ["bar"], theme: "toqan", svgContains: ["Geist", "#EDD1AA", "#252BDD"] } },
  { id: "toqan-night-flows", request: "The sign-up flow for a dark Toqan slide.", tool: "render", input: fromCatalogue("sankey", { theme: "toqan-night" }), expect: { engine: "echarts", theme: "toqan-night", svgContains: ["#121110"] } },
  { id: "high-contrast-line", request: "Conversion by channel, accessible for low vision.", tool: "render", input: fromCatalogue("multi_line", { theme: "high-contrast" }), expect: { marks: ["line"], theme: "high-contrast", svgContains: ["%"] } },
  { id: "print-stacked", request: "Monthly orders by channel, to print.", tool: "render", input: fromCatalogue("stacked_bar", { theme: "print" }), expect: { marks: ["bar"], theme: "print" } },
  { id: "plan-chord", request: "How customers move between plans.", tool: "render", input: fromCatalogue("chord"), expect: { engine: "echarts", marks: ["chord"] } },
  { id: "product-radar", request: "Compare the two models' profiles.", tool: "render", input: fromCatalogue("radar"), expect: { engine: "echarts", marks: ["radar"] } },
  { id: "quick-csv-german", request: "Bar chart of revenue_eur by region from data/sales.csv, German formatting, euros.", tool: "quick", input: { type: "bar", data: { path: "data/sales.csv" }, x: "region", y: "revenue_eur", sort: true, yTitle: "Umsatz (€)", currency: "EUR", locale: "de-DE", title: "Umsatz nach Region" }, expect: { marks: ["bar"], svgContains: [" €"], specHas: ["encoding.x.sort=-y"] } },
  { id: "brush-html", request: "An interactive scatter I can drag to select, as a web page.", tool: "render", input: fromCatalogue("interactive_brush", { formats: ["svg", "png", "html"] }), expect: { marks: ["point"], formats: ["html"], specHas: ["params.0.select=interval"] } },
]
