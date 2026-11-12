/**
 * Reading positions and measures from rows, without guessing. A temporal position is an ISO 8601 date or date-time
 * string, read the same on every host: a date, or a date-time without an offset, is a UTC wall time. A quantitative
 * position or a measure is a finite JSON number; text that looks like a number is not converted (a declared
 * data.transform can do that).
 */

const ISO = /^(\d{4})(?:-(\d{2})(?:-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,9}))?)?(Z|[+-]\d{2}(?::?\d{2})?)?)?)?)?$/

const daysIn = (year: number, month: number) => [31, (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0 ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1]!

/** Milliseconds since the epoch (UTC) for an ISO 8601 string, or undefined when it is not a valid one. */
export function parseTemporal(value: unknown): number | undefined {
  if (typeof value !== "string") return undefined
  const m = ISO.exec(value.trim())
  if (!m) return undefined
  const year = Number(m[1]), month = m[2] ? Number(m[2]) : 1, day = m[3] ? Number(m[3]) : 1
  const hour = m[4] ? Number(m[4]) : 0, minute = m[5] ? Number(m[5]) : 0, second = m[6] ? Number(m[6]) : 0
  const ms = m[7] ? Number(m[7].slice(0, 3).padEnd(3, "0")) : 0
  if (month < 1 || month > 12 || day < 1 || day > daysIn(year, month) || hour > 23 || minute > 59 || second > 59) return undefined
  let offset = 0
  const zone = m[8]
  if (zone && zone !== "Z") {
    const digits = zone.slice(1).replace(":", "")
    const oh = Number(digits.slice(0, 2)), om = digits.length > 2 ? Number(digits.slice(2, 4)) : 0
    if (oh > 23 || om > 59) return undefined
    offset = (zone[0] === "-" ? -1 : 1) * (oh * 60 + om) * 60_000
  }
  const date = new Date(0)
  date.setUTCFullYear(year, month - 1, day)
  date.setUTCHours(hour, minute, second, ms)
  return date.getTime() - offset
}

/** The canonical text of an instant: `YYYY-MM-DDTHH:mm:ss.sssZ`. */
export const isoInstant = (ms: number) => new Date(ms).toISOString()

/** A value counts as missing when it is null or absent; anything else is present (and may still be invalid). */
export const isMissing = (value: unknown) => value === null || value === undefined

/** A finite JSON number; -0 reads as 0. */
export const finiteNumber = (value: unknown): number | undefined => (typeof value === "number" && Number.isFinite(value) ? (Object.is(value, -0) ? 0 : value) : undefined)

/** How a cell reads in a message. */
export function showValue(value: unknown): string {
  if (value === undefined) return "absent"
  if (typeof value === "string") return JSON.stringify(value.length > 40 ? `${value.slice(0, 40)}…` : value)
  if (typeof value === "number" && !Number.isFinite(value)) return String(value)
  try { const text = JSON.stringify(value); return text.length > 60 ? `${text.slice(0, 60)}…` : text } catch { return typeof value }
}
