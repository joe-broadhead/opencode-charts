// Recipe compilation, checked against values computed by hand in this file (never by calling the compiler's own
// helpers): grouping, aggregation, missing values, temporal positions, sorting and the typed colour domain.
import { afterAll, describe, expect, test } from "bun:test"
import { join } from "node:path"
import { compile } from "vega-lite"
import { closeVegaWorker } from "../src/engines/vega-pool.ts"
import { ChartsError } from "../src/errors.ts"
import { DocumentInvalid, parseDocument } from "../src/document/index.ts"
import { compileRecipe, RECIPES, recipeContract, recipeContracts, type RecipeCompilation, type RecipeId } from "../src/recipes/index.ts"
import { renderChart } from "../src/pipeline.ts"
import { ROOT, workspace } from "./helpers.ts"

const ws = workspace()
afterAll(async () => { ws.cleanup(); await closeVegaWorker() })

type Row = Record<string, unknown>
const build = (recipe: RecipeId, rows: Row[], bindings: Row, options?: Row): RecipeCompilation => {
  const doc = parseDocument({ version: 1, chart: { kind: "recipe", recipe, data: { rows }, bindings, ...(options ? { options } : {}) } })
  return compileRecipe(doc.chart as never, rows)
}
function refusal(fn: () => unknown): DocumentInvalid {
  try { fn() } catch (error) { if (error instanceof DocumentInvalid) return error; throw error }
  throw new Error("expected a DocumentInvalid")
}
const enc = (c: RecipeCompilation) => c.spec.encoding as Record<string, Record<string, unknown>>

// A fixed table, small enough to total by hand.
const SALES: Row[] = [
  { region: "North", quarter: "Q1", revenue: 10, rate: 0.5 },
  { region: "South", quarter: "Q1", revenue: 4, rate: 0.25 },
  { region: "North", quarter: "Q2", revenue: 6, rate: 0.75 },
  { region: "North", quarter: "Q1", revenue: 5, rate: 0.5 },
  { region: "South", quarter: "Q2", revenue: -3, rate: 0.1 },
  { region: "East", quarter: "Q1", revenue: 0, rate: 0 },
]

describe("A06: repeated groups need an explicit aggregate", () => {
  test("bars: two rows for North", () => {
    const e = refusal(() => build("bar", SALES, { category: "region", value: "revenue" }))
    expect(e.code).toBe("AGGREGATION_REQUIRED")
    expect(e.path).toBe("/chart/options/aggregate")
    expect(e.message).toContain('2 category group(s)')
    expect(e.message).toContain('category "North" has 3 rows')
    expect(e.message).toContain("sum, mean, median, min, max, count")
  })
  test("grouped bars group by category and series: North/Q1 repeats", () => {
    const e = refusal(() => build("grouped_bar", SALES, { category: "region", series: "quarter", value: "revenue" }, { aggregate: "none" }))
    expect(e.code).toBe("AGGREGATION_REQUIRED")
    expect(e.message).toContain('1 category and series group(s)')
    expect(e.message).toContain('category "North", series "Q1" has 2 rows')
  })
  test("a line with the same date twice, read as the same instant in two spellings", () => {
    const rows = [{ day: "2024-03-01", v: 1 }, { day: "2024-03-01T00:00:00Z", v: 2 }, { day: "2024-03-02", v: 3 }]
    const e = refusal(() => build("line", rows, { x: "day", y: "v" }, { xType: "temporal" }))
    expect(e.code).toBe("AGGREGATION_REQUIRED")
    expect(e.message).toContain('x "2024-03-01T00:00:00.000Z" has 2 rows')
  })
  test("a heatmap cell twice; pie categories twice", () => {
    expect(refusal(() => build("heatmap", SALES, { column: "quarter", row: "region", value: "revenue" })).code).toBe("AGGREGATION_REQUIRED")
    const pie = refusal(() => build("pie", SALES.filter(r => (r.revenue as number) >= 0), { category: "region", value: "revenue" }))
    expect(pie.code).toBe("AGGREGATION_REQUIRED")
    expect(pie.hint).toContain("sum, count")
  })
  test("no automatic sum or mean: a rate column is refused like any other until an aggregate is named", () => {
    expect(refusal(() => build("bar", SALES, { category: "region", value: "rate" })).code).toBe("AGGREGATION_REQUIRED")
  })
  test("scatter, bubble, histogram and box plot never aggregate, so repeated rows are fine", () => {
    expect(build("scatter", SALES, { x: "revenue", y: "rate" }).values).toHaveLength(6)
    expect(build("box_plot", SALES, { category: "region", value: "revenue" }).values).toHaveLength(6)
    expect(build("histogram", SALES, { value: "revenue" }).values).toHaveLength(6)
  })
})

