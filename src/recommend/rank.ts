import { CATALOGUE } from "../catalogue.js"
import { loadData, type Row } from "../data.js"
import type { Json } from "../engines/common.js"
import { ChartsError } from "../errors.js"
import type { Environment } from "../pipeline.js"
import { buildDraft, exampleDraft } from "./draft.js"
import { rolesOf, shapeOf } from "./shape.js"
import { MEDIUM_BUDGET, SCORING, TASK_WORDS, TRAITS_BY_ID, type Medium, type Shape, type Task } from "./traits.js"

/**
 * Which chart fits a question, its data and the medium — deterministically, locally, with no model.
 *
 * The ranking follows MCP Clearsight's design: hard filters for what the data cannot support and what disqualifies a
 * type, then three weighted dimensions (`intent`, `data_fit`, `expressiveness`) with the weights held as data, then a
 * total order so shuffled input gives identical output, then confidence bands, a near-tie note, and an abstention
 * rather than a wrong answer.
 *
 * Adapted from the design of MCP Clearsight (`cesar-alves/mcp-clearsight@4912ede`), MIT OR Apache-2.0,
 * © 2026 The MCP Clearsight contributors: `features.md` §4.9 and ADR 0016. The scoring weights and thresholds are
 * theirs; the catalogue, the traits and this implementation are ours.
 */

export interface RecommendInput {
  readonly request: string
  readonly data?: { readonly rows?: readonly Row[]; readonly path?: string; readonly format?: "csv" | "tsv" | "json" | "jsonl" | "parquet"; readonly transform?: readonly Record<string, unknown>[]; readonly name?: string }
  readonly medium?: Medium
  readonly limit?: number
  readonly detail?: "standard" | "compact"
  readonly engine?: "vega-lite" | "vega" | "echarts"
}

export interface Suggestion {
  readonly rank: number
  readonly id: string
  readonly name: string
  readonly family: string
  readonly engine: string
  readonly score: number
  readonly confidence: "low" | "medium" | "high"
  readonly why: readonly string[]
  readonly encoding: Readonly<Record<string, string>>
  readonly call?: Json
  readonly blocked_by?: string
  readonly warnings?: readonly string[]
}

export interface RecommendResult {
  readonly request: { readonly text: string; readonly tasks: readonly { readonly task: Task; readonly evidence: readonly string[] }[]; readonly unmatched: readonly string[]; readonly ambiguous: readonly string[] }
  readonly medium: Medium
  readonly mediumAssumed: boolean
  readonly profile?: { readonly rows: number; readonly columns: readonly { readonly name: string; readonly type: string; readonly distinct: number; readonly nullShare: number }[]; readonly shape: readonly string[] }
  readonly recommendations: readonly Suggestion[]
  readonly considered: number
  readonly abstain?: { readonly reason: "no_matching_task" | "data_unsupported" | "all_blocked" | "low_confidence"; readonly suggestion: string }
  readonly nearTie?: { readonly a: string; readonly b: string; readonly gap: number }
  readonly scoringVersion: string
}

const AMBIGUOUS = ["graph", "chart", "plot", "diagram", "visualize", "show", "display", "compare"]
const STOP = new Set(["the", "a", "an", "of", "by", "for", "and", "or", "to", "in", "on", "with", "per", "how", "what", "which", "is", "are", "was", "were", "do", "does", "we", "our", "my", "me", "it", "its", "that", "this", "over", "from", "as", "at", "each", "all", "vs", "versus", "between", "please", "can", "you", "give", "make", "draw", "chart"])

const round = (n: number) => Number(n.toFixed(SCORING.scoreDecimals))

/**
 * A stem, so "distributed" matches "distribution" and "trending" matches "trend". English only, deliberately: the
 * lexicon is English and says so; a stemmer that guessed at other languages would be worse than not trying.
 */
const stem = (word: string) => word.toLowerCase().replace(/(ations|ation|ing|ed|es|s|ly)$/u, "").slice(0, 7)
const clamp01 = (n: number) => Math.max(0, Math.min(1, n))

/** The words of a request, lowercased, with stop words removed. */
function words(text: string): string[] {
  return text.toLowerCase().split(/[^a-z0-9_%€$£¥+.-]+/).filter(w => w.length > 1 && !STOP.has(w))
}

