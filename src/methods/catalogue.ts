import { CATALOGUE, catalogueEntry, exampleCall } from "../catalogue.js"
import { ATLASES, type Json } from "../engines/common.js"
import { ChartsError, suggest } from "../errors.js"
import { isRecipeId, recipeCatalogue } from "../recipes/registry.js"
import type { ToolEnvironment } from "../tools.js"

/** tools.charts.catalogue: every chart type by family, and with an id its full working example. */
export function runCatalogue(_env: ToolEnvironment, input: Record<string, unknown>): Json {
  if (input.id) {
    const entry = catalogueEntry(String(input.id))
    if (!entry) throw new ChartsError("CHART_TYPE_UNKNOWN", `There is no chart type "${input.id}".${suggest(String(input.id), CATALOGUE.map(c => c.id)).map(s => ` Did you mean ${s}?`).join("")}`, "Call charts.catalogue without an id to list them.")
    const call = exampleCall(entry)
    const recipe = isRecipeId(entry.id) ? recipeCatalogue(entry.id) : undefined
    return { ...entry, example: call, ...(recipe ? { recipe } : {}) } as unknown as Json
  }
  const list = CATALOGUE.filter(c => !input.family || c.family === input.family)
  return {
    types: list.map(c => ({ id: c.id, name: c.name, engine: c.engine, family: c.family, when: c.when, ...(c.avoid ? { avoid: c.avoid } : {}), ...(isRecipeId(c.id) ? { recipe: true } : {}) })),
    atlases: Object.fromEntries(Object.entries(ATLASES).map(([key, atlas]) => [key, { about: atlas.about, keys: atlas.keys }])),
  } as unknown as Json
}
