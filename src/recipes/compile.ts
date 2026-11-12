import { suggest, pointer, type ChartsCode } from "../errors.js"
import { categoryDomain, categoryKey, compareCategories, isCategoryValue, normaliseCategory, showCategory, type CategoryValue } from "../document/category.js"
import { IssueList } from "../document/issues.js"
import type { RecipeChartV1 } from "../document/types.js"
import { optionDefaults, recipeDefinition } from "./definitions.js"
import type { Aggregate, CompileContext, RecipeCompilation, RecipeId, XType } from "./types.js"
import { finiteNumber, isMissing, isoInstant, parseTemporal, showValue } from "./values.js"

/**
 * Recipe compilation: validated recipe chart + the rows after data.transform → a Vega-Lite spec and the rows its marks
 * draw. Grouping and aggregation happen here, in plain code, so every drawn value can be checked against an
 * independent computation, and nothing is summed, invented or dropped without a diagnostic:
 *
 * - aggregate none (the default) with two rows in one mark's group fails with AGGREGATION_REQUIRED;
 * - count counts rows in the group (after data.transform), and takes no measure;
 * - other aggregates skip null measures, say how many, and leave a group with no number empty rather than zero;
 * - a measure that is not a number fails (TYPE_MISMATCH) unless a declared transform converts it;
 * - a temporal or quantitative x that is missing or invalid fails (POSITION_MISSING, NOT_A_DATE, TYPE_MISMATCH);
 * - temporal x is read as UTC on every host, and written to the marks as an ISO instant.
 */

type Row = Record<string, unknown>
export const RECIPE_DATA_NAME = "table"
const VEGA_LITE_SCHEMA = "https://vega.github.io/schema/vega-lite/v6.json"
const bindingPath = (role: string) => pointer(["chart", "bindings", role])
const optionPath = (name: string) => pointer(["chart", "options", name])
const AGG_LABEL: Record<Exclude<Aggregate, "none" | "count">, string> = { sum: "Sum", mean: "Mean", median: "Median", min: "Minimum", max: "Maximum" }

/** Problems found row by row, reported once per role and kind, with the count and the first few rows. */
class RowProblems {
  private readonly found = new Map<string, { code: ChartsCode; path: string; what: string; fix: string; count: number; examples: string[] }>()
  error(code: ChartsCode, role: string, field: string, what: string, fix: string, row: number, value: unknown) {
    const key = `${role}\u0000${code}`
    const entry = this.found.get(key) ?? { code, path: bindingPath(role), what: `"${field}" (bindings.${role}) ${what}`, fix, count: 0, examples: [] }
    entry.count++
    if (entry.examples.length < 3) entry.examples.push(`row ${row}: ${showValue(value)}`)
    this.found.set(key, entry)
  }
  report(issues: IssueList) {
    for (const p of this.found.values()) issues.error(p.code, `${p.what} in ${p.count} row(s) after data.transform (${p.examples.join("; ")}${p.count > p.examples.length ? "; …" : ""}).`, p.path, p.fix)
  }
}

const filterFix = (field: string) => `Correct those rows, or drop them explicitly with data.transform: [{"filter": "isValid(datum[${JSON.stringify(field)}])"}].`
const numberFix = (field: string) => `Make "${field}" numbers in the data, or convert it with a declared transform such as {"calculate": "toNumber(datum[${JSON.stringify(field)}])", "as": "${field}_n"} and bind that field.`

interface KeyReading { readonly id: string; readonly display: unknown; readonly order: CategoryValue }

