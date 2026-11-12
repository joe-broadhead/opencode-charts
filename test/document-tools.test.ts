import { afterAll, describe, expect, test } from "bun:test"
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { closeVegaWorker } from "../src/engines/vega-pool.ts"
import { ChartsError } from "../src/errors.ts"
import { RECIPE_IDS } from "../src/recipes/types.ts"
import { recipeExamples } from "../src/recipes/examples.ts"
import { runTool, type ToolName } from "../src/tools.ts"
import { BAR, ROOT, ROWS, workspace } from "./helpers.ts"

/**
 * Chart documents through the public tool path (`runTool`, which the plugin and the tools RPC both call): the inline
 * document arm of charts_quick, charts_render and charts_validate, the saved-artifact path arm, the document output
 * format, and the rule that a call takes exactly one input arm.
 */

const spaces: { cleanup: () => void }[] = []
afterAll(async () => { for (const s of spaces) s.cleanup(); await closeVegaWorker() })

type Assert = { action: string; resources: string[] }
function setup(options: { packageRoot?: string; defaults?: Record<string, unknown>; probe?: (step: string, file?: string) => void } = {}) {
  const ws = workspace()
  spaces.push(ws)
  const asserts: Assert[] = []
  const env = {
    ...ws.env,
    ...(options.packageRoot ? { packageRoot: options.packageRoot } : {}),
    defaults: { ...ws.env.defaults, ...(options.defaults ?? {}) },
    assertFiles: async (action: string, resources: readonly string[]) => { asserts.push({ action, resources: [...resources] }) },
    ...(options.probe ? { probe: options.probe } : {}),
  }
  const call = async (tool: ToolName, input: Record<string, unknown>) => (await runTool(env as never, tool, input)).output as Record<string, any>
  const text = async (tool: ToolName, input: Record<string, unknown>) => (await runTool(env as never, tool, input)).content.flatMap(c => (c.type === "text" ? [c.text] : [])).join("\n")
  // Awaited plainly, never through expect(promise).rejects, which can stall the Vega worker's reply under bun test.
  const refusal = async (tool: ToolName, input: Record<string, unknown>) => {
    const outcome: unknown = await runTool(env as never, tool, input).catch((error: unknown) => error)
    if (outcome instanceof ChartsError) return outcome
    throw outcome instanceof Error ? outcome : new Error("expected a refusal")
  }
  const failed = async (tool: ToolName, input: Record<string, unknown>) => {
    const outcome: unknown = await runTool(env as never, tool, input).catch((error: unknown) => error)
    if (!(outcome instanceof Error)) throw new Error("expected the call to fail")
    return outcome
  }
  const write = (path: string, content: string | Uint8Array) => { mkdirSync(join(ws.dir, path, ".."), { recursive: true }); writeFileSync(join(ws.dir, path), content) }
  const read = (path: string) => readFileSync(join(ws.dir, path), "utf8")
  const files = () => tree(ws.dir)
  return { dir: ws.dir, env, asserts, call, text, refusal, failed, write, read, files }
}

function tree(dir: string): string[] {
  const out: string[] = []
  const walk = (at: string, rel: string) => { for (const e of readdirSync(at, { withFileTypes: true })) { const r = rel ? `${rel}/${e.name}` : e.name; if (e.isDirectory()) walk(join(at, e.name), r); else out.push(r) } }
  if (existsSync(dir)) walk(dir, "")
  return out.sort()
}

