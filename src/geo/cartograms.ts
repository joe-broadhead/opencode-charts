import { geoInterpolate } from "d3-geo"
import { ChartsError } from "../errors.js"

/**
 * Grid cartograms, great-circle flows and dot packing: the arithmetic a map or a swarm needs, with no engine in it.
 *
 * A cartogram trades geographic outline for legibility: every region gets the same cell, so small states stay
 * readable and the map ranks regions by value rather than by area. Two curated grids cover the common cases, a US
 * state hex grid and a Europe tile grid, and `computeFlowArcs` turns origin/destination pairs into sampled
 * great-circle paths that a projected chart can draw without a map service. `swarmOffsets` packs one group's dots
 * sideways, which is the geometry both the catalogue's beeswarm example and the Plot engine's recipe are drawn from.
 */

/** One cell of a grid cartogram: where the region sits, and the codes that identify it. */
export interface GridCell {
  readonly col: number
  readonly row: number
}

export interface HexCell extends GridCell {
  /** Two-letter postal code, such as `CA`. */
  readonly postal: string
  readonly name: string
  /** Census state FIPS code, two digits, such as `06`. */
  readonly fips: string
}

export interface TileCell extends GridCell {
  /** ISO 3166-1 alpha-3, such as `DEU`. */
  readonly iso3: string
  /** ISO 3166-1 alpha-2, such as `DE`. */
  readonly iso2: string
  readonly name: string
}

/**
 * The 51 US states and DC on a pointy-top hex grid, in the layout newspapers and public radio use: Alaska top left,
 * Maine top right, Hawaii bottom left, Florida bottom right. Columns run west to east, rows north to south, and no
 * two regions share a cell.
 */
export const US_STATE_HEX_GRID: readonly HexCell[] = [
  { postal: "AK", name: "Alaska", fips: "02", col: 0, row: 0 },
  { postal: "ME", name: "Maine", fips: "23", col: 10, row: 0 },
  { postal: "VT", name: "Vermont", fips: "50", col: 9, row: 1 },
  { postal: "NH", name: "New Hampshire", fips: "33", col: 10, row: 1 },
  { postal: "WA", name: "Washington", fips: "53", col: 0, row: 2 },
  { postal: "ID", name: "Idaho", fips: "16", col: 1, row: 2 },
  { postal: "MT", name: "Montana", fips: "30", col: 2, row: 2 },
  { postal: "ND", name: "North Dakota", fips: "38", col: 3, row: 2 },
  { postal: "MN", name: "Minnesota", fips: "27", col: 4, row: 2 },
  { postal: "IL", name: "Illinois", fips: "17", col: 5, row: 2 },
  { postal: "WI", name: "Wisconsin", fips: "55", col: 6, row: 2 },
  { postal: "MI", name: "Michigan", fips: "26", col: 7, row: 2 },
  { postal: "NY", name: "New York", fips: "36", col: 8, row: 2 },
  { postal: "MA", name: "Massachusetts", fips: "25", col: 9, row: 2 },
  { postal: "RI", name: "Rhode Island", fips: "44", col: 10, row: 2 },
  { postal: "OR", name: "Oregon", fips: "41", col: 0, row: 3 },
  { postal: "NV", name: "Nevada", fips: "32", col: 1, row: 3 },
  { postal: "WY", name: "Wyoming", fips: "56", col: 2, row: 3 },
  { postal: "SD", name: "South Dakota", fips: "46", col: 3, row: 3 },
  { postal: "IA", name: "Iowa", fips: "19", col: 4, row: 3 },
  { postal: "IN", name: "Indiana", fips: "18", col: 5, row: 3 },
  { postal: "OH", name: "Ohio", fips: "39", col: 6, row: 3 },
  { postal: "PA", name: "Pennsylvania", fips: "42", col: 7, row: 3 },
  { postal: "NJ", name: "New Jersey", fips: "34", col: 8, row: 3 },
  { postal: "CT", name: "Connecticut", fips: "09", col: 9, row: 3 },
  { postal: "CA", name: "California", fips: "06", col: 0, row: 4 },
  { postal: "UT", name: "Utah", fips: "49", col: 1, row: 4 },
  { postal: "CO", name: "Colorado", fips: "08", col: 2, row: 4 },
  { postal: "NE", name: "Nebraska", fips: "31", col: 3, row: 4 },
  { postal: "MO", name: "Missouri", fips: "29", col: 4, row: 4 },
  { postal: "KY", name: "Kentucky", fips: "21", col: 5, row: 4 },
  { postal: "WV", name: "West Virginia", fips: "54", col: 6, row: 4 },
  { postal: "VA", name: "Virginia", fips: "51", col: 7, row: 4 },
  { postal: "MD", name: "Maryland", fips: "24", col: 8, row: 4 },
  { postal: "DE", name: "Delaware", fips: "10", col: 9, row: 4 },
  { postal: "AZ", name: "Arizona", fips: "04", col: 1, row: 5 },
  { postal: "NM", name: "New Mexico", fips: "35", col: 2, row: 5 },
  { postal: "KS", name: "Kansas", fips: "20", col: 3, row: 5 },
  { postal: "AR", name: "Arkansas", fips: "05", col: 4, row: 5 },
  { postal: "TN", name: "Tennessee", fips: "47", col: 5, row: 5 },
  { postal: "NC", name: "North Carolina", fips: "37", col: 6, row: 5 },
  { postal: "SC", name: "South Carolina", fips: "45", col: 7, row: 5 },
  { postal: "DC", name: "District of Columbia", fips: "11", col: 8, row: 5 },
  { postal: "OK", name: "Oklahoma", fips: "40", col: 1, row: 6 },
  { postal: "LA", name: "Louisiana", fips: "22", col: 2, row: 6 },
  { postal: "MS", name: "Mississippi", fips: "28", col: 3, row: 6 },
  { postal: "AL", name: "Alabama", fips: "01", col: 4, row: 6 },
  { postal: "GA", name: "Georgia", fips: "13", col: 5, row: 6 },
  { postal: "HI", name: "Hawaii", fips: "15", col: 0, row: 7 },
  { postal: "TX", name: "Texas", fips: "48", col: 1, row: 7 },
  { postal: "FL", name: "Florida", fips: "12", col: 8, row: 7 },
]