/** Reads one grouping or position value; `undefined` when the row has a problem (recorded). */
function readKey(kind: "category" | XType, role: string, field: string, row: Row, index: number, problems: RowProblems): KeyReading | undefined {
  const value = row[field]
  if (kind === "category" || kind === "ordinal") {
    const v = value === undefined ? null : value
    if (!isCategoryValue(v)) { problems.error("TYPE_MISMATCH", role, field, "is not a category (a string, a finite number, true/false or null)", "Use scalar values for this field, or derive one with a calculate transform.", index, value); return undefined }
    const n = normaliseCategory(v)
    return { id: categoryKey(n), display: n, order: n }
  }
  if (isMissing(value)) { problems.error("POSITION_MISSING", role, field, `has no ${kind} position`, filterFix(field), index, value); return undefined }
  if (kind === "temporal") {
    const ms = parseTemporal(value)
    if (ms === undefined) { problems.error("NOT_A_DATE", role, field, "is not an ISO 8601 date or date-time", "Use ISO dates such as 2024-03-01 or 2024-03-01T09:30:00Z; or set options.xType to ordinal; or convert the field with a declared transform.", index, value); return undefined }
    return { id: `t:${ms}`, display: isoInstant(ms), order: ms }
  }
  const n = finiteNumber(value)
  if (n === undefined) { problems.error("TYPE_MISMATCH", role, field, "is not a finite number", numberFix(field), index, value); return undefined }
  return { id: `n:${n}`, display: n, order: n }
}

/** Reads a measure: a number, null for missing, or undefined when invalid (recorded). */
function readMeasure(role: string, field: string, row: Row, index: number, problems: RowProblems): number | null | undefined {
  const value = row[field]
  if (isMissing(value)) return null
  const n = finiteNumber(value)
  if (n === undefined) problems.error("TYPE_MISMATCH", role, field, "is not a finite number", numberFix(field), index, value)
  return n
}

function aggregateValues(op: Exclude<Aggregate, "none" | "count">, values: readonly number[]): number | null {
  if (values.length === 0) return null
  switch (op) {
    case "sum": return values.reduce((a, b) => a + b, 0)
    case "mean": return values.reduce((a, b) => a + b, 0) / values.length
    case "min": return values.reduce((a, b) => (b < a ? b : a))
    case "max": return values.reduce((a, b) => (b > a ? b : a))
    case "median": {
      const sorted = [...values].sort((a, b) => a - b)
      const mid = sorted.length >> 1
      return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2
    }
  }
}

const uniqueName = (base: string, taken: ReadonlySet<string>) => {
  if (!taken.has(base)) return base
  for (let i = 2; ; i++) if (!taken.has(`${base}_${i}`)) return `${base}_${i}`
}

/** A stable sort that keeps the input order of ties. */
const stableSort = <T>(items: readonly T[], compare: (a: T, b: T) => number) => items.map((item, i) => ({ item, i })).sort((a, b) => compare(a.item, b.item) || a.i - b.i).map(x => x.item)

/** Distinct values of one key, in first-appearance order. */
const distinctInOrder = (readings: readonly KeyReading[]) => {
  const seen = new Map<string, KeyReading>()
  for (const r of readings) if (!seen.has(r.id)) seen.set(r.id, r)
  return [...seen.values()]
}

const orderOf = (a: CategoryValue, b: CategoryValue) => (typeof a === "number" && typeof b === "number" ? a - b : compareCategories(a, b))
function orderedKeys(readings: readonly KeyReading[], order: "input" | "ascending" | "descending"): KeyReading[] {
  const distinct = distinctInOrder(readings)
  if (order === "input") return distinct
  return stableSort(distinct, (a, b) => (order === "ascending" ? 1 : -1) * orderOf(a.order, b.order))
}

interface Group { readonly id: string; readonly keys: Record<string, KeyReading>; rows: number; readonly values: number[]; missing: number; value?: number | null }

