// ECharts' module table and the components it does not bundle: which modules each runtime registers, and that an
// option using an unbundled component is refused with a next step (A20).
import { afterAll, describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { echartsModules } from "../src/engines/echarts-install.ts"
import { closeVegaWorker } from "../src/engines/vega-pool.ts"
import { ECHARTS_MODULES, ECHARTS_SERIES_TYPES, ECHARTS_UNBUNDLED } from "../src/runtime-support.ts"
import { runTool, type ToolEnvironment } from "../src/tools.ts"
import { ROOT, workspace } from "./helpers.ts"

const ws = workspace()
afterAll(async () => { ws.cleanup(); await closeVegaWorker() })
const env: ToolEnvironment = { ...ws.env, assertFiles: async () => undefined }
const BAR_OPTION = { xAxis: { type: "category", data: ["a", "b"] }, yAxis: { type: "value" }, series: [{ type: "bar", data: [1, 2] }] }

describe("ECharts modules: one table for both runtimes", () => {
  test("the server registers every module but the tooltip; the browser registers all of them", () => {
    expect(echartsModules("browser")).toHaveLength(ECHARTS_MODULES.length)
    expect(echartsModules("server")).toHaveLength(ECHARTS_MODULES.length - 1)
    expect(ECHARTS_MODULES.filter(m => !m.server).map(m => m.name)).toEqual(["TooltipComponent"])
    expect(new Set(echartsModules("browser")).size).toBe(ECHARTS_MODULES.length)
  })
  test("the series types the safety check accepts are the chart modules' series", () => {
    expect([...ECHARTS_SERIES_TYPES].sort()).toEqual(["bar", "boxplot", "candlestick", "chord", "effectScatter", "funnel", "gauge", "graph", "heatmap", "line", "parallel", "pictorialBar", "pie", "radar", "sankey", "scatter", "sunburst", "themeRiver", "tree", "treemap"])
  })
  test("no unbundled component is also a module's option", () => {
    const read = new Set<string>(ECHARTS_MODULES.flatMap(m => ("options" in m ? [...m.options] : [])))
    for (const key of Object.keys(ECHARTS_UNBUNDLED)) expect(read.has(key)).toBe(false)
  })
  test("the browser runtime is built from the table's entry file", () => {
    expect(readFileSync(join(ROOT, "scripts", "build.mjs"), "utf8")).toContain("src/browser/${name}.ts")
    expect(readFileSync(join(ROOT, "src", "browser", "echarts.ts"), "utf8")).toContain('echartsModules("browser")')
  })
})

describe("unsupported ECharts components are refused (A20)", () => {
  for (const key of ["dataZoom", "brush", "toolbox", "timeline"]) test(`${key}: validate says why and what to do; render writes nothing`, async () => {
    const option = { ...BAR_OPTION, [key]: key === "dataZoom" ? [{ type: "inside" }] : {} }
    const checked = await runTool(env, "validate", { spec: option })
    expect(checked.output.valid).toBe(false)
    const issues = checked.output.issues as unknown as Record<string, unknown>[]
    expect(issues).toContainEqual({ level: "error", code: "ECHARTS_COMPONENT_UNSUPPORTED", message: expect.stringContaining(key), path: `/${key}`, fix: ECHARTS_UNBUNDLED[key]! })
    await expect(runTool(env, "render", { spec: option, name: `refused-${key}` })).rejects.toThrow(/SPEC_INVALID[\s\S]*ECHARTS_COMPONENT_UNSUPPORTED at \/[a-zA-Z]+/)
  })
})
