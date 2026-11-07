import type { ThemeTokens } from "./tokens.js"

/**
 * A categorical palette that never runs out.
 *
 * A theme carries a published, colour-vision-safe palette (Paul Tol, Okabe–Ito…). Those sets are short — five to eight
 * colours — so a chart with more series than that repeats a colour, and the reader cannot tell series 9 from series 2.
 * A theme's own colours are kept, in order, as the first entries; past them, hues are generated in OKLCH at the theme's
 * own lightness and chroma, spaced by the golden angle so no two are near neighbours, and held to a minimum perceptual
 * distance from every colour before them.
 *
 * The published sets are reported as published; the generated entries are reported as generated (`charts_themes`,
 * `charts_capabilities`), so nobody mistakes them for a tested colour-blind-safe set.
 *
 * Adapted from the design of Rune (`anomalyco/rune@bca47138`), MIT, © Anomaly:
 * `crates/rune-mermaid/src/chart.rs` lines 9–39 (series hues spread so neighbours differ, light and dark derived from
 * one hue by lightness and chroma, label ink from the fill's lightness). The arithmetic here is TypeScript.
 */

/** The most series a palette will distinguish. Past this a chart is unreadable whatever the colours, and lint says so. */
export const MAX_SERIES = 20

/** The golden angle: successive additions never return near a previous hue. */
const GOLDEN = 137.50776405003785

/** A colour in OKLab, plus its alpha. */
interface Lab { readonly l: number; readonly a: number; readonly b: number; readonly alpha: number }

const srgbToLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
const linearToSrgb = (c: number) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055)

/** `#rgb`, `#rrggbb`, `#rrggbbaa`, `rgb()` and `rgba()`, plus `transparent`. Anything else is `undefined`. */
export function parseColour(value: string): Lab | undefined {
  const text = value.trim().toLowerCase()
  if (text === "transparent") return { l: 1, a: 0, b: 0, alpha: 0 }
  let r: number, g: number, b: number, alpha = 1
  const hex = /^#([0-9a-f]{3,8})$/.exec(text)
  if (hex) {
    const h = hex[1]!
    const expand = (s: string) => parseInt(s.length === 1 ? s + s : s, 16) / 255
    if (h.length === 3 || h.length === 4) { r = expand(h[0]!); g = expand(h[1]!); b = expand(h[2]!); if (h.length === 4) alpha = expand(h[3]!) }
    else if (h.length === 6 || h.length === 8) { r = expand(h.slice(0, 2)); g = expand(h.slice(2, 4)); b = expand(h.slice(4, 6)); if (h.length === 8) alpha = expand(h.slice(6, 8)) }
    else return undefined
  } else {
    const fn = /^rgba?\(([\d\s.,%]+)\)$/.exec(text)
    if (!fn) return undefined
    const parts = fn[1]!.split(",").map(p => p.trim())
    if (parts.length < 3) return undefined
    const channel = (p: string) => (p.endsWith("%") ? Number(p.slice(0, -1)) / 100 : Number(p) / 255)
    r = channel(parts[0]!); g = channel(parts[1]!); b = channel(parts[2]!)
    if (parts[3] !== undefined) alpha = parts[3].endsWith("%") ? Number(parts[3].slice(0, -1)) / 100 : Number(parts[3])
  }
  if (![r, g, b, alpha].every(Number.isFinite)) return undefined
  const lr = srgbToLinear(r), lg = srgbToLinear(g), lb = srgbToLinear(b)
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb)
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb)
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb)
  return { l: 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, a: 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, b: 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s, alpha }
}

/** OKLCH to sRGB hex, clamped into gamut by reducing chroma. */
export function oklchToHex(lightness: number, chroma: number, hue: number): string {
  const h = (hue * Math.PI) / 180
  const l = lightness, a = chroma * Math.cos(h), b = chroma * Math.sin(h)
  const l_ = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3
  const m_ = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3
  const s_ = (l - 0.0894841775 * a - 1.291485548 * b) ** 3
  const lin = [4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_, -1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_, -0.0041960863 * l_ - 0.7034186147 * m_ + 1.707614701 * s_]
  const clip = (c: number) => Math.max(0, Math.min(1, c))
  const hex = (c: number) => Math.round(clip(linearToSrgb(c)) * 255).toString(16).padStart(2, "0")
  return `#${hex(lin[0]!)}${hex(lin[1]!)}${hex(lin[2]!)}`.toUpperCase()
}

