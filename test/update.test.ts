import { afterAll, describe, expect, setDefaultTimeout, test } from "bun:test"
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { closeVegaWorker } from "../src/engines/vega-pool.ts"
import { ChartsError } from "../src/errors.ts"
import { defaultRules } from "../src/permissions.ts"
import { runTool, type ToolName } from "../src/tools.ts"
import { ROOT, workspace } from "./helpers.ts"

/**
 * charts_update through the public tool path (`runTool`, which the plugin and the tools RPC both call): the saved
 * artifact read with the same checks as a replay, the revision precondition, the patch semantics (omitted, explicit,
 * merged, replaced and cleared fields), the analytical invariants a presentation change keeps, and publication as a
 * new immutable generation folder, with failure injection through the environment's probe.
 *
 * A failure is awaited as `await p.catch(e => e)`, never `expect(p).rejects`, which can stall the Vega worker's reply
 * under bun test.
 */
setDefaultTimeout(60_000)
const spaces: { cleanup: () => void }[] = []
afterAll(async () => { for (const s of spaces) s.cleanup(); await closeVegaWorker() })

type Step = "svg" | "png" | "html" | "spec" | "document" | "preview" | "commit"
function setup(options: { probe?: (step: Step, file?: string) => void; deny?: (action: string, path: string) => boolean } = {}) {
  const ws = workspace()
  spaces.push(ws)
  const asserts: { action: string; resources: string[] }[] = []
  let probe = options.probe
  const env = {
    ...ws.env,
    assertFiles: async (action: string, resources: readonly string[]) => {
      asserts.push({ action, resources: [...resources] })
      const denied = resources.find(r => options.deny?.(action, r))
      if (denied) throw new Error(`permission denied: ${action} ${denied}`)
    },
    probe: (step: Step, file?: string) => probe?.(step, file),
  }
  const call = async (tool: ToolName, input: Record<string, unknown>) => (await runTool(env as never, tool, input)).output as Record<string, any>
  const text = async (tool: ToolName, input: Record<string, unknown>) => (await runTool(env as never, tool, input)).content.flatMap(c => (c.type === "text" ? [c.text] : [])).join("\n")
  const refusal = async (tool: ToolName, input: Record<string, unknown>) => {
    const outcome: unknown = await runTool(env as never, tool, input).catch((error: unknown) => error)
    if (outcome instanceof ChartsError) return outcome
    throw outcome instanceof Error ? outcome : new Error("expected a refusal")
  }
  const write = (path: string, content: string | Uint8Array) => { mkdirSync(join(ws.dir, path, ".."), { recursive: true }); writeFileSync(join(ws.dir, path), content) }
  const read = (path: string) => readFileSync(join(ws.dir, path), "utf8")
  const json = (path: string) => JSON.parse(read(path)) as Record<string, any>
  /** Every path under the workspace with its bytes, hidden ones included. */
  const tree = (): Record<string, string> => {
    const out: Record<string, string> = {}
    const walk = (at: string, rel: string) => { for (const e of readdirSync(at, { withFileTypes: true })) { const r = rel ? `${rel}/${e.name}` : e.name; if (e.isDirectory()) { out[`${r}/`] = ""; walk(join(at, e.name), r) } else out[r] = readFileSync(join(at, e.name)).toString("base64") } }
    walk(ws.dir, "")
    return out
  }
  return { dir: ws.dir, env, asserts, call, text, refusal, write, read, json, tree, setProbe: (p: typeof probe) => { probe = p } }
}

/** A grouped bar of revenue by region and channel, with a transform that would drift if it ran more than once. */
const ROWS = [
  { region: "North", channel: "Online", revenue: 120 }, { region: "North", channel: "Store", revenue: 80 },
  { region: "South", channel: "Online", revenue: 95 }, { region: "South", channel: "Store", revenue: 40 },
  { region: "East", channel: "Online", revenue: 60 }, { region: "East", channel: "Store", revenue: 75 },
]
const DOUBLED = { calculate: "datum.revenue * 2", as: "revenue" }
const DOC = {
  version: 1,
  chart: { kind: "recipe", recipe: "grouped_bar", data: { rows: ROWS, transform: [DOUBLED] }, bindings: { category: "region", series: "channel", value: "revenue" }, options: { yTitle: "Revenue (€k)" } },
  title: "Revenue by region",
}

