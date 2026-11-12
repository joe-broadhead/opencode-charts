import { createHash } from "node:crypto"
import { readFileSync, statSync } from "node:fs"
import { join } from "node:path"
import { MONO, SANS } from "./constants.js"
import { ChartsError } from "./errors.js"
import { confine, type Workspace } from "./paths.js"

/**
 * Fonts and text metrics. Both renderers (Vega and ECharts) measure text with these tables, and resvg draws the
 * same font files, so layout and pixels are identical on hosted Linux and a Mac: no system font is ever read.
 *
 * The bundled fonts are subset with no OpenType layout features (no kerning, no ligatures), so a string's width is
 * exactly the sum of its glyphs' advance widths, which is what resvg then draws.
 */

/**
 * One approved font resource: the single record every consumer of a face uses. Server metrics and rasterisation read
 * `bytes` (the sfnt the tables are parsed from); SVG and HTML embedding write `web`. A bundled face's web form is the
 * WOFF2 build of the same subset, pinned by hash beside its TTF; a custom face's web form is its own TTF or OTF bytes,
 * with that file's MIME type and CSS `format()`.
 */
export interface FontResource {
  readonly family: string
  readonly weight: number
  readonly origin: "bundled" | "custom"
  /** Workspace-relative path of a custom face; the package file name of a bundled one. */
  readonly source: string
  readonly bytes: Uint8Array
  /** SHA-256 of `bytes`, hex. */
  readonly sha256: string
  readonly mime: FontMime
  readonly format: FontFormat
  readonly web: { readonly bytes: Uint8Array; readonly sha256: string; readonly mime: FontMime; readonly format: FontFormat }
}
export type FontMime = "font/ttf" | "font/otf" | "font/woff2"
export type FontFormat = "truetype" | "opentype" | "woff2"

