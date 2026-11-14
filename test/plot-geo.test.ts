// The Plot engine, the cartogram grids and their flow arcs: every recipe renders to SVG and PNG, deterministically,
// with no clipped or overlapping label, and every cartogram carries all of its regions.
import { describe, expect, test } from "bun:test"
import { resolve } from "node:path"
import { ChartsError, SpecInvalid } from "../src/errors.js"
import { bundledFonts } from "../src/fonts.js"
import { svgToPng } from "../src/png.js"
import { checkRenderedSvg } from "../src/safety.js"
import { layoutFacts } from "../src/svg.js"
import { BUILTIN_THEMES } from "../src/themes/tokens.js"
import {
  EU_COUNTRY_TILE_GRID,
  US_STATE_HEX_GRID,
  computeFlowArcs,
  hexCenter,
  hexGridExtent,
  hexPolygon,
  swarmOffsets,
} from "../src/geo/cartograms.js"
import {
  PLOT_ATLASES,
  PLOT_MARKS,
  PLOT_RECIPES,
  PLOT_TRANSFORMS,
  atlasFeatures,
  compilePlotRecipe,
  renderPlot,
  validatePlotSpec,
} from "../src/engines/plot.js"
import { mulberry32, withSeededRandom } from "../src/prng.js"
import type { PlotSpec } from "../src/engines/plot.js"
import type { Row } from "../src/data.js"

const ROOT = resolve(import.meta.dir, "..")
const theme = BUILTIN_THEMES.light!
const fonts = bundledFonts(ROOT)

// ---------------------------------------------------------------------------------------------------------------
// Fixtures: one clean data set per recipe.

const scatter: Row[] = Array.from({ length: 220 }, (_, i) => ({ x: Math.sin(i * 0.7) * 40 + Math.cos(i) * 10, y: Math.cos(i * 0.4) * 30 + Math.sin(i * 1.3) * 8 }))
const points: Row[] = scatter.slice(0, 70)
const swarm: Row[] = Array.from({ length: 90 }, (_, i) => ({ group: ["North", "South", "East"][i % 3]!, value: 10 + ((i * 37) % 50) }))
const series: Row[] = Array.from({ length: 60 }, (_, i) => ({ date: i, value: 100 + Math.sin(i / 4) * 12 + ((i * 13) % 7) }))
const compared: Row[] = Array.from({ length: 28 }, (_, i) => ({ date: i, plan: 100 + i * 2, actual: 100 + i * 2 + Math.sin(i / 2) * 6 }))
const composition: Row[] = [{ category: "Rent", value: 34 }, { category: "Food", value: 22 }, { category: "Travel", value: 14 }, { category: "Other", value: 9 }]
const arrows: Row[] = [
  { start: 1, end: 4, from: 20, to: 45, label: "Alpha" },
  { start: 2, end: 6, from: 30, to: 26, label: "Beta" },
  { start: 3, end: 8, from: 50, to: 62, label: "Gamma" },
  { start: 5, end: 9, from: 40, to: 35, label: "Delta" },
]
const ridges: Row[] = Array.from({ length: 240 }, (_, i) => {
  const group = ["alpha", "beta", "gamma"][i % 3]!
  const centre = { alpha: 20, beta: 34, gamma: 46 }[group as "alpha" | "beta" | "gamma"]
  return { group, value: centre + Math.sin(i * 1.7) * 6 + ((i * 11) % 5) }
})
const folded: Row[] = Array.from({ length: 120 }, (_, i) => ({ date: i, value: 40 + Math.sin(i / 5) * 18 + Math.cos(i / 2) * 6, series: i % 2 ? "north" : "south" }))
const flows: Row[] = [
  { originLat: 40.7, originLon: -74, destLat: 51.5, destLon: -0.1, value: 9, label: "New York - London" },
  { originLat: 40.7, originLon: -74, destLat: 25.2, destLon: 55.3, value: 4, label: "New York - Dubai" },
  { originLat: 35.7, originLon: 139.7, destLat: 1.35, destLon: 103.8, value: 6, label: "Tokyo - Singapore" },
  { originLat: 51.5, originLon: -0.1, destLat: -33.9, destLon: 151.2, value: 3, label: "London - Sydney" },
  { originLat: 49, originLon: 2.5, destLat: 40.7, destLon: -74, value: 5, label: "Paris - New York" },
  { originLat: -23.5, originLon: -46.6, destLat: 51.5, destLon: -0.1, value: 2, label: "Sao Paulo - London" },
]
// A spread of values across most states, so the cartogram exercises every band of its ramp.
const states: Row[] = US_STATE_HEX_GRID.slice(0, 40).map((cell, i) => ({ postal: cell.postal, value: 3 + i * 3 }))
const countries: Row[] = EU_COUNTRY_TILE_GRID.slice(0, 28).map((cell, i) => ({ iso3: cell.iso3, value: 4 + i * 3 }))

