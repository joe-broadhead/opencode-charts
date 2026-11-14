import * as z from "zod"
import { renderMermaidASCII, renderMermaidSVG } from "beautiful-mermaid"
import { MONO, SANS } from "../constants.js"
import { ChartsError, pointer, type Issue } from "../errors.js"
import type { FontBook } from "../fonts.js"
import { accessible } from "../svg.js"
import { inkOn } from "../themes/palette.js"
import type { ThemeTokens } from "../themes/tokens.js"
import { mixColour, withAlpha } from "./table.js"

/**
 * Diagrams, offline and deterministic.
 *
 * Two modes share one pipeline. A `dsl` is Mermaid source (flowchart, sequence, state, class or ER), parsed and laid
 * out by `beautiful-mermaid`; a `kind` is a structured recipe this module lays out itself — a mindmap, an org chart, an
 * Ishikawa fishbone or an architecture flow — because those want a publication look and an ASCII outline more than a
 * general graph layout.
 *
 * Either way the drawing is then made self-contained: the external font import and the CSS variables an SVG renderer
 * cannot resolve are replaced with the theme's own tokens and the bundled faces, so the result draws identically on a
 * host with no fonts installed, passes `checkRenderedSvg`, and rasterises through resvg with no network at all.
 */

// ---------------------------------------------------------------------------------------------------------------
// The spec.

export const DiagramNodeSchema = z.strictObject({
  id: z.string().min(1).max(80),
  label: z.string().min(1).max(200),
  /** A second line: a role on an org chart, a short note on a mindmap branch. */
  subtitle: z.string().max(200).optional(),
  /** The parent node's id; a node with no parent hangs from the root. */
  parent: z.string().max(80).optional(),
  /** A department or theme name; its colour comes from the theme's categorical palette. */
  group: z.string().max(80).optional(),
  /** An explicit accent colour for this node's card or pill. */
  color: z.string().max(64).optional(),
})

export const DiagramEdgeSchema = z.strictObject({
  from: z.string().min(1).max(80),
  to: z.string().min(1).max(80),
  label: z.string().max(120).optional(),
  style: z.enum(["solid", "dotted", "thick"]).optional(),
})

export const DiagramGroupSchema = z.strictObject({
  id: z.string().min(1).max(80),
  label: z.string().min(1).max(160),
  nodes: z.array(z.string().max(80)).max(80),
})

export const FishboneCategorySchema = z.strictObject({
  category: z.string().min(1).max(120),
  causes: z.array(z.string().min(1).max(160)).max(12),
})

export const DiagramSpecSchema = z
  .strictObject({
    /** Mermaid source: `graph TD`, `flowchart LR`, `sequenceDiagram`, `stateDiagram-v2`, `classDiagram` or `erDiagram`. */
    dsl: z.string().min(1).max(20000).optional(),
    /** A structured recipe, laid out by this engine. */
    kind: z.enum(["mindmap", "org_chart", "fishbone", "architecture"]).optional(),
    /** Mindmap balance: a horizontal tree (the default) or a radial one. */
    layout: z.enum(["horizontal", "radial"]).optional(),
    /** The flow direction of an architecture diagram, or of a `graph`/`flowchart` dsl. */
    direction: z.enum(["TD", "TB", "LR", "BT", "RL"]).optional(),
    title: z.string().min(1).max(300).optional(),
    subtitle: z.string().min(1).max(300).optional(),
    kicker: z.string().min(1).max(120).optional(),
    source: z.string().min(1).max(300).optional(),
    notes: z.string().min(1).max(500).optional(),
    /** The question a fishbone explains, such as "Late deliveries". */
    effect: z.string().min(1).max(200).optional(),
    /** The mindmap's centre, when the nodes do not already name one root. */
    root: z.strictObject({ id: z.string().min(1).max(80).optional(), label: z.string().min(1).max(200) }).optional(),
    nodes: z.array(DiagramNodeSchema).max(200).optional(),
    edges: z.array(DiagramEdgeSchema).max(400).optional(),
    /** Architecture groups, drawn as Mermaid subgraphs. */
    groups: z.array(DiagramGroupSchema).max(30).optional(),
    /** Fishbone categories, each with its causes. */
    causes: z.array(FishboneCategorySchema).max(12).optional(),
    /** The drawn width in px; the height follows the content's aspect. */
    width: z.number().min(120).max(4000).optional(),
    height: z.number().min(120).max(4000).optional(),
  })
  .refine(spec => Boolean(spec.dsl) !== Boolean(spec.kind), {
    message: "Give either dsl (Mermaid source) or kind (a diagram recipe), and not both.",
    path: ["dsl"],
  })

export type DiagramNode = z.infer<typeof DiagramNodeSchema>
export type DiagramEdge = z.infer<typeof DiagramEdgeSchema>
export type DiagramGroup = z.infer<typeof DiagramGroupSchema>
export type FishboneCategory = z.infer<typeof FishboneCategorySchema>
export type DiagramSpec = z.infer<typeof DiagramSpecSchema>
export type DiagramKind = NonNullable<DiagramSpec["kind"]>

export interface DiagramRenderOptions {
  readonly theme: ThemeTokens
  readonly fonts: FontBook
  /** Overrides the spec's width, in px. */
  readonly width?: number
  /** Overrides the spec's height, in px; the width follows the content's aspect. */
  readonly height?: number
}

export interface DiagramRender {
  /** The diagram as one self-contained SVG with numeric width and height. */
  readonly svg: string
  /** A Unicode outline of the same diagram, for a terminal. */
  readonly ascii: string
  readonly width: number
  readonly height: number
  readonly issues: readonly Issue[]
}

// ---------------------------------------------------------------------------------------------------------------
// Text helpers.

const escapeText = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")
const round = (value: number) => Math.round(value * 100) / 100
const clamp = (value: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, value))

/** Label text as one line: Mermaid's `<br/>` and a stray entity become a space the fonts can draw. */
const plainLabel = (text: string) => text.replace(/<br\s*\/?>/gi, " ").replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/\s+/g, " ").trim()

// ---------------------------------------------------------------------------------------------------------------
// The frame every diagram is drawn in: a background, a title block, the drawing at a scale, and a footer.

interface FrameContent {
  readonly inner: string
  readonly width: number
  readonly height: number
}

interface FrameHead {
  readonly kicker?: string | undefined
  readonly title?: string | undefined
  readonly subtitle?: string | undefined
  readonly source?: string | undefined
  readonly notes?: string | undefined
}

interface FrameMetrics {
  readonly family: string
  readonly mono: string
  readonly body: number
  readonly small: number
  readonly title: number
  readonly subtitle: number
  readonly titleWeight: number
  readonly pad: number
  measure(text: string, size: number, weight?: number): number
}

