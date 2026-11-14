import { publish, type Artifact } from "../artifacts.js"
import { loadData } from "../data.js"
import { compileVegaLite } from "../engines/vegalite.js"
import type { Json } from "../engines/common.js"
import { ChartsError, type Issue } from "../errors.js"
import { bundledFonts, readCustomFonts, withCustomFonts, type FontBook, type FontResource } from "../fonts.js"
import { browserPalette, type BrowserPalette } from "../browser/theme-bridge.js"
import { browserRuntime, contentSecurityPolicy, scriptJson } from "../html.js"
import { resolveLocale } from "../locale.js"
import { slug } from "../paths.js"
import { svgToPng } from "../png.js"
import { renderChart, type Environment } from "../pipeline.js"
import { checkRenderedSvg } from "../safety.js"
import { accessible, cssFontStack, cssString, normaliseIds } from "../svg.js"
import { buildBoardCube, fieldTypes, formatCell, formatValue, type BoardCube, type BoardLocale, type FieldType, type Row } from "./cube.js"
import { parseBoardDocument, serialiseBoardDocument, type BoardDocument, type BoardFilter, type BoardKpi, type BoardPanel, type BoardTable } from "./schema.js"
import { echartsTheme } from "../themes/adapters.js"
import { resolveThemeAsked } from "../themes/chain.js"
import { BUILTIN_THEMES, type ThemeTokens } from "../themes/tokens.js"

/**
 * The board renderer: one `BoardDocumentV1` in, four files out.
 *
 * 1. `<name>.svg` — the static bento poster. Every chart panel is rendered by the chart pipeline at exactly its grid
 *    cell's size (and never written on its own), stripped of its outer `<svg>` element and placed with a translate, so
 *    the poster is one document: one set of fonts, one accessibility tree, one picture to check.
 * 2. `<name>.png` — that poster at 2× for a retina screen, which is what a chat shows inline.
 * 3. `<name>.board.html` — the offline dashboard. The poster is the page's first paint, so it is complete before any
 *    script runs; the inline `@ui-sdk` runtime then mounts the live filter bar, the cross-filtered KPIs, the live
 *    Vega/ECharts panels and the sortable tables, and exposes `window.chartsAgent`.
 * 4. `<name>.board.json` — the parsed document, so the board can be rendered again or edited by hand.
 *
 * Everything is offline and deterministic: the page's Content-Security-Policy lists the SHA-256 of each inline script
 * and nothing else, the fonts are data URLs, and no generated file names a path, a clock or a random value.
 */

const PAGE = 32
const GAP = 20
const CARD_RADIUS = 8
const HEADER_HEIGHT = 56
const KPI_HEIGHT = 96
const FOOTER_HEIGHT = 44

export interface BoardRenderOptions {
  /** The file stem; the title's slug by default. */
  readonly name?: string
  readonly outDir?: string
  /** The PNG scale (2 is the retina default). */
  readonly scale?: 1 | 2 | 3
}

export interface BoardRenderResult {
  readonly title: string
  readonly theme: string
  readonly width: number
  readonly height: number
  readonly files: { readonly svg?: string; readonly png?: string; readonly html?: string; readonly board?: string }
  readonly markdown?: string
  readonly summary: string
  readonly issues: readonly Issue[]
  readonly ms: number
  readonly svg: string
  readonly cube: BoardCube
  readonly panels: number
  readonly rows: number
}

const esc = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;")
const attr = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")
const px = (value: number) => String(Math.round(value * 100) / 100)
const isObject = (value: unknown): value is Json => !!value && typeof value === "object" && !Array.isArray(value)

/** The row marker a panel spec carries where its rows go: the page swaps it for the dataset's rows. */
export const BOARD_ROWS = "__boardRows"
const rowMarker = () => [{ [BOARD_ROWS]: true }]

/**
 * Where a chart's rows sit in its spec, replaced by a marker so the page carries them once (in the cube) rather than
 * once per panel: Vega data definitions with inline values, and an ECharts dataset's inline source.
 */
function blankRows(node: unknown, kind: "vega" | "echarts"): { spec: unknown; blanks: number } {
  const spec = structuredClone(node) as Json
  let blanks = 0
  if (kind === "vega") {
    for (const data of Array.isArray(spec.data) ? spec.data : []) {
      if (isObject(data) && Array.isArray(data.values)) {
        data.values = rowMarker()
        blanks += 1
      }
    }
  } else if (isObject(spec.dataset) && Array.isArray(spec.dataset.source)) {
    spec.dataset.source = rowMarker()
    blanks += 1
  }
  return { spec, blanks }
}

// ---------------------------------------------------------------------------------------------------------------
// Datasets and the locale.

async function loadDatasets(document: BoardDocument, env: Environment): Promise<Record<string, Row[]>> {
  const datasets: Record<string, Row[]> = {}
  for (const [name, input] of Object.entries(document.datasets)) {
    const loaded = await loadData(env.workspace, input)
    datasets[name] = loaded.rows
  }
  return datasets
}

const boardLocale = (locale: ReturnType<typeof resolveLocale>): BoardLocale => ({ ...(locale.id ? { id: locale.id } : {}), number: { decimal: locale.number.decimal, thousands: locale.number.thousands, grouping: locale.number.grouping, currency: [locale.number.currency[0], locale.number.currency[1]] } })

// ---------------------------------------------------------------------------------------------------------------
// Quick specs: a short description expanded into a Vega-Lite spec, with the column types read from the rows.

const MARK_OF: Readonly<Record<string, string>> = { bar: "bar", line: "line", area: "area", point: "point", scatter: "point", arc: "arc", pie: "arc", donut: "arc", heatmap: "rect", rect: "rect", tick: "tick" }

function fieldDef(field: string | undefined, types: Record<string, FieldType>, extra: Json = {}): Json | undefined {
  if (field === undefined || field === "") return undefined
  return { field, type: types[field] ?? "nominal", ...extra }
}

function quickSpec(panel: BoardPanel, rows: readonly Row[]): Json {
  if (panel.chart.kind === "table") throw new ChartsError("DOCUMENT_INVALID", `The table panel "${panel.id}" has no chart spec.`, "Give the panel a chart, not a table.", "/panels")
  const quick = panel.chart.quick
  if (!quick) throw new ChartsError("DOCUMENT_INVALID", `The panel "${panel.id}" has neither chart.spec nor chart.quick.`, "Describe the chart with quick, or give a spec.", "/panels")
  const types = fieldTypes(rows)
  const mark = MARK_OF[quick.type] ?? "bar"
  const aggregate = quick.aggregate
  const y = quick.y !== undefined ? (aggregate ? { field: quick.y, aggregate, type: "quantitative" } : fieldDef(quick.y, types)) : aggregate ? { aggregate, type: "quantitative" } : undefined
  const x = fieldDef(quick.x, types)
  const color = quick.color !== undefined ? fieldDef(quick.color, types) : undefined
  const size = quick.size !== undefined ? fieldDef(quick.size, types) : undefined
  const encoding: Json = {}
  if (mark === "arc") {
    encoding.theta = y ?? { aggregate: "count", type: "quantitative" }
    if (color ?? x) encoding.color = color ?? x
  } else if (mark === "rect") {
    if (x) encoding.x = x
    if (quick.y !== undefined) encoding.y = fieldDef(quick.y, types)
    if (color) encoding.color = { field: color.field, aggregate: aggregate ?? "sum", type: "quantitative" }
    else if (quick.y !== undefined) encoding.color = { field: quick.y, aggregate: aggregate ?? "sum", type: "quantitative" }
  } else {
    if (x) encoding.x = x
    if (y) encoding.y = y
    if (color) encoding.color = color
    if (size) encoding.size = size
  }
  if (quick.sort && mark === "bar" && encoding.x && isObject(encoding.x) && typeof encoding.x.field === "string" && (encoding.x.type === "nominal" || encoding.x.type === "ordinal") && encoding.y && isObject(encoding.y) && typeof encoding.y.aggregate === "string") {
    encoding.x = { ...encoding.x, sort: "-y" }
  }
  return { mark, encoding }
}

