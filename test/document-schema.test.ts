// ChartDocumentV1: strict, versioned, recipe-discriminated. Every failure names its JSON path; nothing is stripped,
// defaulted or downgraded on the way in.
import { describe, expect, test } from "bun:test"
import * as z from "zod"
import { ChartsError } from "../src/errors.ts"
import { ChartDocumentV1Schema, DocumentInvalid, documentJsonSchema, parseDocument, PresentationTokenOverridesSchema, ThemeDefinitionOverridesSchema } from "../src/document/index.ts"
import { RECIPES, RECIPE_IDS, recipeDefinition, type RecipeId } from "../src/recipes/index.ts"
import { ThemeTokensSchema } from "../src/themes/tokens.ts"

type Doc = Record<string, any>
const example = (id: RecipeId): Doc => structuredClone(recipeDefinition(id).examples()[0]!.document) as Doc
const ROWS = [{ region: "North", quarter: "Q1", revenue: 10, month: "2024-01-01", spend: 1, conv: 2, size: 3 }]
const minimal = (recipe: RecipeId, bindings: Doc, options?: Doc): Doc => ({ version: 1, chart: { kind: "recipe", recipe, data: { rows: ROWS }, bindings, ...(options ? { options } : {}) } })

/** The error a document raises: its code, and each issue's code and path. */
function failure(doc: unknown): { code: string; issues: { code: string; path?: string; fix?: string; message: string }[]; message: string } {
  try { parseDocument(doc) } catch (error) {
    if (error instanceof DocumentInvalid) return { code: error.code, issues: error.issues.map(i => ({ code: i.code, path: i.path, fix: i.fix, message: i.message })), message: error.message }
    if (error instanceof ChartsError) return { code: error.code, issues: [{ code: error.code, path: error.path, fix: error.hint, message: error.detail }], message: error.message }
    throw error
  }
  throw new Error("expected the document to be refused")
}
const paths = (doc: unknown) => failure(doc).issues.map(i => `${i.code} ${i.path}`)