describe("A07: aggregates equal values computed by hand", () => {
  const byRegion = (c: RecipeCompilation, field: string) => Object.fromEntries(c.values.map(r => [r.region as string, r[field]]))
  test("sum", () => {
    // North 10 + 6 + 5 = 21; South 4 + (-3) = 1; East 0.
    const c = build("bar", SALES, { category: "region", value: "revenue" }, { aggregate: "sum" })
    expect(byRegion(c, "revenue")).toEqual({ North: 21, South: 1, East: 0 })
    expect(enc(c).y).toEqual({ field: "revenue", type: "quantitative", title: "Sum of revenue" })
  })
  test("mean, median, min, max", () => {
    expect(byRegion(build("bar", SALES, { category: "region", value: "revenue" }, { aggregate: "mean" }), "revenue")).toEqual({ North: 7, South: 0.5, East: 0 })
    expect(byRegion(build("bar", SALES, { category: "region", value: "revenue" }, { aggregate: "median" }), "revenue")).toEqual({ North: 6, South: 0.5, East: 0 })
    expect(byRegion(build("bar", SALES, { category: "region", value: "revenue" }, { aggregate: "min" }), "revenue")).toEqual({ North: 5, South: -3, East: 0 })
    expect(byRegion(build("bar", SALES, { category: "region", value: "revenue" }, { aggregate: "max" }), "revenue")).toEqual({ North: 10, South: 4, East: 0 })
  })
  test("count counts rows after the transform and needs no measure; its field never collides with a binding", () => {
    const c = build("bar", SALES, { category: "region" }, { aggregate: "count" })
    expect(byRegion(c, "count")).toEqual({ North: 3, South: 2, East: 1 })
    expect(enc(c).y).toEqual({ field: "count", type: "quantitative", title: "Count" })
    const rows = [{ count: "a" }, { count: "a" }, { count: "b" }]
    const clash = build("horizontal_bar", rows, { category: "count" }, { aggregate: "count", xTitle: "Rows" })
    expect(clash.values).toEqual([{ count: "a", count_2: 2 }, { count: "b", count_2: 1 }])
    expect(enc(clash).x).toEqual({ field: "count_2", type: "quantitative", title: "Rows" })
  })
  test("grouped sums by category and series; stacked bars keep negative parts", () => {
    const c = build("stacked_bar", SALES, { category: "region", series: "quarter", value: "revenue" }, { aggregate: "sum" })
    expect(c.values).toEqual([
      { region: "North", quarter: "Q1", revenue: 15 }, { region: "North", quarter: "Q2", revenue: 6 },
      { region: "South", quarter: "Q1", revenue: 4 }, { region: "South", quarter: "Q2", revenue: -3 },
      { region: "East", quarter: "Q1", revenue: 0 },
    ])
  })
  test("a line sums x and series groups, one point per month and region", () => {
    const rows = [
      { m: "2024-01-01", r: "A", v: 1 }, { m: "2024-01-01", r: "A", v: 2 }, { m: "2024-01-01", r: "B", v: 10 },
      { m: "2024-02-01", r: "A", v: 4 }, { m: "2024-02-01", r: "B", v: 20 }, { m: "2024-02-01", r: "B", v: 30 },
    ]
    const c = build("line", rows, { x: "m", y: "v", series: "r" }, { xType: "temporal", aggregate: "sum" })
    expect(c.values).toEqual([
      { m: "2024-01-01T00:00:00.000Z", r: "A", v: 3 }, { m: "2024-01-01T00:00:00.000Z", r: "B", v: 10 },
      { m: "2024-02-01T00:00:00.000Z", r: "A", v: 4 }, { m: "2024-02-01T00:00:00.000Z", r: "B", v: 50 },
    ])
    expect(c.stats).toEqual({ inputRows: 6, markRows: 4, groups: 4 })
  })
  test("the line-sum example equals its fixture: the 60/40 split sums back to each stacked-area value", () => {
    const ex = RECIPES.find(r => r.id === "line")!.examples()[1]!.document as { chart: { data: { rows: Row[] } } }
    const doc = parseDocument(ex)
    const c = compileRecipe(doc.chart as never, ex.chart.data.rows)
    const fixture = RECIPES.find(r => r.id === "stacked_area")!.examples()[0]!.document as { chart: { data: { rows: Row[] } } }
    const expected = new Map(fixture.chart.data.rows.map(r => [`${r.date}T00:00:00.000Z|${r.region}`, r.revenue_eur]))
    expect(c.values).toHaveLength(expected.size)
    for (const row of c.values) expect(row.revenue_eur).toBe(expected.get(`${row.month}|${row.region}`)!)
  })
  test("pie sums and counts; zero slices are kept", () => {
    const rows = [{ s: "a", v: 2 }, { s: "b", v: 0 }, { s: "a", v: 3 }]
    expect(build("pie", rows, { category: "s", value: "v" }, { aggregate: "sum" }).values.map(r => [r.s, r.v])).toEqual([["a", 5], ["b", 0]])
    expect(build("donut", rows, { category: "s" }, { aggregate: "count" }).values.map(r => [r.s, r.count])).toEqual([["a", 2], ["b", 1]])
  })
  test("heatmap means per cell", () => {
    const c = build("heatmap", SALES, { column: "quarter", row: "region", value: "rate" }, { aggregate: "mean" })
    const cell = (region: string, quarter: string) => c.values.find(r => r.region === region && r.quarter === quarter)?.rate
    expect([cell("North", "Q1"), cell("North", "Q2"), cell("South", "Q1"), cell("South", "Q2"), cell("East", "Q1")]).toEqual([0.5, 0.75, 0.25, 0.1, 0])
    expect(enc(c).color).toEqual({ field: "rate", type: "quantitative", title: "Mean of rate" })
  })
})

