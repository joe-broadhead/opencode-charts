// Host seeds and CSS Color 4: a host names the colours it already has, and the synthesiser derives a complete token
// set. The tests below pin the normaliser's grammar, the hue-locked neutrals, the colour-vision-deficiency ring, the
// ramps, the aliases a host bridge sends, and the light/dark pair made from one seed.
import { describe, expect, test } from "bun:test"
import { ChartsError } from "../src/errors.ts"
import { apcaContrast, contrast, themeContrastIssues } from "../src/themes/contrast.ts"
import { parseColour } from "../src/themes/palette.ts"
import {
  derivePairedTheme,
  deriveThemeFromSeed,
  deltaEok,
  deltaEokCvd,
  HostThemeSeedSchema,
  normaliseCssColor,
  normaliseThemeColors,
  parseHostThemeSeed,
} from "../src/themes/seed.ts"
import { BUILTIN_THEMES, mergeTokens, ThemeTokensSchema } from "../src/themes/tokens.ts"

const oklch = (hex: string) => parseColour(hex)!
const lightness = (hex: string) => oklch(hex).l
const hue = (hex: string) => {
  const colour = oklch(hex)
  const degrees = (Math.atan2(colour.b, colour.a) * 180) / Math.PI
  return (degrees + 360) % 360
}
const hueGap = (a: number, b: number) => {
  const difference = Math.abs(a - b) % 360
  return difference > 180 ? 360 - difference : difference
}
/** The smallest colour-vision-deficiency distance in a set: what a colour-blind reader still tells apart. */
const minCvd = (colours: readonly string[]) => {
  let smallest = Number.POSITIVE_INFINITY
  for (let i = 0; i < colours.length; i++) for (let j = i + 1; j < colours.length; j++) smallest = Math.min(smallest, deltaEokCvd(colours[i]!, colours[j]!))
  return smallest
}
const isHex = (value: string) => /^#[0-9A-F]{6}([0-9A-F]{2})?$/.test(value)

