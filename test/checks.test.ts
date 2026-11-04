import { afterAll, describe, expect, test } from "bun:test"
import { closeVegaWorker } from "../src/engines/vega-pool.ts"
import { SpecInvalid, type Issue } from "../src/errors.ts"
import { renderChart, type RenderRequest } from "../src/pipeline.ts"
import { BAR, ROWS, workspace } from "./helpers.ts"

const ws = workspace()
afterAll(async () => { ws.cleanup(); await closeVegaWorker() })
async function issuesOf(request: RenderRequest): Promise<Issue[]> {
  try { return [...(await renderChart({ formats: ["svg"], ...request }, ws.env, false)).issues] }
  catch (error) { if (error instanceof SpecInvalid) return [...error.issues]; throw error }
}
const find = (issues: Issue[], code: string) => issues.find(i => i.code === code)

describe("validation teaches", () => {
  test("an unknown field: did-you-mean, the JSON path, the fields, and a fix", async () => {
    const issue = find(await issuesOf({ spec: { ...BAR, encoding: { ...BAR.encoding, y: { field: "revenu", type: "quantitative" } } }, data: { rows: ROWS } }), "UNKNOWN_FIELD")!
    expect(issue.level).toBe("error")
    expect(issue.path).toBe("/encoding/y/field")
    expect(issue.message).toContain('Did you mean "revenue"?')
    expect(issue.message).toContain("The fields are: region, revenue")
    expect(issue.fix).toBe('Set field to "revenue".')
  })
  test("fields made by transforms count as data", async () => {
    const issues = await issuesOf({ spec: { mark: "bar", transform: [{ calculate: "datum.revenue * 1000", as: "revenue_eur" }], encoding: { x: { field: "region", type: "nominal" }, y: { field: "revenue_eur", type: "quantitative" } } }, data: { rows: ROWS } })
    expect(find(issues, "UNKNOWN_FIELD")).toBeUndefined()
  })
  test("unknown marks, channels, types and top-level keys", async () => {
    const issues = await issuesOf({ spec: { mark: "bars", encodings: {}, encoding: { colour: { field: "region", type: "nominal" }, x: { field: "region", type: "categorical" } } }, data: { rows: ROWS } })
    expect(find(issues, "UNKNOWN_MARK")!.fix).toBe('Did you mean "bar"?')
    expect(find(issues, "UNKNOWN_PROPERTY")!.fix).toBe('Did you mean "encoding"?')
    expect(find(issues, "UNKNOWN_CHANNEL")!.fix).toBe('Did you mean "color"?')
  })
  test("a type alias is read, not refused", async () => {
    const r = await renderChart({ spec: { mark: "bar", encoding: { x: { field: "region", type: "N" }, y: { field: "revenue", type: "Q", title: "Revenue (€k)" } } }, data: { rows: ROWS }, formats: ["svg"] }, ws.env, false)
    expect(r.notes.join(" ")).toContain("as quantitative")
  })
  test("text encoded as a number", async () => {
    const issue = find(await issuesOf({ spec: { mark: "bar", encoding: { x: { field: "revenue", type: "quantitative" }, y: { field: "region", type: "quantitative" } } }, data: { rows: ROWS } }), "TYPE_MISMATCH")!
    expect(issue.fix).toContain('"nominal"')
  })
  test("Vega: an undefined dataset; ECharts: an unknown dimension and a Sankey cycle", async () => {
    expect(find(await issuesOf({ spec: { marks: [{ type: "rect", from: { data: "tabel" } }] }, data: { rows: ROWS } }), "UNKNOWN_DATASET")!.message).toContain('Did you mean "table"?')
    expect(find(await issuesOf({ spec: { xAxis: { type: "category" }, yAxis: {}, series: [{ type: "bar", encode: { x: "regoin", y: "revenue" } }] }, data: { rows: ROWS } }), "UNKNOWN_FIELD")!.message).toContain('"region"')
    expect(find(await issuesOf({ spec: { series: [{ type: "sankey", data: [{ name: "a" }, { name: "b" }], links: [{ source: "a", target: "b", value: 1 }, { source: "b", target: "a", value: 1 }] }] } }), "SANKEY_CYCLE")).toBeDefined()
    expect(find(await issuesOf({ spec: { series: [{ type: "line", data: [1, 2] }] } }), "AXES_MISSING")).toBeDefined()
  })
})

