import type { Issue } from "../errors.js"
import type { Prepared } from "../document/prepare.js"
import { DocumentInvalid } from "../document/issues.js"
import { formatMismatch } from "../interactions/presets.js"
import { LAYOUT_PROFILES } from "../document/defaults.js"
import { bundledFonts, readCustomFonts, withCustomFonts, type FontBook } from "../fonts.js"
import { renderChart, type Environment, type RenderRequest, type RenderResult } from "../pipeline.js"
import { resolveAppearance } from "./appearance.js"
import type { Conflict } from "./planner.js"
import { presentRecipe, unsatisfiable, type RecipePresentation } from "./present.js"
import type { PlotBounds } from "./vega.js"

/**
 * The server side of recipe layout: the shared planner measures with the approved font tables, the chart is drawn with
 * the existing renderer, and the drawing itself is the check. A candidate passes only when the SVG is exactly the
 * requested outer size, no label collides or runs past the edge, and the plot keeps its minimum size; otherwise the
 * next candidate in the fixed order is drawn. Three candidates at most, so at most three renders and the planner's
 * measurement budget: the work is bounded and the outcome never depends on time. When none passes, nothing is
 * returned to publish: LAYOUT_UNSATISFIABLE, with the measured conflicts.
 *
 * `fitRecipe` returns the render request that passed; publishing it (formats, folder, name) is the caller's step.
 */

export interface LayoutReport {
  readonly target: string
  readonly mode: "fixed" | "responsive"
  readonly requested: { readonly width: number; readonly height: number }
  readonly actual: { readonly width: number; readonly height: number }
  readonly plot?: PlotBounds
  readonly floor: number
  readonly fontSizes: { readonly label: number; readonly axisTitle: number; readonly title: number }
  readonly candidate: { readonly index: number; readonly name: string }
  /** Presentation changes the plan made, with the spec path and the reason. */
  readonly adjustments: readonly { readonly path: string; readonly reason: string }[]
  /** Candidates that were drawn and failed the check, with what the drawing showed. */
  readonly rejected: readonly { readonly candidate: string; readonly conflicts: readonly Conflict[] }[]
  /** Layout findings left in the drawing (none when the check passed). */
  readonly unresolved: readonly Issue[]
}

export interface FittedRecipe {
  /** Everything a render of this chart needs except delivery (formats, scales, name, outDir, preview, marks, svgText). */
  readonly request: RenderRequest
  readonly presentation: RecipePresentation
  /** The checking render (nothing written). */
  readonly check: RenderResult
  readonly report: LayoutReport
  readonly issues: readonly Issue[]
}

/** The fonts the chart measures and draws with: bundled, plus the theme's custom files (read with read permission). */
async function fontsFor(env: Environment, files: readonly { family: string; weight?: number; path: string }[]): Promise<FontBook> {
  const book = bundledFonts(env.packageRoot)
  if (!files.length) return book
  return withCustomFonts(book, await readCustomFonts(env.workspace, files, env.assertFiles ? paths => env.assertFiles!("read", paths) : undefined))
}

const MEASURED_FINDINGS = new Set(["LABEL_COLLISION", "LABEL_CLIPPED"])