describe("A05: every recipe's schema", () => {
  test("14 recipes, the quick-chart families", () => {
    expect([...RECIPE_IDS]).toEqual(["bar", "horizontal_bar", "grouped_bar", "stacked_bar", "line", "area", "stacked_area", "scatter", "bubble", "pie", "donut", "histogram", "box_plot", "heatmap"])
    expect(RECIPES.map(r => r.id)).toEqual([...RECIPE_IDS])
  })

  for (const recipe of RECIPES) {
    test(`${recipe.id}: examples parse unchanged; a missing or unknown binding fails at its path`, () => {
      for (const ex of recipe.examples()) {
        const doc = structuredClone(ex.document)
        // Parsed as written: nothing added (no defaults), nothing removed.
        expect(parseDocument(doc)).toEqual(ex.document as never)
        expect(ChartDocumentV1Schema.safeParse(doc).success).toBe(true)
      }
      for (const b of recipe.bindings.filter(b => b.required === "always")) {
        const doc = example(recipe.id)
        delete doc.chart.bindings[b.role]
        expect(paths(doc)).toContain(`FIELD_MISSING /chart/bindings/${b.role}`)
      }
      const doc = example(recipe.id)
      doc.chart.bindings.bogus = "x"
      const f = failure(doc)
      expect(f.code).toBe("DOCUMENT_INVALID")
      expect(f.issues).toEqual([expect.objectContaining({ code: "UNKNOWN_PROPERTY", path: "/chart/bindings/bogus" })])
      const opt = example(recipe.id)
      opt.chart.options = { ...(opt.chart.options ?? {}), colour: "red" }
      expect(paths(opt)).toContain("UNKNOWN_PROPERTY /chart/options/colour")
    })
  }

  test("refused properties say which recipe takes them", () => {
    const series = failure(minimal("bar", { category: "region", value: "revenue", series: "quarter" }))
    expect(series.issues[0]).toMatchObject({ code: "UNKNOWN_PROPERTY", path: "/chart/bindings/series" })
    expect(series.issues[0]!.fix).toContain("grouped_bar or stacked_bar")
    expect(failure(minimal("pie", { category: "region", value: "revenue", series: "q" })).issues[0]!.fix).toContain("stacked_bar")
    expect(failure(minimal("scatter", { x: "spend", y: "conv" }, { aggregate: "sum" })).issues[0]!.fix).toContain("never aggregates")
    expect(failure(minimal("histogram", { value: "revenue" }, { aggregate: "count" })).issues[0]!.fix).toContain("counts rows per bin")
    expect(failure(minimal("box_plot", { category: "region", value: "revenue" }, { aggregate: "mean" })).issues[0]!.fix).toContain("distribution")
    expect(failure(minimal("bubble", { x: "spend", y: "conv", size: "size" }, { aggregate: "max" })).issues[0]!.path).toBe("/chart/options/aggregate")
    expect(failure(minimal("line", { x: "month", y: "revenue" }, { xType: "temporal", sort: "input" })).issues[0]!.fix).toContain("xSort")
    expect(failure(minimal("bar", { category: "region", value: "revenue" }, { xSort: "input" })).issues[0]!.fix).toContain("options.sort")
    expect(failure(minimal("heatmap", { column: "quarter", row: "region", value: "revenue" }, { sort: "input" })).issues[0]!.fix).toContain("rowSort")
    expect(failure(minimal("bar", { category: "region", value: "revenue" }, { bins: 10 })).issues[0]!.fix).toContain("Only histogram")
    expect(failure(minimal("pie", { category: "region", value: "revenue" }, { xTitle: "x" })).issues[0]!.fix).toContain("no axes")
  })

  test("aggregation sets per recipe", () => {
    for (const id of ["bar", "horizontal_bar", "grouped_bar", "stacked_bar", "line", "area", "stacked_area", "heatmap"] as RecipeId[]) {
      expect(recipeDefinition(id).options.aggregate).toEqual(["none", "sum", "mean", "median", "min", "max", "count"])
    }
    expect(recipeDefinition("pie").options.aggregate).toEqual(["none", "sum", "count"])
    expect(recipeDefinition("donut").options.aggregate).toEqual(["none", "sum", "count"])
    for (const id of ["histogram", "scatter", "bubble", "box_plot"] as RecipeId[]) expect(recipeDefinition(id).options.aggregate).toBeUndefined()
    const mean = failure(minimal("pie", { category: "region", value: "revenue" }, { aggregate: "mean" }))
    expect(mean.issues[0]).toMatchObject({ code: "DOCUMENT_INVALID", path: "/chart/options/aggregate" })
    expect(mean.issues[0]!.fix).toBe('Use one of: "none", "sum", "count".')
  })

  test("count counts rows: the measure is refused under count, and required for every other aggregate", () => {
    expect(() => parseDocument(minimal("bar", { category: "region" }, { aggregate: "count" }))).not.toThrow()
    expect(() => parseDocument(minimal("heatmap", { column: "quarter", row: "region" }, { aggregate: "count" }))).not.toThrow()
    expect(() => parseDocument(minimal("line", { x: "month" }, { xType: "temporal", aggregate: "count" }))).not.toThrow()
    const unused = failure(minimal("bar", { category: "region", value: "revenue" }, { aggregate: "count" }))
    expect(unused.issues).toEqual([expect.objectContaining({ code: "DOCUMENT_INVALID", path: "/chart/bindings/value" })])
    expect(unused.issues[0]!.message).toContain("counts the rows")
    expect(paths(minimal("line", { x: "month", y: "revenue" }, { xType: "temporal", aggregate: "count" }))).toEqual(["DOCUMENT_INVALID /chart/bindings/y"])
    for (const aggregate of [undefined, "none", "sum", "mean", "median", "min", "max"]) {
      expect(paths(minimal("bar", { category: "region" }, aggregate ? { aggregate } : undefined))).toEqual(["FIELD_MISSING /chart/bindings/value"])
    }
    // Histogram and box plot always need their measure.
    expect(paths(minimal("histogram", {}))).toEqual(["FIELD_MISSING /chart/bindings/value"])
  })

  test("sort, xSort, rowSort/columnSort and bins: shapes and bounds", () => {
    for (const sort of ["input", "category-ascending", "category-descending", "value-ascending", "value-descending"]) {
      expect(() => parseDocument(minimal("bar", { category: "region", value: "revenue" }, { sort }))).not.toThrow()
      expect(() => parseDocument(minimal("donut", { category: "region", value: "revenue" }, { sort }))).not.toThrow()
    }
    for (const id of ["grouped_bar", "stacked_bar"] as RecipeId[]) {
      expect(() => parseDocument(minimal(id, { category: "region", series: "quarter", value: "revenue" }, { sort: "category-descending" }))).not.toThrow()
      expect(paths(minimal(id, { category: "region", series: "quarter", value: "revenue" }, { sort: "value-descending" }))).toEqual(["DOCUMENT_INVALID /chart/options/sort"])
    }
    expect(paths(minimal("box_plot", { category: "region", value: "revenue" }, { sort: "value-ascending" }))).toEqual(["DOCUMENT_INVALID /chart/options/sort"])
    expect(paths(minimal("line", { x: "month", y: "revenue" }, { xType: "temporal", xSort: "category-ascending" }))).toEqual(["DOCUMENT_INVALID /chart/options/xSort"])
    expect(() => parseDocument(minimal("heatmap", { column: "quarter", row: "region", value: "revenue" }, { rowSort: "descending", columnSort: "ascending" }))).not.toThrow()
    expect(paths(minimal("heatmap", { column: "quarter", row: "region", value: "revenue" }, { rowSort: "value-descending" }))).toEqual(["DOCUMENT_INVALID /chart/options/rowSort"])
    for (const bins of [2, 24, 200]) expect(() => parseDocument(minimal("histogram", { value: "revenue" }, { bins }))).not.toThrow()
    for (const bins of [1, 201, 2.5, "10"]) expect(paths(minimal("histogram", { value: "revenue" }, { bins }))).toEqual(["DOCUMENT_INVALID /chart/options/bins"])
  })

  test("xType is explicit for line, area and stacked area", () => {
    for (const id of ["line", "area"] as RecipeId[]) {
      expect(paths(minimal(id, { x: "month", y: "revenue" }))).toEqual(["DOCUMENT_INVALID /chart/options"])
      expect(paths(minimal(id, { x: "month", y: "revenue" }, {}))).toEqual(["DOCUMENT_INVALID /chart/options/xType"])
      expect(paths(minimal(id, { x: "month", y: "revenue" }, { xType: "time" }))).toEqual(["DOCUMENT_INVALID /chart/options/xType"])
    }
    expect(paths(minimal("stacked_area", { x: "month", y: "revenue" }, { xType: "ordinal" }))).toEqual(["FIELD_MISSING /chart/bindings/series"])
  })

  test("axis titles are bounded, and only on charts with axes", () => {
    expect(() => parseDocument(minimal("horizontal_bar", { category: "region", value: "revenue" }, { xTitle: "x".repeat(120), yTitle: "" }))).not.toThrow()
    expect(paths(minimal("horizontal_bar", { category: "region", value: "revenue" }, { xTitle: "x".repeat(121) }))).toEqual(["DOCUMENT_INVALID /chart/options/xTitle"])
  })

  test("a field bound both as a group and as the measure is refused", () => {
    expect(paths(minimal("bar", { category: "revenue", value: "revenue" }))).toEqual(["DOCUMENT_INVALID /chart/bindings/value"])
  })

  test("an unknown recipe suggests the closest, and points at engine documents", () => {
    const f = failure({ version: 1, chart: { kind: "recipe", recipe: "bars", data: { rows: ROWS }, bindings: {} } })
    expect(f.issues[0]).toMatchObject({ path: "/chart/recipe", fix: 'Did you mean "bar"?' })
    expect(failure({ version: 1, chart: { kind: "recipe", recipe: "sankey", data: { rows: ROWS }, bindings: {} } }).issues[0]!.fix).toContain("\"kind\": \"engine\"")
    expect(paths({ version: 1, chart: { kind: "chart" } })).toEqual(["DOCUMENT_INVALID /chart/kind"])
    expect(paths({ version: 1 })).toEqual(["DOCUMENT_INVALID /chart"])
  })
})

