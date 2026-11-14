import { ChartsError } from "../errors.js"

/**
 * Portable motion for any engine's SVG: the animation is plain CSS inside the drawing, with no script, no network and
 * no browser-specific path syntax. `stroke-dasharray` + `stroke-dashoffset` draw a line on screen, `opacity` and the
 * individual `translate` property lift a mark into place, and `animation-delay` staggers them. All three work in
 * Chrome, Safari and Firefox, and `@media (prefers-reduced-motion: reduce)` turns them off for a reader who asks.
 *
 * The drawing is unchanged in structure: elements gain a `style` attribute (and, for a drawn line, a dash) and one
 * `<style>` element holds the keyframes, so the same SVG renders identically when nothing animates it — a PNG, a
 * print, a still frame.
 */

export type MotionMode = "none" | "entrance" | "draw" | "stagger" | "pulse"

export interface MotionOptions {
  readonly mode: MotionMode
  /** One mark's animation, in milliseconds. */
  readonly durationMs?: number
  /** The gap between two marks, in milliseconds. */
  readonly staggerMs?: number
}

/** More than this many animated elements is noise, and a longer list costs a reader more than it shows. */
export const MAX_ANIMATED_MARKS = 60
/** No element starts later than this, however many marks there are. */
export const MAX_START_MS = 900

const DEFAULTS = { durationMs: 520, staggerMs: 45 } as const

/** Attributes that make an element part of the furniture (a scale, a grid, a title) rather than a mark. */
const FURNITURE = /(?:^|\s)(?:role-axis|role-title|background|foreground|role-frame|mark-group|mark-text|mark-rule)/

/** The opening tag of any element, with its attribute text and whether it self-closes. */
const OPEN_TAG = /<([A-Za-z][\w:.-]*)((?:"[^"]*"|'[^']*'|[^>"'])*?)(\/?)>/g

function attribute(body: string, name: string): string | undefined {
  const found = new RegExp(`(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`).exec(body)
  return found ? (found[1] ?? found[2] ?? "") : undefined
}

/** The tag with `extra` appended to its attributes, before the closing `>` or `/>`. */
function addAttributes(tag: string, extra: string): string {
  const close = tag.endsWith("/>") ? "/>" : ">"
  return `${tag.slice(0, tag.length - close.length).replace(/\s*$/, "")} ${extra}${close}`
}

/** The tag with a class added: appended to its own `class` when it has one, else as a new attribute. */
function addClass(tag: string, name: string): string {
  const found = /(?:^|\s)class\s*=\s*(?:"([^"]*)"|'([^']*)')/.exec(tag)
  if (!found) return addAttributes(tag, `class="${name}"`)
  const present = (found[1] ?? found[2] ?? "").trim()
  if (present.split(/\s+/).includes(name)) return tag
  const leading = /^\s*/.exec(found[0])![0]
  return `${tag.slice(0, found.index)}${leading}class="${present ? `${present} ` : ""}${name}"${tag.slice(found.index + found[0].length)}`
}

/** The tag with CSS declarations appended to (or gaining) its `style` attribute. */
function addStyle(tag: string, declarations: string): string {
  const found = /\sstyle\s*=\s*("([^"]*)"|'([^']*)')/.exec(tag)
  if (!found) return addAttributes(tag, `style="${declarations}"`)
  const quote = found[2] !== undefined ? '"' : "'"
  const value = (found[2] ?? found[3] ?? "").replace(/;\s*$/, "")
  const from = found.index + found[0].length - found[1]!.length
  const to = found.index + found[0].length
  return `${tag.slice(0, from)}${quote}${value};${declarations}${quote}${tag.slice(to)}`
}

/**
 * The length of a polyline path, in user units, or undefined when the path uses a curve (a straight-line sum would
 * be wrong, and a dash on a wrong length jumps). Only `M`, `L`, `H`, `V` and `Z` are measured: the straight paths a
 * line chart, an area edge or a Sankey link is drawn with.
 */
