// Fitting is monotone in the available size: for the same chart, a size that fits never stops fitting when the
// canvas grows. Checked as a property over a sample of recipes and label sets, on the drawn chart (the server's
// planner plus its check of the drawing), from the narrowest size up to the largest profile (1280 × 720).
import { afterAll, describe, expect, test } from "bun:test"
import { closeVegaWorker } from "../src/engines/vega-pool.ts"
import { workspace } from "./helpers.ts"
import { draw } from "./support/documents.ts"
import { recipeDefinition } from "../src/recipes/definitions.ts"
import { RECIPE_IDS } from "../src/recipes/types.ts"

const ws = workspace()
const env = { ...ws.env, assertFiles: async () => undefined }
afterAll(async () => { ws.cleanup(); await closeVegaWorker() })

/** Eight categories of 50–60 characters: the long-labels-in-a-narrow-panel task of the agent corpus. */
const LONG = [
  "Billing and invoice disputes for annual enterprise plans", "Password resets and two-factor authentication lockouts",
  "Data export and scheduled report delivery failures", "Integration errors with third-party calendar providers",
  "Mobile app crashes after the latest operating system update", "Questions about seat licensing and team member invitations",
  "Slow dashboard loading for workspaces with many projects", "Requests to delete an account and all associated personal data",
]
const SHORT = ["North", "South", "East", "West", "Central", "Islands"]
const MEDIUM = Array.from({ length: 20 }, (_, i) => `Product line ${String.fromCharCode(65 + i)} (${2000 + i})`)
const SERIES = ["Online store", "Retail partners and resellers", "Direct enterprise sales"]

const categorical = (recipe: string, labels: readonly string[]) => ({ version: 1, title: "Tickets by category", chart: { kind: "recipe", recipe, data: { rows: labels.map((category, i) => ({ category, tickets: 40 + ((i * 37) % 400) })) }, bindings: { category: "category", value: "tickets" } } })
const grouped = (labels: readonly string[]) => ({ version: 1, title: "Tickets by category and channel", chart: { kind: "recipe", recipe: "grouped_bar", data: { rows: labels.flatMap((category, i) => SERIES.map((channel, j) => ({ category, channel, tickets: 10 + i * 3 + j }))) }, bindings: { category: "category", series: "channel", value: "tickets" } } })
const line = { version: 1, title: "Tickets per month by channel", chart: { kind: "recipe", recipe: "line", data: { rows: ["2024-01-01", "2024-02-01", "2024-03-01", "2024-04-01", "2024-05-01", "2024-06-01"].flatMap((month, i) => SERIES.map((channel, j) => ({ month, channel, tickets: 100 + i * 10 + j * 25 }))) }, bindings: { x: "month", y: "tickets", series: "channel" }, options: { xType: "temporal", yTitle: "Tickets (n)" } } }
const heatmap = { version: 1, title: "Tickets by category and weekday", chart: { kind: "recipe", recipe: "heatmap", data: { rows: LONG.slice(0, 5).flatMap((row, i) => ["Mon", "Tue", "Wed", "Thu", "Fri"].map((column, j) => ({ row, column, tickets: i * 5 + j }))) }, bindings: { column: "column", row: "row", value: "tickets" } } }

