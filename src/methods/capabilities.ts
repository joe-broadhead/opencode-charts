import { capabilities } from "../capabilities.js"
import type { Json } from "../engines/common.js"
import type { ToolEnvironment } from "../tools.js"

/** tools.charts.capabilities: exactly what this build can do, computed rather than promised. */
export function runCapabilities(env: ToolEnvironment): Json {
  return capabilities(env) as unknown as Json
}