export function polylineLength(d: string): number | undefined {
  const tokens = d.match(/[MmLlHhVvZzCcSsQqTtAa]|-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/gi)
  if (!tokens) return undefined
  let x = 0, y = 0, startX = 0, startY = 0, length = 0, drawn = 0, command = ""
  const numbers: number[] = []
  for (const token of tokens) {
    if (/^[A-Za-z]$/.test(token)) {
      if (!"MmLlHhVvZz".includes(token)) return undefined
      command = token
      numbers.length = 0
      if (command === "Z" || command === "z") { length += Math.hypot(startX - x, startY - y); x = startX; y = startY }
      continue
    }
    numbers.push(Number(token))
    const upper = command.toUpperCase()
    const relative = command !== upper
    const need = upper === "H" || upper === "V" ? 1 : 2
    if (numbers.length < need) continue
    const first = numbers.shift()!
    if (upper === "H") {
      const next = relative ? x + first : first
      length += Math.abs(next - x); x = next; drawn++
    } else if (upper === "V") {
      const next = relative ? y + first : first
      length += Math.abs(next - y); y = next; drawn++
    } else {
      const second = numbers.shift()!
      const nextX = relative ? x + first : first, nextY = relative ? y + second : second
      if (upper === "M") {
        // A moveto's later pairs are linetos, as the SVG grammar says, so a path written that way still measures.
        x = nextX; y = nextY; startX = x; startY = y
        command = relative ? "l" : "L"
      } else {
        length += Math.hypot(nextX - x, nextY - y); x = nextX; y = nextY; drawn++
      }
    }
  }
  return drawn > 0 ? Math.round(length * 1000) / 1000 : undefined
}

interface Element {
  readonly tag: string
  readonly name: string
  readonly body: string
  readonly startsAt: number
  readonly endsAt: number
  readonly classes: string
  readonly fill: string | undefined
  readonly stroke: string | undefined
  readonly d: string | undefined
}

function elements(svg: string): Element[] {
  const found: Element[] = []
  for (const match of svg.matchAll(OPEN_TAG)) {
    const [tag, name = "", body = ""] = match
    found.push({
      tag, name: name.toLowerCase(), body,
      startsAt: match.index!, endsAt: match.index! + tag.length,
      classes: attribute(body, "class") ?? "",
      fill: attribute(body, "fill"),
      stroke: attribute(body, "stroke"),
      d: attribute(body, "d"),
    })
  }
  return found
}

const isHidden = (element: Element) => attribute(element.body, "display") === "none" || attribute(element.body, "pointer-events") === "none"
const isFurniture = (element: Element) => FURNITURE.test(element.classes)

/** A line a reader wants to watch being drawn: a stroke that turns a corner, not a single grid or axis rule. */
function strokedPath(element: Element): boolean {
  if (element.name !== "path" || element.d === undefined) return false
  if (element.stroke === undefined || element.stroke === "none") return false
  if (element.fill !== undefined && element.fill !== "none") return false
  const length = polylineLength(element.d)
  return length !== undefined && length > 1 && (element.d.match(/[LlHhVv]/g) ?? []).length >= 2
}

/** A filled mark: a bar, an area, a dot, a slice. */
function filledMark(element: Element): boolean {
  if (!["path", "rect", "circle", "polygon", "polyline", "ellipse"].includes(element.name)) return false
  if (element.fill === undefined || element.fill === "none") return false
  return true
}

/** Whether a mark is a dot rather than a bar or an area: ECharts draws a symbol as a small arc path, Vega as a mark-symbol group. */
function dotted(element: Element): boolean {
  if (/mark-symbol/.test(element.classes)) return true
  return element.name === "path" && element.d !== undefined && /^M1 0A1 1/.test(element.d)
}

const CSS_KEYFRAMES = `@keyframes charts-rise{from{opacity:0;translate:0 6px}to{opacity:1;translate:0 0}}
@keyframes charts-draw{to{stroke-dashoffset:0}}
@keyframes charts-pulse{0%,100%{opacity:1}50%{opacity:.4}}`

