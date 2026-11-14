import * as z from "zod"
import { MONO, SANS } from "../constants.js"
import { ChartsError } from "../errors.js"
import { apcaContrast, contrast } from "./contrast.js"
import type { ThemeTokens } from "./tokens.js"

/**
 * A seed-to-theme synthesiser: a host app, an agent or a design tool names the colours it already uses, and this module
 * derives the whole token set a chart needs from them.
 *
 * Two things make it trustworthy. First, every colour a host might hand over is read with the CSS Color 4 and W3C DTCG
 * grammars (`#hex`, `rgb()`, `hsl()`, `oklch()`, `oklab()`, `color(display-p3 …)` and the DTCG color object), so a
 * modern design token normalises instead of being refused. Second, the derivation is perceptual and hue-locked: neutrals
 * keep the ground's own hue (warm paper keeps warm hairlines), categorical hues are chosen by colour-vision-deficiency
 * distance, and the sequential and diverging ramps are anchored to the ground so a chart never re-tunes its canvas.
 *
 * Everything here is arithmetic on numbers: no clock, no random source, no file, no network, and nothing from the host.
 * The same seed gives the same tokens in Node, a worker and a browser bundle, which is why the document schema can
 * import it.
 */

// ---------------------------------------------------------------------------------------------------------------
// Colour arithmetic: sRGB, linear sRGB, OKLab, OKLCH and the published Machado-2009 CVD matrices.

interface Rgba { readonly r: number; readonly g: number; readonly b: number; readonly alpha: number }
interface Oklab { readonly l: number; readonly a: number; readonly b: number }
interface Oklch { readonly l: number; readonly c: number; readonly h: number }

const clamp01 = (value: number) => (value < 0 ? 0 : value > 1 ? 1 : value)
const clamp = (value: number, lo: number, hi: number) => (value < lo ? lo : value > hi ? hi : value)
const finite = (value: number, fallback = 0) => (Number.isFinite(value) ? value : fallback)

const srgbToLinear = (channel: number) => {
  const c = clamp01(channel)
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}
const linearToSrgb = (channel: number) => {
  const c = channel <= 0.0031308 ? 12.92 * channel : 1.055 * channel ** (1 / 2.4) - 0.055
  return clamp01(c)
}

/** Linear sRGB to OKLab (Björn Ottosson's matrices). */
function linearRgbToOklab(r: number, g: number, b: number): Oklab {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
  return {
    l: 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    a: 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    b: 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  }
}

/** OKLab to linear sRGB; values outside 0..1 are out of the sRGB gamut. */
function oklabToLinearRgb(lab: Oklab): [number, number, number] {
  const l = (lab.l + 0.3963377774 * lab.a + 0.2158037573 * lab.b) ** 3
  const m = (lab.l - 0.1055613458 * lab.a - 0.0638541728 * lab.b) ** 3
  const s = (lab.l - 0.0894841775 * lab.a - 1.291485548 * lab.b) ** 3
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ]
}

const oklchToOklab = (lch: Oklch): Oklab => {
  const radians = (lch.h * Math.PI) / 180
  return { l: lch.l, a: lch.c * Math.cos(radians), b: lch.c * Math.sin(radians) }
}

function oklabToOklch(lab: Oklab): Oklch {
  const c = Math.hypot(lab.a, lab.b)
  if (c < 1e-7) return { l: lab.l, c: 0, h: 0 }
  const degrees = (Math.atan2(lab.b, lab.a) * 180) / Math.PI
  return { l: lab.l, c, h: (degrees + 360) % 360 }
}

/** A colour reduced to the hex form the arithmetic reads; anything unreadable becomes black rather than crashing. */
const readableHex = (value: string): string => {
  const normalised = normaliseCssColor(value)
  return normalised !== undefined && normalised !== "transparent" ? normalised : value
}

/** A colour as OKLCH, from any CSS Color 4 spelling (alpha ignored). */
function toOklch(hex: string): Oklch {
  const rgba = parseHex(readableHex(hex)) ?? { r: 0, g: 0, b: 0, alpha: 1 }
  return oklabToOklch(linearRgbToOklab(srgbToLinear(rgba.r), srgbToLinear(rgba.g), srgbToLinear(rgba.b)))
}

/** Whether an OKLCH colour converts to linear sRGB inside the gamut, with a tolerance for rounding. */
function inGamut(l: number, c: number, h: number, tolerance = 1e-4): boolean {
  const [r, g, b] = oklabToLinearRgb(oklchToOklab({ l, c, h }))
  return r >= -tolerance && r <= 1 + tolerance && g >= -tolerance && g <= 1 + tolerance && b >= -tolerance && b <= 1 + tolerance
}

/** The largest chroma an OKLCH lightness and hue can hold in sRGB, by bisection. */
function maxGamutChroma(l: number, h: number): number {
  if (!inGamut(l, 0, h)) return 0
  let lo = 0
  let hi = 0.5
  for (let i = 0; i < 22; i++) {
    const mid = (lo + hi) / 2
    if (inGamut(l, mid, h)) lo = mid
    else hi = mid
  }
  return lo
}

/** `#RRGGBB`, or `#RRGGBBAA` when the colour is translucent, from non-linear sRGB channels. */
function hexOf(rgba: Rgba): string {
  // The epsilon keeps an exact half-byte (0.1 × 255 = 25.5, held as 25.499999…) on the CSS reference's side of the
  // boundary; it is far below any difference a colour actually carries.
  const byte = (value: number) => Math.round(clamp01(finite(value)) * 255 + 1e-6).toString(16).padStart(2, "0").toUpperCase()
  const alpha = Math.round(clamp01(finite(rgba.alpha, 1)) * 255 + 1e-6)
  const rgb = `#${byte(rgba.r)}${byte(rgba.g)}${byte(rgba.b)}`
  return alpha >= 255 ? rgb : `${rgb}${alpha.toString(16).padStart(2, "0").toUpperCase()}`
}

/**
 * OKLCH to `#RRGGBB`: a colour outside sRGB has its chroma reduced by a factor of 0.9 per step until it is inside, which
 * keeps the lightness and hue a seed asked for and only gives up saturation.
 */
function hexFromOklch(lch: Oklch, alpha = 1): string {
  const l = clamp(finite(lch.l), 0, 1)
  const h = ((finite(lch.h) % 360) + 360) % 360
  let c = Math.max(0, Math.min(0.5, finite(lch.c)))
  for (let step = 0; step < 40 && !inGamut(l, c, h); step++) c *= 0.9
  const [r, g, b] = oklabToLinearRgb(oklchToOklab({ l, c, h }))
  return hexOf({ r: linearToSrgb(r), g: linearToSrgb(g), b: linearToSrgb(b), alpha })
}

/** OKLab to `#RRGGBB`, gamut-fitted through OKLCH. */
function hexFromOklab(lab: Oklab, alpha = 1): string {
  return hexFromOklch(oklabToOklch(lab), alpha)
}

