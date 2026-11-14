/// <reference lib="dom" />
/// <reference lib="dom.iterable" />
import type { ThemeTokens } from "../themes/tokens.js"

/**
 * The host-theme bridge: a chart page or a dashboard becomes part of whatever chrome it sits in.
 *
 * Two message shapes arrive from a host view, and either may be the only one a host speaks:
 *
 *   { type: "charts.theme", v: 1, seq: 2, mode: "dark", seed: { background, foreground, accent } }
 *   { kind: "hello" | "theme.changed", theme: { scheme, surface, raised, text, muted, border, accent, … } }
 *
 * A payload carries literal colours, a seed of three colours, or a full token set; anything missing is derived here in
 * OKLCH, so one accent and one canvas are enough to style every chart, KPI and control. `seq` is enforced as monotonic
 * when a host numbers its messages, and a `hello` that transfers a `MessagePort` keeps that port for the pushes that
 * follow, which is how a host keeps its frames out of the page's own `message` traffic.
 *
 * The same logic exists twice, on purpose:
 *
 * 1. `deriveBrowserTheme` / `installThemeBridge` below, the typed half, bundled into the dashboard runtime. A dashboard
 *    can import functions; it cannot evaluate a string under its own Content-Security-Policy.
 * 2. `THEME_BRIDGE_SOURCE`, the same behaviour as plain browser JavaScript, inlined into the interactive page's own
 *    signed boot script (src/html.ts). A page may not add a `<script>` element — its policy lists the hashes of the
 *    scripts it ships and nothing else — so its bridge has to be part of the boot it already has.
 *
 * Both are covered in a real browser (test/browser/adaptive-theme.test.ts). Nothing here touches the network, the disk or
 * the clock, and no colour string is used before it is checked, so a host's message can never become a rule of its own.
 */

export type BrowserMode = "light" | "dark"

/** The colour slots every chart, KPI and control of one page is drawn from. */
export interface BrowserColours {
  readonly background: string
  readonly text: string
  readonly muted: string
  readonly grid: string
  readonly axis: string
  readonly positive: string
  readonly negative: string
  readonly neutral: string
  readonly highlight: string
  readonly categorical: readonly string[]
  readonly sequential: readonly string[]
  readonly diverging: readonly string[]
}

/** One theme, in the shape every engine on the page reads. */
export interface BrowserPalette {
  readonly mode: BrowserMode
  readonly colors: BrowserColours
  /** The page background (the board's `--board-bg`) and the raised surface it puts cards on. */
  readonly surface?: string
  readonly raised?: string
  readonly font: { readonly family: string; readonly size: number; readonly labelSize: number }
  readonly radius?: string
}

/** A palette plus what the page needs to repaint: CSS custom properties, an ECharts theme and a Plot theme. */
export interface BrowserTheme extends BrowserPalette {
  readonly variables: Readonly<Record<string, string>>
  readonly echartsTheme: Readonly<Record<string, unknown>>
  readonly plotTheme: Readonly<Record<string, unknown>>
}

/** A host view's theme, as a view bridge sends it. `scheme` and `mode` are the same thing under two names. */
export interface ViewTheme {
  readonly scheme?: "light" | "dark"
  readonly mode?: "light" | "dark"
  readonly surface?: string
  readonly raised?: string
  readonly background?: string
  readonly text?: string
  readonly foreground?: string
  readonly muted?: string
  readonly border?: string
  readonly grid?: string
  readonly axis?: string
  readonly accent?: string
  readonly "on-accent"?: string
  readonly danger?: string
  readonly positive?: string
  readonly negative?: string
  readonly neutral?: string
  readonly highlight?: string
  readonly categorical?: readonly string[]
  readonly sequential?: readonly string[]
  readonly diverging?: readonly string[]
  readonly font?: string
  readonly radius?: string
}

/** The documented chart-theme message: a mode, a seed of three colours, or a partial token set. */
export interface ChartsThemeMessage extends ViewTheme {
  readonly type: "charts.theme"
  readonly v?: number
  readonly seq?: number
  readonly seed?: ViewTheme
  readonly colors?: ViewTheme
  readonly tokens?: { readonly colors?: ViewTheme; readonly font?: { readonly family?: string } }
}

const HEX_INPUT = /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i
const FUNCTIONAL_INPUT = /^(?:rgba?|hsla?|oklch)\(\s*[0-9a-z%.,\s/+-]+\)$/i

/** A colour a page may use, normalised to an uppercase hex where that is lossless, or undefined. */
export function safeColour(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined
  const text = value.trim()
  if (!text || text.length > 64) return undefined
  if (text.toLowerCase() === "transparent") return "transparent"
  if (HEX_INPUT.test(text)) return expandHex(text).toUpperCase()
  if (FUNCTIONAL_INPUT.test(text)) return text
  return undefined
}

