import * as z from "zod"
import { ChartsError, pointer, suggest, type ChartsCode, type Issue } from "../errors.js"
import { DEFINITIONS, recipeDefinition } from "../recipes/definitions.js"
import { RECIPE_IDS, type RecipeId } from "../recipes/types.js"
import { checkSpec, LIMITS } from "../safety.js"
import { ThemeTokensSchema } from "../themes/tokens.js"
import { DOCUMENT_DEPTH, scanJson } from "./canonical.js"
import { categoryKey } from "./category.js"
import { DOCUMENT_VERSION, LAYOUT_MODES, LAYOUT_TARGETS } from "./defaults.js"
import { detectEngine } from "./engine.js"
import { DocumentInvalid } from "./issues.js"
import type { CapturedDocumentV1, ChartDocumentV1, JsonObject } from "./types.js"

/**
 * The strict schemas of chart document version 1, and its validator.
 *
 * Every object is strict: an unknown property fails with its JSON path, and nothing is stripped, defaulted or
 * downgraded on the way in. The validator dispatches on chart.kind and then on chart.recipe itself, so an error points
 * at the property that is wrong rather than at a union. `ChartDocumentV1Schema` is the same contract as one zod
 * schema, for JSON Schema projection.
 */

type Path = readonly (string | number)[]

// ---------------------------------------------------------------------------------------------------------------
// Theme token overrides: a strict deep partial projected from the canonical token schema.

/** Token paths a document may not override, with the reason. */
const EXCLUDED_TOKENS: Readonly<Record<string, string>> = {
  name: "appearance.theme selects the named base theme; overrides hold tokens only.",
  description: "appearance.theme selects the named base theme; overrides hold tokens only.",
  "layout.width": "A chart document is sized with layout.width (outer pixels), not a theme token.",
  "layout.height": "A chart document is sized with layout.height (outer pixels), not a theme token.",
}

const unwrap = (schema: z.ZodType): z.ZodType => {
  let s = schema
  while (s instanceof z.ZodOptional || s instanceof z.ZodDefault || s instanceof z.ZodNullable) s = (s as z.ZodOptional<z.ZodType>).unwrap() as z.ZodType
  return s
}

/** The same schema with every default removed (a defaulted member becomes optional), so parsing never adds a value. */
function withoutDefaults(schema: z.ZodType): z.ZodType {
  if (schema instanceof z.ZodDefault) return withoutDefaults(schema.unwrap() as z.ZodType).optional()
  if (schema instanceof z.ZodOptional) return withoutDefaults(schema.unwrap() as z.ZodType).optional()
  if (schema instanceof z.ZodObject) return z.strictObject(Object.fromEntries(Object.entries(schema.shape as Record<string, z.ZodType>).map(([k, v]) => [k, withoutDefaults(v)])))
  if (schema instanceof z.ZodArray) {
    const element = withoutDefaults(schema.element as z.ZodType)
    return element === schema.element ? schema : z.array(element).check(...((schema._zod.def.checks ?? []) as never[]))
  }
  return schema
}

function partialTokens(schema: z.ZodType, path: readonly string[]): z.ZodType {
  const inner = unwrap(schema)
  if (inner instanceof z.ZodObject) {
    const shape: Record<string, z.ZodType> = {}
    for (const [key, child] of Object.entries(inner.shape as Record<string, z.ZodType>)) {
      if (EXCLUDED_TOKENS[[...path, key].join(".")]) continue
      shape[key] = partialTokens(child, [...path, key]).optional()
    }
    return z.strictObject(shape)
  }
  // Arrays are atomic: an override replaces the whole array.
  return withoutDefaults(inner)
}

/** Strict deep-partial theme tokens for appearance.overrides. Derived from ThemeTokensSchema; never a loose record. */
export const PresentationTokenOverridesSchema = partialTokens(ThemeTokensSchema, []).describe("Theme tokens to change on top of the named theme: colors, font, layout (padding, step), axis, marks, legend. Arrays replace whole.")

// ---------------------------------------------------------------------------------------------------------------
// Pieces.

