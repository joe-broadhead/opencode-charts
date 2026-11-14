/**
 * The Web and Desktop half of the plugin: chart cards for the timeline, the actions a card offers, and the commands
 * that manage them.
 *
 * A card is built here as a small, self-contained SVG string. Nothing is fetched, embedded or linked: labels are
 * escaped, colours follow the light or dark appearance, and the same spec always produces the same markup. The
 * `CodeBlock` and `CodeBlockAction` registries below are declared by this plugin, so a host that publishes a
 * code-block surface can list them and any other contribution can read them with `ctx.list`.
 */
import { Command, Plugin, Registry, type SetupContext } from "@opencode/plugin/gui"
import h from "solid-js/h"
import type { JSX } from "solid-js"
import { ChartsThemeContract, extractDomThemeSeed, type ThemeHostDocument, type ThemeSeedResult, type ThemeSyncPayload } from "./theme-contract.js"
import { normalizeChart, parseChartFence, type TerminalChartInput, type TerminalChartSeries } from "./tui-chart.js"

/** The fence languages a chart card answers to. */
export const chartLanguages = ["chart", "charts-board"] as const

/** What a code block hands a renderer. */
export interface ChartCodeBlockInput {
  readonly code: string
  readonly language: string
}

/** One card for a fenced block. Returning undefined leaves the block to the host's own rendering. */
export interface ChartCodeBlock {
  readonly id: string
  readonly languages: readonly string[]
  readonly render: (input: ChartCodeBlockInput) => JSX.Element | undefined
}

/** One action a fenced block offers, such as copying its JSON. */
export interface ChartCodeBlockAction {
  readonly id: string
  readonly languages: readonly string[]
  readonly title: string
  readonly run: (input: ChartCodeBlockInput) => void | Promise<void>
}

/** The chart code-block surface, declared by this plugin. */
export const CodeBlock = Registry.define<ChartCodeBlock>("charts.codeBlock")
/** The actions a chart code block offers, declared by this plugin. */
export const CodeBlockAction = Registry.define<ChartCodeBlockAction>("charts.codeBlockAction")
/** The host's palette command registry, re-exported for the setup's test seam. */
export { Command }

/* ---------------------------------------------------------------------------------------------------- the SVG card */

type Mode = "light" | "dark"

interface Palette {
  readonly background: string
  readonly surface: string
  readonly text: string
  readonly muted: string
  readonly grid: string
  readonly series: readonly string[]
}

const PALETTES: Readonly<Record<Mode, Palette>> = {
  light: {
    background: "#ffffff",
    surface: "#f6f8fa",
    text: "#1f2328",
    muted: "#6e7781",
    grid: "#e6e8eb",
    series: ["#0969da", "#8250df", "#bc4c00", "#1a7f37", "#cf222e", "#9a6700"],
  },
  dark: {
    background: "#0d1117",
    surface: "#161b22",
    text: "#e6edf3",
    muted: "#8b949e",
    grid: "#21262d",
    series: ["#58a6ff", "#bc8cff", "#f0883e", "#3fb950", "#f85149", "#d29922"],
  },
}

const HEX_COLOR = /^#[0-9a-f]{6}$/i

/** One of the card's colours, when the host handed over a clean hex token. */
function hostColor(seed: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = seed?.[key]
  return typeof value === "string" && HEX_COLOR.test(value) ? value : undefined
}

/**
 * The card's palette: the built-in one, with every role the host theme names replaced by the host's own colour. A host
 * series shorter than the built-in one is cycled, so two brand colours still colour six bars.
 */
function paletteFor(mode: Mode, seed?: Record<string, unknown>): Palette {
  const base = PALETTES[mode]
  if (!seed) return base
  const host = Array.isArray(seed.series) ? seed.series.filter((color): color is string => typeof color === "string" && HEX_COLOR.test(color)) : []
  const series = host.length ? Array.from({ length: base.series.length }, (_, index) => host[index % host.length]!) : base.series
  return {
    background: hostColor(seed, "background") ?? base.background,
    surface: hostColor(seed, "surface") ?? base.surface,
    text: hostColor(seed, "text") ?? base.text,
    muted: hostColor(seed, "muted") ?? base.muted,
    grid: hostColor(seed, "border") ?? base.grid,
    series,
  }
}

const WIDTH = 640
const HEIGHT = 300
const LEFT = 150
const RIGHT = 616
const TOP = 78
const BOTTOM = 252
const FONT = "ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif"
const MONO = "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace"

