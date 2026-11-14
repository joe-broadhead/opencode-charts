/**
 * Terminal charts: a small, dependency-free renderer for the kinds of chart a fence in a conversation can ask for.
 *
 * Every function here is pure. The same spec and the same width give the same text on every platform, which is what
 * lets a fence render live while it streams and lets a server preview match what the terminal shows. The output uses
 * only single-width characters — 2x4 Braille dots for curves, 1/8 blocks for bars, sparkline blocks and box drawing —
 * so a line's `length` is its width on screen even with colour codes removed.
 */

/** The chart kinds this renderer draws. */
export type TerminalChartType = "bar" | "horizontal_bar" | "line" | "multi_line" | "area" | "scatter" | "sparkline" | "pie" | "donut" | "table"

/** One point on a series: an x label and the y value at it. */
export interface TerminalChartPoint {
  readonly x: string
  readonly y: number
}

/** One named series. A single-series chart has one; a multi-line chart has one per colour group. */
export interface TerminalChartSeries {
  readonly name: string
  readonly points: readonly TerminalChartPoint[]
}

/** A fence's JSON, either this renderer's own shape or a Vega-Lite-shaped object it understands. */
export interface TerminalChartInput {
  readonly type?: string
  readonly mark?: string | { readonly type?: string; readonly innerRadius?: number }
  readonly title?: string | { readonly text?: string }
  readonly unit?: string
  readonly data?: unknown
  readonly values?: readonly (number | null)[]
  readonly labels?: readonly (string | number)[]
  readonly columns?: readonly string[]
  readonly rows?: readonly (readonly unknown[])[]
  readonly x?: string
  readonly y?: string | readonly string[]
  readonly series?: string | readonly { readonly name?: string; readonly values?: readonly (number | null)[] }[]
  readonly encoding?: {
    readonly x?: AxisSpec
    readonly y?: AxisSpec
    readonly color?: AxisSpec
  }
  readonly width?: number
  readonly height?: number
  readonly ansi?: boolean
}

/** An encoding channel: a field name, or the object a Vega-Lite spec puts there. */
export type AxisSpec = string | { readonly field?: string; readonly title?: string | { readonly text?: string } }

/** The normalized chart every renderer works from. */
export interface TerminalChartModel {
  readonly type: TerminalChartType
  readonly title: string
  readonly unit: string
  readonly series: readonly TerminalChartSeries[]
  readonly columns: readonly string[]
  readonly rows: readonly (readonly unknown[])[]
}

/** Options shared by the renderers. */
export interface TerminalChartOptions {
  readonly width?: number
  readonly height?: number
  readonly ansi?: boolean
}

const RESET = "\u001b[0m"
const STYLES = { bold: "\u001b[1m", dim: "\u001b[2m" } as const
/** Categorical colours, bright enough on a dark terminal and legible on a light one. */
const COLORS = [36, 35, 33, 32, 34, 31, 96, 95] as const

/** The blocks a bar is drawn from, at 1/8 of a cell each. */
const EIGHTHS = ["", "▏", "▎", "▍", "▌", "▋", "▊", "▉"] as const
/** The blocks a sparkline is drawn from, lowest to highest. */
const SPARK = ["▁", "▂", "▃", "▄", "▅", "▆", "▇", "█"] as const
/** The fills a pie strip is drawn from. */
const SHADES = ["█", "▓", "▒", "░", "▙", "▚", "▞", "▛"] as const

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value)

/** A finite number from a number or a numeric string; undefined for anything else. */
export function toNumber(value: unknown): number | undefined {
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : undefined
  }
  return undefined
}

/** 1234 becomes "1.23k"; the exact number when it is short. */
export function formatCompact(value: number): string {
  const abs = Math.abs(value)
  const units: readonly [number, string][] = [
    [1e12, "T"],
    [1e9, "B"],
    [1e6, "M"],
    [1e3, "k"],
  ]
  for (const [size, suffix] of units) {
    if (abs >= size) return `${trimNumber(value / size)}${suffix}`
  }
  return trimNumber(value)
}

function trimNumber(value: number): string {
  const rounded = Math.round(value * 100) / 100
  if (Object.is(rounded, -0)) return "0"
  return String(rounded)
}

const clip = (text: string, width: number): string => {
  if (width <= 0) return ""
  const chars = Array.from(text)
  if (chars.length <= width) return text
  if (width === 1) return "…"
  return `${chars.slice(0, width - 1).join("")}…`
}

