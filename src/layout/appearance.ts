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

/**
 * The profile's presentation defaults over a theme: every font size scaled by the same factor, so the smallest (the
 * label size) meets the floor and the theme's proportions stay; any size still under the floor is raised to it.
 * A theme that already meets the floor is returned unchanged.
 */
export function profileTypography(base: ThemeTokens, profile: LayoutProfile): ThemeTokens {
  const floor = profile.minLabelSize
  const smallest = Math.min(...FONT_SIZE_TOKENS.map(k => base.font[k]))
  if (smallest >= floor) return base
  const factor = floor / smallest
  const font = { ...base.font }
  for (const k of FONT_SIZE_TOKENS) font[k] = Math.max(floor, half(base.font[k] * factor))
  return { ...base, font }
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
