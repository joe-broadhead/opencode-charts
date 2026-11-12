import { BarChart, BoxplotChart, CandlestickChart, ChordChart, EffectScatterChart, FunnelChart, GaugeChart, GraphChart, HeatmapChart, LineChart, ParallelChart, PictorialBarChart, PieChart, RadarChart, SankeyChart, ScatterChart, SunburstChart, ThemeRiverChart, TreeChart, TreemapChart } from "echarts/charts"
import { AriaComponent, CalendarComponent, DatasetComponent, GraphicComponent, GridComponent, LegendComponent, MarkAreaComponent, MarkLineComponent, MarkPointComponent, ParallelComponent, PolarComponent, RadarComponent, SingleAxisComponent, TitleComponent, TooltipComponent, TransformComponent, VisualMapComponent } from "echarts/components"
import { SVGRenderer } from "echarts/renderers"
import { ECHARTS_MODULES, type EChartsModuleName } from "../runtime-support.js"

/** The class behind each module `runtime-support.ts` names: exactly those, no more, no fewer. */
const CLASSES: Readonly<Record<EChartsModuleName, unknown>> = {
  BarChart, BoxplotChart, CandlestickChart, ChordChart, EffectScatterChart, FunnelChart, GaugeChart, GraphChart, HeatmapChart, LineChart, ParallelChart, PictorialBarChart, PieChart, RadarChart, SankeyChart, ScatterChart, SunburstChart, ThemeRiverChart, TreeChart, TreemapChart,
  AriaComponent, CalendarComponent, DatasetComponent, GraphicComponent, GridComponent, LegendComponent, MarkAreaComponent, MarkLineComponent, MarkPointComponent, ParallelComponent, PolarComponent, RadarComponent, SingleAxisComponent, TitleComponent, TooltipComponent, TransformComponent, VisualMapComponent,
  SVGRenderer,
}

/** The modules to register for one runtime, in table order. */
export function echartsModules(where: "server" | "browser"): never[] {
  return ECHARTS_MODULES.filter(m => m[where]).map(m => CLASSES[m.name]) as never[]
}