const FIXTURES: Record<string, Row[]> = {
  hexbin: scatter,
  contour: scatter,
  beeswarm: swarm,
  bollinger: series,
  difference_area: compared,
  waffle: composition,
  arrow_change: arrows,
  voronoi: points,
  ridgeline: ridges,
  horizon: folded,
  cartogram_us_hex: states,
  cartogram_eu_tile: countries,
  flow_map: flows,
}

const draw = (id: string, options: Record<string, unknown> = {}, theme = BUILTIN_THEMES.light!) => {
  const rows = FIXTURES[id]!
  const spec = compilePlotRecipe(id, rows, {}, options, theme)
  return { spec, ...renderPlot(spec, { packageRoot: ROOT, theme, fonts, rows }) }
}

const textOf = (svg: string) => [...svg.matchAll(/<text[^>]*>([^<]*)<\/text>/g)].map(match => match[1]!)

// ---------------------------------------------------------------------------------------------------------------
// The grids.

describe("cartogram grids", () => {
  test("the US hex grid has all 51 states and DC, one cell each, laid out Alaska top left and Florida bottom right", () => {
    expect(US_STATE_HEX_GRID).toHaveLength(51)
    expect(new Set(US_STATE_HEX_GRID.map(cell => cell.postal)).size).toBe(51)
    expect(new Set(US_STATE_HEX_GRID.map(cell => cell.fips)).size).toBe(51)
    expect(new Set(US_STATE_HEX_GRID.map(cell => `${cell.col},${cell.row}`)).size).toBe(51)
    const at = (postal: string) => US_STATE_HEX_GRID.find(cell => cell.postal === postal)!
    expect(at("AK")).toMatchObject({ col: 0, row: 0 })
    expect(at("ME").col).toBe(10)
    expect(at("ME").row).toBe(0)
    expect(at("HI")).toMatchObject({ col: 0, row: 7 })
    expect(at("FL").row).toBe(7)
    expect(at("FL").col).toBeGreaterThan(at("TX").col)
  })

  test("the Europe tile grid has 32 countries, one cell each, and every EU member", () => {
    expect(EU_COUNTRY_TILE_GRID).toHaveLength(32)
    expect(new Set(EU_COUNTRY_TILE_GRID.map(cell => cell.iso3)).size).toBe(32)
    expect(new Set(EU_COUNTRY_TILE_GRID.map(cell => cell.iso2)).size).toBe(32)
    expect(new Set(EU_COUNTRY_TILE_GRID.map(cell => `${cell.col},${cell.row}`)).size).toBe(32)
    const members = ["AUT", "BEL", "BGR", "HRV", "CYP", "CZE", "DNK", "EST", "FIN", "FRA", "DEU", "GRC", "HUN", "IRL", "ITA", "LVA", "LTU", "LUX", "MLT", "NLD", "POL", "PRT", "ROU", "SVK", "SVN", "ESP", "SWE"]
    const present = new Set(EU_COUNTRY_TILE_GRID.map(cell => cell.iso3))
    for (const member of members) expect(present.has(member)).toBe(true)
    for (const other of ["GBR", "CHE", "NOR", "ISL", "UKR"]) expect(present.has(other)).toBe(true)
  })

  test("hexagons are pointy-top and tessellate: six corners, and every neighbour centre is one hex width away", () => {
    const radius = 12
    const hex = hexPolygon(3, 4, radius)
    expect(hex).toHaveLength(6)
    const [cx, cy] = hexCenter(3, 4, radius)
    for (const [x, y] of hex) expect(Math.hypot(x - cx, y - cy)).toBeCloseTo(radius, 6)
    // Pointy top: the topmost and bottommost corners sit on the vertical through the centre.
    expect(hex[0]![0]).toBeCloseTo(cx, 6)
    expect(hex[0]![1]).toBeCloseTo(cy - radius, 6)
    expect(hex[3]![1]).toBeCloseTo(cy + radius, 6)
    // Odd rows shift right by half a hex, so all six neighbours are one hex width away and the plane tiles.
    const width = Math.sqrt(3) * radius
    expect(hexCenter(1, 1, radius)[0] - hexCenter(0, 1, radius)[0]).toBeCloseTo(width, 6)
    expect(hexCenter(1, 1, radius)[0] - hexCenter(1, 0, radius)[0]).toBeCloseTo(width / 2, 6)
    for (const [col, row] of [[4, 4], [2, 3], [3, 3], [2, 5], [3, 5]] as [number, number][]) {
      const [x, y] = hexCenter(col, row, radius)
      expect(Math.hypot(x - cx, y - cy)).toBeCloseTo(width, 6)
    }
    const extent = hexGridExtent([{ col: 0, row: 0 }, { col: 1, row: 1 }], radius)
    expect(extent.width).toBeGreaterThan(width)
    expect(extent.height).toBeCloseTo(2 * radius + 1.5 * radius, 6)
  })
})

