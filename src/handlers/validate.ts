import { renderer } from "../renderer-load.js"
import { toolEntry } from "../tool-table.js"
import { parseInput } from "./input.js"
import type { HandlerCall, MethodHandler } from "./types.js"

const entry = toolEntry("validate")

/** charts.validate: the same checks as a render, writing nothing. */
export const validate: MethodHandler = {
  description: entry.description,
  input: entry.input,
  output: entry.output,
  async run(env, raw, _call: HandlerCall) {
    const input = await parseInput("validate", raw)
    const { runChart } = await renderer()
    return (await runChart(env, "validate", input)).output
  },
}
