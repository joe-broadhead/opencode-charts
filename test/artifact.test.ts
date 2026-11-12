// The saved artifact: capture before transforms, authored intent apart from captured defaults, a deterministic
// revision over exactly the listed inputs, strict size-limited reading, and replay that uses what was captured.
import { describe, expect, test } from "bun:test"
import { applyTransforms } from "../src/data.ts"
import { ChartsError } from "../src/errors.ts"
import {
  ARTIFACT_LIMITS, DocumentInvalid, parseArtifact, prepareDocument, renderFingerprint, replayArtifact, serializeArtifact, verifyFontDependencies,
  type ChartArtifactV1, type CreationEnvironment, type FontDependencyV1, type RenderFingerprintInput,
} from "../src/document/index.ts"
import { recipeDefinition } from "../src/recipes/index.ts"
import { builtinThemes } from "../src/themes/store.ts"

type Row = Record<string, unknown>
const LIGHT = { name: "light", tokens: builtinThemes().light! }
const FONT: FontDependencyV1 = { family: "Brand", weight: 400, path: "fonts/brand.ttf", sha256: `sha256:${"a".repeat(64)}`, bytes: 1234 }

/** An environment whose transform runner counts its calls. */
function environment(over: Partial<CreationEnvironment> = {}) {
  const calls: number[] = []
  const env: CreationEnvironment = {
    locale: "en-US", seed: 1, theme: LIGHT, fonts: [], generator: { plugin: "0.0.0", engines: { "vega-lite": "6.5.0", vega: "6.4.0" } },
    transform: (rows, transform) => { calls.push(rows.length); return applyTransforms(rows, transform) as Row[] },
    ...over,
  }
  return { env, calls }
}

const SALES: Row[] = [{ region: "North", revenue: 1 }, { region: "South", revenue: 2 }, { region: "North", revenue: 3 }]
const barDoc = (over: Row = {}, data: Row = { rows: SALES }) => ({ version: 1, chart: { kind: "recipe", recipe: "bar", data, bindings: { category: "region", value: "revenue" }, options: { aggregate: "sum" } }, ...over })
const prepare = async (doc: unknown, over: Partial<CreationEnvironment> = {}, source?: Parameters<typeof prepareDocument>[1]) => (await prepareDocument(doc, source, environment(over).env)).artifact
const clone = (a: ChartArtifactV1): any => JSON.parse(serializeArtifact(a))
function refusal(fn: () => unknown): ChartsError {
  try { fn() } catch (error) { if (error instanceof ChartsError) return error; throw error }
  throw new Error("expected a refusal")
}

describe("capture", () => {
  test("inline rows are captured before the transform, which is kept once; the marks see it applied once", async () => {
    const { env, calls } = environment()
    const doc = barDoc({}, { rows: [{ v: 1, region: "a" }, { region: "b", v: 2 }, { region: "c", v: 3 }], transform: [{ calculate: "datum.v * 10", as: "revenue" }, { filter: "datum.revenue > 10" }] })
    const prepared = await prepareDocument(doc, undefined, env)
    expect(calls).toEqual([3])
    expect(prepared.artifact.document.chart.data).toEqual({ rows: [{ region: "a", v: 1 }, { region: "b", v: 2 }, { region: "c", v: 3 }], transform: [{ as: "revenue", calculate: "datum.v * 10" }, { filter: "datum.revenue > 10" }] })
    expect(prepared.compilation!.values).toEqual([{ region: "b", revenue: 20 }, { region: "c", revenue: 30 }])
    expect(prepared.artifact.provenance).toEqual({})
  })

  test("data.path is replaced by the rows the adapter read; path, format and digest go to provenance", async () => {
    const provenance = { path: "data/sales.csv", format: "csv" as const, sha256: `sha256:${"b".repeat(64)}`, bytes: 99 }
    const artifact = await prepare(barDoc({}, { path: "data/sales.csv" }), {}, { rows: SALES, provenance })
    expect(artifact.document.chart.data).toEqual({ rows: SALES })
    expect(JSON.stringify(artifact.document)).not.toContain("data/sales.csv")
    expect(artifact.provenance).toEqual({ data: provenance })
    const missing = await prepareDocument(barDoc({}, { path: "data/sales.csv" }), undefined, environment().env).catch(e => e)
    expect(missing.code).toBe("DATA_MISSING")
  })

  test("an engine document keeps its raw spec and inline datasets as written, and gets no recipe metadata", async () => {
    const spec = { $schema: "https://vega.github.io/schema/vega-lite/v6.json", mark: "bar", data: { name: "sales" }, encoding: { x: { field: "region", type: "nominal" }, y: { field: "revenue", type: "quantitative" } }, config: { mark: { color: "#ff0000" } } }
    const artifact = await prepare({ version: 1, chart: { kind: "engine", spec, data: { rows: SALES, name: "sales" } }, layout: { mode: "native" } })
    expect(artifact.document.chart).toEqual({ kind: "engine", spec, data: { rows: SALES, name: "sales" } } as never)
    expect(artifact.captured.defaults).toEqual({ locale: "en-US", seed: 1 })
    expect(artifact.captured.categories).toBeUndefined()
    expect(artifact.document.interactions).toBeUndefined()
    const inline = await prepare({ version: 1, chart: { kind: "engine", spec: { mark: "bar", data: { values: SALES }, encoding: {} } } })
    expect((inline.document.chart as any).spec.data.values).toEqual(SALES)
    expect(inline.document.chart.data).toBeUndefined()
  })
})

