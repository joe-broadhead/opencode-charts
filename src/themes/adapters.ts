import { seriesColours } from "./palette.js"
import type { ThemeTokens } from "./tokens.js"

type Json = Record<string, unknown>
const family = (name: string, fallback: string) => `${name}, ${fallback}`

/** Vega-Lite `config` from tokens. A spec's own `config` is merged over it, so a spec can still override anything. */
export function vegaLiteConfig(t: ThemeTokens): Json {
  const sans = family(t.font.family, "sans-serif"), c = t.colors
  // A theme's own categories first, then generated ones, so a chart never repeats a colour (palette.ts).
  const categorical = seriesColours(c.categorical, 20)
  const guideLabel = { font: sans, fontSize: t.font.labelSize, fill: c.muted }
  return {
    background: c.background,
    padding: t.layout.padding,
    font: sans,
    autosize: { type: "pad", contains: "padding" },
    view: { stroke: null, continuousWidth: t.layout.width, continuousHeight: t.layout.height, discreteWidth: { step: t.layout.step }, discreteHeight: { step: t.layout.step } },
    title: { color: c.text, font: sans, fontSize: t.font.titleSize, fontWeight: t.font.titleWeight, anchor: "start", offset: 14, subtitleColor: c.muted, subtitleFont: sans, subtitleFontSize: t.font.subtitleSize, subtitlePadding: 4, frame: "bounds" },
    axis: {
      domain: t.axis.domain, domainColor: c.axis, domainWidth: 1, ticks: t.axis.ticks, tickColor: c.axis, tickSize: 4,
      grid: t.axis.grid, gridColor: c.grid, gridDash: t.axis.gridDash, gridWidth: 1,
      labelColor: c.muted, labelFont: sans, labelFontSize: t.font.labelSize, labelPadding: t.axis.labelPadding, labelLimit: 180, labelOverlap: true, labelFlush: false,
      titleColor: c.text, titleFont: sans, titleFontSize: t.font.size, titleFontWeight: 500, titlePadding: 10,
    },
    axisX: { grid: false },
    axisY: { domain: false, labelPadding: t.axis.labelPadding + 2 },
    axisBand: { grid: false, ticks: false, domain: true },
    axisXDiscrete: { labelAngle: 0 },
    axisQuantitative: { tickCount: { signal: "max(2, min(10, ceil(height / 64)))" } },
    axisXQuantitative: { tickCount: { signal: "max(2, min(10, ceil(width / 96)))" } },
    axisXTemporal: { tickCount: { signal: "max(2, min(12, ceil(width / 90)))" } },
    axisYTemporal: { tickCount: { signal: "max(2, min(10, ceil(height / 64)))" } },
    legend: { labelColor: c.muted, labelFont: sans, labelFontSize: t.font.labelSize, labelLimit: 200, titleColor: c.text, titleFont: sans, titleFontSize: t.font.labelSize, titleFontWeight: 600, symbolType: "circle", symbolSize: 80, orient: t.legend.orient, rowPadding: 6, padding: 4 },
    header: { labelColor: c.muted, labelFont: sans, labelFontSize: t.font.labelSize + 1, titleColor: c.text, titleFont: sans, titleFontSize: t.font.size, titleFontWeight: 600 },
    range: { category: categorical, ordinal: c.sequential, ramp: c.sequential, heatmap: c.sequential, diverging: c.diverging },
    mark: { color: c.categorical[0], font: sans },
    bar: { cornerRadiusEnd: t.marks.cornerRadius, continuousBandSize: 8, discreteBandSize: { band: 0.72 } },
    rect: { cornerRadius: 0 },
    line: { strokeWidth: t.marks.strokeWidth, strokeCap: "round", strokeJoin: "round" },
    trail: { strokeWidth: t.marks.strokeWidth },
    rule: { color: c.axis, strokeWidth: 1 },
    area: { opacity: t.marks.opacity < 1 ? t.marks.opacity : 0.85, line: false },
    point: { size: t.marks.pointSize, filled: true, strokeWidth: 1.5 },
    circle: { size: t.marks.pointSize },
    square: { size: t.marks.pointSize },
    arc: { stroke: c.background === "transparent" ? null : c.background, strokeWidth: 1.5 },
    text: { color: c.text, font: sans, fontSize: t.font.labelSize },
    geoshape: { stroke: c.background === "transparent" ? c.grid : c.background, strokeWidth: 0.6 },
    boxplot: { median: { color: c.background === "transparent" ? c.text : c.background, strokeWidth: 2 }, rule: { color: c.axis }, outliers: { size: 20, color: c.muted } },
    tick: { thickness: 2 },
    style: {
      "guide-label": guideLabel,
      "guide-title": { font: sans, fill: c.text },
      "group-title": { font: sans, fill: c.text },
      "group-subtitle": { font: sans, fill: c.muted },
      "label": { font: sans, fill: c.text },
    },
    concat: { spacing: 24 },
    facet: { spacing: 18 },
  }
}

