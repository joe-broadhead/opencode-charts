/// <reference lib="dom" />
/// <reference lib="dom.iterable" />
// Recipe documents' interaction presets and responsive layout in a real browser, under the page's own CSP with the
// network refused. Each test changes what is drawn and checks the change against the data, then clears it; every page
// must have no CSP violation, console error or request.
import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { join } from "node:path"
import type { Page } from "playwright-core"
import { closeVegaWorker } from "../../src/engines/vega-pool.ts"
import { DIMMED_OPACITY } from "../../src/interactions/vegalite.ts"
import { workspace } from "../helpers.ts"
import { draw } from "../support/documents.ts"
import { closeBrowser, launch, open, type Opened } from "./harness.ts"

const ws = workspace()
const env = { ...ws.env, assertFiles: async () => undefined }
beforeAll(async () => { await launch() })
afterAll(async () => { await closeBrowser(); ws.cleanup(); await closeVegaWorker() })
const T = 60_000

type Json = Record<string, unknown>
const MONTHS = Array.from({ length: 12 }, (_, i) => `2024-${String(i + 1).padStart(2, "0")}-01`)
const REGIONS = ["North", "South", "East"]
const SALES = MONTHS.flatMap((month, i) => REGIONS.map((region, j) => ({ month, region, revenue_eur: 100 + i * 10 + j * 30 })))
const line = (interactions: Json, layout: Json = {}) => ({ version: 1, title: "Revenue by month and region", chart: { kind: "recipe", recipe: "line", data: { rows: SALES }, bindings: { x: "month", y: "revenue_eur", series: "region" }, options: { xType: "temporal", yTitle: "Revenue (€)" } }, interactions, layout })
const POINTS = Array.from({ length: 60 }, (_, i) => ({ x: i, y: (i * 37) % 50, group: ["A", "B", "C"][i % 3], weight: 1 + (i % 5) }))
const scatter = (interactions: Json, recipe = "scatter") => ({ version: 1, title: "Points", chart: { kind: "recipe", recipe, data: { rows: POINTS }, bindings: { x: "x", y: "y", series: "group", ...(recipe === "bubble" ? { size: "weight" } : {}) }, options: { xTitle: "X (n)", yTitle: "Y (n)" } }, interactions })

/** A recipe document as interactive HTML, through the shared core; opened in the browser. */
async function page(doc: unknown, name: string, options: Parameters<typeof open>[1] = {}): Promise<Opened> {
  const { result } = await draw(env, doc, { formats: ["html"], name }, true)
  const opened = await open(join(ws.dir, result.files.html!), { viewport: { width: 1000, height: 800 }, ...options })
  expect(await opened.status()).toBe("ready")
  return opened
}
const clean = (p: Opened) => { expect(p.violations).toEqual([]); expect(p.errors).toEqual([]); expect(p.requests).toEqual([]) }

/** The data marks with their description (the mark's values) and opacity. */
const marks = (p: Page, role = "point") => p.evaluate((r) => [...document.querySelectorAll(`#chart .role-mark path[aria-label]`)].filter(e => r === "*" || (e.getAttribute("aria-roledescription") ?? "") === r).map(e => { const b = e.getBoundingClientRect(); return { label: e.getAttribute("aria-label") ?? "", opacity: Number(e.getAttribute("opacity") ?? 1), x: b.x + b.width / 2, y: b.y + b.height / 2, h: Math.round(b.height * 10) / 10 } }), role)
const axisLabels = (p: Page) => p.evaluate(() => [...document.querySelectorAll("#chart .role-axis[aria-label]")].map(axis => [...axis.querySelectorAll(".role-axis-label text")].map(t => t.textContent ?? "").sort().join("|")))
const press = async (p: Page, selector: string) => { await p.focus(selector); await p.keyboard.press("Enter") }
const settle = (p: Page) => p.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, 50)))))
const dimmed = (list: { opacity: number }[]) => list.filter(m => m.opacity === DIMMED_OPACITY)
const plot = (p: Page) => p.evaluate(() => { const r = document.querySelector("#chart .role-mark")!.closest("g.mark-group")!.querySelector("path.background")!.getBoundingClientRect(); return { x0: r.left, y0: r.top, x1: r.right, y1: r.bottom } })

