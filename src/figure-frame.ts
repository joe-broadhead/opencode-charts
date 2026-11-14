import type { Issue } from "./errors.js"
import { ChartsError } from "./errors.js"
import type { FontBook } from "./fonts.js"
import { tabularNumsCss } from "./themes/adapters.js"
import type { ThemeTokens } from "./themes/tokens.js"

/**
 * The editorial five-part figure: kicker, headline, subtitle, the chart, and a sourced footer.
 *
 * A chart SVG on its own is a drawing. A figure is something a reader can enter: a short label that says what kind of
 * thing this is (the kicker), a headline that states the finding, a subtitle that says the measure, the period and the
 * population, the drawing, and a footer that says where the numbers came from and what a reader should know about
 * them. The frame composes those five parts around a finished chart without touching a single mark of it: the inner
 * SVG's children move into one `<g>` translated below the header, so ids, clips and aria labels all still point where
 * they did.
 *
 * Everything is measured with the same approved font tables the chart was measured with, so a headline wraps at the
 * width it will actually occupy, and the result is deterministic: no clock, no system font, no network.
 */

export interface FigureFrameInput {
  /** The small label above the headline, drawn uppercase: "CHART", "ECONOMY", "MARKETS". */
  readonly kicker?: string
  /** The headline: the finding a reader should take away. */
  readonly title?: string
  /** The standfirst: measure, period, population, or the caveat that qualifies the headline. */
  readonly subtitle?: string
  /** The source line in the footer: "Source: Office for National Statistics". */
  readonly source?: string
  /** Notes in the footer: definitions, revisions, a caution about comparability. */
  readonly notes?: string
  /** Space above the header and below the footer, in pixels (default 0: the chart's own padding shows through). */
  readonly padding?: number
  /** Space between the header block and the chart, in pixels (default 10). */
  readonly gap?: number
  /** The left edge of the header and footer text, in pixels (default 0). */
  readonly inset?: number
}

export interface FigureFrameResult {
  readonly svg: string
  readonly width: number
  readonly height: number
  /** Advisories about the frame's own text: a headline that needs more lines than the frame draws. */
  readonly warnings: Issue[]
}

const KICKER_SIZE = 11
const FOOTER_SIZE = 10
const MAX_TITLE_LINES = 3
const MAX_SUBTITLE_LINES = 3
const MAX_FOOTER_LINES = 3

const round = (n: number) => Math.round(n * 100) / 100

/** XML text: the five characters that would otherwise change the document. */
export function escapeXml(text: string): string {
  return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&apos;")
}

/**
 * Greedy word wrapping against a measured width; an unbreakable word is kept whole rather than cut. When the text needs
 * more than `maxLines`, the last line it draws ends in an ellipsis and `overflow` is true, so the caller can warn.
 */
function wrapLines(text: string, maxWidth: number, maxLines: number, measure: (text: string) => number): { lines: string[]; overflow: boolean } {
  const words = text.trim().split(/\s+/).filter(Boolean)
  const lines: string[] = []
  let line = "", overflow = false
  for (const word of words) {
    const next = line ? `${line} ${word}` : word
    if (line && measure(next) > maxWidth) {
      lines.push(line)
      if (lines.length === maxLines) { overflow = true; line = ""; break }
      line = word
    } else line = next
  }
  if (line) lines.push(line)
  const kept = lines.slice(0, maxLines)
  if (overflow && kept.length) kept[kept.length - 1] = `${kept[kept.length - 1]}…`
  return { lines: kept, overflow }
}

/** The inner chart's width and height, from its attributes or its viewBox. */
function innerSize(attributes: string): { width: number; height: number } | undefined {
  const number = (name: string) => {
    const found = new RegExp(`\\b${name}\\s*=\\s*"([\\d.]+)(?:px)?"`).exec(attributes)
    return found ? Number(found[1]) : undefined
  }
  const width = number("width"), height = number("height")
  if (width && height) return { width, height }
  const box = /\bviewBox\s*=\s*"([^"]+)"/.exec(attributes)
  const parts = box ? box[1]!.trim().split(/[\s,]+/).map(Number) : []
  if (parts.length === 4 && parts.every(Number.isFinite)) return { width: parts[2]!, height: parts[3]! }
  return undefined
}

/**
 * Wraps a finished chart SVG in the five-part frame. The returned `width` and `height` are the outer SVG's, and the
 * inner chart keeps its own size, translated below the header; a footer rule and source/notes sit below it.
 */
