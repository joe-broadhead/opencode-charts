// The catalogue's visual craft, measured in its drawings: no label is cut short, a treemap cell falls back to its
// name rather than an ellipsis, a candlestick's first tick keeps clear of the frame, a force graph fills its canvas,
// a donut labels its slices and a dual axis names its series. Plus the two paths around a refusal: the fitting search
// is bounded, and the recipes a refusal may offer are drawn before they are named. And the recommend lexicon covers
// the Financial Times' Visual Vocabulary and the German, French and Spanish words for the same intents.
import { afterAll, describe, expect, test } from "bun:test"
import { CATALOGUE, exampleCall } from "../src/catalogue.js"
import { fitDocument, resolveFresh } from "../src/document-tool.js"
import { closeVegaWorker } from "../src/engines/vega-pool.js"
import { bundledFonts } from "../src/fonts.js"
import { REFUSAL_RENDERS } from "../src/layout/fit.js"
import { renderChart } from "../src/pipeline.js"
import { recommend } from "../src/recommend/rank.js"
import { textBoxes } from "../src/svg.js"
import { BUILTIN_THEMES } from "../src/themes/tokens.js"
import { ROOT, workspace } from "./helpers.js"

const ws = workspace()
const env = { ...ws.env, assertFiles: async () => undefined }
const fonts = bundledFonts(ROOT)
const THEMES = ["light", "dark"] as const

afterAll(async () => { ws.cleanup(); await closeVegaWorker() })

const catalogue = (id: string) => CATALOGUE.find(entry => entry.id === id)!
const render = (id: string, theme: string) => renderChart({ ...exampleCall(catalogue(id)), theme, formats: ["svg"] }, env, false)
/** Every text node of an SVG, entity-decoded the way a reader sees it. */
const drawn = (svg: string) => [...svg.matchAll(/<text\b[^>]*>([^<]*)<\/text>/g)].map(([, body]) => body!.replaceAll("&amp;", "&").replaceAll("&lt;", "<").replaceAll("&gt;", ">"))