// ---------------------------------------------------------------------------------------------------------------
// Panel layout: the 12-column grid, packed left to right, a row as tall as its tallest panel.

interface Placement {
  readonly panel: BoardPanel
  readonly index: number
  x: number
  y: number
  width: number
  height: number
}

function placePanels(document: BoardDocument, innerWidth: number): { placements: Placement[]; height: number; columnWidth: number } {
  const columns = document.columns
  const columnWidth = (innerWidth - GAP * (columns - 1)) / columns
  const placements: Placement[] = document.panels.map((panel, index) => ({ panel, index, x: 0, y: 0, width: columnWidth * panel.span + GAP * (panel.span - 1), height: panel.height }))
  let y = 0
  let cursor = 0
  let rowHeight = 0
  let used = 0
  for (const place of placements) {
    const span = place.panel.span
    if (used > 0 && used + span > columns) {
      y += rowHeight + GAP
      cursor = 0
      used = 0
      rowHeight = 0
    }
    place.x = cursor
    place.y = y
    cursor += columnWidth * span + GAP * span
    used += span
    rowHeight = Math.max(rowHeight, place.height)
  }
  return { placements, height: placements.length ? y + rowHeight : 0, columnWidth }
}

// ---------------------------------------------------------------------------------------------------------------
// Poster drawing helpers.

interface Pen {
  readonly theme: ThemeTokens
  readonly fonts: FontBook
  readonly locale: BoardLocale
}
type TextOptions = { size?: number; weight?: number; fill?: string; anchor?: "start" | "middle" | "end"; family?: string; opacity?: number }

function text(pen: Pen, x: number, y: number, value: string, options: TextOptions = {}): string {
  const size = options.size ?? 12
  const weight = options.weight ?? 400
  const fill = options.fill ?? pen.theme.colors.text
  const anchor = options.anchor ? ` text-anchor="${options.anchor}"` : ""
  const opacity = options.opacity !== undefined ? ` opacity="${options.opacity}"` : ""
  return `<text x="${px(x)}" y="${px(y)}" font-family="${attr(options.family ?? pen.theme.font.family)}" font-size="${size}" font-weight="${weight}" fill="${fill}"${anchor}${opacity}>${esc(value)}</text>`
}

function fit(pen: Pen, value: string, maxWidth: number, size: number, weight = 400): string {
  if (pen.fonts.measure(value, size, pen.theme.font.family, weight) <= maxWidth) return value
  let cut = value
  while (cut.length > 1 && pen.fonts.measure(`${cut}…`, size, pen.theme.font.family, weight) > maxWidth) cut = cut.slice(0, -1)
  return `${cut}…`
}

function card(pen: Pen, x: number, y: number, width: number, height: number): string {
  return `<rect x="${px(x)}" y="${px(y)}" width="${px(width)}" height="${px(height)}" rx="${CARD_RADIUS}" fill="${pen.theme.colors.background}" stroke="${pen.theme.colors.grid}" stroke-width="1"/>`
}

/** The active value of a filter as words: All, the chips, the slider's top, or the search text. */
function filterText(filter: BoardFilter, value: unknown, locale: BoardLocale): string {
  if (filter.control === "chips") {
    const chosen = Array.isArray(value) ? value.map(String) : []
    if (chosen.length === 0) return "All"
    return chosen.length > 3 ? `${chosen.slice(0, 3).join(", ")} +${chosen.length - 3}` : chosen.join(", ")
  }
  if (filter.control === "range") return typeof value === "number" ? `≤ ${formatValue(value, { format: "compact" }, locale)}` : "Any"
  if (filter.control === "search") return typeof value === "string" && value.trim() !== "" ? `“${value.trim()}”` : "Any"
  return String(value ?? "") === "" || String(value) === "all" ? "All" : String(value)
}

// ---------------------------------------------------------------------------------------------------------------
// A table drawn as vectors: what the static poster shows and the page's table repeats with sort and copy.

function tableSpec(panel: BoardPanel, rows: readonly Row[]): { columns: { field: string; label: string; format?: string; align: "left" | "right" }[]; limit: number } {
  const table = panel.chart as BoardTable
  const first = rows[0] ?? {}
  const columns = table.columns?.map(column => ({
    field: column.field,
    label: column.label ?? column.field,
    ...(column.format !== undefined ? { format: column.format } : {}),
    align: column.align ?? (rows.slice(0, 20).every(row => row[column.field] === null || row[column.field] === undefined || typeof row[column.field] === "number") ? "right" as const : "left" as const),
  })) ?? Object.keys(first).slice(0, 8).map(field => ({ field, label: field, align: (typeof first[field] === "number" ? "right" : "left") as "left" | "right" }))
  return { columns, limit: table.limit ?? 10 }
}

function drawTable(pen: Pen, x: number, y: number, width: number, height: number, panel: BoardPanel, rows: readonly Row[]): string {
  const { columns, limit } = tableSpec(panel, rows)
  const c = pen.theme.colors
  const rowHeight = 24
  const headHeight = 24
  const all = rows.length <= limit
  const usable = Math.max(1, Math.floor((height - headHeight - 8 - (all ? 0 : 18)) / rowHeight))
  const shown = rows.slice(0, Math.min(limit, usable))
  const columnWidth = width / Math.max(1, columns.length)
  const parts: string[] = []
  columns.forEach((column, i) => {
    const left = x + i * columnWidth
    parts.push(text(pen, column.align === "right" ? left + columnWidth - 4 : left + 4, y + 15, fit(pen, column.label, columnWidth - 8, 10, 600), { size: 10, weight: 600, fill: c.muted, ...(column.align === "right" ? { anchor: "end" as const } : {}) }))
  })
  parts.push(`<line x1="${px(x)}" y1="${px(y + headHeight - 4)}" x2="${px(x + width)}" y2="${px(y + headHeight - 4)}" stroke="${c.grid}" stroke-width="1"/>`)
  shown.forEach((row, index) => {
    const top = y + headHeight + index * rowHeight
    if (index % 2 === 1) parts.push(`<rect x="${px(x)}" y="${px(top)}" width="${px(width)}" height="${rowHeight}" fill="${c.grid}" opacity="0.28"/>`)
    columns.forEach((column, i) => {
      const left = x + i * columnWidth
      const value = formatCell(row[column.field], column.format, pen.locale)
      const mono = /^-?[\d.,%$€£¥–]+$/.test(value)
      parts.push(text(pen, column.align === "right" ? left + columnWidth - 4 : left + 4, top + 16, fit(pen, value, columnWidth - 8, 11, mono ? 400 : 400), { size: 11, weight: 400, fill: c.text, ...(mono ? { family: pen.theme.font.mono } : {}), ...(column.align === "right" ? { anchor: "end" as const } : {}) }))
    })
  })
  if (rows.length > shown.length) parts.push(text(pen, x + width, y + headHeight + shown.length * rowHeight + 14, `${rows.length - shown.length} more`, { size: 10, fill: c.muted, anchor: "end" }))
  return parts.join("")
}

