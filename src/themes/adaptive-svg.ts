import { createHash } from "node:crypto"
import { checkRenderedSvg } from "../safety.js"
import type { ThemeTokens } from "./tokens.js"

/**
 * Dual-polarity SVG: one drawing that answers the reader's colour scheme with no script and no layout shift.
 *
 * A chart is drawn in one theme, so its marks carry literal hex colours. This decorator keeps those bytes as the
 * fallback and adds a scoped stylesheet inside the drawing: every colour the theme names becomes a custom property
 * (`--cs-<scope>-<slot>`), and six ordinary CSS rules set that property from the light or the dark token set — the
 * base, `prefers-color-scheme: dark`, `prefers-color-scheme: light`, `[data-theme="light"]`, `[data-theme="dark"]`
 * and print. A `fill="#FFFFFF"` becomes `fill="var(--cs-…, #FFFFFF)"`, so a viewer that ignores custom properties
 * still draws the theme it was given, while a browser repaints every mark, gridline, canvas and label when the system
 * changes, and an embedder that sets `data-theme` on the root overrides the media query.
 *
 * Determinism is a feature: the scope is the first eight hex digits of the drawing's own SHA-256, the slots are
 * visited in a fixed order, and the same input always gives the same bytes.
 */

export type AdaptiveMode = "light" | "dark"

/** One colour slot and the two values the page may draw it with. */
export interface AdaptiveSlot {
  /** The custom property's suffix: `background`, `text`, `categorical-0`, … */
  readonly name: string
  readonly light: string
  readonly dark: string
}

/** The single-valued slots, in the order they are declared: the canvas first, so it wins a shared hex. */
const SCALAR_SLOTS = ["background", "text", "muted", "grid", "axis", "positive", "negative", "neutral", "highlight"] as const
/** The ramps: each entry is its own slot, paired by index. */
const RAMP_SLOTS = ["categorical", "sequential", "diverging"] as const

/**
 * The slot pairs of two polarities of one theme. A ramp is paired index by index up to the longer of the two, and a
 * side that has no colour at an index borrows the other's, so every property a rule declares has a value.
 */
export function adaptiveSlotPairs(light: ThemeTokens, dark: ThemeTokens): readonly AdaptiveSlot[] {
  const pairs: AdaptiveSlot[] = []
  for (const slot of SCALAR_SLOTS) pairs.push({ name: slot, light: light.colors[slot], dark: dark.colors[slot] })
  for (const slot of RAMP_SLOTS) {
    const count = Math.max(light.colors[slot].length, dark.colors[slot].length)
    for (let index = 0; index < count; index++) {
      const l = light.colors[slot][index] ?? dark.colors[slot][index]
      const d = dark.colors[slot][index] ?? light.colors[slot][index]
      if (l === undefined || d === undefined) continue
      pairs.push({ name: `${slot}-${index}`, light: l, dark: d })
    }
  }
  return pairs
}

/** The scope a drawing's hash gives its class and its custom properties: `cs-a1b2c3d4`. */
export function adaptiveScope(svg: string): string {
  return `cs-${createHash("sha256").update(svg).digest("hex").slice(0, 8)}`
}

/** A three-digit form of a six-digit hex whose nibbles repeat (`#FFFFFF` → `#fff`), which some engines emit. */
function shortHex(hex: string): string | undefined {
  const match = /^#([0-9a-f])\1([0-9a-f])\2([0-9a-f])\3$/i.exec(hex)
  return match ? `#${match[1]}${match[3]}${match[5]}`.toLowerCase() : undefined
}

/** Hex → slot for one polarity, in declaration order, so a hex two slots share keeps the earlier slot. */
function slotIndex(pairs: readonly AdaptiveSlot[], mode: AdaptiveMode): Map<string, string> {
  const map = new Map<string, string>()
  for (const pair of pairs) {
    const value = pair[mode]
    if (!/^#[0-9a-f]{3,8}$/i.test(value)) continue
    if (!map.has(value.toLowerCase())) map.set(value.toLowerCase(), pair.name)
    const short = shortHex(value)
    if (short && !map.has(short)) map.set(short, pair.name)
  }
  return map
}

/** `var(--cs-<scope>-<slot>, #HEX)` for a hex this theme names, or undefined when it is data rather than a token. */
function reference(map: Map<string, string>, scope: string, hex: string): string | undefined {
  const slot = map.get(hex.toLowerCase())
  return slot === undefined ? undefined : `var(--${scope}-${slot}, ${hex})`
}

/**
 * The literal colours become custom properties with the literal as the fallback: `fill`/`stroke` attributes (and a
 * gradient's `stop-color`), and the same properties inside an inline `style="…"`. Everything else is left byte for byte.
 */
function referenceColours(svg: string, map: Map<string, string>, scope: string): string {
  const attributed = svg.replace(/(\s(?:fill|stroke|stop-color))="(#[0-9a-fA-F]{3,8})"/g, (whole, name: string, hex: string) => {
    const value = reference(map, scope, hex)
    return value === undefined ? whole : `${name}="${value}"`
  })
  return attributed.replace(/(\sstyle=")([^"]*)(")/g, (whole, open: string, body: string, close: string) => {
    const next = body.replace(/(^|;)(\s*(?:fill|stroke|stop-color)\s*:\s*)(#[0-9a-fA-F]{3,8})(?=\s*(?:;|$))/gi, (declaration, separator: string, property: string, hex: string) => {
      const value = reference(map, scope, hex)
      return value === undefined ? declaration : `${separator}${property}${value}`
    })
    return next === body ? whole : `${open}${next}${close}`
  })
}