function frameMetrics(theme: ThemeTokens, fonts: FontBook): FrameMetrics {
  const family = fonts.has(theme.font.family) ? theme.font.family : SANS
  const mono = fonts.has(theme.font.mono) ? theme.font.mono : MONO
  return {
    family,
    mono,
    body: theme.font.size,
    small: theme.font.labelSize,
    title: theme.font.titleSize,
    subtitle: theme.font.subtitleSize,
    titleWeight: theme.font.titleWeight,
    pad: Math.max(16, Math.round(theme.layout.padding)),
    measure: (text, size, weight = 400) => fonts.measure(text, size, family, weight),
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Fitting the drawing to the frame.

/**
 * The widest a diagram is drawn when no width was asked for. A Mermaid layout sizes itself from its nodes, and a wide
 * flow or schema comes out as a wall of boxes that is unreadable in a page column; past this width the drawing is
 * scaled down, height and all, so its proportions and the frame's viewBox stay exact.
 */
const MAX_NATURAL_WIDTH = 820
/** The smallest scale a fitted drawing is drawn at: below it the type in the boxes would stop being readable. */
const MIN_FIT_SCALE = 0.55

type Matrix = [number, number, number, number, number, number]
const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0]
const multiply = (m: Matrix, n: Matrix): Matrix => [m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1], m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3], m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5]]

/** The matrix a group's transform applies, or undefined for one this scan does not interpret (so nothing is cropped). */
function matrixOf(transform: string | undefined): Matrix | undefined {
  let m = IDENTITY
  if (!transform) return m
  for (const [, fn, args] of transform.matchAll(/(\w+)\s*\(([^)]*)\)/g)) {
    const a = args!.split(/[\s,]+/).filter(Boolean).map(Number)
    let t: Matrix
    if (fn === "translate") t = [1, 0, 0, 1, a[0] ?? 0, a[1] ?? 0]
    else if (fn === "scale") t = [a[0] ?? 1, 0, 0, a[1] ?? a[0] ?? 1, 0, 0]
    else return undefined
    m = multiply(m, t)
  }
  return m
}

const attribute = (attrs: string, name: string): number | undefined => {
  const found = new RegExp(`(?:^|\\s)${name}="([-\\d.]+)"`).exec(attrs)?.[1]
  return found === undefined ? undefined : Number(found)
}

/**
 * How far the drawing's own shapes reach, to the bottom, with the transforms its groups apply. A layout engine reserves
 * room it never fills — Mermaid leaves the tail of a back edge's rank blank — and the frame closes that band instead of
 * printing it as empty space above the footer. `undefined` when the markup carries a transform or a path this scan
 * cannot interpret, so a drawing it cannot measure is never cropped.
 */
function inkBottom(inner: string): number | undefined {
  let bottom = 0
  const mark = (x: number | undefined, y: number | undefined, m: Matrix) => {
    if (y === undefined || !Number.isFinite(y)) return
    const py = m[1] * (x ?? 0) + m[3] * y + m[5]
    if (py > bottom) bottom = py
  }
  const stack: Matrix[] = [IDENTITY]
  for (const match of inner.matchAll(/<(\/?)([a-zA-Z]+)([^>]*?)(\/?)>/g)) {
    const [, close, name, attrs = "", selfClose] = match
    const top = stack[stack.length - 1]!
    if (close) { stack.pop(); continue }
    const own = matrixOf(/(?:^|\s)transform="([^"]*)"/.exec(attrs)?.[1])
    // A transform this scan does not interpret (a rotation, a skew) leaves the drawing's height as its layout gave it.
    if (own === undefined) return undefined
    const m = multiply(top, own)
    if (name === "rect") mark(attribute(attrs, "x"), (attribute(attrs, "y") ?? 0) + (attribute(attrs, "height") ?? 0), m)
    else if (name === "circle") mark(attribute(attrs, "cx"), (attribute(attrs, "cy") ?? 0) + (attribute(attrs, "r") ?? 0), m)
    else if (name === "ellipse") mark(attribute(attrs, "cx"), (attribute(attrs, "cy") ?? 0) + (attribute(attrs, "ry") ?? 0), m)
    else if (name === "line") mark(attribute(attrs, "x1"), Math.max(attribute(attrs, "y1") ?? 0, attribute(attrs, "y2") ?? 0), m)
    else if (name === "polygon" || name === "polyline") {
      const points = /(?:^|\s)points="([^"]*)"/.exec(attrs)?.[1] ?? ""
      for (const pair of points.matchAll(/([-\d.]+)[, ]+([-\d.]+)/g)) mark(Number(pair[1]), Number(pair[2]), m)
    } else if (name === "text") {
      const size = attribute(attrs, "font-size") ?? 11
      mark(attribute(attrs, "x"), (attribute(attrs, "y") ?? 0) + (attribute(attrs, "dy") ?? 0) + size * 0.25, m)
    } else if (name === "path") {
      const d = /(?:^|\s)d="([^"]*)"/.exec(attrs)?.[1]
      // A relative command's numbers are offsets, not positions: a path this scan cannot read exactly is left out of
      // the measurement entirely, and the drawing keeps the height its layout gave it.
      if (d && /[a-df-z]/.test(d.replace(/[-\d.,\s]/g, ""))) return undefined
      if (d) for (const pair of d.matchAll(/([-\d.]+)[, ]+([-\d.]+)/g)) mark(Number(pair[1]), Number(pair[2]), m)
    }
    if (!selfClose) stack.push(m)
  }
  return bottom
}

/**
 * The drawing without the blank band its layout left at the bottom: the height trimmed to the last shape plus a small
 * margin, and nothing else moved. A drawing whose ink cannot be measured is left exactly as it came.
 */
function trimTrailingSpace(content: FrameContent, margin: number): FrameContent {
  const ink = inkBottom(content.inner)
  if (ink === undefined) return content
  const wanted = Math.ceil(Math.max(ink, 1) + margin)
  return wanted < content.height - 16 ? { ...content, height: wanted } : content
}