// ---------------------------------------------------------------------------------------------------------------
// KPI cards and their sparklines.

function sparkPath(points: readonly (readonly [number, number])[], x: number, y: number, width: number, height: number): string {
  if (points.length < 2) return ""
  const values = points.map(point => point[1])
  const min = Math.min(...values)
  const max = Math.max(...values)
  const span = max - min || 1
  return points.map((point, index) => {
    const px0 = x + (index / (points.length - 1)) * width
    const py0 = y + height - ((point[1] - min) / span) * height
    return `${index === 0 ? "M" : "L"}${px(px0)} ${px(py0)}`
  }).join(" ")
}

function drawKpi(pen: Pen, x: number, y: number, width: number, height: number, kpi: BoardKpi, view: { value: number; display: string }, spark: { points: readonly (readonly [number, number])[]; labels: readonly string[] } | undefined): string {
  const c = pen.theme.colors
  const parts: string[] = [card(pen, x, y, width, height)]
  const inner = width - 32
  const valueWidth = inner - (spark ? 96 : 0)
  const display = fit(pen, view.display, valueWidth, 28, 600)
  let labelWidth = inner
  if (kpi.delta) {
    const good = kpi.delta.positiveIsGood === false ? kpi.delta.value <= 0 : kpi.delta.value >= 0
    const tone = good ? c.positive : c.negative
    const label = `${kpi.delta.value >= 0 ? "+" : "−"}${Math.abs(kpi.delta.value).toFixed(1)}%${kpi.delta.label ? ` ${kpi.delta.label}` : ""}`
    const badgeWidth = pen.fonts.measure(label, 10, pen.theme.font.family, 600) + 16
    const badgeX = x + width - 16 - badgeWidth
    if (badgeX > x + 90) {
      parts.push(`<rect x="${px(badgeX)}" y="${px(y + 16)}" width="${px(badgeWidth)}" height="18" rx="9" fill="${tone}" opacity="0.14"/>`)
      parts.push(text(pen, badgeX + 8, y + 29, label, { size: 10, weight: 600, fill: tone }))
      labelWidth = badgeX - (x + 16) - 8
    }
  }
  parts.push(text(pen, x + 16, y + 30, fit(pen, kpi.label, labelWidth, 11, 500), { size: 11, weight: 500, fill: c.muted }))
  parts.push(text(pen, x + 16, y + 68, display, { size: 28, weight: 600, fill: c.text }))
  if (spark && spark.points.length > 1) {
    const boxWidth = 84
    const boxHeight = 26
    const boxX = x + width - boxWidth - 16
    const boxY = y + (height - boxHeight) / 2 + 6
    const path = sparkPath(spark.points, boxX, boxY, boxWidth, boxHeight)
    parts.push(`<path d="${path}" fill="none" stroke="${c.categorical[0] ?? c.highlight}" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round"/>`)
    const last = spark.points[spark.points.length - 1]!
    const values = spark.points.map(point => point[1])
    const min = Math.min(...values)
    const span = Math.max(...values) - min || 1
    parts.push(`<circle cx="${px(boxX + boxWidth)}" cy="${px(boxY + boxHeight - ((last[1] - min) / span) * boxHeight)}" r="2.4" fill="${c.categorical[0] ?? c.highlight}"/>`)
  }
  return parts.join("")
}

// ---------------------------------------------------------------------------------------------------------------
// One panel's chart, drawn by the chart pipeline at its cell size and embedded as a translated group.

interface DrawnPanel {
  readonly placement: Placement
  readonly fragment: string
  /** The prepared spec the poster drew from: the page compiles or embeds this one, never a second render. */
  readonly resolved?: Json
  readonly kind: "vega" | "echarts" | "table"
  readonly chart: { width: number; height: number }
}

async function drawChartPanel(pen: Pen, env: Environment, placement: Placement, rows: readonly Row[], fonts: readonly FontResource[], theme: ThemeTokens, locale: ReturnType<typeof resolveLocale>, document: BoardDocument): Promise<DrawnPanel> {
  const panel = placement.panel
  const headerHeight = panel.subtitle ? HEADER_HEIGHT + 14 : HEADER_HEIGHT - 8
  const chartWidth = Math.round(placement.width - 24)
  const chartHeight = Math.round(placement.height - headerHeight - 12)
  if (panel.chart.kind === "table") {
    return { placement, fragment: "", kind: "table", chart: { width: chartWidth, height: chartHeight } }
  }
  const engine = panel.chart.engine ?? "vega-lite"
  const spec = panel.chart.spec ?? quickSpec(panel, rows)
  const ownData = panel.chart.spec !== undefined && isObject(panel.chart.spec.data) && Array.isArray((panel.chart.spec.data as Json).values)
  const base = { spec, engine, themeTokens: theme, locale: document.locale ?? env.defaults.locale, ...(document.currency ? { currency: document.currency } : {}), description: panel.subtitle ?? panel.title, fontResources: fonts }
  const draw = (width: number, height: number) => renderChart(ownData ? { ...base, width, height } : { ...base, data: { rows: [...rows], name: panel.dataset }, width, height }, env, false)
  let width = chartWidth
  let height = chartHeight
  let result = await draw(width, height)
  // Vega-Lite sizes the plot, not the picture: axes, labels and padding sit outside it. Two corrections put the whole
  // picture in the cell, so a panel never spills into its neighbour; a spec with its own fixed size is clipped instead.
  for (let attempt = 0; attempt < 2 && !ownData; attempt += 1) {
    const overWidth = result.width - chartWidth
    const overHeight = result.height - chartHeight
    if (Math.abs(overWidth) <= 1 && Math.abs(overHeight) <= 1) break
    width = Math.max(60, width - overWidth)
    height = Math.max(60, height - overHeight)
    result = await draw(width, height)
  }
  return { placement, fragment: innerSvg(result.svg), resolved: result.resolvedSpec, kind: engine === "echarts" ? "echarts" : "vega", chart: { width: chartWidth, height: chartHeight } }
}

/** A rendered chart's content without its `<svg>` wrapper and its (now redundant) title and description. */
function innerSvg(svg: string): string {
  const match = /<svg\b[^>]*>([\s\S]*)<\/svg>\s*$/.exec(svg)
  let inner = match ? match[1]! : svg
  inner = inner.replace(/^\s*<title\b[^>]*>[\s\S]*?<\/title>\s*/i, "").replace(/^\s*<desc\b[^>]*>[\s\S]*?<\/desc>\s*/i, "")
  return inner.trim()
}

