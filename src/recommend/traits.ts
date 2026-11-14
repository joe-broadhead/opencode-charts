/**
 * What each chart type is good for, and what the data must supply.
 *
 * The catalogue (`src/catalogue.ts`) holds the examples; this holds the advice. Kept apart so the examples stay
 * readable and the advice can be reviewed on its own. Every id here must exist in the catalogue: a test enforces it.
 *
 * Adapted from the design of MCP Clearsight (`cesar-alves/mcp-clearsight@4912ede`), MIT OR Apache-2.0,
 * © 2026 The MCP Clearsight contributors: a catalogue entry naming its tasks, the data it `requires`, what
 * disqualifies it (`anti`), and its density by medium (`features.md` §4.9).
 */

/** The closed vocabulary of things a chart can be for. */
export const TASKS = [
  "change_over_time",
  "compare_magnitude",
  "rank",
  "part_to_whole",
  "distribution",
  "relationship",
  "correlation",
  "flow",
  "hierarchy",
  "location",
] as const
export type Task = (typeof TASKS)[number]

/** What a chart needs from the data. One role is met by one profiled column. */
export const ROLES = ["measure", "measure2", "dimension", "temporal", "series", "part", "size", "key", "parent", "source", "target", "location", "open", "close"] as const
export type Role = (typeof ROLES)[number]

export type Medium = "analysis" | "report" | "presentation" | "paper"

export interface Trait {
  readonly id: string
  /** At most two: the first is what it is for, the second what it also does. */
  readonly tasks: readonly [Task, Task?]
  /** Roles the data must supply. Empty means the chart needs nothing in particular. */
  readonly need: readonly Role[]
  /** Roles that make it a better fit when present. */
  readonly want?: readonly Role[]
  /** Words in a request that name this chart or what it does. Lowercase. */
  readonly aliases?: readonly string[]
  /** A curated perceptual score, 0 to 1: how well this type reads its task when drawn well. */
  readonly reads?: number
  /** The data has a series this chart would silently drop: `true` costs it data fit when one is present. */
  readonly dropsSeries?: boolean
  /** Why not, given the shape. Returned as the reason it is disqualified. */
  readonly anti?: (shape: Shape) => string | undefined
  /** How many series and categories it carries comfortably in `report`; the medium scales these. */
  readonly budget?: { readonly series?: number; readonly categories?: number }
}

/** The profiled shape of the data: what a trait's `need` and `anti` are judged against. */
export interface Shape {
  readonly rows: number
  readonly columns: readonly { readonly name: string; readonly type: string; readonly distinct: number; readonly missing: number; readonly top?: readonly string[] }[]
  readonly measures: readonly string[]
  readonly temporals: readonly string[]
  readonly dimensions: readonly string[]
  /** The dimension that best reads as a series: 2–12 values, fewer than the rows. */
  readonly series?: { readonly name: string; readonly distinct: number }
  /** The dimension that best reads as the parts of a whole: 2–8 values. */
  readonly part?: { readonly name: string; readonly distinct: number }
  /** The dimension with the most values, when it has more than 12: a category axis. */
  readonly categories?: { readonly name: string; readonly distinct: number }
  readonly twoMeasures: boolean
  readonly edges?: { readonly source: string; readonly target: string }
  readonly hierarchy?: { readonly key: string; readonly parent: string }
  readonly location?: { readonly name: string; readonly kind: "country" | "us-state" }
  readonly timeSeries: boolean
}

/** A funnel is only a funnel when its categories name ordered stages; otherwise it is a bar chart with tapered width. */
const STAGE = /stage|step|funnel|visit|view|signup|sign-up|trial|lead|checkout|paid|order|cart|opportunit|qualif|demo|contact|subscri/i
const funnelStages = (shape: Shape): string | undefined => {
  const categories = shape.categories
  if (!categories) return "needs ordered stages, and the data has no category column"
  const values = shape.columns.find(column => column.name === categories.name)?.top ?? []
  return values.some(value => STAGE.test(value)) ? undefined : `needs ordered stages (visit, trial, paid…); "${categories.name}" names none`
}

