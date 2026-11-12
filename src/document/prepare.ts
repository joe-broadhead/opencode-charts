import { ChartsError } from "../errors.js"
import { compileRecipe } from "../recipes/compile.js"
import { RECIPE_COMPILER_VERSION } from "../recipes/registry.js"
import type { RecipeCompilation } from "../recipes/types.js"
import { buildArtifact, canonicalRows, captureDefaults, captureDocument, type DefaultsEnvironment } from "./artifact.js"
import { DEFAULT_LAYOUT_TARGET, INTERACTION_DEFAULTS, LAYOUT_PROFILES, type InteractionDefaults, type LayoutMode, type LayoutTarget } from "./defaults.js"
import { parseDocument } from "./schema.js"
import type { CapturedRecipeChartV1, CapturedThemeV1, ChartArtifactV1, DataSourceProvenanceV1, FontDependencyV1, GeneratorV1, JsonObject, RecipeLayoutV1 } from "./types.js"

/**
 * Shared preparation for chart documents, with every environment input explicit: fresh creation and saved-artifact
 * replay run the same steps over the same captured rows, so they cannot disagree.
 *
 * 1. validate the document strictly; 2. capture the rows before data.transform (read by the adapter for data.path);
 * 3. run data.transform once; 4. compile the recipe; 5. capture defaults, theme base, fonts and colour domain beside
 * the authored document; 6. compute the revision. Replay starts at step 3 from the artifact, with its captured values.
 */

export type TransformRunner = (rows: JsonObject[], transform: readonly JsonObject[]) => Promise<JsonObject[]> | JsonObject[]

export interface CreationEnvironment extends DefaultsEnvironment {
  /** The named theme base, resolved by the adapter from appearance.theme or the configured default. */
  readonly theme: CapturedThemeV1
  /** Custom font files the theme and overrides use, with their digests. */
  readonly fonts: readonly FontDependencyV1[]
  readonly generator: Omit<GeneratorV1, "recipeCompiler">
  /** Runs data.transform: the Vega worker in the plugin. Called at most once per preparation. */
  readonly transform: TransformRunner
}

/** Rows the adapter read for data.path (before any transform), with where they came from. */
export interface SourceData {
  readonly rows: readonly JsonObject[]
  readonly provenance?: DataSourceProvenanceV1
}

/** The settings a render uses: authored values where given, captured defaults for the rest. */
export interface EffectiveSettings {
  readonly locale: string
  readonly seed: number
  readonly theme: CapturedThemeV1
  /** Recipe documents only. */
  readonly layout?: { readonly target: LayoutTarget; readonly mode: LayoutMode; readonly width: number; readonly height: number; readonly minLabelSize: number }
  readonly interactions?: InteractionDefaults
  /** Which interaction presets the author set explicitly (an explicit tooltip can require HTML; an omitted one never). */
  readonly explicitInteractions?: readonly (keyof InteractionDefaults)[]
  readonly recipeOptions?: JsonObject
}

export interface Prepared {
  readonly artifact: ChartArtifactV1
  /** The rows after data.transform: what the chart draws (or, for an engine document, the rows given to its spec). */
  readonly rows?: readonly JsonObject[]
  readonly compilation?: RecipeCompilation
  readonly settings: EffectiveSettings
}

async function transformOnce(rows: readonly JsonObject[] | undefined, transform: readonly JsonObject[] | undefined, run: TransformRunner): Promise<JsonObject[] | undefined> {
  if (!rows) return undefined
  if (!transform?.length) return rows as JsonObject[]
  return await run(structuredClone(rows) as JsonObject[], transform)
}

/** Fresh creation: resolves current defaults, captures them, and compiles. */
export async function prepareDocument(raw: unknown, source: SourceData | undefined, env: CreationEnvironment): Promise<Prepared> {
  const document = parseDocument(raw)
  const data = (document.chart as JsonObject).data as JsonObject | undefined
  let rows: JsonObject[] | undefined
  if (data?.path !== undefined) {
    if (!source) throw new ChartsError("DATA_MISSING", `data.path "${data.path}" was not read.`, "Read the file (with read permission) and pass its rows before preparing the document.", "/chart/data/path")
    rows = canonicalRows(source.rows)
  } else if (data?.rows !== undefined) rows = canonicalRows(data.rows as JsonObject[])
  const captured = captureDocument(document, rows)
  const transformed = await transformOnce(rows, data?.transform as JsonObject[] | undefined, env.transform)
  const compilation = captured.chart.kind === "recipe" ? compileRecipe(captured.chart as CapturedRecipeChartV1 as never, transformed ?? []) : undefined
  const defaults = captureDefaults(document, env, compilation?.defaults)
  const artifact = buildArtifact({
    document: captured, defaults, theme: env.theme, fonts: env.fonts,
    ...(compilation?.categories ? { categories: compilation.categories } : {}),
    ...(data?.path !== undefined && source?.provenance ? { provenance: source.provenance } : {}),
    generator: { ...env.generator, recipeCompiler: RECIPE_COMPILER_VERSION },
  })
  return { artifact, ...(transformed ? { rows: transformed } : {}), ...(compilation ? { compilation } : {}), settings: effectiveSettings(artifact) }
}

/** Replay of a saved (already verified) artifact: captured rows, defaults, theme and colour domain; no new defaults. */
export async function replayArtifact(artifact: ChartArtifactV1, transform: TransformRunner): Promise<Omit<Prepared, "artifact">> {
  const chart = artifact.document.chart
  const transformed = await transformOnce(chart.data?.rows, chart.data?.transform, transform)
  const compilation = chart.kind === "recipe"
    ? compileRecipe({ ...chart, options: { ...(artifact.captured.defaults.recipeOptions ?? {}), ...(chart.options ?? {}) } } as never, transformed ?? [], artifact.captured.categories ? { categoryDomain: artifact.captured.categories.domain } : {})
    : undefined
  return { ...(transformed ? { rows: transformed } : {}), ...(compilation ? { compilation } : {}), settings: effectiveSettings(artifact) }
}

/** Authored values over captured defaults. */
export function effectiveSettings(artifact: ChartArtifactV1): EffectiveSettings {
  const doc = artifact.document, defaults = artifact.captured.defaults
  const base = { locale: doc.locale ?? defaults.locale!, seed: doc.seed ?? defaults.seed!, theme: artifact.captured.theme }
  if (doc.chart.kind !== "recipe") return base
  const layout = (doc.layout ?? {}) as RecipeLayoutV1
  const profile = LAYOUT_PROFILES[layout.target ?? defaults.layout?.profile ?? DEFAULT_LAYOUT_TARGET]
  const authored = (doc.interactions ?? {}) as Partial<InteractionDefaults>
  return {
    ...base,
    layout: {
      target: profile.target,
      mode: layout.mode ?? defaults.layout?.mode ?? profile.mode,
      width: layout.width ?? defaults.layout?.width ?? profile.width,
      height: layout.height ?? defaults.layout?.height ?? profile.height,
      minLabelSize: defaults.layout?.minLabelSize ?? profile.minLabelSize,
    },
    interactions: { ...INTERACTION_DEFAULTS, ...(defaults.interactions ?? {}), ...authored },
    explicitInteractions: (Object.keys(authored) as (keyof InteractionDefaults)[]).filter(k => authored[k] !== undefined),
    recipeOptions: { ...(defaults.recipeOptions ?? {}), ...((doc.chart.options ?? {}) as JsonObject) },
  }
}