/** Which tasks the request names, and why. */
export function inferTasks(request: string, known: readonly string[] = []): { tasks: { task: Task; evidence: string[] }[]; unmatched: string[]; ambiguous: string[] } {
  const text = request.toLowerCase()
  const tokens = words(request)
  const tasks: { task: Task; evidence: string[] }[] = []
  for (const [task, vocabulary] of Object.entries(TASK_WORDS) as [Task, readonly string[]][]) {
    const evidence = vocabulary.filter(word => (word.includes(" ") ? text.includes(word) : tokens.some(t => stem(t) === stem(word) && stem(word).length >= 4)))
    if (evidence.length) tasks.push({ task, evidence: evidence.slice(0, 3) })
  }
  const ambiguous = AMBIGUOUS.filter(word => tokens.includes(word))
  // A word is understood when a task word covers it or it names a column in the data, so "trending by channel" leaves
  // nothing over when the data has a channel column.
  const columns = new Set(known.map(name => name.toLowerCase()))
  const vocabulary = Object.values(TASK_WORDS).flat()
  const understood = (token: string) =>
    columns.has(token) ||
    vocabulary.some(word => word.includes(" ") ? text.includes(word) && word.split(" ").includes(token) : stem(token) === stem(word) && stem(word).length >= 4)
  const unmatched = tokens.filter(t => !understood(t) && !/^\d+$/.test(t) && t.length >= 4).slice(0, 8)
  return { tasks, unmatched, ambiguous }
}

/** Which catalogue entries the request names outright. */
function namedEntries(request: string): { id: string; word: string }[] {
  const text = request.toLowerCase()
  const found: { id: string; word: string }[] = []
  for (const [id, trait] of TRAITS_BY_ID) {
    for (const alias of trait.aliases ?? []) {
      if (alias.includes(" ") ? text.includes(alias) : words(request).includes(alias)) found.push({ id, word: alias })
    }
  }
  // A phrase wins over a word: "stacked area" is not merely "area".
  found.sort((a, b) => b.word.length - a.word.length)
  const seen = new Set<string>()
  return found.filter(({ id }) => (seen.has(id) ? false : (seen.add(id), true))).slice(0, 4)
}

const ROLE_LABEL: Readonly<Record<string, string>> = {
  measure: "a measure to plot",
  measure2: "a second measure",
  dimension: "a category",
  temporal: "a date",
  series: "a series (2–12 groups)",
  part: "the parts of a whole (2–8 groups)",
  size: "a size measure",
  key: "a node key",
  parent: "a parent column",
  source: "the source of an edge",
  target: "the target of an edge",
  location: "a country or state column",
  open: "open values",
  close: "close values",
}

/** How well a chart sits inside the medium's budget: 1 inside, 0 at twice the budget, never a hard cut. */
function densityFit(shape: Shape | undefined, budget: { series?: number; categories?: number } | undefined, medium: Medium): { fit: number; over: string[] } {
  if (!shape || !budget) return { fit: 1, over: [] }
  const limits = MEDIUM_BUDGET[medium]
  const over: string[] = []
  let fit = 1
  const check = (measured: number | undefined, allowed: number | undefined, label: string) => {
    if (measured === undefined) return
    const budgetValue = Math.min(allowed ?? Number.POSITIVE_INFINITY, label === "series" ? limits.series : limits.categories)
    if (measured <= budgetValue) return
    const ratio = measured / Math.max(1, budgetValue)
    fit = Math.min(fit, clamp01(1 - (ratio - SCORING.density.rampStart) / (SCORING.density.rampEnd - SCORING.density.rampStart)))
    if (ratio > 1.25) over.push(`${measured} ${label} against ${budgetValue} for ${medium}`)
  }
  check(shape.series?.distinct, budget.series, "series")
  check(shape.categories?.distinct ?? shape.part?.distinct, budget.categories, "categories")
  return { fit, over }
}

