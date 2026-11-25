import type { Json } from "../engines/common.js"
import { hostThemeName, type HostThemeStore } from "../themes/host.js"
import { THEME_GET_INPUT, THEME_GET_OUTPUT } from "./theme-schemas.js"
import type { MethodHandler } from "./types.js"

/** charts.theme_get: the theme this session's renders resolve, if a host synced one. */
export function themeGetHandler(store: HostThemeStore): MethodHandler {
  return {
    description: "Read the theme a host synced for this session's renders.",
    input: THEME_GET_INPUT,
    output: THEME_GET_OUTPUT,
    async run(_env, _input, call) {
      const synced = store.forSession(call.sessionID)
      if (synced === undefined) return { found: false, revision: null, theme: null } as unknown as Json
      return {
        found: true,
        revision: synced.revision,
        mode: synced.mode,
        themeName: hostThemeName(synced.theme),
        theme: { theme: synced.theme, mode: synced.mode, revision: synced.revision },
      } as unknown as Json
    },
  }
}
