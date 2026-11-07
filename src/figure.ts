import type { Json } from "./engines/common.js"
import type { FontBook } from "./fonts.js"
import { textBoxes, textProblems, type TextBox, type TextProblems } from "./svg.js"

/**
 * The figure tree: what the drawing actually contains, as compact text an agent can read, with an id per element that
 * the marked PNG repeats.
 *
 * A count ("2 overlapping labels") tells a model that something is wrong; it cannot say which label, where, or what
 * text to change. Every failure worth fixing in a chart is spatial — a label that collides, one that runs off the
 * edge, a value with no room — so the drawing itself is the right oracle, and text is the cheap channel.
 *
 * Adapted from the design of Rune (`anomalyco/rune@bca47138`), MIT, © Anomaly:
 * `research/16-research-agent-generative-ui.md` §3–§4 (a semantic tree with stable ids plus set-of-marks, because the
 * tree is exact and cheap and the screenshot is what sees everything).
 */

export interface FigureNode {
  readonly id: number
  readonly kind: "title" | "label" | "legend" | "tick" | "text"
  readonly text: string
  /** Box in image pixels: x0, y0, x1, y1. */
  readonly box: readonly [number, number, number, number]
  /** Where it sits: `axis x`, `axis y`, `legend`, `title`, or `drawing`. */
  readonly where: string
  /** True when it collides with another label or runs past the edge. */
  readonly problem?: "overlap" | "clipped"
}

export interface Figure {
  readonly width: number
  readonly height: number
  readonly nodes: readonly FigureNode[]
  /** The tree as text, one node a line, grouped by where it sits. */
  readonly text: string
  /** The ids that need attention, in reading order. */
  readonly problems: readonly number[]
}

const round = (n: number) => Math.round(n * 10) / 10
const escape = (text: string) => text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")

/**
 * The kind of each visible text, in document order, from the class of the group that holds it.
 *
 * Vega and Vega-Lite name their groups (`role-axis-label`, `role-axis-title`, `role-legend-label`, `role-title-text`),
 * and ECharts wraps its labels in `zr-text` groups under a series group. A name we do not know is `drawing`.
 */
export function textRoles(svg: string): { role: "title" | "legend" | "axis" | "drawing"; anchor?: string }[] {
  const roles: { role: "title" | "legend" | "axis" | "drawing"; anchor?: string }[] = []
  const stack: string[] = []
  const tag = /<(\/?)([a-zA-Z]+)([^>]*?)(\/?)>|([^<]+)/g
  const open: { text: string; attrs: string }[] = []
  for (const match of svg.matchAll(tag)) {
    const [, close, name, attrs = "", selfClose, content] = match
    if (content !== undefined) { if (open.length) open[open.length - 1]!.text += content; continue }
    if (name === "g") {
      if (close) stack.pop()
      else if (!selfClose) stack.push(/class="([^"]*)"/.exec(attrs)?.[1] ?? "")
      continue
    }
    if (name !== "text") continue
    if (close) {
      const node = open.pop()
      if (!node || !node.text.trim()) continue
      const classes = [...stack, /(?:^|\s)class="([^"]*)"/.exec(node.attrs)?.[1] ?? ""].join(" ")
      const role = /role-title/.test(classes) ? "title" : /role-legend/.test(classes) ? "legend" : /role-axis/.test(classes) ? "axis" : "drawing"
      const anchor = /text-anchor\s*[:=]\s*"?([a-z]+)/.exec(`${attrs}${node.attrs}`)?.[1]
      roles.push({ role, ...(anchor ? { anchor } : {}) })
    } else if (!selfClose) open.push({ text: "", attrs })
  }
  return roles
}

/**
 * Builds the tree from the drawn SVG, in document order, so the same spec always gives the same ids.
 *
 * The SVG is already id-normalised by the renderer (`normaliseIds`), so the only source of order here is the document
 * itself: no counter, no timestamp, no hash.
 */