/** The columns to use, role by role, preferring a name the request mentions. */
function encodingFor(id: string, shape: Shape | undefined, request: string): Record<string, string> {
  if (!shape) return {}
  const mentioned = new Set(words(request))
  const prefer = (candidates: readonly string[]) => [...candidates].sort((a, b) => Number(mentioned.has(b.toLowerCase())) - Number(mentioned.has(a.toLowerCase())) || a.localeCompare(b))[0]
  const encoding: Record<string, string> = {}
  const needs: Readonly<Record<string, readonly string[]>> = {
    measure: [prefer(shape.measures) ?? ""],
    measure2: [prefer(shape.measures.slice(1)) ?? ""],
    dimension: [shape.categories?.name ?? shape.part?.name ?? shape.dimensions[0] ?? ""],
    temporal: [prefer(shape.temporals) ?? ""],
    series: [shape.series?.name ?? ""],
    part: [shape.part?.name ?? ""],
    size: [shape.measures.slice(2)[0] ?? shape.measures[1] ?? ""],
    key: [shape.hierarchy?.key ?? ""],
    parent: [shape.hierarchy?.parent ?? ""],
    source: [shape.edges?.source ?? ""],
    target: [shape.edges?.target ?? ""],
    location: [shape.location?.name ?? ""],
  }
  const trait = TRAITS_BY_ID.get(id)
  for (const role of trait?.need ?? []) {
    const column = needs[role]?.[0]
    if (column) encoding[role] = column
  }
  if (shape.temporals.length && !encoding.temporal && ["line", "area", "stacked_area", "step_line", "bump", "calendar_heatmap", "multi_line", "streamgraph", "line_band", "slope"].includes(id)) encoding.temporal = shape.temporals[0]!
  if (shape.measures.length === 2 && !encoding.measure2 && ["scatter", "regression", "bubble", "correlation_matrix", "binned_heatmap", "connected_scatter", "parallel", "interactive_brush", "dual_axis"].includes(id)) encoding.measure2 = shape.measures[1]!
  return Object.fromEntries(Object.entries(encoding).filter(([, v]) => v))
}

/** A ready `charts_render` call: on the caller's columns when a builder covers the type, else the catalogue's example. */
function draftFor(id: string, shape: Shape | undefined, rows: readonly Row[] | undefined, encoding: Record<string, string>): { call?: Json; warnings: string[] } {
  if (!shape || !rows) return { call: undefined, warnings: [] }
  const built = buildDraft(id, shape, rows, encoding)
  if (built) return { call: built.call, warnings: [...built.warnings] }
  return { call: exampleDraft(id).call, warnings: [...exampleDraft(id).warnings] }
}

const confidenceOf = (score: number) => (score >= SCORING.confidence.highMin ? "high" : score >= SCORING.confidence.mediumMin ? "medium" : "low") as Suggestion["confidence"]

export interface RecommendOutcome {
  readonly result: RecommendResult
  readonly text: string
}