/**
 * The rule every animated drawing carries, so a reader whose system asks for less motion gets the still picture. It is
 * scoped to the drawing that asked for motion (`.charts-anim`, on the root every `animateSvg` result gains), never to
 * `*`: a page that inlines two charts, or a host element around one, keeps its own motion.
 */
export const REDUCED_MOTION = `@media (prefers-reduced-motion: reduce){.charts-anim,.charts-anim *{animation-duration:.01ms !important;animation-iteration-count:1 !important;transition-duration:.01ms !important}}`

function styleBlock(): string {
  return `<style>${CSS_KEYFRAMES}\n${REDUCED_MOTION}</style>`
}

function delayFor(index: number, staggerMs: number, durationMs: number): number {
  return Math.max(0, Math.min(index * staggerMs, MAX_START_MS - durationMs))
}

/**
 * Adds motion to any engine's SVG. `none` returns the drawing unchanged; `draw` traces stroke marks, `entrance` and
 * `stagger` lift marks into place (the second with a per-mark delay), and `pulse` breathes a highlight over the focal
 * dots. The result passes `checkRenderedSvg`: a `<style>` element and style attributes only, no event handler, no
 * external reference, and the same bytes for the same input.
 */
export function animateSvg(svg: string, options: MotionOptions): string {
  const mode = options.mode
  if (mode === "none") return svg
  if (!/^\s*(?:<\?xml[^>]*>\s*)?<svg[\s>]/.test(svg)) throw new ChartsError("RENDER_FAILED", "There is no <svg> element to animate.", "Animate a rendered chart's SVG.")
  const duration = Math.max(80, Math.min(4000, Math.round(options.durationMs ?? DEFAULTS.durationMs)))
  const stagger = Math.max(0, Math.min(500, Math.round(options.staggerMs ?? DEFAULTS.staggerMs)))
  const found = elements(svg).filter(element => element.name !== "svg" && element.name !== "style" && !isHidden(element) && !isFurniture(element))

  const chosen = mode === "draw"
    ? found.filter(strokedPath)
    : mode === "pulse"
      ? (() => {
          const dots = found.filter(element => filledMark(element) && dotted(element))
          return (dots.length ? dots : found.filter(filledMark)).slice(-24)
        })()
      : found.filter(element => filledMark(element) || strokedPath(element))

  const targets = chosen.slice(0, MAX_ANIMATED_MARKS)
  if (targets.length === 0) return svg

  const style = styleBlock()
  let out = "", cursor = 0
  targets.forEach((element, index) => {
    const delay = mode === "pulse" ? delayFor(index, Math.min(stagger, 60), duration) : delayFor(index, stagger, duration)
    let tag = element.tag
    if (mode === "draw") {
      const length = polylineLength(element.d!)
      if (length === undefined) return
      tag = addAttributes(tag, `stroke-dasharray="${length}" stroke-dashoffset="${length}"`)
      tag = addStyle(tag, `animation:charts-draw ${duration}ms ease-out ${delay}ms forwards`)
    } else if (mode === "pulse") {
      tag = addStyle(tag, `--charts-delay:${delay}ms;transform-box:fill-box;transform-origin:center bottom;animation:charts-pulse ${Math.max(600, duration)}ms ease-in-out var(--charts-delay,0ms) infinite`)
    } else {
      tag = addStyle(tag, `--charts-delay:${delay}ms;transform-box:fill-box;transform-origin:center bottom;animation:charts-rise ${duration}ms cubic-bezier(.2,.7,.3,1) var(--charts-delay,0ms) both`)
    }
    out += svg.slice(cursor, element.startsAt) + tag
    cursor = element.endsAt
  })
  out += svg.slice(cursor)
  // The root gains the class the reduced-motion rule is scoped to, and the keyframes go straight after it, so they are
  // the first thing a browser reads and are never mistaken for a mark by a later pass.
  return out.replace(/<svg\b((?:"[^"]*"|'[^']*'|[^>"'])*)>/, (open) => `${addClass(open, "charts-anim")}${style}`)
}
