import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { ChartsError, suggest } from "../errors.js"
import { confine, ensureDirectory, type Workspace } from "../paths.js"
import { BUILTIN_THEMES as BASE_THEMES, derivePairedTheme, deriveThemeFromSeed, mergeTokens, normaliseThemeColors, parseHostThemeSeed, ThemeTokensSchema, type HostThemeSeed, type ThemeOverrides, type ThemeTokens } from "./tokens.js"

/** Saved themes live in the workspace, so a brand theme is defined once and used by name in every chart. */
export const THEME_DIR = ".charts/themes"
/**
 * The workspace's own theme file. It is read when neither the tool call nor the plugin options name a theme, so a host
 * can drop one file into a repository and every chart follows it. It is never read when nothing named it but the file
 * is absent, so an ordinary workspace pays no permission ask for it.
 */
export const DEFAULT_HOST_THEME_FILE = ".charts/theme.json"
const NAME = /^[a-z0-9][a-z0-9-]{0,47}$/
/** Every built-in theme: the nine built-in palettes. Workspace brand themes live under .charts/themes/. */
export function builtinThemes(): Readonly<Record<string, ThemeTokens>> {
  return BASE_THEMES
}

export interface ThemeSources {
  readonly workspace: Workspace
  /** Themes from the plugin's options (`themes: { name: overrides }`). */
  readonly configured: Readonly<Record<string, ThemeOverrides>>
  /**
   * Saved themes already read by an adapter that asked read permission for each file: by name, the parsed file, or null
   * when there is no file. When set, nothing is read from disk here, and a saved theme outside it is refused.
   */
  readonly approved?: ReadonlyMap<string, ThemeOverrides | null>
}

/** The most named themes (saved or configured) one chain may pass through before a built-in base. */
export const MAX_THEME_CHAIN = 4
export const THEME_NAME = NAME

// ---------------------------------------------------------------------------------------------------------------
// The host-friendly theme shapes: a seed the plugin derives tokens from, and a paired light + dark definition.

/**
 * A seed: the few colours and type choices a host knows, from which a whole token set is derived. Every key is
 * optional, and the pairs below are synonyms (`background`/`surface`/`ground`, `foreground`/`text`, …), so a host can
 * send the words its own design system uses.
 */
export type SeedColorKey =
  | "background" | "surface" | "ground" | "raised"
  | "foreground" | "text"
  | "accent" | "primary"
  | "muted" | "border" | "grid" | "axis"
  | "positive" | "success"
  | "negative" | "danger" | "destructive"
  | "warning" | "neutral" | "highlight"

/** Every colour key a seed may carry. */
export const SEED_COLOR_KEYS: readonly SeedColorKey[] = ["background", "surface", "ground", "raised", "foreground", "text", "accent", "primary", "muted", "border", "grid", "axis", "positive", "success", "negative", "danger", "destructive", "warning", "neutral", "highlight"]

/** Every key a seed may carry: the colours, a palette, the two families, a mode hint and a corner radius. */
export const SEED_KEYS: readonly string[] = [...SEED_COLOR_KEYS, "series", "font", "mono", "radius", "mode", "scheme"]

export type ThemeSeed = HostThemeSeed

/** A theme object that may carry a seed, on top of the tokens the tools have always accepted. */
export type ThemeVariant = ThemeOverrides & { readonly seed?: ThemeSeed }

/** A paired definition: two variants of one theme, for a viewer that follows the reader's light or dark preference. */
export type ThemeDefinition = ThemeVariant & {
  readonly variants?: { readonly light?: ThemeVariant; readonly dark?: ThemeVariant }
}

export interface SeedDeriveOptions {
  readonly name?: string
  readonly description?: string
  /** The tokens the seed sits on: the definition's `extends` (or its `mode`), or a built-in base. */
  readonly base?: ThemeTokens
}

/** Turns a seed into a complete token set over `base`. `src/themes/seed.ts` provides the full synthesis. */
export type SeedDeriver = (seed: Record<string, unknown>, options?: SeedDeriveOptions) => ThemeTokens

/** Both polarities of one seed, so a paired derivation (and its colour-vision checks) runs once. */
export interface SeedPairBases {
  readonly light: ThemeTokens
  readonly dark: ThemeTokens
  readonly name?: string
  readonly description?: string
}

export type PairedSeedDeriver = (seed: Record<string, unknown>, bases: SeedPairBases) => { light: ThemeTokens; dark: ThemeTokens }

/**
 * The default OKLCH + CVD seed synthesiser: fills any omitted ground/ink/accent from `base`, then derives hue-locked
 * hairlines, contrast-checked muted ink, an 8-slot CVD-safe categorical ring and background-anchored ramps.
 */