describe("A08: null, zero, negative, temporal and empty data", () => {
  test("null measures are skipped and counted; a group with no number stays empty, never zero", () => {
    const rows = [{ c: "a", v: 1 }, { c: "a", v: null }, { c: "b", v: null }, { c: "b" }, { c: "z", v: 0 }]
    const c = build("bar", rows, { category: "c", value: "v" }, { aggregate: "sum" })
    expect(c.values).toEqual([{ c: "a", v: 1 }, { c: "b", v: null }, { c: "z", v: 0 }])
    expect(c.diagnostics).toEqual([expect.objectContaining({ level: "warning", code: "VALUE_MISSING", path: "/chart/bindings/value" })])
    expect(c.diagnostics[0]!.message).toContain("3 row(s) have no value")
    expect(c.diagnostics[0]!.message).toContain("1 group(s) have no value at all and are left empty, not zero")
    // count counts rows whatever their measure.
    expect(build("bar", rows, { category: "c" }, { aggregate: "count" }).values.map(r => r.count)).toEqual([2, 2, 1])
  })
  test("one row per mark with a missing value: the mark is empty and reported", () => {
    const c = build("bar", [{ c: "a", v: null }, { c: "b", v: 2 }], { category: "c", value: "v" })
    expect(c.values).toEqual([{ c: "a", v: null }, { c: "b", v: 2 }])
    expect(c.diagnostics[0]!.message).toContain("their marks are left empty")
  })
  test("text measures are refused unless a transform converts them; numbers are never guessed from text", () => {
    const e = refusal(() => build("bar", [{ c: "a", v: "12" }, { c: "b", v: true }, { c: "c", v: "x" }], { category: "c", value: "v" }))
    expect(e.code).toBe("TYPE_MISMATCH")
    expect(e.message).toContain("3 row(s)")
    expect(e.message).toContain('row 0: "12"')
    expect(e.hint).toContain("toNumber")
  })
  test("a missing temporal or quantitative x is refused, not drawn at zero or today", () => {
    const missing = refusal(() => build("line", [{ d: "2024-01-01", v: 1 }, { d: null, v: 2 }, { v: 3 }], { x: "d", y: "v" }, { xType: "temporal" }))
    expect(missing.code).toBe("POSITION_MISSING")
    expect(missing.message).toContain("2 row(s)")
    expect(missing.hint).toContain('isValid(datum["d"])')
    expect(refusal(() => build("scatter", [{ x: 1, y: null }], { x: "x", y: "y" })).code).toBe("POSITION_MISSING")
    expect(refusal(() => build("area", [{ x: "", y: 1 }], { x: "x", y: "y" }, { xType: "quantitative" })).code).toBe("TYPE_MISMATCH")
  })
  test("invalid dates are refused; a number is not a date", () => {
    for (const d of ["2024-13-01", "2023-02-29", "01/02/2024", "2024-01-01T25:00", 2024, true]) {
      expect(refusal(() => build("line", [{ d, v: 1 }], { x: "d", y: "v" }, { xType: "temporal" })).code).toBe("NOT_A_DATE")
    }
    expect(build("line", [{ d: "2024-02-29", v: 1 }], { x: "d", y: "v" }, { xType: "temporal" }).values[0]!.d).toBe("2024-02-29T00:00:00.000Z")
  })
  test("temporal x is UTC on every host: dates, offsets and zone-less times", () => {
    const rows = [{ d: "2024", v: 1 }, { d: "2024-06", v: 2 }, { d: "2024-06-30", v: 3 }, { d: "2024-06-30 23:30", v: 4 }, { d: "2024-07-01T03:30:00+02:00", v: 5 }, { d: "2024-07-01T00:00:00.1234Z", v: 6 }]
    const c = build("line", rows, { x: "d", y: "v" }, { xType: "temporal", xSort: "input" })
    expect(c.values.map(r => r.d)).toEqual(["2024-01-01T00:00:00.000Z", "2024-06-01T00:00:00.000Z", "2024-06-30T00:00:00.000Z", "2024-06-30T23:30:00.000Z", "2024-07-01T01:30:00.000Z", "2024-07-01T00:00:00.123Z"])
  })
  test("the same document compiles to the same values under three host time zones", () => {
    const script = join(ROOT, "test", "tz-probe.ts")
    const outputs = ["UTC", "Pacific/Kiritimati", "America/Los_Angeles"].map(TZ => {
      const run = Bun.spawnSync(["bun", script], { env: { ...process.env, TZ }, stdout: "pipe", stderr: "pipe" })
      expect(run.stderr.toString()).toBe("")
      return run.stdout.toString()
    })
    expect(outputs[0]).toContain("2024-03-31T01:30:00.000Z")
    expect(outputs[0]).toContain("2024-03-31T00:30:00.000Z")
    expect(outputs[0]).toContain("0099-01-01T00:00:00.000Z")
    expect(outputs[1]).toBe(outputs[0]!)
    expect(outputs[2]).toBe(outputs[0]!)
  })
  test("empty data: no marks, no invented rows, a warning", () => {
    const c = build("bar", [], { category: "c", value: "v" })
    expect(c.values).toEqual([])
    expect(c.diagnostics.map(d => d.code)).toEqual(["EMPTY_DATA"])
    expect(build("scatter", [], { x: "x", y: "y", series: "s" }).categories).toEqual({ role: "series", field: "s", domain: [] })
  })
  test("a pie refuses negative parts; bars keep them", () => {
    const e = refusal(() => build("pie", [{ s: "a", v: 2 }, { s: "b", v: -1 }], { category: "s", value: "v" }))
    expect(e.code).toBe("PIE_NEGATIVE")
    expect(e.hint).toContain("bar")
    expect(build("bar", [{ s: "a", v: 2 }, { s: "b", v: -1 }], { category: "s", value: "v" }).values).toEqual([{ s: "a", v: 2 }, { s: "b", v: -1 }])
  })
  test("unknown fields are resolved after the transform, with a suggestion", () => {
    const e = refusal(() => build("bar", [{ region: "a", revenue: 1 }], { category: "regoin", value: "revenue" }))
    expect(e.code).toBe("UNKNOWN_FIELD")
    expect(e.path).toBe("/chart/bindings/category")
    expect(e.message).toContain('Did you mean "region"?')
  })
  test("box plot and histogram leave out rows without a value, and say so", () => {
    const c = build("box_plot", [{ g: "a", v: 1 }, { g: "a", v: null }, { g: "b", v: 3 }], { category: "g", value: "v" })
    expect(c.values).toEqual([{ g: "a", v: 1 }, { g: "b", v: 3 }])
    expect(c.diagnostics[0]).toMatchObject({ code: "VALUE_MISSING" })
    expect(build("histogram", [{ v: null }, { v: 2 }], { value: "v" }).values).toEqual([{ v: 2 }])
  })
})

