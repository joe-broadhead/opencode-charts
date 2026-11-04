import { createHash } from "node:crypto"
import type { FontBook } from "./fonts.js"

const escapeXml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")
const unescapeXml = (s: string) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16))).replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d))).replace(/&amp;/g, "&")

/**
 * Renumbers every id (and ECharts' generated class names) in order of first appearance, under a prefix derived from
 * the content. Both engines number ids from process-wide counters, so without this the same chart rendered twice
 * differs; with it, output is byte-identical, and two charts inlined on one page never share an id.
 */
export function normaliseIds(svg: string): string {
  const tokens: string[] = []
  const seen = new Set<string>()
  const add = (t: string) => { if (!seen.has(t)) { seen.add(t); tokens.push(t) } }
  for (const m of svg.matchAll(/\sid="([^"]+)"/g)) add(m[1]!)
  for (const m of svg.matchAll(/\bzr\d+-[a-z]+-?\d*\b/g)) add(m[0])
  if (tokens.length === 0) return svg
  const escape = (t: string) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  const pattern = new RegExp(`(?<![\\w-])(${tokens.slice().sort((a, b) => b.length - a.length).map(escape).join("|")})(?![\\w-])`, "g")
  const index = new Map(tokens.map((t, i) => [t, i]))
  const placeheld = svg.replace(pattern, t => `\u0000${index.get(t)}\u0000`)
  const prefix = "c" + createHash("sha256").update(placeheld).digest("hex").slice(0, 8)
  return placeheld.replace(/\u0000(\d+)\u0000/g, (_, i) => `${prefix}-${i}`)
}

/** Puts an accessible name and description on the root: role="img", <title> and <desc>, aria-labelledby. */
export function accessible(svg: string, title: string, description: string): string {
  const open = /<svg\b[^>]*>/.exec(svg)
  if (!open) return svg
  const id = "a" + createHash("sha256").update(title + "\n" + description).digest("hex").slice(0, 8)
  const tag = open[0]
    .replace(/\s(role|aria-label|aria-labelledby|aria-describedby|aria-roledescription)="[^"]*"/g, "")
    .replace(/<svg\b/, `<svg role="img" aria-labelledby="${id}-t ${id}-d"`)
  const head = `<title id="${id}-t">${escapeXml(title)}</title><desc id="${id}-d">${escapeXml(description)}</desc>`
  return svg.slice(0, open.index) + tag + head + svg.slice(open.index + open[0].length)
}

/** Embeds the fonts the SVG uses as @font-face data, so it draws identically where they are not installed. */
export function embedFonts(svg: string, faces: readonly { family: string; weight: number; woff2: Uint8Array }[]): string {
  if (faces.length === 0) return svg
  const css = faces.map(f => `@font-face{font-family:"${f.family}";font-weight:${f.weight};src:url(data:font/woff2;base64,${Buffer.from(f.woff2).toString("base64")}) format("woff2")}`).join("")
  return svg.replace(/(<svg\b[^>]*>)/, `$1<style>${css}</style>`)
}

// ---------------------------------------------------------------------------------------------------------------
// Layout facts: where each piece of text landed, measured with the same font tables the renderers used.

type Matrix = [number, number, number, number, number, number]
const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0]
const multiply = (m: Matrix, n: Matrix): Matrix => [m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1], m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3], m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5]]
function parseTransform(value: string | undefined): Matrix {
  let m: Matrix = IDENTITY
  if (!value) return m
  for (const [, fn, args] of value.matchAll(/(\w+)\s*\(([^)]*)\)/g)) {
    const a = args!.split(/[\s,]+/).filter(Boolean).map(Number)
    let t: Matrix = IDENTITY
    if (fn === "translate") t = [1, 0, 0, 1, a[0] ?? 0, a[1] ?? 0]
    else if (fn === "scale") t = [a[0] ?? 1, 0, 0, a[1] ?? a[0] ?? 1, 0, 0]
    else if (fn === "rotate") {
      const r = ((a[0] ?? 0) * Math.PI) / 180, c = Math.cos(r), s = Math.sin(r)
      t = [c, s, -s, c, 0, 0]
      if (a.length >= 3) t = multiply(multiply([1, 0, 0, 1, a[1]!, a[2]!], t), [1, 0, 0, 1, -a[1]!, -a[2]!])
    } else if (fn === "matrix" && a.length === 6) t = a as Matrix
    m = multiply(m, t)
  }
  return m
}
const attr = (attrs: string, name: string) => new RegExp(`(?:^|\\s)${name}="([^"]*)"`).exec(attrs)?.[1]
const styleProp = (attrs: string, name: string) => new RegExp(`${name}\\s*:\\s*([^;"]+)`).exec(attr(attrs, "style") ?? "")?.[1]?.trim()

export interface TextBox { readonly text: string; readonly x0: number; readonly y0: number; readonly x1: number; readonly y1: number; readonly corners: readonly [number, number][] }
export interface LayoutFacts {
  readonly width: number
  readonly height: number
  readonly texts: number
  /** Pairs of text labels whose boxes overlap by more than 2 px each way. */
  readonly overlaps: readonly [string, string][]
  /** Text that runs past the edge of the image. */
  readonly clipped: readonly string[]
}

