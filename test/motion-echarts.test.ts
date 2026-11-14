// ECharts 6 motion: a seeded random for the layouts ECharts decides at random, the matrix timeline builders whose
// frames also render to SVG, portable zero-script CSS motion on any engine's SVG, the deterministic GIF exporter, and
// the story page. Every test here is also a determinism test: the same input must give the same bytes.
import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { extractTimelineFrameSvgOptions } from "../src/engines/echarts-custom.ts"
import { prepareECharts, renderECharts, serialisableOption, ssrOption } from "../src/engines/echarts.ts"
import { bundledFonts } from "../src/fonts.ts"
import { contentSecurityPolicy } from "../src/html.ts"
import { resolveLocale } from "../src/locale.ts"
import { generateProgressiveRevealFrames, MAX_GIF_FRAMES, renderSvgFramesToGif } from "../src/motion/gif.ts"
import { buildStoryHtml } from "../src/motion/story-html.ts"
import { animateSvg, MAX_ANIMATED_MARKS, polylineLength, REDUCED_MOTION } from "../src/motion/svg-animate.ts"
import { mulberry32, withSeededRandom } from "../src/prng.ts"
import { checkRenderedSvg } from "../src/safety.ts"
import { builtinThemes } from "../src/themes/store.ts"
import { ROOT } from "./helpers.ts"

const theme = builtinThemes()["light"]!
const fonts = bundledFonts(ROOT)
const locale = resolveLocale(ROOT)
const golden = (name: string) => readFileSync(join(ROOT, "test", "golden", `${name}.svg`), "utf8")

/** A category axis with `jitter`, which ECharts places with `Math.random` during layout: the beeswarm case. */
const BEESWARM = {
  xAxis: { type: "category", data: ["a", "b", "c"], jitter: 24, jitterOverlap: true },
  yAxis: { type: "value" },
  series: [{ type: "scatter", symbolSize: 10, data: [["a", 10], ["a", 12], ["a", 11], ["b", 15], ["b", 17], ["c", 14]] }],
}

const GIF_HEADER = "GIF89a"

/** An ECharts line chart, whose mark is a stroke a reader can watch being drawn. */
const LINE = {
  xAxis: { type: "category", data: ["a", "b", "c", "d", "e"] },
  yAxis: { type: "value" },
  series: [{ type: "line", showSymbol: false, data: [3, 7, 4, 9, 6] }],
}

describe("a seeded random makes ECharts' random layouts deterministic", () => {
  test("mulberry32 gives the same sequence for the same seed, in [0, 1)", () => {
    const first = Array.from({ length: 5 }, mulberry32(42))
    const second = Array.from({ length: 5 }, mulberry32(42))
    expect(first).toEqual(second)
    expect(first.every(value => value >= 0 && value < 1)).toBe(true)
    expect(Array.from({ length: 5 }, mulberry32(7))).not.toEqual(first)
  })
  test("withSeededRandom restores Math.random, and does so when the work throws", () => {
    const original = Math.random
    expect(withSeededRandom(9, () => Math.random())).toBe(mulberry32(9)())
    expect(Math.random).toBe(original)
    expect(() => withSeededRandom(9, () => { throw new Error("boom") })).toThrow("boom")
    expect(Math.random).toBe(original)
  })
  test("an ECharts beeswarm rendered twice with seed 42 is byte-identical, and another seed moves it", () => {
    const one = renderECharts(BEESWARM, theme, fonts, 420, 260, 42)
    const two = renderECharts(BEESWARM, theme, fonts, 420, 260, 42)
    expect(one).toBe(two)
    expect(renderECharts(BEESWARM, theme, fonts, 420, 260, 7)).not.toBe(one)
    checkRenderedSvg(one)
  })
  test("the five-argument call still works, and the default seed is 1", () => {
    expect(renderECharts(BEESWARM, theme, fonts, 420, 260)).toBe(renderECharts(BEESWARM, theme, fonts, 420, 260, 1))
  })
  test("the static option has no animation and no timeline scrubber; the page's option keeps both", () => {
    const option = { ...BEESWARM, series: [{ type: "scatter", animationDuration: 800, data: [["a", 1]] }], timeline: { data: ["2020", "2021"], autoPlay: true } }
    const still = ssrOption(option)
    expect(still.animation).toBe(false)
    expect((still.timeline as Record<string, unknown>).show).toBe(false)
    // The caller's option is untouched, so the interactive page still animates and still has its timeline.
    expect((option.timeline as Record<string, unknown>).show).toBeUndefined()
    expect((option.series[0] as Record<string, unknown>).animationDuration).toBe(800)
  })
  test("an option that asks for animation keeps it in the page; `animateHtml` turns it on, and SSR never animates", () => {
    // The page's first frame is the static SVG, so only a spec that asks for motion animates on arrival.
    expect(prepareECharts(BEESWARM, { theme, locale }).option.animation).toBe(false)
    const animated = { ...BEESWARM, animation: true, animationDuration: 900 }
    const prepared = prepareECharts(animated, { theme, locale })
    expect(prepared.option.animation).toBe(true)
    expect(serialisableOption(prepared.option).animation).toBe(true)
    expect(ssrOption(prepared.option).animation).toBe(false)
    expect(prepared.option.animation).toBe(true)
    const asked = prepareECharts(BEESWARM, { theme, locale, animateHtml: true })
    expect(asked.option.animation).toBeUndefined()
    expect(serialisableOption(asked.option).animation).toBeUndefined()
  })
})

