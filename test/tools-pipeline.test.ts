import { afterAll, describe, expect, test } from "bun:test"
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs"
import { join } from "node:path"
import { closeVegaWorker } from "../src/engines/vega-pool.ts"
import { US_STATE_HEX_GRID } from "../src/geo/cartograms.ts"
import { TOOL_NAMES } from "../src/registry.ts"
import { runTool, type ToolName } from "../src/tools.ts"
import { workspace } from "./helpers.ts"

/**
 * The five pipelines and the three high-leverage tools, through the public tool path (`runTool`, which the plugin and
 * the tools RPC both call): the Plot, table and diagram engines behind charts_render, the five-part figure frame, the
 * annotation layer, portable motion, the GIF export, and charts_table, charts_diagram and charts_board.
 *
 * Everything here is a promise a reader can see in the files: the SVG draws the frame and the annotations, the GIF is
 * a GIF, the PNG stays still while the SVG animates, the table's page is locked down by a policy, and the board writes
 * its four files.
 */

const spaces: { cleanup: () => void }[] = []
afterAll(async () => { for (const space of spaces) space.cleanup(); await closeVegaWorker() })

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

function setup() {
  const ws = workspace()
  spaces.push(ws)
  const asserts: { action: string; resources: string[] }[] = []
  const env = {
    ...ws.env,
    assertFiles: async (action: "read" | "edit", resources: readonly string[]) => { asserts.push({ action, resources: [...resources] }) },
  }
  const run = async (tool: ToolName, input: Record<string, unknown>) => runTool(env as never, tool, input)
  const call = async (tool: ToolName, input: Record<string, unknown>) => (await run(tool, input)).output as Record<string, any>
  const text = async (tool: ToolName, input: Record<string, unknown>) => (await run(tool, input)).content.flatMap(part => (part.type === "text" ? [part.text] : [])).join("\n")
  const read = (path: string) => readFileSync(join(ws.dir, path), "utf8")
  const bytes = (path: string) => readFileSync(join(ws.dir, path))
  const write = (path: string, content: string) => { mkdirSync(join(ws.dir, path, ".."), { recursive: true }); writeFileSync(join(ws.dir, path), content) }
  return { dir: ws.dir, env, call, text, read, bytes, write, asserts }
}

/** Two numeric fields, a date and a handful of categories: enough for every engine. */
const ROWS = Array.from({ length: 40 }, (_, i) => ({
  x: (i * 13) % 37,
  y: (i * 29) % 41,
  month: `2026-${String((i % 12) + 1).padStart(2, "0")}-01`,
  region: ["North", "South", "East", "West"][i % 4]!,
  segment: ["Consumer", "Enterprise", "SMB"][i % 3]!,
  revenue: 40 + ((i * 17) % 160),
  orders: 5 + ((i * 7) % 30),
  growth: ((i * 11) % 40 - 12) / 100,
  score: 40 + ((i * 23) % 55),
  target: 60 + (i % 30),
  trend: [3, 5, 4, 7, 6] as number[],
  status: ["On track", "At risk", "Ahead"][i % 3]!,
}))

const LINE = { mark: "line", encoding: { x: { field: "month", type: "temporal" }, y: { field: "revenue", type: "quantitative" } } }