function composeFrame(content: FrameContent, head: FrameHead, theme: ThemeTokens, fonts: FontBook, requestedWidth?: number, requestedHeight?: number): { svg: string; width: number; height: number } {
  const m = frameMetrics(theme, fonts)
  let scale = requestedWidth && content.width > 0
    ? clamp(requestedWidth / content.width, 0.2, 6)
    : requestedHeight && content.height > 0
      ? clamp(requestedHeight / content.height, 0.2, 6)
      : 1
  // No size was asked for: a drawing wider than the frame's own column is fitted to it, so the whole picture is
  // readable at the width a page gives it. The frame's own type is never scaled, only the drawing.
  if (requestedWidth === undefined && requestedHeight === undefined && content.width > 0) {
    const room = MAX_NATURAL_WIDTH - 2 * m.pad
    if (content.width > room && room > 0) scale = Math.max(MIN_FIT_SCALE, room / content.width)
  }
  const drawW = round(content.width * scale)
  const drawH = round(content.height * scale)

  const headParts: string[] = []

  const titleWidth = Math.max(
    head.kicker ? m.measure(head.kicker.toUpperCase(), m.small, 600) + m.small * 2 : 0,
    head.title ? m.measure(head.title, m.title, m.titleWeight) : 0,
    head.subtitle ? m.measure(head.subtitle, m.subtitle, 400) : 0,
    head.source ? m.measure(head.source, m.small, 400) : 0,
    head.notes ? m.measure(head.notes, m.small, 400) : 0,
  )
  const innerWidth = Math.max(drawW, titleWidth)
  const width = Math.ceil(innerWidth + m.pad * 2)

  // Title block: the kicker, headline and standfirst share one left edge, so the block reads as one column.
  let y = m.pad
  if (head.kicker) {
    y += Math.round(m.small * 1.2)
    headParts.push(`<text x="${m.pad}" y="${y}" font-family="${escapeText(m.family)}" font-size="${m.small}" font-weight="600" fill="${theme.colors.highlight}" letter-spacing="${round(m.small * 0.1)}">${escapeText(head.kicker.toUpperCase())}</text>`)
    y += Math.round(m.small * 0.4)
  }
  if (head.title) {
    y += Math.round(m.title * 1.05)
    headParts.push(`<text x="${m.pad}" y="${y}" font-family="${escapeText(m.family)}" font-size="${m.title}" font-weight="${m.titleWeight}" fill="${theme.colors.text}">${escapeText(head.title)}</text>`)
    y += Math.round(m.title * 0.3)
  }
  if (head.subtitle) {
    y += Math.round(m.subtitle * 1.35)
    headParts.push(`<text x="${m.pad}" y="${y}" font-family="${escapeText(m.family)}" font-size="${m.subtitle}" font-weight="400" fill="${theme.colors.muted}">${escapeText(head.subtitle)}</text>`)
  }
  if (head.kicker || head.title || head.subtitle) y += Math.round(m.body * 0.6)

  const offsetX = m.pad + Math.max(0, (innerWidth - drawW) / 2)
  const tail: string[] = []
  let tailHeight = 0
  if (head.notes) tailHeight += Math.round(m.small * 1.5)
  if (head.source) tailHeight += Math.round(m.small * 1.5)
  const height = Math.ceil(y + drawH + tailHeight + m.pad)

  let footY = y + drawH
  if (head.notes) {
    footY += Math.round(m.small * 1.5)
    tail.push(`<text x="${m.pad}" y="${footY}" font-family="${escapeText(m.family)}" font-size="${m.small}" fill="${theme.colors.muted}">${escapeText(head.notes)}</text>`)
  }
  if (head.source) {
    footY += Math.round(m.small * 1.5)
    tail.push(`<text x="${m.pad}" y="${footY}" font-family="${escapeText(m.family)}" font-size="${m.small}" fill="${theme.colors.axis}">${escapeText(head.source)}</text>`)
  }

  const style = `<style>text{font-family:${cssString(m.family)},sans-serif}.mono{font-family:${cssString(m.mono)},monospace}</style>`
  const transform = `translate(${round(offsetX)},${round(y)})${scale === 1 ? "" : ` scale(${round(scale)})`}`
  const svg = accessible(
    [
      `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
      style,
      `<rect x="0" y="0" width="${width}" height="${height}" fill="${theme.colors.background}"/>`,
      ...headParts,
      `<g transform="${transform}">${content.inner}</g>`,
      ...tail,
      `</svg>`,
    ].join(""),
    head.title ?? head.kicker ?? "Diagram",
    `${head.subtitle ?? head.title ?? "A diagram"}, drawn at ${width}×${height} pixels.`,
  )
  return { svg, width, height }
}

/** A font family as a CSS string, with the quotes CSS needs. */
function cssString(value: string): string {
  return `"${value.replace(/[\\"'<>&\u0000-\u001f]/g, character => `\\${character.codePointAt(0)!.toString(16)} `)}"`
}

// ---------------------------------------------------------------------------------------------------------------
// Mermaid: colours, sanitisation and the dsl both a raw `dsl` and an architecture recipe go through.

function mermaidOptions(theme: ThemeTokens) {
  const c = theme.colors
  return {
    bg: c.background,
    fg: c.text,
    line: c.axis,
    accent: c.categorical[0]!,
    muted: c.muted,
    surface: mixColour(c.background, c.text, 0.045),
    border: c.grid,
    font: SANS,
    // Tighter than the library's defaults: a flow's own spacing is what makes it wider than a page column, and every
    // pixel here is a pixel the frame does not have to scale away later.
    padding: 20,
    nodeSpacing: 20,
    layerSpacing: 34,
  }
}

/**
 * Takes `beautiful-mermaid`'s SVG and makes it a self-contained drawing: the Google Fonts import and the style block go,
 * every CSS variable in an attribute becomes the theme token it stood for (an SVG rasteriser resolves neither), and the
 * bundled families are named instead. The markup between the root tags is returned with the drawing's own size.
 */
export function sanitiseMermaidSvg(raw: string, theme: ThemeTokens): { inner: string; width: number; height: number } {
  const open = /<svg\b([^>]*)>/.exec(raw)
  if (!open) throw new ChartsError("RENDER_FAILED", "The Mermaid renderer returned no SVG element.", "Check the dsl and render again.")
  const attrs = open[1] ?? ""
  const viewBox = /viewBox="([^"]+)"/.exec(attrs)?.[1]?.trim().split(/[\s,]+/).map(Number)
  const declaredW = Number(/width="([\d.]+)"/.exec(attrs)?.[1] ?? Number.NaN)
  const declaredH = Number(/height="([\d.]+)"/.exec(attrs)?.[1] ?? Number.NaN)
  const width = Number.isFinite(declaredW) ? declaredW : viewBox?.[2] ?? 320
  const height = Number.isFinite(declaredH) ? declaredH : viewBox?.[3] ?? 240

  const tokens: Record<string, string> = {
    "--_text": theme.colors.text,
    "--_text-sec": theme.colors.muted,
    "--_text-muted": mixColour(theme.colors.background, theme.colors.muted, 0.8),
    "--_text-faint": theme.colors.axis,
    "--_line": theme.colors.axis,
    "--_arrow": theme.colors.categorical[0]!,
    "--_node-fill": mixColour(theme.colors.background, theme.colors.text, 0.045),
    "--_node-stroke": theme.colors.grid,
    "--_group-fill": theme.colors.background,
    "--_group-hdr": mixColour(theme.colors.background, theme.colors.text, 0.05),
    "--_inner-stroke": mixColour(theme.colors.background, theme.colors.text, 0.12),
    "--_key-badge": mixColour(theme.colors.background, theme.colors.text, 0.1),
    "--bg": theme.colors.background,
    "--fg": theme.colors.text,
    "--line": theme.colors.axis,
    "--accent": theme.colors.categorical[0]!,
    "--muted": theme.colors.muted,
    "--surface": mixColour(theme.colors.background, theme.colors.text, 0.045),
    "--border": theme.colors.grid,
  }

  let body = raw.slice(open.index + open[0].length, raw.lastIndexOf("</svg>"))
  // The style block carries an external font import and colour-mix() derivations: neither belongs in an offline file.
  body = body.replace(/<style\b[\s\S]*?<\/style>/gi, "")
  body = body.replace(/@import[^;]*;/gi, "")
  body = body.replace(/@font-face\s*\{[^}]*\}/gi, "")
  body = body.replace(/var\(\s*(--[\w-]+)\s*\)/g, (_whole, name: string) => tokens[name] ?? theme.colors.text)
  body = body.replace(/font-family\s*=\s*"[^"]*"/gi, `font-family="${SANS}"`)
  // A row of tspans with no `dy` is one line of text in several inks (a class member's syntax colouring). Flattened to
  // one run it measures as the one label it is, and keeps the theme's text ink rather than a faint fragment's.
  body = body.replace(/<text\b([^>]*)>((?:<tspan\b[^>]*>[\s\S]*?<\/tspan>)+)<\/text>/g, (whole, attrs: string, inner: string) => {
    if (/\bdy\s*=/.test(inner)) return whole
    const content = inner.replace(/<[^>]+>/g, "")
    // The fragments' own fills are gone with their tspans, so the run takes the theme's text ink unless it has one.
    const base = /\bfill\s*=/.test(attrs) ? attrs : `${attrs} fill="${theme.colors.text}"`
    return `<text${base}>${content}</text>`
  })
  // A last guard: any reference that is not to an id in this document is dropped, not left to be fetched.
  body = body.replace(/\s(?:href|xlink:href)="(?:[a-z][a-z0-9+.-]*:|\\|\/\/)[^"]*"/gi, "")
  return { inner: body, width: Math.max(1, Math.round(width * 100) / 100), height: Math.max(1, Math.round(height * 100) / 100) }
}

