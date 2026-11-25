import { renderer } from "../renderer-load.js"
import { toolEntry } from "../tool-table.js"
import { parseInput } from "./input.js"
import type { HandlerCall, MethodHandler } from "./types.js"

const entry = toolEntry("themes")

/** charts.themes: the built-in and saved themes, one theme's tokens, or a preview from a UI seed. */
export const themes: MethodHandler = {
  description: entry.description,
  input: entry.input,
  output: entry.output,
  async run(env, raw, _call: HandlerCall) {
    const input = await parseInput("themes", raw)
    const { runThemes } = await renderer()
    return runThemes(env, input)
  },
}