describe("authored intent and captured defaults stay apart", () => {
  test("omitted interactions, layout, locale, seed and options are captured as defaults, not written into the document", async () => {
    const artifact = await prepare(barDoc())
    const doc = artifact.document as any
    expect(doc.interactions).toBeUndefined()
    expect(doc.layout).toBeUndefined()
    expect(doc.locale).toBeUndefined()
    expect(doc.seed).toBeUndefined()
    expect(doc.chart.options).toEqual({ aggregate: "sum" })
    expect(artifact.captured.defaults).toEqual({
      locale: "en-US", seed: 1, recipeOptions: { sort: "input" },
      layout: { profile: "inline", profileVersion: 1, mode: "responsive", width: 720, height: 420, minLabelSize: 11 },
      interactions: { tooltip: "auto", legend: "static", zoom: "none", brush: "none" },
    })
    const settings = (await replayArtifact(artifact, environment().env.transform)).settings
    expect(settings.explicitInteractions).toEqual([])
    expect(settings.interactions).toEqual({ tooltip: "auto", legend: "static", zoom: "none", brush: "none" })
  })

  test("explicit values stay in the document, even when equal to the default, and are not captured again", async () => {
    const artifact = await prepare(barDoc({ interactions: { tooltip: "auto" }, layout: { target: "report", width: 720 }, locale: "en-US", seed: 1 }))
    expect(artifact.document.interactions).toEqual({ tooltip: "auto" })
    expect(artifact.document.layout).toEqual({ target: "report", width: 720 })
    expect(artifact.captured.defaults).toEqual({
      recipeOptions: { sort: "input" },
      layout: { profile: "report", profileVersion: 1, mode: "fixed", height: 540, minLabelSize: 11 },
      interactions: { legend: "static", zoom: "none", brush: "none" },
    })
    const settings = (await replayArtifact(artifact, environment().env.transform)).settings
    expect(settings.explicitInteractions).toEqual(["tooltip"])
    expect(settings.layout).toEqual({ target: "report", mode: "fixed", width: 720, height: 540, minLabelSize: 11 })
    // Explicit and omitted differ, so the two artifacts differ too.
    expect(artifact.revision).not.toBe((await prepare(barDoc({ layout: { target: "report" }, locale: "en-US", seed: 1 }))).revision)
  })

  test("replay uses the captured defaults and theme; fresh creation resolves the current ones", async () => {
    const dark = { name: "dark", tokens: builtinThemes().dark! }
    const artifact = await prepare(barDoc(), { locale: "de-DE", seed: 7, theme: dark })
    const replayed = await replayArtifact(parseArtifact(serializeArtifact(artifact)), environment().env.transform)
    expect(replayed.settings.locale).toBe("de-DE")
    expect(replayed.settings.seed).toBe(7)
    expect(replayed.settings.theme.tokens.colors.background).toBe(builtinThemes().dark!.colors.background)
    const fresh = await prepareDocument(barDoc(), undefined, environment({ locale: "fr-FR" }).env)
    expect(fresh.settings.locale).toBe("fr-FR")
    expect(fresh.settings.theme.name).toBe("light")
  })
})

