import type { Row } from "./data.js"
import type { Json } from "./engines/common.js"
import { EU_COUNTRY_TILE_GRID, US_STATE_HEX_GRID, computeFlowArcs, hexGridExtent, hexPolygon, swarmOffsets } from "./geo/cartograms.js"
import type { Engine } from "./safety.js"

/**
 * Every chart type the plugin knows, with a small working example. The same entries are the agent's catalogue
 * (charts_catalogue), the cookbook skill's source, the gallery, and the golden tests: an example that stops rendering
 * fails the build.
 */
export type Family = "comparison" | "trend" | "distribution" | "part-to-whole" | "relationship" | "flow" | "hierarchy" | "map" | "text" | "table" | "diagram"
export interface Example {
  readonly spec: Json
  readonly rows?: Row[]
  readonly title: string
  readonly currency?: string
  readonly locale?: string
  readonly width?: number
  readonly height?: number
}
export interface ChartType {
  readonly id: string
  readonly name: string
  readonly engine: Engine
  readonly family: Family
  /** When to use it. */
  readonly when: string
  /** When not to, and what to use instead. */
  readonly avoid?: string
  readonly example: () => Example
}

// Deterministic sample data: no randomness, so examples and golden files never drift.
const MONTHS = Array.from({ length: 12 }, (_, i) => `2024-${String(i + 1).padStart(2, "0")}-01`)
const wave = (i: number, base: number, amp: number, phase = 0) => Number((base + amp * Math.sin(i / 1.9 + phase) + i * base * 0.02).toPrecision(4))
const REGIONS = ["North", "South", "East", "West"]
const months = (series: string[], base: number, amp: number, field = "value"): Row[] => series.flatMap((s, k) => MONTHS.map((date, i) => ({ date, series: s, [field]: wave(i, base * (1 + k * 0.35), amp, k) })))
const PRODUCTS = [{ product: "Lattes", revenue_eur: 182400 }, { product: "Pastries", revenue_eur: 96300 }, { product: "Beans", revenue_eur: 141900 }, { product: "Tea", revenue_eur: 54200 }, { product: "Merch", revenue_eur: 23800 }]
const COUNTRIES = ["Germany", "France", "Spain", "Italy", "Netherlands", "Poland", "Sweden", "Belgium", "Austria", "Portugal", "Ireland", "Denmark"]
/** 10000 as "10,000": ECharts label templates print a raw value, so an example that labels counts carries them formatted. */
const grouped = (n: number) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ",")
const vl = (spec: Json): Json => ({ $schema: "https://vega.github.io/schema/vega-lite/v6.json", ...spec })
const quarterRows = REGIONS.flatMap((region, r) => ["Q1", "Q2", "Q3", "Q4"].map((quarter, q) => ({ region, quarter, revenue_eur: Math.round(400000 + r * 90000 + q * 45000 + ((r * 7 + q * 3) % 5) * 30000) })))
const scatterRows = Array.from({ length: 60 }, (_, i) => ({ spend_k: Math.round((5 + (i * 37) % 95) * 10) / 10, conversions: Math.round(20 + ((i * 37) % 95) * 2.1 + ((i * 53) % 40) - 20), channel: ["Search", "Social", "Email"][i % 3]!, customers: 50 + (i * 29) % 400 }))
const distRows = Array.from({ length: 240 }, (_, i) => { const g = ["A", "B", "C"][i % 3]!; const u = ((i * 7919) % 1000) / 1000, v = ((i * 104729) % 1000) / 1000; const z = Math.sqrt(-2 * Math.log(u + 0.0005)) * Math.cos(2 * Math.PI * v); return { group: g, latency_ms: Math.round((120 + (g === "B" ? 40 : g === "C" ? -25 : 0) + z * 28) * 10) / 10 } })
const tree: Row[] = [
  { id: "root", parent: null, name: "Company", size: 0, group: "Company" },
  ...[["Product", ["Web", "Mobile", "Desktop"]], ["Sales", ["EMEA", "Americas", "APAC"]], ["Ops", ["Support", "Finance"]], ["Research", ["ML", "Design"]]].flatMap(([dept, teams], d) => [
    { id: dept, parent: "root", name: dept, size: 0, group: dept },
    ...(teams as string[]).map((t, k) => ({ id: `${dept}/${t}`, parent: dept, name: t, size: 20 + ((d * 5 + k * 11) % 9) * 12, group: dept })),
  ]),
]

// ---------------------------------------------------------------------------------------------------------------
// The second wave: Plot statistics and cartograms, ECharts 6, data-graphic tables and offline diagrams.
//
// Every example stays plain JSON, so `src/document/` can import this module without reaching an engine: a spec names
// theme tokens (`theme:categorical.0`, `theme:sequential`) that the renderer substitutes from the active theme, and the
// geometry a spec needs (a density curve, a waffle's squares, a hexagon's corners) is worked out here in arithmetic.

/** A deterministic 220-row cloud: two correlated measures, tight in the middle and sparse at the edge. */
const cloud: Row[] = Array.from({ length: 220 }, (_, i) => {
  const u = ((i * 7919) % 1000) / 1000 + 0.0005
  const v = ((i * 104729) % 1000) / 1000
  const z1 = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
  const z2 = Math.sqrt(-2 * Math.log(u)) * Math.sin(2 * Math.PI * v)
  return { spend_k: Math.round(Math.max(6, 52 + z1 * 15) * 10) / 10, conversions: Math.round(Math.max(8, 128 + z2 * 24 + z1 * 14)) }
})
const weeklySessions: Row[] = Array.from({ length: 52 }, (_, i) => ({ week: i + 1, sessions: Math.round(wave(i, 4200, 620, 0.4)) }))
const planActual: Row[] = Array.from({ length: 28 }, (_, i) => ({ day: i + 1, plan: 100 + i * 2, actual: Math.round((100 + i * 2 + Math.sin(i / 2.2) * 9 + ((i * 7) % 5) - 2) * 10) / 10 }))
const composition: Row[] = [{ category: "Lattes", value: 1824 }, { category: "Pastries", value: 963 }, { category: "Beans", value: 1419 }, { category: "Tea", value: 542 }, { category: "Merch", value: 238 }]
const arrowRows: Row[] = [
  { label: "Enterprise", start: 118, end: 132, from: 64, to: 71 },
  { label: "Self-serve", start: 72, end: 96, from: 38, to: 47 },
  { label: "Partners", start: 64, end: 58, from: 29, to: 34 },
  { label: "SMB", start: 96, end: 88, from: 51, to: 45 },
]
/** Where each arrow's label sits: clear of its own head, and inside the plot's own domain. */
const arrowLabels: readonly { index: number; dx: number; dy: number; anchor: "start" | "middle" | "end" }[] = [
  { index: 0, dx: 10, dy: -9, anchor: "start" },
  { index: 1, dx: 10, dy: 3, anchor: "start" },
  { index: 2, dx: 0, dy: -11, anchor: "middle" },
  { index: 3, dx: -10, dy: 14, anchor: "end" },
]
const horizonRows: Row[] = Array.from({ length: 120 }, (_, i) => ({ day: i + 1, page_views: Math.round(40 + Math.sin(i / 5) * 18 + Math.cos(i / 2) * 7 + 26) }))
const flowRows: Row[] = [
  { originLat: 40.7, originLon: -74, destLat: 51.5, destLon: -0.1, value: 9, label: "New York" },
  { originLat: 40.7, originLon: -74, destLat: 25.2, destLon: 55.3, value: 4, label: "New York" },
  { originLat: 35.7, originLon: 139.7, destLat: 1.35, destLon: 103.8, value: 6, label: "Tokyo" },
  { originLat: 51.5, originLon: -0.1, destLat: -33.9, destLon: 151.2, value: 3, label: "London" },
  { originLat: 49, originLon: 2.5, destLat: 40.7, destLon: -74, value: 5, label: "Paris" },
  { originLat: -23.5, originLon: -46.6, destLat: 51.5, destLon: -0.1, value: 2, label: "São Paulo" },
]
const usCartogram: Row[] = US_STATE_HEX_GRID.map((cell, i) => ({ postal: cell.postal, state: cell.name, broadband_pct: 62 + ((i * 37) % 34) }))
const euCartogram: Row[] = EU_COUNTRY_TILE_GRID.map((cell, i) => ({ iso3: cell.iso3, country: cell.name, index_points: 10 + ((i * 29) % 81) }))
const matrixRows: Row[] = [
  { region: "North", revenue: 182, margin: 24, nps: 62, churn: 8 },
  { region: "South", revenue: 143, margin: 18, nps: 51, churn: 12 },
  { region: "East", revenue: 206, margin: 27, nps: 68, churn: 6 },
  { region: "West", revenue: 118, margin: 21, nps: 44, churn: 15 },
]
const tableRows: Row[] = [
  { region: "North", revenue: 1240500, growth: 0.142, status: "On track", trend: [12, 15, 11, 19, 24], mix: "Enterprise" },
  { region: "South", revenue: 890400, growth: -0.031, status: "At risk", trend: [18, 16, 14, 13, 12], mix: "SMB" },
  { region: "East", revenue: 1430250, growth: 0.225, status: "Ahead", trend: [9, 12, 14, 17, 21], mix: "Enterprise" },
  { region: "West", revenue: 612800, growth: 0.064, status: "On track", trend: [14, 13, 15, 16, 15], mix: "SMB" },
]
const kpiRows: Row[] = [
  { team: "Support", csat: 91, csat_target: 88, tickets_share: 0.34, weekly: [82, 86, 88, 90, 91] },
  { team: "Sales", csat: 84, csat_target: 90, tickets_share: 0.21, weekly: [79, 82, 83, 84, 84] },
  { team: "Success", csat: 88, csat_target: 86, tickets_share: 0.27, weekly: [80, 81, 84, 86, 88] },
  { team: "Platform", csat: 93, csat_target: 92, tickets_share: 0.18, weekly: [88, 89, 91, 92, 93] },
]

/** A Gaussian kernel density on `steps` points across [from, to], normalised so the tallest point is 1. */
function kernelDensity(values: readonly number[], steps: number, from: number, to: number): { x: number; d: number }[] {
  const n = Math.max(1, values.length)
  const mean = values.reduce((sum, value) => sum + value, 0) / n
  const deviation = Math.sqrt(values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / n)
  const sorted = [...values].sort((a, b) => a - b)
  const quantile = (q: number) => {
    const at = (sorted.length - 1) * q, low = Math.floor(at), high = Math.ceil(at)
    return sorted[low]! + (sorted[high]! - sorted[low]!) * (at - low)
  }
  const interquartile = quantile(0.75) - quantile(0.25)
  const bandwidth = Math.max(1.06 * deviation * n ** -0.2, 0.9 * (interquartile / 1.34) * n ** -0.2, (to - from) / 80, 1e-6)
  const raw = Array.from({ length: steps }, (_, i) => {
    const x = from + ((to - from) * i) / Math.max(1, steps - 1)
    return { x, d: sorted.reduce((sum, value) => sum + Math.exp(-0.5 * ((x - value) / bandwidth) ** 2), 0) / (n * bandwidth) }
  })
  const peak = Math.max(...raw.map(point => point.d)) || 1
  return raw.map(point => ({ x: point.x, d: point.d / peak }))
}

/** The stacked curves a ridgeline draws, with the label position for each category. */
function ridgeline(rows: readonly Row[], value: string, category: string, bins: number): { areas: Row[]; labels: Row[] } {
  const groups = new Map<string, number[]>()
  for (const row of rows) {
    const key = row[category], number = row[value]
    if (key === undefined || key === null || typeof number !== "number" || !Number.isFinite(number)) continue
    const list = groups.get(String(key))
    if (list) list.push(number)
    else groups.set(String(key), [number])
  }
  const names = [...groups.keys()].sort().reverse()
  const all = [...groups.values()].flat()
  if (all.length === 0) return { areas: [], labels: [] }
  const from = Math.min(...all), to = Math.max(...all), span = to - from || 1
  const areas: Row[] = [], labels: Row[] = []
  names.forEach((name, index) => {
    const base = names.length - 1 - index
    for (const point of kernelDensity(groups.get(name)!, Math.max(8, Math.min(200, bins)), from, to)) areas.push({ x: point.x, base, ridge: base + point.d * 0.92, category: name })
    labels.push({ x: from + span * 0.015, ridge: base + 0.34, category: name })
  })
  return { areas, labels }
}

/** A horizon strip: each value folded into `levels` bands that share the same vertical space. */
function horizonBands(rows: readonly Row[], x: string, value: string, levels: number): Row[] {
  const usable = rows.flatMap(row => {
    const at = row[x], measured = row[value]
    return typeof at === "number" && typeof measured === "number" && Number.isFinite(at) && Number.isFinite(measured) ? [{ x: at, v: measured }] : []
  })
  if (usable.length === 0) return []
  const top = Math.max(...usable.map(row => row.v), 0) || 1
  const count = Math.max(1, Math.min(8, Math.round(levels)))
  const step = top / count
  const out: Row[] = []
  for (let band = 0; band < count; band++) for (const row of usable) {
    const filled = Math.min(Math.max((row.v - band * step) / step, 0), 1)
    out.push({ x: row.x, y0: 0, y1: filled, band })
  }
  return out
}

