import { createHash } from "node:crypto"
import * as z from "zod"
import { MONO, SANS } from "../constants.js"
import type { Row } from "../data.js"
import { ChartsError, pointer, type Issue } from "../errors.js"
import { parseFontStack, type FontBook } from "../fonts.js"
import type { ResolvedLocale } from "../locale.js"
import { accessible, cssString } from "../svg.js"
import { parseColor } from "../themes/contrast.js"
import { inkOn } from "../themes/palette.js"
import type { ThemeTokens } from "../themes/tokens.js"

/**
 * Publication data-graphic tables: a Great-Tables-style renderer that draws a whole table as one measured SVG (so it
 * rasterises as sharply as a chart) and, from the same layout, a self-contained semantic HTML table whose headers
 * sort, whose rows filter, and whose numbers copy out as TSV.
 *
 * The point of the engine is the nanoplot: a small inline mark in the cell (bar, sparkline, bullet, delta pill,
 * heatmap, badge) that carries the shape of the value beside the number itself, which is what makes a table a data
 * graphic rather than a grid. Every mark is placed with the bundled font tables, so column widths are exact and no
 * label clips; nothing is read from the network, the clock or the system fonts, so the same rows give the same bytes
 * on every host.
 */

// ---------------------------------------------------------------------------------------------------------------
// The spec. Strict: an unknown key is a mistake worth reporting, not something to silently ignore.

const ALIGN = z.enum(["left", "right", "center"])
const FORMAT = z.enum(["number", "currency", "percent", "compact", "integer", "text", "date"])
const CELL = z.enum(["text", "bar", "sparkline", "sparkarea", "sparkbar", "bullet", "delta", "badge", "heatmap", "dot"])
const OPERATION = z.enum(["sum", "mean", "median", "min", "max"])

export const TableColumnSchema = z.strictObject({
  /** The row key this column reads. */
  field: z.string().min(1).max(200),
  /** The header text; the field name when absent. */
  label: z.string().min(1).max(200).optional(),
  /** A grouped header above this one; consecutive columns with the same spanner share one rule. */
  spanner: z.string().min(1).max(200).optional(),
  align: ALIGN.optional(),
  format: FORMAT.optional(),
  /** Decimal places; the column's values decide the default. */
  decimals: z.number().int().min(0).max(6).optional(),
  /** A minimum column width in px; the measured content decides the rest. */
  width: z.number().min(20).max(1200).optional(),
  /** The inline mark drawn beside the value. */
  cell: CELL.optional(),
  /** `bullet` reads its target tick from this field of the same row. */
  targetField: z.string().min(1).max(200).optional(),
  /** The value range of a bar, bullet or heatmap; the column's own values when absent. */
  domain: z.tuple([z.number(), z.number()]).optional(),
  /**
   * `delta`: whether a rise is good news (true, the default) or bad news. A delta reads its value the way
   * `format: "percent"` does (0.142 is +14.2%), unless the column's format is "number" or "integer", which are
   * already percentage points.
   */
  positiveIsGood: z.boolean().optional(),
  /** `badge` and `dot`: the fill for a given value, such as {"Overdue": "#CC3344"}. */
  badgeColors: z.record(z.string().max(120), z.string().max(64)).optional(),
})

export const TableSpecSchema = z.strictObject({
  columns: z.array(TableColumnSchema).min(1).max(40),
  title: z.string().min(1).max(300).optional(),
  subtitle: z.string().min(1).max(300).optional(),
  /** A small line above the title, such as a section or a period. */
  kicker: z.string().min(1).max(120).optional(),
  /** The attribution line below the table. */
  source: z.string().min(1).max(300).optional(),
  notes: z.string().min(1).max(500).optional(),
  /** Splits the rows into labelled sections, in the order the groups first appear. */
  rowGroupField: z.string().min(1).max(200).optional(),
  summaryRow: z
    .strictObject({ label: z.string().min(1).max(120), operations: z.record(z.string().min(1).max(200), OPERATION) })
    .optional(),
  sortBy: z.strictObject({ field: z.string().min(1).max(200), order: z.enum(["asc", "desc"]).optional() }).optional(),
  /** Keep only the first n rows after sorting. */
  limit: z.number().int().min(1).max(5000).optional(),
  /** Tint every other row. */
  zebra: z.boolean().optional(),
  /** Rows to tint: indices after sorting, or any text value a row carries. */
  highlightRows: z.array(z.union([z.number().int().min(0), z.string().max(120)])).max(200).optional(),
})

export type TableColumn = z.infer<typeof TableColumnSchema>
export type TableSpec = z.infer<typeof TableSpecSchema>
export type TableCellKind = z.infer<typeof CELL>
export type TableOperation = z.infer<typeof OPERATION>

export interface TableRenderOptions {
  readonly theme: ThemeTokens
  readonly fonts: FontBook
  readonly locale?: ResolvedLocale
}

export interface TableRender {
  /** The table as one measured SVG, sized to its content. */
  readonly svg: string
  /** The same table as accessible HTML: sticky headers, sorting, filtering and Copy TSV. */
  readonly html: string
  readonly width: number
  readonly height: number
  readonly issues: readonly Issue[]
}

// ---------------------------------------------------------------------------------------------------------------
// Number and date formatting, from the locale's own separators, with no Intl and no time zone.

interface NumberPattern {
  readonly decimal: string
  readonly thousands: string
  readonly grouping: readonly number[]
  readonly currency: readonly [string, string]
}

const EN: NumberPattern = { decimal: ".", thousands: ",", grouping: [3], currency: ["$", ""] }
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

const patternOf = (locale: ResolvedLocale | undefined): NumberPattern => {
  if (!locale) return EN
  const n = locale.number
  return {
    decimal: String(n.decimal ?? "."),
    thousands: String(n.thousands ?? ","),
    grouping: Array.isArray(n.grouping) && n.grouping.length ? n.grouping.map(v => Math.max(1, Math.round(Number(v) || 3))) : [3],
    currency: Array.isArray(n.currency) && n.currency.length === 2 ? [String(n.currency[0]), String(n.currency[1])] : EN.currency,
  }
}

function groupInteger(digits: string, pattern: NumberPattern): string {
  const sizes = pattern.grouping.length ? pattern.grouping : [3]
  let out = ""
  let at = digits.length
  let step = 0
  while (at > 0) {
    const size = sizes[Math.min(step, sizes.length - 1)]!
    const start = Math.max(0, at - size)
    out = digits.slice(start, at) + (out ? pattern.thousands + out : "")
    at = start
    step++
  }
  return out || "0"
}

/** Fixed `digits` decimals, grouped, with an ASCII minus that survives TSV, CSV and a spreadsheet. */
export function formatNumber(value: number, digits: number, pattern: NumberPattern = EN): string {
  if (!Number.isFinite(value)) return "—"
  const d = Math.max(0, Math.min(6, Math.round(digits)))
  const negative = value < 0 && Math.abs(value) >= 0.5 * 10 ** -d
  const fixed = Math.abs(value).toFixed(d)
  const dot = fixed.indexOf(".")
  const whole = dot < 0 ? fixed : fixed.slice(0, dot)
  const fraction = dot < 0 ? "" : fixed.slice(dot + 1)
  return `${negative ? "-" : ""}${groupInteger(whole, pattern)}${d > 0 ? pattern.decimal + fraction : ""}`
}

/** The numeric value in a cell, reading "12.4%", "1,204" and "€12.40" as the numbers they are. */
export function numberOf(value: unknown): number | undefined {
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined
  if (typeof value !== "string") return undefined
  const cleaned = value.replace(/[\s,%$€£¥₹+]/g, "").replace(/^\((.*)\)$/, "-$1")
  if (!cleaned) return undefined
  const parsed = Number(cleaned)
  return Number.isFinite(parsed) ? parsed : undefined
}