/** Compiles a validated recipe chart over the rows after its data.transform. Throws DocumentInvalid on errors. */
export function compileRecipe(chart: RecipeChartV1, rows: readonly Row[], context: CompileContext = {}): RecipeCompilation {
  const id = chart.recipe as RecipeId
  const def = recipeDefinition(id)
  const authored = (chart.options ?? {}) as Record<string, unknown>
  const defaults = Object.fromEntries(Object.entries(optionDefaults(id, authored)).filter(([k]) => authored[k] === undefined))
  const options: Record<string, unknown> = { ...defaults, ...authored }
  const b = chart.bindings as Record<string, string | undefined>
  const issues = new IssueList()
  const problems = new RowProblems()

  // Fields are resolved against the data after data.transform.
  if (rows.length === 0) issues.warn("EMPTY_DATA", "The data has no rows after data.transform, so the chart has no marks.", "/chart/data", "Check data.rows or the file, and any data.transform filter.")
  else {
    const fields = new Set<string>()
    for (const row of rows) for (const key of Object.keys(row)) fields.add(key)
    for (const spec of def.bindings) {
      const field = b[spec.role]
      if (field === undefined || fields.has(field)) continue
      const close = suggest(field, [...fields])
      issues.error("UNKNOWN_FIELD", `Field "${field}" is not in the data after data.transform.${close.length ? ` Did you mean ${close.map(c => `"${c}"`).join(" or ")}?` : ""} The fields are: ${[...fields].slice(0, 30).join(", ")}.`, bindingPath(spec.role), close.length ? `Set bindings.${spec.role} to "${close[0]}".` : "Bind one of the listed fields, or create it with a calculate transform.")
    }
  }
  issues.throwIfErrors()

  const colorRole = def.colorRole && b[def.colorRole] !== undefined ? def.colorRole : undefined
  const colorField = colorRole ? b[colorRole]! : undefined
  const bound = new Set(Object.values(b).filter((f): f is string => typeof f === "string"))
  const internal: string[] = []

  // The colour domain, from every row after the transform: typed identity, type order, independent of display sort.
  let domain: CategoryValue[] | undefined
  if (colorField) {
    const seen: CategoryValue[] = []
    // Bad values are reported once, by the pass that draws the marks.
    const ignored = new RowProblems()
    rows.forEach((row, i) => { const k = readKey("category", colorRole!, colorField, row, i, ignored); if (k) seen.push(k.order) })
    const fresh = categoryDomain(seen)
    if (context.categoryDomain) {
      const known = new Set(context.categoryDomain.map(categoryKey))
      domain = [...context.categoryDomain, ...fresh.filter(v => !known.has(categoryKey(v)))]
    } else domain = fresh
  }

  const title = (key: "xTitle" | "yTitle") => (typeof options[key] === "string" ? { title: options[key] as string } : {})
  const colorScale = domain ? { domain } : undefined
  const colorEncoding = colorField ? { color: { field: colorField, type: "nominal", scale: colorScale } } : {}
  let spec: Record<string, unknown>
  let values: Row[]
  let groups: number | undefined

  if (id === "scatter" || id === "bubble") {
    values = []
    rows.forEach((row, i) => {
      const x = readKey("quantitative", "x", b.x!, row, i, problems), y = readKey("quantitative", "y", b.y!, row, i, problems)
      let size: number | undefined
      if (id === "bubble") {
        const s = row[b.size!]
        if (isMissing(s)) problems.error("VALUE_MISSING", "size", b.size!, "has no value", filterFix(b.size!), i, s)
        else if ((size = finiteNumber(s)) === undefined) problems.error("TYPE_MISMATCH", "size", b.size!, "is not a finite number", numberFix(b.size!), i, s)
      }
      const series = colorField ? readKey("category", "series", colorField, row, i, problems) : undefined
      if (!x || !y || (id === "bubble" && size === undefined) || (colorField && !series)) return
      values.push({ [b.x!]: x.display, [b.y!]: y.display, ...(id === "bubble" ? { [b.size!]: size } : {}), ...(colorField ? { [colorField]: series!.display } : {}) })
    })
    problems.report(issues)
    issues.throwIfErrors()
    spec = {
      mark: id === "scatter" ? { type: "point", filled: true, opacity: values.length > 500 ? 0.35 : 0.8 } : { type: "circle", opacity: 0.6 },
      encoding: {
        x: { field: b.x, type: "quantitative", ...title("xTitle") },
        y: { field: b.y, type: "quantitative", ...title("yTitle") },
        ...(id === "bubble" ? { size: { field: b.size, type: "quantitative", scale: { range: [30, 900] } } } : {}),
        ...colorEncoding,
      },
    }
  } else if (id === "histogram" || id === "box_plot") {
    values = []
    let missing = 0
    const cats: KeyReading[] = []
    rows.forEach((row, i) => {
      const v = readMeasure("value", b.value!, row, i, problems)
      const cat = id === "box_plot" ? readKey("category", "category", b.category!, row, i, problems) : undefined
      if (v === undefined || (id === "box_plot" && !cat)) return
      if (v === null) { missing++; return }
      if (cat) cats.push(cat)
      values.push({ ...(cat ? { [b.category!]: cat.display } : {}), [b.value!]: v })
    })
    problems.report(issues)
    issues.throwIfErrors()
    if (missing) issues.warn("VALUE_MISSING", `${missing} row(s) have no value for "${b.value}" and are left out of the ${id === "histogram" ? "bins" : "distribution"}.`, bindingPath("value"), filterFix(b.value!))
    if (id === "histogram") {
      spec = {
        mark: "bar",
        encoding: {
          x: { field: b.value, type: "quantitative", bin: { maxbins: options.bins }, ...title("xTitle") },
          y: { aggregate: "count", type: "quantitative", title: typeof options.yTitle === "string" ? options.yTitle : "Count" },
        },
      }
    } else {
      const order = orderedKeys(cats, (options.sort as string).replace("category-", "") as "input" | "ascending" | "descending")
      const rank = new Map(order.map((k, i) => [k.id, i]))
      const keyed = values.map((row, i) => ({ row, r: rank.get(cats[i]!.id)! }))
      values = stableSort(keyed, (a, c) => a.r - c.r).map(x => x.row)
      spec = {
        mark: { type: "boxplot", extent: 1.5 },
        encoding: { x: { field: b.category, type: "nominal", sort: null, ...title("xTitle") }, y: { field: b.value, type: "quantitative", ...title("yTitle") } },
      }
    }
  } else {
    // The aggregating recipes: one mark per group.
    const op = options.aggregate as Aggregate
    const measureRole = id === "line" || id === "area" || id === "stacked_area" ? "y" : "value"
    const measureField = op === "count" ? undefined : b[measureRole]
    const xType = options.xType as XType | undefined
    const roles: [string, "category" | XType][] = def.groupBy.filter(r => b[r] !== undefined).map(r => [r, r === "x" ? xType! : "category"])
    const byId = new Map<string, Group>()
    let missingRows = 0
    rows.forEach((row, i) => {
      const keys: Record<string, KeyReading> = {}
      let ok = true
      for (const [r, kind] of roles) { const k = readKey(kind, r, b[r]!, row, i, problems); if (k) keys[r] = k; else ok = false }
      const measure = measureField ? readMeasure(measureRole, measureField, row, i, problems) : null
      if (!ok || measure === undefined) return
      const gid = JSON.stringify(roles.map(([r]) => keys[r]!.id))
      let g = byId.get(gid)
      if (!g) byId.set(gid, (g = { id: gid, keys, rows: 0, values: [], missing: 0 }))
      g.rows++
      if (measureField) { if (measure === null) { g.missing++; missingRows++ } else g.values.push(measure) }
    })
    problems.report(issues)
    issues.throwIfErrors()
    const all = [...byId.values()]
    groups = all.length
    const noun = roles.map(([r]) => r).join(" and ")
    if (op === "none") {
      const repeated = all.filter(g => g.rows > 1)
      if (repeated.length) {
        const g = repeated[0]!
        const at = roles.map(([r]) => `${r} ${typeof g.keys[r]!.display === "string" ? JSON.stringify(g.keys[r]!.display) : String(g.keys[r]!.display)}`).join(", ")
        const allowed = def.options.aggregate!.filter(a => a !== "none").join(", ")
        issues.error("AGGREGATION_REQUIRED", `${repeated.length} ${noun} group(s) have more than one row after data.transform (for example ${at} has ${g.rows} rows), and options.aggregate is "none", so one mark would stand for several rows.`, optionPath("aggregate"), `Say how to combine them: set options.aggregate to one of ${allowed}; or give one row per group (aggregate first with data.transform).`)
        issues.throwIfErrors()
      }
    }
    for (const g of all) g.value = op === "count" ? g.rows : op === "none" ? (g.values[0] ?? null) : aggregateValues(op, g.values)
    const empty = all.filter(g => g.value === null).length
    if (missingRows) {
      issues.warn("VALUE_MISSING", op === "none"
        ? `${missingRows} row(s) have no value for "${measureField}"; their marks are left empty.`
        : `${missingRows} row(s) have no value for "${measureField}" and are left out of the ${op}${empty ? `; ${empty} group(s) have no value at all and are left empty, not zero` : ""}.`, bindingPath(measureRole), filterFix(measureField!))
    }
    if ((id === "pie" || id === "donut") && all.some(g => (g.value ?? 0) < 0)) {
      const negative = all.filter(g => (g.value ?? 0) < 0)
      issues.error("PIE_NEGATIVE", `${negative.length} slice(s) are negative, such as ${showCategory(negative[0]!.keys.category!.order)} (${negative[0]!.value}); a ${id} cannot show a negative part.`, bindingPath("value"), "Use bar or horizontal_bar, which show negative values, or filter those rows out with data.transform.")
      issues.throwIfErrors()
    }
    const measureName = measureField ?? uniqueName("count", bound)
    const measureTitle = op === "count" ? "Count" : op === "none" ? undefined : `${AGG_LABEL[op]} of ${measureField}`
    const markRow = (g: Group): Row => {
      const row: Row = {}
      for (const [r] of roles) row[b[r]!] = g.keys[r]!.display
      row[measureName] = g.value
      return row
    }
    const measure = (axisTitle: "xTitle" | "yTitle", extra: Record<string, unknown> = {}) => ({ field: measureName, type: "quantitative", ...(measureTitle !== undefined ? { title: measureTitle } : {}), ...title(axisTitle), ...extra })
    const seriesRank = domain ? new Map(domain.map((v, i) => [categoryKey(v), i])) : undefined
    const bySeries = (g: Group) => (seriesRank && g.keys.series ? seriesRank.get(g.keys.series.id) ?? 0 : 0)

    if (id === "bar" || id === "horizontal_bar" || id === "pie" || id === "donut") {
      const sort = options.sort as string
      let ordered = all
      if (sort.startsWith("category-")) ordered = stableSort(all, (a, c) => (sort === "category-ascending" ? 1 : -1) * compareCategories(a.keys.category!.order, c.keys.category!.order))
      else if (sort.startsWith("value-")) ordered = stableSort(all, (a, c) => {
        if (a.value === null || c.value === null) return a.value === null ? (c.value === null ? 0 : 1) : -1
        return (sort === "value-ascending" ? 1 : -1) * (a.value! - c.value!)
      })
      values = ordered.map(markRow)
      if (id === "pie" || id === "donut") {
        const rankField = uniqueName("slice_order", new Set([...bound, measureName]))
        internal.push(rankField)
        values.forEach((row, i) => { row[rankField] = i })
        spec = {
          mark: { type: "arc", ...(id === "donut" ? { innerRadius: 70 } : {}) },
          encoding: {
            theta: { field: measureName, type: "quantitative", stack: true, ...(measureTitle !== undefined ? { title: measureTitle } : {}) },
            color: { field: b.category, type: "nominal", scale: colorScale },
            order: { field: rankField, type: "quantitative", sort: "ascending" },
          },
        }
      } else {
        const category = (axisTitle: "xTitle" | "yTitle") => ({ field: b.category, type: "nominal", sort: null, ...title(axisTitle) })
        spec = { mark: "bar", encoding: id === "bar" ? { x: category("xTitle"), y: measure("yTitle") } : { y: category("yTitle"), x: measure("xTitle") } }
      }
    } else if (id === "grouped_bar" || id === "stacked_bar") {
      const order = orderedKeys(all.map(g => g.keys.category!), (options.sort as string).replace("category-", "") as "input" | "ascending" | "descending")
      const rank = new Map(order.map((k, i) => [k.id, i]))
      values = stableSort(all, (a, c) => rank.get(a.keys.category!.id)! - rank.get(c.keys.category!.id)! || bySeries(a) - bySeries(c)).map(markRow)
      spec = {
        mark: "bar",
        encoding: {
          x: { field: b.category, type: "nominal", sort: null, ...title("xTitle") },
          ...(id === "grouped_bar" ? { xOffset: { field: b.series, type: "nominal", scale: colorScale } } : {}),
          y: measure("yTitle"),
          ...colorEncoding,
        },
      }
    } else if (id === "heatmap") {
      values = all.map(markRow)
      const axis = (role: "column" | "row", option: "columnSort" | "rowSort", axisTitle: "xTitle" | "yTitle") => {
        const order = options[option] as "input" | "ascending" | "descending"
        return { field: b[role], type: "ordinal", sort: order === "input" ? null : orderedKeys(all.map(g => g.keys[role]!), order).map(k => k.display), ...title(axisTitle) }
      }
      // xTitle and yTitle name the axes; the colour legend is titled by the measure.
      spec = { mark: "rect", encoding: { x: axis("column", "columnSort", "xTitle"), y: axis("row", "rowSort", "yTitle"), color: { field: measureName, type: "quantitative", ...(measureTitle !== undefined ? { title: measureTitle } : {}) } } }
    } else {
      // line, area, stacked_area
      const xSort = options.xSort as "input" | "ascending" | "descending"
      const continuous = xType !== "ordinal"
      let ordered: Group[]
      if (continuous) ordered = xSort === "input" ? all : stableSort(all, (a, c) => (a.keys.x!.order as number) - (c.keys.x!.order as number) || bySeries(a) - bySeries(c))
      else {
        const order = orderedKeys(all.map(g => g.keys.x!), xSort)
        const rank = new Map(order.map((k, i) => [k.id, i]))
        ordered = stableSort(all, (a, c) => rank.get(a.keys.x!.id)! - rank.get(c.keys.x!.id)! || bySeries(a) - bySeries(c))
      }
      values = ordered.map(markRow)
      const stacked = id === "stacked_area"
      const overlapping = id === "area" && colorField !== undefined
      spec = {
        mark: id === "line" ? { type: "line", point: values.length <= 40 } : stacked ? "area" : { type: "area", line: true, ...(overlapping ? { opacity: 0.55 } : {}) },
        encoding: {
          x: { field: b.x, type: xType, ...(continuous ? (xSort === "descending" ? { scale: { reverse: true } } : {}) : { sort: null }), ...title("xTitle") },
          y: measure("yTitle", stacked ? { stack: "zero" } : overlapping ? { stack: null } : {}),
          ...colorEncoding,
          // Paths follow the row order when x is ordinal or kept in input order; otherwise Vega-Lite orders them by x.
          ...(!continuous || xSort === "input" ? { order: { value: null } } : {}),
        },
      }
    }
  }

  return {
    recipe: id,
    spec: { $schema: VEGA_LITE_SCHEMA, data: { name: RECIPE_DATA_NAME }, ...spec },
    dataName: RECIPE_DATA_NAME,
    values,
    options,
    defaults,
    ...(colorField && domain ? { categories: { role: colorRole!, field: colorField, domain } } : {}),
    internalFields: internal,
    diagnostics: issues.warnings(),
    stats: { inputRows: rows.length, markRows: values.length, ...(groups !== undefined ? { groups } : {}) },
  }
}
