import { basename } from "node:path"
import { loadData } from "./data.js"
import { isObject, type Json } from "./engines/common.js"
import { ChartsError, SpecInvalid, formatIssues, type Issue } from "./errors.js"
import { DocumentInvalid } from "./document/issues.js"
import { documentFields, documentFormats, documentRequest, fitDocument, fittedIssues, issueMapper, legacyDocument, pickDelivery, resolveArtifact, resolveFresh, resolveUpdate, selectArm, type Arm, type ChartTool, type ResolvedDocument } from "./document-tool.js"
import { PATCH_FIELDS } from "./document/patch.js"
import type { FittedRecipe } from "./layout/fit.js"
import { parseBoardDocument } from "./board/schema.js"
import { renderBoard } from "./board/render-board.js"
import { renderChart, type Environment, type RenderRequest, type RenderResult } from "./pipeline.js"
import { quickSpec } from "./quick.js"
import { figureJson } from "./figure.js"
import type { ToolName } from "./registry.js"

/**
 * The render core shared by the chart methods: one render path, one document resolution, one update and one board.
 *
 * A handler (`src/handlers/<method>.ts`) supplies the method's input and output; this module does the work. Every
 * function returns the method's answer, the object the register checks against the handler's output schema.
 */

export interface ToolEnvironment extends Environment {
  /** Asks the host for permission on workspace files: `read` for inputs, `edit` for outputs. */
  readonly assertFiles: (action: "read" | "edit", resources: readonly string[]) => Promise<void>
}

export interface ToolOutput {
  readonly output: Json
}

/** How a document call shapes the shared render result: its issue paths, and the fields it adds. */
interface Shape {
  readonly mapIssue?: (issue: Issue) => Issue
  readonly decorate?: (result: RenderResult, issues: readonly Issue[]) => Json
  /** Problems found before rendering that a check reports as invalid (a render throws them instead). */
  readonly preflight?: readonly Issue[]
  /** Text after the summary. */
  readonly note?: string
  /** Findings made before the render that belong with its own (a recipe's appearance warnings), already pointed. */
  readonly issues?: readonly Issue[]
}

async function run(env: ToolEnvironment, request: RenderRequest, write: boolean, inspect: boolean | undefined, extra: Json = {}, shape: Shape = {}): Promise<ToolOutput> {
  if (request.data?.path) await env.assertFiles("read", [request.data.path])
  const map = shape.mapIssue ?? ((issue: Issue) => issue)
  try {
    if (write) await env.assertFiles("edit", [`${request.outDir ?? env.defaults.outDir}/*`])
    // The 1x preview costs little; it is sent only when asked for, or when there is something to look at. It is not
    // part of the answer: the files on disk are what a caller shows.
    const result = await renderChart({ ...request, preview: inspect !== false }, env, write)
    const issues = [...(shape.issues ?? []), ...result.issues.map(map)]
    if (shape.preflight?.length) return invalid([...shape.preflight, ...issues])
    const output: Json = {
      ...(write ? {} : { valid: true }),
      engine: result.engine, theme: result.theme, title: result.title, description: result.description, width: result.width, height: result.height,
      files: result.files, ...(result.markdown ? { markdown: result.markdown } : {}), summary: result.summary,
      warnings: issues.filter(i => i.level === "warning"), notes: result.notes, layout: result.layout,
      ...(result.ascii ? { ascii: result.ascii } : {}),
      figure: figureJson(result.figure), ms: result.ms, ...extra, ...(shape.decorate?.(result, issues) ?? {}),
    }
    return { output }
  } catch (error) {
    // A preflight issue of the shared pipeline already carries a tool path; spec issues are pointed into the call.
    if (error instanceof SpecInvalid && !write) return invalid([...(shape.preflight ?? []), ...error.issues.map(map)])
    throw error
  }
}

const invalid = (issues: readonly Issue[]): ToolOutput => ({ output: { valid: false, issues: issues as unknown as Json } })

/**
 * A call with a chart document: an inline document, a saved artifact's path, or a legacy call that asks for document
 * output. Resolution (reading, checking, capturing) comes first, then the formats; nothing is drawn or written until
 * both pass. A check reports a document that cannot compile, or a format it cannot make, as valid: false.
 */
