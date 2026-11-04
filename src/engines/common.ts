import { readFileSync } from "node:fs"
import { join } from "node:path"
import { ChartsError } from "../errors.js"
import type { Row } from "../data.js"

export type Json = Record<string, unknown>
export const isObject = (v: unknown): v is Json => !!v && typeof v === "object" && !Array.isArray(v)

/** Deep merge for configs: objects merge, everything else (arrays included) is replaced by `over`. */
export function deepMerge(base: unknown, over: unknown): unknown {
  if (!isObject(base) || !isObject(over)) return over === undefined ? base : over
  const out: Json = { ...base }
  for (const [k, v] of Object.entries(over)) out[k] = deepMerge(out[k], v)
  return out
}

// ---------------------------------------------------------------------------------------------------------------
// Bundled offline map atlases (TopoJSON), used as {"atlas": "<name>"} wherever a spec takes data.

export const ATLASES: Record<string, { file: string; feature: string; about: string; keys: string }> = {
  "world-110m": { file: "world-110m.json", feature: "countries", about: "World countries, 1:110m (Natural Earth via world-atlas).", keys: "properties.name, properties.iso_a2, properties.iso_a3, id (ISO numeric)" },
  "world-land-110m": { file: "world-land-110m.json", feature: "land", about: "World land outline, 1:110m.", keys: "none" },
  "us-states-10m": { file: "us-states-10m.json", feature: "states", about: "US states, 1:10m (Census via us-atlas); project with albersUsa.", keys: "properties.name, properties.postal, id (FIPS)" },
}
const atlasCache = new Map<string, unknown>()
export function atlasData(root: string, name: string, feature?: string): Json {
  const atlas = ATLASES[name]
  if (!atlas) throw new ChartsError("ATLAS_UNKNOWN", `There is no bundled map "${name}".`, `Use one of: ${Object.keys(ATLASES).join(", ")}.`)
  let topo = atlasCache.get(name)
  if (!topo) { topo = JSON.parse(readFileSync(join(root, "assets", "data", atlas.file), "utf8")); atlasCache.set(name, topo) }
  return { values: topo, format: { type: "topojson", feature: feature ?? atlas.feature } }
}

/**
 * Replaces data references in place: `{"atlas": name}` with the bundled TopoJSON, and `{"name": dataName}` (the
 * name the tool's rows go by, `table` unless data.name says otherwise) with the rows. Returns how many references
 * to the rows were found.
 */
export function substituteData(node: unknown, root: string, rows: readonly Row[] | undefined, dataName: string): number {
  let used = 0
  const visit = (value: unknown) => {
    if (Array.isArray(value)) { value.forEach(visit); return }
    if (!isObject(value)) return
    for (const [key, child] of Object.entries(value)) {
      if ((key === "data" || key === "from") && isObject(child)) {
        if (typeof child.atlas === "string") {
          const { atlas, feature, ...rest } = child
          value[key] = { ...rest, ...atlasData(root, atlas, typeof feature === "string" ? feature : undefined) }
          continue
        }
        if (rows && child.name === dataName && child.values === undefined && Object.keys(child).every(k => k === "name" || k === "format")) {
          value[key] = { values: rows }
          used++
          continue
        }
      }
      visit(child)
    }
  }
  visit(node)
  return used
}

// ---------------------------------------------------------------------------------------------------------------
// The compact number format: 1.2k, 3.4M, 5.6B, with an optional currency. One self-contained function, registered
// with Vega for SVG and PNG, and inlined (by its source text) into interactive HTML, so both format identically.
// The format string is "<symbol>|<p|s>|<decimal>": symbol, prefix or suffix placement, decimal separator.

