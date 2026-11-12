import * as z from "zod"
import { ChartsError, pointer, type Issue } from "../errors.js"
import { recipeDefinition } from "../recipes/definitions.js"
import type { RecipeId } from "../recipes/types.js"
import { LIMITS } from "../safety.js"
import { ThemeTokensSchema } from "../themes/tokens.js"
import { byteLength, canonicalJson, canonicalValue, isDigest, REVISION_PATTERN, sha256 } from "./canonical.js"
import { categoryKey } from "./category.js"
import { ARTIFACT_FORMAT, ARTIFACT_VERSION, DEFAULT_LAYOUT_TARGET, INTERACTION_DEFAULTS, LAYOUT_MODES, LAYOUT_PROFILE_VERSION, LAYOUT_PROFILES, LAYOUT_TARGETS } from "./defaults.js"
import { DocumentInvalid } from "./issues.js"
import { InteractionsV1Schema, parseDocument } from "./schema.js"
import type {
  CapturedDefaultsV1, CapturedDocumentV1, CapturedStateV1, CategoryDomainV1, ChartArtifactV1, ChartDocumentV1, DataSourceProvenanceV1,
  FontDependencyV1, GeneratorV1, JsonObject, ProvenanceV1, RecipeLayoutV1,
} from "./types.js"

/**
 * The saved chart artifact (`<name>.chart.json`): a versioned envelope around the canonical, uncompiled document.
 *
 * The document keeps exactly what was authored; an external data.path is replaced by the rows read from it (before
 * data.transform, which stays in the document once), with the path, format and content hash kept in provenance. The
 * defaults the chart was resolved with, the named theme base, custom font identities and the colour domain are kept
 * beside it in `captured`, never folded into the authored document.
 *
 * The revision is `sha256:<64 hex>` over the canonical JSON of the document and the captured state: the data (inside
 * the document), the defaults, the theme base, the colour domain and the font digests. Provenance, generator versions,
 * paths, output names, timing and compiled specs are not part of it, so a changed source file or a new plugin release
 * does not change the revision of an unchanged chart.
 */

export const ARTIFACT_LIMITS = {
  /** The captured rows and their transform, as canonical JSON. */
  dataBytes: LIMITS.dataBytes,
  dataRows: LIMITS.dataRows,
  /** An engine document's raw spec. */
  specBytes: LIMITS.specBytes,
  /** Everything else: authored fields, captured defaults, theme tokens, colour domain, provenance. */
  metadataBytes: 512 * 1024,
  get totalBytes() { return this.dataBytes + this.specBytes + this.metadataBytes },
}

const REVISION_DOMAIN = `${ARTIFACT_FORMAT}/${ARTIFACT_VERSION}\n`
const FINGERPRINT_DOMAIN = "opencode-charts-render/1\n"

// ---------------------------------------------------------------------------------------------------------------
// Capture.

/** Rows as a saved document stores them: plain JSON objects with sorted keys, within the data limits. */
export function canonicalRows(rows: readonly unknown[], base: readonly (string | number)[] = ["chart", "data", "rows"]): JsonObject[] {
  if (rows.length > ARTIFACT_LIMITS.dataRows) throw new ChartsError("DATA_TOO_LARGE", `The data has ${rows.length} rows, over ${ARTIFACT_LIMITS.dataRows}.`, "Aggregate first (data.transform with aggregate), or sample the data.", pointer(base))
  const out = rows.map((row, i) => {
    if (!row || typeof row !== "object" || Array.isArray(row)) throw new ChartsError("DATA_INVALID", `Row ${i} is not an object.`, "Each row is an object of field: value.", pointer([...base, i]))
    return canonicalValue(row, [...base, i]) as JsonObject
  })
  const bytes = byteLength(JSON.stringify(out))
  if (bytes > ARTIFACT_LIMITS.dataBytes) throw new ChartsError("DATA_TOO_LARGE", `The captured rows are ${(bytes / 1048576).toFixed(1)} MB as JSON, over ${ARTIFACT_LIMITS.dataBytes / 1048576} MB.`, "Aggregate or sample the data first, or keep fewer fields.", pointer(base))
  return out
}

