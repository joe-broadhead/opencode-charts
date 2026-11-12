/// <reference lib="dom" />
/// <reference lib="dom.iterable" />
// A theme's own font, from a workspace file, in every export (A27): the exact bytes are embedded in interactive HTML
// and in an embedded-font SVG with the right MIME type and format(), the browser has loaded the face before the live
// chart measures any text, and the live chart is drawn with it.
import { afterAll, beforeAll, expect, test } from "bun:test"
import { copyFileSync, mkdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { closeBrowser, launch, open, renderHtml, ROOT, startPlugin, type Plugin } from "./harness.ts"

let plugin: Plugin & { asserts: { action: string; resources: string[] }[] }
beforeAll(async () => { await launch(); plugin = await startPlugin() })
afterAll(async () => { await closeBrowser(); await plugin?.close() })

const FAMILY = "Acme Mono"
const FONT = "brand/acme-mono.ttf"

test("a custom TTF is embedded byte for byte, loaded before the live chart measures, and used to draw it", async () => {
  // The fixture is a monospaced face under a brand name, so a fallback face would measure visibly differently.
  mkdirSync(join(plugin.dir, "brand"), { recursive: true })
  copyFileSync(join(ROOT, "assets", "fonts", "JetBrainsMono-Regular.ttf"), join(plugin.dir, FONT))
  const bytes = readFileSync(join(plugin.dir, FONT))
  const theme = { extends: "light", font: { family: FAMILY, files: [{ family: FAMILY, weight: 400, path: FONT }] } }
  const { html, result } = await renderHtml(plugin, {
    spec: { mark: "bar", encoding: { x: { field: "region", type: "nominal", title: "Region" }, y: { field: "revenue", type: "quantitative", title: "Revenue (€k)" } } },
    data: { rows: [{ region: "North", revenue: 120 }, { region: "South", revenue: 80 }, { region: "East", revenue: 95 }] },
    title: "Revenue by region", theme, formats: ["html", "svg"], svgText: "embed", name: "custom-font",
  })
  expect(plugin.asserts).toContainEqual({ action: "read", resources: [FONT] })

  const face = `@font-face{font-family:"${FAMILY}";font-weight:400;`
  const source = `src:url(data:font/ttf;base64,${bytes.toString("base64")}) format("truetype")}`
  const page = readFileSync(html, "utf8")
  expect(page).toContain(`${face}font-display:block;${source}`)
  const svgFile = join(plugin.dir, (result.output.files as { svg: string }).svg)
  const svg = readFileSync(svgFile, "utf8")
  expect(svg).toContain(`${face}${source}`)

  const opened = await open(html)
  expect(await opened.status()).toBe("ready")
  expect(opened.violations).toEqual([])
  expect(opened.requests).toEqual([])
  const sequence = await opened.sequence()
  const fontsAt = sequence.indexOf("data-chart-fonts=loaded"), liveAt = sequence.indexOf("live-svg-in-stage")
  expect(fontsAt).toBeGreaterThanOrEqual(0)
  expect(liveAt).toBeGreaterThan(fontsAt)
  const seen = await opened.page.evaluate((family) => {
    const faces = [...document.fonts].filter(f => f.family.replace(/"/g, "") === family).map(f => f.status)
    const svg = document.querySelector("#chart svg")!
    const width = Number(svg.getAttribute("width")), height = Number(svg.getAttribute("height"))
    const label = [...svg.querySelectorAll(".role-axis-label text")].find(t => t.textContent === "North") as SVGTextElement
    const ctx = document.createElement("canvas").getContext("2d")!
    const size = getComputedStyle(label).fontSize
    ctx.font = `${size} "${family}"`; const custom = ctx.measureText("North").width
    ctx.font = `${size} sans-serif`; const fallback = ctx.measureText("North").width
    const root = svg.getBoundingClientRect()
    const outside = [...svg.querySelectorAll("text")].filter(t => { const r = t.getBoundingClientRect(); return r.width > 0 && (r.left < root.left - 2 || r.right > root.right + 2 || r.top < root.top - 2 || r.bottom > root.bottom + 2) }).map(t => t.textContent)
    return { faces, family: getComputedStyle(label).fontFamily, drawn: label.getComputedTextLength(), custom, fallback, width, height, outside }
  }, FAMILY)
  expect(seen.faces).toEqual(["loaded"])
  expect(seen.family).toContain(FAMILY)
  expect(Math.abs(seen.drawn - seen.custom)).toBeLessThan(0.5)
  expect(Math.abs(seen.custom - seen.fallback)).toBeGreaterThan(2)
  expect(seen.outside).toEqual([])
  await opened.close()

  // The embedded-font SVG on its own: the browser loads the embedded face and draws with it.
  const alone = await open(svgFile, { wait: false })
  await alone.page.waitForFunction((family) => document.fonts.check(`16px "${family}"`), FAMILY, { timeout: 10_000 })
  expect(alone.requests).toEqual([])
  await alone.close()
}, 60_000)
