import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test"
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, relative } from "node:path"
import { closeVegaWorker } from "../src/engines/vega-pool.ts"
import { runTool } from "../src/tools.ts"
import { BAR, ROOT, ROWS, workspace } from "./helpers.ts"

/**
 * F9: every requested file and the preview are made before anything is written; a failure while preparing leaves the
 * output folder as it was; a failure while committing puts back what it replaced and removes its staging files; and
 * charts_validate creates nothing at all. Failures are injected with the environment's probe, through the public tool
 * path.
 *
 * The renders here run in the calling thread (`CHARTS_IN_PROCESS=1`, restored afterwards): what is under test is the
 * file handling, and under `bun test` a reply from the unreferenced Vega worker can wait for the render timeout when
 * nothing else is pending, which would turn an ordinary render into a spurious `SPEC_TOO_EXPENSIVE`.
 */
setDefaultTimeout(60_000)
type Step = "svg" | "png" | "html" | "spec" | "preview" | "commit"
const spaces: { cleanup: () => void }[] = []
const inProcess = process.env.CHARTS_IN_PROCESS
beforeAll(() => { process.env.CHARTS_IN_PROCESS = "1" })
afterAll(async () => {
  if (inProcess === undefined) delete process.env.CHARTS_IN_PROCESS
  else process.env.CHARTS_IN_PROCESS = inProcess
  for (const s of spaces) s.cleanup()
  await closeVegaWorker()
})

function setup(probe?: (step: Step, file?: string) => void, packageRoot = ROOT) {
  const ws = workspace()
  spaces.push(ws)
  return { dir: ws.dir, env: { ...ws.env, packageRoot, assertFiles: async () => undefined, ...(probe ? { probe } : {}) } }
}

/** Every path under a folder, hidden ones included, with each file's bytes. */
function tree(dir: string): Record<string, string> {
  const out: Record<string, string> = {}
  const walk = (at: string) => {
    for (const entry of readdirSync(at, { withFileTypes: true })) {
      const path = join(at, entry.name)
      if (entry.isDirectory()) { out[`${relative(dir, path)}/`] = ""; walk(path) }
      else out[relative(dir, path)] = readFileSync(path).toString("base64")
    }
  }
  walk(dir)
  return out
}

/** A copy of the package with no browser runtimes: everything else links to the real one. */
function packageWithoutHtml(): string {
  const root = mkdtempSync(join(tmpdir(), "charts-pkg-"))
  spaces.push({ cleanup: () => rmSync(root, { recursive: true, force: true }) })
  for (const entry of readdirSync(ROOT)) if (entry !== "dist") symlinkSync(join(ROOT, entry), join(root, entry))
  mkdirSync(join(root, "dist"))
  for (const entry of readdirSync(join(ROOT, "dist"))) if (entry !== "browser") symlinkSync(join(ROOT, "dist", entry), join(root, "dist", entry))
  return root
}

const ALL = ["svg", "png", "html", "spec"]
const first = { spec: BAR, data: { rows: ROWS }, title: "First version", name: "chart", formats: ALL, inspect: false }
const second = { spec: BAR, data: { rows: ROWS.map(r => ({ ...r, revenue: r.revenue * 2 })) }, title: "Second version", name: "chart", formats: ALL, inspect: true }

describe("charts_validate creates nothing", () => {
  test("A18: HTML asked for with its runtime missing is an invalid result, with no folder and no file", async () => {
    const { dir, env } = setup(undefined, packageWithoutHtml())
    const before = tree(dir)
    const { output } = await runTool(env as never, "validate", { spec: BAR, data: { rows: ROWS }, formats: ["svg", "html"], outDir: "fresh/charts", inspect: false })
    const result = output as { valid: boolean; issues: { code: string; path?: string; level: string }[] }
    expect(result.valid).toBe(false)
    expect(result.issues.filter(i => i.level === "error").map(i => [i.code, i.path])).toEqual([["HTML_UNAVAILABLE", "/formats"]])
    expect(tree(dir)).toEqual(before)
  })

  test("A18: the same call to charts_render fails before any work, with no folder and no file", async () => {
    const { dir, env } = setup(undefined, packageWithoutHtml())
    await expect(runTool(env as never, "render", { spec: BAR, data: { rows: ROWS }, formats: ["svg", "html"], outDir: "fresh/charts" })).rejects.toThrow(/^HTML_UNAVAILABLE: /)
    expect(tree(dir)).toEqual({})
  })

  test("a valid check of every format returns valid: true and leaves the workspace exactly as it was", async () => {
    const { dir, env } = setup()
    writeFileSync(join(dir, "keep.txt"), "unrelated")
    const before = tree(dir)
    const { output } = await runTool(env as never, "validate", { spec: BAR, data: { rows: ROWS }, formats: ALL, scales: [1, 2, 3], outDir: "new/folder", name: "x", svgText: "embed" })
    expect((output as { valid: boolean }).valid).toBe(true)
    expect(tree(dir)).toEqual(before)
  })

  test("an output folder outside the workspace is an invalid check, not a write", async () => {
    const { dir, env } = setup()
    const { output } = await runTool(env as never, "validate", { spec: BAR, data: { rows: ROWS }, outDir: "../elsewhere", inspect: false })
    expect((output as { issues: { code: string; path?: string }[] }).issues.map(i => [i.code, i.path])).toContainEqual(["PATH_OUTSIDE_WORKSPACE", "/outDir"])
    expect(tree(dir)).toEqual({})
  })
})

