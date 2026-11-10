import { compile } from "vega-lite"
import { ChartsError, suggest, type Issue, pointer } from "../errors.js"
import type { FontBook } from "../fonts.js"
import type { Profile, Row } from "../data.js"
import { profile as profileRows } from "../data.js"
import type { ResolvedLocale } from "../locale.js"
import { vegaLiteConfig } from "../themes/adapters.js"
import type { ThemeTokens } from "../themes/tokens.js"
import { calendarOrder, compactSpec, deepMerge, humanise, isObject, substituteData, type Json } from "./common.js"

const TOP_LEVEL = new Set(["$schema", "data", "mark", "encoding", "transform", "layer", "facet", "spec", "repeat", "concat", "hconcat", "vconcat", "width", "height", "title", "description", "name", "config", "params", "projection", "resolve", "autosize", "background", "padding", "usermeta", "datasets", "align", "bounds", "center", "spacing", "columns", "view", "selection"])
const CHANNELS = new Set(["x", "y", "x2", "y2", "xOffset", "yOffset", "xError", "xError2", "yError", "yError2", "color", "fill", "stroke", "opacity", "fillOpacity", "strokeOpacity", "strokeWidth", "strokeDash", "size", "angle", "shape", "text", "tooltip", "description", "detail", "key", "order", "facet", "row", "column", "theta", "theta2", "radius", "radius2", "latitude", "longitude", "latitude2", "longitude2"])
const MARKS = new Set(["arc", "area", "bar", "boxplot", "circle", "errorband", "errorbar", "geoshape", "line", "point", "rect", "rule", "square", "text", "tick", "trail"])
const TYPES = new Set(["quantitative", "nominal", "ordinal", "temporal", "geojson"])
const TYPE_ALIASES: Record<string, string> = { q: "quantitative", n: "nominal", o: "ordinal", t: "temporal", number: "quantitative", numeric: "quantitative", category: "nominal", categorical: "nominal", string: "nominal", date: "temporal", time: "temporal", datetime: "temporal" }
/** Encodings whose title the plugin made from the field name (so lint still asks for a unit). */
const autoTitled = new WeakSet<object>()
const RAINBOW = new Set(["rainbow", "sinebow", "category10", "category20", "tableau10", "tableau20", "set1", "set2", "set3", "paired", "dark2", "accent", "pastel1", "pastel2", "turbo"])

export interface Unit { readonly spec: Json; readonly path: (string | number)[]; readonly mark?: string; readonly encoding: Json }

/** Every unit spec (one with a mark), with its JSON path, through layer, facet, repeat and concat. */
export function units(spec: Json, path: (string | number)[] = []): Unit[] {
  const out: Unit[] = []
  if (spec.mark !== undefined) {
    const mark = typeof spec.mark === "string" ? spec.mark : isObject(spec.mark) && typeof spec.mark.type === "string" ? spec.mark.type : undefined
    out.push({ spec, path, ...(mark ? { mark } : {}), encoding: isObject(spec.encoding) ? spec.encoding : {} })
  }
  for (const key of ["layer", "concat", "hconcat", "vconcat"]) if (Array.isArray(spec[key])) (spec[key] as unknown[]).forEach((s, i) => { if (isObject(s)) out.push(...units(s, [...path, key, i])) })
  if (isObject(spec.spec)) out.push(...units(spec.spec, [...path, "spec"]))
  return out
}

