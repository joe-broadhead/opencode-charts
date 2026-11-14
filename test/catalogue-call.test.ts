import { afterAll, describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { CATALOGUE } from "../src/catalogue.ts"
import { closeVegaWorker } from "../src/engines/vega-pool.ts"
import { runTool } from "../src/tools.ts"
import { portable, ROOT, workspace } from "./helpers.ts"

/**
 * A01: the call `charts_catalogue` returns for an entry is the exact tested call. It carries the example's data,
 * title, currency, locale and size, it validates with no warning, and through `charts_render` it draws the entry's
 * golden SVG. Every entry goes through the public tool path.
 */
const ws = workspace()
const env = { ...ws.env, assertFiles: async () => undefined }
afterAll(async () => { ws.cleanup(); await closeVegaWorker() })

const catalogueCall = async (id: string) => {
  const { output, content } = await runTool(env as never, "catalogue", { id })
  return { call: (output as { example: Record<string, unknown> }).example, text: (content[0] as { text: string }).text }
}

describe("the catalogue's example call", () => {
  test("keeps the calendar heatmap at 820 × 220, in the output, the text and the drawing", async () => {
    const { call, text } = await catalogueCall("calendar_heatmap")
    expect({ width: call.width, height: call.height }).toEqual({ width: 820, height: 220 })
    expect(text).toContain('"width":820,"height":220')
    const { output } = await runTool(env as never, "render", { ...call, name: "calendar-check", formats: ["svg"], inspect: false })
    expect({ width: (output as Record<string, unknown>).width, height: (output as Record<string, unknown>).height }).toEqual({ width: 820, height: 220 })
    const svg = readFileSync(join(ws.dir, (output as { files: { svg: string } }).files.svg), "utf8")
    expect(svg).toMatch(/^<svg[^>]*\swidth="820"[^>]*\sheight="220"/)
  })

  for (const entry of CATALOGUE) test(`${entry.id}: carries the example's metadata, validates and draws its golden`, async () => {
    const ex = entry.example()
    const { call } = await catalogueCall(entry.id)
    // The metadata, field by field, against the example itself.
    expect({ title: call.title, currency: call.currency, locale: call.locale, width: call.width, height: call.height, rows: (call.data as { rows?: unknown[] } | undefined)?.rows?.length })
      .toEqual({ title: ex.title, currency: ex.currency, locale: ex.locale, width: ex.width, height: ex.height, rows: ex.rows?.length })
    expect(call.spec).toEqual(ex.spec)

    const checked = (await runTool(env as never, "validate", { ...call, inspect: false })).output as Record<string, unknown>
    expect({ valid: checked.valid, warnings: checked.warnings }).toEqual({ valid: true, warnings: [] })

    const { output } = await runTool(env as never, "render", { ...call, name: `a01-${entry.id}`, formats: ["svg"], inspect: false })
    const drawn = readFileSync(join(ws.dir, (output as { files: { svg: string } }).files.svg), "utf8")
    const golden = readFileSync(join(ROOT, "test", "golden", `${entry.id}.svg`), "utf8")
    if (drawn !== golden) expect(portable(drawn)).toBe(portable(golden))
  }, 60_000)
})
