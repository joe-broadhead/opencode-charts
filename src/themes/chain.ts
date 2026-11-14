import { existsSync, readFileSync, statSync } from "node:fs"
import { ChartsError, suggest } from "../errors.js"
import { ThemeDefinitionOverridesSchema } from "../document/schema.js"
import { confine } from "../paths.js"
import { DEFAULT_HOST_THEME_FILE, MAX_THEME_CHAIN, SEED_KEYS, SEED_COLOR_KEYS, builtinThemes, resolveSeedPair, resolveTheme, resolveThemeMode, savedThemeExists, THEME_NAME, themePath, type ThemeDefinition, type ThemeSources } from "./store.js"
import { normaliseCssColor, type ThemeOverrides, type ThemeTokens } from "./tokens.js"

/**
 * The one way a tool reads saved themes: the whole `extends` chain is walked here, and every saved theme file is asked
 * for (read permission, by the real path that is read: a link is asked as its target) before a byte of it is read.
 * The store then resolves from exactly these approved files and reads nothing itself. Legacy calls, chart documents,
 * charts_themes and charts_theme_save all go through it.
 *
 * The chain holds at most MAX_THEME_CHAIN named themes; a name that comes back is THEME_CYCLE, with the chain.
 */
export type AssertRead = (paths: readonly string[]) => Promise<void>

/** The keys that shape a definition rather than name a token: checked here, not against the token projection. */
const SHAPE_KEYS: ReadonlySet<string> = new Set(["extends", "seed", "variants", "mode"])

/**
 * Checks a theme object the caller passes (a legacy tool's inline `theme`, or charts_theme_save's tokens) against the
 * typed definition projection of the canonical tokens: an unknown or invalid token is THEME_INVALID at its path, before
 * any saved theme is read. Every object the tools accepted before still passes; only its error comes earlier and
 * names the token.
 *
 * The host-friendly shapes are checked at their own paths: a `seed` (the few colours a host knows) and `variants`
 * (a light and a dark definition). The tokens beside them are checked by the same projection as always.
 */
export function checkThemeDefinition(theme: unknown, at = "/theme"): void {
  if (theme !== undefined && theme !== null && typeof theme === "object" && !Array.isArray(theme)) {
    const record = theme as Record<string, unknown>
    if (record.seed !== undefined) checkSeed(record.seed, `${at}/seed`)
    if (record.variants !== undefined) checkVariants(record.variants, `${at}/variants`)
    if (record.mode !== undefined && record.mode !== "light" && record.mode !== "dark") {
      throw new ChartsError("THEME_INVALID", `Theme token ${at}/mode is invalid: ${JSON.stringify(record.mode)}.`, 'Use "light" or "dark".', `${at}/mode`)
    }
    const tokens: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(record)) if (!SHAPE_KEYS.has(key)) tokens[key] = value
    checkTokens(tokens, at)
    return
  }
  checkTokens(theme, at)
}

/** The token projection: the same check the tools have always applied to a theme object. */
function checkTokens(theme: unknown, at: string): void {
  const parsed = ThemeDefinitionOverridesSchema.safeParse(theme)
  if (parsed.success) return
  const issue = parsed.error.issues[0]!
  const path = `${at}${issue.path.map(p => `/${String(p)}`).join("")}`
  if (issue.code === "unrecognized_keys") {
    const key = issue.keys[0]!
    const allowed = Object.keys(tokensAt(issue.path))
    const close = suggest(key, allowed)
    throw new ChartsError("THEME_INVALID", `"${key}" is not a theme token here.`, close.length ? `Did you mean "${close[0]}"? charts_themes shows a complete theme.` : `Use one of: ${allowed.join(", ")}.`, `${path}/${key}`)
  }
  throw new ChartsError("THEME_INVALID", `Theme token ${path} is invalid: ${issue.message}.`, "Fix that token; charts_themes shows a complete theme to copy from.", path)
}

/** Every key an object level of the definition schema allows. */
function tokensAt(path: readonly PropertyKey[]): Record<string, unknown> {
  let schema: unknown = ThemeDefinitionOverridesSchema
  for (const key of path) {
    while (schema && typeof (schema as { unwrap?: unknown }).unwrap === "function") schema = (schema as { unwrap: () => unknown }).unwrap()
    const shape = (schema as { shape?: Record<string, unknown> }).shape
    schema = typeof key === "string" && shape ? shape[key] : (schema as { element?: unknown }).element
  }
  while (schema && typeof (schema as { unwrap?: unknown }).unwrap === "function") schema = (schema as { unwrap: () => unknown }).unwrap()
  return (schema as { shape?: Record<string, unknown> }).shape ?? {}
}

/**
 * A seed: the colours, palette and type a host knows. A colour is checked for its shape here — `#…`, a function such
 * as `rgb(…)` or `oklch(…)`, or a named colour — and the token it derives is checked again by the token schema, so a
 * colour form this release cannot draw is refused where it lands.
 */