/** Creates the chart with charts_quick and returns its saved artifact's path and revision. */
async function create(t: ReturnType<typeof setup>, doc: unknown = DOC, extra: Record<string, unknown> = {}) {
  const made = await t.call("quick", { document: doc, name: "revenue", ...extra })
  return { path: made.files.document as string, revision: made.revision as string, made }
}

/** What a presentation change must keep: the chart (data, transform, bindings, options) and the analytical captures. */
const meaning = (artifact: Record<string, any>) => ({
  chart: artifact.document.chart,
  locale: artifact.document.locale, currency: artifact.document.currency, seed: artifact.document.seed,
  categories: artifact.captured.categories,
  recipeOptions: artifact.captured.defaults.recipeOptions,
  locale_: artifact.captured.defaults.locale, seed_: artifact.captured.defaults.seed,
  provenance: artifact.provenance,
})

/** The bar values the compiled spec draws, by region and channel: what the reader sees. */
function drawnValues(spec: Record<string, any>): Record<string, number> {
  const values: Record<string, unknown>[] = spec.data?.values ?? spec.datasets?.[Object.keys(spec.datasets ?? {})[0] ?? ""] ?? []
  return Object.fromEntries(values.map(v => [`${v.region}|${v.channel}`, v.revenue as number]))
}
const EXPECTED_DRAWN = Object.fromEntries(ROWS.map(r => [`${r.region}|${r.channel}`, r.revenue * 2]))

