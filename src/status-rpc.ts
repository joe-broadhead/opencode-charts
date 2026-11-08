import type { Plugin } from "@opencode/plugin"
import { Rpc } from "@opencode/plugin/rpc"
import { PLUGIN_ID } from "./plugin.js"
import { formatStatus, type StatusView } from "./status.js"

const string = { type: "string" } as const

/** The status as the dialog, `/charts-status` and a script read it: the family's shared fields plus Charts' own. */
export const ChartsStatus = Rpc.define({
  id: PLUGIN_ID,
  methods: {
    status: {
      input: { type: "object" },
      output: {
        type: "object",
        required: ["version", "host", "state", "unguardedAgents", "nextStep"],
        properties: {
          version: string,
          host: {
            type: "object",
            required: ["version", "range", "tested"],
            properties: { version: { type: ["string", "null"] }, range: string, tested: { type: "boolean" }, supported: { type: "boolean" } },
          },
          state: { enum: ["ready", "failed"] },
          unguardedAgents: { type: "array", items: string },
          nextStep: string,
          png: { type: ["string", "null"] },
          html: { type: ["string", "null"] },
          defaults: { type: "object" },
          themes: { type: "object" },
          tools: { type: "object" },
          skills: { type: "object" },
        },
      },
      errors: { unavailable: { type: "object", properties: { nextStep: string }, required: ["nextStep"] } },
    },
  },
  events: {},
})

export type ChartsStatusRpc = typeof ChartsStatus

/** Registers `charts.status`; the one model the dialog, the command and a script read. */
export function registerStatusRpc(
  rpc: Pick<Plugin.Context["rpc"], "register">,
  status: () => Promise<StatusView>,
) {
  return rpc.register(ChartsStatus, {
    status: async (_input, { error }) =>
      status().catch((cause: unknown) => {
        const reason = cause instanceof Error ? cause.message : String(cause)
        return error("unavailable", `STATUS_UNAVAILABLE: Charts status could not be read. Next step: Run /charts-status again, or check the OpenCode server log.`, {
          nextStep: `Run /charts-status again, or check the OpenCode server log (${reason.slice(0, 160)}).`,
        })
      }),
  })
}

/** What the dialog shows: the report without its heading, which the dialog's title carries. */
export const statusText = (view: StatusView) => formatStatus(view).split("\n").slice(1).join("\n")