/** The recommended call of the brief, with real rows: two channel rows per month and region, so sum is required. */
const MONTHS = ["2024-01-01", "2024-02-01", "2024-03-01", "2024-04-01"]
const REVENUE: Record<string, number> = {}
const CSV = ["month,region,channel,revenue_eur", ...MONTHS.flatMap((m, i) => ["North", "South"].flatMap((r, j) => ["Online", "Store"].map((c, k) => {
  const value = 100 + i * 10 + j * 5 + k * 3
  REVENUE[`${m}|${r}`] = (REVENUE[`${m}|${r}`] ?? 0) + value
  return `${m},${r},${c},${value}`
})))].join("\n") + "\n"
const RECOMMENDED = {
  version: 1,
  chart: { kind: "recipe", recipe: "line", data: { path: "data/revenue.csv" }, bindings: { x: "month", y: "revenue_eur", series: "region" }, options: { xType: "temporal", aggregate: "sum", yTitle: "Revenue (€)" } },
  title: "Revenue by month and region",
  currency: "EUR",
  appearance: { theme: "dark" },
  layout: { target: "inline", mode: "responsive", width: 720, height: 420 },
  interactions: { tooltip: "auto", legend: "highlight", zoom: "x", brush: "none" },
}
const RECOMMENDED_CALL = { document: RECOMMENDED, name: "revenue-by-region", formats: ["document", "svg", "png", "spec", "html"] }

const BAR_DOC = { version: 1, chart: { kind: "recipe", recipe: "bar", data: { rows: ROWS }, bindings: { category: "region", value: "revenue" } }, title: "Revenue by region" }

describe("the recommended document call (brief §5.4), with real data", () => {
  test("charts_quick draws it, saves the artifact and every format, and encodes the sums", async () => {
    const t = setup()
    t.write("data/revenue.csv", CSV)
    const out = await t.call("quick", RECOMMENDED_CALL)
    expect(Object.keys(out.files).sort()).toEqual(["document", "html", "png", "spec", "svg"])
    expect(t.files()).toEqual(["data/revenue.csv", ...["chart.json", "html", "png", "svg", "vl.json"].map(e => `outputs/charts/revenue-by-region.${e}`)].sort())
    expect(out.revision).toMatch(/^sha256:[0-9a-f]{64}$/)
    expect(out.fingerprint).toMatch(/^sha256:[0-9a-f]{64}$/)
    expect(out.source).toEqual({ input: "document", kind: "recipe", recipe: "line", engine: "vega-lite" })
    expect(out.theme).toBe("dark")
    expect(out.categories).toMatchObject({ role: "series", field: "region", count: 2, values: ["North", "South"] })
    expect(out.size).toEqual({ requested: { target: "inline", mode: "responsive", width: 720, height: 420 }, actual: { width: 720, height: 420 } })
    // SVG and PNG are static; the live page is never claimed as verified by a render.
    expect(out.interactions.formats.svg).toEqual({ interactive: false, view: "initial" })
    expect(out.interactions.formats.html.verified).toBe(false)
    // The encoded values are the independently computed sums.
    const spec = JSON.parse(t.read(out.files.spec))
    const drawn = Object.fromEntries((spec.data.values as { month: string; region: string; revenue_eur: number }[]).map(v => [`${v.month.slice(0, 10)}|${v.region}`, v.revenue_eur]))
    expect(drawn).toEqual(REVENUE)
    // The saved artifact holds the rows before any transform, the path in provenance, and the same revision.
    const artifact = JSON.parse(t.read(out.files.document))
    expect(artifact.revision).toBe(out.revision)
    expect(artifact.document.chart.data.rows.length).toBe(16)
    expect(artifact.provenance.data.path).toBe("data/revenue.csv")
    // Read before reading, edit before writing, and nothing else.
    expect(t.asserts).toEqual([{ action: "read", resources: ["data/revenue.csv"] }, { action: "edit", resources: ["outputs/charts/*"] }])
  }, 60_000)

  test("charts_validate and charts_render take the same document and agree with quick, writing nothing on validate", async () => {
    const t = setup()
    t.write("data/revenue.csv", CSV)
    const checked = await t.call("validate", RECOMMENDED_CALL)
    expect(checked.valid).toBe(true)
    expect(checked.fingerprint).toBeUndefined()
    expect(t.files()).toEqual(["data/revenue.csv"])
    expect(t.asserts.map(a => a.action)).toEqual(["read"])
    const rendered = await t.call("render", RECOMMENDED_CALL)
    const quick = await t.call("quick", { ...RECOMMENDED_CALL, name: "via-quick" })
    expect(rendered.revision).toBe(checked.revision)
    expect(quick.revision).toBe(checked.revision)
    expect(t.read(rendered.files.svg)).toBe(t.read(quick.files.svg))
    expect(checked.size).toEqual(rendered.size)
    expect(checked.categories).toEqual(rendered.categories)
  }, 60_000)
})

