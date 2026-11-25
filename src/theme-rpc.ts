import { ChartsError, suggest } from "./errors.js"
import { checkThemeDefinition, resolveThemeAsked } from "./themes/chain.js"
import type { HostThemeStore, HostThemeValue, SyncedHostTheme } from "./themes/host.js"
import { hostThemeName, hostThemeRevision } from "./themes/host.js"
import { builtinThemes, savedThemeNames, type ThemeSources } from "./themes/store.js"

/**
 * The one non-trivial theme write: resolving and validating a theme a host pushes for its session.
 *
 * The method's handler loads this module on the first `theme_sync`, so an engine start and a render never read the theme
 * chain. `theme_get` and `theme_clear` read the in-memory store directly.
 */

/** The polarity a synced theme draws in: the caller's, else the theme's own resolved mode. */
async function modeOf(sources: ThemeSources, input: { readonly theme: HostThemeValue; readonly mode?: string }, assertRead?: (paths: readonly string[]) => Promise<void>): Promise<"light" | "dark"> {
  if (input.mode === "light" || input.mode === "dark") return input.mode
  const resolved = await resolveThemeAsked(sources, input.theme as never, assertRead)
  return resolved.mode
}

/** A named theme that a sync may use: a built-in, a saved theme, or one from the plugin's options. */
function checkThemeName(sources: ThemeSources, name: string): void {
  const builtins = builtinThemes()
  if (builtins[name]) return
  const saved = savedThemeNames(sources)
  if (saved.includes(name)) return
  const all = [...Object.keys(builtins), ...saved]
  const close = suggest(name, all)
  throw new ChartsError("THEME_NOT_FOUND", `There is no theme "${name}".${close.length ? ` Did you mean ${close.map((entry) => `"${entry}"`).join(" or ")}?` : ""}`, `Use one of: ${all.join(", ")}; or sync the theme's own tokens as an object.`, "/theme")
}

/**
 * The theme a host asks to sync, checked and resolved without storing it: a planning call reports exactly what the
 * commit will apply, and the commit stores it.
 */
export async function resolveHostTheme(
  sources: ThemeSources,
  input: { readonly theme?: HostThemeValue; readonly mode?: "light" | "dark"; readonly revision?: string },
  assertRead?: (paths: readonly string[]) => Promise<void>,
): Promise<SyncedHostTheme> {
  const theme = input.theme
  if (theme === undefined) throw new ChartsError("THEME_INVALID", "A theme sync needs a theme.", 'Sync a theme name, or the theme object itself.', "/theme")
  let stored: HostThemeValue
  if (typeof theme === "string") {
    const name = theme.trim()
    if (name === "") throw new ChartsError("THEME_INVALID", "The synced theme name is empty.", "Sync a theme name, or the theme object itself.", "/theme")
    checkThemeName(sources, name)
    stored = name
  } else if (theme && typeof theme === "object" && !Array.isArray(theme)) {
    checkThemeDefinition(theme)
    // A copy, so a caller that reuses its object cannot change what was stored.
    stored = { ...theme }
  } else {
    throw new ChartsError("THEME_INVALID", "The synced theme must be a theme name or a theme object.", 'Sync a name such as "dark", or an object with colors, a seed, or variants.', "/theme")
  }
  // The theme is resolved here, so the polarity a saved dark theme draws in is read from the theme itself.
  const mode = await modeOf(sources, { theme: stored, ...(input.mode === undefined ? {} : { mode: input.mode }) }, assertRead)
  const revision = typeof input.revision === "string" && input.revision.trim() !== "" ? input.revision.trim() : hostThemeRevision(stored, mode)
  return { theme: stored, mode, revision }
}

/** The theme a host syncs for a session, checked, stored and reported back. */
export async function syncHostTheme(
  store: HostThemeStore,
  sources: ThemeSources,
  sessionID: string,
  input: { readonly theme?: HostThemeValue; readonly mode?: "light" | "dark"; readonly revision?: string },
): Promise<{ ok: true; applied: true; revision: string; mode: "light" | "dark"; themeName: string }> {
  const resolved = await resolveHostTheme(sources, input)
  const synced = store.sync(sessionID, resolved)
  return { ok: true, applied: true, revision: synced.revision, mode: synced.mode, themeName: hostThemeName(synced.theme) }
}
