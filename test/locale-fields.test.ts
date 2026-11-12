// A chart document's locale and currency use the legacy tools' own field schemas, and the currency the same table the
// renderer formats with, so a document accepts what a legacy call accepts and refuses an unknown currency up front.
import { describe, expect, test } from "bun:test"
import * as z from "zod"
import { ChartDocumentV1Schema, DocumentInvalid, parseDocument } from "../src/document/index.ts"
import { CURRENCY_FIELD, CURRENCY_SYMBOLS, LOCALE_FIELD } from "../src/locale-fields.ts"
import { resolveLocale } from "../src/locale.ts"
import { INPUTS } from "../src/registry.ts"
import { ROOT } from "./helpers.ts"

const doc = (extra: Record<string, unknown>) => ({ version: 1, chart: { kind: "engine", spec: { mark: "bar" } }, ...extra })
const pathsOf = (value: unknown) => { try { parseDocument(value); return [] } catch (e) { if (e instanceof DocumentInvalid) return e.issues.map(i => i.path); throw e } }
const shape = (schema: z.ZodType) => (schema as z.ZodObject).shape as Record<string, z.ZodType>

describe("locale and currency", () => {
  test("the legacy tools and the document share one field schema each", () => {
    for (const tool of ["render", "quick", "validate"] as const) {
      expect(shape(INPUTS[tool]).locale).toBe(LOCALE_FIELD)
      expect(shape(INPUTS[tool]).currency).toBe(CURRENCY_FIELD)
    }
    expect(shape(ChartDocumentV1Schema).locale).toBe(LOCALE_FIELD)
  })

  test("a locale the legacy call accepts, the document accepts; one it refuses, the document refuses", () => {
    for (const locale of ["de", "en-GB", "pt-BR", "x".repeat(16)]) {
      expect(LOCALE_FIELD.safeParse(locale).success).toBe(true)
      expect(pathsOf(doc({ locale }))).toEqual([])
    }
    expect(pathsOf(doc({ locale: "x".repeat(17) }))).toEqual(["/locale"])
    expect(pathsOf(doc({ locale: 5 }))).toEqual(["/locale"])
  })

  test("the currency is three letters and one the renderer formats, in any case", () => {
    for (const currency of ["EUR", "usd", "Gbp"]) {
      expect(pathsOf(doc({ currency }))).toEqual([])
      expect(() => resolveLocale(ROOT, "en-US", currency)).not.toThrow()
    }
    for (const currency of ["XYZ", "EURO", "EU"]) expect(pathsOf(doc({ currency }))).toEqual(["/currency"])
    expect(() => resolveLocale(ROOT, "en-US", "XYZ")).toThrow("CURRENCY_UNKNOWN")
    expect(Object.keys(CURRENCY_SYMBOLS)).toContain("EUR")
  })
})
