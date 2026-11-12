// Recipe layout: the profile table's outer-size contract, the readability floor, the fixed three-candidate fitting
// policy, typed appearance overrides and stable category colours. Every drawing is measured from the SVG and PNG the
// renderer made, not from the planner's estimate.
import { afterAll, describe, expect, test } from "bun:test"
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { closeVegaWorker } from "../src/engines/vega-pool.ts"
import { DocumentInvalid, LAYOUT_PROFILES } from "../src/document/index.ts"
import { profileTypography, resolveAppearance } from "../src/layout/appearance.ts"
import { planCandidates, planLayout, PLANNER_LIMITS, wrapText, type PlannerInput } from "../src/layout/planner.ts"
import { BUILTIN_THEMES } from "../src/themes/tokens.ts"
import { textBoxes } from "../src/svg.ts"
import { bundledFonts } from "../src/fonts.ts"
import { ROOT, workspace } from "./helpers.ts"
import { draw, prepare } from "./support/documents.ts"
import { renderRecipe } from "../src/layout/fit.ts"

const ws = workspace()
const env = { ...ws.env, assertFiles: async () => undefined }
afterAll(async () => { ws.cleanup(); await closeVegaWorker() })

const LONG = ["Northern Europe and the Baltic states", "Southern Europe", "Middle East and North Africa", "Sub-Saharan Africa", "Latin America and the Caribbean", "East Asia and Pacific"]
const rows = LONG.flatMap((region, i) => ["Online", "Retail stores", "Wholesale partners"].map((channel, j) => ({ region, channel, revenue_eur: 1000 + i * 310 + j * 95 })))
const grouped = (layout: Record<string, unknown>, over: Record<string, unknown> = {}) => ({ version: 1, title: "Revenue by region and sales channel, first half of 2024", chart: { kind: "recipe", recipe: "grouped_bar", data: { rows }, bindings: { category: "region", series: "channel", value: "revenue_eur" }, options: { yTitle: "Revenue (€)" } }, layout, ...over })

const svgSize = (svg: string) => { const m = /<svg\b[^>]*\swidth="([\d.]+)"[^>]*\sheight="([\d.]+)"/.exec(svg)!; return { width: Number(m[1]), height: Number(m[2]) } }
const fontSizes = (svg: string) => [...svg.matchAll(/font-size="([\d.]+)px"/g)].map(m => Number(m[1]))
const pngSize = (bytes: Uint8Array) => { const v = new DataView(bytes.buffer, bytes.byteOffset); return { width: v.getUint32(16), height: v.getUint32(20) } }

