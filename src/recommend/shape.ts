import { profile, type Profile, type Row } from "../data.js"
import type { Shape } from "./traits.js"

/**
 * The data's shape, as the advice needs it: which columns can be a measure, a dimension, a series, a time axis, the
 * ends of an edge, or the key and parent of a hierarchy.
 *
 * It is a reading of `Profile` (`src/data.ts`), which every render already computes, so the advice and the render see
 * the same data. Nothing here samples differently or guesses a value: every statement it makes is a count.
 */

const COUNTRY = /^(country|countries|country_code|country_name|nation|iso_a2|iso_a3|country_iso)$/i
const STATE = /^(state|province|region_code|state_code|postal|fips)$/i
const PARENT = /^(parent|parent_id|parentid|parent_name|manager|manager_id|reports_to|supervisor|upstream)$/i
const KEY = /^(id|key|node|node_id|code|name|label|category_id)$/i
const SOURCE = /^(source|from|origin|src|left|start)$/i
const TARGET = /^(target|to|destination|dst|right|end)$/i
const OPEN = /^(open|o|first|start_value)$/i
const CLOSE = /^(close|c|last|end_value)$/i
const HIGH = /^(high|h|max_value)$/i
const LOW = /^(low|l|min_value)$/i

const US_STATES = new Set(["alabama", "alaska", "arizona", "arkansas", "california", "colorado", "connecticut", "delaware", "florida", "georgia", "hawaii", "idaho", "illinois", "indiana", "iowa", "kansas", "kentucky", "louisiana", "maine", "maryland", "massachusetts", "michigan", "minnesota", "mississippi", "missouri", "montana", "nebraska", "nevada", "new hampshire", "new jersey", "new mexico", "new york", "north carolina", "north dakota", "ohio", "oklahoma", "oregon", "pennsylvania", "rhode island", "south carolina", "south dakota", "tennessee", "texas", "utah", "vermont", "virginia", "washington", "west virginia", "wisconsin", "wyoming"])

/** A year stored as a number is a time axis, not a measure. */
function yearLike(field: Profile["fields"][number]): boolean {
  if (field.type !== "number" || typeof field.min !== "number" || typeof field.max !== "number") return false
  const lo = field.min, hi = field.max
  return lo >= 1800 && hi <= 2200 && Number.isInteger(lo) && Number.isInteger(hi) && field.distinct <= 300 && /^(year|yr|annee|jahr|ano)$/i.test(field.name)
}

