// docs/engineering/open-decisions.md records three behaviours as open product choices. These checks keep what it says
// equal to what the code does, so the page cannot drift from the implementation it describes.
import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { ARTIFACT_LIMITS, canonicalRows, parseDocument } from "../src/document/index.ts"
import { compileRecipe, optionDefaults } from "../src/recipes/index.ts"
import { LIMITS } from "../src/safety.ts"
import { ROOT } from "./helpers.ts"

const page = readFileSync(join(ROOT, "docs", "engineering", "open-decisions.md"), "utf8")
const compiled = (recipe: string, bindings: Record<string, string>, options: Record<string, unknown>, rows: Record<string, unknown>[]) =>
  compileRecipe(parseDocument({ version: 1, chart: { kind: "recipe", recipe, data: { rows }, bindings, options } }).chart as never, rows)

describe("open decisions", () => {
  test("1: the default display sort is input", () => {
    expect(page).toContain("## 1. The default display sort is `input`")
    for (const recipe of ["bar", "horizontal_bar", "pie", "donut", "grouped_bar", "stacked_bar", "box_plot"] as const) expect(optionDefaults(recipe, {}).sort).toBe("input")
    expect(optionDefaults("heatmap", {})).toMatchObject({ rowSort: "input", columnSort: "input" })
    expect(compiled("bar", { category: "c", value: "v" }, {}, [{ c: "b", v: 1 }, { c: "a", v: 2 }]).values.map(r => r.c)).toEqual(["b", "a"])
  })

  test("2: area with a series overlaps; stacked_area stacks", () => {
    expect(page).toContain("## 2. An area recipe with a series draws overlapping areas, not stacked ones")
    const rows = [{ x: 1, y: 1, s: "a" }, { x: 1, y: 2, s: "b" }]
    const area = compiled("area", { x: "x", y: "y", series: "s" }, { xType: "quantitative" }, rows).spec as any
    expect(area.encoding.y.stack).toBeNull()
    expect(area.mark.opacity).toBe(0.55)
    expect((compiled("stacked_area", { x: "x", y: "y", series: "s" }, { xType: "quantitative" }, rows).spec as any).encoding.y.stack).toBe("zero")
  })

  test("3: captured rows are measured as JSON against the data limit", () => {
    expect(page).toContain("## 3. Captured rows are measured as JSON against the data limit")
    expect(ARTIFACT_LIMITS.dataBytes).toBe(LIMITS.dataBytes)
    expect(page).toContain(`${LIMITS.dataBytes / 1048576} MiB`)
    // Rows whose JSON is just over the limit are refused, whatever file they came from.
    const field = "x".repeat(1000)
    const rows = Array.from({ length: Math.ceil(LIMITS.dataBytes / 1000) }, () => ({ [field]: 1 }))
    expect(() => canonicalRows(rows)).toThrow("DATA_TOO_LARGE")
  })
})
