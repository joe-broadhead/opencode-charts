import { afterAll, describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { initWasm, Resvg } from "@resvg/resvg-wasm"
import { CATALOGUE, exampleCall } from "../src/catalogue.ts"
import { closeVegaWorker } from "../src/engines/vega-pool.ts"
import { bundledFonts } from "../src/fonts.ts"
import { renderChart } from "../src/pipeline.ts"
import { BAR, ROOT, ROWS, workspace } from "./helpers.ts"

/**
 * Golden SVGs: every catalogue chart, in the default theme. A change in output is a reviewed change: run
 * `UPDATE_GOLDEN=1 bun test test/output.test.ts` and look at the diff and the gallery.
 *
 * Byte for byte on the machine the goldens come from (macOS arm64). Elsewhere a trigonometric result (a sunburst's
 * arcs, a map projection) can differ in its last digits, because the runtime's Math.sin and Math.atan2 come from the
 * platform; CI showed it on Linux and Intel macOS (66.29585392720165 against 66.29585392720162). So a golden that is
 * not byte-equal must still be equal with every number to 10 significant digits, and with the id prefix, which hashes
 * the content, set aside.
 */
const portable = (svg: string) =>
  svg
    .replace(/\bc[0-9a-f]{8}-(\d+)/g, "c-$1")
    .replace(/-?\d+\.\d+(?:e[-+]?\d+)?/g, n => String(Number(Number(n).toPrecision(10))))
const ws = workspace()
afterAll(async () => { ws.cleanup(); await closeVegaWorker() })
const GOLDEN = join(ROOT, "test", "golden")
mkdirSync(GOLDEN, { recursive: true })
const render = (id: string, theme = "light") => {
  return renderChart({ ...exampleCall(CATALOGUE.find(c => c.id === id)!), theme, formats: ["svg"] }, ws.env, false)
}

describe("golden SVGs", () => {
  for (const entry of CATALOGUE) test(entry.id, async () => {
    const { svg } = await render(entry.id)
    const file = join(GOLDEN, `${entry.id}.svg`)
    if (process.env.UPDATE_GOLDEN || !existsSync(file)) writeFileSync(file, svg)
    const golden = readFileSync(file, "utf8")
    if (svg !== golden) expect(portable(svg)).toBe(portable(golden))
  })
})

describe("the catalogue", () => {
  test("every example renders without a warning, an overlap or a clipped label", async () => {
    const problems: string[] = []
    for (const entry of CATALOGUE) {
      const r = await render(entry.id)
      if (r.issues.length) problems.push(`${entry.id}: ${r.issues.map(i => i.code).join(", ")}`)
    }
    expect(problems).toEqual([])
  })
})

describe("determinism", () => {
  test("the same input gives byte-identical SVG, including force and word-cloud layouts", async () => {
    for (const id of ["network", "word_cloud", "sankey", "grouped_bar", "choropleth_world"]) {
      const a = await render(id, "dark"), b = await render(id, "dark")
      expect(a.svg).toBe(b.svg)
    }
  })
  test("no timestamps, random ids or absolute paths leak into the output", async () => {
    const { svg } = await render("line")
    expect(svg).not.toMatch(/20\d\d-\d\d-\d\dT\d\d:\d\d/)
    expect(svg).not.toContain(ROOT)
    expect(svg).not.toMatch(/zr\d+-/)
  })
  test("ids are unique per chart, so two charts can sit on one page", async () => {
    const a = await render("treemap"), b = await render("sunburst")
    const ids = (svg: string) => [...svg.matchAll(/\sid="([^"]+)"/g)].map(m => m[1])
    const shared = ids(a.svg).filter(id => ids(b.svg).includes(id))
    expect(shared).toEqual([])
  })
})

describe("files", () => {
  test("PNG at 1x, 2x and 3x, with the right pixel sizes", async () => {
    const r = await renderChart({ spec: BAR, data: { rows: ROWS }, title: "Revenue", formats: ["png"], scales: [1, 2, 3] }, ws.env)
    expect(r.files.png).toEqual(["outputs/charts/revenue.png", "outputs/charts/revenue@2x.png", "outputs/charts/revenue@3x.png"])
    for (const [i, file] of r.files.png.entries()) {
      const png = readFileSync(join(ws.dir, file))
      expect([...png.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
      expect(png.readUInt32BE(16)).toBe(r.width * (i + 1))
      expect(png.readUInt32BE(20)).toBe(r.height * (i + 1))
    }
  })
  test("interactive HTML is self-contained: no network reference, a strict CSP, the static chart first", async () => {
    for (const id of ["grouped_bar", "sankey"]) {
      const r = await renderChart({ ...exampleCall(CATALOGUE.find(c => c.id === id)!), formats: ["html"], name: id }, ws.env)
      const html = readFileSync(join(ws.dir, r.files.html!), "utf8")
      expect(html).toContain(`content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; font-src data:; img-src data: blob:"`)
      expect(html).not.toMatch(/<script[^>]+src=|<link\b|@import|url\(\s*["']?https?:/i)
      expect(html).not.toMatch(/(src|href)=["']https?:/i)
      expect(html).toMatch(/<div id="chart"[^>]*><svg/)
      expect(html).toContain("@font-face")
    }
  })
  test("the resolved spec is saved beside the chart, with theme and data", async () => {
    const r = await renderChart({ spec: BAR, data: { rows: ROWS }, title: "Saved spec", theme: "dark" }, ws.env)
    const spec = JSON.parse(readFileSync(join(ws.dir, r.files.spec!), "utf8"))
    expect(spec.data.values).toHaveLength(4)
    expect(spec.config.background).toBe("#16181D")
  })
  test("svgText paths draws glyphs as paths and keeps the accessible name", async () => {
    const r = await renderChart({ spec: BAR, data: { rows: ROWS }, title: "Paths", formats: ["svg"], svgText: "paths" }, ws.env)
    const svg = readFileSync(join(ws.dir, r.files.svg!), "utf8")
    expect(svg).not.toContain("<text")
    expect(svg).toMatch(/<svg[^>]*role="img"/)
    expect(svg).toContain("<title")
  })
})

describe("accessibility", () => {
  test("every chart has role=img, a title, a description and a text summary", async () => {
    const r = await renderChart({ spec: BAR, data: { rows: ROWS }, title: "Revenue by region", formats: ["svg"] }, ws.env, false)
    const [, titleId, descId] = /<svg role="img" aria-labelledby="(\S+) (\S+)"/.exec(r.svg) ?? []
    expect(r.svg).toContain(`<title id="${titleId}">Revenue by region</title><desc id="${descId}">`)
    expect(r.description).toContain("Highest: North (120); lowest: West (40)")
  })
})

describe("text metrics", () => {
  test("the widths the layout uses are the widths resvg draws (same fonts on every host)", async () => {
    await initWasm(readFileSync(join(ROOT, "node_modules/@resvg/resvg-wasm/index_bg.wasm"))).catch(() => undefined)
    const fonts = bundledFonts(ROOT)
    for (const [family, weight] of [["Inter", 400], ["Inter", 600], ["JetBrains Mono", 400]] as const) {
      // Ink bounds of "|text|" minus "||": the side bearings cancel and what is left is the advance width drawn.
      const box = (t: string) => new Resvg(`<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="60"><text x="10" y="40" font-family="${family}" font-weight="${weight}" font-size="24">${t}</text></svg>`, { font: { fontBuffers: fonts.buffers(), loadSystemFonts: false } as never }).innerBBox()!
      for (const text of ["Revenue by region, 2024 — €1.2M (Q3)", "AVAVAVAV To Ty", "1234567890"]) {
        const drawn = box(`|${text}|`).width - box("||").width
        expect(Math.abs(drawn - fonts.measure(text, 24, family, weight))).toBeLessThan(1.5)
      }
    }
  })
})