const TRAITS: readonly Trait[] = [
  // ---- comparison
  { id: "bar", tasks: ["compare_magnitude", "rank"], need: ["measure", "dimension"], want: ["part"], reads: 0.92, dropsSeries: true, aliases: ["bar", "column", "compare", "comparison", "vs", "versus"] },
  { id: "horizontal_bar", tasks: ["rank", "compare_magnitude"], need: ["measure", "dimension"], reads: 0.94, dropsSeries: true, aliases: ["rank", "ranking", "top", "most", "least", "leaderboard", "sorted", "league table", "ranked"], budget: { categories: 60 } },
  { id: "grouped_bar", anti: s => (s.series && s.categories && s.series.name === s.categories.name && s.temporals.length === 0 ? "needs a second category to split by; the data has one" : undefined), tasks: ["compare_magnitude"], need: ["measure", "dimension", "series"], reads: 0.86, aliases: ["side by side", "grouped", "by subgroup", "compare groups"], budget: { series: 4, categories: 10 } },
  { id: "stacked_bar", anti: s => (s.series && s.categories && s.series.name === s.categories.name && s.temporals.length === 0 ? "needs a second category to split by; the data has one" : undefined), tasks: ["part_to_whole", "change_over_time"], need: ["measure", "dimension", "series"], reads: 0.8, aliases: ["stacked", "stack", "composition", "mix", "breakdown"], budget: { series: 5, categories: 12 } },
  { id: "normalized_bar", anti: s => (s.series && s.categories && s.series.name === s.categories.name && s.temporals.length === 0 ? "needs a second category to split by; the data has one" : undefined), tasks: ["part_to_whole"], need: ["measure", "dimension", "series"], reads: 0.78, aliases: ["share", "percent", "proportion", "100%", "normalized"], budget: { series: 5, categories: 12 } },
  { id: "diverging_bar", tasks: ["compare_magnitude"], need: ["measure"], want: ["dimension"], reads: 0.84, aliases: ["gain", "loss", "change", "delta", "increase", "decrease", "positive negative", "deviation", "variance", "diverging", "surplus", "deficit"] },
  { id: "lollipop", tasks: ["rank", "compare_magnitude"], need: ["measure", "dimension"], reads: 0.8, aliases: ["lollipop", "dot and stem"], budget: { categories: 30 } },
  { id: "dumbbell", tasks: ["compare_magnitude"], need: ["measure", "dimension", "series"], reads: 0.82, aliases: ["before and after", "dumbbell", "two values", "difference between"], budget: { series: 2, categories: 12 }, anti: s => (s.series && s.series.distinct === 2 ? undefined : "a dumbbell needs exactly two states per category") },
  { id: "dot_plot", tasks: ["compare_magnitude", "distribution"], need: ["measure", "dimension"], reads: 0.85, aliases: ["dot plot", "cleveland"], budget: { categories: 40 } },
  { id: "bullet", tasks: ["compare_magnitude"], need: ["measure"], want: ["dimension"], reads: 0.8, aliases: ["target", "kpi", "goal", "actual vs", "quota"] },
  { id: "waterfall", tasks: ["compare_magnitude", "change_over_time"], need: ["measure", "dimension"], reads: 0.82, aliases: ["waterfall", "bridge", "contributions", "what changed", "build up"] },

  // ---- trend
  { id: "line", tasks: ["change_over_time"], need: ["temporal", "measure"], reads: 0.95, dropsSeries: true, aliases: ["trend", "over time", "by month", "by day", "by year", "timeline", "history", "growth"] },
  { id: "multi_line", tasks: ["change_over_time"], need: ["temporal", "measure", "series"], reads: 0.9, aliases: ["each series", "per channel", "compare trends", "several lines"], budget: { series: 8 } },
  { id: "area", tasks: ["change_over_time"], need: ["temporal", "measure"], reads: 0.82, dropsSeries: true, aliases: ["area", "volume over time"] },
  { id: "stacked_area", tasks: ["change_over_time", "part_to_whole"], need: ["temporal", "measure", "series"], reads: 0.86, aliases: ["stacked area", "composition over time"], budget: { series: 6 } },
  { id: "streamgraph", tasks: ["change_over_time", "part_to_whole"], need: ["temporal", "measure", "series"], reads: 0.7, aliases: ["streamgraph", "stream"], budget: { series: 8 } },
  { id: "step_line", tasks: ["change_over_time"], need: ["temporal", "measure"], reads: 0.88, dropsSeries: true, aliases: ["step", "state changes", "levels", "when it changed"] },
  { id: "line_band", tasks: ["change_over_time"], need: ["temporal", "measure"], reads: 0.84, anti: s => (s.columns.some(c => /(^|_)(lo|hi|low|high|std|stderr|err|ci|lower|upper|band|min|max)($|_)/i.test(c.name)) ? undefined : "needs a low/high or interval column to draw the band"), aliases: ["confidence", "range", "band", "uncertainty", "interval"] },
  { id: "slope", tasks: ["compare_magnitude"], need: ["measure", "dimension", "series"], reads: 0.8, aliases: ["slope", "two points", "before and after"], budget: { series: 2 } },
  { id: "bump", tasks: ["rank", "change_over_time"], need: ["temporal", "measure", "series"], reads: 0.76, anti: s => ((s.columns.find(c => c.name === s.temporals[0])?.distinct ?? 0) < 4 ? "needs at least four time points to show positions changing" : undefined), aliases: ["rank over time", "bump", "positions", "league table"], budget: { series: 8 } },
  { id: "dual_axis", tasks: ["change_over_time", "relationship"], need: ["temporal", "measure", "measure2"], reads: 0.55, aliases: ["two axes", "different units", "orders and revenue"], anti: () => "readers compare heights across two axes, which are not comparable" },
  { id: "small_multiples", anti: s => (s.series && s.categories && s.series.name === s.categories.name && s.temporals.length === 0 ? "needs a group column other than the category" : undefined), tasks: ["change_over_time", "compare_magnitude"], need: ["measure", "series"], want: ["temporal"], reads: 0.9, aliases: ["facet", "small multiples", "each", "per region", "panel"], budget: { series: 8 } },
  { id: "calendar_heatmap", tasks: ["change_over_time"], need: ["temporal", "measure"], reads: 0.74, aliases: ["calendar", "daily", "by weekday", "streak"] },

  // ---- distribution
  { id: "histogram", tasks: ["distribution"], need: ["measure"], reads: 0.93, dropsSeries: true, aliases: ["distribution", "histogram", "spread", "how many are", "latency", "shape of", "frequency"] },
  { id: "density", tasks: ["distribution"], need: ["measure"], want: ["series"], reads: 0.86, aliases: ["density", "smooth distribution", "curve"], budget: { series: 4 } },
  { id: "box_plot", tasks: ["distribution", "compare_magnitude"], need: ["measure"], want: ["dimension"], reads: 0.9, aliases: ["box", "quartile", "median", "outliers", "compare spread", "compare latency"] },
  { id: "strip", tasks: ["distribution"], need: ["measure"], want: ["dimension"], reads: 0.7, aliases: ["strip", "jitter", "individual points"], anti: s => (s.rows > 800 ? `${s.rows} points overplot; a box plot or a histogram reads better` : undefined) },
  { id: "heatmap", tasks: ["distribution", "compare_magnitude"], need: ["measure", "dimension", "series"], reads: 0.86, aliases: ["heatmap", "by hour", "weekday and hour", "matrix"], budget: { series: 24, categories: 24 } },
  { id: "binned_heatmap", tasks: ["distribution", "relationship"], need: ["measure", "measure2"], reads: 0.84, aliases: ["2d histogram", "density of points", "hexbin", "too many points"], anti: s => (s.rows > 3000 ? undefined : "a scatter plot is more exact for this many points") },

  // ---- part to whole
  { id: "pie", tasks: ["part_to_whole"], need: ["measure"], want: ["part"], reads: 0.6, aliases: ["pie", "share of", "split", "proportion"], anti: s => (((s.part ?? s.categories)?.distinct ?? 0) > 6 ? `${(s.part ?? s.categories)!.distinct} slices: use a bar chart or a treemap` : (s.measures.length ?? 0) === 0 ? "a pie needs one measure" : undefined), budget: { categories: 6 } },
  { id: "donut", tasks: ["part_to_whole"], need: ["measure"], want: ["part"], reads: 0.62, aliases: ["donut", "doughnut", "share of", "split"], anti: s => (((s.part ?? s.categories)?.distinct ?? 0) > 6 ? `${(s.part ?? s.categories)!.distinct} slices: use a bar chart or a treemap` : undefined), budget: { categories: 6 } },
  { id: "radial", tasks: ["part_to_whole", "compare_magnitude"], need: ["measure"], want: ["part"], reads: 0.45, aliases: ["rose", "radial", "nightingale"], anti: () => "angle and radius together are read badly; a bar chart is exact", budget: { categories: 8 } },
  { id: "funnel", tasks: ["flow", "part_to_whole"], need: ["measure"], want: ["dimension"], reads: 0.72, aliases: ["funnel", "conversion", "drop off", "steps", "signup to paid"], anti: s => funnelStages(s) },
  { id: "gauge", tasks: ["compare_magnitude"], need: ["measure"], reads: 0.5, aliases: ["gauge", "progress", "against target", "score"], anti: () => "a gauge hides the number it stands for; a bullet or a headline value reads better" },

  // ---- relationship
  { id: "scatter", tasks: ["relationship"], need: ["measure", "measure2"], reads: 0.94, aliases: ["scatter", "correlation", "against", "vs", "relationship between", "does x affect"], anti: s => (s.rows > 20000 ? `${s.rows} points overplot; a 2-D histogram or a sample reads better` : undefined) },
  { id: "bubble", tasks: ["relationship"], need: ["measure", "measure2", "size"], reads: 0.8, aliases: ["bubble", "third dimension", "size by"], budget: { series: 12 } },
  { id: "regression", tasks: ["relationship", "correlation"], need: ["measure", "measure2"], reads: 0.9, aliases: ["trend line", "regression", "fit", "correlated"] },
  { id: "correlation_matrix", tasks: ["correlation"], need: ["measure", "measure2"], reads: 0.84, aliases: ["correlation matrix", "which fields move together", "correlations"] },
  { id: "connected_scatter", tasks: ["relationship", "change_over_time"], need: ["measure", "measure2", "temporal"], reads: 0.78, aliases: ["connected scatter", "path over time", "trajectory"] },
  { id: "parallel", tasks: ["relationship", "compare_magnitude"], need: ["measure", "measure2"], reads: 0.5, aliases: ["parallel", "many dimensions", "profiles"], anti: () => "more than a few series, and the lines cannot be followed" },
  { id: "radar", tasks: ["compare_magnitude"], need: ["measure"], want: ["series"], reads: 0.42, aliases: ["radar", "spider", "skill profile", "scores across"], anti: () => "area grows with the square of the value, and the order of the axes is arbitrary" },
  { id: "interactive_brush", tasks: ["relationship"], need: ["measure", "measure2"], reads: 0.9, aliases: ["select", "brush", "filter by selection", "interactive"] },

  // ---- flow, hierarchy
  { id: "sankey", tasks: ["flow"], need: ["source", "target", "measure"], reads: 0.9, aliases: ["sankey", "flow", "where do they go", "movement between", "from and to", "flussdiagramm"] },
  { id: "chord", tasks: ["flow"], need: ["source", "target", "measure"], reads: 0.72, aliases: ["chord", "mutual", "between groups both ways"] },
  { id: "network", tasks: ["relationship", "flow"], need: ["source", "target"], reads: 0.7, aliases: ["network", "graph", "connections", "who links to"] },
  { id: "tree", tasks: ["hierarchy"], need: ["key", "parent"], reads: 0.86, aliases: ["tree", "dendrogram", "org chart", "reports to", "structure"] },
  { id: "treemap", tasks: ["hierarchy", "part_to_whole"], need: ["measure"], want: ["key", "parent"], reads: 0.8, aliases: ["treemap", "nested share", "hierarchy of values"] },
  { id: "sunburst", tasks: ["hierarchy", "part_to_whole"], need: ["measure"], want: ["key", "parent"], reads: 0.76, aliases: ["sunburst", "nested rings"] },

  // ---- maps, text, finance
  { id: "choropleth_world", tasks: ["location", "compare_magnitude"], need: ["measure", "location"], reads: 0.86, anti: s => (s.location && s.location.kind === "us-state" ? "the data names US states, so the US map draws it" : undefined), aliases: ["world", "map", "by country", "countries", "geography"] },
  { id: "choropleth_us", tasks: ["location", "compare_magnitude"], need: ["measure", "location"], reads: 0.86, anti: s => (s.location && s.location.kind === "country" && /country|countries|nation|iso/i.test(s.location.name) ? "the data names countries, so the world map draws it" : undefined), aliases: ["us states", "united states", "state map", "america"] },
  { id: "point_map", tasks: ["location", "relationship"], need: ["measure", "location"], reads: 0.8, aliases: ["locations", "on a map", "cities", "points on"] },
  { id: "word_cloud", tasks: ["distribution"], need: ["dimension"], reads: 0.4, aliases: ["word cloud", "most mentioned", "keywords", "text frequency"], anti: s => (s.measures.length > 0 ? "a word cloud needs text, not a measure; a bar chart ranks words exactly" : undefined) },
  { id: "candlestick", tasks: ["change_over_time", "distribution"], need: ["temporal", "open", "close"], reads: 0.88, aliases: ["candlestick", "ohlc", "open high low close", "stock", "price range"] },

  // ---- the second wave: Plot statistics, cartograms, ECharts 6, tables and diagrams
  { id: "hexbin", tasks: ["relationship", "distribution"], need: ["measure", "measure2"], reads: 0.84, aliases: ["hexbin", "hexagonal bin", "hexagon density", "2d density"], anti: s => (s.rows < 200 ? `${s.rows} points: a scatter plot keeps every value; hexagons are for hundreds of rows` : undefined) },
  { id: "contour", tasks: ["distribution", "relationship"], need: ["measure", "measure2"], reads: 0.8, aliases: ["contour", "density contours", "isolines", "kde"], anti: s => (s.rows < 100 ? `${s.rows} points: too few for a density to have a shape; use a scatter plot` : undefined) },
  { id: "beeswarm", tasks: ["distribution"], need: ["measure"], want: ["series"], reads: 0.87, aliases: ["beeswarm", "swarm", "one dot per", "dodged points"], budget: { categories: 30 } },
  { id: "bollinger", tasks: ["change_over_time"], need: ["temporal", "measure"], reads: 0.84, aliases: ["bollinger", "moving average", "rolling average", "volatility band", "normal range"] },
  { id: "difference_area", tasks: ["change_over_time", "compare_magnitude"], need: ["temporal", "measure", "measure2"], reads: 0.82, aliases: ["difference chart", "above and below", "actual vs plan", "surplus and deficit area"], anti: s => (s.columns.some(c => /(^|_)(plan|target|budget|forecast|expected|actual)($|_)/i.test(c.name)) ? undefined : "needs two series to shade between, such as plan and actual") },
  { id: "waffle", tasks: ["part_to_whole"], need: ["measure"], want: ["part"], reads: 0.6, aliases: ["waffle", "unit chart", "square grid", "100 squares"], budget: { categories: 8 } },
  { id: "arrow_change", tasks: ["compare_magnitude", "relationship"], need: ["measure", "measure2"], reads: 0.72, aliases: ["arrow change", "arrow chart", "vectors", "before and after arrows", "movement arrows"], budget: { categories: 12 } },
  { id: "voronoi", tasks: ["relationship", "distribution"], need: ["measure", "measure2"], reads: 0.68, aliases: ["voronoi", "tessellation", "nearest neighbour"] },
  { id: "ridgeline", tasks: ["distribution", "change_over_time"], need: ["measure"], want: ["series"], reads: 0.87, aliases: ["ridgeline", "ridge plot", "joyplot", "stacked density"], budget: { series: 8 } },
  { id: "horizon", tasks: ["change_over_time"], need: ["temporal", "measure"], reads: 0.7, aliases: ["horizon chart", "folded time series", "compact trend"], budget: { series: 4 } },
  { id: "cartogram_us_hex", tasks: ["location", "compare_magnitude"], need: ["measure"], want: ["location"], reads: 0.82, aliases: ["cartogram", "hex map", "state grid", "us hex"], anti: s => (s.columns.some(c => /postal|fips|state|abbr/i.test(c.name)) || (s.location?.kind === "us-state") ? undefined : "needs two-letter state codes (postal) to place each state on the grid") },
  { id: "cartogram_eu_tile", tasks: ["location", "compare_magnitude"], need: ["measure"], want: ["location"], reads: 0.8, aliases: ["tile map", "tile grid", "europe tiles", "grid map"], anti: s => (s.columns.some(c => /iso_?3/i.test(c.name)) ? undefined : "needs ISO 3166 alpha-3 codes (iso3) to place each country on the grid") },
  { id: "flow_map", tasks: ["flow", "location"], need: ["measure"], want: ["source", "target"], reads: 0.78, aliases: ["flow map", "great circle", "arc map", "flight map", "route map"] },
  { id: "violin", tasks: ["distribution"], need: ["measure"], want: ["dimension"], reads: 0.88, aliases: ["violin", "violin plot", "kernel density", "density by group"], anti: s => (s.rows < 20 ? `${s.rows} values: a density needs more to take a shape; use a strip plot` : undefined) },
  { id: "sparkline_matrix", tasks: ["change_over_time", "compare_magnitude"], need: ["measure"], want: ["dimension"], reads: 0.72, aliases: ["sparkline matrix", "kpi grid", "sparkline grid", "indicator grid"] },
  { id: "pictorial_bar", tasks: ["compare_magnitude", "rank"], need: ["measure", "dimension"], reads: 0.84, aliases: ["pictorial bar", "icon bar", "picture bar", "symbol bar", "capped bar"], budget: { categories: 12 } },
  { id: "theme_river", tasks: ["change_over_time", "flow"], need: ["temporal", "measure", "series"], reads: 0.8, aliases: ["theme river", "river chart", "flowing stream", "composition over time"], budget: { series: 8 } },
  { id: "data_table", tasks: ["compare_magnitude", "rank"], need: ["measure"], want: ["dimension"], reads: 0.8, aliases: ["table", "data table", "data graphic", "numbers table", "publication table"], budget: { categories: 40 } },
  { id: "kpi_table", tasks: ["compare_magnitude"], need: ["measure"], want: ["dimension"], reads: 0.78, aliases: ["kpi table", "scorecard", "target table", "balanced scorecard"], budget: { categories: 16 } },
  { id: "flowchart", tasks: ["flow", "hierarchy"], need: [], want: ["source", "target"], reads: 0.78, aliases: ["flowchart", "flow chart", "process flow", "workflow", "decision tree"], budget: { categories: 20 } },
  { id: "sequence_diagram", tasks: ["flow"], need: [], want: ["source", "target"], reads: 0.76, aliases: ["sequence diagram", "sequence chart", "interaction diagram", "protocol diagram", "call sequence"], budget: { categories: 12 } },
  { id: "state_diagram", tasks: ["flow"], need: [], want: ["source", "target"], reads: 0.74, aliases: ["state diagram", "state machine", "lifecycle", "status transitions"], budget: { categories: 12 } },
  { id: "er_diagram", tasks: ["hierarchy", "relationship"], need: [], reads: 0.76, aliases: ["er diagram", "entity relationship", "schema diagram", "erd"], budget: { categories: 16 } },
  { id: "mindmap", tasks: ["hierarchy"], need: [], want: ["key", "parent"], reads: 0.66, aliases: ["mindmap", "mind map", "brainstorm map", "topic tree"], budget: { categories: 16 } },
  { id: "org_chart", tasks: ["hierarchy"], need: [], want: ["key", "parent"], reads: 0.88, aliases: ["org chart", "organisation chart", "organization chart", "reporting line", "who reports to"], budget: { categories: 20 } },
  { id: "fishbone", tasks: ["relationship", "hierarchy"], need: [], want: ["key", "parent"], reads: 0.7, aliases: ["fishbone", "ishikawa", "cause and effect", "root cause", "why did"], budget: { categories: 8 } },
]

