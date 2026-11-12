import { LAYOUT_PROFILES } from "../document/defaults.js"
import { compileRecipe, RECIPE_DATA_NAME } from "./compile.js"
import { DEFINITIONS, optionDefaults, recipeDefinition } from "./definitions.js"
import { RECIPE_IDS, type RecipeDefinition, type RecipeId } from "./types.js"

/**
 * The recipe registry: the 14 quick-chart families as typed recipes. Each definition owns its input schemas, its
 * compiler, its examples, its data requirements, and its interaction and layout support; catalogue text and
 * capability metadata are derived from it here, never written a second time.
 */

/** Moves when a recipe compiles the same document to a different spec. Recorded in saved artifacts. */
export const RECIPE_COMPILER_VERSION = 1

export const RECIPES: readonly RecipeDefinition[] = DEFINITIONS
export const isRecipeId = (value: unknown): value is RecipeId => typeof value === "string" && (RECIPE_IDS as readonly string[]).includes(value)
export { compileRecipe, optionDefaults, recipeDefinition, RECIPE_DATA_NAME, RECIPE_IDS }

/** One recipe's contract as data: what charts_catalogue and charts_capabilities report. */
export function recipeContract(id: RecipeId) {
  const def = recipeDefinition(id)
  const o = def.options
  return {
    id: def.id,
    name: def.name,
    family: def.family,
    summary: def.summary,
    bindings: def.bindings.map(b => ({ role: b.role, required: b.required, kind: b.kind, description: b.description })),
    options: {
      ...(o.xType ? { xType: { values: o.xType, required: true } } : {}),
      ...(o.aggregate ? { aggregate: { values: o.aggregate, default: "none" } } : {}),
      ...(o.sort ? { sort: { values: o.sort, default: "input" } } : {}),
      ...(o.xSort ? { xSort: { values: o.xSort, default: "ascending for temporal and quantitative x; input for ordinal x" } } : {}),
      ...(o.rowSort ? { rowSort: { values: o.rowSort, default: "input" } } : {}),
      ...(o.columnSort ? { columnSort: { values: o.columnSort, default: "input" } } : {}),
      ...(o.bins ? { bins: { min: o.bins.min, max: o.bins.max, default: o.bins.default } } : {}),
      ...(o.axisTitles ? { xTitle: { maxLength: 120 }, yTitle: { maxLength: 120 } } : {}),
    },
    groupBy: def.groupBy,
    colorDomain: def.colorRole ?? null,
    dataRequirements: def.dataRequirements,
    interactions: {
      tooltip: ["auto", "off"],
      legend: def.interactions.legendHighlight ? ["static", "highlight (needs a series binding)"] : ["static"],
      zoom: def.interactions.zoomX ? ["none", "x (temporal x only)"] : ["none"],
      brush: def.interactions.brush ? ["none", "interval"] : ["none"],
    },
    layout: { targets: def.layout.targets, modes: def.layout.modes, profiles: LAYOUT_PROFILES },
    examples: def.examples().map(e => e.name),
  }
}

export const recipeContracts = () => RECIPE_IDS.map(recipeContract)

/**
 * What charts_catalogue adds to an entry that is also a typed recipe: the recipe's contract and its examples as exact
 * charts_quick calls (`{ tool, input: { document, name } }`), each the full fixture, runnable as returned.
 */
export function recipeCatalogue(id: RecipeId) {
  const { layout, examples: _names, ...contract } = recipeContract(id)
  return {
    ...contract,
    layout: { targets: layout.targets, modes: layout.modes },
    examples: recipeDefinition(id).examples().map(e => ({ name: e.name, description: e.description, call: { tool: "quick", input: { document: e.document, name: e.name } } })),
  }
}