describe("tooltip", () => {
  test("recipe-tooltip: hovering a bar shows its aggregated value under the axis title, and the data table has the same values by keyboard", async () => {
    // Two rows per region: the bar is their sum, which the tooltip must show (never one raw row).
    const rows = [{ region: "North", sales_eur: 120 }, { region: "North", sales_eur: 30 }, { region: "South", sales_eur: 80 }, { region: "South", sales_eur: 5 }]
    const p = await page({ version: 1, title: "Sales", chart: { kind: "recipe", recipe: "bar", data: { rows }, bindings: { category: "region", value: "sales_eur" }, options: { aggregate: "sum", yTitle: "Sales (€)" } } }, "tooltip")
    const bars = await marks(p.page, "bar")
    expect(bars).toHaveLength(2)
    await p.page.mouse.move(bars[0]!.x, bars[0]!.y)
    await p.page.waitForSelector("#vg-tooltip-element.visible", { timeout: 5_000 })
    const tip = await p.page.textContent("#vg-tooltip-element")
    expect(tip).toContain("North")
    expect(tip).toContain("Sales (€)")
    expect(tip).toContain("150")
    expect(tip).not.toContain("120")
    // The same values, without a pointer: the details summary is focusable and opens with the keyboard.
    expect(await p.page.isVisible("#chart-table table")).toBe(false)
    await press(p.page, "#chart-details summary")
    expect(await p.page.isVisible("#chart-table table")).toBe(true)
    const table = await p.page.evaluate(() => [...document.querySelectorAll("#chart-table tr")].map(tr => [...tr.children].map(c => c.textContent)))
    expect(table).toEqual([["Region", "Sales (€)"], ["North", "150"], ["South", "85"]])
    clean(p)
    await p.close()
  }, T)
})

describe("legend highlight", () => {
  test("recipe-legend-highlight: choosing a series emphasises its marks only; data, domains and stacked totals stay; Clear highlight restores", async () => {
    const p = await page(line({ legend: "highlight" }), "legend")
    const before = await marks(p.page, "*")
    expect(before.filter(m => m.label.includes("Region")).length).toBe(36 + 3) // 36 points and 3 lines
    const axes = await axisLabels(p.page)
    expect(dimmed(before)).toEqual([])
    // Click "North" in the drawn legend.
    const entry = await p.page.evaluate(() => { const t = [...document.querySelectorAll("#chart .role-legend-label text")].find(e => e.textContent === "North")!; const r = t.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 } })
    await p.page.mouse.click(entry.x, entry.y)
    await settle(p.page)
    const after = await marks(p.page, "*")
    expect(after.length).toBe(before.length)
    const points = after.filter(m => /region/i.test(m.label))
    expect(points.length).toBe(39)
    for (const m of points) expect(m.opacity).toBe(m.label.includes("North") ? 1 : DIMMED_OPACITY)
    expect(await axisLabels(p.page)).toEqual(axes)
    // The toolbar follows the legend; clearing by keyboard restores every mark.
    expect(await p.page.evaluate(() => [...document.querySelectorAll("button[data-series]")].map(b => `${b.textContent}=${b.getAttribute("aria-pressed")}`))).toEqual(["East=false", "North=true", "South=false"])
    await press(p.page, 'button[data-action="clear-legend"]')
    await settle(p.page)
    expect(dimmed(await marks(p.page, "*"))).toEqual([])
    // A series button selects with the keyboard too, and a second press clears it.
    await press(p.page, 'button[aria-label="Highlight South"]')
    await settle(p.page)
    for (const m of (await marks(p.page, "*")).filter(m => /region/i.test(m.label))) expect(m.opacity).toBe(m.label.includes("South") ? 1 : DIMMED_OPACITY)
    await press(p.page, 'button[aria-label="Highlight South"]')
    await settle(p.page)
    expect(dimmed(await marks(p.page, "*"))).toEqual([])
    clean(p)
    await p.close()
  }, T)

  test("on a stacked bar chart, highlighting keeps every bar's position and the stack totals", async () => {
    const p = await page({ version: 1, title: "Stacked", chart: { kind: "recipe", recipe: "stacked_bar", data: { rows: SALES.slice(0, 12) }, bindings: { category: "month", series: "region", value: "revenue_eur" } }, interactions: { legend: "highlight" } }, "stacked")
    const geometry = async () => (await marks(p.page, "bar")).map(m => `${m.label}@${Math.round(m.x)},${Math.round(m.y)},${m.h}`).sort()
    const before = await geometry()
    await press(p.page, 'button[aria-label="Highlight South"]')
    await settle(p.page)
    expect(await geometry()).toEqual(before)
    const bars = await marks(p.page, "bar")
    expect(dimmed(bars).length).toBe(8)
    clean(p)
    await p.close()
  }, T)

  test("without the legend binding's signal the series buttons are not offered, and the page says why; Clear highlight still works", async () => {
    const { result } = await draw(env, line({ legend: "highlight" }), { formats: ["html"], name: "no-binding" }, true)
    const file = join(ws.dir, result.files.html!)
    const { readFileSync, writeFileSync } = await import("node:fs")
    const text = readFileSync(file, "utf8")
    // The spec is a JSON data block (not a hashed script): renaming the signal needs no re-signing.
    const renamed = text.replaceAll("charts_legend_region_legend", "renamed_region_binding")
    expect(renamed).not.toBe(text)
    writeFileSync(file, renamed)
    const p = await open(file, { viewport: { width: 1000, height: 800 } })
    expect(await p.status()).toBe("ready")
    expect(await p.page.evaluate(() => ({ buttons: document.querySelectorAll("button[data-series]").length, why: document.documentElement.getAttribute("data-chart-controls"), clear: !!document.querySelector('button[data-action="clear-legend"]') }))).toEqual({ buttons: 0, why: "series-buttons-unavailable", clear: true })
    // The legend still selects, and Clear highlight still clears.
    const entry = await p.page.evaluate(() => { const t = [...document.querySelectorAll("#chart .role-legend-label text")].find(e => e.textContent === "North")!; const r = t.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 } })
    await p.page.mouse.click(entry.x, entry.y)
    await settle(p.page)
    expect(dimmed(await marks(p.page, "*")).length).toBeGreaterThan(0)
    await press(p.page, 'button[data-action="clear-legend"]')
    await settle(p.page)
    expect(dimmed(await marks(p.page, "*"))).toEqual([])
    clean(p)
    await p.close()
  }, T)
})