/** Euclidean distance in OKLab. 0.02 is a hairline, 0.10 is a clearly different swatch. */
export function deltaEok(a: string, b: string): number {
  const x = toOklabOf(a)
  const y = toOklabOf(b)
  return Math.hypot(x.l - y.l, x.a - y.a, x.b - y.b)
}

const toOklabOf = (value: string): Oklab => {
  const rgba = parseHex(readableHex(value)) ?? { r: 0, g: 0, b: 0, alpha: 1 }
  return linearRgbToOklab(srgbToLinear(rgba.r), srgbToLinear(rgba.g), srgbToLinear(rgba.b))
}

// Machado, Oliveira and Fernandes (2009), severity 1.0, applied in linear sRGB. The published matrices for the two most
// common forms of colour-vision deficiency; a palette that separates under both separates for almost every reader.
const PROTAN = [
  [0.152286, 1.052583, -0.204868],
  [0.114503, 0.786281, 0.099216],
  [-0.003882, -0.048116, 1.051998],
] as const
const DEUTAN = [
  [0.367322, 0.860646, -0.227968],
  [0.280085, 0.672501, 0.047413],
  [-0.01182, 0.04294, 0.968881],
] as const

const applyMatrix = (matrix: readonly (readonly [number, number, number])[], linear: readonly [number, number, number]): [number, number, number] => {
  const [r, g, b] = linear
  return [
    matrix[0]![0] * r + matrix[0]![1] * g + matrix[0]![2] * b,
    matrix[1]![0] * r + matrix[1]![1] * g + matrix[1]![2] * b,
    matrix[2]![0] * r + matrix[2]![1] * g + matrix[2]![2] * b,
  ]
}

/** How a colour appears with protanopia or deuteranopia, as OKLab. */
function simulateCvd(value: string, matrix: readonly (readonly [number, number, number])[]): Oklab {
  const rgba = parseHex(readableHex(value)) ?? { r: 0, g: 0, b: 0, alpha: 1 }
  const linear = applyMatrix(matrix, [srgbToLinear(rgba.r), srgbToLinear(rgba.g), srgbToLinear(rgba.b)])
  return linearRgbToOklab(clamp01(linear[0]), clamp01(linear[1]), clamp01(linear[2]))
}

/**
 * The distance a colour-vision-deficient reader still sees between two colours: the smallest of the ordinary OKLab
 * distance and the distance under protanopia and deuteranopia. A categorical ring maximises the smallest of these, so
 * two series never collapse into one swatch for a colour-blind reader.
 */
export function deltaEokCvd(a: string, b: string): number {
  const plain = deltaEok(a, b)
  const pairs: Array<[Oklab, Oklab]> = [[simulateCvd(a, PROTAN), simulateCvd(b, PROTAN)], [simulateCvd(a, DEUTAN), simulateCvd(b, DEUTAN)]]
  let smallest = plain
  for (const [x, y] of pairs) smallest = Math.min(smallest, Math.hypot(x.l - y.l, x.a - y.a, x.b - y.b))
  return smallest
}

// ---------------------------------------------------------------------------------------------------------------
// CSS Color 4 and W3C DTCG 2025.10 colour input.

function parseHex(text: string): Rgba | undefined {
  const match = /^#([0-9a-f]{3,8})$/i.exec(text.trim())
  if (!match) return undefined
  const digits = match[1]!
  const pair = (pairText: string) => parseInt(pairText.length === 1 ? pairText + pairText : pairText, 16) / 255
  if (digits.length === 3 || digits.length === 4) {
    return { r: pair(digits[0]!), g: pair(digits[1]!), b: pair(digits[2]!), alpha: digits.length === 4 ? pair(digits[3]!) : 1 }
  }
  if (digits.length === 6 || digits.length === 8) {
    return { r: pair(digits.slice(0, 2)), g: pair(digits.slice(2, 4)), b: pair(digits.slice(4, 6)), alpha: digits.length === 8 ? pair(digits.slice(6, 8)) : 1 }
  }
  return undefined
}

/** Splits `rgb(r g b / a)` into its channels and its optional alpha. */
function splitAlpha(body: string): { main: string; alpha?: string } {
  const slash = body.indexOf("/")
  if (slash === -1) return { main: body.trim() }
  return { main: body.slice(0, slash).trim(), alpha: body.slice(slash + 1).trim() }
}

const splitChannels = (main: string): string[] => (main.includes(",") ? main.split(",") : main.split(/\s+/)).map(part => part.trim()).filter(Boolean)

const alphaOf = (text: string | undefined): number => {
  if (text === undefined) return 1
  const value = text.endsWith("%") ? Number(text.slice(0, -1)) / 100 : Number(text)
  return Number.isFinite(value) ? clamp01(value) : 1
}

/** A hue with any CSS angle unit, in degrees. */
function hueOf(text: string): number {
  const match = /^(-?[\d.]+)(deg|grad|rad|turn)?$/i.exec(text.trim())
  if (!match) return Number.NaN
  const value = Number(match[1])
  if (!Number.isFinite(value)) return Number.NaN
  switch ((match[2] ?? "deg").toLowerCase()) {
    case "rad": return (value * 180) / Math.PI
    case "grad": return value * 0.9
    case "turn": return value * 360
    default: return value
  }
}

/** An rgb() or rgba() body, in the legacy comma form or the space-and-slash form. */
function parseRgbBody(body: string): Rgba | undefined {
  const { main, alpha } = splitAlpha(body)
  const parts = splitChannels(main)
  if (parts.length < 3 || parts.length > 4) return undefined
  const channel = (text: string) => (text.endsWith("%") ? Number(text.slice(0, -1)) / 100 : Number(text) / 255)
  const r = channel(parts[0]!)
  const g = channel(parts[1]!)
  const b = channel(parts[2]!)
  const a = alpha === undefined ? (parts[3] !== undefined ? alphaOf(parts[3]) : 1) : alphaOf(alpha)
  if (![r, g, b].every(Number.isFinite)) return undefined
  return { r: clamp01(r), g: clamp01(g), b: clamp01(b), alpha: a }
}

function hslToRgb(hue: number, saturation: number, lightness: number): [number, number, number] {
  const h = (((hue % 360) + 360) % 360) / 360
  const s = clamp01(saturation)
  const l = clamp01(lightness)
  if (s === 0) return [l, l, l]
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s
  const p = 2 * l - q
  const channel = (t: number) => {
    const x = t < 0 ? t + 1 : t > 1 ? t - 1 : t
    if (x < 1 / 6) return p + (q - p) * 6 * x
    if (x < 1 / 2) return q
    if (x < 2 / 3) return p + (q - p) * (2 / 3 - x) * 6
    return p
  }
  return [channel(h + 1 / 3), channel(h), channel(h - 1 / 3)]
}