describe("charts_update: a presentation change as a new revision", () => {
  test("theme and layout change; the chart's data, bindings, options, transform and colour domain do not", async () => {
    const t = setup()
    const { path, revision } = await create(t)
    const sourceBytes = t.read(path)
    const out = await t.call("update", { documentPath: path, expectedRevision: revision, patch: { appearance: { theme: "dark" }, layout: { target: "presentation" } } })
    // The source artifact is intact, and the new revision lives in its own generation folder.
    expect(t.read(path)).toBe(sourceBytes)
    expect(out.revision).toMatch(/^sha256:[0-9a-f]{64}$/)
    expect(out.revision).not.toBe(revision)
    expect(out.update).toEqual({ from: { documentPath: path, revision }, to: { revision: out.revision, documentPath: out.files.document }, changed: ["appearance.theme", "layout"], theme: { resolved: true, changed: true } })
    expect(out.generation.directory).toMatch(/^outputs\/charts\/revenue-[0-9a-f]{16}$/)
    expect(out.generation.reused).toBe(false)
    for (const file of [out.files.svg, out.files.png[0], out.files.spec, out.files.document]) expect(file.startsWith(`${out.generation.directory}/`)).toBe(true)
    expect(out.source).toMatchObject({ input: "update", kind: "recipe", recipe: "grouped_bar", documentPath: path })
    // The invariants, on the saved artifacts themselves.
    const before = JSON.parse(sourceBytes), after = t.json(out.files.document)
    expect(after.revision).toBe(out.revision)
    expect(meaning(after)).toEqual(meaning(before))
    expect(after.document.chart.data.rows).toEqual(ROWS)
    expect(after.document.chart.data.transform).toEqual([DOUBLED])
    expect(after.document.appearance).toEqual({ theme: "dark" })
    expect(after.captured.theme.name).toBe("dark")
    expect(after.document.layout).toEqual({ target: "presentation" })
    // The new layout's profile defaults are captured for it; the interaction defaults stay as captured.
    expect(after.captured.defaults.layout).toEqual({ profile: "presentation", profileVersion: 1, mode: "fixed", width: 1280, height: 720, minLabelSize: 18 })
    expect(after.captured.defaults.interactions).toEqual(before.captured.defaults.interactions)
    // What is drawn: the same values at the new size, in the new theme.
    expect(drawnValues(t.json(out.files.spec))).toEqual(EXPECTED_DRAWN)
    expect(out.size.requested).toEqual({ target: "presentation", mode: "fixed", width: 1280, height: 720 })
    expect(out.size.actual).toEqual({ width: 1280, height: 720 })
    expect(t.read(out.files.svg)).toMatch(/<svg[^>]*width="1280"[^>]*height="720"/)
    expect(out.appearance.base).toBe("dark")
    // No rows are echoed back in the result.
    expect(JSON.stringify(out)).not.toContain("\"Online\",\"revenue\"")
    expect(JSON.stringify(out).length).toBeLessThan(200_000)
  })

  test("A15: repeated updates, each from the last generation, run the transform once per compilation and never drift", async () => {
    const t = setup()
    let { path, revision } = await create(t)
    const original = t.json(path)
    expect(drawnValues(t.json(path.replace(".chart.json", ".vl.json")))).toEqual(EXPECTED_DRAWN)
    const patches = [{ appearance: { theme: "dark" } }, { layout: { target: "report" } }, { title: "Revenue, doubled" }, { appearance: { theme: "light" } }]
    for (const patch of patches) {
      const out = await t.call("update", { documentPath: path, expectedRevision: revision, patch })
      const saved = t.json(out.files.document)
      expect(saved.document.chart).toEqual(original.document.chart)
      expect(saved.document.chart.data.rows).toHaveLength(ROWS.length)
      expect(drawnValues(t.json(out.files.spec))).toEqual(EXPECTED_DRAWN)
      ;({ path, revision } = { path: out.files.document, revision: out.revision })
    }
  })

  test("A12/F3: light → dark → light by update draws the light chart again; a layout-only update keeps the captured base", async () => {
    const t = setup()
    const { path, revision, made } = await create(t)
    const dark = await t.call("update", { documentPath: path, expectedRevision: revision, patch: { appearance: { theme: "dark" } } })
    expect(t.read(dark.files.svg)).not.toBe(t.read(made.files.svg))
    const light = await t.call("update", { documentPath: dark.files.document, expectedRevision: dark.revision, patch: { appearance: { theme: "light" } } })
    expect(t.read(light.files.svg)).toBe(t.read(made.files.svg))
    expect(light.appearance.hash).toBe(made.appearance.hash)
    // Dark's tokens were never folded into the document as authored overrides.
    expect(t.json(light.files.document).document.appearance).toEqual({ theme: "light" })
  })

  test("A12: a saved theme edited after creation is adopted only when the update names it again", async () => {
    const t = setup()
    await t.call("theme_save", { name: "acme", theme: { extends: "light", colors: { categorical: ["#1f4e79", "#c55a11"] } } })
    const { path, revision, made } = await create(t, { ...DOC, appearance: { theme: "acme" } })
    await t.call("theme_save", { name: "acme", theme: { extends: "light", colors: { categorical: ["#2e7d32", "#6a1b9a"] } } })
    const kept = await t.call("update", { documentPath: path, expectedRevision: revision, patch: { layout: { target: "report" } } })
    expect(kept.appearance.hash).toBe(made.appearance.hash)
    expect(kept.update.theme).toEqual({ resolved: false, changed: false })
    expect(t.read(kept.files.svg)).toContain("#1f4e79")
    const adopted = await t.call("update", { documentPath: path, expectedRevision: revision, patch: { appearance: { theme: "acme" } } })
    expect(adopted.update).toMatchObject({ changed: [], theme: { resolved: true, changed: true } })
    expect(adopted.appearance.hash).not.toBe(made.appearance.hash)
    expect(t.read(adopted.files.svg)).toContain("#2e7d32")
    expect(t.read(adopted.files.svg)).not.toContain("#1f4e79")
    // The colour domain (and so which series gets which palette position) is the captured one.
    expect(t.json(adopted.files.document).captured.categories).toEqual(t.json(path).captured.categories)
  })

  test("A14: a source file changed after creation is not read by an update; the captured rows are drawn", async () => {
    const t = setup()
    t.write("data/revenue.csv", ["region,channel,revenue", ...ROWS.map(r => `${r.region},${r.channel},${r.revenue}`)].join("\n") + "\n")
    const doc = { ...DOC, chart: { ...DOC.chart, data: { path: "data/revenue.csv", transform: [DOUBLED] } } }
    const { path, revision } = await create(t, doc)
    t.write("data/revenue.csv", "region,channel,revenue\nNorth,Online,999999\n")
    const before = t.asserts.length
    const out = await t.call("update", { documentPath: path, expectedRevision: revision, patch: { appearance: { theme: "dark" } } })
    expect(drawnValues(t.json(out.files.spec))).toEqual(EXPECTED_DRAWN)
    expect(t.json(out.files.document).provenance).toEqual(t.json(path).provenance)
    // Only the artifact is read, and only the output folder written: the source file is never asked for.
    expect(t.asserts.slice(before)).toEqual([{ action: "read", resources: [path] }, { action: "edit", resources: ["outputs/charts/*"] }])
  })

  test("a no-op patch keeps the revision and reuses its verified generation", async () => {
    const t = setup()
    const { path, revision } = await create(t)
    const first = await t.call("update", { documentPath: path, expectedRevision: revision, patch: {} })
    expect(first.revision).toBe(revision)
    expect(first.update.changed).toEqual([])
    expect(first.generation.reused).toBe(false)
    const listing = t.tree()
    const again = await t.call("update", { documentPath: path, expectedRevision: revision, patch: {} })
    expect(again.generation).toEqual({ ...first.generation, reused: true })
    expect(again.files).toEqual(first.files)
    expect(t.tree()).toEqual(listing)
  })
})