describe("every catalogue example draws clean, in both themes", () => {
  for (const theme of THEMES) {
    test(`${theme}: all ${CATALOGUE.length} entries render at their own size with no finding, no overlap and no clipped label`, async () => {
      const problems: string[] = []
      for (const entry of CATALOGUE) {
        const result = await renderChart({ ...exampleCall(entry), theme, formats: ["svg"] }, env, false)
        const findings = result.issues.filter(issue => issue.level === "error" || issue.level === "warning").map(issue => `${issue.code} at ${issue.path ?? "/"}`)
        if (findings.length) problems.push(`${entry.id}: ${findings.join("; ")}`)
        if (result.layout.overlaps.length) problems.push(`${entry.id}: overlapping labels ${JSON.stringify(result.layout.overlaps.slice(0, 3))}`)
        if (result.layout.clipped.length) problems.push(`${entry.id}: clipped labels ${JSON.stringify(result.layout.clipped.slice(0, 3))}`)
      }
      expect(problems).toEqual([])
    }, 180_000)
  }

  test("treemap: a cell too narrow for \"Name · size\" falls back to its name, and no label is ever cut to \"…\"", async () => {
    for (const theme of THEMES) {
      const svg = (await render("treemap", theme)).svg
      const texts = drawn(svg)
      // Vega's `limit` draws an ellipsis; the example measures the cell itself instead.
      expect(texts.filter(text => text.includes("…"))).toEqual([])
      expect(texts.some(text => /^.{1}…$/.test(text))).toBe(false)
      // The cells that fit are labelled, with the size when there is room and the name alone when there is not.
      expect(texts).toContain("Design · 116")
      expect(texts).toContain("Support")
    }
  })

  test("candlestick: no tick label crowds the frame, and the dates read as dates", async () => {
    for (const theme of THEMES) {
      const { svg } = await render("candlestick", theme)
      const boxes = textBoxes(svg, fonts).boxes
      expect(Math.min(...boxes.map(box => box.x0))).toBeGreaterThanOrEqual(12)
      expect(boxes.map(box => box.text).filter(text => /^\d{4}-\d{2}-\d{2}$/.test(text))).toEqual([])
      expect(boxes.map(box => box.text).filter(text => /^\d{2} Mar$/.test(text)).length).toBeGreaterThanOrEqual(5)
    }
  })

  test("calendar heatmap: day names are unambiguous and the year's last week stays inside the frame", async () => {
    for (const theme of THEMES) {
      const { svg, width } = await render("calendar_heatmap", theme)
      const boxes = textBoxes(svg, fonts).boxes
      expect(boxes.map(box => box.text).filter(text => ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].includes(text))).toHaveLength(7)
      expect(boxes.filter(box => box.text.length === 1 && /[SMTWF]/.test(box.text))).toEqual([])
      expect(Math.max(...boxes.map(box => box.x1))).toBeLessThanOrEqual(width - 8)
    }
  })

  test("network: the force graph fills most of its canvas and every label sits clear of the nodes", async () => {
    for (const theme of THEMES) {
      const { svg, width, height } = await render("network", theme)
      const group = /<g class="mark-symbol role-mark nodes"[^>]*>([\s\S]*?)<\/g>/.exec(svg)?.[1] ?? ""
      const points = [...group.matchAll(/<path transform="translate\(([-\d.]+),([-\d.]+)\)"/g)].map(([, x, y]) => [Number(x), Number(y)] as const)
      expect(points).toHaveLength(10)
      const [xs, ys] = [points.map(point => point[0]), points.map(point => point[1])]
      expect((Math.max(...xs) - Math.min(...xs)) / width).toBeGreaterThan(0.55)
      expect((Math.max(...ys) - Math.min(...ys)) / height).toBeGreaterThan(0.5)
      // A label is placed 15 px above its node: every text box keeps clear of every node circle (radius ≈ 9 px).
      for (const box of textBoxes(svg, fonts).boxes) {
        for (const [x, y] of points) {
          const [dx, dy] = [Math.max(box.x0 - x, 0, x - box.x1), Math.max(box.y0 - y, 0, y - box.y1)]
          expect(Math.hypot(dx, dy), `label ${JSON.stringify(box.text)} sits on the node at ${x.toFixed(0)},${y.toFixed(0)}`).toBeGreaterThan(9)
        }
      }
    }
  })

  test("donut: every slice carries its share, the total sits in the hole, and the legend names the items", async () => {
    for (const theme of THEMES) {
      const texts = drawn((await render("donut", theme)).svg)
      for (const share of ["52%", "21%", "17%", "10%"]) expect(texts).toContain(share)
      for (const item of ["€4.2M", "Payroll", "Infrastructure", "Marketing", "Other"]) expect(texts).toContain(item)
    }
  })

  test("dual axis: both measures are named in a legend, so the reader knows which scale is which", async () => {
    for (const theme of THEMES) {
      const { svg } = await render("dual_axis", theme)
      const texts = drawn(svg)
      expect(svg).toContain("role-legend")
      expect(texts).toContain("Orders")
      expect(texts).toContain("Average basket (€)")
    }
  })

  test("small multiples: the second row's headers are separated from the first row's panels", async () => {
    const { svg } = await render("small_multiples", "light")
    const boxes = textBoxes(svg, fonts).boxes
    const header = (text: string) => boxes.find(box => box.text === text)!
    const rowGap = header("South").y0 - header("East").y1
    // The panel is 120 px tall and the facets keep 24 px of space, so the rows cannot read as one panel's headings.
    expect(rowGap).toBeGreaterThan(120 + 24)
  })

  test("sankey: labels stand off the ribbons, on the outside of their node columns", async () => {
    const { svg, width } = await render("sankey", "light")
    const boxes = textBoxes(svg, fonts).boxes
    const box = (text: string) => boxes.find(entry => entry.text === text)!
    // The three sources are labelled to the left of the first node column, the two ends to the right of the last.
    for (const source of ["Search", "Social", "Referral"]) expect(box(source).x1).toBeLessThan(96)
    for (const sink of ["Paid", "Churned"]) {
      expect(box(sink).x0).toBeGreaterThan(width - 96)
      expect(box(sink).x1).toBeLessThanOrEqual(width - 4)
    }
  })
})

