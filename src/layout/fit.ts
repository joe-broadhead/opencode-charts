import type { Issue } from "../errors.js"
import type { Prepared } from "../document/prepare.js"
import { DocumentInvalid } from "../document/issues.js"
import { formatMismatch } from "../interactions/presets.js"
import { LAYOUT_PROFILES } from "../document/defaults.js"
import { bundledFonts, readCustomFonts, withCustomFonts, type FontBook, type FontResource } from "../fonts.js"
import type { FigureNode } from "../figure.js"
import { renderChart, type Environment, type RenderRequest, type RenderResult } from "../pipeline.js"
import { resolveAppearance } from "./appearance.js"
import { PLANNER_LIMITS, type Conflict } from "./planner.js"
import { LayoutUnsatisfiable, presentRecipe, refusalIssue, swapTurnsAxes, unsatisfiable, type Alternatives, type RecipePresentation } from "./present.js"
import { LIMITS } from "../safety.js"
import { compileRecipe } from "../recipes/compile.js"
import type { CapturedRecipeChartV1 } from "../document/types.js"
import { legendEntries, type PlotBounds } from "./vega.js"

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

/** The least gap, in pixels, between two flat labels side by side on the x axis. */
export const MIN_LABEL_GAP = 3

/**
 * Pairs of axis labels side by side on one line (the same top edge) whose gap is under MIN_LABEL_GAP, left to right.
 * Any axis label counts: the figure can file a flush first label under the y axis.
 */
export function touchingLabels(nodes: readonly FigureNode[]): [FigureNode, FigureNode][] {
  const labels = nodes.filter(n => n.kind === "label").slice().sort((a, b) => a.box[0] - b.box[0])
  const out: [FigureNode, FigureNode][] = []
  for (let i = 0; i < labels.length; i++) for (let j = i + 1; j < labels.length; j++) {
    const a = labels[i]!, b = labels[j]!
    if (Math.abs(a.box[1] - b.box[1]) > 2) continue
    if (b.box[0] - a.box[2] < MIN_LABEL_GAP) out.push([a, b])
    break
  }
  return out
}

/**
 * Below this share of the canvas, the plot is reported: there is no minimum plot area beyond the planner's 64 × 48 px,
 * so a chart whose labels take most of the room still fits, and the result says so.
 */
export const SMALL_PLOT_SHARE = 0.25

function smallPlot(plot: PlotBounds | undefined, width: number, height: number): { path: string; reason: string }[] {
  if (!plot) return []
  const share = (plot.width * plot.height) / (width * height)
  if (share >= SMALL_PLOT_SHARE) return []
  return [{ path: "/layout", reason: `the guides take most of the canvas: the plot is ${Math.round(plot.width)}×${Math.round(plot.height)} px, ${Math.round(share * 100)}% of ${width}×${height}; a larger layout, shorter labels or a horizontal_bar for long categories would give the data more room` }]
}

export interface FitOptions {
  /**
   * The custom fonts, already read with permission and checked against the artifact's digests (the tool adapter does
   * this); measured and drawn with as they are, never read again. Without it the theme's font files are read here.
   */
  readonly fonts?: readonly FontResource[]
  /** Refuse without drawing the alternatives (the check of one alternative uses it). */
  readonly unverified?: boolean
}

/**
 * Fits a prepared recipe document. Throws LAYOUT_UNSATISFIABLE (a DocumentInvalid) when no candidate passes; every
 * size its next step names has been fitted and drawn at that size first (see `verifiedRefusal`).
 */
export async function fitRecipe(prepared: Prepared, env: Environment, options: FitOptions = {}): Promise<FittedRecipe> {
  try { return await fitOnce(prepared, env, options) } catch (error) {
    if (!(error instanceof LayoutUnsatisfiable) || options.unverified) throw error
    throw await verifiedRefusal(error, prepared, env, options)
  }
}

/** Tries at most this many sizes per named alternative before leaving it out of the refusal. */
const VERIFY_TRIES = 6

/**
 * The most drawings one refusal may make while restating its alternatives. A refusal is answered with sizes that were
 * fitted and drawn, so the work grows with how far each estimate is from a size that draws; this keeps it bounded even
 * for a canvas no chart could use (a 60 × 60 px panel), where every step of the search would fail. A realistic refusal
 * needs a handful of drawings, well inside the budget; a pathological one stops early and names only what it proved.
 */
export const REFUSAL_RENDERS = 20

/** Whether a size draws, or `undefined` when the budget for checking is spent (so nothing is claimed about it). */
type Check = boolean | undefined

/**
 * A refusal restated with alternatives that draw: the planner's estimate of each size is a starting point, and each is
 * fitted and drawn there (growing in steps when the drawing still refuses) before it is named. The planner can miss
 * part of a chart (a bubble's size key, say), so its estimate alone is never offered as a size that fits. Every claim
 * the restated refusal makes was checked by drawing; a claim the budget could not check is left out.
 */
