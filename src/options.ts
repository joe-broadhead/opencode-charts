import type { ThemeOverrides } from "./themes/tokens.js"

/** The plugin's options, as the manifest's schema declares them. */
export interface ChartsOptions {
  /** What the plugin's own methods may do without asking: everything, ask for changes, or reads only. */
  readonly access: "all" | "ask-changes" | "read-only"
  /** The theme every chart uses when a call names none. */
  readonly theme: string
  /** The locale numbers and dates are formatted in. */
  readonly locale: string
  /** The workspace folder files are written under. */
  readonly outDir: string
  /** Named themes from configuration. */
  readonly themes: Record<string, ThemeOverrides>
}

const ACCESS = ["all", "ask-changes", "read-only"] as const

/** Read the options from opencode.json. The register refuses an `access` value outside the three levels itself. */
export function options(raw: unknown): ChartsOptions {
  const value = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>
  const access = typeof value.access === "string" && (ACCESS as readonly string[]).includes(value.access) ? (value.access as ChartsOptions["access"]) : "all"
  return {
    access,
    theme: typeof value.theme === "string" ? value.theme : "light",
    locale: typeof value.locale === "string" ? value.locale : "en-US",
    outDir: typeof value.outDir === "string" ? value.outDir : "outputs/charts",
    themes: value.themes && typeof value.themes === "object" && !Array.isArray(value.themes) ? (value.themes as Record<string, ThemeOverrides>) : {},
  }
}
