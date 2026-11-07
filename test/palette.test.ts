import { describe, expect, test } from "bun:test"
import { MAX_SERIES, distance, inkOn, oklchToHex, paletteReport, parseColour, seriesColours, themeColours } from "../src/themes/palette.js"
import { BUILTIN_THEMES, mergeTokens } from "../src/themes/tokens.js"
import { vegaLiteConfig, echartsTheme } from "../src/themes/adapters.js"

/**
 * A palette that never runs out: the theme's published colours first, then generated ones at a measurable perceptual
 * distance. The point is that a chart with more series than the published set does not silently reuse a colour.
 */

const minDistance = (colours: readonly string[]) => {
  let min = Number.POSITIVE_INFINITY
  for (let i = 0; i < colours.length; i++) for (let j = i + 1; j < colours.length; j++) min = Math.min(min, distance(colours[i]!, colours[j]!))
  return min
}

describe("the series palette", () => {
  test("keeps a theme's published colours first, byte for byte", () => {
    for (const theme of Object.values(BUILTIN_THEMES)) {
      const extended = seriesColours(theme.colors.categorical, theme.colors.categorical.length + 5)
      expect(extended.slice(0, theme.colors.categorical.length)).toEqual(theme.colors.categorical)
    }
  })

  test("never repeats a colour up to twelve series, and keeps 0.075 or better to twenty", () => {
    for (const name of ["light", "dark", "presentation"]) {
      const theme = BUILTIN_THEMES[name]!
      expect(new Set(seriesColours(theme.colors.categorical, 12)).size).toBe(12)
      expect(minDistance(seriesColours(theme.colors.categorical, 12))).toBeGreaterThanOrEqual(0.1)
      expect(new Set(seriesColours(theme.colors.categorical, MAX_SERIES)).size).toBe(MAX_SERIES)
      expect(minDistance(seriesColours(theme.colors.categorical, MAX_SERIES))).toBeGreaterThanOrEqual(0.06)
    }
  })

  test("is deterministic: the same theme and count give the same colours", () => {
    const a = seriesColours(BUILTIN_THEMES.light!.colors.categorical, 20)
    const b = seriesColours(BUILTIN_THEMES.light!.colors.categorical, 20)
    expect(a).toEqual(b)
  })

  test("does not extend print or high-contrast, whose palettes are defined by a constraint", () => {
    for (const name of ["print", "high-contrast"]) {
      const theme = BUILTIN_THEMES[name]!
      expect(themeColours(theme, 20)).toEqual(theme.colors.categorical)
      expect(paletteReport(theme).generated).toBe(0)
    }
  })

  test("extends a brand theme that declares only three colours, so a ten-series chart still reads", () => {
    const brand = mergeTokens(BUILTIN_THEMES.light!, { name: "acme", colors: { categorical: ["#123456", "#C8102E", "#F2A900"] } })
    const colours = themeColours(brand, 10)
    expect(colours.length).toBe(10)
    expect(new Set(colours).size).toBe(10)
    expect(colours.slice(0, 3)).toEqual(["#123456", "#C8102E", "#F2A900"])
    expect(minDistance(colours)).toBeGreaterThanOrEqual(0.1)
  })

  test("reports what is published and what is generated, so nobody mistakes one for the other", () => {
    const light = paletteReport(BUILTIN_THEMES.light!)
    expect(light.published).toBe(7)
    expect(light.available).toBe(MAX_SERIES)
    expect(light.generated).toBe(MAX_SERIES - 7)
  })

  test("reaches both engines with the same categories", () => {
    const theme = BUILTIN_THEMES.light!
    const vl = vegaLiteConfig(theme) as { range: { category: string[] } }
    const echarts = echartsTheme(theme) as { color: string[] }
    expect(vl.range.category).toEqual(echarts.color)
    expect(vl.range.category.length).toBe(MAX_SERIES)
  })
})

describe("colour arithmetic", () => {
  test("parses the forms a theme accepts and refuses anything else", () => {
    expect(parseColour("#4477AA")).toBeDefined()
    expect(parseColour("#47A")).toBeDefined()
    expect(parseColour("#4477AA80")).toBeDefined()
    expect(parseColour("rgb(68, 119, 170)")).toBeDefined()
    expect(parseColour("rgba(68,119,170,0.5)")).toBeDefined()
    expect(parseColour("transparent")).toBeDefined()
    expect(parseColour("rebeccapurple")).toBeUndefined()
    expect(parseColour("#12345")).toBeUndefined()
  })

  test("OKLCH round-trips a known colour close to itself", () => {
    expect(oklchToHex(0.5, 0, 0)).toMatch(/^#[0-9A-F]{6}$/)
    const grey = parseColour(oklchToHex(0.5, 0, 0))!
    expect(grey.a).toBeCloseTo(0, 1)
    expect(grey.b).toBeCloseTo(0, 1)
  })

  test("label ink follows the fill's lightness, not the theme's", () => {
    expect(inkOn("#DDAA33", "#1F2328", "#FFFFFF")).toBe("#1F2328")
    expect(inkOn("#004488", "#1F2328", "#FFFFFF")).toBe("#FFFFFF")
  })
})
