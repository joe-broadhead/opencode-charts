// A size key (a legend with no colour scale) must stay visible on every theme's canvas: its symbols' effective colour,
// blended over the background as drawn, is measured from the SVG.
import { afterAll, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { closeVegaWorker } from "../src/engines/vega-pool.ts"
import { recipeDefinition } from "../src/recipes/definitions.ts"
import { contrast, parseColor } from "../src/themes/contrast.ts"
import { BUILTIN_THEMES } from "../src/themes/tokens.ts"
import { runTool } from "../src/tools.ts"
import { workspace } from "./helpers.ts"
import { draw } from "./support/documents.ts"

const ws = workspace()
const env = { ...ws.env, assertFiles: async () => undefined }
afterAll(async () => { ws.cleanup(); await closeVegaWorker() })

/** The size legend's symbols as drawn: fill blended over the canvas with fill-opacity × opacity, and its contrast. */
function sizeKeyContrast(svg: string, background: string): number[] {
  const legend = /aria-label="Symbol legend titled '[^']*' for size[\s\S]*?(?=<g class="mark-group role-legend"|$)/.exec(svg)?.[0]
  if (!legend) throw new Error("no size legend")
  const symbols = [...legend.matchAll(/role-legend-symbol[^>]*><path\b([^>]*)\/>/g)].map(m => m[1]!)
  expect(symbols.length).toBeGreaterThan(2)
  const bg = parseColor(background)!
  return symbols.map(attrs => {
    const fill = parseColor(/\bfill="([^"]+)"/.exec(attrs)![1]!)!
    const alpha = Number(/fill-opacity="([\d.]+)"/.exec(attrs)?.[1] ?? 1) * Number(/\bopacity="([\d.]+)"/.exec(attrs)?.[1] ?? 1)
    const drawn = fill.map((c, i) => Math.round(c * alpha + bg[i]! * (1 - alpha)))
    return contrast(`rgb(${drawn.join(",")})`, background)!
  })
}

test("a recipe bubble chart's size key reads at 3:1 or more against the canvas in every built-in theme", async () => {
  for (const theme of Object.keys(BUILTIN_THEMES)) {
    const doc = structuredClone(recipeDefinition("bubble").examples()[0]!.document) as Record<string, unknown>
    doc.appearance = { theme }
    const { result } = await draw(env, doc)
    for (const ratio of sizeKeyContrast(result.svg, BUILTIN_THEMES[theme]!.colors.background)) expect(ratio).toBeGreaterThanOrEqual(3)
  }
}, 60_000)

test("a legacy bubble spec's size key is drawn in the theme's muted text colour, not black, so it shows on dark", async () => {
  const example = (await runTool(env as never, "catalogue", { id: "bubble" })).output.example as Record<string, unknown>
  const out = (await runTool(env as never, "render", { ...example, theme: "dark", formats: ["svg"], name: "bubble-dark", inspect: false })).output as { files: { svg: string } }
  const svg = readFileSync(join(ws.dir, out.files.svg), "utf8")
  expect(svg).not.toMatch(/role-legend-symbol[^>]*><path\b[^>]*fill="black"/)
  // The spec's own translucent marks set the key's opacity; it stays clearly visible (black was about 1.1:1).
  for (const ratio of sizeKeyContrast(svg, BUILTIN_THEMES.dark!.colors.background)) expect(ratio).toBeGreaterThanOrEqual(2.5)
}, 60_000)
