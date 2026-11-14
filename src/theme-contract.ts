/**
 * The theme bridge: one RPC contract and two pure readers that turn the colours a host already shows into a chart
 * seed. The terminal UI, the Web and Desktop UI and the server share this module, so the schema is declared once.
 *
 * Nothing here touches the file system, the clock or the network, and the fingerprint is a plain FNV-1a over the
 * seed's tokens: the same theme gives the same revision in a terminal, in a browser and on the server.
 */
import { Rpc } from "@opencode/plugin/rpc"

/** The contract's id, as a contribution under the plugin's own id. */
export const THEME_RPC_ID = "charts.theme"

/** A chart mode, the one thing both hosts agree on. */
export type ThemeMode = "light" | "dark"

/** The colours a chart draws from. Every value is a clean `#rrggbb`, so a consumer needs no colour parser. */
export interface ThemeSeed {
  readonly background?: string
  readonly surface?: string
  readonly text?: string
  readonly muted?: string
  readonly border?: string
  readonly accent?: string
  readonly series?: readonly string[]
}

/** What a reader produced: the mode, the tokens and a fingerprint that changes only with the tokens. */
export interface ThemeSeedResult {
  readonly mode: ThemeMode
  readonly seed: Record<string, unknown>
  readonly revision: string
}

const string = { type: "string" } as const
const boolean = { type: "boolean" } as const
const modeSchema = { enum: ["light", "dark"] } as const
/** A synced theme is a name or the theme object itself, exactly as the store resolves it. */
const themeValue = { type: ["string", "object"] } as const
/** What a failed method returns: the typed code and its one next step, as every other Charts refusal does. */
const refusalSchema = { type: "object", required: ["code", "next"], properties: { code: string, next: string }, additionalProperties: false } as const

/** The payload every surface sends: the mode, the seed nested under `theme`, and its revision. */
export interface ThemeSyncPayload {
  readonly mode: ThemeMode
  readonly theme: { readonly seed: Record<string, unknown> }
  readonly revision: string
}

/**
 * The contract's id, re-exported beside the contract itself: `charts.theme`.
 *
 * `sync` reports the active host theme, `get` reads the last one the server saw, `clear` forgets it, and `changed`
 * tells a subscriber when a host pushed a new revision. Every object is closed (`additionalProperties: false`), so a
 * host and the server agree on exactly what travels, and a field added on one side is a refusal on the other rather
 * than something silently dropped.
 */
export const ChartsThemeContract = Rpc.define({
  id: THEME_RPC_ID,
  methods: {
    sync: {
      input: {
        type: "object",
        required: ["theme"],
        properties: { sessionID: string, mode: modeSchema, theme: themeValue, revision: string },
        additionalProperties: false,
      },
      output: {
        type: "object",
        required: ["ok", "applied", "revision", "mode", "themeName"],
        properties: { ok: boolean, applied: boolean, revision: string, mode: modeSchema, themeName: string },
        additionalProperties: false,
      },
      errors: { refused: refusalSchema },
    },
    get: {
      input: { type: "object", properties: { sessionID: string }, additionalProperties: false },
      output: {
        type: "object",
        required: ["found", "revision", "theme"],
        properties: {
          found: boolean,
          revision: { type: ["string", "null"] },
          mode: modeSchema,
          themeName: string,
          theme: {
            type: ["object", "null"],
            required: ["theme", "mode", "revision"],
            properties: { theme: themeValue, mode: modeSchema, revision: string, sessionID: string },
            additionalProperties: false,
          },
        },
        additionalProperties: false,
      },
    },
    clear: {
      input: { type: "object", properties: { sessionID: string }, additionalProperties: false },
      output: { type: "object", required: ["cleared"], properties: { cleared: boolean }, additionalProperties: false },
    },
  },
  events: {
    /** The theme in force changed: the same revision a `sync` returned, so a viewer can ignore its own echo. */
    changed: {
      schema: {
        type: "object",
        required: ["revision", "mode", "themeName"],
        properties: { revision: string, mode: modeSchema, themeName: string, sessionID: string },
        additionalProperties: false,
      },
    },
  },
})

/** The contract's type, so a caller can name it without importing the value. */
export type ChartsThemeRpc = typeof ChartsThemeContract

/* ------------------------------------------------------------------------------------------------------ colours */

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null

const clamp = (value: number, minimum: number, maximum: number): number => Math.min(maximum, Math.max(minimum, value))

const channel = (value: number): string => clamp(Math.round(value), 0, 255).toString(16).padStart(2, "0")