describe("sorting and order", () => {
  const rows = [{ c: "b", v: 2 }, { c: "a", v: 3 }, { c: "c", v: 2 }, { c: "d", v: null }]
  const order = (sort: string) => build("bar", rows, { category: "c", value: "v" }, { sort }).values.map(r => r.c)
  test("input, category and value sorts; ties keep input order; missing values last", () => {
    expect(order("input")).toEqual(["b", "a", "c", "d"])
    expect(order("category-ascending")).toEqual(["a", "b", "c", "d"])
    expect(order("category-descending")).toEqual(["d", "c", "b", "a"])
    expect(order("value-ascending")).toEqual(["b", "c", "a", "d"])
    expect(order("value-descending")).toEqual(["a", "b", "c", "d"])
    // The displayed order is the row order; Vega-Lite keeps it (sort: null).
    expect(enc(build("bar", rows, { category: "c", value: "v" })).x!.sort).toBeNull()
  })
  test("category sorts use typed order: null, booleans, numbers, strings by code point", () => {
    const typed = [{ c: "b", v: 1 }, { c: 10, v: 1 }, { c: "\u{1F600}", v: 1 }, { c: null, v: 1 }, { c: 2, v: 1 }, { c: "￿", v: 1 }, { c: true, v: 1 }, { c: "10", v: 1 }]
    expect(build("bar", typed, { category: "c", value: "v" }, { sort: "category-ascending" }).values.map(r => r.c)).toEqual([null, true, 2, 10, "10", "b", "￿", "\u{1F600}"])
  })
  test("horizontal bars: xTitle names the horizontal (value) axis, yTitle the categories", () => {
    const c = build("horizontal_bar", rows, { category: "c", value: "v" }, { xTitle: "Value (€)", yTitle: "Country" })
    expect(enc(c).x).toMatchObject({ field: "v", title: "Value (€)" })
    expect(enc(c).y).toMatchObject({ field: "c", title: "Country", sort: null })
  })
  test("line xSort: ascending by default for time, reversed axis for descending, input order kept on request", () => {
    const rows = [{ d: "2024-03-01", v: 3 }, { d: "2024-01-01", v: 1 }, { d: "2024-02-01", v: 2 }]
    const asc = build("line", rows, { x: "d", y: "v" }, { xType: "temporal" })
    expect(asc.values.map(r => r.v)).toEqual([1, 2, 3])
    expect(asc.defaults).toEqual({ aggregate: "none", xSort: "ascending" })
    expect(enc(asc).order).toBeUndefined()
    const desc = build("line", rows, { x: "d", y: "v" }, { xType: "temporal", xSort: "descending" })
    expect(enc(desc).x!.scale).toEqual({ reverse: true })
    const input = build("line", rows, { x: "d", y: "v" }, { xType: "temporal", xSort: "input" })
    expect(input.values.map(r => r.v)).toEqual([3, 1, 2])
    expect(enc(input).order).toEqual({ value: null })
    const ordinal = build("line", [{ s: "Mon", v: 1 }, { s: "Tue", v: 2 }, { s: "Wed", v: 3 }], { x: "s", y: "v" }, { xType: "ordinal" })
    expect(ordinal.defaults.xSort).toBe("input")
    expect(ordinal.values.map(r => r.s)).toEqual(["Mon", "Tue", "Wed"])
    expect(build("line", [{ s: "Mon", v: 1 }, { s: "Tue", v: 2 }, { s: "Wed", v: 3 }], { x: "s", y: "v" }, { xType: "ordinal", xSort: "descending" }).values.map(r => r.s)).toEqual(["Wed", "Tue", "Mon"])
  })
  test("heatmap rows and columns are ordered independently", () => {
    const c = build("heatmap", [{ r: "y", c: 2, v: 1 }, { r: "x", c: 1, v: 1 }, { r: "z", c: 3, v: 1 }], { column: "c", row: "r", value: "v" }, { rowSort: "ascending", columnSort: "descending" })
    expect(enc(c).y!.sort).toEqual(["x", "y", "z"])
    expect(enc(c).x!.sort).toEqual([3, 2, 1])
    expect(enc(build("heatmap", [{ r: "y", c: 2, v: 1 }], { column: "c", row: "r", value: "v" })).x!.sort).toBeNull()
  })
  test("pie slices follow the display sort through an order field; colours follow the typed domain", () => {
    const c = build("pie", [{ s: "b", v: 1 }, { s: "a", v: 5 }, { s: "c", v: 3 }], { category: "s", value: "v" }, { sort: "value-descending" })
    expect(c.values).toEqual([{ s: "a", v: 5, slice_order: 0 }, { s: "c", v: 3, slice_order: 1 }, { s: "b", v: 1, slice_order: 2 }])
    expect(c.internalFields).toEqual(["slice_order"])
    expect(enc(c).order).toEqual({ field: "slice_order", type: "quantitative", sort: "ascending" })
    expect(enc(c).color).toEqual({ field: "s", type: "nominal", scale: { domain: ["a", "b", "c"] } })
  })
})

