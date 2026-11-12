import * as z from "zod"
import { LAYOUT_MODES, LAYOUT_TARGETS } from "../document/defaults.js"
import { recipeExamples } from "./examples.js"
import {
  AGGREGATES, AXIS_ORDERS, AXIS_TITLE_MAX, BINS, CATEGORY_SORTS, FIELD_MAX, PIE_AGGREGATES, VALUE_SORTS, X_TYPES,
  type BindingSpec, type InteractionSupport, type OptionSupport, type RecipeDefinition, type RecipeId,
} from "./types.js"

/**
 * The recipe registry's definitions: one entry per quick-chart family. Each entry's bindings and option support are
 * the single source of its input schemas (built below), its catalogue text and its capability metadata.
 */

const FIELD = z.string().min(1).max(FIELD_MAX)

const role = (role: string, required: BindingSpec["required"], kind: BindingSpec["kind"], description: string): BindingSpec => ({ role, required, kind, description })

function bindingsSchema(bindings: readonly BindingSpec[]): z.ZodType {
  return z.strictObject(Object.fromEntries(bindings.map(b => {
    const field = FIELD.describe(`${b.description}${b.required === "unless-count" ? " Required unless options.aggregate is count, and refused under count." : ""}`)
    return [b.role, b.required === "always" ? field : field.optional()]
  })))
}

function optionsSchema(o: OptionSupport): z.ZodType {
  const shape: Record<string, z.ZodType> = {}
  if (o.xType) shape.xType = z.enum(o.xType).describe("How x is read: temporal (ISO dates), quantitative (numbers) or ordinal (ordered categories). Required.")
  if (o.aggregate) shape.aggregate = z.enum(o.aggregate as [string, ...string[]]).optional().describe("How rows that share a mark combine. Default none: repeated groups are an error (AGGREGATION_REQUIRED). count counts rows and takes no measure.")
  if (o.sort) shape.sort = z.enum(o.sort as [string, ...string[]]).optional().describe("Display order of the categories. Default input (the order rows arrive in). Value sorts use the displayed aggregate.")
  if (o.xSort) shape.xSort = z.enum(o.xSort as [string, ...string[]]).optional().describe("Order of x. Default ascending for temporal and quantitative x, input for ordinal x.")
  if (o.rowSort) shape.rowSort = z.enum(o.rowSort as [string, ...string[]]).optional().describe("Order of the rows. Default input.")
  if (o.columnSort) shape.columnSort = z.enum(o.columnSort as [string, ...string[]]).optional().describe("Order of the columns. Default input.")
  if (o.bins) shape.bins = z.number().int().min(o.bins.min).max(o.bins.max).optional().describe(`The most bins to use, ${o.bins.min}–${o.bins.max}. Default ${o.bins.default}.`)
  if (o.axisTitles) {
    shape.xTitle = z.string().max(AXIS_TITLE_MAX).optional().describe("Title of the horizontal axis, whatever field is on it.")
    shape.yTitle = z.string().max(AXIS_TITLE_MAX).optional().describe("Title of the vertical axis, with its unit, such as \"Revenue (€k)\".")
  }
  return z.strictObject(shape)
}

const NO_INTERACTION: InteractionSupport = { tooltip: true, legendHighlight: false, zoomX: false, brush: false }
const LAYOUT = { targets: LAYOUT_TARGETS, modes: LAYOUT_MODES }

const BAR_HINTS = {
  "bindings.series": "A bar chart shows one series. For several, use grouped_bar or stacked_bar with a series binding.",
  "options.xSort": "Bars are ordered with options.sort.",
}
const LINE_HINTS = {
  "options.sort": "Line and area charts order x with options.xSort (input, ascending or descending).",
  "bindings.category": "Line and area charts bind x, y and series.",
  "bindings.value": "Line and area charts bind the measure as y.",
}
const noAggregate = (why: string) => ({ "options.aggregate": why })
const COMMON_HINTS = {
  "options.bins": "Only histogram takes bins.",
  "options.rowSort": "Only heatmap takes rowSort and columnSort.",
  "options.columnSort": "Only heatmap takes rowSort and columnSort.",
}

