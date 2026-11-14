import { Plugin } from "@opencode/plugin/tui"
import { TextRenderable } from "@opentui/core"
import { createSignal } from "solid-js"
import { formatFailure } from "./errors.js"
import { PLUGIN_ID } from "./constants.js"
import { ChartsStatus } from "./status-rpc.js"
import { ChartsThemeContract, applyTuiAnsiTheme, extractTuiThemeSeed, type ThemeSeedResult } from "./theme-contract.js"
import { ChartBlockCache } from "./tui-chart.js"


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

  // The active TUI theme, read on each use: the chart block paints in these colours, and the seed is pushed to the
  // server so an artifact rendered there matches the terminal. A host that publishes no theme keeps the plain block.
  const readTheme = (): ThemeSeedResult | undefined => {
    try {
      if (context.theme === undefined && context.themeMode === undefined) return undefined
      return extractTuiThemeSeed(context.theme, context.themeMode)
    } catch {
      return undefined
    }
  }
  let pushed: string | undefined
  /**
   * Push the seed once per revision that the server accepted. Silent by design: an older server has no such contract
   * and a mock has no such method, and neither may surface an error or a warning in the terminal. A revision is only
   * remembered once the server says it applied it, so a refused or dropped call is retried on the next connection.
   */
  const pushTheme = async (): Promise<void> => {
    const seed = readTheme()
    if (seed === undefined || pushed === seed.revision) return
    const revision = seed.revision
    try {
      const call = context.client.rpc(ChartsThemeContract).sync({ mode: seed.mode, theme: { seed: seed.seed }, revision }, context.location ? { location: context.location } : {})
      const result = (await Promise.resolve(call)) as { readonly applied?: boolean; readonly ok?: boolean } | undefined
      if (result?.applied === true || result?.ok === true) pushed = revision
    } catch {
      // Silent: the charts still draw, and the next `server.connected` tries again.
    }
  }
  const themeStops: (() => void)[] = []
  try {
    // A server that restarted or reloaded came up with an empty registry, so every connection re-offers the theme.
    const stop = context.data.on("server.connected", () => {
      pushed = undefined
      void pushTheme()
    })
    if (typeof stop === "function") themeStops.push(stop)
  } catch {
    // A host whose event bus refuses the listener simply never pushes.
  }
  void pushTheme()

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
    for (const stop of chartStops.splice(0)) stop()
    for (const stop of themeStops.splice(0)) stop()
    unsubscribe()
    if (open === undefined) return
    open = undefined
    setShown(false)
    context.ui.dialog.clear()
  }
}

export default Plugin.define({ id: `${PLUGIN_ID}.tui`, setup: setupView })