/** The canonical document: the authored one with its data replaced by the captured rows (and the transform, once). */
export function captureDocument(document: ChartDocumentV1, rows: readonly JsonObject[] | undefined): CapturedDocumentV1 {
  const chart = document.chart as JsonObject
  const data = chart.data as JsonObject | undefined
  if (!data) return canonicalValue(document) as unknown as CapturedDocumentV1
  if (!rows) throw new ChartsError("DATA_MISSING", "The document's data was not read before capture.", "Read data.path (or take data.rows) and pass the rows.", "/chart/data")
  const captured: JsonObject = { rows }
  if (data.transform !== undefined) captured.transform = data.transform
  if (data.name !== undefined) captured.name = data.name
  return canonicalValue({ ...document, chart: { ...chart, data: captured } }) as unknown as CapturedDocumentV1
}

export interface DefaultsEnvironment {
  /** The locale and seed a fresh document gets when it names none: the plugin's current defaults. */
  readonly locale: string
  readonly seed: number
}

/** The defaults the chart was resolved with, for the fields the author left out, and only those. */
export function captureDefaults(document: ChartDocumentV1, env: DefaultsEnvironment, recipeOptionDefaults?: JsonObject): CapturedDefaultsV1 {
  const out: { -readonly [K in keyof CapturedDefaultsV1]: CapturedDefaultsV1[K] } = {}
  if (document.locale === undefined) out.locale = env.locale
  if (document.seed === undefined) out.seed = env.seed
  if (document.chart.kind === "recipe") {
    if (recipeOptionDefaults && Object.keys(recipeOptionDefaults).length) out.recipeOptions = { ...recipeOptionDefaults }
    const layout = (document.layout ?? {}) as RecipeLayoutV1
    const profile = LAYOUT_PROFILES[layout.target ?? DEFAULT_LAYOUT_TARGET]
    out.layout = {
      profile: profile.target,
      profileVersion: LAYOUT_PROFILE_VERSION,
      ...(layout.mode === undefined ? { mode: profile.mode } : {}),
      ...(layout.width === undefined ? { width: profile.width } : {}),
      ...(layout.height === undefined ? { height: profile.height } : {}),
      minLabelSize: profile.minLabelSize,
    }
    const authored = document.interactions ?? {}
    const omitted = Object.fromEntries(Object.entries(INTERACTION_DEFAULTS).filter(([k]) => (authored as JsonObject)[k] === undefined))
    if (Object.keys(omitted).length) out.interactions = omitted
  }
  return out
}

/** The revision: exactly the inputs that define the chart's content. */
export function computeRevision(document: CapturedDocumentV1, captured: CapturedStateV1): string {
  const content = {
    document,
    defaults: captured.defaults,
    theme: captured.theme,
    categories: captured.categories ?? null,
    fonts: captured.fonts.map(f => ({ family: f.family, weight: f.weight, sha256: f.sha256 })),
  }
  return sha256(REVISION_DOMAIN + canonicalJson(content))
}

export interface ArtifactParts {
  readonly document: CapturedDocumentV1
  readonly defaults: CapturedDefaultsV1
  readonly theme: CapturedStateV1["theme"]
  readonly fonts: readonly FontDependencyV1[]
  readonly categories?: CategoryDomainV1
  readonly provenance?: DataSourceProvenanceV1
  readonly generator: GeneratorV1
}

export function buildArtifact(parts: ArtifactParts): ChartArtifactV1 {
  const captured = canonicalValue({ defaults: parts.defaults, theme: parts.theme, fonts: parts.fonts, ...(parts.categories ? { categories: parts.categories } : {}) }) as unknown as CapturedStateV1
  const document = canonicalValue(parts.document) as unknown as CapturedDocumentV1
  const provenance: ProvenanceV1 = parts.provenance ? { data: parts.provenance } : {}
  const artifact: ChartArtifactV1 = { format: ARTIFACT_FORMAT, version: ARTIFACT_VERSION, revision: computeRevision(document, captured), document, captured, provenance, generator: parts.generator }
  checkSections(artifact as unknown as JsonObject, "write")
  return artifact
}

/** The artifact file's text: canonical JSON and a newline. Same artifact, same bytes. */
export function serializeArtifact(artifact: ChartArtifactV1): string {
  return `${canonicalJson(artifact)}\n`
}

// ---------------------------------------------------------------------------------------------------------------
// Reading a saved artifact.