describe("data: exactly one of rows or path", () => {
  const withData = (data: unknown) => ({ version: 1, chart: { kind: "recipe", recipe: "bar", data, bindings: { category: "region", value: "revenue" } } })
  test("rows, or a path with an optional format, plus a transform", () => {
    expect(() => parseDocument(withData({ rows: ROWS, transform: [{ filter: "datum.revenue > 0" }] }))).not.toThrow()
    expect(() => parseDocument(withData({ path: "data/x.csv", format: "csv" }))).not.toThrow()
  })
  test("both, neither, a format for rows, and a recipe data name fail at their path", () => {
    expect(paths(withData({ rows: ROWS, path: "data/x.csv" }))).toEqual(["DOCUMENT_INVALID /chart/data"])
    expect(paths(withData({}))).toEqual(["DOCUMENT_INVALID /chart/data"])
    expect(paths(withData({ transform: [] }))).toEqual(["DOCUMENT_INVALID /chart/data"])
    expect(paths(withData({ rows: ROWS, format: "csv" }))).toEqual(["DOCUMENT_INVALID /chart/data/format"])
    const name = failure(withData({ rows: ROWS, name: "table" }))
    expect(name.issues[0]).toMatchObject({ code: "UNKNOWN_PROPERTY", path: "/chart/data/name" })
    expect(name.issues[0]!.fix).toContain("engine documents")
    expect(paths(withData({ rows: [1, 2] }))).toEqual(["DOCUMENT_INVALID /chart/data/rows/0", "DOCUMENT_INVALID /chart/data/rows/1"])
  })
  test("an engine document takes data.name, and its spec passes the spec safety checks with the path inside the document", () => {
    expect(() => parseDocument({ version: 1, chart: { kind: "engine", spec: { mark: "bar", data: { name: "sales" } }, data: { rows: ROWS, name: "sales" } } })).not.toThrow()
    const unsafe = failure({ version: 1, chart: { kind: "engine", spec: { mark: "bar", data: { url: "https://example.com/x.csv" } } } })
    expect(unsafe.code).toBe("SPEC_UNSAFE")
    expect(unsafe.issues[0]!.path).toBe("/chart/spec/data/url")
    expect(paths({ version: 1, chart: { kind: "engine", engine: "plotly", spec: {} } })).toEqual(["DOCUMENT_INVALID /chart/engine"])
  })
})

