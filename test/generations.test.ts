import { afterAll, describe, expect, setDefaultTimeout, test } from "bun:test"
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { bundleManifest, GENERATION_DIGEST_CHARS } from "../src/artifacts.ts"
import { closeVegaWorker } from "../src/engines/vega-pool.ts"
import { ChartsError } from "../src/errors.ts"
import { runTool, type ToolName } from "../src/tools.ts"
import { BAR, ROOT, ROWS, workspace } from "./helpers.ts"

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

/** A folder outside the workspace, removed with the test's workspaces. */
const outsideDir = () => { const dir = mkdtempSync(join(tmpdir(), "charts-outside-")); spaces.push({ cleanup: () => rmSync(dir, { recursive: true, force: true }) }); return dir }

describe("links where a generation goes", () => {
  const outside = outsideDir
  const listing = (dir: string) => readdirSync(dir, { recursive: true }).map(String).sort()

  test("a symbolic link at the generation folder is refused, outside or inside the workspace, even to identical files", async () => {
    const t = setup()
    const first = await t.call("quick", { document: DOC, name: "bars", formats: ["svg", "document"] })
    const folder = join(t.dir, first.generation.directory)
    // The identical generation, moved outside the workspace and linked back where the folder goes.
    const away = join(outside(), "copy")
    cpSync(folder, away, { recursive: true })
    rmSync(folder, { recursive: true })
    symlinkSync(away, folder)
    const before = listing(away)
    const linked = await t.refusal("quick", { document: DOC, name: "bars", formats: ["svg", "document"] })
    expect(linked.code).toBe("OUTPUT_WRITE_FAILED")
    expect(linked.detail).toContain(`${first.generation.directory} is a symbolic link`)
    expect(listing(away)).toEqual(before)
    // A link to an identical folder inside the workspace is refused the same way: a generation is never followed.
    rmSync(folder)
    const inside = join(t.dir, "kept")
    cpSync(away, inside, { recursive: true })
    symlinkSync(inside, folder)
    expect((await t.refusal("render", { document: DOC, name: "bars", formats: ["svg", "document"] })).detail).toContain("is a symbolic link")
    expect(Object.keys(t.tree()).filter(p => p.includes(".tmp"))).toEqual([])
  })

  test("an outDir that links outside the workspace is refused before anything is written; one inside is followed to its real path", async () => {
    const t = setup()
    const away = outside()
    symlinkSync(away, join(t.dir, "out-link"))
    const refused = await t.refusal("quick", { document: DOC, name: "bars", outDir: "out-link" })
    expect(refused.code).toBe("PATH_OUTSIDE_WORKSPACE")
    expect(readdirSync(away)).toEqual([])
    const real = join(t.dir, "real-out")
    mkdirSync(real)
    symlinkSync(real, join(t.dir, "in-link"))
    const out = await t.call("quick", { document: DOC, name: "bars", outDir: "in-link", formats: ["svg", "document"] })
    expect(out.generation.directory).toMatch(/^real-out\/bars-[0-9a-f]{16}$/)
    expect(existsSync(join(t.dir, out.files.document))).toBe(true)
  })
})

describe("two processes publishing the same generation", () => {
  /**
   * Each child stages the same bundle, then waits at the last step before the rename until the other has staged too,
   * so both have seen no folder and both rename: one rename wins, and the other finds the folder in place.
   */
  const CHILD = `
    import { publishGeneration } from ${JSON.stringify(join(ROOT, "src", "artifacts.ts"))}
    import { existsSync, writeFileSync } from "node:fs"
    import { join } from "node:path"
    const [dir, barrier, id] = process.argv.slice(2)
    const artifacts = [
      { kind: "svg", file: "race.svg", bytes: "<svg>" + "x".repeat(200000) + "</svg>" },
      { kind: "document", file: "race.chart.json", bytes: JSON.stringify({ rows: Array.from({ length: 2000 }, (_, i) => ({ i })) }) },
      { kind: "png", file: "race.png", bytes: new Uint8Array(150000).fill(7) },
    ]
    const sleep = new Int32Array(new SharedArrayBuffer(4))
    const probe = file => {
      if (!/^race-[0-9a-f]+$/.test(file)) return
      writeFileSync(join(barrier, id), "")
      const other = join(barrier, id === "a" ? "b" : "a")
      for (let waited = 0; !existsSync(other) && waited < 20000; waited += 5) Atomics.wait(sleep, 0, 0, 5)
    }
    try {
      const out = publishGeneration({ directory: dir }, "outputs/charts", "race", artifacts, probe)
      console.log(JSON.stringify({ ok: true, directory: out.directory, reused: out.reused }))
    } catch (error) {
      console.log(JSON.stringify({ ok: false, code: error.code, detail: error.detail }))
    }
  `
  const BUNDLE = [
    { kind: "svg" as const, file: "race.svg", bytes: "<svg>" + "x".repeat(200000) + "</svg>" },
    { kind: "document" as const, file: "race.chart.json", bytes: JSON.stringify({ rows: Array.from({ length: 2000 }, (_, i) => ({ i })) }) },
    { kind: "png" as const, file: "race.png", bytes: new Uint8Array(150000).fill(7) },
  ]

  test("one publishes, the other reuses the verified folder; never a mixed folder, never a staging folder left", async () => {
    const scripts = outsideDir()
    const script = join(scripts, "child.mjs")
    writeFileSync(script, CHILD)
    const { digest } = bundleManifest(BUNDLE)
    const folder = `outputs/charts/race-${digest.slice(7, 7 + GENERATION_DIGEST_CHARS)}`
    for (let round = 0; round < 3; round++) {
      const t = setup()
      const barrier = join(scripts, `barrier-${round}`)
      mkdirSync(barrier)
      const run = (id: string) => Bun.spawn([process.execPath, script, t.dir, barrier, id], { stdout: "pipe", stderr: "pipe" })
      const children = [run("a"), run("b")]
      const outcomes = await Promise.all(children.map(async child => {
        const [text, err] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text()])
        expect(await child.exited, err).toBe(0)
        return JSON.parse(text.trim()) as { ok: boolean; directory?: string; reused?: boolean; code?: string }
      }))
      // Both reached the rename: the barrier saw both.
      expect(readdirSync(barrier).sort()).toEqual(["a", "b"])
      const published = outcomes.filter(o => o.ok && o.reused === false)
      expect(published).toHaveLength(1)
      // The bundles are identical, so the loser of the rename verifies the winner's folder and reuses it (a different
      // bundle under that name would be the coded collision instead).
      expect(outcomes.filter(o => o !== published[0])).toEqual([{ ok: true, directory: folder, reused: true }])
      expect(published[0]!.directory).toBe(folder)
      // Exactly the bundle, byte for byte, and no staging folder left by either process.
      const files = t.tree()
      expect(Object.keys(files).sort()).toEqual(["outputs/", "outputs/charts/", `${folder}/`, ...BUNDLE.map(b => `${folder}/${b.file}`)].sort())
      for (const b of BUNDLE) expect(files[`${folder}/${b.file}`]).toBe(Buffer.from(b.bytes).toString("base64"))
    }
  })
})