function parseHslBody(body: string): Rgba | undefined {
  const { main, alpha } = splitAlpha(body)
  const parts = splitChannels(main)
  if (parts.length < 3 || parts.length > 4) return undefined
  const hue = hueOf(parts[0]!)
  const percent = (text: string) => {
    const value = text.endsWith("%") ? Number(text.slice(0, -1)) : Number(text)
    return Number.isFinite(value) ? value / 100 : Number.NaN
  }
  const saturation = percent(parts[1]!)
  const lightness = percent(parts[2]!)
  const a = alpha === undefined ? (parts[3] !== undefined ? alphaOf(parts[3]) : 1) : alphaOf(alpha)
  if (![hue, saturation, lightness].every(Number.isFinite)) return undefined
  const [r, g, b] = hslToRgb(hue, saturation, lightness)
  return { r, g, b, alpha: a }
}

/** The lightness of `oklch()` and `oklab()`: 0..1, or a percentage. */
const unitLightness = (text: string): number => {
  const value = text.endsWith("%") ? Number(text.slice(0, -1)) / 100 : Number(text)
  if (!Number.isFinite(value)) return Number.NaN
  return value > 1 && value <= 100 ? value / 100 : value
}

const unitChroma = (text: string): number => {
  const value = text.endsWith("%") ? (Number(text.slice(0, -1)) / 100) * 0.4 : Number(text)
  return Number.isFinite(value) ? value : Number.NaN
}

function parseOklchBody(body: string): { lch: Oklch; alpha: number } | undefined {
  const { main, alpha } = splitAlpha(body)
  const parts = splitChannels(main)
  if (parts.length < 3) return undefined
  const l = unitLightness(parts[0]!)
  const c = unitChroma(parts[1]!)
  const h = hueOf(parts[2]!)
  if (![l, c, h].every(Number.isFinite)) return undefined
  return { lch: { l: clamp(l, 0, 1), c: Math.max(0, c), h: ((h % 360) + 360) % 360 }, alpha: alphaOf(alpha) }
}

function parseOklabBody(body: string): Oklab | undefined {
  const { main } = splitAlpha(body)
  const parts = splitChannels(main)
  if (parts.length < 3) return undefined
  const l = unitLightness(parts[0]!)
  const a = unitChroma(parts[1]!)
  const b = unitChroma(parts[2]!)
  if (![l, a, b].every(Number.isFinite)) return undefined
  return { l: clamp(l, 0, 1), a, b }
}

const alphaOfBody = (body: string): number => alphaOf(splitAlpha(body).alpha)

// CSS Color 4 matrices: display-p3 linear to XYZ D65, and XYZ D65 to linear sRGB.
const P3_TO_XYZ = [
  [0.4865709486482162, 0.26566769316909306, 0.1982172852343625],
  [0.2289745640697488, 0.6917385218365064, 0.079286914093745],
  [0, 0.04511338185890264, 1.043944368900976],
] as const
const XYZ_TO_SRGB = [
  [3.2409699419045226, -1.537383177570094, -0.4986107602930034],
  [-0.9692436362808796, 1.8759675015077202, 0.04155505740717559],
  [0.05563007969699366, -0.20397695888897652, 1.0569715142428786],
] as const

/** A linear-light channel triple in any RGB space, to OKLab through XYZ D65. */
function xyzToOklab(xyz: readonly [number, number, number]): Oklab {
  const linear = applyMatrix(XYZ_TO_SRGB, xyz)
  return linearRgbToOklab(linear[0], linear[1], linear[2])
}

/** `color(srgb …)`, `color(srgb-linear …)` and `color(display-p3 …)`, alpha optional. */
function parseColorBody(body: string): string | undefined {
  const { main, alpha } = splitAlpha(body)
  const parts = splitChannels(main)
  const space = parts[0]?.toLowerCase()
  if (!space || parts.length < 4) return undefined
  const channel = (text: string) => (text.endsWith("%") ? Number(text.slice(0, -1)) / 100 : Number(text))
  const values = [channel(parts[1]!), channel(parts[2]!), channel(parts[3]!)]
  if (!values.every(Number.isFinite)) return undefined
  const [r, g, b] = values as [number, number, number]
  const a = alphaOf(alpha)
  switch (space) {
    case "srgb":
      return hexOf({ r: clamp01(r), g: clamp01(g), b: clamp01(b), alpha: a })
    case "srgb-linear":
      return hexOf({ r: linearToSrgb(r), g: linearToSrgb(g), b: linearToSrgb(b), alpha: a })
    case "display-p3": {
      const linearP3 = [srgbToLinear(r), srgbToLinear(g), srgbToLinear(b)] as const
      const xyz = applyMatrix(P3_TO_XYZ, linearP3)
      return hexFromOklab(xyzToOklab(xyz), a)
    }
    case "xyz-d65":
    case "xyz":
      return hexFromOklab(xyzToOklab([r, g, b]), a)
    default:
      return undefined
  }
}

/** A W3C DTCG 2025.10 color object, or a wrapper such as `{ $type: "color", $value: … }`. */
function fromDtcg(input: object): string | undefined {
  const record = input as Record<string, unknown>
  const unwrapped = "$value" in record ? record.$value : record
  if (typeof unwrapped === "string") return normaliseCssColor(unwrapped)
  if (typeof unwrapped !== "object" || unwrapped === null) return undefined
  const value = unwrapped as Record<string, unknown>
  const hex = typeof value.hex === "string" ? normaliseCssColor(value.hex) : undefined
  if (value.colorSpace === undefined) return hex
  const space = String(value.colorSpace).toLowerCase()
  const components = Array.isArray(value.components) ? value.components : undefined
  if (!components || components.length < 3) return hex
  const component = (index: number): number => {
    const entry = components[index]
    if (entry === "none" || entry === undefined || entry === null) return 0
    const number = typeof entry === "number" ? entry : Number(entry)
    return Number.isFinite(number) ? number : 0
  }
  const alpha = typeof value.alpha === "number" && Number.isFinite(value.alpha) ? clamp01(value.alpha) : 1
  const [x, y, z] = [component(0), component(1), component(2)]
  switch (space) {
    case "srgb": return hexOf({ r: clamp01(x), g: clamp01(y), b: clamp01(z), alpha })
    case "srgb-linear": return hexOf({ r: linearToSrgb(x), g: linearToSrgb(y), b: linearToSrgb(z), alpha })
    case "hsl": {
      const [r, g, b] = hslToRgb(x, y / 100, z / 100)
      return hexOf({ r, g, b, alpha })
    }
    case "oklch": return hexFromOklch({ l: x > 1 ? x / 100 : x, c: y, h: z }, alpha)
    case "oklab": return hexFromOklab({ l: x > 1 ? x / 100 : x, a: y, b: z }, alpha)
    case "display-p3": {
      const xyz = applyMatrix(P3_TO_XYZ, [srgbToLinear(x), srgbToLinear(y), srgbToLinear(z)])
      return hexFromOklab(xyzToOklab(xyz), alpha)
    }
    case "xyz-d65": return hexFromOklab(xyzToOklab([x, y, z]), alpha)
    default: return hex
  }
}

