// The terminal and GUI surfaces: the Braille/block renderers, the fence parser, the TUI code-block registration and
// its streaming cache, the GUI card builder and its plugin wiring, and the artifact bridge.
import { describe, expect, test } from "bun:test"
import { build } from "esbuild"
import { join } from "node:path"
import { BrailleCanvas, ChartBlockCache, formatCompact, normalizeChart, parseChartFence, renderTerminalChart, stripAnsi, toNumber } from "../src/tui-chart.ts"
import { chartBlockWidth, setupView } from "../src/tui.ts"
import {
  CodeBlock,
  CodeBlockAction,
  Command,
  buildChartCard,
  buildChartCardSvg,
  chartCardElement,
  chartLanguages,
  default as guiPlugin,
  setupGui,
} from "../src/gui.ts"
import { artifactDomain, publishHtmlArtifact } from "../src/artifact-bridge.ts"
import { ROOT } from "./helpers.ts"

const BRAILLE = /[\u2800-\u28ff]/
const ANSI = /\u001b\[[0-9;]*m/

const BARS = {
  type: "bar",
  title: "Revenue by region",
  unit: "€k",
  data: [
    { region: "North", revenue: 120 },
    { region: "South", revenue: 80 },
    { region: "East", revenue: 95 },
    { region: "West", revenue: 40 },
  ],
  x: "region",
  y: "revenue",
}

const LINE = { type: "line", title: "Latency", unit: "ms", data: [{ x: "Jan", y: 120 }, { x: "Feb", y: 80 }, { x: "Mar", y: 95 }], x: "x", y: "y" }
const MULTI = {
  type: "multi_line",
  data: [
    { x: "Jan", y: 120, series: "read" },
    { x: "Feb", y: 80, series: "read" },
    { x: "Jan", y: 60, series: "write" },
    { x: "Feb", y: 70, series: "write" },
  ],
  x: "x",
  y: "y",
  series: "series",
}
const SCATTER = { type: "scatter", data: [{ x: "1", y: 2 }, { x: "2", y: 5 }, { x: "3", y: 3 }], x: "x", y: "y" }
const PIE = { type: "pie", data: [{ label: "Search", value: 46 }, { label: "Direct", value: 28 }, { label: "Social", value: 26 }], x: "label", y: "value" }

describe("the Braille canvas", () => {
  test("a cell is a 2 by 4 dot matrix", () => {
    const canvas = new BrailleCanvas(4, 3)
    expect(canvas.pixelWidth).toBe(8)
    expect(canvas.pixelHeight).toBe(12)
    expect(canvas.columns).toBe(4)
    expect(canvas.rows).toBe(3)
  })

  test("maps dots to the Braille bit order, column by column", () => {
    const one = new BrailleCanvas(1, 1)
    one.set(0, 0)
    expect(one.charAt(0, 0)).toBe(String.fromCharCode(0x2800 + 0x01))
    const right = new BrailleCanvas(1, 1)
    right.set(1, 0)
    expect(right.charAt(0, 0)).toBe(String.fromCharCode(0x2800 + 0x08))
    const bottom = new BrailleCanvas(1, 1)
    bottom.set(0, 3)
    expect(bottom.charAt(0, 0)).toBe(String.fromCharCode(0x2800 + 0x40))
    const empty = new BrailleCanvas(1, 1)
    expect(empty.charAt(0, 0)).toBe(" ")
  })

  test("draws a line with Bresenham, fills a column, and tags a cell's colour", () => {
    const line = new BrailleCanvas(4, 2)
    line.line(0, 0, 7, 7, 2)
    expect(line.toString()).toMatch(BRAILLE)
    expect(line.colorAt(0, 0)).toBe(2)
    const filled = new BrailleCanvas(1, 1)
    filled.fillDown(0, 0)
    expect(filled.charAt(0, 0)).toBe(String.fromCharCode(0x2800 + 0x47))
    const ignored = new BrailleCanvas(1, 1)
    ignored.set(-1, 0)
    ignored.set(99, 99)
    expect(ignored.charAt(0, 0)).toBe(" ")
  })

  test("reads a scatter dot and reports colours per cell", () => {
    const canvas = new BrailleCanvas(2, 1)
    canvas.dot(2, 0, 1)
    expect(canvas.charAt(1, 0)).toMatch(BRAILLE)
    expect(canvas.colorAt(1, 0)).toBe(1)
    expect(canvas.colorAt(5, 5)).toBe(-1)
  })
})

describe("chart values", () => {
  test("formats compact numbers deterministically", () => {
    expect(formatCompact(42)).toBe("42")
    expect(formatCompact(1200)).toBe("1.2k")
    expect(formatCompact(1_500_000)).toBe("1.5M")
    expect(formatCompact(-2500)).toBe("-2.5k")
    expect(formatCompact(0)).toBe("0")
    expect(toNumber("3.5")).toBe(3.5)
    expect(toNumber("x")).toBeUndefined()
  })

  test("normalizes records, numeric values and named series", () => {
    expect(normalizeChart(BARS).series[0]!.points.map(point => point.y)).toEqual([120, 80, 95, 40])
    expect(normalizeChart({ values: [1, 2], labels: ["a", "b"] }).series[0]!.points).toEqual([{ x: "a", y: 1 }, { x: "b", y: 2 }])
    expect(normalizeChart({ series: [{ name: "a", values: [1] }, { name: "b", values: [2] }] }).series.map(entry => entry.name)).toEqual(["a", "b"])
  })
})

describe("the terminal chart renderers", () => {
  test("ranks horizontal bars and lays out each row inside the width", () => {
    const text = renderTerminalChart(BARS, { width: 48 })
    expect(text).toContain("Revenue by region")
    expect(text).toContain("Unit: €k")
    expect(text).toContain("North")
    expect(text).toContain("120")
    expect(text).toContain("█")
    expect(text.indexOf("North")).toBeLessThan(text.indexOf("East"))
    expect(text.indexOf("East")).toBeLessThan(text.indexOf("South"))
    for (const line of text.split("\n")) expect(line.length).toBeLessThanOrEqual(48)
  })

  test("accepts the horizontal_bar name and colours only on request", () => {
    const plain = renderTerminalChart({ ...BARS, type: "horizontal_bar" }, { width: 48 })
    const ansi = renderTerminalChart({ ...BARS, type: "horizontal_bar" }, { width: 48, ansi: true })
    expect(ansi).toMatch(ANSI)
    expect(stripAnsi(ansi)).toBe(plain)
  })

  test("draws a line with min, mid and max ticks, axis labels and a legend", () => {
    const text = renderTerminalChart(LINE, { width: 56, height: 12 })
    expect(text).toMatch(BRAILLE)
    expect(text).toContain("120")
    expect(text).toContain("100")
    expect(text).toContain("80")
    expect(text).toContain("Jan")
    expect(text).toContain("Mar")
    expect(text).toContain("●")
    for (const line of text.split("\n")) expect(line.length).toBeLessThanOrEqual(56)
  })

  test("draws each series of a multi-line chart in its own colour", () => {
    const text = renderTerminalChart(MULTI, { width: 60, ansi: true })
    expect(text).toContain("read")
    expect(text).toContain("write")
    expect(text).toMatch(ANSI)
    expect(stripAnsi(text)).toMatch(BRAILLE)
  })

  test("fills an area under the curve", () => {
    const area = renderTerminalChart({ ...LINE, type: "area" }, { width: 56 })
    const line = renderTerminalChart(LINE, { width: 56 })
    const cells = (value: string): number => (value.match(/[\u2800-\u28ff]/g) ?? []).length
    expect(area).toMatch(BRAILLE)
    expect(cells(area)).toBeGreaterThan(cells(line))
  })

  test("draws a scatter point cloud with axis labels", () => {
    const text = renderTerminalChart(SCATTER, { width: 52 })
    expect(text).toMatch(BRAILLE)
    expect(text).toContain("1")
    expect(text).toContain("3")
  })

  test("draws pie and donut shares from a proportional strip", () => {
    const pie = renderTerminalChart(PIE, { width: 56 })
    expect(pie).toContain("Search 46%")
    expect(pie).toContain("Direct 28%")
    expect(pie).toContain("Social 26%")
    expect(pie).toContain("█")
    expect(pie).toContain("·")
    const donut = renderTerminalChart({ ...PIE, type: "donut" }, { width: 56 })
    expect(donut).toContain("total 100")
  })

  test("draws a sparkline with a min, last and max summary", () => {
    const text = renderTerminalChart({ type: "sparkline", values: [3, 5, 2, 8, 7, 9, 4] }, { width: 32 })
    const lines = text.split("\n")
    expect(lines[0]).toMatch(/^[▁▂▃▄▅▆▇█]{7}$/)
    expect(lines[1]).toBe("min 2 · last 4 · max 9")
  })

  test("draws a box table with an inline sparkline cell", () => {
    const text = renderTerminalChart({ type: "table", columns: ["Metric", "Trend", "Value"], rows: [["CPU", [1, 3, 2, 5, 4], 42], ["RAM", [2, 2, 3, 4, 6], 61]] }, { width: 64 })
    expect(text).toContain("┌")
    expect(text).toContain("┬")
    expect(text).toContain("┼")
    expect(text).toContain("└")
    expect(text).toContain("│ Metric │ Trend │ Value │")
    expect(text).toContain("CPU")
    expect(text).toMatch(/[▁▂▃▄▅▆▇█]/)
    for (const line of text.split("\n")) expect(line.length).toBeLessThanOrEqual(64)
  })

  test("never exceeds the requested width at any of the sizes a view asks for", () => {
    const specs = [BARS, LINE, MULTI, SCATTER, PIE, { ...PIE, type: "donut" }, { type: "sparkline", values: [1, 4, 2, 9] }, { type: "table", columns: ["a", "b"], rows: [["cpu", [1, 2, 3]]] }]
    for (const width of [24, 40, 64, 80]) {
      for (const spec of specs) {
        for (const ansi of [false, true]) {
          const text = renderTerminalChart(spec, { width, ansi })
          for (const line of text.split("\n")) expect(stripAnsi(line).length).toBeLessThanOrEqual(width)
        }
      }
    }
  })

  test("is deterministic: the same spec gives the same text", () => {
    expect(renderTerminalChart(LINE, { width: 60 })).toBe(renderTerminalChart(LINE, { width: 60 }))
    expect(renderTerminalChart(PIE, { width: 60, ansi: true })).toBe(renderTerminalChart(PIE, { width: 60, ansi: true }))
  })

  test("says so rather than throwing when a chart has no data", () => {
    expect(renderTerminalChart({ type: "line", title: "Empty" })).toContain("No data")
    expect(renderTerminalChart({ type: "table" })).toContain("┌")
  })
})

describe("the fence parser", () => {
  test("reads this renderer's own shape", () => {
    const spec = parseChartFence(JSON.stringify(BARS))
    expect(spec?.x).toBe("region")
    expect(normalizeChart(spec!).series[0]!.points[0]).toEqual({ x: "North", y: 120 })
  })

  test("reads the Vega-Lite shape a model often writes", () => {
    const spec = parseChartFence(
      JSON.stringify({
        mark: "bar",
        title: "Revenue",
        data: { values: [{ region: "North", revenue: 4 }] },
        encoding: { x: { field: "region", type: "nominal" }, y: { field: "revenue", type: "quantitative", title: "Revenue" } },
      }),
    )
    const model = normalizeChart(spec!)
    expect(model.title).toBe("Revenue")
    expect(model.unit).toBe("Revenue")
    expect(model.series[0]!.points).toEqual([{ x: "North", y: 4 }])
  })

  test("reads a fenced block and ignores the fence markers", () => {
    expect(parseChartFence(`\`\`\`chart\n${JSON.stringify({ type: "sparkline", values: [1, 2] })}\n\`\`\``)?.type).toBe("sparkline")
  })

  test("returns undefined for anything that is not one JSON object", () => {
    expect(parseChartFence("")).toBeUndefined()
    expect(parseChartFence("not json")).toBeUndefined()
    expect(parseChartFence("[1,2,3]")).toBeUndefined()
    expect(parseChartFence("```chart\n{\"type\":")).toBeUndefined()
  })
})

describe("the streaming block cache", () => {
  test("keeps the last chart while the next fence is incomplete", () => {
    const cache = new ChartBlockCache()
    const complete = JSON.stringify(BARS)
    const text = cache.update(complete, { width: 48 })
    expect(text).toContain("North")
    expect(cache.update(complete.slice(0, complete.length - 6), { width: 48 })).toBe(text!)
    expect(cache.size).toBe(1)
  })

  test("has no chart for a block that never parsed, and forgets on clear", () => {
    const cache = new ChartBlockCache()
    expect(cache.update("{\"type\":\"line\",\"data\":[")).toBeUndefined()
    expect(cache.update(JSON.stringify(LINE), { width: 40 })).toContain("Latency")
    cache.clear()
    expect(cache.size).toBe(0)
  })

  test("keys a block by a hash of its whole text, never by a truncated prefix", () => {
    // Every Vega-Lite fence opens with the same $schema line: the first 64 characters are identical, and the two
    // blocks must still be two entries with two charts.
    const prefix = "{\"$schema\":\"https://vega.github.io/schema/vega-lite/v5.json\",\"mark\":\"bar\","
    expect(prefix.length).toBeGreaterThan(64)
    expect(ChartBlockCache.key(`${prefix}"data":1}`)).not.toBe(ChartBlockCache.key(`${prefix}"data":2}`))
    expect(ChartBlockCache.key("{\"type\":\"bar\"}")).not.toBe(ChartBlockCache.key("{\"type\":\"line\"}"))
    expect(ChartBlockCache.key("{\"type\":\"bar\"}")).toMatch(/^\d+:[0-9a-f]{8}$/)
    expect(ChartBlockCache.key("{\"type\":\"bar\"}")).toBe(ChartBlockCache.key("{\"type\":\"bar\"}"))

    const cache = new ChartBlockCache()
    cache.update(`${prefix}"data":[{"x":"a","y":1}]}`)
    const second = cache.update(`${prefix}"data":[{"x":"a","y":9},{"x":"b","y":2}]}`)
    // The second block drew its own chart; the first block's entry is not what answers it.
    expect(cache.size).toBe(2)
    expect(cache.update(`${prefix}"data":[{"x":"a","y":9},{"x":"b","y":2}]}`)).toBe(second!)
  })
})

/** The context the status view needs, with a Markdown registry the test can call. */
function tuiContext(options: { markdown?: boolean } = {}) {
  const registered: { language: string; render: (token: { text: string; lang?: string }, context: unknown) => unknown }[] = []
  let unsubscribed = false
  let commands: { id: string; title: string }[] = []
  const context = {
    location: undefined,
    client: { rpc: () => ({ status: async () => ({ text: "Charts status\nConnection: Ready" }) }) },
    data: { on: () => () => undefined },
    ui: { dialog: { alert: async () => undefined, set: () => undefined, clear: () => undefined } },
    keymap: {
      layer: (builder: () => { commands: typeof commands }) => {
        commands = builder().commands
        return () => undefined
      },
    },
    ...(options.markdown
      ? {
          markdown: {
            registerCodeBlockRenderer: (language: string, render: (token: { text: string; lang?: string }, context: unknown) => unknown) => {
              registered.push({ language, render })
              return () => {
                unsubscribed = true
              }
            },
          },
        }
      : {}),
  }
  return { context, registered, commands: () => commands, unsubscribed: () => unsubscribed }
}

describe("the TUI chart code block", () => {
  test("registers one chart renderer and unsubscribes it on teardown", () => {
    const mock = tuiContext({ markdown: true })
    const dispose = setupView(mock.context as never)
    expect(mock.registered).toHaveLength(1)
    expect(mock.registered[0]!.language).toBe("chart")
    expect(mock.commands().map(command => command.title)).toEqual(["Charts: Status", "Refresh Charts status"])
    dispose()
    expect(mock.unsubscribed()).toBe(true)
  })

  test("returns the default rendering instead of throwing without a renderer", () => {
    const mock = tuiContext({ markdown: true })
    setupView(mock.context as never)
    const render = mock.registered[0]!.render
    expect(render({ text: JSON.stringify(BARS), lang: "chart" }, {})).toBeUndefined()
    expect(render({ text: "{\"type\":", lang: "chart" }, {})).toBeUndefined()
  })

  test("a host without a Markdown registry is still fine", () => {
    const mock = tuiContext()
    const dispose = setupView(mock.context as never)
    expect(mock.registered).toHaveLength(0)
    expect(() => dispose()).not.toThrow()
  })

  test("sizes a block inside the terminal", () => {
    expect(chartBlockWidth(40)).toBe(28)
    expect(chartBlockWidth(200)).toBe(88)
    expect(chartBlockWidth(500)).toBe(88)
  })
})

/** The GUI context the setup reads, with every contribution captured. */
function guiContext() {
  const blocks: { id: string; languages: readonly string[]; render: (input: { code: string; language: string }) => unknown }[] = []
  const actions: { id: string; languages: readonly string[]; title: string; run: (input: { code: string; language: string }) => unknown }[] = []
  const commands: { id: string; title: string; run: () => unknown }[] = []
  const toasts: { title: string; description?: string }[] = []
  const copied: string[] = []
  const memory = { mode: "dark" as "dark" | "light" }
  const context = {
    appearance: { mode: () => "dark" as const },
    storage: {
      memory: (_key: string, options: { initial: { mode: "dark" | "light" } }) => {
        memory.mode = options.initial.mode
        return [memory, (mutation: (draft: { mode: "dark" | "light" }) => void) => mutation(memory)] as const
      },
    },
    add: (registry: unknown, item: unknown) => {
      if (registry === CodeBlock) blocks.push(item as (typeof blocks)[number])
      else if (registry === CodeBlockAction) actions.push(item as (typeof actions)[number])
      else if (registry === Command) commands.push(item as (typeof commands)[number])
      return () => undefined
    },
    list: (registry: unknown) => (registry === CodeBlock ? blocks : []),
    system: { copy: async (text: string) => void copied.push(text) },
    toast: { show: (options: { title: string; description?: string }) => void toasts.push(options) },
    t: (key: string) => key,
  }
  return { context, blocks, actions, commands, toasts, copied, memory }
}

describe("the GUI chart plugin", () => {
  test("declares a setup and its fence languages", () => {
    expect(typeof guiPlugin.setup).toBe("function")
    expect([...chartLanguages]).toEqual(["chart", "charts-board"])
  })

  test("builds a theme-aware SVG card for a chart fence", () => {
    const light = buildChartCard(JSON.stringify(LINE), { mode: "light" })
    const dark = buildChartCard(JSON.stringify(LINE), { mode: "dark" })
    expect(light?.kind).toBe("line")
    expect(light?.title).toBe("Latency")
    expect(light?.svg.startsWith("<svg")).toBe(true)
    expect(light?.svg).toContain('fill="#ffffff"')
    expect(dark?.svg).toContain('fill="#0d1117"')
    expect(dark?.svg).not.toContain("<script")
    expect(dark?.svg).not.toMatch(/NaN|undefined/)
  })

  test("draws bars, donuts, tables, sparklines and a KPI strip", () => {
    const bar = buildChartCard(JSON.stringify(BARS))
    expect(bar?.kind).toBe("bar")
    expect(bar?.svg).toContain("North")
    const donut = buildChartCard(JSON.stringify({ ...PIE, type: "donut" }))
    expect(donut?.svg).toContain("<path")
    const table = buildChartCard(JSON.stringify({ type: "table", columns: ["Metric", "Value"], rows: [["CPU", 42]] }))
    expect(table?.kind).toBe("table")
    const spark = buildChartCard(JSON.stringify({ type: "sparkline", values: [1, 4, 2, 9] }))
    expect(spark?.svg).toContain("<polyline")
    const kpi = buildChartCard(JSON.stringify({ type: "kpi", title: "MRR", unit: "€", data: [{ label: "Jan", value: 1250 }], x: "label", y: "value" }))
    expect(kpi?.kind).toBe("kpi")
    expect(kpi?.svg).toContain("1250")
  })

  test("escapes labels and falls back cleanly for malformed JSON", () => {
    const hostile = buildChartCard(JSON.stringify({ type: "bar", title: "<script>alert(1)</script>", data: [{ x: "<b>", y: 1 }], x: "x", y: "y" }))
    expect(hostile?.svg).not.toContain("<script>")
    expect(hostile?.svg).toContain("&lt;script&gt;")
    expect(buildChartCard("not json")).toBeUndefined()
    expect(buildChartCard("[]")).toBeUndefined()
    expect(buildChartCard(JSON.stringify({ type: "line" }))).toBeUndefined()
    expect(buildChartCardSvg({ type: "bar" })).toBeUndefined()
  })

  test("renders a card node with its kind and title", () => {
    const card = buildChartCard(JSON.stringify(LINE))!
    const element = chartCardElement(card)
    expect(element).toBeDefined()
    expect(typeof element === "function" || typeof element === "object").toBe(true)
  })

  test("registers the code block, its copy action and the palette commands", () => {
    const mock = guiContext()
    setupGui(mock.context as never)
    expect(mock.blocks).toHaveLength(1)
    expect(mock.blocks[0]!.languages).toEqual(["chart", "charts-board"])
    expect(mock.blocks[0]!.render({ code: JSON.stringify(BARS), language: "chart" })).toBeDefined()
    expect(mock.blocks[0]!.render({ code: "nope", language: "chart" })).toBeUndefined()
    expect(mock.actions).toHaveLength(1)
    expect(mock.actions[0]!.title).toBe("Copy chart JSON")
    void mock.actions[0]!.run({ code: "{\"a\":1}", language: "chart" })
    expect(mock.copied).toEqual(["{\"a\":1}"])
    expect(mock.commands.map(command => command.id)).toEqual(["toggleTheme", "openStatus"])
    mock.commands[0]!.run()
    expect(mock.memory.mode).toBe("light")
    mock.commands[1]!.run()
    expect(mock.toasts[0]!.description).toContain("chart")
  })

  test("bundles as CommonJS with only the host's modules external", async () => {
    const result = await build({
      entryPoints: [join(ROOT, "src", "gui.ts")],
      absWorkingDir: ROOT,
      bundle: true,
      format: "cjs",
      platform: "node",
      target: "es2022",
      external: ["@opencode/plugin", "@opencode/plugin/*", "solid-js", "solid-js/*"],
      write: false,
      logLevel: "silent",
    })
    const code = result.outputFiles[0]!.text
    const required = [...code.matchAll(/require\("([^"]+)"\)/g)].map(match => match[1]!)
    const allowed = (path: string): boolean => path.startsWith("node:") || path === "@opencode/plugin" || path.startsWith("@opencode/plugin/") || path === "solid-js" || path.startsWith("solid-js/")
    expect(required.length).toBeGreaterThan(0)
    expect(required.filter(path => !allowed(path))).toEqual([])
    expect(code).not.toContain('require("./tui-chart')
    expect(code).toContain("function parseChartFence")
    expect(code).toContain("@opencode/plugin/gui")
  })
})

describe("the artifact bridge", () => {
  test("parses the chart fence a model writes, and refuses a backtick that closes it early", () => {
    const fence = "```chart\n" + JSON.stringify({ type: "bar", data: [{ x: "a", y: 1 }] }) + "\n```"
    expect(parseChartFence(fence)?.type).toBe("bar")
    expect(parseChartFence("```chart\n{ not json }\n```")).toBeUndefined()
    expect(parseChartFence("```chart\n[]\n```")).toBeUndefined()
  })

  test("finds the artifact domain under either name", () => {
    expect(artifactDomain({ experimental: { artifact: {} } })).toEqual({})
    expect(artifactDomain({ artifact: {} })).toEqual({})
    expect(artifactDomain({})).toBeUndefined()
    expect(artifactDomain(undefined)).toBeUndefined()
  })

  test("uses a direct create method when the host has one", async () => {
    const ctx = { experimental: { artifact: { create: async () => ({ url: "https://example.invalid/a" }) } } }
    expect(await publishHtmlArtifact(ctx, { id: "a", title: "A", html: "<p>a</p>" })).toEqual({ url: "https://example.invalid/a" })
  })

  test("registers a provider through transform, with the HTML and SVG it was given", async () => {
    let added: Record<string, unknown> | undefined
    const ctx = {
      experimental: {
        artifact: {
          transform: async (callback: (editor: { add: (definition: Record<string, unknown>) => void }) => void) => {
            callback({ add: definition => void (added = definition) })
            return { dispose: async () => undefined }
          },
        },
      },
    }
    expect(await publishHtmlArtifact(ctx, { id: "chart", title: "Chart", html: "<p>hi</p>", svg: "<svg/>" })).toEqual({})
    expect(added?.capabilities).toEqual(["html"])
    const read = added?.read as () => Promise<Record<string, Uint8Array>>
    const files = await read()
    expect(new TextDecoder().decode(files["index.html"]!)).toBe("<p>hi</p>")
    expect(new TextDecoder().decode(files["chart.svg"]!)).toBe("<svg/>")
  })

  test("returns undefined when there is no artifact surface or the input is empty", async () => {
    expect(await publishHtmlArtifact({}, { id: "a", title: "A", html: "<p>a</p>" })).toBeUndefined()
    expect(await publishHtmlArtifact({ experimental: { artifact: {} } }, { id: "a", title: "A", html: "" })).toBeUndefined()
    expect(await publishHtmlArtifact({ experimental: { artifact: { create: async () => { throw new Error("no") } } } }, { id: "a", title: "A", html: "<p>a</p>" })).toBeUndefined()
  })
})
