import { createHash } from "node:crypto"
import type { Plugin } from "@opencode/plugin"
import { ChartsError, suggest } from "./errors.js"
import { ChartsThemeContract, THEME_RPC_ID } from "./theme-contract.js"
import { checkThemeDefinition, resolveThemeAsked } from "./themes/chain.js"
import { builtinThemes, savedThemeNames, type ThemeSources } from "./themes/store.js"

/**
 * The live host theme RPC: `charts.theme`.
 *
 * A host (a TUI, the desktop app, an editor extension) knows the theme its reader is looking at, and it changes without
 * touching a file. It syncs that theme here once — a name, or the theme object itself — and every tool call in that
 * session resolves it, with no theme written to the workspace and nothing read from disk. The sync is held in memory,
 * per session and for the location as a whole, and bounded so a long-lived process cannot grow without limit.
 *
 * Nothing here is a render path: the registry holds strings and plain objects, and the store resolves them exactly as
 * it resolves an inline `theme` object.
 */

export { ChartsThemeContract, ChartsThemeContract as ChartsThemeRpc, THEME_RPC_ID }

/** The most sessions whose synced theme is remembered: the least recently used is dropped first. */
export const MAX_SYNCED_THEMES = 256

/** What a host may sync: a theme name, or a theme object (tokens, a seed, or light and dark variants). */
export type HostThemeValue = string | Record<string, unknown>

export interface SyncThemeInput {
  /** The session the theme applies to; without one it applies to the whole location. */
  readonly sessionID?: string
  readonly mode?: "light" | "dark"
  readonly theme?: HostThemeValue
  /** The host's own revision for this theme; identical input gives an identical revision when it is not given. */
  readonly revision?: string
}

/** A theme as it was synced, with the revision that identifies it. */
export interface SyncedHostTheme {
  readonly theme: HostThemeValue
  readonly mode: "light" | "dark"
  readonly revision: string
  /** The session it belongs to; absent for the location-wide theme. */
  readonly sessionID?: string
}

export interface HostThemeStore {
  /** How many sessions hold a synced theme. */
  readonly size: number
  sync(input: SyncThemeInput & { readonly theme: HostThemeValue }): SyncedHostTheme
  /** The theme synced for a session, if any; reading it marks the session as recently used. */
  forSession(sessionID: string | undefined): SyncedHostTheme | undefined
  /** The theme synced for the whole location, if any. */
  default(): SyncedHostTheme | undefined
  /** Clears a session's theme, or the location-wide one when no session is named; true when there was one. */
  clear(sessionID?: string): boolean
}

/** A stable JSON text: keys sorted, so two equal themes hash to the same revision. */
function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>
    return `{${Object.keys(record).sort().map(key => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(",")}}`
  }
  return JSON.stringify(value) ?? "null"
}

/** The revision of a synced theme: the host's own when it gave one, else a digest of exactly what was synced. */
export function hostThemeRevision(theme: HostThemeValue, mode: string): string {
  return `sha256:${createHash("sha256").update(stableJson({ theme, mode })).digest("hex")}`
}

/** The name a synced theme is reported by: its own name, or the shape it arrived in. */
export function hostThemeName(theme: HostThemeValue): string {
  if (typeof theme === "string") return theme
  const name = theme.name
  if (typeof name === "string" && name.trim() !== "") return name.trim()
  if (theme.seed !== undefined) return "seed-custom"
  if (theme.variants !== undefined) return "variant-custom"
  return "custom"
}

/**
 * The polarity a synced theme draws in: the caller's, else the theme's own resolved mode. A saved dark theme, a built-in
 * `dark` and an inline `{ mode: "dark" }` all answer `dark`; nothing is assumed from the fact that a name is not built in.
 */
async function modeOf(sources: ThemeSources, input: SyncThemeInput & { readonly theme: HostThemeValue }): Promise<"light" | "dark"> {
  if (input.mode === "light" || input.mode === "dark") return input.mode
  const resolved = await resolveThemeAsked(sources, input.theme as never)
  return resolved.mode
}