const escapeXml = (value: string): string =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;")

const round = (value: number): number => Math.round(value * 100) / 100
const span = (value: number, minimum: number, maximum: number, from: number, to: number): number =>
  maximum === minimum ? (from + to) / 2 : from + ((value - minimum) / (maximum - minimum)) * (to - from)

const label = (x: number, y: number, content: string, options: { fill: string; size?: number; anchor?: "start" | "middle" | "end"; mono?: boolean; weight?: number }): string =>
  `<text x="${round(x)}" y="${round(y)}" fill="${options.fill}" font-family="${options.mono ? MONO : FONT}" font-size="${options.size ?? 12}"${
    options.anchor ? ` text-anchor="${options.anchor}"` : ""
  }${options.weight ? ` font-weight="${options.weight}"` : ""}>${escapeXml(content)}</text>`

const line = (x1: number, y1: number, x2: number, y2: number, color: string, width = 1, dash?: string): string =>
  `<line x1="${round(x1)}" y1="${round(y1)}" x2="${round(x2)}" y2="${round(y2)}" stroke="${color}" stroke-width="${width}"${
    dash ? ` stroke-dasharray="${dash}"` : ""
  }/>`

const rect = (x: number, y: number, width: number, height: number, fill: string, radius = 3, opacity?: number): string =>
  `<rect x="${round(x)}" y="${round(y)}" width="${round(Math.max(0, width))}" height="${round(Math.max(0, height))}" rx="${radius}" fill="${fill}"${
    opacity === undefined ? "" : ` fill-opacity="${opacity}"`
  }/>`

/** The card's frame, title and caption. */
function frame(model: { readonly title: string; readonly unit: string }, palette: Palette, description: string): string[] {
  const title = model.title || "Chart"
  return [
    `<rect x="0.5" y="0.5" width="${WIDTH - 1}" height="${HEIGHT - 1}" rx="12" fill="${palette.background}" stroke="${palette.grid}"/>`,
    label(24, 38, title, { fill: palette.text, size: 18, weight: 600 }),
    ...(model.unit ? [label(WIDTH - 24, 38, model.unit, { fill: palette.muted, size: 12, anchor: "end" })] : []),
    ...(description ? [label(24, 58, description, { fill: palette.muted, size: 11 })] : []),
  ]
}

function seriesColor(palette: Palette, index: number): string {
  return palette.series[index % palette.series.length]!
}

function barCard(series: readonly TerminalChartSeries[], palette: Palette, model: { readonly title: string; readonly unit: string }): string[] {
  const points = [...(series[0]?.points ?? [])].sort((left, right) => right.y - left.y).slice(0, 8)
  const maximum = points.reduce((most, point) => Math.max(most, Math.abs(point.y)), 0) || 1
  const rowHeight = Math.min(26, (BOTTOM - TOP) / Math.max(1, points.length))
  const bars: string[] = []
  points.forEach((point, index) => {
    const y = TOP + index * rowHeight
    const width = ((RIGHT - 70 - LEFT) * Math.abs(point.y)) / maximum
    bars.push(label(LEFT - 12, y + rowHeight * 0.68, point.x, { fill: palette.text, size: 12, anchor: "end" }))
    bars.push(rect(LEFT, y + 4, width, Math.max(6, rowHeight - 10), seriesColor(palette, index), 3))
    bars.push(label(RIGHT - 4, y + rowHeight * 0.68, String(point.y), { fill: palette.muted, size: 11, anchor: "end", mono: true }))
  })
  return [...frame(model, palette, `${points.length} categories`), ...bars]
}

