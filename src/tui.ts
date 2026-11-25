import type { StatusAnswer } from "@we-the-rebel-alliance/plugin-contract/accounts"
import { Plugin } from "@opencode/plugin/tui"
import { TextRenderable } from "@opentui/core"
import { createSignal } from "solid-js"
import { ChartsRpc } from "./client.js"
import { PLUGIN_ID } from "./constants.js"
import { formatFailure } from "./errors.js"
import { formatStatus } from "./status.js"
import { applyTuiAnsiTheme, extractTuiThemeSeed, type ThemeSeedResult } from "./themes/host-seed.js"
import { ChartBlockCache } from "./tui-chart.js"

const TITLE = "Charts status"
const KEYS = "r refresh · esc close"

type Context = Plugin.Context

/**
 * The view's text: the status answer as the server formats it, without its heading, which the dialog title carries,
 * and the one line of keys. A refusal from the RPC is shown as its own message and next step; a server that does not
 * answer at all means the plugin is not loaded there.
 */
export function viewMessage(result: { readonly status: { readonly text: string } } | { readonly error: unknown }): string {
  if ("status" in result) return `${result.status.text.split("\n").slice(1).join("\n")}\n\n${KEYS}`
  const { error } = result
  const type = typeof error === "object" && error !== null && "type" in error ? (error as { type?: unknown }).type : undefined
  if (type === "failed") {
    const { message } = error as { message?: unknown }
    if (typeof message === "string") return `${message}\n\n${KEYS}`
  }
  if (type === "rpc.unavailable" || type === "rpc.method_not_found") {
    return `${formatFailure("STATUS_UNAVAILABLE", "The Charts plugin is not running on this OpenCode server.", "Run /plugins to see why it did not start.")}\n\n${KEYS}`
  }
  return `${formatFailure("STATUS_UNAVAILABLE", "Could not read Charts status.", "Restart OpenCode, then run /charts.")}\n\n${KEYS}`
}

/**
 * The members of the TUI context this view uses: no slot, one dialog, the keymap layer, and — when the host publishes
 * them — the Markdown code-block registry, the theme and the renderer that a chart block draws into. All three are
 * optional so a host that does not publish them keeps the status dialog working.
 */
export interface ViewContext {
  readonly location: Context["location"]
  readonly client: Pick<Context["client"], "rpc">
  readonly data: Pick<Context["data"], "on">
  readonly ui: { readonly dialog: Pick<Context["ui"]["dialog"], "alert" | "set" | "clear"> }
  readonly keymap: Pick<Context["keymap"], "layer">
  readonly markdown?: Pick<Context["markdown"], "registerCodeBlockRenderer">
  readonly theme?: Context["theme"]
  readonly themeMode?: Context["themeMode"]
  readonly renderer?: Context["renderer"]
}

/**
 * How wide a `chart` block draws: a little inside the renderer, which is measured in terminal columns, and never so
 * wide that the plot's axis labels crowd the curve.
 */
export function chartBlockWidth(columns: number): number {
  return Math.max(24, Math.min(88, Math.floor(columns) - 12))
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
      .rpc(ChartsRpc)
      .status({}, location ? { location } : {})
      .then((status) => ({ status: { text: formatStatus(status as StatusAnswer) } }), (error: unknown) => ({ error }))
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

  // The active TUI theme, read on each use: the chart block paints in these colours, so a block matches the terminal
  // around it. Nothing is pushed to the server: a theme sync is a write and asks for the person's confirmation.
  const readTheme = (): ThemeSeedResult | undefined => {
    try {
      if (context.theme === undefined && context.themeMode === undefined) return undefined
      return extractTuiThemeSeed(context.theme, context.themeMode)
    } catch {
      return undefined
    }
  }

  // A ```chart fence is drawn from its JSON. While a model streams the fence its JSON is incomplete, so the cache
  // keeps the last chart this block drew; before the first one parses the block falls back to plain text, and a block
  // that never parses is never an error.
  const charts = new ChartBlockCache()
  const chartStops: (() => void)[] = []
  const markdown = context.markdown
  if (markdown && typeof markdown.registerCodeBlockRenderer === "function") {
    const stop = markdown.registerCodeBlockRenderer("chart", (token) => {
      const renderer = context.renderer
      if (!renderer) return undefined
      try {
        const seed = readTheme()
        const text = charts.update(token.text, { width: chartBlockWidth(renderer.width), height: 14, ansi: seed !== undefined })
        if (!text) return undefined
        // The renderer paints its series with ANSI 256-colour codes; with a host theme they are repainted in its colours.
        const content = seed === undefined ? text : applyTuiAnsiTheme(text, seed.seed)
        const foreground = typeof seed?.seed.text === "string" ? seed.seed.text : context.theme?.text.base
        return new TextRenderable(renderer, { content, fg: foreground })
      } catch {
        return undefined
      }
    })
    if (typeof stop === "function") chartStops.push(stop)
  }

  // Called from setup itself, because keymap layers need the host's reactive owner. Global, because the palette and
  // slash completion list only the commands reachable from their own input mode.
  context.keymap.layer(() => ({
    mode: "global",
    commands: [
      {
        id: `${PLUGIN_ID}.status`,
        title: "Charts: Status",
        description: "The plugin's state, its host range and the next step",
        group: "Charts",
        palette: true,
        slash: { name: "charts" },
        run: () => show(false),
      },
      { id: `${PLUGIN_ID}.status.refresh`, title: "Refresh Charts status", group: "Charts", bind: "r", enabled: shown, run: refresh },
    ],
  }))
  return () => {
    for (const stop of chartStops.splice(0)) stop()
    unsubscribe()
    if (open === undefined) return
    open = undefined
    setShown(false)
    context.ui.dialog.clear()
  }
}

export default Plugin.define({ id: `${PLUGIN_ID}.tui`, setup: setupView })