describe("one input arm per call (A04)", () => {
  const cases: [ToolName, Record<string, unknown>, string][] = [
    ["render", { document: BAR_DOC, spec: BAR }, "/spec"],
    ["render", { document: BAR_DOC, theme: "dark" }, "/theme"],
    ["render", { document: BAR_DOC, width: 600 }, "/width"],
    ["render", { document: BAR_DOC, data: { rows: ROWS } }, "/data"],
    ["render", { documentPath: "x.chart.json", spec: BAR }, "/spec"],
    ["render", { document: BAR_DOC, documentPath: "x.chart.json" }, "/document"],
    ["validate", { document: BAR_DOC, title: "Other" }, "/title"],
    ["validate", { documentPath: "x.chart.json", height: 300 }, "/height"],
    ["quick", { document: BAR_DOC, type: "bar" }, "/type"],
    ["quick", { document: BAR_DOC, x: "region" }, "/x"],
  ]
  for (const [tool, input, path] of cases) {
    test(`${tool} ${Object.keys(input).join(" + ")} is INPUT_CONFLICT before anything is read or written`, async () => {
      const t = setup()
      const error = await t.refusal(tool, { ...input, formats: ["svg"] })
      expect(error.code).toBe("INPUT_CONFLICT")
      expect(error.path).toBe(path)
      expect(t.asserts).toEqual([])
      expect(t.files()).toEqual([])
    })
  }

  test("the refusal says where each legacy field goes in a document", async () => {
    const error = await setup().refusal("render", { document: BAR_DOC, theme: "dark", width: 600 })
    expect(error.message).toContain("theme → document.appearance.theme")
    expect(error.message).toContain("width → document.layout.width")
  })

  test("no arm, an expectedRevision alone, and quick's documentPath are refused with a path", async () => {
    const t = setup()
    expect(await t.refusal("render", { formats: ["svg"] })).toMatchObject({ code: "INPUT_INVALID", path: "/" })
    expect(await t.refusal("validate", { expectedRevision: `sha256:${"0".repeat(64)}` })).toMatchObject({ code: "INPUT_INVALID", path: "/expectedRevision" })
    expect(await t.refusal("quick", { type: "bar" })).toMatchObject({ code: "INPUT_INVALID", path: "/data" })
    expect((await t.failed("quick", { documentPath: "x.chart.json" })).name).toBe("ZodError")
  })

  test("charts_quick refuses an engine document and points at charts_render", async () => {
    const error = await setup().refusal("quick", { document: { version: 1, chart: { kind: "engine", spec: BAR, data: { rows: ROWS } } } })
    expect(error).toMatchObject({ code: "INPUT_INVALID", path: "/document/chart/kind" })
    expect(error.hint).toContain("charts_render")
  })

  test("delivery fields go with every arm", async () => {
    const t = setup()
    const out = await t.call("quick", { document: BAR_DOC, name: "delivered", outDir: "elsewhere", scales: [1], formats: ["svg", "png"], svgText: "paths", marks: "none", inspect: false })
    expect(out.files).toEqual({ svg: "elsewhere/delivered.svg", png: ["elsewhere/delivered.png"] })
  }, 60_000)
})