/** The Mermaid source a spec draws, and its ASCII outline. */
function renderMermaidSource(dsl: string, theme: ThemeTokens, fonts: FontBook): { content: FrameContent; ascii: string } {
  let raw: string
  try {
    raw = renderMermaidSVG(dsl, mermaidOptions(theme))
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    throw new ChartsError("RENDER_FAILED", `The Mermaid source could not be laid out: ${detail}.`, "Use a flowchart (graph TD or flowchart LR), sequenceDiagram, stateDiagram-v2, classDiagram or erDiagram, and check the arrows and labels.")
  }
  // A back edge makes Mermaid reserve a rank it never fills; close that band so the footer sits below the drawing.
  const content = trimTrailingSpace(sanitiseMermaidSvg(raw, theme), Math.round(frameMetrics(theme, fonts).small * 1.4))
  let ascii = ""
  try {
    ascii = renderMermaidASCII(dsl, { colorMode: "none" })
  } catch {
    ascii = ""
  }
  return { content, ascii }
}

// ---------------------------------------------------------------------------------------------------------------
// The tree recipes (mindmap and org chart).

interface TreeNode {
  readonly id: string
  readonly label: string
  readonly subtitle: string | undefined
  readonly group: string | undefined
  readonly color: string | undefined
  readonly children: TreeNode[]
  depth: number
  family: number
  leaf: boolean
  /** Radial placement: the node's own bearing and distance from the centre. */
  angle: number
  radius: number
  x: number
  y: number
  w: number
  h: number
}

interface TreeBuild {
  readonly root: TreeNode
  readonly nodes: readonly TreeNode[]
  readonly cyclic: readonly string[]
}

/**
 * Builds the tree from `parent` links. When the nodes name no single root (none, or several), one is supplied: the
 * `root` label when the spec gives one, else the spec's title, else "Diagram". A link that closes a loop is cut and
 * the node is attached to the root, so a malformed graph still draws and is reported.
 */
function buildTree(nodes: readonly DiagramNode[], rootLabel: string | undefined, rootId: string | undefined): TreeBuild {
  const byId = new Map<string, DiagramNode>()
  for (const node of nodes) {
    if (byId.has(node.id)) throw new ChartsError("SPEC_INVALID", `Two diagram nodes share the id "${node.id}".`, "Give each node a unique id.", pointer(["nodes"]))
    byId.set(node.id, node)
  }
  // Parentless nodes go under the empty key; a link to an unknown id is a parentless node too.
  const childrenOf = new Map<string, DiagramNode[]>()
  for (const node of nodes) {
    const key = node.parent && byId.has(node.parent) && node.parent !== node.id ? node.parent : ""
    const list = childrenOf.get(key)
    if (list) list.push(node)
    else childrenOf.set(key, [node])
  }
  const free = childrenOf.get("") ?? []
  const named = rootId && byId.has(rootId) ? byId.get(rootId) : undefined
  const rootNode: DiagramNode = named ?? (free.length === 1 ? free[0]! : { id: "__root", label: rootLabel ?? "Diagram" })

  const make = (node: DiagramNode, depth: number, parent: TreeNode | undefined): TreeNode => ({
    id: node.id, label: plainLabel(node.label), subtitle: node.subtitle ? plainLabel(node.subtitle) : undefined, group: node.group, color: node.color,
    children: [], depth, family: parent ? parent.family : 0, leaf: true, angle: 0, radius: 0, x: 0, y: 0, w: 0, h: 0,
  })

  const root = make(rootNode, 0, undefined)
  const visited = new Set<string>([root.id])
  const attach = (parent: TreeNode, key: string) => {
    for (const node of childrenOf.get(key) ?? []) {
      if (visited.has(node.id)) continue
      visited.add(node.id)
      const child = make(node, parent.depth + 1, parent)
      parent.children.push(child)
      attach(child, child.id)
    }
  }
  attach(root, root.id === "__root" ? "" : root.id)
  // A named root can leave other parentless nodes behind: they hang from it, one level down.
  if (root.id !== "__root") for (const node of free) {
    if (visited.has(node.id)) continue
    visited.add(node.id)
    const child = make(node, 1, root)
    root.children.push(child)
    attach(child, child.id)
  }

  // Nodes the walk never reached are in a cycle: attach them to the root and let the caller say so.
  const cyclic: string[] = []
  for (const node of nodes) {
    if (visited.has(node.id) || node.id === root.id) continue
    visited.add(node.id)
    cyclic.push(node.id)
    const child = make(node, 1, root)
    root.children.push(child)
    attach(child, child.id)
  }

  // Families: each top-level branch is one colour, inherited by its descendants.
  root.children.forEach((child, index) => {
    const assign = (node: TreeNode, family: number) => {
      node.family = family
      node.children.forEach(grandchild => assign(grandchild, family))
    }
    assign(child, index)
  })

  const flat: TreeNode[] = []
  const collect = (node: TreeNode) => {
    flat.push(node)
    node.children.forEach(collect)
  }
  collect(root)
  for (const node of flat) node.leaf = node.children.length === 0
  return { root, nodes: flat, cyclic }
}

// ---------------------------------------------------------------------------------------------------------------
// Mindmap.

interface TreeLayout {
  readonly content: FrameContent
  readonly ascii: string
  /** Nodes whose parent links close a loop: drawn from the root, and reported. */
  readonly cyclic: readonly string[]
}

