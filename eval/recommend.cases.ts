/**
 * Cases for `charts_recommend`, graded by constraints rather than exact matches: each one says what must appear in the
 * shortlist, what must not, and which chart is the single best answer when there is one.
 *
 * The must-not half is the load-bearing one: it is what stops a plausible but wrong chart from winning, such as a
 * funnel for a share of a whole, or a pie with forty slices.
 *
 * Adapted from MCP Clearsight's eval design (`evals/README.md`): cases assert musts and must-nots, the gates are
 * numbers, and the baseline is committed with the versions that made it.
 */

export interface RecommendCase {
  readonly id: string
  readonly request: string
  /** A synonym of the same question: the ranking must not move. */
  readonly paraphrase?: string
  readonly dataset: string
  readonly medium?: "analysis" | "report" | "presentation" | "paper"
  readonly must: readonly string[]
  readonly mustNot?: readonly string[]
  /** The single best answer, when the case has one. */
  readonly top1?: string
}

const months = (series: string[], base: number, amp: number, field = "value", count = 12) =>
  series.flatMap((name, k) => Array.from({ length: count }, (_, i) => ({ date: `2024-${String(i + 1).padStart(2, "0")}-01`, series: name, [field]: Number((base * (1 + k * 0.35) + amp * Math.sin(i / 1.9 + k) + i * base * 0.02).toPrecision(4)) })))

export const DATASETS: Readonly<Record<string, readonly Record<string, unknown>[]>> = {
  // A time series with a series column: the change-over-time family.
  traffic: months(["Search", "Social", "Email"], 1200, 300, "sessions"),
  // Four categories, one measure: the ranking family.
  regions: ["North", "South", "East", "West", "Central"].map((region, i) => ({ region, revenue: 1_250_000 - i * 210_000 + (i % 3) * 40_000 })),
  // One measure over many rows: the distribution family.
  latency: Array.from({ length: 300 }, (_, i) => ({ service: ["checkout", "search", "profile"][i % 3], latency_ms: Number((90 + ((i * 37) % 180) * 0.9 + (i % 7) * 3).toFixed(1)) })),
  // Two measures: the relationship family.
  spend: Array.from({ length: 60 }, (_, i) => ({ spend_k: Math.round((5 + ((i * 37) % 95)) * 10) / 10, conversions: Math.round(20 + ((i * 37) % 95) * 2.1 + ((i * 53) % 40) - 20) })),
  // Shares of one whole, few parts.
  budget: [{ item: "Payroll", share: 0.52 }, { item: "Infrastructure", share: 0.21 }, { item: "Marketing", share: 0.17 }, { item: "Other", share: 0.1 }],
  // Too many parts for a pie.
  countries: ["Germany", "France", "Spain", "Italy", "Netherlands", "Poland", "Sweden", "Belgium", "Austria", "Portugal", "Ireland", "Denmark", "Finland", "Norway", "Czechia", "Greece"].map((country, i) => ({ country, users_k: 820 - i * 45 + ((i * 37) % 50) })),
  // Edges: the flow family.
  signups: [
    { source: "Search", target: "Trial", value: 520 }, { source: "Social", target: "Trial", value: 310 }, { source: "Referral", target: "Trial", value: 170 },
    { source: "Trial", target: "Paid", value: 410 }, { source: "Trial", target: "Churned", value: 590 },
  ],
  // A hierarchy: parent ids.
  org: [
    { id: "root", parent: null, name: "Company", size: 0 },
    { id: "prod", parent: "root", name: "Product", size: 120 }, { id: "sales", parent: "root", name: "Sales", size: 90 }, { id: "ops", parent: "root", name: "Ops", size: 60 },
    { id: "web", parent: "prod", name: "Web", size: 50 }, { id: "mobile", parent: "prod", name: "Mobile", size: 40 }, { id: "desktop", parent: "prod", name: "Desktop", size: 30 },
  ],
  // Ordered stages: the one case a funnel is right for.
  checkout: [{ stage: "Visited", users: 10000 }, { stage: "Viewed product", users: 6200 }, { stage: "Added to basket", users: 2400 }, { stage: "Checkout", users: 1300 }, { stage: "Paid", users: 980 }],
  // Geography.
  world: [
    { country: "Germany", internet_pct: 93 }, { country: "France", internet_pct: 92 }, { country: "Spain", internet_pct: 96 },
    { country: "Italy", internet_pct: 85 }, { country: "Poland", internet_pct: 87 }, { country: "Sweden", internet_pct: 96 },
  ],
  // A single measure with no dimension: only counts and distributions are honest.
  scores: Array.from({ length: 120 }, (_, i) => ({ score: 40 + ((i * 29) % 60) })),
}