const FontDependencySchema = z.strictObject({ family: z.string().min(1).max(100), weight: z.number().int().min(100).max(900), path: z.string().min(1).max(1024), sha256: z.string().regex(REVISION_PATTERN), bytes: z.number().int().min(0) })
const CategorySchema = z.union([z.string(), z.number(), z.boolean(), z.null()])
const EnvelopeSchema = z.strictObject({
  format: z.literal(ARTIFACT_FORMAT),
  version: z.literal(ARTIFACT_VERSION),
  revision: z.string().regex(REVISION_PATTERN),
  document: z.unknown(),
  captured: z.strictObject({
    defaults: z.strictObject({
      locale: z.string().min(2).max(16).optional(),
      seed: z.number().int().min(0).max(2 ** 31).optional(),
      recipeOptions: z.record(z.string(), z.unknown()).optional(),
      layout: z.strictObject({ profile: z.enum(LAYOUT_TARGETS), profileVersion: z.number().int().min(1), mode: z.enum(LAYOUT_MODES).optional(), width: z.number().int().min(20).max(LIMITS.dimension).optional(), height: z.number().int().min(20).max(LIMITS.dimension).optional(), minLabelSize: z.number().min(1).max(200) }).optional(),
      interactions: InteractionsV1Schema.optional(),
    }),
    theme: z.strictObject({ name: z.string().min(1).max(64), tokens: ThemeTokensSchema }),
    fonts: z.array(FontDependencySchema).max(16),
    categories: z.strictObject({ role: z.enum(["series", "category"]), field: z.string().min(1).max(256), domain: z.array(CategorySchema).max(LIMITS.dataRows) }).optional(),
  }),
  provenance: z.strictObject({ data: z.strictObject({ path: z.string().min(1).max(1024), format: z.enum(["csv", "tsv", "json", "jsonl", "parquet"]), sha256: z.string().regex(REVISION_PATTERN), bytes: z.number().int().min(0) }).optional() }),
  generator: z.strictObject({ plugin: z.string().max(64), recipeCompiler: z.number().int().min(1), engines: z.record(z.string(), z.string().max(64)) }),
})

const invalid = (what: string, path = "/", fix = "Create the chart again from its document; a saved artifact is written by the plugin and not edited by hand.") => new ChartsError("ARTIFACT_INVALID", what, fix, path)

/**
 * The three sections of an artifact, each under its own limit: the captured data (rows and transform), an engine
 * document's raw spec, and everything else. Checked when writing, so the plugin never writes an artifact it would
 * refuse to read, and when reading, before any section is used.
 */
function checkSections(envelope: JsonObject, phase: "write" | "read") {
  const which = phase === "read" ? "The artifact's" : "The chart's"
  const fix = phase === "read" ? "Use an artifact this plugin wrote." : "Aggregate or sample the data first, or bind fewer categories."
  const document = envelope.document as JsonObject | undefined
  const chart = document && typeof document === "object" ? (document.chart as JsonObject | undefined) : undefined
  const data = chart && typeof chart === "object" ? chart.data : undefined
  const spec = chart && typeof chart === "object" ? chart.spec : undefined
  if (data !== undefined) {
    const rows = (data as JsonObject).rows
    if (Array.isArray(rows) && rows.length > ARTIFACT_LIMITS.dataRows) throw new ChartsError("DATA_TOO_LARGE", `${which} data has ${rows.length} rows, over ${ARTIFACT_LIMITS.dataRows}.`, fix, "/document/chart/data/rows")
    const bytes = byteLength(JSON.stringify(data))
    if (bytes > ARTIFACT_LIMITS.dataBytes) throw new ChartsError("DATA_TOO_LARGE", `${which} data is ${bytes} bytes, over ${ARTIFACT_LIMITS.dataBytes}.`, fix, "/document/chart/data")
  }
  if (spec !== undefined && byteLength(JSON.stringify(spec)) > ARTIFACT_LIMITS.specBytes) throw new ChartsError("SPEC_TOO_LARGE", `${which} spec is over ${ARTIFACT_LIMITS.specBytes} bytes.`, phase === "read" ? fix : "Pass large data through data.rows or data.path instead of inside the spec.", "/document/chart/spec")
  const metadata = { ...envelope, document: document && typeof document === "object" ? { ...document, chart: chart && typeof chart === "object" ? { ...chart, data: null, spec: null } : chart } : document }
  const metadataBytes = byteLength(JSON.stringify(metadata))
  if (metadataBytes > ARTIFACT_LIMITS.metadataBytes) throw invalid(`${which} metadata (authored fields, captured defaults, theme, colour domain) is ${metadataBytes} bytes, over ${ARTIFACT_LIMITS.metadataBytes}.`, "/", phase === "read" ? "Create the chart again from its document; a saved artifact is written by the plugin and not edited by hand." : "Bind a series or category with fewer distinct values, or shorten the document's text.")
}