export async function recommend(input: RecommendInput, env: Pick<Environment, "workspace">): Promise<RecommendOutcome> {
  const medium: Medium = input.medium ?? "report"
  const mediumAssumed = input.medium === undefined
  const limit = Math.max(1, Math.min(10, input.limit ?? 3))

  let rows: Row[] | undefined
  let shape: Shape | undefined
  if (input.data && (input.data.rows || input.data.path)) {
    const loaded = await loadData(env.workspace, input.data)
    rows = loaded.rows
    if (rows.length === 0) throw new ChartsError("DATA_EMPTY", "The data has no rows.", "Pass rows, or a file with a header and at least one row.")
    shape = shapeOf(rows)
  }
  const inferred = inferTasks(input.request, shape?.columns.map(c => c.name) ?? [])
  const named = namedEntries(input.request)
  const roles = shape ? rolesOf(shape) : undefined
  const taskSet = new Set(inferred.tasks.map(t => t.task))
  // The task the request says most about leads; another matched task is a real but weaker intent.
  const leading = inferred.tasks.length ? [...inferred.tasks].sort((a, b) => b.evidence.length - a.evidence.length || a.task.localeCompare(b.task))[0]!.task : undefined
  const namedIds = new Set(named.map(n => n.id))
  const tasksKnown = taskSet.size > 0 || namedIds.size > 0

  interface Scored { suggestion: Suggestion; total: number }
  const scored: Scored[] = []
  const blocked: Scored[] = []

  for (const entry of CATALOGUE) {
    const trait = TRAITS_BY_ID.get(entry.id)!
    if (input.engine && entry.engine !== input.engine) continue
    // 1. Hard filters: what the data cannot support, and what disqualifies the type.
    const missing = shape ? trait.need.filter(role => !roles!.has(role)) : []
    const anti = shape ? trait.anti?.(shape) : undefined
    // Once a task is known, a chart that does not serve it is not a recommendation, however well it would draw.
    const offTask = tasksKnown && (taskSet.has(trait.tasks[0]!) || (trait.tasks[1] !== undefined && taskSet.has(trait.tasks[1])) || namedIds.has(entry.id)) ? undefined : tasksKnown ? "does not serve this question" : undefined
    const blockedBy = missing.length ? `needs ${missing.map(r => ROLE_LABEL[r] ?? r).join(", ")}, which the data lacks` : anti
    const blockedReason = blockedBy ?? offTask

    // 2. intent.
    const taskHits = trait.tasks.filter((t): t is Task => t !== undefined && taskSet.has(t))
    const aliasHit = namedIds.has(entry.id)
    const intent = aliasHit ? 1 : taskHits.length ? (taskHits[0] === trait.tasks[0] ? (trait.tasks[0] === leading ? 1 : 0.78) : 0.55) : 0

    // 3. data fit: what it needs, what helps, and how it sits against the medium's budget.
    const density = densityFit(shape, trait.budget, medium)
    const satisfied = shape ? (trait.need.length === 0 ? 1 : (trait.need.length - missing.length) / trait.need.length) : 0.5
    // Full marks when there is nothing further to want; otherwise the share of what it wants that is present.
    const wanted = !trait.want?.length ? 1 : shape ? trait.want.filter(r => roles!.has(r)).length / trait.want.length : 1
    const fit = clamp01(satisfied * 0.75 + wanted * 0.25)
    // What this type would encode, which decides whether it silently drops a series the data has.
    const encoding = encodingFor(entry.id, shape, input.request)
    const plotted = new Set(Object.values(encoding))
    // A chart that would drop a series the data has is the wrong chart, not merely a plainer one.
    const tokens = words(input.request)
    const meansSeries = shape?.series ? tokens.includes(shape.series.name.toLowerCase()) || /\b(by|each|per|split by|broken down by)\b/.test(input.request.toLowerCase()) : false
    const drops = shape && trait.dropsSeries && shape.series && meansSeries && !plotted.has(shape.series.name) ? 0.75 : 1
    const dataFit = shape ? clamp01(fit * drops) * density.fit : 0.5

    // 4. expressiveness: how well the type reads, curated.
    const expressiveness = trait.reads ?? 0.7

    const total = round(SCORING.weights.intent * intent + SCORING.weights.dataFit * dataFit + SCORING.weights.expressiveness * expressiveness)
    const why: string[] = []
    if (aliasHit) why.push(`You named it: "${named.find(n => n.id === entry.id)!.word}".`)
    for (const task of taskHits.slice(0, 2)) why.push(`It is the ${task === trait.tasks[0] ? "" : "secondary "}answer for ${task.replaceAll("_", " ")}.`)
    if (shape && trait.need.length) why.push(`The data supplies ${trait.need.map(r => ROLE_LABEL[r] ?? r).join(", ")}.`)
    if (density.over.length) why.push(`Dense for ${medium}: ${density.over.join("; ")}.`)
    if (drops < 1) why.push(`One line or bar: it would drop ${shape!.series!.name}.`)
    if (shape && entry.engine === "vega-lite" && shape.rows > 5000 && ["scatter", "line", "multi_line"].includes(entry.id)) why.push(`${shape.rows} points: the renderer draws them all, so consider a sample or a bin.`)
    if (!why.length && blockedReason) why.push(`Not a fit: it ${blockedReason}.`)
    if (!why.length) why.push(`${entry.when}`)

    const draft = blockedReason || intent === 0 ? { warnings: [] } : draftFor(entry.id, shape, rows, encoding)
    const suggestion: Suggestion = {
      rank: 0, id: entry.id, name: entry.name, family: entry.family, engine: entry.engine,
      score: total, confidence: confidenceOf(total), why: why.slice(0, 3), encoding,
      ...(draft.call && !blockedReason ? { call: draft.call } : {}),
      ...(blockedReason ? { blocked_by: blockedReason } : {}),
      ...(draft.warnings.length && !blockedReason ? { warnings: draft.warnings } : {}),
    }
    ;(blockedReason ? blocked : scored).push({ suggestion, total })
  }

  // 5. A total order: score descending, then id, so shuffled input gives identical output.
  const order = (a: Scored, b: Scored) => b.total - a.total || a.suggestion.id.localeCompare(b.suggestion.id)
  scored.sort(order)
  blocked.sort(order)

  const tasksFound = inferred.tasks.length > 0 || named.length > 0
  const top = scored.filter(s => s.total >= SCORING.confidence.mediumMin)
  const abstain: RecommendResult["abstain"] = !tasksFound
    ? { reason: "no_matching_task", suggestion: "Name what the figure is for (\"how revenue trends by channel\", \"which regions grew fastest\") and call again." }
    : shape && shape.measures.length === 0 && shape.temporals.length === 0
      ? { reason: "data_unsupported", suggestion: "The data has no measure and no date, so it can only be counted or shown as text: add a numeric column, or chart the counts." }
      : top.length === 0
        ? { reason: scored.length ? "low_confidence" : "all_blocked", suggestion: "Call charts_capabilities to see what this build draws, or ask for a simpler chart." }
        : undefined
  const nearTie = top.length >= 2 && top[0]!.total - top[1]!.total <= SCORING.confidence.nearTieMargin
    ? { a: top[0]!.suggestion.id, b: top[1]!.suggestion.id, gap: round(top[0]!.total - top[1]!.total) }
    : undefined
  // An abstention is a shortlist of none, never a shortlist plus a disclaimer. Only a chart that renders and serves
  // the question is recommended: an entry this build cannot draw, or one that does not serve the task, is left out
  // rather than listed with a caveat (`considered` says how many were weighed).
  const recommendations = abstain ? [] : top.slice(0, limit).map((s, i) => ({ ...s.suggestion, rank: i + 1 }))
  const result: RecommendResult = {
    request: { text: input.request, tasks: inferred.tasks, unmatched: inferred.unmatched, ambiguous: inferred.ambiguous },
    medium,
    mediumAssumed,
    ...(shape ? {
      profile: {
        rows: shape.rows,
        columns: shape.columns.slice(0, 40).map(c => ({ name: c.name, type: c.type, distinct: c.distinct, nullShare: round(c.missing / Math.max(1, shape!.rows)) })),
        shape: [
          ...(shape.measures.length ? [`${shape.measures.length} measure(s): ${shape.measures.slice(0, 6).join(", ")}`] : []),
          ...(shape.temporals.length ? [`date: ${shape.temporals.join(", ")}`] : []),
          ...(shape.series ? [`series: ${shape.series.name} (${shape.series.distinct})`] : []),
          ...(shape.categories ? [`categories: ${shape.categories.name} (${shape.categories.distinct})`] : []),
          ...(shape.edges ? [`edges: ${shape.edges.source} → ${shape.edges.target}`] : []),
          ...(shape.hierarchy ? [`hierarchy: ${shape.hierarchy.key} under ${shape.hierarchy.parent}`] : []),
          ...(shape.location ? [`location: ${shape.location.name} (${shape.location.kind})`] : []),
        ],
      },
    } : {}),
    recommendations,
    considered: scored.length + blocked.length,
    ...(abstain ? { abstain } : {}),
    ...(nearTie && !abstain ? { nearTie } : {}),
    scoringVersion: SCORING.version,
  }
  return { result, text: describe(result, input.detail === "compact") }
}