async function verifiedRefusal(error: LayoutUnsatisfiable, prepared: Prepared, env: Environment, options: FitOptions): Promise<LayoutUnsatisfiable> {
  const found = error.basis.alternatives
  const settings = prepared.settings
  const layout = settings.layout!
  if (!found || !prepared.compilation) return error
  // Fast path: nothing the planner can offer, so there is nothing to draw and the refusal stands as it is.
  const offered = found.own.w !== undefined || found.own.h !== undefined || found.swap !== undefined
  if (!offered) return error
  let budget = REFUSAL_RENDERS
  const at = (p: Prepared, width: number, height: number): Promise<Check> => {
    if (budget <= 0) return Promise.resolve(undefined)
    budget -= 1
    return fitOnce({ ...p, settings: { ...p.settings, layout: { ...p.settings.layout!, width, height } } }, env, { ...options, unverified: true }).then((): Check => true, (e: unknown): Check => { if (e instanceof LayoutUnsatisfiable) return false; throw e })
  }
  // From the estimate, grow by doubling steps until a size draws, then bisect back (in 10 px) to the smallest that does.
  const grow = async (fits: (size: number) => Promise<Check>, start: number | undefined) => {
    if (start === undefined) return undefined
    let failed = start - 10, found: number | undefined
    for (let i = 0; i < VERIFY_TRIES && found === undefined; i++) {
      const size = Math.min(LIMITS.dimension, start + 10 * (2 ** i - 1))
      const drawn = await fits(size)
      if (drawn === undefined) return undefined
      if (drawn) found = size
      else if (size >= LIMITS.dimension) break
      else failed = size
    }
    if (found === undefined) return undefined
    let best: number = found
    while (best - failed > 10) {
      const mid: number = failed + Math.ceil((best - failed) / 20) * 10
      const drawn = await fits(mid)
      if (drawn === undefined) return best
      if (drawn) best = mid; else failed = mid
    }
    return best
  }
  const own = {
    w: await grow(w => at(prepared, w, layout.height), found.own.w),
    h: await grow(h => at(prepared, layout.width, h), found.own.h),
  }
  let swap: Alternatives["swap"] = found.swap
  const swapped = found.swap ? swappedRecipe(prepared, found.swap.recipe) : undefined
  if (found.swap && !swapped) swap = undefined
  else if (found.swap && swapped) {
    // Drawn here first whatever the planner estimated: a different recipe can fit a size the planner refused for this
    // one. An unverified "does not fit here" would be a claim the refusal could not stand behind: leave the swap out.
    const here = await at(swapped, layout.width, layout.height)
    if (here === undefined) swap = undefined
    else {
      const need = here ? {} : {
        w: await grow(w => at(swapped, w, layout.height), found.swap.need.w ?? layout.width),
        h: await grow(h => at(swapped, layout.width, h), found.swap.need.h ?? layout.height),
      }
      swap = { recipe: found.swap.recipe, here, need: { ...(need.w !== undefined ? { w: need.w } : {}), ...(need.h !== undefined ? { h: need.h } : {}) } }
    }
  }
  // A swap that needs exactly what the chart itself needs tells the reader nothing: leave it out.
  if (swap && !swap.here && swap.need.w === own.w && swap.need.h === own.h && (swap.need.w !== undefined || swap.need.h !== undefined)) swap = undefined
  const verified: Alternatives = { ...(swap ? { swap } : {}), own: { ...(own.w !== undefined ? { w: own.w } : {}), ...(own.h !== undefined ? { h: own.h } : {}) } }
  return new LayoutUnsatisfiable([refusalIssue(settings, error.basis.conflicts, error.basis.measured, { found: verified, recipe: prepared.compilation.recipe })], { ...error.basis, alternatives: verified })
}

/** The same prepared chart as the other recipe of its family (its axis titles swapped when the swap turns the axes). */
function swappedRecipe(prepared: Prepared, recipe: string): Prepared | undefined {
  const chart = prepared.artifact.document.chart as CapturedRecipeChartV1
  const options = { ...(chart.options ?? {}) } as Record<string, unknown>
  if (swapTurnsAxes(prepared.compilation!.recipe)) {
    const [x, y] = [options.xTitle, options.yTitle]
    delete options.xTitle; delete options.yTitle
    if (typeof y === "string") options.xTitle = y
    if (typeof x === "string") options.yTitle = x
  }
  try {
    const compilation = compileRecipe({ ...chart, recipe, options } as never, (prepared.rows ?? []) as Record<string, unknown>[], prepared.artifact.captured.categories ? { categoryDomain: prepared.artifact.captured.categories.domain } : {})
    return { ...prepared, compilation }
  } catch { return undefined }
}