describe("x zoom", () => {
  test("recipe-x-zoom: the wheel narrows the x domain and dragging pans it; y keeps its domain; Reset zoom and double-click restore", async () => {
    const p = await page(line({ zoom: "x" }), "zoom")
    const [x0, y0] = await axisLabels(p.page)
    const box = await plot(p.page)
    const centre = { x: (box.x0 + box.x1) / 2, y: (box.y0 + box.y1) / 2 }
    await p.page.mouse.move(centre.x, centre.y)
    await p.page.mouse.wheel(0, -500)
    await settle(p.page)
    const [x1, y1] = await axisLabels(p.page)
    expect(x1).not.toBe(x0)
    expect(y1).toBe(y0)
    // Marks outside the zoomed domain are clipped to the plot, never drawn over the axes.
    const clipped = await p.page.evaluate(() => [...document.querySelectorAll("#chart .role-mark")].every(g => !!g.getAttribute("clip-path") || !!g.closest("[clip-path]")))
    expect(clipped).toBe(true)
    await p.page.mouse.move(centre.x, centre.y)
    await p.page.mouse.down()
    await p.page.mouse.move(centre.x - 150, centre.y, { steps: 6 })
    await p.page.mouse.up()
    await settle(p.page)
    const [x2, y2] = await axisLabels(p.page)
    expect(x2).not.toBe(x1)
    expect(y2).toBe(y0)
    await press(p.page, 'button[data-action="clear-zoom"]')
    await settle(p.page)
    expect(await axisLabels(p.page)).toEqual([x0!, y0!])
    // Double-click resets too.
    await p.page.mouse.move(centre.x, centre.y)
    await p.page.mouse.wheel(0, -500)
    await settle(p.page)
    expect((await axisLabels(p.page))[0]).not.toBe(x0)
    await p.page.mouse.dblclick(centre.x, centre.y)
    await settle(p.page)
    expect(await axisLabels(p.page)).toEqual([x0!, y0!])
    clean(p)
    await p.close()
  }, T)
})