/** Field names the spec itself creates with transforms (calculate as, aggregate as, fold, window…). */
function createdFields(spec: Json): { names: Set<string>; open: boolean } {
  const names = new Set<string>()
  let open = false
  const add = (v: unknown) => { if (typeof v === "string") names.add(v); else if (Array.isArray(v)) v.forEach(add) }
  const visit = (node: unknown) => {
    if (Array.isArray(node)) { node.forEach(visit); return }
    if (!isObject(node)) return
    if (Array.isArray(node.transform)) for (const t of node.transform) {
      if (!isObject(t)) continue
      add(t.as)
      for (const key of ["aggregate", "joinaggregate", "window"]) if (Array.isArray(t[key])) for (const op of t[key] as Json[]) add(op?.as)
      if (t.fold !== undefined && t.as === undefined) add(["key", "value"])
      if (t.density !== undefined && t.as === undefined) add(["value", "density"])
      if (t.quantile !== undefined && t.as === undefined) add(["prob", "value"])
      if (t.flatten !== undefined && t.as === undefined) add(t.flatten)
      if (t.lookup !== undefined && isObject(t.from) && t.as === undefined) add(t.from.fields)
      if (t.pivot !== undefined || t.lookup !== undefined && t.as === undefined && !isObject(t.from)) open = true
      if (t.regression !== undefined || t.loess !== undefined) { add(t.on); add(t.regression ?? t.loess) }
      if (t.bin !== undefined && typeof t.field === "string" && t.as === undefined) open = true
    }
    for (const [k, child] of Object.entries(node)) if (k !== "values" && k !== "data") visit(child)
  }
  visit(spec)
  return { names, open }
}

export interface VegaLiteContext {
  readonly packageRoot: string
  readonly theme: ThemeTokens
  readonly fonts: FontBook
  readonly locale: ResolvedLocale
  readonly rows?: Row[]
  readonly dataName: string
  readonly title?: string
  readonly description?: string
  /** Fields that are money and take the currency; `true` for every quantitative field that looks like money. */
  readonly currencyFields?: readonly string[] | true
  readonly width?: number
  readonly height?: number
}

export interface PreparedVegaLite { readonly spec: Json; readonly profile?: Profile; readonly issues: Issue[]; readonly notes: string[] }

const MONEY = /(revenue|sales|price|cost|spend|profit|income|amount|gmv|arr|mrr|budget|salary|fee|payment|value_(usd|eur|gbp)|usd|eur|gbp|turnover|margin_abs|ebitda)/i
const NOT_MONEY = /(pct|percent|share|rate|ratio|count|qty|quantity|units|year|month|day|week|score|rank|index|id$)/i
const PERCENT = /(pct|percent|share|rate|ratio|conversion|churn|margin(?!_abs))/i

