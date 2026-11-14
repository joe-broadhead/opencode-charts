import * as z from "zod"
import { ChartsError, formatIssues, pointer, type ChartsCode, type Issue } from "../errors.js"

/**
 * The strict schema of a board document, version 1: a title, one or more datasets, filters, KPI cards, optional tabs
 * and the chart or table panels laid out on a 12-column grid. Every object is strict, so a misspelt property fails with
 * its JSON path instead of being dropped, and the defaults the renderer relies on (a 1200 px board, 12 columns, a
 * 6-column panel 300 px high) are filled in here, once.
 *
 * A board is a *document*, not a call: `parseBoardDocument` returns the same value for the same JSON, and everything
 * downstream (the cube, the poster, the page) reads the parsed document rather than the input.
 */

const BOARD_VERSION = 1
const BOARD_KIND = "board"
/** Grid columns a panel spans by default: half the board. */
const BOARD_DEFAULT_SPAN = 6
/** A panel's default height in pixels, header included. */
const BOARD_DEFAULT_PANEL_HEIGHT = 300
/** The default board width in pixels. */
const BOARD_DEFAULT_WIDTH = 1200
/** The default number of grid columns. */
const BOARD_DEFAULT_COLUMNS = 12

const BOARD_CONTROLS = ["segmented", "select", "chips", "range", "search"] as const
const BOARD_AGGREGATES = ["sum", "mean", "median", "min", "max", "count"] as const
const BOARD_FORMATS = ["currency", "percent", "compact", "number", "integer"] as const
const BOARD_ENGINES = ["vega-lite", "vega", "echarts"] as const
const BOARD_QUICK_TYPES = ["bar", "line", "area", "point", "scatter", "arc", "pie", "donut", "heatmap", "rect", "tick"] as const
const BOARD_DATA_FORMATS = ["csv", "tsv", "json", "jsonl", "parquet"] as const

type BoardControl = (typeof BOARD_CONTROLS)[number]
export type BoardAggregate = (typeof BOARD_AGGREGATES)[number]
type BoardFormat = (typeof BOARD_FORMATS)[number]
type BoardEngine = (typeof BOARD_ENGINES)[number]
type BoardQuickType = (typeof BOARD_QUICK_TYPES)[number]
type BoardDataFormat = (typeof BOARD_DATA_FORMATS)[number]

const RowSchema = z.record(z.string(), z.unknown())
const TransformStep = z.record(z.string(), z.unknown())

/** `value` is compared as a string everywhere (options are facets of data), so a number is accepted and kept as text. */
const OptionValue = z.union([z.string(), z.number(), z.boolean()]).transform(value => String(value))

const BoardOptionSchema = z.strictObject({
  value: OptionValue,
  label: z.string().min(1).max(200),
})

const BoardDatasetSchema = z.strictObject({
  /** Inline rows: an array of flat objects. */
  rows: z.array(RowSchema).max(100_000).optional(),
  /** A workspace file: .csv, .tsv, .json, .jsonl or .parquet. */
  path: z.string().min(1).max(1024).optional(),
  format: z.enum(BOARD_DATA_FORMATS).optional(),
  /** Vega-Lite transforms applied once, when the dataset is read. */
  transform: z.array(TransformStep).max(50).optional(),
}).refine(value => (value.rows === undefined) !== (value.path === undefined), {
  message: "Give rows or path, not both and not neither.",
})

const BoardFilterSchema = z.strictObject({
  id: z.string().min(1).max(64).regex(/^[A-Za-z0-9][A-Za-z0-9_-]*$/, "an id is letters, digits, dashes and underscores"),
  label: z.string().min(1).max(80),
  /** The dataset the filter narrows; without one it narrows every dataset that has the field. */
  dataset: z.string().min(1).max(64).optional(),
  /** The column it reads. `"*"` on a search filter matches any text column. */
  field: z.string().min(1).max(200),
  control: z.enum(BOARD_CONTROLS),
  /** The choices, in order. Without them the distinct values of the column are used, sorted. */
  options: z.array(BoardOptionSchema).min(1).max(200).optional(),
  defaultValue: z.unknown().optional(),
})

const BoardDeltaSchema = z.strictObject({
  value: z.number().finite(),
  label: z.string().min(1).max(60).optional(),
  /** Whether an increase is good (default true): it decides the badge's colour, never its sign. */
  positiveIsGood: z.boolean().optional(),
})

const BoardSparklineSchema = z.strictObject({
  x: z.string().min(1).max(200),
  y: z.string().min(1).max(200),
  aggregate: z.enum(["sum", "mean"]).optional(),
})

