import { renderer } from "../renderer-load.js"
import { toolEntry } from "../tool-table.js"
import { parseInput } from "./input.js"
import type { HandlerCall, MethodHandler } from "./types.js"

const entry = toolEntry("table")

/** charts.table: a publication data-graphic table with inline nanoplots. */
export const table: MethodHandler = {
  description: entry.description,
  input: entry.input,
  output: entry.output,
  async run(env, raw, _call: HandlerCall) {
    const input = await parseInput("table", raw)
    const { runTable } = await renderer()
    return (await runTable(env, input)).output
  },
}