export function textBoxes(svg: string, fonts: FontBook): { boxes: TextBox[]; width: number; height: number } {
  const root = /<svg\b([^>]*)>/.exec(svg)
  const width = Number(attr(root?.[1] ?? "", "width") ?? 0), height = Number(attr(root?.[1] ?? "", "height") ?? 0)
  const boxes: TextBox[] = []
  const stack: { m: Matrix; font?: string; size?: number; weight?: string; anchor?: string; hidden?: boolean }[] = [{ m: IDENTITY }]
  const tag = /<(\/?)([a-zA-Z]+)([^>]*?)(\/?)>|([^<]+)/g
  let open: { attrs: string; m: Matrix; text: string; font?: string; size?: number; weight?: string; anchor?: string } | undefined
  for (const match of svg.matchAll(tag)) {
    const [, close, name, attrs = "", selfClose, content] = match
    if (content !== undefined) { if (open) open.text += content; continue }
    const top = stack[stack.length - 1]!
    if (close) {
      if (name === "text" && open) {
        const text = unescapeXml(open.text).trim()
        if (text) {
          const size = open.size ?? 11
          const w = fonts.measure(text, size, open.font, open.weight)
          const x = Number(attr(open.attrs, "x") ?? 0), dy = attr(open.attrs, "dy")
          const baseline = attr(open.attrs, "dominant-baseline") ?? styleProp(open.attrs, "dominant-baseline")
          let y = Number(attr(open.attrs, "y") ?? 0) + (dy && !dy.endsWith("em") ? Number(dy) : 0)
          const anchor = open.anchor ?? "start"
          const left = anchor === "middle" ? x - w / 2 : anchor === "end" ? x - w : x
          const topY = baseline === "central" || baseline === "middle" ? y - size / 2 : baseline === "hanging" || baseline === "text-before-edge" ? y : y - size * 0.8
          const corners = [[left, topY], [left + w, topY], [left, topY + size], [left + w, topY + size]].map(([px, py]) => [open!.m[0] * px! + open!.m[2] * py! + open!.m[4], open!.m[1] * px! + open!.m[3] * py! + open!.m[5]])
          boxes.push({ text, corners: [corners[0], corners[1], corners[3], corners[2]] as [number, number][], x0: Math.min(...corners.map(c => c[0]!)), y0: Math.min(...corners.map(c => c[1]!)), x1: Math.max(...corners.map(c => c[0]!)), y1: Math.max(...corners.map(c => c[1]!)) })
        }
        open = undefined
      }
      stack.pop()
      continue
    }
    const m = multiply(top.m, parseTransform(attr(attrs, "transform")))
    const font = attr(attrs, "font-family") ?? styleProp(attrs, "font-family") ?? top.font
    const sizeRaw = attr(attrs, "font-size") ?? styleProp(attrs, "font-size")
    const size = sizeRaw ? parseFloat(sizeRaw) : top.size
    const weight = attr(attrs, "font-weight") ?? styleProp(attrs, "font-weight") ?? top.weight
    const anchor = attr(attrs, "text-anchor") ?? styleProp(attrs, "text-anchor") ?? top.anchor
    const hidden = /(?:^|\s)(?:opacity|fill-opacity)="0(?:\.0*)?"/.test(attrs) || /display="none"|visibility="hidden"/.test(attrs)
    if (name === "text" && !hidden && !top.hidden) open = { attrs, m, text: "", font, size, weight, anchor }
    if (!selfClose) stack.push({ m, font, size, weight, anchor, hidden: hidden || top.hidden })
  }
  return { boxes, width, height }
}

/** Separating-axis test for two convex quadrilaterals; `margin` px of overlap is tolerated. */
function polygonsOverlap(a: readonly [number, number][], b: readonly [number, number][], margin: number) {
  for (const poly of [a, b]) for (let i = 0; i < poly.length; i++) {
    const [x1, y1] = poly[i]!, [x2, y2] = poly[(i + 1) % poly.length]!
    const len = Math.hypot(x2 - x1, y2 - y1) || 1
    const nx = -(y2 - y1) / len, ny = (x2 - x1) / len
    const project = (p: readonly [number, number][]) => p.map(([x, y]) => x * nx + y * ny)
    const pa = project(a), pb = project(b)
    if (Math.min(Math.max(...pa), Math.max(...pb)) - Math.max(Math.min(...pa), Math.min(...pb)) <= margin) return false
  }
  return true
}

export function layoutFacts(svg: string, fonts: FontBook): LayoutFacts {
  const { boxes, width, height } = textBoxes(svg, fonts)
  const overlaps: [string, string][] = []
  const sample = boxes.slice(0, 1500)
  for (let i = 0; i < sample.length && overlaps.length < 20; i++) for (let j = i + 1; j < sample.length && overlaps.length < 20; j++) {
    const a = sample[i]!, b = sample[j]!
    const ox = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0), oy = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0)
    if (ox > 2 && oy > 2 && polygonsOverlap(a.corners, b.corners, 1.5)) overlaps.push([a.text, b.text])
  }
  const clipped = boxes.filter(b => b.x0 < -1 || b.y0 < -1 || (width && b.x1 > width + 1) || (height && b.y1 > height + 1)).map(b => b.text).slice(0, 20)
  return { width, height, texts: boxes.length, overlaps, clipped }
}