describe("CSS Color 4 and DTCG colours normalise to 8-bit sRGB", () => {
  test("hex in all four lengths, upper-cased, alpha only when translucent", () => {
    expect(normaliseCssColor("#abc")).toBe("#AABBCC")
    expect(normaliseCssColor("#aabbcc")).toBe("#AABBCC")
    expect(normaliseCssColor("  #FfFfFf  ")).toBe("#FFFFFF")
    expect(normaliseCssColor("#ABCD")).toBe("#AABBCCDD")
    expect(normaliseCssColor("#AABBCC80")).toBe("#AABBCC80")
    expect(normaliseCssColor("#aabbccff")).toBe("#AABBCC")
    expect(normaliseCssColor("transparent")).toBe("transparent")
  })

  test("rgb() in the legacy comma form and the CSS Color 4 space-and-slash form", () => {
    expect(normaliseCssColor("rgb(255, 100, 50)")).toBe("#FF6432")
    expect(normaliseCssColor("rgba(255, 100, 50, 0.5)")).toBe("#FF643280")
    expect(normaliseCssColor("rgb(255 100 50 / 50%)")).toBe("#FF643280")
    expect(normaliseCssColor("rgb(255 100 50)")).toBe("#FF6432")
    expect(normaliseCssColor("rgb(100% 40% 20%)")).toBe("#FF6633")
    expect(normaliseCssColor("rgba(0 0 0 / 0)")).toBe("#00000000")
  })

  test("hsl() and hsla(), with deg, rad, grad and turn hues", () => {
    expect(normaliseCssColor("hsl(0 100% 50%)")).toBe("#FF0000")
    expect(normaliseCssColor("hsl(60, 100%, 50%)")).toBe("#FFFF00")
    expect(normaliseCssColor("hsl(240 100% 50%)")).toBe("#0000FF")
    expect(normaliseCssColor("hsl(0.5turn 100% 50%)")).toBe("#00FFFF")
    expect(normaliseCssColor("hsl(0 0% 100%)")).toBe("#FFFFFF")
    expect(normaliseCssColor("hsl(0 0% 0%)")).toBe("#000000")
    expect(normaliseCssColor("hsla(30, 100%, 50%, 0.25)")).toBe("#FF800040")
    // A mid tone: the hue holds and the channels are the ones CSS names, within a rounding step.
    const azure = normaliseCssColor("hsl(210 80% 50%)")!
    expect(isHex(azure)).toBe(true)
    expect(Math.abs(hue(azure) - hue("#1A80E6"))).toBeLessThan(2)
    expect(deltaEok(azure!, "#1A80E6")).toBeLessThan(0.01)
    expect(normaliseCssColor("hsl(3.665rad 100% 50%)")).toBe("#0080FF")
  })

  test("oklch() and oklab(), in numbers and percentages, with an angle unit and alpha", () => {
    expect(normaliseCssColor("oklch(0.62 0.16 38.4)")).toBe("#D45D35")
    expect(normaliseCssColor("oklch(62% 0.16 38.4deg / 0.8)")).toBe("#D45D35CC")
    expect(normaliseCssColor("oklch(0.62 0.16 38.4 / 50%)")).toBe("#D45D3580")
    expect(normaliseCssColor("oklab(0.62 -0.1 0.12)")).toBe("#66981B")
    // A chroma sRGB cannot hold gives up saturation, never the hue: it stays a red, not a clipped orange.
    const p3 = normaliseCssColor("oklch(0.7 0.4 30)")!
    expect(isHex(p3)).toBe(true)
    expect(Math.abs(hue(p3) - 30)).toBeLessThan(6)
  })

  test("color(srgb …) and color(display-p3 …), gamut-fitted by chroma reduction", () => {
    expect(normaliseCssColor("color(srgb 0.9 0.2 0.1)")).toBe("#E6331A")
    expect(normaliseCssColor("color(srgb 0.9 0.2 0.1 / 0.5)")).toBe("#E6331A80")
    expect(normaliseCssColor("color(display-p3 0.9 0.3 0.2)")).toBe("#F93B21")
    // Pure P3 red lies outside sRGB: the fit keeps the red hue and gives up chroma instead of clipping to #FF0000.
    const wide = normaliseCssColor("color(display-p3 1 0 0)")!
    expect(isHex(wide)).toBe(true)
    expect(wide).not.toBe("#FF0000")
    expect(oklch(wide).b).toBeGreaterThan(0) // still on the red side of the a/b plane
    expect(deltaEok(wide, "#FF0000")).toBeLessThan(0.2)
  })

  test("the W3C DTCG color object, with its spaces, components and alpha", () => {
    expect(normaliseCssColor({ colorSpace: "oklch", components: [0.62, 0.16, 38.4] })).toBe("#D45D35")
    expect(normaliseCssColor({ colorSpace: "oklch", components: [0.62, 0.16, 38.4], alpha: 0.5 })).toBe("#D45D3580")
    expect(normaliseCssColor({ colorSpace: "srgb", components: [1, 0.392, 0.196] })).toBe("#FF6432")
    expect(normaliseCssColor({ colorSpace: "srgb", components: ["none", 0, 0] })).toBe("#000000")
    expect(normaliseCssColor({ colorSpace: "hsl", components: [210, 80, 50] })).toBe("#1A80E6")
    expect(normaliseCssColor({ colorSpace: "display-p3", components: [0.9, 0.3, 0.2], alpha: 1 })).toBe("#F93B21")
    expect(normaliseCssColor({ colorSpace: "oklab", components: [0.62, -0.1, 0.12] })).toBe("#66981B")
    // A wrapper carries its value; a value without components falls back to its hex.
    expect(normaliseCssColor({ $type: "color", $value: { colorSpace: "srgb", components: [1, 0.392, 0.196] } })).toBe("#FF6432")
    expect(normaliseCssColor({ $type: "color", $value: "oklch(0.62 0.16 38.4)" })).toBe("#D45D35")
    expect(normaliseCssColor({ colorSpace: "srgb", components: [], hex: "#123456" })).toBe("#123456")
  })

  test("anything unrecognised is undefined, never a guess", () => {
    for (const value of ["beige", "rebeccapurple", "#12345", "#1234567", "rgb(1 2)", "hsl(10, 20%)", "lab(50 20 30)", "color(rec2020 1 0 0)", "", "   ", 42, null, undefined, true, ["#fff"]]) {
      expect(normaliseCssColor(value)).toBeUndefined()
    }
  })

  test("a colour carrying markup is refused, never carried through to a style sheet", () => {
    const base = BUILTIN_THEMES.light!
    const hostile = { ...base, colors: { ...base.colors, background: 'color(x}</style><img src=x>)' } }
    // The normaliser is the last gate before a token is written into a rule: an unreadable value is THEME_INVALID.
    let caught: unknown
    try { normaliseThemeColors(hostile) } catch (error) { caught = error }
    expect(caught).toBeInstanceOf(ChartsError)
    expect(caught).toMatchObject({ code: "THEME_INVALID" })
    expect((caught as ChartsError).detail).toContain("color(x}")
    // The token grammar refuses it too: no `<`, `>`, `{`, `}`, `;`, backslash, quote or backtick in a functional colour.
    for (const value of ['color(x}</style><img src=x>)', "rgb(0 0 0);}</style>", "#fff;</style>", "oklch(0.5 0.1 30)'\">", "var(--x)", "url(https://example.invalid/x)"]) {
      expect(ThemeTokensSchema.safeParse({ ...base, colors: { ...base.colors, background: value } }).success).toBe(false)
    }
    // A palette entry is held to the same grammar, so a series colour cannot break out either.
    expect(ThemeTokensSchema.safeParse({ ...base, colors: { ...base.colors, categorical: ["#4477AA", "rgb(0 0 0)}</style>"] } }).success).toBe(false)
  })

  test("normaliseThemeColors reduces a whole theme, and leaves the built-ins byte for byte", () => {
    for (const theme of Object.values(BUILTIN_THEMES)) expect(normaliseThemeColors(theme)).toEqual(theme)
    const modern = { ...BUILTIN_THEMES.light!, colors: { ...BUILTIN_THEMES.light!.colors, background: "oklch(1 0 0)", text: "rgb(31 35 40)", categorical: ["#abc", "hsl(0 100% 50%)"] } }
    const normalised = normaliseThemeColors(modern)
    expect(normalised.colors.background).toBe("#FFFFFF")
    expect(normalised.colors.text).toBe("#1F2328")
    expect(normalised.colors.categorical).toEqual(["#AABBCC", "#FF0000"])
    expect(ThemeTokensSchema.safeParse(normalised).success).toBe(true)
  })
})

