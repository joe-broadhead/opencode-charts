import { createHash } from "node:crypto"
import { parseFontStack, type FontBook, type FontResource } from "./fonts.js"

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

/**
 * A CSS string literal for a font family: quoted, with every character that could end the string, the rule, the
 * `<style>` element or (inside an SVG) the XML text escaped as a CSS hex escape.
 */
export function cssString(value: string): string {
  return `"${value.replace(/[\\"'<>&\u0000-\u001f\u007f\u2028\u2029]/g, ch => `\\${ch.codePointAt(0)!.toString(16)} `)}"`
}

/**
 * A `font-family` value from a CSS font stack (`"Geist, Inter, sans-serif"`): the families are read with
 * `parseFontStack`, every named one is quoted and escaped with `cssString`, and the stack ends on a generic keyword —
 * the stack's own first generic, else `fallback` — so a hostile family name can never close the string, the
 * declaration, the rule or the `<style>` element it sits in.
 */
export function cssFontStack(stack: string, fallback: "sans-serif" | "monospace" = "sans-serif"): string {
  const { named, generic } = parseFontStack(stack)
  const families = named.map(name => cssString(name))
  families.push(generic === "mono" ? "monospace" : generic === "serif" ? "serif" : generic === "sans" ? "sans-serif" : fallback)
  return families.join(",")
}

/** `@font-face` rules for approved font resources: each face's web bytes, with its own MIME type and `format()`. */
export function fontFaceCss(fonts: readonly FontResource[], block = false): string {
  return fonts.map(f => `@font-face{font-family:${cssString(f.family)};font-weight:${f.weight};${block ? "font-display:block;" : ""}src:url(data:${f.web.mime};base64,${Buffer.from(f.web.bytes).toString("base64")}) format("${f.web.format}")}`).join(block ? "\n" : "")
}

/** Embeds the fonts the SVG uses as @font-face data, so it draws identically where they are not installed. */
export function embedFonts(svg: string, fonts: readonly FontResource[]): string {
  if (fonts.length === 0) return svg
  return svg.replace(/(<svg\b[^>]*>)/, (open) => `${open}<style>${fontFaceCss(fonts)}</style>`)
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
  // A text element is one or more lines: Vega draws a multi-line label as tspans, each after the first moved down by
  // its dy. Each line is measured and boxed on its own.
  let open: { attrs: string; m: Matrix; lines: { text: string; dy: number }[]; font?: string; size?: number; weight?: string; anchor?: string } | undefined
  for (const match of svg.matchAll(tag)) {
    const [, close, name, attrs = "", selfClose, content] = match
    if (content !== undefined) { if (open) open.lines[open.lines.length - 1]!.text += content; continue }
    const top = stack[stack.length - 1]!
    if (!close && name === "tspan" && open) {
      const current = open.lines[open.lines.length - 1]!
      const dy = attr(attrs, "dy")
      const shift = dy && !dy.endsWith("em") ? Number(dy) || 0 : 0
      if (current.text.trim() || shift) open.lines.push({ text: "", dy: current.dy + shift })
    }
    if (close) {
      if (name === "text" && open) {
        for (const line of open.lines) {
          const text = unescapeXml(line.text).trim()
          if (!text) continue
          const size = open.size ?? 11
          const w = fonts.measure(text, size, open.font, open.weight)
          const x = Number(attr(open.attrs, "x") ?? 0), dy = attr(open.attrs, "dy")
          const baseline = attr(open.attrs, "dominant-baseline") ?? styleProp(open.attrs, "dominant-baseline")
          const y = Number(attr(open.attrs, "y") ?? 0) + (dy && !dy.endsWith("em") ? Number(dy) : 0) + line.dy
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
    if (name === "text" && !hidden && !top.hidden) open = { attrs, m, lines: [{ text: "", dy: 0 }], font, size, weight, anchor }
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

/** Which labels collide or run past the edge: the one measurement the layout facts and the figure tree share. */
export interface TextProblems {
  /** Indices into `boxes`, in the order found, at most 20 pairs. */
  readonly pairs: readonly (readonly [number, number])[]
  readonly clipped: readonly number[]
  /** True for a box that is in any pair: the set the marked PNG boxes. */
  readonly flagged: ReadonlySet<number>
}

export function textProblems(boxes: readonly TextBox[], width: number, height: number): TextProblems {
  const pairs: [number, number][] = []
  const sample = Math.min(boxes.length, 1500)
  for (let i = 0; i < sample && pairs.length < 20; i++) for (let j = i + 1; j < sample && pairs.length < 20; j++) {
    const a = boxes[i]!, b = boxes[j]!
    const ox = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0), oy = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0)
    if (ox > 2 && oy > 2 && polygonsOverlap(a.corners, b.corners, 1.5)) pairs.push([i, j])
  }
  const clipped = boxes.flatMap((b, i) => (b.x0 < -1 || b.y0 < -1 || (width && b.x1 > width + 1) || (height && b.y1 > height + 1) ? [i] : []))
  const flagged = new Set<number>()
  for (const [i, j] of pairs) { flagged.add(i); flagged.add(j) }
  for (const i of clipped) flagged.add(i)
  return { pairs, clipped, flagged }
}

export function layoutFacts(svg: string, fonts: FontBook, measured?: { boxes: readonly TextBox[]; width: number; height: number }, problems?: TextProblems): LayoutFacts {
  // A caller that already measured the drawing (the pipeline does) passes its boxes and problems, so the SVG is
  // parsed once and every pair is tested once.
  const { boxes, width, height } = measured ?? textBoxes(svg, fonts)
  const found = problems ?? textProblems(boxes, width, height)
  const overlaps = found.pairs.slice(0, 20).map(([i, j]) => [boxes[i]!.text, boxes[j]!.text] as [string, string])
  const clipped = found.clipped.slice(0, 20).map(i => boxes[i]!.text)
  return { width, height, texts: boxes.length, overlaps, clipped }
}
