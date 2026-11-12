// The Vega runtime inlined into interactive HTML.
import * as vega from "vega"
import { Handler } from "vega-tooltip"

const g = globalThis as Record<string, unknown>
g.vega = vega
g.vegaTooltip = { Handler }
