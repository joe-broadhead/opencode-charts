import type { TimeUnit } from "./planner.js"

/**
 * How a recipe writes time on an axis: one calendar unit and one format for the whole axis, chosen from the span of
 * the data (all in UTC, like the recipes' temporal values), so an axis never mixes "2024" with "February".
 *
 *   three or more calendar years   year     2024
 *   more than two months           month    Jan        (Jan 2024 when the span crosses a year)
 *   more than two days             day      Jan 5      (Jan 5, 2024 when the span crosses a year)
 *   otherwise                      hour     09:00
 *
 * The labels returned are the axis's labels at one tick per unit, in English, for the layout planner to measure; the
 * chart itself formats them with the document's locale (Vega's utcFormat with the locale's time format).
 */

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
const DAY = 86_400_000, HOUR = 3_600_000
/** At most this many labels are listed for measuring: every one up to here, then evenly spaced samples. */
const MAX_LABELS = 400

export interface TimeAxis {
  readonly unit: TimeUnit
  /** d3 time format, applied in UTC. */
  readonly format: string
  /** Units from the first value to the last. */
  readonly intervals: number
  readonly labels: readonly string[]
}

const two = (n: number) => String(n).padStart(2, "0")

/** The axis for a set of temporal values (ISO instants or milliseconds); undefined when there is none. */
export function timeAxis(values: readonly unknown[]): TimeAxis | undefined {
  const ms = values.map(v => (typeof v === "number" ? v : typeof v === "string" ? Date.parse(v) : NaN)).filter(Number.isFinite)
  if (!ms.length) return undefined
  const lo = new Date(Math.min(...ms)), hi = new Date(Math.max(...ms))
  const years = hi.getUTCFullYear() - lo.getUTCFullYear()
  const months = years * 12 + hi.getUTCMonth() - lo.getUTCMonth()
  const crossesYear = years > 0
  const sample = (count: number, label: (i: number) => string) => {
    const n = Math.min(count + 1, MAX_LABELS)
    return Array.from({ length: n }, (_, k) => label(n === count + 1 ? k : Math.round((k * count) / (n - 1))))
  }
  if (years >= 3) return { unit: "year", format: "%Y", intervals: years, labels: sample(years, i => String(lo.getUTCFullYear() + i)) }
  if (months > 2) {
    const first = lo.getUTCFullYear() * 12 + lo.getUTCMonth()
    return { unit: "month", format: crossesYear ? "%b %Y" : "%b", intervals: months, labels: sample(months, i => `${MONTHS[(first + i) % 12]}${crossesYear ? ` ${Math.floor((first + i) / 12)}` : ""}`) }
  }
  const days = Math.floor((Date.UTC(hi.getUTCFullYear(), hi.getUTCMonth(), hi.getUTCDate()) - Date.UTC(lo.getUTCFullYear(), lo.getUTCMonth(), lo.getUTCDate())) / DAY)
  if (days > 2) {
    const start = Date.UTC(lo.getUTCFullYear(), lo.getUTCMonth(), lo.getUTCDate())
    return { unit: "day", format: crossesYear ? "%b %-d, %Y" : "%b %-d", intervals: days, labels: sample(days, i => { const d = new Date(start + i * DAY); return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}${crossesYear ? `, ${d.getUTCFullYear()}` : ""}` }) }
  }
  const hours = Math.ceil((hi.getTime() - lo.getTime()) / HOUR)
  const start = Math.floor(lo.getTime() / HOUR) * HOUR
  return { unit: "hour", format: "%H:%M", intervals: hours, labels: sample(hours, i => { const d = new Date(start + i * HOUR); return `${two(d.getUTCHours())}:00` }) }
}

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/

/**
 * Category labels that are all ISO dates (2024-03-01) read as dates: months when every one is the first of a month,
 * days otherwise, with the year only when they cross one. Undefined when any label is not such a date.
 */
export function dateCategories(labels: readonly string[]): { readonly format: string; readonly display: readonly string[] } | undefined {
  if (!labels.length) return undefined
  const parsed = labels.map(l => ISO_DATE.exec(l)).map(m => (m ? { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) } : undefined))
  if (parsed.some(p => !p || p.m < 1 || p.m > 12 || p.d < 1 || p.d > 31 || new Date(Date.UTC(p.y, p.m - 1, p.d)).getUTCDate() !== p.d)) return undefined
  const dates = parsed as { y: number; m: number; d: number }[]
  const crossesYear = new Set(dates.map(p => p.y)).size > 1
  if (dates.every(p => p.d === 1)) return { format: crossesYear ? "%b %Y" : "%b", display: dates.map(p => `${MONTHS[p.m - 1]}${crossesYear ? ` ${p.y}` : ""}`) }
  return { format: crossesYear ? "%b %-d, %Y" : "%b %-d", display: dates.map(p => `${MONTHS[p.m - 1]} ${p.d}${crossesYear ? `, ${p.y}` : ""}`) }
}