const pad = (text: string, width: number, side: "start" | "end" = "end"): string => {
  const clipped = clip(text, width)
  const fill = " ".repeat(Math.max(0, width - clipped.length))
  return side === "start" ? `${fill}${clipped}` : `${clipped}${fill}`
}

/** The text without its ANSI styling, for measuring. */
export const stripAnsi = (text: string): string => text.replace(/\u001b\[[0-9;]*m/g, "")

const paint = (text: string, style: "bold" | "dim" | number, ansi: boolean): string => {
  if (!ansi) return text
  const code = typeof style === "number" ? `\u001b[${style}m` : STYLES[style]
  return `${code}${text}${RESET}`
}

/** The one-line result of a chart: its text, never wider than the requested width. */
export const textWidth = (text: string): number => stripAnsi(text).length

/* ---------------------------------------------------------------------------------------------- Braille canvas */

const LEFT_BITS = [0x01, 0x02, 0x04, 0x40] as const
const RIGHT_BITS = [0x08, 0x10, 0x20, 0x80] as const

/**
 * A 2x4 dot matrix per terminal cell. Coordinates are pixels: x runs left to right, y runs top to bottom, and every
 * cell holds one Braille character (U+2800 plus the bits of its dots). Each cell also carries a colour index, so a
 * multi-series curve keeps its series' colour wherever two curves pass through the same cell.
 */
export class BrailleCanvas {
  readonly columns: number
  readonly rows: number
  readonly pixelWidth: number
  readonly pixelHeight: number
  private readonly bits: Uint8Array
  private readonly marks: Int16Array

  constructor(columns: number, rows: number) {
    this.columns = Math.max(1, Math.floor(columns))
    this.rows = Math.max(1, Math.floor(rows))
    this.pixelWidth = this.columns * 2
    this.pixelHeight = this.rows * 4
    this.bits = new Uint8Array(this.columns * this.rows)
    this.marks = new Int16Array(this.columns * this.rows).fill(-1)
  }

  /** Lights one dot. Out-of-range coordinates are ignored. */
  set(x: number, y: number, color = 0): this {
    const px = Math.round(x)
    const py = Math.round(y)
    if (px < 0 || py < 0 || px >= this.pixelWidth || py >= this.pixelHeight) return this
    const cell = (py >> 2) * this.columns + (px >> 1)
    const bit = px & 1 ? RIGHT_BITS[py & 3]! : LEFT_BITS[py & 3]!
    this.bits[cell] = this.bits[cell]! | bit
    if (this.marks[cell]! < 0) this.marks[cell] = color
    return this
  }

  /** Lights one dot; an alias that reads better for scatter points. */
  dot(x: number, y: number, color = 0): this {
    return this.set(x, y, color)
  }

  /** A straight line between two pixel positions. */
  line(x0: number, y0: number, x1: number, y1: number, color = 0): this {
    let x = Math.round(x0)
    let y = Math.round(y0)
    const endX = Math.round(x1)
    const endY = Math.round(y1)
    const dx = Math.abs(endX - x)
    const dy = -Math.abs(endY - y)
    const stepX = x < endX ? 1 : -1
    const stepY = y < endY ? 1 : -1
    let error = dx + dy
    for (;;) {
      this.set(x, y, color)
      if (x === endX && y === endY) break
      const twice = error * 2
      if (twice >= dy) {
        error += dy
        x += stepX
      }
      if (twice <= dx) {
        error += dx
        y += stepY
      }
    }
    return this
  }

  /** Fills the pixels of one column from a dot down to the baseline. */
  fillDown(x: number, fromY: number, color = 0): this {
    const px = Math.round(x)
    const top = Math.max(0, Math.min(this.pixelHeight - 1, Math.round(fromY)))
    for (let y = top; y < this.pixelHeight; y++) this.set(px, y, color)
    return this
  }

  /** The character of one cell, or a space while it has no dots. */
  charAt(column: number, row: number): string {
    if (column < 0 || row < 0 || column >= this.columns || row >= this.rows) return " "
    const bits = this.bits[row * this.columns + column]!
    return bits === 0 ? " " : String.fromCharCode(0x2800 + bits)
  }

  /** The colour index of one cell; -1 for a cell with no dots. */
  colorAt(column: number, row: number): number {
    if (column < 0 || row < 0 || column >= this.columns || row >= this.rows) return -1
    return this.marks[row * this.columns + column]!
  }

  /** Every row as text and, per cell, its colour index; the row's characters are single width. */
  lines(): { text: string; colors: number[] }[] {
    const out: { text: string; colors: number[] }[] = []
    for (let row = 0; row < this.rows; row++) {
      let text = ""
      const colors: number[] = []
      for (let column = 0; column < this.columns; column++) {
        text += this.charAt(column, row)
        colors.push(this.colorAt(column, row))
      }
      out.push({ text, colors })
    }
    return out
  }

  toString(): string {
    return this.lines().map(line => line.text).join("\n")
  }
}

/* ------------------------------------------------------------------------------------------------ normalization */

const axisField = (axis: AxisSpec | undefined): string | undefined => {
  if (typeof axis === "string") return axis
  if (isRecord(axis) && typeof axis.field === "string") return axis.field
  return undefined
}

const axisTitle = (axis: AxisSpec | undefined): string | undefined => {
  if (isRecord(axis)) {
    if (typeof axis.title === "string") return axis.title
    if (isRecord(axis.title) && typeof axis.title.text === "string") return axis.title.text
  }
  return undefined
}

const TYPE_ALIASES: Readonly<Record<string, TerminalChartType>> = {
  bar: "bar",
  column: "bar",
  horizontalbar: "horizontal_bar",
  horizontal: "horizontal_bar",
  hbar: "horizontal_bar",
  line: "line",
  multiline: "multi_line",
  multilinechart: "multi_line",
  area: "area",
  scatter: "scatter",
  point: "scatter",
  circle: "scatter",
  square: "scatter",
  tick: "scatter",
  sparkline: "sparkline",
  pie: "pie",
  arc: "pie",
  donut: "donut",
  doughnut: "donut",
  table: "table",
}

/** The chart kind a spec asks for, with Vega-Lite marks mapped onto it. */
export function chartType(input: TerminalChartInput): TerminalChartType {
  const mark = input.mark
  const raw = typeof input.type === "string" ? input.type : typeof mark === "string" ? mark : isRecord(mark) && typeof mark.type === "string" ? mark.type : undefined
  const key = (raw ?? "bar").toLowerCase().replace(/[\s_-]/g, "")
  if (key === "arc" && isRecord(mark) && toNumber(mark.innerRadius) !== undefined && toNumber(mark.innerRadius)! > 0) return "donut"
  return TYPE_ALIASES[key] ?? "bar"
}

function titleText(title: TerminalChartInput["title"]): string {
  if (typeof title === "string") return title
  if (isRecord(title) && typeof title.text === "string") return title.text
  return ""
}

/** The rows a spec carries: its data array, a Vega-Lite `data.values`, numeric values, or nothing. */
function dataRows(input: TerminalChartInput): unknown[] {
  const data = input.data
  if (Array.isArray(data)) return data
  if (isRecord(data)) {
    if (Array.isArray(data.values)) return data.values
    if (Array.isArray(data.rows)) return data.rows
  }
  return []
}

function objectRows(input: TerminalChartInput): Record<string, unknown>[] {
  return dataRows(input).filter(isRecord)
}

function namedSeries(input: TerminalChartInput): TerminalChartSeries[] | undefined {
  const series = input.series
  if (!Array.isArray(series)) return undefined
  const labels = input.labels ?? []
  const out = series.filter(isRecord).map((entry, index) => {
    const values = Array.isArray(entry.values) ? entry.values : []
    return {
      name: typeof entry.name === "string" && entry.name !== "" ? entry.name : `Series ${index + 1}`,
      points: values.map((value, position) => ({ x: String(labels[position] ?? position + 1), y: toNumber(value) ?? 0 })),
    }
  })
  return out.length ? out : undefined
}

function numericSeries(input: TerminalChartInput): TerminalChartSeries[] | undefined {
  if (!Array.isArray(input.values)) return undefined
  const labels = input.labels ?? []
  return [
    {
      name: seriesName(input) ?? "Value",
      points: input.values.map((value, index) => ({ x: String(labels[index] ?? index + 1), y: toNumber(value) ?? 0 })),
    },
  ]
}

function seriesName(input: TerminalChartInput): string | undefined {
  const y = input.encoding?.y
  if (typeof input.y === "string") return input.y
  if (Array.isArray(input.y) && input.y.length === 1) return input.y[0]
  return axisTitle(y) ?? axisField(y)
}

function recordSeries(input: TerminalChartInput): TerminalChartSeries[] | undefined {
  const objects = objectRows(input)
  if (!objects.length) return undefined
  const first = objects[0]!
  const keys = Object.keys(first)
  const xField = axisField(input.encoding?.x) ?? input.x ?? keys.find(key => typeof first[key] === "string") ?? keys[0] ?? "x"
  const requested = axisField(input.encoding?.y)
  const declared = Array.isArray(input.y) ? input.y : input.y ? [input.y] : []
  const numeric = keys.filter(key => objects.some(row => toNumber(row[key]) !== undefined))
  const yFields = requested ? [requested] : declared.length ? [...declared] : [numeric[0] ?? keys[1] ?? "y"]
  const seriesField = axisField(input.encoding?.color) ?? (typeof input.series === "string" ? input.series : undefined)
  const label = (row: Record<string, unknown>, index: number): string => {
    const value = row[xField]
    if (value === undefined || value === null) return String(index + 1)
    return String(value)
  }
  if (seriesField && keys.includes(seriesField) && yFields.length === 1) {
    const field = yFields[0]!
    const groups = new Map<string, TerminalChartPoint[]>()
    objects.forEach((row, index) => {
      const name = row[seriesField] === undefined || row[seriesField] === null ? "—" : String(row[seriesField])
      const points = groups.get(name) ?? []
      points.push({ x: label(row, index), y: toNumber(row[field]) ?? 0 })
      groups.set(name, points)
    })
    return [...groups].map(([name, points]) => ({ name, points }))
  }
  return yFields.map(field => ({
    name: yFields.length > 1 ? field : seriesName(input) ?? field,
    points: objects.map((row, index) => ({ x: label(row, index), y: toNumber(row[field]) ?? 0 })),
  }))
}

/** The chart as its renderers need it. */
export function normalizeChart(input: TerminalChartInput): TerminalChartModel {
  const type = chartType(input)
  const title = titleText(input.title)
  const unit = input.unit ?? axisTitle(input.encoding?.y) ?? ""
  if (type === "table") {
    const objects = objectRows(input)
    const columns = input.columns ?? (objects.length ? Object.keys(objects[0]!) : ["value"])
    const rows = input.rows ?? (objects.length ? objects.map(row => columns.map(column => row[column])) : [])
    const numeric = !objects.length && Array.isArray(input.values)
    return {
      type,
      title,
      unit,
      series: [],
      columns: numeric ? (input.columns ?? ["x", seriesName(input) ?? "value"]) : columns,
      rows: numeric ? (input.values ?? []).map((value, index) => [input.labels?.[index] ?? index + 1, value]) : rows,
    }
  }
  const series = namedSeries(input) ?? recordSeries(input) ?? numericSeries(input) ?? []
  return { type, title, unit, series: series.filter(entry => entry.points.length > 0), columns: [], rows: [] }
}

/* ---------------------------------------------------------------------------------------------------- renderers */

const colorOf = (index: number): number => COLORS[index % COLORS.length]!

function headerLines(model: TerminalChartModel, width: number, ansi: boolean): string[] {
  const lines: string[] = []
  if (model.title) lines.push(paint(clip(model.title, width), "bold", ansi))
  if (model.unit) lines.push(paint(clip(`Unit: ${model.unit}`, width), "dim", ansi))
  return lines
}

function blockBar(value: number, maximum: number, cells: number): string {
  const ratio = maximum === 0 ? 0 : Math.min(1, Math.abs(value) / maximum)
  const eighths = Math.round(ratio * cells * 8)
  const full = Math.floor(eighths / 8)
  const rest = eighths % 8
  return `${"█".repeat(full)}${EIGHTHS[rest]!}`
}

function renderBars(model: TerminalChartModel, width: number, height: number, ansi: boolean): string[] {
  const points = [...(model.series[0]?.points ?? [])].sort((left, right) => right.y - left.y)
  const lines = headerLines(model, width, ansi)
  if (!points.length) return [...lines, paint("No data", "dim", ansi)]
  const maximum = points.reduce((most, point) => Math.max(most, Math.abs(point.y)), 0)
  const values = points.map(point => formatCompact(point.y))
  const valueWidth = values.reduce((most, value) => Math.max(most, value.length), 1)
  const labelWidth = Math.min(24, Math.max(3, points.reduce((most, point) => Math.max(most, point.x.length), 3)))
  const barWidth = Math.max(1, width - labelWidth - valueWidth - 3)
  const room = Math.max(0, height - lines.length)
  const shown = points.length > room ? points.slice(0, Math.max(0, room - 1)) : points
  shown.forEach((point, index) => {
    const bar = paint(pad(blockBar(point.y, maximum, barWidth), barWidth), colorOf(index), ansi)
    lines.push(`${pad(point.x, labelWidth)} ${bar} ${pad(values[index]!, valueWidth, "start")}`)
  })
  const hidden = points.length - shown.length
  if (hidden > 0) lines.push(paint(clip(`… ${hidden} more`, width), "dim", ansi))
  return lines
}

function xLabels(plotWidth: number, labels: readonly string[]): string {
  const left = clip(labels[0] ?? "", plotWidth)
  const right = clip(labels[labels.length - 1] ?? "", plotWidth)
  const cells = Array.from(" ".repeat(plotWidth))
  const place = (text: string, at: number): void => {
    Array.from(text).forEach((character, index) => {
      const position = at + index
      if (position >= 0 && position < cells.length) cells[position] = character
    })
  }
  if (labels.length < 3 || plotWidth < 12) {
    place(left, 0)
    if (right !== left) place(right, plotWidth - right.length)
    return cells.join("")
  }
  const middle = clip(labels[1] ?? "", plotWidth)
  const middleAt = Math.max(0, Math.floor((plotWidth - middle.length) / 2))
  place(left, 0)
  if (middleAt >= left.length + 1 && middleAt + middle.length <= plotWidth - right.length - 1) place(middle, middleAt)
  place(right, plotWidth - right.length)
  return cells.join("")
}

function legendLine(series: readonly TerminalChartSeries[], width: number, ansi: boolean): string {
  let plain = ""
  let painted = ""
  series.forEach((entry, index) => {
    const name = clip(entry.name, 18)
    const plainPiece = `${plain ? "  " : ""}● ${name}`
    if (plain.length + plainPiece.length > width) {
      if (!plain) painted = clip(plainPiece, width)
      return
    }
    plain += plainPiece
    painted += `${painted ? "  " : ""}${paint("●", colorOf(index), ansi)} ${name}`
  })
  return painted
}

function renderBrailleChart(model: TerminalChartModel, width: number, height: number, ansi: boolean): string[] {
  const series = model.series
  if (!series.length) return [...headerLines(model, width, ansi), paint("No data", "dim", ansi)]
  const all = series.flatMap(entry => entry.points.map(point => point.y))
  let minimum = Math.min(...all)
  let maximum = Math.max(...all)
  if (minimum === maximum) {
    minimum -= 1
    maximum += 1
  }
  const middle = (minimum + maximum) / 2
  const ticks = [maximum, middle, minimum].map(value => formatCompact(value))
  const tickWidth = ticks.reduce((most, tick) => Math.max(most, tick.length), 1)
  const plotWidth = Math.max(4, width - tickWidth - 2)
  const legend = series.length > 0
  const plotRows = Math.max(2, height - 2 - (legend ? 1 : 0))
  const canvas = new BrailleCanvas(plotWidth, plotRows)
  const pixelsWide = canvas.pixelWidth
  const pixelsHigh = canvas.pixelHeight
  const yOf = (value: number): number => Math.round(((maximum - value) / (maximum - minimum)) * (pixelsHigh - 1))
  const scatter = model.type === "scatter"
  series.forEach((entry, index) => {
    const count = entry.points.length
    const xOf = (position: number): number => (count <= 1 ? 0 : Math.round((position / (count - 1)) * (pixelsWide - 1)))
    if (model.type === "area") {
      for (let position = 0; position < count; position++) {
        const point = entry.points[position]!
        const next = entry.points[position + 1]
        const fromX = xOf(position)
        const fromY = yOf(point.y)
        if (!next) {
          canvas.fillDown(fromX, fromY, index)
          continue
        }
        const toX = xOf(position + 1)
        const toY = yOf(next.y)
        for (let x = fromX; x < toX; x++) {
          const ratio = toX === fromX ? 0 : (x - fromX) / (toX - fromX)
          canvas.fillDown(x, Math.round(fromY + (toY - fromY) * ratio), index)
        }
      }
    }
    entry.points.forEach((point, position) => {
      const x = xOf(position)
      const y = yOf(point.y)
      if (scatter) canvas.set(x, y, index)
      else if (position > 0) {
        const previous = entry.points[position - 1]!
        canvas.line(xOf(position - 1), yOf(previous.y), x, y, index)
      } else canvas.set(x, y, index)
    })
  })
  const lines = headerLines(model, width, ansi)
  const rows = canvas.lines()
  const tickRows = new Map<number, string>([
    [0, ticks[0]!],
    [Math.floor((plotRows - 1) / 2), ticks[1]!],
    [plotRows - 1, ticks[2]!],
  ])
  rows.forEach((row, index) => {
    let body = ""
    row.text.split("").forEach((character, column) => {
      const color = row.colors[column] ?? -1
      body += character === " " || color < 0 ? character : paint(character, colorOf(color), ansi)
    })
    const tick = tickRows.get(index)
    const axis = index === plotRows - 1 ? "└" : "┤"
    lines.push(`${pad(tick ?? "", tickWidth)} ${axis}${body}`)
  })
  const first = series[0]!.points
  const last = series.reduce((longest, entry) => (entry.points.length > longest.points.length ? entry : longest), series[0]!).points
  const labels = scatter
    ? [first[0]?.x ?? "", first[Math.floor((first.length - 1) / 2)]?.x ?? "", last[last.length - 1]?.x ?? ""]
    : [first[0]?.x ?? "", last[last.length - 1]?.x ?? ""]
  lines.push(`${" ".repeat(tickWidth + 1)} ${xLabels(plotWidth, labels)}`)
  if (legend) lines.push(legendLine(series, width, ansi))
  return lines
}

function renderSparkline(model: TerminalChartModel, width: number, height: number, ansi: boolean): string[] {
  const points = model.series[0]?.points ?? []
  const lines = headerLines(model, width, ansi)
  if (!points.length) return [...lines, paint("No data", "dim", ansi)]
  const values = points.map(point => point.y)
  const minimum = Math.min(...values)
  const maximum = Math.max(...values)
  const span = maximum - minimum
  const room = Math.max(1, Math.min(width, points.length))
  const taken = points.slice(points.length - room)
  const spark = taken
    .map(point => {
      const level = span === 0 ? 0 : Math.round(((point.y - minimum) / span) * (SPARK.length - 1))
      return paint(SPARK[Math.max(0, Math.min(SPARK.length - 1, level))]!, colorOf(0), ansi)
    })
    .join("")
  lines.push(spark)
  const lastValue = values[values.length - 1]!
  lines.push(paint(clip(`min ${formatCompact(minimum)} · last ${formatCompact(lastValue)} · max ${formatCompact(maximum)}`, width), "dim", ansi))
  return lines
}

function renderPie(model: TerminalChartModel, width: number, height: number, ansi: boolean): string[] {
  const points = model.series[0]?.points ?? []
  const lines = headerLines(model, width, ansi)
  if (!points.length) return [...lines, paint("No data", "dim", ansi)]
  const positive = points.map(point => ({ ...point, y: Math.max(0, point.y) }))
  const total = positive.reduce((sum, point) => sum + point.y, 0)
  const stripWidth = Math.max(1, Math.min(width, 72))
  const shares = positive.map(point => (total === 0 ? 0 : point.y / total))
  let filled = 0
  let strip = ""
  shares.forEach((share, index) => {
    const end = Math.round((shares.slice(0, index + 1).reduce((sum, part) => sum + part, 0)) * stripWidth)
    const cells = Math.max(0, end - filled)
    filled += cells
    strip += paint(SHADES[index % SHADES.length]!.repeat(cells), colorOf(index), ansi)
  })
  strip += " ".repeat(Math.max(0, stripWidth - filled))
  lines.push(strip)
  const entries = points.map((point, index) => {
    const percent = total === 0 ? 0 : Math.round((Math.max(0, point.y) / total) * 100)
    return { plain: `${SHADES[index % SHADES.length]} ${point.x} ${percent}%`, painted: `${paint(SHADES[index % SHADES.length]!, colorOf(index), ansi)} ${point.x} ${percent}%` }
  })
  let plain = ""
  let painted = ""
  for (const entry of entries) {
    const piece = `${plain ? " · " : ""}${entry.plain}`
    if (plain.length + piece.length > width) {
      if (!plain) painted = clip(entry.plain, width)
      break
    }
    plain += piece
    painted += `${painted ? " · " : ""}${entry.painted}`
  }
  lines.push(painted)
  if (model.type === "donut") lines.push(paint(clip(`total ${formatCompact(total)}`, width), "dim", ansi))
  if (lines.length > height) return lines.slice(0, Math.max(1, height))
  return lines
}

function cellText(value: unknown, width: number): { text: string; numeric: boolean } {
  if (Array.isArray(value)) {
    const values = value.map(item => toNumber(item) ?? 0)
    const minimum = Math.min(...values)
    const maximum = Math.max(...values)
    const span = maximum - minimum
    const spark = values
      .slice(0, Math.max(1, width))
      .map(item => SPARK[span === 0 ? 0 : Math.max(0, Math.min(SPARK.length - 1, Math.round(((item - minimum) / span) * (SPARK.length - 1))))]!)
      .join("")
    return { text: spark, numeric: false }
  }
  if (typeof value === "number") return { text: formatCompact(value), numeric: true }
  if (value === null || value === undefined) return { text: "", numeric: false }
  return { text: String(value), numeric: false }
}

function renderTable(model: TerminalChartModel, width: number, height: number, ansi: boolean): string[] {
  const lines = headerLines(model, width, ansi)
  const columns = model.columns
  if (!columns.length) return [...lines, paint("No data", "dim", ansi)]
  const body = model.rows.map(row => columns.map((_, index) => cellText(row[index], 16)))
  const widths = columns.map((column, index) => body.reduce((most, row) => Math.max(most, row[index]!.text.length), Math.max(column.length, 2)))
  const total = (): number => widths.reduce((sum, value) => sum + value, 0) + 3 * columns.length + 1
  while (total() > width) {
    let widest = -1
    widths.forEach((value, index) => {
      if (value > 3 && (widest < 0 || value > widths[widest]!)) widest = index
    })
    if (widest < 0) break
    widths[widest] = widths[widest]! - 1
  }
  const border = (left: string, middle: string, right: string): string => `${left}${widths.map(value => "─".repeat(value + 2)).join(middle)}${right}`
  const rowLine = (cells: readonly { text: string; numeric: boolean }[]): string => {
    const rendered = cells.map((cell, index) => pad(cell.text, widths[index]!, cell.numeric ? "start" : "end"))
    return `│ ${rendered.join(" │ ")} │`
  }
  lines.push(clip(border("┌", "┬", "┐"), width))
  lines.push(clip(rowLine(columns.map(column => ({ text: column, numeric: false }))), width))
  lines.push(clip(border("├", "┼", "┤"), width))
  const room = Math.max(0, height - lines.length - 1)
  const shown = body.length > room ? body.slice(0, room) : body
  for (const row of shown) lines.push(clip(rowLine(row), width))
  lines.push(clip(border("└", "┴", "┘"), width))
  return lines
}

/**
 * Draws a chart as terminal text. Width and height are the only layout inputs; colour is off by default so the text
 * can be logged, diffed or sent as a tool result, and on for a live terminal.
 */
export function renderTerminalChart(spec: TerminalChartInput, options: TerminalChartOptions = {}): string {
  const model = normalizeChart(spec)
  const width = Math.max(12, Math.min(140, Math.floor(options.width ?? spec.width ?? 64)))
  const ansi = options.ansi ?? spec.ansi ?? false
  const fallbackHeight = model.type === "bar" || model.type === "horizontal_bar" ? 30 : model.type === "table" ? 24 : model.type === "sparkline" ? 4 : 14
  const height = Math.max(3, Math.min(60, Math.floor(options.height ?? spec.height ?? fallbackHeight)))
  const lines =
    model.type === "table"
      ? renderTable(model, width, height, ansi)
      : model.type === "sparkline"
        ? renderSparkline(model, width, height, ansi)
        : model.type === "pie" || model.type === "donut"
          ? renderPie(model, width, height, ansi)
          : model.type === "line" || model.type === "multi_line" || model.type === "area" || model.type === "scatter"
            ? renderBrailleChart(model, width, height, ansi)
            : renderBars(model, width, height, ansi)
  return lines
    .map(line => {
      if (textWidth(line) <= width) return line
      // The renderers already fit their width; should a label still overflow, drop its colour rather than cut an
      // escape sequence in half.
      return clip(stripAnsi(line), width)
    })
    .join("\n")
}

/* ------------------------------------------------------------------------------------------------- fence parsing */

function fenceBody(code: string): string {
  const trimmed = code.trim()
  if (!trimmed.startsWith("```")) return trimmed
  const firstBreak = trimmed.indexOf("\n")
  if (firstBreak < 0) return ""
  const rest = trimmed.slice(firstBreak + 1)
  const closing = rest.lastIndexOf("```")
  return (closing >= 0 ? rest.slice(0, closing) : rest).trim()
}

/**
 * The chart a fenced block asks for. Accepts this renderer's own shape and the Vega-Lite shape a model often writes
 * (`mark`, `data.values`, `encoding.x/y/color`), and returns undefined for anything that is not one JSON object.
 */
export function parseChartFence(code: string): TerminalChartInput | undefined {
  const body = fenceBody(code)
  if (!body) return undefined
  let parsed: unknown
  try {
    parsed = JSON.parse(body)
  } catch {
    return undefined
  }
  if (!isRecord(parsed)) return undefined
  const encoding = isRecord(parsed.encoding) ? parsed.encoding : undefined
  const spec: TerminalChartInput = {
    type: typeof parsed.type === "string" ? parsed.type : undefined,
    mark: typeof parsed.mark === "string" || isRecord(parsed.mark) ? (parsed.mark as TerminalChartInput["mark"]) : undefined,
    title: typeof parsed.title === "string" || isRecord(parsed.title) ? (parsed.title as TerminalChartInput["title"]) : undefined,
    unit: typeof parsed.unit === "string" ? parsed.unit : undefined,
    data: parsed.data,
    x: typeof parsed.x === "string" ? parsed.x : undefined,
    y: typeof parsed.y === "string" || Array.isArray(parsed.y) ? (parsed.y as TerminalChartInput["y"]) : undefined,
    series: typeof parsed.series === "string" || Array.isArray(parsed.series) ? (parsed.series as TerminalChartInput["series"]) : undefined,
    encoding: encoding
      ? {
          x: encoding.x as AxisSpec | undefined,
          y: encoding.y as AxisSpec | undefined,
          color: encoding.color as AxisSpec | undefined,
        }
      : undefined,
    columns: Array.isArray(parsed.columns) ? (parsed.columns as string[]) : undefined,
    rows: Array.isArray(parsed.rows) ? (parsed.rows as (readonly unknown[])[]) : undefined,
    labels: Array.isArray(parsed.labels) ? (parsed.labels as (string | number)[]) : undefined,
    values: Array.isArray(parsed.values) ? (parsed.values as (number | null)[]) : undefined,
    width: toNumber(parsed.width),
    height: toNumber(parsed.height),
    ansi: typeof parsed.ansi === "boolean" ? parsed.ansi : undefined,
  }
  return spec
}

/* --------------------------------------------------------------------------------------------------- block cache */

/**
 * FNV-1a over the whole text: a 32-bit hash, cheap enough to run on every streaming token, and keyed on the full string
 * so two blocks that begin with the same 64 characters are still two blocks.
 */
function fnv1aHex(value: string): string {
  let hash = 0x811c9dc5
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash.toString(16).padStart(8, "0")
}

/** How much of a block's text identifies it while it streams: the length a key used to be truncated to. */
const STABLE_PREFIX = 64

/**
 * The last chart each fenced block drew, so a block that is still streaming keeps showing a chart instead of
 * flickering back to raw text.
 *
 * A block is identified by a hash of its **whole** text, never by a prefix: every Vega-Lite fence opens with the same
 * `$schema` line, so a 64-character key made two different blocks one entry and each overwrote the other's chart. While
 * a block streams, its text is a prefix of the text that last parsed, which is what the fallback below reads.
 */
export class ChartBlockCache {
  private readonly limit: number
  private readonly good = new Map<string, { text: string; chart: string }>()

  constructor(limit = 16) {
    this.limit = Math.max(1, Math.floor(limit))
  }

  static key(code: string): string {
    return `${code.length}:${fnv1aHex(code)}`
  }

  /** The chart for this text now, or the last chart this block drew while the text was incomplete. */
  update(code: string, options: TerminalChartOptions = {}): string | undefined {
    const key = ChartBlockCache.key(code)
    const spec = parseChartFence(code)
    if (!spec) {
      const exact = this.good.get(key)
      if (exact) return exact.chart
      // Too little of the block has arrived to say which block it is: the caller shows the plain fence.
      if (code.length < STABLE_PREFIX) return undefined
      // The block is still arriving: what it has said is the beginning of what last parsed, and that chart is still
      // the best answer. The newest entry wins, so a block edited backwards finds its most recent drawing.
      for (const entry of [...this.good.values()].reverse()) if (entry.text.startsWith(code)) return entry.chart
      return undefined
    }
    const chart = renderTerminalChart(spec, options)
    this.good.delete(key)
    this.good.set(key, { text: code, chart })
    while (this.good.size > this.limit) {
      const oldest = this.good.keys().next()
      if (oldest.done) break
      this.good.delete(oldest.value)
    }
    return chart
  }

  /** Forgets every block's chart. */
  clear(): void {
    this.good.clear()
  }

  /** How many blocks have a chart remembered. */
  get size(): number {
    return this.good.size
  }
}
