import { afterAll, describe, expect, test } from "bun:test"
import { readdirSync } from "node:fs"
import { closeVegaWorker } from "../src/engines/vega-pool.ts"
import { ChartsError } from "../src/errors.ts"
import { runTool, type ToolName } from "../src/tools.ts"
import { workspace } from "./helpers.ts"

/**
 * A08, empty data, through the public tools: a recipe document whose rows are empty (inline, or after its
 * data.transform) is refused with DATA_EMPTY at its data, before anything is written, and charts_validate reports it
 * as valid: false. No sample rows are drawn in its place, and the compiled spec's field paths are not blamed.
 */

const spaces: { cleanup: () => void }[] = []
afterAll(async () => { for (const s of spaces) s.cleanup(); await closeVegaWorker() })

function setup() {
  const ws = workspace()
  spaces.push(ws)
  const env = { ...ws.env, assertFiles: async () => {} }
  const call = async (tool: ToolName, input: Record<string, unknown>) => (await runTool(env as never, tool, input)).output as Record<string, any>
  const refusal = async (tool: ToolName, input: Record<string, unknown>) => {
    const outcome: unknown = await runTool(env as never, tool, input).catch((error: unknown) => error)
    if (outcome instanceof ChartsError) return outcome
    throw outcome instanceof Error ? outcome : new Error("expected a refusal")
  }
  return { call, refusal, files: () => readdirSync(ws.dir, { recursive: true }) }
}

const doc = (data: Record<string, unknown>) => ({ version: 1, chart: { kind: "recipe", recipe: "bar", data, bindings: { category: "c", value: "v" } } })

describe("an empty recipe document (A08)", () => {
  test("inline rows: [] is DATA_EMPTY at /document/chart/data; validate says valid: false; nothing is written", async () => {
    const t = setup()
    const checked = await t.call("validate", { document: doc({ rows: [] }), inspect: false })
    expect(checked.valid).toBe(false)
    expect(checked.issues).toEqual([expect.objectContaining({ code: "DATA_EMPTY", path: "/document/chart/data" })])
    const refused = await t.refusal("quick", { document: doc({ rows: [] }) })
    expect(refused.code).toBe("DATA_EMPTY")
    expect(refused.path).toBe("/document/chart/data")
    expect(t.files()).toEqual([])
  })

  test("rows a transform filters away are empty too, through charts_render", async () => {
    const t = setup()
    const refused = await t.refusal("render", { document: doc({ rows: [{ c: "a", v: 1 }], transform: [{ filter: "datum.v > 10" }] }) })
    expect(refused.code).toBe("DATA_EMPTY")
    expect(t.files()).toEqual([])
  }, 60_000)
})