describe("the catalogue's own visual craft", () => {
  test("the Plot entries name both of the axes they measure", async () => {
    for (const theme of THEMES) {
      for (const id of ["hexbin", "contour", "voronoi"]) {
        // Plot writes its axis titles with a direction arrow: the measure is what matters here, not the glyph.
        const texts = drawn((await render(id, theme)).svg)
        expect({ id, theme, x: texts.some(text => text.includes("Spend (€k)")) }).toEqual({ id, theme, x: true })
        expect({ id, theme, y: texts.some(text => text.includes("Conversions")) }).toEqual({ id, theme, y: true })
      }
    }
  })

  test("theme river: all twelve months read on the axis, and the standfirst says what the strip is", async () => {
    for (const theme of THEMES) {
      const texts = drawn((await render("theme_river", theme)).svg)
      for (const month of ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]) {
        expect({ theme, month, shown: texts.includes(month) }).toEqual({ theme, month, shown: true })
      }
      expect(texts).not.toContain("2024")
      expect(texts).toContain("Monthly sessions across four acquisition channels, 2024")
    }
  })

  test("sparkline matrix: Title Case metric headers over one small trend in every cell", async () => {
    for (const theme of THEMES) {
      const { svg } = await render("sparkline_matrix", theme)
      const texts = drawn(svg)
      for (const header of ["Revenue", "Margin", "NPS", "Churn"]) expect({ theme, header, shown: texts.includes(header) }).toEqual({ theme, header, shown: true })
      // Four regions by four metrics: one line and one area per cell, each on its own hidden axes.
      const cells = (svg.match(/<path[^>]*stroke-width="1.75"/g) ?? []).length
      expect({ theme, cells }).toEqual({ theme, cells: 16 })
      expect(texts.filter(text => text === "Regional KPIs")).toHaveLength(1)
    }
  })

  test("publication table: a header per group value, and the trend under the Shape spanner", async () => {
    for (const theme of THEMES) {
      const texts = drawn((await render("data_table", theme)).svg)
      // Interleaved rows still get one section each, in the order the values first appear.
      expect({ theme, enterprise: texts.filter(text => text === "Enterprise").length }).toEqual({ theme, enterprise: 1 })
      expect({ theme, smb: texts.filter(text => text === "SMB").length }).toEqual({ theme, smb: 1 })
      expect(texts.indexOf("North")).toBeLessThan(texts.indexOf("East"))
      expect(texts.indexOf("East")).toBeLessThan(texts.indexOf("South"))
      for (const spanner of ["Money", "Delivery", "Shape"]) expect({ theme, spanner, shown: texts.includes(spanner) }).toEqual({ theme, spanner, shown: true })
    }
  })

  test("horizon: the four folds take four distinct steps of the theme's own ramp", async () => {
    for (const theme of THEMES) {
      const { svg } = await render("horizon", theme)
      const ramp = new Set(BUILTIN_THEMES[theme]!.colors.sequential.map(colour => colour.toUpperCase()))
      const fills = new Set([...svg.matchAll(/fill="(#[0-9a-fA-F]{6})"/g)].map(match => match[1]!.toUpperCase()))
      const fromRamp = [...fills].filter(fill => ramp.has(fill))
      // Four steps, none of them the near-white first stop that would vanish on the page.
      expect({ theme, folds: fromRamp.length }).toEqual({ theme, folds: 4 })
      expect({ theme, first: fromRamp.includes(BUILTIN_THEMES[theme]!.colors.sequential[0]!.toUpperCase()) }).toEqual({ theme, first: false })
      const texts = drawn(svg)
      for (const fold of ["B1", "B2", "B3", "B4"]) expect({ theme, fold, shown: texts.includes(fold) }).toEqual({ theme, fold, shown: true })
    }
  })

  test("diagrams: a schema's cards carry their attributes, and every wide drawing fits the frame's column", async () => {
    for (const theme of THEMES) {
      const schema = await render("er_diagram", theme)
      const texts = drawn(schema.svg)
      expect(texts).not.toContain("(no attributes)")
      for (const attribute of ["customer_id", "order_id", "unit_price", "sku", "code"]) {
        expect({ theme, attribute, shown: texts.includes(attribute) }).toEqual({ theme, attribute, shown: true })
      }
      // A Mermaid layout sizes itself from its nodes; the frame fits it to a page column rather than printing a wall.
      for (const id of ["er_diagram", "flowchart", "fishbone"]) {
        const width = (await render(id, theme)).width
        expect({ id, theme, fits: width <= 820 }).toEqual({ id, theme, fits: true })
      }
    }
  })
})

