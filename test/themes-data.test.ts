import { afterAll, describe, expect, test } from "bun:test"
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { parquetWriteBuffer } from "hyparquet-writer"
import { loadData } from "../src/data.ts"
import { closeVegaWorker } from "../src/engines/vega-pool.ts"
import { renderChart } from "../src/pipeline.ts"
import { themeContrastIssues } from "../src/themes/contrast.ts"
import { builtinThemes, resolveTheme, saveTheme } from "../src/themes/store.ts"
import { ThemeTokensSchema } from "../src/themes/tokens.ts"
import { BAR, ROOT, ROWS, workspace } from "./helpers.ts"

const ws = workspace()
afterAll(async () => { ws.cleanup(); await closeVegaWorker() })
const sources = { workspace: ws.env.workspace, packageRoot: ROOT, configured: { "from-config": { extends: "dark", colors: { highlight: "#FF00FF" } } } }

describe("themes", () => {
  const all = builtinThemes(ROOT)
  test("seven built-ins, each complete and passing its own contrast checks", () => {
    expect(Object.keys(all).sort()).toEqual(["dark", "high-contrast", "light", "presentation", "print", "toqan", "toqan-night"])
    for (const theme of Object.values(all)) {
      expect(ThemeTokensSchema.safeParse(theme).success).toBe(true)
      expect(themeContrastIssues(theme)).toEqual([])
    }
  })
  test("toqan comes from Toqan's token file: ochre chart ground, blue series 1 and 2, Geist, no weight over 500", () => {
    const tokens = JSON.parse(readFileSync(join(ROOT, "assets/brand/toqan-tokens.json"), "utf8"))
    const t = all.toqan!, n = all["toqan-night"]!
    expect(t.colors.background).toBe(tokens.primitives.ochre["200"].$value)
    expect(t.colors.categorical.slice(0, 1)).toEqual([tokens.primitives.blue["700"].$value])
    expect(t.colors.categorical).toContain(tokens.primitives.blue["500"].$value)
    expect(t.colors.categorical).toContain(tokens.primitives.coral["500"].$value)
    expect(t.colors.text).toBe(tokens.primitives.neutral.wordmark.$value)
    expect(n.colors.background).toBe(tokens.primitives.neutral.night.$value)
    expect(n.colors.text).toBe(tokens.primitives.neutral.paper.$value)
    for (const theme of [t, n]) { expect(theme.font.family).toBe("Geist"); expect(theme.font.titleWeight).toBeLessThanOrEqual(500) }
  })
  test("a Toqan chart uses only Toqan colours and Geist", async () => {
    const r = await renderChart({ spec: BAR, data: { rows: ROWS }, theme: "toqan", formats: ["svg"] }, ws.env, false)
    expect(r.svg).toContain('font-family="Geist, sans-serif"')
    expect(r.svg).toContain('fill="#EDD1AA"')
    expect(r.svg).not.toMatch(/linearGradient|radialGradient|filter=/)
  })
  test("custom tokens over a base, a saved brand theme by name, and a theme from the plugin's options", async () => {
    const custom = resolveTheme(sources, { extends: "light", colors: { categorical: ["#112233", "#445566"] } })
    expect(custom.colors.categorical).toEqual(["#112233", "#445566"])
    expect(custom.colors.background).toBe("#FFFFFF")
    const saved = saveTheme(sources, "acme", { extends: "toqan", colors: { highlight: "#C20000" } })
    expect(saved.file).toBe(".charts/themes/acme.json")
    expect(resolveTheme(sources, "acme").font.family).toBe("Geist")
    expect(resolveTheme(sources, "from-config").colors.highlight).toBe("#FF00FF")
    const r = await renderChart({ spec: BAR, data: { rows: ROWS }, theme: "acme", formats: ["svg"] }, ws.env, false)
    expect(r.theme).toBe("acme")
  })
  test("teaches: an unknown theme names the closest; bad tokens name the token; low contrast is a warning", async () => {
    expect(() => resolveTheme(sources, "toqan-nite")).toThrow(/Did you mean "toqan-night"/)
    expect(() => resolveTheme(sources, { colors: { background: "beige" } })).toThrow(/\/theme\/colors\/background/)
    const r = await renderChart({ spec: BAR, data: { rows: ROWS }, theme: { colors: { text: "#EEEEEE" } }, formats: ["svg"] }, ws.env, false)
    expect(r.issues.find(i => i.code === "LOW_CONTRAST")?.message).toContain("#EEEEEE")
  })
  test("theme colour tokens in a spec follow the theme", async () => {
    const spec = { mark: { type: "bar", color: "theme:negative" }, encoding: BAR.encoding }
    const light = await renderChart({ spec, data: { rows: ROWS }, formats: ["svg"] }, ws.env, false)
    const toqan = await renderChart({ spec, data: { rows: ROWS }, theme: "toqan", formats: ["svg"] }, ws.env, false)
    expect(light.svg).toContain(builtinThemes(ROOT).light!.colors.negative)
    expect(toqan.svg).toContain(builtinThemes(ROOT).toqan!.colors.negative)
  })
})