const timeline = (recipe: string, n: number, at: (i: number) => string) => ({ version: 1, title: "Active users", chart: { kind: "recipe", recipe, data: { rows: Array.from({ length: n }, (_, i) => ({ day: at(i), users: 1000 + ((i * 137) % 400) })) }, bindings: { x: "day", y: "users" }, options: { xType: "temporal", yTitle: "Users (n)" } } })
const CASES: [string, Record<string, unknown>][] = [
  ["bar, long labels", categorical("bar", LONG)],
  ["bar, short labels", categorical("bar", SHORT)],
  ["bar, 20 medium labels", categorical("bar", MEDIUM)],
  ["horizontal_bar, long labels", categorical("horizontal_bar", LONG)],
  ["horizontal_bar, 20 medium labels", categorical("horizontal_bar", MEDIUM)],
  ["grouped_bar, long labels", grouped(LONG)],
  ["grouped_bar, short labels", grouped(SHORT)],
  ["line with long series names", line],
  ["heatmap, long row labels", heatmap],
  ["pie, long labels", categorical("pie", LONG)],
  // Time axes: the plan spaces calendar ticks, so a wider canvas never has more crowded labels.
  ["line, a year of months", timeline("line", 12, i => `2024-${String(i + 1).padStart(2, "0")}-01`)],
  ["area, three years of months", timeline("area", 36, i => `${2022 + Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, "0")}-01`)],
  ["line, ninety days", timeline("line", 90, i => new Date(Date.UTC(2024, 0, 1 + i)).toISOString().slice(0, 10))],
  ["line, two days of hours", timeline("line", 48, i => new Date(Date.UTC(2024, 0, 1, i)).toISOString())],
  ["area, twelve years", timeline("area", 12, i => `${2013 + i}-01-01`)],
]
const WIDTHS = [320, 480, 600, 720, 1000, 1280]
const HEIGHTS = [320, 480, 720]

test("a chart that fits at W × H fits at every larger W' ≥ W and H' ≥ H (up to 1280 × 720)", async () => {
  const violations: string[] = []
  const report: string[] = []
  for (const [name, doc] of CASES) {
    const fits = new Map<string, boolean>()
    for (const width of WIDTHS) for (const height of HEIGHTS) {
      const outcome = await draw(env, { ...doc, layout: { width, height } }).then(() => true, (error: { code?: string }) => {
        if (error.code !== "LAYOUT_UNSATISFIABLE") throw error
        return false
      })
      fits.set(`${width}x${height}`, outcome)
    }
    for (const w of WIDTHS) for (const h of HEIGHTS) {
      if (!fits.get(`${w}x${h}`)) continue
      for (const w2 of WIDTHS.filter(x => x >= w)) for (const h2 of HEIGHTS.filter(y => y >= h)) if (!fits.get(`${w2}x${h2}`)) violations.push(`${name}: fits ${w}×${h} but not ${w2}×${h2}`)
    }
    report.push(`${name}: ${[...fits].filter(([, ok]) => ok).length}/${fits.size} sizes fit`)
  }
  expect(violations).toEqual([])
  // The property is not vacuous: most sizes fit, and the narrowest refuse the long labels.
  expect(report.every(line => !line.endsWith(": 0/18 sizes fit"))).toBe(true)
}, 600_000)

test("turned labels deeper than 200 px keep the axis title below them (Vega's default maxExtent no longer caps the room)", async () => {
  for (const width of [600, 720]) {
    const { result } = await draw(env, { ...categorical("bar", LONG), layout: { width, height: 480 } })
    expect(result.layout.overlaps).toEqual([])
    const nodes = result.figure.nodes
    const title = nodes.find(n => n.text === "Category")!
    const deepest = Math.max(...nodes.filter(n => LONG.includes(n.text)).map(n => n.box[3]))
    expect(deepest - (result.plot!.y + result.plot!.height)).toBeGreaterThan(200) // deeper than Vega's default extent
    expect(title.box[1]).toBeGreaterThanOrEqual(deepest)
  }
}, 60_000)

