import { readFileSync, statSync } from "node:fs"
import { join } from "node:path"
import { ChartsError } from "./errors.js"

/**
 * Fonts and text metrics. Both renderers (Vega and ECharts) measure text with these tables, and resvg draws the
 * same font files, so layout and pixels are identical on hosted Linux and a Mac: no system font is ever read.
 *
 * The bundled fonts are subset with no OpenType layout features (no kerning, no ligatures), so a string's width is
 * exactly the sum of its glyphs' advance widths, which is what resvg then draws.
 */

export interface FontFace {
  readonly family: string
  readonly weight: number
  readonly style: "normal" | "italic"
  readonly bytes: Uint8Array
  readonly unitsPerEm: number
  readonly ascender: number
  readonly descender: number
  /** Advance width per code point, in font units. */
  readonly advances: Map<number, number>
  readonly fallbackAdvance: number
}

export const SANS = "Inter"
export const MONO = "JetBrains Mono"
export const GEIST = "Geist"
export const BUNDLED_FAMILIES = [SANS, MONO, GEIST] as const

export const BUNDLED: readonly { file: string; family: string; weight: number }[] = [
  { file: "Inter-Regular.ttf", family: SANS, weight: 400 },
  { file: "Inter-SemiBold.ttf", family: SANS, weight: 600 },
  { file: "JetBrainsMono-Regular.ttf", family: MONO, weight: 400 },
  { file: "Geist-Regular.ttf", family: GEIST, weight: 400 },
  { file: "Geist-Medium.ttf", family: GEIST, weight: 500 },
]
const MAX_CUSTOM_FONT_BYTES = 8 * 1024 * 1024

/** Parses the tables a width needs from a TrueType or CFF OpenType font: head, hhea, hmtx, cmap (4 and 12). */
export function parseFont(bytes: Uint8Array, family: string, weight: number): FontFace {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const tag = view.getUint32(0)
  if (tag !== 0x00010000 && tag !== 0x4f54544f && tag !== 0x74727565) throw new ChartsError("FONT_INVALID", `The font for "${family}" is not a TrueType or OpenType file.`, "Use a .ttf or .otf file (not .woff or .woff2).")
  const count = view.getUint16(4)
  const tables = new Map<string, number>()
  for (let i = 0; i < count; i++) {
    const rec = 12 + i * 16
    const name = String.fromCharCode(bytes[rec]!, bytes[rec + 1]!, bytes[rec + 2]!, bytes[rec + 3]!)
    tables.set(name, view.getUint32(rec + 8))
  }
  const need = (name: string) => {
    const off = tables.get(name)
    if (off === undefined) throw new ChartsError("FONT_INVALID", `The font for "${family}" has no ${name} table.`, "Use a complete .ttf or .otf file.")
    return off
  }
  const head = need("head"), hhea = need("hhea"), hmtx = need("hmtx"), cmap = need("cmap")
  const unitsPerEm = view.getUint16(head + 18)
  const ascender = view.getInt16(hhea + 4), descender = view.getInt16(hhea + 6)
  const numberOfHMetrics = view.getUint16(hhea + 34)
  const glyphAdvance = (glyph: number) => view.getUint16(hmtx + 4 * Math.min(glyph, numberOfHMetrics - 1))

  // Pick the best Unicode subtable: format 12 (full repertoire) over format 4 (BMP).
  const subtables = view.getUint16(cmap + 2)
  let best = -1, bestFormat = 0
  for (let i = 0; i < subtables; i++) {
    const platform = view.getUint16(cmap + 4 + i * 8), encoding = view.getUint16(cmap + 6 + i * 8)
    const offset = cmap + view.getUint32(cmap + 8 + i * 8)
    const format = view.getUint16(offset)
    const unicode = platform === 0 || (platform === 3 && (encoding === 1 || encoding === 10))
    if (!unicode) continue
    if ((format === 12 && bestFormat !== 12) || (format === 4 && bestFormat === 0)) { best = offset; bestFormat = format }
  }
  if (best < 0) throw new ChartsError("FONT_INVALID", `The font for "${family}" has no Unicode character map.`, "Use a font with a Unicode cmap.")
  const advances = new Map<number, number>()
  if (bestFormat === 12) {
    const groups = view.getUint32(best + 12)
    for (let g = 0; g < groups; g++) {
      const at = best + 16 + g * 12
      const start = view.getUint32(at), end = view.getUint32(at + 4), glyph = view.getUint32(at + 8)
      for (let c = start; c <= end && c - start < 0x10000; c++) advances.set(c, glyphAdvance(glyph + (c - start)))
    }
  } else {
    const segX2 = view.getUint16(best + 6), segs = segX2 / 2
    const ends = best + 14, starts = ends + segX2 + 2, deltas = starts + segX2, rangeOffsets = deltas + segX2
    for (let s = 0; s < segs; s++) {
      const end = view.getUint16(ends + s * 2), start = view.getUint16(starts + s * 2)
      const delta = view.getInt16(deltas + s * 2), ro = view.getUint16(rangeOffsets + s * 2)
      for (let c = start; c <= end && c !== 0xffff; c++) {
        let glyph: number
        if (ro === 0) glyph = (c + delta) & 0xffff
        else {
          const at = rangeOffsets + s * 2 + ro + (c - start) * 2
          glyph = view.getUint16(at)
          if (glyph !== 0) glyph = (glyph + delta) & 0xffff
        }
        if (glyph !== 0) advances.set(c, glyphAdvance(glyph))
      }
    }
  }
  const fallbackAdvance = advances.get(0x6f /* o */) ?? unitsPerEm * 0.55
  return { family, weight, style: "normal", bytes, unitsPerEm, ascender, descender, advances, fallbackAdvance }
}