function lineCard(series: readonly TerminalChartSeries[], palette: Palette, model: { readonly title: string; readonly unit: string }, area: boolean): string[] {
  const values = series.flatMap(entry => entry.points.map(point => point.y))
  const minimum = Math.min(...values)
  const maximum = Math.max(...values)
  const body: string[] = []
  for (let tick = 0; tick <= 2; tick++) {
    const value = minimum + ((maximum - minimum) * (2 - tick)) / 2
    const y = TOP + ((BOTTOM - TOP) * tick) / 2
    body.push(line(LEFT, y, RIGHT, y, palette.grid, 1))
    body.push(label(LEFT - 10, y + 4, String(round(value)), { fill: palette.muted, size: 11, anchor: "end", mono: true }))
  }
  series.forEach((entry, index) => {
    const color = seriesColor(palette, index)
    const count = entry.points.length
    const points = entry.points.map((point, position) => {
      const x = span(position, 0, Math.max(1, count - 1), LEFT, RIGHT)
      const y = span(point.y, minimum, maximum, BOTTOM, TOP)
      return `${round(x)},${round(y)}`
    })
    if (area && points.length) {
      body.push(`<path d="M ${LEFT},${BOTTOM} L ${points.join(" L ")} L ${RIGHT},${BOTTOM} Z" fill="${color}" fill-opacity="0.16" stroke="none"/>`)
    }
    if (points.length > 1) body.push(`<polyline points="${points.join(" ")}" fill="none" stroke="${color}" stroke-width="2.25" stroke-linejoin="round" stroke-linecap="round"/>`)
    const last = points[points.length - 1]
    if (last) {
      const [x, y] = last.split(",")
      body.push(`<circle cx="${x}" cy="${y}" r="3.2" fill="${color}"/>`)
    }
  })
  const legend: string[] = []
  series.slice(0, 5).forEach((entry, index) => {
    const x = LEFT + index * 118
    legend.push(`<circle cx="${x}" cy="${TOP - 16}" r="3.2" fill="${seriesColor(palette, index)}"/>`)
    legend.push(label(x + 9, TOP - 12, entry.name, { fill: palette.muted, size: 11 }))
  })
  const first = series[0]?.points[0]?.x ?? ""
  const last = series[0]?.points[series[0]!.points.length - 1]?.x ?? ""
  return [
    ...frame(model, palette, `${series.length} series`),
    ...body,
    ...legend,
    label(LEFT, BOTTOM + 24, first, { fill: palette.muted, size: 11 }),
    label(RIGHT, BOTTOM + 24, last, { fill: palette.muted, size: 11, anchor: "end" }),
  ]
}

function scatterCard(series: readonly TerminalChartSeries[], palette: Palette, model: { readonly title: string; readonly unit: string }): string[] {
  const values = series.flatMap(entry => entry.points.map(point => point.y))
  const minimum = Math.min(...values)
  const maximum = Math.max(...values)
  const body: string[] = [line(LEFT, BOTTOM, RIGHT, BOTTOM, palette.grid), line(LEFT, TOP, LEFT, BOTTOM, palette.grid)]
  series.forEach((entry, index) => {
    const count = entry.points.length
    entry.points.forEach((point, position) => {
      const x = span(position, 0, Math.max(1, count - 1), LEFT, RIGHT)
      const y = span(point.y, minimum, maximum, BOTTOM, TOP)
      body.push(`<circle cx="${round(x)}" cy="${round(y)}" r="2.8" fill="${seriesColor(palette, index)}" fill-opacity="0.85"/>`)
    })
  })
  return [...frame(model, palette, `${values.length} points`), ...body, label(LEFT, BOTTOM + 24, String(round(minimum)), { fill: palette.muted, size: 11 }), label(RIGHT, BOTTOM + 24, String(round(maximum)), { fill: palette.muted, size: 11, anchor: "end" })]
}

function arc(cx: number, cy: number, radius: number, from: number, to: number): string {
  const start = { x: cx + radius * Math.cos(from), y: cy + radius * Math.sin(from) }
  const end = { x: cx + radius * Math.cos(to), y: cy + radius * Math.sin(to) }
  const large = to - from > Math.PI ? 1 : 0
  return `M ${round(start.x)} ${round(start.y)} A ${radius} ${radius} 0 ${large} 1 ${round(end.x)} ${round(end.y)}`
}

/** Just the elliptical arc, for a slice that already starts at the centre. */
function sweepArc(cx: number, cy: number, radius: number, from: number, to: number): string {
  const end = { x: cx + radius * Math.cos(to), y: cy + radius * Math.sin(to) }
  const large = to - from > Math.PI ? 1 : 0
  return `A ${radius} ${radius} 0 ${large} 1 ${round(end.x)} ${round(end.y)}`
}

