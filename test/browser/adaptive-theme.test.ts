/// <reference lib="dom" />
/// <reference lib="dom.iterable" />
/**
 * The two halves of a theme-adaptive picture, in a real browser.
 *
 * 1. `makeAdaptiveSvg`: one drawing that follows `prefers-color-scheme` with no script, and that an explicit
 *    `data-theme` on its root overrides — checked by reading the computed fill of the canvas and of a mark.
 * 2. The host-theme bridge: an interactive page and a dashboard take a theme from a `postMessage` and from a
 *    `MessagePort` a view bridge transfers with its `hello`, repaint the page, the live ECharts and Plot views and a
 *    dashboard's custom properties, and keep a dashboard's active filters and undo history — all under the page's own
 *    Content-Security-Policy, with the network refused and no console error.
 *
 * The stage follows `./harness.ts`: playwright-core's pinned build, every request but the file itself refused, one
 * Chromium launch for the whole folder, and a missing browser is an error that says how to install it, never a skip.
 */
import { afterAll, describe, expect, test } from "bun:test"
import { join } from "node:path"
import { renderBoard } from "../../src/board/render-board.ts"
import { buildHtml, type HtmlInput } from "../../src/html.ts"
import type { Environment } from "../../src/pipeline.ts"
import { checkRenderedSvg } from "../../src/safety.ts"
import { echartsTheme } from "../../src/themes/adapters.ts"
import { makeAdaptiveSvg } from "../../src/themes/adaptive-svg.ts"
import { BUILTIN_THEMES } from "../../src/themes/tokens.ts"
import { ROOT } from "../helpers.ts"
import { closeBrowser, open, page, workDir } from "./harness.ts"

const LIGHT = BUILTIN_THEMES.light!
const DARK = BUILTIN_THEMES.dark!
const T = 60_000

afterAll(async () => { await closeBrowser() })

/** A computed colour as `rgb(r, g, b)`, which is what a browser reports for a hex. */
const rgb = (hex: string): string => {
  const value = /^#([0-9a-f]{6})$/i.exec(hex)![1]!
  return `rgb(${[0, 2, 4].map(index => parseInt(value.slice(index, index + 2), 16)).join(", ")})`
}

const computedFill = (target: import("playwright-core").Page, selector: string) => target.evaluate((at) => {
  const element = document.querySelector(at)
  return element ? getComputedStyle(element).fill : null
}, selector)

// ---------------------------------------------------------------------------------------------------------------
// 1. One SVG, two polarities, no script at all.