describe("charts_render draws with the Plot, table and diagram engines", () => {
  test("a Plot recipe compiles and draws, and its spec is written with a plot suffix", async () => {
    const t = setup()
    const out = await t.call("render", { spec: { plotRecipe: "hexbin", bindings: { x: "x", y: "y" } }, engine: "plot", data: { rows: ROWS }, formats: ["svg", "png", "spec"], title: "Hexbin of two fields" })
    expect(out.engine).toBe("plot")
    expect(out.files).toEqual({ svg: "outputs/charts/hexbin-of-two-fields.svg", png: ["outputs/charts/hexbin-of-two-fields.png"], spec: "outputs/charts/hexbin-of-two-fields.plot.json" })
    const svg = t.read(out.files.svg)
    expect(svg.startsWith("<svg")).toBe(true)
    expect(svg).toContain('role="img"')
    expect(t.bytes(out.files.png[0]!).subarray(0, 8)).toEqual(PNG_SIGNATURE)
    const spec = JSON.parse(t.read(out.files.spec)) as { marks: { type: string }[] }
    expect(spec.marks.map(mark => mark.type)).toContain("hexbin")
  })

  test("the US hex cartogram recipe draws all 51 cells from its own atlas grid", async () => {
    const t = setup()
    const states = US_STATE_HEX_GRID.slice(0, 40).map((cell, i) => ({ postal: cell.postal, value: 3 + i * 3 }))
    const out = await t.call("render", { spec: { plotRecipe: "cartogram_us_hex", bindings: { code: "postal", value: "value" } }, engine: "plot", data: { rows: states }, formats: ["svg"], title: "States", width: 620, height: 420 })
    const svg = t.read(out.files.svg)
    expect(out.engine).toBe("plot")
    expect(svg).toContain(">CA<")
    expect(svg).toContain(">NY<")
    expect(out.width).toBeGreaterThan(500)
  })

  test("a table through charts_render draws its headline once, inside the frame", async () => {
    const t = setup()
    const out = await t.call("render", {
      spec: {
        title: "Revenue by region", kicker: "Commercial review", subtitle: "Monthly revenue, seasonally adjusted",
        columns: [{ field: "region", label: "Region" }, { field: "revenue", label: "Revenue", format: "currency", cell: "bar" }],
      },
      engine: "table", data: { rows: ROWS }, formats: ["svg"],
      title: "Revenue by region", kicker: "Commercial review", subtitle: "Monthly revenue, seasonally adjusted",
    })
    expect(out.engine).toBe("table")
    const svg = t.read(out.files.svg)
    // The frame draws the kicker, headline and standfirst; the table draws the grid. Each appears exactly once.
    expect(svg.match(/>Revenue by region<\/text>/g)?.length).toBe(1)
    expect(svg.match(/>COMMERCIAL REVIEW<\/text>/g)?.length).toBe(1)
    expect(svg.match(/>Monthly revenue, seasonally adjusted<\/text>/g)?.length).toBe(1)
    expect(svg).toContain(">Revenue<")
    expect(svg).toContain(">Region<")
    expect(svg).toContain("<rect")
  })

  test("a diagram through charts_render draws its headline once, inside the frame", async () => {
    const t = setup()
    const out = await t.call("render", {
      spec: { dsl: "graph TD\n  A[Intake] --> B[Build]", title: "Triage flow", kicker: "Operations", subtitle: "Two steps" },
      engine: "diagram", formats: ["svg"],
      title: "Triage flow", kicker: "Operations", subtitle: "Two steps",
    })
    expect(out.engine).toBe("diagram")
    const svg = t.read(out.files.svg)
    expect(svg.match(/>Triage flow<\/text>/g)?.length).toBe(1)
    expect(svg.match(/>OPERATIONS<\/text>/g)?.length).toBe(1)
    expect(svg.match(/>Two steps<\/text>/g)?.length).toBe(1)
    expect(svg).toContain(">Intake<")
    expect(svg).toContain(">Build<")
  })

  test("a table spec draws from charts_render too, and its ASCII-free page is static", async () => {
    const t = setup()
    const out = await t.call("render", { spec: { title: "Revenue", columns: [{ field: "region", label: "Region" }, { field: "revenue", format: "currency", cell: "bar" }] }, engine: "table", data: { rows: ROWS }, formats: ["svg", "html"], title: "Revenue" })
    expect(out.engine).toBe("table")
    const page = t.read(out.files.html)
    expect(page).toContain("Content-Security-Policy")
    expect(page).toContain("<table")
    expect(page).toContain("script-src")
  })
})