describe("the typed colour domain (§8.2)", () => {
  const MIXED = [{ s: "b" }, { s: 1 }, { s: "1" }, { s: true }, { s: null }, { s: -0 }, { s: 0 }, { s: "a" }, { s: false }, { s: 1 }, {}]
  test("1 and \"1\" are two categories; booleans and null are their own; -0 is 0; type order then value", () => {
    const c = build("scatter", MIXED.map((r, i) => ({ ...r, x: i, y: i })), { x: "x", y: "y", series: "s" })
    expect(c.categories).toEqual({ role: "series", field: "s", domain: [null, false, true, 0, 1, "1", "a", "b"] })
    expect(Object.is(c.categories!.domain[3], 0)).toBe(true)
    expect(enc(c).color).toEqual({ field: "s", type: "nominal", scale: { domain: [null, false, true, 0, 1, "1", "a", "b"] } })
  })
  test("display sort never changes the colour domain", () => {
    const rows = [{ c: "x", s: "b", v: 1 }, { c: "y", s: "a", v: 2 }]
    for (const sort of ["input", "category-ascending", "category-descending"]) {
      const c = build("grouped_bar", rows, { category: "c", series: "s", value: "v" }, { sort })
      expect(c.categories!.domain).toEqual(["a", "b"])
      expect(enc(c).xOffset).toEqual({ field: "s", type: "nominal", scale: { domain: ["a", "b"] } })
    }
    for (const sort of ["value-ascending", "value-descending", "category-descending"]) expect(build("pie", [{ k: "b", v: 1 }, { k: "a", v: 2 }], { category: "k", value: "v" }, { sort }).categories!.domain).toEqual(["a", "b"])
  })
  test("a captured domain keeps every category's position on replay, even when the data's order changes", () => {
    const doc = parseDocument({ version: 1, chart: { kind: "recipe", recipe: "line", data: { rows: [] }, bindings: { x: "x", y: "y", series: "s" }, options: { xType: "quantitative" } } })
    const first = compileRecipe(doc.chart as never, [{ x: 1, y: 1, s: "b" }, { x: 1, y: 1, s: "a" }])
    expect(first.categories!.domain).toEqual(["a", "b"])
    const again = compileRecipe(doc.chart as never, [{ x: 1, y: 1, s: "a" }, { x: 1, y: 1, s: "b" }], { categoryDomain: first.categories!.domain })
    expect(again.categories!.domain).toEqual(["a", "b"])
    // A category the capture did not have goes after the captured ones; captured positions do not move.
    const extra = compileRecipe(doc.chart as never, [{ x: 1, y: 1, s: "0" }, { x: 1, y: 1, s: "b" }], { categoryDomain: ["b", "z"] })
    expect(extra.categories!.domain).toEqual(["b", "z", "0"])
  })
  test("non-scalar categories are refused", () => {
    expect(refusal(() => build("bar", [{ c: { a: 1 }, v: 1 }], { category: "c", value: "v" })).code).toBe("TYPE_MISMATCH")
    expect(refusal(() => build("scatter", [{ x: 1, y: 1, s: [1] }], { x: "x", y: "y", series: "s" })).code).toBe("TYPE_MISMATCH")
  })
})