describe("the host seed contract", () => {
  test("the minimal seed is a ground and an ink; the aliases are interchangeable", () => {
    expect(HostThemeSeedSchema.safeParse({ background: "#FFFFFF", foreground: "#1F2328" }).success).toBe(true)
    expect(HostThemeSeedSchema.safeParse({ surface: "#121417", text: "#ECEFF4", scheme: "dark", primary: "#38BDF8" }).success).toBe(true)
    expect(HostThemeSeedSchema.safeParse({ ground: "#FAF8F5", foreground: "#1A1A18", accent: "#C2410C", mode: "light" }).success).toBe(true)
  })

  test("a seed without a ground or an ink is refused at the token that is missing", () => {
    const missing = (input: unknown) => HostThemeSeedSchema.safeParse(input)
    expect(missing({}).success).toBe(false)
    expect(missing({ background: "#FFFFFF" }).success).toBe(false)
    expect(missing({ foreground: "#1F2328" }).success).toBe(false)
    const parsed = missing({ background: "#FFFFFF" })
    expect(parsed.success).toBe(false)
    if (!parsed.success) expect(parsed.error.issues[0]!.path).toEqual(["foreground"])
  })

  test("a colour outside CSS Color 4, an unknown key and too many series are refused", () => {
    expect(HostThemeSeedSchema.safeParse({ background: "beige", foreground: "#1F2328" }).success).toBe(false)
    expect(HostThemeSeedSchema.safeParse({ background: "#FFFFFF", foreground: "#1F2328", bogus: 1 }).success).toBe(false)
    expect(HostThemeSeedSchema.safeParse({ background: "#FFFFFF", foreground: "#1F2328", series: Array.from({ length: 13 }, () => "#112233") }).success).toBe(false)
    expect(HostThemeSeedSchema.safeParse({ background: "#FFFFFF", foreground: "#1F2328", series: [] }).success).toBe(false)
  })

  test("a token colour takes CSS Color 4 spellings, and still refuses a word that is not a colour", () => {
    const base = BUILTIN_THEMES.light!
    const modern = { ...base, colors: { ...base.colors, background: "oklch(1 0 0)", text: "hsl(210 20% 12%)", grid: "rgb(232 234 237 / 100%)" } }
    expect(ThemeTokensSchema.safeParse(modern).success).toBe(true)
    expect(ThemeTokensSchema.safeParse({ ...base, colors: { ...base.colors, text: "beige" } }).success).toBe(false)
    expect(ThemeTokensSchema.safeParse({ ...base, colors: { ...base.colors, text: "rgb()" } }).success).toBe(false)
  })

  test("a seed names how a theme is made, not a token: merging it keeps the tokens clean", () => {
    const merged = mergeTokens(BUILTIN_THEMES.light!, { seed: { background: "#FAF8F5", foreground: "#1A1A18" }, colors: { highlight: "#123456" } })
    expect(merged.colors.highlight).toBe("#123456")
    expect(Object.hasOwn(merged, "seed")).toBe(false)
    expect(ThemeTokensSchema.safeParse(merged).success).toBe(true)
  })

  test("parseHostThemeSeed refuses untrusted input as THEME_INVALID, at a path", () => {
    const error = (() => { try { parseHostThemeSeed({ background: "beige", foreground: "#1F2328" }) } catch (caught) { return caught } })()
    expect(error).toBeInstanceOf(ChartsError)
    expect(error).toMatchObject({ code: "THEME_INVALID", path: "/theme/seed/background" })
    expect(() => parseHostThemeSeed({ surface: "#121417", text: "#ECEFF4" })).not.toThrow()
  })
})

