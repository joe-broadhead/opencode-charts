import { renderer } from "../renderer-load.js"
import { toolEntry } from "../tool-table.js"
import { parseInput } from "./input.js"
import type { HandlerCall, MethodHandler } from "./types.js"

const entry = toolEntry("update")

/** charts.update: change a saved chart's presentation into a new generation folder. */
export const update: MethodHandler = {
  description: entry.description,
  input: entry.input,
  output: entry.output,
  async run(env, raw, _call: HandlerCall) {
    const input = await parseInput("update", raw)
    const { runUpdate } = await renderer()
    return (await runUpdate(env, input)).output
  },
}