/** Vega `config` from tokens, for full Vega specs. */
export function vegaConfig(t: ThemeTokens): Json {
  const vl = vegaLiteConfig(t), c = t.colors, sans = family(t.font.family, "sans-serif")
  return {
    background: c.background,
    padding: t.layout.padding,
    title: vl.title,
    axis: vl.axis,
    axisX: vl.axisX,
    axisY: vl.axisY,
    axisBand: vl.axisBand,
    legend: vl.legend,
    range: vl.range,
    text: { fill: c.text, font: sans, fontSize: t.font.labelSize },
    symbol: { fill: c.categorical[0], size: t.marks.pointSize },
    rect: { fill: c.categorical[0] },
    line: { stroke: c.categorical[0], strokeWidth: t.marks.strokeWidth },
    arc: { fill: c.categorical[0] },
    area: { fill: c.categorical[0] },
    path: { stroke: c.axis },
    shape: { stroke: c.axis },
    rule: { stroke: c.axis },
    group: { fill: null },
    style: vl.style,
  }
}

/** An ECharts theme object from tokens. */
export function echartsTheme(t: ThemeTokens): Json {
  const c = t.colors, sans = family(t.font.family, "sans-serif")
  const categorical = seriesColours(c.categorical, 20)
  const axis = (grid: boolean) => ({
    axisLine: { show: t.axis.domain, lineStyle: { color: c.axis } },
    axisTick: { show: t.axis.ticks, lineStyle: { color: c.axis } },
    axisLabel: { color: c.muted, fontFamily: sans, fontSize: t.font.labelSize, hideOverlap: true },
    nameTextStyle: { color: c.text, fontFamily: sans, fontSize: t.font.size },
    splitLine: { show: grid, lineStyle: { color: c.grid, type: t.axis.gridDash.length ? t.axis.gridDash : "solid" } },
    splitArea: { show: false },
  })
  return {
    color: categorical,
    backgroundColor: c.background,
    textStyle: { fontFamily: sans, color: c.text, fontSize: t.font.size },
    title: { left: t.layout.padding, top: t.layout.padding / 2, textStyle: { color: c.text, fontFamily: sans, fontSize: t.font.titleSize, fontWeight: t.font.titleWeight }, subtextStyle: { color: c.muted, fontFamily: sans, fontSize: t.font.subtitleSize } },
    legend: { textStyle: { color: c.muted, fontFamily: sans, fontSize: t.font.labelSize }, icon: "circle", itemWidth: 10, itemHeight: 10 },
    categoryAxis: axis(false),
    valueAxis: axis(t.axis.grid),
    timeAxis: axis(false),
    logAxis: axis(t.axis.grid),
    line: { lineStyle: { width: t.marks.strokeWidth }, symbolSize: 6, smooth: false },
    bar: { itemStyle: { borderRadius: t.marks.cornerRadius } },
    pie: { itemStyle: { borderColor: c.background, borderWidth: 1.5 }, label: { color: c.text, fontFamily: sans } },
    sankey: { lineStyle: { color: "source", opacity: 0.35, curveness: 0.5 }, label: { color: c.text, fontFamily: sans, fontSize: t.font.labelSize }, itemStyle: { borderWidth: 0 } },
    chord: { label: { color: c.text, fontFamily: sans } },
    funnel: { label: { color: c.text, fontFamily: sans }, itemStyle: { borderColor: c.background, borderWidth: 1 } },
    gauge: { axisLine: { lineStyle: { color: [[1, c.grid]] } }, progress: { itemStyle: { color: c.categorical[0] } }, axisLabel: { color: c.muted, fontFamily: sans }, title: { color: c.muted, fontFamily: sans }, detail: { color: c.text, fontFamily: sans } },
    radar: { axisName: { color: c.muted, fontFamily: sans }, splitLine: { lineStyle: { color: c.grid } }, splitArea: { show: false }, axisLine: { lineStyle: { color: c.grid } } },
    candlestick: { itemStyle: { color: c.positive, color0: c.negative, borderColor: c.positive, borderColor0: c.negative } },
    calendar: { itemStyle: { color: c.background, borderColor: c.grid }, splitLine: { lineStyle: { color: c.axis } }, dayLabel: { color: c.muted, fontFamily: sans }, monthLabel: { color: c.muted, fontFamily: sans }, yearLabel: { color: c.text, fontFamily: sans } },
    visualMap: { inRange: { color: c.sequential }, textStyle: { color: c.muted, fontFamily: sans } },
    treemap: { itemStyle: { borderColor: c.background, gapWidth: 1 }, label: { fontFamily: sans } },
    sunburst: { itemStyle: { borderColor: c.background, borderWidth: 1 }, label: { fontFamily: sans } },
    graph: { lineStyle: { color: c.axis, opacity: 0.6 }, label: { color: c.text, fontFamily: sans } },
    parallel: { parallelAxisDefault: axis(false) },
    themeRiver: { label: { color: c.text, fontFamily: sans } },
  }
}
