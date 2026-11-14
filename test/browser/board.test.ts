/// <reference lib="dom" />
/// <reference lib="dom.iterable" />
/**
 * The generated dashboard, live in headless Chromium: the CSP, the cross-filtering, Undo and Redo,
 * `window.chartsAgent`, the full repaint a polarity change causes, the tabs, the table and the detail dialog.
 *
 * The document itself (its schema, its cube and the four files `renderBoard` writes) is checked in
 * `test/board.test.ts`; this stage only opens what that one produced. Both board themes are rendered once, in
 * `beforeAll`, and every test opens the file it needs.
 *
 * The stage follows `test/browser/harness.ts`: playwright-core's pinned build, every request but the file itself
 * refused, one Chromium launch for the whole folder, and a missing browser is an error that says how to install it.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { Page } from "playwright-core"
import { formatValue } from "../../src/board/cube.ts"
import { renderBoard } from "../../src/board/render-board.ts"
import { closeVegaWorker } from "../../src/engines/vega-pool.ts"
import { BUILTIN_THEMES } from "../../src/themes/tokens.ts"
import { BOARD_LOCALE as LOCALE, boardDocument, boardRows, ROOT } from "../helpers.ts"
import { closeBrowser, launch, openBoard } from "./harness.ts"

type Rendered = Awaited<ReturnType<typeof renderBoard>>
interface Board { file: string; result: Rendered }

const dirs: string[] = []
function workspaceEnv() {
  const dir = mkdtempSync(join(tmpdir(), "charts-board-browser-"))
  dirs.push(dir)
  return { dir, env: { workspace: { directory: dir }, packageRoot: ROOT, configuredThemes: {}, defaults: { outDir: "outputs/charts" } } }
}

/** A board rendered once, through the public pipeline, into a workspace of its own. */
async function rendered(document: Record<string, unknown>): Promise<Board> {
  const { dir, env } = workspaceEnv()
  const result = await renderBoard(document, env)
  return { file: join(dir, result.files.html!), result }
}