describe("every recipe's examples compile and render through the existing engine", () => {
  for (const recipe of RECIPES) for (const ex of recipe.examples()) {
    test(`${ex.name}`, async () => {
      const doc = parseDocument(structuredClone(ex.document))
      const rows = (doc.chart as unknown as { data: { rows: Row[] } }).data.rows
      const c = compileRecipe(doc.chart as never, rows)
      expect(c.diagnostics).toEqual([])
      expect(c.spec.data).toEqual({ name: "table" })
      // The compiled spec carries no data of its own; the mark rows travel beside it.
      expect(JSON.stringify(c.spec)).not.toContain('"values"')
      // Valid Vega-Lite, and the renderer draws it with no error.
      expect(() => compile({ ...c.spec, data: { values: c.values } } as never)).not.toThrow()
      const r = await renderChart({ spec: c.spec as never, data: { rows: c.values as never }, title: String(ex.document.title), formats: ["svg"] }, ws.env, false)
      expect(r.issues.filter(i => i.level === "error")).toEqual([])
      expect(r.svg).toContain("<svg")
    })
  }
  test("the compiled spec is deterministic: same document, same spec and values", () => {
    for (const recipe of RECIPES) {
      const ex = recipe.examples()[0]!.document as { chart: { data: { rows: Row[] } } }
      const a = compileRecipe(parseDocument(structuredClone(ex)).chart as never, ex.chart.data.rows)
      const b = compileRecipe(parseDocument(structuredClone(ex)).chart as never, structuredClone(ex.chart.data.rows))
      expect(JSON.stringify([a.spec, a.values])).toBe(JSON.stringify([b.spec, b.values]))
    }
  })
})

