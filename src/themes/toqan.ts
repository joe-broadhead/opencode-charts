import { readFileSync } from "node:fs"
import { join } from "node:path"
import { MONO } from "../fonts.js"
import type { ThemeTokens } from "./tokens.js"

/**
 * The Toqan themes, built from Toqan's own design tokens (assets/brand/toqan-tokens.json, W3C design-token format),
 * never retyped. Brand rules applied (toqan-decks brand.md): chart ground ochre/200 (`colour.viz.ground`); series
 * 1 and 2 are blue/700 and blue/500 (`colour.viz.series-*`), then the coral and blue scales; neutrals are paper, ink
 * and night only (no other greys); Geist for all chart text, at most Medium (no 600/700); no gradients or shadows;
 * coral/500 never as text on a light ground (2.9:1), so text is ink.
 *
 * `toqan` draws on the ochre chart ground. `toqan-night` draws on night with paper text: the token file gives
 * `viz.ground` ochre in night mode too, which is right for a chart panel on a night slide; this theme is for a chart
 * that sits directly on night.
 */
type Token = { $value: string; $extensions?: { "toqan.modes"?: Record<string, string> } }
type Tree = { [key: string]: Tree | Token }

export const TOQAN_FAMILY = "Geist"

export function toqanThemes(root: string): Record<string, ThemeTokens> {
  const tree = JSON.parse(readFileSync(join(root, "assets", "brand", "toqan-tokens.json"), "utf8")) as Tree
  const lookup = (path: string): Token => {
    let node: Tree | Token = tree
    for (const part of path.split(".")) node = (node as Tree)[part]!
    if (!node || typeof (node as Token).$value !== "string") throw new Error(`toqan token ${path} is missing`)
    return node as Token
  }
  /** A token's value in a mode, following `{references}`. */
  const value = (path: string, mode: "paper" | "night"): string => {
    const token = lookup(path)
    const raw = token.$extensions?.["toqan.modes"]?.[mode] ?? token.$value
    const ref = /^\{(.+)\}$/.exec(raw)
    return ref ? value(ref[1]!, mode) : raw
  }
  const p = (path: string) => value(`primitives.${path}`, "paper")

  const common = {
    font: { family: TOQAN_FAMILY, mono: MONO, size: 12, titleSize: 17, subtitleSize: 12, labelSize: 11, titleWeight: 500, files: [] },
    layout: { width: 560, height: 320, padding: 20, step: 24 },
    axis: { grid: true, gridDash: [], domain: true, ticks: false, labelPadding: 6 },
    marks: { strokeWidth: 2, pointSize: 48, cornerRadius: 0, opacity: 1 },
    legend: { orient: "bottom" as const },
  }
  const paper: ThemeTokens = {
    name: "toqan",
    description: "Toqan brand, paper: the ochre chart ground, Geist, platform blue then coral, ink text. From Toqan's design tokens.",
    mode: "light",
    colors: {
      background: value("colour.viz.ground", "paper"),
      text: value("colour.text.ink", "paper"),
      muted: value("colour.text.ink", "paper"),
      grid: value("colour.ground.page", "paper"),
      axis: value("colour.text.ink", "paper"),
      categorical: [value("colour.viz.series-1", "paper"), p("coral.500"), value("colour.viz.series-2", "paper"), p("coral.700"), p("blue.900"), p("coral.600")],
      sequential: ["50", "200", "500", "600", "700", "800", "900"].map(s => p(`blue.${s}`)),
      diverging: [p("coral.700"), p("coral.500"), p("coral.200"), value("colour.ground.page", "paper"), p("blue.200"), p("blue.500"), p("blue.700")],
      positive: value("colour.viz.series-1", "paper"),
      negative: p("coral.600"),
      neutral: value("colour.line.hairline", "paper"),
      highlight: p("coral.500"),
    },
    ...common,
  }
  const night: ThemeTokens = {
    ...paper,
    name: "toqan-night",
    description: "Toqan brand, night: the night ground, paper text, Geist, platform blue and coral. From Toqan's design tokens.",
    mode: "dark",
    colors: {
      background: value("colour.ground.page", "night"),
      text: value("colour.text.ink", "night"),
      muted: value("colour.text.ink", "night"),
      grid: value("colour.ground.cloth", "night"),
      axis: value("colour.line.hairline", "night"),
      categorical: [value("colour.symbol.platform.outer", "night"), p("coral.500"), p("blue.200"), p("coral.200"), value("colour.ui.action", "night"), p("ochre.200")],
      sequential: ["900", "800", "700", "600", "500", "200", "50"].map(s => p(`blue.${s}`)),
      diverging: [p("coral.500"), p("coral.700"), p("coral.900"), value("colour.ground.cloth", "night"), p("blue.900"), p("blue.700"), p("blue.500")],
      positive: value("colour.symbol.platform.outer", "night"),
      negative: p("coral.500"),
      neutral: value("colour.line.hairline", "night"),
      highlight: p("coral.500"),
    },
  }
  return { toqan: paper, "toqan-night": night }
}