describe("a derived theme", () => {
  test("warm cream: neutrals keep the paper's hue, secondary ink stays secondary, and every check passes", () => {
    const theme = deriveThemeFromSeed({ background: "#FAF8F5", foreground: "#1A1A18", accent: "#C2410C" }, { name: "cream" })
    expect(ThemeTokensSchema.safeParse(theme).success).toBe(true)
    expect(theme.mode).toBe("light")
    expect(theme.colors.background).toBe("#FAF8F5")
    // The hairlines are the paper's own hue: a warm grey near 78°, never the cold 258° of a default slate rule.
    const gridHue = hue(theme.colors.grid)
    expect(Math.abs(gridHue - 78)).toBeLessThan(25)
    expect(Math.abs(gridHue - 258)).toBeGreaterThan(90)
    expect(lightness(theme.colors.grid)).toBeLessThan(lightness(theme.colors.background))
    expect(lightness(theme.colors.grid)).toBeGreaterThan(lightness(theme.colors.background) - 0.12)
    // The axis is a visible step, and the secondary ink is not the primary ink flattened.
    expect(contrast(theme.colors.axis, theme.colors.background)!).toBeGreaterThanOrEqual(1.5)
    expect(theme.colors.muted).not.toBe(theme.colors.text)
    expect(Math.abs(hue(theme.colors.muted) - gridHue)).toBeLessThan(20)
    expect(contrast(theme.colors.muted, theme.colors.background)!).toBeGreaterThanOrEqual(4.6)
    expect(Math.abs(apcaContrast(theme.colors.muted, theme.colors.background))).toBeGreaterThanOrEqual(60)
    expect(themeContrastIssues(theme)).toEqual([])
    // Eight categories a colour-blind reader can still tell apart.
    expect(theme.colors.categorical).toHaveLength(8)
    expect(new Set(theme.colors.categorical).size).toBe(8)
    expect(minCvd(theme.colors.categorical)).toBeGreaterThanOrEqual(0.07)
    for (let i = 0; i < 8; i++) for (let j = i + 1; j < 8; j++) expect(hueGap(hue(theme.colors.categorical[i]!), hue(theme.colors.categorical[j]!))).toBeGreaterThanOrEqual(22)
    // The sequential ramp is anchored to the paper and spans a full lightness range.
    expect(theme.colors.sequential).toHaveLength(8)
    const span = (lightness(theme.colors.sequential[0]!) - lightness(theme.colors.sequential[7]!)) * 100
    expect(span).toBeGreaterThanOrEqual(50)
    const steps = theme.colors.sequential.map(lightness)
    expect(steps).toEqual([...steps].sort((a, b) => b - a))
    // The diverging ramp has a ground-tinted middle and two arms of equal lightness.
    expect(theme.colors.diverging).toHaveLength(9)
    expect(Math.abs(lightness(theme.colors.diverging[0]!) - lightness(theme.colors.diverging[8]!))).toBeLessThan(0.02)
    expect(Math.abs(hue(theme.colors.diverging[4]!) - gridHue)).toBeLessThan(20)
  })

  test("dark slate: the mode is inferred, and a dark ground flips the neutral direction and the ramp", () => {
    const theme = deriveThemeFromSeed({ background: "#0A2540", foreground: "#F6F9FC", accent: "#635BFF" })
    expect(theme.mode).toBe("dark")
    expect(ThemeTokensSchema.safeParse(theme).success).toBe(true)
    expect(themeContrastIssues(theme)).toEqual([])
    expect(lightness(theme.colors.grid)).toBeGreaterThan(lightness(theme.colors.background))
    // The navy ground's hue carries into the neutrals.
    expect(Math.abs(hue(theme.colors.grid) - hue("#0A2540"))).toBeLessThan(6)
    expect(Math.abs(hue(theme.colors.axis) - hue("#0A2540"))).toBeLessThan(6)
    expect(contrast(theme.colors.axis, theme.colors.background)!).toBeGreaterThanOrEqual(1.5)
    expect(contrast(theme.colors.muted, theme.colors.background)!).toBeGreaterThanOrEqual(4.6)
    expect(Math.abs(apcaContrast(theme.colors.muted, theme.colors.background))).toBeGreaterThanOrEqual(60)
    expect(minCvd(theme.colors.categorical)).toBeGreaterThanOrEqual(0.07)
    // On a dark canvas more is brighter: the ramp runs light-ward.
    expect(lightness(theme.colors.sequential[7]!)).toBeGreaterThan(lightness(theme.colors.sequential[0]!))
    expect(Math.abs(lightness(theme.colors.sequential[0]!) - lightness(theme.colors.sequential[7]!)) * 100).toBeGreaterThanOrEqual(50)
  })

  test("a near-neutral accent on white is given a hue instead of collapsing the ring", () => {
    const theme = deriveThemeFromSeed({ background: "#FFFFFF", foreground: "#222222", accent: "#222222" })
    expect(ThemeTokensSchema.safeParse(theme).success).toBe(true)
    expect(themeContrastIssues(theme)).toEqual([])
    expect(theme.colors.categorical).toHaveLength(8)
    expect(new Set(theme.colors.categorical).size).toBe(8)
    expect(minCvd(theme.colors.categorical)).toBeGreaterThanOrEqual(0.07)
    const hues = theme.colors.categorical.map(hue)
    const spread = Math.max(...hues) - Math.min(...hues)
    expect(spread).toBeGreaterThan(120)
  })

  test("a ten-token view-bridge payload: aliases, a border as the grid, a font and a radius", () => {
    const theme = deriveThemeFromSeed({
      scheme: "dark",
      surface: "#121417",
      raised: "#1A1D22",
      text: "#ECEFF4",
      muted: "#94A3B8",
      border: "#282E38",
      accent: "#38BDF8",
      danger: "#F87171",
      font: "Geist",
      radius: "8px",
    })
    expect(theme.mode).toBe("dark")
    expect(theme.colors.background).toBe("#121417")
    expect(theme.colors.grid).toBe("#282E38")
    expect(theme.colors.text).toBe("#ECEFF4")
    expect(theme.font.family).toBe("Geist")
    expect(theme.marks.cornerRadius).toBe(8)
    expect(theme.colors.negative).toBe("#F87171")
    expect(theme.colors.categorical[0]).toBe(theme.colors.highlight)
    expect(themeContrastIssues(theme)).toEqual([])
    expect(ThemeTokensSchema.safeParse(theme).success).toBe(true)
  })

  test("a host's own series are kept first and the ring is extended cleanly to eight", () => {
    const series = ["#1F77B4", "#FF7F0E", "#2CA02C", "#D62728", "#9467BD"]
    const theme = deriveThemeFromSeed({ background: "#FFFFFF", foreground: "#1F2328", series }, { name: "host-series" })
    expect(theme.colors.categorical.slice(0, 5)).toEqual(series)
    expect(theme.colors.categorical).toHaveLength(8)
    expect(new Set(theme.colors.categorical).size).toBe(8)
    expect(themeContrastIssues(theme)).toEqual([])
    // The generated tail is at a measurable distance from the host's colours.
    for (let i = 5; i < 8; i++) for (let j = 0; j < i; j++) expect(deltaEokCvd(theme.colors.categorical[i]!, theme.colors.categorical[j]!)).toBeGreaterThan(0.05)
  })

  test("a raised surface gives a hue-less ground its hue, so white takes the card's warmth", () => {
    const plain = deriveThemeFromSeed({ background: "#FFFFFF", foreground: "#1F2328" })
    const warm = deriveThemeFromSeed({ background: "#FFFFFF", foreground: "#1F2328", raised: "#F3EEE7" })
    expect(Math.abs(hue(warm.colors.grid) - hue("#F3EEE7"))).toBeLessThan(8)
    expect(Math.abs(hue(warm.colors.axis) - hue("#F3EEE7"))).toBeLessThan(8)
    // Without the hint the same ground has no hue to give, so the neutral stays neutral.
    expect(oklch(plain.colors.grid).a).toBeCloseTo(oklch(plain.colors.grid).b, 1)
  })

  test("the derivation is deterministic and accepts a base theme's typography", () => {
    const seed = { background: "#FFF1E5", foreground: "#33302E", accent: "#0F5499" } as const
    expect(deriveThemeFromSeed(seed)).toEqual(deriveThemeFromSeed(seed))
    const based = deriveThemeFromSeed(seed, { name: "paper", description: "Paper.", base: BUILTIN_THEMES.print! })
    expect(based.name).toBe("paper")
    expect(based.description).toBe("Paper.")
    expect(based.font).toEqual(BUILTIN_THEMES.print!.font)
    expect(based.layout).toEqual(BUILTIN_THEMES.print!.layout)
    expect(based.marks.strokeWidth).toBe(BUILTIN_THEMES.print!.marks.strokeWidth)
    // A seed's own radius and font win over the base's.
    const overridden = deriveThemeFromSeed({ ...seed, font: "Acme Sans", radius: "0.5rem" }, { base: BUILTIN_THEMES.print! })
    expect(overridden.font.family).toBe("Acme Sans")
    expect(overridden.font.mono).toBe(BUILTIN_THEMES.print!.font.mono)
    expect(overridden.marks.cornerRadius).toBe(8)
  })

  test("a theme name is made from the caller's, within the token grammar", () => {
    expect(deriveThemeFromSeed({ background: "#FFFFFF", foreground: "#1F2328" }).name).toBe("seed-light")
    expect(deriveThemeFromSeed({ background: "#111111", foreground: "#EEEEEE" }).name).toBe("seed-dark")
    expect(deriveThemeFromSeed({ background: "#FFFFFF", foreground: "#1F2328" }, { name: "Acme Brand 2026!" }).name).toBe("acme-brand-2026")
  })
})