function fromRgb(red: number, green: number, blue: number): string | undefined {
  if (![red, green, blue].every(Number.isFinite)) return undefined
  return `#${channel(red)}${channel(green)}${channel(blue)}`
}

function fromHsl(hue: number, saturation: number, lightness: number): string | undefined {
  if (![hue, saturation, lightness].every(Number.isFinite)) return undefined
  const turn = ((hue % 360) + 360) % 360
  const chroma = (1 - Math.abs((2 * clamp(lightness, 0, 100)) / 100 - 1)) * (clamp(saturation, 0, 100) / 100)
  const second = chroma * (1 - Math.abs(((turn / 60) % 2) - 1))
  const offset = clamp(lightness, 0, 100) / 100 - chroma / 2
  const rgb: readonly [number, number, number] =
    turn < 60 ? [chroma, second, 0] : turn < 120 ? [second, chroma, 0] : turn < 180 ? [0, chroma, second] : turn < 240 ? [0, second, chroma] : turn < 300 ? [second, 0, chroma] : [chroma, 0, second]
  return fromRgb((rgb[0] + offset) * 255, (rgb[1] + offset) * 255, (rgb[2] + offset) * 255)
}

function splitArguments(value: string): string[] {
  return value
    .split(/[\s,/]+/)
    .map(part => part.trim())
    .filter(Boolean)
}

function fromString(raw: string): string | undefined {
  const value = raw.trim().toLowerCase()
  if (!value) return undefined
  const hex = /^#([0-9a-f]{3,8})$/.exec(value)
  if (hex) {
    const digits = hex[1]!
    if (digits.length === 3 || digits.length === 4) return `#${digits[0]!}${digits[0]!}${digits[1]!}${digits[1]!}${digits[2]!}${digits[2]!}`
    if (digits.length === 6 || digits.length === 8) return `#${digits.slice(0, 6)}`
    return undefined
  }
  const rgb = /^rgba?\(([^)]*)\)$/.exec(value)
  if (rgb) {
    const parts = splitArguments(rgb[1]!)
    if (parts.length < 3) return undefined
    const values = parts.slice(0, 3).map(part => (part.endsWith("%") ? (Number.parseFloat(part) / 100) * 255 : Number.parseFloat(part)))
    return fromRgb(values[0]!, values[1]!, values[2]!)
  }
  const hsl = /^hsla?\(([^)]*)\)$/.exec(value)
  if (hsl) {
    const parts = splitArguments(hsl[1]!)
    if (parts.length < 3) return undefined
    return fromHsl(Number.parseFloat(parts[0]!), Number.parseFloat(parts[1]!), Number.parseFloat(parts[2]!))
  }
  return undefined
}

function fromObject(value: Record<string, unknown>): string | undefined {
  // A colour class may print itself as hex, as the TUI's RGBA wrapper can.
  const toHex = value.toHex
  if (typeof toHex === "function") {
    try {
      const printed = toHex.call(value)
      if (typeof printed === "string") {
        const hex = fromString(printed)
        if (hex) return hex
      }
    } catch {
      // Fall through to the channels a bare object carries.
    }
  }
  const toInts = value.toInts
  if (typeof toInts === "function") {
    try {
      const ints = toInts.call(value)
      if (Array.isArray(ints) && ints.length >= 3) {
        const rgb = fromRgb(Number(ints[0]), Number(ints[1]), Number(ints[2]))
        if (rgb) return rgb
      }
    } catch {
      // Fall through to the named channels.
    }
  }
  const red = value.r
  const green = value.g
  const blue = value.b
  if (typeof red === "number" && typeof green === "number" && typeof blue === "number") {
    // A float in 0..1 is a unit-scaled channel; an integer is an 8-bit one, which is what the TUI's colours carry.
    const unit = [red, green, blue].every(part => part >= 0 && part <= 1) && [red, green, blue].some(part => !Number.isInteger(part))
    return fromRgb(unit ? red * 255 : red, unit ? green * 255 : green, unit ? blue * 255 : blue)
  }
  return undefined
}

/** Any colour a host hands over, as `#rrggbb`: a hex string, `rgb()`/`hsl()`, an RGBA object or a `.toHex()` class. */
export function toHexColor(value: unknown): string | undefined {
  if (typeof value === "string") return fromString(value)
  if (isRecord(value)) return fromObject(value)
  return undefined
}