describe("lint warns", () => {
  const letters = Array.from({ length: 9 }, (_, i) => ({ k: String.fromCharCode(65 + i), v: i + 1 }))
  test("a pie with too many slices, and negative pie values", async () => {
    expect(find(await issuesOf({ spec: { mark: "arc", encoding: { theta: { field: "v", type: "quantitative" }, color: { field: "k", type: "nominal" } } }, data: { rows: letters } }), "PIE_TOO_MANY_SLICES")).toBeDefined()
    expect(find(await issuesOf({ spec: { mark: "arc", encoding: { theta: { field: "v", type: "quantitative" }, color: { field: "k", type: "nominal" } } }, data: { rows: [{ k: "a", v: -1 }, { k: "b", v: 2 }] } }), "PIE_NEGATIVE")).toBeDefined()
  })
  test("a bar axis that does not start at zero", async () => {
    expect(find(await issuesOf({ spec: { ...BAR, encoding: { ...BAR.encoding, y: { ...BAR.encoding.y, scale: { zero: false } } } }, data: { rows: ROWS } }), "TRUNCATED_AXIS")).toBeDefined()
  })
  test("a rainbow on sequential data", async () => {
    expect(find(await issuesOf({ spec: { mark: "rect", encoding: { x: { field: "k", type: "nominal" }, color: { field: "v", type: "quantitative", scale: { scheme: "rainbow" } } } }, data: { rows: letters } }), "RAINBOW_SEQUENTIAL")).toBeDefined()
  })
  test("missing units, unsorted ranking bars, overplotting, too many series", async () => {
    expect(find(await issuesOf({ spec: { mark: "bar", encoding: { x: { field: "k", type: "nominal" }, y: { field: "v", type: "quantitative" } } }, data: { rows: letters } }), "MISSING_UNITS")).toBeDefined()
    expect(find(await issuesOf({ spec: { mark: "bar", encoding: { x: { field: "k", type: "nominal" }, y: { field: "v", type: "quantitative", title: "V (n)" } } }, data: { rows: letters } }), "UNSORTED_BARS")).toBeDefined()
    const points = Array.from({ length: 2500 }, (_, i) => ({ a: i % 97, b: (i * 31) % 89 }))
    expect(find(await issuesOf({ spec: { mark: "point", encoding: { x: { field: "a", type: "quantitative", title: "A" }, y: { field: "b", type: "quantitative", title: "B" } } }, data: { rows: points } }), "OVERPLOTTING")).toBeDefined()
    const series = Array.from({ length: 12 }, (_, s) => [1, 2, 3].map(t => ({ t, s: `s${s}`, v: s + t }))).flat()
    expect(find(await issuesOf({ spec: { mark: "line", encoding: { x: { field: "t", type: "quantitative", title: "T" }, y: { field: "v", type: "quantitative", title: "V" }, color: { field: "s", type: "nominal" } } }, data: { rows: series } }), "TOO_MANY_SERIES")).toBeDefined()
  })
  test("labels that really collide, found in the drawn SVG", async () => {
    const issues = await issuesOf({ spec: { layer: [{ mark: "point" }, { mark: { type: "text", dx: 4, align: "left" }, encoding: { text: { field: "name" } } }], encoding: { x: { field: "x", type: "quantitative", title: "X" }, y: { field: "y", type: "quantitative", title: "Y" } } }, data: { rows: [{ name: "Alpha Centauri", x: 1, y: 1 }, { name: "Beta Pictoris", x: 1.02, y: 1.01 }] } })
    expect(find(issues, "LABEL_COLLISION")!.message).toContain("Alpha Centauri")
  })
  test("an axis format coarser than its ticks (7% 7% 8%)", async () => {
    const rows = Array.from({ length: 10 }, (_, i) => ({ u: 0.06 + i * 0.004, v: i }))
    expect(find(await issuesOf({ spec: { mark: "point", encoding: { x: { field: "u", type: "quantitative", axis: { format: ".0%" }, scale: { zero: false }, title: "U" }, y: { field: "v", type: "quantitative", title: "V" } } }, data: { rows } }), "DUPLICATE_TICKS")).toBeDefined()
  })
  test("a clean chart has no warnings", async () => {
    expect(await issuesOf({ spec: { ...BAR, encoding: { ...BAR.encoding, x: { ...BAR.encoding.x, sort: "-y" } } }, data: { rows: ROWS } })).toEqual([])
  })
})

describe("smart defaults", () => {
  test("currency and locale: compact euros, German separators", async () => {
    const r = await renderChart({ spec: { mark: "bar", encoding: { x: { field: "region", type: "nominal" }, y: { field: "revenue_eur", type: "quantitative" } } }, data: { rows: ROWS.map(r => ({ region: r.region, revenue_eur: r.revenue * 10_500 })) }, currency: "EUR", locale: "de-DE", formats: ["svg"] }, ws.env, false)
    expect(r.svg).toContain(">1M €</text>")
    expect(r.svg).toContain(">Revenue (€)</text>")
  })
  test("months in calendar order, dates in UTC", async () => {
    const r = await renderChart({ spec: { mark: "bar", encoding: { x: { field: "m", type: "ordinal" }, y: { field: "v", type: "quantitative", title: "V" } } }, data: { rows: [{ m: "March", v: 1 }, { m: "January", v: 2 }, { m: "February", v: 3 }] }, formats: ["svg"] }, ws.env, false)
    const order = [...r.svg.matchAll(/>(January|February|March)</g)].map(m => m[1])
    expect(order).toEqual(["January", "February", "March"])
  })
  test("long category labels are angled before they collide", async () => {
    const rows = ["Customer support tickets", "Billing disputes raised", "Delivery complaints", "Product questions", "Account access issues", "Refund requests"].map((k, v) => ({ k, v }))
    const r = await renderChart({ spec: { mark: "bar", width: 300, encoding: { x: { field: "k", type: "nominal" }, y: { field: "v", type: "quantitative", title: "Tickets" } } }, data: { rows }, formats: ["svg"] }, ws.env, false)
    expect(r.notes.join(" ")).toContain("Angled")
    expect(r.layout.overlaps).toEqual([])
  })
})