function pieCard(series: readonly TerminalChartSeries[], palette: Palette, model: { readonly title: string; readonly unit: string }, donut: boolean): string[] {
  const points = series[0]?.points ?? []
  const total = points.reduce((sum, point) => sum + Math.max(0, point.y), 0) || 1
  const cx = 210
  const cy = 166
  const radius = donut ? 82 : 92
  const body: string[] = []
  let angle = -Math.PI / 2
  points.forEach((point, index) => {
    const sweep = (Math.max(0, point.y) / total) * Math.PI * 2
    const color = seriesColor(palette, index)
    if (sweep > 0) {
      body.push(
        donut
          ? `<path d="${arc(cx, cy, radius, angle, angle + sweep)}" fill="none" stroke="${color}" stroke-width="30" stroke-linecap="butt"/>`
          : `<path d="M ${cx} ${cy} L ${round(cx + radius * Math.cos(angle))} ${round(cy + radius * Math.sin(angle))} ${sweepArc(cx, cy, radius, angle, angle + sweep)} Z" fill="${color}"/>`,
      )
    }
    angle += sweep
  })
  if (donut) body.push(label(cx, cy + 2, String(round(total)), { fill: palette.text, size: 22, anchor: "middle", weight: 600 }), label(cx, cy + 20, model.unit || "total", { fill: palette.muted, size: 11, anchor: "middle" }))
  points.slice(0, 6).forEach((point, index) => {
    const y = TOP + index * 26
    body.push(rect(390, y - 9, 10, 10, seriesColor(palette, index), 2))
    body.push(label(410, y, point.x, { fill: palette.text, size: 12 }))
    body.push(label(WIDTH - 24, y, `${Math.round((Math.max(0, point.y) / total) * 100)}%`, { fill: palette.muted, size: 12, anchor: "end", mono: true }))
  })
  return [...frame(model, palette, `${points.length} slices`), ...body]
}

function sparkCard(series: readonly TerminalChartSeries[], palette: Palette, model: { readonly title: string; readonly unit: string }): string[] {
  const values = series[0]?.points.map(point => point.y) ?? []
  const minimum = Math.min(...values)
  const maximum = Math.max(...values)
  const points = values.map((value, index) => {
    const x = span(index, 0, Math.max(1, values.length - 1), LEFT, RIGHT)
    const y = span(value, minimum, maximum, BOTTOM, TOP)
    return `${round(x)},${round(y)}`
  })
  const body = points.length > 1 ? [`<polyline points="${points.join(" ")}" fill="none" stroke="${seriesColor(palette, 0)}" stroke-width="2.5" stroke-linejoin="round"/>`] : []
  return [...frame(model, palette, `${values.length} points`), ...body, label(LEFT, BOTTOM + 24, `min ${round(minimum)}`, { fill: palette.muted, size: 11 }), label(RIGHT, BOTTOM + 24, `last ${round(values[values.length - 1] ?? 0)}`, { fill: palette.muted, size: 11, anchor: "end" })]
}

function kpiCard(series: readonly TerminalChartSeries[], palette: Palette, model: { readonly title: string; readonly unit: string }): string[] {
  const first = series[0]?.points[0]
  const value = first?.y ?? 0
  return [
    ...frame(model, palette, "Latest value"),
    label(WIDTH / 2, 176, first?.x ?? model.title, { fill: palette.muted, size: 13, anchor: "middle" }),
    label(WIDTH / 2, 226, String(round(value)), { fill: palette.text, size: 58, anchor: "middle", weight: 650 }),
    label(WIDTH / 2, 250, model.unit, { fill: palette.muted, size: 12, anchor: "middle" }),
  ]
}

function tableCard(columns: readonly string[], rows: readonly (readonly unknown[])[], palette: Palette, model: { readonly title: string; readonly unit: string }): string[] {
  const shown = rows.slice(0, 6)
  const columnWidth = (RIGHT - LEFT) / Math.max(1, columns.length)
  const body: string[] = []
  columns.forEach((column, index) => {
    body.push(label(LEFT + index * columnWidth, TOP, column, { fill: palette.muted, size: 11 }))
  })
  body.push(line(LEFT, TOP + 8, RIGHT, TOP + 8, palette.grid))
  shown.forEach((row, rowIndex) => {
    const y = TOP + 30 + rowIndex * 24
    row.forEach((cell, index) => {
      if (Array.isArray(cell)) {
        const values = cell.map(value => (typeof value === "number" ? value : Number(value) || 0))
        const minimum = Math.min(...values)
        const maximum = Math.max(...values)
        const points = values.map((value, position) => `${round(LEFT + index * columnWidth + (position / Math.max(1, values.length - 1)) * (columnWidth - 24))},${round(y - 4 - span(value, minimum, maximum, 0, 14))}`)
        if (points.length > 1) body.push(`<polyline points="${points.join(" ")}" fill="none" stroke="${seriesColor(palette, index)}" stroke-width="1.6"/>`)
        return
      }
      body.push(label(LEFT + index * columnWidth, y, String(cell ?? ""), { fill: palette.text, size: 12, mono: index > 0 }))
    })
  })
  return [...frame(model, palette, `${rows.length} rows`), ...body]
}

