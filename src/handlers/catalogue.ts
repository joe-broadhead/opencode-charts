import { renderer } from "../renderer-load.js"
import { toolEntry } from "../tool-table.js"
import { parseInput } from "./input.js"
import type { HandlerCall, MethodHandler } from "./types.js"

const entry = toolEntry("catalogue")

/** charts.catalogue: every chart type by family; with an id, its full working example. */
export const catalogue: MethodHandler = {
  description: entry.description,
  input: entry.input,
  output: entry.output,
  async run(env, raw, _call: HandlerCall) {
    const input = await parseInput("catalogue", raw)
    const { runCatalogue } = await renderer()
    return runCatalogue(env, input)
  },
}