export class FontBook {
  private readonly faces: FontFace[] = []
  add(face: FontFace) { this.faces.push(face); return this }
  list(): readonly FontFace[] { return this.faces }
  families() { return [...new Set(this.faces.map(face => face.family))] }
  buffers() { return this.faces.map(face => face.bytes) }
  /** The font files an SVG needs: the families its text names, else the default. resvg parses every buffer it is given, so fewer is faster. */
  buffersFor(svg: string, fallbackFamily: string) {
    const named = new Set<string>()
    for (const m of svg.matchAll(/font-family(?:="|:\s*)([^";>]+)/g)) for (const name of m[1]!.split(",")) named.add(name.trim().replace(/^['"]|['"]$/g, "").replace(/&quot;/g, "").toLowerCase())
    const wanted = this.faces.filter(face => named.has(face.family.toLowerCase()))
    const fallback = this.faces.filter(face => face.family.toLowerCase() === fallbackFamily.toLowerCase())
    return [...new Set([...wanted, ...fallback])].map(face => face.bytes)
  }
  has(family: string) { return this.faces.some(face => face.family.toLowerCase() === family.toLowerCase()) }

  /** Whether any face carries this code point, so a label draws instead of leaving a blank box. */
  covers(codePoint: number) { return this.faces.some(face => face.advances.has(codePoint)) }

  /** CSS-like matching: the family named first that we have, else Inter; the nearest weight. */
  face(familyList: string | undefined, weight: number | string | undefined): FontFace {
    const wanted = (familyList ?? SANS).split(",").map(name => name.trim().replace(/^["']|["']$/g, "").toLowerCase())
    let family = wanted.find(name => this.has(name))
    if (!family) family = wanted.some(name => name === "monospace" || name.includes("mono")) ? MONO.toLowerCase() : SANS.toLowerCase()
    const target = numericWeight(weight)
    const candidates = this.faces.filter(face => face.family.toLowerCase() === family)
    // CSS weight matching: <=500 prefers lighter-or-equal first; >500 prefers heavier-or-equal first.
    const sorted = [...candidates].sort((a, b) => weightDistance(a.weight, target) - weightDistance(b.weight, target))
    return sorted[0]!
  }

  measure(text: string, size: number, familyList?: string, weight?: number | string): number {
    const face = this.face(familyList, weight)
    let units = 0
    for (const char of text) units += face.advances.get(char.codePointAt(0)!) ?? face.fallbackAdvance
    return (units / face.unitsPerEm) * size
  }

  /** Measures a CSS font shorthand such as `bold 12px Inter, sans-serif` (the form ECharts passes). */
  measureCss(text: string, css: string): number {
    const match = /^(?:(italic|oblique|normal)\s+)?(?:(normal|bold|bolder|lighter|\d{3})\s+)?(\d+(?:\.\d+)?)px\s+(.+)$/.exec(css.trim())
    if (!match) return this.measure(text, 12)
    return this.measure(text, Number(match[3]), match[4], match[2])
  }
}

function numericWeight(weight: number | string | undefined): number {
  if (typeof weight === "number") return weight
  if (weight === "bold" || weight === "bolder") return 700
  if (weight === "lighter") return 300
  const parsed = Number(weight)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 400
}
function weightDistance(have: number, want: number) {
  if (have === want) return 0
  if (want <= 500) return have < want ? want - have : 1000 + have - want
  return have > want ? have - want : 1000 + want - have
}

let bundled: FontBook | undefined
/** The bundled fonts, read once from the package. */
export function bundledFonts(packageRoot: string): FontBook {
  if (bundled) return bundled
  const book = new FontBook()
  for (const font of BUNDLED) book.add(parseFont(new Uint8Array(readFileSync(join(packageRoot, "assets", "fonts", font.file))), font.family, font.weight))
  bundled = book
  return book
}

/** Bundled fonts plus a theme's own fonts (workspace files that the caller has already confined and read). */
export function withCustomFonts(base: FontBook, custom: readonly { family: string; weight?: number; bytes: Uint8Array }[]): FontBook {
  if (custom.length === 0) return base
  const book = new FontBook()
  for (const face of base.list()) book.add(face)
  for (const font of custom) {
    if (font.bytes.byteLength > MAX_CUSTOM_FONT_BYTES) throw new ChartsError("FONT_TOO_LARGE", `The font for "${font.family}" is over 8 MB.`, "Subset the font or use a smaller file.")
    book.add(parseFont(font.bytes, font.family, font.weight ?? 400))
  }
  return book
}

export function fileSize(path: string) { return statSync(path).size }