/**
 * The 27 EU member states plus the United Kingdom, Switzerland, Norway, Iceland and Ukraine, on a tile grid: the
 * countries a European flow or comparison chart usually needs, arranged so neighbours touch.
 */
export const EU_COUNTRY_TILE_GRID: readonly TileCell[] = [
  { iso3: "ISL", iso2: "IS", name: "Iceland", col: 2, row: 0 },
  { iso3: "NOR", iso2: "NO", name: "Norway", col: 3, row: 1 },
  { iso3: "SWE", iso2: "SE", name: "Sweden", col: 5, row: 1 },
  { iso3: "FIN", iso2: "FI", name: "Finland", col: 7, row: 1 },
  { iso3: "EST", iso2: "EE", name: "Estonia", col: 8, row: 1 },
  { iso3: "IRL", iso2: "IE", name: "Ireland", col: 1, row: 2 },
  { iso3: "GBR", iso2: "GB", name: "United Kingdom", col: 2, row: 2 },
  { iso3: "DNK", iso2: "DK", name: "Denmark", col: 5, row: 2 },
  { iso3: "LVA", iso2: "LV", name: "Latvia", col: 8, row: 2 },
  { iso3: "PRT", iso2: "PT", name: "Portugal", col: 0, row: 3 },
  { iso3: "ESP", iso2: "ES", name: "Spain", col: 1, row: 3 },
  { iso3: "FRA", iso2: "FR", name: "France", col: 3, row: 3 },
  { iso3: "BEL", iso2: "BE", name: "Belgium", col: 4, row: 3 },
  { iso3: "NLD", iso2: "NL", name: "Netherlands", col: 5, row: 3 },
  { iso3: "DEU", iso2: "DE", name: "Germany", col: 6, row: 3 },
  { iso3: "POL", iso2: "PL", name: "Poland", col: 7, row: 3 },
  { iso3: "LTU", iso2: "LT", name: "Lithuania", col: 8, row: 3 },
  { iso3: "CHE", iso2: "CH", name: "Switzerland", col: 3, row: 4 },
  { iso3: "LUX", iso2: "LU", name: "Luxembourg", col: 4, row: 4 },
  { iso3: "AUT", iso2: "AT", name: "Austria", col: 5, row: 4 },
  { iso3: "CZE", iso2: "CZ", name: "Czechia", col: 6, row: 4 },
  { iso3: "SVK", iso2: "SK", name: "Slovakia", col: 7, row: 4 },
  { iso3: "HUN", iso2: "HU", name: "Hungary", col: 8, row: 4 },
  { iso3: "ITA", iso2: "IT", name: "Italy", col: 3, row: 5 },
  { iso3: "SVN", iso2: "SI", name: "Slovenia", col: 5, row: 5 },
  { iso3: "HRV", iso2: "HR", name: "Croatia", col: 6, row: 5 },
  { iso3: "ROU", iso2: "RO", name: "Romania", col: 8, row: 5 },
  { iso3: "UKR", iso2: "UA", name: "Ukraine", col: 9, row: 5 },
  { iso3: "MLT", iso2: "MT", name: "Malta", col: 2, row: 6 },
  { iso3: "GRC", iso2: "GR", name: "Greece", col: 6, row: 6 },
  { iso3: "BGR", iso2: "BG", name: "Bulgaria", col: 7, row: 6 },
  { iso3: "CYP", iso2: "CY", name: "Cyprus", col: 8, row: 7 },
]

