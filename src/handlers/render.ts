import { renderer } from "../renderer-load.js"
import { toolEntry } from "../tool-table.js"
import { parseInput } from "./input.js"
import type { HandlerCall, MethodHandler } from "./types.js"

const entry = toolEntry("render")

/** charts.render: any chart from a spec, a chart document or a saved artifact, written under outputs/charts. */
export const render: MethodHandler = {
  description: entry.description,
  input: entry.input,
  output: entry.output,
  async run(env, raw, _call: HandlerCall) {
    const input = await parseInput("render", raw)
    const { runChart } = await renderer()
    return (await runChart(env, "render", input)).output
  },
}
