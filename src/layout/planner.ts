/**
 * The layout planner: one pure policy for fitting a recipe chart into an outer size, shared by the server (which
 * measures text with the approved font tables) and the browser runtime (which measures after its embedded fonts load).
 * It imports nothing, reads no clock and keeps no state, so the same inputs give the same plan in both places; only the
 * measurements may differ, and both keep to the same candidate order, adjustment limits and readability floor.
 *
 * There are exactly three candidates, always tried in this order, and every one keeps text at its resolved size (never
 * below the floor), every category, every series and every mark:
 *
 *   0 `as-designed`: horizontal category labels, the legend where the theme puts it, a one-line title, normal ticks.
 *   1 `wrapped`:     category labels wrapped to two lines (or turned 45°), long y labels wrapped, the legend below the
 *                    plot, the title wrapped to two lines, sparser continuous ticks.
 *   2 `compact`:     category labels wrapped to three lines or turned (45°, then 90°), the legend below in columns, the
 *                    title wrapped to three lines, the sparsest ticks.
 *
 * A candidate is feasible when its estimate leaves a plot of at least MIN_PLOT and every guide in its share of the
 * canvas; the first feasible one is used. None feasible is LAYOUT_UNSATISFIABLE, with the conflicts of the last.
 *
 * The plan is a set of signal values the compiled chart reads (signal names below), so the browser reflows one live
 * view by setting signals: no recompilation, and selections survive.
 */

/** A text width in pixels; `bold` is the title's weight. */
export type Measure = (text: string, size: number, bold?: boolean) => number

export interface PlannerAxis {
  readonly kind: "discrete" | "continuous"
  /** Discrete: the category labels as drawn, in order. Continuous: the widest tick labels expected. */
  readonly labels: readonly string[]
  readonly title?: string
  /** Temporal axes keep the theme's denser time ticks. */
  readonly temporal?: boolean
  /**
   * A temporal axis with ticks on calendar boundaries: the unit, how many units the data spans, and the tick labels at
   * one tick per unit (formatted the way the axis draws them). The plan picks how many units one tick covers.
   */
  readonly time?: { readonly unit: TimeUnit; readonly intervals: number; readonly labels: readonly string[] }
}

export type TimeUnit = "year" | "month" | "day" | "hour"
/**
 * The tick steps a time unit allows, smallest first, each spacing ticks evenly: months by divisors of 12, hours of 24,
 * days by whole weeks past one day.
 */
export const TIME_STEPS: Readonly<Record<TimeUnit, readonly number[]>> = { year: [1, 2, 5, 10, 20, 50, 100], month: [1, 2, 3, 6, 12], day: [1, 7, 14, 28], hour: [1, 2, 3, 6, 12] }
/** The least space between two neighbouring labels on one axis, as a share of the label size (and never under 4 px). */
export const LABEL_GAP = 0.5

export interface PlannerLegend {
  readonly kind: "symbol" | "gradient"
  readonly labels: readonly string[]
  readonly title?: string
}

export interface PlannerInput {
  /** Outer logical pixels: title, axes, legend and padding included. */
  readonly width: number
  readonly height: number
  readonly padding: number
  /** The profile's readability floor: no text the plan places may be smaller. */
  readonly floor: number
  readonly labelSize: number
  readonly axisTitleSize: number
  readonly titleSize: number
  readonly labelPadding: number
  readonly title?: string
  readonly x?: PlannerAxis
  readonly y?: PlannerAxis
  readonly legend?: PlannerLegend
  /**
   * A size key (a bubble chart's), drawn as one column: its entries' labels and symbol diameters, and its title. It
   * stacks under the colour legend beside the plot, and stands beside it below the plot.
   */
  readonly sizeLegend?: { readonly labels: readonly string[]; readonly title?: string; readonly symbols: readonly number[] }
  /** Where the theme puts the legend in candidate 0. */
  readonly legendOrient: "right" | "bottom" | "left" | "top"
  /** Pie and donut: no axes, the plot is a circle. */
  readonly radial?: boolean
}