describe("the editorial frame, annotations and motion", () => {
  test("a kicker, subtitle and source compose the five-part figure around the drawing", async () => {
    const t = setup()
    const plain = await t.call("render", { spec: LINE, data: { rows: ROWS }, formats: ["svg"], title: "Revenue climbed 12% in the North" })
    const framed = await t.call("render", {
      spec: LINE, data: { rows: ROWS }, formats: ["svg"], title: "Revenue climbed 12% in the North",
      kicker: "Economy", subtitle: "Monthly revenue, seasonally adjusted", source: "Source: Office for National Statistics", notes: "Provisional figures.",
    })
    const svg = t.read(framed.files.svg)
    // The kicker is drawn uppercase, the headline, the standfirst and the footer as the frame lays them out.
    expect(svg).toContain(">ECONOMY<")
    expect(svg).toContain(">Revenue climbed 12% in the North<")
    expect(svg).toContain(">Monthly revenue, seasonally adjusted<")
    expect(svg).toContain(">Source: Office for National Statistics<")
    expect(svg).toContain(">Provisional figures.<")
    // The frame is taller than the drawing alone, and the headline is drawn once, not twice.
    expect(framed.height).toBeGreaterThan(plain.height)
    expect(svg.match(/>Revenue climbed 12% in the North<\/text>/g)?.length).toBe(1)
  })

  test("a paired theme's SVG carries both polarities, text as paths included, and the page gets the same drawing", async () => {
    const t = setup()
    const out = await t.call("render", {
      spec: { plotRecipe: "hexbin", bindings: { x: "x", y: "y" } }, engine: "plot", data: { rows: ROWS },
      formats: ["svg", "html"], svgText: "paths",
      theme: { name: "brand", seed: { accent: "#D97757" } },
      title: "Sessions against conversions",
    })
    const svg = t.read(out.files.svg)
    // One drawing, two polarities: every token is a --cs- custom property, and the media query turns it round.
    expect(svg).toContain("--cs-")
    expect(svg).toContain("@media (prefers-color-scheme: dark)")
    expect(svg).toContain("var(--cs-")
    // Text was written as paths, so the drawing carries no text element at all.
    expect(svg).not.toContain("<text")
    // The page carries the same adaptive drawing, and its spec names the seed the marks were placed with.
    const page = t.read(out.files.html)
    expect(page).toContain("--cs-")
    const spec = JSON.parse(/<script type="application\/json" id="chart-spec">([\s\S]*?)<\/script>/.exec(page)?.[1] ?? "{}") as { seed?: number }
    expect(spec.seed).toBe(1)
  })

  test("a reference line and a callout are injected over the plot, inside one group", async () => {
    const t = setup()
    const out = await t.call("render", {
      spec: { plotRecipe: "hexbin", bindings: { x: "x", y: "y" } }, engine: "plot", data: { rows: ROWS }, formats: ["svg"], title: "Annotated",
      annotations: [
        { type: "line", axis: "y", value: 18, domain: [0, 40], label: "Target" },
        { type: "callout", x: 160, y: 120, text: "Densest cell", subtext: "Most rows land here" },
      ],
    })
    const svg = t.read(out.files.svg)
    expect(svg).toContain('class="charts-annotations"')
    expect(svg).toContain(">Target<")
    expect(svg).toContain(">Densest cell<")
    expect(svg).toContain(">Most rows land here<")
    expect(svg.indexOf("charts-annotations")).toBeLessThan(svg.lastIndexOf("</svg>"))
  })

  test("motion animates the written SVG with CSS only, and the PNG of the same chart stays still", async () => {
    const t = setup()
    const still = await t.call("render", { spec: LINE, data: { rows: ROWS }, formats: ["svg"], title: "Still" })
    const drawn = await t.call("render", { spec: LINE, data: { rows: ROWS }, formats: ["svg", "png"], motion: "draw", title: "Drawn" })
    const stillSvg = t.read(still.files.svg)
    const animatedSvg = t.read(drawn.files.svg)
    expect(stillSvg).not.toContain("animation")
    expect(animatedSvg).toContain("@keyframes")
    expect(animatedSvg).toContain("animation")
    expect(animatedSvg).toContain("prefers-reduced-motion")
    // The PNG is rasterised from the static drawing, so it is a picture with no animation in it.
    expect(t.bytes(drawn.files.png[0]!).subarray(0, 8)).toEqual(PNG_SIGNATURE)
  })

  test("the gif format writes a real GIF89a animation beside the still SVG and PNG", async () => {
    const t = setup()
    const out = await t.call("render", { spec: LINE, data: { rows: ROWS }, formats: ["svg", "png", "gif"], fps: 10, title: "Reveal" })
    expect(Object.keys(out.files).sort()).toEqual(["gif", "png", "svg"])
    expect(out.files.gif).toBe("outputs/charts/reveal.gif")
    expect(t.bytes(out.files.gif).subarray(0, 6).toString("ascii")).toBe("GIF89a")
    expect(t.bytes(out.files.png[0]!).subarray(0, 8)).toEqual(PNG_SIGNATURE)
    expect(existsSync(join(t.dir, out.files.svg))).toBe(true)
  })

  test("an ECharts timeline becomes a GIF of its frames and a story page, with the first frame as the SVG", async () => {
    const t = setup()
    const option = {
      baseOption: { xAxis: { type: "category", data: ["a", "b", "c"] }, yAxis: { type: "value" }, series: [{ type: "bar", data: [1, 2, 3] }] },
      timeline: { data: ["2025", "2026"] },
      options: [{ series: [{ type: "bar", data: [2, 3, 1] }] }, { series: [{ type: "bar", data: [4, 1, 6] }] }],
    }
    const out = await t.call("render", { spec: option, engine: "echarts", formats: ["svg", "gif", "html"], title: "Two years" })
    expect(out.engine).toBe("echarts")
    expect(t.bytes(out.files.gif).subarray(0, 6).toString("ascii")).toBe("GIF89a")
    const page = t.read(out.files.html)
    expect(page).toContain('class="story-step"')
    expect(page).toContain("2025")
    expect(page).toContain("Content-Security-Policy")
  })
})