const BoardKpiSchema = z.strictObject({
  id: z.string().min(1).max(64).regex(/^[A-Za-z0-9][A-Za-z0-9_-]*$/, "an id is letters, digits, dashes and underscores"),
  label: z.string().min(1).max(80),
  dataset: z.string().min(1).max(64),
  /** The column the aggregate reads. Omitted (or "*") with `count` counts rows. */
  field: z.string().min(1).max(200).optional(),
  aggregate: z.enum(BOARD_AGGREGATES),
  format: z.enum(BOARD_FORMATS).optional(),
  decimals: z.number().int().min(0).max(6).optional(),
  prefix: z.string().max(20).optional(),
  suffix: z.string().max(20).optional(),
  delta: BoardDeltaSchema.optional(),
  sparkline: BoardSparklineSchema.optional(),
})

const BoardTabSchema = z.strictObject({
  id: z.string().min(1).max(64).regex(/^[A-Za-z0-9][A-Za-z0-9_-]*$/, "an id is letters, digits, dashes and underscores"),
  label: z.string().min(1).max(60),
})

const BoardQuickSchema = z.strictObject({
  type: z.enum(BOARD_QUICK_TYPES),
  x: z.string().min(1).max(200).optional(),
  y: z.string().min(1).max(200).optional(),
  color: z.string().min(1).max(200).optional(),
  size: z.string().min(1).max(200).optional(),
  aggregate: z.enum(BOARD_AGGREGATES).optional(),
  /** Sort a nominal x by the aggregated y, largest first. */
  sort: z.boolean().optional(),
})

const BoardChartSchema = z.strictObject({
  kind: z.literal("chart").optional(),
  engine: z.enum(BOARD_ENGINES).optional(),
  /** A Vega-Lite spec, a Vega spec or an ECharts option. */
  spec: z.record(z.string(), z.unknown()).optional(),
  /** A short chart description the renderer expands into a spec. */
  quick: BoardQuickSchema.optional(),
}).refine(value => value.spec !== undefined || value.quick !== undefined, {
  message: "Give chart.spec or chart.quick.",
})

const BoardTableColumnSchema = z.strictObject({
  field: z.string().min(1).max(200),
  label: z.string().min(1).max(80).optional(),
  /** A board format name, or a d3-format specifier such as ",.1f". */
  format: z.string().min(1).max(40).optional(),
  align: z.enum(["left", "right"]).optional(),
})

const BoardTableSchema = z.strictObject({
  kind: z.literal("table"),
  columns: z.array(BoardTableColumnSchema).min(1).max(24).optional(),
  limit: z.number().int().min(1).max(5000).optional(),
})

const BoardPanelSchema = z.strictObject({
  id: z.string().min(1).max(64).regex(/^[A-Za-z0-9][A-Za-z0-9_-]*$/, "an id is letters, digits, dashes and underscores"),
  title: z.string().min(1).max(120),
  subtitle: z.string().min(1).max(200).optional(),
  dataset: z.string().min(1).max(64),
  tab: z.string().min(1).max(64).optional(),
  /** Grid columns the panel takes, 1 to the board's column count. */
  span: z.number().int().min(1).max(24).default(BOARD_DEFAULT_SPAN),
  height: z.number().int().min(120).max(2000).default(BOARD_DEFAULT_PANEL_HEIGHT),
  chart: z.union([BoardChartSchema, BoardTableSchema]),
})

export const BoardDocumentSchema = z.strictObject({
  version: z.literal(BOARD_VERSION),
  kind: z.literal(BOARD_KIND).default(BOARD_KIND),
  title: z.string().min(1).max(200),
  subtitle: z.string().min(1).max(400).optional(),
  /** A short line above the title, such as the reporting period. */
  kicker: z.string().min(1).max(120).optional(),
  /** Where the data came from, shown in the footer. */
  source: z.string().min(1).max(300).optional(),
  /** A named theme, or a theme object: tokens, a seed, light and dark variants. */
  theme: z.union([z.string().min(1).max(80), z.record(z.string(), z.unknown())]).optional(),
  locale: z.string().min(1).max(40).optional(),
  currency: z.string().min(1).max(8).optional(),
  width: z.number().int().min(320).max(4000).default(BOARD_DEFAULT_WIDTH),
  columns: z.number().int().min(1).max(24).default(BOARD_DEFAULT_COLUMNS),
  datasets: z.record(z.string().min(1).max(64), BoardDatasetSchema),
  filters: z.array(BoardFilterSchema).max(30).optional(),
  kpis: z.array(BoardKpiSchema).max(12).optional(),
  tabs: z.array(BoardTabSchema).min(1).max(12).optional(),
  panels: z.array(BoardPanelSchema).min(1).max(40),
})