describe("great-circle arcs", () => {
  test("an arc is 32 sampled steps from origin to destination", () => {
    const [arc] = computeFlowArcs([{ originLat: 40.7, originLon: -74, destLat: 51.5, destLon: -0.1, value: 3, label: "NYC-LON" }])
    expect(arc!.points).toHaveLength(33)
    expect(arc!.points[0]![0]).toBeCloseTo(-74, 6)
    expect(arc!.points[0]![1]).toBeCloseTo(40.7, 6)
    expect(arc!.points[32]![0]).toBeCloseTo(-0.1, 6)
    expect(arc!.segments).toHaveLength(1)
    expect(arc!.value).toBe(3)
    expect(arc!.label).toBe("NYC-LON")
    for (const [lon, lat] of arc!.points) {
      expect(Number.isFinite(lon) && Number.isFinite(lat)).toBe(true)
      expect(Math.abs(lat)).toBeLessThanOrEqual(90)
    }
  })

  test("a path across the antimeridian is split into two segments instead of streaking across the map", () => {
    const [arc] = computeFlowArcs([{ originLat: 40.7, originLon: -74, destLat: 35.7, destLon: 139.7, value: 5 }])
    expect(arc!.segments.length).toBe(2)
    for (const segment of arc!.segments) {
      expect(segment.length).toBeGreaterThan(1)
      for (let i = 1; i < segment.length; i++) expect(Math.abs(segment[i]![0] - segment[i - 1]![0])).toBeLessThanOrEqual(180)
    }
    expect(arc!.label).toBeUndefined()
  })

  test("a flow without finite coordinates is refused with a path-free data error", () => {
    expect(() => computeFlowArcs([{ originLat: Number.NaN, originLon: 0, destLat: 1, destLon: 1, value: 1 }])).toThrow(ChartsError)
    let error: unknown
    try { computeFlowArcs([{ originLat: Number.NaN, originLon: 0, destLat: 1, destLon: 1, value: 1 } as never]) } catch (caught) { error = caught }
    expect((error as ChartsError).code).toBe("DATA_INVALID")
  })
})

// ---------------------------------------------------------------------------------------------------------------
// The engine's catalogue surface.

