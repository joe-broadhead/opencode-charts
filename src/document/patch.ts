import * as z from "zod"
import { ChartsError, pointer, type Issue } from "../errors.js"
import { captureLayoutDefaults } from "./artifact.js"
import { canonicalJson, canonicalValue, DOCUMENT_DEPTH, scanJson } from "./canonical.js"
import { DocumentInvalid } from "./issues.js"
import { AppearanceV1Schema, checkStrict, InteractionsV1Schema, overrideHint, parseDocument } from "./schema.js"
import type { AppearanceV1, CapturedDefaultsV1, CapturedDocumentV1, CapturedThemeV1, ChartArtifactV1, InteractionsV1, JsonObject, LayoutV1, RecipeLayoutV1 } from "./types.js"

/**
 * The presentation patch of charts_update, and how it applies to a saved document.
 *
 * A patch changes presentation only: title, description, appearance, layout and interactions. The chart itself (its
 * data, bindings, options, transforms, aggregation and sorting) and the document's locale, currency, seed and version
 * are fixed; changing them is a new document. The rules:
 *
 * - An omitted field leaves the document as it was. An empty title or description is intentionally empty text.
 * - appearance and interactions merge by declared property. appearance.overrides merges token by token (nested
 *   objects merge, arrays replace whole); `overrides: {}` clears every authored token override, and
 *   `categoryColors: []` clears every explicit colour entry (categoryColors is an array, so it replaces whole).
 * - layout replaces the whole authored layout: `{"target": "presentation"}` takes the presentation profile's defaults
 *   rather than keeping an older explicit width. The new layout's profile defaults are captured for the new revision;
 *   every other captured default stays.
 * - appearance.theme, when given, is resolved anew and captured, even when the name is unchanged: that is how a saved
 *   theme's later edits are adopted. Without it the captured theme base stays.
 *
 * No JSON Patch, no deletion by undefined or null, no unknown paths: the patch is strict, and the whole patched
 * document then passes the same strict validation as creation.
 */

export interface PatchV1 {
  readonly title?: string
  readonly description?: string
  readonly appearance?: AppearanceV1
  readonly layout?: LayoutV1
  readonly interactions?: InteractionsV1
}

/** The fields of a patch, in the order the result reports them. */
export const PATCH_FIELDS = ["title", "description", "appearance", "layout", "interactions"] as const

/** Fields a patch cannot carry, because an update keeps the chart's meaning: each is a new document. */
const FIXED: Readonly<Record<string, string>> = {
  version: "the document version",
  chart: "the chart (its kind, recipe or spec, data, bindings and options)",
  kind: "the chart kind",
  recipe: "the recipe",
  spec: "the engine spec",
  engine: "the engine",
  data: "the data",
  rows: "the data",
  path: "the data source",
  transform: "the data transforms",
  bindings: "the field bindings",
  options: "the recipe options (aggregation, sorting, axis types and titles, bins)",
  aggregate: "the aggregation",
  sort: "the sorting",
  locale: "the locale",
  currency: "the currency",
  seed: "the layout seed",
}

const PatchSchema = z.strictObject({
  title: z.string().max(200).optional(),
  description: z.string().max(1000).optional(),
  appearance: AppearanceV1Schema.optional(),
  // A layout's shape depends on the chart kind, so the whole-document validation checks it, with its own codes.
  layout: z.record(z.string(), z.unknown()).optional(),
  interactions: InteractionsV1Schema.optional(),
})

const isPlain = (v: unknown): v is JsonObject => !!v && typeof v === "object" && !Array.isArray(v)

/** Validates a patch strictly. Problems are DocumentInvalid with paths under /patch. */
export function parsePatch(raw: unknown): PatchV1 {
  if (!isPlain(raw)) throw new ChartsError("DOCUMENT_INVALID", "patch must be a JSON object.", `Pass {"appearance": {"theme": "dark"}}, {"layout": {"target": "presentation"}} or any of: ${PATCH_FIELDS.join(", ")}; {} renders the saved chart again.`, "/patch")
  scanJson(raw, { maxDepth: DOCUMENT_DEPTH, base: ["patch"], code: "DOCUMENT_INVALID", what: "The patch" })
  const issues: Issue[] = []
  const rest: JsonObject = {}
  for (const [key, value] of Object.entries(raw)) {
    const fixed = Object.hasOwn(FIXED, key) ? FIXED[key] : undefined
    if (fixed === undefined) { rest[key] = value; continue }
    issues.push({
      level: "error", code: "UNKNOWN_PROPERTY", path: pointer(["patch", key]),
      message: `"${key}" cannot be patched: an update changes presentation only (${PATCH_FIELDS.join(", ")}), and ${fixed} stays as saved.`,
      fix: "To change the chart's data or meaning, create a new document with charts_quick or charts_render (document); to change its presentation, patch title, description, appearance, layout or interactions.",
    })
  }
  const parsed = checkStrict<PatchV1>(PatchSchema, rest, ["patch"], issues, path => (path[1] === "appearance" ? overrideHint(path.slice(1)) : undefined))
  if (issues.length || !parsed) throw new DocumentInvalid(issues.length ? issues : [{ level: "error", code: "DOCUMENT_INVALID", message: "The patch is not valid.", path: "/patch" }])
  return parsed
}