/** How a card is drawn: the mode, and the host theme's seed when one was read. */
export interface ChartCardOptions {
  readonly mode?: Mode
  readonly seed?: Record<string, unknown>
}

/**
 * The SVG for one normalized chart. Returns undefined when the spec carries nothing to draw, so a caller can fall back
 * to the plain fence. A seed replaces the colours the host theme names, so a card sits on the page around it.
 */
export function buildChartCardSvg(spec: TerminalChartInput, options: ChartCardOptions = {}): string | undefined {
  const palette = paletteFor(options.mode ?? "dark", options.seed)
  const model = normalizeChart(spec)
  const raw = typeof spec.type === "string" ? spec.type.toLowerCase() : ""
  const kpi = raw === "kpi" || raw === "metric"
  let body: string[] | undefined
  if (spec.columns?.length || model.type === "table") {
    if (!model.columns.length || !model.rows.length) return undefined
    body = tableCard(model.columns, model.rows, palette, model)
  } else if (kpi) {
    if (!model.series.length) return undefined
    body = kpiCard(model.series, palette, model)
  } else if (model.type === "pie" || model.type === "donut") {
    if (!model.series.length) return undefined
    body = pieCard(model.series, palette, model, model.type === "donut")
  } else if (model.type === "sparkline") {
    if (!model.series.length) return undefined
    body = sparkCard(model.series, palette, model)
  } else if (model.type === "scatter") {
    if (!model.series.length) return undefined
    body = scatterCard(model.series, palette, model)
  } else if (model.type === "line" || model.type === "multi_line" || model.type === "area") {
    if (!model.series.length) return undefined
    body = lineCard(model.series, palette, model, model.type === "area")
  } else {
    if (!model.series.length) return undefined
    body = barCard(model.series, palette, model)
  }
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${WIDTH} ${HEIGHT}" width="${WIDTH}" height="${HEIGHT}" role="img" aria-label="${escapeXml(model.title || "Chart")}">`,
    `<title>${escapeXml(model.title || "Chart")}</title>`,
    ...body,
    `</svg>`,
  ].join("")
}

/** What a code block becomes: the SVG, its kind and its title. */
export interface ChartCard {
  readonly svg: string
  readonly kind: string
  readonly title: string
}

/** A card for a fenced block, or undefined when its JSON is not a chart. */
export function buildChartCard(code: string, options: ChartCardOptions = {}): ChartCard | undefined {
  const spec = parseChartFence(code)
  if (!spec) return undefined
  const svg = buildChartCardSvg(spec, options)
  if (!svg) return undefined
  const model = normalizeChart(spec)
  const raw = typeof spec.type === "string" ? spec.type.toLowerCase() : ""
  const kind = raw === "kpi" || raw === "metric" ? "kpi" : model.type
  return { svg, kind, title: model.title || "Chart" }
}

/** The card as a node the host can mount. */
export function chartCardElement(card: ChartCard): JSX.Element {
  return h("div", { class: "charts-card", "data-charts-kind": card.kind, "data-charts-title": card.title, innerHTML: card.svg }) as unknown as JSX.Element
}

/* -------------------------------------------------------------------------------------------------- the live theme */

/** The revision each client last accepted, so the same theme is not posted twice to the same server. */
const pushedGuiThemes = new WeakMap<object, string>()

/** The host document, or undefined where there is none: the main process, a server render, a test. */
export function hostDocument(): ThemeHostDocument | undefined {
  try {
    return (globalThis as { document?: ThemeHostDocument }).document
  } catch {
    return undefined
  }
}

/** A seed from whatever the page currently shows; undefined when the document or its colours cannot be read. */
export function readGuiThemeSeed(doc: ThemeHostDocument | undefined, mode?: Mode): ThemeSeedResult | undefined {
  try {
    return extractDomThemeSeed(doc, mode)
  } catch {
    return undefined
  }
}

