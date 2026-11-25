import { renderer } from "../renderer-load.js"
import { toolEntry } from "../tool-table.js"
import { parseInput } from "./input.js"
import type { HandlerCall, MethodHandler } from "./types.js"

const entry = toolEntry("theme_save")

/** charts.theme_save: a named theme written to .charts/themes/<name>.json. It overwrites, so it asks. */
export const themeSave: MethodHandler = {
  description: entry.description,
  input: entry.input,
  output: entry.output,
  async run(env, raw, _call: HandlerCall) {
    const input = await parseInput("theme_save", raw)
    const { runThemeSave } = await renderer()
    return runThemeSave(env, input)
  },
}
