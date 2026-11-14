import * as z from "zod"
import { GEIST, GEIST_MONO, MONO, SANS } from "../constants.js"
import type { HostThemeSeed } from "./seed.js"

export {
  deltaEok,
  deltaEokCvd,
  derivePairedTheme,
  deriveThemeFromSeed,
  HostThemeSeedSchema,
  normaliseCssColor,
  normaliseThemeColors,
  parseHostThemeSeed,
  seedModeOf,
  themeNameFrom,
  type DeriveThemeOptions,
  type HostThemeSeed,
  type PairedTheme,
  type PairedThemeInput,
} from "./seed.js"

/**
 * A theme is a small set of tokens. Each engine's own theme (Vega-Lite config, Vega config, ECharts theme) is derived
 * from them in adapters.ts, so one brand theme styles every chart type the same way.
 *
 * A colour token takes any CSS Color 4 spelling a host may already use (`#rgb`, `#rrggbb`, `#rrggbbaa`, `rgb()`,
 * `hsl()`, `oklch()`, `oklab()`, `color()`), plus `transparent`. `normaliseThemeColors` reduces a theme to the 8-bit
 * sRGB form the engines draw, and `normaliseCssColor` reduces one value, so a theme saved from modern design tokens
 * still draws everywhere.
 *
 * The grammar is closed on purpose: a functional colour may carry only digits, letters, `.`, `,`, `%`, `+`, `-` and
 * whitespace, so no token can hold `<`, `>`, `{`, `}`, `;`, a backslash, a quote or a backtick — the characters that
 * would end a declaration, a rule or the `<style>` element a theme is written into.
 */