export interface ParseArtifactOptions {
  /** A read precondition: the revision the caller last saw. */
  readonly expectedRevision?: string
}

/**
 * Reads a saved artifact: size first, then JSON, then the envelope, each section under its own limit, the document
 * under the same strict schema as creation, and finally the revision, recomputed from the content (a revision string
 * in an edited file is never trusted) and compared with `expectedRevision` when given.
 */
export function parseArtifact(input: string | Uint8Array, options: ParseArtifactOptions = {}): ChartArtifactV1 {
  const size = typeof input === "string" ? byteLength(input) : input.byteLength
  if (size > ARTIFACT_LIMITS.totalBytes) throw invalid(`The artifact is ${size} bytes, over the ${ARTIFACT_LIMITS.totalBytes}-byte limit for a saved chart.`, "/", "Use a chart artifact this plugin wrote; a larger chart needs aggregated or sampled data.")
  if (options.expectedRevision !== undefined && !isDigest(options.expectedRevision)) throw new ChartsError("DOCUMENT_INVALID", `expectedRevision ${JSON.stringify(options.expectedRevision)} is not a revision.`, "Pass the revision a previous call returned: sha256: and 64 lowercase hex digits.", "/expectedRevision")
  let raw: unknown
  try { raw = JSON.parse(typeof input === "string" ? input : Buffer.from(input.buffer, input.byteOffset, input.byteLength).toString("utf8")) }
  catch { throw invalid("The artifact is not valid JSON.") }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw invalid("The artifact is not a JSON object.")
  const envelope = raw as JsonObject
  if (envelope.format !== ARTIFACT_FORMAT) throw invalid(`This is not a chart artifact (format ${JSON.stringify(envelope.format)}, expected "${ARTIFACT_FORMAT}").`, "/format", "Pass a .chart.json file. A .vl.json, .vg.json or .echarts.json file is a resolved engine spec, not an editable document: render it with charts_render's spec, or create a new document.")
  if (envelope.version !== ARTIFACT_VERSION) throw new ChartsError("DOCUMENT_VERSION_UNSUPPORTED", `Chart artifact version ${JSON.stringify(envelope.version)} is not supported; this plugin reads version ${ARTIFACT_VERSION} only.`, `Use a plugin release that reads version ${JSON.stringify(envelope.version)}, or create the chart again as a version ${ARTIFACT_VERSION} document. Nothing is converted automatically.`, "/version")

  // Each section under its own limit, before any of it is used.
  checkSections(envelope, "read")
  const document = envelope.document as JsonObject | undefined

  const parsed = EnvelopeSchema.safeParse(envelope)
  if (!parsed.success) {
    const first = parsed.error.issues[0]!
    throw invalid(`The artifact's ${pointer(first.path as (string | number)[])} is invalid: ${first.message}.`, pointer(first.path as (string | number)[]))
  }
  let doc: CapturedDocumentV1
  try { doc = parseDocument(document, { captured: true }) }
  catch (error) {
    if (error instanceof DocumentInvalid) throw new DocumentInvalid(error.issues.map((i: Issue) => ({ ...i, ...(i.path ? { path: `/document${i.path === "/" ? "" : i.path}` } : {}) })))
    if (error instanceof ChartsError) throw new ChartsError(error.code, error.detail, error.hint, `/document${error.path && error.path !== "/" ? error.path : ""}`)
    throw error
  }
  const captured = envelope.captured as unknown as CapturedStateV1
  crossCheck(doc, captured)

  const revision = computeRevision(document as unknown as CapturedDocumentV1, captured)
  if (revision !== envelope.revision) throw new ChartsError("DOCUMENT_REVISION_MISMATCH", `The artifact's content does not match its recorded revision ${envelope.revision}: it was edited or damaged after it was written.`, "Do not edit a saved artifact by hand. Create a new document (from the source data) for a new chart, or use the unedited artifact.", "/revision")
  if (options.expectedRevision !== undefined && options.expectedRevision !== revision) throw new ChartsError("DOCUMENT_REVISION_MISMATCH", `The artifact is at revision ${revision}, not the expected ${options.expectedRevision}.`, "Read the artifact again and decide from its current revision; it changed since the revision you hold.", "/expectedRevision")
  return envelope as unknown as ChartArtifactV1
}