/** The width of a pointy-top hex of radius `radius`, and the distance between two columns. */
const hexWidth = (radius: number) => Math.sqrt(3) * radius
/** How far down each row steps: three quarters of a hex's height, so rows interlock. */
const hexRowStep = (radius: number) => 1.5 * radius

/** The centre of the hex at `col`, `row`: odd rows shift half a hex right (odd-r offset layout). */
export function hexCenter(col: number, row: number, radius: number): [number, number] {
  const x = col * hexWidth(radius) + (Math.abs(Math.round(row)) % 2 === 1 ? hexWidth(radius) / 2 : 0)
  const y = row * hexRowStep(radius)
  return [x, y]
}

/**
 * The six corners of the pointy-top hex at `col`, `row`, clockwise from the top vertex, with vertex-to-centre
 * `radius`. Rows interlock because odd rows shift by half a hex and each row steps by three quarters of a hex height.
 */
export function hexPolygon(col: number, row: number, radius: number): [number, number][] {
  const [cx, cy] = hexCenter(col, row, radius)
  const points: [number, number][] = []
  for (let i = 0; i < 6; i++) {
    const angle = (Math.PI / 180) * (60 * i - 90)
    points.push([cx + radius * Math.cos(angle), cy + radius * Math.sin(angle)])
  }
  return points
}

/** The span of a hex grid at `radius`, from the leftmost corner to the rightmost and from the top vertex to the bottom. */
export function hexGridExtent(cells: readonly GridCell[], radius: number): { width: number; height: number } {
  if (cells.length === 0) return { width: 0, height: 0 }
  const half = hexWidth(radius) / 2
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
  for (const cell of cells) {
    const [x, y] = hexCenter(cell.col, cell.row, radius)
    minX = Math.min(minX, x - half)
    maxX = Math.max(maxX, x + half)
    minY = Math.min(minY, y - radius)
    maxY = Math.max(maxY, y + radius)
  }
  return { width: maxX - minX, height: maxY - minY }
}

/**
 * A beeswarm's sideways offsets, in pixels: the dots of one group packed so that no two circles touch, each taking the
 * nearest free slot to its own value, and never more than `maxOffset` from the band's centre. Plot's own `dodgeX`
 * anchors a whole drawing on the canvas centre (it is a one-column swarm), so a grouped swarm is arithmetic here:
 * deterministic, and it leaves the value axis — the thing the reader measures — exactly where the data put it.
 */