describe("charts_update: patch semantics", () => {
  const STYLED = {
    ...DOC,
    description: "Revenue by region and channel.",
    appearance: { overrides: { colors: { categorical: ["#112233", "#445566"], text: "#101010" }, axis: { grid: false } }, categoryColors: [{ value: "Online", color: "#aa0000" }] },
    layout: { target: "inline", width: 500, height: 320 },
    interactions: { legend: "highlight" },
  }

  test("omitted fields stay; empty title and description are intentionally empty", async () => {
    const t = setup()
    const { path, revision } = await create(t, STYLED)
    const kept = t.json((await t.call("update", { documentPath: path, expectedRevision: revision, patch: {} })).files.document)
    expect(kept.document.title).toBe("Revenue by region")
    expect(kept.document.description).toBe("Revenue by region and channel.")
    const emptied = await t.call("update", { documentPath: path, expectedRevision: revision, patch: { title: "", description: "" } })
    const doc = t.json(emptied.files.document).document
    expect(doc.title).toBe("")
    expect(doc.description).toBe("")
    expect(emptied.update.changed).toEqual(["title", "description"])
    expect(t.read(emptied.files.svg)).not.toContain(">Revenue by region<")
  })

  test("overrides merge token by token, arrays replace whole, and {} clears them all", async () => {
    const t = setup()
    const { path, revision } = await create(t, STYLED)
    const merged = await t.call("update", { documentPath: path, expectedRevision: revision, patch: { appearance: { overrides: { colors: { categorical: ["#778899", "#99aabb"] }, legend: { orient: "bottom" } } } } })
    expect(t.json(merged.files.document).document.appearance).toEqual({
      overrides: { colors: { categorical: ["#778899", "#99aabb"], text: "#101010" }, axis: { grid: false }, legend: { orient: "bottom" } },
      categoryColors: [{ value: "Online", color: "#aa0000" }],
    })
    expect(merged.update.changed).toEqual(["appearance.overrides"])
    const cleared = await t.call("update", { documentPath: path, expectedRevision: revision, patch: { appearance: { overrides: {} } } })
    expect(t.json(cleared.files.document).document.appearance).toEqual({ categoryColors: [{ value: "Online", color: "#aa0000" }] })
    expect(cleared.appearance.overridden).toBe(false)
  })

  test("categoryColors replaces whole, and [] clears every explicit colour", async () => {
    const t = setup()
    const { path, revision } = await create(t, STYLED)
    const replaced = await t.call("update", { documentPath: path, expectedRevision: revision, patch: { appearance: { categoryColors: [{ value: "Store", color: "#00aa00" }] } } })
    expect(t.json(replaced.files.document).document.appearance.categoryColors).toEqual([{ value: "Store", color: "#00aa00" }])
    const cleared = await t.call("update", { documentPath: path, expectedRevision: revision, patch: { appearance: { categoryColors: [] } } })
    expect(t.json(cleared.files.document).document.appearance).toEqual({ overrides: STYLED.appearance.overrides })
    expect(t.read(cleared.files.svg)).not.toContain("#aa0000")
  })

  test("layout replaces the whole layout: a new target takes its profile's size, not the old explicit width", async () => {
    const t = setup()
    const { path, revision } = await create(t, STYLED)
    const before = t.json(path)
    expect(before.captured.defaults.layout).toEqual({ profile: "inline", profileVersion: 1, mode: "responsive", minLabelSize: 11 })
    const out = await t.call("update", { documentPath: path, expectedRevision: revision, patch: { layout: { target: "presentation" } } })
    const after = t.json(out.files.document)
    expect(after.document.layout).toEqual({ target: "presentation" })
    expect(out.size.actual).toEqual({ width: 1280, height: 720 })
    expect(after.captured.defaults.layout).toEqual({ profile: "presentation", profileVersion: 1, mode: "fixed", width: 1280, height: 720, minLabelSize: 18 })
    // Every other captured default stays.
    const { layout: _a, ...otherAfter } = after.captured.defaults
    const { layout: _b, ...otherBefore } = before.captured.defaults
    expect(otherAfter).toEqual(otherBefore)
  })

  test("interactions merge; a preset the patch sets is authored and no longer a captured default", async () => {
    const t = setup()
    const { path, revision } = await create(t, STYLED)
    expect(t.json(path).captured.defaults.interactions).toEqual({ tooltip: "auto", zoom: "none", brush: "none" })
    const out = await t.call("update", { documentPath: path, expectedRevision: revision, patch: { interactions: { tooltip: "off" } }, formats: ["svg", "html", "document"] })
    const saved = t.json(out.files.document)
    expect(saved.document.interactions).toEqual({ legend: "highlight", tooltip: "off" })
    expect(saved.captured.defaults.interactions).toEqual({ zoom: "none", brush: "none" })
    expect(out.interactions.resolved).toEqual({ tooltip: "off", legend: "highlight", zoom: "none", brush: "none" })
  })

  test("A29: an omitted tooltip asks for no HTML across save and update; an explicit one with static formats is a mismatch", async () => {
    const t = setup()
    const { path, revision } = await create(t, DOC, { formats: ["svg", "document"] })
    const quiet = await t.call("update", { documentPath: path, expectedRevision: revision, patch: {}, formats: ["svg", "png", "document"] })
    expect(quiet.files.html).toBeUndefined()
    expect(quiet.interactions.formats).toEqual({ svg: { interactive: false, view: "initial" }, png: { interactive: false, view: "initial" } })
    const listing = t.tree()
    const mismatch = await t.refusal("update", { documentPath: path, expectedRevision: revision, patch: { interactions: { tooltip: "auto" } }, formats: ["svg", "document"] })
    expect(mismatch.code).toBe("INTERACTION_FORMAT_MISMATCH")
    expect(t.tree()).toEqual(listing)
    // With the defaults, the explicit tooltip brings the HTML page.
    const live = await t.call("update", { documentPath: path, expectedRevision: revision, patch: { interactions: { tooltip: "auto" } } })
    expect(live.files.html).toMatch(/\.html$/)
    expect(live.interactions.formats.svg).toEqual({ interactive: false, view: "initial" })
  })

  test("formats without document draw the new revision without saving it, and say so", async () => {
    const t = setup()
    const { path, revision } = await create(t)
    const text = await t.text("update", { documentPath: path, expectedRevision: revision, patch: { appearance: { theme: "dark" } }, formats: ["svg"] })
    expect(text).toContain("No .chart.json was written")
  })
})