function layoutMindmap(spec: DiagramSpec, theme: ThemeTokens, fonts: FontBook): TreeLayout {
  const nodes = spec.nodes ?? []
  if (!nodes.length) throw new ChartsError("SPEC_INVALID", "A mindmap needs nodes.", "Give at least a root node with a label.", pointer(["nodes"]))
  const build = buildTree(nodes, spec.root?.label ?? spec.title ?? "Topics", spec.root?.id)
  const m = frameMetrics(theme, fonts)
  const body = m.body
  const padX = Math.round(body * 1.1)
  const hGap = Math.round(body * 3.2)
  const vGap = Math.round(body * 1.1)
  const colour = (node: TreeNode) => node.color ?? (node.depth === 0 ? theme.colors.text : theme.colors.categorical[node.family % theme.colors.categorical.length]!)

  // Every node's own size, from its measured text.
  for (const node of build.nodes) {
    const size = node.depth === 0 ? body + 1 : body
    const weight = node.depth <= 1 ? 600 : 400
    const textW = Math.max(m.measure(node.label, size, weight), node.subtitle ? m.measure(node.subtitle, m.small, 400) : 0)
    node.h = node.subtitle ? Math.round(body * 3.1) : Math.round(body * 2.2)
    node.w = Math.ceil(textW) + padX * 2
  }

  const radial = spec.layout === "radial"
  const parts: string[] = []
  if (radial) {
    // Radial: the root at the centre, each family owning a wedge of the circle in proportion to its leaves.
    const leaves = (node: TreeNode): number => (node.leaf ? 1 : node.children.reduce((sum, child) => sum + leaves(child), 0))
    const ringStep = Math.max(...build.nodes.map(node => node.w)) * 0.62 + body * 2.4
    const place = (node: TreeNode, cx: number, cy: number, from: number, to: number) => {
      node.x = cx
      node.y = cy
      if (!node.children.length) return
      const span = to - from
      let angle = from
      for (const child of node.children) {
        const share = (leaves(child) / Math.max(1, leaves(node))) * span
        const mid = angle + share / 2
        const radius = (node.depth + 1) * ringStep + (node.depth === 0 ? node.w * 0.25 : 0)
        child.angle = mid
        child.radius = radius
        place(child, cx + Math.cos(mid) * radius, cy + Math.sin(mid) * radius, angle, angle + share)
        angle += share
      }
    }
    place(build.root, 0, 0, -Math.PI / 2, (Math.PI * 3) / 2)
    const minX = Math.min(...build.nodes.map(node => node.x - node.w / 2))
    const minY = Math.min(...build.nodes.map(node => node.y - node.h / 2))
    const maxX = Math.max(...build.nodes.map(node => node.x + node.w / 2))
    const maxY = Math.max(...build.nodes.map(node => node.y + node.h / 2))
    const shiftX = -minX, shiftY = -minY
    for (const node of build.nodes) {
      node.x += shiftX
      node.y += shiftY
    }
    // Branches first, then the pills on top. Each cubic leaves along the parent's bearing and arrives along the
    // child's, so a branch reads as a curve round the centre rather than a chord across it.
    const centreX = shiftX, centreY = shiftY
    for (const node of build.nodes) {
      for (const child of node.children) {
        const fill = colour(child)
        const midRadius = (node.radius + child.radius) / 2
        const c1x = centreX + Math.cos(node.angle) * midRadius
        const c1y = centreY + Math.sin(node.angle) * midRadius
        const c2x = centreX + Math.cos(child.angle) * midRadius
        const c2y = centreY + Math.sin(child.angle) * midRadius
        parts.push(`<path d="M${round(node.x)},${round(node.y)}C${round(c1x)},${round(c1y)} ${round(c2x)},${round(c2y)} ${round(child.x)},${round(child.y)}" fill="none" stroke="${withAlpha(fill, child.depth <= 1 ? 0.9 : 0.55)}" stroke-width="${child.depth <= 1 ? 2 : 1.3}"/>`)
      }
    }
    for (const node of build.nodes) drawMindmapPill(parts, node, colour(node), theme, m)
    return { content: { inner: parts.join(""), width: Math.ceil(maxX - minX), height: Math.ceil(maxY - minY) }, ascii: treeAscii(build.root), cyclic: build.cyclic }
  }

  // Horizontal: depth columns, leaves stacked, each parent centred on its children.
  const depthWidth: number[] = []
  for (const node of build.nodes) depthWidth[node.depth] = Math.max(depthWidth[node.depth] ?? 0, node.w)
  const xs: number[] = []
  let cursor = 0
  for (let depth = 0; depth < depthWidth.length; depth++) {
    xs.push(cursor)
    cursor += (depthWidth[depth] ?? 0) + hGap
  }
  const step = Math.max(...build.nodes.map(node => node.h)) + vGap
  let next = 0
  const place = (node: TreeNode): number => {
    node.x = (xs[node.depth] ?? 0) + node.w / 2
    if (!node.children.length) {
      node.y = next + node.h / 2
      next += step
      return node.y
    }
    // Every child is placed, in order; the parent sits on the middle of the first and last.
    const centres = node.children.map(child => place(child))
    node.y = (centres[0]! + centres[centres.length - 1]!) / 2
    return node.y
  }
  place(build.root)
  const minY = Math.min(...build.nodes.map(node => node.y - node.h / 2))
  for (const node of build.nodes) node.y -= minY
  const maxX = Math.max(...build.nodes.map(node => node.x + node.w / 2))
  const maxY = Math.max(...build.nodes.map(node => node.y + node.h / 2))

  for (const node of build.nodes) {
    for (const child of node.children) {
      const fill = colour(child)
      const x0 = node.x + node.w / 2
      const x1 = child.x - child.w / 2
      const mid = (x0 + x1) / 2
      parts.push(`<path d="M${round(x0)},${round(node.y)}C${round(mid)},${round(node.y)} ${round(mid)},${round(child.y)} ${round(x1)},${round(child.y)}" fill="none" stroke="${withAlpha(fill, child.depth <= 1 ? 0.9 : 0.55)}" stroke-width="${child.depth <= 1 ? 2 : 1.3}"/>`)
    }
  }
  for (const node of build.nodes) drawMindmapPill(parts, node, colour(node), theme, m)
  return { content: { inner: parts.join(""), width: Math.ceil(maxX), height: Math.ceil(maxY) }, ascii: treeAscii(build.root), cyclic: build.cyclic }
}

function drawMindmapPill(parts: string[], node: TreeNode, colour: string, theme: ThemeTokens, m: FrameMetrics) {
  const x = node.x - node.w / 2
  const y = node.y - node.h / 2
  const radius = Math.min(node.h / 2, 14)
  const root = node.depth === 0
  const fill = root ? theme.colors.text : node.depth === 1 ? mixColour(theme.colors.background, colour, 0.16) : theme.colors.background
  const stroke = root ? theme.colors.text : node.depth === 1 ? colour : theme.colors.grid
  parts.push(`<rect x="${round(x)}" y="${round(y)}" width="${round(node.w)}" height="${round(node.h)}" rx="${round(radius)}" fill="${fill}" stroke="${stroke}" stroke-width="${root || node.depth === 1 ? 1.6 : 1}"/>`)
  const ink = root ? theme.colors.background : theme.colors.text
  const size = node.depth === 0 ? m.body + 1 : m.body
  const weight = node.depth <= 1 ? 600 : 400
  if (node.subtitle) {
    parts.push(`<text x="${round(node.x)}" y="${round(node.y - 2)}" font-family="${escapeText(m.family)}" font-size="${size}" font-weight="${weight}" fill="${ink}" text-anchor="middle">${escapeText(node.label)}</text>`)
    parts.push(`<text x="${round(node.x)}" y="${round(node.y + m.small + 2)}" font-family="${escapeText(m.family)}" font-size="${m.small}" font-weight="400" fill="${root ? ink : theme.colors.muted}" text-anchor="middle">${escapeText(node.subtitle)}</text>`)
  } else {
    parts.push(`<text x="${round(node.x)}" y="${round(node.y + size * 0.36)}" font-family="${escapeText(m.family)}" font-size="${size}" font-weight="${weight}" fill="${ink}" text-anchor="middle">${escapeText(node.label)}</text>`)
  }
}