describe("the Plot surface", () => {
  test("every mark and transform the catalogue promises is available", () => {
    const marks = ["dot", "barY", "barX", "lineY", "lineX", "areaY", "areaX", "rectY", "rectX", "rect", "cell", "ruleX", "ruleY", "text", "tickX", "tickY", "link", "arrow", "vector", "frame", "graticule", "sphere", "geo", "bollingerY", "differenceY", "linearRegressionY", "hexbin", "contour", "density", "waffleY", "waffleX", "delaunayLink", "delaunayMesh", "voronoi", "voronoiMesh", "hull", "tree"]
    for (const mark of marks) expect(PLOT_MARKS).toContain(mark)
    const transforms = ["binX", "binY", "groupX", "groupY", "groupZ", "stackY", "stackX", "dodgeX", "dodgeY", "hexbin", "normalizeY", "windowY", "centroid"]
    for (const transform of transforms) expect(PLOT_TRANSFORMS).toContain(transform)
    expect([...PLOT_ATLASES].sort()).toEqual(["us-states-10m", "world-110m", "world-land-110m"])
  })

  test("the 13 recipes are listed once each with their bindings", () => {
    expect(PLOT_RECIPES).toHaveLength(13)
    expect(new Set(PLOT_RECIPES.map(recipe => recipe.id)).size).toBe(13)
    expect(new Set(PLOT_RECIPES.map(recipe => recipe.id))).toEqual(new Set(["hexbin", "contour", "beeswarm", "bollinger", "difference_area", "waffle", "arrow_change", "voronoi", "ridgeline", "horizon", "cartogram_us_hex", "cartogram_eu_tile", "flow_map"]))
    for (const recipe of PLOT_RECIPES) {
      expect(recipe.title.length).toBeGreaterThan(0)
      expect(recipe.description.length).toBeGreaterThan(0)
      expect(recipe.bindings.length).toBeGreaterThan(0)
    }
  })

  test("a bundled atlas converts to GeoJSON features offline", () => {
    const land = atlasFeatures(ROOT, "world-land-110m") as { type: string; features: unknown[] }
    expect(land.type).toBe("FeatureCollection")
    expect(land.features.length).toBeGreaterThan(0)
    const states = atlasFeatures(ROOT, "us-states-10m") as { type: string; features: { properties: { postal?: string } }[] }
    expect(states.features.length).toBeGreaterThanOrEqual(51)
    expect(states.features.some(feature => feature.properties.postal === "CA")).toBe(true)
    expect(() => atlasFeatures(ROOT, "mars-10m")).toThrow(ChartsError)
  })
})

// ---------------------------------------------------------------------------------------------------------------
// Determinism.

describe("determinism", () => {
  test("the seeded generator repeats and the override restores Math.random", () => {
    const first = mulberry32(42), second = mulberry32(42)
    for (let i = 0; i < 20; i++) expect(first()).toBe(second())
    expect(mulberry32(42)()).not.toBe(mulberry32(43)())
    const original = Math.random
    const value = withSeededRandom(7, () => Math.random())
    expect(Math.random).toBe(original)
    expect(value).toBe(mulberry32(7)())
  })

  test("the same spec and seed render byte-identical SVG, beeswarm included", () => {
    for (const recipe of PLOT_RECIPES) {
      const rows = FIXTURES[recipe.id]!
      const spec = compilePlotRecipe(recipe.id, rows, {}, {}, theme)
      const first = renderPlot(spec, { packageRoot: ROOT, theme, fonts, rows, seed: 11 })
      const second = renderPlot(spec, { packageRoot: ROOT, theme, fonts, rows, seed: 11 })
      expect(second.svg).toBe(first.svg)
    }
    // The beeswarm places dots by collision, which is the output most likely to drift between runs.
    const spec = compilePlotRecipe("beeswarm", swarm, {}, {}, theme)
    const a = renderPlot(spec, { packageRoot: ROOT, theme, fonts, rows: swarm, seed: 3 }).svg
    const b = renderPlot(spec, { packageRoot: ROOT, theme, fonts, rows: swarm, seed: 3 }).svg
    expect(b).toBe(a)
  })
})

// ---------------------------------------------------------------------------------------------------------------
// Every recipe, end to end.

