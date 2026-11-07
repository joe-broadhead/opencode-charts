import { describe, expect, test } from "bun:test"
import { recommend } from "../src/recommend/rank.js"
import { shapeOf, rolesOf } from "../src/recommend/shape.js"
import { TRAITS_BY_ID } from "../src/recommend/traits.js"
import { workspace } from "./helpers.js"

/**
 * The advice is graded by constraints, not exact matches: each case says what must be in the top three and what must
 * not. A must-not is the load-bearing half — it is what stops a plausible but wrong chart from winning.
 *
 * Adapted from MCP Clearsight's eval design (`evals/README.md`, "each case asserts musts and must-nots").
 */

const ws = workspace()

const trend = [
  { channel: "Search", month: "2024-01-01", revenue: 120_000, orders: 900 },
  { channel: "Search", month: "2024-02-01", revenue: 132_000, orders: 940 },
  { channel: "Search", month: "2024-03-01", revenue: 141_000, orders: 980 },
  { channel: "Search", month: "2024-04-01", revenue: 138_000, orders: 970 },
  { channel: "Social", month: "2024-01-01", revenue: 88_000, orders: 610 },
  { channel: "Social", month: "2024-02-01", revenue: 91_000, orders: 640 },
  { channel: "Social", month: "2024-03-01", revenue: 97_000, orders: 660 },
  { channel: "Social", month: "2024-04-01", revenue: 103_000, orders: 690 },
  { channel: "Email", month: "2024-01-01", revenue: 41_000, orders: 300 },
  { channel: "Email", month: "2024-02-01", revenue: 47_000, orders: 330 },
  { channel: "Email", month: "2024-03-01", revenue: 52_000, orders: 350 },
  { channel: "Email", month: "2024-04-01", revenue: 58_000, orders: 380 },
]
const latency = Array.from({ length: 240 }, (_, i) => ({ service: ["checkout", "search", "profile"][i % 3], latency_ms: 90 + ((i * 37) % 180) }))
const countries = [
  { country: "Germany", users: 820 }, { country: "France", users: 760 }, { country: "Spain", users: 540 },
  { country: "Italy", users: 610 }, { country: "Poland", users: 390 }, { country: "Sweden", users: 280 },
  { country: "Netherlands", users: 350 }, { country: "Belgium", users: 240 }, { country: "Austria", users: 190 },
  { country: "Portugal", users: 170 }, { country: "Ireland", users: 140 }, { country: "Denmark", users: 160 },
]
const flows = [
  { source: "Search", target: "Trial", value: 520 }, { source: "Social", target: "Trial", value: 310 },
  { source: "Trial", target: "Paid", value: 410 }, { source: "Trial", target: "Churned", value: 590 },
]
const hierarchy = [
  { id: "root", parent: null, name: "Company", size: 0 },
  { id: "p", parent: "root", name: "Product", size: 120 },
  { id: "s", parent: "root", name: "Sales", size: 90 },
  { id: "e", parent: "root", name: "Ops", size: 60 },
]

interface Case { readonly request: string; readonly rows?: readonly Record<string, unknown>[]; readonly medium?: "analysis" | "report" | "presentation" | "paper"; readonly must?: readonly string[]; readonly mustNot?: readonly string[]; readonly top1?: string }

const CASES: readonly Case[] = [
  { request: "how is revenue trending by channel over time?", rows: trend, must: ["multi_line"], mustNot: ["pie", "donut", "histogram", "radar"] },
  { request: "which channel has the most revenue?", rows: trend, must: ["horizontal_bar"], mustNot: ["pie", "radar", "histogram"] },
  { request: "show the share of revenue each channel accounts for", rows: trend, medium: "presentation", must: ["donut", "pie"], mustNot: ["histogram", "scatter", "funnel"] },
  { request: "what does latency look like?", rows: latency, top1: "box_plot", must: ["box_plot", "histogram"], mustNot: ["pie", "line", "sankey"] },
  { request: "rank the countries by users", rows: countries, must: ["horizontal_bar"], mustNot: ["pie", "radar"] },
  { request: "where do sign-ups come from and where do they end up?", rows: flows, must: ["sankey"], mustNot: ["pie", "histogram"] },
  { request: "break the company down by department and team", rows: hierarchy, must: ["treemap", "sunburst", "tree"], mustNot: ["histogram", "scatter"] },
  { request: "is spend correlated with conversions? add a trend line", rows: [{ spend: 10, conversions: 2 }, { spend: 20, conversions: 5 }, { spend: 30, conversions: 9 }, { spend: 40, conversions: 11 }], must: ["regression", "scatter"], mustNot: ["pie", "histogram"] },
]

