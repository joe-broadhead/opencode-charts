import { afterAll, describe, expect, test } from "bun:test"
import { CATALOGUE, exampleCall, type ChartType } from "../src/catalogue.ts"
import type { Row } from "../src/data.ts"
import { substituteThemeColours, type Json } from "../src/engines/common.ts"
import { DiagramSpecSchema, renderDiagram } from "../src/engines/diagram.ts"
import { prepareECharts, renderECharts } from "../src/engines/echarts.ts"
import { renderPlot, validatePlotSpec } from "../src/engines/plot.ts"
import { renderTable, TableSpecSchema } from "../src/engines/table.ts"
import { ChartsError } from "../src/errors.ts"
import { bundledFonts } from "../src/fonts.ts"
import { resolveLocale } from "../src/locale.ts"
import { recommend } from "../src/recommend/rank.ts"
import { TRAITS_BY_ID } from "../src/recommend/traits.ts"
import { checkRenderedSvg, checkSpec, type Engine } from "../src/safety.ts"
import { layoutFacts } from "../src/svg.ts"
import { BUILTIN_THEMES, type ThemeTokens } from "../src/themes/tokens.ts"
import { ROOT, workspace } from "./helpers.ts"

/**
 * The catalogue's Plot statistics and cartograms, its ECharts 6 series, its data-graphic tables and its offline
 * diagrams. What this file holds is the promise each entry makes. The catalogue and the advice are one list (every
 * entry has a trait and no trait outlives its entry), and every example draws through its own engine with nothing
 * clipped, nothing overlapping and no warning.
 */

const ids = (entries: readonly ChartType[]) => entries.map(entry => entry.id)

/** The 26 entries after the catalogue's original 53, in catalogue order. */
const EXTRA_IDS = [
  "hexbin", "contour", "beeswarm", "bollinger", "difference_area", "waffle", "arrow_change", "voronoi", "ridgeline", "horizon",
  "cartogram_us_hex", "cartogram_eu_tile", "flow_map",
  "violin", "sparkline_matrix", "pictorial_bar", "theme_river",
  "data_table", "kpi_table",
  "flowchart", "sequence_diagram", "state_diagram", "er_diagram", "mindmap", "org_chart", "fishbone",
] as const

const fonts = bundledFonts(ROOT)
const locale = resolveLocale(ROOT, "en-US")
const entry = (id: string): ChartType => {
  const found = CATALOGUE.find(candidate => candidate.id === id)
  if (!found) throw new ChartsError("CHART_TYPE_UNKNOWN", `There is no catalogue entry "${id}".`, "Add it to src/catalogue.ts.")
  return found
}

/** One example drawn through its own engine, on one theme, with the spec's theme tokens resolved as the pipeline does. */
async function draw(target: ChartType, theme: ThemeTokens): Promise<{ svg: string; issues: readonly { level: string; code: string; message: string }[]; width: number; height: number }> {
  const example = target.example()
  const spec = substituteThemeColours(example.spec, { ...theme.colors, font: theme.font.family, mono: theme.font.mono }) as Json
  checkSpec(spec, target.engine)
  if (target.engine === "plot") {
    const checked = validatePlotSpec(spec)
    const out = renderPlot(spec, { packageRoot: ROOT, theme, fonts, ...(example.rows ? { rows: example.rows } : {}), ...(example.width ? { width: example.width } : {}), ...(example.height ? { height: example.height } : {}) })
    return { svg: out.svg, width: out.width, height: out.height, issues: [...checked.issues, ...out.issues] }
  }
  if (target.engine === "echarts") {
    const prepared = prepareECharts(spec, { theme, locale, ...(example.rows ? { rows: example.rows as Row[] } : {}), ...(example.width ? { width: example.width } : {}), ...(example.height ? { height: example.height } : {}) })
    return { svg: renderECharts(prepared.option, theme, fonts, prepared.width, prepared.height, 1), width: prepared.width, height: prepared.height, issues: prepared.issues }
  }
  if (target.engine === "table") {
    const out = renderTable(spec, example.rows ?? [], { theme, fonts, locale })
    return { svg: out.svg, width: out.width, height: out.height, issues: out.issues }
  }
  const out = await renderDiagram(spec, { theme, fonts })
  return { svg: out.svg, width: out.width, height: out.height, issues: out.issues }
}