/** A tree as box-drawing lines: the ASCII outline a mindmap or org chart reads best as. */
function treeAscii(root: TreeNode): string {
  const lines: string[] = [root.label]
  const walk = (node: TreeNode, prefix: string) => {
    node.children.forEach((child, index) => {
      const last = index === node.children.length - 1
      lines.push(`${prefix}${last ? "└─ " : "├─ "}${child.label}${child.subtitle ? ` (${child.subtitle})` : ""}`)
      walk(child, `${prefix}${last ? "   " : "│  "}`)
    })
  }
  walk(root, "")
  return lines.join("\n")
}

// ---------------------------------------------------------------------------------------------------------------
// Org chart.

function layoutOrgChart(spec: DiagramSpec, theme: ThemeTokens, fonts: FontBook): TreeLayout {
  const nodes = spec.nodes ?? []
  if (!nodes.length) throw new ChartsError("SPEC_INVALID", "An org chart needs nodes.", "Give at least a root node with a name.", pointer(["nodes"]))
  const build = buildTree(nodes, spec.root?.label ?? spec.title ?? "Organisation", spec.root?.id)
  const m = frameMetrics(theme, fonts)
  const groups = spec.groups ?? []
  const accent = (node: TreeNode): string => {
    if (node.color) return node.color
    const key = node.group ?? ""
    const index = groups.findIndex(group => group.id === key || group.label === key)
    if (index >= 0) return theme.colors.categorical[index % theme.colors.categorical.length]!
    if (!key) return theme.colors.categorical[node.family % theme.colors.categorical.length]!
    let hash = 0
    for (const character of key) hash = (hash * 31 + character.codePointAt(0)!) % 997
    return theme.colors.categorical[hash % theme.colors.categorical.length]!
  }

  const cardPadX = Math.round(m.body * 1.2)
  for (const node of build.nodes) {
    const labelW = m.measure(node.label, m.body, 600)
    const subtitleW = node.subtitle ? m.measure(node.subtitle, m.small, 400) : 0
    node.w = Math.ceil(Math.max(labelW, subtitleW)) + cardPadX * 2 + 6
    node.h = node.subtitle ? Math.round(m.body * 3.2) : Math.round(m.body * 2.5)
  }
  const gapX = Math.round(m.body * 1.6)
  const gapY = Math.round(m.body * 2.4)

  const rowHeight = Math.max(...build.nodes.map(node => node.h)) + gapY
  let next = 0
  const place = (node: TreeNode, depth: number): number => {
    node.y = depth * rowHeight + node.h / 2
    if (!node.children.length) {
      node.x = next + node.w / 2
      next += node.w + gapX
      return node.x
    }
    const centres = node.children.map(child => place(child, depth + 1))
    const centre = (centres[0]! + centres[centres.length - 1]!) / 2
    node.x = centre
    return centre
  }
  place(build.root, 0)
  const maxX = Math.max(...build.nodes.map(node => node.x + node.w / 2))
  const maxY = Math.max(...build.nodes.map(node => node.y + node.h / 2))

  const parts: string[] = []
  // Orthogonal connectors first, so the cards sit on top of their own edges.
  for (const node of build.nodes) {
    for (const child of node.children) {
      const x0 = node.x, y0 = node.y + node.h / 2
      const x1 = child.x, y1 = child.y - child.h / 2
      const midY = y0 + (y1 - y0) / 2
      parts.push(`<path d="M${round(x0)},${round(y0)}V${round(midY)}H${round(x1)}V${round(y1)}" fill="none" stroke="${theme.colors.axis}" stroke-width="1.2" stroke-linejoin="miter"/>`)
    }
  }
  for (const node of build.nodes) {
    const x = node.x - node.w / 2, y = node.y - node.h / 2
    const colour = accent(node)
    parts.push(`<rect x="${round(x)}" y="${round(y)}" width="${round(node.w)}" height="${round(node.h)}" rx="6" fill="${mixColour(theme.colors.background, theme.colors.text, 0.03)}" stroke="${theme.colors.grid}" stroke-width="1"/>`)
    parts.push(`<rect x="${round(x)}" y="${round(y)}" width="4" height="${round(node.h)}" rx="2" fill="${colour}"/>`)
    if (node.subtitle) {
      parts.push(`<text x="${round(x + 6 + cardPadX)}" y="${round(node.y - 3)}" font-family="${escapeText(m.family)}" font-size="${m.body}" font-weight="600" fill="${theme.colors.text}">${escapeText(node.label)}</text>`)
      parts.push(`<text x="${round(x + 6 + cardPadX)}" y="${round(node.y + m.small + 5)}" font-family="${escapeText(m.family)}" font-size="${m.small}" font-weight="400" fill="${theme.colors.muted}">${escapeText(node.subtitle)}</text>`)
    } else {
      parts.push(`<text x="${round(x + 6 + cardPadX)}" y="${round(node.y + m.body * 0.36)}" font-family="${escapeText(m.family)}" font-size="${m.body}" font-weight="600" fill="${theme.colors.text}">${escapeText(node.label)}</text>`)
    }
  }

  const leaves = build.nodes.filter(node => node.leaf)
  const ascii = leaves.length > 1
    ? treeAscii(build.root)
    : `${build.root.label}${build.root.subtitle ? ` (${build.root.subtitle})` : ""}`
  return { content: { inner: parts.join(""), width: Math.ceil(maxX), height: Math.ceil(maxY) }, ascii, cyclic: build.cyclic }
}

// ---------------------------------------------------------------------------------------------------------------
// Fishbone (Ishikawa).

/**
 * A fishbone: one spine pointing at the effect, a rib per category leaning off it, and that category's causes written
 * along the rib. Each cause is marked with a short tick off the bone that stops before its text, so nothing is
 * underlined and no rule crosses the bone; the category's pill sits on the bone's outer tip.
 */
