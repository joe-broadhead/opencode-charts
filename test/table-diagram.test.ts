import { describe, expect, test } from "bun:test"
import type { Row } from "../src/data.js"
import { renderDiagram, DiagramSpecSchema, architectureDsl } from "../src/engines/diagram.js"
import {
  formatCellValue,
  formatDate,
  formatNumber,
  mixColour,
  numberOf,
  renderTable,
  sampleRamp,
  TableSpecSchema,
  withAlpha,
} from "../src/engines/table.js"
import { bundledFonts, type FontBook } from "../src/fonts.js"
import { resolveLocale } from "../src/locale.js"
import { svgToPng } from "../src/png.js"
import { checkRenderedSvg } from "../src/safety.js"
import { layoutFacts } from "../src/svg.js"
import { contrast } from "../src/themes/contrast.js"
import { BUILTIN_THEMES, type ThemeTokens } from "../src/themes/tokens.js"
import { ROOT } from "./helpers.js"

/**
 * The table and diagram engines. What is checked here is the promise both make: a drawing that is measured with the
 * bundled fonts (so no label clips), self-contained (so nothing is fetched and every glyph draws), byte-identical on a
 * second render, and clean enough to rasterise through resvg.
 */

const fonts: FontBook = bundledFonts(ROOT)
const light = BUILTIN_THEMES.light as ThemeTokens
const dark = BUILTIN_THEMES.dark as ThemeTokens
const THEMES = Object.entries(BUILTIN_THEMES) as [string, ThemeTokens][]

const ROWS: Row[] = [
  { region: "North and Midlands", revenue: 1240.5, growth: 0.142, score: 82, target: 90, trend: [12, 15, 11, 19, 24], mix: "Enterprise", status: "On track", share: 0.32, opened: "2026-11-14", target2: 88 },
  { region: "South", revenue: 890, growth: -0.031, score: 64, target: 70, trend: [18, 16, 14, 13, 12], mix: "SMB", status: "At risk", share: -0.23, opened: "2026-01-02", target2: 70 },
  { region: "East", revenue: 1430.25, growth: 0.225, score: 91, target: 88, trend: [9, 12, 14, 17, 21], mix: "Enterprise", status: "Ahead", share: 0.37, opened: "2026-06-30", target2: 84 },
]

const TABLE = {
  title: "Regional revenue, 2026",
  subtitle: "Growth against target, with a five-quarter trend",
  kicker: "Commercial review",
  source: "Source: finance close, November 2026",
  notes: "Targets are board-approved plan.",
  rowGroupField: "mix",
  zebra: true,
  highlightRows: ["East"],
  summaryRow: { label: "Total", operations: { revenue: "sum", growth: "mean" } },
  columns: [
    { field: "region", label: "Region" },
    { field: "revenue", label: "Revenue", spanner: "Money", format: "currency", cell: "bar" },
    { field: "growth", label: "Growth", spanner: "Money", format: "percent", cell: "delta" },
    { field: "score", label: "Score", spanner: "Delivery", cell: "bullet", targetField: "target" },
    { field: "trend", label: "Trend", spanner: "Shape", cell: "sparkline" },
    { field: "trend", label: "Area", spanner: "Shape", cell: "sparkarea" },
    { field: "trend", label: "Bars", spanner: "Shape", cell: "sparkbar" },
    { field: "status", label: "Status", cell: "badge", badgeColors: { "At risk": "#CC3344", Ahead: "#228833" } },
    { field: "share", label: "Share", format: "percent", cell: "heatmap" },
    { field: "mix", label: "Mix", cell: "dot" },
  ],
}

/** Every `<text>` character the drawing would ask a font for. */
function drawnCharacters(svg: string): string[] {
  const found: string[] = []
  for (const match of svg.matchAll(/<text\b[^>]*>([\s\S]*?)<\/text>/g)) {
    for (const character of match[1]!.replace(/<[^>]+>/g, "")) found.push(character)
  }
  return found
}