/** `#rgb` → `#rrggbb`, `#rgba` → `#rrggbbaa`; anything else is returned as it is. */
function expandHex(hex: string): string {
  const body = hex.slice(1)
  return body.length === 3 || body.length === 4 ? `#${[...body].map(channel => channel + channel).join("")}` : `#${body}`
}

// ---------------------------------------------------------------------------------------------------------------
// OKLCH arithmetic: enough to derive a whole page from a seed, and nothing else. sRGB in, sRGB out; the gamut is kept
// by clipping, as one page's chrome does not justify the palette builder's slower chroma search.

interface Lab { readonly l: number; readonly a: number; readonly b: number }

const srgbToLinear = (channel: number) => (channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4)
const linearToSrgb = (channel: number) => (channel <= 0.0031308 ? 12.92 * channel : 1.055 * channel ** (1 / 2.4) - 0.055)

/** A hex colour in OKLab, or undefined when it is not a hex (an `rgb()` a host sent is used as it is, not derived). */
function parseLab(value: string): Lab | undefined {
  if (!HEX_INPUT.test(value)) return undefined
  const body = expandHex(value).slice(1)
  const channel = (index: number) => parseInt(body.slice(index, index + 2), 16) / 255
  const lr = srgbToLinear(channel(0)), lg = srgbToLinear(channel(2)), lb = srgbToLinear(channel(4))
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb)
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb)
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb)
  return { l: 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, a: 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, b: 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s }
}

/** OKLCH → sRGB hex, uppercase and in gamut. */
function oklchHex(lightness: number, chroma: number, hue: number): string {
  const radians = (hue * Math.PI) / 180
  const a = chroma * Math.cos(radians), b = chroma * Math.sin(radians)
  const l = (lightness + 0.3963377774 * a + 0.2158037573 * b) ** 3
  const m = (lightness - 0.1055613458 * a - 0.0638541728 * b) ** 3
  const s = (lightness - 0.0894841775 * a - 1.291485548 * b) ** 3
  const linear = [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s]
  const hex = (value: number) => Math.round(Math.max(0, Math.min(1, linearToSrgb(value))) * 255).toString(16).padStart(2, "0")
  return `#${hex(linear[0]!)}${hex(linear[1]!)}${hex(linear[2]!)}`.toUpperCase()
}

const labToHex = (lab: Lab) => oklchHex(lab.l, Math.hypot(lab.a, lab.b), ((Math.atan2(lab.b, lab.a) * 180) / Math.PI + 360) % 360)
const lightnessOf = (value: string) => parseLab(value)?.l ?? 0.5

/** `t` of the way from `from` to `to` in OKLab; the colour itself when either end is not a hex. */
function mix(from: string, to: string, t: number): string {
  const a = parseLab(from), b = parseLab(to)
  if (!a || !b) return t < 0.5 ? from : to
  return labToHex({ l: a.l + (b.l - a.l) * t, a: a.a + (b.a - a.a) * t, b: a.b + (b.b - a.b) * t })
}

/** Ink that reads on a canvas of this lightness. */
const inkOn = (background: string) => (lightnessOf(background) > 0.58 ? "#1F2328" : "#ECEEF2")

/** `steps` colours from one end to the other, both included. */
function ramp(from: string, to: string, steps: number): string[] {
  const out: string[] = []
  for (let index = 0; index < steps; index++) out.push(mix(from, to, steps === 1 ? 1 : index / (steps - 1)))
  return out
}

/** The golden angle: successive categories never land near a previous hue. */
const GOLDEN = 137.50776405003785

/** An accent's own colour, then five hues spread around it at its lightness and chroma. */
function categories(accent: string, count = 6): string[] {
  const lab = parseLab(accent)
  if (!lab) return [accent]
  const chroma = Math.min(0.16, Math.max(0.06, Math.hypot(lab.a, lab.b)))
  const hue = ((Math.atan2(lab.b, lab.a) * 180) / Math.PI + 360) % 360
  const lightness = Math.min(0.78, Math.max(0.44, lab.l))
  const out = [accent]
  for (let index = 1; index < count; index++) out.push(oklchHex(lightness, chroma, (hue + GOLDEN * index) % 360))
  return out
}

/** Nine stops: a cool end, the canvas, and a warm end, with the lightness turned round on a dark canvas. */
function divergingStops(background: string, mode: BrowserMode): string[] {
  const lightness = mode === "light" ? 0.55 : 0.72
  const cool = oklchHex(lightness, 0.14, 250), warm = oklchHex(lightness, 0.155, 25)
  return [...ramp(cool, background, 5), ...ramp(background, warm, 5).slice(1)]
}