describe("charts_update: refusals before anything is drawn or written", () => {
  const ENGINE = { version: 1, chart: { kind: "engine", spec: { mark: "bar", encoding: { x: { field: "k", type: "nominal" }, y: { field: "v", type: "quantitative", title: "Value" } } }, data: { rows: [{ k: "a", v: 1 }, { k: "b", v: 2 }] } }, title: "Engine" }

  test("fields that would change the chart's meaning are refused at their path, with what to do instead", async () => {
    const t = setup()
    const { path, revision } = await create(t)
    const listing = t.tree()
    for (const key of ["data", "bindings", "options", "chart", "locale", "currency", "seed", "transform", "version"]) {
      const error = await t.refusal("update", { documentPath: path, expectedRevision: revision, patch: { [key]: key === "seed" ? 3 : {} } })
      expect(error.code).toBe("DOCUMENT_INVALID")
      expect(error.path).toBe(`/patch/${key}`)
      expect(error.detail).toContain("cannot be patched")
      expect(error.hint).toContain("create a new document")
    }
    expect(t.tree()).toEqual(listing)
  })

  test("unknown and refused paths inside the patch point into it", async () => {
    const t = setup()
    const { path, revision } = await create(t)
    const at = async (patch: unknown) => { const e = await t.refusal("update", { documentPath: path, expectedRevision: revision, patch }); return [e.code, e.path] }
    expect(await at({ colour: "red" })).toEqual(["DOCUMENT_INVALID", "/patch/colour"])
    expect(await at({ appearance: { overrides: { colours: {} } } })).toEqual(["DOCUMENT_INVALID", "/patch/appearance/overrides/colours"])
    expect(await at({ appearance: { overrides: { extends: "dark" } } })).toEqual(["DOCUMENT_INVALID", "/patch/appearance/overrides/extends"])
    expect(await at({ appearance: { overrides: { layout: { width: 900 } } } })).toEqual(["DOCUMENT_INVALID", "/patch/appearance/overrides/layout/width"])
    expect(await at({ layout: { width: 5 } })).toEqual(["DOCUMENT_INVALID", "/patch/layout/width"])
    expect(await at({ layout: { mode: "native" } })).toEqual(["DOCUMENT_INVALID", "/patch/layout/mode"])
    expect(await at({ interactions: { zoom: "x" } })).toEqual(["INTERACTION_UNSUPPORTED", "/patch/interactions/zoom"])
    expect(await at({ appearance: { theme: "nope" } })).toEqual(["THEME_NOT_FOUND", "/patch/appearance/theme"])
    expect(await at({ title: 5 })).toEqual(["DOCUMENT_INVALID", "/patch/title"])
    expect(await at({ title: undefined, appearance: null })).toEqual(["DOCUMENT_INVALID", "/patch/appearance"])
  })

  test("an engine document takes title, description, theme and native layout, and refuses recipe layout and presets", async () => {
    const t = setup()
    const made = await t.call("render", { document: ENGINE, name: "engine", formats: ["svg", "document"] })
    const ok = await t.call("update", { documentPath: made.files.document, expectedRevision: made.revision, patch: { title: "Engine, dark", appearance: { theme: "dark" }, layout: { mode: "native" } } })
    expect(t.json(ok.files.document).document).toMatchObject({ title: "Engine, dark", appearance: { theme: "dark" }, layout: { mode: "native" } })
    expect(t.json(ok.files.document).captured.defaults).toEqual(t.json(made.files.document).captured.defaults)
    const fixed = await t.refusal("update", { documentPath: made.files.document, expectedRevision: made.revision, patch: { layout: { mode: "fixed", width: 600 } } })
    expect([fixed.code, fixed.path]).toEqual(["LAYOUT_UNSUPPORTED", "/patch/layout/mode"])
    const preset = await t.refusal("update", { documentPath: made.files.document, expectedRevision: made.revision, patch: { interactions: { legend: "highlight" } } })
    expect([preset.code, preset.path]).toEqual(["INTERACTION_UNSUPPORTED", "/patch/interactions/legend"])
  })

  test("A17: a stale, malformed or edited revision is refused before rendering; nothing is written", async () => {
    const t = setup()
    const { path, revision } = await create(t)
    const listing = t.tree()
    const stale = await t.refusal("update", { documentPath: path, expectedRevision: `sha256:${"0".repeat(64)}`, patch: { title: "x" } })
    expect([stale.code, stale.path]).toEqual(["DOCUMENT_REVISION_MISMATCH", "/expectedRevision"])
    const malformed = await t.refusal("update", { documentPath: path, expectedRevision: "latest", patch: {} })
    expect([malformed.code, malformed.path]).toEqual(["DOCUMENT_INVALID", "/expectedRevision"])
    expect(t.tree()).toEqual(listing)
    // An artifact edited by hand, even with its revision string kept, is recomputed and refused.
    const edited = t.json(path)
    edited.document.chart.data.rows[0].revenue = 1
    t.write(path, JSON.stringify(edited))
    const tampered = await t.refusal("update", { documentPath: path, expectedRevision: revision, patch: {} })
    expect([tampered.code, tampered.path]).toEqual(["DOCUMENT_REVISION_MISMATCH", "/revision"])
    // A newer artifact version is not read as this one.
    t.write(path, JSON.stringify({ ...edited, version: 2 }))
    expect((await t.refusal("update", { documentPath: path, expectedRevision: revision, patch: {} })).code).toBe("DOCUMENT_VERSION_UNSUPPORTED")
    // A resolved engine spec is not an editable document.
    const spec = await t.refusal("update", { documentPath: path.replace(".chart.json", ".vl.json"), expectedRevision: revision, patch: {} })
    expect(spec.code).toBe("ARTIFACT_INVALID")
  })

  test("the artifact is asked for before it is read, and a denied read or edit stops the call with nothing written", async () => {
    const reader = setup({ deny: (action, path) => action === "read" && path.endsWith(".chart.json") })
    reader.setProbe(undefined)
    const made = await reader.call("quick", { document: DOC, name: "revenue", formats: ["svg", "document"] })
    const listing = reader.tree()
    const read = await runTool(reader.env as never, "update", { documentPath: made.files.document, expectedRevision: made.revision, patch: {} }).catch((e: unknown) => e) as Error
    expect(read.message).toBe(`permission denied: read ${made.files.document}`)
    expect(reader.tree()).toEqual(listing)
    const writer = setup({ deny: (action) => action === "edit" })
    const { path, revision } = await (async () => { const t = setup(); const c = await create(t); copyFileSync(join(t.dir, c.path), join(writer.dir, "saved.chart.json")); return { path: "saved.chart.json", revision: c.revision } })()
    const before = writer.tree()
    const edit = await runTool(writer.env as never, "update", { documentPath: path, expectedRevision: revision, patch: { appearance: { theme: "dark" } } }).catch((e: unknown) => e) as Error
    expect(edit.message).toBe("permission denied: edit outputs/charts/*")
    expect(writer.tree()).toEqual(before)
    expect(writer.asserts.map(a => a.action)).toEqual(["read", "edit"])
  })

  test("A16: a custom font that changed since the save is DOCUMENT_DEPENDENCY_CHANGED; a font the patch brings is captured", async () => {
    const t = setup()
    mkdirSync(join(t.dir, "fonts"), { recursive: true })
    copyFileSync(join(ROOT, "assets", "fonts", "Inter-Regular.ttf"), join(t.dir, "fonts", "brand.ttf"))
    const { path, revision } = await create(t, { ...DOC, appearance: { overrides: { font: { family: "Brand", files: [{ family: "Brand", path: "fonts/brand.ttf" }] } } } })
    expect(t.json(path).captured.fonts.map((f: { path: string }) => f.path)).toEqual(["fonts/brand.ttf"])
    copyFileSync(join(ROOT, "assets", "fonts", "Inter-SemiBold.ttf"), join(t.dir, "fonts", "brand.ttf"))
    const listing = t.tree()
    const changed = await t.refusal("update", { documentPath: path, expectedRevision: revision, patch: { appearance: { theme: "dark" } } })
    expect(changed.code).toBe("DOCUMENT_DEPENDENCY_CHANGED")
    expect(t.tree()).toEqual(listing)
    // A font that only the patch brings in is read now and captured with its digest.
    copyFileSync(join(ROOT, "assets", "fonts", "JetBrainsMono-Regular.ttf"), join(t.dir, "fonts", "mono.ttf"))
    const plain = await create(t, DOC, { name: "plain" })
    const out = await t.call("update", { documentPath: plain.path, expectedRevision: plain.revision, patch: { appearance: { overrides: { font: { family: "Mono", files: [{ family: "Mono", path: "fonts/mono.ttf" }] } } } } })
    expect(t.json(out.files.document).captured.fonts).toMatchObject([{ family: "Mono", weight: 400, path: "fonts/mono.ttf" }])
  })
})