export function figureOf(svg: string, fonts: FontBook, measured?: { boxes: readonly TextBox[]; width: number; height: number }, problems?: TextProblems): Figure {
  const { boxes, width, height } = measured ?? textBoxes(svg, fonts)
  const roles = textRoles(svg)
  const found = problems ?? textProblems(boxes, width, height)
  const clipped = new Set(found.clipped)
  const overlapping = new Set(found.flagged)
  // An axis label's side comes from its whole group, not from one label: a y axis's labels share an x, an x axis's
  // share a y. A single low tick label on a tall narrow chart would otherwise look like an x label.
  const axisSides = new Map<number, "axis x" | "axis y" | "axis">()
  const axisIndices = boxes.flatMap((_, i) => (roles[i]?.role === "axis" ? [i] : []))
  if (axisIndices.length) {
    const midX = (i: number) => (boxes[i]!.x0 + boxes[i]!.x1) / 2
    const midY = (i: number) => (boxes[i]!.y0 + boxes[i]!.y1) / 2
    const spreadX = Math.max(...axisIndices.map(midX)) - Math.min(...axisIndices.map(midX))
    const spreadY = Math.max(...axisIndices.map(midY)) - Math.min(...axisIndices.map(midY))
    // Labels spread mostly sideways are one x axis; mostly down the page, one y axis.
    for (const i of axisIndices) {
      // The anchor is exact: a y axis right-aligns its labels, an x axis centres them.
      const anchor = roles[i]?.anchor
      // A rotated axis title is centred like an x label, so the edge wins first.
      const hugLeft = width ? midX(i) < width * 0.12 : false
      const hugBottom = height ? midY(i) > height * 0.9 : false
      if (hugLeft) axisSides.set(i, "axis y")
      else if (hugBottom) axisSides.set(i, "axis x")
      else if (anchor === "end") axisSides.set(i, "axis y")
      else if (anchor === "middle") axisSides.set(i, "axis x")
      else if (anchor === "start") axisSides.set(i, "axis y")
      else if (axisIndices.length === 1) axisSides.set(i, "axis")
      else axisSides.set(i, spreadX > spreadY * 1.2 ? "axis x" : spreadY > spreadX * 1.2 ? "axis y" : "axis")
    }
  }
  const nodes: FigureNode[] = boxes.map((box, i) => {
    const role = roles[i]?.role ?? "drawing"
    const where = role === "axis" ? axisSides.get(i) ?? "axis" : role
    const kind: FigureNode["kind"] = where === "title" ? "title" : where === "legend" ? "legend" : where.startsWith("axis") ? "label" : "text"
    const problem: FigureNode["problem"] | undefined = clipped.has(i) ? "clipped" : overlapping.has(i) && !clipped.has(i) ? "overlap" : undefined
    return { id: i, kind, text: box.text, box: [round(box.x0), round(box.y0), round(box.x1), round(box.y1)] as const, where, ...(problem ? { problem } : {}) }
  })
  const groups = new Map<string, FigureNode[]>()
  for (const node of nodes) {
    const list = groups.get(node.where) ?? []
    list.push(node)
    groups.set(node.where, list)
  }
  const lines = [`figure ${width}x${height}, ${nodes.length} labels`]
  for (const [where, list] of groups) {
    lines.push(`  ${where} (${list.length})`)
    for (const node of list) {
      const marks = [node.problem === "overlap" ? "collides with another label" : "", node.problem === "clipped" ? "runs past the edge" : ""].filter(Boolean)
      lines.push(`    n${node.id} "${node.text}" ${node.box.map(v => Math.round(v)).join(",")}${marks.length ? `  <- ${marks.join("; ")}` : ""}`)
    }
  }
  return { width, height, nodes, text: lines.join("\n"), problems: nodes.filter(n => n.problem).map(n => n.id) }
}

/** The tree, cut to a token budget an agent can afford, keeping every problem and the head of each group. */
export function figureText(figure: Figure, maxLines = 60): string {
  const lines = figure.text.split("\n")
  if (lines.length <= maxLines) return figure.text
  const kept = lines.filter((line, i) => i === 0 || line.trimStart().startsWith("n") === false || line.includes("<-") || /^\s{2}\S/.test(line))
  const head = kept.slice(0, maxLines - 1)
  return [...head, `  … ${lines.length - head.length} more labels; send marks: "all" to number them on the image.`].join("\n")
}

/**
 * The same ids on the picture: numbered boxes drawn over the drawing before it is rasterised.
 *
 * The numbers are the tree's ids, so "n7 runs past the edge" points at one rectangle. The overlay is appended last, so
 * it sits above every mark and outside any clip path the chart uses.
 */
export function markedSvg(svg: string, figure: Figure, options: { readonly which?: "problems" | "all" | "none"; readonly colour?: string; readonly font?: string } = {}): string {
  const which = options.which ?? "problems"
  if (which === "none") return svg
  const wanted = which === "all" ? figure.nodes : figure.nodes.filter(n => n.problem)
  if (!wanted.length) return svg
  const colour = options.colour ?? "#D7263D"
  const font = options.font ?? "Inter, sans-serif"
  const marks = wanted.map(node => {
    const [x0, y0, x1, y1] = node.box
    const w = Math.max(1, x1 - x0), h = Math.max(1, y1 - y0)
    const label = `n${node.id}`
    const badge = Math.max(14, Math.min(22, Math.round(h + 6)))
    const badgeY = Math.max(0, y0 - badge - 2)
    return `<g class="charts-mark" data-id="${node.id}"><rect x="${round(x0 - 1)}" y="${round(y0 - 1)}" width="${round(w + 2)}" height="${round(h + 2)}" fill="none" stroke="${colour}" stroke-width="1"${node.problem === "overlap" ? "" : ` stroke-dasharray="2 2"`}/><rect x="${round(x0 - 1)}" y="${round(badgeY)}" width="${label.length * 6 + 6}" height="${badge}" rx="2" fill="${colour}"/><text x="${round(x0 + 1)}" y="${round(badgeY + badge / 2)}" font-family="${escape(font)}" font-size="${Math.max(9, badge - 7)}" font-weight="600" fill="#FFFFFF" dominant-baseline="middle">${label}</text></g>`
  }).join("")
  const legendWidth = Math.min(Math.max(160, figure.width), 340)
  const legend = `<g class="charts-mark-legend"><rect x="0" y="0" width="${legendWidth}" height="16" fill="${colour}"/><text x="4" y="8" font-family="${escape(font)}" font-size="10" fill="#FFFFFF" dominant-baseline="middle">n = figure ids; solid box = needs fixing</text></g>`
  return svg.replace(/<\/svg>\s*$/, `${marks}${legend}</svg>`)
}

/** The figure as a JSON node list, for a script that wants the boxes without parsing text. */
export const figureJson = (figure: Figure): Json => ({
  width: figure.width,
  height: figure.height,
  labels: figure.nodes.length,
  problems: figure.problems.length,
  nodes: figure.nodes.map(n => ({ id: n.id, kind: n.kind, where: n.where, text: n.text, box: n.box, ...(n.problem ? { problem: n.problem } : {}) })),
})