/** The signal names the compiled chart reads. Collision-safe: user fields never become signals. */
export const SIGNALS = {
  title: "charts_title",
  xAngle: "charts_x_angle",
  xKeys: "charts_x_keys",
  xLines: "charts_x_lines",
  yKeys: "charts_y_keys",
  yLines: "charts_y_lines",
  legendOrient: "charts_legend_orient",
  legendColumns: "charts_legend_columns",
  xTickStep: "charts_x_tick_step",
  xTimeStep: "charts_x_time_step",
  yTickStep: "charts_y_tick_step",
} as const

export interface PlanSignals {
  readonly charts_title: readonly string[]
  readonly charts_x_angle: number
  readonly charts_x_keys: readonly string[]
  readonly charts_x_lines: readonly (readonly string[])[]
  readonly charts_y_keys: readonly string[]
  readonly charts_y_lines: readonly (readonly string[])[]
  readonly charts_legend_orient: "right" | "bottom" | "left" | "top"
  readonly charts_legend_columns: number
  readonly charts_x_tick_step: number
  /** Units per tick on a calendar time axis (1 when the axis has none). */
  readonly charts_x_time_step: number
  readonly charts_y_tick_step: number
}

export interface Conflict {
  /** What does not fit, in words. */
  readonly what: string
  /** The part of the chart, as a path into the compiled spec. */
  readonly path: string
  readonly needed: number
  readonly available: number
}

export interface Adjustment { readonly path: string; readonly reason: string }

export interface Plan {
  readonly candidate: 0 | 1 | 2
  readonly name: "as-designed" | "wrapped" | "compact"
  readonly feasible: boolean
  readonly conflicts: readonly Conflict[]
  readonly signals: PlanSignals
  readonly adjustments: readonly Adjustment[]
  /** The estimated plot size; the renderer's measured bounds are reported separately. */
  readonly plot: { readonly width: number; readonly height: number }
  /** Text measurements this plan used (the work budget counts them). */
  readonly measures: number
}

export const PLANNER_LIMITS = {
  candidates: 3,
  minPlotWidth: 64,
  minPlotHeight: 48,
  /** A guide (legend, y labels) may take at most this share of the canvas. */
  legendShare: 0.35,
  /** Text measurements across all three candidates; past it the plan fails rather than guessing. */
  maxMeasures: 30_000,
  titleLines: [1, 2, 3] as const,
  xWrapLines: [1, 2, 3] as const,
  yWrapLines: [1, 2, 3] as const,
  /** The widest a wrapped y label may be, as a share of the canvas width. */
  yLabelShare: [0.3, 0.3, 0.38] as const,
  xTickStep: [96, 140, 200] as const,
  timeTickStep: [90, 130, 190] as const,
  yTickStep: [64, 80, 100] as const,
} as const

const NAMES = ["as-designed", "wrapped", "compact"] as const
const LINE = 1.2

/** Greedy word wrap into at most `lines` lines no wider than `max`; undefined when a word alone is wider. */
export function wrapText(text: string, max: number, lines: number, measure: (s: string) => number): string[] | undefined {
  if (measure(text) <= max) return [text]
  if (lines <= 1) return undefined
  const words = text.split(/\s+/).filter(Boolean)
  const out: string[] = []
  let current = ""
  for (const word of words) {
    const next = current ? `${current} ${word}` : word
    if (measure(next) <= max) { current = next; continue }
    if (!current || measure(word) > max) return undefined
    out.push(current)
    current = word
    if (out.length >= lines) return undefined
  }
  if (current) out.push(current)
  return out.length <= lines ? out : undefined
}

class BudgetExceeded extends Error {}

/**
 * The plot width left when the category labels are turned 45°: each label hangs from its band's centre, (i + ½) of a
 * band from the left edge, and reaches w·cos 45° (plus half its height) further left. The plot is the widest P with
 * room on the left for the y axis (`left`) and for every label's reach: P ≤ (A − reachᵢ) / (1 − (i + ½)/n).
 */
export function turnedPlotWidth(available: number, left: number, widths: readonly number[], size: number): number {
  const n = Math.max(1, widths.length)
  let plot = available - left
  widths.forEach((w, i) => { plot = Math.min(plot, (available - (w * Math.SQRT1_2 + size / 2)) / (1 - (i + 0.5) / n)) })
  return plot
}

