// Typed category identity (§8.2), and canonical JSON: the two orderings a saved chart depends on.
import { describe, expect, test } from "bun:test"
import { canonicalJson, canonicalValue, categoryColorDiagnostics, categoryDomain, categoryKey, compareCategories, compareCodePoints, isCategoryValue } from "../src/document/index.ts"

describe("category identity", () => {
  test("type is part of identity; -0 is 0", () => {
    const keys = [1, "1", true, "true", null, "null", 0, -0, false, "false", ""].map(v => categoryKey(v))
    expect(new Set(keys).size).toBe(10)
    expect(categoryKey(-0)).toBe(categoryKey(0))
    expect(categoryKey(1)).not.toBe(categoryKey("1"))
    expect(categoryKey(null)).not.toBe(categoryKey("null"))
    expect(categoryKey(true)).not.toBe(categoryKey("true"))
  })
  test("non-finite numbers and non-scalars are not categories", () => {
    for (const v of [NaN, Infinity, -Infinity, undefined, {}, [], () => 1]) expect(isCategoryValue(v)).toBe(false)
    for (const v of [0, -0, 1.5, "", "x", true, false, null]) expect(isCategoryValue(v)).toBe(true)
  })
  test("the domain: distinct, typed, ordered null < booleans < numbers < strings, independent of input order", () => {
    const input = ["b", 10, "10", 2, true, null, false, -0, 0, "a", "B", 2, "é", "e"]
    const expected = [null, false, true, 0, 2, 10, "10", "B", "a", "b", "e", "é"]
    expect(categoryDomain(input)).toEqual(expected)
    expect(categoryDomain([...input].reverse())).toEqual(expected)
    expect(Object.is(categoryDomain([-0])[0], 0)).toBe(true)
  })
  test("strings by code point, not by locale and not by UTF-16 unit", () => {
    // U+FFFF sorts before U+1F600 by code point, though its UTF-16 unit (0xFFFF) is above the surrogate 0xD83D.
    expect(["\u{1F600}", "￿"].sort()).toEqual(["\u{1F600}", "￿"])
    expect(categoryDomain(["\u{1F600}", "￿"])).toEqual(["￿", "\u{1F600}"])
    expect(compareCodePoints("a", "ab")).toBe(-1)
    expect(compareCodePoints("Z", "a")).toBe(-1)
    expect(compareCategories("10", "9")).toBe(-1)
    expect(compareCategories(9, 10)).toBe(-1)
  })
  test("a colour entry for a category the chart lacks is a warning; typed mismatches say so", () => {
    const issues = categoryColorDiagnostics([{ value: "1" }, { value: 1 }, { value: "x" }], [1, 2])
    expect(issues.map(i => [i.code, i.path])).toEqual([["CATEGORY_COLOR_UNUSED", "/appearance/categoryColors/0/value"], ["CATEGORY_COLOR_UNUSED", "/appearance/categoryColors/2/value"]])
    expect(issues[0]!.fix).toContain("without quotes")
    expect(issues[1]!.fix).toBe("Use a category from the data, or remove the entry.")
  })
})

describe("canonical JSON", () => {
  test("sorted keys at every depth, arrays and rows in order, undefined members left out, -0 as 0", () => {
    const value = { b: [{ z: 1, a: -0 }, { y: undefined, x: [3, 1, 2] }], a: "x" }
    expect(canonicalJson(value)).toBe('{"a":"x","b":[{"a":0,"z":1},{"x":[3,1,2]}]}')
    expect(canonicalJson({ b: 1, a: 2 })).toBe(canonicalJson({ a: 2, b: 1 }))
  })
  test("anything JSON cannot store exactly is refused with its path", () => {
    for (const [value, path] of [[{ a: [1, NaN] }, "/a/1"], [{ a: Infinity }, "/a"], [{ d: new Date(0) }, "/d"], [[undefined], "/0"], [{ m: new Map() }, "/m"], [{ f: () => 1 }, "/f"]] as const) {
      expect(() => canonicalValue(value)).toThrow(`(at ${path})`)
    }
  })
})