describe("all 14 recipes through the tools (A05)", () => {
  for (const id of RECIPE_IDS) {
    test(`${id}: every example validates and renders through charts_quick and charts_render`, async () => {
      const t = setup()
      for (const example of recipeExamples(id)) {
        const checked = await t.call("validate", { document: example.document, inspect: false })
        expect(checked.valid, JSON.stringify(checked.issues ?? [])).toBe(true)
        const out = await t.call("quick", { document: example.document, name: example.name, formats: ["svg", "document"] })
        expect(out.source.recipe).toBe(id)
        expect(out.revision).toBe(checked.revision)
        const rendered = await t.call("render", { document: example.document, name: `${example.name}-render`, formats: ["svg"] })
        expect(t.read(rendered.files.svg)).toBe(t.read(out.files.svg))
      }
    }, 60_000)
  }

  test("a missing binding and an unknown one fail at their paths, with valid: false from charts_validate", async () => {
    const t = setup()
    const missing = await t.call("validate", { document: { ...BAR_DOC, chart: { ...BAR_DOC.chart, bindings: { value: "revenue" } } } })
    expect(missing.valid).toBe(false)
    expect(missing.issues).toContainEqual(expect.objectContaining({ code: "FIELD_MISSING", path: "/document/chart/bindings/category" }))
    const unknown = await t.call("validate", { document: { ...BAR_DOC, chart: { ...BAR_DOC.chart, bindings: { category: "region", value: "revenue", colour: "x" } } } })
    expect(unknown.issues).toContainEqual(expect.objectContaining({ code: "UNKNOWN_PROPERTY", path: "/document/chart/bindings/colour" }))
    const rendered = await t.refusal("render", { document: { ...BAR_DOC, chart: { ...BAR_DOC.chart, bindings: { value: "revenue" } } } })
    expect(rendered.code).toBe("DOCUMENT_INVALID")
    expect(t.files()).toEqual([])
  })
})

describe("aggregation through the tools (A06, A07)", () => {
  const rows = [{ g: "a", v: 1 }, { g: "a", v: 2 }, { g: "b", v: -4 }, { g: "b", v: 0 }, { g: "c", v: null }]
  const doc = (options?: Record<string, unknown>, bindings: Record<string, unknown> = { category: "g", value: "v" }) => ({ version: 1, chart: { kind: "recipe", recipe: "bar", data: { rows }, bindings, ...(options ? { options } : {}) }, title: "Agg" })

  test("repeated groups with no aggregate are AGGREGATION_REQUIRED: refused by render, invalid from validate, nothing written", async () => {
    const t = setup()
    expect(await t.refusal("render", { document: doc() })).toMatchObject({ code: "AGGREGATION_REQUIRED", path: "/document/chart/options/aggregate" })
    const checked = await t.call("validate", { document: doc() })
    expect(checked.valid).toBe(false)
    expect(checked.issues[0]).toMatchObject({ code: "AGGREGATION_REQUIRED", path: "/document/chart/options/aggregate" })
    expect(t.files()).toEqual([])
  })

  for (const [op, expected] of [["sum", { a: 3, b: -4, c: null }], ["mean", { a: 1.5, b: -2, c: null }], ["count", { a: 2, b: 2, c: 1 }]] as const) {
    test(`${op}: the encoded values are the independently computed ones, zero and negatives kept, no invented zero`, async () => {
      const t = setup()
      const out = await t.call("render", { document: doc({ aggregate: op }, op === "count" ? { category: "g" } : { category: "g", value: "v" }), name: op, formats: ["spec"] })
      const values = JSON.parse(t.read(out.files.spec)).data.values as Record<string, unknown>[]
      const measure = op === "count" ? "count" : "v"
      expect(Object.fromEntries(values.map(v => [v.g, v[measure]]))).toEqual(expected)
    }, 60_000)
  }
})