/**
 * Normalises any colour a host may hand over to 8-bit sRGB: `#rgb`, `#rgba`, `#rrggbb`, `#rrggbbaa`, `rgb()`/`rgba()` in
 * the legacy and the space-and-slash form, `hsl()`/`hsla()`, `oklch()`, `oklab()`, `color(srgb …)`,
 * `color(display-p3 …)` and the W3C DTCG color object. `transparent` stays the keyword. Alpha below 1 becomes
 * `#RRGGBBAA`; anything unrecognised is `undefined`, never a guess.
 */
export function normaliseCssColor(input: unknown): string | undefined {
  if (input === undefined || input === null) return undefined
  if (typeof input === "object") return fromDtcg(input)
  if (typeof input !== "string") return undefined
  const text = input.trim()
  if (!text || text.length > 200) return undefined
  if (text.toLowerCase() === "transparent") return "transparent"
  if (text.startsWith("#")) {
    const rgba = parseHex(text)
    return rgba ? hexOf(rgba) : undefined
  }
  const call = /^([a-z]+)\((.*)\)$/is.exec(text)
  if (!call) return undefined
  const name = call[1]!.toLowerCase()
  const body = call[2]!.trim()
  switch (name) {
    case "rgb":
    case "rgba": {
      const rgba = parseRgbBody(body)
      return rgba ? hexOf(rgba) : undefined
    }
    case "hsl":
    case "hsla": {
      const rgba = parseHslBody(body)
      return rgba ? hexOf(rgba) : undefined
    }
    case "oklch": {
      const parsed = parseOklchBody(body)
      return parsed ? hexFromOklch(parsed.lch, parsed.alpha) : undefined
    }
    case "oklab": {
      const lab = parseOklabBody(body)
      return lab ? hexFromOklab(lab, alphaOfBody(body)) : undefined
    }
    case "color":
      return parseColorBody(body)
    default:
      return undefined
  }
}

/**
 * The same theme with every colour token in the canonical 8-bit sRGB form, so a theme that names `oklch()` or a DTCG
 * object is still drawn from one set of strings. A token that cannot be read is refused with THEME_INVALID: it is the
 * last gate before a colour is written into a rule, and a string this module could not parse is exactly the string a
 * `<style>` breakout is made of.
 */
export function normaliseThemeColors(theme: ThemeTokens): ThemeTokens {
  const one = (value: string): string => {
    const normalised = normaliseCssColor(value)
    if (normalised === undefined) {
      const shown = value.length > 60 ? `${value.slice(0, 60)}…` : value
      throw new ChartsError("THEME_INVALID", `The theme colour ${JSON.stringify(shown)} is not a CSS colour.`, 'Use #rgb, #rrggbb, #rrggbbaa, rgb(), hsla(), oklch(), oklab(), color() or transparent.')
    }
    return normalised
  }
  const many = (values: readonly string[]) => values.map(one)
  return {
    ...theme,
    colors: {
      background: one(theme.colors.background),
      text: one(theme.colors.text),
      muted: one(theme.colors.muted),
      grid: one(theme.colors.grid),
      axis: one(theme.colors.axis),
      categorical: many(theme.colors.categorical),
      sequential: many(theme.colors.sequential),
      diverging: many(theme.colors.diverging),
      positive: one(theme.colors.positive),
      negative: one(theme.colors.negative),
      neutral: one(theme.colors.neutral),
      highlight: one(theme.colors.highlight),
    },
  }
}

// ---------------------------------------------------------------------------------------------------------------
// The host seed contract.

const dtcgColourValue = z.strictObject({
  colorSpace: z.string().trim().min(1).max(40),
  components: z.array(z.union([z.number().finite(), z.literal("none")])).min(3).max(4),
  alpha: z.number().min(0).max(1).optional(),
  hex: z.string().max(16).optional(),
})

const seedColour = z.union([
  z.string().trim().min(1).max(120),
  dtcgColourValue,
  z.strictObject({ $type: z.literal("color").optional(), $value: dtcgColourValue }),
])
  .refine((value) => normaliseCssColor(value) !== undefined, "a seed colour is a CSS Color 4 value (#rgb, #rrggbb, rgb(), hsl(), oklch(), oklab(), color(), transparent) or a W3C DTCG color object")

const seedMode = z.enum(["light", "dark"])

const firstColour = (...values: Array<unknown>): string | undefined => {
  for (const value of values) {
    if (value === undefined) continue
    const normalised = normaliseCssColor(value)
    if (normalised !== undefined) return normalised
  }
  return undefined
}

/**
 * The minimal theme a host app or an agent can honestly describe: the colours it already paints with, under whichever of
 * several familiar names it calls them (`background`/`surface`/`ground`, `foreground`/`text`, `accent`/`primary`,
 * `negative`/`danger`/`destructive`, `positive`/`success`). Everything else is a hint that the synthesiser honours when
 * it can and derives when it cannot.
 */
export const HostThemeSeedSchema = z.strictObject({
  background: seedColour.optional().describe("The chart canvas: the page or card the chart sits on."),
  surface: seedColour.optional().describe("A background by another name; used when `background` is absent."),
  ground: seedColour.optional().describe("A background by another name; used when `background` is absent."),
  foreground: seedColour.optional().describe("Primary ink: axis labels, tick text, titles."),
  text: seedColour.optional().describe("A foreground by another name; used when `foreground` is absent."),
  accent: seedColour.optional().describe("The host's brand or action colour; the first categorical hue when `series` is absent."),
  primary: seedColour.optional().describe("An accent by another name; used when `accent` is absent."),
  mode: seedMode.optional().describe("light or dark. Inferred from the background's OKLCH lightness when absent."),
  scheme: seedMode.optional().describe("A mode by another name; used when `mode` is absent."),
  raised: seedColour.optional().describe("A raised surface above the background, such as a card or a panel."),
  muted: seedColour.optional().describe("Secondary ink. Derived, and verified for contrast, when absent."),
  border: seedColour.optional().describe("Hairlines and dividers; becomes the chart's grid."),
  grid: seedColour.optional().describe("The grid line colour; derived from the background's hue when absent."),
  axis: seedColour.optional().describe("The axis line and tick colour; derived and held above 1.5:1 when absent."),
  series: z.array(seedColour).min(1).max(12).optional().describe("The host's own categorical colours, such as --chart-1..5. Kept first, then the ring is filled to eight."),
  positive: seedColour.optional().describe("The colour of a gain, a rise or a success."),
  success: seedColour.optional().describe("A positive by another name; used when `positive` is absent."),
  negative: seedColour.optional().describe("The colour of a loss, a fall or a failure."),
  danger: seedColour.optional().describe("A negative by another name; used when `negative` is absent."),
  destructive: seedColour.optional().describe("A negative by another name; used when `negative` and `danger` are absent."),
  warning: seedColour.optional().describe("A cautionary colour; used as the highlight when none is given."),
  neutral: seedColour.optional().describe("A quiet reference colour for baselines and totals."),
  highlight: seedColour.optional().describe("The focal accent; the accent when absent."),
  font: z.string().trim().min(1).max(100).optional().describe("The UI's font family for chart text."),
  mono: z.string().trim().min(1).max(100).optional().describe("The font family for numbers in a monospace context."),
  radius: z.union([z.number().finite(), z.string().trim().min(1).max(16)]).optional().describe("A corner radius as a number of pixels or a CSS length such as 8px or 0.5rem; clamped to 0..16 for marks."),
}).refine((seed) => firstColour(seed.background, seed.surface, seed.ground) !== undefined, {
  message: "a seed needs a background, surface or ground colour",
  path: ["background"],
}).refine((seed) => firstColour(seed.foreground, seed.text) !== undefined, {
  message: "a seed needs a foreground or text colour",
  path: ["foreground"],
})