describe("a failure while preparing leaves the folder as it was", () => {
  for (const step of ["svg", "png", "html", "spec", "preview"] as const) test(`A30: ${step} fails: the first version's files are untouched and nothing is added`, async () => {
    let armed = false
    const { dir, env } = setup(s => { if (armed && s === step) throw new Error(`injected ${step} failure`) })
    await runTool(env as never, "render", first)
    writeFileSync(join(dir, "outputs", "charts", "notes.txt"), "unrelated")
    const before = tree(dir)
    armed = true
    await expect(runTool(env as never, "render", second)).rejects.toThrow(`injected ${step} failure`)
    expect(tree(dir)).toEqual(before)
  })

  test("A30: a PNG over the pixel limit is refused before any file is written", async () => {
    const { dir, env } = setup()
    const option = { xAxis: { type: "category" }, yAxis: { type: "value", name: "€k" }, series: [{ type: "bar", encode: { x: "region", y: "revenue" } }] }
    await expect(runTool(env as never, "render", { spec: option, data: { rows: ROWS }, width: 4000, height: 4000, scales: [1, 2], formats: ALL })).rejects.toThrow(/^PNG_TOO_LARGE: /)
    expect(tree(dir)).toEqual({})
  })

  test("an invalid PNG scale is refused before the SVG is written", async () => {
    const { renderChart } = await import("../src/pipeline.ts")
    const { dir, env } = setup()
    await expect(renderChart({ spec: BAR, data: { rows: ROWS }, scales: [4] }, env)).rejects.toThrow(/^SCALE_INVALID: /)
    expect(tree(dir)).toEqual({})
  })
})

describe("a failure while committing puts back what it replaced", () => {
  test("A31: the second file fails to move: the first is restored, the rest are not written, no staging is left", async () => {
    let armed = false
    const { dir, env } = setup((s, file) => { if (armed && s === "commit" && file === "chart.png") throw new Error("injected commit failure") })
    await runTool(env as never, "render", { ...first, formats: ["svg", "png", "spec"] })
    writeFileSync(join(dir, "outputs", "charts", "notes.txt"), "unrelated")
    const before = tree(dir)
    armed = true
    const failure = runTool(env as never, "render", second)
    await expect(failure).rejects.toThrow(/^OUTPUT_WRITE_FAILED: Writing outputs\/charts\/chart\.png failed \(injected commit failure\)\. The 1 file\(s\) already written were put back as they were\./)
    // chart.html did not exist before, and is not there now; chart.svg is the first version again.
    expect(tree(dir)).toEqual(before)
  })

  test("A31: a folder where a chart file goes stops the commit, and every new file is removed", async () => {
    const { dir, env } = setup()
    mkdirSync(join(dir, "outputs", "charts", "chart.png"), { recursive: true })
    writeFileSync(join(dir, "outputs", "charts", "notes.txt"), "unrelated")
    const before = tree(dir)
    await expect(runTool(env as never, "render", { ...second, inspect: false })).rejects.toThrow(/^OUTPUT_WRITE_FAILED: /)
    expect(tree(dir)).toEqual(before)
  })

  test("a successful render replaces the files and leaves no staging or backup file behind", async () => {
    const { dir, env } = setup()
    await runTool(env as never, "render", first)
    const { output } = await runTool(env as never, "render", second)
    expect((output as { files: unknown }).files).toEqual({ svg: "outputs/charts/chart.svg", png: ["outputs/charts/chart.png"], html: "outputs/charts/chart.html", spec: "outputs/charts/chart.vl.json" })
    expect(readdirSync(join(dir, "outputs", "charts")).sort()).toEqual(["chart.html", "chart.png", "chart.svg", "chart.vl.json"])
    expect(readFileSync(join(dir, "outputs", "charts", "chart.svg"), "utf8")).toContain("Second version")
    expect(statSync(join(dir, "outputs", "charts", "chart.png")).size).toBeGreaterThan(0)
  })
})
