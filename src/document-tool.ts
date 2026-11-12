import { existsSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"
import { version as echartsVersion } from "echarts/core"
import { version as vegaVersion } from "vega"
import { version as vegaLiteVersion } from "vega-lite"
import { parseData, transformData, type Row } from "./data.js"
import {
  ARTIFACT_LIMITS, DocumentInvalid, FALLBACK_LOCALE, FALLBACK_SEED, canonicalJson, isDigest, parseArtifact, parseDocument,
  prepareDocument, renderFingerprint, replayArtifact, serializeArtifact, sha256, verifyFontDependencies,
  type CapturedThemeV1, type ChartArtifactV1, type EffectiveSettings, type FontDependencyV1, type JsonObject, type SourceData,
} from "./document/index.js"
import type { Json } from "./engines/common.js"
import { ChartsError, SpecInvalid, type Issue } from "./errors.js"
import { readCustomFonts, type FontResource } from "./fonts.js"
import { confine, slug } from "./paths.js"
import type { Format, RenderRequest, RenderResult } from "./pipeline.js"
import { quickSpec } from "./quick.js"
import { RECIPE_COMPILER_VERSION } from "./recipes/registry.js"
import type { RecipeCompilation } from "./recipes/types.js"
import { builtinThemes, MAX_THEME_CHAIN, resolveTheme, THEME_NAME, themePath } from "./themes/store.js"
import { mergeTokens, type ThemeOverrides, type ThemeTokens } from "./themes/tokens.js"

/**
 * The tool adapter for chart documents: which input arm a call uses, and how a document or a saved artifact becomes a
 * render request for the one pipeline (`renderChart`) every call goes through.
 *
 * A call to charts_render, charts_validate or charts_quick takes exactly one arm: the legacy authoring fields (a spec,
 * or quick's type and fields), an inline `document`, or a saved artifact's `documentPath` (render and validate only).
 * Delivery fields (formats, scales, name, outDir, inspect, marks, svgText) go with any arm and never change what the
 * chart means. The adapter owns permissions and workspace files: it confines and asserts read on every file the call
 * reads (data.path, a saved theme, custom fonts, the artifact) before reading it, and the pure document core
 * (`src/document/`, `src/recipes/`) sees plain values only.
 */

export type ChartTool = "render" | "quick" | "validate"
export type Arm = "legacy" | "document" | "artifact"

/** Shared delivery fields: how the files are made and where they go. Allowed with every arm. */
export const DELIVERY_FIELDS = ["formats", "scales", "name", "outDir", "inspect", "marks", "svgText"] as const
const AUTHORING = ["theme", "locale", "currency", "currencyFields", "title", "description", "seed", "width", "height"] as const
/** The legacy authoring fields of each tool: everything a chart document says in its own terms. */
export const LEGACY_FIELDS: Readonly<Record<ChartTool, readonly string[]>> = {
  render: ["spec", "engine", "data", ...AUTHORING],
  validate: ["spec", "engine", "data", ...AUTHORING],
  quick: ["type", "data", "x", "y", "color", "size", "aggregate", "sort", "temporal", "xTitle", "yTitle", "bins", ...AUTHORING],
}
const DOCUMENT_FIELDS = ["document"] as const
const ARTIFACT_FIELDS = ["documentPath", "expectedRevision"] as const

/** Where each legacy field lives in a chart document, for the refusal's next step. */
const IN_DOCUMENT: Readonly<Record<string, string>> = {
  spec: "chart.spec (with chart.kind \"engine\")", engine: "chart.engine", data: "chart.data", theme: "appearance.theme", width: "layout.width", height: "layout.height",
  title: "title", description: "description", locale: "locale", currency: "currency", seed: "seed", type: "chart.recipe", x: "chart.bindings", y: "chart.bindings",
  color: "chart.bindings.series", size: "chart.bindings.size", aggregate: "chart.options.aggregate", sort: "chart.options.sort", temporal: "chart.options.xType",
  xTitle: "chart.options.xTitle", yTitle: "chart.options.yTitle", bins: "chart.options.bins",
}

/**
 * The call's input arm, or a coded refusal before any work: a mixture of arms is INPUT_CONFLICT, and a call with no
 * chart at all (or an expectedRevision without documentPath) is INPUT_INVALID.
 */
export function selectArm(tool: ChartTool, input: Readonly<Record<string, unknown>>): Arm {
  const given = (keys: readonly string[]) => keys.filter(k => input[k] !== undefined)
  const legacy = given(LEGACY_FIELDS[tool]), document = given(DOCUMENT_FIELDS), artifact = tool === "quick" ? [] : given(ARTIFACT_FIELDS)
  const arms = ([["legacy", legacy], ["document", document], ["artifact", artifact]] as const).filter(([, fields]) => fields.length)
  if (arms.length > 1) {
    const names = { legacy: "legacy authoring fields", document: "document", artifact: "documentPath" } as const
    const list = arms.map(([arm, fields]) => `${names[arm]} (${fields.join(", ")})`).join(" and ")
    const where = legacy.filter(f => IN_DOCUMENT[f]).map(f => `${f} → document.${IN_DOCUMENT[f]}`)
    // The path names the field to move or drop: a legacy field when there is one, otherwise document.
    const first = legacy[0] ?? document[0]!
    throw new ChartsError("INPUT_CONFLICT", `The call mixes ${list}. A call takes exactly one of: a spec with its fields${tool === "quick" ? " (type, data, x, y…)" : ""}, a chart document (document)${tool === "quick" ? "" : ", or a saved artifact (documentPath, expectedRevision)"}; formats, scales, name, outDir, inspect, marks and svgText go with any of them. Nothing was drawn or written.`, document.length && legacy.length ? `Move the fields into the document (${where.slice(0, 6).join("; ")}), or drop document and keep the older form.` : artifact.length ? "To draw the saved artifact exactly, pass only documentPath (and expectedRevision); to change it, create a new document or use its own fields." : "Keep one arm.", `/${first}`)
  }
  // Only charts_quick reaches this: it never replays a saved artifact, so it has no revision to check.
  if (!artifact.length && input.expectedRevision !== undefined) throw new ChartsError("INPUT_INVALID", `charts_${tool} does not replay a saved artifact, so expectedRevision has nothing to check.`, "To draw a saved .chart.json at a known revision, call charts_render (or charts_validate) with documentPath and expectedRevision.", "/expectedRevision")
  if (artifact.length && input.documentPath === undefined) throw new ChartsError("INPUT_INVALID", "expectedRevision was given without documentPath.", "Pass documentPath with it, the saved .chart.json the revision belongs to.", "/expectedRevision")
  if (!arms.length) {
    const what = tool === "quick" ? "type and data, or document" : "spec, document or documentPath"
    throw new ChartsError("INPUT_INVALID", `No chart was given: the call needs ${what}.`, tool === "quick" ? "Pass document (a recipe document; charts_catalogue shows one per recipe), or type with data and the field names." : "Pass spec (a raw Vega-Lite, Vega or ECharts spec), document (a chart document), or documentPath (a saved .chart.json).", "/")
  }
  if (arms[0]![0] === "legacy") {
    const required = tool === "quick" ? (["type", "data"] as const) : (["spec"] as const)
    for (const key of required) if (input[key] === undefined) throw new ChartsError("INPUT_INVALID", `"${key}" is required with the ${tool === "quick" ? "type and field names" : "spec"} form.`, tool === "quick" ? "Pass type and data together, or use document instead." : "Pass spec, or use document or documentPath instead.", `/${key}`)
  }
  return arms[0]![0]
}

// ---------------------------------------------------------------------------------------------------------------
// Resolving a document or an artifact into what the pipeline draws.

export interface DocumentEnvironment {
  readonly workspace: import("./paths.js").Workspace
  readonly packageRoot: string
  readonly configuredThemes: Readonly<Record<string, ThemeOverrides>>
  readonly defaults: { readonly theme?: string; readonly locale?: string; readonly outDir: string }
  readonly assertFiles: (action: "read" | "edit", resources: readonly string[]) => Promise<void>
}

/** A document ready to draw: the artifact (fresh or replayed), what it compiles to, and its custom font bytes. */
export interface ResolvedDocument {
  readonly artifact: ChartArtifactV1
  readonly settings: EffectiveSettings
  readonly rows?: readonly JsonObject[]
  readonly compilation?: RecipeCompilation
  readonly fonts: readonly FontResource[]
  readonly input: "document" | "documentPath" | "legacy"
  /** The saved artifact's workspace path, for the documentPath arm. */
  readonly documentPath?: string
}

const docPath = (path: string | undefined) => {
  if (path === undefined || path === "/") return "/document"
  if (path.startsWith("/data/")) return `/document/chart${path}`
  return `/document${path}`
}

/** Errors of the document core point into the document; here they point into the call (`/document/…`). */
function underDocument(error: unknown): never {
  if (error instanceof DocumentInvalid) throw new DocumentInvalid(error.issues.map(i => ({ ...i, path: docPath(i.path) })))
  if (error instanceof ChartsError && !(error instanceof SpecInvalid)) throw new ChartsError(error.code, error.detail, error.hint, docPath(error.path))
  throw error
}

/**
 * Resolves a named theme for capture. The adapter walks the whole extends chain itself (bounded by MAX_THEME_CHAIN,
 * a repeated name refused as THEME_CYCLE), and for each saved theme asks read permission for the file's real path (a
 * link is asked as its target) before reading a byte of it. The store then resolves from exactly those approved files
 * and reads nothing itself, so no theme file is read without its own permission.
 */
async function namedTheme(env: DocumentEnvironment, name: string): Promise<CapturedThemeV1> {
  const at = (error: unknown): never => {
    if (error instanceof ChartsError) throw new ChartsError(error.code, error.detail, error.hint, "/document/appearance/theme")
    throw error
  }
  const approved = new Map<string, ThemeOverrides | null>()
  const chain: string[] = []
  let next: string | undefined = name.trim().toLowerCase()
  try {
    while (next !== undefined && !builtinThemes()[next]) {
      if (chain.includes(next)) throw new ChartsError("THEME_CYCLE", `The theme "${chain[0]}" extends itself: ${[...chain, next].join(" → ")}.`, "Make the last theme of the chain extend a built-in theme (light, dark, high-contrast, print or presentation).")
      if (chain.length >= MAX_THEME_CHAIN) throw new ChartsError("THEME_CYCLE", `The theme "${chain[0]}" passes through more than ${MAX_THEME_CHAIN} named themes: ${[...chain, next].join(" → ")}.`, "Make each saved theme extend a built-in theme or one other theme.")
      chain.push(next)
      let overrides: ThemeOverrides | undefined
      if (THEME_NAME.test(next)) {
        const file = confine(env.workspace, themePath(next), "write")
        if (existsSync(file.absolute)) {
          // The real file: a theme that is a link is asked for, and read from, its target.
          await env.assertFiles("read", [file.relative])
          const text = readFileSync(file.absolute, "utf8")
          try { overrides = JSON.parse(text) as ThemeOverrides } catch { throw new ChartsError("THEME_INVALID", `The saved theme "${next}" (${file.relative}) is not valid JSON.`, "Save it again with charts_theme_save.") }
          if (!overrides || typeof overrides !== "object" || Array.isArray(overrides)) throw new ChartsError("THEME_INVALID", `The saved theme "${next}" (${file.relative}) is not a JSON object.`, "Save it again with charts_theme_save.")
        }
        approved.set(next, overrides ?? null)
      }
      overrides ??= env.configuredThemes[next]
      if (!overrides) break
      next = typeof overrides.extends === "string" ? overrides.extends.trim().toLowerCase() : "light"
    }
    const tokens = resolveTheme({ workspace: env.workspace, configured: env.configuredThemes, approved }, name)
    return { name: tokens.name, tokens }
  } catch (error) { return at(error) }
}

/** The theme drawn: the captured base, with the document's authored token overrides on top. */
export function effectiveTheme(base: ThemeTokens, overrides: unknown): ThemeTokens {
  if (!overrides || typeof overrides !== "object" || !Object.keys(overrides).length) return base
  return mergeTokens(base, overrides as ThemeOverrides)
}

const fontDependency = (font: FontResource): FontDependencyV1 => ({ family: font.family, weight: font.weight, path: font.source, sha256: `sha256:${font.sha256}`, bytes: font.bytes.byteLength })

/** Runs data.transform in the Vega worker; with `precomputed`, hands back that result instead of running it again. */
const transformRunner = (precomputed?: readonly Row[]) => async (rows: JsonObject[], transform: readonly JsonObject[]) =>
  precomputed ? (structuredClone(precomputed) as JsonObject[]) : ((await transformData(rows as Row[], transform)) as JsonObject[])

/** Reads a document's data.path: confined, read permission asserted, parsed (no transform), with its provenance. */
async function readSource(env: DocumentEnvironment, data: { path: string; format?: "csv" | "tsv" | "json" | "jsonl" | "parquet" }, at = "/document/chart/data/path"): Promise<SourceData> {
  try {
    await env.assertFiles("read", [confine(env.workspace, data.path, "read").relative])
    const parsed = await parseData(env.workspace, { path: data.path, ...(data.format ? { format: data.format } : {}) }, { provenance: true })
    return { rows: parsed.rows as JsonObject[], ...(parsed.provenance ? { provenance: parsed.provenance } : {}) }
  } catch (error) {
    if (error instanceof ChartsError && !error.path) throw new ChartsError(error.code, error.detail, error.hint, at)
    throw error
  }
}

let packageVersions: Map<string, string> | undefined
function pluginVersion(packageRoot: string): string {
  packageVersions ??= new Map()
  let version = packageVersions.get(packageRoot)
  if (version === undefined) {
    try { version = String((JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8")) as { version?: unknown }).version ?? "0.0.0") }
    catch { version = "0.0.0" }
    packageVersions.set(packageRoot, version)
  }
  return version
}

declare const RESVG_VERSION: string | undefined
/** The rasteriser's version: set by the build; read from the installed package when running from source. */
function resvgVersion(packageRoot: string): string {
  if (typeof RESVG_VERSION === "string") return RESVG_VERSION
  try { return String((JSON.parse(readFileSync(join(packageRoot, "node_modules", "@resvg", "resvg-wasm", "package.json"), "utf8")) as { version?: unknown }).version) }
  catch { return "unknown" }
}

const ENGINE_VERSIONS = { "vega-lite": vegaLiteVersion, vega: vegaVersion, echarts: echartsVersion }

/** Fresh creation from an inline document: resolves today's defaults, then captures them. */
export async function resolveFresh(env: DocumentEnvironment, raw: unknown, options: { recipeOnly?: boolean; input?: "document" | "legacy"; source?: SourceData; transformed?: readonly Row[] } = {}): Promise<ResolvedDocument> {
  let document
  try { document = parseDocument(raw) } catch (error) { underDocument(error) }
  if (options.recipeOnly && document.chart.kind !== "recipe") throw new ChartsError("INPUT_INVALID", "charts_quick takes a recipe document, and this one is an engine chart.", "Pass the same document to charts_render, which also takes engine documents; or use a recipe (charts_catalogue lists them).", "/document/chart/kind")
  const data = (document.chart as { data?: { path?: string; format?: "csv" } }).data
  const source = options.source ?? (data?.path !== undefined ? await readSource(env, data as { path: string }) : undefined)
  const theme = await namedTheme(env, document.appearance?.theme ?? env.defaults.theme ?? "light")
  const tokens = effectiveTheme(theme.tokens, document.appearance?.overrides)
  const fonts = await readCustomFonts(env.workspace, tokens.font.files, paths => env.assertFiles("read", paths))
  try {
    const prepared = await prepareDocument(raw, source, {
      locale: env.defaults.locale ?? FALLBACK_LOCALE,
      seed: FALLBACK_SEED,
      theme,
      fonts: fonts.map(fontDependency),
      generator: { plugin: pluginVersion(env.packageRoot), engines: ENGINE_VERSIONS },
      transform: transformRunner(options.transformed),
    })
    return { ...prepared, fonts, input: options.input ?? "document" }
  } catch (error) { underDocument(error) }
}

/**
 * Reads and verifies a saved artifact: the path confined, read permission asserted, the size checked before a byte is
 * read, then the envelope parsed by the document core (canonical copy, size and depth bounds, the revision recomputed
 * and compared with expectedRevision). Shared with any later revision tool, so replay and update check alike.
 */
export async function readArtifact(env: DocumentEnvironment, documentPath: string, expectedRevision?: string): Promise<{ artifact: ChartArtifactV1; path: string }> {
  if (expectedRevision !== undefined && !isDigest(expectedRevision)) throw new ChartsError("DOCUMENT_INVALID", `expectedRevision ${JSON.stringify(expectedRevision).slice(0, 90)} is not a revision.`, "Pass the revision a previous call returned: sha256: and 64 lowercase hex digits.", "/expectedRevision")
  const at = (error: unknown): never => {
    if (error instanceof ChartsError && !error.path) throw new ChartsError(error.code, error.detail, error.hint, "/documentPath")
    throw error
  }
  let file: ReturnType<typeof confine>
  try { file = confine(env.workspace, documentPath, "read") } catch (error) { return at(error) }
  // The real file: a link is asked for as its target, which is what is read.
  await env.assertFiles("read", [file.relative])
  const size = statSync(file.absolute).size
  if (size > ARTIFACT_LIMITS.totalBytes) throw new ChartsError("ARTIFACT_INVALID", `${file.relative} is ${size} bytes, over the ${ARTIFACT_LIMITS.totalBytes}-byte limit for a saved chart; it was not read.`, "Use a chart artifact this plugin wrote; a larger chart needs aggregated or sampled data.", "/documentPath")
  const artifact = parseArtifact(new Uint8Array(readFileSync(file.absolute)), expectedRevision !== undefined ? { expectedRevision } : {})
  return { artifact, path: file.relative }
}

/** Reads the artifact's captured custom fonts (permission asserted) and refuses any whose bytes changed. */
async function capturedFonts(env: DocumentEnvironment, deps: readonly FontDependencyV1[]): Promise<FontResource[]> {
  const resources = await readCustomFonts(env.workspace, deps.map(d => ({ family: d.family, weight: d.weight, path: d.path })), paths => env.assertFiles("read", paths))
  verifyFontDependencies(deps, dep => `sha256:${resources[deps.indexOf(dep)]!.sha256}`)
  return resources
}

/** Replay of a saved artifact: its captured rows, theme base, defaults and colour domain; nothing resolved anew. */
export async function resolveArtifact(env: DocumentEnvironment, documentPath: string, expectedRevision?: string): Promise<ResolvedDocument> {
  const { artifact, path } = await readArtifact(env, documentPath, expectedRevision)
  const fonts = await capturedFonts(env, artifact.captured.fonts)
  try {
    const replay = await replayArtifact(artifact, transformRunner())
    return { artifact, ...replay, fonts, input: "documentPath", documentPath: path }
  } catch (error) { underDocument(error) }
}

/**
 * A legacy call that asks for document output, as an engine document built from what the caller authored: the
 * original, unthemed spec (quick's spec as built from the rows) and the data before its transform, which the document
 * keeps once. Tool-level sizes, money fields and inline theme tokens have no place in an engine document, so a call
 * with them is refused with where to put them instead.
 */
export async function legacyDocument(env: DocumentEnvironment, tool: ChartTool, input: Readonly<Record<string, unknown>>): Promise<ResolvedDocument> {
  for (const key of ["width", "height"] as const) if (input[key] !== undefined) throw new ChartsError("LAYOUT_UNSUPPORTED", `A tool-level ${key} cannot be saved with document output: the saved document is an engine document, which keeps the spec's native size.`, `Set ${key} inside the spec, or send a recipe document with layout.${key}; or drop "document" from formats.`, `/${key}`)
  if (input.currencyFields !== undefined) throw new ChartsError("INPUT_INVALID", "currencyFields cannot be saved with document output.", "Drop currencyFields (money fields are then found by name), or drop \"document\" from formats.", "/currencyFields")
  if (input.theme !== undefined && typeof input.theme !== "string") throw new ChartsError("INPUT_INVALID", "Inline theme tokens cannot be saved with document output: a document names its theme.", "Save the tokens with charts_theme_save and pass the theme's name, or drop \"document\" from formats.", "/theme")
  const data = input.data as Record<string, unknown> & { rows?: Row[]; path?: string; transform?: JsonObject[] } | undefined
  const top = Object.fromEntries((["title", "description", "locale", "currency", "seed"] as const).filter(k => input[k] !== undefined).map(k => [k, input[k]]))
  const appearance = typeof input.theme === "string" ? { appearance: { theme: input.theme } } : {}
  const dataOf = (d: NonNullable<typeof data>, keepName: boolean) => Object.fromEntries((["rows", "path", "format", "transform", ...(keepName ? ["name"] : [])] as const).filter(k => d[k] !== undefined).map(k => [k, d[k]]))
  if (tool !== "quick") {
    const document = { version: 1, chart: { kind: "engine", ...(input.engine ? { engine: input.engine } : {}), spec: input.spec, ...(data ? { data: dataOf(data, true) } : {}) }, ...top, ...appearance }
    return resolveFresh(env, document, { input: "legacy" })
  }
  // Quick builds its spec from the rows after the transform; the document keeps the rows before it, and the transform
  // runs once: the result computed here is the one the document's preparation receives.
  const source = data!.path !== undefined ? await readSource(env, data as { path: string }, "/data/path") : undefined
  const parsedRows = source ? source.rows : ((await parseData(env.workspace, { rows: data!.rows! })).rows as JsonObject[])
  const transformed = await transformData(structuredClone(parsedRows) as Row[], data!.transform)
  const spec = quickSpec(input as never, transformed)
  const document = { version: 1, chart: { kind: "engine", engine: "vega-lite", spec, data: dataOf(data!, false) }, ...top, ...appearance }
  return resolveFresh(env, document, { input: "legacy", ...(source ? { source } : {}), transformed })
}

// ---------------------------------------------------------------------------------------------------------------
// Formats.

export type DocumentFormat = Format | "document"

/** Interaction presets that only a live view can carry. An omitted tooltip never asks for HTML; an explicit one does. */
export function interactiveRequests(settings: EffectiveSettings): string[] {
  const explicit = new Set(settings.explicitInteractions ?? [])
  const i = settings.interactions
  if (!i) return []
  return [
    ...(explicit.has("tooltip") && i.tooltip === "auto" ? ["tooltip \"auto\""] : []),
    ...(i.legend === "highlight" ? ["legend \"highlight\""] : []),
    ...(i.zoom === "x" ? ["zoom \"x\""] : []),
    ...(i.brush === "interval" ? ["brush \"interval\""] : []),
  ]
}

/**
 * The formats of a document call: the caller's list exactly, or the document defaults (svg, png, spec and document,
 * plus html when an interaction needs a live view). An explicit list without html that contradicts an explicitly
 * requested interaction is INTERACTION_FORMAT_MISMATCH, raised before anything is drawn or written.
 */
export function documentFormats(explicit: readonly DocumentFormat[] | undefined, settings: EffectiveSettings): { formats: DocumentFormat[]; mismatch?: ChartsError } {
  const needs = interactiveRequests(settings)
  if (explicit === undefined) return { formats: ["svg", "png", "spec", "document", ...(needs.length ? (["html"] as const) : [])] }
  const formats = [...new Set(explicit)]
  if (needs.length && !formats.includes("html")) {
    return { formats, mismatch: new ChartsError("INTERACTION_FORMAT_MISMATCH", `The document asks for ${needs.join(", ")}, which only the interactive HTML page carries, and formats [${formats.map(f => `"${f}"`).join(", ")}] has no html. SVG and PNG are static pictures of the initial view.`, "Add \"html\" to formats, or set those interactions back to their defaults (tooltip omitted or \"off\", legend \"static\", zoom \"none\", brush \"none\"), or leave formats out to get the defaults.", "/formats") }
  }
  return { formats }
}

// ---------------------------------------------------------------------------------------------------------------
// The render request and the result fields.

/**
 * The outer viewport of a recipe chart: width and height are the whole canvas (title, axes, legend and padding), which
 * Vega-Lite's autosize "fit" with "padding" gives for the single views every recipe compiles to. The layout planner
 * (readability floors, bounded candidates) takes this place when it lands; until then the actual size is measured and
 * reported beside the requested one.
 */
export function withViewport(spec: Readonly<Record<string, unknown>>, layout: NonNullable<EffectiveSettings["layout"]>): Json {
  return { ...spec, width: layout.width, height: layout.height, autosize: { type: "fit", contains: "padding" } } as Json
}

export interface Delivery {
  readonly formats?: readonly DocumentFormat[]
  readonly scales?: readonly (1 | 2 | 3)[]
  readonly name?: string
  readonly outDir?: string
  readonly inspect?: boolean
  readonly marks?: "problems" | "all" | "none"
  readonly svgText?: "text" | "paths" | "embed"
}

export const pickDelivery = (input: Readonly<Record<string, unknown>>): Delivery => Object.fromEntries(DELIVERY_FIELDS.filter(k => input[k] !== undefined).map(k => [k, input[k]])) as Delivery

export function documentRequest(resolved: ResolvedDocument, delivery: Delivery, formats: readonly DocumentFormat[], write: boolean): RenderRequest {
  const { artifact, settings, compilation } = resolved
  const doc = artifact.document
  const chart = doc.chart
  const recipe = chart.kind === "recipe"
  const rows = recipe ? compilation!.values : resolved.rows
  return {
    spec: (recipe ? withViewport(compilation!.spec, settings.layout!) : chart.spec) as Json,
    ...(recipe ? { engine: "vega-lite" as const } : chart.engine ? { engine: chart.engine } : {}),
    ...(rows ? { data: { rows: rows as Row[], name: recipe ? compilation!.dataName : (chart.data?.name ?? "table") } } : {}),
    themeTokens: effectiveTheme(settings.theme.tokens, doc.appearance?.overrides),
    fontResources: resolved.fonts,
    ...(doc.title !== undefined ? { title: doc.title } : {}),
    ...(doc.description !== undefined ? { description: doc.description } : {}),
    locale: settings.locale,
    ...(doc.currency !== undefined ? { currency: doc.currency } : {}),
    seed: settings.seed,
    formats: formats.filter((f): f is Format => f !== "document"),
    ...(delivery.scales ? { scales: delivery.scales } : {}),
    ...(delivery.name !== undefined ? { name: delivery.name } : {}),
    ...(delivery.outDir !== undefined ? { outDir: delivery.outDir } : {}),
    ...(delivery.svgText ? { svgText: delivery.svgText } : {}),
    ...(delivery.marks ? { marks: delivery.marks } : {}),
    ...(write && formats.includes("document") ? { document: serializeArtifact(artifact) } : {}),
  }
}

const TOOL_PATHS = ["/formats", "/scales", "/outDir", "/inspect", "/marks", "/svgText", "/name", "/document", "/documentPath", "/expectedRevision"]
/**
 * An issue of the render, pointed into the call: tool-level paths stay; a theme token path becomes the document's
 * override path; a spec path points into an engine document's spec, or into the compiled spec of a recipe (the
 * .vl.json export), which the caller does not author.
 */
export function issueMapper(resolved: ResolvedDocument): (issue: Issue) => Issue {
  const recipe = resolved.artifact.document.chart.kind === "recipe"
  return issue => {
    const path = issue.path
    if (path === undefined || TOOL_PATHS.some(p => path === p || path.startsWith(`${p}/`))) return issue
    if (path.startsWith("/theme/")) return { ...issue, path: `/document/appearance/overrides${path.slice("/theme".length)}` }
    if (path.startsWith("/spec/") || path === "/spec") return { ...issue, path: recipe ? `/compiled${path.slice("/spec".length) || "/"}` : `/document/chart${path}` }
    return { ...issue, path: recipe ? `/compiled${path === "/" ? "" : path}` : `/document/chart/spec${path === "/" ? "" : path}` }
  }
}

/** The most diagnostics a result carries; the full list is in the text. */
export const DIAGNOSTICS_MAX = 50

const runtimeDigests = new Map<string, Record<"browser/vega.js" | "browser/echarts.js" | "resvg.wasm", string>>()
/** Digests of the runtime assets that end up in outputs; a missing asset gets a stable marker digest. */
function runtimeAssets(packageRoot: string) {
  let found = runtimeDigests.get(packageRoot)
  if (!found) {
    const digest = (file: string) => { const path = join(packageRoot, "dist", file); return existsSync(path) ? sha256(new Uint8Array(readFileSync(path))) : sha256(`missing:${file}`) }
    found = { "browser/vega.js": digest("browser/vega.js"), "browser/echarts.js": digest("browser/echarts.js"), "resvg.wasm": digest("resvg.wasm") }
    runtimeDigests.set(packageRoot, found)
  }
  return found
}

/** The document fields of a result: revision, source, theme, colour domain, sizes, interactions and diagnostics. */
export function documentFields(env: { readonly packageRoot: string }, resolved: ResolvedDocument, result: RenderResult, issues: readonly Issue[], context: { readonly formats: readonly DocumentFormat[]; readonly delivery: Delivery; readonly write: boolean; /** Whether a preview PNG was made. */ readonly inspect: boolean }): Json {
  const { artifact, settings, compilation } = resolved
  const doc = artifact.document
  const chart = doc.chart
  const recipe = chart.kind === "recipe"
  const tokens = effectiveTheme(settings.theme.tokens, doc.appearance?.overrides)
  const categories = artifact.captured.categories
  const byFormat: Record<string, unknown> = {}
  for (const format of context.formats) {
    if (format === "svg" || format === "png") byFormat[format] = { interactive: false, view: "initial" }
    // The live page is never executed here: nothing in a result claims an interaction was seen to work.
    if (format === "html") byFormat.html = { interactive: true, view: "initial", presets: [], verified: false }
  }
  const compiled = (compilation?.diagnostics ?? []).map(i => ({ ...i, path: docPath(i.path) }))
  const diagnostics = [...compiled, ...issues].slice(0, DIAGNOSTICS_MAX)
  const name = slug(context.delivery.name ?? result.title)
  return {
    revision: artifact.revision,
    ...(context.write && result.files ? { fingerprint: renderFingerprint({
      revision: artifact.revision,
      plugin: pluginVersion(env.packageRoot),
      recipeCompiler: RECIPE_COMPILER_VERSION,
      renderers: { ...ENGINE_VERSIONS, resvg: resvgVersion(env.packageRoot) },
      runtimeAssets: runtimeAssets(env.packageRoot),
      viewport: recipe ? { width: settings.layout!.width, height: settings.layout!.height, mode: settings.layout!.mode } : { width: Math.max(1, result.width), height: Math.max(1, result.height), mode: "native" },
      formats: context.formats as ("svg" | "png" | "html" | "spec" | "document")[],
      scales: [...new Set(context.delivery.scales ?? [2])] as (1 | 2 | 3)[],
      fonts: artifact.captured.fonts.map(f => ({ family: f.family, weight: f.weight, sha256: f.sha256 })),
      svgText: context.delivery.svgText ?? "text",
      marks: context.delivery.marks ?? "problems",
      inspect: context.delivery.inspect === true,
      preview: context.inspect,
      name,
      platform: `${process.platform}-${process.arch}`,
    }) } : {}),
    source: {
      input: resolved.input,
      kind: chart.kind,
      ...(recipe ? { recipe: chart.recipe } : {}),
      engine: result.engine,
      ...(resolved.documentPath ? { documentPath: resolved.documentPath } : {}),
    },
    appearance: { theme: tokens.name, base: settings.theme.name, hash: sha256(canonicalJson(tokens)), overridden: tokens !== settings.theme.tokens },
    ...(categories ? { categories: { role: categories.role, field: categories.field, count: categories.domain.length, values: categories.domain.slice(0, 50), truncated: categories.domain.length > 50 } } : {}),
    size: {
      requested: recipe ? { target: settings.layout!.target, mode: settings.layout!.mode, width: settings.layout!.width, height: settings.layout!.height } : { mode: "native" },
      actual: { width: result.width, height: result.height },
    },
    interactions: {
      requested: (doc.interactions ?? {}) as Json,
      ...(settings.interactions ? { resolved: settings.interactions as unknown as Json } : {}),
      formats: byFormat as Json,
    },
    adjustments: [],
    diagnostics: diagnostics as unknown as Json[],
  } as Json
}
