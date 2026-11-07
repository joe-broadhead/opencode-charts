import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { CATALOGUE } from "./catalogue.js"
import { ATLASES } from "./engines/common.js"
import type { Environment } from "./pipeline.js"
import { BUNDLED, bundledFonts, type FontBook } from "./fonts.js"
import { htmlProblem } from "./html.js"
import { localeIds } from "./locale.js"
import { pngProblem } from "./png.js"
import { MAX_SERIES, paletteReport } from "./themes/palette.js"
import { builtinThemes, savedThemeNames } from "./themes/store.js"
import { LIMITS } from "./safety.js"
import { CONTRACT_VERSION, DESCRIPTORS, NAMESPACE } from "./registry.js"

/**
 * What this build can do, computed rather than promised.
 *
 * Every field is read from the running build: the output formats are probed the way `/charts-status` probes them, the
 * palettes are measured, the font coverage is read from the bundled `cmap`, and the limits come from the same constant
 * the safety checks use. Nothing here is a copy of the README, so the two cannot drift.
 *
 * Adapted from the design of MCP Clearsight (`cesar-alves/mcp-clearsight@4912ede`), MIT OR Apache-2.0,
 * © 2026 The MCP Clearsight contributors: `capabilities` as the runtime contract, never advertising what the build
 * cannot do (`features.md` §4.7).
 */

export interface CapabilityView {
  readonly version: string
  readonly contract: string
  readonly namespace: string
  readonly formats: { readonly svg: true; readonly png: boolean; readonly html: boolean; readonly spec: true }
  readonly engines: readonly { readonly id: string; readonly draws: readonly string[]; readonly note?: string }[]
  readonly themes: readonly { readonly name: string; readonly mode: string; readonly categorical: { readonly published: number; readonly available: number; readonly generated: number }; readonly description?: string }[]
  readonly savedThemes: readonly string[]
  readonly fonts: readonly { readonly family: string; readonly weights: readonly number[]; readonly scripts: readonly string[]; readonly glyphs: number }[]
  readonly dataFormats: readonly string[]
  readonly locales: number
  readonly atlases: readonly { readonly name: string; readonly about: string }[]
  readonly limits: { readonly rows: number; readonly dataBytes: number; readonly specBytes: number; readonly dimension: number; readonly pngPixels: number }
  readonly catalogue: { readonly count: number; readonly byFamily: Record<string, number>; readonly byEngine: Record<string, number> }
  readonly tools: readonly { readonly name: string; readonly class: string; readonly readOnly: boolean; readonly stability: string }[]
  readonly determinism: { readonly exact: readonly string[]; readonly across: string; readonly tolerance: string; readonly sources: readonly string[] }
  readonly knownLimits: readonly string[]
  /** Every tool is a method of the tools RPC, so a script reaches all of them with no model. */
  readonly scriptable: boolean
}

const VERSION_FALLBACK = "0.0.0"