async function runDocument(env: ToolEnvironment, name: ChartTool, input: Record<string, unknown>, arm: Arm): Promise<ToolOutput> {
  const write = name !== "validate"
  const delivery = pickDelivery(input)
  let resolved: ResolvedDocument
  try {
    resolved = arm === "artifact" ? await resolveArtifact(env, String(input.documentPath), input.expectedRevision as string | undefined)
      : arm === "document" ? await resolveFresh(env, input.document, { recipeOnly: name === "quick" })
      : await legacyDocument(env, name, input)
  } catch (error) {
    if (error instanceof DocumentInvalid && !write) return invalid(error.issues)
    throw error
  }
  // A recipe with no rows after data.transform has nothing to draw, and nothing is invented to fill it.
  if (resolved.artifact.document.chart.kind === "recipe" && resolved.rows?.length === 0) {
    const empty = { detail: "The chart's data has no rows after data.transform, so there is nothing to draw; no values are invented.", path: "/document/chart/data", hint: "Check data.rows or the file, and any data.transform filter; if the data is really empty, say so instead of drawing a chart." }
    if (!write) return invalid([{ level: "error", code: "DATA_EMPTY", message: empty.detail, path: empty.path, fix: empty.hint }])
    throw new ChartsError("DATA_EMPTY", empty.detail, empty.hint, empty.path)
  }
  const { formats, mismatch } = documentFormats(delivery.formats, resolved.settings)
  const preflight: Issue[] = []
  if (mismatch) {
    if (write) throw mismatch
    preflight.push({ level: "error", code: mismatch.code, message: mismatch.detail, path: mismatch.path!, fix: mismatch.hint })
  }
  const inspect = (delivery.inspect as boolean | undefined) ?? (write ? undefined : true)
  // A recipe is fitted by the layout planner first: a size that cannot be met stops here, before any file.
  let fitted: FittedRecipe | undefined
  try { fitted = await fitDocument(env, resolved) } catch (error) {
    if (error instanceof DocumentInvalid && !write) return invalid([...preflight, ...error.issues])
    if (error instanceof SpecInvalid && !write) return invalid([...preflight, ...error.issues.map(issueMapper(resolved))])
    throw error
  }
  // A new document's output (an inline document, or a saved artifact drawn again) is published as one complete,
  // immutable generation folder; a legacy call that asks for document output keeps the flat file names.
  const request: RenderRequest = { ...documentRequest(resolved, delivery, formats, write, fitted), ...(write && arm !== "legacy" ? { generation: true } : {}) }
  const mapIssue = issueMapper(resolved)
  const kind = resolved.artifact.document.chart.kind
  return run(env, request, write, inspect, {}, {
    mapIssue,
    preflight,
    issues: fittedIssues(fitted),
    decorate: (result, issues) => ({
      ...(documentFields(env, resolved, result, issues, { formats: write ? formats : formats.filter(f => f !== "document"), delivery, write, inspect: inspect !== false, ...(fitted ? { fitted } : {}) }) as Record<string, Json>),
      ...(result.generation ? { generation: { ...result.generation } } : {}),
    }),
    note: `Document: ${kind === "recipe" ? `recipe ${(resolved.artifact.document.chart as { recipe: string }).recipe}` : "engine chart"}, revision ${resolved.artifact.revision}${resolved.documentPath ? `, replayed from ${resolved.documentPath}` : ""}. SVG and PNG are static pictures of the initial view.${write && formats.includes("document") ? " Change its presentation from the saved .chart.json; change its data or meaning with a new document." : ""}`,
  })
}

const pickOutputs = (input: Record<string, unknown>): Partial<RenderRequest> => {
  const keys = ["theme", "locale", "currency", "currencyFields", "formats", "scales", "name", "title", "description", "outDir", "svgText", "seed", "width", "height", "marks", "kicker", "subtitle", "source", "notes", "annotations", "motion", "fps"] as const
  return Object.fromEntries(keys.filter(k => input[k] !== undefined).map(k => [k, input[k]])) as Partial<RenderRequest>
}