describe("formats of a document call", () => {
  test("the defaults are svg, png, spec and document; an omitted tooltip asks for no HTML (A29)", async () => {
    const t = setup()
    const out = await t.call("quick", { document: BAR_DOC, inspect: false })
    expect(Object.keys(out.files).sort()).toEqual(["document", "png", "spec", "svg"])
    // The replay keeps the omission: still no HTML obligation.
    const replay = await t.call("render", { documentPath: out.files.document, name: "replay", inspect: false })
    expect(Object.keys(replay.files).sort()).toEqual(["document", "png", "spec", "svg"])
    expect(replay.interactions.requested).toEqual({})
  }, 60_000)

  test("an explicit tooltip or a persistent interaction adds html to the defaults", async () => {
    const t = setup()
    const out = await t.call("quick", { document: { ...BAR_DOC, interactions: { tooltip: "auto" } }, inspect: false })
    expect(Object.keys(out.files).sort()).toEqual(["document", "html", "png", "spec", "svg"])
    const off = await t.call("quick", { document: { ...BAR_DOC, interactions: { tooltip: "off" } }, name: "off", inspect: false })
    expect(off.files.html).toBeUndefined()
  }, 60_000)

  test("an explicit list is exact, and one that contradicts a requested interaction is INTERACTION_FORMAT_MISMATCH before any file", async () => {
    const t = setup()
    const doc = { ...BAR_DOC, interactions: { tooltip: "auto" } }
    expect(await t.refusal("quick", { document: doc, formats: ["svg", "png"] })).toMatchObject({ code: "INTERACTION_FORMAT_MISMATCH", path: "/formats" })
    expect(t.files()).toEqual([])
    expect(t.asserts).toEqual([])
    const checked = await t.call("validate", { document: doc, formats: ["svg"], inspect: false })
    expect(checked.valid).toBe(false)
    expect(checked.issues).toContainEqual(expect.objectContaining({ code: "INTERACTION_FORMAT_MISMATCH", path: "/formats" }))
    const exact = await t.call("quick", { document: doc, formats: ["svg", "html"], inspect: false })
    expect(Object.keys(exact.files).filter(k => k !== "png" || exact.files.png.length).sort()).toEqual(["html", "svg"])
  }, 60_000)

  test("A18: validate asking for HTML with its runtime missing is invalid, and creates no folder or file", async () => {
    const root = mkdtempSync(join(tmpdir(), "charts-pkg-"))
    spaces.push({ cleanup: () => rmSync(root, { recursive: true, force: true }) })
    for (const entry of readdirSync(ROOT)) if (entry !== "dist") symlinkSync(join(ROOT, entry), join(root, entry))
    mkdirSync(join(root, "dist"))
    for (const entry of readdirSync(join(ROOT, "dist"))) if (entry !== "browser") symlinkSync(join(ROOT, "dist", entry), join(root, "dist", entry))
    const t = setup({ packageRoot: root })
    const checked = await t.call("validate", { document: { ...BAR_DOC, interactions: { tooltip: "auto" } }, outDir: "fresh/charts", inspect: false })
    expect(checked.valid).toBe(false)
    expect(checked.issues).toContainEqual(expect.objectContaining({ code: "HTML_UNAVAILABLE", path: "/formats" }))
    expect(t.files()).toEqual([])
  }, 60_000)

  test("a failure while preparing the artifact, or while moving it in, leaves no new file (A30, A31)", async () => {
    for (const fail of ["document", "commit"]) {
      const t = setup({ probe: (step, file) => { if (step === fail && (step !== "commit" || file?.endsWith(".chart.json"))) throw new Error(`injected ${step}`) } })
      expect((await t.failed("quick", { document: BAR_DOC, formats: ["svg", "spec", "document"], inspect: false })).message).toContain(`injected ${fail}`)
      expect(t.files().filter(f => !f.startsWith("outputs/charts/.")).filter(f => f.startsWith("outputs/"))).toEqual([])
    }
  }, 60_000)
})

