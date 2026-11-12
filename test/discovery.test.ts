import { afterAll, describe, expect, test } from "bun:test"
import { readdirSync } from "node:fs"
import { closeVegaWorker } from "../src/engines/vega-pool.ts"
import { capabilities, describeCapabilities } from "../src/capabilities.ts"
import { CATALOGUE } from "../src/catalogue.ts"
import { DOCUMENT_VERSION, LAYOUT_PROFILES } from "../src/document/defaults.ts"
import { RECIPE_IDS } from "../src/recipes/types.ts"
import { recipeContract } from "../src/recipes/index.ts"
import { recipeExamples } from "../src/recipes/examples.ts"
import { runTool, type ToolName } from "../src/tools.ts"
import { workspace } from "./helpers.ts"

/**
 * The discovery surfaces agree with the recipe registry: charts_capabilities reports the document versions, the 14
 * recipe contracts and the layout profiles; charts_catalogue hands out each recipe's examples as exact charts_quick
 * calls that validate unchanged; charts_recommend drafts a recipe document on the caller's own columns, carries an
 * explicit medium into its layout target, and never picks an aggregate for the caller.
 */

const spaces: { cleanup: () => void }[] = []
afterAll(async () => { for (const s of spaces) s.cleanup(); await closeVegaWorker() })

function setup() {
  const ws = workspace()
  spaces.push(ws)
  const env = { ...ws.env, assertFiles: async () => {} }
  const call = async (tool: ToolName, input: Record<string, unknown>) => (await runTool(env as never, tool, input)) as { output: Record<string, any>; content: { type: string; text?: string }[] }
  const files = () => readdirSync(ws.dir, { recursive: true })
  return { env, call, files }
}

describe("charts_capabilities reports the document contract from the registry", () => {
  const ws = workspace()
  spaces.push(ws)
  const view = capabilities(ws.env)

  test("document versions, the artifact format and the tools that create, replay and update", () => {
    expect(view.documents.versions).toEqual([DOCUMENT_VERSION])
    expect(view.documents.artifact).toEqual({ format: "opencode-charts-artifact", version: 1, file: "<name>.chart.json" })
    expect(view.documents.tools).toEqual({ create: ["quick", "render"], replay: ["render", "validate"], update: "update" })
  })

  test("one recipe entry per registry recipe, with the registry's bindings, options and interactions", () => {
    expect(view.recipes.map(r => r.id)).toEqual([...RECIPE_IDS])
    for (const recipe of view.recipes) {
      const contract = recipeContract(recipe.id as never)
      expect(recipe.bindings).toEqual(contract.bindings.map(b => ({ role: b.role, required: b.required, kind: b.kind })))
      expect(recipe.options).toEqual(contract.options)
      expect(recipe.interactions).toEqual(contract.interactions)
      expect(recipe.interactionDefaults).toEqual({ tooltip: "auto", legend: "static", zoom: "none", brush: "none" })
    }
  })

  test("the layout profiles are the document defaults, and engine documents take native layout only", () => {
    expect(view.layouts.profiles).toEqual(Object.values(LAYOUT_PROFILES))
    expect(view.layouts.defaultTarget).toBe("inline")
    expect(view.layouts.engineDocuments).toEqual(["native"])
    const text = describeCapabilities(view)
    expect(text).toContain("presentation fixed 1280×720, 18px")
    expect(text).toContain("charts_update")
    for (const id of RECIPE_IDS) expect(text).toContain(`${id} (`)
  })
})

describe("charts_catalogue hands out recipe documents (A01, A05)", () => {
  test("the list marks exactly the 14 recipe types", async () => {
    const t = setup()
    const out = await t.call("catalogue", {})
    const marked = (out.output.types as { id: string; recipe?: boolean }[]).filter(e => e.recipe).map(e => e.id).sort()
    expect(marked).toEqual([...RECIPE_IDS].sort())
    expect(out.output.types.length).toBe(CATALOGUE.length)
  })

  for (const id of RECIPE_IDS) {
    test(`${id}: the returned charts_quick calls are the registry's examples and validate unchanged`, async () => {
      const t = setup()
      const out = await t.call("catalogue", { id })
      const recipe = out.output.recipe as { id: string; examples: { name: string; call: { tool: string; input: { document: unknown; name: string } } }[] }
      expect(recipe.id).toBe(id)
      expect(recipe.examples.map(e => e.call.input.document)).toEqual(recipeExamples(id).map(e => e.document))
      for (const example of recipe.examples) {
        expect(example.call.tool).toBe("quick")
        const checked = await t.call("validate", { document: example.call.input.document, inspect: false })
        expect(checked.output.valid, JSON.stringify(checked.output.issues ?? [])).toBe(true)
      }
      const text = out.content.map(c => c.text ?? "").join("\n")
      expect(text).toContain(`document.chart.recipe "${id}"`)
      expect(t.files()).toEqual([])
    }, 60_000)
  }

  test("a type that is not a recipe has no recipe section", async () => {
    const t = setup()
    const out = await t.call("catalogue", { id: "sankey" })
    expect(out.output.recipe).toBeUndefined()
  })
})

describe("charts_recommend drafts a recipe document on the caller's columns", () => {
  const monthly = [
    { month: "2024-01-01", revenue_eur: 120 }, { month: "2024-02-01", revenue_eur: 140 }, { month: "2024-03-01", revenue_eur: 135 },
    { month: "2024-04-01", revenue_eur: 160 }, { month: "2024-05-01", revenue_eur: 170 }, { month: "2024-06-01", revenue_eur: 182 },
  ]

  test("a trend on one row per month: a line document that validates, with the medium as its layout target", async () => {
    const t = setup()
    const out = await t.call("recommend", { request: "how is revenue trending over time?", data: { rows: monthly }, medium: "presentation" })
    const line = (out.output.recommendations as { id: string; document?: { tool: string; input: { document: Record<string, any> } } }[]).find(r => r.document)
    expect(line).toBeDefined()
    const document = line!.document!.input.document
    expect(line!.document!.tool).toBe("quick")
    expect(document.chart.recipe).toBe(line!.id)
    expect(document.chart.data).toEqual({ rows: monthly })
    expect(document.layout).toEqual({ target: "presentation" })
    expect(document.chart.options?.aggregate).toBeUndefined()
    const checked = await t.call("validate", { document, inspect: false })
    expect(checked.output.valid, JSON.stringify(checked.output.issues ?? [])).toBe(true)
  }, 60_000)

  test("an assumed medium leaves the layout to the document's own default", async () => {
    const t = setup()
    const out = await t.call("recommend", { request: "how is revenue trending over time?", data: { rows: monthly } })
    expect(out.output.mediumAssumed).toBe(true)
    const withDocument = (out.output.recommendations as { document?: { input: { document: Record<string, unknown> } } }[]).filter(r => r.document)
    expect(withDocument.length).toBeGreaterThan(0)
    for (const r of withDocument) expect(r.document!.input.document.layout).toBeUndefined()
  })

  test("repeated categories: no document, and a warning that the aggregate is the caller's to choose", async () => {
    const t = setup()
    const rows = [{ region: "North", revenue: 1 }, { region: "North", revenue: 2 }, { region: "South", revenue: 3 }, { region: "East", revenue: 4 }]
    const out = await t.call("recommend", { request: "compare revenue by region", data: { rows } })
    const bar = (out.output.recommendations as { id: string; document?: unknown; warnings?: string[] }[]).find(r => r.id === "bar")
    expect(bar).toBeDefined()
    expect(bar!.document).toBeUndefined()
    expect(bar!.warnings?.join(" ")).toContain("options.aggregate")
  })
})