function packageVersion(packageRoot: string): string {
  try { return String((JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8")) as { version?: unknown }).version ?? VERSION_FALLBACK) }
  catch { return VERSION_FALLBACK }
}

/** Latin, Greek, Cyrillic and punctuation, from the code points the bundled faces actually carry. */
const SCRIPTS: readonly { readonly name: string; readonly ranges: readonly (readonly [number, number])[] }[] = [
  { name: "Latin", ranges: [[0x0041, 0x024f]] },
  { name: "Greek", ranges: [[0x0370, 0x03ff]] },
  { name: "Cyrillic", ranges: [[0x0400, 0x04ff]] },
  { name: "CJK", ranges: [[0x3040, 0x30ff], [0x4e00, 0x9fff]] },
  { name: "Hangul", ranges: [[0xac00, 0xd7af]] },
  { name: "Arabic", ranges: [[0x0600, 0x06ff]] },
  { name: "Hebrew", ranges: [[0x0590, 0x05ff]] },
  { name: "Devanagari", ranges: [[0x0900, 0x097f]] },
]

function scriptsOf(fonts: FontBook): { readonly scripts: readonly string[]; readonly glyphs: number } {
  const counts = SCRIPTS.map(s => ({ name: s.name, hit: 0 }))
  let glyphs = 0
  for (const face of fonts.list()) {
    for (const cp of face.advances.keys()) {
      glyphs++
      for (const [i, script] of SCRIPTS.entries()) {
        if (script.ranges.some(([lo, hi]) => cp >= lo && cp <= hi)) counts[i]!.hit++
      }
    }
  }
  return { scripts: counts.filter(c => c.hit > 0).map(c => c.name), glyphs }
}

export interface CapabilitySources extends Pick<Environment, "packageRoot" | "workspace" | "configuredThemes"> {}

export function capabilities(env: CapabilitySources): CapabilityView {
  const themes = builtinThemes(env.packageRoot)
  const fonts = bundledFonts(env.packageRoot)
  const coverage = scriptsOf(fonts)
  const families = [...new Set(BUNDLED.map(f => f.family))]
  const fontsReport = families.map(family => {
    const weights = BUNDLED.filter(f => f.family === family).map(f => f.weight)
    return { family, weights, scripts: coverage.scripts, glyphs: coverage.glyphs }
  })
  const byFamily: Record<string, number> = {}
  const byEngine: Record<string, number> = {}
  for (const entry of CATALOGUE) {
    byFamily[entry.family] = (byFamily[entry.family] ?? 0) + 1
    byEngine[entry.engine] = (byEngine[entry.engine] ?? 0) + 1
  }
  const png = pngProblem(env.packageRoot) === undefined && existsSync(join(env.packageRoot, "dist", "resvg.wasm"))
  const html = htmlProblem(env.packageRoot) === undefined
  const saved = (() => { try { return savedThemeNames({ workspace: env.workspace, packageRoot: env.packageRoot, configured: env.configuredThemes }) } catch { return [] as string[] } })()
  const hasCjk = coverage.scripts.includes("CJK")
  return {
    version: packageVersion(env.packageRoot),
    contract: CONTRACT_VERSION,
    namespace: NAMESPACE,
    formats: { svg: true, png, html, spec: true },
    engines: [
      { id: "vega-lite", draws: ["bar", "line", "area", "scatter", "histogram", "box plot", "heatmap", "pie and donut", "facets", "layers", "dual axis", "maps"], note: "Compiled to Vega and rendered in a worker with a wall-clock limit and a heap cap." },
      { id: "vega", draws: ["treemap", "sunburst", "tree and dendrogram", "force network", "word cloud"], note: "Vega's own wordcloud transform needs a canvas; this build ships a deterministic replacement with the same parameters." },
      { id: "echarts", draws: ["sankey", "chord", "gauge", "funnel", "radial", "calendar heatmap", "candlestick", "radar", "parallel coordinates"], note: "Server-side SVG with no DOM. Renders in the calling thread; its layouts are bounded by their inputs." },
    ],
    themes: Object.values(themes).map(t => ({ name: t.name, mode: t.mode, categorical: paletteReport(t), ...(t.description ? { description: t.description } : {}) })),
    savedThemes: saved,
    fonts: fontsReport,
    dataFormats: ["csv", "tsv", "json", "jsonl", "parquet"],
    locales: localeIds(env.packageRoot).length,
    atlases: Object.entries(ATLASES).map(([name, a]) => ({ name, about: a.about })),
    limits: { rows: LIMITS.dataRows, dataBytes: LIMITS.dataBytes, specBytes: LIMITS.specBytes, dimension: LIMITS.dimension, pngPixels: LIMITS.pngPixels },
    catalogue: { count: CATALOGUE.length, byFamily, byEngine },
    tools: DESCRIPTORS.map(t => ({ name: t.name, class: t.class, readOnly: t.readOnly, stability: t.stability })),
    determinism: {
      exact: ["svg", "png"],
      across: "same platform, byte for byte; across platforms, every coordinate equal to 10 significant digits",
      tolerance: "trigonometry (sunburst arcs, map projections) can differ in the last digits: Math.sin and Math.atan2 are the platform's",
      sources: ["seeded force and word-cloud layouts", "every temporal scale and time unit forced to UTC", "ids renumbered under a content hash", "bundled font bytes, never a system font", "no timestamps in output"],
    },
    knownLimits: [
      ...(hasCjk ? [] : ["Text beyond Latin, Greek and Cyrillic has no bundled glyphs (CJK, Hangul, Arabic, Hebrew, Devanagari): a theme can add a .ttf or .otf with font.files, and a label using an uncovered code point gets a FONT_GLYPH_MISSING warning."]),
      "Interactive HTML lays text out with the browser's metrics, so it can differ from the SVG by a pixel or two.",
      "The word cloud places horizontal and vertical words only.",
      "There is no PDF output and no Plotly or Mermaid input: the engines are Vega-Lite, Vega and ECharts.",
      `A categorical palette distinguishes up to ${MAX_SERIES} series; past a theme's published colours the rest are generated and are not a tested colour-blind-safe set.`,
    ],
    scriptable: true,
  }
}

/** The text form the model reads: the same facts, in the order they matter. */
export function describeCapabilities(view: CapabilityView): string {
  const formats = [view.formats.svg ? "SVG" : "", view.formats.png ? "PNG" : "", view.formats.html ? "HTML" : "", view.formats.spec ? "spec" : ""].filter(Boolean)
  return [
    `Charts ${view.version} (contract ${view.contract}), ${view.catalogue.count} chart types.`,
    `Outputs: ${formats.join(", ")}.`,
    `Engines: ${view.engines.map(e => `${e.id} (${e.draws.length} families)`).join(", ")}.`,
    `Themes: ${view.themes.map(t => `${t.name}${t.mode === "dark" ? "/dark" : ""} ${t.categorical.published}${t.categorical.generated ? `+${t.categorical.generated}` : ""}`).join(", ")}${view.savedThemes.length ? `; saved: ${view.savedThemes.join(", ")}` : ""}.`,
    `Fonts: ${view.fonts.map(f => `${f.family} ${f.weights.join("/")}`).join(", ")}; scripts: ${view.fonts[0]?.scripts.join(", ") ?? "none"}.`,
    `Data: ${view.dataFormats.join(", ")}; ${view.limits.rows.toLocaleString("en-US")} rows, ${Math.round(view.limits.dataBytes / 1024 / 1024)} MB, ${view.locales} locales.`,
    `Maps: ${view.atlases.map(a => a.name).join(", ")}.`,
    `Tools: ${view.tools.map(t => `${t.name} (${t.class})`).join(", ")}.`,
    `Determinism: ${view.determinism.exact.join(" and ")} byte-exact on one platform; ${view.determinism.tolerance}.`,
    `Known limits:\n${view.knownLimits.map(l => `- ${l}`).join("\n")}`,
  ].join("\n")
}
