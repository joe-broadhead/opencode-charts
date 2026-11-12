// The Vega runtime inlined into interactive HTML. vega-interpreter evaluates parsed expression trees, so the page
// runs under a Content-Security-Policy without 'unsafe-eval': the HTML parses with {ast: true} and passes it as `expr`.
import * as vega from "vega"
import { expressionInterpreter } from "vega-interpreter"
import { Handler } from "vega-tooltip"
import { compactFormat } from "../engines/compact.js"

const g = globalThis as Record<string, unknown>
g.vega = vega
g.vegaInterpreter = expressionInterpreter
g.vegaTooltip = { Handler }
// The compact number format the static chart used, registered by the page as the `compact` expression function.
g.chartsCompact = compactFormat