describe("charts_update: complete-generation publication", () => {
  test("A30: a failure while preparing any file or the preview publishes no generation and leaves no staging", async () => {
    for (const step of ["svg", "png", "html", "spec", "document", "preview"] as const) {
      const t = setup()
      const { path, revision } = await create(t)
      const listing = t.tree()
      t.setProbe(s => { if (s === step) throw new Error(`injected ${step} failure`) })
      const outcome = await runTool(t.env as never, "update", { documentPath: path, expectedRevision: revision, patch: { appearance: { theme: "dark" } }, formats: ["svg", "png", "html", "spec", "document"], inspect: true }).catch((e: unknown) => e) as Error
      expect(outcome.message).toBe(`injected ${step} failure`)
      expect(t.tree()).toEqual(listing)
    }
  })

  test("A31: a failure while writing a file or publishing the folder removes the staging folder and touches nothing else", async () => {
    for (const at of ["revenue.svg", "revenue.chart.json", "folder"] as const) {
      const t = setup()
      const { path, revision } = await create(t)
      t.write("outputs/charts/unrelated.txt", "keep me")
      const listing = t.tree()
      t.setProbe((step, file) => { if (step === "commit" && (at === "folder" ? /^revenue-[0-9a-f]{16}$/.test(file!) : file === at)) throw new Error("disk full") })
      const error = await t.refusal("update", { documentPath: path, expectedRevision: revision, patch: { appearance: { theme: "dark" } } })
      expect(error.code).toBe("OUTPUT_WRITE_FAILED")
      expect(error.detail).toContain("no generation was published")
      expect(error.detail).toContain(at === "folder" ? "failed at revenue-" : `failed at ${at}`)
      expect(t.tree()).toEqual(listing)
    }
  })

  test("A31: the same update made twice at once publishes one generation; both results name it", async () => {
    const t = setup()
    const { path, revision } = await create(t)
    const input = { documentPath: path, expectedRevision: revision, patch: { appearance: { theme: "dark" } } }
    const [a, b] = await Promise.all([t.call("update", input), t.call("update", input)])
    expect(a.generation.directory).toBe(b.generation.directory)
    expect([a.generation.reused, b.generation.reused].sort()).toEqual([false, true])
    expect(Object.keys(t.tree()).filter(p => p.includes(".tmp"))).toEqual([])
  })

  test("A31: a folder of that name with other content is a collision: refused, and never overwritten", async () => {
    const t = setup()
    const { path, revision } = await create(t)
    const input = { documentPath: path, expectedRevision: revision, patch: { appearance: { theme: "dark" } } }
    const first = await t.call("update", input)
    const svg = join(t.dir, first.files.svg)
    writeFileSync(svg, "<svg>not this chart</svg>")
    const listing = t.tree()
    const error = await t.refusal("update", input)
    expect(error.code).toBe("OUTPUT_WRITE_FAILED")
    expect(error.detail).toContain(`${first.generation.directory} already exists and does not hold this chart's files`)
    expect(t.tree()).toEqual(listing)
    // An extra file in the folder is a collision too; a hidden one is not part of a generation.
    rmSync(join(t.dir, first.generation.directory), { recursive: true })
    await t.call("update", input)
    t.write(`${first.generation.directory}/notes.txt`, "mine")
    expect((await t.refusal("update", input)).code).toBe("OUTPUT_WRITE_FAILED")
    rmSync(join(t.dir, first.generation.directory, "notes.txt"))
    t.write(`${first.generation.directory}/.DS_Store`, "")
    expect((await t.call("update", input)).generation.reused).toBe(true)
  })

  test("an update of an update writes a further generation; every earlier one stays as it was", async () => {
    const t = setup()
    const { path, revision } = await create(t)
    const one = await t.call("update", { documentPath: path, expectedRevision: revision, patch: { appearance: { theme: "dark" } } })
    const snapshot = Object.fromEntries(Object.entries(t.tree()).filter(([p]) => p.startsWith(one.generation.directory)))
    const two = await t.call("update", { documentPath: one.files.document, expectedRevision: one.revision, patch: { layout: { target: "paper" } } })
    expect(two.generation.directory).not.toBe(one.generation.directory)
    expect(two.update.from).toEqual({ documentPath: one.files.document, revision: one.revision })
    expect(Object.fromEntries(Object.entries(t.tree()).filter(([p]) => p.startsWith(one.generation.directory)))).toEqual(snapshot)
    expect(existsSync(join(t.dir, path))).toBe(true)
  })
})

describe("charts_update: access", () => {
  test("A32: it is a writer under every access value: allowed, asked, or denied with the other writers", () => {
    expect(defaultRules("all")).toContainEqual({ action: "charts_update", resource: "*", effect: "allow" })
    expect(defaultRules("ask-changes")).toContainEqual({ action: "charts_update", resource: "*", effect: "ask" })
    expect(defaultRules("read-only")).toContainEqual({ action: "charts_update", resource: "*", effect: "deny" })
  })
})
