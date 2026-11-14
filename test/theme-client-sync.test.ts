// The client/server theme bridge: the shared contract, the two seed readers, the terminal push and the GUI card
// palette. Every reader is pure, so a theme's revision is asserted here rather than in a golden.
import { describe, expect, test } from "bun:test"
import {
  ChartsThemeContract,
  THEME_RPC_ID,
  applyTuiAnsiTheme,
  colorLuminance,
  extractDomThemeSeed,
  extractTuiThemeSeed,
  themeRevision,
  toHexColor,
  type ThemeHostDocument,
  type ThemeSyncPayload,
} from "../src/theme-contract.ts"
import { TOOLS_RPC_ID } from "../src/host/rpc.ts"
import { createPlugin } from "../src/plugin.ts"
import { setupView } from "../src/tui.ts"
import { buildChartCardSvg, readGuiThemeSeed, syncGuiTheme } from "../src/gui.ts"
import { workspace } from "./helpers.ts"

/** The line chart every card test draws. */
const LINE = { type: "line", title: "Latency", unit: "ms", data: [{ x: "Jan", y: 120 }, { x: "Feb", y: 80 }, { x: "Mar", y: 95 }], x: "x", y: "y" }

/** A TUI theme in the shape OpenCode resolves: RGBA objects on every token, with a categorical palette. */
const RGBA_THEME = {
  background: { base: { r: 24, g: 24, b: 27, a: 1 }, raised: { base: { r: 39, g: 39, b: 42, a: 1 } } },
  text: { base: { r: 244, g: 244, b: 245, a: 1 }, muted: { r: 161, g: 161, b: 170, a: 1 } },
  border: { base: { r: 39, g: 39, b: 42, a: 1 } },
  hue: { accent: { 600: { r: 124, g: 156, b: 255, a: 1 } } },
  categorical: [
    { 600: { r: 96, g: 165, b: 250, a: 1 } },
    { 600: { r: 244, g: 114, b: 182, a: 1 } },
  ],
}

/** A colour class whose hex is only reachable through its own method, as some hosts wrap theirs. */
class HexColor {
  constructor(private readonly hex: string) {}
  toHex(): string {
    return this.hex
  }
}

/** The smallest document the reader accepts: a root element and a computed style the test owns. */
function mockDocument(
  values: Record<string, string>,
  computed: { backgroundColor?: string; color?: string } = {},
): ThemeHostDocument {
  return {
    documentElement: {},
    defaultView: {
      getComputedStyle: () => ({
        getPropertyValue: (name: string) => values[name] ?? "",
        backgroundColor: computed.backgroundColor ?? "",
        color: computed.color ?? "",
      }),
    },
  }
}

/** Enough microtask turns for a push's promise chain to settle. */
async function flush(): Promise<void> {
  for (let turn = 0; turn < 6; turn++) await Promise.resolve()
}

describe("the theme contract", () => {
  test("declares one sync, one read and one clear, and the changed event", () => {
    expect(THEME_RPC_ID).toBe("charts.theme")
    expect(ChartsThemeContract.id).toBe("charts.theme")
    expect(Object.keys(ChartsThemeContract.methods).sort()).toEqual(["clear", "get", "sync"])
    expect(Object.keys(ChartsThemeContract.events)).toEqual(["changed"])
  })
})

describe("reading a colour", () => {
  test("converts an RGBA object, a hex string, an rgb() and an hsl() to #rrggbb", () => {
    expect(toHexColor({ r: 24, g: 24, b: 27, a: 1 })).toBe("#18181b")
    expect(toHexColor("#18181b")).toBe("#18181b")
    expect(toHexColor("#FFF")).toBe("#ffffff")
    expect(toHexColor("#18181bcc")).toBe("#18181b")
    expect(toHexColor("rgb(24, 24, 27)")).toBe("#18181b")
    expect(toHexColor("hsl(0 0% 100%)")).toBe("#ffffff")
    expect(toHexColor({ r: 0.5, g: 0.5, b: 0.5, a: 1 })).toBe("#808080")
  })

  test("reads a colour class through its own methods, and refuses anything else", () => {
    expect(toHexColor(new HexColor("#E6EDF3"))).toBe("#e6edf3")
    expect(toHexColor({ toInts: () => [255, 0, 0, 1] })).toBe("#ff0000")
    expect(toHexColor("not a colour")).toBeUndefined()
    expect(toHexColor(undefined)).toBeUndefined()
    expect(toHexColor(42)).toBeUndefined()
  })

  test("names a mode from how light the background is", () => {
    expect(colorLuminance("#ffffff")).toBeGreaterThan(colorLuminance("#000000"))
    expect(colorLuminance("#000000")).toBe(0)
  })
})