describe("the saved-artifact path arm", () => {
  test("replays the artifact exactly: same revision, same drawing, same artifact bytes", async () => {
    const t = setup()
    t.write("data/revenue.csv", CSV)
    const first = await t.call("render", { ...RECOMMENDED_CALL, formats: ["svg", "spec", "document", "html"] })
    const replay = await t.call("render", { documentPath: first.files.document, expectedRevision: first.revision, name: "replay", formats: ["svg", "spec", "document", "html"] })
    expect(replay.revision).toBe(first.revision)
    expect(replay.source).toEqual({ input: "documentPath", kind: "recipe", recipe: "line", engine: "vega-lite", documentPath: first.files.document })
    expect(t.read(replay.files.svg)).toBe(t.read(first.files.svg))
    expect(t.read(replay.files.document)).toBe(t.read(first.files.document))
    // The artifact path is asserted for read before it is read; the captured data is never read again.
    expect(t.asserts.slice(2)).toEqual([{ action: "read", resources: [first.files.document] }, { action: "edit", resources: ["outputs/charts/*"] }])
  }, 60_000)

  test("A14: a changed source CSV changes neither the replay nor its revision; a new document adopts it", async () => {
    const t = setup()
    t.write("data/revenue.csv", CSV)
    const first = await t.call("render", { ...RECOMMENDED_CALL, formats: ["svg", "document", "html"] })
    t.write("data/revenue.csv", CSV.replace(",100\n", ",900\n"))
    const replay = await t.call("render", { documentPath: first.files.document, name: "replay", formats: ["svg", "html"] })
    expect(replay.revision).toBe(first.revision)
    expect(t.read(replay.files.svg)).toBe(t.read(first.files.svg))
    const fresh = await t.call("render", { ...RECOMMENDED_CALL, name: "fresh", formats: ["svg", "html"] })
    expect(fresh.revision).not.toBe(first.revision)
  }, 60_000)

  test("A12: replay keeps the captured theme base, locale and seed when plugin defaults and the saved theme change", async () => {
    const t = setup({ defaults: { theme: "acme", locale: "de-DE" } })
    t.write(".charts/themes/acme.json", JSON.stringify({ extends: "light", name: "acme", colors: { background: "#fdf6e3" } }))
    const doc = { version: 1, chart: { kind: "recipe", recipe: "bar", data: { rows: ROWS }, bindings: { category: "region", value: "revenue" } }, title: "Themed" }
    const first = await t.call("render", { document: doc, formats: ["svg", "document"] })
    expect(t.asserts[0]).toEqual({ action: "read", resources: [".charts/themes/acme.json"] })
    const artifact = JSON.parse(t.read(first.files.document))
    expect(artifact.captured.defaults.locale).toBe("de-DE")
    expect(artifact.captured.theme.tokens.colors.background).toBe("#fdf6e3")
    // Change the saved theme and the plugin's defaults: the replay draws exactly what was captured.
    t.write(".charts/themes/acme.json", JSON.stringify({ extends: "dark", name: "acme", colors: { background: "#000000" } }))
    const other = setup({ defaults: { theme: "print", locale: "en-US" } })
    other.write("saved.chart.json", t.read(first.files.document))
    const replay = await other.call("render", { documentPath: "saved.chart.json", name: "replay", formats: ["svg"] })
    expect(replay.revision).toBe(first.revision)
    expect(replay.appearance.hash).toBe(first.appearance.hash)
    expect(other.read(replay.files.svg)).toBe(t.read(first.files.svg))
    // A fresh document resolves the theme anew: the edited saved theme is adopted, explicitly.
    const fresh = await t.call("render", { document: { ...doc, appearance: { theme: "acme" } }, name: "fresh", formats: ["svg"] })
    expect(fresh.appearance.hash).not.toBe(first.appearance.hash)
  }, 60_000)

  test("A17: a stale expectedRevision, an edited artifact and a newer version are refused before drawing or writing", async () => {
    const t = setup()
    const first = await t.call("quick", { document: BAR_DOC, formats: ["document"] })
    const before = t.files()
    const editsBefore = t.asserts.filter(a => a.action === "edit").length
    const stale = await t.refusal("render", { documentPath: first.files.document, expectedRevision: `sha256:${"a".repeat(64)}`, formats: ["svg"] })
    expect(stale).toMatchObject({ code: "DOCUMENT_REVISION_MISMATCH", path: "/expectedRevision" })
    expect(await t.refusal("render", { documentPath: first.files.document, expectedRevision: "abc" })).toMatchObject({ code: "DOCUMENT_INVALID", path: "/expectedRevision" })
    const artifact = JSON.parse(t.read(first.files.document))
    artifact.document.chart.data.rows[0].revenue = 999
    t.write("edited.chart.json", JSON.stringify(artifact))
    expect(await t.refusal("render", { documentPath: "edited.chart.json", formats: ["svg"] })).toMatchObject({ code: "DOCUMENT_REVISION_MISMATCH" })
    t.write("newer.chart.json", JSON.stringify({ ...JSON.parse(t.read(first.files.document)), version: 2 }))
    expect(await t.refusal("render", { documentPath: "newer.chart.json" })).toMatchObject({ code: "DOCUMENT_VERSION_UNSUPPORTED" })
    expect(await t.refusal("render", { document: { ...BAR_DOC, version: 2 } })).toMatchObject({ code: "DOCUMENT_VERSION_UNSUPPORTED", path: "/document/version" })
    expect(t.files()).toEqual([...before, "edited.chart.json", "newer.chart.json"].sort())
    expect(t.asserts.filter(a => a.action === "edit").length).toBe(editsBefore)
    // charts_validate reports the same refusals as errors, not as a valid result.
    expect(await t.refusal("validate", { documentPath: "edited.chart.json" })).toMatchObject({ code: "DOCUMENT_REVISION_MISMATCH" })
  }, 60_000)

  test("A16: a custom font whose bytes changed is DOCUMENT_DEPENDENCY_CHANGED; nothing else is measured instead", async () => {
    const t = setup()
    mkdirSync(join(t.dir, "brand"), { recursive: true })
    copyFileSync(join(ROOT, "assets", "fonts", "Inter-Regular.ttf"), join(t.dir, "brand", "acme.ttf"))
    t.write(".charts/themes/acme.json", JSON.stringify({ extends: "light", name: "acme", font: { family: "Acme", files: [{ family: "Acme", path: "brand/acme.ttf" }] } }))
    const first = await t.call("render", { document: { ...BAR_DOC, appearance: { theme: "acme" } }, formats: ["svg", "document"] })
    const artifact = JSON.parse(t.read(first.files.document))
    expect(artifact.captured.fonts).toEqual([expect.objectContaining({ family: "Acme", path: "brand/acme.ttf" })])
    expect(t.asserts).toContainEqual({ action: "read", resources: ["brand/acme.ttf"] })
    const ok = await t.call("render", { documentPath: first.files.document, name: "same", formats: ["svg"] })
    expect(t.read(ok.files.svg)).toBe(t.read(first.files.svg))
    copyFileSync(join(ROOT, "assets", "fonts", "JetBrainsMono-Regular.ttf"), join(t.dir, "brand", "acme.ttf"))
    expect(await t.refusal("render", { documentPath: first.files.document, name: "changed", formats: ["svg"] })).toMatchObject({ code: "DOCUMENT_DEPENDENCY_CHANGED" })
    rmSync(join(t.dir, "brand", "acme.ttf"))
    expect(await t.refusal("render", { documentPath: first.files.document, name: "gone", formats: ["svg"] })).toMatchObject({ code: "FILE_NOT_FOUND" })
    expect(t.files().filter(f => f.includes("changed") || f.includes("gone"))).toEqual([])
  }, 60_000)

  test("a path outside the workspace, a missing file and a non-artifact are refused at /documentPath or /format", async () => {
    const t = setup()
    expect(await t.refusal("render", { documentPath: "../x.chart.json" })).toMatchObject({ code: "PATH_OUTSIDE_WORKSPACE", path: "/documentPath" })
    expect(await t.refusal("render", { documentPath: "missing.chart.json" })).toMatchObject({ code: "FILE_NOT_FOUND", path: "/documentPath" })
    t.write("spec.vl.json", JSON.stringify(BAR))
    expect(await t.refusal("render", { documentPath: "spec.vl.json" })).toMatchObject({ code: "ARTIFACT_INVALID", path: "/format" })
  })
})

