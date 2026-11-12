// Sequential colour (heatmaps, calendars, choropleths) is one hue family in the light and dark themes, with lightness
// turned round for the canvas: more is darker on white and brighter on near-black, and the lowest value stands off
// the dark canvas.
import { expect, test } from "bun:test"
import { contrast } from "../src/themes/contrast.ts"
import { parseColour } from "../src/themes/palette.ts"
import { BUILTIN_THEMES } from "../src/themes/tokens.ts"
import { vegaLiteConfig } from "../src/themes/adapters.ts"

const lab = (hex: string) => parseColour(hex)!
const hue = (hex: string) => { const c = lab(hex); return (Math.atan2(c.b, c.a) * 180) / Math.PI }

test("light and dark sequential ramps share one hue family, ordered by lightness for their canvas", () => {
  const light = BUILTIN_THEMES.light!.colors.sequential, dark = BUILTIN_THEMES.dark!.colors.sequential
  const hues = [...light, ...dark].map(hue)
  expect(Math.max(...hues) - Math.min(...hues)).toBeLessThan(30)
  const l = (ramp: readonly string[]) => ramp.map(c => lab(c).l)
  expect(l(light)).toEqual([...l(light)].sort((a, b) => b - a)) // darker as values grow, on white
  expect(l(dark)).toEqual([...l(dark)].sort((a, b) => a - b)) // brighter as values grow, on near-black
  expect(contrast(dark[0]!, BUILTIN_THEMES.dark!.colors.background)!).toBeGreaterThanOrEqual(1.3)
  // The engines read it: Vega-Lite's ramp and heatmap ranges are the theme's ramp.
  expect((vegaLiteConfig(BUILTIN_THEMES.dark!).range as Record<string, unknown>).heatmap).toEqual(dark)
})
