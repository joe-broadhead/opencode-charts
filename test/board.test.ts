/**
 * Board documents, as documents: the strict schema and its JSON paths, the board cube (KPIs, sparklines, facets, the
 * client row cap), and the four files `renderBoard` publishes. Nothing here launches a browser: the generated
 * dashboard is exercised live in `test/browser/board.test.ts`.
 */
import { afterAll, describe, expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { aggregateRows, buildBoardCube, CLIENT_ROW_LIMIT, domainOf, facetOptions, filterRows, formatValue, sparkPoints, sparkSeries } from "../src/board/cube.ts"
import { renderBoard } from "../src/board/render-board.ts"
import { BoardDocumentSchema, BoardInvalid, boardDocumentIssues, parseBoardDocument, type BoardDocument } from "../src/board/schema.ts"
import { closeVegaWorker } from "../src/engines/vega-pool.ts"
import { checkRenderedSvg } from "../src/safety.ts"
import { BOARD_LOCALE as LOCALE, BOARD_MONTHS as MONTHS, BOARD_REGIONS as REGIONS, boardDocument, boardRows, ROOT } from "./helpers.ts"

const dirs: string[] = []
function workspaceEnv() {
  const dir = mkdtempSync(join(tmpdir(), "charts-board-"))
  dirs.push(dir)
  return { dir, env: { workspace: { directory: dir }, packageRoot: ROOT, configuredThemes: {}, defaults: { outDir: "outputs/charts" } } }
}

afterAll(async () => {
  await closeVegaWorker()
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

// ---------------------------------------------------------------------------------------------------------------
// The schema.

describe("BoardDocumentSchema", () => {
  test("fills the board's defaults: 1200 px, 12 columns, a 6-column 300 px panel", () => {
    const parsed = BoardDocumentSchema.parse({ version: 1, title: "A board", datasets: { sales: { rows: [{ region: "North", revenue: 1 }] } }, panels: [{ id: "one", title: "One", dataset: "sales", chart: { quick: { type: "bar", x: "region", y: "revenue" } } }] })
    expect(parsed.kind).toBe("board")
    expect(parsed.width).toBe(1200)
    expect(parsed.columns).toBe(12)
    expect(parsed.panels[0]!.span).toBe(6)
    expect(parsed.panels[0]!.height).toBe(300)
  })

  test("names the JSON path of a misspelt property", () => {
    const issues = boardDocumentIssues({ ...boardDocument(), titel: "Nope" })
    expect(issues.length).toBe(1)
    expect(issues[0]!.path).toBe("/titel")
    expect(issues[0]!.message).toContain("titel")
    expect(() => parseBoardDocument({ ...boardDocument(), titel: "Nope" })).toThrow(BoardInvalid)
  })

  test("reports every cross-reference problem together, with paths", () => {
    const issues = boardDocumentIssues({ ...boardDocument(), filters: [{ id: "region", label: "Region", field: "region", control: "segmented", dataset: "nowhere" }] })
    // The schema itself accepts the document; the reference check is what refuses it.
    expect(issues).toEqual([])
    let thrown: BoardInvalid | undefined
    try { parseBoardDocument({ ...boardDocument(), filters: [{ id: "region", label: "Region", field: "region", control: "segmented", dataset: "nowhere" }] }) } catch (error) { thrown = error as BoardInvalid }
    expect(thrown).toBeInstanceOf(BoardInvalid)
    expect(thrown!.issues.map(issue => issue.path)).toContain("/filters/0/dataset")
  })

  test("refuses a panel wider than the board, a duplicate id and an unknown tab", () => {
    let thrown: BoardInvalid | undefined
    try {
      parseBoardDocument(boardDocument({ columns: 6, panels: [{ id: "trend", title: "Trend", dataset: "sales", span: 8, chart: { quick: { type: "bar", x: "region", y: "revenue" } } }, { id: "trend", title: "Again", dataset: "sales", tab: "nope", chart: { quick: { type: "bar", x: "region", y: "revenue" } } }] }))
    } catch (error) { thrown = error as BoardInvalid }
    const paths = thrown!.issues.map(issue => issue.path)
    expect(paths).toContain("/panels/0/span")
    expect(paths).toContain("/panels/1/id")
    expect(paths).toContain("/panels/1/tab")
  })

  test("refuses a version this build does not read, with its own code", () => {
    expect(() => parseBoardDocument({ ...boardDocument(), version: 2 })).toThrow(/DOCUMENT_VERSION_UNSUPPORTED/)
  })

  test("parses a full board into its typed document", () => {
    const document: BoardDocument = parseBoardDocument(boardDocument())
    expect(document.panels).toHaveLength(4)
    expect(document.tabs?.map(tab => tab.id)).toEqual(["overview", "detail"])
    expect(document.filters?.[0]!.defaultValue).toBe("North")
  })
})

// ---------------------------------------------------------------------------------------------------------------
// The cube.

describe("the board cube", () => {
  const rows = boardRows()

  test("computes every aggregate the schema offers", () => {
    const cube = buildBoardCube({ datasets: { sales: rows }, kpis: [] }, LOCALE)
    const values = cube.filtered.sales!
    expect(aggregateRows(values, "sum", "revenue")).toBe(values.reduce((sum, row) => sum + Number(row.revenue), 0))
    expect(aggregateRows(values, "count")).toBe(values.length)
    expect(aggregateRows(values, "min", "revenue")).toBe(Math.min(...values.map(row => Number(row.revenue))))
    expect(aggregateRows(values, "max", "revenue")).toBe(Math.max(...values.map(row => Number(row.revenue))))
    expect(aggregateRows(values, "mean", "revenue")).toBeCloseTo(values.reduce((sum, row) => sum + Number(row.revenue), 0) / values.length, 10)
    expect(aggregateRows(values, "median", "revenue")).toBeGreaterThanOrEqual(aggregateRows(values, "min", "revenue"))
  })

  test("applies the default filters and formats each KPI", () => {
    const cube = buildBoardCube({ datasets: { sales: rows }, filters: [{ id: "region", label: "Region", field: "region", control: "segmented", defaultValue: "North" }], kpis: [
      { id: "revenue", label: "Revenue", dataset: "sales", field: "revenue", aggregate: "sum", format: "currency" },
      { id: "count", label: "Rows", dataset: "sales", aggregate: "count", format: "integer" },
    ] }, LOCALE)
    expect(cube.shown.sales).toBe(rows.filter(row => row.region === "North").length)
    expect(cube.kpis.revenue!.value).toBe(rows.filter(row => row.region === "North").reduce((sum, row) => sum + Number(row.revenue), 0))
    expect(cube.kpis.revenue!.display).toStartWith("$")
    expect(cube.kpis.count!.display).toBe(String(cube.shown.sales))
    expect(cube.filters.region).toBe("North")
  })

  test("offers sorted distinct facets, numbers first", () => {
    const options = facetOptions([{ region: "South" }, { region: "North" }, { region: "South" }, { region: "East" }], "region")
    expect(options.map(option => option.value)).toEqual(["East", "North", "South"])
    expect(facetOptions([{ n: 10 }, { n: 2 }, { n: "3" }], "n").map(option => option.value)).toEqual(["2", "3", "10"])
  })

  test("computes the sparkline the same way with and without the query engine", () => {
    expect(sparkSeries(rows, "month", "revenue")).toEqual(sparkPoints(rows, "month", "revenue"))
    // A mean is summed in a different order by the two, so the last bits of a float may differ; everything a picture
    // draws is the same.
    const engine = sparkSeries(rows, "month", "revenue", "mean")
    const plain = sparkPoints(rows, "month", "revenue", "mean")
    expect(engine.labels).toEqual(plain.labels)
    expect(engine.points).toHaveLength(plain.points.length)
    engine.points.forEach((point, index) => expect(point[1]).toBeCloseTo(plain.points[index]![1], 9))
    const spark = sparkPoints(rows, "month", "revenue")
    expect(spark.points).toHaveLength(MONTHS.length)
    expect(spark.labels[0]).toBe("2026-01-01")
    expect(spark.points[0]![0]).toBe(0)
  })

  test("caps the rows the page carries at 25,000 across datasets", () => {
    const many = Array.from({ length: CLIENT_ROW_LIMIT + 120 }, (_value, i) => ({ revenue: i % 97, region: REGIONS[i % 4] }))
    const cube = buildBoardCube({ datasets: { big: many, small: [{ revenue: 1 }] } }, LOCALE)
    expect(cube.rows.big).toBe(CLIENT_ROW_LIMIT + 120)
    expect(cube.clientRows.big).toBe(CLIENT_ROW_LIMIT)
    expect(cube.clientRows.small).toBe(0)
  })

  test("filters across a dataset's own rows only", () => {
    const filtered = filterRows(rows, [{ filter: { id: "region", field: "region", control: "segmented", dataset: "sales" }, value: "South" }], "sales")
    expect(filtered).toHaveLength(rows.filter(row => row.region === "South").length)
    expect(filterRows(rows, [{ filter: { id: "region", field: "region", control: "segmented", dataset: "other" }, value: "South" }], "sales")).toHaveLength(rows.length)
  })

  test("formats money, percent, compact and integer values", () => {
    expect(formatValue(1234.5, { format: "currency", decimals: 2 }, LOCALE)).toBe("$1,234.50")
    expect(formatValue(0.1234, { format: "percent", decimals: 1 }, LOCALE)).toBe("12.3%")
    expect(formatValue(1234, { format: "integer" }, LOCALE)).toBe("1,234")
    expect(formatValue(1234567, { format: "compact" }, LOCALE)).toBe("$1.2M")
    expect(formatValue(12.345, { format: "number", prefix: "≈ ", suffix: " kg" }, LOCALE)).toBe("≈ 12.3 kg")
  })

  test("gives a range filter a domain whose top is a stop", () => {
    const domain = domainOf(rows, "revenue")
    expect(domain.max).toBeGreaterThanOrEqual(Math.max(...rows.map(row => Number(row.revenue))))
    const stops = (domain.max - domain.min) / domain.step
    expect(Math.round(stops)).toBe(stops)
  })
})

// ---------------------------------------------------------------------------------------------------------------
// The four files.

describe("renderBoard", () => {
  test("publishes the poster, its 2× PNG, the dashboard and the saved document", async () => {
    const { dir, env } = workspaceEnv()
    const result = await renderBoard(boardDocument(), env)
    expect(result.files.svg).toBe("outputs/charts/revenue-overview.svg")
    expect(result.files.png).toBe("outputs/charts/revenue-overview.png")
    expect(result.files.html).toBe("outputs/charts/revenue-overview.board.html")
    expect(result.files.board).toBe("outputs/charts/revenue-overview.board.json")
    for (const file of Object.values(result.files)) expect(existsSync(join(dir, file!))).toBe(true)

    const svg = readFileSync(join(dir, result.files.svg!), "utf8")
    expect(() => checkRenderedSvg(svg)).not.toThrow()
    expect(svg).toStartWith("<svg")
    expect(svg).toContain('role="img"')
    expect(svg).toContain("Revenue overview")
    expect(svg).toContain("Total revenue")
    // The poster is one document: each panel's drawing is a translated group, never a nested <svg>.
    expect(svg).toContain("<g clip-path=")
    expect((svg.match(/<svg/g) ?? []).length).toBe(1)

    const png = readFileSync(join(dir, result.files.png!))
    expect([...png.subarray(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47])
    expect(png.byteLength).toBeGreaterThan(10_000)
  })

  test("writes a dashboard that is offline, hashed and static-first", async () => {
    const { dir, env } = workspaceEnv()
    const result = await renderBoard(boardDocument(), env)
    const html = readFileSync(join(dir, result.files.html!), "utf8")
    const has = (text: string) => expect(html.includes(text)).toBe(true)
    has("default-src 'none'")
    has("script-src 'sha256-")
    has("font-src data:")
    has('data-board-status="initializing"')
    has('id="board-static"')
    has('id="board-live" hidden')
    has("window.ChartsUISdk")
    has('id="board-config"')
    // No inline handler in the markup and no dynamic import anywhere: the policy is the page's only script source.
    const markup = html.replace(/<script[\s\S]*?<\/script>/g, "")
    expect(/\son[a-z]+=/i.test(markup)).toBe(false)
    expect(/import\(\s*["'`]/.test(html)).toBe(false)
    // The fonts are embedded, so the page draws the poster without a network.
    has("@font-face")
    has("data:font/woff2;base64,")
    // Every inline script's hash is in the policy, and the policy lists nothing else.
    const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(match => match[1]!)
    expect(scripts.length).toBeGreaterThanOrEqual(3)
    const policy = /content="([^"]*default-src 'none'[^"]*)"/.exec(html)?.[1] ?? ""
    const hashes = [...policy.matchAll(/'sha256-([A-Za-z0-9+/=]+)'/g)].map(match => match[1]!)
    expect(hashes.length).toBe(scripts.length)
    for (const script of scripts) expect(hashes).toContain(createHash("sha256").update(script, "utf8").digest("base64"))
    // The page names no address of its own. Two kinds of string are not addresses: SVG's own namespace, and the
    // `$schema` identifier a compiled Vega spec carries, which nothing ever loads.
    const urls = [...html.matchAll(/\bhttps?:\/\/[^"\s)]+/g)].map(match => match[0]).filter(url => !url.startsWith("http://www.w3.org/") && !url.startsWith("https://vega.github.io/schema/"))
    expect(urls).toEqual([])
  })

  test("renders both themes and is byte-deterministic", async () => {
    const first = workspaceEnv()
    const second = workspaceEnv()
    const light = await renderBoard(boardDocument(), first.env)
    const lightAgain = await renderBoard(boardDocument(), second.env)
    expect(light.theme).toBe("light")
    for (const kind of ["svg", "png", "html", "board"] as const) {
      const a = readFileSync(join(first.dir, light.files[kind]!))
      const b = readFileSync(join(second.dir, lightAgain.files[kind]!))
      expect(a.equals(b)).toBe(true)
    }

    const darkEnv = workspaceEnv()
    const dark = await renderBoard(boardDocument({ theme: "dark", title: "Revenue overview" }), darkEnv.env)
    expect(dark.theme).toBe("dark")
    const darkSvg = readFileSync(join(darkEnv.dir, dark.files.svg!), "utf8")
    expect(darkSvg).toContain("#16181D")
    const darkHtml = readFileSync(join(darkEnv.dir, dark.files.html!), "utf8")
    expect(darkHtml).toContain('data-board-theme="dark"')
    // The same board in another theme is another picture.
    expect(darkSvg).not.toBe(readFileSync(join(first.dir, light.files.svg!), "utf8"))
  })

  test("saves the parsed document, one level of indent", async () => {
    const { dir, env } = workspaceEnv()
    const result = await renderBoard(boardDocument(), env)
    const saved = JSON.parse(readFileSync(join(dir, result.files.board!), "utf8")) as BoardDocument
    expect(saved.kind).toBe("board")
    expect(saved.panels.map(panel => panel.id)).toEqual(["trend", "share", "channel", "table"])
    expect(saved.width).toBe(1200)
  })

  test("a hostile font family stays inside the stylesheet: no element is created and the poster keeps its escaping", async () => {
    const { dir, env } = workspaceEnv()
    const hostile = 'Evil</style><meta http-equiv="refresh" content="0;url=https://example.com">'
    const theme = { extends: "light", font: { family: hostile, mono: hostile } }
    // A poster of Vega and table panels: the families reach CSS rules and XML attributes only.
    const clean = {
      version: 1,
      title: "Hostile family",
      datasets: { sales: { rows: [{ region: "North", revenue: 120 }, { region: "South", revenue: 80 }] } },
      theme,
      panels: [
        { id: "bar", title: "Revenue", dataset: "sales", chart: { quick: { type: "bar", x: "region", y: "revenue" } } },
        { id: "rows", title: "Rows", dataset: "sales", chart: { kind: "table", columns: [{ field: "region", label: "Region" }, { field: "revenue", label: "Revenue" }] } },
      ],
    }
    const result = await renderBoard(clean, env)
    const html = readFileSync(join(dir, result.files.html!), "utf8")
    // One style element, closed exactly once; the family cannot end it early and open a <meta> refresh.
    expect((html.match(/<style>/g) ?? []).length).toBe(1)
    expect((html.match(/<\/style>/g) ?? []).length).toBe(1)
    // The page's markup — everything the browser parses as elements, the runtimes' own script text aside — carries
    // no refresh and no image the family could have opened.
    const markup = html.replace(/<script[\s\S]*?<\/script>/g, "")
    expect(markup).not.toContain('<meta http-equiv="refresh"')
    expect(markup).not.toContain("<img")
    // Every CSS rule names it as a quoted, escaped string; every XML attribute escapes `<` and `>` instead.
    expect(html).toContain('font-family:"Evil\\3c /style\\3e \\3c meta')
    expect(html).toContain("&lt;/style&gt;&lt;meta http-equiv=")
    expect(() => checkRenderedSvg(result.svg)).not.toThrow()

    // An ECharts panel writes its font into an SVG style attribute, which the renderer's own check refuses rather than
    // emitting markup it could not read: a hostile family can never reach a page that way either.
    await expect(renderBoard(boardDocument({ theme }), env)).rejects.toMatchObject({ code: "SPEC_UNSAFE" })
  })

  test("renders with checks only, writing nothing", async () => {
    const { dir, env } = workspaceEnv()
    const result = await renderBoard(boardDocument(), env, false)
    expect(result.files).toEqual({})
    expect(result.svg).toStartWith("<svg")
    expect(existsSync(join(dir, "outputs"))).toBe(false)
  })
})