export const CASES: readonly RecommendCase[] = [
  // change over time
  { id: "trend-channel", request: "how are sessions trending by channel over time?", paraphrase: "show me the trend for each channel across the year", dataset: "traffic", must: ["multi_line"], mustNot: ["pie", "donut", "histogram", "sankey", "radar"] },
  { id: "trend-plain", request: "plot sessions over time", dataset: "traffic", must: ["line", "area"], mustNot: ["pie", "histogram"] },
  { id: "trend-stacked", request: "show the composition of sessions over time by channel", dataset: "traffic", must: ["stacked_area", "streamgraph", "stacked_bar"], mustNot: ["scatter", "histogram"] },
  { id: "trend-presentation", request: "how are sessions trending by channel?", dataset: "traffic", medium: "presentation", must: ["multi_line", "line", "small_multiples"], mustNot: ["pie", "radar"] },

  // ranking and comparison
  { id: "rank-regions", request: "which region has the most revenue?", dataset: "regions", top1: "horizontal_bar", must: ["horizontal_bar"], mustNot: ["pie", "radar", "histogram", "line"] },
  { id: "rank-paraphrase", request: "rank the regions by revenue", paraphrase: "put the regions in order, biggest revenue first", dataset: "regions", must: ["horizontal_bar"], mustNot: ["pie", "histogram"] },
  { id: "compare-regions", request: "compare revenue across the regions", dataset: "regions", must: ["bar"], mustNot: ["pie", "line"] },
  { id: "rank-countries", request: "which countries have the most users?", dataset: "countries", must: ["horizontal_bar"], mustNot: ["pie", "radar"], top1: "horizontal_bar" },

  // part to whole
  { id: "share-budget", request: "show the share of the budget each item takes", dataset: "budget", must: ["donut", "pie"], mustNot: ["histogram", "funnel", "scatter", "line"] },
  { id: "share-presentation", request: "what proportion of the budget is each item?", dataset: "budget", medium: "presentation", must: ["donut", "pie"], mustNot: ["histogram", "funnel"] },
  { id: "share-many", request: "show the share of users by country", dataset: "countries", must: ["horizontal_bar", "treemap", "normalized_bar", "bar"], mustNot: ["pie", "donut", "radial"] },

  // distribution
  { id: "distribution-latency", request: "what does checkout latency look like?", dataset: "latency", must: ["histogram", "box_plot", "density"], mustNot: ["pie", "sankey", "line"] },
  { id: "distribution-compare", request: "compare the spread of latency across services", dataset: "latency", must: ["box_plot", "strip"], mustNot: ["pie", "line"] },
  { id: "distribution-scores", request: "how are the scores distributed?", dataset: "scores", must: ["histogram", "density"], mustNot: ["pie", "sankey", "line"] },

  // relationship
  { id: "correlation-spend", request: "is spend correlated with conversions?", dataset: "spend", must: ["regression", "scatter"], mustNot: ["pie", "histogram", "sankey"] },
  { id: "trendline-spend", request: "plot spend against conversions with a trend line", dataset: "spend", must: ["regression", "scatter"], mustNot: ["pie", "histogram"] },

  // flow
  { id: "flow-signups", request: "where do sign-ups come from and where do they end up?", dataset: "signups", must: ["sankey"], mustNot: ["pie", "histogram", "line"] },
  { id: "funnel-checkout", request: "show the checkout funnel", dataset: "checkout", must: ["funnel"], mustNot: ["pie", "histogram", "line"] },

  // hierarchy
  { id: "hierarchy-org", request: "break the company down by department and team", dataset: "org", must: ["treemap", "sunburst", "tree"], mustNot: ["histogram", "line", "scatter"] },

  // geography
  { id: "map-world", request: "map internet penetration by country", dataset: "world", must: ["choropleth_world"], mustNot: ["histogram", "sankey"] },

  // abstention and the data's limits
  { id: "abstain-vague", request: "hello there", dataset: "regions", must: [], mustNot: ["bar", "line", "pie"] },
]

/** Pairs that must rank alike: the same question, said differently. */
export const PARAPHRASE_PAIRS = CASES.filter(c => c.paraphrase).map(c => ({ id: c.id, a: c.request, b: c.paraphrase! }))