export interface FontFace {
  readonly resource: FontResource
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

export { MONO, SANS }
export const BUNDLED_FAMILIES = [SANS, MONO] as const

/** The bundled faces, each pinned by the SHA-256 of its TTF and of its WOFF2 web form: a swapped file is refused. */
export const BUNDLED: readonly { file: string; family: string; weight: number; sha256: string; woff2Sha256: string }[] = [
  { file: "Inter-Regular.ttf", family: SANS, weight: 400, sha256: "7bd772628fd218df0cc9e93246bfbbab8b270bb20912e2b821e893425f6df77f", woff2Sha256: "d08fc1998c480094a10261722b05fe2e1bc9c0109be7d00c2bfa4e57f3a40cff" },
  { file: "Inter-SemiBold.ttf", family: SANS, weight: 600, sha256: "5bbcca9955dcceacaa700f9b5f07695a3b9be20e38229a9cd52be5220094437a", woff2Sha256: "ef1edb4e69ad9125c4f6c8beae0fbd8c35492bf80196e94fc69ff8423c61b2a9" },
  { file: "JetBrainsMono-Regular.ttf", family: MONO, weight: 400, sha256: "db93548a24e5c965304d01a1398b6a8c77c4388401b44ff611190ccfa7a5543c", woff2Sha256: "aab1457c2816ef6f0be1956417e660ec014d3890e55c815ce5f620b2f92abb15" },
]
/** Per custom file, and for all of a theme's custom files together: each is embedded in HTML and embedded SVG. */
export const MAX_CUSTOM_FONT_BYTES = 8 * 1024 * 1024
export const MAX_CUSTOM_FONTS_TOTAL_BYTES = 24 * 1024 * 1024

const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex")

/** The sfnt flavour from the first four bytes: TrueType outlines (`0x00010000`, `true`) or CFF (`OTTO`). */
export function sfntKind(bytes: Uint8Array): { mime: "font/ttf" | "font/otf"; format: "truetype" | "opentype" } | undefined {
  if (bytes.byteLength < 12) return undefined
  const tag = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(0)
  if (tag === 0x00010000 || tag === 0x74727565) return { mime: "font/ttf", format: "truetype" }
  if (tag === 0x4f54544f) return { mime: "font/otf", format: "opentype" }
  return undefined
}

/** A custom face's resource: its own bytes for metrics, rasterisation and embedding alike. */
export function customFontResource(bytes: Uint8Array, family: string, weight: number, source: string): FontResource {
  const kind = sfntKind(bytes)
  if (!kind) throw new ChartsError("FONT_INVALID", `The font for "${family}" (${source}) is not a TrueType or OpenType file.`, "Use a .ttf or .otf file (not .woff or .woff2).")
  const hash = sha256(bytes)
  return { family, weight, origin: "custom", source, bytes, sha256: hash, ...kind, web: { bytes, sha256: hash, ...kind } }
}

/** Parses the tables a width needs from a TrueType or CFF OpenType font: head, hhea, hmtx, cmap (4 and 12). */
export function parseFont(bytes: Uint8Array, family: string, weight: number, resource?: FontResource): FontFace {
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
  const kind = sfntKind(bytes) ?? { mime: "font/ttf" as const, format: "truetype" as const }
  const own = resource ?? (() => { const hash = sha256(bytes); return { family, weight, origin: "custom" as const, source: family, bytes, sha256: hash, ...kind, web: { bytes, sha256: hash, ...kind } } })()
  return { resource: own, family, weight, style: "normal", bytes, unitsPerEm, ascender, descender, advances, fallbackAdvance }
}

export class FontBook {
  private readonly faces: FontFace[] = []
  add(face: FontFace) { this.faces.push(face); return this }
  list(): readonly FontFace[] { return this.faces }
  families() { return [...new Set(this.faces.map(face => face.family))] }
  buffers() { return this.faces.map(face => face.bytes) }
  /** Every approved resource in the book, bundled first, in the order the faces were added. */
  resources(): readonly FontResource[] { return this.faces.map(face => face.resource) }
  /**
   * The resources an SVG needs: the faces of the families its text names, and of `families` (the theme's text and
   * mono families), with one face per family and weight, the one `face()` would pick. The PNG rasteriser and SVG and
   * HTML embedding all take this one list, so what is drawn, measured and embedded is the same set of bytes.
   */
  resourcesFor(svg: string, families: readonly string[]): readonly FontResource[] {
    const named = new Set(families.map(name => name.toLowerCase()))
    for (const m of svg.matchAll(/font-family(?:="|:\s*)([^";>]+)/g)) for (const name of m[1]!.split(",")) named.add(name.trim().replace(/^['"]|['"]$/g, "").replace(/&quot;/g, "").toLowerCase())
    const picked = new Map<string, FontResource>()
    for (const face of this.faces) {
      const key = `${face.family.toLowerCase()}\u0000${face.weight}`
      if (named.has(face.family.toLowerCase()) && !picked.has(key)) picked.set(key, face.resource)
    }
    return [...picked.values()]
  }
  /** The font files an SVG needs: the families its text names, else the default. resvg parses every buffer it is given, so fewer is faster. */
  buffersFor(svg: string, fallbackFamily: string) {
    return this.resourcesFor(svg, [fallbackFamily]).map(resource => resource.bytes)
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
/** The bundled fonts, read once from the package and checked against their pinned hashes. */
export function bundledFonts(packageRoot: string): FontBook {
  if (bundled) return bundled
  const book = new FontBook()
  for (const font of BUNDLED) {
    const read = (file: string, expected: string) => {
      const bytes = new Uint8Array(readFileSync(join(packageRoot, "assets", "fonts", file)))
      if (sha256(bytes) !== expected) throw new ChartsError("FONT_INVALID", `The bundled font ${file} does not match this build.`, "Reinstall the plugin.")
      return bytes
    }
    const bytes = read(font.file, font.sha256)
    const woff2 = font.file.replace(/\.ttf$/, ".woff2")
    const resource: FontResource = { family: font.family, weight: font.weight, origin: "bundled", source: font.file, bytes, sha256: font.sha256, mime: "font/ttf", format: "truetype", web: { bytes: read(woff2, font.woff2Sha256), sha256: font.woff2Sha256, mime: "font/woff2", format: "woff2" } }
    book.add(parseFont(bytes, font.family, font.weight, resource))
  }
  bundled = book
  return book
}

/** Bundled fonts plus a theme's own fonts (resources from `readCustomFonts`, or bytes the caller has already read). */
export function withCustomFonts(base: FontBook, custom: readonly (FontResource | { family: string; weight?: number; bytes: Uint8Array })[]): FontBook {
  if (custom.length === 0) return base
  const book = new FontBook()
  for (const face of base.list()) book.add(face)
  let total = 0
  for (const font of custom) {
    if (font.bytes.byteLength > MAX_CUSTOM_FONT_BYTES) throw new ChartsError("FONT_TOO_LARGE", `The font for "${font.family}" is over 8 MB.`, "Subset the font or use a smaller file.")
    total += font.bytes.byteLength
    if (total > MAX_CUSTOM_FONTS_TOTAL_BYTES) throw new ChartsError("FONT_TOO_LARGE", `The theme's font files are over 24 MB together.`, "Subset the fonts, or use fewer weights.")
    const weight = font.weight ?? 400
    const resource = "sha256" in font ? font : customFontResource(font.bytes, font.family, weight, font.family)
    book.add(parseFont(resource.bytes, resource.family, weight, resource))
  }
  return book
}

/**
 * Reads a theme's workspace font files under the limits, in this order: confine every path to the workspace, ask the
 * host for read permission on all of them, check each file's size and the total from the file system, and only then
 * read the bytes. A file that is too large or not a TrueType/OpenType font is refused before it is parsed.
 */
export async function readCustomFonts(workspace: Workspace, files: readonly { family: string; weight?: number; path: string }[], assertRead?: (paths: readonly string[]) => Promise<void>, readBytes: (absolute: string) => Uint8Array = absolute => new Uint8Array(readFileSync(absolute))): Promise<FontResource[]> {
  if (files.length === 0) return []
  const confined = files.map(file => ({ file, at: confine(workspace, file.path, "read") }))
  // The real files: a link is asked for as its target, which is what is read.
  await assertRead?.(confined.map(({ at }) => at.relative))
  let total = 0
  for (const { file, at } of confined) {
    const size = statSync(at.absolute).size
    if (size > MAX_CUSTOM_FONT_BYTES) throw new ChartsError("FONT_TOO_LARGE", `The font for "${file.family}" (${file.path}) is over 8 MB.`, "Subset the font or use a smaller file.")
    total += size
    if (total > MAX_CUSTOM_FONTS_TOTAL_BYTES) throw new ChartsError("FONT_TOO_LARGE", `The theme's font files are over 24 MB together.`, "Subset the fonts, or use fewer weights.")
  }
  return confined.map(({ file, at }) => customFontResource(readBytes(at.absolute), file.family, file.weight ?? 400, at.relative))
}

export function fileSize(path: string) { return statSync(path).size }