/** Renumbers a fragment's ids under a panel prefix, so two identical panels never share an id. */
function namespaceIds(fragment: string, prefix: string): string {
  const tokens = new Set<string>()
  for (const match of fragment.matchAll(/\sid="([^"]+)"/g)) tokens.add(match[1]!)
  if (tokens.size === 0) return fragment
  const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  const pattern = new RegExp(`(?<![\\w-])(${[...tokens].sort((a, b) => b.length - a.length).map(escape).join("|")})(?![\\w-])`, "g")
  const renamed = new Map([...tokens].map(token => [token, `${prefix}-${token}`]))
  return fragment.replace(pattern, token => renamed.get(token) ?? token)
}

// ---------------------------------------------------------------------------------------------------------------
// The page.

/** The packaged `@ui-sdk` dashboard runtime, verified against its build-time SHA-256 hash. */
function uiRuntime(packageRoot: string): string {
  return browserRuntime(packageRoot, "ui")
}

/** One of the chart engines' browser runtimes, inlined into the page exactly as the chart HTML inlines it. */
function chartRuntime(packageRoot: string, name: "vega" | "echarts"): string {
  return browserRuntime(packageRoot, name)
}

interface PanelConfig {
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
  readonly columns?: readonly { field: string; label: string; format?: string; align: "left" | "right" }[]
  readonly limit?: number
}

interface FilterConfig {
  readonly id: string
  readonly label: string
  readonly field: string
  readonly dataset?: string
  readonly control: BoardFilter["control"]
  readonly options: readonly { value: string; label: string }[]
  readonly value: unknown
  readonly min?: number
  readonly max?: number
  readonly step?: number
}

interface PageConfig {
  readonly title: string
  readonly subtitle?: string
  readonly kicker?: string
  readonly source?: string
  readonly width: number
  readonly columns: number
  readonly theme: "light" | "dark"
  readonly locale: { id: string; number: BoardLocale["number"] }
  readonly compactSpec: string
  readonly filters: readonly FilterConfig[]
  readonly kpis: readonly { id: string; label: string; dataset: string; field?: string; aggregate: BoardKpi["aggregate"]; format?: string; decimals?: number; prefix?: string; suffix?: string; delta?: BoardKpi["delta"]; sparkline?: BoardKpi["sparkline"] }[]
  readonly panels: readonly PanelConfig[]
  readonly tabs?: readonly { id: string; label: string }[]
  readonly datasets: Record<string, readonly Row[]>
  readonly totals: Record<string, number>
  /** Rows the page carries per dataset, when the client bundle is capped below the dataset's size. */
  readonly sampled: Record<string, number>
  /** Both polarities of the page's own palette, so the reader's light/dark toggle repaints the live panels too. */
  readonly palettes: { readonly light: BrowserPalette; readonly dark: BrowserPalette }
}

