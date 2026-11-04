import { afterAll, describe, expect, test } from "bun:test"
import { mkdirSync, symlinkSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { closeVegaWorker } from "../src/engines/vega-pool.ts"
import { renderChart } from "../src/pipeline.ts"
import { BAR, ROWS, workspace } from "./helpers.ts"

const ws = workspace()
afterAll(async () => { ws.cleanup(); await closeVegaWorker() })
const refused = async (request: Parameters<typeof renderChart>[0], code: RegExp) => {
  let message = ""
  try { await renderChart(request, ws.env) } catch (error) { message = (error as Error).message }
  expect(message).toMatch(code)
  return message
}

describe("spec safety refuses", () => {
  test("a URL data source, naming the path and the fix", async () => {
    const message = await refused({ spec: { data: { url: "https://example.com/data.csv" }, mark: "bar" } }, /^SPEC_UNSAFE/)
    expect(message).toContain("/data/url")
    expect(message).toContain("data.rows")
  })
  test("a URL hidden in a nested layer, and an href channel", async () => {
    await refused({ spec: { layer: [{ data: { url: "//cdn.example.com/x.json" }, mark: "point" }] } }, /SPEC_UNSAFE.*\/layer\/0\/data\/url/)
    await refused({ spec: { ...BAR, encoding: { ...BAR.encoding, href: { field: "region" } } }, data: { rows: ROWS } }, /SPEC_UNSAFE.*href/)
  })
  test("image marks, in Vega-Lite and Vega", async () => {
    await refused({ spec: { mark: "image", encoding: {} }, data: { rows: ROWS } }, /SPEC_UNSAFE: Image marks/)
    await refused({ spec: { marks: [{ type: "image", encode: { enter: { url: { value: "x.png" } } } }] } }, /SPEC_UNSAFE/)
  })
  test("ECharts images, custom series and geo maps", async () => {
    await refused({ spec: { series: [{ type: "scatter", symbol: "image://https://x/y.png", data: [[1, 2]] }], xAxis: {}, yAxis: {} } }, /SPEC_UNSAFE.*external reference/)
    await refused({ spec: { series: [{ type: "custom" }] } }, /SPEC_UNSAFE.*custom/)
    await refused({ spec: { series: [{ type: "map", map: "world" }] } }, /SPEC_UNSAFE.*geoshape/)
  })
  test("data paths outside the workspace: ../, absolute, ~ and a symbolic link out", async () => {
    await refused({ spec: BAR, data: { path: "../secrets.csv" } }, /^PATH_OUTSIDE_WORKSPACE/)
    await refused({ spec: BAR, data: { path: "/etc/hosts" } }, /^PATH_OUTSIDE_WORKSPACE/)
    await refused({ spec: BAR, data: { path: "~/x.csv" } }, /^PATH_OUTSIDE_WORKSPACE/)
    await refused({ spec: BAR, data: { path: "https://example.com/x.csv" } }, /^PATH_IS_URL/)
    mkdirSync(join(ws.dir, "data"), { recursive: true })
    symlinkSync("/etc", join(ws.dir, "data", "escape"))
    await refused({ spec: BAR, data: { path: "data/escape/hosts" } }, /^PATH_OUTSIDE_WORKSPACE/)
  })
  test("an output folder outside the workspace", async () => {
    await refused({ spec: BAR, data: { rows: ROWS }, outDir: "../../tmp" }, /^PATH_OUTSIDE_WORKSPACE/)
  })
  test("an oversized spec, and too many rows", async () => {
    const big = { ...BAR, data: { values: Array.from({ length: 30_000 }, (_, i) => ({ region: `r${i}`, revenue: i, note: "x".repeat(10) })) } }
    await refused({ spec: big }, /^SPEC_TOO_LARGE|^SPEC_UNSAFE: The spec has more than/)
    await refused({ spec: BAR, data: { rows: Array.from({ length: 100_001 }, () => ({ region: "a", revenue: 1 })) } }, /^DATA_TOO_LARGE/)
  })
  test("long expressions", async () => {
    await refused({ spec: { ...BAR, transform: [{ calculate: "1+".repeat(600) + "1", as: "x" }] }, data: { rows: ROWS } }, /SPEC_UNSAFE.*expression is \d+ characters/)
  })
  test("generators that would explode: a huge sequence, a cross join", async () => {
    await refused({ spec: { marks: [{ type: "symbol", from: { data: "seq" } }], data: [{ name: "seq", transform: [{ type: "sequence", start: 0, stop: 1e9 }] }] } }, /^SPEC_TOO_EXPENSIVE: A sequence transform would make/)
    await refused({ spec: { marks: [{ type: "symbol", from: { data: "a" } }], data: [{ name: "a", values: [{ x: 1 }], transform: [{ type: "cross" }] }] } }, /^SPEC_TOO_EXPENSIVE: Cross/)
  })
  test("a render that runs away is stopped by the worker's time limit, and the next render still works", async () => {
    process.env.CHARTS_RENDER_TIMEOUT_MS = "1500"
    // impute fills a key × group grid: 2,500 keys × 2,500 groups is 6.25 million rows.
    const rows = Array.from({ length: 5000 }, (_, i) => ({ k: i % 2500, g: `g${(i * 7) % 2500}`, v: i }))
    const spec = { mark: "line", transform: [{ impute: "v", key: "k", groupby: ["g"], value: 0 }], encoding: { x: { field: "k", type: "quantitative" }, y: { field: "v", type: "quantitative" }, color: { field: "g", type: "nominal", legend: null } } }
    const { renderChart: render } = await import("../src/pipeline.ts")
    let message = ""
    try { await render({ spec, data: { rows }, formats: ["svg"] }, ws.env) } catch (error) { message = (error as Error).message }
    expect(message).toMatch(/^SPEC_TOO_EXPENSIVE/)
    const ok = await render({ spec: BAR, data: { rows: ROWS }, formats: ["svg"] }, ws.env)
    expect(ok.svg).toContain("<svg")
  }, 30_000)
})

describe("rendered output", () => {
  test("contains no external reference, script or image", async () => {
    const r = await renderChart({ spec: BAR, data: { rows: ROWS }, formats: ["svg"] }, ws.env)
    expect(r.svg).not.toMatch(/<(image|script|foreignObject)\b/)
    expect(r.svg).not.toMatch(/href="(?!#)/)
  })
  test("strings that look like URLs inside data rows are data, not references", async () => {
    const r = await renderChart({ spec: { mark: "bar", encoding: { x: { field: "site", type: "nominal" }, y: { field: "visits", type: "quantitative", title: "Visits" } } }, data: { rows: [{ site: "https://a.example", visits: 3 }, { site: "https://b.example", visits: 5 }] }, formats: ["svg"] }, ws.env)
    expect(r.svg).toContain("https://a.example")
    writeFileSync(join(ws.dir, "ok.txt"), "")
  })
})