describe("unknown properties and versions (A17)", () => {
  test("an unknown top-level property fails with its path; old call fields say where they moved", () => {
    const doc = example("bar")
    doc.width = 900
    doc.extra = true
    const f = failure(doc)
    expect(f.issues.map(i => i.path)).toEqual(["/width", "/extra"])
    expect(f.issues[0]!.fix).toContain("layout.width")
  })

  test("a future version is refused with the supported version and a migration step, never read as version 1", () => {
    for (const version of [2, 99, "1", 0, 1.5, null]) {
      const doc = example("bar")
      doc.version = version
      const f = failure(doc)
      expect(f.code).toBe("DOCUMENT_VERSION_UNSUPPORTED")
      expect(f.message).toContain("version 1 only")
      expect(f.message).toContain("Next step: Rewrite the document as version 1")
      expect(f.issues[0]!.path).toBe("/version")
    }
    const doc = example("bar")
    delete doc.version
    expect(failure(doc)).toMatchObject({ code: "DOCUMENT_INVALID" })
    // A future document with fields this version does not know is refused for its version first, not stripped.
    expect(failure({ version: 2, chart: { kind: "recipe", recipe: "bar", future: true } }).code).toBe("DOCUMENT_VERSION_UNSUPPORTED")
  })

  test("all problems are reported together", () => {
    const doc = minimal("bar", { category: "region", value: "revenue", series: "q" }, { sort: "best" })
    doc.layout = { target: "slide" }
    doc.interactions = { zoom: "y" }
    expect(paths(doc)).toEqual(["DOCUMENT_INVALID /interactions/zoom", "UNKNOWN_PROPERTY /chart/bindings/series", "DOCUMENT_INVALID /chart/options/sort", "DOCUMENT_INVALID /layout/target"])
  })
})