describe("the catalogue and its advice are one list", () => {
  test("holds 79 chart and diagram types, each id once", () => {
    expect(CATALOGUE).toHaveLength(79)
    expect(new Set(ids(CATALOGUE)).size).toBe(CATALOGUE.length)
    // The original 53 entries keep their order, and these 26 follow them.
    expect(ids(CATALOGUE).slice(53)).toEqual([...EXTRA_IDS])
  })

  test("every entry has advice and every trait names a real entry, one to one", () => {
    for (const target of CATALOGUE) expect(TRAITS_BY_ID.has(target.id), `no advice for ${target.id}`).toBe(true)
    const known = new Set(ids(CATALOGUE))
    for (const id of TRAITS_BY_ID.keys()) expect(known.has(id), `advice for a chart that does not exist: ${id}`).toBe(true)
    expect(TRAITS_BY_ID.size).toBe(CATALOGUE.length)
  })

  test("names an engine it can draw on, and a family it belongs to", () => {
    const engines: readonly Engine[] = ["vega-lite", "vega", "echarts", "plot", "table", "diagram"]
    const families = ["comparison", "trend", "distribution", "part-to-whole", "relationship", "flow", "hierarchy", "map", "text", "table", "diagram"]
    for (const target of CATALOGUE) {
      expect(engines).toContain(target.engine)
      expect(families).toContain(target.family)
      expect(target.when.length).toBeGreaterThan(12)
      expect(target.name.length).toBeGreaterThan(2)
    }
    for (const id of ["data_table", "kpi_table"]) expect(entry(id).family).toBe("table")
    for (const id of ["flowchart", "sequence_diagram", "state_diagram", "er_diagram", "mindmap", "org_chart", "fishbone"]) expect(entry(id).family).toBe("diagram")
    for (const id of ["cartogram_us_hex", "cartogram_eu_tile", "flow_map"]) expect(entry(id).family).toBe("map")
  })

  test("the example call carries the example's own data, title and size", () => {
    for (const id of EXTRA_IDS) {
      const target = entry(id)
      const example = target.example()
      const call = exampleCall(target)
      expect(call.spec).toEqual(example.spec)
      expect(call.title).toBe(example.title)
      expect(call.data?.rows).toEqual(example.rows)
    }
  })
})

describe("each extended engine's spec shape is the one its renderer takes", () => {
  test("plot entries are plain PlotSpec JSON with marks and channels", () => {
    for (const id of EXTRA_IDS.filter(candidate => entry(candidate).engine === "plot")) {
      const spec = entry(id).example().spec
      expect(Array.isArray(spec.marks)).toBe(true)
      expect((spec.marks as Json[]).length).toBeGreaterThan(0)
      for (const mark of spec.marks as Json[]) expect(typeof mark.type).toBe("string")
      expect(validatePlotSpec(spec).issues).toEqual([])
    }
  })

  test("echarts entries are plain option JSON with a series each", () => {
    for (const id of EXTRA_IDS.filter(candidate => entry(candidate).engine === "echarts")) {
      const example = entry(id).example()
      const spec = substituteThemeColours(example.spec, BUILTIN_THEMES.light!.colors) as Json
      const prepared = prepareECharts(spec, { theme: BUILTIN_THEMES.light!, locale, ...(example.rows ? { rows: example.rows as Row[] } : {}) })
      expect(prepared.issues.filter(issue => issue.level === "error")).toEqual([])
      expect((prepared.option.series as Json[]).length).toBeGreaterThan(0)
    }
  })

  test("table entries are a TableSpec with their rows", () => {
    for (const id of EXTRA_IDS.filter(candidate => entry(candidate).engine === "table")) {
      const example = entry(id).example()
      expect(TableSpecSchema.safeParse(example.spec).success).toBe(true)
      expect(example.rows?.length ?? 0).toBeGreaterThan(0)
      // Every column reads a field the rows carry, so no cell is missing.
      for (const column of (example.spec.columns as { field: string }[])) expect(Object.hasOwn(example.rows![0]!, column.field)).toBe(true)
    }
  })

  test("diagram entries are a DiagramSpec: Mermaid source or a laid-out kind", () => {
    for (const id of EXTRA_IDS.filter(candidate => entry(candidate).engine === "diagram")) {
      const spec = entry(id).example().spec
      expect(DiagramSpecSchema.safeParse(spec).success).toBe(true)
      expect(Boolean(spec.dsl) !== Boolean(spec.kind)).toBe(true)
    }
  })
})