/** The table spec a tools.charts.table call describes: its columns and presentation, with the rows kept out of the spec. */
export const tableSpecOf = (input: Record<string, unknown>): Json => ({
  columns: input.columns,
  ...(input.title !== undefined ? { title: input.title } : {}),
  ...(input.subtitle !== undefined ? { subtitle: input.subtitle } : {}),
  ...(input.kicker !== undefined ? { kicker: input.kicker } : {}),
  ...(input.source !== undefined ? { source: input.source } : {}),
  ...(input.notes !== undefined ? { notes: input.notes } : {}),
  ...(input.rowGroupField !== undefined ? { rowGroupField: input.rowGroupField } : {}),
  ...(input.summaryRow !== undefined ? { summaryRow: input.summaryRow } : {}),
  ...(input.sortBy !== undefined ? { sortBy: input.sortBy } : {}),
  ...(input.limit !== undefined ? { limit: input.limit } : {}),
  ...(input.zebra !== undefined ? { zebra: input.zebra } : {}),
  ...(input.highlightRows !== undefined ? { highlightRows: input.highlightRows } : {}),
}) as Json

/** The diagram spec a tools.charts.diagram call describes: Mermaid source or a structured kind, never both. */
export const diagramSpecOf = (input: Record<string, unknown>): Json => ({
  ...(input.dsl !== undefined ? { dsl: input.dsl } : {}),
  ...(input.kind !== undefined ? { kind: input.kind } : {}),
  ...(input.layout !== undefined ? { layout: input.layout } : {}),
  ...(input.direction !== undefined ? { direction: input.direction } : {}),
  ...(input.effect !== undefined ? { effect: input.effect } : {}),
  ...(input.root !== undefined ? { root: input.root } : {}),
  ...(input.nodes !== undefined ? { nodes: input.nodes } : {}),
  ...(input.edges !== undefined ? { edges: input.edges } : {}),
  ...(input.groups !== undefined ? { groups: input.groups } : {}),
  ...(input.categories !== undefined ? { categories: input.categories } : {}),
  ...(input.title !== undefined ? { title: input.title } : {}),
  ...(input.subtitle !== undefined ? { subtitle: input.subtitle } : {}),
  ...(input.kicker !== undefined ? { kicker: input.kicker } : {}),
  ...(input.source !== undefined ? { source: input.source } : {}),
  ...(input.notes !== undefined ? { notes: input.notes } : {}),
  ...(input.width !== undefined ? { width: input.width } : {}),
  ...(input.height !== undefined ? { height: input.height } : {}),
}) as Json

/**
 * tools.charts.board: the document parsed with its JSON paths, every dataset file read with permission, and the four files
 * published together.
 */
async function runBoard(env: ToolEnvironment, input: Record<string, unknown>): Promise<ToolOutput> {
  const given = isObject(input.board) ? input.board as Record<string, unknown> : {}
  const board = parseBoardDocument({
    ...given,
    ...(input.theme !== undefined ? { theme: input.theme } : {}),
    ...(input.locale !== undefined ? { locale: input.locale } : {}),
    ...(input.currency !== undefined ? { currency: input.currency } : {}),
  })
  const paths = Object.values(board.datasets).map(dataset => dataset.path).filter((path): path is string => typeof path === "string")
  if (paths.length) await env.assertFiles("read", paths)
  const outDir = String(input.outDir ?? env.defaults.outDir)
  if (env.plan === undefined) await env.assertFiles("edit", [`${outDir}/*`])
  const requested = Array.isArray(input.scales) ? input.scales as number[] : []
  const scale = (requested[0] ?? 2) as 1 | 2 | 3
  const result = await renderBoard(board, env, true, { ...(input.name !== undefined ? { name: String(input.name) } : {}), outDir, scale })
  const warnings = result.issues.filter(issue => issue.level === "warning")
  const output: Json = {
    engine: "board", theme: result.theme, title: result.title, description: result.summary, width: result.width, height: result.height,
    files: result.files, ...(result.markdown ? { markdown: result.markdown } : {}), summary: result.summary,
    warnings, issues: result.issues as unknown as Json, panels: result.panels, rows: result.rows, ms: result.ms,
  }
  return { output }
}

/** Delivery fields without the frame's own text, which a table or a diagram draws inside its spec. */
export const pickFrameless = (input: Record<string, unknown>): Partial<RenderRequest> => {
  const picked = pickOutputs(input) as Record<string, unknown>
  for (const key of ["kicker", "subtitle", "source", "notes"] as const) delete picked[key]
  return picked as Partial<RenderRequest>
}

/**
 * tools.charts.update: the saved artifact verified at expectedRevision, the patch applied, the new revision drawn through
 * the layout planner like any recipe document, and its files published as a new generation folder. A stale revision,
 * an invalid patch, a format list that contradicts an explicit interaction, or a size that cannot be met all stop the
 * call before anything is written; the source artifact and earlier generations are never touched.
 */