describe("recipes render clean SVG", () => {
  for (const recipe of PLOT_RECIPES) {
    test(`${recipe.id} renders a safe, labelled, measured SVG`, () => {
      const { svg, width, height, issues } = draw(recipe.id)
      expect(svg.startsWith("<svg")).toBe(true)
      expect(svg.trimEnd().endsWith("</svg>")).toBe(true)
      expect(() => checkRenderedSvg(svg)).not.toThrow()
      expect(issues.filter(issue => issue.level === "error")).toHaveLength(0)
      // The root carries numeric width and height, the bundled family, a background rect and no style sheet at all.
      expect(svg).toMatch(new RegExp(`^<svg[^>]*width="${width}"[^>]*height="${height}"`))
      expect(width).toBeGreaterThanOrEqual(50)
      expect(height).toBeGreaterThanOrEqual(50)
      expect(svg).toContain('font-family="Inter, sans-serif"')
      expect(svg).not.toContain("system-ui")
      expect(svg).not.toContain("<style")
      expect(svg).toContain(`<rect x="0" y="0" width="${width}" height="${height}" fill="${theme.colors.background}"`)
      // No label runs past the edge, and none collides with another.
      const facts = layoutFacts(svg, fonts)
      expect(facts.width).toBe(width)
      expect(facts.height).toBe(height)
      // Every chart here labels something except the flow map, whose hubs carry no text unless asked.
      if (recipe.id === "flow_map") expect(facts.texts).toBe(0)
      else expect(facts.texts).toBeGreaterThan(0)
      expect(facts.clipped).toEqual([])
      expect(facts.overlaps).toEqual([])
    })
  }

  test("the US hex cartogram draws all 51 postal codes", () => {
    const { svg } = draw("cartogram_us_hex")
    const texts = new Set(textOf(svg))
    for (const cell of US_STATE_HEX_GRID) expect(texts.has(cell.postal)).toBe(true)
    // A legend with the value range beside the map.
    const legend = textOf(svg).filter(text => !/^[A-Z]{2}$/.test(text))
    expect(legend.length).toBe(3)
    expect(legend.some(text => text === "3")).toBe(true)
  })

  test("the Europe tile cartogram draws all 32 country codes and a titled legend", () => {
    const { svg } = draw("cartogram_eu_tile", { legendTitle: "Index" })
    const texts = new Set(textOf(svg))
    for (const cell of EU_COUNTRY_TILE_GRID) expect(texts.has(cell.iso2)).toBe(true)
    expect(texts.has("Index")).toBe(true)
  })

  test("a cartogram renders on the dark theme with readable ink and the dark canvas", () => {
    const dark = BUILTIN_THEMES.dark!
    const { svg } = draw("cartogram_eu_tile", { legendTitle: "Index" }, dark)
    expect(svg).toContain(`fill="${dark.colors.background}"`)
    expect(() => checkRenderedSvg(svg)).not.toThrow()
    const facts = layoutFacts(svg, fonts)
    expect(facts.clipped).toEqual([])
    expect(facts.overlaps).toEqual([])
    // Light ink on the darkest tiles and the canvas colour on the lightest: both ends of the dark theme's own text.
    expect(svg).toContain(`fill="${dark.colors.text}"`)
    expect(svg).toContain(`fill="${dark.colors.background}"`)
  })

  test("the beeswarm spreads each group's dots sideways, and every dot stays in the plot box", () => {
    // Repeated values are what a swarm is for: equal readings would sit on one another in a plain dot plot.
    const dense: Row[] = Array.from({ length: 120 }, (_, i) => ({ group: ["North", "South", "East"][i % 3]!, value: 10 + ((i * 37) % 9) }))
    const spec = compilePlotRecipe("beeswarm", dense, { group: "group", value: "value" }, { radius: 4 }, theme)
    const { svg, height } = renderPlot(spec, { packageRoot: ROOT, theme, fonts, rows: dense })
    // A dot mark writes one circle per row, in the mark's own paint; the attribute order is Plot's business.
    const dots = [...svg.matchAll(/<circle\b([^>]*)>/g)].map(match => {
      const at = (name: string) => Number(new RegExp(`\\s${name}="([-\\d.]+)"`).exec(match[1]!)?.[1] ?? Number.NaN)
      return [at("cx"), at("cy")] as const
    })
    expect(dots).toHaveLength(dense.length)
    const xs = dots.map(([cx]) => cx)
    // A swarm, not three columns: one band alone holds many distinct positions, spread well past a dot's width.
    const band = xs.filter(cx => cx < Math.min(...xs) + 120)
    expect(new Set(band.map(cx => cx.toFixed(2))).size).toBeGreaterThan(3)
    expect(Math.max(...band) - Math.min(...band)).toBeGreaterThan(3)
    // And nothing spills: every dot is inside the drawing, clear of the edge and of the axis furniture.
    for (const [cx, cy] of dots) {
      expect(cx).toBeGreaterThan(8)
      expect(cy).toBeGreaterThan(8)
      expect(cy).toBeLessThan(height - 8)
    }
    // The groups are named where a band axis would put them.
    const labels = textOf(renderPlot(compilePlotRecipe("beeswarm", swarm, { group: "group", value: "value" }, {}, theme), { packageRoot: ROOT, theme, fonts, rows: swarm }).svg)
    for (const group of ["North", "South", "East"]) expect(labels).toContain(group)
  })

  test("a swarm's offsets are deterministic, symmetric about the band, and bounded", () => {
    const points = Array.from({ length: 40 }, (_, i) => ({ value: 10 + ((i * 7) % 11) }))
    const first = swarmOffsets(points, { radius: 4, height: 200, minOffset: -20, maxOffset: 20 })
    expect(swarmOffsets(points, { radius: 4, height: 200, minOffset: -20, maxOffset: 20 })).toEqual(first)
    expect(first).toHaveLength(points.length)
    for (const offset of first) expect(Math.abs(offset)).toBeLessThanOrEqual(20)
    // Repeated values collide, so some dot must move; a lone dot has no reason to.
    expect(new Set(first).size).toBeGreaterThan(1)
    expect(swarmOffsets([{ value: 5 }], { radius: 4, height: 200, minOffset: -20, maxOffset: 20 })).toEqual([0])
  })

  test("wide and tall sizes are honoured", () => {
    const wide = draw("hexbin", { width: 860, height: 260 })
    expect(wide.width).toBe(866)
    expect(wide.height).toBe(266)
  })
})

