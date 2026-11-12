import { basename } from "node:path"
import { CATALOGUE, catalogueEntry, exampleCall } from "./catalogue.js"
import { loadData } from "./data.js"
import { ATLASES, type Json } from "./engines/common.js"
import { ChartsError, SpecInvalid, formatIssues, suggest, type Issue } from "./errors.js"
import { DocumentInvalid } from "./document/issues.js"
import { documentFields, documentFormats, documentRequest, fitDocument, fittedIssues, issueMapper, legacyDocument, pickDelivery, resolveArtifact, resolveFresh, resolveUpdate, selectArm, type Arm, type ChartTool, type ResolvedDocument } from "./document-tool.js"
import { PATCH_FIELDS } from "./document/patch.js"
import type { FittedRecipe } from "./layout/fit.js"
import { capabilities, describeCapabilities } from "./capabilities.js"
import { localeIds } from "./locale.js"
import { renderChart, type Environment, type RenderRequest, type RenderResult } from "./pipeline.js"
import { quickSpec } from "./quick.js"
import { recommend } from "./recommend/rank.js"
import { figureJson, figureText } from "./figure.js"
import { DESCRIPTIONS, INPUTS, NAMESPACE, NAMESPACE_DESCRIPTION, TOOLS, type ToolName } from "./registry.js"
import { builtinThemes, saveTheme, savedThemeNames, THEME_DIR } from "./themes/store.js"
import { approveThemeChain, resolveThemeAsked } from "./themes/chain.js"

export { DESCRIPTIONS, INPUTS, NAMESPACE, NAMESPACE_DESCRIPTION, TOOLS, type ToolName }

// ---------------------------------------------------------------------------------------------------------------

export interface ToolEnvironment extends Environment {
  /** Asks the host for permission on workspace files: `read` for inputs, `edit` for outputs. */
  readonly assertFiles: (action: "read" | "edit", resources: readonly string[]) => Promise<void>
}
export type Content = { type: "text"; text: string } | { type: "file"; uri: string; mime: string; name?: string }
export interface ToolOutput { readonly output: Json; readonly content: Content[] }

const SAVE_HINT = "To hand a file to the person, save it with your host's file-saving tool (in Jelly: jelly_file_save with the path); files under outputs/ are also kept when the turn ends."

function describeResult(r: RenderResult, wrote: boolean, issues: readonly Issue[] = r.issues): string {
  const warnings = issues.filter(i => i.level === "warning")
  const lines = [
    `${wrote ? "Rendered" : "Checked"} "${r.title}" (${r.engine}, theme ${r.theme}, ${r.width}×${r.height}px) in ${r.ms} ms.`,
    ...(r.markdown ? [`Show it inline: ${r.markdown}`] : []),
    ...(wrote ? [`Files: ${[r.files.svg, ...r.files.png, r.files.html, r.files.spec, r.files.document].filter(Boolean).join(", ")}`] : []),
    `What it shows: ${r.summary}`,
    ...(r.notes.length ? [`Defaults applied: ${r.notes.join(" ")}`] : []),
    warnings.length ? `Warnings (${warnings.length}) — fix these before showing it:\n${formatIssues(warnings)}` : "No warnings.",
    `Layout: ${r.layout.texts} labels; ${r.layout.overlaps.length ? `${r.layout.overlaps.length} overlapping` : "none overlapping"}; ${r.layout.clipped.length ? `${r.layout.clipped.length} clipped` : "none clipped"}.`,
    figureText(r.figure),
    ...(wrote ? [SAVE_HINT] : []),
  ]
  return lines.join("\n")
}

const image = (png: Uint8Array, name: string): Content => ({ type: "file", uri: `data:image/png;base64,${Buffer.from(png).toString("base64")}`, mime: "image/png", name })

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
    // The 1x preview costs little; it is sent only when asked for, or when there is something to look at.
    const result = await renderChart({ ...request, preview: inspect !== false }, env, write)
    const issues = [...(shape.issues ?? []), ...result.issues.map(map)]
    if (shape.preflight?.length) return invalid([...shape.preflight, ...issues])
    const show = inspect ?? (!write || issues.some(i => i.level === "warning"))
    const output: Json = {
      ...(write ? {} : { valid: true }),
      engine: result.engine, theme: result.theme, title: result.title, description: result.description, width: result.width, height: result.height,
      files: result.files, ...(result.markdown ? { markdown: result.markdown } : {}), summary: result.summary,
      warnings: issues.filter(i => i.level === "warning"), notes: result.notes, layout: result.layout,
      figure: figureJson(result.figure), ms: result.ms, ...extra, ...(shape.decorate?.(result, issues) ?? {}),
    }
    const content: Content[] = [{ type: "text", text: describeResult(result, write, issues) + (shape.note ? `\n${shape.note}` : "") + (extra.spec ? `\nSpec used (refine it with charts_render):\n${JSON.stringify(extra.spec)}` : "") }]
    if (show && result.preview) content.push(image(result.preview, `${result.title}.png`))
    return { output, content }
  } catch (error) {
    // A preflight issue of the shared pipeline already carries a tool path; spec issues are pointed into the call.
    if (error instanceof SpecInvalid && !write) return invalid([...(shape.preflight ?? []), ...error.issues.map(map)])
    throw error
  }
}