describe("legacy calls that ask for document output", () => {
  test("charts_render saves an engine document with the original unthemed spec and the rows before the transform", async () => {
    const t = setup()
    const transform = [{ calculate: "datum.revenue * 2", as: "revenue" }]
    const legacy = await t.call("render", { spec: BAR, data: { rows: ROWS, transform }, theme: "dark", title: "Legacy", formats: ["svg", "document"] })
    const artifact = JSON.parse(t.read(legacy.files.document))
    expect(artifact.document.chart).toEqual({ kind: "engine", spec: BAR, data: { rows: ROWS, transform } })
    expect(artifact.document.appearance).toEqual({ theme: "dark" })
    expect(legacy.source.input).toBe("legacy")
    // Same pipeline, same picture as the plain legacy call.
    const plain = await t.call("render", { spec: BAR, data: { rows: ROWS, transform }, theme: "dark", title: "Legacy", name: "plain", formats: ["svg"] })
    expect(t.read(legacy.files.svg)).toBe(t.read(plain.files.svg))
    const replay = await t.call("render", { documentPath: legacy.files.document, name: "replay", formats: ["svg"] })
    expect(t.read(replay.files.svg)).toBe(t.read(plain.files.svg))
  }, 60_000)

  test("charts_quick saves the spec it built and the rows before the transform, which runs once", async () => {
    const t = setup()
    const transform = [{ filter: "datum.revenue > 50" }]
    const out = await t.call("quick", { type: "bar", data: { rows: ROWS, transform }, x: "region", y: "revenue", title: "Quick doc", formats: ["svg", "document"] })
    const artifact = JSON.parse(t.read(out.files.document))
    expect(artifact.document.chart.data).toEqual({ rows: ROWS, transform })
    expect(artifact.document.chart.spec.mark).toBe("bar")
    const plain = await t.call("quick", { type: "bar", data: { rows: ROWS, transform }, x: "region", y: "revenue", title: "Quick doc", name: "plain", formats: ["svg"] })
    expect(t.read(out.files.svg)).toBe(t.read(plain.files.svg))
  }, 60_000)

  test("tool-level sizes, money fields and inline theme tokens cannot be saved and say where they go", async () => {
    const t = setup()
    expect(await t.refusal("render", { spec: BAR, data: { rows: ROWS }, width: 600, formats: ["document"] })).toMatchObject({ code: "LAYOUT_UNSUPPORTED", path: "/width" })
    expect(await t.refusal("render", { spec: BAR, data: { rows: ROWS }, currencyFields: ["revenue"], formats: ["document"] })).toMatchObject({ code: "INPUT_INVALID", path: "/currencyFields" })
    expect(await t.refusal("render", { spec: BAR, data: { rows: ROWS }, theme: { extends: "dark" }, formats: ["document"] })).toMatchObject({ code: "INPUT_INVALID", path: "/theme" })
    expect(t.files()).toEqual([])
  })
})

describe("results stay bounded", () => {
  test("a result never echoes the captured rows, and its diagnostics are bounded and pointed into the call", async () => {
    const t = setup()
    const rows = Array.from({ length: 300 }, (_, i) => ({ id: `row-${i}-marker`, x: i, y: (i * 7) % 13 }))
    const out = await t.call("render", { document: { version: 1, chart: { kind: "recipe", recipe: "scatter", data: { rows }, bindings: { x: "x", y: "y" } } }, formats: ["svg", "document"] })
    expect(JSON.stringify(out)).not.toContain("row-1-marker")
    expect(Array.isArray(out.diagnostics)).toBe(true)
    expect(out.diagnostics.length).toBeLessThanOrEqual(50)
    for (const d of out.diagnostics) if (d.path) expect(d.path).toMatch(/^\/(document|compiled|formats|scales|outDir|inspect)/)
    expect(await t.text("validate", { document: BAR_DOC, inspect: false })).toContain("revision sha256:")
  }, 60_000)
})