/**
 * Push the live page theme over `ChartsThemeContract`, so a chart rendered on the server matches the page. Best
 * effort by design: no document, an older server without the contract, or a refused call all resolve false, and one
 * revision is pushed once.
 */
export function syncGuiTheme(client: unknown, doc: ThemeHostDocument | undefined, mode?: Mode): Promise<boolean> {
  const seed = readGuiThemeSeed(doc, mode)
  if (!seed) return Promise.resolve(false)
  const key = typeof client === "object" && client !== null ? client : undefined
  if (key && pushedGuiThemes.get(key) === seed.revision) return Promise.resolve(false)
  const { revision } = seed
  const rpc = (client as { rpc?: (definition: unknown) => unknown } | undefined)?.rpc
  if (typeof rpc !== "function") return Promise.resolve(false)
  try {
    const bridge = rpc.call(client, ChartsThemeContract) as { sync?: (input: ThemeSyncPayload) => Promise<unknown> | undefined } | undefined
    if (!bridge || typeof bridge.sync !== "function") return Promise.resolve(false)
    const call = bridge.sync({ mode: seed.mode, theme: { seed: seed.seed }, revision })
    return Promise.resolve(call).then(
      (result) => {
        // Only a call the server says it applied is remembered: a refusal is retried on the next render.
        const answer = result as { readonly applied?: boolean; readonly ok?: boolean } | undefined
        if (answer?.applied !== true && answer?.ok !== true) return false
        if (key) pushedGuiThemes.set(key, revision)
        return true
      },
      () => false,
    )
  } catch {
    return Promise.resolve(false)
  }
}

/* ----------------------------------------------------------------------------------------------------- the plugin */

/** The host's live light/dark choice; dark when an older host does not publish one. */
function hostMode(ctx: SetupContext<{}>): Mode {
  try {
    const appearance = ctx.appearance as { mode?: () => unknown } | undefined
    const value = typeof appearance?.mode === "function" ? appearance.mode() : undefined
    return value === "light" ? "light" : "dark"
  } catch {
    return "dark"
  }
}

/**
 * The GUI setup: one code block that draws a card for a fence, one action that copies its JSON, and the palette
 * commands that report the surface and switch the card theme. Registration is defensive because the code-block
 * registries are this plugin's own: a host that has no such surface still gets the commands.
 */
export function setupGui(ctx: SetupContext<{}>): void {
  const [prefs, setPrefs] = ctx.storage.memory("charts.gui", { initial: { mode: hostMode(ctx) } })
  const mode = (): Mode => prefs.mode
  /** The page's own colours, read on every render so a card follows a live theme change. */
  const seed = (): Record<string, unknown> | undefined => readGuiThemeSeed(hostDocument(), mode())?.seed
  const add = (register: () => unknown): void => {
    try {
      register()
    } catch {
      // A surface the host does not publish is simply absent; the commands below still work.
    }
  }

  add(() =>
    ctx.add(CodeBlock, {
      id: "chart",
      languages: chartLanguages,
      render: ({ code }) => {
        const card = buildChartCard(code, { mode: mode(), seed: seed() })
        return card ? chartCardElement(card) : undefined
      },
    }),
  )
  add(() =>
    ctx.add(CodeBlockAction, {
      id: "copy-json",
      languages: chartLanguages,
      title: "Copy chart JSON",
      run: ({ code }) => ctx.system.copy(code),
    }),
  )

  ctx.add(Command, {
    id: "toggleTheme",
    title: "Charts: Toggle card theme",
    description: "Switch chart cards between the light and dark palette",
    group: "Charts",
    run: () => setPrefs(draft => {
      draft.mode = draft.mode === "dark" ? "light" : "dark"
    }),
  })
  ctx.add(Command, {
    id: "openStatus",
    title: "Charts: Card status",
    description: "The fence languages chart cards answer to",
    group: "Charts",
    run: () => {
      const languages = [...new Set(ctx.list(CodeBlock).flatMap(block => block.languages))]
      const blocks = ctx.list(CodeBlock).length
      ctx.toast.show({ title: "Charts", description: `${blocks} code block(s): ${languages.join(", ") || "none"}.` })
    },
  })

  // The cards follow the page; reporting the same seed keeps an artifact rendered on the server in step with it.
  try {
    void syncGuiTheme(ctx.client, hostDocument(), mode())
  } catch {
    // A host without the theme contract still draws cards; nothing here is required for setup to finish.
  }
}

export default Plugin.define({ setup: setupGui })
