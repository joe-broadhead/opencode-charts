import type { Issue } from "../errors.js"
import type { ThemeTokens } from "./tokens.js"

/** Parses #rgb, #rrggbb(aa) and rgb()/rgba() to sRGB 0..255. */
export function parseColor(value: string): [number, number, number] | undefined {
  const v = value.trim()
  const hex = /^#([0-9a-f]{3,8})$/i.exec(v)
  if (hex) {
    let h = hex[1]!
    if (h.length === 3 || h.length === 4) h = [...h.slice(0, 3)].map(c => c + c).join("")
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]
  }
  const rgb = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i.exec(v)
  if (rgb) return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])]
  return undefined
}

/** WCAG 2.x relative luminance. */
export function luminance([r, g, b]: [number, number, number]) {
  const lin = (c: number) => { const s = c / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4 }
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
}

/** WCAG contrast ratio between two colours, 1..21; undefined when either cannot be parsed. */
export function contrast(a: string, b: string): number | undefined {
  const ca = parseColor(a), cb = parseColor(b)
  if (!ca || !cb) return undefined
  const [hi, lo] = [luminance(ca), luminance(cb)].sort((x, y) => y - x) as [number, number]
  return (hi + 0.05) / (lo + 0.05)
}

/**
 * Checks a theme's text and marks against its background: text needs 4.5:1 (WCAG 1.4.3), secondary text and axes
 * 3:1 (1.4.11); a categorical colour under 1.5:1 is nearly invisible and is named.
 */
export function themeContrastIssues(theme: ThemeTokens): Issue[] {
  const issues: Issue[] = []
  const bg = theme.colors.background
  if (bg === "transparent") return issues
  const check = (name: string, colour: string, min: number, fix: string) => {
    const ratio = contrast(colour, bg)
    if (ratio !== undefined && ratio < min) issues.push({ level: "warning", code: "LOW_CONTRAST", message: `${name} ${colour} on ${bg} has contrast ${ratio.toFixed(2)}:1, under ${min}:1.`, path: `/theme/colors`, fix })
  }
  check("Text", theme.colors.text, 4.5, "Darken colors.text on a light background, or lighten it on a dark one.")
  check("Secondary text", theme.colors.muted, 3, "Raise the contrast of colors.muted.")
  theme.colors.categorical.forEach((colour, i) => check(`Series colour ${i + 1}`, colour, 1.5, "Replace that colour in colors.categorical; it disappears into the background."))
  return issues
}