/** A waffle's squares: `grid × grid` cells, filled in proportion to each part, column-major from the bottom left. */
function waffleCells(parts: readonly { name: string; value: number }[], grid: number, cell: number): { cells: Row[]; order: string[]; counts: number[] } {
  const order = [...parts].sort((a, b) => b.value - a.value || a.name.localeCompare(b.name))
  const squares = grid * grid
  const total = order.reduce((sum, part) => sum + Math.max(0, part.value), 0) || 1
  const exact = order.map(part => (Math.max(0, part.value) / total) * squares)
  const counts = exact.map(value => Math.floor(value))
  let left = squares - counts.reduce((sum, value) => sum + value, 0)
  for (const { index } of exact.map((value, index) => ({ index, remainder: value - Math.floor(value) })).sort((a, b) => b.remainder - a.remainder || a.index - b.index)) {
    if (left <= 0) break
    counts[index]! += 1
    left -= 1
  }
  const inset = Math.max(1, cell * 0.06)
  const cells: Row[] = []
  let index = 0
  for (let series = 0; series < order.length; series++) {
    for (let n = 0; n < counts[series]!; n++, index++) {
      const column = Math.floor(index / grid), row = index % grid
      cells.push({ x1: column * cell + inset, x2: (column + 1) * cell - inset, y1: row * cell + inset, y2: (row + 1) * cell - inset, series })
    }
  }
  return { cells, order: order.map(part => part.name), counts }
}

// The cartograms share one frame: a map area, a legend column beside it, and a small outer pad, so one data unit is
// one pixel and the hexagons stay regular.
const CART_PAD = 10, CART_LEGEND = 104
/** Three steps of each theme's own sequential ramp, from its middle to its darkest end: white ink reads on the light
 * theme's fills and the theme's background ink on the dark theme's, so one spec labels itself in both. */
const CART_RAMP = ["theme:sequential.5", "theme:sequential.6", "theme:sequential.7"]
const bucketOf = (value: number, min: number, max: number, count: number) => (max === min ? 0 : Math.min(count - 1, Math.max(0, Math.floor(((value - min) / (max - min)) * count))))
/** A legend tick as a whole number: a cartogram's scale is a ranking, and two decimals of it are noise on the ramp. */
const compactNumber = (value: number) => String(Math.round(value))

/** A four-step legend drawn with ordinary marks: swatches, the range's ends and a title. */
function cartogramLegend(x: number, top: number, height: number, min: number, max: number, title: string, fontSize: number): Json[] {
  const step = height / CART_RAMP.length
  const marks: Json[] = CART_RAMP.map((fill, index) => ({ type: "rect", data: [{ x1: x, x2: x + 20, y1: top - (index + 1) * step, y2: top - index * step }], x1: "x1", x2: "x2", y1: "y1", y2: "y2", fill, stroke: "theme:background", strokeWidth: 0.5 }))
  const ticks = [max, (min + max) / 2, min], at = [top, top - height / 2, top - height]
  ticks.forEach((tick, index) => marks.push({ type: "text", data: [{ x: x + 26, y: at[index], text: compactNumber(tick) }], x: "x", y: "y", text: "text", textAnchor: "start", fill: "theme:muted", fontSize }))
  marks.push({ type: "text", data: [{ x, y: top + 16, text: title }], x: "x", y: "y", text: "text", textAnchor: "start", fill: "theme:text", fontSize: fontSize + 1, fontWeight: 600 })
  return marks
}

/** The fill a label sits on: ink is the theme's background, which is the light ink on a light theme and the dark one on a dark theme. */
const cartogramLabels = (data: Row[], fontSize: number): Json => ({ type: "text", data, x: "x", y: "y", text: "text", textAnchor: "middle", fill: "theme:background", fontWeight: 600, fontSize })

/** A US state hex cartogram: all 51 states and DC as equal hexagons, shaded by a value, postal codes inside. */
function usHexSpec(rows: readonly Row[]): Json {
  const values = new Map<string, number>()
  for (const row of rows) {
    const key = String(row.postal ?? "").trim().toUpperCase(), number = row.broadband_pct
    if (key && typeof number === "number" && Number.isFinite(number)) values.set(key, number)
  }
  const known = US_STATE_HEX_GRID.flatMap(cell => (values.get(cell.postal) === undefined ? [] : [values.get(cell.postal)!]))
  const min = known.length ? Math.min(...known) : 0
  const max = known.length ? Math.max(...known) : 1
  const unit = hexGridExtent(US_STATE_HEX_GRID, 1)
  const radius = Math.max(8, Math.min((620 - CART_LEGEND - 2 * CART_PAD) / unit.width, (420 - 2 * CART_PAD) / unit.height))
  const polygons = US_STATE_HEX_GRID.map(cell => ({ cell, points: hexPolygon(cell.col, cell.row, radius) }))
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
  for (const { points } of polygons) for (const [x, y] of points) {
    minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y)
  }
  const spanX = maxX - minX, spanY = maxY - minY
  const width = Math.round(spanX + CART_LEGEND + 2 * CART_PAD), height = Math.round(spanY + 2 * CART_PAD)
  const points: Row[] = [], labels: Row[] = []
  for (const { cell, points: hex } of polygons) {
    const value = values.get(cell.postal) ?? min
    const fill = CART_RAMP[bucketOf(value, min, max, CART_RAMP.length)]!
    for (const [x, y] of hex) points.push({ x: x - minX, y: maxY - y, code: cell.postal, fill })
    const [cx, cy] = hex.reduce((sum, [x, y]) => [sum[0] + x / hex.length, sum[1] + y / hex.length], [0, 0])
    labels.push({ x: cx - minX, y: maxY - cy + 3, text: cell.postal })
  }
  const fontSize = Math.round(Math.max(8, Math.min(15, radius * 0.8)))
  return {
    width, height,
    marginTop: CART_PAD, marginRight: CART_PAD, marginBottom: CART_PAD, marginLeft: CART_PAD,
    x: { domain: [0, spanX + CART_LEGEND], axis: null },
    y: { domain: [0, spanY], axis: null },
    marks: [
      { type: "lineY", data: points, x: "x", y: "y", z: "code", fill: "fill", stroke: "theme:background", strokeWidth: 1, curve: "linear-closed" },
      cartogramLabels(labels, fontSize),
      ...cartogramLegend(spanX + 22, spanY - 26, Math.max(60, Math.min(150, spanY * 0.45)), min, max, "Adults online", Math.min(12, fontSize)),
    ],
  }
}

/** A Europe tile cartogram: one square per country, its ISO code inside, shaded by a value. */
function euTileSpec(rows: readonly Row[]): Json {
  const values = new Map<string, number>()
  for (const row of rows) {
    const key = String(row.iso3 ?? "").trim().toUpperCase(), number = row.index_points
    if (key && typeof number === "number" && Number.isFinite(number)) values.set(key, number)
  }
  const known = EU_COUNTRY_TILE_GRID.flatMap(cell => (values.get(cell.iso3) === undefined ? [] : [values.get(cell.iso3)!]))
  const min = known.length ? Math.min(...known) : 0
  const max = known.length ? Math.max(...known) : 1
  const cellSize = 56
  const cols = Math.max(...EU_COUNTRY_TILE_GRID.map(cell => cell.col)) + 1
  const rows_ = Math.max(...EU_COUNTRY_TILE_GRID.map(cell => cell.row)) + 1
  const spanX = cols * cellSize, spanY = rows_ * cellSize
  const width = Math.round(spanX + CART_LEGEND + 2 * CART_PAD), height = Math.round(spanY + 2 * CART_PAD)
  const inset = 1.5
  const tiles: Row[] = [], labels: Row[] = []
  for (const cell of EU_COUNTRY_TILE_GRID) {
    const value = values.get(cell.iso3) ?? min
    const left = cell.col * cellSize, bottom = (rows_ - 1 - cell.row) * cellSize
    tiles.push({ x1: left + inset, x2: left + cellSize - inset, y1: bottom + inset, y2: bottom + cellSize - inset, fill: CART_RAMP[bucketOf(value, min, max, CART_RAMP.length)]! })
    labels.push({ x: left + cellSize / 2, y: bottom + cellSize / 2 + 5, text: cell.iso2 })
  }
  const fontSize = Math.round(Math.max(8, Math.min(18, cellSize * 0.32)))
  return {
    width, height,
    marginTop: CART_PAD, marginRight: CART_PAD, marginBottom: CART_PAD, marginLeft: CART_PAD,
    x: { domain: [0, spanX + CART_LEGEND], axis: null },
    y: { domain: [0, spanY], axis: null },
    marks: [
      { type: "rect", data: tiles, x1: "x1", x2: "x2", y1: "y1", y2: "y2", fill: "fill", stroke: "theme:background", strokeWidth: 1 },
      cartogramLabels(labels, fontSize),
      ...cartogramLegend(spanX + 22, spanY - 26, Math.max(60, Math.min(150, spanY * 0.5)), min, max, "Index", Math.min(12, fontSize)),
    ],
  }
}

/** Great-circle flows over a world land base in an Equal Earth projection, with a hub at each end. */
function flowMapSpec(rows: readonly Row[]): Json {
  const flows = rows.flatMap(row => {
    const originLat = row.originLat, originLon = row.originLon, destLat = row.destLat, destLon = row.destLon
    if (typeof originLat !== "number" || typeof originLon !== "number" || typeof destLat !== "number" || typeof destLon !== "number") return []
    return [{ originLat, originLon, destLat, destLon, value: typeof row.value === "number" ? row.value : 1, ...(typeof row.label === "string" ? { label: row.label } : {}) }]
  })
  const arcs = computeFlowArcs(flows, { steps: 32 })
  const values = arcs.map(arc => arc.value)
  const min = values.length ? Math.min(...values) : 0
  const max = values.length ? Math.max(...values) : 1
  const weight = (value: number) => (max === min ? 2.3 : 1.1 + ((value - min) / (max - min)) * 2.4)
  const points: Row[] = []
  arcs.forEach((arc, index) => {
    const width = weight(arc.value)
    arc.segments.forEach((segment, s) => {
      segment.forEach(([lon, lat], i) => {
        const t = segment.length === 1 ? 0.5 : i / (segment.length - 1)
        points.push({ lon, lat, flow: `${index}-${s}`, weight: width * (0.4 + 0.6 * Math.sin(Math.PI * Math.min(1, Math.max(0, t)))) })
      })
    })
  })
  // One hub per place. A flow names where it starts, so the origin hub carries the row's label and the destination
  // stays an unnamed node rather than taking a city it is not.
  const hubs = new Map<string, Row>()
  for (const arc of arcs) {
    for (const [index, [lon, lat]] of [arc.origin, arc.dest].entries()) {
      const key = `${lon.toFixed(3)},${lat.toFixed(3)}`
      if (hubs.has(key)) continue
      hubs.set(key, index === 0 && arc.label ? { lon, lat, label: arc.label } : { lon, lat })
    }
  }
  return {
    width: 640, height: 360, projection: "equal-earth", marginTop: 10, marginRight: 14, marginBottom: 20, marginLeft: 14,
    marks: [
      { type: "sphere", fill: "none", stroke: "theme:grid", strokeWidth: 1 },
      { type: "graticule", stroke: "theme:grid", strokeWidth: 0.5, strokeOpacity: 0.7 },
      { type: "geo", atlas: "world-land-110m", fill: "theme:grid", stroke: "theme:background", strokeWidth: 0.4 },
      { type: "lineY", data: points, x: "lon", y: "lat", z: "flow", stroke: "theme:categorical.0", strokeWidth: "weight", strokeOpacity: 0.85, curve: "linear" },
      { type: "dot", data: [...hubs.values()], x: "lon", y: "lat", r: 2.6, fill: "theme:categorical.0", stroke: "theme:background", strokeWidth: 0.8 },
    ],
  }
}

/** A violin plot's option: one mirrored kernel density per group, with the interquartile box and median on top. */
function violinOption(groups: readonly { name: string; values: readonly number[] }[]): Json {
  const band = 0.44, box = 0.24
  const series: Json[] = []
  groups.forEach((group, index) => {
    const centre = groups.length - index - 0.5
    const values = [...group.values].sort((a, b) => a - b)
    const curve = kernelDensity(values, 32, values[0]!, values[values.length - 1]!)
    const colour = `theme:categorical.${index % 6}`
    const at = (q: number) => {
      const position = (values.length - 1) * q, low = Math.floor(position), high = Math.ceil(position)
      return values[low]! + (values[high]! - values[low]!) * (position - low)
    }
    const right = curve.map(point => [point.x, Math.round((centre + point.d * band) * 1000) / 1000])
    const left = curve.map(point => [point.x, Math.round((centre - point.d * band) * 1000) / 1000]).reverse()
    const annotation: Json = {
      markArea: { silent: true, itemStyle: { color: colour, opacity: 0.22 }, data: [[{ coord: [at(0.25), centre - box] }, { coord: [at(0.75), centre + box] }]] },
      markLine: { silent: true, symbol: "none", lineStyle: { color: colour, width: 2 }, data: [[{ coord: [at(0.5), centre - box] }, { coord: [at(0.5), centre + box] }]] },
    }
    series.push({ type: "line", name: group.name, data: right, showSymbol: false, smooth: false, silent: true, z: 3, lineStyle: { width: 1, color: colour }, areaStyle: { origin: centre, color: colour, opacity: 0.32 }, ...annotation })
    series.push({ type: "line", name: group.name, data: left, showSymbol: false, smooth: false, silent: true, z: 3, lineStyle: { width: 1, color: colour }, areaStyle: { origin: centre, color: colour, opacity: 0.32 } })
  })
  return {
    title: { text: "Response time by service", left: "center", textStyle: { fontSize: 16, fontWeight: 600, color: "theme:text" } },
    grid: { left: 96, right: 40, top: 64, bottom: 52 },
    xAxis: { type: "value", name: "Latency (ms)", nameLocation: "middle", nameGap: 30, nameTextStyle: { color: "theme:muted" }, splitLine: { show: true }, axisLabel: { color: "theme:muted" } },
    yAxis: [
      { type: "value", min: 0, max: groups.length, axisLabel: { show: false }, axisLine: { show: false }, axisTick: { show: false }, splitLine: { show: false } },
      { type: "category", data: groups.map(group => group.name), position: "left", axisLine: { show: false }, axisTick: { show: false }, splitLine: { show: false }, axisLabel: { color: "theme:text", fontSize: 11 } },
    ],
    series,
  }
}