/** Token overrides merged property by property: nested objects merge, arrays and values replace. */
function mergeDeclared(base: JsonObject, over: JsonObject): JsonObject {
  const out: JsonObject = { ...base }
  for (const [key, value] of Object.entries(over)) {
    const current = Object.hasOwn(out, key) ? out[key] : undefined
    out[key] = isPlain(value) && isPlain(current) ? mergeDeclared(current, value) : value
  }
  return out
}

export interface PatchedDocument {
  readonly document: CapturedDocumentV1
  readonly defaults: CapturedDefaultsV1
  readonly theme: CapturedThemeV1
  /** The authored fields whose value changed, such as "title", "appearance.overrides" or "layout". */
  readonly changed: readonly string[]
  /** Whether the theme base was resolved anew (appearance.theme given), and whether its tokens differ from the saved base. */
  readonly base: { readonly resolved: boolean; readonly changed: boolean }
}

/** A document path of the patched document, as a path into the call: the patched sections point into the patch. */
export function patchIssuePath(path: string | undefined): string {
  if (path === undefined || path === "/") return "/patch"
  const top = path.split("/")[1]!
  return (PATCH_FIELDS as readonly string[]).includes(top) ? `/patch${path}` : `/document${path}`
}

/**
 * Applies a parsed patch to a verified artifact's document and captured defaults. `theme` is the newly resolved named
 * theme when the patch gives appearance.theme; otherwise the captured base stays. The patched document is validated
 * with the same strict schema as a saved document; the chart (data, bindings, options) is never touched.
 */
export function applyPatch(artifact: ChartArtifactV1, patch: PatchV1, theme?: CapturedThemeV1): PatchedDocument {
  const before = artifact.document
  const doc = structuredClone(before) as unknown as JsonObject
  if (patch.title !== undefined) doc.title = patch.title
  if (patch.description !== undefined) doc.description = patch.description
  if (patch.appearance !== undefined) {
    const appearance: JsonObject = { ...((before.appearance ?? {}) as JsonObject) }
    const given = patch.appearance
    if (given.theme !== undefined) appearance.theme = given.theme
    if (given.overrides !== undefined) {
      if (Object.keys(given.overrides).length === 0) delete appearance.overrides
      else appearance.overrides = mergeDeclared((appearance.overrides ?? {}) as JsonObject, given.overrides as JsonObject)
    }
    if (given.categoryColors !== undefined) {
      if (given.categoryColors.length === 0) delete appearance.categoryColors
      else appearance.categoryColors = given.categoryColors
    }
    if (Object.keys(appearance).length) doc.appearance = appearance
    else delete doc.appearance
  }
  if (patch.layout !== undefined) doc.layout = patch.layout
  if (patch.interactions !== undefined) doc.interactions = { ...((before.interactions ?? {}) as JsonObject), ...patch.interactions }

  let document: CapturedDocumentV1
  try { document = parseDocument(canonicalValue(doc), { captured: true }) }
  catch (error) {
    if (error instanceof DocumentInvalid) throw new DocumentInvalid(error.issues.map(i => ({ ...i, path: patchIssuePath(i.path) })))
    if (error instanceof ChartsError) throw new ChartsError(error.code, error.detail, error.hint, patchIssuePath(error.path))
    throw error
  }

  // Defaults: a replaced layout captures its own profile's defaults; an interaction the patch now sets is no longer a
  // captured default. Everything else stays as captured.
  const defaults: { -readonly [K in keyof CapturedDefaultsV1]: CapturedDefaultsV1[K] } = { ...artifact.captured.defaults }
  if (document.chart.kind === "recipe" && patch.layout !== undefined) defaults.layout = captureLayoutDefaults(patch.layout as RecipeLayoutV1)
  if (patch.interactions !== undefined && defaults.interactions) {
    const left = Object.fromEntries(Object.entries(defaults.interactions).filter(([key]) => (document.interactions as JsonObject | undefined)?.[key] === undefined))
    if (Object.keys(left).length) defaults.interactions = left
    else delete defaults.interactions
  }

  const base = theme ?? artifact.captured.theme
  const section = (d: unknown, path: readonly string[]) => canonicalJson(path.reduce<unknown>((node, key) => (isPlain(node) && Object.hasOwn(node, key) ? node[key] : null), d) ?? null)
  const changed = [["title"], ["description"], ["appearance", "theme"], ["appearance", "overrides"], ["appearance", "categoryColors"], ["layout"], ["interactions"]]
    .filter(path => section(before, path) !== section(document, path))
    .map(path => path.join("."))
  return {
    document,
    defaults: canonicalValue(defaults) as unknown as CapturedDefaultsV1,
    theme: base,
    changed,
    base: { resolved: theme !== undefined, changed: canonicalJson(base) !== canonicalJson(artifact.captured.theme) },
  }
}