const COLOR = z.string().trim().regex(/^(#[0-9a-fA-F]{3,8}|rgba?\([\d\s.,%]+\)|transparent|theme:[a-z]+)$/, "a colour is #rgb, #rrggbb, #rrggbbaa, rgb(), rgba(), transparent or a theme token such as theme:negative")
const CATEGORY = z.union([z.string().max(1000), z.number(), z.boolean(), z.null()])
export const CategoryColorV1Schema = z.strictObject({ value: CATEGORY.describe("The category, typed: 1 and \"1\" are different categories."), color: COLOR })

export const AppearanceV1Schema = z.strictObject({
  theme: z.string().trim().min(1).max(64).optional().describe("A named theme: light, dark, high-contrast, print, presentation, or a saved one. Default: the configured theme."),
  overrides: PresentationTokenOverridesSchema.optional(),
  categoryColors: z.array(CategoryColorV1Schema).max(256).optional().describe("Explicit colours for categories of the colour domain (the series, or the pie's category)."),
})

export const InteractionsV1Schema = z.strictObject({
  tooltip: z.enum(["auto", "off"]).optional(),
  legend: z.enum(["static", "highlight"]).optional(),
  zoom: z.enum(["none", "x"]).optional(),
  brush: z.enum(["none", "interval"]).optional(),
})

const SIZE = z.number().int().min(20).max(LIMITS.dimension)
export const RecipeLayoutV1Schema = z.strictObject({
  target: z.enum(LAYOUT_TARGETS).optional().describe("Where it is read: inline (default), analysis, report, presentation or paper. Sets the default size and the smallest label."),
  mode: z.enum(LAYOUT_MODES).optional().describe("fixed, or responsive (width is the export width; the live view takes its container's width)."),
  width: SIZE.optional().describe("Outer width in logical pixels, including title, axes, legend and padding."),
  height: SIZE.optional().describe("Outer height in logical pixels."),
})
export const NativeLayoutV1Schema = z.strictObject({ mode: z.literal("native") })

const ROW = z.record(z.string(), z.unknown())
const ROWS = z.array(ROW).max(LIMITS.dataRows).describe("Inline rows: [{\"region\":\"North\",\"revenue\":12}, …].")
const TRANSFORM = z.array(ROW).max(50).describe("Vega-Lite transforms, applied to the rows once per compilation.")
const DATA_FORMAT = z.enum(["csv", "tsv", "json", "jsonl", "parquet"])
const DATA_NAME = z.string().regex(/^[A-Za-z][\w-]{0,63}$/).describe("The name the spec uses for these rows; default table.")

const dataShape = { rows: ROWS.optional(), path: z.string().min(1).max(1024).optional().describe("A workspace file: .csv, .tsv, .json, .jsonl or .parquet."), format: DATA_FORMAT.optional(), transform: TRANSFORM.optional() }
export const DataInputV1Schema = z.strictObject(dataShape).describe("Exactly one of rows or path.")
export const EngineDataInputV1Schema = z.strictObject({ ...dataShape, name: DATA_NAME.optional() })
export const CapturedDataV1Schema = z.strictObject({ rows: ROWS, transform: TRANSFORM.optional() })
export const CapturedEngineDataV1Schema = z.strictObject({ rows: ROWS, transform: TRANSFORM.optional(), name: DATA_NAME.optional() })

const ENGINE = z.enum(["vega-lite", "vega", "echarts"])
const SPEC = ROW.describe("A Vega-Lite spec, a Vega spec or an ECharts option, with data left out (see data).")

const topShape = {
  version: z.literal(DOCUMENT_VERSION),
  title: z.string().max(200).optional(),
  description: z.string().max(1000).optional().describe("Alt text."),
  locale: z.string().min(2).max(16).optional().describe("Number and date formats, such as en-GB. Default: the configured locale, else en-US."),
  currency: z.string().length(3).optional().describe("ISO 4217 code (EUR, USD…)."),
  seed: z.number().int().min(0).max(2 ** 31).optional(),
  appearance: AppearanceV1Schema.optional(),
  interactions: InteractionsV1Schema.optional(),
}

function recipeChartSchema(id: RecipeId, captured: boolean): z.ZodType {
  const def = recipeDefinition(id)
  return z.strictObject({
    kind: z.literal("recipe"),
    recipe: z.literal(id),
    data: captured ? CapturedDataV1Schema : DataInputV1Schema,
    bindings: def.bindingsSchema,
    options: def.optionsRequired ? def.optionsSchema : def.optionsSchema.optional(),
  }).describe(`${def.name}: ${def.summary}`)
}
const engineChartSchema = (captured: boolean) => z.strictObject({ kind: z.literal("engine"), engine: ENGINE.optional(), spec: SPEC, data: (captured ? CapturedEngineDataV1Schema : EngineDataInputV1Schema).optional() })

function documentSchema(captured: boolean) {
  return z.strictObject({
    ...topShape,
    chart: z.discriminatedUnion("kind", [z.discriminatedUnion("recipe", RECIPE_IDS.map(id => recipeChartSchema(id, captured)) as never), engineChartSchema(captured)]),
    layout: z.union([RecipeLayoutV1Schema, NativeLayoutV1Schema]).optional().describe("Recipe documents: target, mode, width, height. Engine documents: omit it, or {\"mode\": \"native\"}."),
  })
}

/** The whole contract as one schema, for JSON Schema projection. Validation goes through `parseDocument`. */
export const ChartDocumentV1Schema = documentSchema(false)
export const CapturedDocumentV1Schema = documentSchema(true)
export const documentJsonSchema = () => z.toJSONSchema(ChartDocumentV1Schema, { io: "input", unrepresentable: "any" }) as Record<string, unknown>

// ---------------------------------------------------------------------------------------------------------------
// Issues from zod, with paths into the document.

/** The schema at a path, through objects, arrays and optional wrappers; undefined past a union. */
function schemaAt(schema: z.ZodType, path: Path): z.ZodType | undefined {
  let s: z.ZodType | undefined = schema
  for (const part of path) {
    s = s && unwrap(s)
    if (s instanceof z.ZodObject) s = (s.shape as Record<string, z.ZodType>)[String(part)]
    else if (s instanceof z.ZodArray) s = s.element as z.ZodType
    else return undefined
  }
  return s && unwrap(s)
}

const valueAt = (root: unknown, path: Path) => path.reduce<unknown>((node, key) => (node && typeof node === "object" ? (node as Record<string, unknown>)[key as string] : undefined), root)

function convertIssues(error: z.ZodError, schema: z.ZodType, input: unknown, base: Path, refused: (path: Path) => string | undefined): Issue[] {
  const out: Issue[] = []
  for (const issue of error.issues) {
    const rel = issue.path as (string | number)[]
    const path = [...base, ...rel]
    if (issue.code === "unrecognized_keys") {
      const here = schemaAt(schema, rel)
      const allowed = here instanceof z.ZodObject ? Object.keys(here.shape as object) : []
      for (const key of issue.keys) {
        const hint = refused([...path, key])
        const close = allowed.length ? suggest(key, allowed) : []
        out.push({ level: "error", code: "UNKNOWN_PROPERTY", message: `Unknown property "${key}".`, path: pointer([...path, key]), fix: hint ?? (close.length ? `Did you mean "${close[0]}"?` : allowed.length ? `Remove it. Allowed here: ${allowed.join(", ")}.` : "Remove it.") })
      }
      continue
    }
    if (issue.code === "invalid_type" && valueAt(input, rel) === undefined) {
      const described = schemaAt(schema, rel)?.description
      const name = String(path[path.length - 1] ?? "value")
      out.push({ level: "error", code: path.includes("bindings") ? "FIELD_MISSING" : "DOCUMENT_INVALID", message: `"${name}" is required.`, path: pointer(path), fix: described ? `Set it: ${described}` : `Set ${name}.` })
      continue
    }
    if (issue.code === "invalid_value") {
      const values = (issue as { values?: unknown[] }).values ?? []
      out.push({ level: "error", code: "DOCUMENT_INVALID", message: `${JSON.stringify(valueAt(input, rel))} is not allowed here.`, path: pointer(path), fix: `Use one of: ${values.map(v => JSON.stringify(v)).join(", ")}.` })
      continue
    }
    out.push({ level: "error", code: "DOCUMENT_INVALID", message: `${issue.message}.`, path: pointer(path), fix: schemaAt(schema, rel)?.description ?? "Correct the value." })
  }
  return out
}

function check<T>(schema: z.ZodType, value: unknown, base: Path, issues: Issue[], refused: (path: Path) => string | undefined = () => undefined): T | undefined {
  const parsed = schema.safeParse(value)
  if (parsed.success) return parsed.data as T
  issues.push(...convertIssues(parsed.error, schema, value, base, refused))
  return undefined
}

const isPlain = (v: unknown): v is JsonObject => !!v && typeof v === "object" && !Array.isArray(v)
/** Records one error at a document path. */
const at = (issues: Issue[]) => ({ error: (code: ChartsCode, message: string, path: Path, fix: string) => issues.push({ level: "error", code, message, path: pointer(path), fix }) })

// ---------------------------------------------------------------------------------------------------------------
// The validator.

/** Raises DOCUMENT_VERSION_UNSUPPORTED for anything but version 1; never reads a newer document as an older one. */
export function assertDocumentVersion(version: unknown, path = "/version") {
  if (version === DOCUMENT_VERSION) return
  if (version === undefined) throw new ChartsError("DOCUMENT_INVALID", "The document has no version.", `Add "version": ${DOCUMENT_VERSION}, the chart document version this plugin reads.`, path)
  throw new ChartsError("DOCUMENT_VERSION_UNSUPPORTED", `Chart document version ${JSON.stringify(version)} is not supported; this plugin reads version ${DOCUMENT_VERSION} only.`, `Rewrite the document as version ${DOCUMENT_VERSION} (charts_capabilities lists its schema), or use a plugin release that reads version ${JSON.stringify(version)}. Nothing is converted automatically.`, path)
}

export interface ParseOptions {
  /** A saved artifact's document: data holds captured rows (no path), and the transform once. */
  readonly captured?: boolean
}

/**
 * Validates a chart document strictly and returns it as parsed: absent fields stay absent and nothing is defaulted.
 * Throws DOCUMENT_VERSION_UNSUPPORTED for another version, a spec safety error for an unsafe engine spec, and
 * DocumentInvalid (with every issue and its path) for anything else.
 */
export function parseDocument(raw: unknown, options: { captured: true }): CapturedDocumentV1
export function parseDocument(raw: unknown, options?: ParseOptions): ChartDocumentV1
export function parseDocument(raw: unknown, options: ParseOptions = {}): ChartDocumentV1 | CapturedDocumentV1 {
  const captured = options.captured === true
  if (!isPlain(raw)) throw new ChartsError("DOCUMENT_INVALID", "The chart document must be a JSON object.", `Pass {"version": ${DOCUMENT_VERSION}, "chart": {…}}.`, "/")
  assertDocumentVersion(raw.version)
  // Before any schema copies it: a prototype key would be dropped silently by an object copy, and deep nesting is
  // bounded before anything recursive reads it.
  scanJson(raw, { maxDepth: DOCUMENT_DEPTH, code: "DOCUMENT_INVALID", what: "The document" })
  const issues: Issue[] = []

  const top = check<JsonObject>(z.strictObject({ ...topShape, chart: z.unknown().optional(), layout: z.unknown().optional() }), raw, [], issues, path => (path.length === 1 ? TOP_HINTS[String(path[0])] : path[0] === "appearance" ? overrideHint(path) : undefined))
  const chartRaw = raw.chart
  let chart: JsonObject | undefined
  let recipe: RecipeId | undefined
  if (!isPlain(chartRaw)) at(issues).error("DOCUMENT_INVALID", chartRaw === undefined ? "\"chart\" is required." : "chart must be an object.", ["chart"], "Set chart to {\"kind\": \"recipe\", …} or {\"kind\": \"engine\", …}.")
  else if (chartRaw.kind === "recipe") {
    if (typeof chartRaw.recipe !== "string" || !(RECIPE_IDS as readonly string[]).includes(chartRaw.recipe)) {
      const close = typeof chartRaw.recipe === "string" ? suggest(chartRaw.recipe, RECIPE_IDS) : []
      at(issues).error("DOCUMENT_INVALID", chartRaw.recipe === undefined ? "\"recipe\" is required." : `There is no recipe ${JSON.stringify(chartRaw.recipe)}.`, ["chart", "recipe"], close.length ? `Did you mean "${close[0]}"?` : `Use one of: ${RECIPE_IDS.join(", ")}; other chart types use {"kind": "engine"} with a raw spec.`)
    } else {
      recipe = chartRaw.recipe as RecipeId
      const def = recipeDefinition(recipe)
      chart = check<JsonObject>(recipeChartSchema(recipe, captured), chartRaw, ["chart"], issues, path => def.refused[path.slice(1).join(".")] ?? dataHint(path, captured))
      if (chart) recipeCrossChecks(recipe, chart, issues)
    }
  } else if (chartRaw.kind === "engine") {
    chart = check<JsonObject>(engineChartSchema(captured), chartRaw, ["chart"], issues, path => dataHint(path, captured))
    if (chart) {
      const spec = chart.spec as JsonObject
      try { checkSpec(spec, (chart.engine as never) ?? detectEngine(spec)) }
      catch (error) {
        if (!(error instanceof ChartsError)) throw error
        issues.push({ level: "error", code: error.code, message: error.detail, path: `/chart/spec${error.path && error.path !== "/" ? error.path : ""}`, fix: error.hint })
      }
    }
  } else at(issues).error("DOCUMENT_INVALID", chartRaw.kind === undefined ? "\"kind\" is required." : `${JSON.stringify(chartRaw.kind)} is not a chart kind.`, ["chart", "kind"], "Use \"recipe\" for the typed chart families, or \"engine\" for a raw Vega-Lite, Vega or ECharts spec.")

  if (chart && !captured) dataChecks(chart.data as JsonObject | undefined, issues)
  const kind = isPlain(chartRaw) ? chartRaw.kind : undefined
  const layout = raw.layout === undefined ? undefined : layoutChecks(kind, raw.layout, issues)
  if (top && chart) interactionChecks(kind, recipe, chart, top.interactions as JsonObject | undefined, issues)
  if (top && chart) appearanceChecks(kind, recipe, chart, top.appearance as JsonObject | undefined, issues)

  if (issues.length || !top || !chart) throw new DocumentInvalid(issues.length ? issues : [{ level: "error", code: "DOCUMENT_INVALID", message: "The document is not valid.", path: "/" }])
  const out: JsonObject = { ...top, chart }
  if (layout !== undefined) out.layout = layout
  else delete out.layout
  return out as unknown as ChartDocumentV1
}

/** Where the fields of the older call shapes live in a document. */
const TOP_HINTS: Readonly<Record<string, string>> = {
  width: "A document sets its outer size with layout.width and layout.height.",
  height: "A document sets its outer size with layout.width and layout.height.",
  theme: "A document names its theme with appearance.theme, and changes tokens with appearance.overrides.",
  data: "Data belongs to the chart: chart.data.",
  spec: "A raw spec belongs to an engine chart: {\"kind\": \"engine\", \"spec\": …} under chart.",
  type: "A recipe chart is chart: {\"kind\": \"recipe\", \"recipe\": \"bar\", …}.",
  formats: "formats is a delivery field of the tool call, beside document, not inside it.",
}

function overrideHint(path: Path): string | undefined {
  if (path[1] !== "overrides") return undefined
  const token = path.slice(2).join(".")
  if (token === "extends") return EXCLUDED_TOKENS.name
  return EXCLUDED_TOKENS[token]
}

function dataHint(path: Path, captured: boolean): string | undefined {
  if (path[1] !== "data") return undefined
  if (captured && (path[2] === "path" || path[2] === "format")) return "A saved document holds its captured rows; the original path is in the artifact's provenance."
  if (path[2] === "name") return "A recipe names its own dataset; data.name is for engine documents."
  return undefined
}

function dataChecks(data: JsonObject | undefined, issues: Issue[]) {
  if (!data) return
  const hasRows = data.rows !== undefined, hasPath = data.path !== undefined
  if (hasRows === hasPath) at(issues).error("DOCUMENT_INVALID", hasRows ? "data has both rows and path." : "data has neither rows nor path.", ["chart", "data"], "Give exactly one: rows (inline) or path (a workspace file).")
  else if (hasRows && data.format !== undefined) at(issues).error("DOCUMENT_INVALID", "data.format is for data.path; inline rows have no format.", ["chart", "data", "format"], "Remove data.format.")
}

function recipeCrossChecks(recipe: RecipeId, chart: JsonObject, issues: Issue[]) {
  const def = recipeDefinition(recipe)
  const bindings = chart.bindings as Record<string, string | undefined>
  const op = (chart.options as JsonObject | undefined)?.aggregate
  for (const spec of def.bindings) {
    if (spec.required !== "unless-count") continue
    const present = bindings[spec.role] !== undefined
    if (op === "count" && present) at(issues).error("DOCUMENT_INVALID", `bindings.${spec.role} is not used: aggregate count counts the rows in each group, whatever their ${spec.role}.`, ["chart", "bindings", spec.role], `Remove bindings.${spec.role} to count rows, or choose sum, mean, median, min or max to use "${bindings[spec.role]}".`)
    if (op !== "count" && !present) at(issues).error("FIELD_MISSING", `A ${recipe} chart needs bindings.${spec.role} (${spec.description.replace(/\.$/, "")})${def.options.aggregate?.includes("count") ? " unless options.aggregate is count" : ""}.`, ["chart", "bindings", spec.role], def.options.aggregate?.includes("count") ? `Bind the numeric field, or set options.aggregate to "count" to count rows.` : "Bind the numeric field.")
  }
  // A measure that is also a grouping field would be overwritten by its own aggregate.
  const measures = def.bindings.filter(b => b.kind === "measure" || b.kind === "size")
  const groups = def.bindings.filter(b => b.kind !== "measure" && b.kind !== "size")
  for (const m of measures) for (const g of groups) if (bindings[m.role] !== undefined && bindings[m.role] === bindings[g.role] && def.groupBy.length) at(issues).error("DOCUMENT_INVALID", `bindings.${m.role} and bindings.${g.role} name the same field "${bindings[m.role]}".`, ["chart", "bindings", m.role], "Bind different fields: one to group by, one to measure.")
}

function layoutChecks(kind: unknown, layout: unknown, issues: Issue[]): JsonObject | undefined {
  if (kind === "engine") {
    if (isPlain(layout)) {
      const extra = Object.keys(layout).filter(k => k !== "mode")
      const why = "An engine document keeps its native layout: exact outer sizing and responsive reflow are for recipe documents."
      const fix = "Use a recipe document for a fixed or responsive outer size, or set width and height inside the raw spec; for an engine document omit layout or pass {\"mode\": \"native\"}."
      if (layout.mode !== undefined && layout.mode !== "native") { at(issues).error("LAYOUT_UNSUPPORTED", `layout.mode ${JSON.stringify(layout.mode)} is not available for an engine document. ${why}`, ["layout", "mode"], fix); return undefined }
      for (const key of extra) if (["target", "width", "height"].includes(key)) { at(issues).error("LAYOUT_UNSUPPORTED", `layout.${key} is not available for an engine document. ${why}`, ["layout", key], fix); return undefined }
    }
    return check<JsonObject>(NativeLayoutV1Schema, layout, ["layout"], issues)
  }
  if (isPlain(layout) && layout.mode === "native") { at(issues).error("DOCUMENT_INVALID", "layout.mode \"native\" is the layout of engine documents.", ["layout", "mode"], "For a recipe use mode fixed or responsive, with target, width and height."); return undefined }
  return check<JsonObject>(RecipeLayoutV1Schema, layout, ["layout"], issues)
}

function interactionChecks(kind: unknown, recipe: RecipeId | undefined, chart: JsonObject, interactions: JsonObject | undefined, issues: Issue[]) {
  if (!interactions) return
  if (kind === "engine") {
    for (const key of Object.keys(interactions)) at(issues).error("INTERACTION_UNSUPPORTED", `interactions.${key} is a recipe preset; an engine document keeps the interaction its raw spec declares.`, ["interactions", key], "Remove interactions and declare interaction in the raw spec (Vega-Lite params, for example), or use a recipe document.")
    return
  }
  if (!recipe) return
  const def = recipeDefinition(recipe)
  const bindings = chart.bindings as Record<string, string | undefined>
  const supports = (what: "legendHighlight" | "zoomX" | "brush") => DEFINITIONS.filter(d => d.interactions[what]).map(d => d.id).join(", ")
  if (interactions.legend === "highlight") {
    if (!def.interactions.legendHighlight) at(issues).error("INTERACTION_UNSUPPORTED", `A ${recipe} chart has no series legend to highlight from.`, ["interactions", "legend"], `Use legend "static", or a recipe with a series legend: ${supports("legendHighlight")}.`)
    else if (bindings.series === undefined) at(issues).error("INTERACTION_UNSUPPORTED", "legend \"highlight\" selects a series, and this chart has no series binding.", ["interactions", "legend"], "Bind a series field, or use legend \"static\".")
  }
  if (interactions.zoom === "x") {
    if (!def.interactions.zoomX) at(issues).error("INTERACTION_UNSUPPORTED", `x zoom is not available for a ${recipe} chart.`, ["interactions", "zoom"], `Use zoom "none", or a temporal ${supports("zoomX")} chart.`)
    else if ((chart.options as JsonObject | undefined)?.xType !== "temporal") at(issues).error("INTERACTION_UNSUPPORTED", "x zoom needs a temporal x axis.", ["interactions", "zoom"], "Set options.xType to temporal (with ISO dates in x), or use zoom \"none\".")
  }
  if (interactions.brush === "interval" && !def.interactions.brush) at(issues).error("INTERACTION_UNSUPPORTED", `An interval brush is not available for a ${recipe} chart.`, ["interactions", "brush"], `Use brush "none", or a ${supports("brush")} chart.`)
}

function appearanceChecks(kind: unknown, recipe: RecipeId | undefined, chart: JsonObject, appearance: JsonObject | undefined, issues: Issue[]) {
  const colors = appearance?.categoryColors as { value: unknown }[] | undefined
  if (!colors) return
  if (kind === "engine") { at(issues).error("DOCUMENT_INVALID", "categoryColors is a recipe option; an engine document keeps the colour scales its spec declares.", ["appearance", "categoryColors"], "Set the colours in the raw spec's scale (range and domain), or use a recipe document."); return }
  if (recipe) {
    const def = recipeDefinition(recipe)
    const role = def.colorRole
    if (!role || (chart.bindings as JsonObject)[role] === undefined) { at(issues).error("DOCUMENT_INVALID", `A ${recipe} chart${role ? " without a series binding" : ""} has no category colours to set.`, ["appearance", "categoryColors"], role ? "Bind a series field, or remove categoryColors." : "Remove categoryColors; use appearance.overrides.colors for the palette."); return }
  }
  const seen = new Map<string, number>()
  colors.forEach((entry, i) => {
    const key = categoryKey(entry.value as never)
    if (seen.has(key)) at(issues).error("DOCUMENT_INVALID", `categoryColors[${i}] repeats the category ${JSON.stringify(entry.value)} of entry ${seen.get(key)}.`, ["appearance", "categoryColors", i, "value"], "Give each category one colour.")
    else seen.set(key, i)
  })
}
