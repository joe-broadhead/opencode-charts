// The theme and figure layer: the editorial themes and their contrast arithmetic, the five-part figure frame, and
// the engine-agnostic annotation engine. Everything is checked on the strings it produces, because a drawing is what a
// reader sees; the theme checks are the same ones the tool reports beside a saved theme.
import { describe, expect, test } from "bun:test"
import { AnnotationSchema, BAND_PRESETS, renderAnnotationsSvg, injectAnnotations, US_RECESSIONS, type Annotation } from "../src/annotations.ts"
import { ChartsError } from "../src/errors.ts"
import { wrapFigureSvg } from "../src/figure-frame.ts"
import { bundledFonts } from "../src/fonts.ts"
import { checkRenderedSvg } from "../src/safety.ts"
import { apcaContrast, contrast, themeContrastIssues } from "../src/themes/contrast.ts"
import { parseColour } from "../src/themes/palette.ts"
import { BLUES, BUILTIN_THEMES, ThemeTokensSchema } from "../src/themes/tokens.ts"
import { ROOT } from "./helpers.ts"

const fonts = bundledFonts(ROOT)
const THEMES = { geist: BUILTIN_THEMES.geist!, "geist-dark": BUILTIN_THEMES["geist-dark"]!, "editorial-ft": BUILTIN_THEMES["editorial-ft"]!, "editorial-economist": BUILTIN_THEMES["editorial-economist"]! }

