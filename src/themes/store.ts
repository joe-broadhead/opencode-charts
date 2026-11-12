import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { ChartsError, suggest } from "../errors.js"
import { confine, ensureDirectory, type Workspace } from "../paths.js"
import { BUILTIN_THEMES as BASE_THEMES, ThemeTokensSchema, mergeTokens, type ThemeOverrides, type ThemeTokens } from "./tokens.js"

/** Saved themes live in the workspace, so a brand theme is defined once and used by name in every chart. */
export const THEME_DIR = ".charts/themes"
const NAME = /^[a-z0-9][a-z0-9-]{0,47}$/
/** Every built-in theme: the five general ones. Brand themes are saved in a workspace, never built in. */
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

function readSaved(sources: ThemeSources, name: string): ThemeOverrides | undefined {
  if (sources.approved) {
    if (!sources.approved.has(name)) throw new ChartsError("THEME_INVALID", `The saved theme "${name}" was not read with permission.`, "Name the theme again so it is resolved with its whole extends chain.")
    return sources.approved.get(name) ?? undefined
  }
  const file = savedFile(sources, name)
  if (!savedThemeExists(file, name)) return undefined
  try { return JSON.parse(readFileSync(file.absolute, "utf8")) as ThemeOverrides }
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

/**
 * A theme by name (built-in, saved in the workspace, or from the plugin's options) or tokens over a base. Workspace
 * themes win over configured ones, which win over built-ins, except that built-in names cannot be shadowed.
 */
export function resolveTheme(sources: ThemeSources, theme: string | ThemeOverrides | undefined, depth = 0): ThemeTokens {
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
  const base = resolveTheme(sources, theme.extends ?? "light", depth + 1)
  const merged = mergeTokens(base, theme)
  if (!theme.name) merged.name = `${base.name}-custom`
  return validate(merged)
}

function validate(tokens: ThemeTokens): ThemeTokens {
  const parsed = ThemeTokensSchema.safeParse(tokens)
  if (!parsed.success) {
    const first = parsed.error.issues[0]!
    throw new ChartsError("THEME_INVALID", `Theme token /${first.path.join("/")} is invalid: ${first.message}.`, "Fix that token; charts_themes shows a complete theme to copy from.", `/theme/${first.path.join("/")}`)
  }
  return parsed.data
}

/** Saves tokens as a named workspace theme, after checking that they resolve. */
export function saveTheme(sources: ThemeSources, name: string, overrides: ThemeOverrides) {
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