/** The declarations of one rule: every slot of one polarity. */
function declarations(pairs: readonly AdaptiveSlot[], mode: AdaptiveMode, scope: string): string {
  return pairs.map(pair => `--${scope}-${pair.name}:${pair[mode]}`).join(";")
}

/**
 * The six rules, in the order that makes them work: the base (the initial polarity, which is also the print rule's
 * fallback), the two media queries — `:not([data-theme])` so an explicit choice always wins — then the two explicit
 * choices, equal in specificity and later, so `data-theme` settles it, and print last.
 */
function stylesheet(pairs: readonly AdaptiveSlot[], scope: string, initial: AdaptiveMode): string {
  const light = declarations(pairs, "light", scope)
  const dark = declarations(pairs, "dark", scope)
  const base = initial === "dark" ? dark : light
  return `.${scope}{${base}}@media (prefers-color-scheme: dark){.${scope}:not([data-theme="light"]){${dark}}}` +
    `@media (prefers-color-scheme: light){.${scope}:not([data-theme="dark"]){${light}}}` +
    `.${scope}[data-theme="light"]{${light}}.${scope}[data-theme="dark"]{${dark}}` +
    `@media print{.${scope}{${light}}}`
}

/**
 * Puts the scope class and `color-scheme: light dark` on the root, keeping every attribute it already carries
 * (`role`, `aria-labelledby`, `width`, `height`, `viewBox`, a `style` of its own) exactly as it is.
 */
function decorateRoot(svg: string, scope: string): { svg: string; end: number } {
  const open = /<svg\b([^>]*)>/.exec(svg)
  if (!open) throw new TypeError("makeAdaptiveSvg needs an SVG element to decorate.")
  let attributes = open[1] ?? ""
  const existingClass = /(\sclass=")([^"]*)(")/.exec(attributes)
  if (existingClass) {
    const names = existingClass[2]!.split(/\s+/).filter(Boolean)
    if (!names.includes(scope)) names.push(scope)
    attributes = attributes.replace(existingClass[0], `${existingClass[1]}${names.join(" ")}${existingClass[3]}`)
  } else attributes += ` class="${scope}"`
  const existingStyle = /(\sstyle=")([^"]*)(")/.exec(attributes)
  if (existingStyle) {
    const declared = existingStyle[2]!.trim().replace(/;\s*$/, "")
    const merged = /color-scheme\s*:/i.test(declared) ? declared : `${declared}${declared ? ";" : ""}color-scheme: light dark`
    attributes = attributes.replace(existingStyle[0], `${existingStyle[1]}${merged}${existingStyle[3]}`)
  } else attributes += ` style="color-scheme: light dark"`
  const start = open.index
  const decorated = `<svg${attributes}>`
  return { svg: svg.slice(0, start) + decorated + svg.slice(start + open[0].length), end: start + decorated.length }
}

/**
 * One drawing that serves both polarities.
 *
 * `svg` is drawn in `initialMode`'s tokens; `light` and `dark` are two complete themes of one design. The result draws
 * the same picture in a viewer that knows nothing about custom properties (every literal survives as a fallback),
 * follows the reader's colour scheme in a browser, and answers `data-theme` when an embedder states one.
 */
export function makeAdaptiveSvg(svg: string, light: ThemeTokens, dark: ThemeTokens, initialMode: AdaptiveMode = "light"): string {
  const scope = adaptiveScope(svg)
  const pairs = adaptiveSlotPairs(light, dark)
  const initial: AdaptiveMode = initialMode === "dark" ? "dark" : "light"
  const referenced = referenceColours(svg, slotIndex(pairs, initial), scope)
  const decorated = decorateRoot(referenced, scope)
  const style = `<style>${stylesheet(pairs, scope, initial)}</style>`
  const out = decorated.svg.slice(0, decorated.end) + style + decorated.svg.slice(decorated.end)
  // The drawing is still the same picture: no script, no image, no external reference survived the decoration.
  checkRenderedSvg(out)
  return out
}
