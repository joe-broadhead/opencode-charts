// The ECharts runtime inlined into interactive HTML: the browser half of `runtime-support.ts`'s module table.
import * as echarts from "echarts/core"
import { compactFormat } from "../engines/compact.js"
import { echartsModules } from "../engines/echarts-install.js"
import { findTooltipMarkup } from "../engines/echarts-markup.js"

echarts.use(echartsModules("browser"))
;(globalThis as Record<string, unknown>).echarts = echarts
;(globalThis as Record<string, unknown>).chartsCompact = compactFormat
;(globalThis as Record<string, unknown>).chartsTooltipMarkup = findTooltipMarkup
