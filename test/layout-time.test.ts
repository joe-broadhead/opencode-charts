// Time on recipe axes: one calendar unit and one format per axis, ticks the plan spaces so labels never touch, the
// drawn check counting touching labels as a collision, fitting monotone on time axes, and ISO date categories written
// as dates.
import { afterAll, describe, expect, test } from "bun:test"
import { closeVegaWorker } from "../src/engines/vega-pool.ts"
import { MIN_LABEL_GAP, touchingLabels } from "../src/layout/fit.ts"
import { dateCategories, timeAxis } from "../src/layout/time.ts"
import { recipeDefinition } from "../src/recipes/definitions.ts"
import type { FigureNode } from "../src/figure.ts"
import { workspace } from "./helpers.ts"
import { draw } from "./support/documents.ts"

const ws = workspace()
const env = { ...ws.env, assertFiles: async () => undefined }
afterAll(async () => { ws.cleanup(); await closeVegaWorker() })

type Json = Record<string, any>
const example = (recipe: string) => structuredClone(recipeDefinition(recipe as never).examples()[0]!.document) as Json

describe("the time axis of a recipe", () => {
  test("a year of months reads Jan to Dec at the default size: no year-only first tick, no two labels touching", async () => {
    for (const recipe of ["line", "area"]) {
      const { result } = await draw(env, example(recipe))
      const labels = result.figure.nodes.filter(n => n.kind === "label" && n.box[1] > result.plot!.y + result.plot!.height).sort((a, b) => a.box[0] - b.box[0])
      const row = labels.filter(n => Math.abs(n.box[1] - labels[0]!.box[1]) < 2).map(n => n.text)
      expect(row).toEqual(["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"])
      expect(touchingLabels(result.figure.nodes)).toEqual([])
    }
  }, 60_000)

  test("narrower, fewer ticks: every second month, still one format, and never touching", async () => {
    const { result, fitted } = await draw(env, { ...example("line"), layout: { width: 360, height: 300 } })
    const labels = result.figure.nodes.filter(n => n.kind === "label" && n.box[1] > result.plot!.y + result.plot!.height).sort((a, b) => a.box[0] - b.box[0])
    const row = labels.filter(n => Math.abs(n.box[1] - labels[0]!.box[1]) < 2).map(n => n.text)
    expect(row.every(t => /^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)$/.test(t))).toBe(true)
    expect(row.length).toBeLessThan(12)
    expect(fitted.presentation.plan.signals.charts_x_time_step).toBeGreaterThan(1)
    expect(fitted.report.adjustments.map(a => a.path)).toContain("/encoding/x/axis/tickCount")
    expect(touchingLabels(result.figure.nodes)).toEqual([])
  }, 60_000)

  test("the unit and format follow the span, in UTC", () => {
    const months = Array.from({ length: 12 }, (_, i) => `2024-${String(i + 1).padStart(2, "0")}-01T00:00:00.000Z`)
    expect(timeAxis(months)).toMatchObject({ unit: "month", format: "%b", intervals: 11 })
    expect(timeAxis(months)!.labels).toEqual(["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"])
    expect(timeAxis(["2023-11-01", "2024-02-01"])).toMatchObject({ unit: "month", format: "%b %Y", intervals: 3, labels: ["Nov 2023", "Dec 2023", "Jan 2024", "Feb 2024"] })
    expect(timeAxis(["2019-06-01", "2024-06-01"])).toMatchObject({ unit: "year", format: "%Y", intervals: 5 })
    expect(timeAxis(["2024-03-01", "2024-03-20"])).toMatchObject({ unit: "day", format: "%b %-d", intervals: 19 })
    expect(timeAxis(["2024-03-01T00:00:00Z", "2024-03-02T12:00:00Z"])).toMatchObject({ unit: "hour", format: "%H:%M", intervals: 36 })
  })
})

