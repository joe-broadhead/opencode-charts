import { renderer } from "../renderer-load.js"
import { toolEntry } from "../tool-table.js"
import type { HandlerCall, MethodHandler } from "./types.js"

const entry = toolEntry("capabilities")

/** charts.capabilities: engines, formats, themes, fonts, limits and tools, computed from this build. */
export const capabilities: MethodHandler = {
  description: entry.description,
  input: entry.input,
  output: entry.output,
  async run(env, _input, _call: HandlerCall) {
    const { runCapabilities } = await renderer()
    return runCapabilities(env)
  },
}