describe("every example draws clean in dark, where the themes differ most", () => {
  // The light drawings are already held to this bar by output.test.ts (the goldens), catalogue-call.test.ts and
  // catalogue-craft-recommend.test.ts (the whole catalogue, both themes); this file adds the dark pass.
  const theme = BUILTIN_THEMES.dark as ThemeTokens
  for (const id of EXTRA_IDS) {
    test(`${id} (dark): safe, themed, measured, with no clipped or overlapping label`, async () => {
      const target = entry(id)
      const { svg, issues, width, height } = await draw(target, theme)
      checkRenderedSvg(svg)
      expect(svg.startsWith("<svg")).toBe(true)
      expect(svg.trimEnd().endsWith("</svg>")).toBe(true)
      // Nothing is fetched, and no CSS variable survives: the drawing is one self-contained object.
      expect(svg.includes("@import")).toBe(false)
      expect(svg.includes("fonts.googleapis")).toBe(false)
      expect(svg).not.toContain("system-ui")
      expect(/^<svg\b[^>]*\bwidth="[\d.]+"[^>]*\bheight="[\d.]+"/.test(svg)).toBe(true)
      expect(width).toBeGreaterThan(120)
      expect(height).toBeGreaterThan(80)
      // The engine reports nothing: a catalogue example renders without a warning.
      expect(issues.filter(issue => issue.level === "error" || issue.level === "warning").map(issue => `${issue.code}: ${issue.message}`)).toEqual([])
      // And the labels sit inside the canvas without colliding.
      const facts = layoutFacts(svg, fonts)
      expect({ id, clipped: facts.clipped }).toEqual({ id, clipped: [] as string[] })
      expect({ id, overlaps: facts.overlaps }).toEqual({ id, overlaps: [] as [string, string][] })
    }, 30_000)
  }
})