export function swarmOffsets(points: readonly { readonly value: number }[], options: { readonly radius: number; readonly height: number; readonly minOffset: number; readonly maxOffset: number; readonly padding?: number }): number[] {
  const radius = Math.max(0.5, options.radius)
  const padding = options.padding ?? 1
  const gap = radius * 2 + padding
  const step = radius + padding / 2
  const values = points.map(point => point.value)
  const low = values.length ? Math.min(...values) : 0
  const high = values.length ? Math.max(...values) : 1
  const span = high - low || 1
  const down = (value: number) => ((value - low) / span) * options.height
  const clampOffset = (value: number) => Math.max(options.minOffset, Math.min(options.maxOffset, value))
  const placed: { x: number; y: number }[] = []
  const out = new Array<number>(points.length).fill(0)
  // Nearest value first, so the densest part of the band packs tidily and the tail has room.
  const order = points.map((point, index) => ({ point, index })).sort((a, b) => a.point.value - b.point.value || a.index - b.index)
  for (const { point, index } of order) {
    const at = down(point.value)
    let chosen = 0
    for (let k = 0; k < 512; k++) {
      const candidate = clampOffset(k === 0 ? 0 : Math.ceil(k / 2) * step * (k % 2 === 1 ? 1 : -1))
      if (placed.every(other => Math.hypot(other.x - candidate, other.y - at) >= gap - 1e-6)) { chosen = candidate; break }
    }
    placed.push({ x: chosen, y: at })
    out[index] = Math.round(chosen * 100) / 100
  }
  return out
}

/** One origin-to-destination flow, in degrees. */
export interface FlowInput {
  readonly originLat: number
  readonly originLon: number
  readonly destLat: number
  readonly destLon: number
  readonly value: number
  readonly label?: string
}

/** A sampled great-circle path, split where it crosses the antimeridian so no segment jumps across the map. */
export interface FlowArc {
  readonly value: number
  readonly label?: string
  /** The origin, as [longitude, latitude]. */
  readonly origin: readonly [number, number]
  /** The destination, as [longitude, latitude]. */
  readonly dest: readonly [number, number]
  /** Every sampled point, in order, as [longitude, latitude]. */
  readonly points: readonly (readonly [number, number])[]
  /** The path split at the antimeridian: one segment normally, two when the arc wraps past ±180°. */
  readonly segments: readonly (readonly (readonly [number, number])[])[]
}

export const FLOW_ARC_STEPS = 32

const finiteNumber = (value: unknown, name: string, index: number): number => {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new ChartsError("DATA_INVALID", `Flow ${index} has no finite ${name}.`, "Give every flow numeric originLat, originLon, destLat and destLon in degrees.")
  return value
}
const wrapLongitude = (lon: number) => ((((lon + 180) % 360) + 360) % 360) - 180

/**
 * Samples each flow as a great-circle arc: `steps` equal steps from origin to destination, in [longitude, latitude].
 * A path that crosses the antimeridian (a longitude jump of more than 180° between two samples) is split there, so
 * each returned segment can be drawn as one polyline instead of streaking across the whole map.
 */
export function computeFlowArcs(flows: readonly FlowInput[], options: { steps?: number } = {}): FlowArc[] {
  const steps = Math.max(4, Math.min(256, Math.round(options.steps ?? FLOW_ARC_STEPS)))
  return flows.map((flow, index) => {
    const origin: [number, number] = [wrapLongitude(finiteNumber(flow.originLon, "originLon", index)), finiteNumber(flow.originLat, "originLat", index)]
    const dest: [number, number] = [wrapLongitude(finiteNumber(flow.destLon, "destLon", index)), finiteNumber(flow.destLat, "destLat", index)]
    const interpolate = geoInterpolate(origin, dest)
    const points: [number, number][] = []
    for (let i = 0; i <= steps; i++) {
      const [lon, lat] = interpolate(i / steps) as [number, number]
      points.push([lon, lat])
    }
    const segments: [number, number][][] = []
    let current: [number, number][] = []
    for (const point of points) {
      const previous = current[current.length - 1]
      if (previous && Math.abs(point[0] - previous[0]) > 180) {
        if (current.length > 1) segments.push(current)
        current = []
      }
      current.push(point)
    }
    if (current.length > 1) segments.push(current)
    return { value: flow.value, ...(flow.label === undefined ? {} : { label: flow.label }), origin, dest, points, segments }
  })
}
