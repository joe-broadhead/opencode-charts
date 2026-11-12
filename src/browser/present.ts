/// <reference lib="dom" />
/**
 * The live half of a recipe chart in interactive HTML, bundled into the Vega runtime: responsive reflow through the
 * shared layout planner, keyboard controls for the persistent selections, and a table of the values the tooltips show.
 *
 * Reflow re-plans at the measured width with the same planner the server used (measuring after the embedded fonts
 * loaded) and moves the one live view there by setting its width and the plan's signals: nothing is recompiled, so
 * selections, zoom and colours survive. One ResizeObserver, coalesced to one update per frame; a zero width (hidden)
 * is ignored until the chart is visible again. A width no candidate fits keeps the last valid view and says so.
 */
import { planLayout, type PlanSignals } from "../layout/planner.js"
import type { RuntimePresentation } from "../layout/present.js"

interface VegaView {
  width(w: number): VegaView
  signal(name: string, value: unknown): VegaView
  runAsync(): Promise<VegaView>
  scenegraph(): { root: SceneNode }
  getState(options: { signals?: (name: string) => boolean; data?: (name: string) => boolean; recurse?: boolean }): { signals?: Record<string, unknown> }
  addDataListener(name: string, handler: (name: string, value: unknown[]) => void): VegaView
  removeDataListener(name: string, handler: (name: string, value: unknown[]) => void): VegaView
  data(name: string): unknown[]
}
interface SceneNode { items?: SceneNode[]; tooltip?: unknown; mark?: { role?: string } }

const LEGEND_BINDING = /^charts_legend_.+_legend$/
const MIN_WIDTH = 20, MAX_WIDTH = 4000

export interface Attachment {
  /** After the live view replaced the static chart: start observing and enable the controls. */
  ready(): void
  /** Stops observing, removes every listener this attachment added, and hides the controls. */
  dispose(): void
  /** What is live: for the page's own checks and its tests. */
  stats(): { observers: number; listeners: number; width: number; candidate: number | null }
}