describe("data in", () => {
  mkdirSync(join(ws.dir, "data"), { recursive: true })
  writeFileSync(join(ws.dir, "data/sales.csv"), "﻿region,revenue,when\nNorth,120,2024-01-01\nSouth,80,2024-02-01\n")
  writeFileSync(join(ws.dir, "data/sales.tsv"), "region\trevenue\nNorth\t120\nSouth\t80\n")
  writeFileSync(join(ws.dir, "data/sales.json"), JSON.stringify({ rows: [{ region: "North", revenue: 120 }] }))
  writeFileSync(join(ws.dir, "data/sales.jsonl"), '{"region":"North","revenue":120}\n{"region":"South","revenue":80}\n')
  writeFileSync(join(ws.dir, "data/sales.parquet"), new Uint8Array(parquetWriteBuffer({ columnData: [{ name: "region", data: ["North", "South"], type: "STRING" }, { name: "revenue", data: [120, 80], type: "INT32" }] })))
  test("CSV (with a BOM), TSV, JSON, JSONL and Parquet, typed", async () => {
    const csv = await loadData(ws.env.workspace, { path: "data/sales.csv" })
    expect(csv.rows[0]).toEqual({ region: "North", revenue: 120, when: "2024-01-01" })
    expect((await loadData(ws.env.workspace, { path: "data/sales.tsv" })).rows[1]).toEqual({ region: "South", revenue: 80 })
    expect((await loadData(ws.env.workspace, { path: "data/sales.json" })).rows).toHaveLength(1)
    expect((await loadData(ws.env.workspace, { path: "data/sales.jsonl" })).rows).toHaveLength(2)
    expect((await loadData(ws.env.workspace, { path: "data/sales.parquet" })).rows).toEqual([{ region: "North", revenue: 120 }, { region: "South", revenue: 80 }])
  })
  test("a transform pipeline (filter, aggregate, window) so the agent need not reshape by hand", async () => {
    const rows = [...ROWS, { region: "North", revenue: 30 }]
    const out = await loadData(ws.env.workspace, { rows, transform: [{ filter: "datum.revenue > 35" }, { aggregate: [{ op: "sum", field: "revenue", as: "total" }], groupby: ["region"] }, { window: [{ op: "rank", as: "rank" }], sort: [{ field: "total", order: "descending" }] }] })
    expect(out.rows.find(r => r.region === "North")).toEqual({ region: "North", total: 120, rank: 1 })
  })
  test("a chart straight from a workspace file", async () => {
    const r = await renderChart({ spec: BAR, data: { path: "data/sales.parquet" }, formats: ["svg"] }, ws.env, false)
    expect(r.summary).toContain("data/sales.parquet (2 rows)")
  })
})