/** All three candidates, in their fixed order. Throws when the work budget is spent (see `planLayout`). */
export function planCandidates(input: PlannerInput, measure: Measure): Plan[] {
  const cache = new Map<string, number>()
  let count = 0
  const m = (text: string, size: number, bold?: boolean) => {
    const key = `${size}${bold ? "b" : ""}\u0000${text}`
    let w = cache.get(key)
    if (w === undefined) {
      if (++count > PLANNER_LIMITS.maxMeasures) throw new BudgetExceeded()
      w = measure(text, size, bold)
      cache.set(key, w)
    }
    return w
  }
  return [0, 1, 2].map(c => candidate(input, c as 0 | 1 | 2, m, () => count))
}

export type PlanOutcome = { readonly ok: true; readonly plan: Plan; readonly candidates: readonly Plan[] } | { readonly ok: false; readonly candidates: readonly Plan[]; readonly conflicts: readonly Conflict[]; readonly budget?: true }

/** The first feasible candidate, or every candidate's conflicts. */
export function planLayout(input: PlannerInput, measure: Measure): PlanOutcome {
  let plans: Plan[]
  try { plans = planCandidates(input, measure) }
  catch (error) {
    if (error instanceof BudgetExceeded) return { ok: false, candidates: [], budget: true, conflicts: [{ what: `the chart has too much text to place within the planner's budget of ${PLANNER_LIMITS.maxMeasures} measurements`, path: "/", needed: PLANNER_LIMITS.maxMeasures + 1, available: PLANNER_LIMITS.maxMeasures }] }
    throw error
  }
  const plan = plans.find(p => p.feasible)
  return plan ? { ok: true, plan, candidates: plans } : { ok: false, candidates: plans, conflicts: plans[plans.length - 1]!.conflicts }
}