/** A date cell as "14 Nov 2026"; anything that is not an ISO date is shown as it came. */
export function formatDate(value: unknown): string {
  const text = String(value ?? "").trim()
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(text)
  if (!match) return text
  const month = MONTHS[Number(match[2]) - 1]
  return month ? `${Number(match[3])} ${month} ${match[1]}` : text
}

const hasFraction = (values: readonly number[]) => values.some(value => Number.isFinite(value) && Math.abs(value - Math.round(value)) > 1e-9)

function decimalsFor(column: TableColumn, values: readonly number[]): number {
  if (column.decimals !== undefined) return column.decimals
  switch (column.format) {
    case "currency":
      return 2
    case "percent":
    case "compact":
      return 1
    case "integer":
    case "date":
    case "text":
      return 0
    default:
      return hasFraction(values) ? 1 : 0
  }
}

/** The text a cell shows: the column's format applied to its value. */
export function formatCellValue(column: TableColumn, value: unknown, pattern: NumberPattern = EN, fallbackDecimals?: number): string {
  if (value === null || value === undefined || value === "") return "—"
  const format = column.format ?? (typeof value === "number" ? "number" : "text")
  if (format === "text") return String(value)
  if (format === "date") return formatDate(value)
  const numeric = numberOf(value)
  if (numeric === undefined) return String(value)
  const digits = column.decimals ?? fallbackDecimals ?? (format === "currency" ? 2 : format === "percent" || format === "compact" ? 1 : 0)
  if (format === "percent") return `${formatNumber(numeric * 100, digits, pattern)}%`
  if (format === "currency") {
    const [prefix, suffix] = pattern.currency
    // The sign goes before the symbol, as money is written: -$40.00, not $-40.00.
    return `${numeric < 0 ? "-" : ""}${prefix}${formatNumber(Math.abs(numeric), digits, pattern)}${suffix}`
  }
  if (format === "integer") return formatNumber(numeric, 0, pattern)
  if (format === "compact") {
    const abs = Math.abs(numeric)
    const units: readonly (readonly [number, string])[] = [[1e12, "T"], [1e9, "B"], [1e6, "M"], [1e3, "k"]]
    const unit = units.find(([scale]) => abs >= scale)
    if (!unit) return formatNumber(numeric, digits, pattern)
    return `${formatNumber(numeric / unit[0], digits, pattern)}${unit[1]}`
  }
  return formatNumber(numeric, digits, pattern)
}

// ---------------------------------------------------------------------------------------------------------------
// Colour arithmetic for the marks: mixing two tokens, adding alpha, and sampling a theme ramp.

const hex2 = (value: number) => Math.max(0, Math.min(255, Math.round(value))).toString(16).padStart(2, "0")

/** `a` to `b` at `t`, in sRGB. Falls back to `b` when either cannot be parsed. */
export function mixColour(a: string, b: string, t: number): string {
  const ca = parseColor(a), cb = parseColor(b)
  if (!ca || !cb) return b
  return `#${hex2(ca[0] + (cb[0] - ca[0]) * t)}${hex2(ca[1] + (cb[1] - ca[1]) * t)}${hex2(ca[2] + (cb[2] - ca[2]) * t)}`
}

/** The colour at `alpha` (0..1) as #rrggbbaa; the token itself when it cannot be parsed. */
export function withAlpha(colour: string, alpha: number): string {
  const c = parseColor(colour)
  if (!c) return colour
  return `#${hex2(c[0])}${hex2(c[1])}${hex2(c[2])}${hex2(Math.max(0, Math.min(1, alpha)) * 255)}`
}

/** A theme ramp (sequential or diverging) sampled at `t` in 0..1, interpolating between its published stops. */
export function sampleRamp(ramp: readonly string[], t: number): string {
  const stops = ramp.length ? ramp : ["#EEEEEE", "#333333"]
  if (stops.length === 1) return stops[0]!
  const u = Math.max(0, Math.min(1, t)) * (stops.length - 1)
  const index = Math.min(stops.length - 2, Math.floor(u))
  return mixColour(stops[index]!, stops[index + 1]!, u - index)
}

// ---------------------------------------------------------------------------------------------------------------
// The measured layout.

interface Metrics {
  readonly family: string
  readonly body: number
  readonly small: number
  readonly title: number
  readonly subtitle: number
  readonly titleWeight: number
  readonly rowHeight: number
  readonly pad: number
  readonly cellPad: number
  measure(text: string, size: number, weight?: number, family?: string): number
}

function metricsOf(theme: ThemeTokens, fonts: FontBook): Metrics {
  const family = fonts.has(theme.font.family) ? theme.font.family : SANS
  const body = theme.font.size
  return {
    family,
    body,
    small: theme.font.labelSize,
    title: theme.font.titleSize,
    subtitle: theme.font.subtitleSize,
    titleWeight: theme.font.titleWeight,
    rowHeight: Math.max(24, Math.round(body * 2.3)),
    pad: Math.max(12, Math.round(theme.layout.padding)),
    cellPad: Math.max(8, Math.round(body * 0.8)),
    measure: (text, size, weight = 400, familyName = family) => fonts.measure(text, size, familyName, weight),
  }
}

const escapeText = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")
const round = (value: number) => Math.round(value * 100) / 100
const pathNumber = (value: number) => String(Math.round(value * 100) / 100)
const clamp = (value: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, value))

/** How wide a mark wants to be, before its value label is added. */
function plotWidth(kind: TableCellKind): number {
  switch (kind) {
    case "sparkline":
    case "sparkarea":
    case "sparkbar":
      return 84
    case "bullet":
      return 88
    case "bar":
      return 68
    case "dot":
      return 14
    case "delta":
      return 12
    case "badge":
      return 18
    default:
      return 0
  }
}

interface ColumnStats {
  readonly numbers: readonly number[]
  readonly min: number
  readonly max: number
  readonly hasNegative: boolean
  readonly series: readonly (readonly number[])[]
}

function statsOf(rows: readonly Row[], column: TableColumn): ColumnStats {
  const numbers: number[] = []
  const series: number[][] = []
  for (const row of rows) {
    const value = row[column.field]
    const points = seriesOf(value)
    if (points) {
      series.push(points)
      continue
    }
    const number = numberOf(value)
    if (number !== undefined) numbers.push(number)
  }
  const min = numbers.length ? Math.min(...numbers) : 0
  const max = numbers.length ? Math.max(...numbers) : 0
  return { numbers, min, max, hasNegative: min < 0, series }
}

const domainOf = (column: TableColumn, stats: ColumnStats): [number, number] => {
  if (column.domain) return [Math.min(column.domain[0], column.domain[1]), Math.max(column.domain[0], column.domain[1])]
  let lo = stats.min, hi = stats.max
  for (const points of stats.series) {
    lo = Math.min(lo, ...points)
    hi = Math.max(hi, ...points)
  }
  if (lo === hi) {
    const room = Math.abs(lo) > 0 ? Math.abs(lo) * 0.5 : 1
    return [lo - room, hi + room]
  }
  return [lo, hi]
}

/** A delta's signed percentage: a fraction by default, percentage points when the column says so. */
function deltaLabel(column: TableColumn, value: unknown, digits: number, pattern: NumberPattern): string {
  const numeric = numberOf(value) ?? 0
  const points = column.format === "number" || column.format === "integer" ? numeric : numeric * 100
  return `${points >= 0 ? "+" : "-"}${formatNumber(Math.abs(points), digits, pattern)}%`
}

const seriesOf = (value: unknown): number[] | undefined => {
  if (Array.isArray(value)) {
    const points = value.map(numberOf).filter((v): v is number => v !== undefined)
    return points.length ? points : undefined
  }
  if (typeof value === "string" && value.includes(",")) {
    const points = value.split(",").map(numberOf).filter((v): v is number => v !== undefined)
    return points.length ? points : undefined
  }
  return undefined
}