/** Prepares a Vega-Lite spec: data and atlases in, theme and locale config, smart defaults; then validates and lints. */
export function prepareVegaLite(input: Json, ctx: VegaLiteContext): PreparedVegaLite {
  const issues: Issue[] = [], notes: string[] = []
  const spec = structuredClone(input) as Json
  delete spec.$schema

  // Teach the top-level shape first.
  for (const key of Object.keys(spec)) if (!TOP_LEVEL.has(key)) {
    const close = suggest(key, [...TOP_LEVEL])
    issues.push({ level: "error", code: "UNKNOWN_PROPERTY", message: `"${key}" is not a Vega-Lite top-level property.`, path: pointer([key]), fix: close.length ? `Did you mean "${close[0]}"?` : "Remove it." })
  }
  if (spec.mark === undefined && !["layer", "facet", "repeat", "concat", "hconcat", "vconcat"].some(k => spec[k] !== undefined))
    issues.push({ level: "error", code: "NO_MARK", message: "The spec has no mark (and no layer, facet, repeat or concat).", path: "/", fix: "Add \"mark\": \"bar\" (or line, point, area, arc, rect, …) and an \"encoding\"." })

  // Data: rows given to the tool go wherever the spec names them, or become the top-level data.
  const used = substituteData(spec, ctx.packageRoot, ctx.rows, ctx.dataName)
  if (ctx.rows && used === 0) {
    if (spec.data === undefined) spec.data = { values: ctx.rows }
    else if (isObject(spec.data) && (spec.data as Json).values !== undefined) issues.push({ level: "error", code: "DATA_TWICE", message: "Rows were passed in data, and the spec has its own data.values.", path: "/data", fix: `Remove one: keep data.rows and set the spec's data to {"name": "${ctx.dataName}"}, or drop data.rows.` })
    else if (!isObject(spec.data) || spec.data.atlas === undefined) spec.data = { values: ctx.rows }
  }
  const values = isObject(spec.data) && Array.isArray(spec.data.values) ? (spec.data.values as Row[]) : ctx.rows
  const isGeo = JSON.stringify(spec).includes('"topojson"')
  const prof = values && !isGeo ? profileRows(values) : values ? profileRows(values) : undefined
  if (!values && spec.data === undefined && !isGeo) issues.push({ level: "error", code: "DATA_MISSING", message: "The chart has no data.", path: "/data", fix: "Pass data.rows or data.path to the tool, or put data.values in the spec." })
  if (values && values.length === 0) issues.push({ level: "warning", code: "EMPTY_DATA", message: "The data has no rows, so the chart is empty.", path: "/data" })

  // Theme, locale, and the compact number format.
  const decimal = ctx.locale.number.decimal
  const userConfig = isObject(spec.config) ? spec.config : {}
  spec.config = deepMerge(deepMerge(vegaLiteConfig(ctx.theme), { locale: { number: ctx.locale.number, ...(ctx.locale.time ? { time: ctx.locale.time } : {}) }, customFormatTypes: true }), userConfig)
  if (ctx.width && spec.width === undefined) spec.width = ctx.width
  if (ctx.height && spec.height === undefined) spec.height = ctx.height
  if (ctx.title && spec.title === undefined) spec.title = ctx.title
  if (ctx.description && spec.description === undefined) spec.description = ctx.description

  const created = createdFields(spec)
  const known = new Set([...(prof?.fields.map(f => f.name) ?? []), ...created.names])
  const fieldProfile = (name: string) => prof?.fields.find(f => f.name === name)
  const step = ctx.theme.layout.step

  // Time zones: every temporal scale and time unit is UTC, so output is identical on any host.
  const utcUnit = (u: unknown): unknown => typeof u === "string" ? (u.startsWith("utc") ? u : `utc${u}`) : isObject(u) && typeof u.unit === "string" ? { ...u, unit: u.unit.startsWith("utc") ? u.unit : `utc${u.unit}` } : u
  const visitTransforms = (node: unknown) => {
    if (Array.isArray(node)) { node.forEach(visitTransforms); return }
    if (!isObject(node)) return
    if (Array.isArray(node.transform)) for (const t of node.transform) if (isObject(t) && t.timeUnit !== undefined) t.timeUnit = utcUnit(t.timeUnit)
    for (const [k, child] of Object.entries(node)) if (k !== "data" && k !== "values") visitTransforms(child)
  }
  visitTransforms(spec)

  // Discrete axes size to their categories: roomy for a few, a fixed step per category for many.
  if (spec.mark !== undefined || Array.isArray(spec.layer)) {
    const first = units(spec)[0]
    const discrete = (c: string) => { const d = first?.encoding[c]; return isObject(d) && (d.type === "nominal" || d.type === "ordinal") && typeof d.field === "string" && !isObject(d.bin) ? d.field as string : undefined }
    const count = (f: string | undefined) => (f && values ? new Set(values.map(r => r[f])).size : 0)
    const xf = discrete("x"), yf = discrete("y")
    if (xf && spec.width === undefined && first?.mark !== "arc") spec.width = Math.max(Math.min(ctx.theme.layout.width, count(xf) * 72), count(xf) * step)
    if (yf && !xf && spec.height === undefined) spec.height = Math.max(Math.min(ctx.theme.layout.height, count(yf) * 40), count(yf) * step)
  }

  for (const unit of units(spec)) {
    const { encoding, path, mark } = unit
    if (unit.mark && !MARKS.has(unit.mark)) {
      const close = suggest(unit.mark, [...MARKS])
      issues.push({ level: "error", code: "UNKNOWN_MARK", message: `"${unit.mark}" is not a Vega-Lite mark.`, path: pointer([...path, "mark"]), fix: close.length ? `Did you mean "${close[0]}"?` : `Use one of: ${[...MARKS].join(", ")}.` })
    }
    for (const [channel, def] of Object.entries(encoding)) {
      const encPath = [...path, "encoding", channel]
      if (!CHANNELS.has(channel)) {
        const close = suggest(channel, [...CHANNELS])
        issues.push({ level: "error", code: "UNKNOWN_CHANNEL", message: `"${channel}" is not an encoding channel.`, path: pointer(encPath), fix: close.length ? `Did you mean "${close[0]}"?` : "Remove it." })
        continue
      }
      for (const [i, d] of (Array.isArray(def) ? def : [def]).entries()) {
        if (!isObject(d)) continue
        const dPath = Array.isArray(def) ? [...encPath, i] : encPath
        if (typeof d.type === "string" && !TYPES.has(d.type)) {
          const alias = TYPE_ALIASES[d.type.toLowerCase()]
          if (alias) { notes.push(`Read type "${d.type}" at ${pointer([...dPath, "type"])} as ${alias}.`); d.type = alias }
          else issues.push({ level: "error", code: "UNKNOWN_TYPE", message: `"${d.type}" is not an encoding type.`, path: pointer([...dPath, "type"]), fix: "Use quantitative, nominal, ordinal or temporal." })
        }
        const field = typeof d.field === "string" ? d.field : undefined
        if (field && prof && !isGeo && !created.open) {
          const head = field.replace(/\\\./g, "\u0000").split(".")[0]!.replace(/\u0000/g, ".")
          if (!known.has(field) && !known.has(head)) {
            const close = suggest(field, [...known])
            issues.push({ level: "error", code: "UNKNOWN_FIELD", message: `Field "${field}" is not in the data.${close.length ? ` Did you mean ${close.map(c => `"${c}"`).join(" or ")}?` : ""} The fields are: ${[...known].slice(0, 30).join(", ")}.`, path: pointer([...dPath, "field"]), fix: close.length ? `Set field to "${close[0]}".` : "Use one of the listed fields, or create it with a calculate transform." })
            continue
          }
        }
        const fp = field ? fieldProfile(field) : undefined
        if (fp && d.type === "quantitative" && (fp.type === "string") && !["count", "distinct", "valid", "missing"].includes(String(d.aggregate ?? ""))) {
          issues.push({ level: "error", code: "TYPE_MISMATCH", message: `Field "${field}" holds text (${fp.top?.slice(0, 3).join(", ")}…) but is encoded as quantitative.`, path: pointer([...dPath, "type"]), fix: `Use "type": "nominal", or aggregate it with "aggregate": "count".` })
        }
        if (fp && d.type === "temporal" && fp.type === "string") issues.push({ level: "warning", code: "NOT_A_DATE", message: `Field "${field}" is encoded as temporal but its values (${fp.top?.slice(0, 2).join(", ")}) are not ISO dates.`, path: pointer([...dPath, "type"]), fix: "Use ISO dates (2024-03-01) in the data, or type ordinal." })

        // Smart defaults that only fill gaps the spec left open.
        if (d.type === "temporal") {
          if (d.timeUnit !== undefined) d.timeUnit = utcUnit(d.timeUnit)
          else d.scale = { type: "utc", ...(isObject(d.scale) ? d.scale : {}) }
        }
        const guide = ["x", "y", "theta", "radius"].includes(channel) ? "axis" : ["color", "size", "opacity", "fill", "stroke", "shape"].includes(channel) ? "legend" : undefined
        const hasFormat = d.format !== undefined || (guide && isObject(d[guide]) && (d[guide] as Json).format !== undefined)
        if (d.type === "quantitative" && !hasFormat && d.aggregate !== "count" && field) {
          const money = ctx.currencyFields === true ? MONEY.test(field) && !NOT_MONEY.test(field) : ctx.currencyFields?.includes(field)
          const fraction = PERCENT.test(field) && fp?.type === "number" && (fp.min as number) >= -1 && (fp.max as number) <= 1
          let format: { format: string; formatType?: string } | undefined
          if (fraction) format = { format: ".0%" }
          else if (money && ctx.locale.currency) format = { format: compactSpec(ctx.locale.number.currency, decimal), formatType: "compact" }
          else if (fp?.type === "number" && Math.max(Math.abs(fp.min as number), Math.abs(fp.max as number)) >= 10_000) format = { format: compactSpec(undefined, decimal), formatType: "compact" }
          if (format) {
            if (guide && d[guide] !== null) d[guide] = { ...format, ...(isObject(d[guide]) ? d[guide] as Json : {}) }
            else if (channel === "text" || channel === "tooltip") Object.assign(d, format)
          }
        }
        if (guide && d.title === undefined && field && !d.aggregate && d.bin === undefined && d.timeUnit === undefined && !field.includes(".") && !(isObject(d[guide]) && (d[guide] as Json).title !== undefined)) { d.title = humanise(field); autoTitled.add(d) }

        // Lines and points need no zero baseline: start near the data when it sits far from zero. Bars keep zero.
        if (d.type === "quantitative" && (channel === "y" || channel === "x") && ["line", "point", "circle", "square", "trail"].includes(mark ?? "") && fp?.type === "number" && !(isObject(d.scale) && (d.scale as Json).zero !== undefined) && d.aggregate === undefined && d.bin === undefined && d.stack === undefined) {
          const min = fp.min as number, max = fp.max as number
          if (min > 0 && min > max * 0.35) { d.scale = { zero: false, ...(isObject(d.scale) ? d.scale as Json : {}) }; notes.push(`Started the ${channel} axis near the data (${field} ranges ${min}–${max}).`) }
        }

        // Calendar order for months and weekdays, unless the spec sorts.
        if ((d.type === "nominal" || d.type === "ordinal") && field && d.sort === undefined && values) {
          const order = calendarOrder(values.map(r => r[field]))
          if (order) { d.sort = order; notes.push(`Ordered ${field} as a calendar (${order[0]}…${order[order.length - 1]}).`) }
        }

        // Long or many category labels on x: angle them before they collide.
        if (channel === "x" && (d.type === "nominal" || d.type === "ordinal") && field && values && d.axis !== null) {
          const labels = [...new Set(values.map(r => String(r[field] ?? "")))]
          const longest = Math.max(0, ...labels.map(l => ctx.fonts.measure(l.slice(0, 40), ctx.theme.font.labelSize, ctx.theme.font.family)))
          const width = typeof unit.spec.width === "number" ? unit.spec.width : typeof spec.width === "number" ? spec.width : undefined
          const available = width ? width / Math.max(1, labels.length) : step
          const axis = isObject(d.axis) ? d.axis as Json : {}
          if (axis.labelAngle === undefined && longest > available * 0.92) {
            d.axis = { labelAngle: -40, labelAlign: "right", labelBaseline: "top", labelOverlap: false, ...axis }
            notes.push(`Angled the ${field} labels so they do not collide.`)
          }
          if (labels.length > 60) issues.push({ level: "warning", code: "LABEL_DENSITY", message: `${labels.length} categories on x: their labels cannot all be read.`, path: pointer(dPath), fix: "Aggregate to fewer categories, filter to the top N, or swap to a horizontal bar chart with y as the category." })
        }

        // Many legend entries go below the chart in columns.
        if ((channel === "color" || channel === "fill") && (d.type === "nominal" || d.type === "ordinal") && field && values && d.legend !== null) {
          const count = new Set(values.map(r => r[field])).size
          if (count > 8 && !(isObject(d.legend) && (d.legend as Json).orient !== undefined)) d.legend = { orient: "bottom", columns: Math.min(5, Math.ceil(count / 3)), ...(isObject(d.legend) ? d.legend as Json : {}) }
        }
      }
    }
  }
  // Units share axes in a layer, so a title on any of them names the axis.
  const titled = new Set<string>()
  for (const unit of units(spec)) for (const c of ["x", "y"]) { const d = unit.encoding[c]; if (isObject(d) && ((d.title !== undefined && !autoTitled.has(d)) || (isObject(d.axis) && (d.axis as Json).title !== undefined))) titled.add(c) }
  for (const unit of units(spec)) lintUnit(unit, prof, issues, values, titled)
  return { spec, ...(prof ? { profile: prof } : {}), issues, notes }
}