describe("a refusal suggests only what would fit", () => {
  const refuse = async (doc: Record<string, unknown>) => {
    const error = await draw(env, doc).then(() => undefined, (e: { code?: string; issues?: { fix?: string }[] }) => e)
    expect(error?.code).toBe("LAYOUT_UNSATISFIABLE")
    return error!.issues![0]!.fix!
  }
  const fitsAt = (doc: Record<string, unknown>, width: number, height: number) => draw(env, { ...doc, layout: { width, height } }).then(() => true, (e: { code?: string }) => { if (e.code !== "LAYOUT_UNSATISFIABLE") throw e; return false })
  const withRecipe = (doc: Record<string, unknown>, recipe: string) => ({ ...doc, chart: { ...(doc.chart as object), recipe } })

  const claims = (text: string) => [...text.matchAll(/(\d+) px wide at (\d+) px tall|(\d+) px tall at (\d+) px wide/g)].map(m => (m[1] ? [Number(m[1]), Number(m[2])] : [Number(m[4]), Number(m[3])]) as [number, number])
  const sentence = (fix: string, start: string) => { const i = fix.toLowerCase().indexOf(start.toLowerCase()); return i < 0 ? "" : fix.slice(i, fix.indexOf(".", fix.indexOf(" px", i)) + 1) }

  for (const [recipe, width, height] of [["bar", 320, 320], ["bar", 600, 300], ["horizontal_bar", 360, 480], ["horizontal_bar", 320, 320]] as const) test(`${recipe} with long labels at ${width}×${height}: the other bar is offered first only if it fits this size, and every size the fix names draws`, async () => {
    const doc = categorical(recipe, LONG)
    const other = recipe === "bar" ? "horizontal_bar" : "bar"
    const fix = await refuse({ ...doc, layout: { width, height } })
    const alternative = withRecipe(doc, other)
    const otherFits = await fitsAt(alternative, width, height)
    if (otherFits) expect(fix.startsWith(`A ${other} of the same data fits ${width}×${height} px`)).toBe(true)
    else {
      expect(fix).not.toContain(`A ${other} of the same data fits`)
      for (const [w, h] of claims(sentence(fix, `A ${other} does not fit`))) expect(await fitsAt(alternative, w, h)).toBe(true)
    }
    const own = claims(sentence(fix, "this chart fits at"))
    expect(own.length).toBeGreaterThan(0)
    for (const [w, h] of own) expect(await fitsAt(doc, w, h)).toBe(true)
  }, 120_000)

  test("the corpus case: eight long labels as a horizontal_bar at 360 × 480 offer a bar at 360 × 480 first, and that bar draws there", async () => {
    const doc = categorical("horizontal_bar", LONG)
    const fix = await refuse({ ...doc, layout: { width: 360, height: 480 } })
    expect(fix.startsWith('A bar of the same data fits 360×480 px: send the same document with chart.recipe "bar"')).toBe(true)
    // The requested chart's own minimum comes after it.
    expect(fix.indexOf("Or keep the horizontal_bar: this chart fits at")).toBeGreaterThan(0)
    const { result } = await draw(env, { ...withRecipe(doc, "bar"), layout: { width: 360, height: 480 } })
    expect({ width: result.width, height: result.height }).toEqual({ width: 360, height: 480 })
  }, 120_000)

  test("when no alternative fits the size, the refusal names the minimum size first", async () => {
    const doc = categorical("bar", LONG)
    const fix = await refuse({ ...doc, layout: { width: 320, height: 320 } })
    expect(await fitsAt(withRecipe(doc, "horizontal_bar"), 320, 320)).toBe(false)
    expect(fix.startsWith("This chart fits at")).toBe(true)
    for (const [w, h] of claims(sentence(fix, "this chart fits at"))) expect(await fitsAt(doc, w, h)).toBe(true)
  }, 120_000)

  test("a bar chart the horizontal bar would fit gets that suggestion first, and the horizontal bar does fit", async () => {
    // 900 × 300: too shallow for the turned labels, but they list down the side of a horizontal bar.
    const doc = categorical("bar", LONG)
    const fix = await refuse({ ...doc, layout: { width: 900, height: 300 } })
    expect(fix.startsWith("A horizontal_bar of the same data fits 900×300 px")).toBe(true)
    expect(await fitsAt(withRecipe(doc, "horizontal_bar"), 900, 300)).toBe(true)
  }, 120_000)
})

test("the planner and the drawing agree on turned labels: no candidate the planner accepts is rejected by the drawn check", async () => {
  const disagreements: string[] = []
  for (const [width, height] of [[300, 480], [310, 480], [320, 390], [330, 480], [360, 480], [420, 480], [600, 480]]) {
    const outcome = await draw(env, { ...categorical("bar", LONG), layout: { width, height } }).then(r => r.fitted.report.rejected, (e: { code?: string; message: string }) => {
      if (e.code !== "LAYOUT_UNSATISFIABLE") throw e
      // A refusal by the planner itself is agreement; one the drawing made after the planner accepted is not.
      return e.message.includes("measured on the drawn chart") ? [{ candidate: "all", conflicts: [{ what: e.message }] }] : []
    })
    if (outcome.length) disagreements.push(`${width}×${height}: ${outcome.map(r => `${r.candidate}: ${r.conflicts.map(c => c.what).join("; ").slice(0, 120)}`).join(" | ")}`)
  }
  expect(disagreements).toEqual([])
}, 120_000)

