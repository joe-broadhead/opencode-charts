import { Plugin } from "@opencode/plugin/tui"
import { createSignal } from "solid-js"
import { formatFailure } from "./errors.js"
import { PLUGIN_ID } from "./constants.js"
import { ChartsStatus } from "./status-rpc.js"


const TITLE = "Charts status"
const KEYS = "r refresh · esc close"

type Context = Plugin.Context

/**
 * The view's text: the report `/charts-status` prints without its heading, which the dialog title carries, and the
 * one line of keys. A refusal from the RPC is shown as its own message and next step; a server that does not answer
 * at all means the plugin is not loaded there.
 */
export function viewMessage(result: { readonly status: { readonly text: string } } | { readonly error: unknown }): string {
  // The RPC carries the report already formatted, so the dialog needs no copy of the status model.
  if ("status" in result) return `${result.status.text.split("\n").slice(1).join("\n")}\n\n${KEYS}`
  const { error } = result
  const type = typeof error === "object" && error !== null && "type" in error ? (error as { type?: unknown }).type : undefined
  if (type === "unavailable") {
    const { message, data } = error as { message?: unknown; data?: { nextStep?: unknown } }
    if (typeof message === "string") return `${message}${typeof data?.nextStep === "string" ? ` Next step: ${data.nextStep}` : ""}\n\n${KEYS}`
  }
  if (type === "rpc.unavailable" || type === "rpc.method_not_found") {
    return `${formatFailure("STATUS_UNAVAILABLE", "The Charts plugin is not running on this OpenCode server.", "Run /plugins to see why it did not start.")}\n\n${KEYS}`
  }
  return `${formatFailure("STATUS_UNAVAILABLE", "Could not read Charts status.", "Restart OpenCode, then run /charts.")}\n\n${KEYS}`
}

/** The members of the TUI context this view uses: no slot, one dialog, and the keymap layer. */
export interface ViewContext {
  readonly location: Context["location"]
  readonly client: Pick<Context["client"], "rpc">
  readonly data: Pick<Context["data"], "on">
  readonly ui: { readonly dialog: Pick<Context["ui"]["dialog"], "alert" | "set" | "clear"> }
  readonly keymap: Pick<Context["keymap"], "layer">
}

export function setupView(context: ViewContext) {
  let open: number | undefined
  let latest = 0
  /** The event listeners, held only while the view is open. */
  let stops: (() => void)[] = []
  const unsubscribe = () => {
    for (const stop of stops.splice(0)) stop()
  }
  const subscribe = () => {
    if (stops.length) return
    stops = [context.data.on("server.connected", refresh), context.data.on("agent.updated", refresh)]
  }
  // The refresh key is live only while the view is open, so `r` never reaches it from anywhere else.
  const [shown, setShown] = createSignal(false)
  const show = async (refresh: boolean) => {
    if (refresh && open === undefined) return
    const request = ++latest
    const location = context.location
    const result = await context.client
      .rpc(ChartsStatus)
      .status({}, location ? { location } : {})
      // The host validates the output against the contract's schema before it answers.
      .then((status) => ({ status: status as { text: string } }), (error: unknown) => ({ error }))
    // The newest request wins, and a refresh never reopens a view the user closed meanwhile.
    if (request !== latest || (refresh && open === undefined)) return
    open = request
    setShown(true)
    subscribe()
    // The alert closes on Esc; replacing it with a newer one closes it too.
    void context.ui.dialog.alert({ title: TITLE, message: viewMessage(result) }).then(() => {
      if (open !== request) return
      open = undefined
      setShown(false)
      unsubscribe()
    })
    // Showing resets the size; the rules block reads better wide.
    context.ui.dialog.set({ size: "large" })
  }
  const refresh = () => void show(true)

  // Called from setup itself, because keymap layers need the host's reactive owner. Global, because the palette and
  // slash completion list only the commands reachable from their own input mode.
  context.keymap.layer(() => ({
    mode: "global",
    commands: [
      {
        id: `${PLUGIN_ID}.status`,
        title: "Charts: Status",
        description: "The renderers, themes, tools and permission posture, and the next step",
        group: "Charts",
        palette: true,
        slash: { name: "charts" },
        run: () => show(false),
      },
      { id: `${PLUGIN_ID}.status.refresh`, title: "Refresh Charts status", group: "Charts", bind: "r", enabled: shown, run: refresh },
    ],
  }))
  return () => {
    unsubscribe()
    if (open === undefined) return
    open = undefined
    setShown(false)
    context.ui.dialog.clear()
  }
}

export default Plugin.define({ id: `${PLUGIN_ID}.tui`, setup: setupView })
