import { renderer } from "../renderer-load.js"
import { toolEntry } from "../tool-table.js"
import { parseInput } from "./input.js"
import type { HandlerCall, MethodHandler } from "./types.js"

const entry = toolEntry("quick")

/** charts.quick: a standard chart from a type and field names, or a typed recipe document. */
export const quick: MethodHandler = {
  description: entry.description,
  input: entry.input,
  output: entry.output,
  async run(env, raw, _call: HandlerCall) {
    const input = await parseInput("quick", raw)
    const { runChart } = await renderer()
    return (await runChart(env, "quick", input)).output
  },
}