export function attach(view: VegaView, p: RuntimePresentation, doc: Document): Attachment {
  const root = doc.documentElement
  const host = doc.getElementById("chart")!
  const notice = doc.getElementById("chart-layout")
  const context = doc.createElement("canvas").getContext("2d")
  const measure = (text: string, size: number, bold?: boolean) => {
    if (!context) return text.length * size * 0.6
    context.font = `${bold ? p.font.titleWeight : 400} ${size}px ${JSON.stringify(p.font.family)}, sans-serif`
    return context.measureText(text).width
  }
  let width = p.width
  let candidate: number | null = null
  let observer: ResizeObserver | undefined
  let frame = 0
  let pending = 0
  const removers: (() => void)[] = []
  const listen = (el: EventTarget, type: string, fn: EventListener) => { el.addEventListener(type, fn); removers.push(() => el.removeEventListener(type, fn)) }

  /** Plans at `w` and applies it to the view; false (and the view untouched) when no candidate fits. */
  function apply(w: number): boolean {
    const outcome = planLayout({ ...p.planner, width: w }, measure)
    if (!outcome.ok) {
      root.setAttribute("data-chart-layout", "unsatisfiable")
      if (notice) {
        notice.hidden = false
        notice.textContent = `At ${w} px this chart cannot keep its labels readable (${outcome.conflicts[0]?.what ?? "no layout fits"}), so it stays at ${width} px.`
      }
      return false
    }
    view.width(w)
    for (const [name, value] of Object.entries(outcome.plan.signals) as [keyof PlanSignals, unknown][]) view.signal(name, value)
    width = w
    candidate = outcome.plan.candidate
    root.setAttribute("data-chart-layout", "fit")
    root.setAttribute("data-chart-width", String(w))
    root.setAttribute("data-chart-candidate", outcome.plan.name)
    if (notice) { notice.hidden = true; notice.textContent = "" }
    return true
  }

  const available = () => Math.min(MAX_WIDTH, Math.floor(host.clientWidth))

  // Before the first run: the live chart starts at the width it will be shown at.
  if (p.mode === "responsive") {
    const w = available()
    if (w >= MIN_WIDTH && w !== width) apply(w)
    else if (w >= MIN_WIDTH) root.setAttribute("data-chart-width", String(w))
  }

  function reflow() {
    frame = 0
    const w = Math.min(MAX_WIDTH, Math.floor(pending))
    if (w < MIN_WIDTH || w === width) return
    if (apply(w)) void view.runAsync()
  }

  function controls() {
    const bar = doc.getElementById("chart-controls")
    const c = p.controls
    if (!bar) return
    bar.hidden = false
    const fire = (type: string) => { window.dispatchEvent(new Event(type)) }
    const legend = c.legend
    let binding: string | undefined
    if (legend) binding = Object.keys(view.getState({ signals: name => LEGEND_BINDING.test(name), data: () => false, recurse: true }).signals ?? {})[0]
    // A series button sets the legend binding's signal; without that signal it could do nothing, so it is not shown
    // and the page says why (the legend itself and Clear highlight still work).
    if (legend && !binding) {
      for (const group of bar.querySelectorAll(".chart-group")) group.remove()
      root.setAttribute("data-chart-controls", "series-buttons-unavailable")
    }
    const buttons = [...bar.querySelectorAll<HTMLButtonElement>("button[data-series]")]
    const sync = (_: string, tuples: unknown[]) => {
      const picked = new Set(tuples.flatMap(t => ((t as { values?: unknown[] }).values ?? []).map(v => JSON.stringify(v))))
      for (const b of buttons) b.setAttribute("aria-pressed", String(picked.has(JSON.stringify(legend!.series[Number(b.dataset.series)]!.value))))
    }
    if (legend) {
      view.addDataListener(`${legend.param}_store`, sync)
      removers.push(() => view.removeDataListener(`${legend.param}_store`, sync), () => sync("", []))
      sync("", view.data(`${legend.param}_store`))
    }
    for (const b of buttons) listen(b, "click", () => {
      const series = legend!.series[Number(b.dataset.series)]!
      if (b.getAttribute("aria-pressed") === "true") fire(legend!.clear)
      else if (binding) void view.signal(binding, series.value).runAsync()
    })
    const actions: Record<string, () => void> = {
      "clear-legend": () => legend && fire(legend.clear),
      "clear-zoom": () => c.zoom && fire(c.zoom.clear),
      "clear-brush": () => c.brush && fire(c.brush.clear),
      "reset-all": () => { for (const k of ["legend", "zoom", "brush"] as const) { const x = c[k]; if (x) fire(x.clear) } },
    }
    for (const b of bar.querySelectorAll<HTMLButtonElement>("button[data-action]")) listen(b, "click", () => actions[b.dataset.action!]?.())
  }

  /** The values the tooltips show, one row per distinct mark tooltip, in drawing order. */
  function details() {
    const box = doc.getElementById("chart-details")
    const table = doc.getElementById("chart-table")
    if (!box || !table || !p.controls.details) return
    const rows: Record<string, unknown>[] = []
    const seen = new Set<string>()
    const walk = (node: SceneNode) => {
      const tip = node.tooltip
      if (tip !== undefined && tip !== null && tip !== "") {
        const row = typeof tip === "object" ? tip as Record<string, unknown> : { Value: tip }
        const key = JSON.stringify(row)
        if (!seen.has(key)) { seen.add(key); rows.push(row) }
      }
      for (const child of node.items ?? []) walk(child)
    }
    walk(view.scenegraph().root)
    if (!rows.length) return
    const columns: string[] = []
    for (const row of rows) for (const k of Object.keys(row)) if (!columns.includes(k)) columns.push(k)
    const t = doc.createElement("table")
    const head = t.createTHead().insertRow()
    for (const k of columns) { const th = doc.createElement("th"); th.scope = "col"; th.textContent = k; head.appendChild(th) }
    const body = t.createTBody()
    for (const row of rows) { const tr = body.insertRow(); for (const k of columns) tr.insertCell().textContent = row[k] === undefined ? "" : String(row[k]) }
    table.textContent = ""
    table.appendChild(t)
    box.hidden = false
  }

  return {
    ready() {
      controls()
      details()
      if (p.mode === "responsive" && typeof ResizeObserver === "function") {
        observer = new ResizeObserver(entries => {
          const entry = entries[entries.length - 1]
          pending = entry ? entry.contentRect.width : host.clientWidth
          if (!frame) frame = requestAnimationFrame(reflow)
        })
        observer.observe(host)
      }
    },
    dispose() {
      observer?.disconnect()
      observer = undefined
      if (frame) cancelAnimationFrame(frame)
      frame = 0
      while (removers.length) removers.pop()!()
      const bar = doc.getElementById("chart-controls")
      if (bar) bar.hidden = true
      const box = doc.getElementById("chart-details")
      if (box) box.hidden = true
    },
    stats: () => ({ observers: observer ? 1 : 0, listeners: removers.length, width, candidate }),
  }
}