async function runUpdate(env: ToolEnvironment, input: Record<string, unknown>): Promise<ToolOutput> {
  const given = pickDelivery(input)
  const { resolved, origin } = await resolveUpdate(env, String(input.documentPath), String(input.expectedRevision), input.patch)
  // The files keep the source artifact's stem (revenue.chart.json → revenue-<digest>/revenue.*) unless a name is given.
  const delivery = given.name !== undefined ? given : { ...given, name: basename(origin.documentPath).replace(/\.chart\.json$/i, "").replace(/\.json$/i, "") }
  const { formats, mismatch } = documentFormats(delivery.formats, resolved.settings)
  if (mismatch) throw mismatch
  const fitted = await fitDocument(env, resolved)
  const request: RenderRequest = { ...documentRequest(resolved, delivery, formats, true, fitted), generation: true }
  const mapIssue = issueMapper(resolved)
  const revision = resolved.artifact.revision
  const changed = origin.changed.length ? `changed ${origin.changed.join(", ")}` : "no authored field changed"
  return run(env, request, true, delivery.inspect, {}, {
    mapIssue: issue => intoPatch(mapIssue(issue)),
    issues: fittedIssues(fitted).map(intoPatch),
    decorate: (result, issues) => ({
      ...(documentFields(env, resolved, result, issues, { formats, delivery, write: true, inspect: delivery.inspect !== false, ...(fitted ? { fitted } : {}) }) as Record<string, Json>),
      update: {
        from: { documentPath: origin.documentPath, revision: origin.revision },
        to: { revision, ...(result.files.document ? { documentPath: result.files.document } : {}) },
        changed: [...origin.changed],
        theme: { ...origin.theme },
      },
      ...(result.generation ? { generation: { ...result.generation } } : {}),
    }),
    note: `Updated ${origin.documentPath} (revision ${origin.revision}) to revision ${revision}: ${changed}${origin.theme.resolved ? `; theme "${resolved.settings.theme.name}" resolved anew${origin.theme.changed ? " with changed tokens" : ""}` : ""}. ${generationNote(formats)} The source artifact was not changed; data, bindings, aggregation and sorting are as saved. SVG and PNG are static pictures of the initial view.`,
  })
}

/** A path into the patched document, as a path into the update call: the patched sections are under /patch. */
const intoPatch = (issue: Issue): Issue => {
  const match = /^\/document\/([a-z]+)(\/.*)?$/i.exec(issue.path ?? "")
  return match && (PATCH_FIELDS as readonly string[]).includes(match[1]!) ? { ...issue, path: `/patch/${match[1]}${match[2] ?? ""}` } : issue
}
const generationNote = (formats: readonly string[]) => formats.includes("document") ? "The new generation holds its own .chart.json: update that one next, with the new revision." : "No .chart.json was written (document is not in formats), so this revision cannot be updated again."

/** The three chart methods: a document arm, an artifact arm, or a legacy spec. */
export async function runChart(env: ToolEnvironment, name: "render" | "quick" | "validate", input: Record<string, unknown> & { data?: RenderRequest["data"] }): Promise<ToolOutput> {
  // Exactly one input arm per call, refused before any file is read or written.
  const arm = selectArm(name, input)
  if (arm !== "legacy" || (input.formats as readonly string[] | undefined)?.includes("document")) return runDocument(env, name, input, arm)
  switch (name) {
    case "render": return run(env, { spec: input.spec as Json, ...(input.engine ? { engine: input.engine as RenderRequest["engine"] } : {}), ...(input.data ? { data: input.data } : {}), ...pickOutputs(input) }, true, input.inspect as boolean | undefined)
    case "validate": return run(env, { spec: input.spec as Json, ...(input.engine ? { engine: input.engine as RenderRequest["engine"] } : {}), ...(input.data ? { data: input.data } : {}), ...pickOutputs(input) }, false, (input.inspect as boolean | undefined) ?? true)
    case "quick": {
      if (input.data?.path) await env.assertFiles("read", [input.data.path])
      const loaded = await loadData(env.workspace, input.data!)
      const spec = quickSpec(input as never, loaded.rows)
      return run(env, { spec, data: { rows: loaded.rows }, ...pickOutputs(input) }, true, input.inspect as boolean | undefined, { spec })
    }
  }
}

/** The exported pieces a handler needs, so one file per method can call the same core. */
export { run, runBoard, runUpdate }
export type { Arm }