function layoutFishbone(spec: DiagramSpec, theme: ThemeTokens, fonts: FontBook): TreeLayout {
  const categories = spec.causes ?? []
  if (!categories.length) throw new ChartsError("SPEC_INVALID", "A fishbone needs causes.", "Give at least one category with its causes.", pointer(["causes"]))
  const effect = plainLabel(spec.effect ?? spec.title ?? "Effect")
  const m = frameMetrics(theme, fonts)
  const body = m.body
  const pillH = Math.round(body * 1.9)
  const headW = Math.ceil(m.measure(effect, body + 1, 600)) + Math.round(body * 2.2)
  const headH = Math.round(body * 3.2)
  const margin = Math.round(body * 0.8)
  const ribsInput = categories.map(category => ({ label: plainLabel(category.category), causes: category.causes.map(plainLabel) }))
  const pillWidth = (label: string) => Math.ceil(m.measure(label, body, 600)) + 20
  // Two causes on one bone sit at least 30 px apart, and the first clears the pill.
  const causeGap = Math.max(30, Math.round(m.small * 2.4))
  const firstGap = pillH + Math.round(m.small * 1.6)
  const mostCauses = Math.max(1, ...ribsInput.map(rib => rib.causes.length))
  // The bone's vertical run, with a breath at the spine so the cause nearest it never touches the spine or its label.
  const rise = firstGap + (mostCauses - 1) * causeGap + Math.round(m.small * 2.4)
  const tick = Math.round(body * 1.1)
  const textGap = 6
  // A rib's slot: wide enough for the widest pill plus a gutter, so pills on one side never touch.
  const slot = Math.max(Math.max(...ribsInput.map(rib => pillWidth(rib.label))) + Math.round(body * 3.4), Math.round(body * 9))
  const ribRun = Math.min(Math.round(slot * 0.5), Math.round(body * 6.5))
  const spineY = rise + Math.round(body * 2.2)
  // The spine starts at x = 0; the ribs' labels reach left of it, and the whole drawing is shifted into the margin
  // once their extent is known.
  const spineEnd = ribsInput.length * slot

  interface Cause { readonly x: number; readonly y: number; readonly text: string; readonly width: number }
  interface Rib { readonly attach: number; readonly tip: number; readonly tipY: number; readonly above: boolean; readonly colour: string; readonly labelWidth: number; readonly causes: readonly Cause[] }
  const ribs: Rib[] = ribsInput.map((rib, index) => {
    const above = index % 2 === 0
    const attach = index * slot + Math.round(slot * 0.62)
    const tip = attach - ribRun
    const tipY = above ? spineY - rise : spineY + rise
    const causes = rib.causes.map((text, position) => {
      const distance = Math.min(firstGap + position * causeGap, rise)
      const onBone = tip + (attach - tip) * (rise === 0 ? 0 : distance / rise)
      return { x: onBone, y: above ? tipY + distance : tipY - distance, text, width: m.measure(text, m.small) }
    })
    return { attach, tip, tipY, above, colour: theme.colors.categorical[index % theme.colors.categorical.length]!, labelWidth: pillWidth(rib.label), causes }
  })

  // The drawing's extent, so every part lands inside the frame with one margin.
  let minX = 0, maxX = spineEnd + 18 + headW
  let minY = spineY - headH / 2, maxY = spineY + headH / 2
  for (const rib of ribs) {
    minX = Math.min(minX, rib.tip - rib.labelWidth / 2)
    for (const cause of rib.causes) {
      minX = Math.min(minX, cause.x - tick - textGap - cause.width)
      minY = Math.min(minY, cause.y - m.small * 1.4)
      maxY = Math.max(maxY, cause.y)
    }
    minY = Math.min(minY, rib.above ? rib.tipY - pillH : rib.tipY)
    maxY = Math.max(maxY, rib.above ? rib.tipY : rib.tipY + pillH)
  }
  const shiftX = margin - minX
  const shiftY = margin - minY
  const x = (value: number) => round(value + shiftX)
  const y = (value: number) => round(value + shiftY)
  const width = Math.ceil(maxX - minX + margin * 2)
  const height = Math.ceil(maxY - minY + margin * 2)

  const parts: string[] = []
  // The spine, pointing at the effect: a line and a polygon head, so no glyph has to exist for the arrow.
  parts.push(`<line x1="${x(0)}" y1="${y(spineY)}" x2="${x(spineEnd)}" y2="${y(spineY)}" stroke="${theme.colors.text}" stroke-width="2"/>`)
  parts.push(`<polygon points="${x(spineEnd)},${y(spineY - 6)} ${x(spineEnd + 12)},${y(spineY)} ${x(spineEnd)},${y(spineY + 6)}" fill="${theme.colors.text}"/>`)
  // The effect box.
  const headX = spineEnd + 18
  const headFill = mixColour(theme.colors.background, theme.colors.categorical[0]!, 0.14)
  parts.push(`<rect x="${x(headX)}" y="${y(spineY - headH / 2)}" width="${headW}" height="${headH}" rx="6" fill="${headFill}" stroke="${theme.colors.categorical[0]!}" stroke-width="1.6"/>`)
  parts.push(`<text x="${round(x(headX + headW / 2))}" y="${round(y(spineY + (body + 1) * 0.36))}" font-family="${escapeText(m.family)}" font-size="${body + 1}" font-weight="600" fill="${theme.colors.text}" text-anchor="middle">${escapeText(effect)}</text>`)

  ribs.forEach((rib, index) => {
    const label = ribsInput[index]!.label
    parts.push(`<line x1="${x(rib.attach)}" y1="${y(spineY)}" x2="${x(rib.tip)}" y2="${y(rib.tipY)}" stroke="${rib.colour}" stroke-width="1.8"/>`)
    // The pill on the bone's outer tip: above the tip on an upper rib, below it on a lower one.
    const pillY = rib.above ? rib.tipY - pillH : rib.tipY
    const pillFill = mixColour(theme.colors.background, rib.colour, 0.16)
    parts.push(`<rect x="${x(rib.tip - rib.labelWidth / 2)}" y="${y(pillY)}" width="${rib.labelWidth}" height="${pillH}" rx="${round(pillH / 2)}" fill="${pillFill}" stroke="${rib.colour}" stroke-width="1.2"/>`)
    parts.push(`<text x="${x(rib.tip)}" y="${round(y(pillY + pillH / 2 + body * 0.36))}" font-family="${escapeText(m.family)}" font-size="${body}" font-weight="600" fill="${inkOn(pillFill, theme.mode === "dark" ? theme.colors.background : theme.colors.text, "#FFFFFF")}" text-anchor="middle">${escapeText(label)}</text>`)
    // Each cause: a short tick off the bone, stopping before the text, with the label above and to its left.
    for (const cause of rib.causes) {
      parts.push(`<line x1="${x(cause.x - tick)}" y1="${y(cause.y)}" x2="${x(cause.x)}" y2="${y(cause.y)}" stroke="${withAlpha(rib.colour, 0.8)}" stroke-width="1.1"/>`)
      parts.push(`<text x="${x(cause.x - tick - textGap)}" y="${round(y(cause.y) - 5)}" font-family="${escapeText(m.family)}" font-size="${m.small}" font-weight="400" fill="${theme.colors.text}" text-anchor="end">${escapeText(cause.text)}</text>`)
    }
  })

  const ascii = [`Cause-and-effect: ${effect}`, ...categories.map((category, index) => {
    const last = index === categories.length - 1
    const rows = [`${last ? "└─ " : "├─ "}${plainLabel(category.category)}`]
    category.causes.forEach((cause, position) => {
      rows.push(`${last ? "   " : "│  "}${position === category.causes.length - 1 ? "└─ " : "├─ "}${plainLabel(cause)}`)
    })
    return rows.join("\n")
  })].join("\n")
  return { content: { inner: parts.join(""), width, height }, ascii, cyclic: [] }
}

// ---------------------------------------------------------------------------------------------------------------
// Architecture: a structured graph, as Mermaid.

