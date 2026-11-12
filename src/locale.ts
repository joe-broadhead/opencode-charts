import { readFileSync } from "node:fs"
import { join } from "node:path"
import { ChartsError, suggest } from "./errors.js"
import { CURRENCY_SYMBOLS as SYMBOLS } from "./locale-fields.js"

/** d3 locale definitions, generated into assets/data/locales.json from d3-format and d3-time-format. */
interface NumberLocale { decimal: string; thousands: string; grouping: number[]; currency: [string, string]; [key: string]: unknown }
interface Locales { number: Record<string, NumberLocale>; time: Record<string, Record<string, unknown>> }


let cache: Locales | undefined
const load = (root: string) => (cache ??= JSON.parse(readFileSync(join(root, "assets", "data", "locales.json"), "utf8")) as Locales)

export interface ResolvedLocale {
  readonly id: string
  readonly number: NumberLocale
  readonly time?: Record<string, unknown>
  readonly currency?: string
}

/** A locale (BCP 47, such as de-DE) and an optional ISO 4217 currency whose symbol replaces the locale's own. */
export function resolveLocale(root: string, id = "en-US", currency?: string): ResolvedLocale {
  const all = load(root)
  const key = Object.keys(all.number).find(k => k.toLowerCase() === id.toLowerCase())
    ?? Object.keys(all.number).find(k => k.toLowerCase().startsWith(id.toLowerCase().split("-")[0]! + "-"))
  if (!key) throw new ChartsError("LOCALE_UNKNOWN", `There is no locale "${id}".${suggest(id, Object.keys(all.number)).map(s => ` Did you mean ${s}?`).join("")}`, `Use one of: ${Object.keys(all.number).join(", ")}.`)
  const number: NumberLocale = { ...all.number[key]! }
  if (currency) {
    const code = currency.toUpperCase()
    const symbol = SYMBOLS[code]
    if (!symbol) throw new ChartsError("CURRENCY_UNKNOWN", `There is no currency "${currency}".`, `Use an ISO 4217 code: ${Object.keys(SYMBOLS).join(", ")}.`)
    const suffix = number.currency[0] === "" && number.currency[1] !== ""
    number.currency = suffix ? ["", ` ${symbol}`] : [symbol.length > 1 && /[A-Z]$/.test(symbol) ? `${symbol} ` : symbol, ""]
  }
  const time = all.time[key] ?? all.time[Object.keys(all.time).find(k => k.startsWith(key.split("-")[0]! + "-")) ?? ""]
  return { id: key, number, ...(time ? { time } : {}), ...(currency ? { currency: currency.toUpperCase() } : {}) }
}

export const localeIds = (root: string) => Object.keys(load(root).number)