describe("layout against chart.kind", () => {
  const engine = (layout: unknown) => ({ version: 1, chart: { kind: "engine", spec: { mark: "bar" } }, layout })
  test("recipes take target/mode/width/height; native is for engine documents", () => {
    expect(() => parseDocument({ ...minimal("bar", { category: "region", value: "revenue" }), layout: { target: "presentation", mode: "fixed", width: 1280, height: 720 } })).not.toThrow()
    expect(paths({ ...minimal("bar", { category: "region", value: "revenue" }), layout: { mode: "native" } })).toEqual(["DOCUMENT_INVALID /layout/mode"])
    expect(paths({ ...minimal("bar", { category: "region", value: "revenue" }), layout: { width: 10 } })).toEqual(["DOCUMENT_INVALID /layout/width"])
    expect(paths({ ...minimal("bar", { category: "region", value: "revenue" }), layout: { width: 4001 } })).toEqual(["DOCUMENT_INVALID /layout/width"])
    expect(paths({ ...minimal("bar", { category: "region", value: "revenue" }), layout: { width: "50%" } })).toEqual(["DOCUMENT_INVALID /layout/width"])
  })
  test("an engine document takes native layout or none; fixed or responsive is LAYOUT_UNSUPPORTED", () => {
    expect(() => parseDocument(engine({ mode: "native" }))).not.toThrow()
    expect(() => parseDocument({ version: 1, chart: { kind: "engine", spec: { mark: "bar" } } })).not.toThrow()
    for (const [layout, path] of [[{ mode: "fixed" }, "/layout/mode"], [{ mode: "responsive", width: 500 }, "/layout/mode"], [{ width: 500 }, "/layout/width"], [{ target: "report" }, "/layout/target"]] as const) {
      const f = failure(engine(layout))
      expect(f.code).toBe("LAYOUT_UNSUPPORTED")
      expect(f.issues[0]!.path).toBe(path)
      expect(f.issues[0]!.fix).toContain("recipe document")
    }
    expect(paths(engine({ mode: "native", extra: 1 }))).toEqual(["UNKNOWN_PROPERTY /layout/extra"])
  })
})

describe("interactions", () => {
  const withInteractions = (doc: Doc, interactions: Doc) => ({ ...doc, interactions })
  test("supported presets and combinations parse", () => {
    expect(() => parseDocument(withInteractions(example("scatter"), { tooltip: "auto", legend: "highlight", brush: "interval" }))).not.toThrow()
    expect(() => parseDocument(withInteractions(example("line"), { tooltip: "off", zoom: "x" }))).not.toThrow()
    expect(() => parseDocument(withInteractions(recipeDefinition("line").examples()[1]!.document as Doc, { legend: "highlight", zoom: "x" }))).not.toThrow()
    expect(() => parseDocument(withInteractions(example("pie"), { tooltip: "auto", legend: "static", zoom: "none", brush: "none" }))).not.toThrow()
  })
  test("unsupported ones are INTERACTION_UNSUPPORTED at their path, with the alternatives", () => {
    const zoom = failure(withInteractions(example("pie"), { zoom: "x" }))
    expect(zoom).toMatchObject({ code: "INTERACTION_UNSUPPORTED" })
    expect(zoom.issues[0]!.path).toBe("/interactions/zoom")
    expect(zoom.issues[0]!.fix).toContain("line, area")
    expect(failure(withInteractions(example("bar"), { brush: "interval" })).issues[0]!.fix).toContain("scatter, bubble")
    expect(failure(withInteractions(example("bar"), { legend: "highlight" })).issues[0]!.path).toBe("/interactions/legend")
    expect(failure(withInteractions(example("line"), { legend: "highlight" })).issues[0]!.message).toContain("no series binding")
    expect(failure(withInteractions(minimal("line", { x: "quarter", y: "revenue" }, { xType: "ordinal" }), { zoom: "x" })).issues[0]!.message).toContain("temporal")
    expect(failure(withInteractions(example("stacked_area"), { zoom: "x" })).code).toBe("INTERACTION_UNSUPPORTED")
  })
  test("an engine document keeps its own interaction syntax: presets are refused", () => {
    const f = failure({ version: 1, chart: { kind: "engine", spec: { mark: "point" } }, interactions: { tooltip: "auto" } })
    expect(f.code).toBe("INTERACTION_UNSUPPORTED")
    expect(f.issues[0]!.path).toBe("/interactions/tooltip")
  })
})