function lintUnit(unit: Unit, prof: Profile | undefined, issues: Issue[], values: Row[] | undefined, titled: Set<string>) {
  const { encoding: e, path, mark } = unit
  const at = (...p: (string | number)[]) => pointer([...path, ...p])
  const distinct = (field: unknown) => (typeof field === "string" && values ? new Set(values.map(r => r[field])).size : 0)
  const enc = (c: string) => (isObject(e[c]) ? (e[c] as Json) : undefined)
  if (mark === "arc" && !enc("radius")) {
    const color = enc("color")
    const n = color?.type === "nominal" || color?.type === "ordinal" ? distinct(color?.field) : 0
    if (n > 7) issues.push({ level: "warning", code: "PIE_TOO_MANY_SLICES", message: `A pie with ${n} slices: angles this close cannot be compared.`, path: at("encoding", "color"), fix: "Use a bar chart sorted by value, or keep the top 5 and group the rest as Other." })
    const theta = enc("theta")
    if (typeof theta?.field === "string" && values?.some(r => typeof r[theta.field as string] === "number" && (r[theta.field as string] as number) < 0)) issues.push({ level: "error", code: "PIE_NEGATIVE", message: "A pie cannot show negative values.", path: at("encoding", "theta"), fix: "Use a bar chart (or a waterfall for gains and losses)." })
  }
  if (mark === "line" || mark === "area" || mark === "trail") {
    const n = distinct(enc("color")?.field)
    if (n > 10) issues.push({ level: "warning", code: "TOO_MANY_SERIES", message: `${n} lines in one chart: the colours cannot be told apart.`, path: at("encoding", "color"), fix: "Highlight the few that matter and grey the rest, or facet into small multiples with \"row\"/\"column\"." })
  }
  if (mark === "bar" || mark === "area") for (const c of ["x", "y"]) {
    const scale = enc(c)?.scale
    if (enc(c)?.type === "quantitative" && isObject(scale) && (scale.zero === false || (Array.isArray(scale.domain) && typeof scale.domain[0] === "number" && (scale.domain[0] as number) > 0)))
      issues.push({ level: "warning", code: "TRUNCATED_AXIS", message: `The ${c} axis of a ${mark} chart does not start at zero, which exaggerates differences.`, path: at("encoding", c, "scale"), fix: "Remove scale.zero:false / the domain, or use a line or point chart for a zoomed range." })
  }
  for (const c of ["color", "fill"]) {
    const d = enc(c), scale = d && isObject(d.scale) ? d.scale as Json : undefined
    const scheme = scale ? (isObject(scale.scheme) ? (scale.scheme as Json).name : scale.scheme) : undefined
    if (d?.type === "quantitative" && typeof scheme === "string" && RAINBOW.has(scheme.toLowerCase())) issues.push({ level: "warning", code: "RAINBOW_SEQUENTIAL", message: `The "${scheme}" scheme on a quantitative field reads as categories, not as more and less.`, path: at("encoding", c, "scale", "scheme"), fix: "Drop the scheme to use the theme's sequential ramp, or use viridis, blues, or a diverging scheme such as redblue around a midpoint." })
  }
  if ((mark === "point" || mark === "circle" || mark === "square") && (values?.length ?? 0) > 2000) {
    const opacity = isObject(unit.spec.mark) ? (unit.spec.mark as Json).opacity : undefined
    if (opacity === undefined || (opacity as number) > 0.6) issues.push({ level: "warning", code: "OVERPLOTTING", message: `${values!.length} points will overlap into a blot.`, path: at("mark"), fix: "Set mark.opacity to about 0.3, or bin into a heatmap (rect with bin on x and y)." })
  }
  for (const c of ["x", "y"]) {
    const d = enc(c)
    if (d?.type === "quantitative" && typeof d.field === "string" && d.axis !== null && !titled.has(c) && d.aggregate !== "count" && (d.title === undefined || (autoTitled.has(d) && !String(d.title).includes("("))) && !(isObject(d.axis) && ((d.axis as Json).title !== undefined || (d.axis as Json).format !== undefined)) && !PERCENT.test(d.field) && !MONEY.test(d.field))
      issues.push({ level: "warning", code: "MISSING_UNITS", message: `The ${c} axis "${d.field}" has no unit.`, path: at("encoding", c), fix: `Set "title" with the unit, such as "${humanise(d.field)} (€k)" or "(%)".` })
    if (d && (d.type === "nominal") && typeof d.field === "string") {
      const fp = prof?.fields.find(f => f.name === d.field)
      if (fp?.type === "temporal" && fp.distinct > 12 && (c === "x")) issues.push({ level: "warning", code: "DATE_AS_CATEGORY", message: `"${d.field}" holds dates but is encoded as nominal, so gaps in time disappear and ticks crowd.`, path: at("encoding", c, "type"), fix: "Use \"type\": \"temporal\"." })
    }
  }
  if (mark === "bar" && values) {
    const cat = ["x", "y"].map(c => enc(c)).find(d => d?.type === "nominal")
    const n = distinct(cat?.field)
    if (cat && n >= 8 && cat.sort === undefined && !enc("color") && !calendarOrder(values.map(r => r[cat.field as string]))) issues.push({ level: "warning", code: "UNSORTED_BARS", message: `${n} bars in data order make ranking hard.`, path: at("encoding", ["x", "y"].find(c => enc(c) === cat)!), fix: `Set "sort": "-${cat === enc("x") ? "y" : "x"}" to rank by value.` })
  }
  if (unit.spec.resolve && isObject(unit.spec.resolve) && JSON.stringify(unit.spec.resolve).includes("independent") && Array.isArray(unit.spec.layer)) issues.push({ level: "warning", code: "DUAL_AXIS", message: "Two independent y scales: readers compare the lines' heights, which mean different things.", path: at("resolve"), fix: "Title both axes with their units and colour each axis like its line, or use two charts side by side." })
}

/** Compiles to Vega, collecting Vega-Lite's own warnings as issues. */
export function compileVegaLite(spec: Json): { vega: Json; warnings: string[] } {
  const warnings: string[] = []
  const logger = {
    level(_?: number) { return logger },
    error(...args: unknown[]) { warnings.push(args.map(String).join(" ")); return logger },
    warn(...args: unknown[]) { warnings.push(args.map(String).join(" ")); return logger },
    info() { return logger },
    debug() { return logger },
  }
  try {
    const out = compile(spec as never, { logger: logger as never })
    return { vega: out.spec as unknown as Json, warnings: warnings.filter(w => !/autosize "fit" only works|Autosize "fit" only works|Dropping .* from channel "tooltip"|Dropping "fit|because spec has discrete (width|height)/i.test(w)) }
  } catch (error) {
    throw new ChartsError("SPEC_INVALID", `Vega-Lite could not compile the spec: ${(error as Error).message}`, "Fix the spec; charts_catalogue has a working example for each chart type.")
  }
}