export function wrapFigureSvg(svg: string, frame: FigureFrameInput, theme: ThemeTokens, fonts: FontBook): FigureFrameResult {
  const source = svg.trim()
  const open = /<svg\b([^>]*)>([\s\S]*)<\/svg>\s*$/i.exec(source)
  if (!open) throw new ChartsError("RENDER_FAILED", "The chart passed to the figure frame is not an SVG document.", "Render the chart first, then wrap its SVG (the tool's svgText output) in the frame.")
  const size = innerSize(open[1]!)
  if (!size) throw new ChartsError("RENDER_FAILED", "The chart SVG has no width and height (or viewBox), so the frame cannot size itself around it.", "Render the chart with an explicit width and height, then wrap it.")
  const inner = open[2]!.trim()

  const padding = Math.max(0, round(frame.padding ?? 0))
  const gap = Math.max(0, round(frame.gap ?? 10))
  const inset = Math.max(0, round(frame.inset ?? 0))
  const width = size.width
  const textWidth = Math.max(40, width - inset * 2)
  const titleSize = theme.font.titleSize
  const subtitleSize = theme.font.subtitleSize
  const family = theme.font.family
  const warnings: Issue[] = []
  const header: string[] = []
  const footer: string[] = []
  const measureWith = (size: number, weight = 400) => (line: string) => fonts.measure(line, size, family, weight)
  const body = (attributes: string, value: string) => `<text ${attributes} font-family="${escapeXml(family)}">${escapeXml(value)}</text>`

  // ---- header ------------------------------------------------------------------------------------------------
  let y = padding
  if (frame.kicker?.trim()) {
    const kicker = frame.kicker.trim()
    y += KICKER_SIZE
    header.push(body(`x="${round(inset)}" y="${round(y)}" font-size="${KICKER_SIZE}" font-weight="600" letter-spacing="${round(KICKER_SIZE * 0.08)}" fill="${theme.colors.highlight}"`, kicker.toUpperCase()))
    y += 8
  }
  if (frame.title?.trim()) {
    const wrapped = wrapLines(frame.title.trim(), textWidth, MAX_TITLE_LINES, measureWith(titleSize, theme.font.titleWeight))
    const step = Math.round(titleSize * 1.2)
    for (const [i, line] of wrapped.lines.entries()) {
      y += i === 0 ? titleSize : step
      header.push(body(`x="${round(inset)}" y="${round(y)}" font-size="${titleSize}" font-weight="${theme.font.titleWeight}" fill="${theme.colors.text}"`, line))
    }
    if (wrapped.overflow) warnings.push({ level: "warning", code: "LABEL_CLIPPED", message: `The headline needs more than ${MAX_TITLE_LINES} lines at ${Math.round(textWidth)} px and the frame draws ${MAX_TITLE_LINES}.`, path: "/title", fix: "Shorten the headline so it states the finding in one or two lines." })
    y += 8
  }
  if (frame.subtitle?.trim()) {
    const wrapped = wrapLines(frame.subtitle.trim(), textWidth, MAX_SUBTITLE_LINES, measureWith(subtitleSize))
    const step = Math.round(subtitleSize * 1.35)
    for (const [i, line] of wrapped.lines.entries()) {
      y += i === 0 ? subtitleSize : step
      header.push(body(`x="${round(inset)}" y="${round(y)}" font-size="${subtitleSize}" fill="${theme.colors.muted}"`, line))
    }
    if (wrapped.overflow) warnings.push({ level: "warning", code: "LABEL_CLIPPED", message: `The subtitle needs more than ${MAX_SUBTITLE_LINES} lines at ${Math.round(textWidth)} px and the frame draws ${MAX_SUBTITLE_LINES}.`, path: "/description", fix: "Shorten the subtitle to the measure, the period and the population." })
  }
  // With header text the block is measured; without it the top padding still separates the frame from the chart.
  const headerHeight = header.length ? Math.ceil(y + gap) : padding

  // ---- footer ------------------------------------------------------------------------------------------------
  let footerHeight = 0
  const hasFooter = Boolean(frame.source?.trim() || frame.notes?.trim())
  if (hasFooter) {
    const ruleY = headerHeight + size.height + Math.max(8, Math.round(gap))
    footer.push(`<line x1="${round(inset)}" y1="${round(ruleY)}" x2="${round(width - inset)}" y2="${round(ruleY)}" stroke="${theme.colors.grid}" stroke-width="1"/>`)
    let fy = ruleY + 14
    const block = (value: string | undefined, size_: number, colour: string) => {
      if (!value?.trim()) return
      const wrapped = wrapLines(value.trim(), textWidth, MAX_FOOTER_LINES, measureWith(size_))
      for (const line of wrapped.lines) { footer.push(body(`x="${round(inset)}" y="${round(fy)}" font-size="${size_}" fill="${colour}"`, line)); fy += Math.round(size_ * 1.35) }
      if (wrapped.overflow) warnings.push({ level: "warning", code: "LABEL_CLIPPED", message: `A footer line needs more than ${MAX_FOOTER_LINES} lines at ${Math.round(textWidth)} px and the frame draws ${MAX_FOOTER_LINES}.`, path: "/description", fix: "Shorten the source or the notes." })
    }
    block(frame.source, FOOTER_SIZE, theme.colors.muted)
    block(frame.notes, FOOTER_SIZE, theme.colors.muted)
    footerHeight = Math.ceil(fy - ruleY + padding)
  }

  const height = headerHeight + size.height + (hasFooter ? footerHeight : padding)
  const label = frame.title?.trim() || frame.subtitle?.trim() || frame.kicker?.trim() || "Chart"
  const background = theme.colors.background === "transparent" ? "" : `<rect x="0" y="0" width="${round(width)}" height="${round(height)}" fill="${theme.colors.background}"/>`
  const out = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${round(width)}" height="${round(height)}" viewBox="0 0 ${round(width)} ${round(height)}" role="img" aria-label="${escapeXml(label)}">`,
    `<style>${tabularNumsCss()}</style>`,
    background,
    ...header,
    `<g transform="translate(0, ${headerHeight})">${inner}</g>`,
    ...footer,
    `</svg>`,
  ].filter(Boolean).join("")
  return { svg: out, width: round(width), height: round(height), warnings }
}