describe("the layout profiles' outer-size contract (A09)", () => {
  for (const target of ["inline", "analysis", "report", "presentation", "paper"] as const) test(`${target}: long labels, a long title and a legend fit ${LAYOUT_PROFILES[target].width}×${LAYOUT_PROFILES[target].height} exactly, with no text under ${LAYOUT_PROFILES[target].minLabelSize} px`, async () => {
    const profile = LAYOUT_PROFILES[target]
    const { result, fitted } = await draw(env, grouped({ target }))
    expect(svgSize(result.svg)).toEqual({ width: profile.width, height: profile.height })
    expect({ width: result.width, height: result.height }).toEqual({ width: profile.width, height: profile.height })
    expect(Math.min(...fontSizes(result.svg))).toBeGreaterThanOrEqual(profile.minLabelSize)
    // Every label, the title and the legend are inside the canvas and clear of each other.
    expect(result.layout.clipped).toEqual([])
    expect(result.layout.overlaps).toEqual([])
    const report = fitted.report
    expect(report.requested).toEqual({ width: profile.width, height: profile.height })
    expect(report.actual).toEqual(report.requested)
    expect(report.floor).toBe(profile.minLabelSize)
    expect(report.fontSizes.label).toBeGreaterThanOrEqual(profile.minLabelSize)
    expect(report.plot!.width).toBeGreaterThanOrEqual(PLANNER_LIMITS.minPlotWidth)
    expect(report.plot!.x + report.plot!.width).toBeLessThanOrEqual(profile.width)
    expect(report.plot!.y + report.plot!.height).toBeLessThanOrEqual(profile.height)
    // Every category and series is still drawn: 6 regions × 3 channels.
    expect((result.svg.match(/<path [^>]*aria-roledescription="bar"/g) ?? []).length).toBe(18)
  }, 60_000)

  test("explicit width and height win over the target's, and the PNG is those pixels times the scale at 1x, 2x and 3x", async () => {
    const { result } = await draw(env, grouped({ target: "report", width: 640, height: 400 }), { formats: ["svg", "png"], scales: [1, 2, 3], name: "fixed" }, true)
    expect(svgSize(readFileSync(join(ws.dir, result.files.svg!), "utf8"))).toEqual({ width: 640, height: 400 })
    expect(result.files.png.map(p => pngSize(readFileSync(join(ws.dir, p))))).toEqual([{ width: 640, height: 400 }, { width: 1280, height: 800 }, { width: 1920, height: 1200 }])
  }, 60_000)

  test("adjustments are reported with a path and a reason, and the marks keep their data", async () => {
    const { fitted } = await draw(env, grouped({ width: 520, height: 420 }))
    expect(fitted.report.candidate.index).toBeGreaterThan(0)
    expect(fitted.report.adjustments.length).toBeGreaterThan(0)
    for (const a of fitted.report.adjustments) { expect(a.path).toMatch(/^\//); expect(a.reason.length).toBeGreaterThan(10) }
    expect(fitted.request.data!.rows).toEqual(fitted.presentation.rows)
    expect(fitted.presentation.rows).toHaveLength(18)
  }, 60_000)
})

describe("a size that cannot be met is refused, never stretched or shrunk (A10)", () => {
  test("a tiny outer size: LAYOUT_UNSATISFIABLE with the conflicts and alternatives, and no files", async () => {
    const prepared = await prepare(grouped({ width: 220, height: 160 }))
    const error = await renderRecipe(prepared, env, { formats: ["svg", "png"], name: "tiny", outDir: "outputs/tiny" }, true).catch(e => e)
    expect(error).toBeInstanceOf(DocumentInvalid)
    expect(error.code).toBe("LAYOUT_UNSATISFIABLE")
    expect(error.issues[0].path).toBe("/layout")
    expect(error.issues[0].message).toContain("220×160")
    expect(error.issues[0].message).toMatch(/needs \d+, has -?\d+/)
    expect(error.issues[0].fix).toMatch(/layout\.width|layout\.target/)
    expect(existsSync(join(ws.dir, "outputs", "tiny"))).toBe(false)
  }, 60_000)

  test("a font override below the profile's floor is refused at its path, not raised or shrunk", async () => {
    const prepared = await prepare(grouped({ target: "presentation" }, { appearance: { overrides: { font: { labelSize: 12 } } } }))
    const error = await renderRecipe(prepared, env, { formats: [] }, false).catch(e => e)
    expect(error.code).toBe("LAYOUT_UNSATISFIABLE")
    expect(error.issues[0].path).toBe("/appearance/overrides/font/labelSize")
    expect(error.issues[0].message).toContain("18 px")
  }, 60_000)

  test("an engine document asks for responsive layout: LAYOUT_UNSUPPORTED before anything is drawn", async () => {
    const error = await prepare({ version: 1, chart: { kind: "engine", spec: { mark: "bar" } }, layout: { mode: "responsive" } }).catch(e => e)
    expect(error.code).toBe("LAYOUT_UNSUPPORTED")
  })
})

test("A11: the same fixed-size document draws the same SVG and PNG bytes every time", async () => {
  const doc = grouped({ target: "analysis" })
  const a = await draw(env, doc, { formats: ["svg", "png"], name: "same-a" }, true)
  const b = await draw(env, doc, { formats: ["svg", "png"], name: "same-b" }, true)
  expect(readFileSync(join(ws.dir, a.result.files.svg!), "utf8")).toBe(readFileSync(join(ws.dir, b.result.files.svg!), "utf8"))
  expect(Buffer.compare(readFileSync(join(ws.dir, a.result.files.png[0]!)), readFileSync(join(ws.dir, b.result.files.png[0]!)))).toBe(0)
  expect(a.fitted.report).toEqual(b.fitted.report)
}, 60_000)

describe("the planner (shared by server and browser)", () => {
  const measure = (text: string, size: number) => text.length * size * 0.55
  const base: PlannerInput = { width: 720, height: 420, padding: 16, floor: 11, labelSize: 11, axisTitleSize: 12, titleSize: 16, labelPadding: 6, legendOrient: "right", title: "Revenue by region", x: { kind: "discrete", labels: LONG }, y: { kind: "continuous", labels: ["9,999"] }, legend: { kind: "symbol", labels: ["Online", "Retail stores"] } }

  test("always three candidates, in the fixed order, and the first feasible one is chosen", () => {
    const plans = planCandidates(base, measure)
    expect(plans.map(p => [p.candidate, p.name])).toEqual([[0, "as-designed"], [1, "wrapped"], [2, "compact"]])
    const outcome = planLayout(base, measure)
    expect(outcome.ok).toBe(true)
    if (outcome.ok) expect(outcome.plan).toEqual(plans.find(p => p.feasible)!)
  })

  test("the outcome does not depend on how long measuring takes, only on the measurements", () => {
    let slow = 0
    const a = planLayout(base, measure)
    const b = planLayout(base, (t, s) => { for (let i = 0; i < 2000; i++) slow += i; return measure(t, s) })
    expect(JSON.stringify(a)).toBe(JSON.stringify(b))
  })

  test("labels are wrapped or turned, never shortened, and every category keeps its label", () => {
    const outcome = planLayout({ ...base, width: 480 }, measure)
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    const s = outcome.plan.signals
    for (const [i, key] of s.charts_x_keys.entries()) expect(s.charts_x_lines[i]!.join(" ")).toBe(key)
    expect(s.charts_x_angle === 0 || s.charts_x_keys.length === 0).toBe(true)
  })

  test("below the floor there is no feasible candidate, at any size", () => {
    const outcome = planLayout({ ...base, labelSize: 9, width: 1600, height: 900 }, measure)
    expect(outcome.ok).toBe(false)
    if (!outcome.ok) expect(outcome.conflicts.some(c => c.what.includes("below the 11 px floor"))).toBe(true)
  })

  test("the work budget is counted in measurements, and spending it fails rather than guessing", () => {
    const many = Array.from({ length: PLANNER_LIMITS.maxMeasures + 10 }, (_, i) => `Category ${i}`)
    const outcome = planLayout({ ...base, x: { kind: "discrete", labels: many } }, measure)
    expect(outcome.ok).toBe(false)
    if (!outcome.ok) expect(outcome.budget).toBe(true)
  })

  test("is pure: it imports nothing and uses no host global, so the browser runtime bundles the same code", () => {
    const source = readFileSync(join(ROOT, "src", "layout", "planner.ts"), "utf8")
    expect(source).not.toMatch(/^\s*import\s/m)
    expect(source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "")).not.toMatch(/\b(Buffer|process|require|Bun|fetch|Date|Math\.random|performance)\b/)
  })

  test("wrapText keeps every word and refuses a word wider than the line", () => {
    const m = (s: string) => s.length * 6
    expect(wrapText("one two three", 60, 2, m)).toEqual(["one two", "three"])
    expect(wrapText("one two three", 60, 1, m)).toBeUndefined()
    expect(wrapText("unbreakableword", 30, 3, m)).toBeUndefined()
  })
})

describe("appearance: profile typography, typed overrides, stable category colours", () => {
  const light = BUILTIN_THEMES.light!, dark = BUILTIN_THEMES.dark!
  test("a profile raises a theme's type to its floor with the theme's proportions; a theme already above is unchanged", () => {
    const presentation = profileTypography(light, LAYOUT_PROFILES.presentation)
    expect(presentation.font.labelSize).toBe(18)
    expect(presentation.font.titleSize / presentation.font.labelSize).toBeCloseTo(light.font.titleSize / light.font.labelSize, 1)
    expect(profileTypography(light, LAYOUT_PROFILES.inline)).toBe(light)
    // print is 9 px: an inline chart raises it to the 11 px floor.
    expect(profileTypography(BUILTIN_THEMES.print!, LAYOUT_PROFILES.inline).font.labelSize).toBe(11)
  })

  test("order: theme base, then profile, then overrides; an override at or above the floor stays as written", () => {
    const resolved = resolveAppearance({ base: dark, profile: LAYOUT_PROFILES.presentation, overrides: { font: { titleSize: 40 }, colors: { grid: "#333333" } } })
    expect(resolved.tokens.font.titleSize).toBe(40)
    expect(resolved.tokens.font.labelSize).toBe(18)
    expect(resolved.tokens.colors.grid).toBe("#333333")
    expect(resolved.tokens.colors.background).toBe(dark.colors.background)
  })

  const domain = { role: "series" as const, field: "k", domain: [null, false, 1, "1", "b"] }
  test("colours follow the captured domain by position; an explicit entry is matched by typed identity", () => {
    const resolved = resolveAppearance({ base: light, profile: LAYOUT_PROFILES.inline, categories: domain, categoryColors: [{ value: "1", color: "#123456" }] })
    expect(resolved.colorRange).toHaveLength(5)
    expect(resolved.colorRange![3]).toBe("#123456") // the string "1"
    expect(resolved.colorRange![2]).toBe(light.colors.categorical[2]) // the number 1 keeps its palette colour
    expect(resolved.issues).toEqual([])
  })

  test("a new theme recolours by the same positions; a literal colour stays literal; a theme: colour resolves from the new theme (A13)", () => {
    const colors = [{ value: "b", color: "theme:negative" }, { value: null, color: "#ABCDEF" }]
    const inLight = resolveAppearance({ base: light, profile: LAYOUT_PROFILES.inline, categories: domain, categoryColors: colors })
    const inDark = resolveAppearance({ base: dark, profile: LAYOUT_PROFILES.inline, categories: domain, categoryColors: colors })
    expect(inLight.colorRange![4]).toBe(light.colors.negative)
    expect(inDark.colorRange![4]).toBe(dark.colors.negative)
    expect(inLight.colorRange![0]).toBe("#ABCDEF")
    expect(inDark.colorRange![0]).toBe("#ABCDEF")
    expect(inDark.colorRange![1]).toBe(dark.colors.categorical[1])
  })

  test("an entry for a category the chart does not have is reported (CATEGORY_COLOR_UNUSED), with the typed hint", () => {
    const resolved = resolveAppearance({ base: light, profile: LAYOUT_PROFILES.inline, categories: { ...domain, domain: [1, 2] }, categoryColors: [{ value: "2", color: "#000000" }] })
    expect(resolved.issues.map(i => [i.code, i.path])).toEqual([["CATEGORY_COLOR_UNUSED", "/appearance/categoryColors/0/value"]])
    expect(resolved.issues[0]!.fix).toContain("without quotes")
  })

  test("in a drawn chart, display sort never changes which category gets which colour, and the warning reaches the result", async () => {
    const pie = (sort: string) => ({ version: 1, chart: { kind: "recipe", recipe: "pie", data: { rows: [{ k: "b", v: 2 }, { k: "a", v: 5 }, { k: "c", v: 1 }] }, bindings: { category: "k", value: "v" }, options: { sort } }, appearance: { categoryColors: [{ value: "a", color: "#FF0000" }, { value: "zzz", color: "#00FF00" }] } })
    const byValue = await draw(env, pie("value-descending"))
    const byInput = await draw(env, pie("input"))
    const scale = (r: typeof byValue) => ((r.fitted.presentation.spec.encoding as Record<string, { scale?: unknown }>).color!.scale)
    expect(scale(byValue)).toEqual(scale(byInput))
    expect(scale(byValue)).toEqual({ domain: ["a", "b", "c"], range: ["#FF0000", BUILTIN_THEMES.light!.colors.categorical[1], BUILTIN_THEMES.light!.colors.categorical[2]] })
    expect(byValue.fitted.issues.map(i => i.code)).toContain("CATEGORY_COLOR_UNUSED")
    // The slice drawn red is "a" in both orders.
    for (const r of [byValue, byInput]) expect(r.result.svg).toMatch(/aria-label="K: a; V: 5"[^>]*fill="#FF0000"/)
  }, 60_000)

  test("a pie's internal slice order is not in the exported data", async () => {
    const { fitted } = await draw(env, { version: 1, chart: { kind: "recipe", recipe: "donut", data: { rows: [{ k: "b", v: 2 }, { k: "a", v: 5 }] }, bindings: { category: "k", value: "v" } } })
    expect(fitted.presentation.rows).toEqual([{ k: "b", v: 2 }, { k: "a", v: 5 }])
    expect(JSON.stringify(fitted.check.resolvedSpec.data)).not.toContain("slice_order")
    // Nor in the drawing's mark descriptions, which name the visible fields only.
    expect(fitted.check.svg).not.toContain("slice_order")
    expect(fitted.check.svg).toContain('aria-label="K: b; V: 2"')
  }, 60_000)
})

test("multi-line labels are measured line by line", () => {
  const fonts = bundledFonts(ROOT)
  const svg = `<svg width="200" height="100"><g transform="translate(100,20)"><text text-anchor="end" font-size="11px" font-family="Inter"><tspan>East and the far</tspan><tspan x="0" dy="13">Eastern region</tspan></text></g></svg>`
  const { boxes } = textBoxes(svg, fonts)
  expect(boxes.map(b => b.text)).toEqual(["East and the far", "Eastern region"])
  expect(boxes[1]!.y0 - boxes[0]!.y0).toBeCloseTo(13, 5)
  expect(boxes.every(b => b.x0 >= 0)).toBe(true)
})
