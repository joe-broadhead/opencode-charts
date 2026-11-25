import { renderer } from "../renderer-load.js"
import { toolEntry } from "../tool-table.js"
import { parseInput } from "./input.js"
import type { HandlerCall, MethodHandler } from "./types.js"

const entry = toolEntry("recommend")

/** charts.recommend: which chart fits this question, this data and this medium. It never renders. */
export const recommend: MethodHandler = {
  description: entry.description,
  input: entry.input,
  output: entry.output,
  async run(env, raw, _call: HandlerCall) {
    const input = await parseInput("recommend", raw)
    const { runRecommend } = await renderer()
    return runRecommend(env, input)
  },
}