describe("a refusal is bounded, and every alternative it names was drawn", () => {
  const recipe = (id: string, rows: Record<string, unknown>[], bindings: Record<string, string>, width: number, height: number) =>
    ({ version: 1, title: "Tickets by region", chart: { kind: "recipe", recipe: id, data: { rows }, bindings }, layout: { mode: "fixed", width, height } })
  const LONG = ["Northern Europe and the Baltic states", "Southern Europe", "Middle East and North Africa", "Sub-Saharan Africa", "Latin America and the Caribbean", "East Asia and Pacific"]
  const rows = LONG.map((category, i) => ({ category, tickets: 40 + i * 37 }))
  const fits = (doc: Record<string, unknown>) => resolveFresh(env, doc).then(resolved => fitDocument(env, resolved)).then(() => true, (error: { code?: string }) => {
    if (error.code !== "LAYOUT_UNSATISFIABLE") throw error
    return false
  })

  test("an unsatisfiable 60 × 60 px canvas refuses within a second and a half, whatever the chart", async () => {
    const tiny = recipe("grouped_bar", LONG.flatMap((category, i) => ["Online", "Retail", "Wholesale"].map((series, j) => ({ category, series, tickets: 10 + i + j }))), { category: "category", series: "series", value: "tickets" }, 60, 60)
    const started = Date.now()
    const resolved = await resolveFresh(env, tiny)
    const error = await fitDocument(env, resolved).then(() => undefined, (e: { code?: string }) => e)
    expect(error?.code).toBe("LAYOUT_UNSATISFIABLE")
    expect(Date.now() - started).toBeLessThan(1500)
    // The search is capped, so no canvas can make a refusal draw without limit.
    expect(REFUSAL_RENDERS).toBeGreaterThan(0)
    expect(REFUSAL_RENDERS).toBeLessThanOrEqual(40)
  }, 60_000)

  test("a pie of long labels on a narrow canvas offers the horizontal bar that draws at that size", async () => {
    const pie = recipe("pie", rows, { category: "category", value: "tickets" }, 420, 300)
    const resolved = await resolveFresh(env, pie)
    const error = await fitDocument(env, resolved).then(() => undefined, (e: { code?: string; issues?: readonly { fix?: string }[] }) => e)
    expect(error?.code).toBe("LAYOUT_UNSATISFIABLE")
    const fix = error!.issues![0]!.fix!
    expect(fix.startsWith('A horizontal_bar of the same data fits 420×300 px')).toBe(true)
    // The swap shares the pie's bindings, so the same document draws as a horizontal bar at that size.
    expect(await fits({ ...pie, chart: { ...(pie.chart as object), recipe: "horizontal_bar" } })).toBe(true)
  }, 60_000)

  test("a size a swap is said to need draws at that size too", async () => {
    const pie = recipe("pie", rows, { category: "category", value: "tickets" }, 240, 260)
    const resolved = await resolveFresh(env, pie)
    const error = await fitDocument(env, resolved).then(() => undefined, (e: { code?: string; issues?: readonly { fix?: string }[] }) => e)
    const fix = error!.issues![0]!.fix!
    const named = /A horizontal_bar does not fit 240×260 px either; it fits at (\d+) px wide at 260 px tall/.exec(fix)
    expect(named).not.toBeNull()
    expect(await fits({ ...recipe("horizontal_bar", rows, { category: "category", value: "tickets" }, Number(named![1]), 260) })).toBe(true)
  }, 60_000)

  test("the recipes a refusal may offer take the same bindings, so the same document compiles as each of them", async () => {
    const grouped = recipe("grouped_bar", LONG.flatMap((category, i) => ["Online", "Retail stores", "Wholesale partners"].map((series, j) => ({ category, series, tickets: 10 + i * 3 + j }))), { category: "category", series: "series", value: "tickets" }, 720, 480)
    const pie = recipe("pie", rows, { category: "category", value: "tickets" }, 720, 480)
    const as = (doc: Record<string, unknown>, swap: string) => ({ ...doc, chart: { ...(doc.chart as object), recipe: swap } })
    // A grouped bar and a stacked bar bind category, series and value alike; a pie and a horizontal bar bind category
    // and value alike. Each draws at a size that leaves room, so no swap a refusal names is missing a binding.
    expect(await fits(grouped)).toBe(true)
    expect(await fits(as(grouped, "stacked_bar"))).toBe(true)
    expect(await fits(pie)).toBe(true)
    expect(await fits(as(pie, "horizontal_bar"))).toBe(true)
  }, 60_000)
})