// ---------------------------------------------------------------------------------------------------------------
// Derivation.

const DEFAULT_FONT = { family: "sans-serif", size: 12, labelSize: 11 } as const

/** The last resort for a payload that names nothing: one neutral pair per polarity, and an accent for each. */
function defaults(mode: BrowserMode): BrowserColours {
  const light = mode === "light"
  const background = light ? "#FFFFFF" : "#16181D"
  const text = light ? "#1F2328" : "#E6E8EB"
  const accent = light ? "#4477AA" : "#56B4E9"
  return {
    background,
    text,
    muted: light ? "#59636E" : "#A3AAB3",
    grid: light ? "#E8EAED" : "#2A2F37",
    axis: light ? "#9AA1A9" : "#596170",
    positive: light ? "#228833" : "#3DBE8B",
    negative: light ? "#CC3344" : "#F2707A",
    neutral: light ? "#9AA1A9" : "#7D8590",
    highlight: accent,
    categorical: categories(accent),
    sequential: ramp(background, accent, 8),
    diverging: divergingStops(background, mode),
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value)

/** The keys a payload may never set: writing one through `[[Set]]` would reach `Object.prototype` instead of the theme. */
const UNSAFE_KEYS: ReadonlySet<string> = new Set(["__proto__", "constructor", "prototype"])

/** Copies a payload's own keys, skipping the ones that would rewrite a prototype. */
function copyOwn(target: Record<string, unknown>, source: Record<string, unknown>): void {
  for (const key of Object.keys(source)) if (!UNSAFE_KEYS.has(key)) target[key] = source[key]
}

/** A list of colours, each checked; undefined when it is not a usable list. */
function colourList(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined
  const out: string[] = []
  for (const entry of value.slice(0, 32)) {
    const colour = safeColour(entry)
    if (colour) out.push(colour)
  }
  return out.length >= 2 ? out : undefined
}

const modeOf = (value: unknown): BrowserMode | undefined => (value === "light" || value === "dark" ? value : undefined)

const RADIUS = /^-?(?:\d+|\d*\.\d+)(?:px|rem|em|%)$/
const FAMILY = /^[A-Za-z][A-Za-z0-9 _-]{0,59}$/

/**
 * Any host payload as a complete page theme. A payload naming nothing usable is `undefined`, so a stray message cannot
 * repaint the page. `base` is the page's own palette: the fallback for what a payload leaves out, and the font when the
 * payload has none.
 */
export function deriveBrowserTheme(input: unknown, base?: BrowserPalette): BrowserTheme | undefined {
  const record = isRecord(input) ? input : undefined
  if (!record) return undefined
  const payload: Record<string, unknown> = isRecord(record.theme) ? record.theme : record
  const tokens = isRecord(record.tokens) ? record.tokens : undefined
  // Weakest first, so a payload's own key beats its seed, a token set beats a colour map, and so on.
  const merged: Record<string, unknown> = {}
  for (const source of [isRecord(payload.seed) ? payload.seed : undefined, isRecord(payload.colors) ? payload.colors : undefined, isRecord(tokens?.colors) ? tokens.colors : undefined, payload]) {
    if (source) copyOwn(merged, source)
  }

  const asked = modeOf(merged.scheme) ?? modeOf(merged.mode) ?? modeOf(record.scheme) ?? modeOf(record.mode)
  const surface = safeColour(merged.surface) ?? safeColour(merged.raised)
  const backgroundAsked = safeColour(merged.background) ?? surface
  const mode: BrowserMode = asked ?? (backgroundAsked === undefined ? (base?.mode ?? "light") : lightnessOf(backgroundAsked) > 0.58 ? "light" : "dark")
  const fallback = base && base.mode === mode ? base.colors : defaults(mode)

  const background = backgroundAsked ?? fallback.background
  const text = safeColour(merged.text) ?? safeColour(merged.foreground) ?? (backgroundAsked === undefined ? fallback.text : inkOn(background))
  const accent = safeColour(merged.accent) ?? safeColour(merged.highlight) ?? fallback.highlight
  const colours: BrowserColours = {
    background,
    text,
    muted: safeColour(merged.muted) ?? mix(text, background, 0.42),
    grid: safeColour(merged.grid) ?? safeColour(merged.border) ?? mix(background, text, 0.14),
    axis: safeColour(merged.axis) ?? safeColour(merged.border) ?? mix(background, text, 0.38),
    positive: safeColour(merged.positive) ?? fallback.positive,
    negative: safeColour(merged.negative) ?? safeColour(merged.danger) ?? fallback.negative,
    neutral: safeColour(merged.neutral) ?? mix(background, text, 0.5),
    highlight: accent,
    categorical: colourList(merged.categorical) ?? categories(accent),
    sequential: colourList(merged.sequential) ?? ramp(background, accent, 8),
    diverging: colourList(merged.diverging) ?? divergingStops(background, mode),
  }

  const askedFamily = merged.font ?? tokens?.font
  const family = typeof askedFamily === "string" && FAMILY.test(askedFamily.trim())
    ? askedFamily.trim()
    : isRecord(askedFamily) && typeof askedFamily.family === "string" && FAMILY.test(askedFamily.family.trim())
      ? askedFamily.family.trim()
      : (base?.font.family ?? DEFAULT_FONT.family)
  const radius = typeof merged.radius === "string" && RADIUS.test(merged.radius.trim()) ? merged.radius.trim() : base?.radius

  return browserTheme({
    mode,
    colors: colours,
    surface: surface ?? background,
    raised: safeColour(merged.raised) ?? surface ?? background,
    font: { family, size: base?.font.size ?? DEFAULT_FONT.size, labelSize: base?.font.labelSize ?? DEFAULT_FONT.labelSize },
    ...(radius !== undefined ? { radius } : {}),
  })
}

/** A page palette from a full token set: what a page drawn in one theme hands its bridge as the base. */
export function browserPalette(theme: ThemeTokens): BrowserPalette {
  const c = theme.colors
  return {
    mode: theme.mode,
    colors: {
      background: c.background, text: c.text, muted: c.muted, grid: c.grid, axis: c.axis,
      positive: c.positive, negative: c.negative, neutral: c.neutral, highlight: c.highlight,
      categorical: [...c.categorical], sequential: [...c.sequential], diverging: [...c.diverging],
    },
    surface: c.background,
    raised: c.background,
    font: { family: theme.font.family, size: theme.font.size, labelSize: theme.font.labelSize },
  }
}

/** A palette plus the three things a page repaints with: CSS custom properties, an ECharts theme, a Plot theme. */
export function browserTheme(palette: BrowserPalette): BrowserTheme {
  const c = palette.colors
  const axis = (grid: boolean) => ({ axisLine: { show: true, lineStyle: { color: c.axis } }, axisTick: { show: false, lineStyle: { color: c.axis } }, axisLabel: { color: c.muted }, splitLine: { show: grid, lineStyle: { color: c.grid } }, splitArea: { show: false } })
  const echartsTheme: Record<string, unknown> = {
    color: [...c.categorical],
    backgroundColor: palette.raised ?? palette.surface ?? c.background,
    textStyle: { color: c.text, fontFamily: palette.font.family },
    title: { textStyle: { color: c.text, fontFamily: palette.font.family }, subtextStyle: { color: c.muted } },
    legend: { textStyle: { color: c.muted, fontFamily: palette.font.family } },
    categoryAxis: axis(false),
    valueAxis: axis(true),
    timeAxis: axis(false),
    logAxis: axis(true),
    line: { lineStyle: { width: 2 } },
    pie: { itemStyle: { borderColor: palette.raised ?? palette.surface ?? c.background, borderWidth: 1.5 } },
    visualMap: { inRange: { color: [...c.sequential] } },
  }
  const plotTheme: Record<string, unknown> = {
    colors: { background: palette.raised ?? c.background, text: c.text, muted: c.muted, grid: c.grid, axis: c.axis, categorical: [...c.categorical], sequential: [...c.sequential] },
    font: { family: palette.font.family, size: palette.font.size, labelSize: palette.font.labelSize },
  }
  return { ...palette, variables: boardVariables(palette), echartsTheme, plotTheme }
}

/**
 * The CSS custom properties a dashboard's chrome is built from, in both of its namespaces. Setting them on the page's
 * root restates every surface, ink, rule and accent at once, with no class toggling and no style sheet rewrite.
 */
export function boardVariables(theme: BrowserPalette): Record<string, string> {
  const c = theme.colors
  const surface = theme.surface ?? c.background
  const raised = theme.raised ?? c.background
  const radius = theme.radius ?? "8px"
  const variables: Record<string, string> = {
    "--board-bg": surface,
    "--board-surface": raised,
    "--board-text": c.text,
    "--board-muted": c.muted,
    "--board-border": c.grid,
    "--board-axis": c.axis,
    "--board-accent": c.highlight,
    "--board-positive": c.positive,
    "--board-negative": c.negative,
    "--board-radius": radius,
    "--board-chart-bg": raised,
    "--ui-bg": raised,
    "--ui-surface": raised,
    "--ui-text": c.text,
    "--ui-muted": c.muted,
    "--ui-border": c.grid,
    "--ui-accent": c.highlight,
    "--ui-radius": radius,
  }
  return variables
}

// ---------------------------------------------------------------------------------------------------------------
// The listener: one place that knows what a host may send, and what it may not.

/** Where a theme came from: a host message, or the reader's own colour-scheme preference. */
export type ThemeSource = "host" | "media"

export interface ThemeBridgeOptions {
  /** Called for every accepted theme; the caller repaints. An exception here never stops the bridge. */
  readonly onChange: (theme: BrowserTheme, source: ThemeSource) => void
  readonly view?: Window
  /** The page's own palette: the base a partial payload builds on. */
  readonly base?: BrowserPalette
  /** Both polarities of the page's theme, when it has them: the reader's preference picks one until a host speaks. */
  readonly paired?: { readonly light: BrowserPalette; readonly dark: BrowserPalette }
}

export interface ThemeBridgeHandle {
  /** Applies one payload for a caller that holds it (the page's own `setHostTheme`). */
  apply(input: unknown): BrowserTheme | undefined
  /** The last theme applied, if any. */
  current(): BrowserTheme | undefined
  /** Stops listening and detaches any port. The page keeps the theme it has. */
  destroy(): void
}

/**
 * Listens for a host's theme on `window` and, when a `hello` transfers one, on a `MessagePort`. Messages are accepted
 * only from the page itself or its parent, a numbered message never replaces a later one, and the reader's colour
 * scheme is followed only while no host has spoken.
 */
export function installThemeBridge(options: ThemeBridgeOptions): ThemeBridgeHandle {
  const win = options.view ?? window
  const paired = options.paired
  let lastSeq = Number.NEGATIVE_INFINITY
  let overridden = false
  let disposed = false
  let current: BrowserTheme | undefined
  let port: MessagePort | undefined

  const deliver = (theme: BrowserTheme, source: ThemeSource) => {
    current = theme
    try { options.onChange(theme, source) } catch { /* a page that cannot repaint keeps the theme it has */ }
  }

  const apply = (input: unknown): BrowserTheme | undefined => {
    if (disposed) return undefined
    const record = isRecord(input) ? input : undefined
    if (record && typeof record.seq === "number") {
      if (record.seq <= lastSeq) return undefined
      lastSeq = record.seq
    }
    const theme = deriveBrowserTheme(input, options.base)
    if (!theme) return undefined
    overridden = true
    deliver(theme, "host")
    if (record?.type === "charts.theme") acknowledge(typeof record.seq === "number" ? record.seq : undefined)
    return theme
  }

  /** Tells the parent frame a chart-theme message landed; a sandboxed frame may refuse the post, and that is fine. */
  function acknowledge(seq: number | undefined) {
    try {
      if (win.parent && win.parent !== win) win.parent.postMessage({ type: "charts.theme.ack", v: 1, ...(seq === undefined ? {} : { seq }), applied: true }, "*")
    } catch { /* an opaque-origin frame can refuse the post; the theme is applied either way */ }
  }

  function attach(candidate: MessagePort) {
    if (candidate === port) return
    if (port) { try { port.onmessage = null; port.close() } catch { /* already closed */ } }
    port = candidate
    port.onmessage = (event: MessageEvent) => { apply(event.data) }
    try { port.start?.() } catch { /* a port that is already running needs no start */ }
  }

  const onMessage = (event: MessageEvent) => {
    if (disposed) return
    const source = event.source as unknown
    if (source && source !== win && source !== win.parent) return
    const data = event.data
    if (!isRecord(data)) return
    if (data.type === "charts.theme") { apply(data); return }
    if (data.kind !== "hello" && data.kind !== "theme.changed") return
    const ports = event.ports as unknown as MessagePort[] | undefined
    if (data.kind === "hello" && ports && ports[0]) attach(ports[0])
    if (data.theme !== undefined) apply(data)
  }

  const query = paired && typeof win.matchMedia === "function" ? win.matchMedia("(prefers-color-scheme: dark)") : undefined
  const fromMedia = () => {
    if (disposed || overridden || !paired || !query) return
    const mode: BrowserMode = query.matches ? "dark" : "light"
    deliver(browserTheme({ ...paired[mode], mode }), "media")
  }

  win.addEventListener("message", onMessage as EventListener)
  if (query) {
    if (typeof query.addEventListener === "function") query.addEventListener("change", fromMedia)
    else if (typeof (query as MediaQueryList & { addListener?: (fn: () => void) => void }).addListener === "function") (query as MediaQueryList & { addListener: (fn: () => void) => void }).addListener(fromMedia)
    fromMedia()
  }
  try {
    if (win.parent && win.parent !== win) win.parent.postMessage({ type: "charts.hello", v: 1, capabilities: ["theme"] }, "*")
  } catch { /* an opaque-origin frame can refuse the post */ }

  return {
    apply,
    current: () => current,
    destroy: () => {
      disposed = true
      win.removeEventListener("message", onMessage as EventListener)
      if (query) {
        if (typeof query.removeEventListener === "function") query.removeEventListener("change", fromMedia)
        else (query as MediaQueryList & { removeListener?: (fn: () => void) => void }).removeListener?.(fromMedia)
      }
      if (port) { try { port.onmessage = null; port.close() } catch { /* already closed */ } port = undefined }
    },
  }
}

// ---------------------------------------------------------------------------------------------------------------
// The page's half. This is plain browser JavaScript with no imports, inlined into the interactive page's own signed
// boot script: a page's policy hashes the scripts it ships, so a second `<script>` element would never run.

/**
 * An expression that, called as `(source)(window, document, config)`, returns the page-side bridge:
 *
 *   { hooks: [], apply(payload), theme(), destroy() }
 *
 * `config` is `{ palette, paired, font }`; a page that has only one polarity passes `paired: null`. `hooks` is the
 * list of repaints the page's own boot registers (a live ECharts or Plot view), each called with the new theme.
 */
export const THEME_BRIDGE_SOURCE = `(function(win,doc,config){
var GOLDEN=137.50776405003785,lastSeq=-Infinity,overridden=false,port=null,current=null,hooks=[];
var HEX=/^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i,FN=/^(?:rgba?|hsla?|oklch)\\(\\s*[0-9a-z%.,\\s/+\\-]+\\)$/i,RADIUS=/^-?(?:\\d+|\\d*\\.\\d+)(?:px|rem|em|%)$/,FAMILY=/^[A-Za-z][A-Za-z0-9 _-]{0,59}$/;
function expand(h){var b=h.slice(1);if(b.length===3||b.length===4){var o='';for(var i=0;i<b.length;i++)o+=b.charAt(i)+b.charAt(i);return '#'+o}return '#'+b}
function safe(v){if(typeof v!=='string')return undefined;var t=v.trim();if(!t||t.length>64)return undefined;if(t.toLowerCase()==='transparent')return 'transparent';if(HEX.test(t))return expand(t).toUpperCase();if(FN.test(t))return t;return undefined}
function lin(c){return c<=0.04045?c/12.92:Math.pow((c+0.055)/1.055,2.4)}
function unlin(c){return c<=0.0031308?12.92*c:1.055*Math.pow(c,1/2.4)-0.055}
function lab(v){if(!HEX.test(v))return null;var b=expand(v).slice(1),ch=function(i){return parseInt(b.slice(i,i+2),16)/255};
var r=lin(ch(0)),g=lin(ch(2)),bl=lin(ch(4));
var l=Math.cbrt(0.4122214708*r+0.5363325363*g+0.0514459929*bl),m=Math.cbrt(0.2119034982*r+0.6806995451*g+0.1073969566*bl),s=Math.cbrt(0.0883024619*r+0.2817188376*g+0.6299787005*bl);
return {l:0.2104542553*l+0.793617785*m-0.0040720468*s,a:1.9779984951*l-2.428592205*m+0.4505937099*s,b:0.0259040371*l+0.7827717662*m-0.808675766*s}}
function hex(l,c,h){var r=h*Math.PI/180,a=c*Math.cos(r),b=c*Math.sin(r);
var x=Math.pow(l+0.3963377774*a+0.2158037573*b,3),y=Math.pow(l-0.1055613458*a-0.0638541728*b,3),z=Math.pow(l-0.0894841775*a-1.291485548*b,3);
var L=[4.0767416621*x-3.3077115913*y+0.2309699292*z,-1.2684380046*x+2.6097574011*y-0.3413193965*z,-0.0041960863*x-0.7034186147*y+1.707614701*z];
var p=function(v){return Math.round(Math.max(0,Math.min(1,unlin(v)))*255).toString(16).padStart(2,'0')};
return ('#'+p(L[0])+p(L[1])+p(L[2])).toUpperCase()}
function toHex(v){var c=lab(v);if(!c)return v;return hex(c.l,Math.hypot(c.a,c.b),(Math.atan2(c.b,c.a)*180/Math.PI+360)%360)}
function light(v){var c=lab(v);return c?c.l:0.5}
function mix(f,t,k){var a=lab(f),b=lab(t);if(!a||!b)return k<0.5?f:t;return hex(a.l+(b.l-a.l)*k,Math.hypot(a.a+(b.a-a.a)*k,a.b+(b.b-a.b)*k),(Math.atan2(a.b+(b.b-a.b)*k,a.a+(b.a-a.a)*k)*180/Math.PI+360)%360)}
function ramp(f,t,n){var o=[],i;for(i=0;i<n;i++)o.push(mix(f,t,n===1?1:i/(n-1)));return o}
function cats(accent,n){var c=lab(accent);if(!c)return [accent];var ch=Math.min(0.16,Math.max(0.06,Math.hypot(c.a,c.b))),hue=(Math.atan2(c.b,c.a)*180/Math.PI+360)%360,l=Math.min(0.78,Math.max(0.44,c.l)),o=[accent],i;
for(i=1;i<n;i++)o.push(hex(l,ch,(hue+GOLDEN*i)%360));return o}
function divs(bg,mode){var l=mode==='light'?0.55:0.72;return ramp(hex(l,0.14,250),bg,5).concat(ramp(bg,hex(l,0.155,25),5).slice(1))}
function defaults(mode){var light=mode==='light',bg=light?'#FFFFFF':'#16181D',accent=light?'#4477AA':'#56B4E9';
return {background:bg,text:light?'#1F2328':'#E6E8EB',muted:light?'#59636E':'#A3AAB3',grid:light?'#E8EAED':'#2A2F37',axis:light?'#9AA1A9':'#596170',positive:light?'#228833':'#3DBE8B',negative:light?'#CC3344':'#F2707A',neutral:light?'#9AA1A9':'#7D8590',highlight:accent,categorical:cats(accent,6),sequential:ramp(bg,accent,8),diverging:divs(bg,mode)}}
function isObj(v){return !!v&&typeof v==='object'&&!Array.isArray(v)}
function list(v){if(!Array.isArray(v))return undefined;var o=[],i,c;for(i=0;i<v.length&&i<32;i++){c=safe(v[i]);if(c)o.push(c)}return o.length>=2?o:undefined}
function modeOf(v){return v==='light'||v==='dark'?v:undefined}
function copy(d,o){for(var k in o)if(Object.prototype.hasOwnProperty.call(o,k)&&k!=='__proto__'&&k!=='constructor'&&k!=='prototype')d[k]=o[k]}
function derive(input){if(!isObj(input))return undefined;var payload=isObj(input.theme)?input.theme:input,tokens=isObj(input.tokens)?input.tokens:null,merged={},srcs=[isObj(payload.seed)?payload.seed:null,isObj(payload.colors)?payload.colors:null,tokens&&isObj(tokens.colors)?tokens.colors:null,payload],i,src;
for(i=0;i<srcs.length;i++){if(srcs[i])copy(merged,srcs[i])}
var asked=modeOf(merged.scheme)||modeOf(merged.mode)||modeOf(input.scheme)||modeOf(input.mode);
var surface=safe(merged.surface)||safe(merged.raised),bgAsked=safe(merged.background)||surface;
var mode=asked||(bgAsked===undefined?(config.palette?config.palette.mode:'light'):(light(bgAsked)>0.58?'light':'dark'));
var base=config.palette&&config.palette.mode===mode?config.palette.colors:defaults(mode);
var bg=bgAsked||base.background;
var text=safe(merged.text)||safe(merged.foreground)||(bgAsked===undefined?base.text:(light(bg)>0.58?'#1F2328':'#ECEEF2'));
var accent=safe(merged.accent)||safe(merged.highlight)||base.highlight;
var colours={background:bg,text:text,muted:safe(merged.muted)||mix(text,bg,0.42),grid:safe(merged.grid)||safe(merged.border)||mix(bg,text,0.14),axis:safe(merged.axis)||safe(merged.border)||mix(bg,text,0.38),positive:safe(merged.positive)||base.positive,negative:safe(merged.negative)||safe(merged.danger)||base.negative,neutral:safe(merged.neutral)||mix(bg,text,0.5),highlight:accent,categorical:list(merged.categorical)||cats(accent,6),sequential:list(merged.sequential)||ramp(bg,accent,8),diverging:list(merged.diverging)||divs(bg,mode)};
var fam=merged.font||(tokens&&tokens.font),family=(typeof fam==='string'&&FAMILY.test(fam.trim()))?fam.trim():((isObj(fam)&&typeof fam.family==='string'&&FAMILY.test(fam.family.trim()))?fam.family.trim():((config.palette&&config.palette.font&&config.palette.font.family)||'sans-serif'));
var radius=(typeof merged.radius==='string'&&RADIUS.test(merged.radius.trim()))?merged.radius.trim():(config.palette&&config.palette.radius)||undefined;
return theme({mode:mode,colors:colours,surface:surface||bg,raised:safe(merged.raised)||surface||bg,font:{family:family,size:(config.palette&&config.palette.font&&config.palette.font.size)||12,labelSize:(config.palette&&config.palette.font&&config.palette.font.labelSize)||11},radius:radius})}
function theme(p){var c=p.colors,axis=function(g){return {axisLine:{show:true,lineStyle:{color:c.axis}},axisTick:{show:false,lineStyle:{color:c.axis}},axisLabel:{color:c.muted},splitLine:{show:g,lineStyle:{color:c.grid}},splitArea:{show:false}}};
return {mode:p.mode,colors:c,surface:p.surface,raised:p.raised,font:p.font,radius:p.radius,
echartsTheme:{color:c.categorical.slice(),backgroundColor:p.raised||p.surface,textStyle:{color:c.text,fontFamily:p.font.family},title:{textStyle:{color:c.text,fontFamily:p.font.family},subtextStyle:{color:c.muted}},legend:{textStyle:{color:c.muted,fontFamily:p.font.family}},categoryAxis:axis(false),valueAxis:axis(true),timeAxis:axis(false),logAxis:axis(true),line:{lineStyle:{width:2}},pie:{itemStyle:{borderColor:p.raised||p.surface,borderWidth:1.5}},visualMap:{inRange:{color:c.sequential.slice()}}},
plotTheme:{colors:{background:p.raised||c.background,text:c.text,muted:c.muted,grid:c.grid,axis:c.axis,categorical:c.categorical.slice(),sequential:c.sequential.slice()},font:p.font}}}
function paint(t){var root=doc.documentElement,body=doc.body;
try{root.style.background=t.colors.background;root.style.colorScheme=t.mode;root.setAttribute('data-theme',t.mode);if(body){body.style.background=t.colors.background;body.style.color=t.colors.text}}catch(e){}
var marks=doc.querySelectorAll('[class*="cs-"]'),i;
for(i=0;i<marks.length;i++){try{marks[i].setAttribute('data-theme',t.mode)}catch(e){}}
for(i=0;i<hooks.length;i++){try{hooks[i](t)}catch(e){}}
return t}
function acknowledge(seq){var n={type:'charts.theme.ack',v:1,applied:true};if(typeof seq==='number')n.seq=seq;try{if(win.parent&&win.parent!==win)win.parent.postMessage(n,'*')}catch(e){}}
function apply(input){if(isObj(input)&&typeof input.seq==='number'){if(input.seq<=lastSeq)return undefined;lastSeq=input.seq}
var t=derive(input);if(!t)return undefined;overridden=true;current=t;paint(t);if(isObj(input)&&input.type==='charts.theme')acknowledge(input.seq);return t}
function attach(p){if(p===port)return;if(port){try{port.onmessage=null}catch(e){}}port=p;port.onmessage=function(e){apply(e.data)};try{if(port.start)port.start()}catch(e){}}
function onMessage(e){var src=e.source;if(src&&src!==win&&src!==win.parent)return;var d=e.data;if(!isObj(d))return;
if(d.type==='charts.theme'){apply(d);return}
if(d.kind!=='hello'&&d.kind!=='theme.changed')return;
if(d.kind==='hello'&&e.ports&&e.ports[0])attach(e.ports[0]);
if(d.theme!==undefined)apply(d)}
win.addEventListener('message',onMessage);
var paired=config.paired,mq=(paired&&typeof win.matchMedia==='function')?win.matchMedia('(prefers-color-scheme: dark)'):null;
function fromMedia(){if(overridden||!paired||!mq)return;var m=mq.matches?'dark':'light';var p=paired[m];if(p){var t=theme({mode:m,colors:p.colors,surface:p.surface,raised:p.raised,font:p.font||{family:'sans-serif',size:12,labelSize:11}});current=t;paint(t)}}
if(mq){if(mq.addEventListener)mq.addEventListener('change',fromMedia);else if(mq.addListener)mq.addListener(fromMedia);fromMedia()}
try{if(win.parent&&win.parent!==win)win.parent.postMessage({type:'charts.hello',v:1,capabilities:['theme']},'*')}catch(e){}
return {hooks:hooks,apply:apply,theme:function(){return current},destroy:function(){win.removeEventListener('message',onMessage);if(mq){if(mq.removeEventListener)mq.removeEventListener('change',fromMedia);else if(mq.removeListener)mq.removeListener(fromMedia)}if(port){try{port.onmessage=null}catch(e){}}}}})`