describe("the TUI theme seed", () => {
  test("reads the resolved theme's RGBA tokens and keeps its series", () => {
    const seed = extractTuiThemeSeed(RGBA_THEME, "dark")
    expect(seed?.mode).toBe("dark")
    expect(seed?.seed.background).toBe("#18181b")
    expect(seed?.seed.surface).toBe("#27272a")
    expect(seed?.seed.text).toBe("#f4f4f5")
    expect(seed?.seed.muted).toBe("#a1a1aa")
    expect(seed?.seed.accent).toBe("#7c9cff")
    expect(seed?.seed.series).toEqual(["#60a5fa", "#f472b6"])
    expect(seed?.revision).toMatch(/^[0-9a-f]{16}$/)
  })

  test("gives the same revision for the same tokens, and a new one for a new mode", () => {
    const first = extractTuiThemeSeed(RGBA_THEME, "dark")!
    expect(extractTuiThemeSeed(RGBA_THEME, "dark")!.revision).toBe(first.revision)
    expect(extractTuiThemeSeed(RGBA_THEME, "light")!.revision).not.toBe(first.revision)
  })

  test("reads a .toHex() token and infers the mode from the background", () => {
    const dark = extractTuiThemeSeed({ background: { base: new HexColor("#0d1117") }, text: { base: new HexColor("#E6EDF3") } })
    expect(dark?.mode).toBe("dark")
    expect(dark?.seed.text).toBe("#e6edf3")
    const light = extractTuiThemeSeed({ background: { base: "#ffffff" }, text: { base: "#111111" } })
    expect(light?.mode).toBe("light")
    expect(light?.seed.background).toBe("#ffffff")
  })

  test("returns undefined for a theme that carries nothing a chart can use", () => {
    expect(extractTuiThemeSeed(undefined)).toBeUndefined()
    expect(extractTuiThemeSeed({})).toBeUndefined()
    expect(extractTuiThemeSeed({ text: { base: "not a colour" } })).toBeUndefined()
    expect(extractTuiThemeSeed("theme")).toBeUndefined()
  })
})