// ---------------------------------------------------------------------------------------------------------------
// PNG.

describe("rasterisation", () => {
  const ids = ["hexbin", "beeswarm", "waffle", "cartogram_us_hex", "flow_map"]
  for (const id of ids) {
    test(`${id} rasterises to a PNG of the reported size`, async () => {
      const { svg, width, height } = draw(id)
      const png = await svgToPng(ROOT, svg, fonts, 1, "Inter")
      expect(png.width).toBe(width)
      expect(png.height).toBe(height)
      expect([...png.png.slice(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
      expect(png.png.byteLength).toBeGreaterThan(1000)
    }, 30_000)
  }
})

// ---------------------------------------------------------------------------------------------------------------
// Hand-written specs: the marks, transforms and diagnostics.

describe("PlotSpec", () => {
  const multi: PlotSpec = {
    width: 560,
    height: 340,
    title: "Twelve weeks",
    subtitle: "Actual against plan",
    marks: [
      { type: "ruleY", data: [0], stroke: "#DDDDDD" },
      { type: "lineY", x: "date", y: "plan", stroke: "#59636E", strokeWidth: 1.5 },
      { type: "areaY", x: "date", y: "actual", fill: "#4477AA", fillOpacity: 0.2 },
      { type: "dot", x: "date", y: "actual", r: 2 },
      { type: "text", data: [{ date: 27, actual: 150, label: "end" }], x: "date", y: "actual", text: "label", dx: -4, dy: 12, textAnchor: "end" },
    ],
  }

  test("a multi-mark spec with a title renders and lays out cleanly", () => {
    const out = renderPlot(multi, { packageRoot: ROOT, theme, fonts, rows: compared })
    expect(out.svg).toContain("Twelve weeks")
    expect(out.svg).toContain("Actual against plan")
    const facts = layoutFacts(out.svg, fonts)
    expect(facts.clipped).toEqual([])
    expect(facts.overlaps).toEqual([])
    expect(out.svg).toBe(renderPlot(multi, { packageRoot: ROOT, theme, fonts, rows: compared }).svg)
  })

  test("declarative transforms stack and bin", () => {
    const spec: PlotSpec = {
      width: 520,
      height: 320,
      marks: [
        { type: "barY", x: "group", y: "value", fill: "group", transform: [{ type: "groupX", args: { y: "sum" } }] },
        { type: "barY", data: swarm.map(row => ({ group: row.group, value: 1 })), x: "group", y: "value", fill: "group", transform: [{ type: "stackY" }] },
      ],
    }
    const out = renderPlot(spec, { packageRoot: ROOT, theme, fonts, rows: swarm })
    expect(out.svg).toContain('aria-label="bar"')
    expect(layoutFacts(out.svg, fonts).clipped).toEqual([])
  })

  test("a mark with its own data and a dodge transform places every point", () => {
    const spec: PlotSpec = {
      width: 520,
      height: 300,
      marks: [{ type: "dot", data: swarm, x: "group", y: "value", r: 3, transform: [{ type: "dodgeY", args: { anchor: "middle", r: 3 } }] }],
    }
    const out = renderPlot(spec, { packageRoot: ROOT, theme, fonts })
    expect((out.svg.match(/<circle/g) ?? []).length).toBe(swarm.length)
  })

  test("a geo mark reads a bundled atlas, with a sphere and graticule around it", () => {
    const spec: PlotSpec = {
      width: 560,
      height: 320,
      projection: "equal-earth",
      marks: [
        { type: "sphere", fill: "none", stroke: "#AAAAAA" },
        { type: "graticule", stroke: "#DDDDDD", strokeWidth: 0.5 },
        { type: "geo", atlas: "world-land-110m", fill: "#E8EAED", stroke: "#FFFFFF", strokeWidth: 0.4 },
        { type: "dot", data: [{ lon: -74, lat: 40.7 }, { lon: 139.7, lat: 35.7 }], x: "lon", y: "lat", r: 3, fill: "#CC3344" },
        { type: "lineY", data: [{ lon: -74, lat: 40.7 }, { lon: 139.7, lat: 35.7 }], x: "lon", y: "lat", stroke: "#CC3344" },
      ],
    }
    const out = renderPlot(spec, { packageRoot: ROOT, theme, fonts })
    expect(out.svg).toContain('aria-label="geo"')
    expect((out.svg.match(/<path/g) ?? []).length).toBeGreaterThan(3)
    expect(() => checkRenderedSvg(out.svg)).not.toThrow()
    expect(layoutFacts(out.svg, fonts).clipped).toEqual([])
  })

  test("a spec-level atlas feeds a geo mark without repeating it", () => {
    const spec: PlotSpec = { width: 480, height: 280, atlas: "us-states-10m", projection: "albers-usa", marks: [{ type: "geo", fill: "#E8EAED", stroke: "#FFFFFF" }] }
    const out = renderPlot(spec, { packageRoot: ROOT, theme, fonts })
    expect(out.svg).toContain('aria-label="geo"')
  })

  test("a channel that names no field is reported with the closest field, and still renders", () => {
    const rows = [{ amount: 4, day: 1 }, { amount: 9, day: 2 }]
    const out = renderPlot({ marks: [{ type: "barY", x: "day", y: "amont" }] }, { packageRoot: ROOT, theme, fonts, rows })
    const warning = out.issues.find(issue => issue.code === "UNKNOWN_FIELD")!
    expect(warning.level).toBe("warning")
    expect(warning.path).toBe("/marks/0/y")
    expect(warning.fix).toContain('"amount"')
    expect(out.svg.startsWith("<svg")).toBe(true)
  })

  test("an unknown mark is refused with a did-you-mean and a JSON path", () => {
    const { issues } = validatePlotSpec({ marks: [{ type: "dott", x: "a", y: "b" }] })
    const error = issues.find(issue => issue.code === "UNKNOWN_MARK")!
    expect(error.path).toBe("/marks/0/type")
    expect(error.fix).toContain('"dot"')
    expect(() => renderPlot({ marks: [{ type: "dott" }] }, { packageRoot: ROOT, theme, fonts })).toThrow(SpecInvalid)
  })

  test("an unknown top-level property and an unknown transform each get a path and a suggestion", () => {
    const property = validatePlotSpec({ markz: [], marks: [{ type: "dot" }] }).issues.find(issue => issue.code === "UNKNOWN_PROPERTY")!
    expect(property.path).toBe("/markz")
    expect(property.fix).toContain('"marks"')
    const transform = validatePlotSpec({ marks: [{ type: "dot", transform: [{ type: "dogeY" }] }] }).issues.find(issue => issue.code === "TRANSFORM_INVALID")!
    expect(transform.path).toBe("/marks/0/transform/0/type")
    expect(transform.fix).toContain('"dodgeY"')
  })

  test("an empty mark list and a bad size are refused", () => {
    expect(validatePlotSpec({ marks: [] }).issues.some(issue => issue.level === "error")).toBe(true)
    expect(validatePlotSpec({ marks: [{ type: "dot" }], width: 10 }).issues.some(issue => issue.code === "SPEC_INVALID")).toBe(true)
    expect(() => renderPlot({ marks: [] }, { packageRoot: ROOT, theme, fonts })).toThrow(ChartsError)
  })

  test("two placement transforms in one mark are refused", () => {
    const { issues } = validatePlotSpec({ marks: [{ type: "dot", x: "a", y: "b", transform: [{ type: "dodgeY" }, { type: "hexbin" }] }] })
    expect(issues.some(issue => issue.code === "TRANSFORM_INVALID" && /stacked/.test(issue.message))).toBe(true)
  })

  test("an unknown recipe id names the closest recipe", () => {
    let error: unknown
    try { compilePlotRecipe("hexbn", [], {}, {}, theme) } catch (caught) { error = caught }
    expect((error as ChartsError).code).toBe("CHART_TYPE_UNKNOWN")
    expect((error as ChartsError).message).toContain('"hexbin"')
  })
})