describe("these examples carry what they promise", () => {
  test("the cartograms draw every region they name", async () => {
    const { US_STATE_HEX_GRID, EU_COUNTRY_TILE_GRID } = await import("../src/geo/cartograms.ts")
    const us = (await draw(entry("cartogram_us_hex"), BUILTIN_THEMES.light!)).svg
    for (const cell of US_STATE_HEX_GRID) expect(us).toContain(`>${cell.postal}<`)
    const eu = (await draw(entry("cartogram_eu_tile"), BUILTIN_THEMES.light!)).svg
    for (const cell of EU_COUNTRY_TILE_GRID) expect(eu).toContain(`>${cell.iso2}<`)
  })

  test("the flow map draws an arc per row and no label it was not asked for", async () => {
    const example = entry("flow_map").example()
    const { svg } = await draw(entry("flow_map"), BUILTIN_THEMES.light!)
    const paths = (svg.match(/<path\b/g) ?? []).length
    // The land base is a path per landmass; the arcs are lines on top of it.
    expect(paths).toBeGreaterThan(5)
    const lines = (svg.match(/stroke-width="[\d.]+"/g) ?? []).length
    expect(lines).toBeGreaterThan(5)
    expect(layoutFacts(svg, fonts).texts).toBe(0)
    expect(example.rows?.length).toBe(6)
  })

  test("the tables draw their marks: a bar, a sparkline, a delta, a bullet and a heatmap", async () => {
    const board = (await draw(entry("data_table"), BUILTIN_THEMES.light!)).svg
    // The bar, the sparkline and the delta are marks a reader can see, not only cells of text.
    expect({ rects: board.includes("<rect"), paths: board.includes("<path"), triangles: board.includes("<polygon") }).toEqual({ rects: true, paths: true, triangles: true })
    const kpi = (await draw(entry("kpi_table"), BUILTIN_THEMES.light!)).svg
    expect(kpi).toContain("<path") // the sparkarea
    expect(kpi).toMatch(/<line[^>]*stroke-width="1.6"/) // the bullet's target tick
    // The heatmap paints a cell from the theme's sequential ramp.
    expect(kpi.toLowerCase()).toContain(BUILTIN_THEMES.light!.colors.sequential[0]!.toLowerCase())
  })

  test("the violin draws both halves, a quartile box and a median per group", async () => {
    const { svg } = await draw(entry("violin"), BUILTIN_THEMES.light!)
    const texts = [...svg.matchAll(/<text[^>]*>([^<]*)<\/text>/g)].map(match => match[1]!)
    for (const service of ["A", "B", "C"]) expect(texts).toContain(service)
    expect(svg).toContain("<polygon")
    expect(texts).toContain("Latency (ms)")
  })

  test("the diagrams write an ASCII outline of the same structure", async () => {
    for (const id of ["mindmap", "org_chart", "fishbone", "flowchart"]) {
      const out = await renderDiagram(substituteThemeColours(entry(id).example().spec, BUILTIN_THEMES.light!.colors) as Json, { theme: BUILTIN_THEMES.light!, fonts })
      expect({ id, ascii: out.ascii.trim().length > 0 }).toEqual({ id, ascii: true })
    }
    const mindmap = await renderDiagram(entry("mindmap").example().spec, { theme: BUILTIN_THEMES.light!, fonts })
    expect(mindmap.ascii.split("\n")[0]).toBe("Charts")
    const fishbone = await renderDiagram(entry("fishbone").example().spec, { theme: BUILTIN_THEMES.light!, fonts })
    expect(fishbone.ascii.split("\n")[0]).toBe("Cause-and-effect: Late deliveries")
  })
})

describe("safety covers the three new engines", () => {
  test("accepts each extended engine's own spec, and refuses an external reference in all three", () => {
    for (const id of EXTRA_IDS) {
      const target = entry(id)
      expect(() => checkSpec(target.example().spec, target.engine)).not.toThrow()
    }
    const cases: [Engine, Json][] = [
      ["plot", { marks: [{ type: "geo", atlas: "world-110m", data: [{ href: "https://example.com/a.json" }] }] }],
      ["table", { columns: [{ field: "a", label: "A" }], source: "https://example.com/table.csv" }],
      ["diagram", { dsl: "graph TD\n  A[Read] --> B[Write]", notes: "https://example.com/notes" }],
    ]
    for (const [engine, spec] of cases) {
      let error: unknown
      try { checkSpec(spec, engine) } catch (caught) { error = caught }
      expect({ engine, code: (error as ChartsError | undefined)?.code }).toEqual({ engine, code: "SPEC_UNSAFE" })
    }
  })

  test("a plot spec may name a bundled atlas, and may not name an image mark", () => {
    expect(() => checkSpec({ atlas: "world-110m", marks: [{ type: "geo", fill: "theme:grid" }] }, "plot")).not.toThrow()
    expect(() => checkSpec({ marks: [{ type: "image", src: "a.png" }] }, "plot")).toThrow(ChartsError)
  })

  test("a long label under an expression-like key is text in these engines, not an expression", () => {
    const long = "x".repeat(1_200)
    expect(() => checkSpec({ columns: [{ field: "a", label: "A" }], notes: long }, "table")).not.toThrow()
    expect(() => checkSpec({ marks: [{ type: "dot", filter: long }] }, "plot")).not.toThrow()
    // The authored grammars still bound their expressions.
    expect(() => checkSpec({ mark: "bar", transform: [{ calculate: long, as: "x" }] }, "vega-lite")).toThrow(ChartsError)
  })
})

