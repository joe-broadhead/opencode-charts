import { formatLocale } from "d3-format"
import { compactFormat, compactSpec } from "../engines/compact.js"
import type { BoardAggregate, BoardFilter, BoardKpi, BoardOption } from "./schema.js"

/**
 * The board's data cube: the initial filtered rows, one value per KPI, the sparkline points, and the facet choices each
 * filter offers. Computation is deterministic (no clocks, no sampling at random): the same rows and the same filters
 * give the same numbers, on the server and in the page.
 *
 * The module is deliberately host-free: no file access, no process, no network, and no query engine. `render-board.ts`
 * reads files and hands the rows in; `browser/ui-sdk.ts` reuses the pure helpers below so a click in the page
 * recomputes exactly what the static poster drew. Every group, distinct value and aggregate is a plain loop, so the
 * same code runs in a page under a Content-Security-Policy that refuses `new Function` as in Node.
 */

export type Row = Record<string, unknown>

/** The number conventions of a locale: what d3-format needs to print 1234.5 as "1.234,5" or "$1,234.50". */
export interface BoardNumberLocale {
  readonly decimal: string
  readonly thousands: string
  readonly grouping: readonly number[]
  readonly currency: readonly [string, string]
  readonly percent?: string
  readonly minus?: string
}

export interface BoardLocale {
  readonly id?: string
  readonly number: BoardNumberLocale
}

/** The most rows the page carries, across its datasets, for cross-filtering offline. */
export const CLIENT_ROW_LIMIT = 25_000
/** The most choices a filter offers when its options are read from the data. */
export const FACET_OPTION_LIMIT = 200
/** The most points a sparkline keeps; a longer series is sampled evenly, which keeps its shape. */
export const SPARK_POINT_LIMIT = 120

interface BoardDomain {
  readonly min: number
  readonly max: number
  readonly step: number
}

interface BoardOptionView {
  readonly value: string
  readonly label: string
}

interface BoardKpiView {
  readonly value: number
  readonly display: string
}

interface BoardSparkView {
  /** `[index, value]` pairs in x order: what the poster and the page draw. */
  readonly points: readonly (readonly [number, number])[]
  /** The x value behind each point, for the page's tooltip. */
  readonly labels: readonly string[]
}

export interface BoardCube {
  /** Rows read per dataset. */
  readonly rows: Readonly<Record<string, number>>
  /** Rows the page carries per dataset (the first `CLIENT_ROW_LIMIT` across all of them). */
  readonly clientRows: Readonly<Record<string, number>>
  /** The rows the page carries, unfiltered, so a filter can be widened again offline. */
  readonly client: Readonly<Record<string, readonly Row[]>>
  /** Rows left after the initial filters, per dataset. */
  readonly shown: Readonly<Record<string, number>>
  /** The rows the poster draws, per dataset: the initial filters applied. */
  readonly filtered: Readonly<Record<string, readonly Row[]>>
  /** Each filter's initial value. */
  readonly filters: Readonly<Record<string, unknown>>
  /** The facet choices each filter offers, by filter id. */
  readonly facets: Readonly<Record<string, readonly BoardOptionView[]>>
  /** A numeric field's extent and a usable step, by filter id (range controls). */
  readonly domains: Readonly<Record<string, BoardDomain>>
  /** Each KPI's number and its formatted text. */
  readonly kpis: Readonly<Record<string, BoardKpiView>>
  /** Each KPI's sparkline, when it asks for one. */
  readonly sparks: Readonly<Record<string, BoardSparkView>>
}

// ---------------------------------------------------------------------------------------------------------------
// Numbers and their format.

const FORMATTERS = new WeakMap<object, ReturnType<typeof formatLocale>>()
function localeFormat(locale: BoardLocale) {
  const key = locale.number as unknown as object
  const cached = FORMATTERS.get(key)
  if (cached) return cached
  const formatter = formatLocale({
    decimal: locale.number.decimal,
    thousands: locale.number.thousands,
    grouping: [...locale.number.grouping],
    currency: [locale.number.currency[0], locale.number.currency[1]],
    ...(locale.number.percent !== undefined ? { percent: locale.number.percent } : {}),
    ...(locale.number.minus !== undefined ? { minus: locale.number.minus } : {}),
  })
  FORMATTERS.set(key, formatter)
  return formatter
}