interface PlotContext {
  readonly theme: ThemeTokens
  readonly metrics: Metrics
  readonly categorical: readonly string[]
  readonly positive: string
  readonly negative: string
  readonly text: string
  readonly muted: string
  readonly grid: string
  readonly axis: string
  readonly sequential: readonly string[]
  readonly diverging: readonly string[]
  readonly darkInk: string
  readonly lightInk: string
}

/** A smooth cubic through the points (Catmull-Rom tangents), so a sparkline reads as a trend, not a zigzag. */
function smoothPath(points: readonly (readonly [number, number])[]): string {
  if (points.length === 0) return ""
  if (points.length === 1) return `M${pathNumber(points[0]![0])},${pathNumber(points[0]![1])}`
  let d = `M${pathNumber(points[0]![0])},${pathNumber(points[0]![1])}`
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i - 1] ?? points[i]!
    const p1 = points[i]!
    const p2 = points[i + 1]!
    const p3 = points[i + 2] ?? p2
    const c1x = p1[0] + (p2[0] - p0[0]) / 6
    const c1y = p1[1] + (p2[1] - p0[1]) / 6
    const c2x = p2[0] - (p3[0] - p1[0]) / 6
    const c2y = p2[1] - (p3[1] - p1[1]) / 6
    d += `C${pathNumber(c1x)},${pathNumber(c1y)} ${pathNumber(c2x)},${pathNumber(c2y)} ${pathNumber(p2[0])},${pathNumber(p2[1])}`
  }
  return d
}

interface CellBox {
  readonly x: number
  readonly y: number
  readonly w: number
  readonly h: number
}

/**
 * A badge's fill: an opaque colour, never a translucent one. A pill is measured for the ink that sits on it, so the
 * fill has to be exactly what the reader sees: the value's own colour blended into the canvas at 16%, or a quiet tint
 * of the muted ink when the value has no colour of its own. A `#rrggbbaa` fill would be measured as its unblended RGB,
 * which puts white ink on what is really a pale pill.
 */
function badgeFill(column: TableColumn, value: unknown, ctx: PlotContext): string {
  const named = column.badgeColors?.[String(value ?? "")]
  return mixColour(ctx.theme.colors.background, named ?? ctx.muted, named ? 0.16 : 0.14)
}

/**
 * The inline mark of one cell, complete with its value label. `box` is the cell's inner box; `target` is a bullet's
 * target tick, read from the row by the caller.
 */
function plotCell(column: TableColumn, value: unknown, box: CellBox, ctx: PlotContext, stats: ColumnStats, label: string, labelWidth: number, target: number | undefined): string {
  const { x, y, w, h } = box
  const centre = y + h / 2
  const kind = column.cell ?? "text"
  const body = ctx.metrics.body
  const out: string[] = []
  const textStyle = (anchor: "start" | "middle" | "end", size = body, weight = 400, fill = ctx.text) => `font-family="${escapeText(ctx.metrics.family)}" font-size="${size}" font-weight="${weight}" fill="${fill}" text-anchor="${anchor}"`
  const baseline = round(centre + body * 0.36)

  if (kind === "bar") {
    const numeric = numberOf(value) ?? 0
    const [lo, hi] = domainOf(column, stats)
    const trackW = Math.max(10, w - labelWidth - 6)
    const span = hi - lo || 1
    const zero = lo < 0 ? x + ((0 - lo) / span) * trackW : x
    const at = x + ((clamp(numeric, lo, hi) - lo) / span) * trackW
    const fill = numeric < 0 ? ctx.negative : stats.hasNegative ? ctx.positive : ctx.categorical[0]!
    const left = Math.min(zero, at)
    // A value the domain clamps away draws nothing: a minimum-width sliver at the domain's edge would misreport it.
    const width = numeric === 0 || at === zero ? 0 : Math.max(Math.abs(at - zero), 1.5)
    const barH = Math.min(10, Math.max(4, h - 8))
    if (width > 0) out.push(`<rect x="${round(left)}" y="${round(centre - barH / 2)}" width="${round(width)}" height="${round(barH)}" rx="${round(Math.min(3, barH / 2))}" fill="${fill}"/>`)
    if (lo < 0) out.push(`<line x1="${round(zero)}" y1="${round(centre - barH / 2 - 1)}" x2="${round(zero)}" y2="${round(centre + barH / 2 + 1)}" stroke="${ctx.axis}" stroke-width="1"/>`)
    out.push(`<text x="${round(x + w)}" y="${baseline}" ${textStyle("end")} style="font-variant-numeric:tabular-nums">${escapeText(label)}</text>`)
    return out.join("")
  }

  if (kind === "sparkline" || kind === "sparkarea") {
    const points = seriesOf(value)
    if (!points) return ""
    const lo = Math.min(...points), hi = Math.max(...points)
    const pad = 3
    const top = y + pad, bottom = y + h - pad
    const span = hi - lo || 1
    const step = points.length > 1 ? w / (points.length - 1) : 0
    const coords = points.map((point, index) => [x + (points.length > 1 ? index * step : w / 2), bottom - ((point - lo) / span) * (bottom - top)] as const)
    const line = smoothPath(coords)
    const colour = ctx.categorical[0]!
    if (kind === "sparkarea") out.push(`<path d="${line}L${pathNumber(x + w)},${pathNumber(bottom)}L${pathNumber(x)},${pathNumber(bottom)}Z" fill="${withAlpha(colour, 0.16)}" stroke="none"/>`)
    out.push(`<path d="${line}" fill="none" stroke="${colour}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>`)
    for (const index of new Set([points.indexOf(lo), points.indexOf(hi)])) {
      const point = coords[index]!
      out.push(`<circle cx="${round(point[0])}" cy="${round(point[1])}" r="1.5" fill="${ctx.muted}"/>`)
    }
    const end = coords[coords.length - 1]!
    out.push(`<circle cx="${round(end[0])}" cy="${round(end[1])}" r="2.4" fill="${colour}" stroke="${ctx.theme.colors.background}" stroke-width="1"/>`)
    return out.join("")
  }

  if (kind === "sparkbar") {
    const points = seriesOf(value)
    if (!points) return ""
    const lo = Math.min(0, ...points), hi = Math.max(0, ...points)
    const span = hi - lo || 1
    const slot = w / Math.max(1, points.length)
    const gap = Math.min(2, slot / 4)
    const bottom = y + h - 2
    const zero = bottom - ((0 - lo) / span) * (h - 4)
    const colour = ctx.categorical[0]!
    points.forEach((point, index) => {
      const at = bottom - ((point - lo) / span) * (h - 4)
      const top = Math.min(at, zero)
      out.push(`<rect x="${round(x + index * slot + gap / 2)}" y="${round(top)}" width="${round(Math.max(1, slot - gap))}" height="${round(Math.max(1, Math.abs(zero - at)))}" rx="1" fill="${point < 0 ? ctx.negative : colour}"/>`)
    })
    return out.join("")
  }

  if (kind === "bullet") {
    const numeric = numberOf(value) ?? 0
    const [lo, hi] = domainOf(column, stats)
    const span = hi - lo || 1
    const trackW = Math.max(12, w - labelWidth - 6)
    const barH = Math.min(8, Math.max(4, h - 10))
    out.push(`<rect x="${round(x)}" y="${round(centre - barH / 2)}" width="${round(trackW)}" height="${round(barH)}" rx="${round(barH / 2)}" fill="${withAlpha(ctx.axis, 0.22)}"/>`)
    const at = x + ((clamp(numeric, lo, hi) - lo) / span) * trackW
    out.push(`<rect x="${round(x)}" y="${round(centre - barH / 2)}" width="${round(Math.max(1.5, at - x))}" height="${round(barH)}" rx="${round(barH / 2)}" fill="${ctx.categorical[0]}"/>`)
    if (target !== undefined && Number.isFinite(target)) {
      const tick = x + ((clamp(target, lo, hi) - lo) / span) * trackW
      out.push(`<line x1="${round(tick)}" y1="${round(centre - barH)}" x2="${round(tick)}" y2="${round(centre + barH)}" stroke="${ctx.text}" stroke-width="1.6" stroke-linecap="round"/>`)
    }
    out.push(`<text x="${round(x + w)}" y="${baseline}" ${textStyle("end")} style="font-variant-numeric:tabular-nums">${escapeText(label)}</text>`)
    return out.join("")
  }

  if (kind === "delta") {
    const numeric = numberOf(value) ?? 0
    const good = (column.positiveIsGood ?? true) ? numeric >= 0 : numeric < 0
    const colour = numeric === 0 ? ctx.muted : good ? ctx.positive : ctx.negative
    const direction = numeric >= 0 ? 1 : -1
    const baseY = centre - body * 0.32
    const triangle = direction > 0
      ? `${round(x + 0.5)},${round(baseY + body * 0.62)} ${round(x + body * 0.52)},${round(baseY + body * 0.62)} ${round(x + body * 0.26)},${round(baseY)}`
      : `${round(x + 0.5)},${round(baseY)} ${round(x + body * 0.52)},${round(baseY)} ${round(x + body * 0.26)},${round(baseY + body * 0.62)}`
    out.push(`<polygon points="${triangle}" fill="${colour}"/>`)
    out.push(`<text x="${round(x + body * 0.72)}" y="${baseline}" ${textStyle("start", body, 600, colour)} style="font-variant-numeric:tabular-nums">${escapeText(label)}</text>`)
    return out.join("")
  }

  if (kind === "badge") {
    const fill = badgeFill(column, value, ctx)
    const pillH = Math.min(round(body * 1.7), Math.max(12, h - 8))
    const pillW = Math.min(w, labelWidth + 16)
    out.push(`<rect x="${round(x)}" y="${round(centre - pillH / 2)}" width="${round(pillW)}" height="${round(pillH)}" rx="${round(pillH / 2)}" fill="${fill}" stroke="${withAlpha(ctx.muted, 0.3)}" stroke-width="1"/>`)
    out.push(`<text x="${round(x + pillW / 2)}" y="${baseline}" ${textStyle("middle", body, 600, inkOn(fill, ctx.darkInk, ctx.lightInk))}>${escapeText(label)}</text>`)
    return out.join("")
  }

  if (kind === "dot") {
    const fill = badgeFill(column, value, ctx)
    out.push(`<circle cx="${round(x + 4)}" cy="${round(centre)}" r="3.6" fill="${fill}"/>`)
    out.push(`<text x="${round(x + 13)}" y="${baseline}" ${textStyle("start")}>${escapeText(label)}</text>`)
    return out.join("")
  }

  return out.join("")
}