export type HostThemeSeed = z.infer<typeof HostThemeSeedSchema>

/** A seed from untrusted input (a host bridge, a JSON file), refused as THEME_INVALID at the token that is wrong. */
export function parseHostThemeSeed(input: unknown): HostThemeSeed {
  const parsed = HostThemeSeedSchema.safeParse(input)
  if (parsed.success) return parsed.data
  const issue = parsed.error.issues[0]!
  const path = ["/theme", "seed", ...issue.path.map(String)].join("/")
  throw new ChartsError("THEME_INVALID", `The theme seed ${path} is invalid: ${issue.message}.`, "Pass background and foreground, plus the optional accent, series, muted and the other hint colours.", path)
}

/** The light or dark reading of a seed: `mode`, else `scheme`, else the background's own OKLCH lightness at 0.55. */
export function seedModeOf(seed: HostThemeSeed): "light" | "dark" {
  const explicit = seed.mode ?? seed.scheme
  if (explicit) return explicit
  const background = firstColour(seed.background, seed.surface, seed.ground) ?? "#FFFFFF"
  return toOklch(background === "transparent" ? "#FFFFFF" : background).l >= 0.55 ? "light" : "dark"
}

// ---------------------------------------------------------------------------------------------------------------
// Derivation.

/** The lightness band a categorical colour is chosen in, by mode: dark ink on paper, luminous marks on a dark canvas. */
const CATEGORICAL_BASE = { light: 0.56, dark: 0.72 } as const
const CATEGORICAL_CHROMA = { light: 0.162, dark: 0.148 } as const
/** The smallest hue separation two categorical colours may have, in degrees. */
const MIN_HUE_GAP = 24
/** How many categorical colours a derived theme carries. */
const RING = 8

const DEFAULT_FONT: ThemeTokens["font"] = { family: SANS, mono: MONO, size: 12, titleSize: 16, subtitleSize: 12, labelSize: 11, titleWeight: 600, files: [] }
const DEFAULT_LAYOUT: ThemeTokens["layout"] = { width: 560, height: 320, padding: 16, step: 24 }
const DEFAULT_AXIS: ThemeTokens["axis"] = { grid: true, gridDash: [], domain: true, ticks: false, labelPadding: 6 }
const DEFAULT_MARKS: ThemeTokens["marks"] = { strokeWidth: 2, pointSize: 48, cornerRadius: 2, opacity: 1 }
const DEFAULT_LEGEND: ThemeTokens["legend"] = { orient: "right" }

/** The theme name a seed's derivation uses: lowercase letters, digits and dashes, at most 48 characters. */
export function themeNameFrom(value: string | undefined, fallback: string): string {
  const cleaned = (value ?? fallback).toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/-+/g, "-").replace(/^-+|-+$/g, "").slice(0, 46)
  if (!cleaned) return fallback
  return /^[a-z0-9]/.test(cleaned) ? cleaned : `seed-${cleaned}`.slice(0, 48)
}

/** The corner radius in pixels a seed's `radius` names, clamped to the range `marks.cornerRadius` accepts. */
function radiusPixels(radius: number | string | undefined): number | undefined {
  if (radius === undefined) return undefined
  let pixels: number
  if (typeof radius === "number") pixels = radius
  else {
    const match = /^(-?[\d.]+)\s*(px|rem|em|pt|pc|in|cm|mm)?$/i.exec(radius.trim())
    if (!match) return undefined
    const value = Number(match[1])
    if (!Number.isFinite(value)) return undefined
    const unit = (match[2] ?? "px").toLowerCase()
    const scale = unit === "rem" || unit === "em" ? 16 : unit === "pt" ? 96 / 72 : unit === "pc" ? 16 : unit === "in" ? 96 : unit === "cm" ? 96 / 2.54 : unit === "mm" ? 96 / 25.4 : 1
    pixels = value * scale
  }
  return clamp(Math.round(pixels * 100) / 100, 0, 16)
}

/**
 * Moves a colour along its own lightness until it clears a contrast floor against the ground, in `direction` (toward
 * black or toward white), and optionally an APCA lightness floor. Deterministic: at most 48 small steps.
 */
function stepForContrast(lch: Oklch, ground: string, minimum: number, direction: 1 | -1, minimumApca?: number): string {
  let lightness = clamp(lch.l, 0.02, 0.98)
  let out = hexFromOklch({ ...lch, l: lightness })
  for (let step = 0; step < 48; step++) {
    const ratio = contrast(out, ground) ?? 21
    const apca = Math.abs(apcaContrast(out, ground))
    if (ratio >= minimum && (minimumApca === undefined || apca >= minimumApca)) return out
    lightness = clamp(lightness + direction * 0.012, 0.02, 0.98)
    out = hexFromOklch({ ...lch, l: lightness })
  }
  return out
}

/** Steps an OKLCH colour toward the ground until it clears a contrast floor, keeping its hue and chroma. */
function stepTowardGround(lch: Oklch, ground: string, direction: 1 | -1): string {
  let lightness = clamp(lch.l, 0.02, 0.98)
  let out = hexFromOklch({ ...lch, l: lightness })
  for (let step = 0; step < 48; step++) {
    if ((contrast(out, ground) ?? 21) >= 1.5) return out
    lightness = clamp(lightness + direction * 0.012, 0.02, 0.98)
    out = hexFromOklch({ ...lch, l: lightness })
  }
  return out
}

interface Candidate { readonly hex: string; readonly lch: Oklch; readonly lab: Oklab; readonly protan: Oklab; readonly deutan: Oklab }

const cvdOf = (hex: string): Candidate => ({ hex, lch: toOklch(hex), lab: toOklabOf(hex), protan: simulateCvd(hex, PROTAN), deutan: simulateCvd(hex, DEUTAN) })

