// Interaction presets for recipe documents, compiled by trusted code into the recipe's Vega-Lite spec: what each
// preset adds, which combinations are allowed, when HTML is required, and that the static exports are the canonical
// initial view. Live behaviour is tested in a real browser (test/browser/presets.test.ts).
import { afterAll, describe, expect, test } from "bun:test"
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { closeVegaWorker } from "../src/engines/vega-pool.ts"
import { INTERACTION_DEFAULTS } from "../src/document/index.ts"
import { combinationIssues, formatMismatch, interactionReport } from "../src/interactions/presets.ts"
import { CLEAR_EVENTS, DIMMED_OPACITY, PARAMS } from "../src/interactions/vegalite.ts"
import { compileVegaLite } from "../src/engines/vegalite.ts"
import { patchRecipeVega, LEGEND_BINDING } from "../src/layout/vega.ts"
import { SIGNALS } from "../src/layout/planner.ts"
import { workspace } from "./helpers.ts"
import { draw } from "./support/documents.ts"

const ws = workspace()
const env = { ...ws.env, assertFiles: async () => undefined }
afterAll(async () => { ws.cleanup(); await closeVegaWorker() })

type Json = Record<string, any>
const MONTHS = ["2024-01-01", "2024-02-01", "2024-03-01", "2024-04-01"]
const SALES = MONTHS.flatMap((month, i) => ["North", "South", "North"].map((region, j) => ({ month, region, revenue_eur: 100 + i * 10 + j })))
const line = (interactions?: Json) => ({ version: 1, title: "Revenue", chart: { kind: "recipe", recipe: "line", data: { rows: SALES }, bindings: { x: "month", y: "revenue_eur", series: "region" }, options: { xType: "temporal", aggregate: "sum" } }, ...(interactions ? { interactions } : {}) })
const POINTS = Array.from({ length: 30 }, (_, i) => ({ x: i, y: (i * 7) % 23, group: i % 3 === 0 ? "A" : "B", s: 1 + (i % 4) }))
const scatter = (interactions?: Json, recipe = "scatter") => ({ version: 1, chart: { kind: "recipe", recipe, data: { rows: POINTS }, bindings: { x: "x", y: "y", series: "group", ...(recipe === "bubble" ? { size: "s" } : {}) }, options: { xTitle: "X (n)", yTitle: "Y (n)" } }, ...(interactions ? { interactions } : {}) })
const spec = async (doc: unknown) => (await draw(env, doc)).fitted.presentation.spec as Json

describe("tooltip", () => {
  test("auto lists what each mark draws, titled like the axes, the aggregate named, time in UTC", async () => {
    const s = await spec(line())
    expect(s.encoding.tooltip).toEqual([
      { field: "month", type: "temporal", title: "Month", formatType: "utc", format: "%Y-%m-%d" },
      { field: "revenue_eur", type: "quantitative", title: "Sum of revenue_eur" },
      { field: "region", type: "nominal", title: "Region" },
    ])
  }, 30_000)

  test("a pie's tooltip never lists its internal slice order", async () => {
    const s = await spec({ version: 1, chart: { kind: "recipe", recipe: "pie", data: { rows: [{ k: "a", v: 1 }, { k: "b", v: 2 }] }, bindings: { category: "k", value: "v" } } })
    expect(s.encoding.tooltip.map((t: Json) => t.field)).toEqual(["k", "v"])
  }, 30_000)

  test("a box plot uses Vega-Lite's own statistics tooltip; off sets no tooltip at all", async () => {
    const box = await spec({ version: 1, chart: { kind: "recipe", recipe: "box_plot", data: { rows: POINTS }, bindings: { category: "group", value: "y" } } })
    // Drawn as the one layer of a view (Vega-Lite's box plot takes no params of its own).
    expect(box.layer[0].mark.tooltip).toBe(true)
    const off = await spec(line({ tooltip: "off" }))
    expect(off.encoding.tooltip).toBeUndefined()
    expect(off.mark.tooltip).toBe(false)
  }, 30_000)
})

