/// <reference lib="dom" />
/// <reference lib="dom.iterable" />
import { announce, cellsToText, createRovingFocus, createSelection, createUndoStack, prepareAnnouncements } from "@ui-sdk/core"
import { createAgent } from "@ui-sdk/core/agent"
import { createHistory } from "@ui-sdk/core/history"
import { observe } from "@ui-sdk/core/observe"
import "@ui-sdk/web/collapsible"
import "@ui-sdk/web/dialog"
import "@ui-sdk/web/popover"
import "@ui-sdk/web/segmented-control"
import "@ui-sdk/web/select"
import "@ui-sdk/web/slider"
import "@ui-sdk/web/tabs"
import "@ui-sdk/web/toggle"
import "@ui-sdk/web/toolbar"
import { aggregateRows, filterRows, formatCell, formatValue, numeric, snapRange, sparkPoints, type BoardNumberLocale, type Row } from "../board/cube.js"
import { compactFormat, compactSpec } from "../engines/compact.js"
import { boardVariables, browserTheme, deriveBrowserTheme, installThemeBridge, type BrowserPalette, type BrowserTheme, type ThemeBridgeHandle } from "./theme-bridge.js"

/**
 * The dashboard runtime inlined into `<name>.board.html`: the `@ui-sdk` behaviours and web components, the board's own
 * controller, and the agent bridge, in one IIFE with no imports left at run time.
 *
 * The page is offline and under a Content-Security-Policy that allows only the hashes of its own inline scripts, so
 * every element is imported statically (the `@ui-sdk/web` autoloader's dynamic `import()` would be blocked) and no
 * expression is ever turned into code. Vega is handed `{ast: true}` and the interpreter the shell bundles, which is
 * what lets a live view run under that policy.
 *
 * `mountBoard(config)` builds the chrome, applies the initial filters, draws the panels and resolves `ready`; from then
 * on every filter change recomputes the KPIs, the sparklines and the panels from the rows the page carries, so
 * cross-filtering works with the network switched off.
 *
 * The board also listens for a host view's theme (`installThemeBridge`): a `{ type: "charts.theme" }` postMessage, or a
 * view bridge's `hello` / `theme.changed` over a transferred `MessagePort`. A theme replaces the `--board-*` and
 * `--ui-*` custom properties, the page background and the live chart themes in place, without touching the filter
 * state or the undo history, because a repaint is not a data change.
 */

type Json = Record<string, unknown>

export interface BoardFilterConfig {
  readonly id: string
  readonly label: string
  readonly field: string
  readonly dataset?: string
  readonly control: "segmented" | "select" | "chips" | "range" | "search"
  readonly options: readonly { value: string; label: string }[]
  readonly value: unknown
  readonly min?: number
  readonly max?: number
  readonly step?: number
}

export interface BoardKpiConfig {
  readonly id: string
  readonly label: string
  readonly dataset: string
  readonly field?: string
  readonly aggregate: "sum" | "mean" | "median" | "min" | "max" | "count"
  readonly format?: string
  readonly decimals?: number
  readonly prefix?: string
  readonly suffix?: string
  readonly delta?: { value: number; label?: string; positiveIsGood?: boolean }
  readonly sparkline?: { x: string; y: string; aggregate?: "sum" | "mean" }
}

export interface BoardTableCellConfig {
  readonly field: string
  readonly label: string
  readonly format?: string
  readonly align: "left" | "right"
}

export interface BoardPanelConfig {
  readonly id: string
  readonly title: string
  readonly subtitle?: string
  readonly dataset: string
  readonly tab?: string
  readonly span: number
  readonly height: number
  readonly bodyHeight: number
  readonly kind: "vega" | "echarts" | "table"
  readonly spec?: unknown
  readonly columns?: readonly BoardTableCellConfig[]
  readonly limit?: number
}

export interface BoardConfig {
  readonly title: string
  readonly subtitle?: string
  readonly kicker?: string
  readonly source?: string
  readonly width: number
  readonly columns: number
  readonly theme: "light" | "dark"
  readonly locale: { readonly id: string; readonly number: BoardNumberLocale }
  readonly filters: readonly BoardFilterConfig[]
  readonly kpis: readonly BoardKpiConfig[]
  readonly panels: readonly BoardPanelConfig[]
  readonly tabs?: readonly { id: string; label: string }[]
  readonly datasets: Readonly<Record<string, readonly Row[]>>
  readonly totals: Readonly<Record<string, number>>
  readonly sampled?: Readonly<Record<string, number>>
  readonly echartsTheme?: Json
  /** Both polarities of the page's palette, so its own light/dark button repaints the live panels, not only the chrome. */
  readonly palettes?: { readonly light: BrowserPalette; readonly dark: BrowserPalette }
}

export interface BoardState {
  readonly filters: Readonly<Record<string, unknown>>
  readonly tab: string | null
  readonly theme: "light" | "dark"
}

export interface BoardSnapshot {
  readonly version: number
  readonly board: { readonly title: string; readonly theme: string; readonly tab: string | null; readonly status: string; readonly rows: { readonly shown: number; readonly total: number } }
  readonly filters: readonly { readonly id: string; readonly label: string; readonly control: string; readonly value: unknown; readonly active: boolean }[]
  readonly kpis: readonly { readonly id: string; readonly value: number; readonly display: string }[]
  readonly panels: readonly { readonly id: string; readonly kind: string; readonly tab: string | null; readonly rows: number }[]
  readonly undo: { readonly canUndo: boolean; readonly canRedo: boolean; readonly entries: number; readonly position: number }
  /** The last change a component reported, from @ui-sdk's own `observe`: what moved, and who moved it. */
  readonly last?: { readonly label?: string; readonly key: string; readonly value: unknown; readonly source: string }
  readonly components?: unknown
}

export type BoardStep =
  | { readonly steps: readonly { readonly ref: string; readonly action: string; readonly args?: readonly unknown[] }[] }
  | { readonly ref: string; readonly action: string; readonly args?: readonly unknown[] }
  | { readonly action: "setFilter"; readonly id: string; readonly value: unknown }
  | { readonly action: "setTab"; readonly id: string }
  | { readonly action: "setTheme"; readonly id?: string; readonly value?: string }
  | { readonly action: "undo" | "redo" | "reset" | "announce"; readonly id?: string; readonly value?: unknown }