const DEFAULT_DECIMALS: Readonly<Record<string, number>> = { currency: 0, percent: 1, number: 1, integer: 0, compact: 0 }

interface BoardValueFormat {
  readonly format?: string
  readonly decimals?: number
  readonly prefix?: string
  readonly suffix?: string
}

/** The number a cell holds: a finite number, a numeric string, or undefined. */
export function numeric(value: unknown): number | undefined {
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value)
    return Number.isFinite(n) ? n : undefined
  }
  return undefined
}

/** The d3-format specifier behind a board format name, and whether percent maths applies (d3's % scales by 100). */
function specifier(format: string | undefined, decimals: number | undefined): string {
  const digits = decimals ?? DEFAULT_DECIMALS[format ?? "number"] ?? 1
  if (format === undefined) return `,.${digits}f`
  if (format === "integer") return ",.0f"
  if (format === "number") return `,.${digits}f`
  if (format === "currency") return `$,.${digits}f`
  if (format === "percent") return `.${digits}%`
  // Anything else is a d3-format specifier the caller wrote, such as ",.1f" or "+.2s".
  return format
}

/** One number as the board prints it: the format, then the prefix and suffix around it. */
export function formatValue(value: number, options: BoardValueFormat, locale: BoardLocale): string {
  const prefix = options.prefix ?? ""
  const suffix = options.suffix ?? ""
  if (!Number.isFinite(value)) return `${prefix}–${suffix}`
  if (options.format === "compact") return `${prefix}${compactFormat(value, compactSpec(locale.number.currency as [string, string], locale.number.decimal))}${suffix}`
  try {
    return `${prefix}${localeFormat(locale).format(specifier(options.format, options.decimals))(value)}${suffix}`
  } catch {
    return `${prefix}${String(value)}${suffix}`
  }
}

/** A table cell as text: numbers through the same formats, booleans as yes and no, nothing as an en dash. */
export function formatCell(value: unknown, format: string | undefined, locale: BoardLocale): string {
  if (value === null || value === undefined || value === "") return "–"
  if (typeof value === "number") return format === undefined ? value.toLocaleString(locale.id ?? "en-US") : formatValue(value, { format }, locale)
  if (typeof value === "boolean") return value ? "yes" : "no"
  if (typeof value === "object") return JSON.stringify(value)
  const text = String(value)
  if (format === undefined) return text
  const n = numeric(text)
  return n === undefined ? text : formatValue(n, { format }, locale)
}

/** A numeric field's extent and a step that puts about ten stops on a slider. */
export function domainOf(rows: readonly Row[], field: string): BoardDomain {
  let min = Infinity
  let max = -Infinity
  for (const row of rows) {
    const n = numeric(row[field])
    if (n === undefined) continue
    if (n < min) min = n
    if (n > max) max = n
  }
  if (!Number.isFinite(min) || !Number.isFinite(max)) return { min: 0, max: 1, step: 1 }
  if (min === max) return { min, max: min + 1, step: 1 }
  const raw = (max - min) / 10
  const magnitude = 10 ** Math.floor(Math.log10(raw))
  const step = [1, 2, 2.5, 5, 10].map(m => m * magnitude).find(s => s >= raw) ?? magnitude
  const size = step > 0 ? step : 1
  // The top is the next stop on the slider's own grid, so every value the slider can hold, the top included, is a stop.
  const top = min + Math.ceil((max - min) / size) * size
  return { min, max: top, step: size }
}

/** A range value moved to the nearest stop of its domain, so the control and the filter always agree. */
export function snapRange(value: unknown, domain: BoardDomain): number {
  const n = numeric(value)
  if (n === undefined) return domain.max
  const stops = Math.round((n - domain.min) / domain.step)
  return Math.min(domain.max, Math.max(domain.min, domain.min + stops * domain.step))
}

