/// <reference lib="dom" />
/// <reference lib="dom.iterable" />
/**
 * The bundles a packed install ships, end to end: the four browser runtimes (vega, echarts, plot, ui) and the GUI part
 * built from their entries, their SHA-256 compiled into the plugin, and the two pages that use them — a Plot page whose
 * marks answer the pointer, and a static page whose own script is signed by the policy. The dashboard is checked to
 * mount from the prebuilt `dist/browser/ui.js`, so a packed install needs no bundler at run time.
 *
 * The stage follows `./harness.ts`: playwright-core's pinned build, every request but the file itself refused, one
 * Chromium launch for the whole folder, and a missing browser is an error that says how to install it, never a skip.
 */
import { afterAll, describe, expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { renderBoard } from "../../src/board/render-board.ts"
import { browserRuntime, buildHtml, htmlProblem, type BrowserRuntimeName } from "../../src/html.ts"
import type { Environment } from "../../src/pipeline.ts"
import { BUILTIN_THEMES } from "../../src/themes/tokens.ts"
import { ROOT as PACKAGE } from "../helpers.ts"
import { closeBrowser, open, page, workDir } from "./harness.ts"

const RUNTIMES: readonly BrowserRuntimeName[] = ["vega", "echarts", "plot", "ui"]
const LIGHT = BUILTIN_THEMES.light!

const ROWS = [
  { region: "North", revenue: 120 },
  { region: "South", revenue: 80 },
  { region: "East", revenue: 95 },
  { region: "West", revenue: 40 },
]

/** The static first paint every generated page carries: the live view replaces it only once it is ready. */
const STATIC_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="240" height="120" viewBox="0 0 240 120" role="img" aria-label="Static"><rect x="0" y="0" width="240" height="120" fill="#FFFFFF"/><rect x="20" y="40" width="60" height="60" fill="#4477AA"/></svg>`

afterAll(async () => { await closeBrowser() })

// ---------------------------------------------------------------------------------------------------------------
// The build.

describe("the built bundles", () => {
  test("dist/browser holds exactly the four runtimes and dist/ the GUI part", () => {
    const browser = join(PACKAGE, "dist", "browser")
    expect(existsSync(join(browser, "vega.js"))).toBe(true)
    for (const name of RUNTIMES) {
      const file = join(browser, `${name}.js`)
      expect(existsSync(file)).toBe(true)
      // One read returns the file itself: the runtime the page inlines is the one the build made.
      expect(browserRuntime(PACKAGE, name)).toBe(readFileSync(file, "utf8"))
      expect(readFileSync(file, "utf8").length).toBeGreaterThan(1_000)
    }
    expect(existsSync(join(PACKAGE, "dist", "gui.cjs"))).toBe(true)
    expect(readFileSync(join(PACKAGE, "dist", "gui.cjs"), "utf8")).toContain("charts.codeBlock")
  })

  test("index.js carries all four runtime hashes, so a swapped sibling is refused", () => {
    const index = readFileSync(join(PACKAGE, "dist", "index.js"), "utf8")
    for (const name of RUNTIMES) {
      const digest = createHash("sha256").update(readFileSync(join(PACKAGE, "dist", "browser", `${name}.js`))).digest("hex")
      expect(index).toContain(digest)
    }
  })

  test("htmlProblem is undefined when all four are present and a ChartsError when one is missing", () => {
    expect(htmlProblem(PACKAGE)).toBeUndefined()
    // A package that ships only the Vega runtime: a page cannot be made from it, and the problem names what is missing.
    const broken = workDir()
    const browser = join(broken, "dist", "browser")
    mkdirSync(browser, { recursive: true })
    writeFileSync(join(browser, "vega.js"), "/* a runtime */")
    const problem = htmlProblem(broken)
    expect(problem?.code).toBe("HTML_UNAVAILABLE")
    expect(problem?.detail).toContain("echarts")
  })
})

// ---------------------------------------------------------------------------------------------------------------
// A Plot page: Plot in the runtime slot, the rows in their own block, the marks answering the pointer.

describe("a Plot page", () => {
  test("reaches ready offline, with the live Plot drawing over the static first paint", async () => {
    const html = buildHtml(PACKAGE, {
      engine: "plot",
      spec: { width: 480, height: 280, marks: [{ type: "barY", x: "region", y: "revenue", fill: "#4477AA" }] },
      rows: ROWS,
      svg: STATIC_SVG,
      title: "Revenue by region",
      description: "Revenue by region, drawn with Observable Plot.",
      theme: LIGHT,
      fonts: [],
      compactSpec: "",
      localeId: "en-US",
    })
    // The page signs its runtime and its boot, and carries the rows once.
    expect(html).toContain('<script type="application/json" id="chart-rows">')
    expect(html).toContain('<script type="application/json" id="chart-theme">')
    expect(html).toContain("chartsPlot.render")
    const opened = await open(page("plot", html))
    try {
      expect(await opened.status()).toBe("ready")
      expect(opened.violations).toEqual([])
      expect(opened.errors).toEqual([])
      expect(opened.requests).toEqual([])
      // The live Plot drawing replaced the static SVG, and the off-screen stage is gone.
      const live = await opened.page.evaluate(() => ({
        status: document.documentElement.getAttribute("data-chart-status"),
        staticGone: !document.querySelector("#chart > svg"),
        bars: document.querySelectorAll("#chart > div svg rect").length,
        stage: document.querySelectorAll('body > div[aria-hidden="true"]').length,
        fonts: [...document.fonts].length,
      }))
      expect(live).toMatchObject({ status: "ready", staticGone: true, stage: 0, fonts: 0 })
      expect(live.bars).toBeGreaterThanOrEqual(ROWS.length)

      // `tip: true` on every mark: pointing at a bar shows that bar's values in the drawing.
      const bar = await opened.page.evaluate(() => {
        const rect = [...document.querySelectorAll("#chart > div svg rect")].find(candidate => candidate.getBoundingClientRect().width > 20 && candidate.getBoundingClientRect().height > 20)!
        const box = rect.getBoundingClientRect()
        return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
      })
      await opened.page.mouse.move(bar.x, bar.y, { steps: 4 })
      await opened.page.waitForFunction(() => [...document.querySelectorAll("#chart > div svg g")].some(group => /revenue|region/i.test(group.textContent ?? "")), undefined, { timeout: 5_000 })
      expect(opened.violations).toEqual([])
      expect(opened.requests).toEqual([])
    } finally {
      await opened.close()
    }
  }, 60_000)
})

// ---------------------------------------------------------------------------------------------------------------
// A static page: no chart runtime at all, and the body's own script signed into the policy.

describe("a static page", () => {
  const TABLE_SCRIPT = `(function(){
var table=document.getElementById("bundles-table");
if(!table)return;
var heads=table.tHead?table.tHead.querySelectorAll("th[data-index]"):[];
Array.prototype.forEach.call(heads,function(th){
  th.addEventListener("click",function(){
    var index=Number(th.getAttribute("data-index"));
    var rows=Array.prototype.slice.call(table.tBodies[0].rows);
    rows.sort(function(a,b){return a.cells[index].textContent.localeCompare(b.cells[index].textContent)});
    rows.forEach(function(row){table.tBodies[0].appendChild(row)});
    document.documentElement.setAttribute("data-sorted-by",th.textContent||"");
  });
});
})()`
  const TABLE = `<table id="bundles-table" role="grid" aria-label="Revenue by region"><caption>Revenue by region</caption>
<thead><tr><th scope="col" data-index="0" tabindex="0">Region</th><th scope="col" data-index="1">Revenue</th></tr></thead>
<tbody>${ROWS.map(row => `<tr><td>${row.region}</td><td>${row.revenue}</td></tr>`).join("")}</tbody></table>`

  test("reaches ready with the body's own script signed, and nothing else running", async () => {
    const html = buildHtml(PACKAGE, {
      engine: "static",
      svg: STATIC_SVG,
      htmlBody: `${TABLE}<script>${TABLE_SCRIPT}</script>`,
      title: "Revenue by region",
      description: "A table of revenue by region.",
      theme: LIGHT,
      fonts: [],
      compactSpec: "",
      localeId: "en-US",
    })
    // The body's script is hashed into the policy, so it runs while any other script would not.
    const digest = createHash("sha256").update(TABLE_SCRIPT, "utf8").digest("base64")
    expect(html).toContain(`'sha256-${digest}'`)
    // No chart runtime is inlined into a static page.
    expect(html).not.toContain('id="chart-spec"')
    const opened = await open(page("static-table", html))
    try {
      expect(await opened.status()).toBe("ready")
      expect(opened.violations).toEqual([])
      expect(opened.errors).toEqual([])
      expect(opened.requests).toEqual([])
      const shown = await opened.page.evaluate(() => ({
        grid: document.querySelector("#chart > table[role='grid']")?.getAttribute("aria-label") ?? null,
        imageRole: document.querySelector("#chart")?.getAttribute("role"),
        staticSvg: document.querySelectorAll("#chart > svg").length,
      }))
      expect(shown).toEqual({ grid: "Revenue by region", imageRole: null, staticSvg: 0 })
      // The signed script ran: a click on a header sorts the body.
      await opened.page.click("#bundles-table th[data-index='0']")
      await opened.page.waitForFunction(() => document.documentElement.getAttribute("data-sorted-by") === "Region")
      const order = await opened.page.evaluate(() => [...document.querySelectorAll("#bundles-table tbody tr td:first-child")].map(cell => cell.textContent))
      expect(order).toEqual(["East", "North", "South", "West"])
      expect(opened.violations).toEqual([])
      expect(opened.errors).toEqual([])
    } finally {
      await opened.close()
    }
  }, 60_000)

  test("shows the static drawing on its own when the page carries no body", async () => {
    const html = buildHtml(PACKAGE, {
      engine: "static",
      svg: STATIC_SVG,
      title: "A drawing",
      description: "A drawing, shown as it is.",
      theme: LIGHT,
      fonts: [],
      compactSpec: "",
      localeId: "en-US",
    })
    const opened = await open(page("static-svg", html))
    try {
      expect(await opened.status()).toBe("ready")
      expect(opened.violations).toEqual([])
      expect(opened.errors).toEqual([])
      expect(opened.requests).toEqual([])
      expect(await opened.page.evaluate(() => ({ svg: document.querySelectorAll("#chart > svg").length, role: document.querySelector("#chart")?.getAttribute("role") }))).toEqual({ svg: 1, role: "img" })
    } finally {
      await opened.close()
    }
  }, 60_000)
})

// ---------------------------------------------------------------------------------------------------------------
// The dashboard, from the prebuilt runtime.

describe("the dashboard runtime", () => {
  test("renderBoard inlines dist/browser/ui.js itself, and the page mounts offline", async () => {
    const workspace = workDir()
    const env: Environment = { workspace: { directory: workspace }, packageRoot: PACKAGE, configuredThemes: {}, defaults: { outDir: "outputs/charts" } }
    const boardDocument = {
      version: 1,
      title: "Bundle check",
      datasets: { sales: { rows: ROWS } },
      filters: [{ id: "region", label: "Region", field: "region", control: "segmented" }],
      kpis: [{ id: "revenue", label: "Revenue", dataset: "sales", field: "revenue", aggregate: "sum", format: "number" }],
      panels: [{ id: "rows", title: "Rows", dataset: "sales", span: 6, height: 240, chart: { kind: "table", columns: [{ field: "region" }, { field: "revenue", format: "number", align: "right" }] } }],
    }
    const result = await renderBoard(boardDocument, env)
    const file = join(workspace, result.files.html!)
    const html = readFileSync(file, "utf8")
    // The page's first script is the dashboard runtime: the file the build made, byte for byte (a `</script` is
    // escaped in the element so the document parses, which is what the policy signs).
    const runtime = /<script>([\s\S]*?)<\/script>/.exec(html)
    expect(runtime).not.toBeNull()
    const inline = runtime![1]!.replace(/<\\\/script/gi, "</script")
    expect(inline).toBe(readFileSync(join(PACKAGE, "dist", "browser", "ui.js"), "utf8"))

    const opened = await open(file, { wait: false })
    try {
      await opened.page.waitForFunction(() => document.documentElement.getAttribute("data-board-status") !== "initializing", undefined, { timeout: 30_000 })
      expect(await opened.page.evaluate(() => document.documentElement.getAttribute("data-board-status"))).toBe("ready")
      expect(opened.violations).toEqual([])
      expect(opened.errors).toEqual([])
      expect(opened.requests).toEqual([])
      expect(await opened.page.isVisible("#board-live")).toBe(true)
      expect(await opened.page.evaluate(() => [...document.querySelectorAll("#board-live table.board-table tbody tr")].length)).toBe(ROWS.length)
    } finally {
      await opened.close()
    }
  }, 90_000)
})
