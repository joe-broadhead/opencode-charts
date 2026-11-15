import type { Plugin } from "@opencode/plugin"
import { ChartsThemeContract } from "./theme-contract.js"
import type { ThemeSources } from "./themes/store.js"

/**
 * The host theme RPC's light half: its types, which theme a call resolves, and the contract's registration. The work
 * behind it (src/theme-rpc.ts: the store's checks and the theme chain, which carry the theme tokens' schemas) loads on
 * the first `sync`, so registering the RPC at every engine start reads none of it.
 */

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

export type ChartsThemeRpcType = typeof ChartsThemeContract

/** What a refused method returns, made by the RPC's own context. */
export interface ThemeContext {
  readonly error: (type: "refused", message: string, data: { code: string; next: string }) => unknown
}
/** The work behind each method. */
export interface ThemeHandlers {
  sync(input: unknown, context: ThemeContext): Promise<unknown>
  get(input: unknown): Promise<unknown>
  clear(input: unknown): Promise<unknown>
}
export type ThemeNotify = (name: "changed", data: Record<string, unknown>) => Promise<void>
export type RpcLike = Pick<Plugin.Context["rpc"], "register">

interface ThemeRpcRegistration {
  readonly events: { readonly emit: (name: "changed", data: Record<string, unknown>) => Promise<void> }
  dispose(): Promise<void> | void
}

/**
 * Registers `charts.theme` with the handlers `make` gives, made on the first call that needs them. The returned function
 * unregisters it.
 */
export async function registerThemeContract(rpc: RpcLike, make: (notify: ThemeNotify) => ThemeHandlers | Promise<ThemeHandlers>, idle?: Pick<ThemeHandlers, "get" | "clear">): Promise<() => Promise<void>> {
  let emit: ThemeNotify | undefined
  // A `sync` may arrive while `rpc.register` is still resolving, and `reg.emit` does not exist until it does: the
  // events are held here and sent the moment it is assigned, so the first theme a host pushes is never lost.
  const pending: { name: "changed"; data: Record<string, unknown> }[] = []
  const notify: ThemeNotify = async (name, data) => {
    if (emit === undefined) {
      pending.push({ name, data })
      return
    }
    await emit(name, data)
  }
  let made: Promise<ThemeHandlers> | undefined
  const handlers = () => {
    made ??= Promise.resolve().then(() => make(notify)).catch((cause: unknown) => {
      made = undefined
      throw cause
    })
    return made
  }
  const registration = (await rpc.register(ChartsThemeContract, {
    sync: async (input: unknown, context: unknown) => (await handlers()).sync(input, context as ThemeContext),
    // Before the handlers are made nothing has been synced, so `idle` may answer for an empty store.
    get: async (input: unknown) => (made === undefined && idle ? idle.get(input) : (await handlers()).get(input)),
    clear: async (input: unknown) => (made === undefined && idle ? idle.clear(input) : (await handlers()).clear(input)),
  } as never)) as unknown as ThemeRpcRegistration
  emit = registration.events?.emit
  for (const event of pending.splice(0)) await emit?.(event.name, event.data)
  return async () => void (await registration.dispose())
}

/**
 * Registers `charts.theme` for the plugin: the store is made, and src/theme-rpc.ts loaded, on the first call. Until a
 * theme is synced, `get` finds none and `clear` clears none, as an empty store answers, without loading anything.
 */
export async function registerDeferredThemeRpc(rpc: RpcLike, sources: ThemeSources): Promise<{ readonly stop: () => Promise<void>; readonly store: () => HostThemeStore | undefined }> {
  let store: HostThemeStore | undefined
  const stop = await registerThemeContract(rpc, async (notify) => {
    const module = await import("./theme-rpc.js")
    const made = module.createHostThemeStore()
    const work = module.themeHandlers(made, sources, notify)
    store = made
    return work
  }, {
    get: async () => ({ found: false, revision: null, theme: null }),
    clear: async () => ({ cleared: false }),
  })
  return { stop, store: () => store }
}