function oklchSeedDeriver(seed: Record<string, unknown>, options: SeedDeriveOptions = {}): ThemeTokens {
  const base = options.base ?? builtinThemes().light!
  const hasGround = seed.background !== undefined || seed.surface !== undefined || seed.ground !== undefined
  const hasInk = seed.foreground !== undefined || seed.text !== undefined
  const complete: Record<string, unknown> = {
    ...(hasGround ? {} : { background: base.colors.background }),
    ...(hasInk ? {} : { foreground: base.colors.text }),
    ...seed,
  }
  const parsed = parseHostThemeSeed(complete)
  return deriveThemeFromSeed(parsed, { ...(options.name !== undefined ? { name: options.name } : {}), ...(options.description !== undefined ? { description: options.description } : {}), base })
}

function oklchPairedDeriver(seed: Record<string, unknown>, bases: SeedPairBases): { light: ThemeTokens; dark: ThemeTokens } {
  const hasGround = seed.background !== undefined || seed.surface !== undefined || seed.ground !== undefined
  const options = { ...(bases.name !== undefined ? { name: bases.name } : {}), ...(bases.description !== undefined ? { description: bases.description } : {}) }
  if (!hasGround) {
    return {
      light: oklchSeedDeriver(seed, { ...options, base: bases.light }),
      dark: oklchSeedDeriver(seed, { ...options, base: bases.dark }),
    }
  }
  const hasInk = seed.foreground !== undefined || seed.text !== undefined
  const complete: Record<string, unknown> = {
    ...(hasInk ? {} : { foreground: bases.light.colors.text }),
    ...seed,
  }
  const parsed = parseHostThemeSeed(complete)
  const paired = derivePairedTheme({ seed: parsed, ...(bases.name !== undefined ? { name: bases.name } : {}) })
  return { light: paired.light, dark: paired.dark }
}

const derive: SeedDeriver = oklchSeedDeriver
const derivePair: PairedSeedDeriver | undefined = oklchPairedDeriver

/**
 * One polarity of a seed: the installed deriver runs over `base`, and the result is merged onto the base so a partial
 * derivation still makes a complete theme.
 */
export function deriveSeedTokens(seed: Record<string, unknown>, options: SeedDeriveOptions = {}): ThemeTokens {
  const base = options.base ?? builtinThemes().light!
  const derived = derive(seed, { ...options, base })
  const merged = mergeTokens(base, derived as ThemeOverrides)
  merged.name = options.name ?? derived.name ?? `${base.name}-custom`
  merged.mode = derived.mode ?? base.mode
  if (options.description !== undefined) merged.description = options.description
  else if (derived.description === undefined) delete merged.description
  return merged
}

/** Both polarities of a seed, from the paired deriver when one is installed, or derived twice over the two bases. */
export function deriveSeedPair(seed: Record<string, unknown>, bases: SeedPairBases): { light: ThemeTokens; dark: ThemeTokens } {
  if (derivePair) return derivePair(seed, bases)
  const options = { ...(bases.name !== undefined ? { name: bases.name } : {}), ...(bases.description !== undefined ? { description: bases.description } : {}) }
  return { light: deriveSeedTokens(seed, { ...options, base: bases.light }), dark: deriveSeedTokens(seed, { ...options, base: bases.dark }) }
}

// ---------------------------------------------------------------------------------------------------------------
// Reading saved themes.

function savedFile(sources: ThemeSources, name: string) {
  return confine(sources.workspace, `${THEME_DIR}/${name}.json`, "write")
}

/**
 * Whether a saved theme's file exists. The path is confined for writing (a theme may not exist yet), so it is not
 * checked to be a file: a folder (or a device) where the theme's file goes is NOT_A_FILE here, not a raw EISDIR later.
 */
export function savedThemeExists(file: { readonly absolute: string; readonly relative: string }, name: string): boolean {
  if (!existsSync(file.absolute)) return false
  if (!statSync(file.absolute).isFile()) throw new ChartsError("NOT_A_FILE", `The saved theme "${name}" (${file.relative}) is not a regular file: there is a folder or a device where its file goes.`, `Move or remove ${file.relative}, then save the theme again with charts_theme_save (or use another name).`)
  return true
}

function readSaved(sources: ThemeSources, name: string): ThemeDefinition | undefined {
  if (sources.approved) {
    if (!sources.approved.has(name)) throw new ChartsError("THEME_INVALID", `The saved theme "${name}" was not read with permission.`, "Name the theme again so it is resolved with its whole extends chain.")
    return sources.approved.get(name) ?? undefined
  }
  const file = savedFile(sources, name)
  if (!savedThemeExists(file, name)) return undefined
  try { return JSON.parse(readFileSync(file.absolute, "utf8")) as ThemeDefinition }
  catch { throw new ChartsError("THEME_INVALID", `The saved theme "${name}" (${file.relative}) is not valid JSON.`, "Save it again with charts_theme_save.") }
}