describe("an ECharts timeline unfolds into one frame per step", () => {
  const timeline = {
    baseOption: { xAxis: { type: "category", data: ["a", "b", "c"] }, yAxis: { type: "value" }, series: [{ type: "bar", data: [1, 2, 3] }] },
    timeline: { data: ["2025", "2026"], autoPlay: true },
    options: [{ series: [{ type: "bar", data: [2, 3, 1] }] }, { series: [{ type: "bar", data: [4, 1, 6] }] }],
  }

  test("every frame is a chart on its own, with the timeline hidden and its own data merged in", () => {
    const frames = extractTimelineFrameSvgOptions(timeline)
    expect(frames).toHaveLength(2)
    frames.forEach((frame, index) => {
      expect((frame.timeline as Record<string, unknown>).show).toBe(false)
      expect((frame.timeline as Record<string, unknown>).currentIndex).toBe(index)
      checkRenderedSvg(renderECharts(frame, theme, fonts, 480, 300))
    })
    expect((frames[1]!.series as { data: number[] }[])[0]!.data).toEqual([4, 1, 6])
    // The base option is read, never changed: the page still has its own timeline to play.
    expect((timeline.timeline as Record<string, unknown>).show).toBeUndefined()
    expect((timeline.options[1]!.series[0] as { data: number[] }).data).toEqual([4, 1, 6])
  })

  test("a timeline with no frames unfolds to nothing rather than throwing", () => {
    expect(extractTimelineFrameSvgOptions({ timeline: { data: ["2025"] }, series: [] })).toEqual([])
  })
})

describe("portable CSS motion on any engine's SVG", () => {
  const drawings = { vega: golden("line"), echarts: renderECharts(LINE, theme, fonts, 420, 260, 3) } as const
  for (const mode of ["draw", "stagger", "entrance", "pulse"] as const) {
    test(`${mode}: keyframes, the reduced-motion rule, no script, and the same bytes twice`, () => {
      for (const [engine, svg] of Object.entries(drawings)) {
        const out = animateSvg(svg, { mode })
        expect(out).toBe(animateSvg(svg, { mode }))
        expect(out).toContain(`@keyframes charts-${mode === "stagger" || mode === "entrance" ? "rise" : mode === "draw" ? "draw" : "pulse"}`)
        expect(out).toContain(REDUCED_MOTION)
        expect(out).toContain("@media (prefers-reduced-motion: reduce)")
        expect(out).not.toMatch(/\son[a-z]+=/)
        expect(out).not.toContain("<script")
        checkRenderedSvg(out)
        if (mode === "draw") expect(out).toContain("stroke-dasharray")
        if (mode === "stagger") expect(out).toContain("--charts-delay:")
        expect(out.length).toBeGreaterThan(svg.length)
      }
    })
  }
  test("none returns the drawing unchanged", () => {
    expect(animateSvg(drawings.vega, { mode: "none" })).toBe(drawings.vega)
  })
  test("no element starts later than 900 ms, and no more than 60 animate", () => {
    const many = renderECharts({ ...BEESWARM, series: [{ type: "bar", data: ["a", "b", "c"].flatMap(category => [1, 2, 3, 4, 5].map(v => [category, v])) }] }, theme, fonts, 900, 500, 5)
    const out = animateSvg(many, { mode: "stagger", staggerMs: 120 })
    const delays = [...out.matchAll(/--charts-delay:(\d+)ms/g)].map(m => Number(m[1]))
    expect(delays.length).toBeLessThanOrEqual(MAX_ANIMATED_MARKS)
    for (const delay of delays) expect(delay).toBeLessThanOrEqual(900)
    expect((out.match(/animation:charts-rise/g) ?? []).length).toBeLessThanOrEqual(MAX_ANIMATED_MARKS)
  })
  test("a polyline is measured; a curve is left alone", () => {
    expect(polylineLength("M0,0L3,4L6,8")).toBe(10)
    expect(polylineLength("M0,0h10v10")).toBe(20)
    expect(polylineLength("M0,0C1,1 2,2 3,3")).toBeUndefined()
  })
  test("the reveal frames of one drawing differ only in how much they show", () => {
    const frames = generateProgressiveRevealFrames(golden("line"), 8)
    expect(frames).toHaveLength(8)
    expect(new Set(frames).size).toBe(8)
    for (const frame of frames) checkRenderedSvg(frame)
    expect(generateProgressiveRevealFrames(golden("line"), 8)).toEqual(frames)
  })
})

