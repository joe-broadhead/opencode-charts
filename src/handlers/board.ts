import { renderer } from "../renderer-load.js"
import { toolEntry } from "../tool-table.js"
import { parseInput } from "./input.js"
import type { HandlerCall, MethodHandler } from "./types.js"

const entry = toolEntry("board")

/** charts.board: a dashboard document published as SVG, PNG, offline HTML and its .board.json. */
export const board: MethodHandler = {
  description: entry.description,
  input: entry.input,
  output: entry.output,
  async run(env, raw, _call: HandlerCall) {
    const input = await parseInput("board", raw)
    const { runBoard } = await renderer()
    return (await runBoard(env, input)).output
  },
}