describe("registry metadata", () => {
  test("every recipe states its bindings, options, data requirements, interactions, layout support and examples", () => {
    const contracts = recipeContracts()
    expect(contracts).toHaveLength(14)
    for (const c of contracts) {
      expect(c.bindings.length).toBeGreaterThan(0)
      expect(c.dataRequirements.length).toBeGreaterThan(20)
      expect(c.layout.targets).toEqual(["inline", "analysis", "report", "presentation", "paper"])
      expect(c.examples.length).toBeGreaterThan(0)
      expect(c.interactions.tooltip).toEqual(["auto", "off"])
    }
    expect(recipeContract("line").interactions.zoom).toEqual(["none", "x (temporal x only)"])
    expect(recipeContract("pie").interactions.zoom).toEqual(["none"])
    expect(recipeContract("scatter").interactions.brush).toEqual(["none", "interval"])
    expect(recipeContract("histogram").options).toMatchObject({ bins: { min: 2, max: 200, default: 24 } })
    expect(recipeContract("grouped_bar").groupBy).toEqual(["category", "series"])
    expect(recipeContract("heatmap").groupBy).toEqual(["column", "row"])
  })
  test("the chart document validator and the compiler are host-free: ChartsError carries every refusal", () => {
    expect(() => build("bar", [{ a: 1 }], { category: "a", value: "a" })).toThrow(ChartsError)
  })
})