/** The colour-vision-deficiency distance between two prepared colours. */
const cvdDistance = (a: Candidate, b: Candidate): number => Math.min(
  Math.hypot(a.lab.l - b.lab.l, a.lab.a - b.lab.a, a.lab.b - b.lab.b),
  Math.hypot(a.protan.l - b.protan.l, a.protan.a - b.protan.a, a.protan.b - b.protan.b),
  Math.hypot(a.deutan.l - b.deutan.l, a.deutan.a - b.deutan.a, a.deutan.b - b.deutan.b),
)

/** The candidate grid per mode, built once: it depends on the mode, not on the ground. */
const GRID: Record<"light" | "dark", Candidate[]> = { light: [], dark: [] }

/** The candidate grid the categorical ring chooses from: every hue, five lightnesses, chroma at 90% of the gamut. */
function ringCandidates(mode: "light" | "dark"): Candidate[] {
  const cached = GRID[mode]
  if (cached.length) return cached
  const base = CATEGORICAL_BASE[mode]
  const limit = CATEGORICAL_CHROMA[mode]
  for (let hue = 0; hue < 360; hue += 4) {
    for (let level = -2; level <= 2; level++) {
      const l = clamp(base + level * 0.05, 0.24, 0.9)
      const chroma = clamp(maxGamutChroma(l, hue) * 0.9, 0.06, limit)
      cached.push(cvdOf(hexFromOklch({ l, c: chroma, h: hue })))
    }
  }
  return cached
}

const hueGap = (a: number, b: number): number => {
  const difference = Math.abs(a - b) % 360
  return difference > 180 ? 360 - difference : difference
}

/** Whether a candidate's hue is far enough from every ring colour that already has one. */
function hueIsFree(candidate: Candidate, ring: readonly Candidate[]): boolean {
  if (candidate.lch.c < 0.02) return true
  return ring.every(other => other.lch.c < 0.02 || hueGap(candidate.lch.h, other.lch.h) >= MIN_HUE_GAP)
}

const smallestCvd = (candidate: Candidate, others: readonly Candidate[]): number => {
  let smallest = Number.POSITIVE_INFINITY
  for (const other of others) smallest = Math.min(smallest, cvdDistance(candidate, other))
  return others.length ? smallest : Number.POSITIVE_INFINITY
}

/**
 * Fills a categorical ring to eight colours: the seed's own colours first, then a greedy maximin choice over the
 * candidate grid, then three passes of local refinement. Each step maximises the smallest colour-vision-deficiency
 * distance to the colours already chosen, subject to a 24° hue gap and 1.5:1 against the ground.
 */
function categoricalRing(start: readonly string[], ground: string, mode: "light" | "dark"): string[] {
  const ring: Candidate[] = []
  for (const hex of start) {
    if (ring.some(entry => entry.hex === hex)) continue
    ring.push(cvdOf(hex))
    if (ring.length >= RING) return ring.map(entry => entry.hex)
  }
  // Only candidates that stand off this ground are eligible; the grid itself is shared between grounds.
  const candidates = ringCandidates(mode).filter(candidate => (contrast(candidate.hex, ground) ?? 21) >= 1.6)
  for (let slot = ring.length; slot < RING; slot++) {
    let best: Candidate | undefined
    let bestScore = -1
    for (const candidate of candidates) {
      if (ring.some(entry => entry.hex === candidate.hex)) continue
      if (!hueIsFree(candidate, ring)) continue
      const score = smallestCvd(candidate, ring)
      if (score > bestScore) {
        bestScore = score
        best = candidate
      }
    }
    if (!best) {
      // The hue constraint can exhaust a narrow grid; take the farthest remaining colour instead, deterministically.
      for (const candidate of candidates) {
        if (ring.some(entry => entry.hex === candidate.hex)) continue
        const score = smallestCvd(candidate, ring)
        if (score > bestScore) {
          bestScore = score
          best = candidate
        }
      }
    }
    if (!best) break
    ring.push(best)
  }
  // Three passes over the generated colours: a neighbour cell can only be taken when it raises the smallest distance.
  for (let pass = 0; pass < 3; pass++) {
    for (let index = start.length; index < ring.length; index++) {
      const others = ring.filter((_, at) => at !== index)
      let best = ring[index]!
      let bestScore = smallestCvd(best, others)
      for (const candidate of candidates) {
        if (others.some(entry => entry.hex === candidate.hex)) continue
        if (!hueIsFree(candidate, others)) continue
        const score = smallestCvd(candidate, others)
        if (score > bestScore + 1e-9) {
          bestScore = score
          best = candidate
        }
      }
      ring[index] = best
    }
  }
  return ring.map(entry => entry.hex)
}

/** Eight sequential stops from a just-visible tint of the ground to a deep (light) or luminous (dark) accent. */
function sequentialRamp(groundLch: Oklch, accentLch: Oklch, mode: "light" | "dark"): string[] {
  const near = clamp(mode === "light" ? groundLch.l - 0.04 : groundLch.l + 0.04, 0.03, 0.97)
  const far = mode === "light" ? clamp(groundLch.l - 0.58, 0.02, 0.44) : clamp(groundLch.l + 0.6, 0.72, 0.94)
  // A ground with no hue cannot start a hue arc, so the ramp starts in the accent's own family rather than inventing one.
  const startHue = groundLch.c < 0.002 ? accentLch.h : groundLch.h
  const arc = (((accentLch.h - startHue + 540) % 360) - 180)
  const nearChroma = clamp(groundLch.c * 1.1, 0.008, 0.05)
  const farChroma = clamp(accentLch.c * 0.9, 0.06, 0.24)
  const stops: string[] = []
  for (let index = 0; index < 8; index++) {
    const t = index / 7
    const eased = t ** 0.85
    const l = near + (far - near) * t
    const c = nearChroma + (farChroma - nearChroma) * eased
    const h = ((startHue + arc * eased) % 360 + 360) % 360
    stops.push(hexFromOklch({ l, c, h }))
  }
  return stops
}

/** Nine diverging stops: a negative arm, a ground-tinted midpoint and a positive arm, symmetric in lightness. */
function divergingRamp(groundLch: Oklch, negative: Oklch, positive: Oklch, mode: "light" | "dark"): string[] {
  const mid = clamp(mode === "light" ? groundLch.l - 0.05 : groundLch.l + 0.06, 0.06, 0.95)
  const far = mode === "light" ? clamp(groundLch.l - 0.55, 0.1, 0.44) : clamp(groundLch.l + 0.58, 0.72, 0.95)
  const negativeHue = negative.c < 0.02 ? (positive.h + 180) % 360 : negative.h
  const positiveHue = positive.c < 0.02 ? negative.h : positive.h
  // Each arm keeps its own hue and only gains chroma away from the middle, so a green arm never passes through yellow.
  const arm = (hue: number, chroma: number, fraction: number) => hexFromOklch({
    l: mid + (far - mid) * fraction,
    c: clamp(chroma * fraction ** 1.6, 0.004, 0.2),
    h: hue,
  })
  const negativeChroma = clamp(negative.c, 0.08, 0.2)
  const positiveChroma = clamp(positive.c, 0.08, 0.2)
  const out: string[] = []
  for (const fraction of [1, 0.75, 0.5, 0.25]) out.push(arm(negativeHue, negativeChroma, fraction))
  out.push(hexFromOklch({ l: mid, c: clamp(groundLch.c * 1.2, 0.004, 0.02), h: groundLch.h }))
  for (const fraction of [0.25, 0.5, 0.75, 1]) out.push(arm(positiveHue, positiveChroma, fraction))
  return out
}

