import type * as z from "zod"
import type { Issue } from "../errors.js"
import type { CategoryValue } from "../document/category.js"

/** The 14 recipe families: the quick-chart types, as typed document recipes. */
export const RECIPE_IDS = ["bar", "horizontal_bar", "grouped_bar", "stacked_bar", "line", "area", "stacked_area", "scatter", "bubble", "pie", "donut", "histogram", "box_plot", "heatmap"] as const
export type RecipeId = (typeof RECIPE_IDS)[number]

export const AGGREGATES = ["none", "sum", "mean", "median", "min", "max", "count"] as const
export type Aggregate = (typeof AGGREGATES)[number]
export const PIE_AGGREGATES = ["none", "sum", "count"] as const
export type PieAggregate = (typeof PIE_AGGREGATES)[number]
export const VALUE_SORTS = ["input", "category-ascending", "category-descending", "value-ascending", "value-descending"] as const
export type ValueSort = (typeof VALUE_SORTS)[number]
export const CATEGORY_SORTS = ["input", "category-ascending", "category-descending"] as const
export type CategorySort = (typeof CATEGORY_SORTS)[number]
export const AXIS_ORDERS = ["input", "ascending", "descending"] as const
export type AxisOrder = (typeof AXIS_ORDERS)[number]
export const X_TYPES = ["temporal", "quantitative", "ordinal"] as const
export type XType = (typeof X_TYPES)[number]
export const BINS = { min: 2, max: 200, default: 24 } as const
export const AXIS_TITLE_MAX = 120
export const FIELD_MAX = 256

type Titles = { readonly xTitle?: string; readonly yTitle?: string }

/** Bindings per recipe: which data field plays which role. `value`/`y` is left out when counting rows. */
export interface RecipeBindingsMap {
  bar: { readonly category: string; readonly value?: string }
  horizontal_bar: { readonly category: string; readonly value?: string }
  grouped_bar: { readonly category: string; readonly series: string; readonly value?: string }
  stacked_bar: { readonly category: string; readonly series: string; readonly value?: string }
  line: { readonly x: string; readonly y?: string; readonly series?: string }
  area: { readonly x: string; readonly y?: string; readonly series?: string }
  stacked_area: { readonly x: string; readonly y?: string; readonly series: string }
  scatter: { readonly x: string; readonly y: string; readonly series?: string }
  bubble: { readonly x: string; readonly y: string; readonly size: string; readonly series?: string }
  pie: { readonly category: string; readonly value?: string }
  donut: { readonly category: string; readonly value?: string }
  histogram: { readonly value: string }
  box_plot: { readonly category: string; readonly value: string }
  heatmap: { readonly column: string; readonly row: string; readonly value?: string }
}

type LineOptions = Titles & { readonly xType: XType; readonly aggregate?: Aggregate; readonly xSort?: AxisOrder }
/** Options per recipe. Line, area and stacked area require `xType`, so their options object is required. */
export interface RecipeOptionsMap {
  bar: Titles & { readonly aggregate?: Aggregate; readonly sort?: ValueSort }
  horizontal_bar: Titles & { readonly aggregate?: Aggregate; readonly sort?: ValueSort }
  grouped_bar: Titles & { readonly aggregate?: Aggregate; readonly sort?: CategorySort }
  stacked_bar: Titles & { readonly aggregate?: Aggregate; readonly sort?: CategorySort }
  line: LineOptions
  area: LineOptions
  stacked_area: LineOptions
  scatter: Titles
  bubble: Titles
  pie: { readonly aggregate?: PieAggregate; readonly sort?: ValueSort }
  donut: { readonly aggregate?: PieAggregate; readonly sort?: ValueSort }
  histogram: Titles & { readonly bins?: number }
  box_plot: Titles & { readonly sort?: CategorySort }
  heatmap: Titles & { readonly aggregate?: Aggregate; readonly rowSort?: AxisOrder; readonly columnSort?: AxisOrder }
}
export type OptionsRequired = "line" | "area" | "stacked_area"

