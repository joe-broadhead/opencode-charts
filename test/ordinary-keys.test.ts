// `constructor` and `prototype` are ordinary data keys: a legacy raw spec and a chart document with such columns
// render, keep a stable revision, and never read Object.prototype members in their place. Only `__proto__`, which a
// copy would drop, is refused, in every place JSON comes in.
import { afterAll, describe, expect, test } from "bun:test"
import { applyTransforms, profile } from "../src/data.ts"
import { closeVegaWorker } from "../src/engines/vega-pool.ts"
import { ChartsError } from "../src/errors.ts"
import { canonicalJson, canonicalValue, parseArtifact, parseDocument, prepareDocument, replayArtifact, serializeArtifact, type CreationEnvironment } from "../src/document/index.ts"
import { renderChart } from "../src/pipeline.ts"
import { compileRecipe } from "../src/recipes/index.ts"
import { checkSpec } from "../src/safety.ts"
import { builtinThemes } from "../src/themes/store.ts"
import { workspace } from "./helpers.ts"

const ws = workspace()
afterAll(async () => { ws.cleanup(); await closeVegaWorker() })
const env: CreationEnvironment = { locale: "en-US", seed: 1, theme: { name: "light", tokens: builtinThemes().light! }, fonts: [], generator: { plugin: "0.0.0", engines: {} }, transform: (rows, t) => applyTransforms(rows, t) as never }
const ROWS = [{ constructor: "Acme", prototype: 3 }, { constructor: "Bolt", prototype: 5 }, { constructor: "Acme", prototype: 4 }]
function refusal(fn: () => unknown): ChartsError {
  try { fn() } catch (error) { if (error instanceof ChartsError) return error; throw error }
  throw new Error("expected a refusal")
}

describe("constructor and prototype are ordinary keys", () => {
  // Vega itself cannot encode a field named "constructor" (an internal lookup; the same at the baseline commit): such
  // a spec fails in the engine with SPEC_INVALID, as before, and never as SPEC_UNSAFE. Carrying the column, and encoding
  // "prototype", work.
  const ROWS2 = ROWS.map(r => ({ ...r, maker: r.constructor }))
  test("a legacy raw Vega-Lite spec with those columns inline renders, as before", async () => {
    for (const aggregate of [undefined, "sum"]) {
      const spec = { mark: "bar", data: { values: ROWS2 }, encoding: { x: { field: "maker", type: "nominal" }, y: { field: "prototype", type: "quantitative", ...(aggregate ? { aggregate } : {}) } } }
      expect(() => checkSpec(spec, "vega-lite")).not.toThrow()
      const r = await renderChart({ spec, formats: ["svg"] }, ws.env, false)
      expect(r.issues.filter(i => i.level === "error")).toEqual([])
      expect(r.svg).toContain("Acme")
      const viaRows = await renderChart({ spec: { ...spec, data: { name: "table" } }, data: { rows: ROWS2 }, formats: ["svg"] }, ws.env, false)
      expect(viaRows.svg).toContain("Bolt")
    }
    const encoded = { mark: "bar", data: { values: ROWS }, encoding: { x: { field: "constructor", type: "nominal" }, y: { field: "prototype", type: "quantitative" } } }
    expect(() => checkSpec(encoded, "vega-lite")).not.toThrow()
    const e = await renderChart({ spec: encoded, formats: ["svg"] }, ws.env, false).then(() => undefined, (error: unknown) => error)
    expect(e).toMatchObject({ code: "SPEC_INVALID" })
  })

  test("a recipe document with those columns captures, aggregates and renders them", async () => {
    const doc = { version: 1, chart: { kind: "recipe", recipe: "bar", data: { rows: ROWS2 }, bindings: { category: "maker", value: "prototype" }, options: { aggregate: "sum" } } }
    const prepared = await prepareDocument(doc, undefined, env)
    expect(prepared.compilation!.values).toEqual([{ maker: "Acme", prototype: 7 }, { maker: "Bolt", prototype: 5 }])
    expect(prepared.artifact.document.chart.data!.rows).toEqual(ROWS2)
    for (const row of prepared.compilation!.values) expect(Object.getPrototypeOf(row)).toBe(Object.prototype)
    const r = await renderChart({ spec: prepared.compilation!.spec as never, data: { rows: prepared.compilation!.values as never }, formats: ["svg"] }, ws.env, false)
    expect(r.issues.filter(i => i.level === "error")).toEqual([])
    expect(r.svg).toContain("Acme")
    // Bound as the category, "constructor" compiles to the right marks (the engine's own limit applies at render).
    const bound = compileRecipe(parseDocument({ ...doc, chart: { ...doc.chart, bindings: { category: "constructor", value: "prototype" } } }).chart as never, ROWS2)
    expect(bound.values).toEqual([{ constructor: "Acme", prototype: 7 }, { constructor: "Bolt", prototype: 5 }])
  })

  test("their revision is stable through save, load, replay and a fresh preparation", async () => {
    const doc = { version: 1, chart: { kind: "recipe", recipe: "scatter", data: { rows: ROWS.map((r, i) => ({ ...r, x: i })) }, bindings: { x: "x", y: "prototype", series: "constructor" } } }
    const first = (await prepareDocument(doc, undefined, env)).artifact
    const again = (await prepareDocument(structuredClone(doc), undefined, env)).artifact
    expect(again.revision).toBe(first.revision)
    let artifact = first
    for (let i = 0; i < 3; i++) artifact = parseArtifact(serializeArtifact(artifact), { expectedRevision: first.revision })
    expect(artifact.document.chart.data!.rows[0]).toEqual({ constructor: "Acme", prototype: 3, x: 0 })
    expect(artifact.captured.categories!.domain).toEqual(["Acme", "Bolt"])
    const replayed = await replayArtifact(artifact, env.transform)
    expect(replayed.compilation!.values.map(v => Object.getOwnPropertyDescriptor(v, "constructor")?.value)).toEqual(["Acme", "Bolt", "Acme"])
    expect(canonicalJson(canonicalValue({ prototype: 1, constructor: 2 }))).toBe('{"constructor":2,"prototype":1}')
  })

  test("a row without the column reads it as missing, never as an inherited member", () => {
    const rows: Record<string, unknown>[] = [{ constructor: "Acme", v: 1 }, { v: 2 }]
    const c = compileRecipe(parseDocument({ version: 1, chart: { kind: "recipe", recipe: "bar", data: { rows }, bindings: { category: "constructor", value: "v" } } }).chart as never, rows)
    expect(c.values).toEqual([{ constructor: "Acme", v: 1 }, { constructor: null, v: 2 }])
    const measure = compileRecipe(parseDocument({ version: 1, chart: { kind: "recipe", recipe: "bar", data: { rows: [] }, bindings: { category: "c", value: "constructor" }, options: { aggregate: "sum" } } }).chart as never, [{ c: "a", constructor: 2 }, { c: "a" }])
    expect(measure.values).toEqual([{ c: "a", constructor: 2 }])
    expect(measure.diagnostics.map(d => d.code)).toEqual(["VALUE_MISSING"])
    // The data profile reads own values too: an absent "constructor" is missing, not a function.
    expect(profile([{ constructor: 1 }, {}]).fields[0]).toMatchObject({ name: "constructor", type: "number", missing: 1 })
  })

  test("an engine document's spec and theme overrides may use them as keys", () => {
    expect(() => parseDocument({ version: 1, chart: { kind: "engine", spec: { mark: "bar", data: { values: ROWS }, encoding: { x: { field: "constructor", type: "nominal" } } } } })).not.toThrow()
  })
})