function crossCheck(document: CapturedDocumentV1, captured: CapturedStateV1) {
  const chart = document.chart
  if (chart.kind === "engine") {
    if (captured.categories) throw invalid("An engine document has no recipe colour domain.", "/captured/categories")
    if (captured.defaults.recipeOptions || captured.defaults.layout || captured.defaults.interactions) throw invalid("An engine document has no recipe defaults.", "/captured/defaults")
    return
  }
  const def = recipeDefinition(chart.recipe as RecipeId)
  const options = { ...(captured.defaults.recipeOptions ?? {}), ...((chart.options ?? {}) as JsonObject) }
  if (captured.defaults.recipeOptions) for (const key of Object.keys(captured.defaults.recipeOptions)) if ((chart.options as JsonObject | undefined)?.[key] !== undefined) throw invalid(`captured.defaults.recipeOptions.${key} is also authored; a default is captured only for an omitted option.`, `/captured/defaults/recipeOptions/${key}`)
  if (!def.optionsSchema.safeParse(options).success) throw invalid(`The captured recipe options do not fit the ${chart.recipe} recipe.`, "/captured/defaults/recipeOptions")
  const role = def.colorRole
  const bound = role ? (chart.bindings as JsonObject)[role] : undefined
  if (captured.categories) {
    if (captured.categories.role !== role || captured.categories.field !== bound) throw invalid(`The captured colour domain is for ${captured.categories.role} "${captured.categories.field}", which this chart does not bind.`, "/captured/categories")
    const keys = new Set<string>()
    for (const [i, v] of captured.categories.domain.entries()) { const k = categoryKey(v); if (keys.has(k)) throw invalid(`The captured colour domain repeats ${JSON.stringify(v)}.`, `/captured/categories/domain/${i}`); keys.add(k) }
  } else if (bound !== undefined) throw invalid("The artifact has no captured colour domain for its series.", "/captured")
}

// ---------------------------------------------------------------------------------------------------------------
// Dependencies.

/**
 * Checks that each custom font still has the bytes it was captured with. `digestOf` reads the workspace file through
 * the adapter (with its permission and confinement checks) and returns its `sha256:` digest; a missing file is the
 * adapter's own FILE_NOT_FOUND. A different digest is DOCUMENT_DEPENDENCY_CHANGED: no other font is measured instead.
 */
export function verifyFontDependencies(fonts: readonly FontDependencyV1[], digestOf: (font: FontDependencyV1) => string) {
  fonts.forEach((font, i) => {
    const actual = digestOf(font)
    if (actual !== font.sha256) throw new ChartsError("DOCUMENT_DEPENDENCY_CHANGED", `The font file ${font.path} (${font.family} ${font.weight}) changed since the chart was saved: it was ${font.sha256.slice(0, 19)}…, it is now ${actual.slice(0, 19)}….`, "Restore the original font file, or create a new document to adopt the changed font.", `/captured/fonts/${i}`)
  })
}

// ---------------------------------------------------------------------------------------------------------------
// The render fingerprint: what a generated bundle's bytes and membership depend on, beyond the document revision.

export interface RenderFingerprintInput {
  /** The document revision being rendered. */
  readonly revision: string
  /** Engine, rasteriser and runtime versions: vega, vega-lite, echarts, resvg… */
  readonly renderers: Readonly<Record<string, string>>
  /** Digests of runtime assets that end up in outputs (browser bundles, wasm, embedded fonts). */
  readonly runtimeAssets: Readonly<Record<string, string>>
  /** The resolved outer viewport. */
  readonly viewport: { readonly width: number; readonly height: number; readonly mode: string }
  readonly formats: readonly string[]
  /** PNG densities in the order given: the first is written without a suffix. */
  readonly scales: readonly number[]
  readonly fonts: readonly { readonly family: string; readonly weight: number; readonly sha256: string }[]
  readonly svgText: "text" | "paths" | "embed"
  readonly marks: "problems" | "all" | "none"
  readonly inspect: boolean
  readonly preview: boolean
  /** The bundle's file stem. */
  readonly name: string
  /** The platform the byte-equality promise holds on, such as linux-x64. */
  readonly platform: string
}

/** `sha256:` over every input that can change a bundle's bytes or its file list. Formats are a set; scales an order. */
export function renderFingerprint(input: RenderFingerprintInput): string {
  if (!isDigest(input.revision)) throw new ChartsError("DOCUMENT_INVALID", "The render fingerprint needs a document revision.", "Pass the revision of the captured document.", "/revision")
  const normalised = { ...input, formats: [...new Set(input.formats)].sort() }
  return sha256(FINGERPRINT_DOMAIN + canonicalJson(normalised))
}
