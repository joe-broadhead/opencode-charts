import { renderer } from "../renderer-load.js"
import { toolEntry } from "../tool-table.js"
import { parseInput } from "./input.js"
import type { HandlerCall, MethodHandler } from "./types.js"

const entry = toolEntry("diagram")

/** charts.diagram: Mermaid source or a structured recipe, as SVG plus a Unicode outline. */
export const diagram: MethodHandler = {
  description: entry.description,
  input: entry.input,
  output: entry.output,
  async run(env, raw, _call: HandlerCall) {
    const input = await parseInput("diagram", raw)
    const { runDiagram } = await renderer()
    return (await runDiagram(env, input)).output
  },
}