test("a plot left small by its guides is reported as an adjustment, with its size and share of the canvas", async () => {
  const narrow = await draw(env, { ...categorical("bar", LONG), layout: { width: 360, height: 480 } })
  const plot = narrow.fitted.report.plot!
  expect((plot.width * plot.height) / (360 * 480)).toBeLessThan(0.25)
  const note = narrow.fitted.report.adjustments.find(a => a.path === "/layout")
  expect(note?.reason).toContain(`the plot is ${Math.round(plot.width)}×${Math.round(plot.height)} px`)
  const roomy = await draw(env, { ...categorical("bar", SHORT), layout: { width: 720, height: 480 } })
  expect(roomy.fitted.report.adjustments.filter(a => a.path === "/layout")).toEqual([])
}, 60_000)

test("every recipe's refusal names only sizes, and swaps, that fit when requested", async () => {
  const swapTitles = (doc: Record<string, any>, recipe: string) => {
    const options = { ...(doc.chart.options ?? {}) }
    const [x, y] = [options.xTitle, options.yTitle]
    delete options.xTitle; delete options.yTitle
    if (y !== undefined) options.xTitle = y
    if (x !== undefined) options.yTitle = x
    return { ...doc, chart: { ...doc.chart, recipe, options } }
  }
  const fitsAt = (doc: Record<string, unknown>, width: number, height: number) => draw(env, { ...doc, layout: { mode: "fixed", width, height } }).then(() => true, (e: { code?: string }) => { if (e.code !== "LAYOUT_UNSATISFIABLE") throw e; return false })
  const claims = (text: string) => [...text.matchAll(/(\d+) px wide at (\d+) px tall|(\d+) px tall at (\d+) px wide/g)].map(m => (m[1] ? [Number(m[1]), Number(m[2])] : [Number(m[4]), Number(m[3])]) as [number, number])
  const wrong: string[] = []
  let refusals = 0
  for (const recipe of RECIPE_IDS) for (const [width, height] of [[240, 180], [360, 300]] as const) {
    const doc = { ...structuredClone(recipeDefinition(recipe).examples()[0]!.document) as Record<string, any>, layout: { mode: "fixed", width, height } }
    const error = await draw(env, doc).then(() => undefined, (e: { code?: string; issues?: { fix?: string }[] }) => { if (e.code !== "LAYOUT_UNSATISFIABLE") throw e; return e })
    if (!error) continue
    refusals++
    const fix = error.issues![0]!.fix!
    const ownAt = fix.toLowerCase().indexOf("this chart fits at")
    const own = ownAt < 0 ? [] : claims(fix.slice(ownAt, fix.indexOf(")", ownAt)))
    for (const [w, h] of own) if (!(await fitsAt(doc, w, h))) wrong.push(`${recipe} ${width}×${height}: named ${w}×${h}, which is refused`)
    const swapped = /A (bar|horizontal_bar) (of the same data fits|does not fit)/.exec(fix)
    if (swapped) {
      const other = swapTitles(doc, swapped[1]!)
      if (swapped[2] === "of the same data fits") { if (!(await fitsAt(other, width, height))) wrong.push(`${recipe} ${width}×${height}: offered ${swapped[1]} here, which is refused`) }
      else for (const [w, h] of claims(fix.slice(fix.indexOf(`A ${swapped[1]} does not fit`)).split(".")[0]!.split("either;")[1] ?? "")) if (!(await fitsAt(other, w, h))) wrong.push(`${recipe} ${width}×${height}: named ${swapped[1]} at ${w}×${h}, which is refused`)
    }
  }
  expect(wrong).toEqual([])
  expect(refusals).toBeGreaterThan(3) // the sizes are small enough that several recipes refuse
}, 600_000)