// ---------------------------------------------------------------------------------------------------------------
// Rows: ordering, sections, highlights and the summary.

interface PendingRow {
  readonly row: Row
  readonly index: number
  readonly highlight: boolean
}

interface RowBand {
  readonly label: string | undefined
  readonly rows: readonly PendingRow[]
}

function orderRows(spec: TableSpec, rows: readonly Row[]): { row: Row; index: number }[] {
  const keyed = rows.map((row, index) => ({ row, index }))
  if (!spec.sortBy) return keyed
  const { field, order } = spec.sortBy
  const direction = order === "desc" ? -1 : 1
  keyed.sort((a, b) => {
    const av = a.row[field], bv = b.row[field]
    const an = numberOf(av), bn = numberOf(bv)
    const compare = an !== undefined && bn !== undefined ? an - bn : String(av ?? "").localeCompare(String(bv ?? ""))
    return compare === 0 ? a.index - b.index : compare * direction
  })
  return keyed
}

function bandsOf(spec: TableSpec, ordered: readonly { row: Row; index: number }[], highlighted: ReadonlySet<number>): RowBand[] {
  const limited = spec.limit ? ordered.slice(0, spec.limit) : ordered
  const marked: PendingRow[] = limited.map((entry, position) => ({ row: entry.row, index: entry.index, highlight: highlighted.has(position) }))
  if (!spec.rowGroupField) return [{ label: undefined, rows: marked }]
  // One section per group value, in the order the values first appear, so every "Enterprise" row sits under one
  // "Enterprise" header even when the rows interleave. A group header a reader sees twice is not a section.
  const sections = new Map<string, PendingRow[]>()
  for (const entry of marked) {
    const label = entry.row[spec.rowGroupField]
    const text = label === null || label === undefined ? "" : String(label)
    const rows = sections.get(text)
    if (rows) rows.push(entry)
    else sections.set(text, [entry])
  }
  return [...sections.entries()].map(([label, rows]) => ({ label, rows }))
}

function summarise(spec: TableSpec, rows: readonly Row[], pattern: NumberPattern, decimals: readonly number[]): Map<string, string> {
  const out = new Map<string, string>()
  if (!spec.summaryRow) return out
  for (const [field, operation] of Object.entries(spec.summaryRow.operations)) {
    const values = rows.map(row => numberOf(row[field])).filter((v): v is number => v !== undefined)
    if (!values.length) continue
    const sorted = [...values].sort((a, b) => a - b)
    const sum = values.reduce((a, b) => a + b, 0)
    let result: number
    if (operation === "sum") result = sum
    else if (operation === "mean") result = sum / values.length
    else if (operation === "min") result = sorted[0]!
    else if (operation === "max") result = sorted[sorted.length - 1]!
    else {
      const mid = Math.floor(sorted.length / 2)
      result = sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2
    }
    const index = spec.columns.findIndex(column => column.field === field)
    const column = index >= 0 ? spec.columns[index] : undefined
    out.set(field, column ? formatCellValue(column, result, pattern, decimals[index] ?? 0) : String(result))
  }
  return out
}

// ---------------------------------------------------------------------------------------------------------------
// The SVG.

/**
 * Draws the table. The columns are measured first (header, every formatted value, every mark), the spanner groups
 * widened to fit their labels, and only then is anything placed: no label is clipped or collided by construction.
 */