describe("A15: transforms run once per compilation, through any number of save/load cycles", () => {
  test("rows are stored before the transform and never accumulate it", async () => {
    // Doubling, then a filter: applied twice it would give 8 and 12, and keep 2.
    const transform = [{ calculate: "datum.v * 2", as: "v" }, { filter: "datum.v > 2" }]
    const doc = { version: 1, chart: { kind: "recipe", recipe: "bar", data: { rows: [{ k: "a", v: 1 }, { k: "b", v: 2 }, { k: "c", v: 3 }], transform }, bindings: { category: "k", value: "v" } } }
    const first = await prepareDocument(doc, undefined, environment().env)
    expect(first.compilation!.values).toEqual([{ k: "b", v: 4 }, { k: "c", v: 6 }])
    let artifact = first.artifact
    for (let cycle = 0; cycle < 4; cycle++) {
      const text = serializeArtifact(artifact)
      artifact = parseArtifact(text, { expectedRevision: first.artifact.revision })
      const { env, calls } = environment()
      const replayed = await replayArtifact(artifact, env.transform)
      expect(calls).toEqual([3])
      expect(replayed.compilation!.values).toEqual([{ k: "b", v: 4 }, { k: "c", v: 6 }])
      expect(artifact.document.chart.data!.rows).toEqual([{ k: "a", v: 1 }, { k: "b", v: 2 }, { k: "c", v: 3 }])
      expect(artifact.document.chart.data!.transform).toEqual([{ as: "v", calculate: "datum.v * 2" }, { filter: "datum.v > 2" }])
      expect(artifact.revision).toBe(first.artifact.revision)
      expect(serializeArtifact(artifact)).toBe(text)
    }
  })

  test("creation and replay compile the same spec and marks", async () => {
    for (const ex of [recipeDefinition("line").examples()[1]!, recipeDefinition("grouped_bar").examples()[0]!, recipeDefinition("pie").examples()[0]!]) {
      const created = await prepareDocument(structuredClone(ex.document), undefined, environment().env)
      const replayed = await replayArtifact(parseArtifact(serializeArtifact(created.artifact)), environment().env.transform)
      expect(JSON.stringify(replayed.compilation!.spec)).toBe(JSON.stringify(created.compilation!.spec))
      expect(replayed.compilation!.values).toEqual(created.compilation!.values)
      expect(replayed.compilation!.options).toEqual(created.compilation!.options)
    }
  })
})