describe("makeAdaptiveSvg", () => {
  const DRAWING = `<svg xmlns="http://www.w3.org/2000/svg" width="120" height="60" viewBox="0 0 120 60" role="img" aria-label="Revenue"><rect id="canvas" x="0" y="0" width="120" height="60" fill="#FFFFFF"/><rect id="bar" x="10" y="10" width="30" height="40" fill="#4477AA"/><g style="fill:#1F2328;stroke:#E8EAED"><text id="label" x="60" y="40">42</text></g></svg>`

  test("stays a safe, deterministic drawing: one root, the same bytes twice, and every attribute kept", () => {
    const first = makeAdaptiveSvg(DRAWING, LIGHT, DARK)
    const second = makeAdaptiveSvg(DRAWING, LIGHT, DARK)
    expect(second).toBe(first)
    expect(() => checkRenderedSvg(first)).not.toThrow()
    // The root gained the scope and the colour scheme; nothing it already said was lost.
    const root = /<svg\b[^>]*>/.exec(first)![0]
    for (const attribute of ['xmlns="http://www.w3.org/2000/svg"', 'width="120"', 'height="60"', 'viewBox="0 0 120 60"', 'role="img"', 'aria-label="Revenue"', 'class="cs-', 'style="color-scheme: light dark"']) expect(root).toContain(attribute)
    expect((first.match(/<svg/g) ?? []).length).toBe(1)
    // Six rules, the media queries among them, and the literal kept as each property's fallback.
    for (const rule of ['@media (prefers-color-scheme: dark)', '@media (prefers-color-scheme: light)', "@media print", '[data-theme="light"]', '[data-theme="dark"]']) expect(first).toContain(rule)
    expect(first).toContain('fill="var(--cs-')
    expect(first).toContain(`, ${LIGHT.colors.background})`)
    // A colour the theme does not name is data, and stays exactly as it was.
    const foreign = makeAdaptiveSvg(`<svg xmlns="http://www.w3.org/2000/svg"><rect width="1" height="1" fill="#123456"/></svg>`, LIGHT, DARK)
    expect(foreign).toContain('fill="#123456"')
    // The initial polarity decides which literals can be referenced, and a dark drawing starts from the dark set.
    const darkStart = makeAdaptiveSvg(DRAWING.replace(/#4477AA/, DARK.colors.categorical[0]!), LIGHT, DARK, "dark")
    expect(darkStart).toContain(`, ${DARK.colors.categorical[0]})`)
  })

  test("follows the reader's colour scheme, and an explicit data-theme overrides it", async () => {
    const adaptive = makeAdaptiveSvg(DRAWING, LIGHT, DARK)
    const opened = await open(page("adaptive", `<!doctype html><html><head><meta charset="utf-8"><title>Adaptive</title><style>html,body{margin:0}</style></head><body>${adaptive}</body></html>`), { wait: false })
    try {
      // The page carries no script: every flip below is CSS alone.
      expect(await opened.page.evaluate(() => document.scripts.length)).toBe(0)
      await opened.page.emulateMedia({ colorScheme: "light" })
      expect(await computedFill(opened.page, "#canvas")).toBe(rgb(LIGHT.colors.background))
      expect(await computedFill(opened.page, "#bar")).toBe(rgb(LIGHT.colors.categorical[0]!))
      expect(await computedFill(opened.page, "#label")).toBe(rgb(LIGHT.colors.text))
      expect(await opened.page.getAttribute("#canvas", "fill")).toContain("var(--cs-")

      await opened.page.emulateMedia({ colorScheme: "dark" })
      expect(await computedFill(opened.page, "#canvas")).toBe(rgb(DARK.colors.background))
      expect(await computedFill(opened.page, "#bar")).toBe(rgb(DARK.colors.categorical[0]!))
      expect(await computedFill(opened.page, "#label")).toBe(rgb(DARK.colors.text))

      // An embedder that states a polarity wins over the reader's preference, in both directions.
      await opened.page.evaluate(() => document.querySelector("svg")!.setAttribute("data-theme", "light"))
      expect(await computedFill(opened.page, "#canvas")).toBe(rgb(LIGHT.colors.background))
      await opened.page.emulateMedia({ colorScheme: "light" })
      await opened.page.evaluate(() => document.querySelector("svg")!.setAttribute("data-theme", "dark"))
      expect(await computedFill(opened.page, "#canvas")).toBe(rgb(DARK.colors.background))
      expect(opened.violations).toEqual([])
      expect(opened.errors).toEqual([])
    } finally {
      await opened.close()
    }
  }, T)
})

// ---------------------------------------------------------------------------------------------------------------
// 2. A standalone page takes a theme from the host.

describe("a standalone page", () => {
  const ROWS = [{ region: "North", revenue: 120 }, { region: "South", revenue: 80 }, { region: "East", revenue: 95 }]
  const STATIC = `<svg xmlns="http://www.w3.org/2000/svg" width="240" height="120" viewBox="0 0 240 120" role="img" aria-label="Static"><rect width="240" height="120" fill="#FFFFFF"/><rect x="20" y="40" width="60" height="60" fill="#4477AA"/></svg>`
  const HOST = { type: "charts.theme", v: 1, seq: 1, mode: "dark", seed: { background: "#13111C", foreground: "#F4F2F8", accent: "#A855F7" } }

  const echartsHtml = (extra: Partial<HtmlInput> = {}): string => buildHtml(ROOT, {
    engine: "echarts",
    spec: { xAxis: { type: "category", data: ["Q1", "Q2", "Q3"] }, yAxis: { type: "value" }, series: [{ type: "bar", data: [120, 80, 95] }] },
    svg: STATIC,
    title: "Orders by quarter",
    description: "Orders by quarter.",
    theme: LIGHT,
    echartsTheme: echartsTheme(LIGHT),
    fonts: [],
    compactSpec: "",
    localeId: "en-US",
    ...extra,
  })
  const echartsPage = (extra: Partial<HtmlInput> = {}): string => page("host-echarts", echartsHtml(extra))

  const HOSTILE_FAMILY = 'Evil</style><meta http-equiv="refresh" content="0;url=https://example.com">'

  test("a hostile font family stays inside the page's <style> block, so no element can be created", () => {
    const hostile = { ...LIGHT, font: { ...LIGHT.font, family: HOSTILE_FAMILY, mono: HOSTILE_FAMILY } }
    const html = echartsHtml({ theme: hostile })
    // One style element, closed exactly once: the family cannot end it early and open a <meta> refresh.
    expect((html.match(/<\/style>/g) ?? []).length).toBe(1)
    expect((html.match(/<style>/g) ?? []).length).toBe(1)
    // The only meta the page carries is its own policy: the family never opened a refresh.
    expect(html).not.toContain('<meta http-equiv="refresh"')
    expect(html).not.toContain("<img src=")
    expect((html.match(/<meta /g) ?? []).length).toBe(3)
    // The family is a quoted, escaped CSS string in every rule that names it.
    expect(html).toContain("font-family:\"Evil\\3c /style\\3e \\3c meta")
    expect(html).toContain("font-family:\"Evil\\3c /style\\3e \\3c meta") // mono's rule too
    // The drawing is unchanged and still safe: the family is an XML attribute, escaped there as `<`.
    expect(() => checkRenderedSvg(STATIC)).not.toThrow()
  })

  const plotPage = (): string => page("host-plot", buildHtml(ROOT, {
    engine: "plot",
    spec: { width: 480, height: 280, marks: [{ type: "barY", x: "region", y: "revenue", fill: "region" }] },
    rows: ROWS,
    svg: STATIC,
    title: "Revenue by region",
    description: "Revenue by region.",
    theme: LIGHT,
    fonts: [],
    compactSpec: "",
    localeId: "en-US",
  }))

  test("flips its canvas and its live ECharts marks from a charts.theme message, with no violation and no request", async () => {
    const opened = await open(echartsPage())
    try {
      expect(await opened.status()).toBe("ready")
      expect(opened.violations).toEqual([])
      expect(opened.errors).toEqual([])
      expect(opened.requests).toEqual([])
      // The page's own theme, before the host speaks.
      expect(await opened.page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe(rgb(LIGHT.colors.background))

      await opened.page.evaluate((payload) => { window.postMessage(payload, "*") }, HOST)
      await opened.page.waitForFunction(() => getComputedStyle(document.body).backgroundColor === "rgb(19, 17, 28)", undefined, { timeout: 10_000 })

      const after = await opened.page.evaluate(() => ({
        body: getComputedStyle(document.body).backgroundColor,
        colour: getComputedStyle(document.body).color,
        root: document.documentElement.getAttribute("data-theme"),
        scheme: document.documentElement.style.colorScheme,
        accent: [...document.querySelectorAll("#chart path")].map(path => (path.getAttribute("fill") ?? "").toUpperCase()),
        staticGone: !document.querySelector("#chart > svg"),
      }))
      expect(after.body).toBe(rgb("#13111C"))
      expect(after.colour).toBe(rgb("#F4F2F8"))
      expect(after.root).toBe("dark")
      expect(after.scheme).toBe("dark")
      // The live ECharts view was rebuilt with the host's accent as its first category.
      expect(after.staticGone).toBe(true)
      expect(after.accent).toContain("#A855F7")
      expect(opened.violations).toEqual([])
      expect(opened.errors).toEqual([])
      expect(opened.requests).toEqual([])

      // A numbered theme never replaces an equal or later one; the next number does.
      await opened.page.evaluate((payload) => { window.postMessage({ ...payload, mode: "light" }, "*") }, HOST)
      await opened.page.waitForTimeout(300)
      expect(await opened.page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe(rgb("#13111C"))
      await opened.page.evaluate((payload) => { window.postMessage({ ...payload, seq: 2, mode: "light", seed: { background: "#FAFAF7", foreground: "#1B1B1B", accent: "#0F766E" } }, "*") }, HOST)
      await opened.page.waitForFunction(() => getComputedStyle(document.body).backgroundColor === "rgb(250, 250, 247)", undefined, { timeout: 10_000 })
      expect(await opened.page.evaluate(() => document.documentElement.getAttribute("data-theme"))).toBe("light")
      expect(opened.violations).toEqual([])
    } finally {
      await opened.close()
    }
  }, T)

  test("re-renders a live Plot view in the host's palette", async () => {
    const opened = await open(plotPage())
    try {
      expect(await opened.status()).toBe("ready")
      const before = await opened.page.evaluate(() => [...document.querySelectorAll("#chart > div svg rect")].length)
      expect(before).toBeGreaterThanOrEqual(ROWS.length)
      await opened.page.evaluate((payload) => { window.postMessage(payload, "*") }, HOST)
      await opened.page.waitForFunction(() => getComputedStyle(document.body).backgroundColor === "rgb(19, 17, 28)", undefined, { timeout: 10_000 })
      // Every mark was drawn again, and the first category is the host's accent.
      await opened.page.waitForFunction(() => [...document.querySelectorAll("#chart > div svg rect")].some(rect => getComputedStyle(rect).fill === "rgb(168, 85, 247)"), undefined, { timeout: 10_000 })
      expect(await opened.page.evaluate(() => ({ bars: document.querySelectorAll("#chart > div svg rect").length, stage: document.querySelectorAll('body > div[aria-hidden="true"]').length }))).toMatchObject({ bars: before, stage: 0 })
      expect(opened.violations).toEqual([])
      expect(opened.errors).toEqual([])
      expect(opened.requests).toEqual([])
    } finally {
      await opened.close()
    }
  }, T)

  test("announces itself to a parent frame and acknowledges a theme, so a host can sequence its messages", async () => {
    // The page in a frame: `hello` on boot, and an ack for every accepted `charts.theme`, numbered as it was sent.
    const encoded = Buffer.from(echartsHtml()).toString("base64")
    const host = page("frame-host", `<!doctype html><html><head><meta charset="utf-8"><title>Host</title></head><body><script>window.__messages=[];addEventListener("message",function(event){window.__messages.push(event.data)})</script><iframe id="frame" title="Chart" src="data:text/html;base64,${encoded}" style="width:1000px;height:700px;border:0"></iframe></body></html>`)
    const opened = await open(host, { wait: false })
    try {
      await opened.page.waitForFunction(() => ((window as unknown as { __messages?: { type?: string }[] }).__messages ?? []).some(message => message?.type === "charts.hello"), undefined, { timeout: 15_000 })
      const hello = await opened.page.evaluate(() => ((window as unknown as { __messages: { type: string; v: number; capabilities?: string[] }[] }).__messages).find(message => message.type === "charts.hello"))
      expect(hello).toMatchObject({ v: 1, capabilities: ["theme"] })

      await opened.page.evaluate(() => {
        const frame = document.getElementById("frame") as HTMLIFrameElement
        frame.contentWindow!.postMessage({ type: "charts.theme", v: 1, seq: 7, mode: "dark", seed: { background: "#101214", foreground: "#EDEFF2", accent: "#38BDF8" } }, "*")
      })
      await opened.page.waitForFunction(() => ((window as unknown as { __messages?: { type?: string }[] }).__messages ?? []).some(message => message?.type === "charts.theme.ack"), undefined, { timeout: 15_000 })
      const ack = await opened.page.evaluate(() => ((window as unknown as { __messages: { type: string; v: number; seq?: number; applied?: boolean }[] }).__messages).find(message => message.type === "charts.theme.ack"))
      expect(ack).toMatchObject({ v: 1, seq: 7, applied: true })

      // The framed page is themed, and the frame's own start-up produced no policy violation.
      const frame = opened.page.frames().find(candidate => candidate !== opened.page.mainFrame())
      expect(await frame!.evaluate(() => ({ body: getComputedStyle(document.body).backgroundColor, theme: document.documentElement.getAttribute("data-theme") }))).toMatchObject({ body: "rgb(16, 18, 20)", theme: "dark" })
      expect(opened.violations).toEqual([])
      expect(opened.errors).toEqual([])
    } finally {
      await opened.close()
    }
  }, T)

  test("given both polarities, it reports the reader's palette to a late hook before any host speaks", async () => {
    const opened = await open(echartsPage({ pairedThemes: { light: LIGHT, dark: DARK } }))
    try {
      expect(await opened.status()).toBe("ready")
      await opened.page.emulateMedia({ colorScheme: "dark" })
      await opened.page.waitForFunction(() => (window as unknown as { chartsRuntime: { theme: () => { mode?: string } | undefined } }).chartsRuntime.theme()?.mode === "dark", undefined, { timeout: 10_000 })
      // `fromMedia` records the theme it painted, so `theme()` answers it and a hook registered afterwards — the
      // dashboard's live ECharts and Vega repaints are registered exactly that way — receives it at once.
      const reported = await opened.page.evaluate(() => {
        const runtime = (window as unknown as { chartsRuntime: { theme: () => { mode: string; colors: { background: string }; echartsTheme: { color: string[] } } | undefined; addThemeHook: (hook: (theme: unknown) => void) => unknown } }).chartsRuntime
        let seen: { mode: string; colors: { background: string } } | undefined
        runtime.addThemeHook((theme) => { seen = theme as { mode: string; colors: { background: string } } })
        return { current: runtime.theme(), seen }
      })
      expect(reported.current?.mode).toBe("dark")
      expect(reported.current?.colors.background.toUpperCase()).toBe(DARK.colors.background.toUpperCase())
      expect(reported.seen?.mode).toBe("dark")
      expect(opened.violations).toEqual([])
      expect(opened.errors).toEqual([])
      expect(opened.requests).toEqual([])
    } finally {
      await opened.close()
    }
  }, T)

  test("given both polarities, it follows the reader until a host overrides, and then keeps the host's theme", async () => {
    const opened = await open(echartsPage({ pairedThemes: { light: LIGHT, dark: DARK } }))
    try {
      expect(await opened.status()).toBe("ready")
      await opened.page.emulateMedia({ colorScheme: "dark" })
      await opened.page.waitForFunction((expected) => getComputedStyle(document.body).backgroundColor === expected, rgb(DARK.colors.background), { timeout: 10_000 })
      expect(await opened.page.evaluate(() => document.documentElement.getAttribute("data-theme"))).toBe("dark")

      // A host theme takes over; the reader's preference no longer moves the page.
      await opened.page.evaluate((payload) => { window.postMessage(payload, "*") }, HOST)
      await opened.page.waitForFunction(() => getComputedStyle(document.body).backgroundColor === "rgb(19, 17, 28)", undefined, { timeout: 10_000 })
      await opened.page.emulateMedia({ colorScheme: "light" })
      await opened.page.waitForTimeout(300)
      expect(await opened.page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe(rgb("#13111C"))
      expect(opened.violations).toEqual([])
      expect(opened.errors).toEqual([])
      expect(opened.requests).toEqual([])
    } finally {
      await opened.close()
    }
  }, T)
})

// ---------------------------------------------------------------------------------------------------------------
// 3. A dashboard takes a theme over a MessagePort, and a repaint is not a data change.

describe("a dashboard", () => {
  const MONTHS = ["2026-01-01", "2026-02-01", "2026-03-01"]
  const REGIONS = ["North", "South", "East"]
  const rows = MONTHS.flatMap((month, monthIndex) => REGIONS.map((region, regionIndex) => ({ month, region, revenue: 40 + monthIndex * 10 + regionIndex * 30 })))

  const boardDocument = () => ({
    version: 1,
    title: "Revenue overview",
    subtitle: "By region and month",
    source: "Sales extract",
    datasets: { sales: { rows } },
    filters: [{ id: "region", label: "Region", field: "region", control: "segmented", defaultValue: "North" }],
    kpis: [{ id: "revenue", label: "Total revenue", dataset: "sales", field: "revenue", aggregate: "sum", format: "number" }],
    panels: [
      { id: "table", title: "Rows", dataset: "sales", span: 6, height: 260, chart: { kind: "table", columns: [{ field: "month", label: "Month" }, { field: "region", label: "Region" }, { field: "revenue", label: "Revenue", align: "right" }] } },
      { id: "share", title: "Revenue by region", dataset: "sales", span: 6, height: 260, chart: { quick: { type: "bar", x: "region", y: "revenue", aggregate: "sum" } } },
    ],
  })

  const DARK_VIEW = { v: 1, kind: "hello", theme: { scheme: "dark", surface: "#101418", raised: "#181E24", text: "#ECF2F8", muted: "#8B9BB0", border: "#26303C", accent: "#22D3EE", "on-accent": "#061014", danger: "#FB7185", font: "Geist", radius: "8px" } }
  const LIGHT_VIEW = { kind: "theme.changed", theme: { scheme: "light", surface: "#FAF8F5", raised: "#FFFFFF", text: "#1C1917", muted: "#6B6257", border: "#E4DCD1", accent: "#0F766E", danger: "#B91C1C", font: "Geist", radius: "6px" } }

  const variable = (target: import("playwright-core").Page, name: string) => target.evaluate((property) => getComputedStyle(document.documentElement).getPropertyValue(property).trim(), name)

  test("repaints its custom properties from a transferred MessagePort, keeping the active filter and the undo history", async () => {
    const workspace = workDir()
    const env: Environment = { workspace: { directory: workspace }, packageRoot: ROOT, configuredThemes: {}, defaults: { outDir: "outputs/charts" } }
    const result = await renderBoard(boardDocument(), env)
    const opened = await open(join(workspace, result.files.html!), { wait: false })
    try {
      await opened.page.waitForFunction(() => document.documentElement.getAttribute("data-board-status") === "ready", undefined, { timeout: 30_000 })
      expect(opened.violations).toEqual([])
      expect(opened.errors).toEqual([])
      expect(opened.requests).toEqual([])
      expect(await variable(opened.page, "--board-bg")).toBe(LIGHT.colors.background)

      // A filter is active before the host speaks: it must still be active afterwards.
      await opened.page.click('ui-segmented-control-item[value="South"]')
      await opened.page.waitForFunction(() => (document.getElementById("board-status")?.textContent ?? "").includes("Showing"), undefined, { timeout: 15_000 })
      const before = await opened.page.evaluate(() => ({
        rows: document.querySelectorAll("#board-live tbody tr[data-index]").length,
        status: document.getElementById("board-status")?.textContent ?? "",
        filter: (window as unknown as { chartsAgent: { getState: () => { filters: Record<string, unknown> } } }).chartsAgent.getState().filters.region,
        undo: (window as unknown as { chartsAgent: { snapshot: () => { undo: { entries: number } } } }).chartsAgent.snapshot().undo.entries,
      }))
      expect(before.filter).toBe("South")
      expect(before.rows).toBeGreaterThan(0)

      // A view bridge's `hello` transfers the port it will push on; the dashboard keeps it.
      await opened.page.evaluate((hello) => {
        const channel = new MessageChannel()
        ;(window as unknown as { hostPort: MessagePort }).hostPort = channel.port1
        window.postMessage(hello, "*", [channel.port2])
      }, DARK_VIEW)
      await opened.page.waitForFunction(() => getComputedStyle(document.documentElement).getPropertyValue("--board-bg").trim() === "#101418", undefined, { timeout: 10_000 })

      const dark = await opened.page.evaluate(() => ({
        body: getComputedStyle(document.body).backgroundColor,
        surface: getComputedStyle(document.documentElement).getPropertyValue("--board-surface").trim(),
        accent: getComputedStyle(document.documentElement).getPropertyValue("--board-accent").trim(),
        negative: getComputedStyle(document.documentElement).getPropertyValue("--board-negative").trim(),
        radius: getComputedStyle(document.documentElement).getPropertyValue("--board-radius").trim(),
        board: document.documentElement.getAttribute("data-board-theme"),
        root: document.documentElement.getAttribute("data-theme"),
        scheme: document.documentElement.style.colorScheme,
        setHostTheme: typeof (window as unknown as { chartsAgent: { setHostTheme?: unknown } }).chartsAgent.setHostTheme,
      }))
      expect(dark).toMatchObject({ body: rgb("#101418"), surface: "#181E24", accent: "#22D3EE", negative: "#FB7185", radius: "8px", board: "dark", root: "dark", scheme: "dark", setHostTheme: "function" })

      // The next push arrives on the port the hello transferred, not on `window`.
      await opened.page.evaluate((changed) => (window as unknown as { hostPort: MessagePort }).hostPort.postMessage(changed), LIGHT_VIEW)
      await opened.page.waitForFunction(() => getComputedStyle(document.documentElement).getPropertyValue("--board-bg").trim() === "#FAF8F5", undefined, { timeout: 10_000 })
      const light = await opened.page.evaluate(() => ({
        body: getComputedStyle(document.body).backgroundColor,
        accent: getComputedStyle(document.documentElement).getPropertyValue("--board-accent").trim(),
        board: document.documentElement.getAttribute("data-board-theme"),
        rows: document.querySelectorAll("#board-live tbody tr[data-index]").length,
        status: document.getElementById("board-status")?.textContent ?? "",
        filter: (window as unknown as { chartsAgent: { getState: () => { filters: Record<string, unknown> } } }).chartsAgent.getState().filters.region,
        undo: (window as unknown as { chartsAgent: { snapshot: () => { undo: { entries: number } } } }).chartsAgent.snapshot().undo.entries,
      }))
      expect(light).toMatchObject({ body: rgb("#FAF8F5"), accent: "#0F766E", board: "light", filter: "South" })
      // A repaint is not a data change: the same rows, the same announcement, the same history.
      expect(light.rows).toBe(before.rows)
      expect(light.status).toBe(before.status)
      expect(light.undo).toBe(before.undo)

      // The page's own theme button takes the chrome back from the host: the built-in dark chrome rules again.
      await opened.page.click('button[data-action="theme"]')
      await opened.page.waitForFunction(() => getComputedStyle(document.documentElement).getPropertyValue("--board-bg").trim() === "#0E1013", undefined, { timeout: 10_000 })
      expect(await opened.page.getAttribute("html", "data-board-theme")).toBe("dark")
      expect(await variable(opened.page, "--board-accent")).toBe("#56B4E9")
      expect(await opened.page.evaluate(() => document.documentElement.getAttribute("style") ?? "")).not.toContain("--board-bg")
      expect(opened.violations).toEqual([])
      expect(opened.errors).toEqual([])
      expect(opened.requests).toEqual([])
    } finally {
      await opened.close()
    }
  }, 90_000)

  test("takes a charts.theme postMessage, and a colour that is not one never becomes a rule", async () => {
    const workspace = workDir()
    const env: Environment = { workspace: { directory: workspace }, packageRoot: ROOT, configuredThemes: {}, defaults: { outDir: "outputs/charts" } }
    const result = await renderBoard(boardDocument(), env)
    const opened = await open(join(workspace, result.files.html!), { wait: false })
    try {
      await opened.page.waitForFunction(() => document.documentElement.getAttribute("data-board-status") === "ready", undefined, { timeout: 30_000 })
      await opened.page.evaluate(() => { window.postMessage({ type: "charts.theme", v: 1, seq: 1, mode: "dark", seed: { background: "#13111C", foreground: "#F4F2F8", accent: "#A855F7" } }, "*") })
      await opened.page.waitForFunction(() => getComputedStyle(document.documentElement).getPropertyValue("--board-accent").trim() === "#A855F7", undefined, { timeout: 10_000 })

      // The same number never replaces a theme already applied; the next number does.
      await opened.page.evaluate(() => { window.postMessage({ type: "charts.theme", v: 1, seq: 1, mode: "dark", seed: { accent: "#22D3EE" } }, "*") })
      await opened.page.waitForTimeout(250)
      expect(await variable(opened.page, "--board-accent")).toBe("#A855F7")

      // A value that is not a colour is not a rule: the derivation falls back, and nothing it says reaches the DOM.
      await opened.page.evaluate(() => { window.postMessage({ type: "charts.theme", v: 1, seq: 2, mode: "dark", seed: { background: "url(https://example.invalid/x)", accent: "#22D3EE" } }, "*") })
      await opened.page.waitForFunction(() => getComputedStyle(document.documentElement).getPropertyValue("--board-accent").trim() === "#22D3EE", undefined, { timeout: 10_000 })
      const style = await opened.page.evaluate(() => document.documentElement.getAttribute("style") ?? "")
      expect(style).not.toContain("url(")
      expect(style).not.toContain("expression")
      expect(opened.violations).toEqual([])
      expect(opened.errors).toEqual([])
      expect(opened.requests).toEqual([])
    } finally {
      await opened.close()
    }
  }, 90_000)
})