export interface BoardApp {
  readonly ready: Promise<void>
  snapshot(options?: { readonly components?: boolean }): BoardSnapshot
  act(input: BoardStep | readonly BoardStep[]): Promise<unknown>
  query(input: string | { readonly text?: string; readonly within?: string; readonly kind?: string }): Promise<unknown>
  undo(): BoardState
  redo(): BoardState
  reset(): BoardState
  getState(): BoardState
  setFilter(id: string, value: unknown): Promise<BoardState>
  setTab(id: string): Promise<BoardState>
  setTheme(theme: string): BoardState
  /** Applies a host view's theme: the same payloads `window.postMessage` and a view bridge's `MessagePort` carry. */
  setHostTheme(input: unknown): BoardState
  destroy(): void
}

// ---------------------------------------------------------------------------------------------------------------
// Small DOM helpers. Elements are built, never assembled from strings, so a dataset's text can never be markup.

function h<K extends keyof HTMLElementTagNameMap>(tag: K, attributes: Record<string, string> = {}, children: readonly (Node | string)[] = []): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, value)
  for (const child of children) node.append(child)
  return node
}

function must<T>(value: T | null | undefined, what: string): T {
  if (value === null || value === undefined) throw new Error(`The dashboard is missing ${what}.`)
  return value
}

interface VegaView {
  initialize(el: HTMLElement): VegaView
  runAsync(): Promise<VegaView>
  finalize(): void
  addEventListener(type: string, handler: (event: unknown, item: { datum?: Row } | null) => void): void
  resize(): VegaView
}
interface VegaLike {
  parse(spec: unknown, config?: unknown, options?: { ast?: boolean }): unknown
  View: new (spec: unknown, options?: Record<string, unknown>) => VegaView
}
interface EChartsChart {
  setOption(option: unknown, options?: Record<string, unknown>): void
  resize(): void
  dispose(): void
  on(type: string, handler: (params: { data?: Row; name?: string }) => void): void
}
interface EChartsLike {
  init(el: HTMLElement, theme?: string | null, options?: Record<string, unknown>): EChartsChart
  registerTheme(name: string, theme: unknown): void
}

const globalScope = globalThis as unknown as { vega?: VegaLike; vegaInterpreter?: unknown; echarts?: EChartsLike }

/** Vega in the page: the safety checks already ran on the server, and the loader refuses every load anyway. */
function vegaView(spec: unknown): { view: VegaView } | undefined {
  const vega = globalScope.vega
  if (!vega) return undefined
  const parsed = vega.parse(spec, null, { ast: true })
  const deny = () => Promise.reject(new Error("Charts load nothing."))
  const view = new vega.View(parsed, { expr: globalScope.vegaInterpreter, renderer: "svg", hover: true, loader: { load: deny, sanitize: deny, http: deny, file: deny } })
  return { view }
}

/** The rows a panel spec asks for: the marker the renderer left where its data goes, filled from the page's copy. */
function fillRows(spec: unknown, rows: readonly Row[]): unknown {
  const copy = JSON.parse(JSON.stringify(spec)) as Json
  const marker = (values: unknown): boolean => Array.isArray(values) && values.length === 1 && !!values[0] && typeof values[0] === "object" && (values[0] as Json).__boardRows === true
  if (Array.isArray(copy.data)) {
    for (const data of copy.data) if (data && typeof data === "object" && marker((data as Json).values)) (data as Json).values = rows.map(row => ({ ...row }))
  }
  if (copy.dataset && typeof copy.dataset === "object" && marker((copy.dataset as Json).source)) (copy.dataset as Json).source = rows.map(row => ({ ...row }))
  return copy
}

// ---------------------------------------------------------------------------------------------------------------
// Repainting a drawn picture: a compiled Vega spec bakes its colours in, so a palette is applied by mapping the
// colours the drawing already carries onto the ones the new palette names — the same swap the adaptive SVG makes with
// CSS variables, done here on the marks a live view rendered.

const HEX_DRAWN = /^#[0-9a-fA-F]{6}$/

/**
 * The colour pairs from one palette to another: every slot the drawing can carry, matched by role — the canvas, the
 * ink, the hairlines and axes, and the categorical, sequential and diverging ramps by index.
 */
function paletteMap(from: BrowserTheme | undefined, to: BrowserTheme | undefined): Map<string, string> {
  const map = new Map<string, string>()
  if (!from || !to) return map
  const add = (before: string | undefined, after: string | undefined): void => {
    if (!before || !after) return
    const key = before.trim().toUpperCase()
    if (key === after.trim().toUpperCase()) return
    map.set(key, after.trim())
  }
  add(from.colors.background, to.colors.background)
  add(from.colors.text, to.colors.text)
  add(from.colors.muted, to.colors.muted)
  add(from.colors.grid, to.colors.grid)
  add(from.colors.axis, to.colors.axis)
  add(from.colors.neutral, to.colors.neutral)
  const ramps = ["categorical", "sequential", "diverging"] as const
  for (const ramp of ramps) {
    const before = from.colors[ramp]
    const after = to.colors[ramp]
    if (!after.length) continue
    before.forEach((colour, index) => add(colour, after[index % after.length]))
  }
  return map
}

