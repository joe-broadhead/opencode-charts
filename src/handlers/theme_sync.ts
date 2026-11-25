import type { Json } from "../engines/common.js"
import { hostThemeName, type HostThemeStore } from "../themes/host.js"
import { THEME_DIR } from "../themes/store.js"
import { THEME_SYNC_INPUT, THEME_SYNC_OUTPUT } from "./theme-schemas.js"
import type { MethodHandler } from "./types.js"

/**
 * charts.theme_sync: store the theme a host shows for this session's renders.
 *
 * A write, and it asks even under `access: all`: it changes what every later render in the session draws with. Over RPC
 * it therefore needs the contract's confirmation (a permission ask or a host-signed grant); a host without a way to ask
 * leaves the server on its configured theme. The theme chain loads on the first sync, never at engine start.
 */
export function themeSyncHandler(store: HostThemeStore): MethodHandler {
  return {
    description: "Apply the theme a host shows to this session's chart renders.",
    input: THEME_SYNC_INPUT,
    output: THEME_SYNC_OUTPUT,
    async run(env, raw, call) {
      const input = raw as { theme?: string | Record<string, unknown>; mode?: "light" | "dark"; revision?: string }
      // A named theme resolves through the saved-theme chain, which reads `.charts/themes/`; ask for that read first.
      if (typeof input.theme === "string") await env.assertFiles("read", [`${THEME_DIR}/*`])
      const { syncHostTheme } = await import("../theme-rpc.js")
      const sources = { workspace: env.workspace, configured: env.configuredThemes }
      return (await syncHostTheme(store, sources, call.sessionID, input)) as unknown as Json
    },
  }
}