async function fitOnce(prepared: Prepared, env: Environment, options: FitOptions): Promise<FittedRecipe> {
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
  const fonts = options.fonts ? (options.fonts.length ? withCustomFonts(bundledFonts(env.packageRoot), options.fonts) : bundledFonts(env.packageRoot)) : await fontsFor(env, tokens.font.files)
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
      ...(options.fonts ? { fontResources: options.fonts } : {}),
      formats: [],
    }
    const check = await renderChart(request, env, false)
    const conflicts: Conflict[] = []
    if (check.width !== layout.width || check.height !== layout.height) conflicts.push({ what: `the drawing is ${check.width}×${check.height} px, not the requested ${layout.width}×${layout.height}`, path: "/layout", needed: Math.max(check.width, check.height), available: Math.max(layout.width, layout.height) })
    for (const pair of check.layout.overlaps) conflicts.push({ what: `labels "${pair[0]}" and "${pair[1]}" overlap`, path: "/encoding", needed: 0, available: 0 })
    for (const text of check.layout.clipped) conflicts.push({ what: `label "${text}" runs past the edge`, path: "/encoding", needed: 0, available: 0 })
    // Labels that touch read as one ("NovemberDecember") even when they do not overlap: flat x labels keep a gap.
    const overlapping = new Set(check.layout.overlaps.map(pair => [...pair].sort().join("\u0000")))
    // A pair that overlaps is reported once, as an overlap, not again as touching.
    if (presentation.plan.signals.charts_x_angle === 0) for (const [a, b] of touchingLabels(check.figure.nodes)) if (!overlapping.has([a.text, b.text].sort().join("\u0000"))) conflicts.push({ what: `x labels "${a.text}" and "${b.text}" are ${Math.max(0, Math.round((b.box[0] - a.box[2]) * 10) / 10)} px apart`, path: "/encoding/x/axis", needed: MIN_LABEL_GAP, available: Math.max(0, b.box[0] - a.box[2]) })
    const legend = presentation.runtime.planner.legend
    if (legend?.kind === "symbol") {
      const drawn = legendEntries(check.svg)
      const shown = new Set(drawn.labels)
      const missing = legend.labels.filter(label => !shown.has(label))
      if (drawn.elided || missing.length) conflicts.push({ what: `the legend leaves out ${missing.length} of ${legend.labels.length} entries${missing.length ? ` (such as ${JSON.stringify(missing[0])})` : ""}${drawn.elided ? " behind an elided rest" : ""}`, path: "/encoding/color/legend", needed: legend.labels.length, available: legend.labels.length - missing.length })
    }
    // The drawn plot keeps the planner's minimum: guides that squeeze it smaller are a refusal, not a chart.
    if (check.plot && (check.plot.width < PLANNER_LIMITS.minPlotWidth || check.plot.height < PLANNER_LIMITS.minPlotHeight)) conflicts.push({ what: `the guides leave a ${Math.floor(check.plot.width)}×${Math.floor(check.plot.height)} px plot`, path: "/layout", needed: check.plot.width < PLANNER_LIMITS.minPlotWidth ? PLANNER_LIMITS.minPlotWidth : PLANNER_LIMITS.minPlotHeight, available: Math.floor(Math.min(check.plot.width < PLANNER_LIMITS.minPlotWidth ? check.plot.width : check.plot.height)) })
    if (!conflicts.length) {
      const report: LayoutReport = {
        target: layout.target, mode: layout.mode,
        requested: { width: layout.width, height: layout.height },
        actual: { width: check.width, height: check.height },
        ...(check.plot ? { plot: check.plot } : {}),
        floor: layout.minLabelSize,
        fontSizes: { label: tokens.font.labelSize, axisTitle: tokens.font.size, title: tokens.font.titleSize },
        candidate: { index: presentation.plan.candidate, name: presentation.plan.name },
        adjustments: [...presentation.plan.adjustments, ...smallPlot(check.plot, layout.width, layout.height)],
        rejected,
        unresolved: check.issues.filter(i => MEASURED_FINDINGS.has(i.code)),
      }
      return { request, presentation, check, report, issues: [...presentation.issues, ...check.issues] }
    }
    rejected.push({ candidate: presentation.plan.name, conflicts })
    from = presentation.plan.candidate + 1
    if (from >= 3) throw unsatisfiable(settings, conflicts, true, { recipe: compilation.recipe, planner: presentation.runtime.planner, measure })
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
  // The appearance findings (CATEGORY_COLOR_UNUSED) belong to the result too, not only to the fitting report.
  return { fitted, result: { ...result, issues: [...fitted.presentation.issues, ...result.issues] } }
}
