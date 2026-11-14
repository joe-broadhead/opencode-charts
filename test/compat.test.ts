import { afterAll, describe, expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { closeVegaWorker } from "../src/engines/vega-pool.ts"
import { runTool, type ToolName } from "../src/tools.ts"
import { BAR, portable, ROOT, ROWS, workspace } from "./helpers.ts"

/**
 * Compatibility fixtures: representative legacy calls through the public tool path (`runTool`, the function the
 * plugin and the tools RPC both call), with what each returns recorded in `test/compat/legacy-calls.json`. The
 * record was written from the code before the reliability work and changes only with `UPDATE_GOLDEN=1` and a reviewed
 * diff: geometry, engine, theme, files and the drawing itself (a hash of the portable SVG) must not drift; a new
 * warning is a deliberate, documented change.
 */
const sha = (text: string) => createHash("sha256").update(text).digest("hex").slice(0, 16)

const ws = workspace()
const env = { ...ws.env, assertFiles: async () => undefined }
afterAll(async () => { ws.cleanup(); await closeVegaWorker() })

const VEGA = { $schema: "https://vega.github.io/schema/vega/v6.json", data: [{ name: "table" }], scales: [{ name: "x", type: "band", domain: { data: "table", field: "region" }, range: "width", padding: 0.2 }, { name: "y", type: "linear", domain: { data: "table", field: "revenue" }, range: "height", nice: true }], axes: [{ orient: "bottom", scale: "x" }, { orient: "left", scale: "y", title: "Revenue (€k)" }], marks: [{ type: "rect", from: { data: "table" }, encode: { enter: { x: { scale: "x", field: "region" }, width: { scale: "x", band: 1 }, y: { scale: "y", field: "revenue" }, y2: { scale: "y", value: 0 } } } }] }
const ECHARTS = { xAxis: { type: "category" }, yAxis: { type: "value", name: "€k" }, series: [{ type: "bar", encode: { x: "region", y: "revenue" } }] }
const data = { rows: ROWS }

/** The calls: each a tool and its input exactly as a caller sends it. */
const LEGACY_CALLS: readonly { readonly id: string; readonly tool: ToolName; readonly input: Record<string, unknown> }[] = [
  { id: "quick-bar", tool: "quick", input: { type: "bar", data, x: "region", y: "revenue", yTitle: "Revenue (€k)", title: "Quick bar", formats: ["svg", "spec"] } },
  { id: "quick-bar-sized", tool: "quick", input: { type: "bar", data, x: "region", y: "revenue", yTitle: "Revenue (€k)", title: "Quick bar sized", width: 480, height: 300, formats: ["svg", "spec"] } },
  { id: "vl-unsized", tool: "render", input: { spec: BAR, data, title: "VL unsized", formats: ["svg", "spec"] } },
  { id: "vl-tool-sized", tool: "render", input: { spec: BAR, data, title: "VL tool sized", width: 520, height: 320, formats: ["svg", "spec"] } },
  { id: "vl-spec-sized", tool: "render", input: { spec: { ...BAR, width: 500, height: 280 }, data, title: "VL spec sized", formats: ["svg", "spec"] } },
  { id: "vl-equal-sizes", tool: "render", input: { spec: { ...BAR, width: 500, height: 280 }, data, title: "VL equal sizes", width: 500, height: 280, formats: ["svg", "spec"] } },
  { id: "vl-conflicting-sizes", tool: "render", input: { spec: { ...BAR, width: 500 }, data, title: "VL conflicting sizes", width: 900, formats: ["svg", "spec"] } },
  { id: "vega-unsized", tool: "render", input: { spec: VEGA, data, title: "Vega unsized", formats: ["svg", "spec"] } },
  { id: "vega-tool-sized", tool: "render", input: { spec: VEGA, data, title: "Vega tool sized", width: 420, height: 260, formats: ["svg", "spec"] } },
  { id: "echarts-unsized", tool: "render", input: { spec: ECHARTS, data, title: "ECharts unsized", formats: ["svg", "spec"] } },
  { id: "echarts-tool-sized", tool: "render", input: { spec: ECHARTS, data, title: "ECharts tool sized", width: 480, height: 300, formats: ["svg", "spec"] } },
  { id: "echarts-conflicting-sizes", tool: "render", input: { spec: { ...ECHARTS, width: 400 }, data, title: "ECharts conflicting sizes", width: 600, formats: ["svg", "spec"] } },
  { id: "validate-vl", tool: "validate", input: { spec: BAR, data, width: 520, inspect: false } },
]

interface Record_ { engine: unknown; theme: unknown; width: unknown; height: unknown; files: unknown; warnings: string[]; svg: string }

async function observe(call: (typeof LEGACY_CALLS)[number]): Promise<Record_> {
  const { output } = await runTool(env as never, call.tool, call.input)
  const o = output as Record<string, any>
  const files = o.files as { svg?: string }
  const svg = files.svg ? readFileSync(join(ws.dir, files.svg), "utf8") : ""
  return { engine: o.engine, theme: o.theme, width: o.width, height: o.height, files: o.files, warnings: (o.warnings as { code: string }[]).map(w => w.code), svg: svg ? sha(portable(svg)) : "" }
}

const FILE = join(ROOT, "test", "compat", "legacy-calls.json")

describe("legacy calls keep their behaviour", () => {
  test("every recorded call returns the recorded geometry, files, warnings and drawing", async () => {
    const seen: Record<string, Record_> = {}
    for (const call of LEGACY_CALLS) seen[call.id] = await observe(call)
    if (process.env.UPDATE_GOLDEN || !existsSync(FILE)) {
      mkdirSync(join(ROOT, "test", "compat"), { recursive: true })
      writeFileSync(FILE, JSON.stringify(seen, null, 1) + "\n")
    }
    const recorded = JSON.parse(readFileSync(FILE, "utf8")) as Record<string, Record_>
    expect(Object.keys(seen)).toEqual(Object.keys(recorded))
    for (const id of Object.keys(recorded)) expect({ id, ...seen[id] }).toEqual({ id, ...recorded[id]! })
  }, 120_000)
})
