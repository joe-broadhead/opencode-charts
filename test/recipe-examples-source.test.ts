// Recipe examples come from the catalogue's exact tested calls (exampleCall): the rows, title, currency and locale an
// agent gets from charts_catalogue are the ones a recipe example documents. A derived example keeps every value.
import { describe, expect, test } from "bun:test"
import { catalogueEntry, exampleCall } from "../src/catalogue.ts"
import { RECIPES } from "../src/recipes/index.ts"

type Doc = { title?: string; currency?: string; locale?: string; chart: { data: { rows: Record<string, unknown>[] } } }

describe("recipe examples share the catalogue's calls", () => {
  for (const recipe of RECIPES) test(recipe.id, () => {
    const examples = recipe.examples()
    // Every recipe's first example is its own catalogue entry's call, unchanged.
    expect(examples[0]!.source).toEqual({ catalogue: recipe.id, derived: false })
    for (const ex of examples) {
      const call = exampleCall(catalogueEntry(ex.source.catalogue)!)
      const doc = ex.document as Doc
      expect(call.data?.rows.length).toBeGreaterThan(0)
      if (!ex.source.derived) expect(doc.chart.data.rows).toEqual(call.data!.rows)
      if (doc.title === call.title) {
        expect(doc.currency).toBe(call.currency)
        expect(doc.locale).toBe(call.locale)
      }
    }
  })

  test("the derived line example keeps the total of every row it splits", () => {
    const ex = RECIPES.find(r => r.id === "line")!.examples().find(e => e.source.derived)!
    expect(ex.source.catalogue).toBe("stacked_area")
    const call = exampleCall(catalogueEntry("stacked_area")!)
    const rows = (ex.document as Doc).chart.data.rows
    expect(rows).toHaveLength(call.data!.rows.length * 2)
    const total = (list: Record<string, unknown>[]) => list.reduce((sum, r) => sum + (r.revenue_eur as number), 0)
    expect(total(rows)).toBe(total(call.data!.rows))
    expect((ex.document as Doc).currency).toBe(call.currency)
  })
})