describe("recommend", () => {
  for (const c of CASES) test(c.request, async () => {
    const { result } = await recommend({ request: c.request, ...(c.rows ? { data: { rows: c.rows } } : {}), ...(c.medium ? { medium: c.medium } : {}), limit: 5 }, ws.env)
    const ids = result.recommendations.map(r => r.id)
    for (const id of c.must ?? []) expect(ids, `expected ${id} in ${ids.join(", ")}`).toContain(id)
    for (const id of c.mustNot ?? []) expect(ids, `${id} must not be recommended here`).not.toContain(id)
    if (c.top1) expect(ids[0]).toBe(c.top1)
    expect(result.abstain).toBeUndefined()
  })

  test("says why, and offers a call that draws the top pick on the caller's own columns", async () => {
    const { result } = await recommend({ request: "which channel has the most revenue?", data: { rows: trend } }, ws.env)
    const top = result.recommendations[0]!
    expect(top.why.length).toBeGreaterThan(0)
    expect(top.call).toBeDefined()
    const input = (top.call as { input: { spec: Record<string, any>; data?: unknown } }).input
    expect(JSON.stringify(input.spec)).toContain("channel")
    expect(JSON.stringify(input.spec)).toContain("revenue")
    expect(JSON.stringify(input).length).toBeGreaterThan(200)
  })

  test("abstains with a reason instead of guessing when the request names no task", async () => {
    const { result, text } = await recommend({ request: "hello there" }, ws.env)
    expect(result.recommendations).toEqual([])
    expect(result.abstain?.reason).toBe("no_matching_task")
    expect(text).toContain("No recommendation")
  })

  test("assumes a medium only when none is given, and says so", async () => {
    const assumed = await recommend({ request: "revenue trend", data: { rows: trend } }, ws.env)
    expect(assumed.result.medium).toBe("report")
    expect(assumed.result.mediumAssumed).toBe(true)
    const given = await recommend({ request: "revenue trend", data: { rows: trend }, medium: "presentation" }, ws.env)
    expect(given.result.mediumAssumed).toBe(false)
  })

  test("is deterministic: the same call twice gives the same ranking and scores", async () => {
    const a = await recommend({ request: "which channel has most revenue", data: { rows: trend }, limit: 5 }, ws.env)
    const b = await recommend({ request: "which channel has most revenue", data: { rows: trend }, limit: 5 }, ws.env)
    expect(JSON.stringify(a.result)).toBe(JSON.stringify(b.result))
  })

  test("a shuffle of the rows does not change the ranking", async () => {
    const shuffled = [...trend].reverse()
    const a = await recommend({ request: "which channel has most revenue", data: { rows: trend } }, ws.env)
    const b = await recommend({ request: "which channel has most revenue", data: { rows: shuffled } }, ws.env)
    expect(b.result.recommendations.map(r => r.id)).toEqual(a.result.recommendations.map(r => r.id))
  })

  test("a compact answer is the standard one's projection, never a second ranking", async () => {
    const full = await recommend({ request: "revenue trend by channel", data: { rows: trend }, limit: 4 }, ws.env)
    const compact = await recommend({ request: "revenue trend by channel", data: { rows: trend }, limit: 4, detail: "compact" }, ws.env)
    expect(compact.result.recommendations.map(r => r.id)).toEqual(full.result.recommendations.map(r => r.id))
    expect(compact.result.profile).toBeDefined()
  })

  test("tokens the request left unexplained are named, and the data's columns are not among them", async () => {
    const { result } = await recommend({ request: "how is revenue trending by channel over time?", data: { rows: trend } }, ws.env)
    expect(result.request.unmatched).not.toContain("revenue")
    expect(result.request.unmatched).not.toContain("channel")
  })

  test("a near tie is called out rather than hidden", async () => {
    const { result } = await recommend({ request: "compare revenue by channel", data: { rows: trend }, limit: 3 }, ws.env)
    if (result.nearTie) expect(result.nearTie.gap).toBeLessThanOrEqual(0.03)
  })

  test("the profile says what the data is, so the advice can be checked", async () => {
    const { result } = await recommend({ request: "revenue by channel", data: { rows: trend } }, ws.env)
    expect(result.profile?.rows).toBe(trend.length)
    expect(result.profile?.columns.map(c => c.name)).toEqual(["channel", "month", "revenue", "orders"])
    const shape = result.profile!.shape.join(" ")
    expect(shape).toContain("channel (3)")
    expect(shape).toContain("date: month")
  })
})

describe("the shape of the data", () => {
  test("finds measures, dates, series, edges and hierarchies", () => {
    const trendShape = shapeOf(trend)
    expect(trendShape.measures).toEqual(["revenue", "orders"])
    expect(trendShape.temporals).toEqual(["month"])
    expect(trendShape.series).toEqual({ name: "channel", distinct: 3 })
    const flowsShape = shapeOf(flows)
    expect(flowsShape.edges).toEqual({ source: "source", target: "target" })
    const hierarchyShape = shapeOf(hierarchy)
    expect(hierarchyShape.hierarchy).toEqual({ key: "id", parent: "parent" })
    expect(rolesOf(trendShape).has("series")).toBe(true)
    expect(rolesOf(hierarchyShape).has("parent")).toBe(true)
  })

  test("a column that is different in every row is an id, not a category", () => {
    const rows = Array.from({ length: 50 }, (_, i) => ({ order_id: `ORD-${i}`, amount: i * 3 }))
    expect(shapeOf(rows).dimensions).toEqual([])
  })

  test("a year stored as a number is a time axis, not a measure", () => {
    const rows = [{ year: 2020, revenue: 1 }, { year: 2021, revenue: 2 }, { year: 2022, revenue: 3 }]
    expect(shapeOf(rows).temporals).toEqual(["year"])
    expect(shapeOf(rows).measures).toEqual(["revenue"])
  })

  test("every trait's need is a role the shape can report", () => {
    for (const [, trait] of TRAITS_BY_ID) for (const role of trait.need) expect(["measure", "measure2", "dimension", "temporal", "series", "part", "size", "key", "parent", "source", "target", "location", "open", "close"]).toContain(role)
  })
})
