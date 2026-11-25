import type { Json } from "../engines/common.js"
import type { Issue } from "../errors.js"
import type { ToolEnvironment } from "../tools.js"
import { approveThemeChain, resolveThemeAsked, resolveThemePairAsked } from "../themes/chain.js"
import { builtinThemes, saveTheme, savedThemeNames, THEME_DIR } from "../themes/store.js"
import { localeIds } from "../locale.js"

/** tools.charts.themes: the built-in and saved themes, one theme's tokens, or a preview from a UI seed. */
export async function runThemes(env: ToolEnvironment, input: Record<string, unknown>): Promise<Json> {
  const sources = { workspace: env.workspace, configured: env.configuredThemes }
  if (input.seed !== undefined) {
    const resolved = await resolveThemePairAsked(sources, { seed: input.seed as never }, paths => env.assertFiles("read", paths))
    const { themeContrastIssues } = await import("../themes/contrast.js")
    const warnings = themeContrastIssues(resolved.active)
    return { theme: resolved.active as unknown as Json, ...(resolved.paired ? { paired: resolved.paired as unknown as Json } : {}), warnings: warnings as unknown as Json }
  }
  if (input.name) {
    const theme = await resolveThemeAsked(sources, String(input.name), paths => env.assertFiles("read", paths))
    return { theme } as unknown as Json
  }
  const builtins = builtinThemes()
  // The list is a directory read: ask for it before reading the entries, not after.
  await env.assertFiles("read", [`${THEME_DIR}/*`])
  const saved = savedThemeNames(sources)
  return {
    builtin: Object.values(builtins).map(t => ({ name: t.name, mode: t.mode, description: t.description })),
    saved,
    locales: localeIds(env.packageRoot),
  } as unknown as Json
}

/** tools.charts.theme_save: a named theme written to the workspace, checked and with its contrast findings. */
export async function runThemeSave(env: ToolEnvironment, input: Record<string, unknown>): Promise<Json> {
  if (env.plan === undefined) await env.assertFiles("edit", [`${THEME_DIR}/${input.name}.json`])
  const sources = { workspace: env.workspace, configured: env.configuredThemes }
  // The themes it extends are read with permission first; the store reads only those.
  const approved = await approveThemeChain(sources, input.theme as never, paths => env.assertFiles("read", paths))
  const { file, theme } = saveTheme({ ...sources, approved }, String(input.name), input.theme as never, env.plan)
  const { themeContrastIssues } = await import("../themes/contrast.js")
  const issues: Issue[] = themeContrastIssues(theme)
  return { file, theme: theme as unknown as Json, warnings: issues as unknown as Json }
}