const BOARD_CSS = (theme: ThemeTokens): string => {
  const c = theme.colors
  return `
:root{--board-bg:${c.background};--board-surface:${c.background};--board-text:${c.text};--board-muted:${c.muted};--board-border:${c.grid};--board-axis:${c.axis};--board-accent:${c.categorical[0] ?? c.highlight};--board-positive:${c.positive};--board-negative:${c.negative};--board-radius:8px;--board-gap:${GAP}px;--ui-bg:${c.background};--ui-surface:${c.background};--ui-text:${c.text};--ui-muted:${c.muted};--ui-border:${c.grid};--ui-accent:${c.text};--ui-radius:6px;--board-chart-bg:${c.background}}
html[data-board-theme="dark"]{--board-bg:#0E1013;--board-surface:#16181D;--board-text:#E6E8EB;--board-muted:#A3AAB3;--board-border:#2A2F37;--board-axis:#596170;--board-accent:#56B4E9;--board-positive:#3DBE8B;--board-negative:#F2707A;--ui-bg:#0E1013;--ui-surface:#16181D;--ui-text:#E6E8EB;--ui-muted:#A3AAB3;--ui-border:#2A2F37;--ui-accent:#E6E8EB}
html[data-board-theme="light"]{--board-bg:${c.background};--board-surface:${c.background};--board-text:${c.text};--board-muted:${c.muted};--board-border:${c.grid};--board-axis:${c.axis};--board-accent:${c.categorical[0] ?? c.highlight};--board-positive:${c.positive};--board-negative:${c.negative};--ui-bg:${c.background};--ui-surface:${c.background};--ui-text:${c.text};--ui-muted:${c.muted};--ui-border:${c.grid};--ui-accent:${c.text}}
*{box-sizing:border-box}
html,body{margin:0;background:var(--board-bg);color:var(--board-text);font-family:${cssFontStack(theme.font.family, "sans-serif")}}
main{margin:0 auto;padding:${PAGE}px}
.board-sr{position:absolute;left:-9999px;width:1px;height:1px;overflow:hidden}
#board-failure{margin:12px 0 0;padding:10px 14px;border:1px solid var(--board-negative);border-radius:6px;font-size:13px}
#board-failure[hidden]{display:none}
#board-diagnostic{display:block;margin-top:4px;color:var(--board-muted);font-family:${cssFontStack(theme.font.mono, "monospace")};font-size:11px;white-space:pre-wrap;word-break:break-word}
#board-static>svg{max-width:100%;height:auto;display:block}
#board-live[hidden]{display:none}
.board-head{display:flex;flex-wrap:wrap;align-items:flex-end;justify-content:space-between;gap:16px;margin-bottom:16px}
.board-kicker{margin:0 0 4px;color:var(--board-muted);font-size:12px;font-weight:600;letter-spacing:.08em;text-transform:uppercase}
.board-title{margin:0;font-size:26px;line-height:1.15;font-weight:600;letter-spacing:-.01em}
.board-subtitle{margin:6px 0 0;color:var(--board-muted);font-size:13px}
.board-actions{display:flex;flex-wrap:wrap;align-items:center;gap:8px}
.board-button{font:inherit;font-size:12px;color:var(--ui-text);background:var(--ui-surface);border:1px solid var(--ui-border);border-radius:var(--ui-radius);padding:5px 10px;cursor:pointer}
.board-button:hover{border-color:var(--ui-accent)}
.board-button:focus-visible{outline:2px solid var(--ui-accent);outline-offset:2px}
.board-button[disabled]{opacity:.45;cursor:default}
ui-toolbar[data-board-filters]{display:flex;flex-wrap:wrap;align-items:flex-end;gap:14px;padding:12px 14px;border:1px solid var(--ui-border);border-radius:10px;background:var(--ui-surface);margin-bottom:16px}
.board-field{display:flex;flex-direction:column;gap:5px;min-width:130px}
.board-field>label,.board-field-label{font-size:11px;font-weight:600;color:var(--ui-muted);letter-spacing:.02em}
.board-field input[type="search"]{font:inherit;font-size:13px;color:var(--ui-text);background:var(--ui-surface);border:1px solid var(--ui-border);border-radius:var(--ui-radius);padding:5px 9px;min-width:180px}
.board-field input[type="search"]:focus-visible{outline:2px solid var(--ui-accent);outline-offset:1px}
ui-segmented-control{display:inline-flex;gap:2px;padding:2px;border:1px solid var(--ui-border);border-radius:8px;background:var(--ui-bg);position:relative}
ui-segmented-control-item{display:inline-block;padding:5px 10px;font-size:12px;border-radius:6px;cursor:pointer;position:relative;z-index:1;color:var(--ui-muted)}
ui-segmented-control-item[data-state="checked"],ui-segmented-control-item[aria-checked="true"]{color:var(--ui-text);font-weight:600}
ui-segmented-control-indicator{position:absolute;background:var(--ui-surface);border:1px solid var(--ui-border);border-radius:6px;box-shadow:0 1px 2px rgba(0,0,0,.06);z-index:0}
ui-toggle-group{display:inline-flex;flex-wrap:wrap;gap:6px}
ui-toggle{border:1px solid var(--ui-border);border-radius:999px;overflow:hidden}
ui-toggle button{font:inherit;font-size:12px;color:var(--ui-muted);background:var(--ui-surface);border:0;padding:4px 11px;cursor:pointer}
ui-toggle[data-state="pressed"]{border-color:var(--ui-accent);background:var(--ui-accent)}
ui-toggle[data-state="pressed"] button{color:var(--ui-bg);background:var(--ui-accent);font-weight:600}
ui-select{min-width:150px}
ui-select-trigger button{width:100%;display:flex;justify-content:space-between;gap:10px;font:inherit;font-size:13px;color:var(--ui-text);background:var(--ui-surface);border:1px solid var(--ui-border);border-radius:var(--ui-radius);padding:5px 9px;cursor:pointer}
ui-select-trigger button:focus-visible{outline:2px solid var(--ui-accent);outline-offset:1px}
ui-select-content{background:var(--ui-surface);border:1px solid var(--ui-border);border-radius:8px;padding:4px;box-shadow:0 10px 30px rgba(0,0,0,.12);min-width:150px}
ui-select-item{display:block;padding:6px 9px;border-radius:6px;font-size:13px;cursor:pointer}
ui-select-item[data-highlighted],ui-select-item:hover{background:var(--ui-bg)}
ui-slider{min-width:170px;display:block}
ui-slider-control{display:block;height:22px;position:relative;width:100%}
ui-slider-track{display:block;position:absolute;top:8px;left:0;right:0;height:6px;border-radius:999px;background:var(--ui-border)}
ui-slider-indicator{display:block;position:absolute;height:6px;border-radius:999px;background:var(--ui-accent)}
ui-slider-thumb{display:block;position:absolute;width:16px;height:16px;margin-left:-8px;top:3px;border-radius:50%;background:var(--ui-surface);border:2px solid var(--ui-accent);cursor:grab}
ui-slider-thumb:has(:focus-visible){outline:2px solid var(--ui-accent);outline-offset:2px}
ui-slider-value{font-size:12px;color:var(--ui-muted);font-variant-numeric:tabular-nums}
.board-summary{margin:0 0 12px;color:var(--board-muted);font-size:12px}
.board-kpis{display:grid;grid-template-columns:repeat(${Math.max(1, Math.min(6, 4))},minmax(0,1fr));gap:${GAP}px;margin-bottom:${GAP}px}
.board-kpi{border:1px solid var(--board-border);border-radius:var(--board-radius);padding:14px 16px;background:var(--board-surface);display:flex;flex-direction:column;gap:6px;min-height:96px}
.board-kpi-label{font-size:11px;font-weight:500;color:var(--board-muted)}
.board-kpi-row{display:flex;align-items:baseline;gap:8px;flex-wrap:wrap}
.board-kpi-value{font-size:28px;font-weight:600;letter-spacing:-.02em;font-variant-numeric:tabular-nums}
.board-kpi-delta{font-size:10px;font-weight:600;border-radius:999px;padding:2px 8px}
.board-kpi-delta[data-good="true"]{color:var(--board-positive);background:color-mix(in srgb,var(--board-positive) 14%,transparent)}
.board-kpi-delta[data-good="false"]{color:var(--board-negative);background:color-mix(in srgb,var(--board-negative) 14%,transparent)}
.board-kpi-spark{margin-top:auto;display:block;width:100%;max-width:132px;height:26px;align-self:flex-end}
.board-grid{display:grid;grid-template-columns:repeat(12,minmax(0,1fr));gap:${GAP}px}
.board-panel{border:1px solid var(--board-border);border-radius:var(--board-radius);background:var(--board-surface);display:flex;flex-direction:column;min-width:0;overflow:hidden}
.board-panel-head{padding:12px 16px 8px;display:flex;flex-direction:column;gap:2px}
.board-panel-title{margin:0;font-size:13px;font-weight:600;letter-spacing:-.01em}
.board-panel-subtitle{margin:0;color:var(--board-muted);font-size:11px}
.board-panel-body{padding:0 12px 12px;min-width:0;overflow:auto}
.board-panel-body[data-kind="vega"],.board-panel-body[data-kind="echarts"]{margin:0 12px 12px;padding:0;background:var(--board-chart-bg);border-radius:6px;overflow:hidden}
.board-panel-body svg{max-width:100%;height:auto;display:block}
.board-table{width:100%;border-collapse:collapse;font-size:12px}
.board-table caption{text-align:left;color:var(--board-muted);font-size:11px;padding:0 4px 6px}
.board-table th{position:sticky;top:0;background:var(--board-surface);text-align:left;font-size:10px;font-weight:600;color:var(--board-muted);border-bottom:1px solid var(--board-border);padding:4px 8px;cursor:pointer;white-space:nowrap}
.board-table th[aria-sort="ascending"],.board-table th[aria-sort="descending"]{color:var(--board-text)}
.board-table td{padding:4px 8px;border-bottom:1px solid var(--board-border);white-space:nowrap}
.board-table tr[data-index]{cursor:pointer}
.board-table tr[data-index]:hover td{background:color-mix(in srgb,var(--board-accent) 8%,transparent)}
.board-table td[data-align="right"],.board-table th[data-align="right"]{text-align:right;font-variant-numeric:tabular-nums}
.board-table:focus-visible,.board-table td:focus-visible{outline:2px solid var(--board-accent);outline-offset:-2px}
.board-table-tools{display:flex;justify-content:space-between;align-items:center;gap:8px;padding:2px 4px 6px;font-size:11px;color:var(--board-muted)}
.board-empty{padding:18px;color:var(--board-muted);font-size:12px}
.board-footer{display:flex;flex-wrap:wrap;justify-content:space-between;gap:8px;margin-top:${GAP}px;padding-top:12px;border-top:1px solid var(--board-border);color:var(--board-muted);font-size:11px}
ui-collapsible-panel{display:block;padding-top:6px}
ui-collapsible-trigger button{font:inherit;font-size:11px;color:var(--board-muted);background:none;border:0;padding:0;cursor:pointer;text-decoration:underline}
ui-tabs{display:block;width:100%}
ui-tabs-panel{display:block;width:100%}
ui-tabs-list{display:flex;gap:4px;margin-bottom:14px;border-bottom:1px solid var(--board-border)}
ui-tabs-tab button{font:inherit;font-size:13px;color:var(--board-muted);background:none;border:0;border-bottom:2px solid transparent;padding:7px 10px;cursor:pointer}
ui-tabs-tab[data-state="selected"] button,ui-tabs-tab[aria-selected="true"] button{color:var(--board-text);border-bottom-color:var(--board-accent);font-weight:600}
ui-dialog{display:contents}
ui-dialog-content{position:fixed;inset:0;margin:auto;width:min(560px,92vw);height:max-content;max-height:80vh;overflow:auto;z-index:60;background:var(--ui-surface);color:var(--ui-text);border:1px solid var(--ui-border);border-radius:10px;padding:18px 20px;box-shadow:0 24px 60px rgba(0,0,0,.28)}
ui-dialog-content[hidden]{display:none}
ui-dialog-content::backdrop{background:rgba(12,14,18,.42)}
ui-dialog-title{display:block;font-size:15px;font-weight:600;margin-bottom:4px}
ui-dialog-description{display:block;font-size:12px;color:var(--ui-muted);margin-bottom:10px}
ui-dialog-close button{font:inherit;font-size:12px;border:1px solid var(--ui-border);background:var(--ui-surface);color:var(--ui-text);border-radius:6px;padding:4px 10px;margin-top:12px;cursor:pointer}
.board-detail{width:100%;border-collapse:collapse;font-size:12px}
.board-detail th{text-align:left;color:var(--ui-muted);font-weight:600;padding:3px 10px 3px 0;white-space:nowrap;vertical-align:top}
.board-detail td{padding:3px 0;font-variant-numeric:tabular-nums;word-break:break-word}
`
}