/** How a binding role is used. */
export type RoleKind = "category" | "series" | "position" | "measure" | "size"
export interface BindingSpec {
  readonly role: string
  /** `unless-count`: required for every aggregate but count, and refused under count. */
  readonly required: "always" | "unless-count" | "optional"
  readonly kind: RoleKind
  readonly description: string
}

/** The options a recipe takes and their defaults: the source of its option schema and of its documentation. */
export interface OptionSupport {
  readonly aggregate?: readonly Aggregate[]
  readonly sort?: readonly string[]
  readonly xType?: readonly XType[]
  readonly xSort?: readonly AxisOrder[]
  readonly rowSort?: readonly AxisOrder[]
  readonly columnSort?: readonly AxisOrder[]
  readonly bins?: typeof BINS
  /** Physical-axis titles: xTitle names the horizontal axis and yTitle the vertical one, whatever field is there. */
  readonly axisTitles: boolean
}

export interface InteractionSupport {
  /** tooltip auto/off: every recipe with visible data marks. */
  readonly tooltip: true
  /** legend highlight: needs a series binding. */
  readonly legendHighlight: boolean
  /** zoom x: only with xType temporal. */
  readonly zoomX: boolean
  /** brush interval. */
  readonly brush: boolean
}

export interface LayoutSupport {
  readonly targets: readonly string[]
  readonly modes: readonly string[]
}

export interface RecipeExample {
  readonly name: string
  readonly description: string
  /** A complete ChartDocumentV1 with inline rows: the full fixture, runnable as is. */
  readonly document: Record<string, unknown>
  /**
   * The catalogue entry whose exact tested call (`exampleCall`) the rows come from; `derived` when the rows are
   * reshaped from it (split into two rows each, for instance) to show an option.
   */
  readonly source: { readonly catalogue: string; readonly derived: boolean }
}

/** What a recipe produces: a Vega-Lite spec for the existing renderer, and the rows its marks draw. */
export interface RecipeCompilation {
  readonly recipe: RecipeId
  /** A Vega-Lite spec whose data is `{ "name": dataName }`; theme, size and title are applied by the renderer. */
  readonly spec: Record<string, unknown>
  readonly dataName: string
  /** One row per mark (aggregated where the recipe aggregates); the input rows stay in the document. */
  readonly values: Record<string, unknown>[]
  /** Authored options with every default filled in. */
  readonly options: Record<string, unknown>
  /** Only the defaults that filled options the author left out. */
  readonly defaults: Record<string, unknown>
  /** The colour domain: series when bound, the category for pie and donut. */
  readonly categories?: { readonly role: "series" | "category"; readonly field: string; readonly domain: readonly CategoryValue[] }
  /** Fields the compiler added to `values` (a slice order); never part of the data. */
  readonly internalFields: readonly string[]
  /** Warnings. Errors are thrown as a DocumentInvalid that lists them all. */
  readonly diagnostics: readonly Issue[]
  readonly stats: { readonly inputRows: number; readonly markRows: number; readonly groups?: number }
}

export interface CompileContext {
  /** A saved artifact's colour domain: categories keep their positions on replay. */
  readonly categoryDomain?: readonly CategoryValue[]
}

export interface RecipeDefinition {
  readonly id: RecipeId
  readonly name: string
  readonly family: "comparison" | "trend" | "distribution" | "part-to-whole" | "relationship"
  readonly summary: string
  readonly bindings: readonly BindingSpec[]
  readonly options: OptionSupport
  readonly optionsRequired: boolean
  readonly colorRole?: "series" | "category"
  /** Roles whose values form one mark's group, when the recipe aggregates. */
  readonly groupBy: readonly string[]
  readonly interactions: InteractionSupport
  readonly layout: LayoutSupport
  /** What the rows must look like, in a sentence. */
  readonly dataRequirements: string
  /** Hints for properties another recipe takes but this one refuses, keyed by "bindings.series", "options.sort"… */
  readonly refused: Readonly<Record<string, string>>
  readonly bindingsSchema: z.ZodType
  readonly optionsSchema: z.ZodType
  readonly examples: () => readonly RecipeExample[]
}
