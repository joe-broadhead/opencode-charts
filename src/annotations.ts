import * as z from "zod"
import type { FontBook } from "./fonts.js"
import type { ThemeTokens } from "./themes/tokens.js"

/**
 * Annotations are the layer a chart needs to be read rather than decoded: the rule at a target, the shaded stretch of
 * a recession, the callout that says what the turning point was.
 *
 * Everything here is engine-agnostic SVG produced from data coordinates, so the same annotations sit on a Vega-Lite
 * chart, a Vega chart or an ECharts chart, and the output is deterministic: no clock, no randomness, no system font,
 * no network. A `callout`'s `x` and `y` are plot-box pixels (the caller projects the datum); a `line` and a `band` are
 * given in their axis's own data space, with a `domain` to project them.
 */

const colour = z.string().trim().regex(/^(#[0-9a-fA-F]{3,8}|rgba?\([\d\s.,%]+\)|transparent)$/, "a colour is #rgb, #rrggbb, #rrggbbaa, rgb(), rgba() or transparent")
const finite = z.number().finite()

/** A reference line across the plot at one value on one axis. */
export const LineAnnotationSchema = z.strictObject({
  type: z.literal("line"),
  axis: z.enum(["x", "y"]),
  value: finite,
  domain: z.tuple([finite, finite]),
  label: z.string().trim().min(1).max(120).optional(),
  color: colour.optional(),
  dashed: z.boolean().optional(),
})

/** A shaded span on one axis: an explicit from/to, or a bundled preset (US recessions, covid lockdowns). */
export const BandAnnotationSchema = z.strictObject({
  type: z.literal("band"),
  axis: z.enum(["x", "y"]),
  from: z.union([finite, z.string().trim().min(4).max(40)]).optional(),
  to: z.union([finite, z.string().trim().min(4).max(40)]).optional(),
  preset: z.enum(["us-recessions", "covid-lockdowns"]).optional(),
  domain: z.tuple([z.union([finite, z.string().trim().min(4).max(40)]), z.union([finite, z.string().trim().min(4).max(40)])]),
  label: z.string().trim().min(1).max(120).optional(),
  color: colour.optional(),
})

/** A focal point with a leader line and wrapped text: the "what happened here" note. */
export const CalloutAnnotationSchema = z.strictObject({
  type: z.literal("callout"),
  x: finite,
  y: finite,
  dx: finite.optional(),
  dy: finite.optional(),
  text: z.string().trim().min(1).max(300),
  subtext: z.string().trim().min(1).max(300).optional(),
  color: colour.optional(),
})

export const AnnotationSchema = z.discriminatedUnion("type", [LineAnnotationSchema, BandAnnotationSchema, CalloutAnnotationSchema])
export type Annotation = z.infer<typeof AnnotationSchema>
export type LineAnnotation = z.infer<typeof LineAnnotationSchema>
export type BandAnnotation = z.infer<typeof BandAnnotationSchema>
export type CalloutAnnotation = z.infer<typeof CalloutAnnotationSchema>

/** A span of time, as ISO dates, that a preset band shades. */
export interface BandSpan { readonly from: string; readonly to: string; readonly label: string }

/**
 * NBER business-cycle contractions from 2001 on, as month starts: the 2001 contraction (March–November), the
 * 2007–2009 financial-crisis contraction (December 2007–June 2009) and the 2020 contraction (February–April).
 */
export const US_RECESSIONS: readonly BandSpan[] = [
  { from: "2001-03-01", to: "2001-11-01", label: "2001 recession" },
  { from: "2007-12-01", to: "2009-06-01", label: "2007–09 recession" },
  { from: "2020-02-01", to: "2020-04-01", label: "2020 recession" },
]

/** The first covid lockdowns in the large western economies, February–June 2020. */
export const COVID_LOCKDOWNS: readonly BandSpan[] = [
  { from: "2020-03-01", to: "2020-06-01", label: "Lockdowns" },
]

export const BAND_PRESETS: Readonly<Record<"us-recessions" | "covid-lockdowns", readonly BandSpan[]>> = {
  "us-recessions": US_RECESSIONS,
  "covid-lockdowns": COVID_LOCKDOWNS,
}

export interface PlotBox { readonly x: number; readonly y: number; readonly width: number; readonly height: number }

const round = (n: number) => Math.round(n * 100) / 100
const escape = (text: string) => text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;")

/** A data value as a number: a number as it is, an ISO date or time as its epoch milliseconds, anything else NaN. */
export function numericValue(value: number | string): number {
  if (typeof value === "number") return value
  const text = value.trim()
  const date = Date.parse(text)
  if (Number.isFinite(date) && /\d{4}-\d{2}-\d{2}/.test(text)) return date
  const number = Number(text)
  return Number.isFinite(number) ? number : Number.NaN
}

const proportion = (value: number, [lo, hi]: readonly [number, number]) => (hi === lo ? 0.5 : (value - lo) / (hi - lo))

/** Where a value sits in the plot box on one axis. */
function project(value: number, axis: "x" | "y", domain: readonly [number, number], box: PlotBox): number {
  const t = proportion(value, domain)
  return axis === "x" ? box.x + t * box.width : box.y + (1 - t) * box.height
}

/** Greedy wrap of one callout line, measured with the book that draws it. */
function wrapText(text: string, maxWidth: number, measure: (line: string) => number): string[] {
  const words = text.trim().split(/\s+/).filter(Boolean)
  const lines: string[] = []
  let line = ""
  for (const word of words) {
    const next = line ? `${line} ${word}` : word
    if (line && measure(next) > maxWidth) { lines.push(line); line = word }
    else line = next
  }
  if (line) lines.push(line)
  return lines
}

const clamp = (value: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, value))

/**
 * The annotations as one SVG group, in plot-box pixels. A caller that owns the chart's SVG inserts it with
 * `injectAnnotations`; a caller that draws its own figure uses the string directly.
 */
export function renderAnnotationsSvg(annotations: readonly Annotation[], plotBox: PlotBox, theme: ThemeTokens, fonts: FontBook): string {
  if (!annotations.length) return ""
  const parts: string[] = []
  const family = theme.font.family
  const size = 10
  const measure = (line: string) => fonts.measure(line, size, family)
  const labelAt = (x: number, y: number, text: string) =>
    `<text x="${round(x)}" y="${round(y)}" font-family="${escape(family)}" font-size="${size}" fill="${theme.colors.muted}">${escape(text)}</text>`

  for (const annotation of annotations) {
    if (annotation.type === "line") {
      const at = project(annotation.value, annotation.axis, annotation.domain, plotBox)
      const tone = annotation.color ?? theme.colors.axis
      const dash = annotation.dashed === false ? "" : ` stroke-dasharray="4 3"`
      if (annotation.axis === "x") {
        parts.push(`<line x1="${round(at)}" y1="${round(plotBox.y)}" x2="${round(at)}" y2="${round(plotBox.y + plotBox.height)}" stroke="${tone}" stroke-width="1"${dash}/>`)
        if (annotation.label) {
          const width = measure(annotation.label)
          // Keep a label on the canvas, right of the rule when it fits, left of it otherwise.
          const x = at + 4 + width <= plotBox.x + plotBox.width ? at + 4 : Math.max(plotBox.x, at - 4 - width)
          parts.push(labelAt(x, plotBox.y + size + 2, annotation.label))
        }
      } else {
        parts.push(`<line x1="${round(plotBox.x)}" y1="${round(at)}" x2="${round(plotBox.x + plotBox.width)}" y2="${round(at)}" stroke="${tone}" stroke-width="1"${dash}/>`)
        if (annotation.label) parts.push(labelAt(plotBox.x + plotBox.width - Math.min(measure(annotation.label), plotBox.width), Math.max(plotBox.y + size, at - 4), annotation.label))
      }
      continue
    }

    if (annotation.type === "band") {
      const spans: readonly BandSpan[] = annotation.preset ? BAND_PRESETS[annotation.preset] : [{ from: String(annotation.from ?? annotation.domain[0]), to: String(annotation.to ?? annotation.domain[1]), label: annotation.label ?? "" }]
      const tone = annotation.color ?? theme.colors.muted
      const [lo, hi] = annotation.domain.map(numericValue) as [number, number]
      for (const span of spans) {
        const from = numericValue(span.from), to = numericValue(span.to)
        if (![from, to, lo, hi].every(Number.isFinite)) continue
        const a = project(from, annotation.axis, [lo, hi], plotBox)
        const b = project(to, annotation.axis, [lo, hi], plotBox)
        const [start, end] = a <= b ? [a, b] : [b, a]
        if (annotation.axis === "x") parts.push(`<rect x="${round(start)}" y="${round(plotBox.y)}" width="${round(Math.max(1, end - start))}" height="${round(plotBox.height)}" fill="${tone}" fill-opacity="0.14"/>`)
        else parts.push(`<rect x="${round(plotBox.x)}" y="${round(start)}" width="${round(plotBox.width)}" height="${round(Math.max(1, end - start))}" fill="${tone}" fill-opacity="0.14"/>`)
        const text = annotation.label ?? span.label
        if (text) {
          if (annotation.axis === "x") parts.push(labelAt(start + 3, plotBox.y + 2 * size + 2, text))
          else parts.push(labelAt(plotBox.x + 4, start + size, text))
        }
      }
      continue
    }

    // A callout: a 3.5 px focal dot with a halo, a 1 px leader, a 2 px accent tick, then the wrapped note.
    const tone = annotation.color ?? theme.colors.highlight
    const dotX = clamp(annotation.x, plotBox.x, plotBox.x + plotBox.width)
    const dotY = clamp(annotation.y, plotBox.y, plotBox.y + plotBox.height)
    const textSize = 11
    const subSize = 10
    const measureBody = (line: string) => fonts.measure(line, textSize, family)
    const maxTextWidth = Math.max(40, Math.min(200, plotBox.width * 0.5))
    const bodyLines = wrapText(annotation.text, maxTextWidth, measureBody)
    const measureSub = (line: string) => fonts.measure(line, subSize, family)
    const subLines = annotation.subtext ? wrapText(annotation.subtext, maxTextWidth, measureSub) : []
    const textWidth = Math.max(...bodyLines.map(measureBody), ...subLines.map(measureSub), 1)
    const bodyStep = Math.round(textSize * 1.3), subStep = Math.round(subSize * 1.4)
    const textHeight = bodyLines.length * bodyStep + subLines.length * subStep
    // Default the leader up and to the right, then hold the whole note inside the plot box.
    const dx = annotation.dx ?? 28, dy = annotation.dy ?? -34
    const labelX = clamp(dotX + dx, plotBox.x + 4, Math.max(plotBox.x + 4, plotBox.x + plotBox.width - textWidth - 4))
    const labelY = clamp(dotY + dy, plotBox.y + textSize + 2, Math.max(plotBox.y + textSize + 2, plotBox.y + plotBox.height - textHeight - 4))
    parts.push(`<circle cx="${round(dotX)}" cy="${round(dotY)}" r="8" fill="${tone}" fill-opacity="0.16"/>`)
    parts.push(`<circle cx="${round(dotX)}" cy="${round(dotY)}" r="3.5" fill="${tone}"/>`)
    parts.push(`<line x1="${round(dotX)}" y1="${round(dotY)}" x2="${round(labelX)}" y2="${round(labelY + textSize * 0.35)}" stroke="${tone}" stroke-width="1"/>`)
    // The accent tick at the text end of the leader, 2 px wide and a little taller than the cap height.
    parts.push(`<line x1="${round(labelX)}" y1="${round(labelY - 2)}" x2="${round(labelX)}" y2="${round(labelY + textSize + 2)}" stroke="${tone}" stroke-width="2"/>`)
    let lineY = labelY + Math.round(textSize * 0.95)
    for (const line of bodyLines) {
      parts.push(`<text x="${round(labelX + 5)}" y="${round(lineY)}" font-family="${escape(family)}" font-size="${textSize}" font-weight="600" fill="${theme.colors.text}">${escape(line)}</text>`)
      lineY += bodyStep
    }
    for (const line of subLines) {
      lineY += subStep - bodyStep
      parts.push(`<text x="${round(labelX + 5)}" y="${round(lineY)}" font-family="${escape(family)}" font-size="${subSize}" fill="${theme.colors.muted}">${escape(line)}</text>`)
    }
  }
  return parts.length ? `<g class="charts-annotations" aria-hidden="true">${parts.join("")}</g>` : ""
}

/** The same group, inserted last into an existing chart SVG (before `</svg>`) so it sits above every mark. */
export function injectAnnotations(svg: string, annotations: readonly Annotation[], plotBox: PlotBox, theme: ThemeTokens, fonts: FontBook): string {
  const group = renderAnnotationsSvg(annotations, plotBox, theme, fonts)
  if (!group) return svg
  return svg.replace(/<\/svg>\s*$/, `${group}</svg>`)
}

