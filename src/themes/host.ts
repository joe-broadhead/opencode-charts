import { createHash } from "node:crypto"

/**
 * The themes hosts push for a session, and the one resolution a render uses.
 *
 * A host (the TUI, or any client that can confirm a write) syncs the colours its reader is looking at once; every
 * render in that session resolves it, and nothing is written to the workspace. The store is in memory, per session,
 * and bounded so a long-lived process cannot grow without limit. Nothing here touches the file system, the clock or the
 * network.
 */

/** What a host may sync: a theme name, or a theme object (tokens, a seed, or light and dark variants). */
export type HostThemeValue = string | Record<string, unknown>

/** A theme as it was synced, with the revision that identifies it. */
export interface SyncedHostTheme {
  readonly theme: HostThemeValue
  readonly mode: "light" | "dark"
  readonly revision: string
}

export interface SyncHostThemeInput {
  readonly theme: HostThemeValue
  readonly mode: "light" | "dark"
  readonly revision: string
}

export interface HostThemeStore {
  /** How many sessions hold a synced theme. */
  readonly size: number
  sync(sessionID: string, input: SyncHostThemeInput): SyncedHostTheme
  /** The theme synced for a session, if any; reading it marks the session as recently used. */
  forSession(sessionID: string | undefined): SyncedHostTheme | undefined
  /** Clears a session's theme; true when there was one. */
  clear(sessionID: string): boolean
}

/** A stable JSON text: keys sorted, so two equal themes hash to the same revision. */
function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`)
      .join(",")}}`
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

/** The most sessions whose synced theme is remembered: the least recently used is dropped first. */
export const MAX_SYNCED_THEMES = 256

/**
 * The in-memory registry of synced themes. Themes are held least-recently-used first, so the oldest session is
 * dropped once MAX_SYNCED_THEMES sessions hold one.
 */
export function createHostThemeStore(limit = MAX_SYNCED_THEMES): HostThemeStore {
  const bySession = new Map<string, SyncedHostTheme>()
  return {
    get size() {
      return bySession.size
    },
    sync(sessionID, input) {
      const synced: SyncedHostTheme = { theme: input.theme, mode: input.mode, revision: input.revision }
      // Re-inserting moves a session to the most-recently-used end.
      bySession.delete(sessionID)
      bySession.set(sessionID, synced)
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
    clear(sessionID) {
      return bySession.delete(sessionID)
    },
  }
}

/**
 * Which theme a call resolves, in the order a host expects: the one the call named, then the live theme synced for its
 * session, then the plugin's configured default, and finally nothing (which reads the workspace's own theme file when
 * there is one).
 */
export function effectiveThemeInput(
  explicitTheme: HostThemeValue | undefined,
  sessionID: string | undefined,
  hostStore: Pick<HostThemeStore, "forSession"> | undefined,
  defaultTheme: string | undefined,
): HostThemeValue | undefined {
  if (explicitTheme !== undefined) return explicitTheme
  const session = hostStore?.forSession(sessionID)
  if (session !== undefined) return session.theme
  return defaultTheme
}