test("the drawn check counts labels that touch as a collision, not only ones that overlap", () => {
  const node = (id: number, text: string, x0: number, x1: number, y0 = 400): FigureNode => ({ id, kind: "label", text, box: [x0, y0, x1, y0 + 11], where: "axis x" })
  // "November" ends at 500, "December" starts at 501: 1 px apart, read as one word.
  const touching = touchingLabels([node(1, "November", 450, 500), node(2, "December", 501, 552), node(3, "Date", 480, 505, 430)])
  expect(touching.map(([a, b]) => [a.text, b.text])).toEqual([["November", "December"]])
  expect(touchingLabels([node(1, "Nov", 450, 470), node(2, "Dec", 470 + MIN_LABEL_GAP, 490)])).toEqual([])
})

describe("ISO date categories are written as dates", () => {
  test("months, days and years only when needed", () => {
    expect(dateCategories(["2024-01-01", "2024-02-01"])).toEqual({ format: "%b", display: ["Jan", "Feb"] })
    expect(dateCategories(["2023-12-01", "2024-01-01"])).toEqual({ format: "%b %Y", display: ["Dec 2023", "Jan 2024"] })
    expect(dateCategories(["2024-03-04", "2024-03-05"])).toEqual({ format: "%b %-d", display: ["Mar 4", "Mar 5"] })
    expect(dateCategories(["2024-01-01", "North"])).toBeUndefined()
    expect(dateCategories(["2024-02-30"])).toBeUndefined()
  })

  test("a stacked bar by month shows Jan … Dec on its axis, and its data keeps the ISO values", async () => {
    const doc = example("stacked_bar")
    const { result, fitted } = await draw(env, doc)
    const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
    const shown = result.figure.nodes.filter(n => n.kind === "label" && months.includes(n.text)).sort((a, b) => a.box[0] - b.box[0]).map(n => n.text)
    expect(shown).toEqual(months)
    expect(result.svg).not.toMatch(/>2024-\d\d-01</)
    expect(fitted.presentation.rows.some(r => /^2024-\d\d-01$/.test(String(Object.values(r)[0])))).toBe(true)
  }, 60_000)
})

test("a box plot draws with no Vega-Lite warning, and the plan's signals still reach it (its title is drawn)", async () => {
  for (const layout of [{}, { width: 360, height: 300 }, { width: 1280, height: 640 }]) {
    const doc = { ...structuredClone(recipeDefinition("box_plot").examples()[0]!.document) as Json, title: "Response times by region", layout }
    const { result } = await draw(env, doc)
    expect(result.issues.filter(i => i.code === "VEGA_LITE_WARNING")).toEqual([])
    expect(result.figure.nodes.some(n => n.kind === "title" && n.text === "Response times by region")).toBe(true)
  }
}, 60_000)

test("a pie or donut lists its legend in slice order, and each category keeps its colour", async () => {
  const rows = [{ channel: "Search", visits: 120 }, { channel: "Direct", visits: 300 }, { channel: "Email", visits: 45 }, { channel: "Social", visits: 210 }]
  const legendOrder = (svg: string) => [...svg.matchAll(/role-legend-label[^>]*><text[^>]*>([^<]+)<\/text>/g)].map(m => m[1])
  const colourOf = (svg: string) => Object.fromEntries([...svg.matchAll(/aria-label="Channel: ([A-Za-z]+); [^"]*"[^>]*fill="(#[0-9A-F]+)"/g)].map(m => [m[1], m[2]]))
  const drawn: Record<string, Record<string, string>> = {}
  for (const sort of ["value-descending", "category-ascending", "input"]) for (const recipe of ["pie", "donut"]) {
    const { result, fitted } = await draw(env, { version: 1, title: "Visits by channel", chart: { kind: "recipe", recipe, data: { rows }, bindings: { category: "channel", value: "visits" }, options: { sort } } })
    const slices = fitted.presentation.rows.map(r => String(r.channel))
    expect(legendOrder(result.svg)).toEqual(slices)
    drawn[`${recipe} ${sort}`] = colourOf(result.svg)
  }
  // The same colour for each category in every order and in both recipes.
  expect(new Set(Object.values(drawn).map(c => JSON.stringify(Object.entries(c).sort()))).size).toBe(1)
  expect(Object.keys(drawn["pie value-descending"]!).sort()).toEqual(["Direct", "Email", "Search", "Social"])
}, 60_000)
