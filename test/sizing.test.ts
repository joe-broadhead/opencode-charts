import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { closeVegaWorker } from "../src/engines/vega-pool.ts"
import { renderChart } from "../src/pipeline.ts"
import { runTool } from "../src/tools.ts"
import { BAR, ROWS, workspace } from "./helpers.ts"

/**
 * F2: a spec's own size keeps its legacy precedence over the tool's, and the caller is told when the two disagree.
 * The compiler's autosize "fit" warnings reach the result instead of being filtered out.
 */
const ws = workspace()
const env = { ...ws.env, assertFiles: async () => undefined }
afterAll(async () => { ws.cleanup(); await closeVegaWorker() })
// The Vega worker's cold start (a new thread, the engine and the fonts) is paid here, outside the comparisons below,
// so no assertion depends on how fast a runner starts a thread.
beforeAll(async () => { await renderChart({ spec: BAR, data: { rows: ROWS }, formats: ["svg"] }, env, false) }, 60_000)

type Warning = { code: string; path?: string; message: string; fix?: string }
const check = async (input: Record<string, unknown>) => (await runTool(env as never, "validate", { data: { rows: ROWS }, inspect: false, ...input })).output as { valid?: boolean; width: number; height: number; warnings: Warning[] }
const overrides = (warnings: Warning[]) => warnings.filter(w => w.code === "SIZE_OVERRIDE_IGNORED")

describe("legacy size precedence", () => {
  test("A02: spec width 500 with tool width 900 keeps the 500 geometry and names both values and /spec/width", async () => {
    const specOnly = await check({ spec: { ...BAR, width: 500 } })
    const both = await check({ spec: { ...BAR, width: 500 }, width: 900 })
    // The geometry is the spec's: exactly what the spec alone draws, not the tool's 900.
    expect({ width: both.width, height: both.height }).toEqual({ width: specOnly.width, height: specOnly.height })
    const toolOnly = await check({ spec: BAR, width: 900 })
    expect(toolOnly.width).toBeGreaterThan(both.width + 300)
    const [warning, ...rest] = overrides(both.warnings)
    expect(rest).toEqual([])
    expect(warning!.path).toBe("/spec/width")
    expect(warning!.message).toContain("900")
    expect(warning!.message).toContain("500")
    expect(warning!.message).toContain("/spec/width")
    expect(warning!.fix).toMatch(/remove width from the spec/)
    expect(warning!.fix).toMatch(/drop the tool's width/)
    expect(overrides(specOnly.warnings)).toEqual([])
  })

  test("A03: equal tool and spec sizes give no warning and the same geometry", async () => {
    const specOnly = await check({ spec: { ...BAR, width: 500, height: 280 } })
    const equal = await check({ spec: { ...BAR, width: 500, height: 280 }, width: 500, height: 280 })
    expect(overrides(equal.warnings)).toEqual([])
    expect({ width: equal.width, height: equal.height }).toEqual({ width: specOnly.width, height: specOnly.height })
  })

  test("height conflicts are reported on their own path", async () => {
    const both = await check({ spec: { ...BAR, height: 200 }, height: 400 })
    expect(overrides(both.warnings).map(w => w.path)).toEqual(["/spec/height"])
  })

  test("a step size is quoted as written, never turned into a pixel count", async () => {
    const stepped = await check({ spec: { ...BAR, width: { step: 30 } }, width: 900 })
    const [warning] = overrides(stepped.warnings)
    expect(warning!.message).toContain('{"step":30}')
    expect(warning!.message).toContain("not a pixel count")
    expect(warning!.message).not.toMatch(/drawn \d+ wide/)
  })

  test("a Vega signal size is reported as the signal, and keeps precedence", async () => {
    const VEGA = { $schema: "https://vega.github.io/schema/vega/v6.json", width: { signal: "360" }, height: 200, data: [{ name: "table" }], marks: [{ type: "rect", from: { data: "table" }, encode: { enter: { x: { value: 0 }, width: { value: 10 }, y: { value: 0 }, height: { value: 10 } } } }] }
    const result = await check({ spec: VEGA, width: 700 })
    const [warning] = overrides(result.warnings)
    expect(warning!.message).toContain('{"signal":"360"}')
    expect(warning!.path).toBe("/spec/width")
  })

  test("ECharts: a number in the option wins and is named; a non-number is dropped and the size drawn is said", async () => {
    const OPTION = { xAxis: { type: "category" }, yAxis: { type: "value", name: "€k" }, series: [{ type: "bar", encode: { x: "region", y: "revenue" } }] }
    const numeric = await check({ spec: { ...OPTION, width: 400 }, width: 600 })
    expect(numeric.width).toBe(400)
    expect(overrides(numeric.warnings).map(w => [w.path, w.message.includes("600") && w.message.includes("400")])).toEqual([["/spec/width", true]])
    const percent = await check({ spec: { ...OPTION, width: "100%" }, width: 600 })
    expect(percent.width).toBe(600)
    expect(overrides(percent.warnings)[0]!.message).toContain("tool's width 600")
    const equal = await check({ spec: { ...OPTION, width: 600 }, width: 600 })
    expect(overrides(equal.warnings)).toEqual([])
  })

  test("the warning reaches charts_render's result too, with the files written at the spec's size", async () => {
    const { output } = await runTool(env as never, "render", { spec: { ...BAR, width: 500 }, data: { rows: ROWS }, width: 900, name: "conflict", formats: ["svg"], inspect: false })
    expect(((output as { warnings: Warning[] }).warnings).map(w => w.code)).toContain("SIZE_OVERRIDE_IGNORED")
  })
})

describe("the compiler's fit warnings", () => {
  test('autosize "fit" on a facet is reported, with a fix, not filtered out', async () => {
    const spec = { facet: { field: "region", type: "nominal" }, autosize: { type: "fit" }, spec: { mark: "bar", encoding: { x: { field: "region", type: "nominal" }, y: { field: "revenue", type: "quantitative", title: "Revenue (€k)" } } } }
    const r = await renderChart({ spec, data: { rows: ROWS }, formats: ["svg"] }, ws.env, false)
    const fit = r.issues.filter(i => i.code === "VEGA_LITE_WARNING" && /fit/i.test(i.message))
    expect(fit.length).toBeGreaterThan(0)
    expect(fit[0]!.fix).toMatch(/numeric width and height/)
  })

  test('autosize "fit" with a discrete (step) width is reported', async () => {
    const r = await renderChart({ spec: { ...BAR, width: { step: 40 }, autosize: { type: "fit" } }, data: { rows: ROWS }, formats: ["svg"] }, ws.env, false)
    expect(r.issues.filter(i => i.code === "VEGA_LITE_WARNING").map(i => i.message)).toEqual(['Dropping "fit-x" because spec has discrete width.'])
  })

  test("an explicit valid size with fit gives no fit warning", async () => {
    const spec = { mark: "line", encoding: { x: { field: "x", type: "quantitative", title: "X (s)" }, y: { field: "y", type: "quantitative", title: "Y (m)" } }, width: 400, height: 240, autosize: { type: "fit", contains: "padding" } }
    const r = await renderChart({ spec, data: { rows: [{ x: 1, y: 2 }, { x: 2, y: 3 }] }, formats: ["svg"] }, ws.env, false)
    expect(r.issues.filter(i => /fit/i.test(i.message))).toEqual([])
  })
})
