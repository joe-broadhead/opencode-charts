import { afterAll, describe, expect, test } from "bun:test"
import { ASCII_DEADLINE_MS, DIAGRAM_LIMITS, mermaidSize, renderDiagram } from "../src/engines/diagram.ts"
import { mixColour, renderTable, TableSpecSchema, withAlpha } from "../src/engines/table.ts"
import { DiagramSpecSchema } from "../src/engines/diagram.ts"
import { closeVegaWorker, renderDiagramBounded, WORKER_HEAP_MB } from "../src/engines/vega-pool.ts"
import { bundledFonts } from "../src/fonts.ts"
import { resolveLocale } from "../src/locale.ts"
import { checkRenderedSvg } from "../src/safety.ts"
import { BUILTIN_THEMES, type ThemeTokens } from "../src/themes/tokens.ts"
import { attr, isUserColour, userColourHex } from "../src/themes/user-colour.ts"
import { runTool } from "../src/handlers/index.ts"
import { ROOT, workspace } from "./helpers.ts"

/**
 * A diagram is bounded: its size is checked before any layout, it is laid out in the worker under the render deadline
 * and the heap cap, and its ASCII outline is a second job with a shorter deadline. User colours are colours, and the
 * rendered SVG refers to nothing outside itself.
 */

const fonts = bundledFonts(ROOT)
const light = BUILTIN_THEMES.light as ThemeTokens
const spaces: { cleanup: () => void }[] = []
afterAll(async () => { for (const space of spaces) space.cleanup(); await closeVegaWorker() })

/** A flowchart of `edges` edges among `nodes` nodes, deterministic: the shape the review measured. */
function flowchart(edges: number, nodes = Math.max(10, Math.round(edges / 2))): string {
  let s = 7
  const r = () => (s = (s * 1103515245 + 12345) % 2147483648) % nodes
  const lines = ["graph TD"]
  for (let i = 0; i < edges; i++) lines.push(`n${r().toString(36)} --> n${r().toString(36)}`)
  return lines.join("\n")
}

/** A random DAG of `nodes` nodes and `edges` edges with no repeated pair: the worst layout this engine accepts. */
function dag(nodes: number, edges: number): string {
  let s = 11
  const r = () => (s = (s * 1103515245 + 12345) % 2147483648) % nodes
  const seen = new Set<string>(), lines = ["graph TD"]
  while (seen.size < edges) {
    let a = r(), b = r()
    if (a === b) continue
    if (a > b) [a, b] = [b, a]
    if (seen.has(`${a}:${b}`)) continue
    seen.add(`${a}:${b}`)
    lines.push(`n${a} --> n${b}`)
  }
  return lines.join("\n")
}

function call(input: Record<string, unknown>, tool: "diagram" | "validate" = "diagram") {
  const ws = workspace()
  spaces.push(ws)
  return runTool({ ...ws.env, assertFiles: async () => {} } as never, tool, input)
}

/** Peak RSS of this process while `work` runs: the worker's memory is this process's memory. */
async function peakRss<T>(work: () => Promise<T>): Promise<{ value: T | unknown; peakMb: number; baseMb: number }> {
  const baseMb = process.memoryUsage().rss / 1e6
  let peak = baseMb
  const timer = setInterval(() => { peak = Math.max(peak, process.memoryUsage().rss / 1e6) }, 20)
  try {
    const value = await work().catch((error: unknown) => error)
    return { value, peakMb: Math.max(peak, process.memoryUsage().rss / 1e6), baseMb }
  } finally {
    clearInterval(timer)
  }
}