function buildPage(input: {
  document: BoardDocument
  theme: ThemeTokens
  svg: string
  locale: ReturnType<typeof resolveLocale>
  config: PageConfig
  faces: string
  scripts: { ui: string; vega?: string; echarts?: string }
}): string {
  const { document, theme, svg, config, locale } = input
  if (!config.panels.length) throw new ChartsError("DOCUMENT_INVALID", "The board has no panels to show.", "Add at least one panel.", "/panels")
  const faces = input.faces
  const boot = `(function(){var root=document.documentElement,status=document.getElementById("board-status"),fail=document.getElementById("board-failure"),diag=document.getElementById("board-diagnostic");
function failed(error){var m=error&&error.message?error.message:String(error);root.setAttribute("data-board-status","failed");status.setAttribute("data-status","failed");status.textContent="The interactive dashboard did not start; the static dashboard is shown.";diag.textContent=m.slice(0,240);fail.hidden=false;}
try{var config=JSON.parse(document.getElementById("board-config").textContent);
if(!window.ChartsUISdk||typeof window.ChartsUISdk.mountBoard!=="function")throw new Error("The dashboard runtime is not available.");
var app=window.ChartsUISdk.mountBoard(config);
window.chartsAgent=app;window.chartsBoard=app;
app.ready.then(function(){},failed);}catch(error){failed(error)}})();`
  const scripts = [input.scripts.ui, ...(input.scripts.vega ? [input.scripts.vega] : []), ...(input.scripts.echarts ? [input.scripts.echarts] : []), boot]
  // The policy hashes the exact text the element carries, so escaping a `</script` inside a script keeps it signed.
  const escaped = scripts.map(script => script.replace(/<\/script/gi, "<\\/script"))
  return `<!doctype html>
<html lang="en" data-board-status="initializing" data-board-theme="${theme.mode}">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${contentSecurityPolicy(escaped)}">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(document.title)}</title>
<style>
${faces}
${BOARD_CSS(theme)}
main{max-width:${config.width}px}
.board-grid{grid-template-columns:repeat(${config.columns},minmax(0,1fr))!important}
.board-kpis{grid-template-columns:repeat(${Math.max(1, Math.min(config.kpis.length || 1, 6))},minmax(0,1fr))!important}
</style>
</head>
<body>
<main>
<div id="board-static">${svg}</div>
<div id="board-live" hidden></div>
<p id="board-status" class="board-sr" role="status" aria-live="polite" data-status="initializing">The static dashboard is shown; the interactive view is starting.</p>
<div id="board-failure" role="alert" hidden>The interactive dashboard could not start. The dashboard above is complete; filters and live charts are not available.<code id="board-diagnostic"></code></div>
</main>
<script type="application/json" id="board-config">${scriptJson({ ...config, ...(input.scripts.echarts ? { echartsTheme: echartsTheme(theme) } : {}), localeName: locale.id })}</script>
<script>${escaped[0]}</script>
${input.scripts.vega ? `<script>${escaped[1]}</script>` : ""}
${input.scripts.echarts ? `<script>${escaped[input.scripts.vega ? 2 : 1]}</script>` : ""}
<script>${escaped[escaped.length - 1]}</script>
</body>
</html>
`
}

// ---------------------------------------------------------------------------------------------------------------
// The renderer.