export type BoardOption = z.infer<typeof BoardOptionSchema>
type BoardDataset = z.infer<typeof BoardDatasetSchema>
export type BoardFilter = z.infer<typeof BoardFilterSchema>
export type BoardKpi = z.infer<typeof BoardKpiSchema>
type BoardTab = z.infer<typeof BoardTabSchema>
type BoardQuick = z.infer<typeof BoardQuickSchema>
type BoardChart = z.infer<typeof BoardChartSchema>
export type BoardTable = z.infer<typeof BoardTableSchema>
type BoardTableColumn = z.infer<typeof BoardTableColumnSchema>
export type BoardPanel = z.infer<typeof BoardPanelSchema>
export type BoardDocument = z.infer<typeof BoardDocumentSchema>

/**
 * A board document that cannot be used, with every problem found: each issue carries its JSON path into the document
 * and one fix. The error's own code is DOCUMENT_INVALID (shape) or DOCUMENT_VERSION_UNSUPPORTED (a version this build
 * does not read), so a caller can tell "fix the document" from "upgrade the plugin".
 */
export class BoardInvalid extends ChartsError {
  readonly issues: readonly Issue[]
  constructor(issues: readonly Issue[]) {
    const errors = issues.filter(issue => issue.level === "error")
    const shown = errors.length ? errors : issues
    const first = shown[0]!
    const code: ChartsCode = first.code
    const detail = shown.length === 1
      ? first.message
      : `The board has ${shown.length} problems:\n${formatIssues(shown)}\n`
    super(code, detail, shown.length === 1 ? first.fix ?? "Fix it and call the tool again." : "Fix the listed problems and call the tool again.", shown.length === 1 ? first.path : undefined)
    this.issues = issues
    this.name = "BoardInvalid"
  }
}

/** A zod issue's path as a JSON pointer: `/panels/0/chart/spec`. */
const issuePath = (path: readonly PropertyKey[]): string => pointer(path.map(part => (typeof part === "symbol" ? String(part) : part)))

const issueMessage = (issue: z.core.$ZodIssue): string => {
  if (issue.code === "unrecognized_keys" && "keys" in issue) {
    const keys = (issue as { keys: string[] }).keys
    return `"${keys.join('", "')}" ${keys.length === 1 ? "is not a property here" : "are not properties here"}.`
  }
  if (issue.code === "invalid_type") return `Expected ${issue.expected}, received ${issue.input === undefined ? "nothing" : typeof issue.input}.`
  return issue.message
}

/** Every problem in a board document, by JSON path; empty when it parses. */
export function boardDocumentIssues(input: unknown): Issue[] {
  const parsed = BoardDocumentSchema.safeParse(input)
  if (parsed.success) return []
  // A strict object reports every unknown key at once, at its own path; one issue per key names each of them.
  const issues: Issue[] = parsed.error.issues.flatMap((issue): Issue[] => {
    if (issue.code === "unrecognized_keys" && "keys" in issue) {
      return (issue as { keys: string[] }).keys.map(key => ({
        level: "error" as const,
        code: "UNKNOWN_PROPERTY" as const,
        message: `"${key}" is not a property of a board document${issue.path.length ? ` at ${issuePath(issue.path)}` : ""}.`,
        path: issuePath([...issue.path, key]),
      }))
    }
    return [{
      level: "error" as const,
      code: "DOCUMENT_INVALID" as const,
      message: issueMessage(issue),
      path: issuePath(issue.path),
    }]
  })
  // A version this build does not read is its own code: the document is well formed, the plugin is old.
  if (typeof input === "object" && input !== null && !Array.isArray(input)) {
    const version = (input as { version?: unknown }).version
    if (version !== undefined && version !== BOARD_VERSION) {
      return [{ level: "error", code: "DOCUMENT_VERSION_UNSUPPORTED", message: `Board documents are version ${BOARD_VERSION}; this one is ${JSON.stringify(version)}.`, path: "/version", fix: `Set version to ${BOARD_VERSION}.` }]
    }
  }
  return issues
}

/**
 * Parses and validates a board document. Beyond the schema, the cross-references are checked too: every dataset a
 * filter, KPI or panel names exists, every tab a panel names exists, ids are unique where they are used as keys, and
 * a panel's span fits the board. All problems are reported together.
 */