export function savedThemeNames(sources: ThemeSources): string[] {
  const names = new Set(Object.keys(sources.configured))
  try {
    const dir = confine(sources.workspace, THEME_DIR, "write").absolute
    if (existsSync(dir)) for (const file of readdirSync(dir, { withFileTypes: true })) if (file.isFile() && file.name.endsWith(".json") && NAME.test(file.name.slice(0, -5))) names.add(file.name.slice(0, -5))
  } catch { /* no saved themes */ }
  return [...names].sort()
}

// ---------------------------------------------------------------------------------------------------------------
// Resolving.

/** The keys that shape a definition rather than name a token. */
const SHAPE_KEYS: ReadonlySet<string> = new Set(["extends", "seed", "variants", "mode"])

/** The token overrides of a definition: everything but its shape keys, so a seed or a pair never leaks into the tokens. */
function explicitTokens(definition: ThemeDefinition): ThemeOverrides {
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(definition)) if (value !== undefined && !SHAPE_KEYS.has(key)) out[key] = value
  return out as ThemeOverrides
}

/** The tokens a definition sits on: its `extends`, else its `mode`, else the polarity the caller asked for. */
function baseTokens(sources: ThemeSources, definition: ThemeDefinition, mode: "light" | "dark", depth: number): ThemeTokens {
  const parent = definition.extends !== undefined ? (definition.extends ?? "light") : (definition.mode ?? mode)
  return resolveTheme(sources, parent, depth + 1)
}

/** The variant a paired definition uses at one polarity. */
function variantFor(definition: ThemeDefinition, mode: "light" | "dark"): ThemeVariant | undefined {
  if (!definition.variants) return undefined
  return mode === "dark" ? (definition.variants.dark ?? definition.variants.light) : (definition.variants.light ?? definition.variants.dark)
}

/** One polarity of an object definition: its variant or its seed, then any explicit tokens on top. */
function resolveDefinition(sources: ThemeSources, definition: ThemeDefinition, mode: "light" | "dark", depth: number): ThemeTokens {
  const base = baseTokens(sources, definition, mode, depth)
  const variant = variantFor(definition, mode)
  let tokens: ThemeTokens
  if (variant !== undefined) tokens = resolveVariant(sources, variant, mode, depth)
  else if (definition.seed !== undefined) tokens = deriveSeedTokens(definition.seed as Record<string, unknown>, { ...(definition.name !== undefined ? { name: definition.name } : {}), ...(definition.description !== undefined ? { description: definition.description } : {}), base })
  else tokens = base
  const merged = mergeTokens(tokens, explicitTokens(definition))
  if (!definition.name) merged.name = `${base.name}-custom`
  return validate(merged)
}

/** A variant sits on the built-in base of its own polarity unless it names its own parent. */
function resolveVariant(sources: ThemeSources, variant: ThemeVariant, mode: "light" | "dark", depth: number): ThemeTokens {
  if (variant.extends === undefined) return resolveTheme(sources, { ...variant, extends: mode }, depth + 1)
  return resolveTheme(sources, variant, depth + 1)
}

/**
 * Both polarities of a seed definition, so a paired derivation runs once. The seed sits on the definition's parent at
 * each polarity, and the explicit tokens apply to both.
 */
export function resolveSeedPair(sources: ThemeSources, definition: ThemeDefinition, depth = 0): { light: ThemeTokens; dark: ThemeTokens } {
  const seed = definition.seed
  if (seed === undefined) throw new ChartsError("THEME_INVALID", "A seed pair needs a seed.", "Give the theme a seed, or light and dark variants.", "/theme/seed")
  const lightBase = baseTokens(sources, definition, "light", depth)
  const darkBase = baseTokens(sources, definition, "dark", depth)
  const pair = deriveSeedPair(seed as Record<string, unknown>, { light: lightBase, dark: darkBase, ...(definition.name !== undefined ? { name: definition.name } : {}), ...(definition.description !== undefined ? { description: definition.description } : {}) })
  const explicit = explicitTokens(definition)
  const finish = (tokens: ThemeTokens, mode: "light" | "dark"): ThemeTokens => {
    const merged = mergeTokens(tokens, explicit)
    merged.mode = tokens.mode ?? mode
    if (!definition.name) merged.name = `${lightBase.name}-custom`
    return validate(merged)
  }
  return { light: finish(pair.light, "light"), dark: finish(pair.dark, "dark") }
}

/**
 * A theme by name (built-in, saved in the workspace, or from the plugin's options) or a definition over a base: tokens,
 * a seed, or a paired light + dark definition. Workspace themes win over configured ones, which win over built-ins,
 * except that built-in names cannot be shadowed.
 */