const mermaidId = (id: string) => `n_${id.replace(/[^A-Za-z0-9_]/g, "_")}`
/** A label as one safe Mermaid string: quotes and the characters that would close a shape are replaced, not escaped. */
const mermaidText = (text: string) =>
  plainLabel(text)
    .replace(/["']/g, "'")
    .replace(/[[\]{}|<>`]/g, character => ({ "[": "(", "]": ")", "{": "(", "}": ")", "|": "/", "<": "(", ">": ")", "`": "" }[character] ?? " "))
    .replace(/;/g, ",")

/** The Mermaid source for an architecture recipe: a flowchart with one subgraph per group. */
export function architectureDsl(spec: DiagramSpec): string {
  const nodes = spec.nodes ?? []
  if (!nodes.length) throw new ChartsError("SPEC_INVALID", "An architecture diagram needs nodes.", "Give the nodes and the flows between them.", pointer(["nodes"]))
  const groups = spec.groups ?? []
  const known = new Set(nodes.map(node => node.id))
  const inGroup = new Set(groups.flatMap(group => group.nodes))
  for (const group of groups) for (const id of group.nodes) if (!known.has(id)) throw new ChartsError("SPEC_INVALID", `The group "${group.id}" names a node "${id}" that does not exist.`, "Use node ids from the nodes list.", pointer(["groups"]))
  const direction = spec.direction ?? "LR"
  const lines = [`flowchart ${direction}`]
  for (const group of groups) {
    lines.push(`  subgraph ${mermaidId(group.id)}["${mermaidText(group.label)}"]`)
    for (const id of group.nodes) {
      const node = nodes.find(candidate => candidate.id === id)!
      lines.push(`    ${mermaidId(id)}["${mermaidText(node.label)}"]`)
    }
    lines.push("  end")
  }
  for (const node of nodes) {
    if (inGroup.has(node.id)) continue
    const shape = node.id === spec.root?.id ? `(["${mermaidText(node.label)}"])` : `["${mermaidText(node.label)}"]`
    lines.push(`  ${mermaidId(node.id)}${shape}`)
  }
  for (const edge of spec.edges ?? []) {
    if (!known.has(edge.from) || !known.has(edge.to)) throw new ChartsError("SPEC_INVALID", `An edge runs from "${edge.from}" to "${edge.to}", and one of those nodes does not exist.`, "Use node ids from the nodes list.", pointer(["edges"]))
    const arrow = edge.style === "dotted" ? "-.->" : edge.style === "thick" ? "==>" : "-->"
    lines.push(`  ${mermaidId(edge.from)} ${arrow}${edge.label ? `|"${mermaidText(edge.label)}"|` : ""} ${mermaidId(edge.to)}`)
  }
  return lines.join("\n")
}

// ---------------------------------------------------------------------------------------------------------------
// The one entry point.

/** Draws a diagram: Mermaid source or a structured recipe, as a self-contained SVG and a Unicode outline. */
export async function renderDiagram(specInput: unknown, options: DiagramRenderOptions): Promise<DiagramRender> {
  const parsed = DiagramSpecSchema.safeParse(specInput)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    const at = issue?.path.length ? pointer(issue.path.map(String)) : undefined
    throw new ChartsError("SPEC_INVALID", `The diagram spec has a problem: ${issue?.message ?? "it is not an object"}.`, "Fix the field named above and render again.", at)
  }
  const spec = parsed.data
  const { theme, fonts } = options
  const issues: Issue[] = []
  let ascii = ""
  let frame: FrameContent

  if (spec.dsl) {
    let source = spec.dsl.trim()
    if (!/^(?:graph|flowchart|sequenceDiagram|stateDiagram(?:-v2)?|classDiagram|erDiagram)\b/.test(source)) {
      throw new ChartsError("CHART_TYPE_UNKNOWN", "The dsl is not a diagram this engine draws.", "Start it with graph, flowchart, sequenceDiagram, stateDiagram-v2, classDiagram or erDiagram.")
    }
    // A direction in the spec wins over the one in the header, so a recipe can restyle a saved dsl without editing it.
    if (spec.direction) source = source.replace(/^(graph|flowchart)\s+(?:TD|TB|LR|BT|RL)\b/, (_whole, kind: string) => `${kind} ${spec.direction}`)
    const rendered = renderMermaidSource(source, theme, fonts)
    frame = rendered.content
    ascii = rendered.ascii
  } else {
    switch (spec.kind) {
      case "mindmap": {
        const rendered = layoutMindmap(spec, theme, fonts)
        frame = rendered.content
        ascii = rendered.ascii
        if (rendered.cyclic.length) issues.push(cycleIssue(rendered.cyclic))
        break
      }
      case "org_chart": {
        const rendered = layoutOrgChart(spec, theme, fonts)
        frame = rendered.content
        ascii = rendered.ascii
        if (rendered.cyclic.length) issues.push(cycleIssue(rendered.cyclic))
        break
      }
      case "fishbone": {
        const rendered = layoutFishbone(spec, theme, fonts)
        frame = rendered.content
        ascii = rendered.ascii
        break
      }
      case "architecture": {
        const rendered = renderMermaidSource(architectureDsl(spec), theme, fonts)
        frame = rendered.content
        ascii = rendered.ascii
        break
      }
      default:
        throw new ChartsError("SPEC_INVALID", "The diagram spec names neither dsl nor kind.", "Give a dsl, or a kind of mindmap, org_chart, fishbone or architecture.", pointer(["kind"]))
    }
  }
  const width = options.width ?? spec.width
  const height = options.height ?? spec.height
  const composed = composeFrame(frame, { kicker: spec.kicker, title: spec.title, subtitle: spec.subtitle, source: spec.source, notes: spec.notes }, theme, fonts, width, height)

  for (const character of new Set(drawnCharacters(composed.svg))) {
    if (!fonts.covers(character.codePointAt(0)!)) {
      issues.push({ level: "warning", code: "FONT_GLYPH_MISSING", message: `The bundled fonts have no glyph for "${character}", so it draws as a blank box.`, fix: "Translate the label, or use a symbol the bundled fonts draw." })
      break
    }
  }
  if (!ascii.trim()) ascii = spec.kind === "fishbone" ? `Cause-and-effect: ${plainLabel(spec.effect ?? spec.title ?? "Effect")}` : (spec.title ?? spec.kind ?? "diagram")

  return { svg: composed.svg, ascii, width: composed.width, height: composed.height, issues }
}

/** The warning a cut link raises: the nodes still draw, hung from the root, and the reader is told why. */
function cycleIssue(ids: readonly string[]): Issue {
  return {
    level: "warning",
    code: "SPEC_INVALID",
    message: `The nodes ${ids.slice(0, 4).map(id => `"${id}"`).join(", ")} form a cycle, so they are drawn from the root.`,
    path: pointer(["nodes"]),
    fix: "Make the parent links a tree: exactly one node with no parent.",
  }
}

/** The characters an SVG actually draws, so a glyph check measures the same text resvg will. */
function drawnCharacters(svg: string): string[] {
  const characters: string[] = []
  for (const match of svg.matchAll(/<text\b[^>]*>([\s\S]*?)<\/text>/g)) {
    const body = match[1]!.replace(/<[^>]+>/g, "")
    for (const character of body) if (character.codePointAt(0)! > 0x20) characters.push(character)
  }
  return characters
}