describe("deterministic animated files", () => {
  /** The six bytes a GIF starts with, as text: a file that is not a GIF says something else. */
  const gifHeader = (bytes: Uint8Array) => new TextDecoder().decode(bytes.slice(0, 6))
  const timelineOption = {
    baseOption: { xAxis: { type: "category", data: ["a", "b"] }, yAxis: { type: "value" }, series: [{ type: "bar", data: [1, 2] }] },
    timeline: { data: ["2024", "2025", "2026"] },
    options: [{ series: [{ type: "bar", data: [2, 3] }] }, { series: [{ type: "bar", data: [4, 1] }] }, { series: [{ type: "bar", data: [3, 5] }] }],
  }

  test("a timeline's frames become a GIF, byte for byte the same on two runs", async () => {
    const frames = extractTimelineFrameSvgOptions(timelineOption).map(frame => renderECharts(frame, theme, fonts, 480, 300))
    const one = await renderSvgFramesToGif(ROOT, frames, fonts, { fps: 6 })
    const two = await renderSvgFramesToGif(ROOT, frames, fonts, { fps: 6 })
    expect(gifHeader(one.gif)).toBe(GIF_HEADER)
    expect(one.gif.length).toBeGreaterThan(1000)
    expect(one.frames).toBe(3)
    expect(one.width).toBe(480)
    expect(Buffer.from(one.gif).equals(Buffer.from(two.gif))).toBe(true)
  })
  test("a single static chart becomes a smooth GIF through the progressive reveal", async () => {
    const frames = generateProgressiveRevealFrames(golden("bar"), 10)
    const one = await renderSvgFramesToGif(ROOT, frames, fonts, { fps: 12, holdLastFrames: 2 })
    const two = await renderSvgFramesToGif(ROOT, frames, fonts, { fps: 12, holdLastFrames: 2 })
    expect(gifHeader(one.gif)).toBe(GIF_HEADER)
    expect(one.frames).toBe(12)
    expect(Buffer.from(one.gif).equals(Buffer.from(two.gif))).toBe(true)
  })
  test("the caps hold: more than 60 frames is refused, and a big drawing is scaled into 1280×960", async () => {
    const frames = Array.from({ length: MAX_GIF_FRAMES + 1 }, () => golden("bar"))
    await expect(renderSvgFramesToGif(ROOT, frames, fonts)).rejects.toThrow(/SIZE_INVALID/)
    const wide = await renderSvgFramesToGif(ROOT, [generateProgressiveRevealFrames(golden("bar"), 2)[1]!], fonts, { scale: 4 })
    expect(wide.width).toBeLessThanOrEqual(1280)
    expect(wide.height).toBeLessThanOrEqual(960)
  })
})

describe("the story page", () => {
  const steps = [{ title: "Monday", caption: "The week starts", svg: golden("line") }, { title: "Tuesday", svg: golden("bar") }, { title: "Wednesday", caption: "Peak", svg: golden("line") }]
  const html = buildStoryHtml({ title: "Active users", description: "A week in three steps", steps, theme, fonts: fonts.resources() })

  test("is a self-contained page whose policy is the hash of its one script", () => {
    expect(html.startsWith("<!doctype html>")).toBe(true)
    const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]!)
    expect(scripts).toHaveLength(1)
    expect(html).toContain(`content="${contentSecurityPolicy(scripts)}"`)
    expect(contentSecurityPolicy(scripts)).toMatch(/^default-src 'none'; script-src 'sha256-[A-Za-z0-9+/]{43}='; /)
    expect(html).not.toContain("unsafe-eval")
    expect(html).not.toMatch(/\son[a-z]+=/)
    // The SVG namespace is the only URL in the file: nothing is fetched, linked or embedded from elsewhere.
    expect(html).not.toMatch(/(?:src|href)\s*=\s*"https?:/i)
    expect(html).not.toContain("url(http")
  })
  test("has a labelled play button, a scrubber, a speed selector, a caption and keyboard shortcuts", () => {
    expect(html).toContain('id="story-play" type="button" aria-pressed="false"')
    expect(html).toContain('id="story-scrubber" type="range" min="0" max="2"')
    expect(html).toContain('<option value="0.5">0.5×</option>')
    expect(html).toContain('<option value="1" selected>1×</option>')
    expect(html).toContain('<option value="2">2×</option>')
    expect(html).toContain('id="story-step-caption"')
    expect(html).toContain('aria-live="polite"')
    expect(html).toContain('event.key==="ArrowLeft"')
    expect(html).toContain('event.key==="ArrowRight"')
    expect(html).toContain('event.key===" "')
    // The first step is drawn, and the rest are in the page but hidden: the first paint needs no script.
    expect((html.match(/<figure class="story-step"/g) ?? []).length).toBe(3)
    expect(html).toContain('<figure class="story-step" data-step="0" aria-hidden="false">')
    expect(html).toContain('<figure class="story-step" data-step="1" hidden aria-hidden="true">')
    expect(html).toContain("font-display:block")
    expect(buildStoryHtml({ title: "Active users", description: "A week in three steps", steps, theme, fonts: fonts.resources() })).toBe(html)
  })
  test("a story with no steps is refused with a next step", () => {
    expect(() => buildStoryHtml({ title: "Empty", steps: [], theme })).toThrow(/SIZE_INVALID/)
  })
})