export function parseBoardDocument(input: unknown): BoardDocument {
  if (typeof input !== "object" || input === null || Array.isArray(input)) throw new ChartsError("DOCUMENT_INVALID", "A board is a JSON object.", "Pass {version: 1, title, datasets, panels}.", "/")
  const issues = boardDocumentIssues(input)
  if (issues.length) throw new BoardInvalid(issues)
  const document = BoardDocumentSchema.parse(input)
  const references: Issue[] = []
  const datasets = new Set(Object.keys(document.datasets))
  const tabs = new Set((document.tabs ?? []).map(tab => tab.id))
  const unique = (kind: string, ids: readonly string[], base: string) => {
    const seen = new Set<string>()
    ids.forEach((id, i) => {
      if (seen.has(id)) references.push({ level: "error", code: "DOCUMENT_INVALID", message: `The ${kind} id "${id}" is used twice.`, path: `${base}/${i}/id`, fix: "Give every entry its own id." })
      seen.add(id)
    })
  }
  unique("filter", (document.filters ?? []).map(filter => filter.id), "/filters")
  unique("KPI", (document.kpis ?? []).map(kpi => kpi.id), "/kpis")
  unique("tab", (document.tabs ?? []).map(tab => tab.id), "/tabs")
  unique("panel", document.panels.map(panel => panel.id), "/panels")
  ;(document.filters ?? []).forEach((filter, i) => {
    if (filter.dataset !== undefined && !datasets.has(filter.dataset)) references.push({ level: "error", code: "UNKNOWN_DATASET", message: `The filter "${filter.id}" reads dataset "${filter.dataset}", which the board does not define.`, path: `/filters/${i}/dataset`, fix: `Use one of: ${[...datasets].join(", ")}.` })
    if (filter.control === "range" && filter.options !== undefined) references.push({ level: "warning", code: "DOCUMENT_INVALID", message: `The range filter "${filter.id}" also lists options, which a range does not use.`, path: `/filters/${i}/options`, fix: "Remove options from a range filter." })
    if (filter.control === "search" && filter.options !== undefined) references.push({ level: "warning", code: "DOCUMENT_INVALID", message: `The search filter "${filter.id}" also lists options, which a search does not use.`, path: `/filters/${i}/options`, fix: "Remove options from a search filter." })
  })
  ;(document.kpis ?? []).forEach((kpi, i) => {
    if (!datasets.has(kpi.dataset)) references.push({ level: "error", code: "UNKNOWN_DATASET", message: `The KPI "${kpi.id}" reads dataset "${kpi.dataset}", which the board does not define.`, path: `/kpis/${i}/dataset`, fix: `Use one of: ${[...datasets].join(", ")}.` })
    if (kpi.aggregate !== "count" && kpi.field === undefined) references.push({ level: "error", code: "FIELD_MISSING", message: `The KPI "${kpi.id}" aggregates with ${kpi.aggregate} but names no field.`, path: `/kpis/${i}/field`, fix: "Set field, or use aggregate \"count\"." })
    if (kpi.sparkline && kpi.sparkline.x === kpi.sparkline.y && kpi.sparkline.aggregate !== undefined) references.push({ level: "warning", code: "DOCUMENT_INVALID", message: `The sparkline of "${kpi.id}" groups ${kpi.sparkline.x} by itself, so it is one point per row.`, path: `/kpis/${i}/sparkline`, fix: "Use a different y, or drop the aggregate." })
  })
  document.panels.forEach((panel, i) => {
    if (!datasets.has(panel.dataset)) references.push({ level: "error", code: "UNKNOWN_DATASET", message: `The panel "${panel.id}" draws dataset "${panel.dataset}", which the board does not define.`, path: `/panels/${i}/dataset`, fix: `Use one of: ${[...datasets].join(", ")}.` })
    if (panel.span > document.columns) references.push({ level: "error", code: "DOCUMENT_INVALID", message: `The panel "${panel.id}" spans ${panel.span} columns on a ${document.columns}-column board.`, path: `/panels/${i}/span`, fix: `Use a span from 1 to ${document.columns}.` })
    if (panel.tab !== undefined && !tabs.has(panel.tab)) references.push({ level: "error", code: "DOCUMENT_INVALID", message: `The panel "${panel.id}" sits on tab "${panel.tab}", which the board does not define.`, path: `/panels/${i}/tab`, fix: `Use one of: ${[...tabs].join(", ") || "(add tabs)"}.` })
    if (panel.chart.kind !== "table" && panel.chart.engine === "echarts" && panel.chart.spec === undefined) references.push({ level: "error", code: "DOCUMENT_INVALID", message: `The ECharts panel "${panel.id}" has no chart.spec: chart.quick builds Vega-Lite only.`, path: `/panels/${i}/chart`, fix: "Set chart.engine to \"vega-lite\", or give an ECharts option as chart.spec." })
  })
  if (references.some(issue => issue.level === "error")) throw new BoardInvalid(references)
  return document
}

/** The document as saved beside the board: the parsed value, one level of indent, one trailing newline. */
export const serialiseBoardDocument = (document: BoardDocument): string => JSON.stringify(document, null, 1) + "\n"