export function resolveTheme(sources: ThemeSources, theme: string | ThemeDefinition | undefined, depth = 0): ThemeTokens {
  const BUILTIN_THEMES = builtinThemes()
  // Each named theme costs two steps: its name, then its tokens over its base.
  if (depth > MAX_THEME_CHAIN * 2) throw new ChartsError("THEME_CYCLE", "A theme extends itself through too many steps.", "Make each saved theme extend a built-in theme or one other theme.")
  if (theme === undefined) return BUILTIN_THEMES.light!
  if (typeof theme === "string") {
    const name = theme.trim().toLowerCase()
    if (BUILTIN_THEMES[name]) return BUILTIN_THEMES[name]!
    const saved = (NAME.test(name) ? readSaved(sources, name) : undefined) ?? sources.configured[name]
    if (!saved) {
      const all = [...Object.keys(BUILTIN_THEMES), ...savedThemeNames(sources)]
      const close = suggest(name, all)
      throw new ChartsError("THEME_NOT_FOUND", `There is no theme "${theme}".${close.length ? ` Did you mean ${close.map(n => `"${n}"`).join(" or ")}?` : ""}`, `Use one of: ${all.join(", ")}; or pass tokens with "extends".`)
    }
    return validate(resolveTheme(sources, { ...saved, name }, depth + 1))
  }
  return resolveDefinition(sources, theme, theme.mode ?? "light", depth)
}

/** A definition resolved at one polarity, whether or not it names one: what a paired surface reads. */
export function resolveThemeMode(sources: ThemeSources, theme: string | ThemeDefinition | undefined, mode: "light" | "dark", depth = 0): ThemeTokens {
  if (theme === undefined || typeof theme === "string") return resolveTheme(sources, theme, depth)
  return resolveDefinition(sources, theme, mode, depth)
}

const LEGACY_COLOUR = /^(#[0-9a-fA-F]{3,8}|rgba?\([\d\s.,%]+\)|transparent)$/

function normaliseModernColours(tokens: ThemeTokens): ThemeTokens {
  const one = (value: string) => {
    if (LEGACY_COLOUR.test(value.trim())) return value.trim()
    try {
      return normaliseThemeColors({ ...tokens, colors: { ...tokens.colors, background: value } }).colors.background
    } catch {
      // A value the colour parser cannot read is left exactly as it arrived, so the token schema refuses it below and
      // the caller is told which token is wrong. The schema's grammar is the closed one, so nothing unsafe passes.
      return value
    }
  }
  const many = (values: readonly string[]) => values.map(one)
  return {
    ...tokens,
    colors: {
      background: one(tokens.colors.background),
      text: one(tokens.colors.text),
      muted: one(tokens.colors.muted),
      grid: one(tokens.colors.grid),
      axis: one(tokens.colors.axis),
      categorical: many(tokens.colors.categorical),
      sequential: many(tokens.colors.sequential),
      diverging: many(tokens.colors.diverging),
      positive: one(tokens.colors.positive),
      negative: one(tokens.colors.negative),
      neutral: one(tokens.colors.neutral),
      highlight: one(tokens.colors.highlight),
    },
  }
}

function validate(tokens: ThemeTokens): ThemeTokens {
  const normalised = normaliseModernColours(tokens)
  const parsed = ThemeTokensSchema.safeParse(normalised)
  if (!parsed.success) {
    const first = parsed.error.issues[0]!
    throw new ChartsError("THEME_INVALID", `Theme token /${first.path.join("/")} is invalid: ${first.message}.`, "Fix that token; charts_themes shows a complete theme to copy from.", `/theme/${first.path.join("/")}`)
  }
  return parsed.data
}

/** Saves tokens (or a seed or a pair) as a named workspace theme, after checking that they resolve. */
export function saveTheme(sources: ThemeSources, name: string, overrides: ThemeDefinition) {
  const BUILTIN_THEMES = builtinThemes()
  if (!NAME.test(name)) throw new ChartsError("THEME_NAME_INVALID", `"${name}" is not a theme name.`, "Use lowercase letters, digits and dashes, such as acme-brand.")
  if (BUILTIN_THEMES[name]) throw new ChartsError("THEME_NAME_TAKEN", `"${name}" is a built-in theme.`, "Pick another name, and set extends to it to start from it.")
  const resolved = resolveTheme(sources, { ...overrides, name })
  ensureDirectory(sources.workspace, THEME_DIR)
  const file = savedFile(sources, name)
  savedThemeExists(file, name)
  writeFileSync(file.absolute, JSON.stringify({ ...overrides, name }, null, 2) + "\n")
  return { file: file.relative, theme: resolved }
}

export const themePath = (name: string) => join(THEME_DIR, `${name}.json`)