describe("the table tool draws a publication data graphic", () => {
  test("sparklines, bars, deltas, spanners and a summary row become one SVG, a PNG and an accessible page", async () => {
    const t = setup()
    const out = await t.call("table", {
      data: { rows: ROWS },
      title: "Regional revenue, 2026",
      subtitle: "Growth against target, with a five-quarter trend",
      kicker: "Commercial review",
      source: "Source: finance close, November 2026",
      notes: "Targets are board-approved plan.",
      rowGroupField: "segment",
      zebra: true,
      highlightRows: ["East"],
      summaryRow: { label: "Total", operations: { revenue: "sum", growth: "mean" } },
      formats: ["svg", "png", "html"],
      columns: [
        { field: "region", label: "Region" },
        { field: "revenue", label: "Revenue", spanner: "Money", format: "currency", cell: "bar" },
        { field: "growth", label: "Growth", spanner: "Money", format: "percent", cell: "delta" },
        { field: "score", label: "Score", spanner: "Delivery", cell: "bullet", targetField: "target" },
        { field: "trend", label: "Trend", spanner: "Shape", cell: "sparkline" },
        { field: "trend", label: "Area", spanner: "Shape", cell: "sparkarea" },
        { field: "trend", label: "Bars", spanner: "Shape", cell: "sparkbar" },
        { field: "status", label: "Status", cell: "badge", badgeColors: { "At risk": "#CC3344", Ahead: "#228833" } },
      ],
    })
    expect(out.engine).toBe("table")
    expect(Object.keys(out.files).sort()).toEqual(["html", "png", "svg"])
    const svg = t.read(out.files.svg)
    for (const label of ["Regional revenue, 2026", "COMMERCIAL REVIEW", "Money", "Delivery", "Shape", "Total", "Revenue", "Growth"]) expect(svg).toContain(label)
    // An inline sparkline is a path inside a cell, not a number alone.
    expect(svg).toContain("<path")
    expect(t.bytes(out.files.png[0]!).subarray(0, 8)).toEqual(PNG_SIGNATURE)
    const page = t.read(out.files.html)
    expect(page).toContain("<table")
    expect(page).toContain("Copy TSV")
    expect(page).toContain("Content-Security-Policy")
    expect(page).toMatch(/script-src 'sha256-/)
    expect(t.asserts).toContainEqual({ action: "edit", resources: ["outputs/charts/*"] })
  })

  test("a column no row carries is refused with its own error, not drawn empty", async () => {
    const t = setup()
    const error = await runTool(t.env as never, "table", { data: { rows: ROWS }, columns: [{ field: "missing", cell: "bar" }] }).catch((caught: unknown) => caught)
    expect((error as { code?: string }).code).toBe("FIELD_MISSING")
  })
})

describe("charts_diagram draws Mermaid source or a structured recipe", () => {
  test("Mermaid flowchart source draws, rasterises, and returns a Unicode outline", async () => {
    const t = setup()
    const out = await t.call("diagram", { dsl: "flowchart LR\n  ingest[Ingest] --> model[Model] --> publish[Publish]", title: "Pipeline", formats: ["svg", "png"] })
    expect(out.engine).toBe("diagram")
    expect(Object.keys(out.files).sort()).toEqual(["png", "svg"])
    const svg = t.read(out.files.svg)
    expect(svg).toContain(">Ingest<")
    expect(svg).toContain(">Publish<")
    expect(String(out.ascii)).toContain("Ingest")
    expect(String(out.ascii)).toContain("Model")
    expect(t.bytes(out.files.png[0]!).subarray(0, 8)).toEqual(PNG_SIGNATURE)
    const text = await t.text("diagram", { dsl: "flowchart LR\n  a --> b", formats: ["svg"], name: "outline" })
    expect(text).toContain("Structure:")
  })

  test("a fishbone recipe names its effect and its categories, and draws its causes", async () => {
    const t = setup()
    const out = await t.call("diagram", { kind: "fishbone", effect: "Late deliveries", categories: [{ category: "People", causes: ["Thin crew", "Training"] }, { category: "Systems", causes: ["Old scanner"] }], formats: ["svg", "png"] })
    const svg = t.read(out.files.svg)
    expect(svg).toContain("Late deliveries")
    expect(svg).toContain("People")
    expect(svg).toContain("Thin crew")
    expect(String(out.ascii)).toContain("Cause-and-effect: Late deliveries")
    expect(String(out.ascii)).toContain("Old scanner")
    // A fishbone without a title is named by the effect it explains.
    expect(out.files.svg).toBe("outputs/charts/late-deliveries.svg")
  })

  test("giving both dsl and kind is refused with the schema's own path", async () => {
    const t = setup()
    const error = await runTool(t.env as never, "diagram", { dsl: "flowchart LR\n a --> b", kind: "mindmap", formats: ["svg"] }).catch((caught: unknown) => caught)
    expect((error as { code?: string }).code).toBe("SPEC_INVALID")
    expect((error as { issues?: { path?: string }[] }).issues?.[0]?.path).toBe("/dsl")
  })
})

describe("charts_board publishes the dashboard", () => {
  function board() {
    return {
      version: 1,
      title: "Revenue overview",
      subtitle: "Monthly revenue by region and segment",
      kicker: "FY 2026",
      source: "Sales extract",
      datasets: {
        sales: { rows: ROWS.map(row => ({ month: row.month, region: row.region, segment: row.segment, revenue: row.revenue, orders: row.orders })) },
        channels: { rows: [{ channel: "Web", revenue: 640 }, { channel: "App", revenue: 480 }, { channel: "Store", revenue: 260 }] },
      },
      filters: [
        { id: "region", label: "Region", field: "region", control: "segmented" },
        { id: "segment", label: "Segment", field: "segment", control: "chips" },
        { id: "revenue", label: "Revenue up to", field: "revenue", control: "range" },
      ],
      kpis: [
        { id: "revenue", label: "Total revenue", dataset: "sales", field: "revenue", aggregate: "sum", format: "currency", delta: { value: 12.4, label: "vs last year" }, sparkline: { x: "month", y: "revenue" } },
        { id: "orders", label: "Orders", dataset: "sales", field: "orders", aggregate: "sum", format: "integer", sparkline: { x: "month", y: "orders" } },
      ],
      panels: [
        { id: "trend", title: "Revenue by month", dataset: "sales", span: 8, chart: { quick: { type: "line", x: "month", y: "revenue", aggregate: "sum" } } },
        { id: "channel", title: "Revenue by channel", dataset: "channels", span: 4, chart: { quick: { type: "bar", x: "channel", y: "revenue", aggregate: "sum" } } },
        { id: "detail", title: "Rows behind the trend", dataset: "sales", span: 12, height: 240, chart: { kind: "table", columns: [{ field: "month" }, { field: "region" }, { field: "revenue", format: "currency" }] } },
      ],
    }
  }

  test("writes the poster SVG, the 2x PNG, the offline .board.html and the .board.json", async () => {
    const t = setup()
    const out = await t.call("board", { board: board(), name: "revenue-board", inspect: true })
    expect(out.engine).toBe("board")
    expect(out.panels).toBe(3)
    expect(out.files).toEqual({
      svg: "outputs/charts/revenue-board.svg",
      png: "outputs/charts/revenue-board.png",
      html: "outputs/charts/revenue-board.board.html",
      board: "outputs/charts/revenue-board.board.json",
    })
    expect(out.markdown).toBe("![Revenue overview](outputs/charts/revenue-board.png)")
    expect(t.bytes(out.files.png).subarray(0, 8)).toEqual(PNG_SIGNATURE)
    const poster = t.read(out.files.svg)
    expect(poster).toContain("Total revenue")
    expect(poster).toContain("Revenue by month")
    const page = t.read(out.files.html)
    expect(page).toContain('id="board-config"')
    expect(page).toContain("Content-Security-Policy")
    expect(page).toMatch(/script-src 'sha256-/)
    const document = JSON.parse(t.read(out.files.board)) as { version: number; title: string; panels: unknown[] }
    expect(document.version).toBe(1)
    expect(document.title).toBe("Revenue overview")
    expect(document.panels).toHaveLength(3)
    expect(t.asserts).toContainEqual({ action: "edit", resources: ["outputs/charts/*"] })
  })

  test("a dataset read from a workspace file is asked for before it is read", async () => {
    const t = setup()
    t.write("data/sales.csv", "month,region,segment,revenue,orders\n2026-01-01,North,Consumer,120,4\n2026-02-01,South,SMB,90,3\n2026-03-01,East,Enterprise,140,6\n")
    const document = board()
    const out = await t.call("board", {
      board: { ...document, datasets: { ...document.datasets, file: { path: "data/sales.csv" } }, panels: [{ id: "file", title: "From a file", dataset: "file", span: 12, chart: { quick: { type: "bar", x: "region", y: "revenue", aggregate: "sum" } } }] },
      name: "from-file",
    })
    expect(t.asserts).toContainEqual({ action: "read", resources: ["data/sales.csv"] })
    expect(out.files.svg).toBe("outputs/charts/from-file.svg")
  })

  test("an unknown panel dataset is refused with the document's own JSON path", async () => {
    const t = setup()
    const document = board()
    const broken = { ...document, panels: [{ ...document.panels[0]!, dataset: "nowhere" }] }
    const error = await runTool(t.env as never, "board", { board: broken }).catch((caught: unknown) => caught)
    expect((error as { code?: string }).code).toBe("UNKNOWN_DATASET")
    expect((error as { path?: string }).path).toBe("/panels/0/dataset")
    expect(existsSync(join(t.dir, "outputs"))).toBe(false)
  })
})

describe("charts_capabilities reports the whole build", () => {
  test("names all twelve tools, six engines, nine themes and the gif format", async () => {
    const t = setup()
    const view = await t.call("capabilities", {})
    expect(view.contract).toBe("1.2.0")
    expect(view.tools.map((tool: { name: string }) => tool.name)).toEqual([...TOOL_NAMES])
    expect(view.tools).toHaveLength(12)
    expect(view.engines.map((engine: { id: string }) => engine.id)).toEqual(["vega-lite", "vega", "echarts", "plot", "table", "diagram"])
    expect(view.themes).toHaveLength(9)
    expect(view.formats.gif).toBe(view.formats.png)
    // A GIF needs the same rasteriser a PNG does, and nothing claims a module this build does not ship.
    expect(view.formats.svg).toBe(true)
    expect(view.formats.document).toBe(true)
    expect(view.knownLimits.join(" ")).not.toContain("no Plotly or Mermaid input")
    expect(view.knownLimits.join(" ")).toContain("Mermaid")
    const text = await t.text("capabilities", {})
    expect(text).toContain("GIF")
    expect(text).toContain("plot (")
    expect(text).toContain("table (")
    expect(text).toContain("diagram (")
    for (const name of ["board", "table", "diagram"]) expect(view.tools.map((tool: { name: string; class: string }) => `${tool.name}:${tool.class}`)).toContain(`${name}:export`)
  })
})