describe("__proto__ is refused in every place JSON comes in", () => {
  const bar = (rows: unknown, extra = "") => `{"version":1,"chart":{"kind":"recipe","recipe":"bar","data":{"rows":${rows}},"bindings":{"category":"c","value":"v"}${extra}}}`
  const variants: [string, () => unknown, string][] = [
    ["canonical JSON", () => canonicalValue(JSON.parse('{"a":{"__proto__":{"x":1}}}')), "/a/__proto__"],
    ["a document row", () => parseDocument(JSON.parse(bar('[{"c":"a","v":1,"__proto__":{"p":1}}]'))), "/chart/data/rows/0/__proto__"],
    ["a nested row value", () => parseDocument(JSON.parse(bar('[{"c":"a","v":{"w":[{"__proto__":1}]}}]'))), "/chart/data/rows/0/v/w/0/__proto__"],
    ["the bindings", () => parseDocument(JSON.parse(bar('[{"c":"a","v":1}]').replace('"bindings":{', '"bindings":{"__proto__":"x",'))), "/chart/bindings/__proto__"],
    ["a transform", () => parseDocument(JSON.parse(bar('[{"c":"a","v":1}],"transform":[{"__proto__":{}}]'))), "/chart/data/transform/0/__proto__"],
    ["the document root", () => parseDocument(JSON.parse(`{"__proto__":{},${bar("[]").slice(1)}`)), "/__proto__"],
    ["theme overrides", () => parseDocument(JSON.parse(bar('[{"c":"a","v":1}]').replace(/}$/, ',"appearance":{"overrides":{"colors":{"__proto__":{}}}}}'))), "/appearance/overrides/colors/__proto__"],
    ["an engine spec", () => parseDocument(JSON.parse('{"version":1,"chart":{"kind":"engine","spec":{"mark":"bar","encoding":{"__proto__":{}}}}}')), "/chart/spec/encoding/__proto__"],
    ["a legacy spec", () => checkSpec(JSON.parse('{"mark":"bar","data":{"values":[{"__proto__":{"x":1}}]}}'), "vega-lite"), "/data/values/0/__proto__"],
    ["an artifact row", () => parseArtifact(JSON.stringify({ format: "opencode-charts-artifact", version: 1 }).replace(/}$/, ',"document":{"chart":{"data":{"rows":[{"__proto__":1}]}}}}')), "/document/chart/data/rows/0/__proto__"],
    ["artifact metadata", () => parseArtifact('{"format":"opencode-charts-artifact","version":1,"captured":{"defaults":{"__proto__":{}}}}'), "/captured/defaults/__proto__"],
  ]
  test("eleven variants", () => {
    expect(variants).toHaveLength(11)
    for (const [where, run, path] of variants) {
      const e = refusal(run)
      expect({ where, path: e.path, refused: /__proto__/.test(e.message) }).toEqual({ where, path, refused: true })
    }
  })
})
