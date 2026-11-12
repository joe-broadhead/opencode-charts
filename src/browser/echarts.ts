// The ECharts runtime inlined into interactive HTML: the browser half of `runtime-support.ts`'s module table.
import * as echarts from "echarts/core"
import { echartsModules } from "../engines/echarts-install.js"

echarts.use(echartsModules("browser"))
;(globalThis as Record<string, unknown>).echarts = echarts