describe("a diagram's size is checked before any layout", () => {
  test("Mermaid sources are counted the way the renderer reads them", () => {
    expect(mermaidSize("graph TD\n  a --> b --> c\n  a --> c")).toEqual({ nodes: 3, edges: 3 })
    expect(mermaidSize("sequenceDiagram\n  participant A\n  A->>B: hi\n  B-->>A: ok")).toEqual({ nodes: 2, edges: 2 })
    expect(mermaidSize("classDiagram\n  class Shape\n  Shape <|-- Circle\n  Shape <|-- Square")).toEqual({ nodes: 3, edges: 2 })
    expect(mermaidSize("erDiagram\n  CUSTOMER ||--o{ ORDER : places\n  ORDER ||--|{ LINE : contains")).toEqual({ nodes: 3, edges: 2 })
    expect(mermaidSize("stateDiagram-v2\n  [*] --> Idle\n  Idle --> Busy\n  Busy --> Idle")?.edges).toBe(3)
  })

  for (const edges of [600, 800, 1500]) {
    test(`the review's ${edges}-edge flowchart is refused at once, through charts_diagram and charts_validate`, async () => {
      const dsl = flowchart(edges)
      expect(dsl.length).toBeLessThanOrEqual(20_000)
      for (const tool of ["diagram", "validate"] as const) {
        const started = performance.now()
        const input = tool === "diagram" ? { dsl, formats: ["svg"] } : { spec: { dsl }, engine: "diagram" }
        const error = await call(input, tool).catch((caught: unknown) => caught) as { code?: string; message?: string }
        expect(performance.now() - started).toBeLessThan(2_000)
        expect(error.code).toBe("SPEC_TOO_EXPENSIVE")
        expect(error.message).toContain(`at most ${DIAGRAM_LIMITS.edges} edges`)
        expect(error.message).toContain("Next step:")
      }
    })
  }

  test("too many nodes is refused with the node limit", async () => {
    const dsl = ["graph LR", ...Array.from({ length: DIAGRAM_LIMITS.nodes + 1 }, (_, i) => `n${i}[Node ${i}]`)].join("\n")
    const error = await renderDiagram({ dsl }, { theme: light, fonts }).catch((caught: unknown) => caught) as { code?: string; message?: string }
    expect(error.code).toBe("SPEC_TOO_EXPENSIVE")
    expect(error.message).toContain(`at most ${DIAGRAM_LIMITS.nodes} nodes`)
  })

  test("an architecture recipe over the edge limit is refused with the edges path", async () => {
    const nodes = Array.from({ length: 30 }, (_, i) => ({ id: `s${i}`, label: `Service ${i}` }))
    const edges = Array.from({ length: DIAGRAM_LIMITS.edges + 1 }, (_, i) => ({ from: `s${i % 30}`, to: `s${(i * 7 + 1) % 30}` }))
    const error = await renderDiagram({ kind: "architecture", nodes, edges }, { theme: light, fonts }).catch((caught: unknown) => caught) as { code?: string; path?: string }
    expect(error.code).toBe("SPEC_TOO_EXPENSIVE")
    expect(error.path).toBe("/edges")
  })
})

describe("a diagram is drawn in the worker, under a deadline and a heap cap", () => {
  test(`a diagram at the limits (${DIAGRAM_LIMITS.nodes} nodes, ${DIAGRAM_LIMITS.edges} edges) draws within the deadline, in bounded memory`, async () => {
    const { value, peakMb, baseMb } = await peakRss(() => renderDiagramBounded({ dsl: dag(DIAGRAM_LIMITS.nodes, DIAGRAM_LIMITS.edges) }, { theme: light, fonts }))
    const out = value as { svg?: string; ascii?: string }
    expect(typeof out.svg).toBe("string")
    // Over the outline's limits: the outline is the title line, and no outline job ran.
    expect(out.ascii).toBe("diagram")
    expect(peakMb - baseMb).toBeLessThan(500)
  }, 30_000)

  test("an outline that never finishes is stopped at its deadline; the drawing stands", async () => {
    // Three lines that send the outline router into a loop that grows without end.
    const dsl = "graph TD\n  n0 --> n6\n  n6 --> n0\n  n6 --> n0"
    const started = performance.now()
    const { value, peakMb, baseMb } = await peakRss(() => renderDiagramBounded({ dsl, title: "Loop" }, { theme: light, fonts }))
    const out = value as { svg: string; ascii: string; issues: { code: string; message: string }[] }
    expect(performance.now() - started).toBeLessThan(ASCII_DEADLINE_MS + 5_000)
    expect(out.svg).toContain("<svg")
    expect(out.ascii).toBe("Loop")
    expect(out.issues.map(issue => issue.code)).toContain("SPEC_TOO_EXPENSIVE")
    expect(peakMb - baseMb).toBeLessThan(500)
  }, 30_000)

  test("an outline within the limits is drawn by the worker", async () => {
    const out = await renderDiagramBounded({ dsl: "flowchart LR\n  a[Intake] --> b[Review] --> c[Ship]" }, { theme: light, fonts })
    expect(out.ascii).toContain("Intake")
    expect(out.issues).toEqual([])
  })

  test(`the worker's heap is capped at ${WORKER_HEAP_MB} MB`, () => {
    expect(WORKER_HEAP_MB).toBeLessThanOrEqual(256)
  })
})

const PAYLOAD = `red" style="cursor:url(http://e.x/c.png),auto`