describe("recommend: the Visual Vocabulary's intents, in English, German, French and Spanish", () => {
  const traffic = ["Search", "Social", "Email"].flatMap(channel => ["2024-01-01", "2024-02-01", "2024-03-01", "2024-04-01"].map((month, i) => ({ channel, month, sessions: 100 + i * 20 })))
  const regions = ["North", "South", "East", "West", "Central"].map((region, i) => ({ region, revenue: 1_250_000 - i * 210_000 }))
  const latency = Array.from({ length: 300 }, (_, i) => ({ service: ["checkout", "search", "profile"][i % 3], latency_ms: 90 + ((i * 37) % 180) }))
  const budget = [{ item: "Payroll", share: 0.52 }, { item: "Infrastructure", share: 0.21 }, { item: "Marketing", share: 0.17 }, { item: "Other", share: 0.1 }]
  const signups = [{ source: "Search", target: "Trial", value: 520 }, { source: "Social", target: "Trial", value: 310 }, { source: "Trial", target: "Paid", value: 410 }, { source: "Trial", target: "Churned", value: 590 }]
  const checkout = [{ stage: "Visited", users: 10000 }, { stage: "Viewed product", users: 6200 }, { stage: "Added to basket", users: 2400 }, { stage: "Checkout", users: 1300 }, { stage: "Paid", users: 980 }]
  const org = [{ id: "root", parent: null, name: "Company", size: 0 }, { id: "prod", parent: "root", name: "Product", size: 120 }, { id: "sales", parent: "root", name: "Sales", size: 90 }, { id: "web", parent: "prod", name: "Web", size: 50 }]
  const world = [{ country: "Germany", internet_pct: 93 }, { country: "France", internet_pct: 92 }, { country: "Spain", internet_pct: 96 }, { country: "Italy", internet_pct: 85 }]

  interface Case { readonly request: string; readonly rows: readonly Record<string, unknown>[]; readonly must: readonly string[]; readonly mustNot?: readonly string[]; readonly understood?: readonly string[] }

  const CASES: readonly Case[] = [
    // The Visual Vocabulary's intents: deviation, ranking, distribution, composition, flow, hierarchy and spatial.
    { request: "show the deviation from target by region", rows: regions, must: ["diverging_bar", "bar"], mustNot: ["pie", "histogram"] },
    { request: "which regions are in surplus and which in deficit?", rows: regions, must: ["diverging_bar", "bar"], mustNot: ["pie", "line"], understood: ["surplus", "deficit"] },
    { request: "build a league table of regions by revenue", rows: regions, must: ["horizontal_bar"], mustNot: ["pie"], understood: ["league"] },
    { request: "what is the spread of latency across services?", rows: latency, must: ["box_plot", "histogram"], mustNot: ["pie", "sankey"] },
    { request: "show the composition of sessions over time by channel", rows: traffic, must: ["stacked_bar", "stacked_area", "streamgraph"], mustNot: ["scatter", "sankey"] },
    { request: "show me the journey from sign-up to paid", rows: signups, must: ["sankey"], mustNot: ["pie"], understood: ["journey"] },
    { request: "where do we lose users? attrition and drop-off by stage", rows: checkout, must: ["funnel"], mustNot: ["pie"], understood: ["attrition"] },
    { request: "show the org structure of the company", rows: org, must: ["tree", "treemap", "sunburst"], mustNot: ["histogram", "scatter"] },
    { request: "map the geographic spread by country", rows: world, must: ["choropleth_world"], mustNot: ["scatter", "sankey"], understood: ["geographic"] },
    // German: Umsatz, Verlauf, Verteilung, Vergleich, Anteil.
    { request: "wie entwickeln sich die sessions im verlauf?", rows: traffic, must: ["line", "multi_line", "area"], understood: ["verlauf", "entwickeln"] },
    { request: "zeige die verteilung der latenz", rows: latency, must: ["histogram", "box_plot", "density"], understood: ["verteilung"] },
    { request: "vergleich des umsatzes je region", rows: regions, must: ["bar", "dot_plot", "diverging_bar"], mustNot: ["pie"], understood: ["vergleich", "umsatzes"] },
    { request: "anteil des budgets je posten", rows: budget, must: ["donut", "pie"], mustNot: ["histogram"], understood: ["anteil"] },
    // French: évolution, répartition, comparaison.
    { request: "évolution des sessions par canal", rows: traffic, must: ["line", "multi_line", "small_multiples"], understood: ["evolution"] },
    { request: "répartition du budget par poste", rows: budget, must: ["donut", "pie"], mustNot: ["histogram"], understood: ["repartition"] },
    // Spanish: evolución, distribución, clasificación, participación.
    { request: "evolución de las sesiones por canal", rows: traffic, must: ["line", "multi_line", "small_multiples"], understood: ["evolucion"] },
    { request: "distribución de la latencia por servicio", rows: latency, must: ["histogram", "box_plot", "density"], understood: ["distribucion"] },
    { request: "clasificación de las regiones por ingresos", rows: regions, must: ["horizontal_bar"], mustNot: ["pie"], understood: ["clasificacion"] },
    { request: "participación del presupuesto por partida", rows: budget, must: ["donut", "pie"], mustNot: ["histogram"], understood: ["participacion"] },
  ]

  for (const c of CASES) test(c.request, async () => {
    const { result } = await recommend({ request: c.request, data: { rows: [...c.rows] }, limit: 5 }, env)
    const ids = result.recommendations.map(r => r.id)
    expect(ids.some(id => c.must.includes(id)), `expected one of ${c.must.join(", ")} in ${ids.join(", ")}`).toBe(true)
    for (const id of c.mustNot ?? []) expect(ids, `${id} must not be recommended here`).not.toContain(id)
    // A word the lexicon knows is not reported as not understood.
    for (const word of c.understood ?? []) expect(result.request.unmatched).not.toContain(word)
    expect(result.abstain).toBeUndefined()
  })

  test("an accented word and its unaccented spelling name the same intent", async () => {
    const accented = await recommend({ request: "évolution des sessions par canal", data: { rows: traffic } }, env)
    const plain = await recommend({ request: "evolution des sessions par canal", data: { rows: traffic } }, env)
    expect(accented.result.request.tasks.map(t => t.task)).toEqual(plain.result.request.tasks.map(t => t.task))
    expect(accented.result.recommendations.map(r => r.id)).toEqual(plain.result.recommendations.map(r => r.id))
  })
})