/** Fits a prepared recipe document. Throws LAYOUT_UNSATISFIABLE (a DocumentInvalid) when no candidate passes. */
export async function fitRecipe(prepared: Prepared, env: Environment): Promise<FittedRecipe> {
  const { artifact, compilation, settings } = prepared
  if (!compilation || !settings.layout) throw new TypeError("fitRecipe needs a prepared recipe document")
  const doc = artifact.document
  const layout = settings.layout
  const profile = { ...LAYOUT_PROFILES[layout.target], minLabelSize: layout.minLabelSize }
  const appearance = resolveAppearance({
    base: settings.theme.tokens, profile,
    ...(doc.appearance?.overrides ? { overrides: doc.appearance.overrides } : {}),
    ...(doc.appearance?.categoryColors ? { categoryColors: doc.appearance.categoryColors } : {}),
    ...(artifact.captured.categories ? { categories: artifact.captured.categories } : {}),
  })
  const tokens = appearance.tokens
  const fonts = await fontsFor(env, tokens.font.files)
  const measure = (text: string, size: number, bold?: boolean) => fonts.measure(text, size, tokens.font.family, bold ? tokens.font.titleWeight : 400)
  const rejected: { candidate: string; conflicts: Conflict[] }[] = []

  for (let from = 0; from < 3;) {
    const presentation = presentRecipe({
      compilation, settings, appearance, measure, from,
      ...(doc.title ? { title: doc.title } : {}),
      ...(artifact.captured.categories ? { categories: artifact.captured.categories } : {}),
    })
    const request: RenderRequest = {
      spec: presentation.spec,
      engine: "vega-lite",
      data: { rows: presentation.rows as never, name: presentation.dataName },
      themeTokens: tokens,
      locale: settings.locale,
      ...(doc.currency ? { currency: doc.currency } : {}),
      seed: settings.seed,
      ...(doc.title !== undefined ? { title: doc.title } : {}),
      ...(doc.description !== undefined ? { description: doc.description } : {}),
      presentation: presentation.runtime,
      formats: [],
    }
    const check = await renderChart(request, env, false)
    const conflicts: Conflict[] = []
    if (check.width !== layout.width || check.height !== layout.height) conflicts.push({ what: `the drawing is ${check.width}×${check.height} px, not the requested ${layout.width}×${layout.height}`, path: "/layout", needed: Math.max(check.width, check.height), available: Math.max(layout.width, layout.height) })
    for (const pair of check.layout.overlaps) conflicts.push({ what: `labels "${pair[0]}" and "${pair[1]}" overlap`, path: "/encoding", needed: 0, available: 0 })
    for (const text of check.layout.clipped) conflicts.push({ what: `label "${text}" runs past the edge`, path: "/encoding", needed: 0, available: 0 })
    if (check.plot && (check.plot.width < 1 || check.plot.height < 1)) conflicts.push({ what: `the plot is ${check.plot.width}×${check.plot.height} px`, path: "/layout", needed: 1, available: Math.min(check.plot.width, check.plot.height) })
    if (!conflicts.length) {
      const report: LayoutReport = {
        target: layout.target, mode: layout.mode,
        requested: { width: layout.width, height: layout.height },
        actual: { width: check.width, height: check.height },
        ...(check.plot ? { plot: check.plot } : {}),
        floor: layout.minLabelSize,
        fontSizes: { label: tokens.font.labelSize, axisTitle: tokens.font.size, title: tokens.font.titleSize },
        candidate: { index: presentation.plan.candidate, name: presentation.plan.name },
        adjustments: presentation.plan.adjustments,
        rejected,
        unresolved: check.issues.filter(i => MEASURED_FINDINGS.has(i.code)),
      }
      return { request, presentation, check, report, issues: [...presentation.issues, ...check.issues] }
    }
    rejected.push({ candidate: presentation.plan.name, conflicts })
    from = presentation.plan.candidate + 1
    if (from >= 3) throw unsatisfiable(settings, conflicts, true)
  }
  throw unsatisfiable(settings, rejected.flatMap(r => r.conflicts), true)
}

export type Delivery = Pick<RenderRequest, "formats" | "scales" | "name" | "outDir" | "svgText" | "preview" | "marks">

/**
 * Fits and renders a prepared recipe document with the given delivery: the checking render's chart, written. An
 * explicit format list without HTML for explicitly requested interactions is refused first (INTERACTION_FORMAT_MISMATCH).
 */
export async function renderRecipe(prepared: Prepared, env: Environment, delivery: Delivery, write = true): Promise<{ fitted: FittedRecipe; result: RenderResult }> {
  const settings = prepared.settings
  const mismatch = settings.interactions ? formatMismatch(delivery.formats, settings.interactions, settings.explicitInteractions ?? []) : undefined
  if (mismatch) throw new DocumentInvalid([mismatch])
  const fitted = await fitRecipe(prepared, env)
  const result = await renderChart({ ...fitted.request, ...delivery }, env, write)
  return { fitted, result }
}