describe("a user colour is a colour, and the SVG refers to nothing outside itself", () => {
  test("the review's payload is refused as a table badge colour and as a diagram node colour", async () => {
    const table = TableSpecSchema.safeParse({ columns: [{ field: "s", cell: "badge", badgeColors: { Late: PAYLOAD } }] })
    expect(table.success).toBe(false)
    expect(DiagramSpecSchema.safeParse({ kind: "org_chart", nodes: [{ id: "a", label: "A", color: PAYLOAD }] }).success).toBe(false)
    // charts_table reads its columns with the schema the tool declares, so the call is refused before anything is drawn.
    const viaTable = await call({ data: { rows: [{ s: "Late" }] }, columns: [{ field: "s", cell: "badge", badgeColors: { Late: PAYLOAD } }], formats: ["svg"] }, "table" as never).catch((caught: unknown) => caught)
    expect(viaTable).toBeInstanceOf(Error)
    expect(String((viaTable as Error).message)).toContain("a colour is #rgb")
    const viaDiagram = await call({ kind: "org_chart", nodes: [{ id: "a", label: "A", color: PAYLOAD }], formats: ["svg"] }).catch((caught: unknown) => caught)
    expect(viaDiagram).toBeInstanceOf(Error)
    expect(String((viaDiagram as Error).message)).toContain("a colour is #rgb")
  })

  test("colour arithmetic never passes on a value that is not a colour", async () => {
    expect(mixColour(light.colors.background, PAYLOAD, 0.16)).toBe("none")
    expect(withAlpha(PAYLOAD, 0.5)).toBe("none")
    expect(mixColour(light.colors.background, "teal", 1)).toBe("#008080")
    expect(mixColour("#000000", "transparent", 0.5)).toBe("transparent")
    const tree = await renderDiagram({ kind: "org_chart", nodes: [{ id: "a", label: "A" }, { id: "b", label: "B", parent: "a" }] }, { theme: light, fonts })
    expect(() => checkRenderedSvg(tree.svg)).not.toThrow()
  })

  test("colour names, hex, rgb() and theme tokens are colours; anything else is not", () => {
    for (const ok of ["teal", "#C34", "#CC3344", "#cc334480", "rgb(204, 51, 68)", "rgba(0,0,0,0.5)", "transparent", "theme:positive", "theme:categorical.2"]) expect({ ok, valid: isUserColour(ok) }).toEqual({ ok, valid: true })
    for (const bad of [PAYLOAD, "notacolour", "url(#x)", "red;", "rgb(1,2,3) x", "#12345", "var(--x)", "expression(1)"]) expect({ bad, valid: isUserColour(bad) }).toEqual({ bad, valid: false })
    expect(userColourHex("teal")).toBe("#008080")
    expect(userColourHex("theme:positive")).toBeUndefined()
    expect(attr(`a"b<c>&'`)).toBe("a&quot;b&lt;c&gt;&amp;&#39;")
  })

  test("a named colour is drawn as its value, tinted like any other", async () => {
    const out = renderTable({ columns: [{ field: "s", cell: "badge", badgeColors: { Late: "teal" } }] }, [{ s: "Late" }], { theme: light, fonts, locale: resolveLocale(ROOT, "en-US") })
    expect(out.svg).not.toContain(`fill="teal"`)
    const tree = await renderDiagram({ kind: "org_chart", nodes: [{ id: "a", label: "A", color: "teal" }] }, { theme: light, fonts })
    expect(tree.svg).toContain(`fill="#008080"`)
  })

  test("checkRenderedSvg refuses url() to anything but an internal #id, and external references in style", () => {
    const wrap = (inner: string) => `<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10">${inner}</svg>`
    expect(() => checkRenderedSvg(wrap(`<rect fill="red" style="cursor:url(http://e.x/c.png),auto"/>`))).toThrow(/external resource/)
    expect(() => checkRenderedSvg(wrap(`<rect fill="url(http://e.x/p.svg#g)"/>`))).toThrow(/external resource/)
    expect(() => checkRenderedSvg(wrap(`<rect style="fill:u\\72l(//e.x/a)"/>`))).toThrow(/external resource/)
    expect(() => checkRenderedSvg(wrap(`<rect style="fill:&#x75;rl(//e.x/a)"/>`))).toThrow(/external resource/)
    expect(() => checkRenderedSvg(wrap(`<style>@import "http://e.x/a.css";</style>`))).toThrow(/external resource/)
    expect(() => checkRenderedSvg(wrap(`<style>rect{background:url(data:image/png;base64,AAAA)}</style>`))).toThrow(/external resource/)
    // Internal references, and text that only reads like one, pass.
    expect(() => checkRenderedSvg(wrap(`<defs><linearGradient id="g"/></defs><rect fill="url(#g)" clip-path="url( '#c' )"/>`))).not.toThrow()
    expect(() => checkRenderedSvg(wrap(`<g aria-label="see url(http://e.x)"><text>url(http://e.x)</text></g>`))).not.toThrow()
  })
})
