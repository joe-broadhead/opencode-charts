import type { Issue } from "../errors.js"
import type { InteractionDefaults } from "../document/defaults.js"

/**
 * Interaction presets for recipe documents: which presets a recipe has, which combinations are allowed, what each one
 * needs from the formats, and what a result reports about them.
 *
 * Presets compile to Vega-Lite only (interactions/vegalite.ts): the recipes draw with Vega-Lite, and the ECharts
 * runtime keeps its own tested tooltip and legend behaviour for raw ECharts specs. Raw engine documents keep the
 * interaction their spec declares; presets on them are refused by the document schema.
 */

export type PresetName = keyof InteractionDefaults

/** The persistent selections: each needs the HTML runtime, and each has its own clear control. */
export const PERSISTENT = ["legend", "zoom", "brush"] as const

/** Whether an effective setting is a live behaviour (anything but the off/static/none value). */
const OFF: Readonly<Record<PresetName, string>> = { tooltip: "off", legend: "static", zoom: "none", brush: "none" }
export const isActive = (name: PresetName, value: string | undefined) => value !== undefined && value !== OFF[name]

/**
 * The allowed combinations of persistent presets. Tooltip combines with everything. Legend highlight combines with x
 * zoom (temporal line and area) and with the interval brush (scatter and bubble); zoom and brush are never offered on
 * the same recipe, so they never combine.
 */
export const ALLOWED_COMBINATIONS: readonly (readonly PresetName[])[] = [["legend", "zoom"], ["legend", "brush"]]

/** INTERACTION_UNSUPPORTED for a combination no recipe offers (zoom with brush), with the allowed alternatives. */
export function combinationIssues(effective: Partial<InteractionDefaults>): Issue[] {
  const active = PERSISTENT.filter(name => isActive(name, effective[name]))
  if (active.length < 2) return []
  const allowed = ALLOWED_COMBINATIONS.some(combo => active.every(name => combo.includes(name)))
  if (allowed) return []
  return [{
    level: "error", code: "INTERACTION_UNSUPPORTED",
    message: `${active.map(n => `${n} ${effective[n]}`).join(" with ")} is not a supported combination.`,
    path: `/interactions/${active[active.length - 1]}`,
    fix: `Combine legend highlight with x zoom (temporal line or area) or with the interval brush (scatter or bubble); tooltip combines with every preset. Keep one of ${active.join(" and ")}.`,
  }]
}

export interface InteractionReport {
  /** What the author set, exactly; omitted presets are absent. */
  readonly requested: Partial<InteractionDefaults>
  readonly effective: InteractionDefaults
  /** What each format carries. SVG and PNG are the static initial view, with no executable interaction. */
  readonly formats: {
    readonly html: InteractionDefaults & { readonly verified: false }
    readonly svg: "static initial view"
    readonly png: "static initial view"
  }
  /** True when HTML is required: a persistent preset is on, or a tooltip was asked for explicitly. */
  readonly htmlRequired: boolean
}

/**
 * The interactions a recipe render reports. `verified` is false: generating a file runs it nowhere, and only a browser
 * that opened it could say it reached ready.
 */
export function interactionReport(effective: InteractionDefaults, explicit: readonly PresetName[]): InteractionReport {
  const requested = Object.fromEntries(explicit.map(name => [name, effective[name]])) as Partial<InteractionDefaults>
  return {
    requested,
    effective,
    formats: { html: { ...effective, verified: false }, svg: "static initial view", png: "static initial view" },
    htmlRequired: htmlReasons(effective, explicit).length > 0,
  }
}

/** Why HTML is needed: each persistent preset that is on, and a tooltip the author asked for by name. */
export function htmlReasons(effective: InteractionDefaults, explicit: readonly PresetName[]): string[] {
  const reasons: string[] = PERSISTENT.filter(name => isActive(name, effective[name])).map(name => `interactions.${name} is ${effective[name]}`)
  if (explicit.includes("tooltip") && effective.tooltip === "auto") reasons.push("interactions.tooltip is set to auto")
  return reasons
}

/**
 * INTERACTION_FORMAT_MISMATCH when an explicit format list leaves out HTML that an explicitly requested interaction
 * needs. An omitted tooltip never creates the obligation: the default hover is not a request.
 */
export function formatMismatch(formats: readonly string[] | undefined, effective: InteractionDefaults, explicit: readonly PresetName[]): Issue | undefined {
  if (!formats || formats.includes("html")) return undefined
  const reasons = htmlReasons(effective, explicit).filter(reason => explicit.some(name => reason.startsWith(`interactions.${name} `)))
  if (!reasons.length) return undefined
  return {
    level: "error", code: "INTERACTION_FORMAT_MISMATCH",
    message: `The formats ${JSON.stringify(formats)} have no html, and ${reasons.join(" and ")}: SVG and PNG are static pictures of the initial view.`,
    path: "/formats",
    fix: "Add \"html\" to formats, or remove those interactions (tooltip \"off\", legend \"static\", zoom \"none\", brush \"none\").",
  }
}
