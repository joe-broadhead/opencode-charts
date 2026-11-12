// Hints for refused properties are looked up as own properties only: an unknown key that happens to be the name of an
// Object.prototype member ("toString", "valueOf", "hasOwnProperty") gets the ordinary fix, never an inherited function.
import { describe, expect, test } from "bun:test"
import { DocumentInvalid, parseDocument } from "../src/document/index.ts"

const BAR = { kind: "recipe", recipe: "bar", data: { rows: [{ c: "a", v: 1 }] }, bindings: { category: "c", value: "v" } }
function issues(doc: unknown) {
  try { parseDocument(doc) } catch (error) { if (error instanceof DocumentInvalid) return { issues: error.issues, message: error.message }; throw error }
  throw new Error("expected a refusal")
}

describe("hint lookups", () => {
  for (const key of ["toString", "valueOf", "hasOwnProperty", "isPrototypeOf", "toLocaleString"]) {
    test(`an unknown "${key}" gets a plain fix at the top level, in the chart, in bindings and in theme overrides`, () => {
      const cases = [
        { version: 1, chart: BAR, [key]: 1 },
        { version: 1, chart: { ...BAR, [key]: 1 } },
        { version: 1, chart: { ...BAR, bindings: { ...BAR.bindings, [key]: "x" } } },
        { version: 1, chart: BAR, appearance: { overrides: { [key]: 1, colors: { [key]: "#fff" } } } },
      ]
      for (const doc of cases) {
        const { issues: found, message } = issues(doc)
        expect(found.length).toBeGreaterThan(0)
        for (const issue of found) {
          expect(issue.code).toBe("UNKNOWN_PROPERTY")
          expect(typeof issue.fix).toBe("string")
          expect(issue.fix).toMatch(/^(Remove it|Did you mean)/)
        }
        expect(message).not.toMatch(/\[object |native code|function /)
      }
    })
  }
  test("declared hints still apply", () => {
    expect(issues({ version: 1, chart: BAR, width: 1 }).issues[0]!.fix).toContain("layout.width")
    expect(issues({ version: 1, chart: { ...BAR, bindings: { ...BAR.bindings, series: "s" } } }).issues[0]!.fix).toContain("grouped_bar")
    expect(issues({ version: 1, chart: BAR, appearance: { overrides: { name: "x" } } }).issues[0]!.fix).toContain("appearance.theme")
  })
})