/** Drags a rectangle over the middle of the plot and returns the brush's bounds. */
async function brush(p: Page, from = [0.2, 0.2], to = [0.7, 0.75]) {
  const box = await plot(p)
  const at = ([fx, fy]: number[]) => ({ x: box.x0 + (box.x1 - box.x0) * fx!, y: box.y0 + (box.y1 - box.y0) * fy! })
  const a = at(from), b = at(to)
  await p.mouse.move(a.x, a.y)
  await p.mouse.down()
  await p.mouse.move(b.x, b.y, { steps: 8 })
  await p.mouse.up()
  await settle(p)
  return p.evaluate(() => { const r = document.querySelector("#chart .charts_brush_brush path")!.getBoundingClientRect(); return { x0: r.left, x1: r.right, y0: r.top, y1: r.bottom } })
}
const inside = (m: { x: number; y: number }, b: { x0: number; x1: number; y0: number; y1: number }) => m.x > b.x0 + 2 && m.x < b.x1 - 2 && m.y > b.y0 + 2 && m.y < b.y1 - 2
const outside = (m: { x: number; y: number }, b: { x0: number; x1: number; y0: number; y1: number }) => m.x < b.x0 - 2 || m.x > b.x1 + 2 || m.y < b.y0 - 2 || m.y > b.y1 + 2

describe("interval brush", () => {
  for (const recipe of ["scatter", "bubble"]) test(`recipe-interval-brush: dragging over a ${recipe} emphasises exactly the marks inside; Clear selection restores them all`, async () => {
    const p = await page(scatter({ brush: "interval" }, recipe), `brush-${recipe}`)
    const role = recipe === "bubble" ? "circle" : "point"
    const before = await marks(p.page, role)
    expect(before).toHaveLength(60)
    const axes = await axisLabels(p.page)
    const b = await brush(p.page)
    const after = await marks(p.page, role)
    expect(after).toHaveLength(60)
    expect(dimmed(after).length).toBeGreaterThan(0)
    expect(after.filter(m => m.opacity !== DIMMED_OPACITY).length).toBeGreaterThan(0)
    for (const m of after) { if (inside(m, b)) expect(m.opacity).not.toBe(DIMMED_OPACITY); if (outside(m, b)) expect(m.opacity).toBe(DIMMED_OPACITY) }
    expect(await axisLabels(p.page)).toEqual(axes) // the brush selects; it does not zoom
    await press(p.page, 'button[data-action="clear-brush"]')
    await settle(p.page)
    expect(dimmed(await marks(p.page, role))).toEqual([])
    expect(await p.page.evaluate(() => { const r = document.querySelector("#chart .charts_brush_brush path")?.getBoundingClientRect(); return r ? r.width * r.height : 0 })).toBe(0)
    clean(p)
    await p.close()
  }, T)
})