export const TRAITS_BY_ID: ReadonlyMap<string, Trait> = new Map(TRAITS.map(t => [t.id, t]))

/**
 * Words that mean a task. The chart's own aliases are matched too.
 *
 * The list follows the Financial Times' Visual Vocabulary, which names what a figure is *for*: deviation, correlation,
 * ranking, distribution, change over time, part-to-whole, magnitude, spatial and flow (plus hierarchy) are all here,
 * in the words people use for them ("surplus/deficit", "league table", "spread", "journey"). Non-English requests are
 * covered too: the common German, French and Spanish words for these tasks are listed with their accents folded, so
 * "évolution", "evolución" and "evolution" are one word and none of them is reported as not understood.
 */
export const TASK_WORDS: Readonly<Record<Task, readonly string[]>> = {
  // change over time (FT: "change over time", "evolution")
  change_over_time: ["trend", "over time", "time series", "timeline", "by month", "by week", "by day", "by year", "by quarter", "each month", "each week", "growth", "history", "since", "monthly", "weekly", "daily", "yearly", "trajectory", "change over", "evolution", "evolve", "pace of change", "verlauf", "entwicklung", "tendance", "evolucion", "tendencia"],
  // comparison and magnitude (FT: "magnitude", "deviation")
  compare_magnitude: ["compare", "comparison", "versus", "vs", "against", "difference", "higher", "lower", "bigger", "smaller", "more than", "relative", "magnitude", "deviation", "variance", "surplus", "deficit", "surplus and deficit", "diverging", "variation", "upside", "downside", "umsatz", "vergleich", "abweichung", "comparaison", "comparacion", "variacion", "desviacion"],
  // ranking (FT: "ranking", "league table")
  rank: ["rank", "ranking", "top", "bottom", "most", "least", "best", "worst", "leaderboard", "order", "sorted", "which has the", "league table", "ranked", "ordering", "rangliste", "rangfolge", "classement", "clasificacion"],
  // part to whole (FT: "part-to-whole", "composition")
  part_to_whole: ["share", "proportion", "percent", "percentage", "split", "breakdown", "composition", "mix", "make up", "of the total", "part of", "part to whole", "share of the whole", "anteil", "zusammensetzung", "repartition", "composicion", "participacion", "reparto"],
  // distribution and spread (FT: "distribution")
  distribution: ["distribution", "spread", "histogram", "how many", "frequency", "range", "latency", "response time", "outliers", "shape of", "dispersion", "verteilung", "distribucion"],
  // relationship and correlation (FT: "correlation")
  relationship: ["relationship", "related", "correlat", "affect", "depend", "drives", "predict", "scatter", "associated"],
  correlation: ["correlat", "which fields", "move together", "matrix", "covary", "covariance", "correlation matrix", "korrelation", "correlacion"],
  // flow and journey (FT: "flow")
  flow: ["flow", "funnel", "conversion", "sankey", "where do", "come from", "go to", "movement", "drop off", "drop-off", "journey", "path through", "attrition", "pass through", "fluss", "flux", "flujo", "recorrido"],
  // hierarchy (FT's "part-to-whole" charts, drawn as trees)
  hierarchy: ["hierarchy", "nested", "tree", "org", "reports to", "parent", "break down", "breakdown", "break it down", "structure", "department", "team", "org chart", "org structure", "organisation structure", "hierarchie", "jerarquia"],
  // spatial (FT: "spatial")
  location: ["map", "geo", "country", "countries", "state", "states", "region on a", "location", "where in the world", "choropleth", "spatial", "geographic", "geography", "cartogram", "geografie", "geographie", "geografia"],
}

/** Mediums and how much they let a figure carry. A blank bound is unbounded. */
export const MEDIUM_BUDGET: Readonly<Record<Medium, { readonly series: number; readonly categories: number; readonly minFont: number }>> = {
  analysis: { series: 40, categories: 200, minFont: 9 },
  report: { series: 8, categories: 24, minFont: 11 },
  presentation: { series: 5, categories: 8, minFont: 18 },
  paper: { series: 20, categories: 60, minFont: 7 },
}

/** The scoring table, as data. Changing a number changes `SCORING_VERSION`; a test fails until it is bumped. */
export const SCORING = {
  version: "1",
  weights: { intent: 0.35, dataFit: 0.4, expressiveness: 0.25 },
  confidence: { mediumMin: 0.5, highMin: 0.75, nearTieMargin: 0.03 },
  density: { rampStart: 1, rampEnd: 2, floor: 0 },
  scoreDecimals: 6,
} as const
