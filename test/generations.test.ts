import { afterAll, describe, expect, setDefaultTimeout, test } from "bun:test"
import { readdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { closeVegaWorker } from "../src/engines/vega-pool.ts"
import { ChartsError } from "../src/errors.ts"
import { runTool, type ToolName } from "../src/tools.ts"
import { BAR, ROWS, workspace } from "./helpers.ts"

/**
 * Complete-generation publication for every new document's output (brief §10.3, F9): charts_quick and charts_render
 * with `document` or `documentPath` write one immutable generation folder, `<outDir>/<name>-<digest>/`, as
 * charts_update does, with the same reuse, collision and clean-up rules. A legacy spec call stays flat, even when it
 * asks for document output.
 */
setDefaultTimeout(60_000)
const spaces: { cleanup: () => void }[] = []
afterAll(async () => { for (const s of spaces) s.cleanup(); await closeVegaWorker() })

type Step = "svg" | "png" | "html" | "spec" | "document" | "preview" | "commit"
function setup() {
  const ws = workspace()
  spaces.push(ws)
  let probe: ((step: Step, file?: string) => void) | undefined
  const env = { ...ws.env, assertFiles: async () => undefined, probe: (step: Step, file?: string) => probe?.(step, file) }
  const call = async (tool: ToolName, input: Record<string, unknown>) => (await runTool(env as never, tool, input)).output as Record<string, any>
  const refusal = async (tool: ToolName, input: Record<string, unknown>) => {
    const outcome: unknown = await runTool(env as never, tool, input).catch((error: unknown) => error)
    if (outcome instanceof ChartsError) return outcome
    throw outcome instanceof Error ? outcome : new Error("expected a refusal")
  }
  const tree = (): Record<string, string> => {
    const out: Record<string, string> = {}
    const walk = (at: string, rel: string) => { for (const e of readdirSync(at, { withFileTypes: true })) { const r = rel ? `${rel}/${e.name}` : e.name; if (e.isSymbolicLink()) out[r] = "link"; else if (e.isDirectory()) { out[`${r}/`] = ""; walk(join(at, e.name), r) } else out[r] = readFileSync(join(at, e.name)).toString("base64") } }
    walk(ws.dir, "")
    return out
  }
  return { dir: ws.dir, env, call, refusal, tree, setProbe: (p: typeof probe) => { probe = p } }
}

const DOC = { version: 1, chart: { kind: "recipe", recipe: "bar", data: { rows: ROWS }, bindings: { category: "region", value: "revenue" } }, title: "Revenue by region" }
const GENERATION = /^outputs\/charts\/([a-z0-9-]+)-[0-9a-f]{16}$/

describe("a new document's output is one generation folder", () => {
  test("charts_quick and charts_render with document, and charts_render with documentPath, publish generations", async () => {
    const t = setup()
    const quick = await t.call("quick", { document: DOC, name: "bars" })
    expect(quick.generation.directory).toMatch(GENERATION)
    expect(Object.values({ ...quick.files, png: quick.files.png[0] }).every(f => String(f).startsWith(`${quick.generation.directory}/bars.`))).toBe(true)
    const render = await t.call("render", { document: { ...DOC, chart: { kind: "engine", spec: BAR, data: { rows: ROWS } } }, name: "engine" })
    expect(render.generation.directory).toMatch(/^outputs\/charts\/engine-[0-9a-f]{16}$/)
    const replay = await t.call("render", { documentPath: quick.files.document, expectedRevision: quick.revision, name: "replay" })
    expect(replay.generation.directory).toMatch(/^outputs\/charts\/replay-[0-9a-f]{16}$/)
    // Nothing is written flat beside the folders.
    expect(Object.keys(t.tree()).filter(p => /^outputs\/charts\/[^/]+$/.test(p))).toEqual([])
  })

  test("the same document again reuses its verified generation; nothing is rewritten", async () => {
    const t = setup()
    const first = await t.call("quick", { document: DOC, name: "bars" })
    expect(first.generation.reused).toBe(false)
    const listing = t.tree()
    const again = await t.call("quick", { document: DOC, name: "bars" })
    expect(again.generation).toEqual({ ...first.generation, reused: true })
    expect(t.tree()).toEqual(listing)
    // Replaying the saved artifact under the same name draws the same bytes into the same folder.
    expect((await t.call("render", { documentPath: first.files.document, name: "bars" })).generation).toEqual({ ...first.generation, reused: true })
  })

  test("a folder of that name with other content is refused, and a failed publication leaves no folder or staging", async () => {
    const t = setup()
    const first = await t.call("quick", { document: DOC, name: "bars", formats: ["svg", "document"] })
    writeFileSync(join(t.dir, first.files.svg), "<svg>not this chart</svg>")
    const listing = t.tree()
    const collision = await t.refusal("quick", { document: DOC, name: "bars", formats: ["svg", "document"] })
    expect(collision.code).toBe("OUTPUT_WRITE_FAILED")
    expect(collision.detail).toContain("does not hold this chart's files")
    expect(t.tree()).toEqual(listing)
    t.setProbe((step, file) => { if (step === "commit" && file === "other.chart.json") throw new Error("disk full") })
    const failed = await t.refusal("render", { document: DOC, name: "other", formats: ["svg", "document"] })
    expect(failed.detail).toContain("no generation was published")
    expect(t.tree()).toEqual(listing)
  })

  test("a legacy spec call stays flat, also when it asks for document output", async () => {
    const t = setup()
    const legacy = await t.call("render", { spec: BAR, data: { rows: ROWS }, name: "legacy", formats: ["svg", "document"] })
    expect(legacy.files).toEqual({ svg: "outputs/charts/legacy.svg", png: [], document: "outputs/charts/legacy.chart.json" })
    expect(legacy.generation).toBeUndefined()
    const quick = await t.call("quick", { type: "bar", data: { rows: ROWS }, x: "region", y: "revenue", name: "legacy-quick", formats: ["svg", "document"] })
    expect(quick.files.document).toBe("outputs/charts/legacy-quick.chart.json")
    const plain = await t.call("render", { spec: BAR, data: { rows: ROWS }, name: "plain", formats: ["svg"] })
    expect(plain.files.svg).toBe("outputs/charts/plain.svg")
  })
})