describe("the DOM theme seed", () => {
  test("reads OpenCode's Web and Desktop variables", () => {
    const seed = extractDomThemeSeed(
      mockDocument({
        "--v2-background-bg-base": "#101014",
        "--v2-text-text-base": "#f4f4f5",
        "--v2-text-text-muted": "#a1a1aa",
        "--v2-border-border-base": "#27272a",
        "--v2-icon-icon-accent-base": "#7c9cff",
      }),
    )
    expect(seed?.mode).toBe("dark")
    expect(seed?.seed.background).toBe("#101014")
    expect(seed?.seed.text).toBe("#f4f4f5")
    expect(seed?.seed.muted).toBe("#a1a1aa")
    expect(seed?.seed.border).toBe("#27272a")
    expect(seed?.seed.accent).toBe("#7c9cff")
    expect(seed?.revision).toMatch(/^[0-9a-f]{16}$/)
  })

  test("reads a shadcn theme's background, primary and chart palette", () => {
    const seed = extractDomThemeSeed(
      mockDocument({
        "--background": "#ffffff",
        "--foreground": "#0a0a0a",
        "--muted-foreground": "#71717a",
        "--border": "#e4e4e7",
        "--primary": "#2563eb",
        "--chart-1": "#1d4ed8",
        "--chart-2": "#0ea5e9",
        "--chart-3": "#10b981",
        "--chart-4": "#f59e0b",
        "--chart-5": "#ef4444",
      }),
      "light",
    )
    expect(seed?.mode).toBe("light")
    expect(seed?.seed.background).toBe("#ffffff")
    expect(seed?.seed.text).toBe("#0a0a0a")
    expect(seed?.seed.muted).toBe("#71717a")
    expect(seed?.seed.accent).toBe("#2563eb")
    expect(seed?.seed.series).toEqual(["#1d4ed8", "#0ea5e9", "#10b981", "#f59e0b", "#ef4444"])
  })

  test("prefers a specific host variable over a generic one", () => {
    const seed = extractDomThemeSeed(mockDocument({ "--v2-background-bg-base": "#101014", "--background": "#ffffff", "--viz-ink": "#eeeeee" }))
    expect(seed?.seed.background).toBe("#101014")
    expect(seed?.seed.text).toBe("#eeeeee")
  })

  test("falls back to a page's own viz tokens and to the computed colours", () => {
    const tokens = extractDomThemeSeed(mockDocument({ "--surface-page": "#fafafa", "--viz-ink": "#18181b", "--viz-1": "#0969da", "--viz-2": "#8250df" }))
    expect(tokens?.seed.background).toBe("#fafafa")
    expect(tokens?.seed.text).toBe("#18181b")
    expect(tokens?.seed.series).toEqual(["#0969da", "#8250df"])
    const computed = extractDomThemeSeed(mockDocument({}, { backgroundColor: "#0d1117", color: "#e6edf3" }))
    expect(computed?.seed.background).toBe("#0d1117")
    expect(computed?.seed.text).toBe("#e6edf3")
    expect(computed?.mode).toBe("dark")
  })

  test("returns undefined without a document, a root, or readable colours", () => {
    expect(extractDomThemeSeed(undefined)).toBeUndefined()
    expect(extractDomThemeSeed({})).toBeUndefined()
    expect(extractDomThemeSeed({ documentElement: {}, defaultView: { getComputedStyle: () => undefined } })).toBeUndefined()
    expect(extractDomThemeSeed(mockDocument({ "--background": "oklch(1 0 0)" }))).toBeUndefined()
  })
})

describe("the revision", () => {
  test("ignores the order fields were written in", () => {
    expect(themeRevision("dark", { background: "#000000", text: "#ffffff" })).toBe(themeRevision("dark", { text: "#ffffff", background: "#000000" }))
    expect(themeRevision("dark", { background: "#000000" })).not.toBe(themeRevision("light", { background: "#000000" }))
    expect(themeRevision("dark", { background: "#000000" })).not.toBe(themeRevision("dark", { background: "#000001" }))
  })
})

describe("the terminal repaint", () => {
  test("paints a series code with the seed colour and leaves every other code alone", () => {
    const seed = { series: ["#60a5fa", "#f472b6"], accent: "#7c9cff" }
    expect(applyTuiAnsiTheme("\u001b[36m▁▂\u001b[0m", seed)).toBe("\u001b[38;2;96;165;250m▁▂\u001b[0m")
    expect(applyTuiAnsiTheme("\u001b[35m█\u001b[0m", seed)).toBe("\u001b[38;2;244;114;182m█\u001b[0m")
    expect(applyTuiAnsiTheme("\u001b[95m█\u001b[0m", seed)).toBe("\u001b[38;2;124;156;255m█\u001b[0m")
    expect(applyTuiAnsiTheme("\u001b[1mbold\u001b[0m", seed)).toBe("\u001b[1mbold\u001b[0m")
    expect(applyTuiAnsiTheme("plain text", seed)).toBe("plain text")
  })
})

/** What a mocked server answers a `sync`: applied, refused as unapplied, or a transport failure. */
type Answer = "applied" | "unapplied" | "throws"