const COLOUR_SHAPE = /^(#[0-9a-fA-F]{3,8}|[a-zA-Z][a-zA-Z0-9-]*\([^()]*\)|[a-zA-Z]+)$/

function checkSeed(seed: unknown, at: string): void {
  if (!seed || typeof seed !== "object" || Array.isArray(seed)) {
    throw new ChartsError("THEME_INVALID", `${at} must be an object of seed tokens.`, `Use one of: ${SEED_KEYS.join(", ")}.`, at)
  }
  for (const [key, value] of Object.entries(seed)) {
    if (!SEED_KEYS.includes(key)) {
      const close = suggest(key, SEED_KEYS)
      throw new ChartsError("THEME_INVALID", `"${key}" is not a seed token.`, close.length ? `Did you mean "${close[0]}"?` : `Use one of: ${SEED_KEYS.join(", ")}.`, `${at}/${key}`)
    }
    if (key === "mode" || key === "scheme") {
      if (value !== "light" && value !== "dark") throw new ChartsError("THEME_INVALID", `${at}/${key} must be "light" or "dark".`, 'Use "light" or "dark".', `${at}/${key}`)
      continue
    }
    if (key === "series") {
      if (!Array.isArray(value) || value.length === 0 || value.some(entry => normaliseCssColor(entry) === undefined && (typeof entry !== "string" || !COLOUR_SHAPE.test(entry.trim())))) {
        throw new ChartsError("THEME_INVALID", `${at}/${key} must be a list of colours.`, "Give the palette as an array such as [\"#0F5499\", \"#E3120B\"].", `${at}/${key}`)
      }
      continue
    }
    if (key === "radius") {
      const pixels = typeof value === "number" ? value : typeof value === "string" ? Number.parseFloat(value) : Number.NaN
      if (!Number.isFinite(pixels)) throw new ChartsError("THEME_INVALID", `${at}/${key} must be a number of pixels.`, 'Give a number such as 8, or a value such as "8px".', `${at}/${key}`)
      continue
    }
    if ((SEED_COLOR_KEYS as readonly string[]).includes(key)) {
      if (normaliseCssColor(value) !== undefined || (typeof value === "string" && COLOUR_SHAPE.test(value.trim()))) continue
      throw new ChartsError("THEME_INVALID", `${at}/${key} is not a colour: ${JSON.stringify(value)}.`, 'Give a colour such as "#1A1A18", "rgb(26 26 24)" or "oklch(0.2 0.01 60)".', `${at}/${key}`)
    }
    if (typeof value !== "string" || value.trim() === "") {
      throw new ChartsError("THEME_INVALID", `${at}/${key} must be a name.`, `Give a family name such as "Inter".`, `${at}/${key}`)
    }
  }
}

/** A paired definition: exactly the two polarities, each a theme definition in its own right. */
function checkVariants(variants: unknown, at: string): void {
  if (!variants || typeof variants !== "object" || Array.isArray(variants)) {
    throw new ChartsError("THEME_INVALID", `${at} must be an object with light and dark variants.`, 'Give {"light": {…}, "dark": {…}}.', at)
  }
  for (const [key, variant] of Object.entries(variants)) {
    if (key !== "light" && key !== "dark") throw new ChartsError("THEME_INVALID", `"${key}" is not a theme variant.`, 'Use "light" or "dark".', `${at}/${key}`)
    checkThemeDefinition(variant, `${at}/${key}`)
  }
}

/** The parents a definition names: its own `extends`, and each variant's. */
function parentsOf(definition: unknown): unknown[] {
  if (!definition || typeof definition !== "object" || Array.isArray(definition)) return []
  const record = definition as Record<string, unknown>
  const parents: unknown[] = [record.extends]
  const variants = record.variants
  if (variants && typeof variants === "object" && !Array.isArray(variants)) for (const variant of Object.values(variants as Record<string, unknown>)) parents.push(...parentsOf(variant))
  return parents
}

/** Reads, with permission, every saved theme the theme (a name, or tokens with `extends`) passes through. */
export async function approveThemeChain(sources: ThemeSources, theme: string | ThemeDefinition | undefined, assertRead?: AssertRead): Promise<Map<string, ThemeOverrides | null>> {
  if (theme !== undefined && typeof theme !== "string") checkThemeDefinition(theme)
  const approved = new Map<string, ThemeOverrides | null>()
  const chain: string[] = []
  const queue: string[] = []
  const push = (value: unknown) => {
    if (typeof value === "string" && value.trim() !== "") queue.push(value.trim().toLowerCase())
  }
  if (typeof theme === "string") push(theme)
  else if (theme !== undefined) for (const parent of parentsOf(theme)) push(parent)
  while (queue.length) {
    const next = queue.shift()!
    if (builtinThemes()[next]) continue
    if (chain.includes(next)) throw new ChartsError("THEME_CYCLE", `The theme "${chain[0]}" extends itself: ${[...chain, next].join(" → ")}.`, "Make the last theme of the chain extend a built-in theme (light, dark, high-contrast, print or presentation).")
    if (chain.length >= MAX_THEME_CHAIN) throw new ChartsError("THEME_CYCLE", `The theme "${chain[0]}" passes through more than ${MAX_THEME_CHAIN} named themes: ${[...chain, next].join(" → ")}.`, "Make each saved theme extend a built-in theme or one other theme.")
    chain.push(next)
    let overrides: ThemeDefinition | undefined
    if (THEME_NAME.test(next)) {
      const file = confine(sources.workspace, themePath(next), "write")
      if (savedThemeExists(file, next)) {
        await assertRead?.([file.relative])
        const text = readFileSync(file.absolute, "utf8")
        try { overrides = JSON.parse(text) as ThemeDefinition } catch { throw new ChartsError("THEME_INVALID", `The saved theme "${next}" (${file.relative}) is not valid JSON.`, "Save it again with charts_theme_save.") }
        if (!overrides || typeof overrides !== "object" || Array.isArray(overrides)) throw new ChartsError("THEME_INVALID", `The saved theme "${next}" (${file.relative}) is not a JSON object.`, "Save it again with charts_theme_save.")
      }
      approved.set(next, overrides ?? null)
    }
    overrides ??= sources.configured[next] as ThemeDefinition | undefined
    if (!overrides) continue
    for (const parent of parentsOf(overrides)) push(parent)
  }
  return approved
}

/**
 * The workspace's own theme file, read with permission. It is only touched when the file exists, so a workspace
 * without it pays no permission ask; a folder where it should be is ignored rather than failing every render.
 */
export async function readHostTheme(sources: ThemeSources, assertRead?: AssertRead): Promise<ThemeDefinition | undefined> {
  const file = confine(sources.workspace, DEFAULT_HOST_THEME_FILE, "write")
  if (!existsSync(file.absolute)) return undefined
  let info
  try { info = statSync(file.absolute) } catch { return undefined }
  if (!info.isFile()) return undefined
  await assertRead?.([file.relative])
  let parsed: unknown
  try { parsed = JSON.parse(readFileSync(file.absolute, "utf8")) } catch {
    throw new ChartsError("THEME_INVALID", `The workspace theme (${file.relative}) is not valid JSON.`, `Fix its JSON, or save a theme with charts_theme_save.`)
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new ChartsError("THEME_INVALID", `The workspace theme (${file.relative}) is not a JSON object.`, "Give it theme tokens, a seed, or light and dark variants.")
  checkThemeDefinition(parsed)
  return parsed as ThemeDefinition
}

/** The theme a call resolves: the one it named, or the workspace's own theme file when it named none. */
async function asked(sources: ThemeSources, theme: string | ThemeDefinition | undefined, assertRead?: AssertRead): Promise<ThemeDefinition | string | undefined> {
  if (theme !== undefined) return theme
  return readHostTheme(sources, assertRead)
}

/** Resolves a theme after asking for every saved file its chain reads. */
export async function resolveThemeAsked(sources: ThemeSources, theme: string | ThemeDefinition | undefined, assertRead?: AssertRead): Promise<ThemeTokens> {
  const requested = await asked(sources, theme, assertRead)
  const approved = await approveThemeChain(sources, requested, assertRead)
  return resolveTheme({ ...sources, approved }, requested)
}

/** Both polarities of one theme: what a surface that follows the reader's preference draws. */
export interface ThemePair {
  readonly light: ThemeTokens
  readonly dark: ThemeTokens
}

/**
 * Resolves the active theme and, when the definition carries both polarities (light and dark variants, or a seed), the
 * pair as well. A named theme and a plain token object have no pair: the caller keeps its one theme.
 */
export async function resolveThemePairAsked(sources: ThemeSources, theme: string | ThemeDefinition | undefined, assertRead?: AssertRead): Promise<{ active: ThemeTokens; paired?: ThemePair }> {
  const requested = await asked(sources, theme, assertRead)
  const approved = await approveThemeChain(sources, requested, assertRead)
  const scoped = { ...sources, approved }
  const active = resolveTheme(scoped, requested)
  const definition = requested !== undefined && typeof requested !== "string" ? requested : undefined
  if (!definition) return { active }
  if (definition.variants) {
    // A pair with only one side written derives the other from the same tokens over that polarity's base.
    const pair = { light: resolveThemeMode(scoped, definition, "light"), dark: resolveThemeMode(scoped, definition, "dark") }
    return { active, paired: pair }
  }
  if (definition.seed !== undefined) return { active, paired: resolveSeedPair(scoped, definition) }
  return { active }
}