describe("a paired light and dark theme", () => {
  test("one light seed synthesises a matching dark companion that shares its ground hue and accent", () => {
    const pair = derivePairedTheme({ name: "acme", seed: { background: "#FAF8F5", foreground: "#1A1A18", accent: "#C2410C" } })
    expect(pair.light.mode).toBe("light")
    expect(pair.dark.mode).toBe("dark")
    expect(pair.light.name).toBe("acme-light")
    expect(pair.dark.name).toBe("acme-dark")
    expect(themeContrastIssues(pair.light)).toEqual([])
    expect(themeContrastIssues(pair.dark)).toEqual([])
    expect(ThemeTokensSchema.safeParse(pair.light).success).toBe(true)
    expect(ThemeTokensSchema.safeParse(pair.dark).success).toBe(true)
    expect(lightness(pair.dark.colors.background)).toBeLessThan(lightness(pair.light.colors.background) - 0.6)
    expect(pair.dark.colors.background).not.toBe("#000000")
    // The warm paper hue survives into the dark ground instead of turning a default blue-black.
    expect(Math.abs(hue(pair.dark.colors.background) - hue(pair.light.colors.background))).toBeLessThan(15)
    expect(Math.abs(hue(pair.dark.colors.highlight) - hue(pair.light.colors.highlight))).toBeLessThan(12)
    // The active member follows the mode, defaulting to the seed's own.
    expect(pair.active).toEqual(pair.light)
    expect(derivePairedTheme({ name: "acme", mode: "dark", seed: { background: "#FAF8F5", foreground: "#1A1A18", accent: "#C2410C" } }).active).toEqual(pair.dark)
  })

  test("a dark seed synthesises a light companion, and two given seeds are both used as they are", () => {
    const fromDark = derivePairedTheme({ name: "night", seed: { background: "#0A2540", foreground: "#F6F9FC", accent: "#635BFF" } })
    expect(fromDark.light.mode).toBe("light")
    expect(fromDark.dark.mode).toBe("dark")
    // The dark member keeps the seed it was given, byte for byte.
    expect(fromDark.dark.colors.background).toBe("#0A2540")
    expect(themeContrastIssues(fromDark.light)).toEqual([])
    expect(themeContrastIssues(fromDark.dark)).toEqual([])

    const both = derivePairedTheme({
      name: "acme",
      mode: "dark",
      light: { background: "#FFF1E5", foreground: "#33302E", accent: "#0F5499" },
      dark: { background: "#101820", foreground: "#F2F4F6", accent: "#5B8FBF" },
    })
    expect(both.light.colors.background).toBe("#FFF1E5")
    expect(both.dark.colors.background).toBe("#101820")
    expect(both.active).toEqual(both.dark)
  })

  test("accepts W3C DTCG color objects directly inside a host seed", () => {
    const parsed = parseHostThemeSeed({
      background: { $type: "color", $value: { colorSpace: "srgb", components: [0.98, 0.97, 0.96] } },
      foreground: "oklch(0.22 0.01 60)",
      accent: { colorSpace: "display-p3", components: [0.76, 0.25, 0.05] },
    })
    const derived = deriveThemeFromSeed(parsed)
    expect(derived.mode).toBe("light")
    expect(themeContrastIssues(derived)).toEqual([])
  })
})