/** The header a metric field gets: Title Case, with the acronyms a reader knows kept upper case. */
const ACRONYMS = new Set(["nps", "csat", "mrr", "arpu", "kpi", "ctr", "roi", "cac", "ltv"])
const metricLabel = (field: string): string => {
  const word = field.replace(/_/g, " ").trim()
  if (ACRONYMS.has(word.toLowerCase())) return word.toUpperCase()
  return word.replace(/(^|\s)(\p{L})/gu, (_whole, space: string, letter: string) => space + letter.toUpperCase())
}

/**
 * A sparkline matrix on ECharts 6's matrix coordinate system: a header row of metrics and a column of entities, and in
 * every cell a small line of its own on its own hidden axes, so each row reads as a shape to scan. The trends are
 * arithmetic on the cell's value and its position, never a random draw, so the same rows give the same picture.
 */
function matrixOption(rows: readonly Row[], rowField: string, metrics: readonly string[]): Json {
  const regions = rows.map(row => String(row[rowField] ?? ""))
  const headers = metrics.map(metricLabel)
  const grid: Json[] = [], xAxis: Json[] = [], yAxis: Json[] = [], series: Json[] = []
  rows.forEach((row, rowIndex) => metrics.forEach((metric, metricIndex) => {
    const id = `spark-${rowIndex}-${metricIndex}`
    const value = row[metric]
    const base = typeof value === "number" && Number.isFinite(value) ? value : 1
    const trend = Array.from({ length: 8 }, (_, point) =>
      Math.round((base * (0.9 + 0.11 * Math.sin(point / 1.7 + rowIndex * 1.9 + metricIndex * 2.3)) + point * base * 0.008) * 10) / 10)
    // One mini grid per cell, ten pixels in from the cell's own borders, on a hidden pair of axes of its own: the
    // sparkline fills the cell and nothing of the series' scale shows.
    grid.push({ id, coordinateSystem: "matrix", matrixIndex: 0, coord: [headers[metricIndex]!, regions[rowIndex]!], left: 12, top: 12, right: 12, bottom: 12 })
    xAxis.push({ id: `${id}-x`, gridId: id, type: "category", data: trend.map((_, point) => String(point + 1)), show: false })
    yAxis.push({ id: `${id}-y`, gridId: id, type: "value", min: "dataMin", max: "dataMax", show: false })
    series.push({
      type: "line",
      name: `${regions[rowIndex]} ${headers[metricIndex]}`,
      xAxisId: `${id}-x`,
      yAxisId: `${id}-y`,
      showSymbol: false,
      silent: true,
      lineStyle: { width: 1.75, color: "theme:categorical.0" },
      areaStyle: { color: "theme:categorical.0", opacity: 0.14 },
      data: trend,
    })
  }))
  return {
    title: { text: "Regional KPIs", left: "center", textStyle: { fontSize: 16, fontWeight: 600, color: "theme:text" } },
    aria: { enabled: true, label: { description: `Regional KPIs: ${regions.length} regions across ${headers.length} metrics, each cell a small trend of its own.` } },
    matrix: {
      left: 84, right: 32, top: 66, bottom: 26,
      x: { data: headers, label: { color: "theme:text", fontSize: 11 } },
      y: { data: regions, label: { color: "theme:text", fontSize: 11 } },
      body: { itemStyle: { borderColor: "theme:grid" } },
    },
    grid, xAxis, yAxis, series,
  }
}