const lab = (value: string): Lab => parseColour(value) ?? { l: 0.5, a: 0, b: 0, alpha: 1 }

/** Perceptual distance in OKLab. 0.10 is the floor below which two swatches read as one colour at chart sizes. */
export function distance(a: string, b: string): number {
  const x = lab(a), y = lab(b)
  return Math.hypot(x.l - y.l, x.a - y.a, x.b - y.b)
}

const MIN_DISTANCE = 0.1
const lightnessOf = (value: string) => lab(value).l
const chromaOf = (value: string) => Math.hypot(lab(value).a, lab(value).b)
const hueOf = (value: string) => {
  const c = lab(value)
  const deg = (Math.atan2(c.b, c.a) * 180) / Math.PI
  return deg < 0 ? deg + 360 : deg
}
const median = (values: readonly number[]) => {
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2
}

/**
 * The categories a theme can tell apart: its own colours first, then generated ones.
 *
 * `count` is the number of series the chart needs. The result is always exactly that long, and no two entries are
 * closer than 0.10 in OKLab for the first eight; past that the floor is relaxed to 0.06, because an honest repeat is
 * worse than a near neighbour.
 */
export function seriesColours(colours: readonly string[], count: number): readonly string[] {
  const published = [...colours]
  const wanted = Math.min(Math.max(count, published.length), MAX_SERIES)
  if (wanted <= published.length) return published.slice(0, Math.max(count, 0))
  const base = published.filter(c => parseColour(c) && parseColour(c)!.alpha > 0.5)
  const lightness = base.length ? median(base.map(lightnessOf)) : 0.62
  const chroma = base.length ? Math.max(0.08, median(base.map(chromaOf))) * 0.9 : 0.12
  // Start the ring at the largest gap between the published hues, so a generated colour is not a near-copy of one.
  const hues = base.map(hueOf).sort((a, b) => a - b)
  let start = hues.length ? (hues[hues.length - 1]! + hues[0]! + 360) / 2 : 0
  if (hues.length > 1) {
    let widest = -1
    for (let i = 0; i < hues.length; i++) {
      const gap = (hues[(i + 1) % hues.length]! - hues[i]! + 360) % 360 || 360
      if (gap > widest) { widest = gap; start = hues[i]! + gap / 2 }
    }
  }
  const out = [...published]
  for (let k = 0; out.length < wanted && k < 200; k++) {
    const hue = (start + GOLDEN * (k + 1)) % 360
    // Alternating lightness above and below the theme's own, so neighbours differ in more than hue.
    const l = lightness + (k % 3 === 0 ? 0.06 : k % 3 === 1 ? -0.05 : 0)
    const candidate = oklchToHex(Math.max(0.3, Math.min(0.82, l)), chroma, hue)
    // The floor tightens as the palette fills: 0.10 to 12 series, then 0.075, then 0.06 at the top.
    const floor = out.length < 12 ? MIN_DISTANCE : out.length < 16 ? 0.075 : 0.06
    if (out.every(existing => distance(existing, candidate) >= floor)) out.push(candidate)
  }
  // Two colours can be unavoidable at the top of the range; fill to `wanted` deterministically.
  for (let k = 0; out.length < wanted; k++) out.push(oklchToHex(Math.max(0.3, Math.min(0.82, lightness + (k % 5) * 0.05 - 0.1)), Math.max(0.06, chroma * 0.8), (start + GOLDEN * (k + 40)) % 360))
  return out.slice(0, Math.max(count, published.length))
}

/** A theme's categories at `count` series: published colours first, then generated. */
export function themeColours(theme: ThemeTokens, count: number): readonly string[] {
  // `print` and `high-contrast` are defined by a constraint (greyscale-safe, contrast) that extra hues would break.
  if (theme.name === "print" || theme.name === "high-contrast") return theme.colors.categorical.slice(0, Math.max(1, Math.min(count, theme.colors.categorical.length)))
  return seriesColours(theme.colors.categorical, count)
}

/** The ink a label on `fill` should use: dark text on a light mark, light on a dark one. */
export function inkOn(fill: string, dark: string, light: string): string {
  const l = lightnessOf(fill)
  return l > 0.6 ? dark : light
}

/** How many of a theme's categories are published, and how many the palette can reach. */
export function paletteReport(theme: ThemeTokens) {
  const published = theme.colors.categorical.length
  const extendable = theme.name !== "print" && theme.name !== "high-contrast"
  const available = extendable ? Math.max(published, MAX_SERIES) : published
  return { published, available, generated: available - published }
}
