// The bundled Geist faces and CSS font-stack resolution: the book loads all four families with pinned bytes, a stack
// ("Geist, Inter, sans-serif") resolves to the first family the book has, and a Geist theme renders and rasterises
// with no FONT_NOT_BUNDLED warning. The faces are pinned by hash, so a swapped file is refused before it is parsed.
import { afterAll, describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { closeVegaWorker } from "../src/engines/vega-pool.ts"
import { GEIST, GEIST_MONO, MONO, SANS } from "../src/constants.ts"
import { BUNDLED, BUNDLED_FAMILIES, bundledFonts, parseFontStack } from "../src/fonts.ts"
import { svgToPng } from "../src/png.ts"
import { cssFontStack, cssString } from "../src/svg.ts"
import { renderChart } from "../src/pipeline.ts"
import { checkRenderedSvg } from "../src/safety.ts"
import { BAR, ROOT, ROWS, workspace } from "./helpers.ts"

const ws = workspace()
const fonts = bundledFonts(ROOT)
const faceOf = (family: string, weight: number) => fonts.list().find(face => face.family === family && face.weight === weight)!

afterAll(async () => { ws.cleanup(); await closeVegaWorker() })

describe("the bundled faces", () => {
  test("Inter and JetBrains Mono stay first, and the three Geist faces follow them", () => {
    // The capabilities report and the registry's script check read the first family, so the original three lead.
    expect(BUNDLED.slice(0, 3).map(font => font.file)).toEqual(["Inter-Regular.ttf", "Inter-SemiBold.ttf", "JetBrainsMono-Regular.ttf"])
    expect(BUNDLED.slice(3).map(font => [font.file, font.family, font.weight])).toEqual([
      ["Geist-Regular.ttf", GEIST, 400],
      ["Geist-SemiBold.ttf", GEIST, 600],
      ["GeistMono-Regular.ttf", GEIST_MONO, 400],
    ])
    expect(BUNDLED_FAMILIES).toEqual([SANS, MONO, GEIST, GEIST_MONO])
    expect(fonts.families()).toEqual([SANS, MONO, GEIST, GEIST_MONO])
  })

  test("every bundled face carries its TTF and its pinned WOFF2 web form", () => {
    for (const font of BUNDLED) {
      const face = faceOf(font.family, font.weight)
      expect([face.resource.source, face.resource.mime, face.resource.format]).toEqual([font.file, "font/ttf", "truetype"])
      expect([face.resource.sha256, face.resource.web.sha256]).toEqual([font.sha256, font.woff2Sha256])
      expect([face.resource.web.mime, face.resource.web.format]).toEqual(["font/woff2", "woff2"])
      // The web form is a WOFF2 file, and is the size the file system holds.
      expect(new TextDecoder().decode(face.resource.web.bytes.subarray(0, 4))).toBe("wOF2")
      expect(face.resource.web.bytes.byteLength).toBe(readFileSync(join(ROOT, "assets", "fonts", font.file.replace(/\.ttf$/, ".woff2"))).byteLength)
      expect(face.resource.web.bytes.byteLength).toBeGreaterThan(1000)
    }
  })

  test("each Geist .ttf parses into real metrics: an em of 1000 and the face's own glyph advances", () => {
    // The exact advances pin the parse: head, hhea, hmtx and cmap are read from the file, not guessed.
    const expected = [
      { family: GEIST, weight: 400, glyphs: 728, a: 668, m: 877 },
      { family: GEIST, weight: 600, glyphs: 728, a: 709, m: 892 },
      { family: GEIST_MONO, weight: 400, glyphs: 889, a: 600, m: 600 },
    ]
    for (const want of expected) {
      const face = faceOf(want.family, want.weight)
      expect([face.unitsPerEm, face.ascender, face.descender]).toEqual([1000, 1005, -295])
      expect(face.advances.size).toBe(want.glyphs)
      expect(face.advances.get(0x41 /* A */)).toBe(want.a)
      expect(face.advances.get(0x6d /* m */)).toBe(want.m)
      expect(face.fallbackAdvance).toBe(face.advances.get(0x6f /* o */)!)
      expect(face.advances.has(0x20 /* space */)).toBe(true)
      for (const char of "Hamburgefonstiv 0123456789€") expect(face.advances.has(char.codePointAt(0)!), `${want.family}: no glyph for ${char}`).toBe(true)
    }
    // Geist Mono is monospaced: the same advance for a wide glyph, a narrow one and a digit.
    const mono = faceOf(GEIST_MONO, 400)
    for (const codePoint of [0x4d /* M */, 0x69 /* i */, 0x31 /* 1 */, 0x2e /* . */]) expect(mono.advances.get(codePoint)).toBe(600)
    // A measurement is the sum of the advances: ten mono glyphs at 100px are 600 units each out of 1000.
    expect(fonts.measure("MMMMMMMMMM", 100, GEIST_MONO)).toBe(600)
    // The semibold is wider than the regular for the same string, so the weight picks the right face.
    expect(fonts.measure("Hamburgefonstiv", 48, GEIST, 600)).toBeGreaterThan(fonts.measure("Hamburgefonstiv", 48, GEIST, 400))
  })
})

describe("parseFontStack", () => {
  test("splits a sans stack into names and its generic, dropping quotes and whitespace", () => {
    expect(parseFontStack("Geist, 'Inter', ui-sans-serif, system-ui, -apple-system, sans-serif")).toEqual({ named: [GEIST, SANS], generic: "sans" })
    expect(parseFontStack(`  "Geist" ,\tInter ,  sans-serif `)).toEqual({ named: [GEIST, SANS], generic: "sans" })
  })

  test("splits a mono stack, and keeps a generic apart from the names", () => {
    expect(parseFontStack("'Geist Mono', JetBrains Mono, ui-monospace, monospace")).toEqual({ named: [GEIST_MONO, MONO], generic: "mono" })
    expect(parseFontStack("ui-monospace, monospace")).toEqual({ named: [], generic: "mono" })
  })

  test("system-ui, its spellings and the serif keywords are generics; Segoe UI and Helvetica are named families", () => {
    for (const generic of ["system-ui", "ui-sans-serif", "-apple-system", "BlinkMacSystemFont"]) expect(parseFontStack(generic)).toEqual({ named: [], generic: "sans" })
    expect(parseFontStack("ui-serif, serif")).toEqual({ named: [], generic: "serif" })
    expect(parseFontStack("Segoe UI, Helvetica, serif")).toEqual({ named: ["Segoe UI", "Helvetica"], generic: "serif" })
  })

  test("maps the CSS spellings of the bundled families to their canonical names", () => {
    expect(parseFontStack("Geist Sans")).toEqual({ named: [GEIST] })
    expect(parseFontStack("geist-sans")).toEqual({ named: [GEIST] })
    expect(parseFontStack("GeistMono")).toEqual({ named: [GEIST_MONO] })
    expect(parseFontStack("geist-mono")).toEqual({ named: [GEIST_MONO] })
    expect(parseFontStack("Geist Sans, Geist, sans-serif")).toEqual({ named: [GEIST], generic: "sans" })
  })

  test("an absent or empty stack names nothing", () => {
    expect(parseFontStack(undefined)).toEqual({ named: [] })
    expect(parseFontStack("")).toEqual({ named: [] })
    expect(parseFontStack(" , ")).toEqual({ named: [] })
  })
})

describe("has: what a theme's family resolves to", () => {
  test("a bundled family is available, under its own name and its CSS aliases", () => {
    expect(fonts.has("Geist")).toBe(true)
    expect(fonts.has("Geist Sans")).toBe(true)
    expect(fonts.has("Geist Mono")).toBe(true)
    expect(fonts.has("geist-mono")).toBe(true)
    expect(fonts.has("Inter")).toBe(true)
    expect(fonts.has("JetBrains Mono")).toBe(true)
  })

  test("a stack is available when any family it names is", () => {
    expect(fonts.has("UnknownBrandFont, Geist, Inter, sans-serif")).toBe(true)
    expect(fonts.has("Comic Sans, Inter")).toBe(true)
    expect(fonts.has("Geist, Inter")).toBe(true)
  })

  test("a stack of generics alone is available, because a bundled face always answers it", () => {
    expect(fonts.has("system-ui, sans-serif")).toBe(true)
    expect(fonts.has("sans-serif")).toBe(true)
    expect(fonts.has("ui-monospace, monospace")).toBe(true)
    expect(fonts.has("ui-serif, serif")).toBe(true)
  })

  test("a concrete family the book does not have is not, generic fallback or not", () => {
    expect(fonts.has("TotallyMissingFont")).toBe(false)
    expect(fonts.has("Comic Sans")).toBe(false)
    expect(fonts.has("NonExistentFont, sans-serif")).toBe(false)
    expect(fonts.has("")).toBe(false)
  })

  test("resolveFamily names the face a stack draws with", () => {
    expect(fonts.resolveFamily("Geist, Inter, sans-serif")).toBe(GEIST)
    expect(fonts.resolveFamily("UnknownBrandFont, Geist")).toBe(GEIST)
    expect(fonts.resolveFamily("'Geist Mono', ui-monospace, monospace")).toBe(GEIST_MONO)
    expect(fonts.resolveFamily("Geist Sans")).toBe(GEIST)
    expect(fonts.resolveFamily("system-ui, sans-serif")).toBe(SANS)
    expect(fonts.resolveFamily(undefined)).toBe(SANS)
    expect(fonts.resolveFamily("TotallyMissingFont")).toBe(SANS)
    expect(fonts.resolveFamily("Missing Brand Mono")).toBe(MONO)
  })
})

describe("resourcesFor: the faces a drawing embeds", () => {
  test("a Geist family stack picks Geist, not the names after it", () => {
    const svg = `<svg><text font-family="Geist, Inter, sans-serif">x</text><text font-family="Geist Mono, monospace">0</text></svg>`
    const used = fonts.resourcesFor(svg, ["Geist, Inter, sans-serif", "Geist Mono, ui-monospace, monospace"])
    expect(used.map(resource => `${resource.family} ${resource.weight}`)).toEqual([`${GEIST} 400`, `${GEIST} 600`, `${GEIST_MONO} 400`])
    expect(used.every(resource => resource.origin === "bundled")).toBe(true)
    // A single name behaves the same way, and buffersFor is the same list as bytes.
    expect(fonts.resourcesFor(`<svg><text font-family="Geist">x</text></svg>`, [GEIST]).map(resource => resource.family)).toEqual([GEIST, GEIST])
    expect(fonts.buffersFor(svg, "Geist, Inter, sans-serif")).toEqual(fonts.resourcesFor(svg, ["Geist, Inter, sans-serif"]).map(resource => resource.bytes))
  })
})

describe("a Geist theme renders and rasterises", () => {
  const theme = { extends: "light", font: { family: GEIST, mono: GEIST_MONO } }
  const render = () => renderChart({ spec: BAR, data: { rows: ROWS }, theme, formats: ["svg"], name: "geist-theme" }, ws.env, false)

  test("renders with no warning: the bundled Geist face is found, not reported missing", async () => {
    const result = await render()
    expect(result.issues).toEqual([])
    expect(result.svg).toContain(GEIST)
    expect(result.svg.includes("Inter")).toBe(false)
    expect(result.width).toBeGreaterThan(0)
    expect(result.height).toBeGreaterThan(0)
    expect(() => checkRenderedSvg(result.svg)).not.toThrow()
    // The same input still gives the same bytes with the new face.
    expect((await render()).svg).toBe(result.svg)
  })

  test("a family the book does not have still gets FONT_NOT_BUNDLED", async () => {
    const missing = await renderChart({ spec: BAR, data: { rows: ROWS }, theme: { extends: "light", font: { family: "TotallyMissingFont" } }, formats: ["svg"] }, ws.env, false)
    expect(missing.issues.map(issue => issue.code)).toContain("FONT_NOT_BUNDLED")
  })

  test("rasterises to a valid PNG with the Geist buffers", async () => {
    const { svg, width, height } = await render()
    const png = await svgToPng(ROOT, svg, fonts, 2, GEIST)
    expect([...png.png.slice(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    expect(png.width).toBe(width * 2)
    expect(png.height).toBe(height * 2)
    expect(png.png.byteLength).toBeGreaterThan(1000)
  }, 30_000)
})

describe("cssFontStack: a stack written into a <style> block", () => {
  test("keeps the families in order, quotes them, and ends on a generic keyword", () => {
    expect(cssFontStack("Geist, Inter, sans-serif")).toBe(`"${GEIST}","${SANS}",sans-serif`)
    expect(cssFontStack("Geist")).toBe(`"${GEIST}",sans-serif`)
    expect(cssFontStack("'Geist Mono', JetBrains Mono, ui-monospace, monospace", "monospace")).toBe(`"${GEIST_MONO}","${MONO}",monospace`)
    // A generic alone stays a bare keyword, never a quoted string.
    expect(cssFontStack("sans-serif")).toBe("sans-serif")
    expect(cssFontStack("system-ui, sans-serif")).toBe("sans-serif")
    expect(cssFontStack("ui-serif, serif")).toBe("serif")
    // A stack with no generic of its own ends on the caller's fallback.
    expect(cssFontStack("Inter")).toBe(`"${SANS}",sans-serif`)
    expect(cssFontStack("", "monospace")).toBe("monospace")
  })

  test("escapes every character that could end the string, the rule or the style element", () => {
    const hostile = `Evil</style><meta http-equiv="refresh" content="0;url=https://example.com">`
    const stack = cssFontStack(hostile)
    // Nothing raw can close the declaration: `<` and `>` are CSS hex escapes, quotes are escaped, and the only
    // unquoted word is the generic the stack ends on.
    expect(stack).not.toContain("<")
    expect(stack).not.toContain(">")
    expect(stack).not.toContain('"refresh"')
    expect(stack.startsWith(`"Evil\\3c /style\\3e \\3c meta`)).toBe(true)
    expect(stack.endsWith(",sans-serif")).toBe(true)
    // Only quoted strings and one generic keyword are left once every quoted segment is removed: nothing outside a
    // string can end the declaration, however hostile the name is.
    const outsideStrings = (value: string): string => value.replace(/"[^"]*"/g, "").replace(/^,|,$/g, "")
    for (const value of ["Evil;}</style>", "Evil`family", "Evil\\", `Evil" family`, "a;b{c}d"]) {
      expect(outsideStrings(cssFontStack(value))).toMatch(/^[a-z-]*$/)
    }
    // The escaping is exactly the one `cssString` provides for a family name.
    expect(cssFontStack(hostile)).toBe(`${cssString(hostile)},sans-serif`)
  })
})
