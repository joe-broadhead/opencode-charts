import { suggest, type Issue, pointer } from "../errors.js"
import type { Row } from "../data.js"
import { profile as profileRows, type Profile } from "../data.js"
import type { ResolvedLocale } from "../locale.js"
import { vegaConfig } from "../themes/adapters.js"
import type { ThemeTokens } from "../themes/tokens.js"
import { deepMerge, isObject, substituteData, type Json } from "./common.js"

export interface VegaContext {
  readonly packageRoot: string
  readonly theme: ThemeTokens
  readonly locale: ResolvedLocale
  readonly rows?: Row[]
  readonly dataName: string
  readonly title?: string
  readonly description?: string
  readonly width?: number
  readonly height?: number
}

/** Prepares a full Vega spec: rows into the named dataset, atlases, theme config and locale; checks dataset references. */
export function prepareVega(input: Json, ctx: VegaContext): { spec: Json; profile?: Profile; issues: Issue[] } {
  const issues: Issue[] = []
  const spec = structuredClone(input) as Json
  delete spec.$schema
  substituteData(spec, ctx.packageRoot, undefined, ctx.dataName)
  const datasets = Array.isArray(spec.data) ? (spec.data as Json[]) : (spec.data = [] as Json[])
  // Atlas datasets: {"name": "world", "atlas": "world-110m"} become the bundled TopoJSON.
  spec.data = datasets.map(d => {
    if (!isObject(d) || typeof d.atlas !== "string") return d
    const holder: Json = { data: { atlas: d.atlas, ...(d.feature ? { feature: d.feature } : {}) } }
    substituteData(holder, ctx.packageRoot, undefined, ctx.dataName)
    const { atlas: _a, feature: _f, ...rest } = d
    return { ...rest, ...(holder.data as Json) }
  })
  const data = spec.data as Json[]
  if (ctx.rows) {
    const target = data.find(d => isObject(d) && d.name === ctx.dataName)
    if (target) {
      if (target.values !== undefined || target.source !== undefined) issues.push({ level: "error", code: "DATA_TWICE", message: `Rows were passed in data, and dataset "${ctx.dataName}" already has values or a source.`, path: pointer(["data", data.indexOf(target), "values"]), fix: `Remove its values, or give the rows another name with data.name.` })
      else target.values = ctx.rows
    } else data.unshift({ name: ctx.dataName, values: ctx.rows })
  }
  const names = new Set<string>()
  const declare = (node: unknown) => {
    if (Array.isArray(node)) { node.forEach(declare); return }
    if (!isObject(node)) return
    if (Array.isArray(node.data)) for (const d of node.data) if (isObject(d) && typeof d.name === "string") names.add(d.name)
    if (isObject(node.from) && isObject(node.from.facet) && typeof node.from.facet.name === "string") names.add(node.from.facet.name)
    // A mark's name is a data source too (marks drawn from another mark's items).
    if (Array.isArray(node.marks)) for (const m of node.marks) if (isObject(m) && typeof m.name === "string") names.add(m.name)
    for (const [k, child] of Object.entries(node)) if (k !== "values") declare(child)
  }
  declare(spec)
  const check = (node: unknown, path: (string | number)[]) => {
    if (Array.isArray(node)) { node.forEach((n, i) => check(n, [...path, i])); return }
    if (!isObject(node)) return
    for (const [k, child] of Object.entries(node)) {
      if (k === "values") continue
      if ((k === "data" || k === "source") && typeof child === "string" && path[path.length - 1] !== "signals" && !names.has(child)) {
        const close = suggest(child, [...names])
        issues.push({ level: "error", code: "UNKNOWN_DATASET", message: `Dataset "${child}" is not defined.${close.length ? ` Did you mean "${close[0]}"?` : ""} Defined: ${[...names].join(", ") || "none"}.`, path: pointer([...path, k]), fix: close.length ? `Set it to "${close[0]}".` : `Add {"name": "${child}", …} to data, or pass rows with data.name "${child}".` })
      }
      check(child, [...path, k])
    }
  }
  check(spec, [])
  if (!Array.isArray(spec.marks) || spec.marks.length === 0) issues.push({ level: "error", code: "NO_MARKS", message: "The Vega spec has no marks.", path: "/marks", fix: "Add a marks array; charts_catalogue has Vega examples (treemap, sunburst, force, word cloud)." })
  const userConfig = isObject(spec.config) ? spec.config : {}
  spec.config = deepMerge(deepMerge(vegaConfig(ctx.theme), { locale: { number: ctx.locale.number, ...(ctx.locale.time ? { time: ctx.locale.time } : {}) } }), userConfig)
  if (spec.width === undefined) spec.width = ctx.width ?? ctx.theme.layout.width
  if (spec.height === undefined) spec.height = ctx.height ?? ctx.theme.layout.height
  if (ctx.title && spec.title === undefined) spec.title = ctx.title
  if (ctx.description && spec.description === undefined) spec.description = ctx.description
  if (spec.background === undefined) spec.background = ctx.theme.colors.background
  if (spec.padding === undefined) spec.padding = ctx.theme.layout.padding
  const rowsForProfile = ctx.rows ?? (data.find(d => Array.isArray(d.values))?.values as Row[] | undefined)
  return { spec, ...(rowsForProfile ? { profile: profileRows(rowsForProfile) } : {}), issues }
}

export { renderVega } from "./vega-pool.js"
