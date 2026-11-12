// Recipe documents prepared and drawn through the shared core, as the tools adapter does: one environment, the
// built-in themes, transforms through the plugin's own runner.
import { applyTransforms } from "../../src/data.ts"
import { prepareDocument, type CreationEnvironment, type Prepared } from "../../src/document/index.ts"
import { renderRecipe, type Delivery } from "../../src/layout/fit.ts"
import type { Environment } from "../../src/pipeline.ts"
import { BUILTIN_THEMES } from "../../src/themes/tokens.ts"

export function creation(theme = "light", over: Partial<CreationEnvironment> = {}): CreationEnvironment {
  return {
    locale: "en-US", seed: 1,
    theme: { name: theme, tokens: BUILTIN_THEMES[theme]! },
    fonts: [],
    generator: { plugin: "test", engines: {} },
    transform: (rows, transform) => applyTransforms(rows as never, transform as never) as never,
    ...over,
  }
}

export const prepare = (doc: unknown, theme = "light", over: Partial<CreationEnvironment> = {}): Promise<Prepared> => prepareDocument(doc, undefined, creation((doc as { appearance?: { theme?: string } }).appearance?.theme ?? theme, over))

/** Prepares and draws a recipe document; with `write` the delivery's files are published. */
export async function draw(env: Environment, doc: unknown, delivery: Delivery = { formats: ["svg", "html"] }, write = false) {
  const prepared = await prepare(doc)
  return { prepared, ...(await renderRecipe(prepared, env, delivery, write)) }
}
