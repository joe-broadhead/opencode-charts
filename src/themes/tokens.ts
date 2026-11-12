import * as z from "zod"
import { MONO, SANS } from "../constants.js"

/**
 * A theme is a small set of tokens. Each engine's own theme (Vega-Lite config, Vega config, ECharts theme) is derived
 * from them in adapters.ts, so one brand theme styles every chart type the same way.
 */
const color = z.string().trim().regex(/^(#[0-9a-fA-F]{3,8}|rgba?\([\d\s.,%]+\)|transparent)$/, "a colour is #rgb, #rrggbb, #rrggbbaa, rgb(), rgba() or transparent")
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
/** A custom theme: any subset of the tokens, on top of a base (a built-in or a saved theme). */
export type ThemeOverrides = Deep<ThemeTokens> & { extends?: string }

export const ThemeOverridesSchema: z.ZodType<ThemeOverrides> = z.looseObject({}).describe("Theme tokens to override, on top of `extends` (default light).") as never

// Palettes from published colour-vision-deficiency-safe sets:
// Paul Tol "bright" (https://personal.sron.nl/~pault/), Okabe & Ito (2008), ColorBrewer RdBu and viridis.
export const TOL_BRIGHT = ["#4477AA", "#EE6677", "#228833", "#CCBB44", "#66CCEE", "#AA3377", "#BBBBBB"]
// Okabe–Ito without its yellow (1.3:1 on white), which is swapped for Tol's wine.
export const OKABE_ITO = ["#0072B2", "#E69F00", "#009E73", "#CC79A7", "#56B4E9", "#D55E00", "#882255", "#000000"]
export const OKABE_ITO_DARK = ["#56B4E9", "#E69F00", "#009E73", "#CC79A7", "#F0E442", "#D55E00", "#0072B2", "#BBBBBB"]
export const TOL_HIGH_CONTRAST = ["#004488", "#DDAA33", "#BB5566", "#000000", "#777777"]
export const BLUES = ["#EEF3FA", "#D3E1F2", "#AFC8E6", "#86ABD7", "#5E8DC6", "#3D6FAE", "#285389", "#183A63"]
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
    colors: { background: "#16181D", text: "#E6E8EB", muted: "#A3AAB3", grid: "#2A2F37", axis: "#596170", categorical: OKABE_ITO_DARK, sequential: VIRIDIS, diverging: RDBU_DARK, positive: "#3DBE8B", negative: "#F2707A", neutral: "#7D8590", highlight: "#F0E442" },
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
}

export function mergeTokens(base: ThemeTokens, overrides: ThemeOverrides): ThemeTokens {
  const merge = (a: unknown, b: unknown): unknown => {
    if (b === undefined) return a
    if (Array.isArray(b) || typeof b !== "object" || b === null || typeof a !== "object" || a === null || Array.isArray(a)) return b
    const out: Record<string, unknown> = { ...(a as Record<string, unknown>) }
    for (const [key, value] of Object.entries(b)) if (key !== "extends") out[key] = merge(out[key], value)
    return out
  }
  return merge(base, overrides) as ThemeTokens
}