function candidate(input: PlannerInput, c: 0 | 1 | 2, m: Measure, used: () => number): Plan {
  const conflicts: Conflict[] = []
  const adjustments: Adjustment[] = []
  const pad = input.padding
  const availW = input.width - 2 * pad, availH = input.height - 2 * pad
  const lbl = input.labelSize
  const label = (s: string) => m(s, lbl)
  const fail = (what: string, path: string, needed: number, available: number) => conflicts.push({ what, path, needed: Math.ceil(needed), available: Math.floor(available) })

  // Readability: every size the plan places must meet the floor (an override below it never reaches here).
  for (const [name, size] of [["labels", lbl], ["axis titles", input.axisTitleSize], ["the title", input.titleSize]] as const) if (size < input.floor) fail(`${name} at ${size} px are below the ${input.floor} px floor`, "/config", input.floor, size)

  // Title: one line, then wrapped.
  let titleLines: string[] = []
  let titleH = 0
  if (input.title) {
    const lines = wrapText(input.title, availW, PLANNER_LIMITS.titleLines[c], s => m(s, input.titleSize, true))
    if (!lines) fail(`the title needs more than ${PLANNER_LIMITS.titleLines[c]} line(s) at ${availW} px`, "/title/text", m(input.title, input.titleSize, true), availW * PLANNER_LIMITS.titleLines[c])
    titleLines = lines ?? [input.title]
    if (titleLines.length > 1) adjustments.push({ path: "/title/text", reason: `wrapped the title to ${titleLines.length} lines to fit ${availW} px` })
    titleH = titleLines.length * input.titleSize * LINE + 14
  }
  const axisTitleH = (axis?: PlannerAxis) => (axis?.title ? input.axisTitleSize * LINE + 10 : 0)
  const tick = (input.labelPadding ?? 6) + 4

  // Legend: where the theme puts it first, below the plot after that.
  const legend = input.legend
  // A size key is one column, which sits beside the plot, never below it: a chart with one keeps its legends at the side.
  const legendOrient: PlanSignals["charts_legend_orient"] = input.sizeLegend ? (input.legendOrient === "left" ? "left" : "right") : c === 0 ? input.legendOrient : input.legendOrient === "top" ? "top" : "bottom"
  let legendW = 0, legendH = 0, legendColumns = 1
  let colourSideH = 0, colourBottomW = 0
  if (legend) {
    const titleW = legend.title ? m(legend.title, lbl) : 0
    const titleRow = legend.title ? lbl * LINE + 5 : 0
    if (legend.kind === "gradient") {
      const widest = Math.max(0, ...legend.labels.map(label))
      if (legendOrient === "right" || legendOrient === "left") { legendW = Math.max(titleW, 16 + 4 + widest) + 18; legendH = 0 }
      else { legendH = titleRow + 16 + lbl * LINE + 18; legendW = 0 }
    } else {
      const item = 16 + 4 + Math.max(0, ...legend.labels.map(label))
      if (legendOrient === "right" || legendOrient === "left") {
        legendW = Math.max(item, titleW) + 18
        // Every entry is drawn (no "…N entries"), one per row beside the plot.
        const rows = legend.labels.length * (lbl + 6) + titleRow
        colourSideH = rows + 2
        if (rows > availH - titleH) fail(`${legend.labels.length} legend entries need ${Math.ceil(rows)} px of height beside the plot`, "/encoding/color/legend", rows, availH - titleH)
      } else {
        legendColumns = Math.max(1, Math.min(legend.labels.length, Math.floor((availW + 10) / (item + 10))))
        if (item > availW) fail(`a legend entry needs ${Math.ceil(item)} px`, "/encoding/color/legend", item, availW)
        if (titleW > availW) fail(`the legend title needs ${Math.ceil(titleW)} px`, "/encoding/color/legend/title", titleW, availW)
        const rows = Math.ceil(legend.labels.length / legendColumns)
        legendH = rows * (lbl + 6) + titleRow + 18
        colourBottomW = Math.max(titleW, legendColumns * (item + 10))
      }
    }
  }
  const sizeKey = input.sizeLegend
  if (sizeKey) {
    const titleW = sizeKey.title ? m(sizeKey.title, lbl) : 0
    const titleRow = sizeKey.title ? lbl * LINE + 5 : 0
    const labelW = Math.max(0, ...sizeKey.labels.map(label))
    // One column: each entry as tall as its symbol (or its label), 11 px apart (as Vega lays it out).
    const width = Math.max(titleW, Math.max(0, ...sizeKey.symbols) + 4 + labelW)
    const height = titleRow + sizeKey.symbols.reduce((sum, d) => sum + Math.max(lbl, d), 0) + 11 * Math.max(0, sizeKey.symbols.length - 1)
    if (legendOrient === "right" || legendOrient === "left") {
      legendW = Math.max(legendW, width + 18)
      const stacked = colourSideH + (legend ? 8 : 0) + height
      if (stacked > availH - titleH) fail(`the legends need ${Math.ceil(stacked)} px of height beside the plot`, "/encoding/size/legend", stacked, availH - titleH)
    } else {
      const total = width + (legend ? colourBottomW + 16 : 0)
      legendH = Math.max(legendH, height + 18)
      if (total > availW) fail(`the legends need ${Math.ceil(total)} px of width below the plot`, "/encoding/size/legend", total, availW)
    }
  }
  if (legend || sizeKey) {
    if (legendW > availW * PLANNER_LIMITS.legendShare) fail(`the legend needs ${Math.ceil(legendW)} px beside the plot`, "/encoding/color/legend", legendW, availW * PLANNER_LIMITS.legendShare)
    if (legendH > availH * PLANNER_LIMITS.legendShare) fail(legend && legend.kind === "symbol" ? `${legend.labels.length} legend entries need ${Math.ceil(legendH)} px below the plot` : `the legend needs ${Math.ceil(legendH)} px below the plot`, "/encoding/color/legend", legendH, availH * PLANNER_LIMITS.legendShare)
    if (legendOrient !== input.legendOrient) adjustments.push({ path: "/encoding/color/legend/orient", reason: `moved the legend ${legendOrient === "bottom" ? "below" : "above"} the plot${legendColumns > 1 ? ` in ${legendColumns} columns` : ""} to give the plot the width` })
  }

  const xTickStep = input.x?.temporal ? PLANNER_LIMITS.timeTickStep[c] : PLANNER_LIMITS.xTickStep[c]
  const yTickStep = PLANNER_LIMITS.yTickStep[c]
  let xAngle = 0
  let xWrap: { keys: string[]; lines: string[][] } = { keys: [], lines: [] }
  let yWrap: { keys: string[]; lines: string[][] } = { keys: [], lines: [] }
  let plotW: number, plotH: number
  let timeStep = 1

  if (input.radial) {
    plotW = availW - legendW
    plotH = availH - titleH - legendH
    const diameter = Math.min(plotW, plotH)
    if (diameter < 80) fail(`the ${legend ? "legend and title leave" : "title leaves"} a ${Math.floor(diameter)} px circle`, "/mark", 80, diameter)
  } else {
    // y axis width.
    let yW = 0
    const y = input.y
    if (y) {
      if (y.kind === "continuous") yW = Math.max(0, ...y.labels.map(label)) + tick
      else {
        const max = availW * PLANNER_LIMITS.yLabelShare[c]
        const lines = PLANNER_LIMITS.yWrapLines[c]
        let widest = 0, tallest = 1
        for (const text of y.labels) {
          const wrapped = wrapText(text, max, lines, label)
          if (!wrapped) { fail(`the y label ${JSON.stringify(text.slice(0, 40))} needs more than ${lines} line(s) of ${Math.floor(max)} px`, "/encoding/y/axis", label(text), max * lines); widest = Math.max(widest, Math.min(label(text), max)); continue }
          if (wrapped.length > 1) { yWrap.keys.push(text); yWrap.lines.push(wrapped) }
          widest = Math.max(widest, ...wrapped.map(label))
          tallest = Math.max(tallest, wrapped.length)
        }
        yW = widest + tick
        if (yWrap.keys.length) adjustments.push({ path: "/encoding/y/axis/labelExpr", reason: `wrapped ${yWrap.keys.length} long y label(s) to at most ${tallest} lines` })
        ;(yWrap as { tallest?: number }).tallest = tallest
      }
      yW += axisTitleH(y)
    }
    plotW = availW - yW - legendW

    // x axis height, choosing the least aggressive label treatment this candidate allows.
    let xH = 0
    const x = input.x
    if (x) {
      if (x.kind === "continuous") xH = lbl * LINE + tick
      else {
        const n = Math.max(1, x.labels.length)
        const slot = plotW / n
        const widths = x.labels.map(label)
        const longest = Math.max(0, ...widths)
        const options: ("flat" | "wrap" | 45 | 90)[] = c === 0 ? ["flat"] : c === 1 ? ["flat", "wrap", 45] : ["flat", "wrap", 45, 90]
        let chosen: "flat" | "wrap" | 45 | 90 | undefined
        for (const option of options) {
          if (option === "flat" && longest <= slot - 4) { chosen = option; xH = lbl * LINE + tick; break }
          if (option === "wrap") {
            const lines = PLANNER_LIMITS.xWrapLines[c]
            const wrapped = x.labels.map(t => wrapText(t, slot - 4, lines, label))
            if (wrapped.every(Boolean)) {
              chosen = option
              const keys: string[] = [], out: string[][] = []
              wrapped.forEach((w, i) => { if (w!.length > 1) { keys.push(x.labels[i]!); out.push(w!) } })
              xWrap = { keys, lines: out }
              xH = Math.max(1, ...wrapped.map(w => w!.length)) * lbl * LINE + tick
              break
            }
          }
          if (option === 45) {
            // A label turned 45° runs down and to the left of its tick, so the first ones reach past the plot's left
            // edge, and the view must keep that room: the plot is narrower than the axes alone would leave.
            const turned = turnedPlotWidth(plotW + yW, yW, widths, lbl)
            if (lbl * 1.5 <= turned / n) { chosen = option; xAngle = -45; plotW = turned; xH = longest * Math.SQRT1_2 + lbl * Math.SQRT1_2 + tick; break }
          }
          if (option === 90 && lbl * LINE <= slot) { chosen = option; xAngle = -90; xH = longest + tick; break }
        }
        if (!chosen) {
          fail(`${n} x labels need ${Math.ceil(c === 0 ? longest + 4 : lbl * (c === 1 ? 1.5 : LINE))} px each and have ${Math.floor(slot)} px`, "/encoding/x/axis", (c === 0 ? longest + 4 : lbl * (c === 1 ? 1.5 : LINE)) * n, plotW)
          xH = lbl * LINE + tick
        } else if (chosen === "wrap" && xWrap.keys.length) adjustments.push({ path: "/encoding/x/axis/labelExpr", reason: `wrapped ${xWrap.keys.length} x label(s) to fit ${Math.floor(slot)} px per category` })
        else if (chosen === 45 || chosen === 90) adjustments.push({ path: "/encoding/x/axis/labelAngle", reason: `turned the x labels ${chosen}° so ${n} categories fit ${Math.floor(plotW)} px` })
      }
      xH += axisTitleH(x)
    }
    plotH = availH - titleH - xH - legendH
    // Axis titles are drawn whole along their axis.
    if (x?.title && m(x.title, input.axisTitleSize) > plotW) fail(`the x axis title needs ${Math.ceil(m(x.title, input.axisTitleSize))} px`, "/encoding/x/title", m(x.title, input.axisTitleSize), plotW)
    if (y?.title && m(y.title, input.axisTitleSize) > plotH + xH) fail(`the y axis title needs ${Math.ceil(m(y.title, input.axisTitleSize))} px`, "/encoding/y/title", m(y.title, input.axisTitleSize), plotH + xH)
    const yRows = y?.kind === "discrete" ? Math.max(1, y.labels.length) : 0
    const tallest = (yWrap as { tallest?: number }).tallest ?? 1
    if (yRows && plotH / yRows < tallest * lbl * LINE) fail(`${yRows} y categories need ${Math.ceil(tallest * lbl * LINE)} px each and have ${Math.floor(plotH / yRows)} px`, "/encoding/y/axis", yRows * tallest * lbl * LINE, plotH)
    if (plotW < PLANNER_LIMITS.minPlotWidth) fail(`the axes${legendW ? " and legend" : ""} leave a ${Math.floor(plotW)} px wide plot`, "/width", PLANNER_LIMITS.minPlotWidth, plotW)
    if (plotH < PLANNER_LIMITS.minPlotHeight) fail(`the title, axes${legendH ? " and legend" : ""} leave a ${Math.floor(plotH)} px tall plot`, "/height", PLANNER_LIMITS.minPlotHeight, plotH)
    // A calendar time axis: the fewest units per tick that keep every label clear of its neighbours.
    const time = input.x?.time
    if (time) {
      const gap = Math.max(4, lbl * LABEL_GAP)
      const widest = Math.max(0, ...time.labels.map(label))
      const steps = TIME_STEPS[time.unit]
      const fits = (step: number) => time.intervals === 0 || (plotW * step) / time.intervals >= widest + gap
      const step = steps.find(fits)
      if (step === undefined) fail(`${time.unit} labels need ${Math.ceil(widest + gap)} px apart and have ${Math.floor((plotW * steps[steps.length - 1]!) / Math.max(1, time.intervals))} px at one label every ${steps[steps.length - 1]} ${time.unit}s`, "/encoding/x/axis", widest + gap, (plotW * steps[steps.length - 1]!) / Math.max(1, time.intervals))
      timeStep = step ?? steps[steps.length - 1]!
      if (timeStep > 1) adjustments.push({ path: "/encoding/x/axis/tickCount", reason: `one label every ${timeStep} ${time.unit}s, so the labels keep apart` })
    } else if (c > 0 && input.x?.kind === "continuous") adjustments.push({ path: "/encoding/x/axis/tickCount", reason: `one tick per ${xTickStep} px` })
    if (c > 0 && input.y?.kind === "continuous") adjustments.push({ path: "/encoding/y/axis/tickCount", reason: `one tick per ${yTickStep} px` })
  }

  return {
    candidate: c,
    name: NAMES[c],
    feasible: conflicts.length === 0,
    conflicts,
    adjustments,
    plot: { width: Math.floor(plotW), height: Math.floor(plotH) },
    measures: used(),
    signals: {
      charts_title: titleLines,
      charts_x_angle: xAngle,
      charts_x_keys: xWrap.keys,
      charts_x_lines: xWrap.lines,
      charts_y_keys: yWrap.keys,
      charts_y_lines: yWrap.lines,
      charts_legend_orient: legendOrient,
      charts_legend_columns: legendColumns,
      charts_x_tick_step: xTickStep,
      charts_x_time_step: timeStep,
      charts_y_tick_step: yTickStep,
    },
  }
}