const invalid = (issues: readonly Issue[]): ToolOutput => ({ output: { valid: false, issues: issues as unknown as Json }, content: [{ type: "text", text: `Not valid yet:\n${formatIssues(issues)}` }] })

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
    throw error
  }
  const request = documentRequest(resolved, delivery, formats, write, fitted)
  const mapIssue = issueMapper(resolved)
  const kind = resolved.artifact.document.chart.kind
  return run(env, request, write, inspect, {}, {
    mapIssue,
    preflight,
    issues: fittedIssues(fitted),
    decorate: (result, issues) => documentFields(env, resolved, result, issues, { formats: write ? formats : formats.filter(f => f !== "document"), delivery, write, inspect: inspect !== false, ...(fitted ? { fitted } : {}) }),
    note: `Document: ${kind === "recipe" ? `recipe ${(resolved.artifact.document.chart as { recipe: string }).recipe}` : "engine chart"}, revision ${resolved.artifact.revision}${resolved.documentPath ? `, replayed from ${resolved.documentPath}` : ""}. SVG and PNG are static pictures of the initial view.${write && formats.includes("document") ? " Change its presentation from the saved .chart.json; change its data or meaning with a new document." : ""}`,
  })
}

/** A path into the patched document, as a path into the update call: the patched sections are under /patch. */
const intoPatch = (issue: Issue): Issue => {
  const match = /^\/document\/([a-z]+)(\/.*)?$/i.exec(issue.path ?? "")
  return match && (PATCH_FIELDS as readonly string[]).includes(match[1]!) ? { ...issue, path: `/patch/${match[1]}${match[2] ?? ""}` } : issue
}