describe("the revision", () => {
  const REVISION = /^sha256:[0-9a-f]{64}$/
  test("same inputs, same revision and bytes, whatever the key order of the input", async () => {
    const a = await prepare(barDoc({ title: "T", appearance: { theme: "light", overrides: { colors: { negative: "#AA0000" } } } }))
    const shuffled = { title: "T", appearance: { overrides: { colors: { negative: "#AA0000" } }, theme: "light" }, chart: { options: { aggregate: "sum" }, bindings: { value: "revenue", category: "region" }, data: { rows: SALES.map(r => ({ revenue: r.revenue, region: r.region })) }, recipe: "bar", kind: "recipe" }, version: 1 }
    const b = await prepare(shuffled)
    expect(a.revision).toMatch(REVISION)
    expect(b.revision).toBe(a.revision)
    expect(serializeArtifact(b)).toBe(serializeArtifact(a))
  })

  test("every listed input changes it: document, data, transform, defaults, theme base, colour domain, fonts", async () => {
    const base = await prepare(barDoc())
    const changed = await Promise.all([
      prepare(barDoc({ title: "New" })),
      prepare(barDoc({}, { rows: [{ region: "North", revenue: 1 }, { region: "South", revenue: 2 }, { region: "North", revenue: 4 }] })),
      prepare(barDoc({}, { rows: [...SALES].reverse() })),
      prepare(barDoc({}, { rows: SALES, transform: [{ filter: "true" }] })),
      prepare(barDoc({ interactions: { tooltip: "off" } })),
      prepare(barDoc(), { locale: "de-DE" }),
      prepare(barDoc(), { seed: 2 }),
      prepare(barDoc(), { theme: { name: "light", tokens: { ...LIGHT.tokens, colors: { ...LIGHT.tokens.colors, negative: "#000000" } } } }),
      prepare(barDoc(), { fonts: [FONT] }),
      prepare(barDoc(), { fonts: [{ ...FONT, sha256: `sha256:${"c".repeat(64)}` }] }),
    ])
    const revisions = changed.map(a => a.revision)
    expect(new Set([base.revision, ...revisions]).size).toBe(revisions.length + 1)
    // The colour domain is part of it: same document and rows, different captured domain.
    const series = { version: 1, chart: { kind: "recipe", recipe: "scatter", data: { rows: [{ x: 1, y: 1, s: "a" }] }, bindings: { x: "x", y: "y", series: "s" } } }
    const withDomain = clone(await prepare(series))
    withDomain.captured.categories.domain = ["a", "b"]
    expect(refusal(() => parseArtifact(JSON.stringify(withDomain))).code).toBe("DOCUMENT_REVISION_MISMATCH")
  })

  test("excluded inputs do not: provenance, a changed source file, generator versions, font path, output names", async () => {
    const provenance = (sha: string) => ({ rows: SALES, provenance: { path: "data/a.csv", format: "csv" as const, sha256: `sha256:${sha.repeat(64)}`, bytes: 10 } })
    const base = await prepare(barDoc(), { fonts: [FONT] })
    const fromFile = await prepare(barDoc({}, { path: "data/a.csv" }), { fonts: [FONT] }, provenance("d"))
    const changedFile = await prepare(barDoc({}, { path: "data/other.csv" }), { fonts: [FONT] }, provenance("e"))
    const newRelease = await prepare(barDoc(), { fonts: [{ ...FONT, path: "brand/moved.ttf" }], generator: { plugin: "9.9.9", engines: { "vega-lite": "7.0.0" } } })
    expect(fromFile.revision).toBe(base.revision)
    expect(changedFile.revision).toBe(base.revision)
    expect(newRelease.revision).toBe(base.revision)
    expect(JSON.stringify(base)).not.toMatch(/"ms"|time|\/home\/|\/Users\//)
  })
})

describe("reading a saved artifact (A17)", () => {
  test("round trip: what was written is what is read", async () => {
    const artifact = await prepare(barDoc({ appearance: { theme: "light" } }))
    expect(parseArtifact(serializeArtifact(artifact))).toEqual(clone(artifact))
    expect(parseArtifact(new TextEncoder().encode(serializeArtifact(artifact))).revision).toBe(artifact.revision)
  })

  test("edited content or an edited revision string is DOCUMENT_REVISION_MISMATCH; the stored string is never trusted", async () => {
    const artifact = await prepare(barDoc())
    const edited = clone(artifact)
    edited.document.chart.data.rows[0].revenue = 1000
    expect(refusal(() => parseArtifact(JSON.stringify(edited)))).toMatchObject({ code: "DOCUMENT_REVISION_MISMATCH", path: "/revision" })
    const relabelled = clone(artifact)
    relabelled.revision = `sha256:${"0".repeat(64)}`
    expect(refusal(() => parseArtifact(JSON.stringify(relabelled))).code).toBe("DOCUMENT_REVISION_MISMATCH")
    const defaults = clone(artifact)
    defaults.captured.defaults.locale = "de-DE"
    expect(refusal(() => parseArtifact(JSON.stringify(defaults))).code).toBe("DOCUMENT_REVISION_MISMATCH")
  })

  test("expectedRevision is a read precondition, checked against the recomputed revision", async () => {
    const artifact = await prepare(barDoc())
    expect(parseArtifact(serializeArtifact(artifact), { expectedRevision: artifact.revision }).revision).toBe(artifact.revision)
    const stale = refusal(() => parseArtifact(serializeArtifact(artifact), { expectedRevision: `sha256:${"f".repeat(64)}` }))
    expect(stale).toMatchObject({ code: "DOCUMENT_REVISION_MISMATCH", path: "/expectedRevision" })
    expect(refusal(() => parseArtifact(serializeArtifact(artifact), { expectedRevision: "abc" })).code).toBe("DOCUMENT_INVALID")
  })

  test("unknown future versions of the envelope or the document are refused, never downgraded", async () => {
    const artifact = await prepare(barDoc())
    const envelope = clone(artifact)
    envelope.version = 2
    envelope.newField = true
    const e = refusal(() => parseArtifact(JSON.stringify(envelope)))
    expect(e).toMatchObject({ code: "DOCUMENT_VERSION_UNSUPPORTED", path: "/version" })
    expect(e.message).toContain("version 1 only")
    const doc = clone(artifact)
    doc.document.version = 2
    expect(refusal(() => parseArtifact(JSON.stringify(doc)))).toMatchObject({ code: "DOCUMENT_VERSION_UNSUPPORTED", path: "/document/version" })
  })

  test("a resolved engine spec (.vl.json) is not a document", () => {
    const e = refusal(() => parseArtifact(JSON.stringify({ $schema: "https://vega.github.io/schema/vega-lite/v6.json", mark: "bar", config: {} })))
    expect(e).toMatchObject({ code: "ARTIFACT_INVALID", path: "/format" })
    expect(e.hint).toContain(".vl.json")
  })

  test("size is checked before parsing, and each section under its own limit", async () => {
    const huge = " ".repeat(ARTIFACT_LIMITS.totalBytes + 1)
    const e = refusal(() => parseArtifact(huge))
    expect(e.code).toBe("ARTIFACT_INVALID")
    expect(e.message).toContain("bytes, over the")
    expect(refusal(() => parseArtifact("{not json")).message).toContain("not valid JSON")
    const artifact = clone(await prepare(barDoc()))
    artifact.document.chart.data.rows = Array.from({ length: ARTIFACT_LIMITS.dataRows + 1 }, () => ({}))
    expect(refusal(() => parseArtifact(JSON.stringify(artifact)))).toMatchObject({ code: "DATA_TOO_LARGE", path: "/document/chart/data/rows" })
    const meta = clone(await prepare(barDoc()))
    meta.generator.engines = Object.fromEntries(Array.from({ length: 20000 }, (_, i) => [`engine${i}`, "x".repeat(30)]))
    expect(refusal(() => parseArtifact(JSON.stringify(meta))).message).toContain("metadata")
    const engine = clone(await prepare({ version: 1, chart: { kind: "engine", spec: { mark: "bar" } } }))
    engine.document.chart.spec.description = "x".repeat(ARTIFACT_LIMITS.specBytes)
    expect(refusal(() => parseArtifact(JSON.stringify(engine)))).toMatchObject({ code: "SPEC_TOO_LARGE", path: "/document/chart/spec" })
  })

  test("the envelope and the document are strict: unknown keys fail with their path", async () => {
    const artifact = await prepare(barDoc())
    const envelope = clone(artifact)
    envelope.extra = 1
    expect(refusal(() => parseArtifact(JSON.stringify(envelope))).code).toBe("ARTIFACT_INVALID")
    const doc = clone(artifact)
    doc.document.chart.bindings.extra = "x"
    const e = refusal(() => parseArtifact(JSON.stringify(doc)))
    expect(e).toBeInstanceOf(DocumentInvalid)
    expect((e as DocumentInvalid).issues[0]!.path).toBe("/document/chart/bindings/extra")
    const path = clone(artifact)
    path.document.chart.data = { path: "data/x.csv" }
    const p = refusal(() => parseArtifact(JSON.stringify(path))) as DocumentInvalid
    expect(p.issues.map(i => i.path)).toContain("/document/chart/data/path")
    expect(p.issues.find(i => i.path === "/document/chart/data/path")!.fix).toContain("provenance")
  })

  test("captured state must fit the document", async () => {
    const artifact = await prepare(barDoc())
    const overlap = clone(artifact)
    overlap.captured.defaults.recipeOptions.aggregate = "none"
    expect(refusal(() => parseArtifact(JSON.stringify(overlap)))).toMatchObject({ code: "ARTIFACT_INVALID", path: "/captured/defaults/recipeOptions/aggregate" })
    const series = clone(await prepare({ version: 1, chart: { kind: "recipe", recipe: "scatter", data: { rows: [{ x: 1, y: 1, s: "a" }] }, bindings: { x: "x", y: "y", series: "s" } } }))
    series.captured.categories.domain = ["a", "a"]
    expect(refusal(() => parseArtifact(JSON.stringify(series))).code).toBe("ARTIFACT_INVALID")
    delete series.captured.categories
    expect(refusal(() => parseArtifact(JSON.stringify(series))).code).toBe("ARTIFACT_INVALID")
  })
})

describe("dependencies and the render fingerprint", () => {
  test("a custom font whose bytes changed is DOCUMENT_DEPENDENCY_CHANGED; the same bytes pass", () => {
    expect(() => verifyFontDependencies([FONT], () => FONT.sha256)).not.toThrow()
    const e = refusal(() => verifyFontDependencies([FONT], () => `sha256:${"9".repeat(64)}`))
    expect(e).toMatchObject({ code: "DOCUMENT_DEPENDENCY_CHANGED", path: "/captured/fonts/0" })
    expect(e.hint).toContain("create a new document")
  })

  const digest = (c: string) => `sha256:${c.repeat(64)}`
  const INPUT: RenderFingerprintInput = {
    revision: digest("1"), plugin: "0.0.0", recipeCompiler: 1,
    renderers: { "vega-lite": "6.5.0", vega: "6.4.0", echarts: "6.1.0", resvg: "2.6.2" },
    runtimeAssets: { "browser/vega.js": digest("2"), "browser/echarts.js": digest("6"), "resvg.wasm": digest("7") },
    viewport: { width: 720, height: 420, mode: "responsive" }, formats: ["svg", "png", "spec", "document"], scales: [2, 1], fonts: [{ family: "Inter", weight: 400, sha256: digest("3") }],
    svgText: "text", marks: "problems", inspect: false, preview: true, name: "revenue", platform: "linux-x64",
  }
  test("every input that changes bundle bytes or membership changes it", () => {
    const base = renderFingerprint(INPUT)
    expect(base).toMatch(/^sha256:[0-9a-f]{64}$/)
    const variants: Partial<RenderFingerprintInput>[] = [
      { revision: digest("4") }, { plugin: "0.0.1" }, { recipeCompiler: 2 }, { renderers: { ...INPUT.renderers, vega: "6.4.1" } }, { renderers: { ...INPUT.renderers, resvg: "2.6.3" } },
      { runtimeAssets: { ...INPUT.runtimeAssets, "browser/vega.js": digest("5") } }, { runtimeAssets: { ...INPUT.runtimeAssets, "resvg.wasm": digest("8") } },
      { viewport: { width: 721, height: 420, mode: "responsive" } }, { viewport: { width: 720, height: 420, mode: "fixed" } }, { formats: ["svg", "png", "spec", "document", "html"] },
      { scales: [1, 2] }, { scales: [2] }, { fonts: [] }, { svgText: "embed" }, { marks: "all" }, { inspect: true }, { preview: false }, { name: "revenue-2" }, { platform: "darwin-arm64" },
    ]
    const all = variants.map(v => renderFingerprint({ ...INPUT, ...v }))
    expect(new Set([base, ...all]).size).toBe(variants.length + 1)
  })
  test("formats are a set; the revision must be a revision", () => {
    expect(renderFingerprint({ ...INPUT, formats: ["document", "spec", "png", "svg", "svg"] })).toBe(renderFingerprint(INPUT))
    expect(refusal(() => renderFingerprint({ ...INPUT, revision: "x" })).code).toBe("DOCUMENT_INVALID")
  })
  test("the input is strict: unknown, missing or malformed renderer and asset entries are refused with their path", () => {
    const bad: [unknown, string][] = [
      [{ ...INPUT, renderers: { ...INPUT.renderers, plotly: "1.0" } }, "/renderers"],
      [{ ...INPUT, renderers: { "vega-lite": "6.5.0", vega: "6.4.0", resvg: "2.6.2" } }, "/renderers/echarts"],
      [{ ...INPUT, runtimeAssets: { ...INPUT.runtimeAssets, "browser/vega.js": "abc" } }, "/runtimeAssets/browser~1vega.js"],
      [{ ...INPUT, runtimeAssets: { ...INPUT.runtimeAssets, "extra.js": digest("9") } }, "/runtimeAssets"],
      [{ ...INPUT, recipeCompiler: undefined }, "/recipeCompiler"],
      [{ ...INPUT, scales: [4] }, "/scales/0"],
      [{ ...INPUT, formats: ["gif"] }, "/formats/0"],
      [{ ...INPUT, timing: 12 }, "/"],
    ]
    for (const [input, path] of bad) expect(refusal(() => renderFingerprint(input as RenderFingerprintInput))).toMatchObject({ code: "DOCUMENT_INVALID", path })
  })
})