/** The polarity the store reads for an input it was handed directly, without a theme chain to resolve. */
function storedModeOf(theme: HostThemeValue): "light" | "dark" {
  if (typeof theme === "string") {
    const builtin = builtinThemes()[theme.trim().toLowerCase()]
    if (builtin) return builtin.mode
  }
  if (theme && typeof theme === "object" && theme.mode === "dark") return "dark"
  return "light"
}

/** Validates one sync and copies the theme, so a caller that reuses its object cannot change what was stored. */
function normalised(input: SyncThemeInput & { readonly theme: HostThemeValue }): SyncedHostTheme {
  const theme = input.theme
  let stored: HostThemeValue
  if (typeof theme === "string") {
    const name = theme.trim()
    if (name === "") throw new ChartsError("THEME_INVALID", "The synced theme name is empty.", "Sync a theme name, or the theme object itself.", "/theme")
    stored = name
  } else if (theme && typeof theme === "object" && !Array.isArray(theme)) {
    checkThemeDefinition(theme)
    stored = { ...theme }
  } else {
    throw new ChartsError("THEME_INVALID", "The synced theme must be a theme name or a theme object.", "Sync a name such as \"dark\", or an object with colors, a seed, or variants.", "/theme")
  }
  const mode = input.mode === "light" || input.mode === "dark" ? input.mode : storedModeOf(stored)
  const revision = typeof input.revision === "string" && input.revision.trim() !== "" ? input.revision.trim() : hostThemeRevision(stored, mode)
  return { theme: stored, mode, revision, ...(input.sessionID !== undefined && input.sessionID !== "" ? { sessionID: input.sessionID } : {}) }
}

/**
 * The in-memory registry of synced themes. Per-session themes are held least-recently-used first, so the oldest is
 * dropped once MAX_SYNCED_THEMES sessions hold one; the location-wide theme is held beside them.
 */
export function createHostThemeStore(limit = MAX_SYNCED_THEMES): HostThemeStore {
  const bySession = new Map<string, SyncedHostTheme>()
  let locationDefault: SyncedHostTheme | undefined
  return {
    get size() {
      return bySession.size
    },
    sync(input) {
      const synced = normalised(input)
      if (synced.sessionID === undefined) {
        locationDefault = synced
        return synced
      }
      // Re-inserting moves a session to the most-recently-used end.
      bySession.delete(synced.sessionID)
      bySession.set(synced.sessionID, synced)
      while (bySession.size > limit) {
        const oldest = bySession.keys().next()
        if (oldest.done) break
        bySession.delete(oldest.value)
      }
      return synced
    },
    forSession(sessionID) {
      if (sessionID === undefined) return undefined
      const synced = bySession.get(sessionID)
      if (synced === undefined) return undefined
      bySession.delete(sessionID)
      bySession.set(sessionID, synced)
      return synced
    },
    default() {
      return locationDefault
    },
    clear(sessionID) {
      if (sessionID === undefined) {
        const had = locationDefault !== undefined
        locationDefault = undefined
        return had
      }
      return bySession.delete(sessionID)
    },
  }
}

/**
 * Which theme a tool call resolves, in the order a host expects: the one the call named, then the live theme synced for
 * its session, then the live theme synced for the location, then the plugin's configured default, and finally nothing
 * (which reads the workspace's own theme file when there is one).
 */
export function effectiveThemeInput(
  explicitTheme: HostThemeValue | undefined,
  sessionID: string | undefined,
  hostStore: Pick<HostThemeStore, "forSession" | "default"> | undefined,
  defaultTheme: string | undefined,
): HostThemeValue | undefined {
  if (explicitTheme !== undefined) return explicitTheme
  const session = hostStore?.forSession(sessionID)
  if (session !== undefined) return session.theme
  const location = hostStore?.default()
  if (location !== undefined) return location.theme
  return defaultTheme
}

// ---------------------------------------------------------------------------------------------------------------
// The contract lives in theme-contract.ts and is declared there once; this module registers it.

export type ChartsThemeRpcType = typeof ChartsThemeContract