describe("appearance", () => {
  const withAppearance = (doc: Doc, appearance: unknown) => ({ ...doc, appearance })

  test("overrides are a strict deep partial of the canonical tokens, without identity keys or layout size", () => {
    // Every token path of ThemeTokensSchema is accepted, except the excluded ones; nothing else is.
    const leaves = (schema: z.ZodType, path: string[] = []): string[] => {
      let s: any = schema
      while (s instanceof z.ZodOptional || s instanceof z.ZodDefault) s = s.unwrap()
      return s instanceof z.ZodObject ? Object.entries(s.shape).flatMap(([k, v]) => leaves(v as z.ZodType, [...path, k])) : [path.join(".")]
    }
    const tokens = leaves(ThemeTokensSchema)
    const overrides = leaves(PresentationTokenOverridesSchema)
    expect(tokens.filter(t => !overrides.includes(t)).sort()).toEqual(["description", "layout.height", "layout.width", "name"])
    expect(overrides.filter(t => !tokens.includes(t))).toEqual([])
  })

  test("overrides parse as written: no token default is materialised", () => {
    const appearance = { theme: "dark", overrides: { colors: { negative: "#AA0000", categorical: ["#111111", "#222222"] }, font: { size: 13, files: [{ family: "Brand", path: "fonts/brand.ttf" }] }, axis: { grid: false }, legend: { orient: "bottom" } } }
    const parsed = parseDocument(withAppearance(example("bar"), appearance))
    expect(parsed.appearance).toEqual(appearance as never)
  })

  test("unknown, excluded and invalid tokens fail at their path", () => {
    const f = failure(withAppearance(example("bar"), { overrides: { layout: { width: 900, padding: 8 }, colors: { bogus: "#fff" }, name: "x", extends: "dark" } }))
    expect(f.issues.map(i => i.path).sort()).toEqual(["/appearance/overrides/colors/bogus", "/appearance/overrides/extends", "/appearance/overrides/layout/width", "/appearance/overrides/name"].sort())
    expect(f.issues.find(i => i.path === "/appearance/overrides/layout/width")!.fix).toContain("layout.width")
    expect(f.issues.find(i => i.path === "/appearance/overrides/extends")!.fix).toContain("appearance.theme")
    expect(paths(withAppearance(example("bar"), { overrides: { colors: { categorical: ["#111111"] } } }))).toEqual(["DOCUMENT_INVALID /appearance/overrides/colors/categorical"])
    expect(paths(withAppearance(example("bar"), { overrides: { font: { size: 2 } } }))).toEqual(["DOCUMENT_INVALID /appearance/overrides/font/size"])
    expect(paths(withAppearance(example("bar"), { overrides: { colors: { text: "beige" } } }))).toEqual(["DOCUMENT_INVALID /appearance/overrides/colors/text"])
    expect(paths(withAppearance(example("bar"), { palette: [] }))).toEqual(["UNKNOWN_PROPERTY /appearance/palette"])
  })

  test("categoryColors: typed entries, no duplicates, only where the recipe has a colour domain", () => {
    const scatter = example("scatter")
    expect(() => parseDocument(withAppearance(scatter, { categoryColors: [{ value: 1, color: "#112233" }, { value: "1", color: "#445566" }, { value: true, color: "theme:negative" }, { value: null, color: "#000" }] }))).not.toThrow()
    expect(paths(withAppearance(scatter, { categoryColors: [{ value: "Search", color: "#112233" }, { value: "Search", color: "#445566" }] }))).toEqual(["DOCUMENT_INVALID /appearance/categoryColors/1/value"])
    expect(paths(withAppearance(scatter, { categoryColors: [{ value: 0, color: "#112233" }, { value: -0, color: "#445566" }] }))).toEqual(["DOCUMENT_INVALID /appearance/categoryColors/1/value"])
    expect(paths(withAppearance(scatter, { categoryColors: [{ value: { a: 1 }, color: "#112233" }] }))).toEqual(["DOCUMENT_INVALID /appearance/categoryColors/0/value"])
    expect(() => parseDocument(withAppearance(example("pie"), { categoryColors: [{ value: "Search", color: "#112233" }] }))).not.toThrow()
    expect(failure(withAppearance(example("bar"), { categoryColors: [{ value: "Lattes", color: "#112233" }] })).issues[0]!.path).toBe("/appearance/categoryColors")
    expect(failure(withAppearance(example("line"), { categoryColors: [{ value: "x", color: "#112233" }] })).issues[0]!.fix).toContain("series")
    expect(failure(withAppearance({ version: 1, chart: { kind: "engine", spec: { mark: "bar" } } }, { categoryColors: [{ value: "a", color: "#112233" }] })).issues[0]!.message).toContain("engine document")
  })
})