describe("combined presets (A21)", () => {
  test("legend highlight with the brush: full emphasis is the intersection; each clears on its own; both survive a resize; reset all clears both", async () => {
    const p = await page(scatter({ legend: "highlight", brush: "interval" }), "legend-brush", { viewport: { width: 1000, height: 800 } })
    const b = await brush(p.page)
    await press(p.page, 'button[aria-label="Highlight A"]')
    await settle(p.page)
    const both = await marks(p.page)
    for (const m of both) {
      const inA = m.label.includes("Group: A")
      if (inside(m, b)) expect(m.opacity).toBe(inA ? 0.8 : DIMMED_OPACITY)
      if (outside(m, b)) expect(m.opacity).toBe(DIMMED_OPACITY)
    }
    const emphasised = both.filter(m => m.opacity !== DIMMED_OPACITY).map(m => m.label).sort()
    expect(emphasised.length).toBeGreaterThan(0)
    expect(emphasised.every(l => l.includes("Group: A"))).toBe(true)

    // A narrower window: the chart reflows, and the same marks are emphasised.
    await p.page.setViewportSize({ width: 640, height: 800 })
    await p.page.waitForFunction(() => Number(document.documentElement.getAttribute("data-chart-width")) < 640)
    await settle(p.page)
    expect((await marks(p.page)).filter(m => m.opacity !== DIMMED_OPACITY).map(m => m.label).sort()).toEqual(emphasised)

    // Clearing the highlight keeps the brush: everything inside it is emphasised again.
    await press(p.page, 'button[data-action="clear-legend"]')
    await settle(p.page)
    const brushOnly = await marks(p.page)
    expect(brushOnly.filter(m => m.opacity !== DIMMED_OPACITY).length).toBeGreaterThan(emphasised.length)
    expect(dimmed(brushOnly).length).toBeGreaterThan(0)
    // Highlight again, then clear the brush: the highlight stays.
    await press(p.page, 'button[aria-label="Highlight B"]')
    await press(p.page, 'button[data-action="clear-brush"]')
    await settle(p.page)
    for (const m of await marks(p.page)) expect(m.opacity).toBe(m.label.includes("Group: B") ? 0.8 : DIMMED_OPACITY)
    await brush(p.page)
    await press(p.page, 'button[data-action="reset-all"]')
    await settle(p.page)
    expect(dimmed(await marks(p.page))).toEqual([])
    clean(p)
    await p.close()
  }, T)

  test("legend highlight with x zoom: zoom changes the view, highlight the emphasis; each resets alone and both survive a resize", async () => {
    const p = await page(line({ legend: "highlight", zoom: "x" }), "legend-zoom")
    const [x0, y0] = await axisLabels(p.page)
    const box = await plot(p.page)
    await p.page.mouse.move((box.x0 + box.x1) / 2, (box.y0 + box.y1) / 2)
    await p.page.mouse.wheel(0, -500)
    await press(p.page, 'button[aria-label="Highlight East"]')
    await settle(p.page)
    const zoomed = (await axisLabels(p.page))[0]
    expect(zoomed).not.toBe(x0)
    const highlighted = () => marks(p.page, "*").then(list => list.filter(m => /region/i.test(m.label)).every(m => m.opacity === (m.label.includes("East") ? 1 : DIMMED_OPACITY)))
    expect(await highlighted()).toBe(true)
    await p.page.setViewportSize({ width: 700, height: 800 })
    await p.page.waitForFunction(() => Number(document.documentElement.getAttribute("data-chart-width")) < 700)
    await settle(p.page)
    expect(await highlighted()).toBe(true)
    expect((await axisLabels(p.page))[1]).toBe(y0)
    await press(p.page, 'button[data-action="clear-zoom"]')
    await settle(p.page)
    expect(await highlighted()).toBe(true)
    await press(p.page, 'button[data-action="clear-legend"]')
    await settle(p.page)
    expect(dimmed(await marks(p.page, "*"))).toEqual([])
    clean(p)
    await p.close()
  }, T)
})