// ---------------------------------------------------------------------------------------------------------------
// Field types, for the quick specs the renderer expands.

export type FieldType = "quantitative" | "temporal" | "nominal"
const DATE_LIKE = /^\d{4}-\d{2}(-\d{2})?([T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$/

/** The Vega-Lite type a column behaves like, read from up to 500 values: numbers, dates, or categories. */
export function fieldTypes(rows: readonly Row[]): Record<string, FieldType> {
  const names = new Set<string>()
  for (const row of rows.slice(0, 500)) for (const name of Object.keys(row)) names.add(name)
  const types: Record<string, FieldType> = {}
  for (const name of names) {
    let seen = 0
    let numbers = 0
    let dates = 0
    for (const row of rows.slice(0, 500)) {
      const value = row[name]
      if (value === null || value === undefined || value === "") continue
      seen += 1
      if (numeric(value) !== undefined && typeof value !== "string") numbers += 1
      else if (typeof value === "string" && DATE_LIKE.test(value)) dates += 1
    }
    types[name] = seen > 0 && numbers === seen ? "quantitative" : seen > 0 && dates === seen ? "temporal" : "nominal"
  }
  return types
}

// ---------------------------------------------------------------------------------------------------------------
// Aggregation.

/** One aggregate over the rows: count of rows, or a statistic of a numeric column. */
export function aggregateRows(rows: readonly Row[], aggregate: BoardAggregate, field?: string): number {
  if (aggregate === "count" && (field === undefined || field === "*")) return rows.length
  if (field === undefined || field === "*") return rows.length
  let sum = 0
  let count = 0
  let min = Infinity
  let max = -Infinity
  const values: number[] = []
  for (const row of rows) {
    const n = numeric(row[field])
    if (n === undefined) continue
    values.push(n)
    sum += n
    count += 1
    if (n < min) min = n
    if (n > max) max = n
  }
  if (count === 0) return 0
  if (aggregate === "count") return count
  if (aggregate === "sum") return sum
  if (aggregate === "mean") return sum / count
  if (aggregate === "min") return min
  if (aggregate === "max") return max
  values.sort((a, b) => a - b)
  const middle = Math.floor(values.length / 2)
  return values.length % 2 === 1 ? values[middle]! : (values[middle - 1]! + values[middle]!) / 2
}

// ---------------------------------------------------------------------------------------------------------------
// Filtering.

/** The text a filter compares: strings as they are, numbers through their plain form, nothing as empty. */
const text = (value: unknown): string => (value === null || value === undefined ? "" : typeof value === "object" ? JSON.stringify(value) : String(value))

interface AppliedFilter {
  readonly filter: Pick<BoardFilter, "id" | "field" | "control" | "dataset">
  readonly value: unknown
}

/** Whether a filter is set at all: an empty choice means every row. */
export function isFilterActive(control: string, value: unknown): boolean {
  if (value === undefined || value === null) return false
  if (control === "chips") return Array.isArray(value) && value.length > 0
  if (control === "range") return typeof value === "number" && Number.isFinite(value)
  if (control === "search") return typeof value === "string" && value.trim() !== ""
  return String(value) !== "" && String(value) !== "all"
}

/** Whether one row passes one filter. */
export function matchesFilter(row: Row, filter: Pick<BoardFilter, "field" | "control">, value: unknown): boolean {
  if (!isFilterActive(filter.control, value)) return true
  if (filter.control === "chips") {
    const chosen = new Set((Array.isArray(value) ? value : [value]).map(text))
    return chosen.has(text(row[filter.field]))
  }
  if (filter.control === "range") {
    const n = numeric(row[filter.field])
    return n !== undefined && n <= Number(value)
  }
  if (filter.control === "search") {
    const needle = String(value).trim().toLowerCase()
    if (filter.field === "*") return Object.values(row).some(cell => text(cell).toLowerCase().includes(needle))
    return text(row[filter.field]).toLowerCase().includes(needle)
  }
  return text(row[filter.field]) === text(value)
}

/**
 * The rows a set of filters leaves. A filter with a dataset narrows only that dataset; a filter without one narrows
 * every dataset that has its field, and leaves the others alone (a region filter says nothing about a channel table).
 */
export function filterRows(rows: readonly Row[], filters: readonly AppliedFilter[], dataset?: string): Row[] {
  const scoped = filters.filter(entry => entry.filter.dataset === undefined || dataset === undefined || entry.filter.dataset === dataset)
  const first = rows[0]
  const active = scoped.filter(entry => first === undefined || entry.filter.field === "*" || Object.hasOwn(first, entry.filter.field))
  if (active.length === 0) return [...rows]
  return rows.filter(row => active.every(entry => matchesFilter(row, entry.filter, entry.value)))
}

/** A filter's initial value: an empty choice, an empty chip set, the domain's top, or an empty search. */
export function normaliseFilterValue(filter: Pick<BoardFilter, "control">, raw: unknown, domain: BoardDomain): unknown {
  if (filter.control === "chips") {
    if (Array.isArray(raw)) return raw.map(text)
    if (raw === undefined || raw === null || raw === "") return []
    return [text(raw)]
  }
  if (filter.control === "range") return snapRange(raw, domain)
  if (filter.control === "search") return raw === undefined || raw === null ? "" : text(raw)
  return raw === undefined || raw === null ? "" : text(raw)
}

// ---------------------------------------------------------------------------------------------------------------
// Facets.

/** A deterministic order for facet values: numbers ascending, then text, with numbers first. */
function compareValues(a: unknown, b: unknown): number {
  const na = typeof a === "number" ? a : numeric(a)
  const nb = typeof b === "number" ? b : numeric(b)
  const aNumber = na !== undefined && !(typeof a === "string" && a.trim() === "")
  const bNumber = nb !== undefined && !(typeof b === "string" && b.trim() === "")
  if (aNumber && bNumber) return na! - nb!
  if (aNumber) return -1
  if (bNumber) return 1
  return text(a).localeCompare(text(b), "en")
}

/** The distinct values of a column as filter choices, in a stable order, at most `limit`. */
export function facetOptions(rows: readonly Row[], field: string, limit = FACET_OPTION_LIMIT): BoardOptionView[] {
  const values = rows.map(row => row[field]).filter(value => value !== null && value !== undefined && value !== "")
  values.sort(compareValues)
  const seen = new Set<string>()
  const options: BoardOptionView[] = []
  for (const value of values) {
    const key = text(value)
    if (seen.has(key)) continue
    seen.add(key)
    options.push({ value: key, label: key })
    if (options.length >= limit) break
  }
  return options
}

// ---------------------------------------------------------------------------------------------------------------
// Sparklines.

/** `[label, value]` pairs sampled to the point limit and numbered, which is what a sparkline path draws. */
function sparkOf(entries: readonly { label: string; value: number }[]): BoardSparkView {
  const stride = Math.max(1, Math.ceil(entries.length / SPARK_POINT_LIMIT))
  const kept = entries.filter((_entry, index) => index % stride === 0 || index === entries.length - 1)
  return { points: kept.map((entry, index) => [index, entry.value] as const), labels: kept.map(entry => entry.label) }
}

/**
 * A KPI's sparkline: one point per x value, in x order, the y aggregated within it. The poster and the dashboard page
 * build it with the same arithmetic (`sparkPoints`), so a cross-filtered KPI matches the drawing it replaced.
 */
export function sparkSeries(rows: readonly Row[], x: string, y: string, aggregate: "sum" | "mean" = "sum"): BoardSparkView {
  return sparkPoints(rows, x, y, aggregate)
}

/** Rows grouped by x in first-seen order, then ordered by x, and sampled to the point limit. */
export function sparkPoints(rows: readonly Row[], x: string, y: string, aggregate: "sum" | "mean" = "sum"): BoardSparkView {
  const groups = new Map<string, { label: string; raw: unknown; sum: number; count: number }>()
  for (const row of rows) {
    const label = text(row[x])
    const value = numeric(row[y])
    const group = groups.get(label)
    if (!group) groups.set(label, { label, raw: row[x], sum: value ?? 0, count: value === undefined ? 0 : 1 })
    else {
      group.sum += value ?? 0
      if (value !== undefined) group.count += 1
    }
  }
  const ordered = [...groups.values()].sort((a, b) => compareValues(a.raw, b.raw))
  return sparkOf(ordered.map(group => ({ label: group.label, value: aggregate === "mean" ? (group.count ? group.sum / group.count : 0) : group.sum })))
}

// ---------------------------------------------------------------------------------------------------------------
// The initial cube.

interface BoardCubeInput {
  readonly datasets: Readonly<Record<string, readonly Row[]>>
  readonly filters?: readonly BoardFilter[]
  readonly kpis?: readonly BoardKpi[]
}

/** The rows a filter's facets and domain are read from: its dataset, or every dataset that has the field. */
function scopeRows(datasets: Readonly<Record<string, readonly Row[]>>, filter: BoardFilter): Row[] {
  if (filter.dataset !== undefined) return [...(datasets[filter.dataset] ?? [])]
  const out: Row[] = []
  for (const rows of Object.values(datasets)) if (rows.some(row => Object.hasOwn(row, filter.field))) out.push(...rows)
  return out
}

/**
 * The board's initial cube. Filter facets and domains come from the unfiltered rows (so a choice never disappears once
 * another filter narrows things), then the initial values are applied to every dataset, and the KPIs and sparklines are
 * computed from what is left.
 */
export function buildBoardCube(input: BoardCubeInput, locale: BoardLocale): BoardCube {
  const datasetNames = Object.keys(input.datasets)
  const rows: Record<string, number> = {}
  for (const name of datasetNames) rows[name] = input.datasets[name]!.length

  // The page carries the first rows across all datasets, in document order, up to the limit.
  const client: Record<string, readonly Row[]> = {}
  const clientRows: Record<string, number> = {}
  let budget = CLIENT_ROW_LIMIT
  for (const name of datasetNames) {
    const all = input.datasets[name]!
    const take = Math.max(0, Math.min(all.length, budget))
    client[name] = all.slice(0, take)
    clientRows[name] = take
    budget -= take
  }

  const facets: Record<string, BoardOptionView[]> = {}
  const domains: Record<string, BoardDomain> = {}
  const values: Record<string, unknown> = {}
  for (const filter of input.filters ?? []) {
    const scope = scopeRows(input.datasets, filter)
    const domain = domainOf(scope, filter.field)
    domains[filter.id] = domain
    const options = filter.options !== undefined ? filter.options.map(option => ({ value: option.value, label: option.label })) : filter.control === "segmented" || filter.control === "select" || filter.control === "chips" ? facetOptions(scope, filter.field) : []
    facets[filter.id] = options
    values[filter.id] = normaliseFilterValue(filter, filter.defaultValue, domain)
  }

  const applied: AppliedFilter[] = (input.filters ?? []).map(filter => ({ filter, value: values[filter.id] }))
  const filtered: Record<string, readonly Row[]> = {}
  const shown: Record<string, number> = {}
  for (const name of datasetNames) {
    const kept = filterRows(input.datasets[name]!, applied, name)
    filtered[name] = kept
    shown[name] = kept.length
  }

  const kpis: Record<string, BoardKpiView> = {}
  const sparks: Record<string, BoardSparkView> = {}
  for (const kpi of input.kpis ?? []) {
    const kept = filtered[kpi.dataset] ?? []
    const value = aggregateRows(kept, kpi.aggregate, kpi.field)
    kpis[kpi.id] = { value, display: formatValue(value, kpi, locale) }
    if (kpi.sparkline) sparks[kpi.id] = sparkSeries(kept, kpi.sparkline.x, kpi.sparkline.y, kpi.sparkline.aggregate ?? "sum")
  }

  return { rows, clientRows, client, shown, filtered, filters: values, facets, domains, kpis, sparks }
}
