import * as vega from "vega"
import { ChartsError } from "../errors.js"
import type { FontBook } from "../fonts.js"
import { checkCardinality, deniedLoader } from "../safety.js"
import { compactFormat, type Json } from "./common.js"
import { installWordcloud } from "./wordcloud.js"

const V = vega as unknown as {
  textMetrics: { width: (item: { fontSize?: number; font?: string; fontWeight?: string | number }, text: unknown) => number }
  setRandom: (r: () => number) => void
  randomLCG: (seed: number) => () => number
  expressionFunction: (name: string, fn: unknown) => void
}

let metricsInstalled: FontBook | undefined
/** Vega measures every label with the bundled font tables (vega's documented hook for a user text-metrics function). */
export function installMetrics(fonts: FontBook) {
  if (metricsInstalled === fonts) return
  installWordcloud(fonts)
  V.textMetrics.width = (item, text) => {
    const s = text == null ? "" : String(text).trim()
    const size = item.fontSize != null ? +item.fontSize || 0 : 11
    return size <= 0 || !s ? 0 : fonts.measure(s, size, item.font, item.fontWeight)
  }
  metricsInstalled = fonts
}

let functionsInstalled = false
function installFunctions() {
  if (functionsInstalled) return
  V.expressionFunction("compact", compactFormat)
  functionsInstalled = true
}

export interface VegaRender { readonly svg: string; readonly width: number; readonly height: number; readonly warnings: string[] }

/** Renders a full Vega spec to SVG with no network, the bundled fonts and a fixed seed. */
export async function renderVegaInProcess(spec: Json, fonts: FontBook, seed: number): Promise<VegaRender> {
  installMetrics(fonts)
  installFunctions()
  checkCardinality(spec)
  V.setRandom(V.randomLCG(seed))
  const warnings: string[] = []
  const logger = { level(_?: number) { return logger }, error: (...a: unknown[]) => { warnings.push(a.map(String).join(" ")); return logger }, warn: (...a: unknown[]) => { warnings.push(a.map(String).join(" ")); return logger }, info: () => logger, debug: () => logger }
  let runtime
  try { runtime = vega.parse(spec as never) }
  catch (error) { throw new ChartsError("SPEC_INVALID", `Vega could not parse the spec: ${(error as Error).message}`, "Fix the named property; charts_catalogue has working Vega examples.") }
  const view = new vega.View(runtime, { renderer: "none", loader: deniedLoader() as never, logger: logger as never, logLevel: vega.Warn })
  try {
    await view.runAsync()
    const svg = await view.toSVG()
    return { svg, width: view.width(), height: view.height(), warnings: warnings.filter(w => !/Can not resolve event source: window/.test(w)) }
  } catch (error) {
    if (error instanceof ChartsError) throw error
    throw new ChartsError("RENDER_FAILED", `Vega could not render the chart: ${(error as Error).message}`, "Check field names and transforms against the data; charts_validate explains each problem.")
  } finally {
    view.finalize()
  }
}