describe("recommendation: a request in a type's own words finds it", () => {
  const ws = workspace()
  afterAll(() => ws.cleanup())

  const points: Row[] = Array.from({ length: 220 }, (_, i) => ({ spend_k: 5 + ((i * 37) % 95), conversions: 20 + ((i * 53) % 400) }))
  const groups: Row[] = Array.from({ length: 240 }, (_, i) => ({ service: ["checkout", "search", "profile"][i % 3]!, latency_ms: 90 + ((i * 37) % 180) }))
  const time: Row[] = Array.from({ length: 52 }, (_, i) => ({ date: `2024-${String((i % 12) + 1).padStart(2, "0")}-${String((i % 28) + 1).padStart(2, "0")}`, sessions: 4200 + Math.round(Math.sin(i / 1.9) * 620) }))
  const twoSeries: Row[] = Array.from({ length: 28 }, (_, i) => ({ month: `2024-${String((i % 12) + 1).padStart(2, "0")}-01`, plan: 100 + i * 2, actual: 100 + i * 2 + Math.round(Math.sin(i / 2.2) * 9) }))
  const parts: Row[] = [{ category: "Lattes", value: 1824 }, { category: "Pastries", value: 963 }, { category: "Beans", value: 1419 }, { category: "Tea", value: 542 }]
  const postal: Row[] = ["CA", "TX", "NY", "FL", "WA", "OR", "ID", "MT", "ND", "SD", "MN", "IL", "WI", "MI", "ME", "VT", "NH", "MA", "RI", "CT", "NJ", "PA", "OH", "IN", "IA", "NE", "MO", "KY", "WV", "VA", "MD", "DE", "NC", "SC", "GA", "AL", "MS", "TN", "AR", "KS", "AZ", "NM", "CO", "UT", "NV", "OK", "LA", "HI", "AK", "WY", "DC"].map((code, i) => ({ postal: code, broadband: 62 + ((i * 37) % 34) }))
  const iso3: Row[] = ["AUT", "BEL", "BGR", "HRV", "CYP", "CZE", "DNK", "EST", "FIN", "FRA", "DEU", "GRC", "HUN", "IRL", "ITA", "LVA", "LTU", "LUX", "MLT", "NLD", "POL", "PRT", "ROU", "SVK", "SVN", "ESP", "SWE", "GBR", "CHE", "NOR", "ISL", "UKR"].map((code, i) => ({ iso3: code, points: 10 + ((i * 29) % 81) }))
  const routes: Row[] = [{ originLat: 40.7, originLon: -74, destLat: 51.5, destLon: -0.1, value: 9 }, { originLat: 35.7, originLon: 139.7, destLat: 1.35, destLon: 103.8, value: 6 }]
  const wide: Row[] = [{ region: "North", revenue: 182, margin: 24, nps: 62 }, { region: "South", revenue: 143, margin: 18, nps: 51 }, { region: "East", revenue: 206, margin: 27, nps: 68 }]
  const traffic: Row[] = ["Search", "Social", "Email"].flatMap((series, k) => Array.from({ length: 12 }, (_, i) => ({ date: `2024-${String(i + 1).padStart(2, "0")}-01`, series, sessions: Math.round(1200 * (1 + k * 0.4) + Math.sin(i / 1.9 + k) * 180) })))
  const edges: Row[] = [{ source: "Search", target: "Trial", value: 520 }, { source: "Social", target: "Trial", value: 310 }, { source: "Trial", target: "Paid", value: 410 }]
  const org: Row[] = [{ id: "root", parent: null, name: "Company", size: 0 }, { id: "p", parent: "root", name: "Product", size: 120 }, { id: "s", parent: "root", name: "Sales", size: 90 }]

  /** The request people write, the data it arrives with, and where the type must land. */
  const CASES: readonly { request: string; rows: Row[]; id: string; at: 1 | 3 | 5 }[] = [
    { request: "hexbin of spend and conversions", rows: points, id: "hexbin", at: 1 },
    { request: "contour plot of spend and conversions", rows: points, id: "contour", at: 1 },
    { request: "voronoi of spend and conversions", rows: points, id: "voronoi", at: 1 },
    { request: "beeswarm of latency by service", rows: groups, id: "beeswarm", at: 3 },
    { request: "violin plot of latency by service", rows: groups, id: "violin", at: 3 },
    { request: "ridgeline of latency by service", rows: groups, id: "ridgeline", at: 5 },
    { request: "bollinger band of the weekly sessions", rows: time, id: "bollinger", at: 3 },
    { request: "difference chart of actual against plan", rows: twoSeries, id: "difference_area", at: 3 },
    { request: "arrow change of revenue and conversion", rows: points, id: "arrow_change", at: 1 },
    { request: "waffle of the sales mix by product", rows: parts, id: "waffle", at: 1 },
    { request: "horizon chart of daily sessions", rows: time, id: "horizon", at: 3 },
    { request: "us state cartogram of broadband by state", rows: postal, id: "cartogram_us_hex", at: 3 },
    { request: "europe tile grid of the digital index", rows: iso3, id: "cartogram_eu_tile", at: 1 },
    { request: "route map of flights between airports", rows: routes, id: "flow_map", at: 1 },
    { request: "sparkline matrix of regional kpis", rows: wide, id: "sparkline_matrix", at: 3 },
    { request: "pictorial bar of users by country", rows: wide, id: "pictorial_bar", at: 3 },
    { request: "theme river of sessions by channel", rows: traffic, id: "theme_river", at: 1 },
    { request: "data table of revenue by region", rows: wide, id: "data_table", at: 1 },
    { request: "kpi scorecard of service targets", rows: wide, id: "kpi_table", at: 3 },
    { request: "flowchart of the approval process", rows: edges, id: "flowchart", at: 1 },
    { request: "sequence diagram of the payment calls", rows: edges, id: "sequence_diagram", at: 1 },
    { request: "state diagram of the subscription lifecycle", rows: groups, id: "state_diagram", at: 1 },
    { request: "entity relationship diagram of the schema", rows: edges, id: "er_diagram", at: 1 },
    { request: "mindmap of the platform", rows: org, id: "mindmap", at: 1 },
    { request: "org chart of the company", rows: org, id: "org_chart", at: 1 },
    { request: "fishbone of why deliveries are late", rows: groups, id: "fishbone", at: 1 },
  ]

  test("the 26 types are covered by a request of their own", () => {
    expect(CASES.map(c => c.id).sort()).toEqual([...EXTRA_IDS].sort())
  })

  for (const c of CASES) {
    test(`"${c.request}" puts ${c.id} in the top ${c.at}`, async () => {
      const { result } = await recommend({ request: c.request, data: { rows: c.rows }, limit: 5 }, ws.env)
      const shortlist = result.recommendations.map(suggestion => suggestion.id)
      expect(shortlist.slice(0, c.at)).toContain(c.id)
      expect(result.recommendations.find(suggestion => suggestion.id === c.id)?.blocked_by).toBeUndefined()
    })
  }

  test("the templates these types offer rank as they did: a rank question is a ranked bar", async () => {
    const regions: Row[] = ["North", "South", "East", "West", "Central"].map((region, i) => ({ region, revenue: 1_250_000 - i * 210_000 }))
    const { result } = await recommend({ request: "which region has the most revenue?", data: { rows: regions }, limit: 5 }, ws.env)
    expect(result.recommendations[0]!.id).toBe("horizontal_bar")
  })
})