let light: Board
let dark: Board
beforeAll(async () => {
  await launch()
  light = await rendered(boardDocument())
  dark = await rendered(boardDocument({ theme: "dark" }))
})
afterAll(async () => {
  await closeBrowser()
  await closeVegaWorker()
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

/** A generated dashboard, opened from disk. The first render of a board can take longer than a chart's. */
const open = (board: Board) => openBoard(board.file, { viewport: { width: 1280, height: 1000 }, timeout: 30_000 })

const status = (page: Page) => page.evaluate(() => document.documentElement.getAttribute("data-board-status"))
const kpis = (page: Page) => page.evaluate(() => Object.fromEntries([...document.querySelectorAll<HTMLElement>("[data-kpi]")].map(card => [card.dataset.kpi!, card.querySelector("[data-kpi-value]")?.textContent ?? ""])))
const snapshot = (page: Page) => page.evaluate(() => (window as unknown as { chartsAgent: { snapshot: () => Record<string, unknown> } }).chartsAgent.snapshot())

const T = 30_000

describe("the generated dashboard", () => {
  test("mounts offline, with no console error, no request and no policy violation", async () => {
    const opened = await open(light)
    try {
      expect(await status(opened.page)).toBe("ready")
      expect(opened.requests).toEqual([])
      expect(opened.errors).toEqual([])
      expect(opened.violations).toEqual([])
      expect(await opened.page.isVisible("#board-live")).toBe(true)
      expect(await opened.page.isHidden("#board-static")).toBe(true)
      // The live KPIs start from the same numbers the poster was drawn with.
      const live = await kpis(opened.page)
      expect(live.revenue).toBe(light.result.cube.kpis.revenue!.display)
      expect(live.orders).toBe(light.result.cube.kpis.orders!.display)
      await expect(opened.page.getAttribute("html", "data-board-theme")).resolves.toBe("light")
    } finally { await opened.close() }
  }, T)

  test("the board rendered in dark mounts in dark, and its live panels draw from the dark palette", async () => {
    const opened = await open(dark)
    try {
      expect(await status(opened.page)).toBe("ready")
      expect(opened.requests).toEqual([])
      expect(opened.errors).toEqual([])
      expect(opened.violations).toEqual([])
      await expect(opened.page.getAttribute("html", "data-board-theme")).resolves.toBe("dark")
      const fills = await opened.page.evaluate(() => [...document.querySelectorAll("#board-live [data-panel] svg *")].flatMap(node => [node.getAttribute("fill"), node.getAttribute("stroke")]).filter((value): value is string => value !== null && value.startsWith("#")).map(value => value.toUpperCase()))
      expect(fills).toContain(BUILTIN_THEMES.dark!.colors.categorical[0]!.toUpperCase())
    } finally { await opened.close() }
  }, T)

  test("cross-filters from a segmented control and a chip, announcing the rows", async () => {
    const opened = await open(light)
    try {
      const before = await kpis(opened.page)
      await opened.page.click('ui-segmented-control-item[value="South"]')
      await opened.page.waitForFunction(previous => (document.querySelector('[data-kpi="revenue"] [data-kpi-value]')?.textContent ?? "") !== previous, before.revenue, { timeout: 15_000 })
      const after = await kpis(opened.page)
      expect(after.revenue).not.toBe(before.revenue)
      const expected = boardRows().filter(row => row.region === "South").reduce((sum, row) => sum + Number(row.revenue), 0)
      expect(after.revenue).toBe(formatValue(expected, { format: "currency" }, LOCALE))
      await expect(opened.page.textContent("#board-status")).resolves.toContain(`of ${light.result.rows} rows`)

      await opened.page.click('ui-toggle[value="Enterprise"] button')
      const shown = boardRows().filter(row => row.region === "South" && row.segment === "Enterprise").length + 2
      await opened.page.waitForFunction(expected => (document.querySelector("#board-status")?.textContent ?? "").includes(`Showing ${expected} of 74 rows`), shown, { timeout: 15_000 })
      expect(await opened.page.textContent("[data-board-summary]")).toContain("Segment: Enterprise")
    } finally { await opened.close() }
  }, T)

  test("undoes and redoes a filter change", async () => {
    const opened = await open(light)
    try {
      const state = () => opened.page.evaluate(() => (window as unknown as { chartsAgent: { getState: () => { filters: Record<string, unknown> } } }).chartsAgent.getState().filters)
      expect(await state()).toMatchObject({ region: "North" })
      await opened.page.click('ui-segmented-control-item[value="West"]')
      await opened.page.waitForTimeout(400)
      expect(await state()).toMatchObject({ region: "West" })
      await opened.page.click('button[data-action="undo"]')
      await opened.page.waitForTimeout(400)
      expect(await state()).toMatchObject({ region: "North" })
      await opened.page.click('button[data-action="redo"]')
      await opened.page.waitForTimeout(400)
      expect(await state()).toMatchObject({ region: "West" })
      await opened.page.click('button[data-action="reset"]')
      await opened.page.waitForTimeout(400)
      expect(await state()).toMatchObject({ region: "North", segment: [] })
    } finally { await opened.close() }
  }, T)

  test("exposes window.chartsAgent: a small snapshot, board actions and @ui-sdk steps", async () => {
    const opened = await open(light)
    try {
      const snap = await snapshot(opened.page)
      expect(snap.version).toBe(1)
      expect((snap.board as { status: string }).status).toBe("ready")
      expect((snap.filters as { id: string }[]).map(filter => filter.id)).toEqual(["region", "segment", "revenue", "search"])
      expect((snap.panels as { id: string }[]).map(panel => panel.id)).toEqual(["trend", "share", "channel", "table"])
      expect(JSON.stringify(snap).length).toBeLessThan(1400)

      await opened.page.evaluate(() => (window as unknown as { chartsAgent: { act: (step: unknown) => Promise<unknown> } }).chartsAgent.act({ action: "setFilter", id: "region", value: "East" }))
      await opened.page.waitForTimeout(400)
      const filtered = await snapshot(opened.page)
      expect((filtered.filters as { id: string; value: unknown }[]).find(filter => filter.id === "region")!.value).toBe("East")
      expect((filtered.kpis as { id: string }[]).length).toBe(4)

      // A step in the @ui-sdk's own shape reaches the component, and the board follows its change event.
      const step = await opened.page.evaluate(() => (window as unknown as { chartsAgent: { act: (step: unknown) => Promise<{ ok: boolean }> } }).chartsAgent.act({ ref: "Region", action: "setValue", args: ["West"] }))
      expect(step.ok).toBe(true)
      await opened.page.waitForTimeout(400)
      const afterStep = await snapshot(opened.page)
      expect((afterStep.filters as { id: string; value: unknown }[]).find(filter => filter.id === "region")!.value).toBe("West")

      const components = await opened.page.evaluate(() => (window as unknown as { chartsAgent: { snapshot: (options: { components: boolean }) => { components: unknown[] } } }).chartsAgent.snapshot({ components: true }))
      expect((components.components as { component: string }[]).some(component => component.component === "segmented-control")).toBe(true)
    } finally { await opened.close() }
  }, T)

  test("the reader's polarity button repaints the live ECharts and Vega panels, not only the chrome", async () => {
    const opened = await open(light)
    const colours = () => opened.page.evaluate(() => Object.fromEntries([...document.querySelectorAll<HTMLElement>("#board-live [data-panel]")].map(section => {
      const seen = new Set<string>()
      for (const node of section.querySelectorAll("svg *")) {
        for (const name of ["fill", "stroke"]) {
          const value = node.getAttribute(name)
          if (value && value.startsWith("#")) seen.add(value.toUpperCase())
        }
      }
      return [section.dataset.panel ?? "", [...seen]]
    })))
    try {
      expect(await status(opened.page)).toBe("ready")
      const lightColors = BUILTIN_THEMES.light!.colors
      const darkColors = BUILTIN_THEMES.dark!.colors
      const before = (await colours()) as Record<string, string[]>
      // The panels were drawn from the page's own light theme, which is what the poster shows.
      expect(before.trend).toContain(lightColors.categorical[0]!.toUpperCase())
      expect(before.channel).toContain(lightColors.categorical[0]!.toUpperCase())

      await opened.page.click('button[data-action="theme"]')
      await opened.page.waitForFunction(() => document.documentElement.getAttribute("data-board-theme") === "dark", undefined, { timeout: 15_000 })
      await opened.page.waitForFunction((expected) => [...document.querySelectorAll("#board-live[hidden] , #board-live [data-panel] svg *")].some(node => (node.getAttribute("fill") ?? "").toUpperCase() === expected), darkColors.categorical[0]!.toUpperCase(), { timeout: 20_000 })
      const after = (await colours()) as Record<string, string[]>
      // Neither a Vega panel nor the ECharts panel keeps the light palette: the polarity button is a full repaint.
      for (const panel of ["trend", "share", "channel"]) {
        expect(after[panel]).toContain(darkColors.categorical[0]!.toUpperCase())
        expect(after[panel]).not.toContain(lightColors.categorical[0]!.toUpperCase())
      }
      expect(after.trend).toContain(darkColors.grid.toUpperCase())
      expect(after.trend).not.toContain(lightColors.grid.toUpperCase())
      expect(opened.violations).toEqual([])
      expect(opened.errors).toEqual([])
    } finally { await opened.close() }
  }, 60_000)

  test("switches tabs, sorts a table, opens a row's detail and toggles the theme", async () => {
    const opened = await open(light)
    try {
      // The second tab holds the ECharts panel and the table.
      await opened.page.click('ui-tabs-tab[value="detail"] button')
      await opened.page.waitForTimeout(500)
      expect(await opened.page.evaluate(() => (window as unknown as { chartsAgent: { getState: () => { tab: string } } }).chartsAgent.getState().tab)).toBe("detail")
      const rows = await opened.page.locator("tbody tr[data-index]").count()
      expect(rows).toBeGreaterThan(0)

      // Sorting by revenue puts the largest first, as the poster's own sort would.
      const firstBefore = await opened.page.locator('tbody tr[data-index] td[data-c="3"]').first().textContent()
      await opened.page.click('th[data-field="revenue"] button')
      await opened.page.waitForTimeout(200)
      expect(await opened.page.getAttribute('th[data-field="revenue"]', "aria-sort")).toBe("ascending")
      await opened.page.click('th[data-field="revenue"] button')
      await opened.page.waitForTimeout(200)
      const firstAfter = await opened.page.locator('tbody tr[data-index] td[data-c="3"]').first().textContent()
      expect(firstAfter).not.toBe(firstBefore)
      expect(await opened.page.getAttribute('th[data-field="revenue"]', "aria-sort")).toBe("descending")

      // A row opens the detail dialog with its fields.
      await opened.page.locator("tbody tr[data-index]").first().click()
      await opened.page.waitForTimeout(300)
      const detail = await opened.page.textContent("[data-board-detail]")
      expect(detail).toContain("revenue")
      expect(await opened.page.evaluate(() => (document.querySelector("ui-dialog") as unknown as { open: boolean }).open)).toBe(true)
      // A modal dialog holds focus, so it closes before anything else is pressed.
      await opened.page.click("ui-dialog-close button")
      await opened.page.waitForTimeout(300)
      expect(await opened.page.evaluate(() => (document.querySelector("ui-dialog") as unknown as { open: boolean }).open)).toBe(false)

      // The theme action moves the chrome's custom properties, whatever the chart theme is.
      const before = await opened.page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--board-bg").trim())
      await opened.page.click('button[data-action="theme"]')
      await opened.page.waitForTimeout(200)
      const after = await opened.page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--board-bg").trim())
      expect(after).not.toBe(before)
      expect(await opened.page.getAttribute("html", "data-board-theme")).toBe("dark")
    } finally { await opened.close() }
  }, T)
})