describe("persistent presets", () => {
  test("legend highlight: a legend-bound point selection over the series, shown by opacity only", async () => {
    const s = await spec(line({ legend: "highlight" }))
    expect(s.params.find((p: Json) => p.name === PARAMS.legend)).toEqual({ name: PARAMS.legend, select: { type: "point", fields: ["region"], on: "window:chartsnopick", clear: `window:${CLEAR_EVENTS.legend}` }, bind: "legend" })
    expect(s.encoding.opacity).toEqual({ condition: { test: { param: PARAMS.legend }, value: 1 }, value: DIMMED_OPACITY })
  }, 30_000)

  test("x zoom: an interval on x bound to the x scale, marks clipped to the plot; y is not bound", async () => {
    const s = await spec(line({ zoom: "x" }))
    expect(s.params.find((p: Json) => p.name === PARAMS.zoom)).toEqual({ name: PARAMS.zoom, select: { type: "interval", encodings: ["x"], clear: `dblclick, window:${CLEAR_EVENTS.zoom}` }, bind: "scales" })
    expect(s.mark.clip).toBe(true)
    expect(s.encoding.opacity).toBeUndefined()
  }, 30_000)

  test("legend highlight with the brush: full emphasis is their intersection", async () => {
    const s = await spec(scatter({ legend: "highlight", brush: "interval" }))
    expect(s.encoding.opacity.condition.test).toEqual({ and: [{ param: PARAMS.legend }, { param: PARAMS.brush }] })
    expect(s.encoding.opacity.condition.value).toBe(0.8) // the scatter's own resting opacity
  }, 30_000)

  test("presets change emphasis only: the data, scales and domains are the same as without them", async () => {
    for (const [plain, live] of [[line(), line({ legend: "highlight", zoom: "x" })], [scatter(undefined, "bubble"), scatter({ legend: "highlight", brush: "interval" }, "bubble")]] as const) {
      const a = await draw(env, plain), b = await draw(env, live)
      expect(b.fitted.request.data).toEqual(a.fitted.request.data)
      const strip = (s: Json) => Object.fromEntries(Object.entries(s.encoding).filter(([k]) => k !== "opacity" && k !== "tooltip"))
      expect(strip(b.fitted.presentation.spec)).toEqual(strip(a.fitted.presentation.spec))
    }
  }, 60_000)

  test("the compiled legend binding changes only through the legend and clears only on its own event", async () => {
    const s = await spec(line({ legend: "highlight" }))
    const vega = compileVegaLite({ ...s, data: { values: [] } }).vega as Json
    patchRecipeVega(vega)
    const binding = vega.signals.find((x: Json) => LEGEND_BINDING.test(x.name))
    expect(binding.name).toBe(`${PARAMS.legend}_region_legend`)
    expect(binding.on.some((h: Json) => JSON.stringify(h.events) === JSON.stringify([{ source: "view", type: "click" }]))).toBe(false)
    expect(binding.on).toContainEqual({ events: [{ source: "window", type: CLEAR_EVENTS.legend }], update: "null", force: true })
    expect(vega.legends.every((l: Json) => l.orient?.signal === SIGNALS.legendOrient)).toBe(true)
  }, 30_000)
})

