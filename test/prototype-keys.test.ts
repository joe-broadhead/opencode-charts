// Prototype keys (__proto__, constructor, prototype) in JSON input: refused with a code and a path everywhere JSON
// comes in, never dropped by a copy. A dropped key would leave the canonical text, and so the revision, unchanged while
// the raw object carried it on to replay and rendering.
import { describe, expect, test } from "bun:test"
import { applyTransforms } from "../src/data.ts"
import { ChartsError } from "../src/errors.ts"
import { canonicalJson, canonicalValue, parseArtifact, parseDocument, prepareDocument, replayArtifact, serializeArtifact, type ChartArtifactV1, type CreationEnvironment } from "../src/document/index.ts"
import { checkSpec } from "../src/safety.ts"
import { builtinThemes } from "../src/themes/store.ts"

const env: CreationEnvironment = { locale: "en-US", seed: 1, theme: { name: "light", tokens: builtinThemes().light! }, fonts: [], generator: { plugin: "0.0.0", engines: {} }, transform: (rows, t) => applyTransforms(rows, t) as never }
function refusal(fn: () => unknown): ChartsError {
  try { fn() } catch (error) { if (error instanceof ChartsError) return error; throw error }
  throw new Error("expected a refusal")
}
const KEYS = ["__proto__", "constructor", "prototype"]
const bar = (rows: unknown) => ({ version: 1, chart: { kind: "recipe", recipe: "bar", data: { rows }, bindings: { category: "c", value: "v" } } })

async function saved(): Promise<{ artifact: ChartArtifactV1; text: string }> {
  const { artifact } = await prepareDocument(bar([{ c: "a", v: 1 }]), undefined, env)
  return { artifact, text: serializeArtifact(artifact) }
}

describe("prototype keys", () => {
  test("canonical JSON refuses them with a path instead of dropping them", () => {
    for (const key of KEYS) {
      const value = JSON.parse(`{"a":1,"rows":[{"${key}":{"x":1},"b":2}]}`)
      const e = refusal(() => canonicalValue(value))
      expect(e).toMatchObject({ code: "DATA_INVALID", path: `/rows/0/${key}` })
      expect(() => canonicalJson(value)).toThrow(ChartsError)
    }
  })

  test("a document with one in a row, a spec or anywhere else is refused, not stripped", () => {
    for (const key of KEYS) {
      expect(refusal(() => parseDocument(JSON.parse(`{"version":1,"chart":{"kind":"recipe","recipe":"bar","data":{"rows":[{"c":"a","v":1,"${key}":{"p":1}}]},"bindings":{"category":"c","value":"v"}}}`)))).toMatchObject({ code: "DOCUMENT_INVALID", path: `/chart/data/rows/0/${key}` })
      expect(refusal(() => parseDocument(JSON.parse(`{"version":1,"chart":{"kind":"engine","spec":{"mark":"bar","encoding":{"${key}":{}}}}}`)))).toMatchObject({ code: "DOCUMENT_INVALID", path: `/chart/spec/encoding/${key}` })
      expect(refusal(() => parseDocument(JSON.parse(`{"version":1,"${key}":{},"chart":{"kind":"engine","spec":{"mark":"bar"}}}`)))).toMatchObject({ code: "DOCUMENT_INVALID", path: `/${key}` })
    }
  })

  test("the spec safety check refuses them on the raw render path too", () => {
    for (const key of KEYS) {
      expect(refusal(() => checkSpec(JSON.parse(`{"mark":"bar","encoding":{"x":{"${key}":{"field":"a"}}}}`), "vega-lite"))).toMatchObject({ code: "SPEC_UNSAFE", path: `/encoding/x/${key}` })
    }
  })

  test("a saved artifact with one injected keeps its revision string but is refused, in rows and in a spec", async () => {
    const { text } = await saved()
    const injected = text.replace('{"c":"a","v":1}', '{"__proto__":{"polluted":true},"c":"a","v":1}')
    expect(injected).not.toBe(text)
    expect(refusal(() => parseArtifact(injected))).toMatchObject({ code: "ARTIFACT_INVALID", path: "/document/chart/data/rows/0/__proto__" })
    const engine = serializeArtifact((await prepareDocument({ version: 1, chart: { kind: "engine", spec: { mark: "bar", encoding: {} } } }, undefined, env)).artifact)
    expect(refusal(() => parseArtifact(engine.replace('"encoding":{}', '"encoding":{"constructor":{"x":1}}')))).toMatchObject({ code: "ARTIFACT_INVALID", path: "/document/chart/spec/encoding/constructor" })
  })

  test("parseArtifact returns the canonical parsed value, not the raw envelope", async () => {
    const { artifact, text } = await saved()
    // The same content with its keys in another order: the result is the canonical form.
    const reordered = JSON.stringify(Object.fromEntries(Object.entries(JSON.parse(text)).reverse()))
    const parsed = parseArtifact(reordered)
    expect(JSON.stringify(parsed)).toBe(canonicalJson(artifact))
    expect(Object.getPrototypeOf(parsed.document.chart.data!.rows[0])).toBe(Object.prototype)
  })

  test("replay refuses an artifact object carrying one, even with a matching revision", async () => {
    const { text } = await saved()
    const raw = JSON.parse(text.replace('{"c":"a","v":1}', '{"__proto__":{"x":1},"c":"a","v":1}')) as ChartArtifactV1
    expect(Object.keys(raw.document.chart.data!.rows[0]!)).toContain("__proto__")
    const e = await replayArtifact(raw, env.transform).then(() => undefined, (error: unknown) => error)
    expect(e).toMatchObject({ code: "DATA_INVALID", path: "/document/chart/data/rows/0/__proto__" })
  })
})