/** What a failed method returns: the typed code and its one next step, as every other Charts refusal does. */
function refusal<T>(cause: unknown, error: (type: "refused", message: string, data: { code: string; next: string }) => T): T {
  if (cause instanceof ChartsError) return error("refused", cause.message, { code: cause.code, next: cause.hint })
  throw cause
}

/** A named theme that a sync may use: a built-in, a saved theme, or one from the plugin's options. */
function checkThemeName(sources: ThemeSources, name: string): void {
  const builtins = builtinThemes()
  if (builtins[name]) return
  const saved = savedThemeNames(sources)
  if (saved.includes(name)) return
  const all = [...Object.keys(builtins), ...saved]
  const close = suggest(name, all)
  throw new ChartsError("THEME_NOT_FOUND", `There is no theme "${name}".${close.length ? ` Did you mean ${close.map(entry => `"${entry}"`).join(" or ")}?` : ""}`, `Use one of: ${all.join(", ")}; or sync the theme's own tokens as an object.`, "/theme")
}

interface ThemeRpcRegistration {
  readonly events: { readonly emit: (name: "changed", data: Record<string, unknown>) => Promise<void> }
  dispose(): Promise<void> | void
}

type RpcLike = Pick<Plugin.Context["rpc"], "register">

/**
 * Registers `charts.theme` against a store. The returned function unregisters it, so the plugin's own cleanup can
 * await every registration it made.
 */
export async function registerThemeRpc(rpc: RpcLike, store: HostThemeStore, sources: ThemeSources): Promise<() => Promise<void>> {
  type Emit = (name: "changed", data: Record<string, unknown>) => Promise<void>
  let emit: Emit | undefined
  // A `sync` may arrive while `rpc.register` is still resolving, and `reg.emit` does not exist until it does: the
  // events are held here and sent the moment it is assigned, so the first theme a host pushes is never lost.
  const pending: { name: "changed"; data: Record<string, unknown> }[] = []
  const notify = async (name: "changed", data: Record<string, unknown>): Promise<void> => {
    if (emit === undefined) {
      pending.push({ name, data })
      return
    }
    await emit(name, data)
  }
  const registration = (await rpc.register(ChartsThemeContract, {
    sync: async (input, context) => {
      try {
        const sync = (input ?? {}) as SyncThemeInput
        if (sync.theme === undefined) throw new ChartsError("THEME_INVALID", "A theme sync needs a theme.", "Sync a theme name, or the theme object itself.", "/theme")
        if (typeof sync.theme === "string") {
          const name = sync.theme.trim()
          if (name === "") throw new ChartsError("THEME_INVALID", "The synced theme name is empty.", "Sync a theme name, or the theme object itself.", "/theme")
          checkThemeName(sources, name)
        }
        // The theme is resolved here, so the polarity a saved dark theme draws in is read from the theme itself.
        const mode = await modeOf(sources, { ...sync, theme: sync.theme })
        const synced = store.sync({ ...sync, mode, theme: sync.theme })
        const themeName = hostThemeName(synced.theme)
        await notify("changed", { revision: synced.revision, mode: synced.mode, themeName, ...(synced.sessionID !== undefined ? { sessionID: synced.sessionID } : {}) })
        return { ok: true, applied: true, revision: synced.revision, mode: synced.mode, themeName }
      } catch (cause) {
        return refusal(cause, context.error)
      }
    },
    get: async (input) => {
      const query = (input ?? {}) as { sessionID?: string }
      const synced = store.forSession(query.sessionID) ?? store.default() ?? null
      if (synced === null) return { found: false, revision: null, theme: null }
      return {
        found: true,
        revision: synced.revision,
        mode: synced.mode,
        themeName: hostThemeName(synced.theme),
        theme: { theme: synced.theme, mode: synced.mode, revision: synced.revision, ...(synced.sessionID !== undefined ? { sessionID: synced.sessionID } : {}) },
      }
    },
    clear: async (input) => ({ cleared: store.clear(((input ?? {}) as { sessionID?: string }).sessionID) }),
  })) as unknown as ThemeRpcRegistration
  emit = registration.events?.emit
  for (const event of pending.splice(0)) await emit?.(event.name, event.data)
  return async () => void (await registration.dispose())
}