export async function renderBoard(input: unknown, env: Environment, write = true, options: BoardRenderOptions = {}): Promise<BoardRenderResult> {
  const started = performance.now()
  const document = parseBoardDocument(input)
  const issues: Issue[] = []

  // A board names a built-in or saved theme, or carries the theme itself: tokens, a seed, or light and dark variants.
  const theme = await resolveThemeAsked({ workspace: env.workspace, configured: env.configuredThemes }, (document.theme ?? env.defaults.theme) as never, env.assertFiles ? paths => env.assertFiles!("read", paths) : undefined)
  const locale = resolveLocale(env.packageRoot, document.locale ?? env.defaults.locale ?? "en-US", document.currency)
  const board = boardLocale(locale)
  let fonts: FontBook = bundledFonts(env.packageRoot)
  let custom: FontResource[] = []
  if (theme.font.files.length) {
    custom = await readCustomFonts(env.workspace, theme.font.files, env.assertFiles ? paths => env.assertFiles!("read", paths) : undefined)
    if (custom.length) fonts = withCustomFonts(fonts, custom)
  }
  if (!fonts.has(theme.font.family)) issues.push({ level: "warning", code: "FONT_NOT_BUNDLED", message: `The font "${theme.font.family}" is not available, so Inter is used.`, path: "/theme/font/family", fix: "Use Inter or JetBrains Mono, or add the font file with the theme's font.files." })

  const datasets = await loadDatasets(document, env)
  for (const name of Object.keys(document.datasets)) if (datasets[name]!.length === 0) issues.push({ level: "warning", code: "EMPTY_DATA", message: `The dataset "${name}" has no rows, so its panels are empty.`, path: `/datasets/${name}`, fix: "Check the file or rows the dataset names." })

  const cube = buildBoardCube({ datasets, filters: document.filters ?? [], kpis: document.kpis ?? [] }, board)
  const pen: Pen = { theme, fonts, locale: board }
  const innerWidth = document.width - PAGE * 2
  const { placements, height: gridHeight } = placePanels(document, innerWidth)

  // The chart panels, each drawn at its cell size by the chart pipeline and never written on its own.
  const drawn = await Promise.all(placements.map(async placement => {
    const rows = cube.filtered[placement.panel.dataset] ?? []
    try {
      return await drawChartPanel(pen, env, placement, rows, custom, theme, locale, document)
    } catch (error) {
      if (error instanceof ChartsError) throw new ChartsError(error.code, `Panel "${placement.panel.id}": ${error.detail}`, error.hint, `/panels/${placement.index}`)
      throw error
    }
  }))

  // The header block, filter pills, KPI row, then the grid.
  const headerHeight = (document.kicker ? 20 : 0) + 36 + (document.subtitle ? 22 : 0)
  const pills = (document.filters ?? []).map(filter => ({ filter, text: `${filter.label}: ${filterText(filter, cube.filters[filter.id], board)}` }))
  const pillsHeight = pills.length ? 34 : 0
  const kpiColumns = (document.kpis ?? []).length
  const kpiRows = kpiColumns ? Math.ceil(kpiColumns / Math.min(kpiColumns, 6)) : 0
  const kpisPerRow = kpiColumns ? Math.min(kpiColumns, 6) : 1
  const kpiColumnWidth = (innerWidth - GAP * (kpisPerRow - 1)) / kpisPerRow
  const kpisHeight = kpiRows ? kpiRows * KPI_HEIGHT + (kpiRows - 1) * GAP : 0
  const totalHeight = PAGE + headerHeight + (pillsHeight ? pillsHeight + GAP : 0) + (kpisHeight ? kpisHeight + GAP : 0) + gridHeight + (gridHeight ? GAP : 0) + FOOTER_HEIGHT + PAGE
  const c = theme.colors

  const parts: string[] = []
  parts.push(`<rect x="0" y="0" width="${document.width}" height="${px(totalHeight)}" fill="${c.background}"/>`)
  let y = PAGE
  if (document.kicker) {
    parts.push(text(pen, PAGE, y + 12, document.kicker.toUpperCase(), { size: 10, weight: 600, fill: c.muted }))
    y += 20
  }
  parts.push(text(pen, PAGE, y + 26, fit(pen, document.title, innerWidth, 26, 600), { size: 26, weight: 600, fill: c.text }))
  y += 36
  if (document.subtitle) {
    parts.push(text(pen, PAGE, y + 15, fit(pen, document.subtitle, innerWidth, 13), { size: 13, fill: c.muted }))
    y += 22
  }

  if (pills.length) {
    let x = PAGE
    for (const pill of pills) {
      const label = fit(pen, pill.text, innerWidth - (x - PAGE) - 60, 11)
      const width = pen.fonts.measure(label, 11, theme.font.family, 500) + 22
      if (x + width > PAGE + innerWidth) break
      parts.push(`<rect x="${px(x)}" y="${px(y + 2)}" width="${px(width)}" height="24" rx="12" fill="${c.grid}" opacity="0.45"/>`)
      parts.push(text(pen, x + 11, y + 17, label, { size: 11, weight: 500, fill: c.text }))
      x += width + 8
    }
    y += pillsHeight + GAP
  }

  if (kpiColumns) {
    ;(document.kpis ?? []).forEach((kpi, index) => {
      const column = index % kpisPerRow
      const row = Math.floor(index / kpisPerRow)
      const x = PAGE + column * (kpiColumnWidth + GAP)
      const top = y + row * (KPI_HEIGHT + GAP)
      const view = cube.kpis[kpi.id] ?? { value: 0, display: "0" }
      parts.push(drawKpi(pen, x, top, kpiColumnWidth, KPI_HEIGHT, kpi, view, cube.sparks[kpi.id]))
    })
    y += kpisHeight + GAP
  }

  for (const panel of drawn) {
    const place = panel.placement
    const x = PAGE + place.x
    const top = y + place.y
    const p = place.panel
    const header = p.subtitle ? HEADER_HEIGHT + 14 : HEADER_HEIGHT - 8
    parts.push(card(pen, x, top, place.width, place.height))
    parts.push(text(pen, x + 16, top + 26, fit(pen, p.title, place.width - 32, 13, 600), { size: 13, weight: 600, fill: c.text }))
    if (p.subtitle) parts.push(text(pen, x + 16, top + 43, fit(pen, p.subtitle, place.width - 32, 11), { size: 11, fill: c.muted }))
    parts.push(`<line x1="${px(x + 16)}" y1="${px(top + header - 8)}" x2="${px(x + place.width - 16)}" y2="${px(top + header - 8)}" stroke="${c.grid}" stroke-width="1"/>`)
    if (panel.kind === "table") {
      const rows = cube.filtered[p.dataset] ?? []
      const table = tableSpec(p, rows)
      parts.push(drawTable(pen, x + 16, top + header, place.width - 32, place.height - header - 16, p, rows.slice(0, table.limit + 6)))
    } else if (panel.fragment) {
      const fragment = namespaceIds(panel.fragment, p.id)
      const clip = `panel-clip-${place.index}`
      parts.push(`<defs><clipPath id="${clip}"><rect x="${px(x + 12)}" y="${px(top + header)}" width="${px(place.width - 24)}" height="${px(place.height - header - 12)}" rx="2"/></clipPath></defs>`)
      parts.push(`<g clip-path="url(#${clip})"><g transform="translate(${px(x + 12)}, ${px(top + header)})">${fragment}</g></g>`)
    }
  }
  y += gridHeight

  const footerY = y + (gridHeight ? GAP : 0) + 20
  if (document.source) parts.push(text(pen, PAGE, footerY, fit(pen, document.source, innerWidth * 0.6, 11), { size: 11, fill: c.muted }))
  const totalRows = Object.values(cube.rows).reduce((sum, n) => sum + n, 0)
  parts.push(text(pen, PAGE + innerWidth, footerY, `${document.panels.length} panels · ${totalRows.toLocaleString(locale.id)} rows`, { size: 11, fill: c.muted, anchor: "end" }))

  let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${document.width}" height="${px(totalHeight)}" viewBox="0 0 ${document.width} ${px(totalHeight)}">${parts.join("")}</svg>`
  checkRenderedSvg(svg)
  svg = normaliseIds(svg)
  const kpiSummary = (document.kpis ?? []).map(kpi => `${kpi.label} ${cube.kpis[kpi.id]?.display ?? "0"}`).join(", ")
  const description = `${document.title}${document.subtitle ? `: ${document.subtitle}` : ""}. A dashboard of ${document.panels.length} panels${kpiSummary ? ` and ${kpiSummary}` : ""}, from ${totalRows.toLocaleString(locale.id)} rows${document.source ? ` (${document.source})` : ""}.`
  svg = accessible(svg, document.title, description)

  const name = slug(options.name ?? document.title)
  const outDir = options.outDir ?? env.defaults.outDir
  const files: { svg?: string; png?: string; html?: string; board?: string } = {}
  let markdown: string | undefined

  if (write) {
    const artifacts: Artifact[] = []
    env.probe?.("svg")
    artifacts.push({ kind: "svg", file: `${name}.svg`, bytes: svg })

    env.probe?.("png")
    const scale = options.scale ?? 2
    const png = await svgToPng(env.packageRoot, svg, fonts, scale, fonts.has(theme.font.family) ? theme.font.family : "Inter")
    artifacts.push({ kind: "png", file: scale === 1 ? `${name}.png` : `${name}.png`, bytes: png.png })

    env.probe?.("html")
    const panels: PanelConfig[] = []
    const vegaPanels: string[] = []
    const echartsPanels: string[] = []
    await Promise.all(drawn.map(async panel => {
      const p = panel.placement.panel
      const base = {
        id: p.id,
        title: p.title,
        ...(p.subtitle !== undefined ? { subtitle: p.subtitle } : {}),
        dataset: p.dataset,
        ...(p.tab !== undefined ? { tab: p.tab } : {}),
        span: p.span,
        height: p.height,
        bodyHeight: panel.chart.height,
      }
      if (p.chart.kind === "table") {
        const rows = cube.client[p.dataset] ?? []
        const table = tableSpec(p, rows)
        panels.push({ ...base, kind: "table", columns: table.columns, limit: table.limit })
        return
      }
      const engine = p.chart.engine ?? "vega-lite"
      const ownData = p.chart.spec !== undefined && isObject(p.chart.spec.data) && Array.isArray((p.chart.spec.data as Json).values)
      const spec = p.chart.spec ?? quickSpec(p, cube.client[p.dataset] ?? [])
      if (ownData) {
        issues.push({ level: "warning", code: "DATA_TWICE", message: `The panel "${p.id}" carries its own data.values, so the board's filters do not narrow it.`, path: `/panels/${panel.placement.index}/chart/spec/data`, fix: "Remove the spec's data and let the panel read its dataset." })
        panels.push({ ...base, kind: engine === "echarts" ? "echarts" : "vega", spec })
        if (engine === "echarts") echartsPanels.push(p.id)
        else vegaPanels.push(p.id)
        return
      }
      if (engine === "echarts") {
        const option = structuredClone(panel.resolved ?? spec) as Json
        delete option.width
        delete option.height
        if (isObject(option.dataset) && Array.isArray(option.dataset.source)) option.dataset.source = rowMarker()
        else option.dataset = { source: rowMarker() }
        panels.push({ ...base, kind: "echarts", spec: option })
        echartsPanels.push(p.id)
        return
      }
      const prepared = panel.resolved ?? spec
      const compiled = engine === "vega-lite" ? compileVegaLite(prepared).vega : prepared
      panels.push({ ...base, kind: "vega", spec: blankRows(compiled, "vega").spec })
      vegaPanels.push(p.id)
    }))
    // Authored order, not the order the parallel renders finished in.
    panels.sort((left, right) => document.panels.findIndex(panel => panel.id === left.id) - document.panels.findIndex(panel => panel.id === right.id))

    const filters: FilterConfig[] = (document.filters ?? []).map(filter => {
      const domain = cube.domains[filter.id] ?? { min: 0, max: 1, step: 1 }
      return {
        id: filter.id,
        label: filter.label,
        field: filter.field,
        ...(filter.dataset !== undefined ? { dataset: filter.dataset } : {}),
        control: filter.control,
        options: cube.facets[filter.id] ?? [],
        value: cube.filters[filter.id],
        ...(filter.control === "range" ? { min: domain.min, max: domain.max, step: domain.step } : {}),
      }
    })
    const config: PageConfig = {
      title: document.title,
      ...(document.subtitle !== undefined ? { subtitle: document.subtitle } : {}),
      ...(document.kicker !== undefined ? { kicker: document.kicker } : {}),
      ...(document.source !== undefined ? { source: document.source } : {}),
      width: document.width,
      columns: document.columns,
      theme: theme.mode,
      locale: { id: locale.id, number: board.number },
      compactSpec: "",
      filters,
      kpis: (document.kpis ?? []).map(kpi => ({
        id: kpi.id,
        label: kpi.label,
        dataset: kpi.dataset,
        ...(kpi.field !== undefined ? { field: kpi.field } : {}),
        aggregate: kpi.aggregate,
        ...(kpi.format !== undefined ? { format: kpi.format } : {}),
        ...(kpi.decimals !== undefined ? { decimals: kpi.decimals } : {}),
        ...(kpi.prefix !== undefined ? { prefix: kpi.prefix } : {}),
        ...(kpi.suffix !== undefined ? { suffix: kpi.suffix } : {}),
        ...(kpi.delta !== undefined ? { delta: kpi.delta } : {}),
        ...(kpi.sparkline !== undefined ? { sparkline: kpi.sparkline } : {}),
      })),
      panels,
      ...(document.tabs !== undefined ? { tabs: document.tabs } : {}),
      datasets: cube.client as Record<string, readonly Row[]>,
      totals: { ...cube.rows },
      sampled: { ...cube.clientRows },
      // The board's own two chromes: the theme it was drawn with, and the built-in counterpart its theme button shows.
      palettes: {
        light: browserPalette(theme.mode === "light" ? theme : BUILTIN_THEMES.light!),
        dark: browserPalette(theme.mode === "dark" ? theme : BUILTIN_THEMES.dark!),
      },
    }
    const scripts = {
      ui: await uiRuntime(env.packageRoot),
      ...(vegaPanels.length ? { vega: chartRuntime(env.packageRoot, "vega") } : {}),
      ...(echartsPanels.length ? { echarts: chartRuntime(env.packageRoot, "echarts") } : {}),
    }
    const page = buildPage({
      document, theme, svg, locale, config,
      faces: fontFaceCssFor(fonts.resourcesFor(svg, [theme.font.family, theme.font.mono])),
      scripts,
    })
    artifacts.push({ kind: "html", file: `${name}.board.html`, bytes: page })

    env.probe?.("document")
    artifacts.push({ kind: "document", file: `${name}.board.json`, bytes: serialiseBoardDocument(document) })

    const written = publish(env.workspace, outDir, artifacts, file => env.probe?.("commit", file))
    artifacts.forEach((artifact, index) => {
      if (artifact.kind === "svg") files.svg = written[index]!
      else if (artifact.kind === "png") files.png = written[index]!
      else if (artifact.kind === "html") files.html = written[index]!
      else files.board = written[index]!
    })
    if (files.png) markdown = `![${document.title.replace(/[\[\]]/g, "")}](${files.png})`
  }

  return {
    title: document.title,
    theme: theme.name,
    width: document.width,
    height: Math.round(totalHeight),
    files,
    ...(markdown ? { markdown } : {}),
    summary: `${description} ${document.kpis?.length ?? 0} KPI cards, ${document.filters?.length ?? 0} filters.`,
    issues: [...issues].sort((left, right) => (left.path ?? "").localeCompare(right.path ?? "") || left.message.localeCompare(right.message)),
    ms: Math.round(performance.now() - started),
    svg,
    cube,
    panels: document.panels.length,
    rows: Object.values(cube.rows).reduce((sum, n) => sum + n, 0),
  }
}

/** `@font-face` rules for the faces the poster and the page name, block-loaded so the first paint never measures a fallback. */
function fontFaceCssFor(resources: readonly FontResource[]): string {
  return resources.map(resource => `@font-face{font-family:${cssString(resource.family)};font-weight:${resource.weight};font-display:block;src:url(data:${resource.web.mime};base64,${Buffer.from(resource.web.bytes).toString("base64")}) format("${resource.web.format}")}`).join("\n")
}
