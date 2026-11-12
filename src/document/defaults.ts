/**
 * The defaults a chart document resolves when the author leaves a field out. A saved artifact records the ones it
 * used, separately from the authored document, so a replay uses them even after these change.
 */

/** The only chart document version this build reads and writes. */
export const DOCUMENT_VERSION = 1 as const
/** The artifact envelope's discriminator and version. */
export const ARTIFACT_FORMAT = "opencode-charts-artifact" as const
export const ARTIFACT_VERSION = 1 as const

export const LAYOUT_TARGETS = ["inline", "analysis", "report", "presentation", "paper"] as const
export type LayoutTarget = (typeof LAYOUT_TARGETS)[number]
export const LAYOUT_MODES = ["fixed", "responsive"] as const
export type LayoutMode = (typeof LAYOUT_MODES)[number]

export interface LayoutProfile {
  readonly target: LayoutTarget
  readonly mode: LayoutMode
  /** Outer logical pixels: title, axes, legend and padding included. */
  readonly width: number
  readonly height: number
  /** The smallest label size, in pixels, a chart for this target may use. */
  readonly minLabelSize: number
}

/** Version of the profile table below. A saved artifact records it with the profile it used. */
export const LAYOUT_PROFILE_VERSION = 1
export const DEFAULT_LAYOUT_TARGET: LayoutTarget = "inline"

/** Product defaults per target (not measured claims); explicit layout fields override them. */
export const LAYOUT_PROFILES: Readonly<Record<LayoutTarget, LayoutProfile>> = {
  inline: { target: "inline", mode: "responsive", width: 720, height: 420, minLabelSize: 11 },
  analysis: { target: "analysis", mode: "fixed", width: 900, height: 540, minLabelSize: 11 },
  report: { target: "report", mode: "fixed", width: 900, height: 540, minLabelSize: 11 },
  presentation: { target: "presentation", mode: "fixed", width: 1280, height: 720, minLabelSize: 18 },
  paper: { target: "paper", mode: "fixed", width: 1000, height: 650, minLabelSize: 11 },
}

export interface InteractionDefaults {
  readonly tooltip: "auto" | "off"
  readonly legend: "static" | "highlight"
  readonly zoom: "none" | "x"
  readonly brush: "none" | "interval"
}
export const INTERACTION_DEFAULTS: InteractionDefaults = { tooltip: "auto", legend: "static", zoom: "none", brush: "none" }

/** Used when neither the document nor the plugin's options name one. */
export const FALLBACK_LOCALE = "en-US"
export const FALLBACK_SEED = 1