/** The context the TUI view needs, with the theme contract's calls recorded. */
function tuiContext(options: { theme?: unknown; themeMode?: "light" | "dark"; refuse?: boolean; answers?: Answer[] } = {}) {
  const syncs: ThemeSyncPayload[] = []
  const definitions: unknown[] = []
  const connected: (() => void)[] = []
  let call = 0
  const context = {
    location: undefined,
    client: {
      rpc: (definition: unknown) => {
        definitions.push(definition)
        return {
          status: async () => ({ text: "Charts status\nConnection: Ready" }),
          sync: async (input: ThemeSyncPayload) => {
            const answer = options.answers?.[call++] ?? (options.refuse ? "throws" : "applied")
            if (answer === "throws") throw new Error("rpc.method_not_found")
            syncs.push(input)
            return answer === "applied" ? { ok: true, applied: true, revision: input.revision, mode: input.mode, themeName: "seed-custom" } : { ok: false, applied: false, revision: input.revision, mode: input.mode, themeName: "seed-custom" }
          },
        }
      },
    },
    data: {
      on: (type: string, handler: () => void) => {
        if (type === "server.connected") connected.push(handler)
        return () => undefined
      },
    },
    ui: { dialog: { alert: async () => undefined, set: () => undefined, clear: () => undefined } },
    keymap: { layer: () => () => undefined },
    ...(options.theme !== undefined || options.themeMode !== undefined ? { theme: options.theme, themeMode: options.themeMode } : {}),
  }
  return { context, syncs, definitions, connected }
}

describe("the TUI theme push", () => {
  test("pushes the seed once when the host publishes a theme", async () => {
    const mock = tuiContext({ theme: RGBA_THEME, themeMode: "dark" })
    const dispose = setupView(mock.context as never)
    await flush()
    expect(mock.definitions).toEqual([ChartsThemeContract])
    expect(mock.syncs).toHaveLength(1)
    const [payload] = mock.syncs
    expect(payload!.mode).toBe("dark")
    expect(payload!.theme.seed.background).toBe("#18181b")
    expect(payload!.revision).toBe(extractTuiThemeSeed(RGBA_THEME, "dark")!.revision)
    dispose()
  })

  test("re-offers the theme on every server.connected, because a restarted server has an empty registry", async () => {
    const mock = tuiContext({ theme: RGBA_THEME, themeMode: "dark" })
    const dispose = setupView(mock.context as never)
    await flush()
    expect(mock.syncs).toHaveLength(1)
    for (const handler of mock.connected) handler()
    await flush()
    // `pushed` is reset before the re-push, so a reload never starts up themeless.
    expect(mock.syncs).toHaveLength(2)
    expect(mock.syncs[1]!.revision).toBe(mock.syncs[0]!.revision)
    dispose()
  })

  test("retries after a first call that failed, and remembers nothing it did not apply", async () => {
    const mock = tuiContext({ theme: RGBA_THEME, themeMode: "dark", answers: ["throws", "unapplied", "applied"] })
    const dispose = setupView(mock.context as never)
    await flush()
    // The first call threw: nothing landed, and no revision was remembered.
    expect(mock.syncs).toEqual([])
    for (const handler of mock.connected) handler()
    await flush()
    // The reconnect reached the server, which answered `applied: false`: still not remembered.
    expect(mock.syncs).toHaveLength(1)
    for (const handler of mock.connected) handler()
    await flush()
    // The third call was applied.
    expect(mock.syncs).toHaveLength(2)
    for (const handler of mock.connected) handler()
    await flush()
    // A reconnect always re-offers it, whatever it remembered.
    expect(mock.syncs).toHaveLength(3)
    dispose()
  })

  test("never calls the contract when the host publishes no theme", async () => {
    const mock = tuiContext()
    const dispose = setupView(mock.context as never)
    await flush()
    expect(mock.definitions).toEqual([])
    expect(mock.syncs).toEqual([])
    dispose()
  })

  test("stays silent when the server has no such contract", async () => {
    const mock = tuiContext({ theme: RGBA_THEME, themeMode: "dark", refuse: true })
    expect(() => setupView(mock.context as never)).not.toThrow()
    await flush()
    expect(mock.syncs).toEqual([])
    for (const handler of mock.connected) handler()
    expect(() => mock.connected[0]!()).not.toThrow()
    await flush()
  })

  test("stays silent on a client that only knows the status call", async () => {
    // This is the shape test/tui.test.ts mocks: an `rpc` that answers `status` and nothing else.
    const context = {
      location: undefined,
      client: { rpc: () => ({ status: async () => ({ text: "Charts status\nConnection: Ready" }) }) },
      data: { on: () => () => undefined },
      ui: { dialog: { alert: async () => undefined, set: () => undefined, clear: () => undefined } },
      keymap: { layer: () => () => undefined },
      theme: RGBA_THEME,
      themeMode: "dark" as const,
    }
    const dispose = setupView(context as never)
    await flush()
    expect(() => dispose()).not.toThrow()
  })
})