export interface DeriveThemeOptions {
  /** The theme name; default seed-light or seed-dark. */
  readonly name?: string
  /** The description a theme listing shows; a factual one is written when absent. */
  readonly description?: string
  /** The tokens to start from: its font, layout, axis, marks and legend are kept. Defaults are used when absent. */
  readonly base?: ThemeTokens
}

/**
 * Derives a complete token set from a host seed.
 *
 * The ground and ink are the seed's own (stepped only if they would fail WCAG 2.x). Neutrals are hue-locked to the
 * ground: the grid is a 5.5-point lightness step at the ground's hue, the axis a 16-point step held above 1.5:1, and
 * secondary ink is stepped toward the foreground until it clears 4.6:1 and APCA Lc 60. The categorical ring is
 * colour-vision-deficiency-safe by construction; the sequential ramp spans at least 52 lightness points from the
 * ground's hue to the accent's, and the diverging ramp is symmetric.
 */
export function deriveThemeFromSeed(seed: HostThemeSeed, options: DeriveThemeOptions = {}): ThemeTokens {
  const mode = seedModeOf(seed)
  const base = options.base
  const backgroundInput = firstColour(seed.background, seed.surface, seed.ground) ?? (mode === "dark" ? "#16181D" : "#FFFFFF")
  const transparent = backgroundInput === "transparent"
  const background = transparent ? "transparent" : backgroundInput
  // Arithmetic on a transparent canvas has no ground to hold; white and near-black stand in, and contrast is skipped.
  const ground = transparent ? (mode === "dark" ? "#16181D" : "#FFFFFF") : backgroundInput
  const groundLch = toOklch(ground)
  const step = mode === "dark" ? 1 : -1
  // A ground with no hue of its own (white, black, a pure grey) takes the hue of the raised surface the host mentions,
  // so a warm card over white gives warm hairlines instead of a rose-tinted default.
  const raisedLch = firstColour(seed.raised) === undefined ? undefined : toOklch(firstColour(seed.raised)!)
  const neutralHue = groundLch.c < 0.002 && raisedLch !== undefined && raisedLch.c >= 0.002 ? raisedLch.h : groundLch.h
  const neutralChroma = groundLch.c < 0.002 && raisedLch !== undefined && raisedLch.c >= 0.002 ? clamp(raisedLch.c * 0.5, 0.004, 0.012) : groundLch.c

  const foregroundInput = firstColour(seed.foreground, seed.text) ?? (mode === "dark" ? "#F2F3F5" : "#1F2328")
  const foregroundLch = toOklch(foregroundInput === "transparent" ? (mode === "dark" ? "#F2F3F5" : "#1F2328") : foregroundInput)
  // Ink moves away from the ground: down on a light canvas, up on a dark one, in the direction the host's own ink sits.
  const away: 1 | -1 = foregroundLch.l <= groundLch.l ? -1 : 1
  const text = stepForContrast(foregroundLch, ground, 4.6, away)

  const gridHint = firstColour(seed.grid, seed.border)
  const grid = gridHint ?? hexFromOklch({
    l: clamp(groundLch.l + step * 0.055, 0.03, 0.97),
    c: clamp(neutralChroma * 1.25, 0.004, 0.022),
    h: neutralHue,
  })

  const axisHint = firstColour(seed.axis)
  const axisInk = axisHint ?? stepForContrast({
    l: clamp(groundLch.l + step * 0.16, 0.03, 0.97),
    c: clamp(neutralChroma * 1.6, 0.006, 0.03),
    h: neutralHue,
  }, ground, 1.5, step)

  const mutedHint = firstColour(seed.muted)
  let muted: string
  if (mutedHint !== undefined && mutedHint !== text) {
    muted = stepForContrast(toOklch(mutedHint), ground, 4.6, away, 60)
  } else {
    muted = ""
    for (let t = 0.3; t <= 1.0001; t += 0.02) {
      const l = groundLch.l + (foregroundLch.l - groundLch.l) * t
      const c = clamp(neutralChroma + (foregroundLch.c - neutralChroma) * t, 0.002, 0.03)
      const candidate = hexFromOklch({ l, c, h: neutralHue })
      if ((contrast(candidate, ground) ?? 21) >= 4.6 && Math.abs(apcaContrast(candidate, ground)) >= 60) {
        muted = candidate
        break
      }
    }
    if (!muted) muted = stepForContrast({ l: groundLch.l + (foregroundLch.l - groundLch.l) * 0.65, c: clamp(neutralChroma, 0.002, 0.03), h: neutralHue }, ground, 4.6, away, 60)
    // Secondary ink that rounds onto the primary ink has lost the hierarchy it exists for: step it back a point.
    if (muted === text) muted = stepForContrast({ l: clamp(foregroundLch.l - away * 0.06, 0.02, 0.98), c: foregroundLch.c, h: foregroundLch.h }, ground, 4.6, away, 60)
  }

  const baseLightness = CATEGORICAL_BASE[mode]
  const chromaLimit = CATEGORICAL_CHROMA[mode]
  const accentHint = firstColour(seed.accent, seed.primary) ?? firstColour(seed.series?.[0])
  const accentSource = accentHint === undefined ? { l: baseLightness, c: Math.min(0.15, chromaLimit), h: 255 } : toOklch(accentHint)
  // A near-neutral accent has no hue to honour: an achromatic brand mark still needs a categorical ring, so it is given
  // one deterministic hue rather than every ring colour inheriting "grey".
  const accentLch: Oklch = accentSource.c < 0.02
    ? { l: clamp(accentSource.l, baseLightness - 0.12, baseLightness + 0.12), c: Math.max(0.1, accentSource.c), h: 255 }
    : { l: clamp(accentSource.l, baseLightness - 0.12, baseLightness + 0.12), c: clamp(accentSource.c, 0.04, 0.3), h: accentSource.h }
  const accent = stepForContrast(accentLch, ground, 1.6, away)

  // A host's series are kept exactly, except one that would disappear into the ground: that one is stepped in
  // lightness until it stands off the canvas, so the ring is never the reason a series is invisible.
  const seriesHints = (seed.series ?? []).map(value => normaliseCssColor(value)).filter((value): value is string => value !== undefined && value !== "transparent")
  const ringStart = seriesHints.length ? seriesHints.map(hex => stepTowardGround(toOklch(hex), ground, away)) : [accent]
  const categorical = categoricalRing(ringStart, ground, mode)

  const positiveHint = firstColour(seed.positive, seed.success)
  const negativeHint = firstColour(seed.negative, seed.danger, seed.destructive)
  const positiveLch = positiveHint === undefined ? { l: mode === "dark" ? 0.78 : 0.55, c: 0.125, h: 152 } : toOklch(positiveHint)
  const negativeLch = negativeHint === undefined ? { l: mode === "dark" ? 0.72 : 0.55, c: 0.16, h: 27 } : toOklch(negativeHint)
  const positive = stepForContrast(positiveLch, ground, 3, away)
  const negative = stepForContrast(negativeLch, ground, 3, away)

  const neutralHint = firstColour(seed.neutral)
  const neutral = neutralHint ?? axisInk
  const highlightHint = firstColour(seed.highlight, seed.warning)
  const highlight = highlightHint ?? accent

  const font = base?.font
  const marks = base?.marks
  const radius = radiusPixels(seed.radius)
  const name = themeNameFrom(options.name, mode === "dark" ? "seed-dark" : "seed-light")
  const description = (options.description ?? `Synthesised from a host seed: ${mode} ground ${background}, ${categorical.length} colour-vision-safe categories and a ${mode}-anchored sequential ramp.`).slice(0, 300)

  return {
    name,
    description,
    mode,
    colors: {
      background,
      text,
      muted,
      grid,
      axis: axisInk,
      categorical,
      sequential: sequentialRamp(groundLch, accentLch, mode),
      diverging: divergingRamp(groundLch, negativeLch, positiveLch, mode),
      positive,
      negative,
      neutral,
      highlight,
    },
    font: {
      ...(font ?? DEFAULT_FONT),
      family: seed.font ?? font?.family ?? SANS,
      mono: seed.mono ?? font?.mono ?? MONO,
      files: [...(font?.files ?? [])],
    },
    layout: { ...(base?.layout ?? DEFAULT_LAYOUT) },
    axis: { ...(base?.axis ?? DEFAULT_AXIS) },
    marks: { ...(marks ?? DEFAULT_MARKS), ...(radius === undefined ? {} : { cornerRadius: radius }) },
    legend: { ...(base?.legend ?? DEFAULT_LEGEND) },
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Paired light and dark.

export interface PairedThemeInput {
  /** The name stem: light and dark are named <name>-light and <name>-dark. */
  readonly name?: string
  /** Which of the pair a caller should draw with now; the seed's own mode when absent. */
  readonly mode?: "light" | "dark"
  /** One seed, used for its own mode; the companion is synthesised structurally. */
  readonly seed?: HostThemeSeed
  /** A light seed, when the caller has both sides already. */
  readonly light?: HostThemeSeed
  /** A dark seed, when the caller has both sides already. */
  readonly dark?: HostThemeSeed
}

export interface PairedTheme {
  readonly light: ThemeTokens
  readonly dark: ThemeTokens
  /** The member of the pair for the caller's `mode`, so one call answers both "give me a theme" and "give me both". */
  readonly active: ThemeTokens
}

/**
 * The companion of a seed in the other mode: the same hues, with the ground and ink re-lit for the other canvas.
 * The accent keeps its hue and chroma and moves into the other mode's categorical lightness band; a seed's explicit
 * series are not carried, because a light-tuned series is not automatically a dark-tuned one and the ring regenerates
 * from the accent instead.
 */
function companionSeed(seed: HostThemeSeed, mode: "light" | "dark"): HostThemeSeed {
  const background = firstColour(seed.background, seed.surface, seed.ground) ?? (mode === "dark" ? "#FFFFFF" : "#16181D")
  const foreground = firstColour(seed.foreground, seed.text) ?? (mode === "dark" ? "#1F2328" : "#F2F3F5")
  const groundLch = toOklch(background === "transparent" ? "#FFFFFF" : background)
  const inkLch = toOklch(foreground === "transparent" ? "#1F2328" : foreground)
  const accentSource = toOklch(firstColour(seed.accent, seed.primary) ?? firstColour(seed.series?.[0]) ?? hexFromOklch({ l: 0.56, c: 0.15, h: 255 }))
  const accentLch: Oklch = { l: mode === "dark" ? 0.72 : 0.56, c: clamp(accentSource.c, 0.03, 0.19), h: accentSource.h }
  return {
    background: mode === "dark" ? hexFromOklch({ l: 0.155, c: clamp(groundLch.c * 0.9, 0, 0.02), h: groundLch.h }) : hexFromOklch({ l: 0.975, c: clamp(groundLch.c * 0.9, 0, 0.02), h: groundLch.h }),
    foreground: mode === "dark" ? hexFromOklch({ l: 0.93, c: clamp(inkLch.c, 0, 0.02), h: inkLch.h }) : hexFromOklch({ l: 0.22, c: clamp(inkLch.c, 0, 0.02), h: inkLch.h }),
    accent: hexFromOklch(accentLch),
    mode,
    positive: firstColour(seed.positive, seed.success),
    negative: firstColour(seed.negative, seed.danger, seed.destructive),
    neutral: firstColour(seed.neutral),
    highlight: firstColour(seed.highlight, seed.warning),
    font: seed.font,
    mono: seed.mono,
    radius: seed.radius,
  }
}

/**
 * A matched light and dark theme from one seed (or from two). The companion is synthesised so a host that describes one
 * mode still gets a pair that shares its hues, its brand accent and its type, instead of a dark theme that drifts.
 */
export function derivePairedTheme(input: PairedThemeInput = {}): PairedTheme {
  let lightSeed = input.light
  let darkSeed = input.dark
  let sourceMode: "light" | "dark" | undefined
  if (input.seed) {
    sourceMode = seedModeOf(input.seed)
    if (sourceMode === "dark") darkSeed ??= input.seed
    else lightSeed ??= input.seed
  }
  if (!lightSeed && !darkSeed) lightSeed = { background: "#FFFFFF", foreground: "#1F2328", accent: "#2563EB", mode: "light" }
  if (lightSeed && !darkSeed) darkSeed = companionSeed(lightSeed, "dark")
  if (!lightSeed && darkSeed) lightSeed = companionSeed(darkSeed, "light")
  const stem = themeNameFrom(input.name ?? "seed", "seed")
  const light = deriveThemeFromSeed(lightSeed!, { name: `${stem}-light`.slice(0, 48), description: `Light side of ${stem}: synthesised from the host seed.` })
  const dark = deriveThemeFromSeed(darkSeed!, { name: `${stem}-dark`.slice(0, 48), description: `Dark side of ${stem}: synthesised from the host seed.` })
  const active = (input.mode ?? sourceMode ?? light.mode) === "dark" ? dark : light
  return { light, dark, active }
}