export function compactFormat(value: unknown, spec: unknown): string {
  const n = typeof value === "number" ? value : Number(value)
  if (!Number.isFinite(n)) return String(value ?? "")
  const parts = String(spec ?? "").split("|")
  const symbol = parts[0] || "", suffix = parts[1] === "s", decimal = parts[2] || "."
  const abs = Math.abs(n)
  const units: [number, string][] = [[1e12, "T"], [1e9, "B"], [1e6, "M"], [1e3, "k"]]
  let body = ""
  const trim = (x: number, digits: number) => { let s = x.toFixed(digits); if (s.indexOf(".") >= 0) s = s.replace(/0+$/, "").replace(/\.$/, ""); return s }
  for (const [size, unit] of units) if (abs >= size) { const v = abs / size; body = trim(v, v < 10 ? 1 : 0) + unit; break }
  if (!body) body = trim(abs, abs < 1 ? 2 : abs < 10 ? 1 : 0)
  body = body.replace(".", decimal)
  const sign = n < 0 ? "−" : ""
  if (!symbol) return sign + body
  return suffix ? `${sign}${body} ${symbol}` : `${sign}${symbol}${body}`
}

export function compactSpec(currency: [string, string] | undefined, decimal: string): string {
  if (!currency || (currency[0] === "" && currency[1] === "")) return `||${decimal}`
  const suffix = currency[0] === ""
  const symbol = (suffix ? currency[1] : currency[0]).replace(/ /g, "").trim()
  return `${symbol}|${suffix ? "s" : "p"}|${decimal}`
}

// ---------------------------------------------------------------------------------------------------------------
// Category orders a person expects, rather than alphabetical.

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"]
const DAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]
export function calendarOrder(values: readonly unknown[]): string[] | undefined {
  const strings = [...new Set(values.filter((v): v is string => typeof v === "string"))]
  if (strings.length < 3) return undefined
  for (const list of [MONTHS, DAYS]) {
    const index = (s: string) => { const l = s.toLowerCase().replace(/\.$/, ""); return list.findIndex(m => m === l || (l.length >= 3 && m.startsWith(l))) }
    if (strings.every(s => index(s) >= 0)) return strings.slice().sort((a, b) => index(a) - index(b))
  }
  return undefined
}

const UNIT_SUFFIX: Record<string, string> = { eur: "€", usd: "$", gbp: "£", jpy: "¥", pct: "%", percent: "%", k: "k", m: "M", bn: "B", ms: "ms", s: "s", sec: "s", min: "min", h: "h", hrs: "h", kg: "kg", km: "km", mi: "mi", gb: "GB", mb: "MB", tb: "TB", c: "°C", f: "°F" }
/** A readable axis title from a field name: "revenue_eur" is "Revenue (€)", "orderCount" is "Order count". */
export const humanise = (field: string) => {
  const parts = field.replace(/([a-z])([A-Z])/g, "$1_$2").split(/[_\s]+/).filter(Boolean)
  const last = parts[parts.length - 1]?.toLowerCase()
  const unit = parts.length > 1 && last ? UNIT_SUFFIX[last] : undefined
  const words = (unit ? parts.slice(0, -1) : parts).map(w => w.toLowerCase()).join(" ")
  const s = words.charAt(0).toUpperCase() + words.slice(1)
  return unit ? `${s} (${unit})` : s
}

/**
 * Theme colour references: any string "theme:<token>" in a spec becomes that colour of the active theme, so one spec
 * stays on-brand in every theme. Tokens: background, text, muted, grid, axis, positive, negative, neutral, highlight,
 * and categorical.<n>, sequential.<n>, diverging.<n>.
 */
export function substituteThemeColours(node: unknown, colors: Record<string, string | readonly string[]>): unknown {
  if (typeof node === "string" && node.startsWith("theme:")) {
    const [token, index] = node.slice(6).split(".")
    const value = colors[token!]
    if (typeof value === "string") return value
    if (Array.isArray(value)) return index === undefined ? [...value] : value[Number(index) % value.length] ?? node
    return node
  }
  if (Array.isArray(node)) return node.map(n => substituteThemeColours(n, colors))
  if (isObject(node)) return Object.fromEntries(Object.entries(node).map(([k, v]) => [k, k === "values" || k === "source" ? v : substituteThemeColours(v, colors)]))
  return node
}