describe("the plugin's theme RPC", () => {
  interface RegisteredRpc {
    readonly id: string
    readonly handlers: Record<string, (input: unknown, context: { error: (type: string, message: string, data: Record<string, unknown>) => unknown }) => Promise<Record<string, unknown>>>
    readonly events: { name: string; data: Record<string, unknown> }[]
  }

  /** A fake host that records every contract `plugin.setup` registers, so a test can call the methods it was given. */
  function recordedHost(dir: string, registered: RegisteredRpc[]) {
    const editor = {
      list: () => [] as { id: string }[],
      update: (_id: string, _change: (info: { permissions: unknown[] }) => void) => undefined,
      add: (_entry: unknown) => undefined,
      namespace: (_entry: unknown) => undefined,
    }
    return {
      editor,
      ctx: {
        app: { version: "2.2.5" },
        options: {},
        location: { directory: dir, project: { directory: dir } },
        agent: { transform: async (fn: (value: typeof editor) => void) => fn(editor), list: async () => ({ data: [] }) },
        command: { transform: async (fn: (value: typeof editor) => void) => fn(editor) },
        rpc: {
          register: async (contract: { id: string }, handlers: RegisteredRpc["handlers"]) => {
            const record: RegisteredRpc = { id: contract.id, handlers, events: [] }
            registered.push(record)
            return { events: { emit: async (name: string, data: Record<string, unknown>) => { record.events.push({ name, data }) } }, dispose: async () => undefined }
          },
        },
        session: { synthetic: async () => undefined },
        permission: { assert: async () => undefined, hook: async () => ({ dispose: async () => undefined }) },
        tool: { transform: async (fn: (value: typeof editor) => void) => fn(editor), list: async () => [] },
        skill: { transform: async (fn: (value: typeof editor) => void) => fn(editor), list: async () => ({ data: [] }) },
      },
    }
  }

  test("setup registers charts.tools beside charts.theme, applies a TUI seed and announces the change", async () => {
    const ws = workspace()
    const registered: RegisteredRpc[] = []
    const stop = await createPlugin({ packageRoot: ws.env.packageRoot }).setup(recordedHost(ws.dir, registered).ctx as never)
    try {
      // The tools RPC and the theme bridge are two contributions of one plugin, so a host that loads one has both.
      expect(registered.map(entry => entry.id)).toContain(TOOLS_RPC_ID)
      expect(registered.map(entry => entry.id)).toContain(THEME_RPC_ID)
      const theme = registered.find(entry => entry.id === THEME_RPC_ID)!

      // Exactly what the TUI pushes: a seed read from the host's own resolved theme, with its revision.
      const seed = extractTuiThemeSeed(RGBA_THEME, "dark")!
      const payload: ThemeSyncPayload = { mode: seed.mode, theme: { seed: seed.seed }, revision: seed.revision }
      const context = { error: (type: string, message: string) => ({ type, message }) }
      const synced = await theme.handlers.sync!(payload, context)
      expect(synced).toMatchObject({ ok: true, applied: true, revision: seed.revision, mode: "dark", themeName: "seed-custom" })

      // The location-wide theme is what every call in the workspace now resolves, and the host hears about it once.
      expect(theme.events.filter(event => event.name === "changed")).toContainEqual({
        name: "changed",
        data: expect.objectContaining({ revision: seed.revision, mode: "dark", themeName: "seed-custom" }),
      })
      const got = await theme.handlers.get!({}, context)
      expect(got).toMatchObject({ found: true, revision: seed.revision, mode: "dark", themeName: "seed-custom" })
      expect((got.theme as { theme: { seed: Record<string, unknown> } }).theme.seed.background).toBe("#18181b")

      // A cleared theme answers `found: false`; the bridge holds it in memory, so a workspace file is never written.
      expect(await theme.handlers.clear!({}, context)).toEqual({ cleared: true })
      expect(await theme.handlers.get!({}, context)).toMatchObject({ found: false, revision: null, theme: null })
    } finally {
      await stop?.()
      ws.cleanup()
    }
  })
})