const COLOUR = /^(?:#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})|(?:rgba?|hsla?|oklch|oklab|color)\([0-9a-zA-Z.\s,%+\/-]+\)|transparent)$/
const color = z.string().trim().regex(COLOUR, "a colour is #rgb, #rrggbb, #rrggbbaa, rgb(), rgba(), hsl(), oklch(), oklab(), color() or transparent")
const palette = z.array(color).min(2).max(32)

export const ThemeTokensSchema = z.strictObject({
  name: z.string().trim().regex(/^[a-z0-9][a-z0-9-]{0,47}$/, "a theme name is lowercase letters, digits and dashes"),
  description: z.string().max(300).optional(),
  mode: z.enum(["light", "dark"]),
  colors: z.strictObject({
    background: color,
    text: color,
    muted: color,
    grid: color,
    axis: color,
    categorical: palette,
    sequential: palette,
    diverging: palette,
    positive: color,
    negative: color,
    neutral: color,
    highlight: color,
  }),
  font: z.strictObject({
    family: z.string().min(1).max(100),
    mono: z.string().min(1).max(100),
    size: z.number().min(6).max(48),
    titleSize: z.number().min(6).max(96),
    subtitleSize: z.number().min(6).max(64),
    labelSize: z.number().min(6).max(48),
    titleWeight: z.number().int().min(100).max(900),
    /** Workspace font files (.ttf or .otf) for a brand family; text is measured and drawn with them. */
    files: z.array(z.strictObject({ family: z.string().min(1).max(100), weight: z.number().int().min(100).max(900).default(400), path: z.string().min(1).max(1024) })).max(8).default([]),
  }),
  layout: z.strictObject({
    width: z.number().int().min(50).max(4000),
    height: z.number().int().min(50).max(4000),
    padding: z.number().min(0).max(200),
    step: z.number().min(4).max(200),
  }),
  axis: z.strictObject({
    grid: z.boolean(),
    gridDash: z.array(z.number().min(0).max(50)).max(4),
    domain: z.boolean(),
    ticks: z.boolean(),
    labelPadding: z.number().min(0).max(40),
  }),
  marks: z.strictObject({
    strokeWidth: z.number().min(0.25).max(12),
    pointSize: z.number().min(4).max(800),
    cornerRadius: z.number().min(0).max(40),
    opacity: z.number().min(0.05).max(1),
  }),
  legend: z.strictObject({ orient: z.enum(["right", "bottom", "top", "left"]) }),
})
export type ThemeTokens = z.infer<typeof ThemeTokensSchema>

type Deep<T> = { [K in keyof T]?: T[K] extends readonly unknown[] ? T[K] : T[K] extends object ? Deep<T[K]> : T[K] }
/**
 * A custom theme: any subset of the tokens, on top of a base (a built-in or a saved theme).
 *
 * `seed` is not a token: it is the host's own UI colours, and `deriveThemeFromSeed` turns them into a complete token
 * set. `variants` carries one seed per mode, so a name can describe a matched light and dark pair.
 */
export type ThemeOverrides = Deep<ThemeTokens> & {
  extends?: string | null
  seed?: HostThemeSeed
  variants?: { light?: ThemeOverrides; dark?: ThemeOverrides }
}

export const ThemeOverridesSchema: z.ZodType<ThemeOverrides> = z.looseObject({}).describe("Theme tokens to override, on top of `extends` (default light).") as never

// Palettes from published colour-vision-deficiency-safe sets:
// Paul Tol "bright" (https://personal.sron.nl/~pault/), Okabe & Ito (2008), ColorBrewer RdBu and viridis.
export const TOL_BRIGHT = ["#4477AA", "#EE6677", "#228833", "#CCBB44", "#66CCEE", "#AA3377", "#BBBBBB"]
// Okabe–Ito without its yellow (1.3:1 on white), which is swapped for Tol's wine.
export const OKABE_ITO = ["#0072B2", "#E69F00", "#009E73", "#CC79A7", "#56B4E9", "#D55E00", "#882255", "#000000"]
export const OKABE_ITO_DARK = ["#56B4E9", "#E69F00", "#009E73", "#CC79A7", "#F0E442", "#D55E00", "#0072B2", "#BBBBBB"]
export const TOL_HIGH_CONTRAST = ["#004488", "#DDAA33", "#BB5566", "#000000", "#777777"]
/**
 * The lowest stop stands 1.24:1 off white, so a heatmap's first bin is a visible step on the canvas rather than a
 * near-white swatch indistinguishable from the paper; the family and its ordering are unchanged above it.
 */
export const BLUES = ["#DDE8F6", "#C6DAF0", "#AFC8E6", "#86ABD7", "#5E8DC6", "#3D6FAE", "#285389", "#183A63"]
/**
 * BLUES for a dark canvas: the same blue family as light's ramp, with the lightness turned round, so on either theme
 * more is more salient (darker on white, brighter on near-black) and the lowest value still stands off the canvas.
 */
export const BLUES_DARK = ["#1E3550", "#24476E", "#2C5D8E", "#3874AD", "#4E8DC6", "#6FA8D8", "#97C3E6", "#C6DEF2"]
export const VIRIDIS = ["#440154", "#46337E", "#365C8D", "#277F8E", "#1FA187", "#4AC16D", "#A0DA39", "#FDE725"]
export const RDBU = ["#2166AC", "#4393C3", "#92C5DE", "#D1E5F0", "#F7F7F7", "#FDDBC7", "#F4A582", "#D6604D", "#B2182B"]
export const RDBU_DARK = ["#4393C3", "#3A6E99", "#2E4C66", "#2A3340", "#262A31", "#4A3530", "#86493C", "#C0604D", "#F4A582"]
const GREYS = ["#F5F5F5", "#D9D9D9", "#BDBDBD", "#969696", "#737373", "#525252", "#252525"]

const common = {
  font: { family: SANS, mono: MONO, size: 12, titleSize: 16, subtitleSize: 12, labelSize: 11, titleWeight: 600, files: [] },
  layout: { width: 560, height: 320, padding: 16, step: 24 },
  axis: { grid: true, gridDash: [], domain: true, ticks: false, labelPadding: 6 },
  marks: { strokeWidth: 2, pointSize: 48, cornerRadius: 2, opacity: 1 },
  legend: { orient: "right" as const },
}

export const BUILTIN_THEMES: Readonly<Record<string, ThemeTokens>> = {
  light: {
    name: "light", description: "Calm and quiet on white; Paul Tol's colour-blind-safe palette. The default.", mode: "light",
    colors: { background: "#FFFFFF", text: "#1F2328", muted: "#59636E", grid: "#E8EAED", axis: "#9AA1A9", categorical: TOL_BRIGHT, sequential: BLUES, diverging: RDBU, positive: "#228833", negative: "#CC3344", neutral: "#9AA1A9", highlight: "#EE6677" },
    ...common,
  },
  dark: {
    name: "dark", description: "For dark surfaces; Okabe–Ito palette ordered for contrast on a dark ground.", mode: "dark",
    colors: { background: "#16181D", text: "#E6E8EB", muted: "#A3AAB3", grid: "#2A2F37", axis: "#596170", categorical: OKABE_ITO_DARK, sequential: BLUES_DARK, diverging: RDBU_DARK, positive: "#3DBE8B", negative: "#F2707A", neutral: "#7D8590", highlight: "#F0E442" },
    ...common,
  },
  "high-contrast": {
    name: "high-contrast", description: "Black on white, heavier lines and the Okabe–Ito palette, for low vision and projectors.", mode: "light",
    colors: { background: "#FFFFFF", text: "#000000", muted: "#1A1A1A", grid: "#BDBDBD", axis: "#000000", categorical: OKABE_ITO, sequential: VIRIDIS, diverging: RDBU, positive: "#007A4D", negative: "#B5121B", neutral: "#555555", highlight: "#D55E00" },
    ...common,
    font: { ...common.font, size: 13, labelSize: 12, titleSize: 18, titleWeight: 600 },
    axis: { ...common.axis, ticks: true },
    marks: { ...common.marks, strokeWidth: 3, pointSize: 64 },
  },
  print: {
    name: "print", description: "For paper and PDF: white, black text, Tol's high-contrast palette that survives greyscale.", mode: "light",
    colors: { background: "#FFFFFF", text: "#000000", muted: "#333333", grid: "#DDDDDD", axis: "#000000", categorical: TOL_HIGH_CONTRAST, sequential: GREYS, diverging: RDBU, positive: "#004488", negative: "#BB5566", neutral: "#777777", highlight: "#DDAA33" },
    ...common,
    font: { ...common.font, size: 10, labelSize: 9, titleSize: 13, subtitleSize: 10 },
    axis: { ...common.axis, ticks: true, gridDash: [2, 2] },
    marks: { ...common.marks, strokeWidth: 1.5, cornerRadius: 0 },
  },
  presentation: {
    name: "presentation", description: "Large type and thick marks for slides at 16:9.", mode: "light",
    colors: { background: "#FFFFFF", text: "#111418", muted: "#4B535C", grid: "#E3E6EA", axis: "#8D949C", categorical: TOL_BRIGHT, sequential: BLUES, diverging: RDBU, positive: "#228833", negative: "#CC3344", neutral: "#8D949C", highlight: "#EE6677" },
    ...common,
    font: { ...common.font, size: 16, labelSize: 15, titleSize: 26, subtitleSize: 17, titleWeight: 600 },
    layout: { width: 960, height: 480, padding: 24, step: 40 },
    marks: { ...common.marks, strokeWidth: 3.5, pointSize: 110, cornerRadius: 3 },
    legend: { orient: "bottom" },
  },
  /**
   * The editorial four, added in v2: two product-interface themes (Geist light and dark) and two newspaper themes (FT
   * warm paper, The Economist cool stone). Each one is a complete token set, so every engine is styled from the same
   * colours and type; each passes `themeContrastIssues` with no warnings.
   */
  geist: {
    name: "geist", description: "Vercel Geist light: white canvas, near-black text, crisp cobalt-first categories.", mode: "light",
    colors: {
      background: "#FFFFFF", text: "#0A0A0A", muted: "#666666", grid: "#EAEAEA", axis: "#888888",
      categorical: ["#0070F3", "#0D9488", "#B45309", "#7C3AED", "#E11D48", "#0E7490"],
      sequential: ["#DCEAFB", "#BDD6F7", "#93BCF0", "#689FE6", "#3F80D6", "#2362B6", "#144792", "#0A2D64"],
      diverging: ["#0A5BD3", "#4C86DE", "#93B4EC", "#CBD8EF", "#F3E6E8", "#EFB9BF", "#DE868F", "#C13F4E", "#8E1D31"],
      positive: "#0E9F6E", negative: "#E5484D", neutral: "#8F8F8F", highlight: "#0070F3",
    },
    ...common,
    font: { ...common.font, family: GEIST, mono: GEIST_MONO, titleSize: 17, titleWeight: 600 },
  },
  "geist-dark": {
    name: "geist-dark", description: "Vercel Geist dark: near-black canvas, luminous categories and a dark-safe blue ramp.", mode: "dark",
    colors: {
      background: "#0A0A0A", text: "#EDEDED", muted: "#A1A1A1", grid: "#262626", axis: "#525252",
      categorical: ["#4D9DFF", "#2DD4BF", "#F5A623", "#A78BFA", "#FB7185", "#22D3EE"],
      sequential: ["#14243C", "#1B3354", "#23456F", "#2E5A8D", "#3D72AC", "#518BC9", "#71A7E1", "#9DC6F2"],
      diverging: ["#2E6FBF", "#3F5F86", "#3E4A5B", "#333A45", "#2A2C31", "#4A3336", "#7A4149", "#B05663", "#E3818D"],
      positive: "#3DD68C", negative: "#FF6B6B", neutral: "#7D7D7D", highlight: "#4D9DFF",
    },
    ...common,
    font: { ...common.font, family: GEIST, mono: GEIST_MONO, titleSize: 17, titleWeight: 600 },
  },
  "editorial-ft": {
    name: "editorial-ft", description: "Financial Times paper: warm salmon ground, Oxford blue and claret, a warm sequential ramp.", mode: "light",
    colors: {
      background: "#FFF1E5", text: "#33302E", muted: "#66605C", grid: "#E6D9CE", axis: "#999189",
      categorical: ["#0F5499", "#9E2F50", "#0D7680", "#B16E00", "#6B4C9A", "#A0522D"],
      sequential: ["#F3D8C2", "#EFC1A5", "#E5A47F", "#D4855D", "#BC6741", "#9B4C2C", "#742F1C"],
      diverging: ["#0F5499", "#5B8FBF", "#A9C2D8", "#E8E1D8", "#F0D3C2", "#DFA98F", "#C4795C", "#9E2F50"],
      positive: "#2E7D5B", negative: "#9E2F50", neutral: "#8C7F76", highlight: "#9E2F50",
    },
    ...common,
    font: { ...common.font, titleSize: 19, titleWeight: 700 },
  },
  "editorial-economist": {
    name: "editorial-economist", description: "The Economist's cool stone: signature blue, cyan and red, restrained type and a blue ramp.", mode: "light",
    colors: {
      background: "#F2F5F7", text: "#0D1B2A", muted: "#4A5568", grid: "#DCE2E8", axis: "#8292A2",
      categorical: ["#006BA2", "#E3120B", "#379A8B", "#3EBCD2", "#C77700", "#7C5CA8"],
      sequential: ["#D8E5EF", "#BDD4E5", "#9CBFD8", "#76A6C9", "#4F8AB8", "#2E6E9E", "#124F78", "#003A5C"],
      diverging: ["#006BA2", "#4A97BE", "#A3C6D9", "#E9EEF2", "#F5DAD8", "#EDA9A4", "#DB6A62", "#E3120B"],
      positive: "#2E7D4F", negative: "#E3120B", neutral: "#8B98A5", highlight: "#E3120B",
    },
    ...common,
    font: { ...common.font, titleSize: 18, titleWeight: 700 },
  },
}

export function mergeTokens(base: ThemeTokens, overrides: ThemeOverrides): ThemeTokens {
  const merge = (a: unknown, b: unknown): unknown => {
    if (b === undefined) return a
    if (Array.isArray(b) || typeof b !== "object" || b === null || typeof a !== "object" || a === null || Array.isArray(a)) return b
    const out: Record<string, unknown> = { ...(a as Record<string, unknown>) }
    // `extends`, `seed` and `variants` are how a theme is selected and synthesised, never tokens of the theme itself.
    for (const [key, value] of Object.entries(b)) if (key !== "extends" && key !== "seed" && key !== "variants") out[key] = merge(out[key], value)
    return out
  }
  return merge(base, overrides) as ThemeTokens
}
