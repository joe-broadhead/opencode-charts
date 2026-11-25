import { Rpc } from "@opencode/plugin/rpc"
import { STATUS_SCHEMA } from "@we-the-rebel-alliance/plugin-contract/accounts"
import { THEME_CLEAR_INPUT, THEME_CLEAR_OUTPUT, THEME_GET_INPUT, THEME_GET_OUTPUT, THEME_SYNC_INPUT, THEME_SYNC_OUTPUT } from "./handlers/theme-schemas.js"

/**
 * The client side of the plugin's one RPC id, for a host that reads the status dialog or syncs a theme.
 *
 * It registers nothing: `register` owns the one `ctx.rpc.register` on the server. A host uses this definition to type
 * `client.rpc(ChartsRpc)`, and the server validates the same shapes through its handlers.
 */
export const ChartsRpc = Rpc.define({
  id: "charts",
  methods: {
    status: { input: { type: "object", properties: {}, additionalProperties: false }, output: STATUS_SCHEMA },
    theme_sync: { input: THEME_SYNC_INPUT, output: THEME_SYNC_OUTPUT },
    theme_get: { input: THEME_GET_INPUT, output: THEME_GET_OUTPUT },
    theme_clear: { input: THEME_CLEAR_INPUT, output: THEME_CLEAR_OUTPUT },
  },
  events: {},
})

export type ChartsRpcType = typeof ChartsRpc
