import type * as z from "zod"
import type { OptionsRequired, RecipeBindingsMap, RecipeId, RecipeOptionsMap } from "../recipes/types.js"
import type { ThemeTokens, ThemeTokensSchema } from "../themes/tokens.js"
import type { CategoryValue } from "./category.js"
import type { ARTIFACT_FORMAT, ARTIFACT_VERSION, InteractionDefaults, LayoutMode, LayoutTarget } from "./defaults.js"

/**
 * The public chart document (version 1), the captured canonical form a saved artifact stores, and the artifact
 * envelope. Four separate types, never confused: the request (ChartDocumentV1), the captured document
 * (CapturedDocumentV1), a compiled engine spec (RecipeCompilation, in recipes/types.ts) and published files (outside
 * this module).
 */

export type JsonObject = Record<string, unknown>
export type DataFormat = "csv" | "tsv" | "json" | "jsonl" | "parquet"
export type EngineId = "vega-lite" | "vega" | "echarts"

/** Data for a new document: exactly one of rows or path. format only with path. */
export interface DataInputV1 {
  readonly rows?: readonly JsonObject[]
  readonly path?: string
  readonly format?: DataFormat
  /** Vega-Lite transforms, run once per compilation over the captured rows. */
  readonly transform?: readonly JsonObject[]
}
/** An engine document's data may also name the dataset its spec refers to (default table). */
export interface EngineDataInputV1 extends DataInputV1 { readonly name?: string }

export type RecipeChartV1 = {
  [R in RecipeId]: { readonly kind: "recipe"; readonly recipe: R; readonly data: DataInputV1; readonly bindings: RecipeBindingsMap[R] }
    & (R extends OptionsRequired ? { readonly options: RecipeOptionsMap[R] } : { readonly options?: RecipeOptionsMap[R] })
}[RecipeId]

export interface EngineChartV1 {
  readonly kind: "engine"
  readonly engine?: EngineId
  readonly spec: JsonObject
  readonly data?: EngineDataInputV1
}

type TokenInput = z.input<typeof ThemeTokensSchema>
type DeepPartial<T> = { [K in keyof T]?: T[K] extends readonly unknown[] ? T[K] : T[K] extends object ? DeepPartial<T[K]> : T[K] }
/**
 * Theme tokens a document may override: a strict deep partial of the canonical tokens, arrays whole, without the
 * identity keys (name, description, extends) and without layout.width/height (a document sizes itself with layout).
 */
export type PresentationTokenOverrides = DeepPartial<Omit<TokenInput, "name" | "description" | "layout"> & { layout: Omit<TokenInput["layout"], "width" | "height"> }>

export interface CategoryColorV1 { readonly value: CategoryValue; readonly color: string }
export interface AppearanceV1 {
  /** A named theme: built-in, saved in the workspace, or from the plugin's options. The only base selector. */
  readonly theme?: string
  readonly overrides?: PresentationTokenOverrides
  readonly categoryColors?: readonly CategoryColorV1[]
}

export interface RecipeLayoutV1 {
  readonly target?: LayoutTarget
  readonly mode?: LayoutMode
  /** Outer logical pixels, title, axes, legend and padding included. */
  readonly width?: number
  readonly height?: number
}
export interface NativeLayoutV1 { readonly mode: "native" }
export type LayoutV1 = RecipeLayoutV1 | NativeLayoutV1

export interface InteractionsV1 {
  readonly tooltip?: "auto" | "off"
  readonly legend?: "static" | "highlight"
  readonly zoom?: "none" | "x"
  readonly brush?: "none" | "interval"
}

export interface ChartDocumentV1 {
  readonly version: 1
  readonly chart: RecipeChartV1 | EngineChartV1
  readonly title?: string
  readonly description?: string
  readonly locale?: string
  readonly currency?: string
  readonly seed?: number
  readonly appearance?: AppearanceV1
  readonly layout?: LayoutV1
  readonly interactions?: InteractionsV1
}

// ---------------------------------------------------------------------------------------------------------------
// Captured form: what a saved artifact holds.

/** Captured data: the normalised rows before data.transform, which is kept once beside them. */
export interface CapturedDataV1 {
  readonly rows: readonly JsonObject[]
  readonly transform?: readonly JsonObject[]
  readonly name?: string
}
export type CapturedRecipeChartV1 = Omit<RecipeChartV1, "data"> & { readonly data: CapturedDataV1 }
export type CapturedEngineChartV1 = Omit<EngineChartV1, "data"> & { readonly data?: CapturedDataV1 }
/** The canonical, uncompiled document: authored intent exactly, with an external data.path replaced by its rows. */
export interface CapturedDocumentV1 extends Omit<ChartDocumentV1, "chart"> {
  readonly chart: CapturedRecipeChartV1 | CapturedEngineChartV1
}

export interface CapturedLayoutDefaultsV1 {
  readonly profile: LayoutTarget
  readonly profileVersion: number
  /** Effective values for the layout fields the author left out. */
  readonly mode?: LayoutMode
  readonly width?: number
  readonly height?: number
  readonly minLabelSize: number
}

/** Effective defaults a replay uses, kept apart from the authored document: only fields the author omitted. */
export interface CapturedDefaultsV1 {
  readonly locale?: string
  readonly seed?: number
  /** Recipe options the author left out, with the value the compiler used. */
  readonly recipeOptions?: JsonObject
  readonly layout?: CapturedLayoutDefaultsV1
  /** Interaction presets the author left out (recipe documents only). */
  readonly interactions?: Partial<InteractionDefaults>
}

/** The named theme a document was resolved against, frozen: its overrides stay authored in the document. */
export interface CapturedThemeV1 {
  readonly name: string
  readonly tokens: ThemeTokens
}

/** A custom font the chart depends on, identified by its content. */
export interface FontDependencyV1 {
  readonly family: string
  readonly weight: number
  /** Workspace-relative path it was read from; not part of the revision. */
  readonly path: string
  readonly sha256: string
  readonly bytes: number
}

export interface CategoryDomainV1 {
  readonly role: "series" | "category"
  readonly field: string
  readonly domain: readonly CategoryValue[]
}

export interface CapturedStateV1 {
  readonly defaults: CapturedDefaultsV1
  readonly theme: CapturedThemeV1
  readonly fonts: readonly FontDependencyV1[]
  /** The stable colour domain of a recipe document; absent when the recipe has none, and for engine documents. */
  readonly categories?: CategoryDomainV1
}

export interface DataSourceProvenanceV1 {
  readonly path: string
  readonly format: DataFormat
  readonly sha256: string
  readonly bytes: number
}
export interface ProvenanceV1 {
  /** The file data.path named, before its rows were captured. Absent for inline rows. */
  readonly data?: DataSourceProvenanceV1
}

/** What produced the artifact, to explain a later rerender; not part of the revision. */
export interface GeneratorV1 {
  readonly plugin: string
  /** RECIPE_COMPILER_VERSION of the recipe compiler that captured it. */
  readonly recipeCompiler: number
  readonly engines: Readonly<Record<string, string>>
}

export interface ChartArtifactV1 {
  readonly format: typeof ARTIFACT_FORMAT
  readonly version: typeof ARTIFACT_VERSION
  readonly revision: string
  readonly document: CapturedDocumentV1
  readonly captured: CapturedStateV1
  readonly provenance: ProvenanceV1
  readonly generator: GeneratorV1
}