describe("responsive layout (A24)", () => {
  const many = Array.from({ length: 10 }, (_, i) => ({ team: `Product team ${String.fromCharCode(65 + i)}`, tickets: 20 + i * 7, kind: i % 2 ? "Bugs" : "Features" }))
  const doc = { version: 1, title: "Open tickets by product team and kind", chart: { kind: "recipe", recipe: "grouped_bar", data: { rows: many }, bindings: { category: "team", series: "kind", value: "tickets" }, options: { yTitle: "Tickets (n)" } }, interactions: { legend: "highlight" } }

  test("recipe-responsive: at 320, 480, 720 and 1024 px the live chart is re-planned to its container, text never under the floor or scaled by CSS", async () => {
    const p = await page(doc, "responsive")
    const seen: Json[] = []
    for (const viewport of [1024, 720, 480, 320]) {
      await p.page.setViewportSize({ width: viewport, height: 800 })
      await p.page.waitForFunction((w) => { const host = document.getElementById("chart")!; return Number(document.documentElement.getAttribute("data-chart-width")) === Math.floor(host.clientWidth) || document.documentElement.getAttribute("data-chart-layout") === "unsatisfiable" }, viewport)
      await settle(p.page)
      const state = await p.page.evaluate(() => {
        const svg = document.querySelector("#chart > div > svg")!
        const box = svg.getBoundingClientRect()
        const host = document.getElementById("chart")!
        const sizes = [...svg.querySelectorAll("text")].map(t => parseFloat(t.getAttribute("font-size") ?? getComputedStyle(t).fontSize))
        const outside = [...svg.querySelectorAll("text")].filter(t => { const r = t.getBoundingClientRect(); return r.width > 0 && (r.left < box.left - 1 || r.right > box.right + 1 || r.top < box.top - 1 || r.bottom > box.bottom + 1) }).map(t => t.textContent)
        return { layout: document.documentElement.getAttribute("data-chart-layout"), candidate: document.documentElement.getAttribute("data-chart-candidate"), attr: Number(svg.getAttribute("width")), drawn: Math.round(box.width), host: Math.floor(host.clientWidth), height: Number(svg.getAttribute("height")), smallest: Math.min(...sizes), outside, notice: !document.getElementById("chart-layout")!.hidden, rotated: [...svg.querySelectorAll(".role-axis-label text")].some(t => /rotate\(-(45|90)\)/.test(t.getAttribute("transform") ?? "")) }
      })
      seen.push({ viewport, ...state })
      expect(state.attr).toBe(state.drawn) // the SVG is drawn at its own size: no CSS scaling
      expect(state.smallest).toBeGreaterThanOrEqual(11)
      expect(state.height).toBe(420) // height stays fixed in v1
      if (state.layout === "fit") {
        expect(state.attr).toBe(state.host)
        expect(state.outside).toEqual([])
        expect(state.notice).toBe(false)
      } else {
        expect(state.notice).toBe(true)
        expect(state.attr).toBeGreaterThan(state.host)
      }
    }
    // Real reflow, not one picture: the widths differ and the narrow views use a more compact candidate.
    expect(new Set(seen.map(s => s.attr)).size).toBeGreaterThanOrEqual(3)
    const fits = seen.filter(s => s.layout === "fit")
    expect(fits.length).toBeGreaterThanOrEqual(3)
    // At the widest the category labels lie flat (wrapped where needed); at the narrowest they are turned to fit.
    expect(fits[0]!.rotated).toBe(false)
    expect(fits[fits.length - 1]!.rotated).toBe(true)
    clean(p)
    await p.close()
  }, T)

  test("a width no candidate fits keeps the last valid view and says so", async () => {
    const wide = Array.from({ length: 24 }, (_, i) => ({ month: `Month number ${i + 1} of the long programme`, value: i }))
    const p = await page({ version: 1, title: "A long programme", chart: { kind: "recipe", recipe: "bar", data: { rows: wide }, bindings: { category: "month", value: "value" }, options: { yTitle: "Value (n)" } }, layout: { width: 1100, height: 420 } }, "unsatisfiable", { viewport: { width: 1200, height: 800 } })
    const start = await p.page.evaluate(() => Number(document.querySelector("#chart > div > svg")!.getAttribute("width")))
    await p.page.setViewportSize({ width: 320, height: 800 })
    await p.page.waitForFunction(() => document.documentElement.getAttribute("data-chart-layout") === "unsatisfiable")
    const state = await p.page.evaluate(() => ({ width: Number(document.querySelector("#chart > div > svg")!.getAttribute("width")), notice: document.getElementById("chart-layout")!.textContent, visible: !document.getElementById("chart-layout")!.hidden, status: document.documentElement.getAttribute("data-chart-status") }))
    expect(state.width).toBe(start)
    expect(state.visible).toBe(true)
    expect(state.notice).toContain("cannot keep its labels readable")
    expect(state.status).toBe("ready")
    clean(p)
    await p.close()
  }, T)
})