export function shapeOf(rows: readonly Row[]): Shape {
  const p = profile(rows)
  const numberFields = p.fields.filter(f => f.type === "number" && !yearLike(f))
  const temporalFields = p.fields.filter(f => f.type === "temporal" || yearLike(f))
  const textFields = p.fields.filter(f => f.type === "string" || f.type === "boolean")
  const measures = numberFields.map(f => f.name)
  const temporals = temporalFields.map(f => f.name)
  // A column that is different in every row of a large table is an id, not a category.
  const dimensions = textFields.filter(f => !(f.distinct >= rows.length && rows.length > 20)).map(f => f.name)
  const byName = (re: RegExp) => p.fields.find(f => re.test(f.name))
  const textByDistinct = textFields
    .filter(f => dimensions.includes(f.name) && f.distinct >= 2)
    .sort((a, b) => a.distinct - b.distinct || a.name.localeCompare(b.name))

  const seriesField = textByDistinct.find(f => f.distinct >= 2 && f.distinct <= 12 && rows.length / Math.max(1, f.distinct) >= 2)
  const partField = textByDistinct.find(f => f.distinct >= 2 && f.distinct <= 8)
  const categoryField = [...textByDistinct].sort((a, b) => b.distinct - a.distinct).find(f => f.distinct >= 2)

  // An edge list: two text columns whose values overlap, or columns named like one.
  const sourceNamed = byName(SOURCE), targetNamed = byName(TARGET)
  let edges: Shape["edges"]
  if (sourceNamed && targetNamed && sourceNamed.name !== targetNamed.name) edges = { source: sourceNamed.name, target: targetNamed.name }
  else {
    const pair = textByDistinct.filter(f => f.distinct >= 2 && f.distinct <= 500 && f.distinct < rows.length)
    if (pair.length >= 2) {
      const overlap = textsOverlap(rows, pair[0]!.name, pair[1]!.name)
      if (overlap) edges = { source: pair[0]!.name, target: pair[1]!.name }
    }
  }

  const parentNamed = byName(PARENT)
  const keyNamed = byName(KEY)
  const hierarchy = parentNamed ? { key: (keyNamed ?? byName(/id$/i) ?? textFields.find(f => f.name !== parentNamed.name))?.name ?? textFields[0]!.name, parent: parentNamed.name } : undefined

  const stateish = textFields.find(f => f.top?.some(v => US_STATES.has(v.toLowerCase())))
  const countryNamed = byName(COUNTRY), stateNamed = byName(STATE)
  const location = stateish
    ? { name: stateish.name, kind: "us-state" as const }
    : countryNamed
      ? { name: countryNamed.name, kind: "country" as const }
      : stateNamed
        ? { name: stateNamed.name, kind: /state|postal|fips/i.test(stateNamed.name) ? "us-state" as const : "country" as const }
        : undefined

  const openNamed = byName(OPEN), closeNamed = byName(CLOSE)
  const hasOhlc = Boolean(openNamed && closeNamed && (byName(HIGH) || byName(LOW)))

  return {
    rows: rows.length,
    columns: p.fields.map(f => ({ name: f.name, type: yearLike(f) ? "temporal" : f.type, distinct: f.distinct, missing: f.missing, ...(f.top ? { top: f.top } : {}) })),
    measures,
    temporals: hasOhlc && !temporals.length ? [] : temporals,
    dimensions,
    ...(seriesField ? { series: { name: seriesField.name, distinct: seriesField.distinct } } : {}),
    ...(partField ? { part: { name: partField.name, distinct: partField.distinct } } : {}),
    ...(categoryField ? { categories: { name: categoryField.name, distinct: categoryField.distinct } } : {}),
    twoMeasures: measures.length >= 2,
    ...(edges ? { edges } : {}),
    ...(hierarchy ? { hierarchy } : {}),
    ...(location ? { location } : {}),
    timeSeries: temporals.length > 0 && measures.length > 0,
  }
}

/** Whether two text columns share values, as an edge list's ends do. */
function textsOverlap(rows: readonly Row[], a: string, b: string): boolean {
  const left = new Set<string>(), right = new Set<string>()
  for (const row of rows.slice(0, 500)) {
    if (typeof row[a] === "string") left.add(row[a] as string)
    if (typeof row[b] === "string") right.add(row[b] as string)
  }
  if (left.size < 2 || right.size < 2) return false
  let shared = 0
  for (const value of left) if (right.has(value)) shared++
  // An edge list's ends share most of their names; two unrelated categories share almost none.
  return shared >= Math.min(left.size, right.size) / 2
}

/** The roles the shape satisfies, so a trait's `need` can be checked. */
export function rolesOf(shape: Shape): ReadonlySet<string> {
  const roles = new Set<string>()
  if (shape.measures.length >= 1) roles.add("measure")
  if (shape.measures.length >= 2) roles.add("measure2")
  if (shape.dimensions.length >= 1) roles.add("dimension")
  if (shape.temporals.length >= 1) roles.add("temporal")
  if (shape.series) roles.add("series")
  if (shape.part) roles.add("part")
  if (shape.categories) roles.add("categories")
  if (shape.edges) { roles.add("source"); roles.add("target") }
  if (shape.hierarchy) { roles.add("key"); roles.add("parent") }
  if (shape.location) roles.add("location")
  if (shape.series && shape.series.distinct >= 3) roles.add("size")
  const names = new Set(shape.columns.map(c => c.name))
  if ([...names].some(n => OPEN.test(n)) && [...names].some(n => CLOSE.test(n))) { roles.add("open"); roles.add("close") }
  if (shape.location) roles.add("location")
  return roles
}