/** Well-formedness for the SVGs this layer emits: every tag opens and closes, and no text runs into a `<`. */
function expectWellFormed(svg: string) {
  const stack: string[] = []
  let index = 0
  for (const match of svg.matchAll(/<\/?([A-Za-z][\w:.-]*)((?:"[^"]*"|'[^']*'|[^>"'])*?)(\/?)>/g)) {
    const at = match.index!
    expect(svg.slice(index, at).includes("<")).toBe(false)
    index = at + match[0].length
    if (match[0].startsWith("</")) expect(stack.pop()).toBe(match[1])
    else if (!match[3]) stack.push(match[1]!)
  }
  expect(stack).toEqual([])
  expect(svg.slice(index).includes("<")).toBe(false)
}

const INNER = `<svg xmlns="http://www.w3.org/2000/svg" width="560" height="320" role="img" aria-label="Revenue by region"><rect x="0" y="0" width="560" height="320" fill="#FFFFFF"/><path d="M20,300L120,260L240,270L380,180" fill="none" stroke="#0F5499" stroke-width="2"/></svg>`
const sizeOf = (svg: string) => {
  const width = Number(/\bwidth="([\d.]+)"/.exec(svg)![1])
  const height = Number(/\bheight="([\d.]+)"/.exec(svg)![1])
  return { width, height }
}

describe("the four editorial themes", () => {
  for (const [name, theme] of Object.entries(THEMES)) {
    test(`${name}: a complete token set, no contrast warning, and type that holds up under APCA`, () => {
      expect(ThemeTokensSchema.safeParse(theme).success).toBe(true)
      expect(theme.name).toBe(name)
      expect(themeContrastIssues(theme)).toEqual([])
      expect(Math.abs(apcaContrast(theme.colors.text, theme.colors.background))).toBeGreaterThanOrEqual(90)
      expect(Math.abs(apcaContrast(theme.colors.muted, theme.colors.background))).toBeGreaterThanOrEqual(45)
      expect(Math.abs(apcaContrast(theme.colors.categorical[0]!, theme.colors.background))).toBeGreaterThanOrEqual(45)
    })
  }

  test("Geist light and dark are the Vercel canvases: white on near-black, near-black on white", () => {
    expect(THEMES.geist.mode).toBe("light")
    expect(THEMES.geist.colors.background).toBe("#FFFFFF")
    expect(THEMES.geist.colors.text).toBe("#0A0A0A")
    expect(THEMES["geist-dark"].mode).toBe("dark")
    expect(THEMES["geist-dark"].colors.background).toBe("#0A0A0A")
    expect(THEMES["geist-dark"].colors.text).toBe("#EDEDED")
    // More is brighter on a dark canvas: the ramp turns round.
    const dark = THEMES["geist-dark"].colors.sequential
    expect(parseColour(dark[0]!)!.l).toBeLessThan(parseColour(dark[dark.length - 1]!)!.l)
  })

  test("the newspaper themes keep their own paper and their own leading ink", () => {
    expect(THEMES["editorial-ft"].colors.background).toBe("#FFF1E5")
    expect(THEMES["editorial-ft"].colors.categorical[0]).toBe("#0F5499")
    expect(THEMES["editorial-ft"].colors.highlight).toBe("#9E2F50")
    expect(THEMES["editorial-economist"].colors.background).toBe("#F2F5F7")
    expect(THEMES["editorial-economist"].colors.categorical[0]).toBe("#006BA2")
    expect(THEMES["editorial-economist"].colors.highlight).toBe("#E3120B")
  })

  test("a sequential ramp's lowest stop stands off the paper, in both blue families", () => {
    expect(contrast(BLUES[0]!, "#FFFFFF")!).toBeGreaterThanOrEqual(1.2)
    expect(contrast(THEMES["editorial-ft"].colors.sequential[0]!, THEMES["editorial-ft"].colors.background)!).toBeGreaterThanOrEqual(1.15)
    expect(contrast(THEMES["editorial-economist"].colors.sequential[0]!, THEMES["editorial-economist"].colors.background)!).toBeGreaterThanOrEqual(1.1)
  })
})

describe("the contrast and palette arithmetic", () => {
  test("APCA puts black on white at the top, white on black at the bottom, and equal colours at zero", () => {
    expect(apcaContrast("#000000", "#FFFFFF")).toBeCloseTo(106, 0)
    expect(apcaContrast("#FFFFFF", "#000000")).toBeLessThan(-100)
    expect(apcaContrast("#777777", "#777777")).toBe(0)
    // A darker text on a light ground scores higher; the sign says which way round the polarity is.
    expect(apcaContrast("#333333", "#FFFFFF")).toBeGreaterThan(apcaContrast("#999999", "#FFFFFF"))
    expect(apcaContrast("#999999", "#FFFFFF")).toBeGreaterThan(0)
    expect(apcaContrast("#EEEEEE", "#0A0A0A")).toBeLessThan(0)
    // Deterministic, and unparseable input is zero rather than a guess.
    expect(apcaContrast("#0070F3", "#FFFFFF")).toBe(apcaContrast("#0070F3", "#FFFFFF"))
    expect(apcaContrast("rebeccapurple", "#FFFFFF")).toBe(0)
  })

})

describe("the five-part figure frame", () => {
  const frame = {
    kicker: "Economy",
    title: "Revenue fell 12% in the North while the South grew",
    subtitle: "Quarterly revenue by region, seasonally adjusted, 2023–24",
    source: "Source: Office for National Statistics",
    notes: "Values are in euros at 2023 prices.",
  }

  test("kicker, headline, subtitle, chart and footer compose one SVG of the exact outer size", () => {
    const wrapped = wrapFigureSvg(INNER, frame, THEMES["editorial-ft"], fonts)
    expect(wrapped.width).toBe(560)
    expect(wrapped.height).toBeGreaterThan(320)
    expect(wrapped.warnings).toEqual([])
    expect(sizeOf(wrapped.svg)).toEqual({ width: wrapped.width, height: wrapped.height })
    expect(wrapped.svg).toContain('<g transform="translate(0, ')
    // The five parts, in order: kicker, headline, subtitle, drawing, footer rule.
    const kickerAt = wrapped.svg.indexOf(">ECONOMY<")
    const titleAt = wrapped.svg.indexOf(">Revenue fell 12%")
    const subtitleAt = wrapped.svg.indexOf(">Quarterly revenue")
    const chartAt = wrapped.svg.search(/<g transform="translate\(0, /)
    const ruleAt = wrapped.svg.search(/<line x1="0" y1="[\d.]+" x2="560"/)
    expect(kickerAt).toBeGreaterThan(0)
    expect(kickerAt).toBeLessThan(titleAt)
    expect(titleAt).toBeLessThan(subtitleAt)
    expect(subtitleAt).toBeLessThan(chartAt)
    expect(chartAt).toBeLessThan(ruleAt)
    expect(wrapped.svg).toContain("Source: Office for National Statistics")
    expect(wrapped.svg).toContain("Values are in euros at 2023 prices.")
    // The chart's own content is untouched: same paths inside the translated group, and the frame's label names it.
    expect(wrapped.svg).toContain('<path d="M20,300L120,260L240,270L380,180"')
    expect(wrapped.svg).toContain('role="img" aria-label="Revenue fell 12% in the North while the South grew"')
  })

  test("the frame injects tabular figures, is deterministic, and is safe to publish", () => {
    const a = wrapFigureSvg(INNER, frame, THEMES["editorial-economist"], fonts)
    const b = wrapFigureSvg(INNER, frame, THEMES["editorial-economist"], fonts)
    expect(a.svg).toBe(b.svg)
    expect(a.svg).toContain("<style>")
    expect(a.svg).toContain("font-variant-numeric: tabular-nums")
    expect(a.svg).toContain("svg text, .chart-tabular")
    expectWellFormed(a.svg)
    expect(() => checkRenderedSvg(a.svg)).not.toThrow()
    expect(a.svg).not.toMatch(/<script|<image|<foreignObject/i)
  })

  test("a header with no footer, and a footer with no header, both size themselves from what is there", () => {
    const titleOnly = wrapFigureSvg(INNER, { title: "Revenue fell 12% in the North" }, THEMES.geist, fonts)
    expect(titleOnly.svg).toContain("Revenue fell 12%")
    expect(titleOnly.svg).not.toContain("<line x1=")
    expect(titleOnly.height).toBeGreaterThan(320)
    const footerOnly = wrapFigureSvg(INNER, { source: "Source: own analysis" }, THEMES["geist-dark"], fonts)
    expect(footerOnly.svg).toContain("Source: own analysis")
    expect(footerOnly.svg).toContain('<g transform="translate(0, 0)"')
    expect(footerOnly.height).toBeGreaterThan(320)
    // No text at all: the frame is the chart, unchanged in size.
    const bare = wrapFigureSvg(INNER, {}, THEMES.geist, fonts)
    expect(bare.height).toBe(320)
    expect(bare.svg).toContain('<g transform="translate(0, 0)">')
  })

  test("the frame escapes its own text and refuses something that is not a sized SVG", () => {
    const escaped = wrapFigureSvg(INNER, { title: "Costs < revenue & margins > 0" }, THEMES.geist, fonts)
    expect(escaped.svg).toContain("Costs &lt; revenue &amp; margins &gt; 0")
    expectWellFormed(escaped.svg)
    expect(() => wrapFigureSvg("<div>not a chart</div>", {}, THEMES.geist, fonts)).toThrow(ChartsError)
    expect(() => wrapFigureSvg("<svg><rect/></svg>", {}, THEMES.geist, fonts)).toThrow(/no width and height/)
  })

})

describe("annotations and direct labels", () => {
  const box = { x: 40, y: 20, width: 400, height: 240 }
  const theme = THEMES["editorial-economist"]

  test("the schema is strict: a known shape passes, an unknown field or a bad colour is refused", () => {
    expect(AnnotationSchema.safeParse({ type: "line", axis: "x", value: 80, domain: [0, 100], label: "Target" }).success).toBe(true)
    expect(AnnotationSchema.safeParse({ type: "band", axis: "x", preset: "us-recessions", domain: ["2000-01-01", "2024-01-01"] }).success).toBe(true)
    expect(AnnotationSchema.safeParse({ type: "callout", x: 10, y: 10, text: "Peak" }).success).toBe(true)
    expect(AnnotationSchema.safeParse({ type: "line", axis: "x", value: 1, domain: [0, 1], width: 2 }).success).toBe(false)
    expect(AnnotationSchema.safeParse({ type: "callout", x: 1, y: 1, text: "x", color: "rebeccapurple" }).success).toBe(false)
    expect(AnnotationSchema.safeParse({ type: "band", axis: "x", preset: "nope", domain: [0, 1] }).success).toBe(false)
  })

  test("a reference line is drawn at its value with a label, dashed by default and solid when asked", () => {
    const svg = renderAnnotationsSvg([{ type: "line", axis: "x", value: 80, domain: [0, 100], label: "Target" }], box, theme, fonts)
    expect(svg).toContain('x1="360"')
    expect(svg).toContain('stroke-dasharray="4 3"')
    expect(svg).toContain(">Target</text>")
    const solid = renderAnnotationsSvg([{ type: "line", axis: "y", value: 50, domain: [0, 100], dashed: false }], box, theme, fonts)
    expect(solid).toContain('y1="140"')
    expect(solid).not.toContain("stroke-dasharray")
    expectWellFormed(svg)
  })

  test("the bundled NBER recessions shade three spans on a time axis", () => {
    expect(US_RECESSIONS.map(r => r.from)).toEqual(["2001-03-01", "2007-12-01", "2020-02-01"])
    expect(BAND_PRESETS["us-recessions"]).toBe(US_RECESSIONS)
    const annotation: Annotation = { type: "band", axis: "x", preset: "us-recessions", domain: ["2000-01-01", "2024-01-01"] }
    const svg = renderAnnotationsSvg([annotation], box, theme, fonts)
    expect((svg.match(/<rect\b/g) ?? []).length).toBe(3)
    expect(svg).toContain("2007–09 recession")
    expect(svg).toContain('fill-opacity="0.14"')
    // Each span's width is its share of the domain, in plot-box pixels.
    const widths = [...svg.matchAll(/<rect[^>]*width="([\d.]+)"/g)].map(m => Number(m[1]))
    const span = (from: string, to: string) => ((Date.parse(to) - Date.parse(from)) / (Date.parse("2024-01-01") - Date.parse("2000-01-01"))) * box.width
    expect(widths[0]!).toBeCloseTo(span("2001-03-01", "2001-11-01"), 0)
    expect(widths[1]!).toBeCloseTo(span("2007-12-01", "2009-06-01"), 0)
    expect(svg).toContain('y="20"')
  })

  test("a callout wraps its text, draws the dot, halo, leader and accent tick, and stays inside the plot box", () => {
    const svg = renderAnnotationsSvg([{ type: "callout", x: 380, y: 30, dx: 120, dy: -60, text: "A long note that has to wrap across more than one line at this width, because a reader needs the whole sentence and not an ellipsis", subtext: "and a second line under it" }], box, theme, fonts)
    expect((svg.match(/<circle\b/g) ?? []).length).toBe(2)
    expect(svg).toContain('r="3.5"')
    expect(svg).toContain('r="8"')
    expect((svg.match(/<line\b/g) ?? []).length).toBe(2)
    expect(svg).toContain('stroke-width="2"')
    const lines = [...svg.matchAll(/<text[^>]*>([^<]+)<\/text>/g)].map(m => m[1]!)
    expect(lines.length).toBeGreaterThan(3)
    for (const x of [...svg.matchAll(/<text x="([\d.]+)"/g)].map(m => Number(m[1]))) expect(x).toBeGreaterThanOrEqual(box.x)
    for (const y of [...svg.matchAll(/<text[^>]* y="([\d.]+)"/g)].map(m => Number(m[1]))) {
      expect(y).toBeGreaterThanOrEqual(box.y)
      expect(y).toBeLessThanOrEqual(box.y + box.height)
    }
    expectWellFormed(svg)
  })

  test("annotations are injected above the marks, and the result passes the safety check", () => {
    const annotations: Annotation[] = [
      { type: "line", axis: "x", value: 60, domain: [0, 100], label: "Target" },
      { type: "band", axis: "x", preset: "covid-lockdowns", domain: ["2020-01-01", "2021-01-01"] },
      { type: "callout", x: 120, y: 90, text: "Peak", subtext: "March 2020" },
    ]
    const svg = injectAnnotations(INNER, annotations, box, theme, fonts)
    expect(svg.endsWith("</g></svg>")).toBe(true)
    expect(svg.indexOf("charts-annotations")).toBeGreaterThan(svg.indexOf("<path"))
    expect(() => checkRenderedSvg(svg)).not.toThrow()
    expect(injectAnnotations(INNER, [], box, theme, fonts)).toBe(INNER)
  })

})