export function renderTable(specInput: unknown, rowsInput: readonly Row[], options: TableRenderOptions): TableRender {
  const parsed = TableSpecSchema.safeParse(specInput)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    const at = issue?.path.length ? pointer(issue.path.map(String)) : undefined
    throw new ChartsError("SPEC_INVALID", `The table spec has a problem: ${issue?.message ?? "it is not an object"}.`, "Fix the column or option named above and render again.", at)
  }
  const spec = parsed.data
  const { theme, fonts } = options
  if (!Array.isArray(rowsInput)) throw new ChartsError("DATA_INVALID", "The table's rows are not an array.", "Pass an array of row objects.")
  if (rowsInput.length === 0) throw new ChartsError("DATA_EMPTY", "The table has no rows.", "Pass at least one row, or check the filter that produced them.")
  for (const [index, row] of rowsInput.entries()) {
    if (!row || typeof row !== "object" || Array.isArray(row)) throw new ChartsError("DATA_INVALID", `Row ${index} is not an object.`, "Each row is an object of field: value.")
  }

  const metrics = metricsOf(theme, fonts)
  const pattern = patternOf(options.locale)
  const issues: Issue[] = []
  const colours = theme.colors.categorical
  const ctx: PlotContext = {
    theme,
    metrics,
    categorical: colours,
    positive: theme.colors.positive,
    negative: theme.colors.negative,
    text: theme.colors.text,
    muted: theme.colors.muted,
    grid: theme.colors.grid,
    axis: theme.colors.axis,
    sequential: theme.colors.sequential,
    diverging: theme.colors.diverging,
    darkInk: theme.mode === "dark" ? theme.colors.background : theme.colors.text,
    lightInk: "#FFFFFF",
  }

  // A field no row carries cannot be measured or drawn: report it once, with its column's path.
  for (const [index, column] of spec.columns.entries()) {
    if (!rowsInput.some(row => Object.prototype.hasOwnProperty.call(row, column.field))) {
      throw new ChartsError("FIELD_MISSING", `No row has the field "${column.field}", which column ${index + 1} reads.`, "Rename the column's field to one the rows carry, or add it to the data.", pointer(["columns", index, "field"]))
    }
  }

  const ordered = orderRows(spec, rowsInput)
  const sourceRows = ordered.map(entry => entry.row)
  const allStats = spec.columns.map(column => statsOf(sourceRows, column))
  const decimals = spec.columns.map((column, index) => decimalsFor(column, allStats[index]!.numbers))
  const highlighted = new Set<number>()
  for (const entry of spec.highlightRows ?? []) {
    if (typeof entry === "number") highlighted.add(entry)
    else ordered.forEach((item, index) => {
      if (Object.values(item.row).some(value => typeof value === "string" && value === entry)) highlighted.add(index)
    })
  }
  const bands = bandsOf(spec, ordered, highlighted)
  const drawnRows = bands.flatMap(band => band.rows)
  const summary = summarise(spec, drawnRows.map(entry => entry.row), pattern, decimals)

  const labelOf = (column: TableColumn) => column.label ?? column.field
  const cellLabel = (column: TableColumn, index: number, row: Row) => {
    if (column.cell === "delta") return deltaLabel(column, row[column.field], decimals[index] ?? 1, pattern)
    return formatCellValue(column, row[column.field], pattern, decimals[index])
  }
  const targetOf = (column: TableColumn, row: Row) => (column.targetField ? numberOf(row[column.targetField]) : undefined)

  // Column widths: the widest of the header, every value label, and every mark the column draws.
  const widths: number[] = spec.columns.map((column, index) => {
    let content = metrics.measure(labelOf(column), metrics.body, 600)
    let labelWidth = 0
    for (const entry of drawnRows) {
      const label = cellLabel(column, index, entry.row)
      labelWidth = Math.max(labelWidth, metrics.measure(label, metrics.body, 400))
    }
    content = Math.max(content, labelWidth)
    const kind = column.cell ?? "text"
    if (kind !== "text" && kind !== "heatmap") content = Math.max(content, plotWidth(kind) + (plotWidth(kind) > 0 ? labelWidth + 6 : 0))
    return Math.max(column.width ?? 0, Math.ceil(content) + metrics.cellPad * 2)
  })

  // Spanner groups: consecutive columns with the same spanner label share a rule and one centred heading. A group too
  // narrow for its own label is widened, a pixel or two per column, until the label has room on both sides.
  const spans: { label: string; from: number; to: number }[] = []
  for (const [index, column] of spec.columns.entries()) {
    if (!column.spanner) continue
    const last = spans[spans.length - 1]
    if (last && last.label === column.spanner && last.to === index - 1) last.to = index
    else spans.push({ label: column.spanner, from: index, to: index })
  }
  for (const span of spans) {
    const need = Math.ceil(metrics.measure(span.label, metrics.small, 600)) + metrics.cellPad * 2
    let have = 0
    for (let i = span.from; i <= span.to; i++) have += widths[i]!
    if (have >= need) continue
    const share = Math.ceil((need - have) / (span.to - span.from + 1))
    for (let i = span.from; i <= span.to; i++) widths[i] = widths[i]! + share
  }

  const tableWidth = widths.reduce((sum, width) => sum + width, 0)

  // The title block is part of the drawing, so the whole graphic is one object at one scale.
  const groupHeight = Math.round(metrics.small * 2.4)
  const spannerHeight = spans.length ? Math.round(metrics.small * 2.2) : 0

  const titleWidth = Math.max(
    spec.kicker ? metrics.measure(spec.kicker.toUpperCase(), metrics.small, 600) : 0,
    spec.title ? metrics.measure(spec.title, metrics.title, metrics.titleWeight) : 0,
    spec.subtitle ? metrics.measure(spec.subtitle, metrics.subtitle, 400) : 0,
    spec.source ? metrics.measure(spec.source, metrics.small, 400) : 0,
    spec.notes ? metrics.measure(spec.notes, metrics.small, 400) : 0,
  )
  const width = Math.ceil(Math.max(tableWidth, titleWidth) + metrics.pad * 2)
  const tableX = metrics.pad + Math.max(0, (width - metrics.pad * 2 - tableWidth) / 2)

  const fills: string[] = []
  const rules: string[] = []
  const text: string[] = []
  const marks: string[] = []

  // Title block. Every line starts at the same left edge, the kicker included, so the block has one margin.
  let y = metrics.pad
  if (spec.kicker) {
    y += Math.round(metrics.small * 1.2)
    text.push(`<text x="${metrics.pad}" y="${y}" font-family="${escapeText(metrics.family)}" font-size="${metrics.small}" font-weight="600" fill="${theme.colors.highlight}" letter-spacing="${round(metrics.small * 0.1)}">${escapeText(spec.kicker.toUpperCase())}</text>`)
    y += Math.round(metrics.small * 0.4)
  }
  if (spec.title) {
    y += Math.round(metrics.title * 1.05)
    text.push(`<text x="${metrics.pad}" y="${y}" font-family="${escapeText(metrics.family)}" font-size="${metrics.title}" font-weight="${metrics.titleWeight}" fill="${theme.colors.text}">${escapeText(spec.title)}</text>`)
    y += Math.round(metrics.title * 0.3)
  }
  if (spec.subtitle) {
    y += Math.round(metrics.subtitle * 1.35)
    text.push(`<text x="${metrics.pad}" y="${y}" font-family="${escapeText(metrics.family)}" font-size="${metrics.subtitle}" font-weight="400" fill="${theme.colors.muted}">${escapeText(spec.subtitle)}</text>`)
  }
  if (spec.title || spec.subtitle || spec.kicker) y += Math.round(metrics.body * 0.6)

  // Column x positions.
  const xs: number[] = []
  let cursor = tableX
  for (const width of widths) {
    xs.push(cursor)
    cursor += width
  }
  const alignOf = (column: TableColumn): "left" | "right" | "center" => {
    if (column.align) return column.align
    const kind = column.cell ?? "text"
    if (kind !== "text" && kind !== "badge" && kind !== "dot" && kind !== "heatmap") return "right"
    if (column.format && column.format !== "text" && column.format !== "date") return "right"
    return "left"
  }

  // Spanners.
  if (spans.length) {
    for (const span of spans) {
      const from = xs[span.from]!
      const to = xs[span.to]! + widths[span.to]!
      rules.push(`<line x1="${round(from)}" y1="${round(y + spannerHeight - 1.5)}" x2="${round(to)}" y2="${round(y + spannerHeight - 1.5)}" stroke="${theme.colors.grid}" stroke-width="1"/>`)
      text.push(`<text x="${round((from + to) / 2)}" y="${round(y + spannerHeight - 8)}" font-family="${escapeText(metrics.family)}" font-size="${metrics.small}" font-weight="600" fill="${theme.colors.text}" text-anchor="middle" letter-spacing="${round(metrics.small * 0.04)}">${escapeText(span.label)}</text>`)
    }
    y += spannerHeight
  }

  // Header.
  spec.columns.forEach((column, index) => {
    const align = alignOf(column)
    const x = align === "right" ? xs[index]! + widths[index]! - metrics.cellPad : align === "center" ? xs[index]! + widths[index]! / 2 : xs[index]! + metrics.cellPad
    text.push(`<text x="${round(x)}" y="${round(y + metrics.rowHeight / 2 + metrics.body * 0.36)}" font-family="${escapeText(metrics.family)}" font-size="${metrics.body}" font-weight="600" fill="${theme.colors.text}" text-anchor="${align === "right" ? "end" : align === "center" ? "middle" : "start"}">${escapeText(labelOf(column))}</text>`)
  })
  y += metrics.rowHeight
  rules.push(`<line x1="${round(tableX)}" y1="${round(y - 0.75)}" x2="${round(tableX + tableWidth)}" y2="${round(y - 0.75)}" stroke="${theme.colors.axis}" stroke-width="1.5"/>`)

  // Rows, section bands and the summary.
  const missingData = new Set<string>()
  let rowNumber = 0
  for (const band of bands) {
    if (band.label !== undefined) {
      fills.push(`<rect x="${round(tableX)}" y="${round(y)}" width="${round(tableWidth)}" height="${groupHeight}" fill="${withAlpha(theme.colors.text, 0.045)}"/>`)
      rules.push(`<line x1="${round(tableX)}" y1="${round(y + 0.5)}" x2="${round(tableX + tableWidth)}" y2="${round(y + 0.5)}" stroke="${theme.colors.grid}" stroke-width="1"/>`)
      text.push(`<text x="${round(tableX + metrics.cellPad)}" y="${round(y + groupHeight / 2 + metrics.small * 0.36)}" font-family="${escapeText(metrics.family)}" font-size="${metrics.small}" font-weight="600" fill="${theme.colors.text}" letter-spacing="${round(metrics.small * 0.04)}">${escapeText(band.label || "—")}</text>`)
      y += groupHeight
    }
    band.rows.forEach((entry, inBand) => {
      if (spec.zebra && (rowNumber + inBand) % 2 === 1) fills.push(`<rect x="${round(tableX)}" y="${round(y)}" width="${round(tableWidth)}" height="${metrics.rowHeight}" fill="${withAlpha(theme.colors.text, 0.028)}"/>`)
      if (entry.highlight) fills.push(`<rect x="${round(tableX)}" y="${round(y)}" width="${round(tableWidth)}" height="${metrics.rowHeight}" fill="${withAlpha(theme.colors.highlight, 0.12)}"/>`)

      spec.columns.forEach((column, index) => {
        const stats = allStats[index]!
        const value = entry.row[column.field]
        const kind = column.cell ?? "text"
        const label = cellLabel(column, index, entry.row)
        const align = alignOf(column)
        const cellX = xs[index]!
        const cellW = widths[index]!
        const baseline = round(y + metrics.rowHeight / 2 + metrics.body * 0.36)
        const textX = align === "right" ? cellX + cellW - metrics.cellPad : align === "center" ? cellX + cellW / 2 : cellX + metrics.cellPad
        const anchor = align === "right" ? "end" : align === "center" ? "middle" : "start"

        if (kind === "heatmap") {
          const [lo, hi] = domainOf(column, stats)
          const numeric = numberOf(value)
          const t = numeric === undefined || hi === lo ? 0 : (numeric - lo) / (hi - lo)
          const ramp = lo < 0 && hi > 0 ? ctx.diverging : ctx.sequential
          const fill = sampleRamp(ramp, t)
          fills.push(`<rect x="${round(cellX + 1)}" y="${round(y + 2)}" width="${round(cellW - 2)}" height="${metrics.rowHeight - 4}" fill="${fill}"/>`)
          marks.push(`<text x="${round(textX)}" y="${baseline}" font-family="${escapeText(metrics.family)}" font-size="${metrics.body}" font-weight="400" fill="${inkOn(fill, ctx.darkInk, ctx.lightInk)}" text-anchor="${anchor}" style="font-variant-numeric:tabular-nums">${escapeText(label)}</text>`)
          return
        }
        if (kind === "text") {
          marks.push(`<text x="${round(textX)}" y="${baseline}" font-family="${escapeText(metrics.family)}" font-size="${metrics.body}" font-weight="400" fill="${theme.colors.text}" text-anchor="${anchor}">${escapeText(label)}</text>`)
          return
        }
        if ((kind === "sparkline" || kind === "sparkarea" || kind === "sparkbar") && !seriesOf(value)) missingData.add(column.field)
        const inner = { x: cellX + metrics.cellPad, y: y + 2, w: cellW - metrics.cellPad * 2, h: metrics.rowHeight - 4 }
        marks.push(plotCell(column, value, inner, ctx, stats, label, metrics.measure(label, metrics.body, 400), targetOf(column, entry.row)))
      })
      y += metrics.rowHeight
      if (inBand < band.rows.length - 1) rules.push(`<line x1="${round(tableX)}" y1="${round(y - 0.5)}" x2="${round(tableX + tableWidth)}" y2="${round(y - 0.5)}" stroke="${theme.colors.grid}" stroke-width="1"/>`)
    })
    rowNumber += band.rows.length
  }

  if (spec.summaryRow) {
    rules.push(`<line x1="${round(tableX)}" y1="${round(y + 0.75)}" x2="${round(tableX + tableWidth)}" y2="${round(y + 0.75)}" stroke="${theme.colors.axis}" stroke-width="1.5"/>`)
    const centre = y + metrics.rowHeight / 2 + metrics.body * 0.36
    spec.columns.forEach((column, index) => {
      const align = alignOf(column)
      const x = align === "right" ? xs[index]! + widths[index]! - metrics.cellPad : align === "center" ? xs[index]! + widths[index]! / 2 : xs[index]! + metrics.cellPad
      const label = index === 0 ? spec.summaryRow!.label : summary.get(column.field) ?? ""
      marks.push(`<text x="${round(x)}" y="${round(centre)}" font-family="${escapeText(metrics.family)}" font-size="${metrics.body}" font-weight="600" fill="${theme.colors.text}" text-anchor="${align === "right" ? "end" : align === "center" ? "middle" : "start"}" style="font-variant-numeric:tabular-nums">${escapeText(label)}</text>`)
    })
    y += metrics.rowHeight
  }

  // Footer: the notes, then the source, in the muted ink.
  if (spec.notes) {
    y += Math.round(metrics.small * 1.5)
    marks.push(`<text x="${metrics.pad}" y="${round(y)}" font-family="${escapeText(metrics.family)}" font-size="${metrics.small}" fill="${theme.colors.muted}">${escapeText(spec.notes)}</text>`)
  }
  if (spec.source) {
    y += Math.round(metrics.small * 1.5)
    marks.push(`<text x="${metrics.pad}" y="${round(y)}" font-family="${escapeText(metrics.family)}" font-size="${metrics.small}" fill="${theme.colors.axis}">${escapeText(spec.source)}</text>`)
  }
  const height = Math.ceil(y + metrics.pad)

  for (const field of missingData) {
    const index = spec.columns.findIndex(column => column.field === field)
    issues.push({ level: "warning", code: "DATA_INVALID", message: `The "${field}" column's marks need an array of numbers in each row, but some rows have none, so those cells are blank.`, path: pointer(["columns", index, "cell"]), fix: `Give each row an array such as [12, 15, 11, 19] at "${field}", or use cell "bar".` })
  }

  const title = spec.title ?? spec.kicker ?? "Table"
  const description = `A table of ${drawnRows.length} row(s) and ${spec.columns.length} column(s): ${spec.columns.map(labelOf).join(", ")}.`
  const svg = accessible(
    [
      `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
      `<rect x="0" y="0" width="${width}" height="${height}" fill="${theme.colors.background}"/>`,
      ...fills,
      ...rules,
      ...text,
      ...marks,
      `</svg>`,
    ].join(""),
    title,
    description,
  )

  for (const character of new Set(svgText(svg))) {
    if (!fonts.covers(character.codePointAt(0)!)) {
      issues.push({ level: "warning", code: "FONT_GLYPH_MISSING", message: `The bundled fonts have no glyph for "${character}", so it draws as a blank box.`, fix: "Translate the label, or add a font that covers the script with theme.font.files." })
      break
    }
  }

  const html = tableHtml({ spec, bands, summary, widths, metrics, theme, ctx, allStats, labelOf, cellLabel, alignOf, targetOf, pattern })
  return { svg, html, width, height, issues }
}

/** The characters an SVG actually draws, so a glyph check measures the same text resvg will. */
function svgText(svg: string): string[] {
  const characters: string[] = []
  for (const match of svg.matchAll(/<text\b[^>]*>([\s\S]*?)<\/text>/g)) {
    const body = match[1]!.replace(/<[^>]+>/g, "")
    for (const character of body) if (character.codePointAt(0)! > 0x20) characters.push(character)
  }
  return characters
}

// ---------------------------------------------------------------------------------------------------------------
// The HTML: the same layout, semantic and interactive, with the same marks as inline SVG.

interface HtmlInput {
  readonly spec: TableSpec
  readonly bands: readonly RowBand[]
  readonly summary: ReadonlyMap<string, string>
  readonly widths: readonly number[]
  readonly metrics: Metrics
  readonly theme: ThemeTokens
  readonly ctx: PlotContext
  readonly allStats: readonly ColumnStats[]
  readonly labelOf: (column: TableColumn) => string
  readonly cellLabel: (column: TableColumn, index: number, row: Row) => string
  readonly alignOf: (column: TableColumn) => "left" | "right" | "center"
  readonly targetOf: (column: TableColumn, row: Row) => number | undefined
  readonly pattern: NumberPattern
}

/**
 * The family as a CSS value: the named families of a stack, each quoted through the shared escaper, then the generic.
 * A theme's family is normally one name ("Inter"); a custom stack with a quote or a bracket in it would otherwise end
 * the CSS string and the rule with it.
 */
function cssFamily(family: string): string {
  const { named, generic } = parseFontStack(family)
  const names = named.map(cssString)
  if (!names.length) return cssString(family)
  return [...names, generic === "mono" ? "monospace" : generic === "serif" ? "serif" : "sans-serif"].join(", ")
}

function tableHtml(input: HtmlInput): string {
  const { spec, bands, summary, widths, metrics, theme, ctx, allStats, labelOf, cellLabel, alignOf, targetOf, pattern } = input
  const digest = createHash("sha256").update(JSON.stringify({ title: spec.title ?? "", columns: spec.columns.map(column => [column.field, column.label ?? "", column.cell ?? "text"]) })).digest("hex").slice(0, 8)
  const tableId = `tbl-${digest}`
  const spannerOf = (index: number) => spec.columns[index]?.spanner

  // Spanner cells: one per run of equal labels, with the columns it covers.
  const head: string[] = []
  if (spec.columns.some(column => column.spanner)) {
    const cells: string[] = []
    for (let index = 0; index < spec.columns.length; index++) {
      const spanner = spannerOf(index)
      if (!spanner) {
        cells.push(`<td class="spanner" aria-hidden="true"></td>`)
        continue
      }
      if (spannerOf(index - 1) === spanner) continue
      let span = 1
      while (spannerOf(index + span) === spanner) span++
      cells.push(`<th class="spanner" scope="colgroup" colspan="${span}">${escapeText(spanner)}</th>`)
    }
    head.push(`<tr class="spanners">${cells.join("")}</tr>`)
  }
  head.push(
    `<tr class="columns">${spec.columns
      .map((column, index) => {
        const align = alignOf(column)
        const numeric = !(column.format === "text" || column.format === "date" || (column.cell ?? "text") === "badge" || (column.cell ?? "text") === "heatmap")
        return `<th scope="col" data-index="${index}" data-type="${numeric ? "number" : "text"}" aria-sort="none" tabindex="0" class="align-${align}">${escapeText(labelOf(column))}<span class="sort" aria-hidden="true"></span></th>`
      })
      .join("")}</tr>`,
  )

  const cellHtml = (column: TableColumn, index: number, row: Row): string => {
    const stats = allStats[index]!
    const value = row[column.field]
    const kind = column.cell ?? "text"
    const label = cellLabel(column, index, row)
    const align = alignOf(column)
    const raw = Array.isArray(value) ? value.join(", ") : value === null || value === undefined ? "" : String(value)
    const sortValue = typeof value === "number" ? String(value) : Array.isArray(value) ? value.join(" ") : String(value ?? "")
    if (kind === "heatmap") {
      const [lo, hi] = domainOf(column, stats)
      const numeric = numberOf(value)
      const t = numeric === undefined || hi === lo ? 0 : (numeric - lo) / (hi - lo)
      const ramp = lo < 0 && hi > 0 ? ctx.diverging : ctx.sequential
      const fill = sampleRamp(ramp, t)
      return `<td class="align-${align} heat" data-sort-value="${escapeText(sortValue)}" data-tsv="${escapeText(raw)}" style="background:${fill};color:${inkOn(fill, ctx.darkInk, ctx.lightInk)}">${escapeText(label)}</td>`
    }
    if (kind === "text") return `<td class="align-${align}" data-sort-value="${escapeText(sortValue)}" data-tsv="${escapeText(raw)}">${escapeText(label)}</td>`
    const plotW = Math.max(56, Math.min(150, widths[index]! - metrics.cellPad * 2))
    const plotH = Math.max(14, metrics.rowHeight - 10)
    const inner = plotCell(column, value, { x: 0, y: 0, w: plotW, h: plotH }, ctx, stats, label, metrics.measure(label, metrics.body, 400), targetOf(column, row))
    const mark = inner ? `<svg xmlns="http://www.w3.org/2000/svg" width="${plotW}" height="${plotH}" viewBox="0 0 ${plotW} ${plotH}" role="img" aria-label="${escapeText(label)}">${inner}</svg>` : escapeText(label)
    return `<td class="align-${align} plot" data-sort-value="${escapeText(sortValue)}" data-tsv="${escapeText(raw)}">${mark}</td>`
  }

  const body: string[] = []
  bands.forEach((band, groupIndex) => {
    if (band.label !== undefined) body.push(`<tr class="group" data-group-head="${groupIndex}"><th scope="colgroup" colspan="${spec.columns.length}">${escapeText(band.label || "—")}</th></tr>`)
    band.rows.forEach((entry, position) => {
      const cells = spec.columns.map((column, index) => cellHtml(column, index, entry.row)).join("")
      body.push(`<tr data-row="${position}" data-group="${groupIndex}"${entry.highlight ? ` class="highlight"` : ""}>${cells}</tr>`)
    })
  })

  const footer: string[] = []
  if (spec.summaryRow) {
    footer.push(
      `<tr class="summary">${spec.columns
        .map((column, index) => {
          const label = index === 0 ? spec.summaryRow!.label : summary.get(column.field) ?? ""
          return `<th scope="row" class="align-${alignOf(column)}">${escapeText(label)}</th>`
        })
        .join("")}</tr>`,
    )
  }

  const caption = [spec.kicker, spec.title, spec.subtitle].filter((value): value is string => Boolean(value)).map(escapeText).join(" — ")
  const cellPadY = Math.max(4, Math.round(metrics.rowHeight / 2 - metrics.body * 0.7))
  const css = [
    `:root{color-scheme:${theme.mode}}`,
    `body{margin:0;padding:${metrics.pad}px;background:${theme.colors.background};color:${theme.colors.text};font-family:${cssFamily(metrics.family)},sans-serif;font-size:${metrics.body}px;line-height:1.4}`,
    `.table-wrap{overflow:auto;border-radius:6px}`,
    `table{border-collapse:collapse;width:100%;font-variant-numeric:tabular-nums}`,
    `caption{caption-side:top;text-align:left;padding:0 0 10px;color:${theme.colors.text};font-size:${metrics.subtitle}px}`,
    `th,td{padding:${cellPadY}px ${metrics.cellPad}px;border-bottom:1px solid ${theme.colors.grid};vertical-align:middle;white-space:nowrap}`,
    `thead th{position:sticky;top:0;background:${theme.colors.background};font-weight:600;border-bottom:1.5px solid ${theme.colors.axis};cursor:pointer;z-index:2}`,
    `thead th:focus-visible{outline:2px solid ${theme.colors.categorical[0]};outline-offset:-2px}`,
    `thead tr.spanners th.spanner{text-align:center;font-size:${metrics.small}px;border-bottom:1px solid ${theme.colors.grid};cursor:default}`,
    `tbody tr.group th{text-align:left;font-size:${metrics.small}px;background:${withAlpha(theme.colors.text, 0.045)};border-bottom:1px solid ${theme.colors.grid}}`,
    `tbody tr.highlight{background:${withAlpha(theme.colors.highlight, 0.12)}}`,
    `tbody tr[hidden]{display:none}`,
    `tfoot th{border-top:1.5px solid ${theme.colors.axis};border-bottom:none;font-weight:600;text-align:left}`,
    `.align-left{text-align:left}.align-right{text-align:right}.align-center{text-align:center}`,
    `.plot svg{display:block;margin-left:auto}`,
    `.align-left.plot svg{margin-left:0}`,
    `td.plot{line-height:0}`,
    `.tools{display:flex;gap:8px;align-items:center;margin:10px 0 0;flex-wrap:wrap}`,
    `.tools input{flex:1 1 220px;min-width:160px;padding:6px 8px;border:1px solid ${theme.colors.grid};border-radius:4px;background:${theme.colors.background};color:${theme.colors.text};font:inherit}`,
    `.tools button{padding:6px 10px;border:1px solid ${theme.colors.grid};border-radius:4px;background:${withAlpha(theme.colors.text, 0.05)};color:${theme.colors.text};font:inherit;cursor:pointer}`,
    `.tools button:hover{background:${withAlpha(theme.colors.text, 0.09)}}`,
    `#status{font-size:${metrics.small}px;color:${theme.colors.muted}}`,
    `.sort{margin-left:6px;font-size:${metrics.small}px;color:${theme.colors.muted}}`,
    `.foot{display:flex;gap:12px;justify-content:space-between;margin-top:10px;font-size:${metrics.small}px;color:${theme.colors.axis};flex-wrap:wrap}`,
    `@media print{thead th{position:static}.tools,.sort{display:none}}`,
  ].join("\n")

  const script = `(function(){
  var table=document.getElementById(${JSON.stringify(tableId)});
  if(!table){return}
  var body=table.tBodies[0], head=table.tHead, status=document.getElementById(${JSON.stringify(`${tableId}-status`)}), search=document.getElementById(${JSON.stringify(`${tableId}-search`)}), copy=document.getElementById(${JSON.stringify(`${tableId}-copy`)});
  function cellValue(cell){var raw=cell.getAttribute("data-sort-value");var number=Number(raw);return raw!==null&&raw!==""&&!isNaN(number)?number:(raw||"")}
  function dataRows(){return Array.prototype.slice.call(body.rows).filter(function(row){return row.hasAttribute("data-row")})}
  function order(compare){
    var groups={},names=[];
    dataRows().forEach(function(row){var key=row.getAttribute("data-group")||"0";if(!groups[key]){groups[key]=[];names.push(key)}groups[key].push(row)});
    names.forEach(function(key){
      var rows=groups[key].sort(compare);
      var marker=body.querySelector('tr[data-group-head="'+key+'"]');
      if(marker){body.appendChild(marker)}
      rows.forEach(function(row){body.appendChild(row)});
    });
  }
  function sortBy(index, ascending){
    order(function(a,b){
      var x=cellValue(a.cells[index]), y=cellValue(b.cells[index]);
      var result=typeof x==="number"&&typeof y==="number"?x-y:String(x).localeCompare(String(y));
      return ascending?result:-result;
    });
  }
  function headers(){return head?Array.prototype.slice.call(head.querySelectorAll("th[data-index]")):[]}
  headers().forEach(function(th){
    var index=Number(th.getAttribute("data-index"));
    function activate(){
      var ascending=th.getAttribute("aria-sort")!=="ascending";
      headers().forEach(function(other){
        other.setAttribute("aria-sort","none");
        var mark=other.querySelector(".sort"); if(mark){mark.textContent=""}
      });
      th.setAttribute("aria-sort",ascending?"ascending":"descending");
      var mark=th.querySelector(".sort"); if(mark){mark.textContent=ascending?"\\u25B2":"\\u25BC"}
      sortBy(index,ascending);
      filter();
    }
    th.addEventListener("click",activate);
    th.addEventListener("keydown",function(event){if(event.key==="Enter"||event.key===" "){event.preventDefault();activate()}});
  });
  function filter(){
    var query=(search&&search.value?search.value:"").toLowerCase();
    var visible=0;
    dataRows().forEach(function(row){var hit=!query||row.textContent.toLowerCase().indexOf(query)>=0;row.hidden=!hit;if(hit){visible++}});
    Array.prototype.forEach.call(body.querySelectorAll("tr.group"),function(marker){
      var next=marker.nextElementSibling, any=false;
      while(next&&next.hasAttribute("data-row")){if(!next.hidden){any=true}next=next.nextElementSibling}
      marker.hidden=!any;
    });
    if(status){status.textContent=query&&search?visible+" of "+dataRows().length+" rows":""}
    return visible;
  }
  if(search){search.addEventListener("input",filter)}
  if(copy){copy.addEventListener("click",function(){
    var lines=[];
    if(head){var labels=[];Array.prototype.forEach.call(head.querySelectorAll("th[data-index]"),function(th){labels.push(th.textContent.replace(/[\\u25B2\\u25BC]/g,"").trim())});lines.push(labels.join("\\t"))}
    dataRows().forEach(function(row){if(row.hidden){return}var cells=[];Array.prototype.forEach.call(row.cells,function(cell){cells.push(cell.getAttribute("data-tsv")||"")});lines.push(cells.join("\\t"))});
    var value=lines.join("\\n");
    function done(ok){if(status){status.textContent=ok?"Copied "+dataRows().length+" rows as TSV":"Select the selected text and copy it"}if(copy){copy.textContent=ok?"Copied":"Copy TSV"}}
    if(navigator.clipboard&&navigator.clipboard.writeText){navigator.clipboard.writeText(value).then(function(){done(true)},function(){done(false)})}
    else{var area=document.createElement("textarea");area.value=value;area.setAttribute("aria-label","Table TSV");document.body.appendChild(area);area.select();if(status){status.textContent="Press Ctrl+C (Cmd+C) to copy the selected TSV"}window.setTimeout(function(){document.body.removeChild(area)},8000)}
  })}
})()`

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeText(spec.title ?? "Table")}</title>
<style>
${css}
</style>
</head>
<body>
<div class="table-wrap">
<table id="${tableId}" role="grid" aria-label="${escapeText(spec.title ?? "Table")}">
${caption ? `<caption>${caption}</caption>` : ""}
<colgroup>${widths.map(width => `<col style="width:${width}px">`).join("")}</colgroup>
<thead>
${head.join("\n")}
</thead>
<tbody>
${body.join("\n")}
</tbody>
${footer.length ? `<tfoot>\n${footer.join("\n")}\n</tfoot>` : ""}
</table>
</div>
<div class="tools">
<input id="${tableId}-search" type="search" placeholder="Filter rows" aria-label="Filter rows">
<button id="${tableId}-copy" type="button" aria-label="Copy the table as TSV">Copy TSV</button>
<span id="${tableId}-status" role="status" aria-live="polite"></span>
</div>
<div class="foot"><span>${escapeText(spec.notes ?? "")}</span><span>${escapeText(spec.source ?? "")}</span></div>
<script>
${script}
</script>
</body>
</html>`
}
