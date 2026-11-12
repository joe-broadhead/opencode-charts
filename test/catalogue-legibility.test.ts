import { afterAll, describe, expect, test } from "bun:test"
import { CATALOGUE, exampleCall } from "../src/catalogue.ts"
import { closeVegaWorker } from "../src/engines/vega-pool.ts"
import { renderChart } from "../src/pipeline.ts"
import { contrast } from "../src/themes/contrast.ts"
import { workspace } from "./helpers.ts"

/**
 * What a reader needs from a catalogue example, measured in its SVG: every category labelled, value labels clear of
 * their marks, label text readable on what is under it, and a map that draws the countries without data. Each case
 * fails on the example it was written against (a funnel labelled inside its segments, a waterfall at 327 px wide, a
 * rose chart without labels, a choropleth that drew only its joined countries).
 */
const ws = workspace()
afterAll(async () => { ws.cleanup(); await closeVegaWorker() })
const THEMES = ["light", "dark"] as const
const render = async (id: string, theme: string) => (await renderChart({ ...exampleCall(CATALOGUE.find(c => c.id === id)!), theme, formats: ["svg"] }, ws.env, false)).svg

/** Text elements with their content, opacity, fill and anchor position. */
function texts(svg: string) {
  return [...svg.matchAll(/<text([^>]*)>([^<]*)<\/text>/g)].map(([, attrs, body]) => {
    const attr = (name: string) => attrs!.match(new RegExp(`\\s${name}="([^"]*)"`))?.[1]
    const t = attr("transform")?.match(/translate\(([-\d.e]+),\s*([-\d.e]+)\)/)
    return { text: body!.replaceAll("&amp;", "&"), aria: attr("aria-label") ?? "", opacity: attr("opacity"), fill: attr("fill") ?? "", x: Number(t?.[1] ?? attr("x") ?? 0), y: Number(t?.[2] ?? attr("y") ?? 0) }
  })
}
const visible = (svg: string) => texts(svg).filter(t => t.opacity !== "0").map(t => t.text)
const background = (svg: string) => svg.match(/<rect[^>]*\bfill="(#[0-9A-Fa-f]{6})"/)?.[1] ?? ""

/** Filled polygons (ECharts' funnel segments), in paint order. */
function polygons(svg: string) {
  return [...svg.matchAll(/<polygon points="([^"]*)"[^>]*\bfill="(#[0-9A-Fa-f]{6})"/g)].map(([, points, fill]) => {
    const n = points!.trim().split(/[\s,]+/).map(Number)
    return { pts: Array.from({ length: n.length / 2 }, (_, i) => [n[2 * i]!, n[2 * i + 1]!] as const), fill: fill! }
  })
}
function inside([x, y]: readonly [number, number], pts: readonly (readonly [number, number])[]) {
  let hit = false
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i]!, [xj, yj] = pts[j]!
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit
  }
  return hit
}

describe("catalogue examples a reader can read", () => {
  for (const theme of THEMES) {
    test(`waterfall (${theme}): every step is labelled, and each change sits above its bar`, async () => {
      const svg = await render("waterfall", theme)
      const shown = visible(svg)
      for (const step of ["Revenue", "Cost of goods", "Payroll", "Marketing", "Other income", "Profit"]) expect(shown).toContain(step)
      const tops = new Map<string, number>()
      for (const [, step, d] of svg.matchAll(/<path aria-label="step: ([^;]+);[^"]*"[^>]*aria-roledescription="bar"[^>]*\sd="([^"]*)"/g)) {
        const ys = [...d!.matchAll(/-?[\d.]+,(-?[\d.]+)/g)].map(m => Number(m[1]))
        tops.set(step!, Math.min(...ys))
      }
      expect(tops.size).toBe(6)
      const labels = texts(svg).filter(t => t.aria.startsWith("step: "))
      expect(labels.length).toBe(6)
      for (const label of labels) {
        const step = label.aria.match(/^step: ([^;]+);/)![1]!
        expect(label.y).toBeLessThanOrEqual(tops.get(step)!)
      }
    })

    test(`funnel (${theme}): labels read at 4.5:1 on what is under them, with grouped counts`, async () => {
      const svg = await render("funnel", theme)
      const bg = background(svg)
      expect(bg).not.toBe("")
      const segments = polygons(svg)
      expect(segments.length).toBeGreaterThanOrEqual(5)
      const labels = texts(svg).filter(t => /\d$/.test(t.text))
      expect(labels.map(l => l.text)).toEqual(["Visited  10,000", "Viewed product  6,200", "Added to basket  2,400", "Checkout  1,300", "Paid  980"])
      for (const label of labels) {
        // Sample along the label's run (Inter at 12 px averages under 7 px a character), take whatever is painted last.
        const width = label.text.length * 7
        for (let k = 0; k <= 8; k++) {
          const point = [label.x + (width * k) / 8, label.y] as const
          const under = segments.filter(s => inside(point, s.pts)).at(-1)?.fill ?? bg
          const ratio = contrast(label.fill, under)
          expect({ label: label.text, under, ratio: (ratio ?? 0) >= 4.5 }).toEqual({ label: label.text, under, ratio: true })
        }
      }
    })

    test(`radial (${theme}): every month is labelled and the colour has a titled legend`, async () => {
      const svg = await render("radial", theme)
      const shown = visible(svg)
      for (const month of ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]) expect(shown.some(t => t.startsWith(`${month} `))).toBe(true)
      expect(svg).toContain("role-legend")
      expect(shown).toContain("Rainfall (mm)")
    })

    test(`world choropleth (${theme}): every country is drawn, with a no-data fill in the legend`, async () => {
      const svg = await render("choropleth_world", theme)
      const bg = background(svg)
      const base = svg.match(/<g class="mark-shape role-mark layer_0_marks"[^>]*>(.*?)<\/g>/)?.[1] ?? ""
      const fills = [...base.matchAll(/<path [^>]*\bfill="([^"]*)"/g)].map(m => m[1])
      expect(fills.length).toBeGreaterThanOrEqual(177)
      const noData = fills[0]!
      expect(new Set(fills)).toEqual(new Set([noData]))
      expect(noData.toUpperCase()).not.toBe(bg.toUpperCase())
      expect(visible(svg)).toContain("No data")
      const valued = svg.match(/<g class="mark-shape role-mark layer_1_marks"[^>]*>(.*?)<\/g>/)?.[1] ?? ""
      const valueFills = [...valued.matchAll(/<path [^>]*\bfill="([^"]*)"/g)].map(m => m[1]!.toUpperCase())
      expect(valueFills.length).toBe(25)
      expect(valueFills).not.toContain(noData.toUpperCase())
    })
  }

  test("example axes and legends are titled for people, not by field name", async () => {
    for (const [id, title, raw] of [["lollipop", "Store", "store"], ["dumbbell", "Area", "area"], ["interactive_brush", "Channel", "channel"], ["line_band", "Units per day", "Units per day, Forecast"]] as const) {
      const shown = visible(await render(id, "light"))
      expect({ id, has: shown.includes(title), raw: shown.includes(raw) }).toEqual({ id, has: true, raw: false })
    }
  })
})