type Spec = Omit<RecipeDefinition, "bindingsSchema" | "optionsSchema" | "examples" | "layout" | "optionsRequired">

const SPECS: readonly Spec[] = [
  {
    id: "bar", name: "Bar chart", family: "comparison", summary: "Compare one value across categories.",
    bindings: [role("category", "always", "category", "Category field, one bar each."), role("value", "unless-count", "measure", "Numeric value field.")],
    options: { aggregate: AGGREGATES, sort: VALUE_SORTS, axisTitles: true },
    groupBy: ["category"], interactions: NO_INTERACTION,
    dataRequirements: "One row per category, or set options.aggregate to combine repeated categories. The value is a number.",
    refused: { ...COMMON_HINTS, ...BAR_HINTS },
  },
  {
    id: "horizontal_bar", name: "Horizontal bar", family: "comparison", summary: "Rank many categories, or long category names, on horizontal bars.",
    bindings: [role("category", "always", "category", "Category field, one bar each (on the vertical axis)."), role("value", "unless-count", "measure", "Numeric value field (on the horizontal axis).")],
    options: { aggregate: AGGREGATES, sort: VALUE_SORTS, axisTitles: true },
    groupBy: ["category"], interactions: NO_INTERACTION,
    dataRequirements: "One row per category, or set options.aggregate to combine repeated categories. The value is a number.",
    refused: { ...COMMON_HINTS, ...BAR_HINTS },
  },
  {
    id: "grouped_bar", name: "Grouped bar", family: "comparison", summary: "Compare series side by side within each category.",
    bindings: [role("category", "always", "category", "Category field (the groups)."), role("series", "always", "series", "Series field (the bars within a group)."), role("value", "unless-count", "measure", "Numeric value field.")],
    options: { aggregate: AGGREGATES, sort: CATEGORY_SORTS, axisTitles: true },
    colorRole: "series", groupBy: ["category", "series"], interactions: { ...NO_INTERACTION, legendHighlight: true },
    dataRequirements: "One row per category and series, or set options.aggregate. The value is a number.",
    refused: { ...COMMON_HINTS, "options.xSort": "Bars are ordered with options.sort." },
  },
  {
    id: "stacked_bar", name: "Stacked bar", family: "comparison", summary: "Show totals and their make-up across categories.",
    bindings: [role("category", "always", "category", "Category field (one stack each)."), role("series", "always", "series", "Series field (the segments)."), role("value", "unless-count", "measure", "Numeric value field.")],
    options: { aggregate: AGGREGATES, sort: CATEGORY_SORTS, axisTitles: true },
    colorRole: "series", groupBy: ["category", "series"], interactions: { ...NO_INTERACTION, legendHighlight: true },
    dataRequirements: "One row per category and series, or set options.aggregate. The value is a number.",
    refused: { ...COMMON_HINTS, "options.xSort": "Bars are ordered with options.sort." },
  },
  {
    id: "line", name: "Line chart", family: "trend", summary: "A value over time or along an ordered axis, one line per series.",
    bindings: [role("x", "always", "position", "Field on the horizontal axis (see options.xType)."), role("y", "unless-count", "measure", "Numeric value field."), role("series", "optional", "series", "Series field, one line each.")],
    options: { xType: X_TYPES, aggregate: AGGREGATES, xSort: AXIS_ORDERS, axisTitles: true },
    colorRole: "series", groupBy: ["x", "series"], interactions: { ...NO_INTERACTION, legendHighlight: true, zoomX: true },
    dataRequirements: "One row per x (and series), or set options.aggregate. Temporal x is an ISO date; quantitative x and y are numbers.",
    refused: { ...COMMON_HINTS, ...LINE_HINTS },
  },
  {
    id: "area", name: "Area chart", family: "trend", summary: "A volume over time; with a series, overlapping areas.",
    bindings: [role("x", "always", "position", "Field on the horizontal axis (see options.xType)."), role("y", "unless-count", "measure", "Numeric value field."), role("series", "optional", "series", "Series field, one area each.")],
    options: { xType: X_TYPES, aggregate: AGGREGATES, xSort: AXIS_ORDERS, axisTitles: true },
    colorRole: "series", groupBy: ["x", "series"], interactions: { ...NO_INTERACTION, legendHighlight: true, zoomX: true },
    dataRequirements: "One row per x (and series), or set options.aggregate. Temporal x is an ISO date; quantitative x and y are numbers.",
    refused: { ...COMMON_HINTS, ...LINE_HINTS },
  },
  {
    id: "stacked_area", name: "Stacked area", family: "trend", summary: "Totals over time and how each series contributes.",
    bindings: [role("x", "always", "position", "Field on the horizontal axis (see options.xType)."), role("y", "unless-count", "measure", "Numeric value field."), role("series", "always", "series", "Series field, one band each.")],
    options: { xType: X_TYPES, aggregate: AGGREGATES, xSort: AXIS_ORDERS, axisTitles: true },
    colorRole: "series", groupBy: ["x", "series"], interactions: { ...NO_INTERACTION, legendHighlight: true },
    dataRequirements: "One row per x and series, or set options.aggregate. Temporal x is an ISO date; y is a number.",
    refused: { ...COMMON_HINTS, ...LINE_HINTS },
  },
  {
    id: "scatter", name: "Scatter plot", family: "relationship", summary: "The relationship between two numbers, one point per row.",
    bindings: [role("x", "always", "position", "Numeric field on the horizontal axis."), role("y", "always", "position", "Numeric field on the vertical axis."), role("series", "optional", "series", "Series field (point colour).")],
    options: { axisTitles: true },
    colorRole: "series", groupBy: [], interactions: { ...NO_INTERACTION, legendHighlight: true, brush: true },
    dataRequirements: "One row per point; x and y are numbers on every row.",
    refused: { ...COMMON_HINTS, ...noAggregate("A scatter plot draws one point per row and never aggregates; combine rows first with data.transform if you need to."), "options.sort": "A scatter plot has no category order." },
  },
  {
    id: "bubble", name: "Bubble chart", family: "relationship", summary: "A scatter plot with a third number as the point's area.",
    bindings: [role("x", "always", "position", "Numeric field on the horizontal axis."), role("y", "always", "position", "Numeric field on the vertical axis."), role("size", "always", "size", "Numeric field for the bubble area."), role("series", "optional", "series", "Series field (bubble colour).")],
    options: { axisTitles: true },
    colorRole: "series", groupBy: [], interactions: { ...NO_INTERACTION, legendHighlight: true, brush: true },
    dataRequirements: "One row per bubble; x, y and size are numbers on every row.",
    refused: { ...COMMON_HINTS, ...noAggregate("A bubble chart draws one bubble per row and never aggregates; combine rows first with data.transform if you need to."), "options.sort": "A bubble chart has no category order." },
  },
  {
    id: "pie", name: "Pie chart", family: "part-to-whole", summary: "Parts of one whole, for a few slices.",
    bindings: [role("category", "always", "category", "Slice field."), role("value", "unless-count", "measure", "Non-negative numeric value field.")],
    options: { aggregate: PIE_AGGREGATES, sort: VALUE_SORTS, axisTitles: false },
    colorRole: "category", groupBy: ["category"], interactions: NO_INTERACTION,
    dataRequirements: "One row per slice, or set options.aggregate to sum or count. Values are zero or more; a pie cannot show a negative part.",
    refused: { ...COMMON_HINTS, "bindings.series": "A pie shows one series. To compare parts across groups, use stacked_bar.", "options.xTitle": "A pie has no axes.", "options.yTitle": "A pie has no axes." },
  },
  {
    id: "donut", name: "Donut chart", family: "part-to-whole", summary: "A pie with a hole, for a few slices.",
    bindings: [role("category", "always", "category", "Slice field."), role("value", "unless-count", "measure", "Non-negative numeric value field.")],
    options: { aggregate: PIE_AGGREGATES, sort: VALUE_SORTS, axisTitles: false },
    colorRole: "category", groupBy: ["category"], interactions: NO_INTERACTION,
    dataRequirements: "One row per slice, or set options.aggregate to sum or count. Values are zero or more; a donut cannot show a negative part.",
    refused: { ...COMMON_HINTS, "bindings.series": "A donut shows one series. To compare parts across groups, use stacked_bar.", "options.xTitle": "A donut has no axes.", "options.yTitle": "A donut has no axes." },
  },
  {
    id: "histogram", name: "Histogram", family: "distribution", summary: "The shape of one numeric variable: rows counted per bin.",
    bindings: [role("value", "always", "measure", "Numeric field to bin.")],
    options: { bins: BINS, axisTitles: true },
    groupBy: [], interactions: NO_INTERACTION,
    dataRequirements: "One row per observation; the value is a number. Rows without a value are left out and reported.",
    refused: { ...noAggregate("A histogram counts rows per bin itself; it takes no aggregate."), "options.rowSort": COMMON_HINTS["options.rowSort"], "options.columnSort": COMMON_HINTS["options.columnSort"], "bindings.series": "A histogram shows one variable; compare groups with box_plot." },
  },
  {
    id: "box_plot", name: "Box plot", family: "distribution", summary: "Medians, spread and outliers of a value across categories.",
    bindings: [role("category", "always", "category", "Category field, one box each."), role("value", "always", "measure", "Numeric field whose distribution is drawn.")],
    options: { sort: CATEGORY_SORTS, axisTitles: true },
    groupBy: [], interactions: NO_INTERACTION,
    dataRequirements: "One row per observation; the value is a number. The recipe never pre-aggregates: the box summarises every row.",
    refused: { ...COMMON_HINTS, ...noAggregate("A box plot summarises the distribution itself; it takes no aggregate.") },
  },
  {
    id: "heatmap", name: "Heatmap", family: "distribution", summary: "A value across two categorical dimensions, one cell each.",
    bindings: [role("column", "always", "category", "Field on the horizontal axis (columns)."), role("row", "always", "category", "Field on the vertical axis (rows)."), role("value", "unless-count", "measure", "Numeric value field (cell colour).")],
    options: { aggregate: AGGREGATES, rowSort: AXIS_ORDERS, columnSort: AXIS_ORDERS, axisTitles: true },
    groupBy: ["column", "row"], interactions: NO_INTERACTION,
    dataRequirements: "One row per cell (row and column), or set options.aggregate to combine repeated cells. The value is a number.",
    refused: { "options.bins": COMMON_HINTS["options.bins"], "options.sort": "A heatmap orders each axis with options.rowSort and options.columnSort.", "bindings.series": "A heatmap has no series; its colour is the value." },
  },
]

export const DEFINITIONS: readonly RecipeDefinition[] = SPECS.map(spec => ({
  ...spec,
  layout: LAYOUT,
  optionsRequired: spec.options.xType !== undefined,
  bindingsSchema: bindingsSchema(spec.bindings),
  optionsSchema: optionsSchema(spec.options),
  examples: () => recipeExamples(spec.id),
}))

const BY_ID = new Map(DEFINITIONS.map(d => [d.id, d]))
export const recipeDefinition = (id: RecipeId): RecipeDefinition => BY_ID.get(id)!

/** The option defaults a recipe fills in, given the authored options (xSort depends on xType). */
export function optionDefaults(id: RecipeId, options: Readonly<Record<string, unknown>>): Record<string, unknown> {
  const o = recipeDefinition(id).options
  const out: Record<string, unknown> = {}
  if (o.aggregate) out.aggregate = "none"
  if (o.sort) out.sort = "input"
  if (o.xSort) out.xSort = options.xType === "ordinal" ? "input" : "ascending"
  if (o.rowSort) out.rowSort = "input"
  if (o.columnSort) out.columnSort = "input"
  if (o.bins) out.bins = o.bins.default
  return out
}