describe("the JSON Schema projection", () => {
  test("is one schema for the whole contract, discriminated by kind and recipe", () => {
    const schema = documentJsonSchema()
    expect(schema.type).toBe("object")
    expect(schema.additionalProperties).toBe(false)
    const text = JSON.stringify(schema)
    for (const id of RECIPE_IDS) expect(text).toContain(`"const":"${id}"`)
    expect(text).toContain('"const":"engine"')
    // The union schema and the validator agree on the examples and on a strict failure.
    expect(ChartDocumentV1Schema.safeParse({ ...example("bar"), extra: 1 }).success).toBe(false)
  })
})

describe("the theme definition projection (charts_theme_save and legacy theme objects)", () => {
  const leaves = (schema: z.ZodType, path: string[] = []): string[] => {
    let s: any = schema
    while (s instanceof z.ZodOptional || s instanceof z.ZodDefault) s = s.unwrap()
    return s instanceof z.ZodObject ? Object.entries(s.shape).flatMap(([k, v]) => leaves(v as z.ZodType, [...path, k])) : [path.join(".")]
  }

  test("every canonical token, plus extends; nothing else", () => {
    const tokens = leaves(ThemeTokensSchema)
    const definition = leaves(ThemeDefinitionOverridesSchema)
    expect(definition.filter(t => !tokens.includes(t))).toEqual(["extends"])
    expect(tokens.filter(t => !definition.includes(t))).toEqual([])
  })

  test("strict at every depth, arrays whole, no default materialised", () => {
    const brand = { extends: "dark", name: "acme-dark", colors: { categorical: ["#111111", "#222222"] }, font: { files: [{ family: "Acme", path: "fonts/acme.ttf" }] }, layout: { width: 800 } }
    expect(ThemeDefinitionOverridesSchema.parse(brand)).toEqual(brand)
    const bad = ThemeDefinitionOverridesSchema.safeParse({ colors: { bogus: "#fff" }, marks: { glow: 1 }, palette: [] })
    expect(bad.success).toBe(false)
    expect(bad.error!.issues.map(i => [i.code, i.path.join("/"), (i as { keys?: string[] }).keys?.join()])).toEqual([["unrecognized_keys", "colors", "bogus"], ["unrecognized_keys", "marks", "glow"], ["unrecognized_keys", "", "palette"]])
    expect(ThemeDefinitionOverridesSchema.safeParse({ colors: { categorical: ["#111111"] } }).success).toBe(false)
  })
})
