// Nesting depth: rows, specs and metadata are held to LIMITS.depth, checked without recursion before anything recursive
// reads them, so a deeply nested value under the size cap is a coded refusal and never a stack overflow.
import { describe, expect, test } from "bun:test"
import { applyTransforms } from "../src/data.ts"
import { ChartsError } from "../src/errors.ts"
import { canonicalRows, canonicalValue, parseArtifact, parseDocument, prepareDocument, serializeArtifact, type CreationEnvironment } from "../src/document/index.ts"
import { LIMITS } from "../src/safety.ts"
import { builtinThemes } from "../src/themes/store.ts"

const env: CreationEnvironment = { locale: "en-US", seed: 1, theme: { name: "light", tokens: builtinThemes().light! }, fonts: [], generator: { plugin: "0.0.0", engines: {} }, transform: (rows, t) => applyTransforms(rows, t) as never }
/** `levels` objects, one inside the other, built without recursion. */
function nested(levels: number): Record<string, unknown> {
  let value: Record<string, unknown> = { leaf: 1 }
  for (let i = 1; i < levels; i++) value = { a: value }
  return value
}
const deepText = (levels: number) => `${'{"a":'.repeat(levels)}1${"}".repeat(levels)}`
function refusal(fn: () => unknown): ChartsError {
  try { fn() } catch (error) { if (error instanceof ChartsError) return error; throw error }
  throw new Error("expected a refusal")
}
const bar = (rows: unknown) => ({ version: 1, chart: { kind: "recipe", recipe: "bar", data: { rows }, bindings: { category: "c", value: "v" } } })

describe("nesting depth", () => {
  test("canonical JSON refuses a 100,000-deep value with a code, not a RangeError", () => {
    expect(refusal(() => canonicalValue(nested(100_000))).code).toBe("DATA_INVALID")
  })

  test("a captured row is held to LIMITS.depth", () => {
    expect(() => canonicalRows([{ c: "a", v: 1, d: nested(10) }])).not.toThrow()
    const e = refusal(() => canonicalRows([{ c: "a", v: 1 }, { c: "b", v: 2, d: nested(LIMITS.depth + 5) }]))
    expect(e.code).toBe("DATA_INVALID")
    expect(e.path).toStartWith("/chart/data/rows/1/d")
  })

  test("a document with a 100,000-deep row is refused when parsed, and when prepared", async () => {
    expect(refusal(() => parseDocument(bar([{ c: "a", v: 1, d: nested(100_000) }]))).code).toBe("DOCUMENT_INVALID")
    // Within the document's overall allowance, but deeper than a row may be.
    const e = await prepareDocument(bar([{ c: "a", v: 1, d: nested(LIMITS.depth + 2) }]), undefined, env).then(() => undefined, (error: unknown) => error)
    expect(e).toMatchObject({ code: "DATA_INVALID" })
  })

  test("a saved artifact with a deep row, spec or metadata value is refused with a code", async () => {
    const text = serializeArtifact((await prepareDocument(bar([{ c: "a", v: 1 }]), undefined, env)).artifact)
    // Far beyond any limit, still under the artifact's size cap.
    const huge = text.replace('{"c":"a","v":1}', `{"c":"a","d":${deepText(100_000)},"v":1}`)
    expect(refusal(() => parseArtifact(huge)).code).toBe("ARTIFACT_INVALID")
    // Within the document's overall allowance, but deeper than a row may be.
    const row = refusal(() => parseArtifact(text.replace('{"c":"a","v":1}', `{"c":"a","d":${deepText(LIMITS.depth + 3)},"v":1}`)))
    expect(row.code).toBe("ARTIFACT_INVALID")
    expect(row.path).toStartWith("/document/chart/data/rows/0/d")
    const meta = refusal(() => parseArtifact(text.replace('"recipeOptions":{', `"recipeOptions":{"deep":${deepText(LIMITS.depth)},`)))
    expect(meta.code).toBe("ARTIFACT_INVALID")
    expect(meta.message).toContain("metadata")
    const engine = serializeArtifact((await prepareDocument({ version: 1, chart: { kind: "engine", spec: { mark: "bar", encoding: {} } } }, undefined, env)).artifact)
    expect(refusal(() => parseArtifact(engine.replace('"encoding":{}', `"encoding":${deepText(LIMITS.depth + 3)}`))).code).toBe("ARTIFACT_INVALID")
  })
})