describe("lifecycle (A25)", () => {
  // Counts live ResizeObservers and their observed elements, independently of the runtime's own report.
  const INSTRUMENT = `(() => { const Native = window.ResizeObserver; const live = new Set(); window.__observers = () => live.size;
    window.ResizeObserver = class extends Native { observe(t, o) { live.add(this); return super.observe(t, o) } disconnect() { live.delete(this); return super.disconnect() } } })()`
  const observers = (p: Page) => p.evaluate(() => (window as unknown as { __observers: () => number }).__observers())
  const runtime = (p: Page) => p.evaluate(() => ({ status: (window as unknown as { chartsRuntime: { status(): string; stats(): Json | null } }).chartsRuntime.status(), stats: (window as unknown as { chartsRuntime: { stats(): Json | null } }).chartsRuntime.stats(), live: document.querySelectorAll("#chart > div > svg").length, static: document.querySelectorAll("#chart > svg").length, width: Number(document.documentElement.getAttribute("data-chart-width")) }))

  test("hidden (zero width) is ignored until shown; repeated resizes coalesce; one observer and one view throughout", async () => {
    const p = await page(line({ legend: "highlight" }), "lifecycle", { init: INSTRUMENT })
    expect(await observers(p.page)).toBe(1)
    await press(p.page, 'button[aria-label="Highlight North"]')
    const shown = (await runtime(p.page)).width
    await p.page.evaluate(() => { document.querySelector("figure")!.style.display = "none" })
    await settle(p.page)
    expect((await runtime(p.page)).width).toBe(shown) // a hidden chart keeps its last width
    await p.page.setViewportSize({ width: 600, height: 800 })
    await settle(p.page)
    expect((await runtime(p.page)).width).toBe(shown)
    await p.page.evaluate(() => { document.querySelector("figure")!.style.display = "" })
    await p.page.waitForFunction((w) => Number(document.documentElement.getAttribute("data-chart-width")) !== w, shown)
    expect((await runtime(p.page)).width).toBeLessThan(600)
    for (const w of [900, 500, 800, 450, 700, 520, 1000, 610]) await p.page.setViewportSize({ width: w, height: 800 })
    await p.page.waitForFunction(() => Number(document.documentElement.getAttribute("data-chart-width")) === Math.floor(document.getElementById("chart")!.clientWidth))
    const r = await runtime(p.page)
    expect(r.stats).toMatchObject({ views: 1, observers: 1 })
    expect(await observers(p.page)).toBe(1)
    // The highlight survived it all.
    for (const m of (await marks(p.page, "*")).filter(m => /region/i.test(m.label))) expect(m.opacity).toBe(m.label.includes("North") ? 1 : DIMMED_OPACITY)
    clean(p)
    await p.close()
  }, T)

  test("dispose and remount: the static chart comes back, nothing stays observed or listening, and a remount starts one fresh view", async () => {
    const p = await page(line({ legend: "highlight", zoom: "x" }), "remount", { init: INSTRUMENT })
    const first = await runtime(p.page)
    expect(first.stats).toMatchObject({ views: 1, observers: 1 })
    const listeners = (first.stats as { listeners: number }).listeners
    for (let round = 0; round < 3; round++) {
      await p.page.evaluate(() => (window as unknown as { chartsRuntime: { dispose(): void } }).chartsRuntime.dispose())
      expect(await runtime(p.page)).toMatchObject({ status: "disposed", stats: null, live: 0, static: 1 })
      expect(await observers(p.page)).toBe(0)
      expect(await p.page.isVisible("#chart-controls")).toBe(false)
      await p.page.evaluate(() => (window as unknown as { chartsRuntime: { mount(): void } }).chartsRuntime.mount())
      await p.page.waitForFunction(() => document.documentElement.getAttribute("data-chart-status") === "ready")
      const again = await runtime(p.page)
      expect(again).toMatchObject({ status: "ready", live: 1, static: 0, stats: { views: 1, observers: 1, listeners } })
      expect(await observers(p.page)).toBe(1)
      // A remounted chart works: the controls act on the new view.
      await press(p.page, 'button[aria-label="Highlight South"]')
      await settle(p.page)
      expect(dimmed(await marks(p.page, "*")).length).toBeGreaterThan(0)
    }
    clean(p)
    await p.close()
  }, T)

  test("a recipe page whose runtime fails keeps its static chart, shows the failure and never shows its controls (A26)", async () => {
    const { result } = await draw(env, line({ legend: "highlight" }), { formats: ["html"], name: "broken-recipe" }, true)
    const file = join(ws.dir, result.files.html!)
    const { readFileSync, writeFileSync } = await import("node:fs")
    const { resign } = await import("./harness.ts")
    const broken = readFileSync(file, "utf8").replace(/<script>(?!\(function\(\)\{var ENGINE)[\s\S]*?<\/script>/, "<script>/* the runtime is missing */</script>")
    writeFileSync(file, resign(broken))
    const p = await open(file)
    expect(await p.status()).toBe("failed")
    expect(await p.page.evaluate(() => ({ staticSvg: !!document.querySelector("#chart > svg"), controls: document.getElementById("chart-controls")!.hidden, details: document.getElementById("chart-details")!.hidden, failure: !document.getElementById("chart-failure")!.hidden }))).toEqual({ staticSvg: true, controls: true, details: true, failure: true })
    expect(p.requests).toEqual([])
    await p.close()
  }, T)
})
