import { describe, expect, test } from "bun:test"
import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { bundledFonts } from "../src/fonts.js"
import { figureText, markedSvg, textRoles } from "../src/figure.js"
import { renderChart } from "../src/pipeline.js"
import { ROOT, ROWS, BAR, workspace } from "./helpers.js"

/**
 * The figure tree: every label the drawing contains, with a stable id, its box and whether it collides or clips; and
 * the same ids drawn on the preview, so "n7 runs past the edge" points at one label.
 */

const ws = workspace()
const fonts = bundledFonts(ROOT)

const render = (spec: Record<string, unknown>, rows = ROWS, extra: Record<string, unknown> = {}) =>
  renderChart({ spec, data: { rows }, theme: "light", ...extra }, ws.env, false)

describe("the figure tree", () => {
  test("names every label, its box and where it sits", async () => {
    const { svg, figure } = await render(BAR)
    expect(figure.nodes.length).toBeGreaterThan(3)
    const texts = figure.nodes.map(node => node.text)
    expect(texts).toContain("North")
    expect(texts).toContain("Region")
    expect(texts).toContain("Revenue (€k)")
    for (const node of figure.nodes) {
      expect(node.box[2]).toBeGreaterThanOrEqual(node.box[0])
      expect(node.box[3]).toBeGreaterThanOrEqual(node.box[1])
      expect(svg).toContain(">") // the drawing the tree describes
    }
    expect(figure.text).toContain("figure ")
    expect(figure.text).toContain("n0 ")
  })

  test("gives the same ids for the same spec, every time", async () => {
    const a = await render(BAR)
    const b = await render(BAR)
    expect(a.figure.text).toBe(b.figure.text)
    expect(JSON.stringify(a.figure.nodes)).toBe(JSON.stringify(b.figure.nodes))
  })

  test("puts an axis label on the axis it belongs to", async () => {
    const { figure } = await render(BAR)
    const north = figure.nodes.find(node => node.text === "North")!
    const revenue = figure.nodes.find(node => node.text === "Revenue (€k)")!
    expect(north.where).toBe("axis x")
    expect(revenue.where).toBe("axis y")
    const title = figure.nodes.find(node => node.text === "Chart")
    if (title) expect(["title", "drawing"]).toContain(title.where)
  })

  test("flags a colliding label, and the same id appears in the tree and on the picture", async () => {
    // Twenty-six long category names on a 220px axis cannot fit: they collide or clip, which is the case the tree is for.
    const rows = Array.from({ length: 26 }, (_, i) => ({ region: `Region ${String.fromCharCode(65 + i)} long name`, revenue: 100 + i }))
    const { svg, figure } = await render({ ...BAR, width: 220 } as never, rows)
    expect(figure.problems.length).toBeGreaterThan(0)
    const flagged = figure.nodes.filter(node => node.problem)
    expect(flagged.length).toBeGreaterThan(0)
    for (const node of flagged) expect(figure.text).toContain(`n${node.id}`)
    const marked = markedSvg(svg, figure, { which: "problems" })
    for (const node of flagged.slice(0, 3)) expect(marked).toContain(`data-id="${node.id}"`)
    expect(marked).toContain("charts-mark-legend")
    expect(marked.endsWith("</svg>")).toBe(true)
  })

  test("marks: all numbers every label; marks: none leaves the drawing untouched", async () => {
    const plain = await render(BAR)
    expect(markedSvg(plain.svg, plain.figure, { which: "none" })).toBe(plain.svg)
    const all = markedSvg(plain.svg, plain.figure, { which: "all" })
    for (const node of plain.figure.nodes) expect(all).toContain(`data-id="${node.id}"`)
  })

  test("the overlay is our own markup: no script, no external reference", async () => {
    const plain = await render(BAR)
    const marked = markedSvg(plain.svg, plain.figure, { which: "all" })
    expect(marked).not.toContain("<script")
    // The drawing names the SVG namespace once; the overlay adds no reference of its own.
    const external = (text: string) => text.match(/https?:\/\//g)?.length ?? 0
    expect(external(marked)).toBe(external(plain.svg))
    expect(marked).not.toMatch(/xlink:href|<image|<foreignObject|url\((['"]?)https?:/)
  })

  test("cuts a long tree to a token budget but never hides a problem", () => {
    const nodes = Array.from({ length: 120 }, (_, i) => ({ id: i, kind: "label" as const, text: `L${i}`, box: [0, i, 10, i + 8] as const, where: "axis x", ...(i === 119 ? { problem: "overlap" as const } : {}) }))
    const text = ["figure 100x200, 120 labels", "  axis x (120)", ...nodes.map(n => `    n${n.id} "${n.text}" 0,${n.box[1]},10,${n.box[3]}${n.problem ? "  <- collides with another label" : ""}`)].join("\n")
    const figure = { width: 100, height: 200, nodes, text, problems: [119] }
    const cut = figureText(figure, 30)
    expect(cut.split("\n").length).toBeLessThanOrEqual(30)
    expect(cut).toContain("n119")
    expect(cut).toContain("more labels")
  })

  test("reads the roles from the drawing's own group classes", async () => {
    const { svg } = await render(BAR)
    const roles = textRoles(svg)
    expect(roles.some(role => role.role === "axis")).toBe(true)
    expect(roles.every(role => ["title", "legend", "axis", "drawing"].includes(role.role))).toBe(true)
  })

  test("holds for a Vega chart and an ECharts chart, not only Vega-Lite", async () => {
    const vega = await render({ $schema: "https://vega.github.io/schema/vega/v6.json", data: [{ name: "t", values: ROWS }], scales: [{ name: "x", type: "band", domain: { data: "t", field: "region" }, range: "width" }, { name: "y", type: "linear", domain: { data: "t", field: "revenue" }, range: "height" }], axes: [{ orient: "bottom", scale: "x" }, { orient: "left", scale: "y" }], marks: [{ type: "rect", from: { data: "t" }, encode: { enter: { x: { scale: "x", field: "region" }, width: { scale: "x", band: 1 }, y: { scale: "y", field: "revenue" }, y2: { scale: "y", value: 0 } } } }] } as never)
    expect(vega.figure.nodes.length).toBeGreaterThan(0)
    const echarts = await render({ series: [{ type: "funnel", data: [{ name: "Visited", value: 10 }, { name: "Paid", value: 4 }] }] } as never)
    expect(echarts.figure.nodes.map(node => node.text)).toContain("Visited")
  })

  test("the tree is byte-stable enough to be a golden", async () => {
    const { figure } = await render(BAR)
    const file = join(ROOT, "test", "golden", "figure-bar.txt")
    if (process.env.UPDATE_GOLDEN || !existsSync(file)) writeFileSync(file, figure.text)
    const golden = readFileSync(file, "utf8")
    expect(figure.text).toBe(golden)
  })
})

describe("the marks option, through the tool", () => {
  test("reaches the pipeline: marks \"all\" changes the preview, marks \"none\" leaves it alone", async () => {
    const { runTool } = await import("../src/tools.ts")
    const env = { ...ws.env, assertFiles: async () => undefined }
    const spec = { mark: "bar", encoding: { x: { field: "region", type: "nominal" }, y: { field: "revenue", type: "quantitative" } } }
    const png = (result: { content: readonly { type: string; uri?: string }[] }) =>
      Buffer.from(String(result.content.find(part => part.type === "file")!.uri).split(",")[1] ?? "", "base64")
    const all = await runTool(env as never, "validate", { spec, data: { rows: ROWS }, marks: "all" })
    const none = await runTool(env as never, "validate", { spec, data: { rows: ROWS }, marks: "none" })
    expect(all.content.some(part => part.type === "file")).toBe(true)
    expect(png(all as never).length).not.toBe(png(none as never).length)
    expect(all.output.figure).toBeDefined()
  })
})

describe("fonts and the scripts they cover", () => {
  test("knows which glyphs it has, so a label it cannot draw is named rather than drawn as a box", () => {
    expect(fonts.covers("A".codePointAt(0)!)).toBe(true)
    expect(fonts.covers("é".codePointAt(0)!)).toBe(true)
    expect(fonts.covers("Ж".codePointAt(0)!)).toBe(true)
    expect(fonts.covers("東".codePointAt(0)!)).toBe(false)
  })

  test("a spec with CJK labels gets FONT_GLYPH_MISSING with the characters and a fix", async () => {
    const { issues } = await render(BAR, [{ region: "東京", revenue: 120 }, { region: "大阪", revenue: 80 }])
    const warning = issues.find(issue => issue.code === "FONT_GLYPH_MISSING")
    expect(warning).toBeDefined()
    expect(warning!.level).toBe("warning")
    expect(warning!.message).toContain("東")
    expect(warning!.fix).toContain("font.files")
  })

  test("a Latin chart gets no font warning", async () => {
    const { issues } = await render(BAR)
    expect(issues.find(issue => issue.code === "FONT_GLYPH_MISSING")).toBeUndefined()
  })
})