describe("the GUI card palette", () => {
  test("inherits the host's background, ink, gridline and series colours", () => {
    const doc = mockDocument({
      "--v2-background-bg-base": "#101014",
      "--v2-text-text-base": "#f4f4f5",
      "--v2-text-text-muted": "#a1a1aa",
      "--v2-border-border-base": "#27272a",
      "--chart-1": "#60a5fa",
      "--chart-2": "#f472b6",
    })
    const seed = readGuiThemeSeed(doc, "dark")!.seed
    const svg = buildChartCardSvg(LINE, { mode: "dark", seed })!
    expect(svg).toContain('fill="#101014"')
    expect(svg).toContain('stroke="#27272a"')
    expect(svg).toContain('stroke="#60a5fa"')
    expect(svg).toContain('fill="#f4f4f5"')
    expect(svg).not.toMatch(/NaN|undefined/)
  })

  test("keeps the built-in palette when no host theme was read", () => {
    const svg = buildChartCardSvg(LINE, { mode: "dark" })!
    expect(svg).toContain('fill="#0d1117"')
    expect(svg).toContain('stroke="#58a6ff"')
    expect(readGuiThemeSeed(undefined, "dark")).toBeUndefined()
  })
})

describe("the GUI theme push", () => {
  test("reports a revision once, and resolves false when it cannot", async () => {
    const pushes: ThemeSyncPayload[] = []
    const client = {
      rpc: (definition: unknown) => {
        expect(definition).toBe(ChartsThemeContract)
        return {
          sync: async (input: ThemeSyncPayload) => {
            pushes.push(input)
            return { revision: input.revision, applied: true }
          },
        }
      },
    }
    const doc = mockDocument({ "--v2-background-bg-base": "#101014", "--chart-1": "#60a5fa" })
    expect(await syncGuiTheme(client, doc, "dark")).toBe(true)
    expect(pushes).toHaveLength(1)
    expect(pushes[0]!.theme.seed.background).toBe("#101014")
    expect(await syncGuiTheme(client, doc, "dark")).toBe(false)
    expect(pushes).toHaveLength(1)
    expect(await syncGuiTheme(undefined, doc, "dark")).toBe(false)
    expect(await syncGuiTheme(client, undefined, "dark")).toBe(false)
    expect(await syncGuiTheme({}, doc, "dark")).toBe(false)
  })

  test("a refused call resolves false rather than throwing", async () => {
    const client = {
      rpc: () => ({
        sync: async () => {
          throw new Error("rpc.method_not_found")
        },
      }),
    }
    const doc = mockDocument({ "--v2-background-bg-base": "#010203" })
    expect(await syncGuiTheme(client, doc, "dark")).toBe(false)
  })

  test("a server that answers it did not apply the theme is not remembered, and the next render retries", async () => {
    const answers = ["unapplied", "applied", "applied"]
    let call = 0
    const pushes: ThemeSyncPayload[] = []
    const client = {
      rpc: () => ({
        sync: async (input: ThemeSyncPayload) => {
          pushes.push(input)
          const answer = answers[call++]!
          return answer === "applied" ? { ok: true, applied: true, revision: input.revision } : { ok: false, applied: false, revision: input.revision }
        },
      }),
    }
    const doc = mockDocument({ "--v2-background-bg-base": "#010203" })
    expect(await syncGuiTheme(client, doc, "dark")).toBe(false)
    // The same revision is offered again, because the first answer was not an application.
    expect(await syncGuiTheme(client, doc, "dark")).toBe(true)
    expect(pushes).toHaveLength(2)
    expect(await syncGuiTheme(client, doc, "dark")).toBe(false)
    expect(pushes).toHaveLength(2)
  })
})