/** Characters no bundled face can draw: they would become blank boxes. */
function uncoveredGlyphs(svg: string, book: FontBook): string[] {
  const missing = new Set<string>()
  for (const character of drawnCharacters(svg)) {
    const point = character.codePointAt(0)!
    if (point < 0x21 || book.covers(point)) continue
    missing.add(character)
  }
  return [...missing]
}

/** Every URL in a drawing, except the SVG namespace, which is an identifier and not something to load. */
function externalUrls(svg: string): string[] {
  return [...svg.matchAll(/https?:\/\/[^\s"'<>)]+/g)].map(match => match[0]).filter(url => url !== "http://www.w3.org/2000/svg")
}

/** The root element must carry pixel numbers, not percentages or `100%`. */
const numericSize = (svg: string) => /^<svg\b[^>]*\bwidth="[\d.]+"[^>]*\bheight="[\d.]+"/.test(svg)

describe("the table engine", () => {
  test("draws every mark in every built-in theme with no clipped or colliding label", () => {
    for (const [name, theme] of THEMES) {
      const table = renderTable(TABLE, ROWS, { theme, fonts })
      checkRenderedSvg(table.svg)
      expect(numericSize(table.svg)).toBe(true)
      const facts = layoutFacts(table.svg, fonts)
      expect({ theme: name, clipped: facts.clipped, overlaps: facts.overlaps }).toEqual({ theme: name, clipped: [], overlaps: [] })
      // The measurement is real: every header, value, spanner and section band is in there.
      expect(facts.texts).toBeGreaterThan(35)
      expect(table.width).toBeGreaterThan(320)
      expect(table.height).toBeGreaterThan(80)
      // Nothing is fetched: no import, no URL and no font face beyond the two bundled families.
      expect(externalUrls(table.svg)).toEqual<void[]>([])
      expect(table.svg).not.toContain("@import")
      expect(table.svg).not.toContain("@font-face")
      expect(uncoveredGlyphs(table.svg, fonts)).toEqual<string[]>([])
    }
  })

  test("draws a mark for each cell kind it is asked for", () => {
    const single = (kind: string, extra: Record<string, unknown> = {}) =>
      renderTable(
        { columns: [{ field: "v", label: "Value", cell: kind, ...extra }], title: kind },
        [{ v: kind === "badge" ? "On track" : kind === "sparkline" || kind === "sparkarea" || kind === "sparkbar" ? [3, 8, 5, 11] : 42, t: 30 }],
        { theme: light, fonts },
      ).svg

    for (const kind of ["bar", "sparkline", "sparkarea", "sparkbar", "bullet", "delta", "badge", "heatmap", "dot"]) {
      const svg = single(kind, kind === "bullet" ? { targetField: "t" } : kind === "badge" ? { badgeColors: { "On track": "#228833" } } : {})
      checkRenderedSvg(svg)
      expect(svg.length).toBeGreaterThan(400)
    }
    expect(single("bar")).toContain("<rect")
    expect(single("sparkline")).toContain("<path")
    expect(single("sparkline")).toContain("<circle")
    expect(single("sparkarea")).toMatch(/Z" fill="#[0-9a-f]{8}"/)
    expect(single("sparkbar")).toMatch(/<rect[^>]*rx="1"/)
    expect(single("bullet", { targetField: "t" })).toMatch(/<line[^>]*stroke-width="1.6"/)
    expect(single("delta")).toContain("<polygon")
    expect(single("badge", { badgeColors: { "On track": "#228833" } })).toContain(mixColour(light.colors.background, "#228833", 0.16))
    // One value of 42 with no explicit domain fills the ramp's middle.
    expect(single("heatmap")).toContain(sampleRamp(light.colors.sequential, 0.5))
    expect(single("dot")).toContain("<circle")
  })

  test("draws spanners, section bands and a computed summary row", () => {
    const table = renderTable(TABLE, ROWS, { theme: light, fonts })
    const texts = [...table.svg.matchAll(/<text\b[^>]*>([^<]*)<\/text>/g)].map(match => match[1]!)
    // Spanners: each label once, over its run of columns, with a 1px rule beneath.
    expect(texts.filter(text => text === "Money")).toHaveLength(1)
    expect(texts.filter(text => text === "Shape")).toHaveLength(1)
    expect(table.svg).toMatch(/stroke-width="1\.5"/)
    // Section bands, in the order the rows name them.
    expect(texts).toContain("Enterprise")
    expect(texts).toContain("SMB")
    expect(texts.indexOf("SMB")).toBeGreaterThan(texts.indexOf("Enterprise"))
    // The summary row: its label, the summed revenue and the mean growth, formatted as their columns ask.
    expect(texts).toContain("Total")
    expect(texts).toContain("$3,560.75")
    expect(texts).toContain("11.2%")
    // A delta reads a fraction as a percentage, the same way `format: "percent"` does, and signs it.
    expect(texts).toContain("+14.2%")
    expect(texts).toContain("-3.1%")
    expect(texts).toContain("+22.5%")
  })

  test("one section per group value, in the order the values first appear", () => {
    // The rows interleave Enterprise, SMB, Enterprise: a reader still gets one Enterprise header, then one SMB header.
    const table = renderTable({ ...TABLE, columns: TABLE.columns.slice(0, 2), summaryRow: undefined, highlightRows: undefined }, ROWS, { theme: light, fonts })
    const texts = [...table.svg.matchAll(/<text\b[^>]*>([^<]*)<\/text>/g)].map(match => match[1]!)
    expect(texts.filter(text => text === "Enterprise")).toHaveLength(1)
    expect(texts.filter(text => text === "SMB")).toHaveLength(1)
    // The two Enterprise rows are drawn together, before the SMB row: one section, not two.
    expect(texts.indexOf("Enterprise")).toBeLessThan(texts.indexOf("SMB"))
    const north = texts.indexOf("North and Midlands"), east = texts.indexOf("East"), south = texts.indexOf("South")
    expect(north).toBeLessThan(east)
    expect(east).toBeLessThan(south)
    // A grouped page keeps the same sections, so sorting and filtering act inside a group.
    expect((table.html.match(/<tr class="group"/g) ?? []).length).toBe(2)
  })

  test("the kicker starts at the table's own left margin, in the theme's highlight ink", () => {
    const table = renderTable(TABLE, ROWS, { theme: light, fonts })
    const xOf = (label: string) => Number(new RegExp(`<text x="([\\d.]+)"[^>]*>${label}</text>`).exec(table.svg)![1])
    expect(xOf("COMMERCIAL REVIEW")).toBe(xOf("Regional revenue, 2026"))
    expect(table.svg).toMatch(new RegExp(`<text x="[\\d.]+" y="[\\d.]+"[^>]*fill="${light.colors.highlight}"[^>]*>COMMERCIAL REVIEW</text>`))
  })

  test("a badge's pill is an opaque tint, and its ink clears 4.5:1 in every built-in theme", () => {
    const badges = { columns: [{ field: "status", label: "Status", cell: "badge", badgeColors: { "At risk": "#CC3344", Ahead: "#228833" } }], title: "Status" }
    for (const [name, theme] of THEMES) {
      const svg = renderTable(badges, ROWS, { theme, fonts }).svg
      // Each pill is a rounded rect and the ink that sits on it is the text drawn immediately inside it.
      const pills = [...svg.matchAll(/<rect[^>]*\brx="[\d.]+"[^>]*\bfill="(#[0-9a-fA-F]{6})"[^>]*\/><text[^>]*\bfill="(#[0-9a-fA-F]{6})"[^>]*>([^<]*)<\/text>/g)]
      expect({ theme: name, pills: pills.length }).toEqual({ theme: name, pills: 3 })
      for (const [, fill, ink, label] of pills) {
        // An opaque #rrggbb, never an 8-digit translucent fill measured as if it were solid.
        expect(fill).toMatch(/^#[0-9a-f]{6}$/i)
        expect({ theme: name, label, ratio: Number(contrast(ink!, fill!)!.toFixed(2)) }).toMatchObject({ theme: name })
        expect(contrast(ink!, fill!)).toBeGreaterThanOrEqual(4.5)
      }
    }
  })

  test("sorts before it limits, and tints the rows it is asked to", () => {
    const table = renderTable(
      { ...TABLE, rowGroupField: undefined, summaryRow: undefined, highlightRows: [0], sortBy: { field: "revenue", order: "desc" }, limit: 2 },
      ROWS,
      { theme: light, fonts },
    )
    const texts = [...table.svg.matchAll(/<text\b[^>]*>([^<]*)<\/text>/g)].map(match => match[1]!)
    expect(texts).toContain("East")
    expect(texts).toContain("North and Midlands")
    expect(texts).not.toContain("South")
    expect(table.svg).toContain(withAlpha(light.colors.highlight, 0.12))
  })

  test("writes a semantic HTML grid that sorts, filters and copies TSV", () => {
    const table = renderTable(TABLE, ROWS, { theme: dark, fonts })
    const html = table.html
    expect(html.startsWith("<!doctype html>")).toBe(true)
    expect(html).toContain('role="grid"')
    expect(html).toContain("<caption>")
    expect(html).toContain("<thead>")
    expect(html).toContain("<tfoot>")
    expect(html).toContain('scope="colgroup"')
    expect(html).toContain('data-sort-value="1430.25"')
    expect(html).toContain('data-tsv="East"')
    expect(html).toContain('aria-sort="none"')
    expect(html).toContain("position:sticky")
    expect(html).toContain('type="search"')
    expect(html).toContain("Copy TSV")
    expect(html).toContain('role="status"')
    // The marks come along as inline SVG, so the HTML is the same graphic and not a plainer copy.
    expect(html).toContain('<svg xmlns="http://www.w3.org/2000/svg"')
    expect(html).toContain("<polygon")
    // Self-contained: the only URL is the SVG namespace on the inline marks.
    expect(externalUrls(html)).toEqual<void[]>([])
    expect(html).not.toContain("@import")
    // The behaviour is a plain script with listeners, not inline handlers, so a strict page can load it as one block.
    const script = /<script>\n([\s\S]*?)\n<\/script>/.exec(html)?.[1]
    expect(script).toBeDefined()
    expect(() => new Function(script!)).not.toThrow()
    expect(html).not.toMatch(/\son[a-z]+="/)
  })

  test("formats numbers, money, percentages, compact units and dates from the locale", () => {
    expect(formatNumber(1234567.891, 2)).toBe("1,234,567.89")
    expect(formatNumber(-42, 0)).toBe("-42")
    expect(formatNumber(Number.NaN, 0)).toBe("—")
    const de = resolveLocale(ROOT, "de-DE")
    expect(formatNumber(1234567.891, 2, { decimal: ",", thousands: ".", grouping: [3], currency: ["", " €"] })).toBe("1.234.567,89")
    const column = { field: "v", format: "currency" as const }
    expect(formatCellValue(column, 1240.5)).toBe("$1,240.50")
    expect(formatCellValue(column, -40)).toBe("-$40.00")
    expect(formatCellValue(column, 1240.5, { decimal: ",", thousands: ".", grouping: [3], currency: ["", " €"] })).toBe("1.240,50 €")
    expect(formatCellValue({ field: "v", format: "percent" }, 0.142)).toBe("14.2%")
    expect(formatCellValue({ field: "v", format: "compact" }, 1240000)).toBe("1.2M")
    expect(formatCellValue({ field: "v", format: "integer" }, 12.7)).toBe("13")
    expect(formatCellValue({ field: "v", format: "number", decimals: 0 }, 3.4)).toBe("3")
    expect(formatDate("2026-11-14")).toBe("14 Nov 2026")
    expect(formatDate("not a date")).toBe("not a date")
    expect(numberOf("€1,204.50")).toBe(1204.5)
    expect(numberOf("-3.1%")).toBe(-3.1)
    expect(numberOf("n/a")).toBeUndefined()
    expect(de.number.decimal).toBe(",")
  })

  test("keeps its colour helpers exact and repeatable", () => {
    expect(mixColour("#000000", "#FFFFFF", 0.5)).toBe("#808080")
    expect(withAlpha("#4477AA", 0.12)).toBe("#4477aa1f")
    expect(sampleRamp(["#000000", "#FFFFFF"], 0)).toBe("#000000")
    expect(sampleRamp(["#000000", "#FFFFFF"], 1)).toBe("#ffffff")
    expect(sampleRamp(["#000000", "#FFFFFF"], 0.5)).toBe("#808080")
    expect(sampleRamp(["#123456"], 0.7)).toBe("#123456")
  })

  test("is byte-deterministic", () => {
    const first = renderTable(TABLE, ROWS, { theme: light, fonts })
    const second = renderTable(TABLE, ROWS, { theme: light, fonts })
    expect(second.svg).toBe(first.svg)
    expect(second.html).toBe(first.html)
    expect(second.width).toBe(first.width)
  })

  test("rasterises through resvg", async () => {
    for (const theme of [light, dark]) {
      const table = renderTable(TABLE, ROWS, { theme, fonts })
      const png = await svgToPng(ROOT, table.svg, fonts, 2, "Inter")
      expect(png.width).toBe(Math.round(table.width * 2))
      expect(png.height).toBe(Math.round(table.height * 2))
      expect(png.png.byteLength).toBeGreaterThan(1000)
      expect(new TextDecoder().decode(png.png.subarray(1, 4))).toBe("PNG")
    }
  })

  test("refuses an unknown key, an unknown field and a table with no rows", () => {
    expect(TableSpecSchema.safeParse({ columns: [{ field: "a", ribbon: true }] }).success).toBe(false)
    expect(() => renderTable({ columns: [{ field: "nope" }] }, ROWS, { theme: light, fonts })).toThrow(/^FIELD_MISSING/)
    expect(() => renderTable(TABLE, [], { theme: light, fonts })).toThrow(/^DATA_EMPTY/)
    expect(() => renderTable({ columns: [] }, ROWS, { theme: light, fonts })).toThrow(/^SPEC_INVALID/)
  })
})

// ---------------------------------------------------------------------------------------------------------------

const MINDMAP = {
  kind: "mindmap",
  title: "Charts platform",
  root: { label: "Platform" },
  nodes: [
    { id: "render", label: "Rendering" },
    { id: "vega", label: "Vega", parent: "render" },
    { id: "echarts", label: "ECharts", parent: "render" },
    { id: "data", label: "Data" },
    { id: "rows", label: "Rows", parent: "data" },
    { id: "files", label: "Files", parent: "data" },
    { id: "output", label: "Output" },
    { id: "svg", label: "SVG", parent: "output" },
    { id: "png", label: "PNG", parent: "output" },
  ],
}

const ORG = {
  kind: "org_chart",
  title: "Product organisation",
  nodes: [
    { id: "ceo", label: "Dana Reed", subtitle: "Chief Executive" },
    { id: "cto", label: "Sam Ortiz", subtitle: "Engineering", parent: "ceo", group: "Engineering" },
    { id: "cpo", label: "Lee Park", subtitle: "Product", parent: "ceo", group: "Product" },
    { id: "infra", label: "Ada Chen", subtitle: "Infrastructure", parent: "cto", group: "Engineering" },
  ],
}

const FISHBONE = {
  kind: "fishbone",
  title: "Why deliveries slipped",
  effect: "Late deliveries",
  causes: [
    { category: "People", causes: ["Two open roles", "Onboarding gap"] },
    { category: "Process", causes: ["Manual handoffs", "No buffer", "Late QA"] },
    { category: "Systems", causes: ["Slow CI"] },
    { category: "Suppliers", causes: ["Single source", "Long lead time"] },
  ],
}

const ARCHITECTURE = {
  kind: "architecture",
  title: "Platform architecture",
  nodes: [
    { id: "web", label: "Web app" },
    { id: "api", label: "API" },
    { id: "db", label: "Database" },
    { id: "queue", label: "Queue" },
  ],
  groups: [
    { id: "client", label: "Client", nodes: ["web"] },
    { id: "server", label: "Services", nodes: ["api", "queue", "db"] },
  ],
  edges: [
    { from: "web", to: "api", label: "HTTPS" },
    { from: "api", to: "db" },
    { from: "api", to: "queue", style: "dotted" },
  ],
}

const DIAGRAMS: [string, Record<string, unknown>][] = [
  ["flowchart", { dsl: "graph TD\n  A[Intake] --> B{In scope?}\n  B -->|yes| C[Build]\n  B -->|no| D[Return]", title: "Triage flow", kicker: "Operations" }],
  ["sequenceDiagram", { dsl: "sequenceDiagram\n  participant C as Customer\n  participant A as API\n  C->>A: Request\n  A-->>C: Response", title: "Request path" }],
  ["stateDiagram-v2", { dsl: "stateDiagram-v2\n  [*] --> Idle\n  Idle --> Running : start\n  Running --> Idle : stop", title: "Job states" }],
  ["classDiagram", { dsl: "classDiagram\n  class Animal {\n    +String name\n    +speak() void\n  }\n  Animal <|-- Dog", title: "Types" }],
  ["erDiagram", { dsl: "erDiagram\n  CUSTOMER ||--o{ ORDER : places\n  ORDER ||--|{ LINE_ITEM : contains", title: "Orders" }],
  ["mindmap", MINDMAP as unknown as Record<string, unknown>],
  ["mindmap radial", { ...MINDMAP, layout: "radial" } as unknown as Record<string, unknown>],
  ["org_chart", ORG as unknown as Record<string, unknown>],
  ["fishbone", FISHBONE as unknown as Record<string, unknown>],
  ["architecture", ARCHITECTURE as unknown as Record<string, unknown>],
]

describe("the diagram engine", () => {
  test("draws each kind self-contained, sized, glyph-complete and byte-identical", async () => {
    for (const [name, spec] of DIAGRAMS) {
      const diagram = await renderDiagram(spec, { theme: light, fonts })
      checkRenderedSvg(diagram.svg)
      expect({ name, size: numericSize(diagram.svg) }).toEqual({ name, size: true })
      // The two things an offline drawing may never carry: a font import and a URL (bar the SVG namespace).
      expect({ name, urls: externalUrls(diagram.svg) }).toEqual({ name, urls: [] })
      expect({ name, import: diagram.svg.includes("@import"), fonts: diagram.svg.includes("fonts.googleapis") }).toEqual({ name, import: false, fonts: false })
      // A CSS variable or colour-mix() would be left unresolved by an SVG rasteriser, so none survives.
      expect({ name, vars: /var\(--/.test(diagram.svg), mix: diagram.svg.includes("color-mix") }).toEqual({ name, vars: false, mix: false })
      // A single SVG font-family mention is fine (the frame's rule); what may not remain is a system stack.
      expect(diagram.svg).not.toContain("system-ui")
      expect(uncoveredGlyphs(diagram.svg, fonts)).toEqual<string[]>([])
      expect(diagram.ascii.trim().length).toBeGreaterThan(0)
      const facts = layoutFacts(diagram.svg, fonts)
      expect({ name, clipped: facts.clipped }).toEqual({ name, clipped: [] })

      const again = await renderDiagram(spec, { theme: light, fonts })
      expect({ name, same: again.svg === diagram.svg && again.ascii === diagram.ascii }).toEqual({ name, same: true })
      expect(diagram.width).toBeGreaterThan(60)
      expect(diagram.height).toBeGreaterThan(40)
    }
  })

  test("rasterises every kind through resvg", async () => {
    for (const [, spec] of DIAGRAMS) {
      const diagram = await renderDiagram(spec, { theme: light, fonts })
      const png = await svgToPng(ROOT, diagram.svg, fonts, 1, "Inter")
      expect(new TextDecoder().decode(png.png.subarray(1, 4))).toBe("PNG")
      expect(png.width).toBe(diagram.width)
      expect(png.height).toBe(diagram.height)
    }
  })

  test("keeps its own recipes legible in the dark theme", async () => {
    for (const spec of [MINDMAP, ORG, FISHBONE, ARCHITECTURE]) {
      const diagram = await renderDiagram(spec, { theme: dark, fonts })
      checkRenderedSvg(diagram.svg)
      expect(uncoveredGlyphs(diagram.svg, fonts)).toEqual<string[]>([])
      expect(layoutFacts(diagram.svg, fonts).clipped).toEqual<string[]>([])
      const png = await svgToPng(ROOT, diagram.svg, fonts, 1, "Inter")
      expect(png.png.byteLength).toBeGreaterThan(1000)
    }
  })

  test("writes an accessible outline in ASCII for every recipe", async () => {
    const mindmap = await renderDiagram(MINDMAP, { theme: light, fonts })
    expect(mindmap.ascii.split("\n")[0]).toBe("Platform")
    expect(mindmap.ascii).toContain("├─ Rendering")
    expect(mindmap.ascii).toContain("│  ├─ Vega")
    expect(mindmap.ascii).toContain("└─ Output")

    const org = await renderDiagram(ORG, { theme: light, fonts })
    expect(org.ascii).toContain("Sam Ortiz (Engineering)")
    expect(org.ascii).toContain("└─ Lee Park (Product)")

    const fishbone = await renderDiagram(FISHBONE, { theme: light, fonts })
    expect(fishbone.ascii.split("\n")[0]).toBe("Cause-and-effect: Late deliveries")
    expect(fishbone.ascii).toContain("├─ People")
    expect(fishbone.ascii).toContain("└─ Suppliers")

    const flow = await renderDiagram(DIAGRAMS[0]![1], { theme: light, fonts })
    expect(flow.ascii).toContain("┌")
    expect(flow.ascii).toContain("Intake")
  })

  test("converts an architecture recipe into Mermaid subgraphs and labelled flows", () => {
    const dsl = architectureDsl(DiagramSpecSchema.parse(ARCHITECTURE) as never)
    expect(dsl.startsWith("flowchart LR")).toBe(true)
    expect(dsl).toContain('subgraph n_client["Client"]')
    expect(dsl).toContain('subgraph n_server["Services"]')
    expect(dsl).toContain('n_web["Web app"]')
    expect(dsl).toContain('n_web -->|"HTTPS"| n_api')
    expect(dsl).toContain("n_api -.-> n_queue")
    expect(dsl).toContain("n_api --> n_db")
    expect(dsl.split("\n").filter(line => line === "  end")).toHaveLength(2)
  })

  test("honours a direction and a requested width", async () => {
    const wide = await renderDiagram({ ...DIAGRAMS[0]![1], direction: "LR" }, { theme: light, fonts, width: 640 })
    expect(wide.width).toBeGreaterThan(600)
    expect(wide.width).toBeLessThan(700)
    // The height keeps the drawing's aspect rather than stretching it.
    expect(wide.height).toBeLessThan(640)
    const narrow = await renderDiagram(DIAGRAMS[0]![1], { theme: light, fonts })
    expect(narrow.width).toBeLessThan(wide.width)
  })

  test("draws a mindmap whose links close a loop, and reports them", async () => {
    const cyclic = await renderDiagram({ kind: "mindmap", title: "Loop", nodes: [{ id: "a", label: "A", parent: "b" }, { id: "b", label: "B", parent: "a" }] }, { theme: light, fonts })
    checkRenderedSvg(cyclic.svg)
    expect(cyclic.issues.map(issue => issue.code)).toContain("SPEC_INVALID")
    expect(cyclic.ascii).toContain("A")
    expect(cyclic.ascii).toContain("B")
  })

  test("refuses a spec that names both modes, an unknown kind and a broken edge", async () => {
    expect(DiagramSpecSchema.safeParse({ dsl: "graph TD\n A-->B", kind: "mindmap" }).success).toBe(false)
    expect(DiagramSpecSchema.safeParse({ kind: "sankeyish" }).success).toBe(false)
    await expect(renderDiagram({ kind: "architecture", nodes: [{ id: "a", label: "A" }], edges: [{ from: "a", to: "gone" }] }, { theme: light, fonts })).rejects.toThrow(/^SPEC_INVALID/)
    await expect(renderDiagram({ dsl: "pie\n  \"a\": 1" }, { theme: light, fonts })).rejects.toThrow(/^CHART_TYPE_UNKNOWN/)
  })
})
