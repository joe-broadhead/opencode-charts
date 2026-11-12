import { existsSync, readFileSync } from "node:fs"
import { ChartsError } from "../errors.js"
import { confine } from "../paths.js"
import { builtinThemes, MAX_THEME_CHAIN, resolveTheme, THEME_NAME, themePath, type ThemeSources } from "./store.js"
import type { ThemeOverrides, ThemeTokens } from "./tokens.js"

/**
 * The one way a tool reads saved themes: the whole `extends` chain is walked here, and every saved theme file is asked
 * for (read permission, by the real path that is read: a link is asked as its target) before a byte of it is read.
 * The store then resolves from exactly these approved files and reads nothing itself. Legacy calls, chart documents,
 * charts_themes and charts_theme_save all go through it.
 *
 * The chain holds at most MAX_THEME_CHAIN named themes; a name that comes back is THEME_CYCLE, with the chain.
 */
export type AssertRead = (paths: readonly string[]) => Promise<void>

/** Reads, with permission, every saved theme the theme (a name, or tokens with `extends`) passes through. */
export async function approveThemeChain(sources: ThemeSources, theme: string | ThemeOverrides | undefined, assertRead?: AssertRead): Promise<Map<string, ThemeOverrides | null>> {
  const approved = new Map<string, ThemeOverrides | null>()
  const chain: string[] = []
  const nameOf = (value: unknown) => (typeof value === "string" ? value.trim().toLowerCase() : "light")
  let next: string | undefined = theme === undefined ? undefined : typeof theme === "string" ? nameOf(theme) : nameOf(theme.extends)
  while (next !== undefined && !builtinThemes()[next]) {
    if (chain.includes(next)) throw new ChartsError("THEME_CYCLE", `The theme "${chain[0]}" extends itself: ${[...chain, next].join(" → ")}.`, "Make the last theme of the chain extend a built-in theme (light, dark, high-contrast, print or presentation).")
    if (chain.length >= MAX_THEME_CHAIN) throw new ChartsError("THEME_CYCLE", `The theme "${chain[0]}" passes through more than ${MAX_THEME_CHAIN} named themes: ${[...chain, next].join(" → ")}.`, "Make each saved theme extend a built-in theme or one other theme.")
    chain.push(next)
    let overrides: ThemeOverrides | undefined
    if (THEME_NAME.test(next)) {
      const file = confine(sources.workspace, themePath(next), "write")
      if (existsSync(file.absolute)) {
        await assertRead?.([file.relative])
        const text = readFileSync(file.absolute, "utf8")
        try { overrides = JSON.parse(text) as ThemeOverrides } catch { throw new ChartsError("THEME_INVALID", `The saved theme "${next}" (${file.relative}) is not valid JSON.`, "Save it again with charts_theme_save.") }
        if (!overrides || typeof overrides !== "object" || Array.isArray(overrides)) throw new ChartsError("THEME_INVALID", `The saved theme "${next}" (${file.relative}) is not a JSON object.`, "Save it again with charts_theme_save.")
      }
      approved.set(next, overrides ?? null)
    }
    overrides ??= sources.configured[next]
    if (!overrides) break
    next = nameOf(overrides.extends)
  }
  return approved
}

/** Resolves a theme after asking for every saved file its chain reads. */
export async function resolveThemeAsked(sources: ThemeSources, theme: string | ThemeOverrides | undefined, assertRead?: AssertRead): Promise<ThemeTokens> {
  const approved = await approveThemeChain(sources, theme, assertRead)
  return resolveTheme({ ...sources, approved }, theme)
}
