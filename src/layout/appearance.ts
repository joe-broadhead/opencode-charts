import { pointer, type Issue } from "../errors.js"
import { categoryColorDiagnostics, categoryKey } from "../document/category.js"
import { DocumentInvalid } from "../document/issues.js"
import type { LayoutProfile } from "../document/defaults.js"
import type { CategoryColorV1, CategoryDomainV1, PresentationTokenOverrides } from "../document/types.js"
import { themeColours } from "../themes/palette.js"
import { mergeTokens, type ThemeTokens } from "../themes/tokens.js"

/**
 * The effective look of a recipe chart, resolved in the brief's order:
 *
 *   captured named theme base → layout-profile presentation defaults → explicit appearance overrides
 *
 * (explicit layout dimensions come last, in the layout step). The profile's defaults are typography only: every font
 * size is scaled so the smallest one meets the profile's readability floor, whatever the theme. An override is the
 * author's own value and is never rescaled; one below the floor is refused (LAYOUT_UNSATISFIABLE), not shrunk to fit
 * and not silently raised.
 *
 * Category colours are positional over the captured colour domain: the category at domain index i takes palette
 * colour i (or its explicit entry), so a category keeps its colour across revisions, display sorts and selections, and
 * a new theme recolours by position without reordering anything.
 */

/** The theme's font sizes that draw text on a chart, with the override path each one has. */
export const FONT_SIZE_TOKENS = ["labelSize", "size", "subtitleSize", "titleSize"] as const
type FontSizeToken = (typeof FONT_SIZE_TOKENS)[number]

const half = (n: number) => Math.round(n * 2) / 2

/** The canvas the type scale is designed on: the responsive inline panel every theme's sizes are drawn for. */
const TYPE_REFERENCE_AREA = 720 * 420
/** The most a larger canvas enlarges the heading, the subtitle and the axis titles. */
const MAX_DISPLAY_SCALE = 1.4

/**
 * The typographic step a profile's canvas earns over the reference panel: 1 for a canvas of the reference size or
 * smaller (so `inline` returns a theme unchanged), rising with the square root of the canvas's area and capped, so a
 * report's 900 × 540 gets 1.27 and paper's 1000 × 650 the full 1.4.
 */
export function displayScale(profile: LayoutProfile): number {
  const ratio = Math.sqrt((profile.width * profile.height) / TYPE_REFERENCE_AREA)
  return ratio <= 1 ? 1 : Math.min(MAX_DISPLAY_SCALE, Math.round(ratio * 100) / 100)
}

/**
 * The profile's presentation defaults over a theme: every font size scaled by the same factor, so the smallest (the
 * label size) meets the floor and the theme's proportions stay; any size still under the floor is raised to it.
 * A theme that already meets the floor is returned unchanged on a canvas of the reference size.
 *
 * Once the label size meets the floor, a larger canvas also gets a proportional display step: the title, subtitle and
 * axis title grow (never the labels, which sit at the readable floor where paper and screens want them) and the inner
 * padding opens up, so a report or a print page is not an inline panel with more white around it.
 */
export function profileTypography(base: ThemeTokens, profile: LayoutProfile): ThemeTokens {
  const floor = profile.minLabelSize
  const smallest = Math.min(...FONT_SIZE_TOKENS.map(k => base.font[k]))
  const floorMet = smallest >= floor
  const display = floorMet ? displayScale(profile) : 1
  if (floorMet && display === 1) return base
  const factor = floorMet ? 1 : floor / smallest
  const font = { ...base.font }
  for (const k of FONT_SIZE_TOKENS) {
    const raised = base.font[k] * factor
    // A label keeps to the floor; the heading, subtitle and axis title take the display step too.
    font[k] = Math.max(floor, half(k === "labelSize" ? raised : raised * display))
  }
  const layout = display > 1 ? { ...base.layout, padding: half(base.layout.padding * (1 + (display - 1) / 2)) } : base.layout
  return { ...base, font, layout }
}

export interface AppearanceInput {
  /** The captured named theme's tokens (frozen in the artifact). */
  readonly base: ThemeTokens
  readonly profile: LayoutProfile
  readonly overrides?: PresentationTokenOverrides
  readonly categoryColors?: readonly CategoryColorV1[]
  /** The captured colour domain, when the recipe has one. */
  readonly categories?: CategoryDomainV1
}

export interface ResolvedAppearance {
  readonly tokens: ThemeTokens
  /** One colour per domain category, by position: the scale range that goes with the captured domain. */
  readonly colorRange?: readonly string[]
  /** Warnings (CATEGORY_COLOR_UNUSED). Errors are thrown as DocumentInvalid. */
  readonly issues: readonly Issue[]
}

/** A `theme:<token>` colour reference, resolved against the effective tokens. */
const SEMANTIC = /^theme:([a-z]+)$/

/** Resolves the effective tokens and category colours. Throws DocumentInvalid when an override breaks the floor. */
export function resolveAppearance(input: AppearanceInput): ResolvedAppearance {
  const errors: Issue[] = []
  const floor = input.profile.minLabelSize
  const overrides = input.overrides as { font?: Partial<Record<FontSizeToken, number>> } | undefined
  for (const k of FONT_SIZE_TOKENS) {
    const size = overrides?.font?.[k]
    if (typeof size === "number" && size < floor) errors.push({
      level: "error", code: "LAYOUT_UNSATISFIABLE",
      message: `appearance.overrides.font.${k} is ${size} px, below the ${floor} px readability floor of the ${input.profile.target} layout.`,
      path: pointer(["appearance", "overrides", "font", k]),
      fix: `Use ${floor} px or more, remove the override (the ${input.profile.target} profile sets readable sizes), or choose a layout.target with a lower floor.`,
    })
  }
  const tokens = mergeTokens(profileTypography(input.base, input.profile), (input.overrides ?? {}) as never)

  let colorRange: string[] | undefined
  const warnings: Issue[] = []
  const domain = input.categories?.domain
  if (domain) {
    const palette = themeColours(tokens, Math.max(1, domain.length))
    const explicit = new Map<string, { color: string; index: number }>()
    input.categoryColors?.forEach((entry, index) => explicit.set(categoryKey(entry.value), { color: entry.color, index }))
    colorRange = domain.map((value, i) => {
      const given = explicit.get(categoryKey(value))
      if (!given) return palette[i % palette.length]!
      const semantic = SEMANTIC.exec(given.color)
      if (!semantic) return given.color
      const token = (tokens.colors as Record<string, unknown>)[semantic[1]!]
      if (typeof token === "string") return token
      errors.push({ level: "error", code: "DOCUMENT_INVALID", message: `${given.color} is not a colour token of the theme.`, path: pointer(["appearance", "categoryColors", given.index, "color"]), fix: `Use one of ${Object.entries(tokens.colors).filter(([, v]) => typeof v === "string").map(([k]) => `theme:${k}`).join(", ")}, or a literal colour.` })
      return palette[i % palette.length]!
    })
    if (input.categoryColors?.length) warnings.push(...categoryColorDiagnostics(input.categoryColors, domain))
  }
  if (errors.length) throw new DocumentInvalid(errors)
  return { tokens, ...(colorRange ? { colorRange } : {}), issues: warnings }
}