export const CATALOGUE: readonly ChartType[] = [
  // ---- comparison
  { id: "bar", name: "Bar chart", engine: "vega-lite", family: "comparison", when: "Compare a value across a few categories.", avoid: "Over ~15 categories: use horizontal_bar.", example: () => ({ title: "Revenue by product, 2024", currency: "EUR", rows: PRODUCTS, spec: vl({ mark: "bar", encoding: { x: { field: "product", type: "nominal", sort: "-y" }, y: { field: "revenue_eur", type: "quantitative" } } }) }) },
  { id: "horizontal_bar", name: "Horizontal bar (ranked)", engine: "vega-lite", family: "comparison", when: "Rank many categories, or long category names.", example: () => ({ title: "Active users by country", rows: COUNTRIES.map((country, i) => ({ country, users_k: Math.round(820 - i * 61 + ((i * 37) % 50)) })), spec: vl({ mark: "bar", encoding: { y: { field: "country", type: "nominal", sort: "-x" }, x: { field: "users_k", type: "quantitative" } } }) }) },
  { id: "grouped_bar", name: "Grouped bar", engine: "vega-lite", family: "comparison", when: "Compare sub-groups side by side within each category (xOffset).", avoid: "More than ~4 sub-groups: use small multiples.", example: () => ({ title: "Quarterly revenue by region", currency: "EUR", rows: quarterRows, spec: vl({ mark: "bar", encoding: { x: { field: "region", type: "nominal" }, xOffset: { field: "quarter" }, y: { field: "revenue_eur", type: "quantitative" }, color: { field: "quarter", type: "nominal" } } }) }) },
  { id: "stacked_bar", name: "Stacked bar", engine: "vega-lite", family: "comparison", when: "Show totals and their make-up across categories or time.", example: () => ({ title: "Monthly orders by channel", rows: months(["Web", "App", "Store"], 1200, 300, "orders"), spec: vl({ mark: "bar", encoding: { x: { field: "date", type: "ordinal", timeUnit: "yearmonth", title: "Month" }, y: { aggregate: "sum", field: "orders", type: "quantitative", title: "Orders" }, color: { field: "series", type: "nominal", title: "Channel" } } }) }) },
  { id: "normalized_bar", name: "100% stacked bar", engine: "vega-lite", family: "part-to-whole", when: "Compare shares (not totals) across categories.", example: () => ({ title: "Channel mix by region", rows: quarterRows.map(r => ({ region: r.region, channel: r.quarter.replace("Q1", "Web").replace("Q2", "App").replace("Q3", "Store").replace("Q4", "Partner"), orders: r.revenue_eur / 1000 })), spec: vl({ mark: "bar", encoding: { y: { field: "region", type: "nominal" }, x: { aggregate: "sum", field: "orders", type: "quantitative", stack: "normalize", axis: { format: ".0%" }, title: "Share of orders" }, color: { field: "channel", type: "nominal" } } }) }) },
  { id: "diverging_bar", name: "Diverging bar", engine: "vega-lite", family: "comparison", when: "Gains and losses around zero.", example: () => ({ title: "Change in sales vs last year", rows: COUNTRIES.slice(0, 9).map((country, i) => ({ country, change_pct: Math.round((((i * 37) % 31) - 12) * 10) / 1000 })), spec: vl({ mark: "bar", encoding: { y: { field: "country", type: "nominal", sort: "-x" }, x: { field: "change_pct", type: "quantitative", axis: { format: "+.0%", labelExpr: "datum.value === 0 ? '0%' : datum.label" }, title: "Change vs 2023" }, color: { condition: { test: "datum.change_pct < 0", value: "theme:negative" }, value: "theme:positive" } } }) }) },
  { id: "lollipop", name: "Lollipop", engine: "vega-lite", family: "comparison", when: "A lighter bar chart for many categories.", example: () => ({ title: "NPS by store", rows: COUNTRIES.slice(0, 8).map((store, i) => ({ store, nps: 18 + ((i * 23) % 41) })), spec: vl({ encoding: { y: { field: "store", type: "nominal", sort: "-x", title: "Store" }, x: { field: "nps", type: "quantitative", title: "NPS (points)" } }, layer: [{ mark: { type: "rule", strokeWidth: 2, color: "theme:axis" } , encoding: { x: { datum: 0 }, x2: { field: "nps" } } }, { mark: { type: "point", filled: true, size: 120 } }] }) }) },
  { id: "dumbbell", name: "Dumbbell", engine: "vega-lite", family: "comparison", when: "Before/after or two values per category.", example: () => ({ title: "Satisfaction before and after the redesign", rows: ["Search", "Checkout", "Account", "Help", "Returns"].flatMap((area, i) => [{ area, when: "Before", score: 52 + i * 4 }, { area, when: "After", score: 61 + i * 5 - (i === 3 ? 8 : 0) }]), spec: vl({ encoding: { y: { field: "area", type: "nominal", title: "Area" }, x: { field: "score", type: "quantitative", scale: { zero: false, padding: 16 }, title: "Score (0–100)" } }, layer: [{ mark: { type: "line", color: "theme:axis", strokeWidth: 2 }, encoding: { detail: { field: "area" } } }, { mark: { type: "point", filled: true, size: 110, opacity: 1 }, encoding: { color: { field: "when", type: "nominal", sort: ["Before", "After"], title: null } } }] }) }) },
  { id: "dot_plot", name: "Dot plot (Cleveland)", engine: "vega-lite", family: "comparison", when: "Precise comparison when bars would be heavy; non-zero baselines are fine.", example: () => ({ title: "Median delivery time by city", rows: ["Berlin", "Paris", "Madrid", "Rome", "Vienna", "Lisbon", "Dublin"].map((city, i) => ({ city, delivery_min: 24 + ((i * 17) % 19) })), spec: vl({ mark: { type: "point", filled: true, size: 90 }, encoding: { y: { field: "city", type: "nominal", sort: "x" }, x: { field: "delivery_min", type: "quantitative", scale: { zero: false, padding: 16 }, title: "Median delivery (min)" } } }) }) },
  { id: "bullet", name: "Bullet chart", engine: "vega-lite", family: "comparison", when: "Actual against target with qualitative bands (KPIs).", example: () => ({ title: "Quarter to date vs target", rows: [{ kpi: "Revenue (€k)", poor: 600, ok: 800, good: 1000, actual: 870, target: 900 }, { kpi: "New customers", poor: 300, ok: 450, good: 600, actual: 510, target: 480 }, { kpi: "NPS", poor: 20, ok: 40, good: 60, actual: 44, target: 50 }], width: 520, spec: vl({ facet: { row: { field: "kpi", type: "nominal", header: { labelAngle: 0, labelAlign: "left", title: null } } }, resolve: { scale: { x: "independent" } }, spec: { width: 420, height: 26, layer: [{ mark: { type: "bar", color: "theme:grid" }, encoding: { x: { field: "good", type: "quantitative", title: null } } }, { mark: { type: "bar", color: "theme:neutral", opacity: 0.35 }, encoding: { x: { field: "ok", type: "quantitative" } } }, { mark: { type: "bar", size: 10, color: "theme:categorical.0" }, encoding: { x: { field: "actual", type: "quantitative" } } }, { mark: { type: "tick", color: "theme:text", thickness: 2, size: 22 }, encoding: { x: { field: "target", type: "quantitative" } } }] } }) }) },
  { id: "waterfall", name: "Waterfall", engine: "vega-lite", family: "comparison", when: "How increases and decreases build from a start to an end total.", example: () => ({ title: "From revenue to profit", currency: "EUR", width: 560, rows: [{ step: "Revenue", amount: 1200 }, { step: "Cost of goods", amount: -480 }, { step: "Payroll", amount: -310 }, { step: "Marketing", amount: -120 }, { step: "Other income", amount: 60 }, { step: "Profit", amount: 0 }], spec: vl({ transform: [{ window: [{ op: "sum", field: "amount", as: "total" }] }, { window: [{ op: "lead", field: "step", as: "lead" }] }, { calculate: "datum.step === 'Profit' ? datum.total : datum.total - datum.amount", as: "previous" }, { calculate: "datum.step === 'Profit' ? 0 : datum.total", as: "end" }, { calculate: "datum.step === 'Profit' ? 'Total' : datum.amount >= 0 ? 'Increase' : 'Decrease'", as: "kind" }, { calculate: "max(datum.previous, datum.end)", as: "top" }, { calculate: "datum.step === 'Profit' ? format(datum.total, ',.0f') : format(datum.amount, '+,.0f')", as: "label" }], encoding: { x: { field: "step", type: "ordinal", sort: null, title: null, axis: { labelAngle: 0, labelOverlap: false } } }, layer: [{ mark: { type: "bar", width: { band: 0.7 } }, encoding: { y: { field: "previous", type: "quantitative", title: "€k" }, y2: { field: "end" }, color: { field: "kind", type: "nominal", scale: { domain: ["Increase", "Decrease", "Total"], range: ["theme:positive", "theme:negative", "theme:neutral"] }, title: null } } }, { mark: { type: "text", dy: -6, baseline: "bottom" }, encoding: { y: { field: "top", type: "quantitative", title: "€k" }, text: { field: "label" } } }] }) }) },
  // ---- trend
  { id: "line", name: "Line chart", engine: "vega-lite", family: "trend", when: "A value over time.", example: () => ({ title: "Daily active users, 2024", rows: MONTHS.map((date, i) => ({ date, dau: Math.round(wave(i, 42000, 6000)) })), spec: vl({ mark: { type: "line", point: true }, encoding: { x: { field: "date", type: "temporal", title: null }, y: { field: "dau", type: "quantitative", title: "Daily active users" } } }) }) },
  { id: "multi_line", name: "Multi-series line", engine: "vega-lite", family: "trend", when: "Compare a few series over time (≤ 7).", avoid: "More than ~7 series: highlight one or use small multiples.", example: () => ({ title: "Conversion rate by channel", rows: months(["Search", "Social", "Email", "Direct"], 0.03, 0.006, "conversion_rate"), spec: vl({ mark: "line", encoding: { x: { field: "date", type: "temporal", title: null }, y: { field: "conversion_rate", type: "quantitative", axis: { format: ".1%" }, title: "Conversion rate" }, color: { field: "series", type: "nominal", title: "Channel" } } }) }) },
  { id: "area", name: "Area chart", engine: "vega-lite", family: "trend", when: "A single volume over time.", example: () => ({ title: "Storage used", rows: MONTHS.map((date, i) => ({ date, storage_tb: Math.round((40 + i * 6 + wave(i, 0, 4)) * 10) / 10 })), spec: vl({ mark: { type: "area", line: true }, encoding: { x: { field: "date", type: "temporal", title: null }, y: { field: "storage_tb", type: "quantitative" } } }) }) },
  { id: "stacked_area", name: "Stacked area", engine: "vega-lite", family: "trend", when: "Totals over time and how parts contribute.", example: () => ({ title: "Revenue by region", currency: "EUR", rows: REGIONS.flatMap((s, k) => MONTHS.map((date, i) => ({ date, region: s, revenue_eur: Math.round(wave(i, 300000 + k * 80000, 60000, k)) }))), spec: vl({ mark: "area", encoding: { x: { field: "date", type: "temporal", title: null }, y: { field: "revenue_eur", type: "quantitative", stack: "zero" }, color: { field: "region", type: "nominal" } } }) }) },
  { id: "streamgraph", name: "Streamgraph", engine: "vega-lite", family: "trend", when: "Changing composition where the overall shape matters more than exact values.", example: () => ({ title: "Listening by genre", rows: ["Pop", "Rock", "Jazz", "Hip-hop", "Classical"].flatMap((g, k) => MONTHS.map((date, i) => ({ date, genre: g, hours: Math.round(wave(i, 200 + k * 60, 80 + k * 10, k * 1.3)) }))), spec: vl({ mark: "area", encoding: { x: { field: "date", type: "temporal", title: null, axis: { domain: false, grid: false } }, y: { aggregate: "sum", field: "hours", type: "quantitative", stack: "center", axis: null }, color: { field: "genre", type: "nominal" } } }) }) },
  { id: "step_line", name: "Step line", engine: "vega-lite", family: "trend", when: "Values that change at discrete moments (prices, rates, plans).", example: () => ({ title: "Policy rate", rows: MONTHS.map((date, i) => ({ date, rate: [0.045, 0.045, 0.045, 0.04, 0.04, 0.0375, 0.0375, 0.035, 0.035, 0.035, 0.0325, 0.03][i] })), spec: vl({ mark: { type: "line", interpolate: "step-after" }, encoding: { x: { field: "date", type: "temporal", title: null }, y: { field: "rate", type: "quantitative", axis: { format: ".2%" }, scale: { zero: false }, title: "Rate" } } }) }) },
  { id: "line_band", name: "Line with confidence band", engine: "vega-lite", family: "trend", when: "An estimate with its uncertainty.", example: () => ({ title: "Forecast demand with 90% interval", rows: MONTHS.map((date, i) => ({ date, forecast: wave(i, 500, 80), low: wave(i, 500, 80) - 30 - i * 6, high: wave(i, 500, 80) + 30 + i * 6 })), spec: vl({ encoding: { x: { field: "date", type: "temporal", title: null } }, layer: [{ mark: { type: "area", opacity: 0.25 }, encoding: { y: { field: "low", type: "quantitative", title: "Units per day" }, y2: { field: "high" } } }, { mark: "line", encoding: { y: { field: "forecast", type: "quantitative", title: "Units per day" } } }] }) }) },
  { id: "slope", name: "Slope chart", engine: "vega-lite", family: "trend", when: "Change between two moments for several items.", example: () => ({ title: "Market share, 2023 vs 2024", rows: [["Alpha", 0.31, 0.29], ["Bravo", 0.22, 0.25], ["Charlie", 0.18, 0.2], ["Delta", 0.12, 0.09]].flatMap(([brand, a, b]) => [{ brand, year: "2023", share: a }, { brand, year: "2024", share: b }]), width: 320, height: 360, spec: vl({ encoding: { x: { field: "year", type: "ordinal", axis: { labelAngle: 0 }, title: null }, y: { field: "share", type: "quantitative", axis: { format: ".0%", grid: false }, title: "Market share" }, color: { field: "brand", type: "nominal", legend: null } }, layer: [{ mark: { type: "line", point: true } }, { mark: { type: "text", align: "left", dx: 8 }, encoding: { text: { field: "brand" } }, transform: [{ filter: "datum.year === '2024'" }] }] }) }) },
  { id: "bump", name: "Bump chart", engine: "vega-lite", family: "trend", when: "Rank changes over time.", example: () => ({ title: "League position by week", rows: ["Lions", "Tigers", "Bears", "Wolves"].flatMap((team, k) => [1, 2, 3, 4, 5, 6].map(week => ({ week, team, rank: ((k + week * (k % 2 ? 1 : 3)) % 4) + 1 }))), spec: vl({ mark: { type: "line", point: { size: 80, filled: true }, interpolate: "monotone" }, encoding: { x: { field: "week", type: "ordinal", title: "Week" }, y: { field: "rank", type: "ordinal", title: "Position" }, color: { field: "team", type: "nominal" } } }) }) },
  { id: "dual_axis", name: "Dual axis (bar + line)", engine: "vega-lite", family: "trend", when: "Two measures with different units that share time — label both axes.", avoid: "Readers compare heights across axes; prefer two aligned charts.", example: () => ({ title: "Orders and average basket", rows: MONTHS.map((date, i) => ({ date, orders: Math.round(wave(i, 3200, 500)), basket_eur: wave(i, 38, 4, 2) })), spec: vl({ encoding: { x: { field: "date", type: "temporal", timeUnit: "yearmonth", title: null } }, layer: [{ mark: { type: "bar", opacity: 0.8 }, encoding: { y: { field: "orders", type: "quantitative", title: "Orders" }, color: { datum: "Orders", type: "nominal", title: null, scale: { domain: ["Orders", "Average basket (€)"], range: ["theme:categorical.0", "theme:categorical.1"] } } } }, { mark: { type: "line", strokeWidth: 3 }, encoding: { y: { field: "basket_eur", type: "quantitative", title: "Average basket (€)", axis: { titleColor: "theme:categorical.1" } }, color: { datum: "Average basket (€)", type: "nominal", title: null, scale: { domain: ["Orders", "Average basket (€)"], range: ["theme:categorical.0", "theme:categorical.1"] } } } }], resolve: { scale: { y: "independent", color: "shared" } } }) }) },
  { id: "small_multiples", name: "Small multiples (facet)", engine: "vega-lite", family: "trend", when: "Many series: one small chart each, same scales.", example: () => ({ title: "Weekly sign-ups by region", rows: REGIONS.flatMap((region, k) => MONTHS.map((date, i) => ({ date, region, signups: Math.round(wave(i, 900 + k * 150, 200, k)) }))), spec: vl({ facet: { field: "region", type: "nominal", title: null }, columns: 2, spacing: 24, spec: { width: 240, height: 120, mark: "area", encoding: { x: { field: "date", type: "temporal", title: null, axis: { format: "%b" } }, y: { field: "signups", type: "quantitative", title: "Sign-ups" } } } }) }) },
  // ---- distribution
  { id: "histogram", name: "Histogram", engine: "vega-lite", family: "distribution", when: "The shape of one numeric variable.", example: () => ({ title: "Checkout latency", rows: distRows, spec: vl({ mark: "bar", encoding: { x: { field: "latency_ms", type: "quantitative", bin: { maxbins: 24 }, title: "Latency (ms)" }, y: { aggregate: "count", type: "quantitative", title: "Requests" } } }) }) },
  { id: "density", name: "Density plot", engine: "vega-lite", family: "distribution", when: "Compare smooth distributions of a few groups.", example: () => ({ title: "Latency by service", rows: distRows, spec: vl({ transform: [{ density: "latency_ms", groupby: ["group"], extent: [20, 240] }], mark: { type: "area", opacity: 0.45, line: true }, encoding: { x: { field: "value", type: "quantitative", title: "Latency (ms)" }, y: { field: "density", type: "quantitative", title: "Density", stack: null }, color: { field: "group", type: "nominal", title: "Service" } } }) }) },
  { id: "box_plot", name: "Box plot", engine: "vega-lite", family: "distribution", when: "Medians, spread and outliers across groups.", example: () => ({ title: "Latency by service", rows: distRows, spec: vl({ mark: { type: "boxplot", extent: 1.5 }, encoding: { x: { field: "group", type: "nominal", title: "Service" }, y: { field: "latency_ms", type: "quantitative", title: "Latency (ms)" }, color: { field: "group", type: "nominal", legend: null } } }) }) },
  { id: "strip", name: "Strip plot", engine: "vega-lite", family: "distribution", when: "Every observation, for small samples.", example: () => ({ title: "Response times by service", rows: distRows.slice(0, 120), spec: vl({ mark: { type: "tick", thickness: 1.5 }, encoding: { x: { field: "latency_ms", type: "quantitative", title: "Latency (ms)" }, y: { field: "group", type: "nominal", title: "Service" } } }) }) },
  { id: "heatmap", name: "Heatmap", engine: "vega-lite", family: "distribution", when: "A value across two categorical dimensions (day × hour).", example: () => ({ title: "Orders by weekday and hour", rows: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].flatMap((day, d) => Array.from({ length: 12 }, (_, h) => ({ day, hour: `${String(h * 2).padStart(2, "0")}:00`, orders: Math.round(20 + 60 * Math.max(0, Math.sin(((h - 3) / 11) * Math.PI)) * (d >= 5 ? 1.4 : 1) + ((d * 7 + h * 3) % 9)) }))), spec: vl({ mark: "rect", encoding: { x: { field: "hour", type: "ordinal", title: null }, y: { field: "day", type: "ordinal", title: null }, color: { field: "orders", type: "quantitative", title: "Orders" } } }) }) },
  { id: "binned_heatmap", name: "2-D histogram", engine: "vega-lite", family: "distribution", when: "Where many points concentrate (instead of an overplotted scatter).", example: () => ({ title: "Spend vs conversions", rows: scatterRows, spec: vl({ mark: "rect", encoding: { x: { field: "spend_k", type: "quantitative", bin: { maxbins: 12 }, title: "Spend (€k)" }, y: { field: "conversions", type: "quantitative", bin: { maxbins: 10 }, title: "Conversions" }, color: { aggregate: "count", type: "quantitative", title: "Campaigns" } } }) }) },
  // ---- part to whole
  { id: "pie", name: "Pie chart", engine: "vega-lite", family: "part-to-whole", when: "Parts of one whole, 2–5 slices.", avoid: "More than 5–7 slices, or comparing pies: use bars.", example: () => ({ title: "Traffic sources", rows: [{ source: "Search", visits: 4200 }, { source: "Direct", visits: 2600 }, { source: "Social", visits: 1500 }, { source: "Email", visits: 900 }], spec: vl({ mark: { type: "arc" }, encoding: { theta: { field: "visits", type: "quantitative", stack: true }, color: { field: "source", type: "nominal", sort: { field: "visits", order: "descending" } }, order: { field: "visits", sort: "descending" } } }) }) },
  { id: "donut", name: "Donut chart", engine: "vega-lite", family: "part-to-whole", when: "A pie with room for a total in the middle.", example: () => ({ title: "Budget split", rows: [{ item: "Payroll", share: 0.52 }, { item: "Infrastructure", share: 0.21 }, { item: "Marketing", share: 0.17 }, { item: "Other", share: 0.1 }], spec: vl({ layer: [{ mark: { type: "arc", innerRadius: 68, outerRadius: 104, padAngle: 0.015 }, encoding: { theta: { field: "share", type: "quantitative", stack: true }, color: { field: "item", type: "nominal", sort: null }, order: { field: "share", sort: "descending" } } }, { transform: [{ calculate: "format(datum.share, '.0%')", as: "label" }], mark: { type: "text", radius: 121, fontSize: 11 }, encoding: { theta: { field: "share", type: "quantitative", stack: true }, text: { field: "label" } } }, { data: { values: [{}] }, mark: { type: "text", fontSize: 22, fontWeight: 500 }, encoding: { text: { value: "€4.2M" } } }] }) }) },
  { id: "radial", name: "Radial (rose) chart", engine: "vega-lite", family: "part-to-whole", when: "Cyclical categories such as months or directions.", example: () => ({ title: "Rainfall by month", rows: ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"].map((month, i) => ({ month, rain_mm: Math.round(40 + 35 * Math.cos((i / 12) * 2 * Math.PI) + (i % 3) * 6) })), width: 460, height: 420, spec: vl({ encoding: { theta: { field: "month", type: "nominal", sort: null }, radius: { field: "rain_mm", type: "quantitative", scale: { type: "sqrt", zero: true, rangeMin: 20 } } }, layer: [{ mark: { type: "arc", stroke: "theme:background", strokeWidth: 1 }, encoding: { color: { field: "rain_mm", type: "quantitative", title: "Rainfall (mm)" } } }, { transform: [{ calculate: "datum.month + ' ' + format(datum.rain_mm, ',.0f')", as: "label" }], mark: { type: "text", radiusOffset: 20, fontSize: 11 }, encoding: { text: { field: "label" } } }] }) }) },
  { id: "treemap", name: "Treemap", engine: "vega", family: "hierarchy", when: "Sizes within a hierarchy (budget, disk use).", example: () => ({ title: "Headcount by team", rows: tree, spec: { $schema: "https://vega.github.io/schema/vega/v6.json", autosize: "pad", data: [{ name: "table" }, { name: "tree", source: "table", transform: [{ type: "stratify", key: "id", parentKey: "parent" }, { type: "treemap", field: "size", sort: { field: "value", order: "descending" }, round: true, method: "squarify", paddingInner: 2, paddingOuter: 0, size: [{ signal: "width" }, { signal: "height" }] }] }, { name: "leaves", source: "tree", transform: [{ type: "filter", expr: "!datum.children" }] }], scales: [{ name: "color", type: "ordinal", domain: { data: "leaves", field: "group", sort: true }, range: "category" }], marks: [
    { type: "rect", from: { data: "leaves" }, encode: { enter: { fill: { scale: "color", field: "group" }, stroke: { signal: "background" } }, update: { x: { field: "x0" }, y: { field: "y0" }, x2: { field: "x1" }, y2: { field: "y1" } } } },
    // "Name · size" when the cell is wide enough, else "Name" alone, else nothing: no text is ever truncated.
    { type: "text", from: { data: "leaves" }, encode: { enter: { text: { signal: "datum.name + ' · ' + datum.size" }, fontSize: { value: 11 }, fill: { signal: "luminance(scale('color', datum.group)) > 0.19 ? '#111111' : '#FFFFFF'" } }, update: { x: { signal: "datum.x0 + 6" }, y: { signal: "datum.y0 + 16" }, opacity: { signal: "datum.y1 - datum.y0 >= 22 && datum.x1 - datum.x0 >= 12 + length(datum.name + ' · ' + datum.size) * 6 ? 1 : 0" } } } },
    { type: "text", from: { data: "leaves" }, encode: { enter: { text: { signal: "datum.name" }, fontSize: { value: 11 }, fill: { signal: "luminance(scale('color', datum.group)) > 0.19 ? '#111111' : '#FFFFFF'" } }, update: { x: { signal: "datum.x0 + 6" }, y: { signal: "datum.y0 + 16" }, opacity: { signal: "datum.y1 - datum.y0 >= 22 && datum.x1 - datum.x0 < 12 + length(datum.name + ' · ' + datum.size) * 6 && datum.x1 - datum.x0 >= 12 + length(datum.name) * 6 ? 1 : 0" } } } },
  ], legends: [{ fill: "color", orient: "bottom", direction: "horizontal", title: "Department" }] } }) },
  { id: "sunburst", name: "Sunburst", engine: "vega", family: "hierarchy", when: "A hierarchy as nested rings.", example: () => ({ title: "Headcount by department and team", rows: tree, width: 420, height: 420, spec: { $schema: "https://vega.github.io/schema/vega/v6.json", autosize: "pad", data: [{ name: "table" }, { name: "tree", source: "table", transform: [{ type: "stratify", key: "id", parentKey: "parent" }, { type: "partition", field: "size", sort: { field: "value" }, size: [{ signal: "2 * PI" }, { signal: "min(width, height) / 2" }], as: ["a0", "r0", "a1", "r1", "depth", "children"] }] }], scales: [{ name: "color", type: "ordinal", domain: { data: "tree", field: "group", sort: true }, range: "category" }], marks: [{ type: "arc", from: { data: "tree" }, encode: { enter: { x: { signal: "width / 2" }, y: { signal: "height / 2" }, fill: { signal: "datum.depth === 0 ? 'transparent' : scale('color', datum.group)" }, fillOpacity: { signal: "datum.depth === 1 ? 1 : 0.7" }, stroke: { signal: "background" }, strokeWidth: { value: 1 } }, update: { startAngle: { field: "a0" }, endAngle: { field: "a1" }, innerRadius: { field: "r0" }, outerRadius: { field: "r1" } } } }, { type: "text", from: { data: "tree" }, encode: { enter: { text: { field: "name" }, fontSize: { value: 10 }, align: { value: "center" }, baseline: { value: "middle" }, fill: { signal: "luminance(scale('color', datum.group)) > 0.45 ? '#111111' : '#FFFFFF'" } }, update: { x: { signal: "width / 2 + (datum.r0 + datum.r1) / 2 * sin((datum.a0 + datum.a1) / 2)" }, y: { signal: "height / 2 - (datum.r0 + datum.r1) / 2 * cos((datum.a0 + datum.a1) / 2)" }, opacity: { signal: "datum.depth >= 1 && (datum.a1 - datum.a0) * (datum.r0 + datum.r1) / 2 > 34 ? 1 : 0" } } } }] } }) },
  { id: "funnel", name: "Funnel", engine: "echarts", family: "part-to-whole", when: "Drop-off through ordered stages.", example: () => ({ title: "Checkout funnel", width: 640, height: 340, rows: ([["Visited", 10000], ["Viewed product", 6200], ["Added to basket", 2400], ["Checkout", 1300], ["Paid", 980]] as const).map(([stage, visitors]) => ({ stage, visitors, visitors_label: grouped(visitors) })), spec: { series: [{ type: "funnel", left: "4%", width: "58%", bottom: 16, sort: "descending", gap: 2, encode: { itemName: "stage", value: "visitors" }, label: { show: true, position: "right", formatter: "{b}  {@visitors_label}" }, labelLine: { show: true, length: 16 } }] } }) },
  { id: "gauge", name: "Gauge", engine: "echarts", family: "part-to-whole", when: "One KPI against its range, for dashboards.", avoid: "Several KPIs: use bullet charts.", example: () => ({ title: "Uptime this month", width: 400, height: 320, spec: { series: [{ type: "gauge", min: 99, max: 100, splitNumber: 4, startAngle: 210, endAngle: -30, radius: "82%", progress: { show: true, width: 14 }, axisLine: { lineStyle: { width: 14 } }, pointer: { show: false }, axisTick: { show: false }, splitLine: { show: false }, axisLabel: { distance: 22, fontSize: 11 }, detail: { formatter: "{value}%", fontSize: 28, offsetCenter: [0, "4%"] }, title: { offsetCenter: [0, "34%"] }, data: [{ value: 99.94, name: "Uptime" }] }] } }) },
  // ---- relationship
  { id: "scatter", name: "Scatter plot", engine: "vega-lite", family: "relationship", when: "Relationship between two numbers.", example: () => ({ title: "Spend vs conversions", rows: scatterRows, spec: vl({ mark: { type: "point", filled: true, opacity: 0.8 }, encoding: { x: { field: "spend_k", type: "quantitative", title: "Spend (€k)" }, y: { field: "conversions", type: "quantitative", title: "Conversions" }, color: { field: "channel", type: "nominal" } } }) }) },
  { id: "bubble", name: "Bubble chart", engine: "vega-lite", family: "relationship", when: "A scatter with a third measure as area.", example: () => ({ title: "Campaigns: spend, conversions and reach", rows: scatterRows.slice(0, 30), spec: vl({ mark: { type: "circle", opacity: 0.6, stroke: "theme:background", strokeWidth: 1 }, encoding: { x: { field: "spend_k", type: "quantitative", title: "Spend (€k)" }, y: { field: "conversions", type: "quantitative", title: "Conversions" }, size: { field: "customers", type: "quantitative", title: "Customers", scale: { range: [30, 900] } }, color: { field: "channel", type: "nominal" } } }) }) },
  { id: "regression", name: "Scatter with trend line", engine: "vega-lite", family: "relationship", when: "Show the overall trend through points.", example: () => ({ title: "Spend vs conversions, with linear fit", rows: scatterRows, spec: vl({ encoding: { x: { field: "spend_k", type: "quantitative", title: "Spend (€k)" }, y: { field: "conversions", type: "quantitative", title: "Conversions" } }, layer: [{ mark: { type: "point", filled: true, opacity: 0.6 } }, { mark: { type: "line", color: "theme:highlight", strokeWidth: 2.5 }, transform: [{ regression: "conversions", on: "spend_k" }] }] }) }) },
  { id: "correlation_matrix", name: "Correlation matrix", engine: "vega-lite", family: "relationship", when: "Pairwise correlations between several measures.", example: () => { const v = ["price", "rating", "reviews", "returns", "margin"]; const r = [[1, -0.3, 0.1, 0.5, 0.6], [-0.3, 1, 0.7, -0.6, 0.1], [0.1, 0.7, 1, -0.2, 0.0], [0.5, -0.6, -0.2, 1, -0.4], [0.6, 0.1, 0.0, -0.4, 1]]; return { title: "Correlation between product measures", width: 360, height: 360, rows: v.flatMap((a, i) => v.map((b, j) => ({ a, b, r: r[i]![j]! }))), spec: vl({ encoding: { x: { field: "a", type: "nominal", sort: v, title: null }, y: { field: "b", type: "nominal", sort: v, title: null } }, layer: [{ mark: "rect", encoding: { color: { field: "r", type: "quantitative", scale: { domain: [-1, 1], scheme: "redblue", reverse: true }, title: "r" } } }, { mark: { type: "text", fontSize: 11 }, encoding: { text: { field: "r", type: "quantitative", format: ".1f" }, color: { condition: { test: "abs(datum.r) > 0.5", value: "#FFFFFF" }, value: "#111111" } } }] }) } } },
  { id: "connected_scatter", name: "Connected scatter", engine: "vega-lite", family: "relationship", when: "How two measures moved together over time.", example: () => ({ title: "Unemployment vs inflation, 2015–2024", rows: Array.from({ length: 10 }, (_, i) => ({ year: 2015 + i, unemployment: [0.10, 0.096, 0.09, 0.083, 0.076, 0.081, 0.077, 0.068, 0.065, 0.064][i], inflation: [0.001, 0.002, 0.015, 0.018, 0.012, 0.003, 0.026, 0.084, 0.054, 0.024][i] })), spec: vl({ encoding: { x: { field: "unemployment", type: "quantitative", axis: { format: ".1%" }, scale: { zero: false }, title: "Unemployment" }, y: { field: "inflation", type: "quantitative", axis: { format: ".0%" }, title: "Inflation" }, order: { field: "year" } }, layer: [{ mark: { type: "line", point: true } }, { mark: { type: "text", align: "left", dx: 7, dy: -7, fontSize: 10 }, encoding: { text: { field: "year", type: "nominal" } } }] }) }) },
  { id: "parallel", name: "Parallel coordinates", engine: "echarts", family: "relationship", when: "Many measures per item; spot clusters and trade-offs.", example: () => ({ title: "Laptops compared", width: 640, spec: { parallelAxis: [{ dim: 0, name: "Price (€)" }, { dim: 1, name: "Weight (kg)" }, { dim: 2, name: "Battery (h)" }, { dim: 3, name: "Score" }], parallel: { left: 60, right: 60, top: 80, bottom: 40 }, series: [{ type: "parallel", lineStyle: { width: 2, opacity: 0.7 }, data: [[1299, 1.2, 14, 88], [899, 1.6, 10, 76], [1999, 1.4, 18, 93], [649, 2.1, 7, 64], [1499, 1.3, 12, 85], [1099, 1.8, 11, 79]] }] } }) },
  { id: "radar", name: "Radar chart", engine: "echarts", family: "relationship", when: "A profile across 4–8 comparable scores, for 1–3 items.", avoid: "Precise comparison: use grouped bars.", example: () => ({ title: "Product profiles", width: 480, height: 420, spec: { legend: { data: ["Model A", "Model B"] }, radar: { indicator: [{ name: "Speed", max: 10 }, { name: "Cost", max: 10 }, { name: "Quality", max: 10 }, { name: "Support", max: 10 }, { name: "Features", max: 10 }] }, series: [{ type: "radar", areaStyle: { opacity: 0.2 }, data: [{ name: "Model A", value: [8, 5, 7, 6, 9] }, { name: "Model B", value: [6, 8, 8, 7, 5] }] }] } }) },
  // ---- flow
  { id: "sankey", name: "Sankey diagram", engine: "echarts", family: "flow", when: "Volumes flowing between stages or categories.", avoid: "Cycles: a Sankey flows one way.", example: () => ({ title: "Where sign-ups come from and go", width: 640, height: 360, spec: { series: [{ type: "sankey", left: 96, right: 96, top: 40, bottom: 28, nodeWidth: 14, nodeGap: 14, lineStyle: { color: "gradient", opacity: 0.42, curveness: 0.5 }, label: { fontSize: 11, textBorderWidth: 2, textBorderColor: "theme:background" }, data: [{ name: "Search", label: { position: "left" } }, { name: "Social", label: { position: "left" } }, { name: "Referral", label: { position: "left" } }, { name: "Trial", label: { position: "top" } }, { name: "Paid", label: { position: "right" } }, { name: "Churned", label: { position: "right" } }], links: [{ source: "Search", target: "Trial", value: 520 }, { source: "Social", target: "Trial", value: 310 }, { source: "Referral", target: "Trial", value: 170 }, { source: "Trial", target: "Paid", value: 410 }, { source: "Trial", target: "Churned", value: 590 }] }] } }) },
  { id: "chord", name: "Chord diagram", engine: "echarts", family: "flow", when: "Two-way flows between a few groups.", example: () => ({ title: "Customer moves between plans", width: 460, height: 440, spec: { series: [{ type: "chord", radius: ["70%", "78%"], label: { show: true }, lineStyle: { color: "source", opacity: 0.4 }, data: ["Free", "Basic", "Pro", "Team"].map(name => ({ name })), links: [{ source: "Free", target: "Basic", value: 40 }, { source: "Basic", target: "Pro", value: 25 }, { source: "Pro", target: "Team", value: 12 }, { source: "Basic", target: "Free", value: 10 }, { source: "Pro", target: "Basic", value: 8 }, { source: "Team", target: "Pro", value: 4 }] }] } }) },
  { id: "network", name: "Force-directed network", engine: "vega", family: "flow", when: "Who is connected to whom.", example: () => { const nodes = ["Ana", "Ben", "Chloe", "Dev", "Eva", "Finn", "Gus", "Hana", "Ivo", "Jun"].map((name, i) => ({ index: i, name, team: ["Data", "Web", "Ops"][i % 3] })); const links = [[0, 1], [0, 2], [1, 2], [2, 3], [3, 4], [4, 5], [5, 6], [6, 3], [7, 8], [8, 9], [9, 7], [0, 7], [4, 8]].map(([s, t]) => ({ source: s, target: t })); return { title: "Who works with whom", width: 520, height: 360, spec: { $schema: "https://vega.github.io/schema/vega/v6.json", autosize: "pad", data: [{ name: "node-data", values: nodes }, { name: "link-data", values: links }], scales: [{ name: "color", type: "ordinal", domain: { data: "node-data", field: "team", sort: true }, range: "category" }], marks: [{ name: "nodes", type: "symbol", zindex: 1, from: { data: "node-data" }, encode: { enter: { fill: { scale: "color", field: "team" }, stroke: { signal: "background" }, strokeWidth: { value: 1.5 }, size: { value: 260 } } }, transform: [{ type: "force", iterations: 400, static: true, signal: "force", forces: [{ force: "center", x: { signal: "width / 2" }, y: { signal: "height / 2" } }, { force: "collide", radius: 26 }, { force: "nbody", strength: -120 }, { force: "link", links: "link-data", distance: 85 }] }] }, { type: "path", from: { data: "link-data" }, interactive: false, encode: { update: { stroke: { value: "theme:axis" }, strokeWidth: { value: 1.2 } } }, transform: [{ type: "linkpath", require: { signal: "force" }, shape: "line", sourceX: "datum.source.x", sourceY: "datum.source.y", targetX: "datum.target.x", targetY: "datum.target.y" }] }, { type: "text", from: { data: "nodes" }, zindex: 2, encode: { update: { x: { field: "x" }, y: { field: "y", offset: -15 }, text: { field: "datum.name" }, align: { value: "center" }, fontSize: { value: 11 } } } }], legends: [{ fill: "color", orient: "bottom-right", title: "Team" }] } } } },
  { id: "tree", name: "Tree (dendrogram)", engine: "vega", family: "hierarchy", when: "Structure of a hierarchy (org chart, taxonomy).", example: () => ({ title: "Organisation", rows: tree, width: 560, height: 380, spec: { $schema: "https://vega.github.io/schema/vega/v6.json", autosize: "pad", padding: { left: 70, right: 70, top: 10, bottom: 10 }, data: [{ name: "table" }, { name: "tree", source: "table", transform: [{ type: "stratify", key: "id", parentKey: "parent" }, { type: "tree", method: "tidy", size: [{ signal: "height" }, { signal: "width - 60" }], separation: true, as: ["y", "x", "depth", "children"] }] }, { name: "links", source: "tree", transform: [{ type: "treelinks" }, { type: "linkpath", orient: "horizontal", shape: "diagonal" }] }], scales: [{ name: "color", type: "ordinal", domain: { data: "tree", field: "group", sort: true }, range: "category" }], marks: [{ type: "path", from: { data: "links" }, encode: { update: { path: { field: "path" }, stroke: { value: "theme:axis" } } } }, { type: "symbol", from: { data: "tree" }, encode: { enter: { size: { value: 90 }, stroke: { signal: "background" } }, update: { x: { field: "x" }, y: { field: "y" }, fill: { scale: "color", field: "group" } } } }, { type: "text", from: { data: "tree" }, encode: { enter: { text: { field: "name" }, fontSize: { value: 11 }, baseline: { value: "middle" } }, update: { x: { field: "x" }, y: { field: "y" }, dx: { signal: "datum.children ? -9 : 9" }, align: { signal: "datum.children ? 'right' : 'left'" } } } }] } }) },
  // ---- time, finance and calendars
  { id: "calendar_heatmap", name: "Calendar heatmap", engine: "echarts", family: "trend", when: "Daily values over a year, where weekday patterns matter.", example: () => ({ title: "Commits per day, 2024", width: 820, height: 220, rows: Array.from({ length: 366 }, (_, i) => { const d = new Date(Date.UTC(2024, 0, 1 + i)); const wd = d.getUTCDay(); return { date: d.toISOString().slice(0, 10), commits: wd === 0 || wd === 6 ? (i * 7) % 3 : 3 + ((i * 13) % 11) } }), spec: { visualMap: { min: 0, max: 14, orient: "horizontal", left: "center", bottom: 4, itemHeight: 120, calculable: false, text: ["14 commits", "0"] }, calendar: { range: "2024", cellSize: ["auto", 14], left: 52, right: 32, dayLabel: { nameMap: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] }, yearLabel: { show: false }, splitLine: { show: false }, itemStyle: { color: "theme:background", borderColor: "theme:background" } }, series: [{ type: "heatmap", coordinateSystem: "calendar", encode: { time: "date", value: "commits" }, itemStyle: { borderColor: "theme:background", borderWidth: 1 } }] } }) },
  { id: "candlestick", name: "Candlestick", engine: "echarts", family: "trend", when: "Open, high, low and close per period.", example: () => { const rows = Array.from({ length: 30 }, (_, i) => { const base = 100 + i * 0.8 + 6 * Math.sin(i / 3); const open = Math.round((base + Math.sin(i * 1.7) * 2) * 100) / 100; const close = Math.round((base + Math.cos(i * 1.3) * 2.5) * 100) / 100; return { date: `${String(i + 1).padStart(2, "0")} Mar`, open, close, low: Math.round((Math.min(open, close) - 1.2 - (i % 3) * 0.4) * 100) / 100, high: Math.round((Math.max(open, close) + 1.1 + (i % 4) * 0.3) * 100) / 100 } }); return { title: "ACME share price, March 2024", rows, spec: { grid: { left: 56, right: 24, top: 64, bottom: 36 }, xAxis: { type: "category", axisLabel: { interval: 4 }, splitLine: { show: false } }, yAxis: { type: "value", scale: true, name: "€", nameTextStyle: { align: "right" } }, series: [{ type: "candlestick", encode: { x: "date", y: ["open", "close", "low", "high"] } }] } } } },
  // ---- maps
  { id: "choropleth_world", name: "World choropleth", engine: "vega-lite", family: "map", when: "A rate by country. Join on iso_a3, iso_a2 or name from the bundled world-110m atlas.", avoid: "Totals (bigger countries dominate): map rates, or use a bubble map.", example: () => ({ title: "Internet users, share of population", width: 640, height: 340, rows: [["USA", 0.92], ["CAN", 0.93], ["MEX", 0.76], ["BRA", 0.81], ["ARG", 0.88], ["GBR", 0.97], ["FRA", 0.86], ["DEU", 0.92], ["ESP", 0.94], ["ITA", 0.85], ["POL", 0.87], ["RUS", 0.9], ["CHN", 0.76], ["IND", 0.46], ["JPN", 0.83], ["AUS", 0.96], ["ZAF", 0.72], ["NGA", 0.55], ["EGY", 0.72], ["KEN", 0.29], ["IDN", 0.66], ["TUR", 0.83], ["SAU", 0.99], ["SWE", 0.95], ["NOR", 0.99]].map(([iso, users_share]) => ({ iso, users_share })), spec: vl({ data: { atlas: "world-110m" }, projection: { type: "equalEarth" }, layer: [{ mark: { type: "geoshape", stroke: "theme:background", strokeWidth: 0.5 }, encoding: { color: { datum: "No data", type: "nominal", scale: { domain: ["No data"], range: ["theme:grid"] }, legend: { title: null, orient: "bottom-right" } } } }, { transform: [{ lookup: "properties.iso_a3", from: { data: { name: "table" }, key: "iso", fields: ["users_share"] } }, { filter: "isValid(datum.users_share)" }], mark: { type: "geoshape" }, encoding: { color: { field: "users_share", type: "quantitative", legend: { format: ".0%" }, title: "Internet users" } } }], resolve: { scale: { color: "independent" } } }) }) },
  { id: "choropleth_us", name: "US states choropleth", engine: "vega-lite", family: "map", when: "A rate by US state (join on postal, name or FIPS id).", example: () => ({ title: "Unemployment rate by state", width: 600, height: 360, rows: ["CA", "TX", "FL", "NY", "PA", "IL", "OH", "GA", "NC", "MI", "NJ", "VA", "WA", "AZ", "MA", "TN", "IN", "MO", "MD", "WI", "CO", "MN", "SC", "AL", "LA", "KY", "OR", "OK", "CT", "UT", "IA", "NV", "AR", "MS", "KS", "NM", "NE", "ID", "WV", "HI", "NH", "ME", "MT", "RI", "DE", "SD", "ND", "AK", "VT", "WY", "DC"].map((postal, i) => ({ postal, unemployment: Math.round((0.025 + ((i * 37) % 30) / 1000) * 1000) / 1000 })), spec: vl({ data: { atlas: "us-states-10m" }, projection: { type: "albersUsa" }, transform: [{ lookup: "properties.postal", from: { data: { name: "table" }, key: "postal", fields: ["unemployment"] } }], mark: "geoshape", encoding: { color: { field: "unemployment", type: "quantitative", legend: { format: ".1%" }, title: "Unemployment" } } }) }) },
  { id: "point_map", name: "Point / bubble map", engine: "vega-lite", family: "map", when: "Values at places (cities, stores) on a world base map.", example: () => ({ title: "Customers by city", width: 640, height: 340, rows: [["London", 51.5, -0.13, 1200], ["New York", 40.7, -74, 2100], ["São Paulo", -23.5, -46.6, 900], ["Lagos", 6.5, 3.4, 400], ["Mumbai", 19.1, 72.9, 1500], ["Tokyo", 35.7, 139.7, 1800], ["Sydney", -33.9, 151.2, 600], ["Berlin", 52.5, 13.4, 800], ["Mexico City", 19.4, -99.1, 700], ["Singapore", 1.35, 103.8, 950]].map(([city, lat, lon, customers]) => ({ city, lat, lon, customers })), spec: vl({ projection: { type: "equalEarth" }, layer: [{ data: { atlas: "world-land-110m" }, mark: { type: "geoshape", fill: "theme:grid", stroke: null } }, { data: { name: "table" }, mark: { type: "circle", opacity: 0.75, stroke: "theme:background", strokeWidth: 1 }, encoding: { longitude: { field: "lon", type: "quantitative" }, latitude: { field: "lat", type: "quantitative" }, size: { field: "customers", type: "quantitative", scale: { range: [40, 900] }, title: "Customers" } } }] }) }) },
  // ---- text
  { id: "word_cloud", name: "Word cloud", engine: "vega", family: "text", when: "A light overview of frequent terms; never for precise comparison.", example: () => ({ title: "What customers mention", width: 520, height: 300, rows: [["delivery", 96], ["price", 81], ["quality", 74], ["support", 55], ["app", 52], ["fast", 47], ["refund", 33], ["packaging", 29], ["friendly", 27], ["late", 24], ["discount", 22], ["easy", 21], ["fresh", 18], ["checkout", 16], ["tracking", 15], ["size", 12], ["colour", 11], ["returns", 10], ["coupon", 9], ["gift", 8]].map(([text, count]) => ({ text, count })), spec: { $schema: "https://vega.github.io/schema/vega/v6.json", autosize: "pad", data: [{ name: "table" }], scales: [{ name: "color", type: "ordinal", domain: { data: "table", field: "text" }, range: "category" }], marks: [{ type: "text", from: { data: "table" }, encode: { enter: { text: { field: "text" }, align: { value: "center" }, baseline: { value: "middle" }, fill: { scale: "color", field: "text" } } }, transform: [{ type: "wordcloud", size: [{ signal: "width" }, { signal: "height" }], text: { field: "text" }, rotate: { expr: "datum.count < 20 && length(datum.text) < 6 ? 90 : 0" }, font: "theme:font", fontSize: { field: "datum.count" }, fontWeight: "600", fontSizeRange: [12, 52], padding: 3 }] }] } }) },
  // ---- interaction (static render shows the full chart; the HTML is interactive)
  { id: "interactive_brush", name: "Brushable scatter", engine: "vega-lite", family: "relationship", when: "Interactive HTML: drag to highlight a region.", example: () => ({ title: "Drag to select campaigns", rows: scatterRows, spec: vl({ params: [{ name: "brush", select: "interval" }], mark: { type: "point", filled: true }, encoding: { x: { field: "spend_k", type: "quantitative", title: "Spend (€k)" }, y: { field: "conversions", type: "quantitative", title: "Conversions" }, color: { condition: { param: "brush", field: "channel", type: "nominal", title: "Channel" }, value: "theme:grid" } } }) }) },

  // ---- Observable Plot: statistical and specialised
  { id: "hexbin", name: "Hexbin scatter", engine: "plot", family: "relationship", when: "Two numbers with hundreds of rows: bin them into hexagons and shade each by how many rows land in it.", avoid: "Fewer than ~200 rows, or an exact value: a scatter plot keeps every point.", example: () => ({ title: "Spend vs conversions, binned", rows: cloud, spec: { width: 560, height: 340, x: { label: "Spend (€k)" }, y: { label: "Conversions" }, color: { type: "linear", range: "theme:sequential", legend: false }, marks: [{ type: "hexbin", x: "spend_k", y: "conversions", outputs: { fill: "count" }, binWidth: 16, inset: -0.4 }, { type: "text", data: [{ text: "Darker = more campaigns" }], text: "text", frameAnchor: "top-left", dx: 6, dy: 12, fill: "theme:muted", fontSize: 10 }] } }) },
  { id: "contour", name: "Density contours", engine: "plot", family: "distribution", when: "Where two measures pile up, as filled contour bands rather than individual points.", avoid: "Few rows, where every value matters: use scatter.", example: () => ({ title: "Where campaigns concentrate", rows: cloud, spec: { width: 560, height: 340, clip: true, x: { label: "Spend (€k)" }, y: { label: "Conversions" }, color: { type: "linear", range: "theme:sequential", legend: false }, marks: [{ type: "density", x: "spend_k", y: "conversions", fill: "density", thresholds: 10, stroke: "theme:background", strokeWidth: 0.5 }] } }) },
  { id: "beeswarm", name: "Beeswarm", engine: "plot", family: "distribution", when: "Every observation as one dot, dodged sideways where values collide, so a small sample reads exactly.", avoid: "Thousands of rows, where the swarm becomes a block: use a box plot.", example: () => {
    const rows = distRows.slice(0, 150)
    const names = [...new Set(rows.map(row => String(row.group)))]
    const width = 560, height = 340
    // One band per service, and inside it one packed column of dots per collision: the offsets are geometry, so the
    // swarm is the same picture on every render and the value axis stays where the data put it.
    const band = (width - 56) / names.length
    const reach = Math.max(4, band / 2 - 7)
    const placed: Row[] = rows.map(row => ({ ...row }))
    names.forEach((name, index) => {
      const at = rows.flatMap((row, i) => (String(row.group) === name ? [i] : []))
      const offsets = swarmOffsets(at.map(i => ({ value: Number(rows[i]!.latency_ms) })), { radius: 4, padding: 2, height: height - 94, minOffset: -reach, maxOffset: reach })
      at.forEach((i, k) => { placed[i] = { ...placed[i]!, position: index + offsets[k]! / band } })
    })
    const low = Math.min(...rows.map(row => Number(row.latency_ms)))
    return {
      title: "Response times by service",
      rows: placed,
      spec: {
        width, height,
        // Room under the plot for the band names and the axis title, which stand where a band axis would put them.
        marginBottom: 50,
        x: { domain: [-0.5, names.length - 0.5], axis: null },
        y: { label: "Latency (ms)", insetTop: 12, insetBottom: 12 },
        marks: [
          { type: "dot", x: "position", y: "latency_ms", r: 4, fill: "theme:categorical.0", fillOpacity: 0.65 },
          { type: "text", data: names.map((name, index) => ({ position: index, base: low, name })), x: "position", y: "base", text: "name", textAnchor: "middle", dy: 18, fill: "theme:muted", fontSize: 11 },
          { type: "text", data: [{ position: (names.length - 1) / 2, base: low, text: "Service" }], x: "position", y: "base", text: "text", textAnchor: "middle", dy: 35, fill: "theme:muted", fontSize: 11 },
        ],
      },
    }
  } },
  { id: "bollinger", name: "Bollinger band", engine: "plot", family: "trend", when: "A time series with a moving average and a volatility band around it, so a run above or below normal shows.", avoid: "A short series: the band needs a window of points to mean anything.", example: () => ({ title: "Weekly sessions, with a 20-week band", rows: weeklySessions, spec: { width: 560, height: 340, x: { domain: [20, 52], label: "Week" }, y: { label: "Sessions" }, marks: [{ type: "bollingerY", x: "week", y: "sessions", n: 20, k: 2, fill: "theme:categorical.0", fillOpacity: 0.22, stroke: "theme:categorical.0", strokeWidth: 1.5 }] } }) },
  { id: "difference_area", name: "Difference area", engine: "plot", family: "trend", when: "Two series shaded by which one is ahead: plan against actual, forecast against outcome.", avoid: "Series that cross many times: the bands become noise; plot both lines.", example: () => ({ title: "Actual against plan", rows: planActual, spec: { width: 560, height: 340, x: { label: "Day" }, marks: [{ type: "differenceY", x: "day", y1: "plan", y2: "actual", positiveFill: "theme:positive", negativeFill: "theme:negative", fillOpacity: 0.7 }, { type: "lineY", x: "day", y: "plan", stroke: "theme:text", strokeWidth: 1.5 }, { type: "lineY", x: "day", y: "actual", stroke: "theme:muted", strokeWidth: 1.5 }, { type: "text", data: [{ x: 2, y: 147, text: "Above plan" }], x: "x", y: "y", text: "text", textAnchor: "start", fill: "theme:positive", fontSize: 11, fontWeight: 600 }, { type: "text", data: [{ x: 2, y: 141, text: "Below plan" }], x: "x", y: "y", text: "text", textAnchor: "start", fill: "theme:negative", fontSize: 11, fontWeight: 600 }, { type: "text", data: [{ x: 28, y: planActual.at(-1)!.plan, text: "Plan" }], x: "x", y: "y", text: "text", textAnchor: "end", dx: -8, dy: -11, fill: "theme:text", fontSize: 11, fontWeight: 600 }, { type: "text", data: [{ x: 24, y: planActual.at(-5)!.actual, text: "Actual" }], x: "x", y: "y", text: "text", textAnchor: "start", dx: 6, dy: 16, fill: "theme:muted", fontSize: 11, fontWeight: 600 }] } }) },
  { id: "waffle", name: "Waffle", engine: "plot", family: "part-to-whole", when: "A part-to-whole composition as a grid of unit squares: counts readers can point at.", avoid: "More than ~6 parts, or precise comparison: use a bar chart.", example: () => {
    const grid = 10, cell = 28
    const span = grid * cell, legend = 132, pad = 8
    const { cells, order, counts } = waffleCells(composition.map(row => ({ name: String(row.category), value: Number(row.value) })), grid, cell)
    const total = counts.reduce((sum, value) => sum + value, 0) || 1
    const fontSize = 11
    return {
      title: "Sales mix, by unit sold",
      rows: composition,
      spec: {
        width: span + legend + 2 * pad, height: span + 2 * pad,
        marginTop: pad, marginRight: pad, marginBottom: pad, marginLeft: pad,
        x: { domain: [0, span + legend], axis: null },
        y: { domain: [0, span], axis: null },
        marks: [
          ...order.map((name, index) => ({ type: "rect", data: cells.filter(row => row.series === index), x1: "x1", x2: "x2", y1: "y1", y2: "y2", fill: `theme:categorical.${index % 6}`, stroke: "none", title: name })),
          ...order.flatMap((name, index) => [
            { type: "rect", data: [{ x1: span + 18, x2: span + 30, y1: span - 6 - (index + 1) * 22, y2: span - 6 - index * 22 }], x1: "x1", x2: "x2", y1: "y1", y2: "y2", fill: `theme:categorical.${index % 6}`, stroke: "none" },
            { type: "text", data: [{ x: span + 36, y: span - 10 - index * 22, text: `${name} ${Math.round((counts[index]! / total) * 100)}%` }], x: "x", y: "y", text: "text", textAnchor: "start", fill: "theme:muted", fontSize },
          ]),
        ],
      },
    }
  } },
  { id: "arrow_change", name: "Arrow change", engine: "plot", family: "comparison", when: "Two measures before and after, one arrow per item: where each moved, and how far.", avoid: "Many items, where the arrows cross: use a slope chart or a dumbbell.", example: () => ({ title: "Revenue and conversion, before and after", rows: arrowRows, spec: { width: 560, height: 340, x: { domain: [50, 152], label: "Average order value (€)" }, y: { domain: [22, 80], label: "Conversion (%)" }, marks: [{ type: "arrow", x1: "start", y1: "from", x2: "end", y2: "to", bend: 16, stroke: "theme:axis", strokeWidth: 1.5 }, { type: "dot", x: "start", y: "from", r: 2.5, fill: "theme:muted" }, { type: "dot", x: "end", y: "to", r: 2.5, fill: "theme:categorical.0" }, ...arrowLabels.map(place => ({ type: "text", data: [arrowRows[place.index]!], x: "end", y: "to", text: "label", dx: place.dx, dy: place.dy, textAnchor: place.anchor, fill: "theme:text", fontSize: 11 }))] } }) },
  { id: "voronoi", name: "Voronoi tessellation", engine: "plot", family: "relationship", when: "Split the plane into the region nearest each point, so local density and gaps read at once.", avoid: "Reading exact positions: the cells hide the points' own values.", example: () => ({ title: "Nearest campaign to any spend and conversion", rows: cloud.slice(0, 70), spec: { width: 560, height: 340, x: { label: "Spend (€k)" }, y: { label: "Conversions" }, marks: [{ type: "voronoi", x: "spend_k", y: "conversions", fill: "theme:categorical.0", fillOpacity: 0.12, stroke: "theme:axis", strokeOpacity: 0.42, strokeWidth: 0.9 }, { type: "dot", x: "spend_k", y: "conversions", r: 3, fill: "theme:categorical.1" }] } }) },
  { id: "ridgeline", name: "Ridgeline", engine: "plot", family: "distribution", when: "A density curve per group, stacked so several distributions compare by shape.", avoid: "More than ~8 groups: the curves overlap into a texture.", example: () => {
    const { areas, labels } = ridgeline(distRows, "latency_ms", "group", 48)
    const names = ["A", "B", "C"]
    return {
      title: "Latency distribution by service",
      rows: distRows,
      spec: {
        width: 560, height: 360,
        x: { label: "Latency (ms)" },
        y: { domain: [0, names.length], axis: null },
        color: { type: "ordinal", domain: names, range: "theme:categorical", legend: false },
        marks: [
          { type: "areaY", data: areas, x: "x", y1: "base", y2: "ridge", z: "category", fill: "category", fillOpacity: 0.85, curve: "basis" },
          { type: "ruleY", data: names.map((category, index) => ({ y: names.length - 1 - index, category })), y: "y", stroke: "theme:grid", strokeWidth: 0.75 },
          { type: "text", data: labels, x: "x", y: "ridge", text: "category", textAnchor: "start", dx: 2, fill: "theme:muted", fontSize: 11 },
        ],
      },
    }
  } },
  { id: "horizon", name: "Horizon chart", engine: "plot", family: "trend", when: "A long run folded into colour bands, so a year fits in a short strip.", avoid: "Reading exact values: a folded value is not a height; use a line chart.", example: () => {
    const folded = horizonBands(horizonRows, "day", "page_views", 4)
    const folds = [0, 1, 2, 3]
    const ramp = ["theme:sequential.2", "theme:sequential.4", "theme:sequential.6", "theme:sequential.7"]
    return {
      title: "Page views, folded into four bands",
      rows: horizonRows,
      spec: {
        width: 560, height: 196,
        marginTop: 28,
        x: { domain: [1, 120], label: "Day" },
        y: { domain: [0, 1], axis: null },
        color: { type: "ordinal", domain: folds, range: ramp, legend: false },
        marks: [
          { type: "areaY", data: folded, x: "x", y1: "y0", y2: "y1", z: "band", fill: "band", stroke: "none" },
          { type: "ruleY", data: [0], stroke: "theme:axis", strokeWidth: 1 },
          ...folds.flatMap(band => [
            { type: "rect" as const, data: [{ x1: 66 + band * 14, x2: 71 + band * 14, y1: 1.08, y2: 1.18 }], x1: "x1", x2: "x2", y1: "y1", y2: "y2", fill: ramp[band], clip: false },
            { type: "text" as const, data: [{ x: 72.5 + band * 14, y: 1.13, text: `B${band + 1}` }], x: "x", y: "y", text: "text", textAnchor: "start" as const, fill: "theme:muted", fontSize: 10, clip: false },
          ]),
        ],
      },
    }
  } },
  { id: "cartogram_us_hex", name: "US state hex cartogram", engine: "plot", family: "map", when: "Compare a value across US states, where every state deserves the same space whatever its area.", avoid: "Geographic shape or position itself: use the US states choropleth.", example: () => ({ title: "Adults with home broadband, by state", rows: usCartogram, spec: usHexSpec(usCartogram) }) },
  { id: "cartogram_eu_tile", name: "Europe tile cartogram", engine: "plot", family: "map", when: "Compare a value across European countries as equal tiles: the 27 EU members plus the UK, Switzerland, Norway, Iceland and Ukraine.", avoid: "A world comparison: use the world choropleth.", example: () => ({ title: "Digital index, by country", rows: euCartogram, spec: euTileSpec(euCartogram) }) },
  { id: "flow_map", name: "Geodesic flow map", engine: "plot", family: "map", when: "Volumes moving between places as great-circle arcs over a world land base.", avoid: "One-way stage volumes with no geography: use a Sankey.", example: () => ({ title: "Where travellers fly", rows: flowRows, spec: flowMapSpec(flowRows) }) },

  // ---- ECharts 6: advanced statistical and narrative series
  { id: "violin", name: "Violin plot", engine: "echarts", family: "distribution", when: "Compare the shape of a distribution across a few groups, not just its quartiles.", avoid: "Fewer than ~20 values per group: a box plot or a strip plot is enough.", example: () => {
    const groups = ["A", "B", "C"].map(name => ({ name, values: distRows.filter(row => row.group === name).map(row => Number(row.latency_ms)) }))
    return { title: "Response time by service", rows: distRows, width: 640, height: 380, spec: violinOption(groups) }
  } },
  { id: "sparkline_matrix", name: "Sparkline matrix", engine: "echarts", family: "trend", when: "A grid of entities against metrics, each row a shape to scan: a KPI wall.", avoid: "Exact comparison across rows: the dots share no common scale.", example: () => ({ title: "Regional KPIs", rows: matrixRows, width: 640, height: 360, spec: matrixOption(matrixRows, "region", ["revenue", "margin", "nps", "churn"]) }) },
  { id: "pictorial_bar", name: "Pictorial bar", engine: "echarts", family: "comparison", when: "A ranked comparison where a repeated symbol or a capped bar makes the quantities friendlier.", avoid: "Precision work: a plain bar chart reads more exactly.", example: () => ({ title: "Active users by country", rows: COUNTRIES.slice(0, 6).map((country, i) => ({ country, users_k: Math.round(820 - i * 61 + ((i * 37) % 50)) })), spec: { title: { text: "Active users by country", left: "center", textStyle: { fontSize: 16, fontWeight: 600, color: "theme:text" } }, grid: { left: 96, right: 64, top: 72, bottom: 32 }, xAxis: { type: "value", splitLine: { show: true }, axisLabel: { color: "theme:muted" } }, yAxis: { type: "category", inverse: true, data: COUNTRIES.slice(0, 6), axisLine: { show: false }, axisTick: { show: false }, axisLabel: { color: "theme:text" } }, series: [
    { type: "bar", barWidth: 16, itemStyle: { color: "theme:categorical.0", borderRadius: 8 }, label: { show: true, position: "right", distance: 20, formatter: "{c}", color: "theme:text", fontSize: 11 }, data: COUNTRIES.slice(0, 6).map((_, i) => Math.round(820 - i * 61 + ((i * 37) % 50))) },
    { type: "pictorialBar", symbol: "circle", symbolPosition: "end", symbolSize: [16, 16], z: 3, itemStyle: { color: "theme:categorical.0" }, data: COUNTRIES.slice(0, 6).map((_, i) => Math.round(820 - i * 61 + ((i * 37) % 50))) },
  ] } }) },
  { id: "theme_river", name: "Theme river", engine: "echarts", family: "trend", when: "Changing composition over time as one flowing stream, where the overall shape matters more than exact values.", avoid: "Reading one series exactly: use a multi-series line.", example: () => {
    const channels = ["Search", "Social", "Email", "Direct"]
    const points = MONTHS.flatMap((date, i) => channels.map((name, k) => [date, Math.round(wave(i, 320 * (1 + k * 0.45), 60 + k * 18, k * 0.9)), name]))
    return {
      title: "Sessions by channel",
      width: 640, height: 380,
      spec: {
        title: { text: "Sessions by channel", subtext: "Monthly sessions across four acquisition channels, 2024", left: "center", textStyle: { fontSize: 16, fontWeight: 600, color: "theme:text" }, subtextStyle: { color: "theme:muted", fontSize: 12 } },
        singleAxis: { type: "time", top: 84, bottom: 64, left: 40, right: 40, axisLabel: { color: "theme:muted", formatter: "{MMM}" }, axisLine: { show: true }, splitLine: { show: false } },
        legend: { bottom: 8, textStyle: { color: "theme:muted" } },
        series: [{ type: "themeRiver", label: { show: false }, data: points }],
      },
    }
  } },

  // ---- Data-graphic tables
  { id: "data_table", name: "Publication data table", engine: "table", family: "table", when: "A ranked list where the reader needs the number and its shape: inline bars, sparklines and signed deltas beside the values.", avoid: "One measure across many categories: a bar chart compares faster.", example: () => ({
    title: "Regional revenue, 2026",
    rows: tableRows,
    spec: {
      title: "Regional revenue, 2026",
      subtitle: "Growth against last year, with a five-month trend",
      kicker: "Commercial review",
      source: "Source: finance close, November 2026",
      notes: "Growth is year on year; the trend is monthly revenue.",
      zebra: true,
      rowGroupField: "mix",
      columns: [
        { field: "region", label: "Region" },
        { field: "revenue", label: "Revenue", spanner: "Money", format: "currency", cell: "bar" },
        { field: "growth", label: "Growth", spanner: "Money", format: "percent", cell: "delta" },
        { field: "status", label: "Status", spanner: "Delivery", cell: "badge", badgeColors: { "At risk": "theme:negative", Ahead: "theme:positive" } },
        { field: "trend", label: "Trend", spanner: "Shape", cell: "sparkline" },
      ],
      summaryRow: { label: "Total", operations: { revenue: "sum", growth: "mean" } },
    },
  }) },
  { id: "kpi_table", name: "KPI scorecard table", engine: "table", family: "table", when: "An executive scorecard: actual against target with a bullet bar, a sparkline of the run up to it, and a heatmap of shares.", avoid: "A single KPI: a headline value or a bullet chart is smaller.", example: () => ({
    title: "Service KPIs, this quarter",
    rows: kpiRows,
    spec: {
      title: "Service KPIs, this quarter",
      subtitle: "Satisfaction against target, tickets and the weekly run",
      kicker: "Operations review",
      source: "Source: support platform, week 12",
      columns: [
        { field: "team", label: "Team" },
        { field: "csat", label: "CSAT", format: "integer", cell: "bullet", targetField: "csat_target", domain: [70, 100] },
        { field: "weekly", label: "Last five weeks", cell: "sparkarea" },
        { field: "tickets_share", label: "Share of tickets", format: "percent", cell: "heatmap" },
      ],
      summaryRow: { label: "Team mean", operations: { csat: "mean", tickets_share: "sum" } },
    },
  }) },

  // ---- Deterministic offline diagrams
  { id: "flowchart", name: "Flowchart", engine: "diagram", family: "diagram", when: "A process with decisions and branches, as boxes and arrows a reader can follow.", avoid: "Volumes moving between stages: use a Sankey, whose widths carry the amounts.", example: () => ({ title: "Invoice triage", spec: { dsl: "flowchart LR\n  A[Invoice received] --> B{Under 500?}\n  B -->|yes| C[Auto-approve]\n  B -->|no| D[Manager review]\n  D --> E{Approved?}\n  E -->|yes| F[Pay run]\n  E -->|no| G[Query raised]\n  G --> A", title: "Invoice triage", kicker: "Finance operations", source: "Process owner: accounts payable" } }) },
  { id: "sequence_diagram", name: "Sequence diagram", engine: "diagram", family: "diagram", when: "Who calls whom, in what order: a protocol, an API handshake, a checkout.", avoid: "State that does not move forward in time: use a state diagram.", example: () => ({ title: "Card payment", spec: { dsl: "sequenceDiagram\n  participant C as Customer\n  participant S as Shop\n  participant P as Payment provider\n  C->>S: Place order\n  S->>P: Authorise\n  P-->>S: Approved\n  S-->>C: Confirmation\n  P->>S: Settlement", title: "Card payment", subtitle: "Authorisation, then settlement", source: "Protocol: 3-D Secure" } }) },
  { id: "state_diagram", name: "State diagram", engine: "diagram", family: "diagram", when: "The states one thing moves through, and the events that move it.", avoid: "Several actors and their messages: use a sequence diagram.", example: () => ({ title: "Subscription lifecycle", spec: { dsl: "stateDiagram-v2\n  [*] --> Trial\n  Trial --> Active : payment\n  Trial --> Expired : no payment\n  Active --> Paused : request\n  Paused --> Active : resume\n  Active --> Cancelled : cancel\n  Cancelled --> [*]\n  Expired --> [*]", title: "Subscription lifecycle", kicker: "Billing", source: "States as at November 2026" } }) },
  { id: "er_diagram", name: "Entity-relationship diagram", engine: "diagram", family: "diagram", when: "A schema: entities, their keys and the cardinality between them.", avoid: "Runtime order of calls: use a sequence diagram.", example: () => ({ title: "Orders schema", spec: { dsl: "erDiagram\n  CUSTOMER {\n    string customer_id PK\n    string email\n  }\n  ORDER {\n    string order_id PK\n    date placed_on\n  }\n  LINE_ITEM {\n    int quantity\n    decimal unit_price\n  }\n  PRODUCT {\n    string sku PK\n    decimal price\n  }\n  CATEGORY {\n    string code PK\n    string name\n  }\n  CUSTOMER ||--o{ ORDER : places\n  ORDER ||--|{ LINE_ITEM : contains\n  PRODUCT ||--o{ LINE_ITEM : appears_in\n  CATEGORY ||--o{ PRODUCT : groups", title: "Orders schema", subtitle: "Five tables across customers, orders and products", source: "Schema version 12" } }) },
  { id: "mindmap", name: "Mindmap", engine: "diagram", family: "diagram", when: "A central topic and its branches, for scope or a brainstorm, laid out as a tree.", avoid: "Values within a hierarchy: a treemap carries the sizes.", example: () => ({ title: "Charts platform", spec: { kind: "mindmap", title: "Charts platform", subtitle: "What the plugin covers", root: { label: "Charts" }, nodes: [
    { id: "render", label: "Rendering" }, { id: "vega", label: "Vega and Vega-Lite", parent: "render" }, { id: "echarts", label: "ECharts", parent: "render" }, { id: "plot", label: "Observable Plot", parent: "render" },
    { id: "data", label: "Data" }, { id: "rows", label: "Inline rows", parent: "data" }, { id: "files", label: "Workspace files", parent: "data" },
    { id: "out", label: "Output" }, { id: "svg", label: "SVG and PNG", parent: "out" }, { id: "html", label: "Interactive HTML", parent: "out" }, { id: "table", label: "Tables and diagrams", parent: "out" },
  ] } }) },
  { id: "org_chart", name: "Org chart", engine: "diagram", family: "diagram", when: "Who reports to whom, with roles under each name.", avoid: "Team sizes: a treemap shows how many people each team has.", example: () => ({ title: "Product organisation", spec: { kind: "org_chart", title: "Product organisation", subtitle: "Reporting lines, November 2026", groups: [{ id: "eng", label: "Engineering", nodes: ["cto", "infra"] }, { id: "prod", label: "Product", nodes: ["cpo"] }], nodes: [
    { id: "ceo", label: "Dana Reed", subtitle: "Chief Executive" },
    { id: "cto", label: "Sam Ortiz", subtitle: "Engineering", parent: "ceo", group: "eng" },
    { id: "cpo", label: "Lee Park", subtitle: "Product", parent: "ceo", group: "prod" },
    { id: "infra", label: "Ada Chen", subtitle: "Infrastructure", parent: "cto", group: "eng" },
    { id: "design", label: "Noah Silva", subtitle: "Design", parent: "cpo", group: "prod" },
  ] } }) },
  { id: "fishbone", name: "Fishbone (Ishikawa)", engine: "diagram", family: "diagram", when: "Root causes of one effect, grouped by category, for a review or a post-mortem.", avoid: "Causes with volumes or order: use a flowchart.", example: () => ({ title: "Why deliveries slipped", spec: { kind: "fishbone", title: "Why deliveries slipped", effect: "Late deliveries", kicker: "Post-mortem", causes: [
    { category: "People", causes: ["Two open roles", "Onboarding gap"] },
    { category: "Process", causes: ["Manual handoffs", "No buffer", "Late QA"] },
    { category: "Systems", causes: ["Slow build"] },
    { category: "Suppliers", causes: ["Single source", "Long lead time"] },
  ] } }) },
]

export const catalogueEntry = (id: string) => CATALOGUE.find(entry => entry.id === id)

/** A complete `charts_render` (or `charts_validate`) input: what an example draws, exactly as tested. */
export interface ExampleCall {
  readonly spec: Json
  readonly data?: { readonly rows: Row[] }
  readonly title: string
  readonly currency?: string
  readonly locale?: string
  readonly width?: number
  readonly height?: number
}

/**
 * The one conversion from a catalogue example to the call that draws it, with its data, title, currency, locale and
 * size. `charts_catalogue`, `charts_recommend`'s example drafts, the gallery, the golden suite and the evals all use
 * it, so the call an agent is given is the call the tests render.
 */
export function exampleCall(source: ChartType | Example): ExampleCall {
  const ex = "example" in source ? source.example() : source
  return {
    spec: ex.spec,
    ...(ex.rows ? { data: { rows: ex.rows } } : {}),
    title: ex.title,
    ...(ex.currency ? { currency: ex.currency } : {}),
    ...(ex.locale ? { locale: ex.locale } : {}),
    ...(ex.width !== undefined ? { width: ex.width } : {}),
    ...(ex.height !== undefined ? { height: ex.height } : {}),
  }
}
