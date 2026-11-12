import type { JsonObject, EngineId } from "./types.js"

/** Vega-Lite has `mark` or a composition; Vega has `marks`; ECharts has `series`. The renderer's own rule, without file access. */
export function detectEngine(spec: JsonObject): EngineId {
  const schema = typeof spec.$schema === "string" ? spec.$schema : ""
  if (/vega-lite/.test(schema)) return "vega-lite"
  if (/vega\/v\d/.test(schema)) return "vega"
  if (spec.series !== undefined) return "echarts"
  if (Array.isArray(spec.marks) || Array.isArray(spec.signals) || Array.isArray(spec.scales)) return "vega"
  return "vega-lite"
}