/** The model-facing text: the shortlist, one reason each, and the call that draws it. */
export function describe(r: RecommendResult, compact = false): string {
  const head = [`Which chart for: "${r.request.text}"`, `Tasks: ${r.request.tasks.length ? r.request.tasks.map(t => `${t.task} (${t.evidence.join(", ")})`).join("; ") : "none recognised"}. Medium: ${r.medium}${r.mediumAssumed ? " (assumed)" : ""}.`]
  if (r.abstain) return [...head, `No recommendation: ${r.abstain.reason.replaceAll("_", " ")}. ${r.abstain.suggestion}`].join("\n")
  const lines = r.recommendations.map(s => {
    const status = s.blocked_by ? ` — not in this build: ${s.blocked_by}` : ` [${s.confidence}]`
    return `${s.rank}. ${s.name} (${s.id}, ${s.engine})${status}\n   ${s.why.join(" ")}${s.call ? `\n   Draw it: ${JSON.stringify(s.call)}` : ""}`
  })
  const tail = [
    ...(compact || !r.profile ? [] : [`Data: ${r.profile.rows} rows. ${r.profile.shape.join("; ")}.`]),
    ...(r.nearTie ? [`Close call: ${r.nearTie.a} and ${r.nearTie.b} are ${r.nearTie.gap} apart; pick by what the reader must do.`] : []),
    ...(r.request.unmatched.length ? [`Not understood: ${r.request.unmatched.join(", ")}.`] : []),
  ]
  return [...head, ...lines, ...tail].join("\n")
}
