import { compareCodePoints } from "./canonical.js"

/**
 * Typed category identity, for the colour domain of a recipe chart.
 *
 * A category is a JSON scalar, and its type is part of its identity: the number 1 and the string "1" are two
 * categories, `true` is not "true", and null is a category of its own. -0 is the same category as 0. A non-finite
 * number is not a category. The domain is ordered by type (null, boolean, number, string), then by value: false before
 * true, numbers numerically, strings by Unicode code point. That order never depends on the locale, on the display sort
 * or on the order rows arrive in, so a category keeps its palette position across revisions and selections.
 */

export type CategoryValue = string | number | boolean | null

/** Whether a value can be a category: a string, a finite number, a boolean or null. */
export function isCategoryValue(value: unknown): value is CategoryValue {
  return value === null || typeof value === "string" || typeof value === "boolean" || (typeof value === "number" && Number.isFinite(value))
}

/** -0 becomes 0; everything else is returned as is. */
export const normaliseCategory = (value: CategoryValue): CategoryValue => (typeof value === "number" && Object.is(value, -0) ? 0 : value)

/** A string that is equal for two values exactly when they are the same typed category. */
export function categoryKey(value: CategoryValue): string {
  if (value === null) return "null"
  if (typeof value === "boolean") return value ? "b:true" : "b:false"
  if (typeof value === "number") return `n:${Object.is(value, -0) ? 0 : value}`
  return `s:${value}`
}

const RANK = (value: CategoryValue) => (value === null ? 0 : typeof value === "boolean" ? 1 : typeof value === "number" ? 2 : 3)

/** The domain order: null, booleans, numbers, strings; within a type by value, strings by code point. */
export function compareCategories(a: CategoryValue, b: CategoryValue): number {
  const ra = RANK(a), rb = RANK(b)
  if (ra !== rb) return ra - rb
  if (typeof a === "boolean") return a === b ? 0 : a ? 1 : -1
  if (typeof a === "number") { const nb = b as number; return a === nb ? 0 : a < nb ? -1 : 1 }
  if (typeof a === "string") return compareCodePoints(a, b as string)
  return 0
}

/** The distinct categories among `values`, in domain order. Values must already be category values. */
export function categoryDomain(values: Iterable<CategoryValue>): CategoryValue[] {
  const seen = new Map<string, CategoryValue>()
  for (const value of values) {
    const v = normaliseCategory(value)
    const key = categoryKey(v)
    if (!seen.has(key)) seen.set(key, v)
  }
  return [...seen.values()].sort(compareCategories)
}

/** How a category reads in a message: strings quoted, everything else as JSON. */
export const showCategory = (value: CategoryValue) => (typeof value === "string" ? JSON.stringify(value) : String(value))

/**
 * Warnings for explicit category colours that name a category the captured domain does not have: the colour would
 * never be used. Entries are matched by typed identity, so { value: "1" } does not colour the number 1.
 */
export function categoryColorDiagnostics(entries: readonly { readonly value: CategoryValue }[], domain: readonly CategoryValue[]) {
  const known = new Set(domain.map(categoryKey))
  return entries.flatMap((entry, i) => known.has(categoryKey(entry.value)) ? [] : [{
    level: "warning" as const,
    code: "CATEGORY_COLOR_UNUSED" as const,
    message: `categoryColors[${i}] names ${showCategory(entry.value)}, which is not a category of this chart${domain.length ? ` (its categories are ${domain.slice(0, 8).map(showCategory).join(", ")}${domain.length > 8 ? ", …" : ""})` : ""}.`,
    path: `/appearance/categoryColors/${i}/value`,
    fix: typeof entry.value === "string" && domain.some(v => typeof v !== "string" && String(v) === entry.value) ? `Categories are typed: use ${entry.value} without quotes to match the ${typeof domain.find(v => String(v) === entry.value)} category.` : "Use a category from the data, or remove the entry.",
  }])
}