/** Rewrites the fill, stroke and stop colours of a drawing that is already on the page. */
function recolourSvg(root: Element, map: Map<string, string>): void {
  if (map.size === 0) return
  const swap = (value: string): string | undefined => map.get(value.trim().toUpperCase())
  for (const node of root.querySelectorAll("*")) {
    for (const name of ["fill", "stroke", "stop-color"]) {
      const value = node.getAttribute(name)
      if (!value || !HEX_DRAWN.test(value.trim())) continue
      const next = swap(value)
      if (next) node.setAttribute(name, next)
    }
    const style = node.getAttribute("style")
    if (style && style.includes("#")) node.setAttribute("style", style.replace(/#[0-9a-fA-F]{6}/g, hex => swap(hex) ?? hex))
  }
}

// ---------------------------------------------------------------------------------------------------------------
// The controller.

export function mountBoard(config: BoardConfig): BoardApp {
  prepareAnnouncements(document)
  const html = document.documentElement
  const statusEl = must(document.getElementById("board-status"), "the status region")
  const staticEl = must(document.getElementById("board-static"), "the static poster")
  const liveEl = must(document.getElementById("board-live"), "the live container")
  const failureEl = document.getElementById("board-failure")
  const locale = { id: config.locale.id, number: config.locale.number }
  const datasets = config.datasets
  const totalRows = Object.values(config.totals).reduce((sum, n) => sum + n, 0)

  const initialFilters: Record<string, unknown> = {}
  for (const filter of config.filters) initialFilters[filter.id] = filter.value
  const initialTab = config.tabs && config.tabs.length ? config.tabs[0]!.id : null
  let state: BoardState = { filters: initialFilters, tab: initialTab, theme: config.theme }

  const stack = createUndoStack<BoardState>(state)
  const agent = createAgent()
  const history = createHistory(agent)
  let lastChange: { label?: string; key: string; value: unknown; source: string } | undefined
  const stopObserve = observe(change => { lastChange = { ...(change.label !== undefined ? { label: change.label } : {}), key: change.key, value: change.value, source: String(change.source) } })
  let syncing = false
  let destroyed = false
  let renderToken = 0
  let status = "initializing"
  let filtered: Record<string, Row[]> = {}
  let kpiViews: Record<string, { value: number; display: string }> = {}
  let sparkViews: Record<string, { points: readonly (readonly [number, number])[]; labels: readonly string[] }> = {}

  const sparkElements: Record<string, SVGSVGElement> = {}
  const valueElements: Record<string, HTMLElement> = {}
  const controls: Record<string, HTMLElement> = {}
  const tableBodies: Record<string, { table: HTMLTableElement; body: HTMLTableSectionElement; caption: HTMLElement }> = {}
  const tableSort: Record<string, { field: string; direction: 1 | -1 }> = {}
  const charts: Record<string, EChartsChart> = {}
  const views: Record<string, VegaView> = {}
  const boardTheme = (mode: "light" | "dark"): BrowserTheme | undefined => {
    const palette = config.palettes?.[mode]
    return palette ? browserTheme({ ...palette, mode }) : undefined
  }
  /** The palette the compiled panel specs were drawn with: the page's own theme, baked into every mark at build time. */
  const sourceTheme = boardTheme(config.theme)
  /** The palette the panels are drawn with now: the page's, or the one a host view last named. */
  let liveTheme: BrowserTheme | undefined = sourceTheme
  /** The ECharts theme the panels are drawn with: the page's own, or the one a host view last named. */
  let liveEchartsTheme: Json | undefined = (sourceTheme?.echartsTheme as Json | undefined) ?? config.echartsTheme
  let resolveReady!: () => void
  let rejectReady!: (error: unknown) => void
  const ready = new Promise<void>((resolve, reject) => { resolveReady = resolve; rejectReady = reject })

  const setStatus = (next: "initializing" | "ready" | "failed", message: string, priority: "polite" | "assertive" = "polite") => {
    status = next
    html.setAttribute("data-board-status", next)
    statusEl.setAttribute("data-status", next)
    statusEl.textContent = message
    if (next !== "failed") announce(message, { priority })
  }

  // -------------------------------------------------------------------------------------------------------------
  // The chrome.

  const head = h("div", { class: "board-head" })
  const titles = h("div")
  if (config.kicker) titles.append(h("p", { class: "board-kicker" }, [config.kicker]))
  titles.append(h("h1", { class: "board-title" }, [config.title]))
  if (config.subtitle) titles.append(h("p", { class: "board-subtitle" }, [config.subtitle]))
  head.append(titles)

  const actions = h("div", { class: "board-actions" })
  const themeButton = h("button", { type: "button", class: "board-button", "data-action": "theme", "aria-label": "Switch between the light and the dark chrome" })
  const undoButton = h("button", { type: "button", class: "board-button", "data-action": "undo" }, ["Undo"])
  const redoButton = h("button", { type: "button", class: "board-button", "data-action": "redo" }, ["Redo"])
  const resetButton = h("button", { type: "button", class: "board-button", "data-action": "reset" }, ["Reset"])
  actions.append(themeButton, undoButton, redoButton, resetButton)
  head.append(actions)

  const toolbar = h("ui-toolbar", { "aria-label": "Board filters", "data-board-filters": "" })
  const summary = h("p", { class: "board-summary", "data-board-summary": "" })
  const kpiRow = h("div", { class: "board-kpis" })
  const grid = h("div", { class: "board-grid" })
  const footer = h("footer", { class: "board-footer" })
  const left = h("span", {}, [config.source ?? ""])
  const right = h("span", {}, [`${config.panels.length} panels`])
  footer.append(left)
  if (config.source) {
    const details = h("ui-collapsible")
    const trigger = h("ui-collapsible-trigger")
    trigger.append(h("button", { type: "button" }, ["Source & notes"]))
    const panel = h("ui-collapsible-panel")
    panel.append(h("p", {}, [`Data: ${config.source}. ${totalRows.toLocaleString(config.locale.id)} rows in ${Object.keys(datasets).length} datasets.`]))
    details.append(trigger, panel)
    footer.append(details)
  }
  footer.append(right)
  liveEl.append(head, toolbar, summary, kpiRow, grid, footer)

  // The row detail: a dialog named by its title, filled when a mark or a row is clicked.
  const detail = h("ui-dialog", { "aria-label": "Row detail" })
  const detailContent = h("ui-dialog-content")
  const detailTitle = h("ui-dialog-title")
  detailTitle.textContent = "Row detail"
  const detailDescription = h("ui-dialog-description")
  const detailBody = h("div", { "data-board-detail": "" })
  const detailClose = h("ui-dialog-close")
  detailClose.append(h("button", { type: "button", "aria-label": "Close the row detail" }, ["Close"]))
  detailContent.append(detailTitle, detailDescription, detailBody, detailClose)
  detail.append(detailContent)
  liveEl.append(detail)

  // -------------------------------------------------------------------------------------------------------------
  // Filters.

  const labelFor = (filter: BoardFilterConfig): HTMLElement => h("span", { class: "board-field-label" }, [filter.label])
  const optionRow = (value: string, label: string): HTMLElement => h("ui-segmented-control-item", { value }, [label])

  for (const filter of config.filters) {
    const field = h("div", { class: "board-field" })
    field.append(labelFor(filter))
    if (filter.control === "segmented") {
      const control = h("ui-segmented-control", { "aria-label": filter.label })
      control.append(h("ui-segmented-control-indicator"))
      control.append(optionRow("", "All"))
      for (const option of filter.options) control.append(optionRow(option.value, option.label))
      setProperty(control, "value", typeof filter.value === "string" ? filter.value : "")
      control.addEventListener("valuechange", event => changeFilter(filter, (event as CustomEvent).detail?.value))
      field.append(control)
      controls[filter.id] = control
    } else if (filter.control === "select") {
      const control = h("ui-select", { "aria-label": filter.label, placeholder: "All" })
      const trigger = h("ui-select-trigger")
      const button = h("button", { type: "button" })
      button.append(h("ui-select-value"))
      trigger.append(button)
      const content = h("ui-select-content")
      content.append(h("ui-select-item", { value: "" }, ["All"]))
      for (const option of filter.options) content.append(h("ui-select-item", { value: option.value }, [option.label]))
      control.append(trigger, content)
      setProperty(control, "value", typeof filter.value === "string" && filter.value !== "" ? filter.value : null)
      control.addEventListener("valuechange", event => changeFilter(filter, (event as CustomEvent).detail?.value ?? ""))
      field.append(control)
      controls[filter.id] = control
    } else if (filter.control === "chips") {
      const control = h("ui-toggle-group", { "aria-label": filter.label, multiple: "" })
      for (const option of filter.options) {
        const toggle = h("ui-toggle", { value: option.value })
        toggle.append(h("button", { type: "button" }, [option.label]))
        control.append(toggle)
      }
      setProperty(control, "value", Array.isArray(filter.value) ? filter.value : [])
      control.addEventListener("valuechange", event => changeFilter(filter, (event as CustomEvent).detail?.value ?? []))
      field.append(control)
      controls[filter.id] = control
    } else if (filter.control === "range") {
      const control = h("ui-slider", { "aria-label": filter.label, min: String(filter.min ?? 0), max: String(filter.max ?? 1), step: String(filter.step ?? 1) })
      control.append(h("ui-slider-value"))
      const sliderControl = h("ui-slider-control")
      const track = h("ui-slider-track")
      track.append(h("ui-slider-indicator"), h("ui-slider-thumb", { "aria-label": filter.label }))
      sliderControl.append(track)
      control.append(sliderControl)
      setProperty(control, "format", (value: number) => formatValue(value, { format: "compact" }, locale))
      setProperty(control, "value", numeric(filter.value) ?? filter.max ?? 0)
      control.addEventListener("valuecommit", event => changeFilter(filter, (event as CustomEvent).detail?.value))
      field.append(control)
      controls[filter.id] = control
    } else {
      const wrap = h("ui-toolbar-input")
      const input = h("input", { type: "search", "aria-label": filter.label, placeholder: "Search", value: typeof filter.value === "string" ? filter.value : "" })
      input.addEventListener("input", () => changeFilter(filter, input.value))
      wrap.append(input)
      field.append(wrap)
      controls[filter.id] = input
    }
    toolbar.append(field)
  }

  function setProperty(node: HTMLElement, name: string, value: unknown) {
    try { (node as unknown as Record<string, unknown>)[name] = value } catch { /* a component that refuses the write keeps its own */ }
  }

  function changeFilter(filter: BoardFilterConfig, value: unknown) {
    if (syncing) return
    const next = normalise(filter, value)
    commit({ ...state, filters: { ...state.filters, [filter.id]: next } }, filter.id)
  }

  function normalise(filter: BoardFilterConfig, value: unknown): unknown {
    if (filter.control === "chips") return Array.isArray(value) ? value.map(String) : value === undefined || value === null || value === "" ? [] : [String(value)]
    if (filter.control === "range") return snapRange(value, { min: filter.min ?? 0, max: filter.max ?? 1, step: filter.step ?? 1 })
    return value === null || value === undefined ? "" : String(value)
  }

  // -------------------------------------------------------------------------------------------------------------
  // KPI cards.

  for (const kpi of config.kpis) {
    const card = h("div", { class: "board-kpi", "data-kpi": kpi.id })
    card.append(h("span", { class: "board-kpi-label" }, [kpi.label]))
    const row = h("div", { class: "board-kpi-row" })
    const value = h("span", { class: "board-kpi-value", "data-kpi-value": "" })
    row.append(value)
    if (kpi.delta) {
      const good = kpi.delta.positiveIsGood === false ? kpi.delta.value <= 0 : kpi.delta.value >= 0
      const badge = h("span", { class: "board-kpi-delta", "data-good": String(good), "data-kpi-delta": "" }, [`${kpi.delta.value >= 0 ? "+" : "−"}${Math.abs(kpi.delta.value).toFixed(1)}%${kpi.delta.label ? ` ${kpi.delta.label}` : ""}`])
      row.append(badge)
    }
    card.append(row)
    if (kpi.sparkline) {
      const spark = document.createElementNS("http://www.w3.org/2000/svg", "svg")
      spark.setAttribute("class", "board-kpi-spark")
      spark.setAttribute("preserveAspectRatio", "none")
      spark.setAttribute("viewBox", "0 0 100 26")
      spark.setAttribute("aria-hidden", "true")
      card.append(spark)
      sparkElements[kpi.id] = spark
    }
    valueElements[kpi.id] = value
    kpiRow.append(card)
  }

  // -------------------------------------------------------------------------------------------------------------
  // Panels: live Vega, live ECharts, and tables with sorting, a roving cursor and TSV copy.

  const panelHosts: Record<string, HTMLElement> = {}
  const sections: Record<string, HTMLElement> = {}
  const panelRows = (panel: BoardPanelConfig): Row[] => filtered[panel.dataset] ?? []

  for (const panel of config.panels) {
    const section = h("section", { class: "board-panel", "data-panel": panel.id, "aria-label": panel.title })
    section.style.gridColumn = `span ${Math.max(1, Math.min(panel.span, config.columns))}`
    section.dataset.tab = panel.tab ?? ""
    const headEl = h("div", { class: "board-panel-head" })
    headEl.append(h("h2", { class: "board-panel-title" }, [panel.title]))
    if (panel.subtitle) headEl.append(h("p", { class: "board-panel-subtitle" }, [panel.subtitle]))
    const body = h("div", { class: "board-panel-body", "data-kind": panel.kind })
    body.style.minHeight = `${Math.max(80, panel.bodyHeight)}px`
    section.append(headEl, body)
    panelHosts[panel.id] = body
    sections[panel.id] = section
  }

  if (config.tabs && config.tabs.length > 1) {
    const tabs = h("ui-tabs", { "aria-label": "Board views" })
    tabs.append(h("ui-tabs-list", { "aria-label": "Board views" }, config.tabs.map(tab => {
      const item = h("ui-tabs-tab", { value: tab.id })
      item.append(h("button", { type: "button" }, [tab.label]))
      return item
    })))
    for (const tab of config.tabs) {
      const zone = h("div", { class: "board-grid" })
      for (const panel of config.panels) if ((panel.tab ?? config.tabs![0]!.id) === tab.id) zone.append(sections[panel.id]!)
      tabs.append(h("ui-tabs-panel", { value: tab.id }, [zone]))
    }
    setProperty(tabs, "value", state.tab ?? config.tabs[0]!.id)
    tabs.addEventListener("valuechange", event => {
      if (syncing) return
      commit({ ...state, tab: String((event as CustomEvent).detail?.value ?? "") })
    })
    controls["__tabs"] = tabs
    // The tabs take the grid's place (not one of its cells): each tab's own panel holds a grid.
    grid.replaceWith(tabs)
  } else {
    for (const panel of config.panels) grid.append(sections[panel.id]!)
  }

  // -------------------------------------------------------------------------------------------------------------
  // Rendering.

  const appliedFilters = () => config.filters.map(filter => ({ filter: { id: filter.id, field: filter.field, control: filter.control, ...(filter.dataset !== undefined ? { dataset: filter.dataset } : {}) }, value: state.filters[filter.id] }))

  function recompute() {
    const applied = appliedFilters()
    const next: Record<string, Row[]> = {}
    for (const name of Object.keys(datasets)) next[name] = filterRows(datasets[name] ?? [], applied, name)
    filtered = next
    kpiViews = {}
    for (const kpi of config.kpis) {
      const rows = filtered[kpi.dataset] ?? []
      const value = aggregateRows(rows, kpi.aggregate, kpi.field)
      kpiViews[kpi.id] = { value, display: formatValue(value, kpi, locale) }
      if (kpi.sparkline) sparkViews[kpi.id] = sparkPoints(rows, kpi.sparkline.x, kpi.sparkline.y, kpi.sparkline.aggregate ?? "sum")
    }
  }

  function apply() {
    recompute()
    syncing = true
    for (const filter of config.filters) {
      const control = controls[filter.id]
      const value = state.filters[filter.id]
      if (!control) continue
      if (filter.control === "search") (control as HTMLInputElement).value = typeof value === "string" ? value : ""
      else if (filter.control === "chips") setProperty(control, "value", Array.isArray(value) ? value : [])
      else if (filter.control === "range") setProperty(control, "value", numeric(value) ?? filter.max ?? 0)
      else if (filter.control === "select") setProperty(control, "value", typeof value === "string" && value !== "" ? value : null)
      else setProperty(control, "value", typeof value === "string" ? value : "")
    }
    if (controls["__tabs"] && state.tab !== null) setProperty(controls["__tabs"]!, "value", state.tab)
    syncing = false

    for (const kpi of config.kpis) {
      const view = kpiViews[kpi.id] ?? { value: 0, display: "0" }
      const valueEl = valueElements[kpi.id]
      if (valueEl) valueEl.textContent = view.display
      const spark = sparkElements[kpi.id]
      if (spark) {
        const points = sparkViews[kpi.id]?.points ?? []
        spark.replaceChildren()
        if (points.length > 1) {
          const values = points.map(point => point[1])
          const min = Math.min(...values)
          const span = Math.max(...values) - min || 1
          const path = document.createElementNS("http://www.w3.org/2000/svg", "path")
          path.setAttribute("d", points.map((point, index) => `${index === 0 ? "M" : "L"}${((index / (points.length - 1)) * 100).toFixed(2)} ${(26 - ((point[1] - min) / span) * 24).toFixed(2)}`).join(" "))
          path.setAttribute("fill", "none")
          path.setAttribute("stroke", "currentColor")
          path.setAttribute("stroke-width", "1.5")
          path.setAttribute("stroke-linejoin", "round")
          path.setAttribute("stroke-linecap", "round")
          path.setAttribute("vector-effect", "non-scaling-stroke")
          spark.append(path)
        }
      }
    }

    const shown = Object.values(filtered).reduce((sum, rows) => sum + rows.length, 0)
    const sampled = config.sampled ? Object.values(config.sampled).reduce((sum, n) => sum + n, 0) : totalRows
    const note = sampled < totalRows ? ` (the page carries the first ${sampled.toLocaleString(locale.id)} of ${totalRows.toLocaleString(locale.id)} rows)` : ""
    setStatus(status === "ready" ? "ready" : "initializing", `Showing ${shown.toLocaleString(locale.id)} of ${sampled.toLocaleString(locale.id)} rows${note}.`, "polite")
    summary.textContent = config.filters.length ? config.filters.map(filter => `${filter.label}: ${filterText(filter, state.filters[filter.id])}`).join(" · ") : ""
    themeButton.textContent = state.theme === "dark" ? "Light" : "Dark"
    undoButton.toggleAttribute("disabled", !stack.canUndo())
    redoButton.toggleAttribute("disabled", !stack.canRedo())
    renderPanels().catch(error => { announce(`The live view could not update: ${error instanceof Error ? error.message : String(error)}`); })
  }

  function filterText(filter: BoardFilterConfig, value: unknown): string {
    if (filter.control === "chips") {
      const chosen = Array.isArray(value) ? value.map(String) : []
      return chosen.length === 0 ? "All" : chosen.length > 3 ? `${chosen.slice(0, 3).join(", ")} +${chosen.length - 3}` : chosen.join(", ")
    }
    if (filter.control === "range") return numeric(value) === undefined ? "Any" : `≤ ${formatValue(numeric(value)!, { format: "compact" }, locale)}`
    if (filter.control === "search") return String(value ?? "").trim() === "" ? "Any" : `“${String(value).trim()}”`
    return String(value ?? "") === "" || String(value) === "all" ? "All" : String(value)
  }

  async function renderPanels() {
    const token = ++renderToken
    await Promise.all(config.panels.map(async panel => {
      const rows = panelRows(panel)
      if (token !== renderToken) return
      if (panel.kind === "table") { renderTable(panel, rows); return }
      const host = panelHosts[panel.id]
      if (!host) return
      if (panel.kind === "echarts") {
        const echarts = globalScope.echarts
        if (!echarts) throw new Error("The ECharts runtime is not available.")
        const option = fillRows(panel.spec ?? {}, rows) as Json
        formatEChartsAxes(option)
        if (liveEchartsTheme) echarts.registerTheme("board", liveEchartsTheme)
        if (!charts[panel.id]) {
          host.replaceChildren()
          const target = h("div")
          target.style.width = "100%"
          target.style.height = `${panel.bodyHeight}px`
          host.append(target)
          const chart = echarts.init(target, liveEchartsTheme ? "board" : null, { renderer: "svg" })
          chart.on("click", params => showDetail(params.data ?? { name: params.name }))
          charts[panel.id] = chart
        }
        charts[panel.id]!.setOption(option, { notMerge: true })
        return
      }
      const built = vegaView(fillRows(panel.spec ?? {}, rows))
      if (!built) throw new Error("The Vega runtime is not available.")
      const old = views[panel.id]
      if (old) old.finalize()
      views[panel.id] = built.view
      host.replaceChildren()
      built.view.addEventListener("click", (_event, item) => { if (item?.datum) showDetail(item.datum) })
      await built.view.initialize(host).runAsync()
      // The compiled spec's colours were baked at build time; a palette swap rewrites the drawn ones in place.
      recolourSvg(host, paletteMap(sourceTheme, liveTheme))
    }))
  }

  /** ECharts' own formatters are functions, which a JSON spec cannot carry: the page adds the same ones the poster used. */
  function formatEChartsAxes(option: Json) {
    const spec = compactSpec(config.locale.number.currency as [string, string], config.locale.number.decimal)
    const format = (value: number) => (Math.abs(value) >= 10000 ? compactFormat(value, spec) : Number(value).toLocaleString(config.locale.id))
    for (const key of ["xAxis", "yAxis", "radiusAxis", "singleAxis"]) {
      const axes = option[key]
      for (const axis of Array.isArray(axes) ? axes : axes && typeof axes === "object" ? [axes] : []) {
        if (!axis || typeof axis !== "object") continue
        const record = axis as Json
        const label = record.axisLabel && typeof record.axisLabel === "object" ? (record.axisLabel as Json) : {}
        if ((record.type === "value" || record.type === "log") && label.formatter === undefined) record.axisLabel = { ...label, formatter: format }
      }
    }
    if (!option.tooltip) option.tooltip = { trigger: (Array.isArray(option.series) ? option.series : []).some(series => series && typeof series === "object" && ["line", "bar", "area"].includes(String((series as Json).type))) ? "axis" : "item", confine: true }
  }

  function renderTable(panel: BoardPanelConfig, rows: readonly Row[]) {
    const host = panelHosts[panel.id]
    if (!host) return
    const columns = panel.columns && panel.columns.length ? panel.columns : deriveColumns(rows)
    const sort = tableSort[panel.id]
    const ordered = sort ? [...rows].sort((a, b) => compareCells(a[sort.field], b[sort.field]) * sort.direction) : [...rows]
    const limited = ordered.slice(0, panel.limit ?? 50)
    let entry = tableBodies[panel.id]
    if (!entry) {
      host.replaceChildren()
      const tools = h("div", { class: "board-table-tools" })
      const count = h("span", { "data-table-count": "" })
      const copy = h("button", { type: "button", class: "board-button", "data-copy": "" }, ["Copy TSV"])
      tools.append(count, copy)
      const table = h("table", { class: "board-table", tabindex: "0", "aria-label": `${panel.title} table` })
      const caption = h("caption", { class: "board-sr" })
      const head = h("thead")
      const body = h("tbody")
      table.append(caption, head, body)
      host.append(tools, table)
      entry = { table, body, caption }
      tableBodies[panel.id] = entry
      const headRow = h("tr")
      for (const column of columns) {
        const th = h("th", { scope: "col", "data-field": column.field, "data-align": column.align })
        th.append(h("button", { type: "button", class: "board-button", style: "border:0;background:none;padding:0;font:inherit;color:inherit" }, [column.label]))
        th.addEventListener("click", () => {
          const current = tableSort[panel.id]
          tableSort[panel.id] = { field: column.field, direction: current && current.field === column.field && current.direction === 1 ? -1 : 1 }
          renderTable(panel, panelRows(panel))
        })
        headRow.append(th)
      }
      table.tHead!.append(headRow)
      copy.addEventListener("click", () => copyTable(panel, columns, limited))
      table.addEventListener("keydown", event => moveCell(table, event as KeyboardEvent))
    }
    entry.caption.textContent = `${panel.title}: ${limited.length} of ${rows.length} rows shown${sort ? `, sorted by ${columns.find(column => column.field === sort.field)?.label ?? sort.field} ${sort.direction === 1 ? "ascending" : "descending"}` : ""}.`
    for (const th of entry.table.tHead!.querySelectorAll("th")) {
      const field = (th as HTMLElement).dataset.field
      th.setAttribute("aria-sort", sort && sort.field === field ? (sort.direction === 1 ? "ascending" : "descending") : "none")
    }
    entry.body.replaceChildren()
    if (limited.length === 0) {
      const row = h("tr")
      const cell = h("td", { colspan: String(columns.length), class: "board-empty" }, ["No rows pass the filters."])
      row.append(cell)
      entry.body.append(row)
    }
    limited.forEach((row, index) => {
      const tr = h("tr", { "data-index": String(index) })
      columns.forEach((column, columnIndex) => {
        const value = row[column.field]
        const cell = h("td", { "data-align": column.align, "data-r": String(index), "data-c": String(columnIndex), tabindex: index === 0 && columnIndex === 0 ? "0" : "-1" })
        cell.textContent = formatCell(value, column.format, locale)
        tr.append(cell)
      })
      tr.addEventListener("click", () => showDetail(row))
      entry.body.append(tr)
    })
    const count = host.querySelector("[data-table-count]")
    if (count) count.textContent = `${limited.length} of ${rows.length} rows`
  }

  function deriveColumns(rows: readonly Row[]): BoardTableCellConfig[] {
    const first = rows[0] ?? {}
    return Object.keys(first).slice(0, 8).map(field => ({ field, label: field, align: typeof first[field] === "number" ? "right" as const : "left" as const }))
  }

  const compareCells = (a: unknown, b: unknown): number => {
    const na = numeric(a)
    const nb = numeric(b)
    if (na !== undefined && nb !== undefined) return na - nb
    return String(a ?? "").localeCompare(String(b ?? ""), "en")
  }

  function moveCell(table: HTMLTableElement, event: KeyboardEvent) {
    const target = event.target as HTMLElement
    if (target.tagName !== "TD") return
    const row = Number(target.dataset.r ?? 0)
    const column = Number(target.dataset.c ?? 0)
    const rows = table.tBodies[0]?.rows.length ?? 0
    const columns = table.tHead?.rows[0]?.cells.length ?? 0
    let nextRow = row
    let nextColumn = column
    if (event.key === "ArrowDown") nextRow = Math.min(rows - 1, row + 1)
    else if (event.key === "ArrowUp") nextRow = Math.max(0, row - 1)
    else if (event.key === "ArrowRight") nextColumn = Math.min(columns - 1, column + 1)
    else if (event.key === "ArrowLeft") nextColumn = Math.max(0, column - 1)
    else if (event.key === "Home") nextColumn = 0
    else if (event.key === "End") nextColumn = columns - 1
    else return
    event.preventDefault()
    const next = table.querySelector<HTMLElement>(`td[data-r="${nextRow}"][data-c="${nextColumn}"]`)
    if (!next) return
    for (const cell of table.querySelectorAll<HTMLElement>("td[tabindex]")) cell.tabIndex = -1
    next.tabIndex = 0
    next.focus()
    const value = next.textContent ?? ""
    announce(`${value === "" ? "empty" : value}, row ${nextRow + 1} of ${rows}, column ${nextColumn + 1} of ${columns}.`)
  }

  async function copyTable(panel: BoardPanelConfig, columns: readonly BoardTableCellConfig[], rows: readonly Row[]) {
    const text = cellsToText([columns.map(column => column.label), ...rows.map(row => columns.map(column => formatCell(row[column.field], column.format, locale)))])
    try {
      await navigator.clipboard.writeText(text)
      announce(`${panel.title}: ${rows.length} rows copied as tab-separated text.`)
    } catch {
      const scratch = h("textarea", { "aria-label": "Copied text", style: "position:absolute;left:-9999px" })
      scratch.value = text
      document.body.append(scratch)
      scratch.select()
      announce(`${panel.title}: the table is selected as tab-separated text; press the copy shortcut.`)
      window.setTimeout(() => scratch.remove(), 3000)
    }
  }

  // -------------------------------------------------------------------------------------------------------------
  // Row detail: a dialog with the clicked datum's fields and, where a filter offers the value, a button that narrows to it.

  function showDetail(datum: Row) {
    detailDescription.textContent = "The values behind the mark you selected."
    detailBody.replaceChildren()
    const table = h("table", { class: "board-detail" })
    for (const [key, value] of Object.entries(datum)) {
      if (key.startsWith("__")) continue
      const row = h("tr")
      row.append(h("th", {}, [key]), h("td", {}, [formatCell(value, undefined, locale)]))
      table.append(row)
    }
    detailBody.append(table)
    const matching = config.filters.filter(filter => (filter.control === "segmented" || filter.control === "select" || filter.control === "chips") && filter.options.some(option => option.value === String(datum[filter.field] ?? "")))
    if (matching.length) {
      const actions = h("div", { style: "display:flex;flex-wrap:wrap;gap:6px;margin-top:10px" })
      for (const filter of matching) {
        const value = String(datum[filter.field] ?? "")
        const button = h("button", { type: "button", class: "board-button" }, [`Filter ${filter.label}: ${value}`])
        button.addEventListener("click", () => {
          void app.setFilter(filter.id, filter.control === "chips" ? [value] : value)
          setProperty(detail, "open", false)
        })
        actions.append(button)
      }
      detailBody.append(actions)
    }
    setProperty(detail, "open", true)
  }

  // -------------------------------------------------------------------------------------------------------------
  // State, undo and the actions.

  function commit(next: BoardState, group?: string) {
    state = next
    stack.record(next, group !== undefined ? { group } : undefined)
    apply()
  }

  function restore(next: BoardState | undefined) {
    if (!next) return state
    state = next
    apply()
    return state
  }

  // -------------------------------------------------------------------------------------------------------------
  // The host's theme: the CSS custom properties, the page's own surfaces, and every live chart, in place.

  /** The properties a host theme set inline on the root, so the board's own theme button can take them back. */
  const hostProperties = new Set<string>()
  let hostApplied = false

  /** An ECharts theme is fixed when its instance is made, so a new palette means a new instance in the same box. */
  function rethemeCharts(next: Json | undefined) {
    if (liveEchartsTheme === next) return
    liveEchartsTheme = next
    for (const chart of Object.values(charts)) { try { chart.dispose() } catch { /* already gone */ } }
    for (const id of Object.keys(charts)) delete charts[id]
  }

  /** The theme the live panels should draw with after the reader's own polarity choice. */
  function switchTheme(mode: "light" | "dark"): void {
    const next = boardTheme(mode)
    liveTheme = next
    rethemeCharts((next?.echartsTheme as Json | undefined) ?? config.echartsTheme)
  }

  function clearHostTheme(): boolean {
    if (!hostApplied) return false
    for (const name of hostProperties) html.style.removeProperty(name)
    hostProperties.clear()
    html.style.removeProperty("color-scheme")
    html.style.removeProperty("background")
    document.body.style.removeProperty("background")
    document.body.style.removeProperty("color")
    html.removeAttribute("data-theme")
    hostApplied = false
    rethemeCharts(config.echartsTheme)
    return true
  }

  function applyHostTheme(theme: BrowserTheme) {
    hostApplied = true
    for (const [name, value] of Object.entries(boardVariables(theme))) {
      html.style.setProperty(name, value)
      hostProperties.add(name)
    }
    html.style.colorScheme = theme.mode
    html.style.background = theme.colors.background
    document.body.style.background = theme.colors.background
    document.body.style.color = theme.colors.text
    html.setAttribute("data-theme", theme.mode)
    // The palette a filtered row is read on changed, not the filters: the state and the undo stack stay as they are.
    state = { ...state, theme: theme.mode }
    html.setAttribute("data-board-theme", theme.mode)
    themeButton.textContent = theme.mode === "dark" ? "Light" : "Dark"
    liveTheme = theme
    rethemeCharts(theme.echartsTheme as Json)
    apply()
  }

  function setHostTheme(input: unknown): BoardState {
    themeBridge.apply(input)
    return state
  }

  const themeBridge: ThemeBridgeHandle = installThemeBridge({
    ...(config.palettes?.[config.theme] ? { base: config.palettes[config.theme] } : {}),
    onChange: theme => applyHostTheme(theme),
  })

  function setTheme(theme: string): BoardState {
    const next: BoardState = { ...state, theme: theme === "dark" ? "dark" : "light" }
    state = next
    // A reader's own choice takes the page back from a host: the inline properties a host theme set are dropped, so
    // the built-in palettes rule again.
    const hadHost = clearHostTheme()
    html.setAttribute("data-board-theme", next.theme)
    themeButton.textContent = next.theme === "dark" ? "Light" : "Dark"
    announce(`${next.theme === "dark" ? "Dark" : "Light"} theme.`)
    // The chrome follows the CSS; the live panels are re-themed here, so the button is never only half a repaint.
    switchTheme(next.theme)
    if (hadHost || config.palettes) apply()
    return state
  }

  themeButton.addEventListener("click", () => { void setTheme(state.theme === "dark" ? "light" : "dark") })
  undoButton.addEventListener("click", () => { restore(stack.undo()) })
  redoButton.addEventListener("click", () => { restore(stack.redo()) })
  resetButton.addEventListener("click", () => {
    state = { ...state, filters: initialFilters, tab: initialTab }
    stack.record(state)
    apply()
    announce("Filters reset.")
  })
  const onResize = debounce(() => {
    for (const chart of Object.values(charts)) chart.resize()
    for (const view of Object.values(views)) view.resize()
  }, 150)
  window.addEventListener("resize", onResize)

  function debounce<A extends unknown[]>(fn: (...args: A) => void, wait: number) {
    let timer = 0
    return (...args: A) => { window.clearTimeout(timer); timer = window.setTimeout(() => fn(...args), wait) }
  }

  // -------------------------------------------------------------------------------------------------------------
  // The agent bridge: the @ui-sdk snapshot sees the components; the board snapshot adds the cube's own state.

  const snapshot = (options?: { readonly components?: boolean }): BoardSnapshot => {
    const shown = Object.values(filtered).reduce((sum, rows) => sum + rows.length, 0)
    return {
      version: 1,
      board: { title: config.title, theme: state.theme, tab: state.tab, status, rows: { shown, total: totalRows } },
      filters: config.filters.map(filter => ({ id: filter.id, label: filter.label, control: filter.control, value: state.filters[filter.id], active: filterText(filter, state.filters[filter.id]) !== "All" && filterText(filter, state.filters[filter.id]) !== "Any" })),
      kpis: config.kpis.map(kpi => ({ id: kpi.id, value: kpiViews[kpi.id]?.value ?? 0, display: kpiViews[kpi.id]?.display ?? "0" })),
      panels: config.panels.map(panel => ({ id: panel.id, kind: panel.kind, tab: panel.tab ?? null, rows: panelRows(panel).length })),
      undo: { canUndo: stack.canUndo(), canRedo: stack.canRedo(), entries: history.entries().length, position: history.position() },
      ...(lastChange ? { last: lastChange } : {}),
      ...(options?.components ? { components: agent.snapshot() } : {}),
    }
  }

  async function setFilter(id: string, value: unknown): Promise<BoardState> {
    const filter = config.filters.find(entry => entry.id === id)
    if (!filter) throw new Error(`There is no filter "${id}".`)
    const next = { ...state, filters: { ...state.filters, [filter.id]: normalise(filter, value) } }
    commit(next, filter.id)
    await ready.catch(() => undefined)
    return state
  }

  async function setTab(id: string): Promise<BoardState> {
    if (!config.tabs || !config.tabs.some(tab => tab.id === id)) throw new Error(`There is no tab "${id}".`)
    commit({ ...state, tab: id })
    return state
  }

  async function act(input: BoardStep | readonly BoardStep[]): Promise<unknown> {
    if (Array.isArray(input)) {
      const results: unknown[] = []
      for (const step of input) results.push(await act(step))
      return results
    }
    const step = input as BoardStep
    if ("steps" in step) return agent.act({ steps: step.steps as { ref: string; action: string; args?: unknown[] }[] })
    if ("ref" in step) return agent.act({ steps: [{ ref: step.ref, action: step.action, args: [...((step.args ?? []) as unknown[])] }] })
    if (step.action === "setFilter") return setFilter(step.id, step.value)
    if (step.action === "setTab") return setTab(step.id)
    if (step.action === "setTheme") return setTheme(String(step.value ?? step.id ?? (state.theme === "dark" ? "light" : "dark")))
    if (step.action === "undo") return restore(stack.undo())
    if (step.action === "redo") return restore(stack.redo())
    if (step.action === "reset") { resetButton.click(); return state }
    if (step.action === "announce") { announce(String(step.value ?? "")); return state }
    return agent.act({ steps: [step as { ref: string; action: string }] })
  }

  const app: BoardApp = {
    ready,
    snapshot,
    act,
    query: input => (typeof input === "string" ? agent.query({ text: input }) : agent.query(input as { text?: string; within?: string; kind?: string })),
    undo: () => restore(stack.undo()),
    redo: () => restore(stack.redo()),
    reset: () => { resetButton.click(); return state },
    getState: () => state,
    setFilter,
    setTab,
    setTheme,
    setHostTheme,
    destroy: () => {
      destroyed = true
      window.removeEventListener("resize", onResize)
      stopObserve()
      history.destroy()
      themeBridge.destroy()
      for (const view of Object.values(views)) view.finalize()
      for (const chart of Object.values(charts)) chart.dispose()
    },
  }

  // -------------------------------------------------------------------------------------------------------------
  // First paint: apply the initial filters, draw the panels, then swap the poster for the live dashboard.

  apply()
  renderPanels()
    .then(() => {
      if (destroyed) return
      staticEl.hidden = true
      liveEl.hidden = false
      setStatus("ready", `Dashboard ready. Showing ${Object.values(filtered).reduce((sum, rows) => sum + rows.length, 0).toLocaleString(locale.id)} of ${totalRows.toLocaleString(locale.id)} rows.`)
      resolveReady()
    })
    .catch(error => {
      staticEl.hidden = false
      liveEl.hidden = true
      setStatus("failed", "The interactive dashboard did not start; the static dashboard is shown.", "assertive")
      if (failureEl) failureEl.hidden = false
      rejectReady(error)
    })

  return app
}

// ---------------------------------------------------------------------------------------------------------------
// The page's public surface: the board controller, the behaviours it is built from, and the version of this bridge.

const api = {
  mountBoard,
  createAgent,
  observe,
  createHistory,
  createUndoStack,
  announce,
  createRovingFocus,
  createSelection,
  cellsToText,
  prepareAnnouncements,
  // The host-theme bridge, for a host that would rather call it than post a message.
  installThemeBridge,
  deriveBrowserTheme,
  boardVariables,
  version: 1,
}

;(globalThis as unknown as { ChartsUISdk?: typeof api }).ChartsUISdk = api

export { api as ChartsUISdk }