describe("combinations and formats", () => {
  const effective = (over: Json) => ({ ...INTERACTION_DEFAULTS, ...over })
  test("tooltip combines with everything; legend with zoom or brush; zoom with brush is refused with the alternatives", () => {
    expect(combinationIssues(effective({ legend: "highlight", zoom: "x" }))).toEqual([])
    expect(combinationIssues(effective({ legend: "highlight", brush: "interval" }))).toEqual([])
    const [issue] = combinationIssues(effective({ zoom: "x", brush: "interval" }))
    expect(issue).toMatchObject({ code: "INTERACTION_UNSUPPORTED", path: "/interactions/brush" })
    expect(issue!.fix).toContain("legend highlight with x zoom")
  })

  test("unsupported presets on a recipe are refused at their path before anything is drawn", async () => {
    const pie = { version: 1, chart: { kind: "recipe", recipe: "pie", data: { rows: [{ k: "a", v: 1 }] }, bindings: { category: "k", value: "v" } }, interactions: { zoom: "x" } }
    const error = await draw(env, pie).catch(e => e)
    expect(error.code).toBe("INTERACTION_UNSUPPORTED")
    expect(error.issues[0].path).toBe("/interactions/zoom")
  })

  test("an omitted tooltip never requires HTML; an explicit tooltip or a persistent preset with static-only formats is a mismatch (A29)", () => {
    expect(formatMismatch(["svg", "png"], effective({}), [])).toBeUndefined()
    const tooltip = formatMismatch(["svg", "png"], effective({}), ["tooltip"])
    expect(tooltip).toMatchObject({ code: "INTERACTION_FORMAT_MISMATCH", path: "/formats" })
    expect(tooltip!.message).toContain("interactions.tooltip is set to auto")
    expect(formatMismatch(["svg"], effective({ legend: "highlight" }), ["legend"])!.code).toBe("INTERACTION_FORMAT_MISMATCH")
    expect(formatMismatch(["svg", "html"], effective({ legend: "highlight" }), ["legend"])).toBeUndefined()
    // No explicit list: the defaults decide (html is added where needed), so nothing to check here.
    expect(formatMismatch(undefined, effective({ legend: "highlight" }), ["legend"])).toBeUndefined()
    expect(formatMismatch(["svg"], effective({ tooltip: "off" }), ["tooltip"])).toBeUndefined()
  })

  test("a render with an explicit static-only format list and an explicit preset is refused before anything is written", async () => {
    const error = await draw(env, line({ legend: "highlight" }), { formats: ["svg", "png"], name: "mismatch", outDir: "outputs/mismatch" }, true).catch(e => e)
    expect(error.code).toBe("INTERACTION_FORMAT_MISMATCH")
    expect(existsSync(join(ws.dir, "outputs", "mismatch"))).toBe(false)
    // The same chart with only the default hover writes its static files.
    const ok = await draw(env, line(), { formats: ["svg"], name: "no-mismatch" }, true)
    expect(ok.result.files.svg).toBeDefined()
  }, 30_000)

  test("the report says what was asked, what is in effect per format, and that HTML is unverified until a browser runs it", () => {
    const report = interactionReport(effective({ legend: "highlight" }), ["legend"])
    expect(report.requested).toEqual({ legend: "highlight" })
    expect(report.formats.svg).toBe("static initial view")
    expect(report.formats.png).toBe("static initial view")
    expect(report.formats.html).toMatchObject({ legend: "highlight", tooltip: "auto", verified: false })
    expect(report.htmlRequired).toBe(true)
    expect(interactionReport(effective({}), []).htmlRequired).toBe(false)
  })
})

test("static exports are the canonical initial view: nothing dimmed, no selection drawn, no script (A29)", async () => {
  const { result } = await draw(env, scatter({ legend: "highlight", brush: "interval" }), { formats: ["svg", "html"], name: "initial" }, true)
  const svg = readFileSync(join(ws.dir, result.files.svg!), "utf8")
  expect(svg).not.toContain(`opacity="${DIMMED_OPACITY}"`)
  expect(svg).not.toMatch(/<script|on[a-z]+=/i)
  const plain = await draw(env, scatter(), { formats: ["svg"], name: "initial-plain" }, true)
  // The same 30 points in the same places as the chart without presets.
  const points = (s: string) => [...s.matchAll(/aria-roledescription="point" transform="([^"]+)"/g)].map(m => m[1])
  expect(points(svg)).toHaveLength(30)
  expect(points(svg)).toEqual(points(readFileSync(join(ws.dir, plain.result.files.svg!), "utf8")))
}, 60_000)
