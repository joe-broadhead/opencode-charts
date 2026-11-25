// The theme bridge's two halves: the pure readers a host uses to turn the colours it shows into a chart seed, and the
// in-memory store the theme methods write. Every reader is pure, so a theme's revision is asserted here, not in a golden.
import { describe, expect, test } from "bun:test"
import { statusAnswer } from "@we-the-rebel-alliance/plugin-contract/accounts"
import { ChartsRpc } from "../src/client.ts"
import { formatStatus } from "../src/status.ts"
import { manifest, version } from "../src/manifest.ts"
import { applyTuiAnsiTheme, colorLuminance, extractTuiThemeSeed, themeRevision, toHexColor } from "../src/themes/host-seed.ts"
import { createHostThemeStore, effectiveThemeInput, hostThemeName, hostThemeRevision } from "../src/themes/host.ts"
import { viewMessage } from "../src/tui.ts"

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

describe("the client definition", () => {
  test("names the one RPC id and the four calls a host may make, and no event", () => {
    expect(ChartsRpc.id).toBe("charts")
    expect(Object.keys(ChartsRpc.methods).sort()).toEqual(["status", "theme_clear", "theme_get", "theme_sync"])
    expect(Object.keys(ChartsRpc.events)).toEqual([])
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

describe("the revision", () => {
  test("ignores the order fields were written in", () => {
    expect(themeRevision("dark", { background: "#000000", text: "#ffffff" })).toBe(themeRevision("dark", { text: "#ffffff", background: "#000000" }))
    expect(themeRevision("dark", { background: "#000000" })).not.toBe(themeRevision("light", { background: "#000000" }))
    expect(themeRevision("dark", { background: "#000000" })).not.toBe(themeRevision("dark", { background: "#000001" }))
  })

  test("digests exactly what was synced, and names a synced theme by its own name or its shape", () => {
    expect(hostThemeRevision("dark", "dark")).toBe(hostThemeRevision("dark", "dark"))
    expect(hostThemeRevision("dark", "dark")).not.toBe(hostThemeRevision("light", "light"))
    expect(hostThemeName("dark")).toBe("dark")
    expect(hostThemeName({ name: "acme" })).toBe("acme")
    expect(hostThemeName({ seed: { background: "#000000" } })).toBe("seed-custom")
    expect(hostThemeName({ variants: {} })).toBe("variant-custom")
    expect(hostThemeName({})).toBe("custom")
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

describe("the session store", () => {
  test("keeps one theme per session, most recently used last, and forgets the oldest past the bound", () => {
    const store = createHostThemeStore(2)
    store.sync("a", { theme: "dark", mode: "dark", revision: "r1" })
    store.sync("b", { theme: "light", mode: "light", revision: "r2" })
    expect(store.forSession("a")).toEqual({ theme: "dark", mode: "dark", revision: "r1" })
    store.sync("c", { theme: "print", mode: "light", revision: "r3" })
    expect(store.size).toBe(2)
    expect(store.forSession("b")).toBeUndefined()
    expect(store.forSession("a")?.revision).toBe("r1")
  })

  test("resolves the call's own theme, then the session's, then the configured default", () => {
    const store = createHostThemeStore()
    store.sync("ses", { theme: "dark", mode: "dark", revision: "r" })
    expect(effectiveThemeInput(undefined, "ses", store, "light")).toBe("dark")
    expect(effectiveThemeInput("print", "ses", store, "light")).toBe("print")
    expect(effectiveThemeInput(undefined, "other", store, "light")).toBe("light")
    expect(effectiveThemeInput(undefined, "ses", store, undefined)).toBe("dark")
  })

  test("clears only the session it names", () => {
    const store = createHostThemeStore()
    store.sync("a", { theme: "dark", mode: "dark", revision: "r" })
    expect(store.clear("b")).toBe(false)
    expect(store.clear("a")).toBe(true)
    expect(store.clear("a")).toBe(false)
    expect(store.forSession("a")).toBeUndefined()
  })
})

describe("the status the dialog shows", () => {
  const answer = statusAnswer({ manifest, version, hostVersion: "2.4.1", accounts: [], unguardedAgents: { ok: true, agents: [] } })

  test("formats the contract answer with the heading, the connection, the host and the next step", () => {
    expect(formatStatus(answer).split("\n")).toEqual([
      "Charts status",
      "Connection: Ready",
      "Account: none needed; Charts calls no service",
      "OpenCode: 2.4.1 (tested)",
      `Version: ${version}`,
      "Agents without default rules: none",
      "Next step: Nothing to do.",
    ])
  })

  test("the dialog drops the heading the title carries and keeps the keys", () => {
    expect(viewMessage({ status: { text: formatStatus(answer) } })).toStartWith("Connection: Ready\n")
    expect(viewMessage({ status: { text: formatStatus(answer) } })).toEndWith("r refresh · esc close")
  })

  test("names an agent the generated rules miss, and a plugin that failed", () => {
    const guarded = statusAnswer({ manifest, version, hostVersion: "2.4.1", accounts: [], unguardedAgents: { ok: true, agents: ["reviewer"] } })
    expect(formatStatus(guarded)).toContain("Agents without default rules: reviewer")
    const failed = statusAnswer({ manifest, version, hostVersion: "2.4.1", accounts: [], problems: ["the agent list could not be read"], unguardedAgents: { ok: true, agents: [] } })
    expect(formatStatus(failed)).toContain("Connection: Error")
    expect(formatStatus(failed)).toContain("Next step: the agent list could not be read")
  })
})
