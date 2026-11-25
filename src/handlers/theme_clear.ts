import type { Json } from "../engines/common.js"
import type { HostThemeStore } from "../themes/host.js"
import { THEME_CLEAR_INPUT, THEME_CLEAR_OUTPUT } from "./theme-schemas.js"
import type { MethodHandler } from "./types.js"

/** charts.theme_clear: forget the theme this session's renders resolve. A write; it asks for the contract's confirmation over RPC. */
export function themeClearHandler(store: HostThemeStore): MethodHandler {
  return {
    description: "Forget the theme a host synced for this session's renders.",
    input: THEME_CLEAR_INPUT,
    output: THEME_CLEAR_OUTPUT,
    async run(_env, _input, call) {
      return { cleared: store.clear(call.sessionID) } as unknown as Json
    },
  }
}