/** How light a `#rrggbb` colour is, so a reader can name the mode when the host does not. */
export function colorLuminance(hex: string): number {
  const read = (offset: number): number => {
    const value = Number.parseInt(hex.slice(offset, offset + 2), 16) / 255
    if (!Number.isFinite(value)) return 0
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * read(1) + 0.7152 * read(3) + 0.0722 * read(5)
}

/* ---------------------------------------------------------------------------------------------------- revisions */

/** FNV-1a: a small, allocation-free 32-bit hash, so the browser half needs no crypto module. */
function fnv1a(value: string, seed: number): string {
  let state = seed >>> 0
  for (let index = 0; index < value.length; index++) {
    state ^= value.charCodeAt(index)
    state = Math.imul(state, 0x01000193) >>> 0
  }
  return state.toString(16).padStart(8, "0")
}

/** The revision of a mode and a seed: two independently seeded hashes, over a fixed field order. */
export function themeRevision(mode: ThemeMode, seed: Record<string, unknown>): string {
  const series = Array.isArray(seed.series) ? seed.series.map(token => String(token)) : []
  const canonical = [mode, seed.background, seed.surface, seed.text, seed.muted, seed.border, seed.accent, ...series].map(token => (typeof token === "string" ? token : "")).join("\n")
  return `${fnv1a(canonical, 0x811c9dc5)}${fnv1a(canonical, 0x9e3779b9)}`
}

function seedResult(tokens: ThemeSeed, modeHint?: ThemeMode): ThemeSeedResult | undefined {
  const seed: Record<string, unknown> = {}
  for (const key of ["background", "surface", "text", "muted", "border", "accent"] as const) {
    const value = tokens[key]
    if (value) seed[key] = value
  }
  if (tokens.series?.length) seed.series = [...tokens.series]
  if (Object.keys(seed).length === 0) return undefined
  const mode = modeHint ?? (typeof tokens.background === "string" ? (colorLuminance(tokens.background) > 0.45 ? "light" : "dark") : "dark")
  return { mode, seed, revision: themeRevision(mode, seed) }
}

/* ---------------------------------------------------------------------------------------------------- the hosts */

/** Reads a nested member without trusting any level of the object. */
function member(value: unknown, ...path: readonly string[]): unknown {
  let cursor: unknown = value
  for (const key of path) {
    if (!isRecord(cursor)) return undefined
    cursor = cursor[key]
  }
  return cursor
}

/** The step a hue scale reads best at for a chart series: dark enough for a light page, bright enough for a dark one. */
function hueStep(value: unknown): string | undefined {
  return toHexColor(member(value, "600")) ?? toHexColor(member(value, "500")) ?? toHexColor(member(value, "400")) ?? toHexColor(member(value, "base"))
}

/**
 * The seed of an OpenCode TUI `ResolvedTheme`: duck-typed, so the module carries no host theme import, and safe on a
 * theme that is missing a token. Returns undefined when the theme carries nothing a chart can use.
 */
export function extractTuiThemeSeed(theme: unknown, mode?: ThemeMode): ThemeSeedResult | undefined {
  if (!isRecord(theme)) return undefined
  const categorical = Array.isArray(theme.categorical) ? theme.categorical : []
  const series = categorical
    .map(entry => hueStep(entry))
    .filter((color): color is string => typeof color === "string")
    .slice(0, 6)
  const tokens: ThemeSeed = {
    background: toHexColor(member(theme, "background", "base")),
    surface: toHexColor(member(theme, "background", "raised", "base")),
    text: toHexColor(member(theme, "text", "base")),
    muted: toHexColor(member(theme, "text", "muted")),
    border: toHexColor(member(theme, "border", "base")),
    accent: hueStep(member(theme, "hue", "accent")) ?? hueStep(member(theme, "hue", "interactive")) ?? series[0],
    series,
  }
  return seedResult(tokens, mode)
}

/** A computed style: what a browser's `getComputedStyle` returns, narrowed to the members a reader uses. */
export interface ThemeStyleReader {
  getPropertyValue?(name: string): string
  readonly backgroundColor?: string
  readonly color?: string
}

/** A host document: the members a reader needs, so this module compiles without the DOM library. */
export interface ThemeHostDocument {
  readonly documentElement?: unknown
  readonly defaultView?: { getComputedStyle?(element: unknown): ThemeStyleReader | null | undefined } | null
}

/** The CSS custom properties each role reads, most specific host first. */
const BACKGROUND_VARIABLES = ["--v2-background-bg-base", "--background", "--surface-page", "--viz-ground"] as const
const SURFACE_VARIABLES = ["--v2-background-bg-raised-base", "--v2-background-bg-raised", "--card", "--muted", "--surface-raised", "--secondary"] as const
const TEXT_VARIABLES = ["--v2-text-text-base", "--foreground", "--viz-ink", "--text"] as const
const MUTED_VARIABLES = ["--v2-text-text-muted", "--muted-foreground", "--viz-muted", "--text-muted"] as const
const BORDER_VARIABLES = ["--v2-border-border-base", "--border", "--viz-grid", "--input"] as const
const ACCENT_VARIABLES = ["--v2-icon-icon-accent-base", "--v2-text-text-accent", "--primary", "--accent", "--ring", "--viz-accent"] as const
const SERIES_VARIABLES = ["--chart-1", "--chart-2", "--chart-3", "--chart-4", "--chart-5", "--chart-6"] as const
const VIZ_VARIABLES = ["--viz-1", "--viz-2", "--viz-3", "--viz-4", "--viz-5", "--viz-6"] as const

function computedStyle(doc: ThemeHostDocument): ThemeStyleReader | undefined {
  const element = doc.documentElement
  if (!element) return undefined
  const view = doc.defaultView
  if (view && typeof view.getComputedStyle === "function") {
    try {
      return view.getComputedStyle(element) ?? undefined
    } catch {
      return undefined
    }
  }
  const scope = globalThis as { getComputedStyle?: (element: unknown) => ThemeStyleReader | null | undefined }
  if (typeof scope.getComputedStyle === "function") {
    try {
      return scope.getComputedStyle(element) ?? undefined
    } catch {
      return undefined
    }
  }
  return undefined
}

/**
 * The seed of the colours a host page already shows: OpenCode's Web and Desktop variables, a shadcn/Tailwind theme,
 * a page's own `--surface-page`/`--viz-*` tokens, or the computed background and text. Returns undefined when the
 * document is unavailable or carries nothing a chart can use.
 */
export function extractDomThemeSeed(doc: ThemeHostDocument | undefined, modeHint?: ThemeMode): ThemeSeedResult | undefined {
  if (!doc) return undefined
  const style = computedStyle(doc)
  if (!style) return undefined
  const read = (name: string): string | undefined => {
    try {
      const raw = typeof style.getPropertyValue === "function" ? style.getPropertyValue(name) : undefined
      return typeof raw === "string" && raw.trim() !== "" ? raw : undefined
    } catch {
      return undefined
    }
  }
  const first = (names: readonly string[]): string | undefined => {
    for (const name of names) {
      const color = toHexColor(read(name))
      if (color) return color
    }
    return undefined
  }
  const collection = (names: readonly string[]): string[] =>
    names
      .map(name => toHexColor(read(name)))
      .filter((color): color is string => typeof color === "string")
      .slice(0, 6)
  const charts = collection(SERIES_VARIABLES)
  const tokens: ThemeSeed = {
    background: first(BACKGROUND_VARIABLES) ?? toHexColor(style.backgroundColor),
    surface: first(SURFACE_VARIABLES),
    text: first(TEXT_VARIABLES) ?? toHexColor(style.color),
    muted: first(MUTED_VARIABLES),
    border: first(BORDER_VARIABLES),
    accent: first(ACCENT_VARIABLES),
    series: charts.length ? charts : collection(VIZ_VARIABLES),
  }
  return seedResult(tokens, modeHint)
}

/* ----------------------------------------------------------------------------------------------------- the TUI */

/** The ANSI colours the terminal renderer paints series with, in its own colour order. */
const ANSI_SERIES: Readonly<Record<number, number>> = { 31: 5, 32: 3, 33: 2, 34: 4, 35: 1, 36: 0, 95: 7, 96: 6 }

/**
 * Repaints a terminal chart's ANSI colour codes with the host theme's seed colours, so a chart block matches the
 * terminal around it. A code the seed has no colour for is left exactly as it was.
 */
export function applyTuiAnsiTheme(text: string, seed: Record<string, unknown>): string {
  if (!text.includes("\u001b[")) return text
  const series = Array.isArray(seed.series) ? seed.series.filter((color): color is string => typeof color === "string") : []
  const accent = typeof seed.accent === "string" ? seed.accent : undefined
  const repaint = (code: number): string | undefined => {
    const index = ANSI_SERIES[code]
    if (index === undefined) return undefined
    const hex = series[index] ?? accent
    if (!hex) return undefined
    const red = Number.parseInt(hex.slice(1, 3), 16)
    const green = Number.parseInt(hex.slice(3, 5), 16)
    const blue = Number.parseInt(hex.slice(5, 7), 16)
    if (![red, green, blue].every(Number.isFinite)) return undefined
    return `\u001b[38;2;${red};${green};${blue}m`
  }
  return text.replace(/\u001b\[(\d+)m/g, (match, digits: string) => repaint(Number(digits)) ?? match)
}