/**
 * charts_update: the saved artifact verified at expectedRevision, the patch applied, the new revision drawn through
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
const generationNote = (formats: readonly string[]) => formats.includes("document") ? "The new generation holds its own .chart.json: update that one next, with the new revision." : "No .chart.json was written (document is not in formats), so this revision cannot be updated again."

const pickOutputs = (input: Record<string, unknown>): Partial<RenderRequest> => {
  const keys = ["theme", "locale", "currency", "currencyFields", "formats", "scales", "name", "title", "description", "outDir", "svgText", "seed", "width", "height", "marks"] as const
  return Object.fromEntries(keys.filter(k => input[k] !== undefined).map(k => [k, input[k]])) as Partial<RenderRequest>
}

export async function runTool(env: ToolEnvironment, name: ToolName, raw: unknown): Promise<ToolOutput> {
  const input = INPUTS[name].parse(raw) as Record<string, unknown> & { data?: RenderRequest["data"] }
  if (name === "render" || name === "validate" || name === "quick") {
    // Exactly one input arm per call, refused before any file is read or written.
    const arm = selectArm(name, input)
    if (arm !== "legacy" || (input.formats as readonly string[] | undefined)?.includes("document")) return runDocument(env, name, input, arm)
  }
  switch (name) {
    case "update": return runUpdate(env, input)
    case "render": return run(env, { spec: input.spec as Json, ...(input.engine ? { engine: input.engine as RenderRequest["engine"] } : {}), ...(input.data ? { data: input.data } : {}), ...pickOutputs(input) }, true, input.inspect as boolean | undefined)
    case "validate": return run(env, { spec: input.spec as Json, ...(input.engine ? { engine: input.engine as RenderRequest["engine"] } : {}), ...(input.data ? { data: input.data } : {}), ...pickOutputs(input) }, false, (input.inspect as boolean | undefined) ?? true)
    case "quick": {
      if (input.data?.path) await env.assertFiles("read", [input.data.path])
      const loaded = await loadData(env.workspace, input.data!)
      const spec = quickSpec(input as never, loaded.rows)
      return run(env, { spec, data: { rows: loaded.rows }, ...pickOutputs(input) }, true, input.inspect as boolean | undefined, { spec })
    }
    case "recommend": {
      if (input.data?.path) await env.assertFiles("read", [input.data.path])
      const outcome = await recommend(input as never, env)
      return { output: outcome.result as unknown as Json, content: [{ type: "text", text: outcome.text }] }
    }
    case "capabilities": {
      const view = capabilities(env)
      return { output: view as unknown as Json, content: [{ type: "text", text: describeCapabilities(view) }] }
    }
    case "catalogue": {
      if (input.id) {
        const entry = catalogueEntry(String(input.id))
        if (!entry) throw new ChartsError("CHART_TYPE_UNKNOWN", `There is no chart type "${input.id}".${suggest(String(input.id), CATALOGUE.map(c => c.id)).map(s => ` Did you mean ${s}?`).join("")}`, "Call charts_catalogue without an id to list them.")
        const call = exampleCall(entry)
        return { output: { ...entry, example: call } as unknown as Json, content: [{ type: "text", text: `${entry.name} (${entry.engine}, ${entry.family}). Use it for: ${entry.when}${entry.avoid ? ` Avoid when: ${entry.avoid}` : ""}\nA working charts_render call — swap in your data and fields:\n${JSON.stringify(call)}` }] }
      }
      const list = CATALOGUE.filter(c => !input.family || c.family === input.family)
      const text = [`${list.length} chart types. Call charts_catalogue with an id for a full working example.`, ...[...new Set(list.map(c => c.family))].map(f => `\n${f}:\n${list.filter(c => c.family === f).map(c => `- ${c.id} — ${c.name} [${c.engine}]: ${c.when}${c.avoid ? ` Avoid: ${c.avoid}` : ""}`).join("\n")}`), `\nMaps use bundled atlases, never the network: ${Object.entries(ATLASES).map(([k, a]) => `${k} (${a.about} Join keys: ${a.keys})`).join("; ")}.`]
      return { output: { types: list.map(c => ({ id: c.id, name: c.name, engine: c.engine, family: c.family, when: c.when, ...(c.avoid ? { avoid: c.avoid } : {}) })) }, content: [{ type: "text", text: text.join("\n") }] }
    }
    case "themes": {
      const sources = { workspace: env.workspace, configured: env.configuredThemes }
      if (input.name) {
        const theme = await resolveThemeAsked(sources, String(input.name), paths => env.assertFiles("read", paths))
        return { output: { theme } as unknown as Json, content: [{ type: "text", text: `Theme ${theme.name}: ${theme.description ?? ""}\nTokens (copy any subset into a custom theme with "extends": "${theme.name}"):\n${JSON.stringify(theme, null, 1)}` }] }
      }
      const builtins = builtinThemes()
      const saved = savedThemeNames(sources)
      return { output: { builtin: Object.values(builtins).map(t => ({ name: t.name, mode: t.mode, description: t.description })), saved, locales: localeIds(env.packageRoot) }, content: [{ type: "text", text: `Built-in themes:\n${Object.values(builtins).map(t => `- ${t.name} (${t.mode}): ${t.description}`).join("\n")}\nSaved themes: ${saved.length ? saved.join(", ") : "none"} (charts_theme_save makes one).\nFonts bundled: Inter, JetBrains Mono. A theme can add workspace .ttf/.otf files with font.files.` }] }
    }
    case "theme_save": {
      await env.assertFiles("edit", [`${THEME_DIR}/${input.name}.json`])
      const sources = { workspace: env.workspace, configured: env.configuredThemes }
      // The themes it extends are read with permission first; the store reads only those.
      const approved = await approveThemeChain(sources, input.theme as never, paths => env.assertFiles("read", paths))
      const { file, theme } = saveTheme({ ...sources, approved }, String(input.name), input.theme as never)
      const { themeContrastIssues } = await import("./themes/contrast.js")
      const issues: Issue[] = themeContrastIssues(theme)
      return { output: { file, theme: theme as unknown as Json, warnings: issues as unknown as Json }, content: [{ type: "text", text: `Saved theme "${theme.name}" to ${file}. Use it with theme: "${theme.name}".${issues.length ? `\nContrast warnings:\n${formatIssues(issues)}` : " Contrast checks pass."}` }] }
    }
  }
}
