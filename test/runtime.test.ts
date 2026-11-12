// The interactive runtime's contract, without a browser: which ECharts modules each runtime registers and what the
// capabilities say about it; ECharts components that are not bundled are refused (A20); the page's shell, CSP and
// encoding; the approved font resources and how custom font files are read; and the rendered-SVG safety check.
import { afterAll, describe, expect, test } from "bun:test"
import { copyFileSync, mkdirSync, readFileSync, truncateSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { capabilities } from "../src/capabilities.ts"
import { echartsModules } from "../src/engines/echarts-install.ts"
import { closeVegaWorker } from "../src/engines/vega-pool.ts"
import { BUNDLED, bundledFonts, customFontResource, MAX_CUSTOM_FONT_BYTES, readCustomFonts, withCustomFonts } from "../src/fonts.ts"
import { contentSecurityPolicy, scriptJson } from "../src/html.ts"
import { ECHARTS_MODULES, ECHARTS_SERIES_TYPES, ECHARTS_UNBUNDLED, HTML_INTERACTIONS, RECIPE_INTERACTIONS } from "../src/runtime-support.ts"
import { checkRenderedSvg, echartsMarkupIssues, tooltipMarkupProblem } from "../src/safety.ts"
import { cssString, fontFaceCss } from "../src/svg.ts"
import { runTool, type ToolEnvironment } from "../src/tools.ts"
import { BAR, ROOT, ROWS, workspace } from "./helpers.ts"

const ws = workspace()
afterAll(async () => { ws.cleanup(); await closeVegaWorker() })
const asked: { action: string; resources: readonly string[] }[] = []
const env: ToolEnvironment = { ...ws.env, assertFiles: async (action, resources) => { asked.push({ action, resources }) } }
const BAR_OPTION = { xAxis: { type: "category", data: ["a", "b"] }, yAxis: { type: "value" }, series: [{ type: "bar", data: [1, 2] }] }

describe("ECharts modules: one table for both runtimes", () => {
  test("the server registers every module but the tooltip; the browser registers all of them", () => {
    expect(echartsModules("browser")).toHaveLength(ECHARTS_MODULES.length)
    expect(echartsModules("server")).toHaveLength(ECHARTS_MODULES.length - 1)
    expect(ECHARTS_MODULES.filter(m => !m.server).map(m => m.name)).toEqual(["TooltipComponent"])
    expect(new Set(echartsModules("browser")).size).toBe(ECHARTS_MODULES.length)
  })
  test("the series types the safety check accepts are the chart modules' series", () => {
    expect([...ECHARTS_SERIES_TYPES].sort()).toEqual(["bar", "boxplot", "candlestick", "chord", "effectScatter", "funnel", "gauge", "graph", "heatmap", "line", "parallel", "pictorialBar", "pie", "radar", "sankey", "scatter", "sunburst", "themeRiver", "tree", "treemap"])
  })
  test("no unbundled component is also a module's option", () => {
    const read = new Set<string>(ECHARTS_MODULES.flatMap(m => ("options" in m ? [...m.options] : [])))
    for (const key of Object.keys(ECHARTS_UNBUNDLED)) expect(read.has(key)).toBe(false)
  })
  test("the browser runtime is built from the table's entry file", () => {
    expect(readFileSync(join(ROOT, "scripts", "build.mjs"), "utf8")).toContain("src/browser/${name}.ts")
    expect(readFileSync(join(ROOT, "src", "browser", "echarts.ts"), "utf8")).toContain('echartsModules("browser")')
  })
})

describe("unsupported ECharts components are refused (A20)", () => {
  for (const key of ["dataZoom", "brush", "toolbox", "timeline"]) test(`${key}: validate says why and what to do; render writes nothing`, async () => {
    const option = { ...BAR_OPTION, [key]: key === "dataZoom" ? [{ type: "inside" }] : {} }
    const checked = await runTool(env, "validate", { spec: option })
    expect(checked.output.valid).toBe(false)
    const issues = checked.output.issues as unknown as Record<string, unknown>[]
    expect(issues).toContainEqual({ level: "error", code: "ECHARTS_COMPONENT_UNSUPPORTED", message: expect.stringContaining(key), path: `/${key}`, fix: ECHARTS_UNBUNDLED[key]! })
    await expect(runTool(env, "render", { spec: option, name: `refused-${key}` })).rejects.toThrow(/SPEC_INVALID[\s\S]*ECHARTS_COMPONENT_UNSUPPORTED at \/[a-zA-Z]+/)
  })
  test("the capabilities report only the tested interactions, and the refused components", () => {
    const view = capabilities(env)
    expect(view.interactions.html).toEqual(HTML_INTERACTIONS)
    // Recipe presets are reported apart, each with a browser test of its id (test/browser/runtime.test.ts holds that).
    expect(view.interactions.presets).toEqual(RECIPE_INTERACTIONS)
    expect(view.interactions.presets.map(i => i.id)).toEqual(["recipe-tooltip", "recipe-legend-highlight", "recipe-x-zoom", "recipe-interval-brush", "recipe-responsive"])
    expect(view.interactions.html.filter(i => i.engine === "echarts").map(i => i.id)).toEqual(["echarts-tooltip", "echarts-legend-toggle"])
    expect(view.interactions.unsupported.map(u => u.option)).toEqual(Object.keys(ECHARTS_UNBUNDLED))
    expect(view.knownLimits.join(" ")).toContain("dataZoom, brush")
  })
})

describe("ECharts tooltip text that would become HTML is refused", () => {
  const PAYLOAD = `<img src=x onerror="window.__pwned=1">{b}`
  const levels: [string, Record<string, unknown>][] = [
    ["/tooltip/formatter", { ...BAR_OPTION, tooltip: { formatter: PAYLOAD } }],
    ["/series/0/tooltip/formatter", { ...BAR_OPTION, series: [{ type: "bar", data: [1, 2], tooltip: { formatter: PAYLOAD } }] }],
    ["/series/0/data/0/tooltip/formatter", { ...BAR_OPTION, series: [{ type: "bar", data: [{ value: 1, tooltip: { formatter: PAYLOAD } }, 2] }] }],
    ["/series/0/markPoint/data/0/tooltip/formatter", { ...BAR_OPTION, series: [{ type: "bar", data: [1, 2], markPoint: { data: [{ type: "max", tooltip: { formatter: PAYLOAD } }] } }] }],
    ["/legend/tooltip/formatter", { ...BAR_OPTION, legend: { tooltip: { show: true, formatter: PAYLOAD } } }],
    ["/legend/data/0/tooltip", { ...BAR_OPTION, legend: { data: [{ name: "a", tooltip: PAYLOAD }] } }],
    ["/xAxis/tooltip/formatter", { ...BAR_OPTION, xAxis: { type: "category", data: ["a", "b"], tooltip: { show: true, formatter: PAYLOAD } } }],
    ["/graphic/0/tooltip/formatter", { ...BAR_OPTION, graphic: [{ type: "text", style: { text: "note" }, tooltip: { formatter: PAYLOAD } }] }],
  ]
  for (const [path, option] of levels) test(`at ${path}: validate refuses it with the path and a next step`, async () => {
    const checked = await runTool(env, "validate", { spec: option })
    expect(checked.output.valid).toBe(false)
    expect(checked.output.issues as unknown as Record<string, unknown>[]).toContainEqual({ level: "error", code: "ECHARTS_MARKUP_REFUSED", message: expect.stringContaining(path), path, fix: expect.stringContaining("{b}<br/>{c}") })
  })
  test("attribute-free formatting tags and placeholders pass", () => {
    for (const ok of ["{b}<br/>{c}", "{b}<br>{c}", "<b>{a}</b>: {c}", "<strong>{b}</strong><br />{c} €", "<table><tr><td>{b}</td><td>{c}</td></tr></table>", "<div><p><span><em>{b}</em></span></p></div>", "<I>{b}</I>", "a & b > c", "&amp;"]) expect(tooltipMarkupProblem(ok)).toBeUndefined()
  })
  test("any attribute, other tag, comment, CDATA or reference to < is refused", () => {
    for (const bad of [`<span style="color:red">{b}</span>`, "<b class=x>{b}</b>", "<script>1</script>", "<svg/onload=x>", "<a>{b}</a>", "<img src=x>", "<!-- {b} -->", "<![CDATA[x]]>", "<br/ onclick=x>", "&lt;img src=x onerror=f()&gt;", "&LT;b", "&lt", "&#60;img", "&#0060;", "&#x3C;img", "&#x003c;", "{b}<"]) expect(tooltipMarkupProblem(bad)).toBeString()
    expect(tooltipMarkupProblem("&#600;")).toBeUndefined()
  })
  test("extraCssText and className are refused when they are not inert", () => {
    const issues = (tooltip: Record<string, unknown>) => echartsMarkupIssues({ tooltip }).map(i => i.path)
    for (const css of ["background:url(x)", "width: expression(alert(1))", "@import 'x'", "content:'\\3c'"]) expect(issues({ extraCssText: css })).toEqual(["/tooltip/extraCssText"])
    expect(issues({ extraCssText: "padding: 8px; box-shadow: none" })).toEqual([])
    expect(issues({ className: "my-tip x_1" })).toEqual([])
    expect(issues({ className: "x\" onmouseover=\"y" })).toEqual(["/tooltip/className"])
  })
  test("the page runs the same check: the ECharts runtime bundles the spec check's module, and the boot calls it", async () => {
    expect(readFileSync(join(ROOT, "src", "browser", "echarts.ts"), "utf8")).toContain('import { findTooltipMarkup } from "../engines/echarts-markup.js"')
    expect(readFileSync(join(ROOT, "src", "safety.ts"), "utf8")).toContain('from "./engines/echarts-markup.js"')
    const r = await runTool(env, "render", { spec: BAR_OPTION, title: "Boot", formats: ["html"], name: "boot-check", inspect: false })
    expect(readFileSync(join(ws.dir, (r.output.files as { html: string }).html), "utf8")).toContain("var refused=chartsTooltipMarkup(option);if(refused.length)throw")
  })
  test("other formatters are drawn as SVG text, and a dataset column called tooltip is data", () => {
    expect(echartsMarkupIssues({ xAxis: { axisLabel: { formatter: "{value} <b>" } }, series: [{ label: { formatter: "<{b}>" } }], dataset: { source: [{ tooltip: "<img>", v: 1 }] } })).toEqual([])
  })
})

describe("the interactive page", () => {
  test("starts initializing, under a CSP without unsafe-eval, with Vega parsed to ASTs and run by the interpreter", async () => {
    const r = await runTool(env, "render", { spec: BAR, data: { rows: ROWS }, title: "Page", formats: ["html"], name: "page", inspect: false })
    const html = readFileSync(join(ws.dir, (r.output.files as { html: string }).html), "utf8")
    expect(html).toContain('<html lang="en" data-chart-status="initializing">')
    expect(html).toMatch(/content="default-src 'none'; script-src 'sha256-[A-Za-z0-9+\/]{43}=' 'sha256-[A-Za-z0-9+\/]{43}='; style-src 'unsafe-inline'; font-src data:; img-src data: blob:; base-uri 'none'; form-action 'none'; object-src 'none'"/)
    expect(html).not.toContain("unsafe-eval")
    // script-src is exactly the hashes of the page's two inline scripts: no inline handler or other script can run.
    const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]!)
    expect(scripts).toHaveLength(2)
    expect(html).toContain(`content="${contentSecurityPolicy(scripts)}"`)
    expect(html).not.toMatch(/\son[a-z]+=/)
    expect(html).toContain("vega.parse(spec,null,{ast:true}),{expr:vegaInterpreter,")
    expect(html).toContain('id="chart-status" class="chart-sr" role="status" aria-live="polite" data-status="initializing"')
    expect(html).toContain('<div id="chart-failure" role="alert" hidden>')
    // The boot carries no function source: the compact format comes from the bundled runtime.
    expect(html).not.toMatch(/function compactFormat|\bl\(function/)
  })
  test("JSON in a script element cannot close it, and a family name cannot close a style rule", () => {
    expect(scriptJson({ t: "</script><!-- & \u2028" })).toBe('{"t":"\\u003c/script\\u003e\\u003c!-- \\u0026 \\u2028"}')
    expect(JSON.parse(scriptJson({ t: "</script>" })).t).toBe("</script>")
    expect(cssString(`A"}</style><script>`)).toBe('"A\\22 }\\3c /style\\3e \\3c script\\3e "')
  })
  test("vega and vega-interpreter are the pair released together", () => {
    const version = (name: string) => JSON.parse(readFileSync(join(ROOT, "node_modules", name, "package.json"), "utf8")).version
    expect([version("vega"), version("vega-interpreter")]).toEqual(["6.4.0", "2.3.2"])
  })
})

describe("approved font resources (F8)", () => {
  test("each bundled face carries its TTF for metrics and PNG, and its pinned WOFF2 for embedding", () => {
    const book = bundledFonts(ROOT)
    expect(book.resources().map(r => [r.family, r.weight, r.mime, r.format, r.web.mime, r.web.format])).toEqual(BUNDLED.map(b => [b.family, b.weight, "font/ttf", "truetype", "font/woff2", "woff2"]))
    for (const [i, r] of book.resources().entries()) {
      expect(r.sha256).toBe(BUNDLED[i]!.sha256)
      expect(r.web.sha256).toBe(BUNDLED[i]!.woff2Sha256)
      expect(book.list()[i]!.bytes).toBe(r.bytes)
    }
  })
  test("a custom TTF and OTF keep their own bytes, MIME type and CSS format", () => {
    const ttf = new Uint8Array(readFileSync(join(ROOT, "assets", "fonts", "Inter-Regular.ttf")))
    const t = customFontResource(ttf, "Brand", 400, "fonts/brand.ttf")
    expect([t.mime, t.format, t.web.mime, t.web.format, t.web.bytes === ttf]).toEqual(["font/ttf", "truetype", "font/ttf", "truetype", true])
    const otf = new Uint8Array(16); otf.set([0x4f, 0x54, 0x54, 0x4f])
    const o = customFontResource(otf, "Brand Display", 700, "fonts/brand.otf")
    expect([o.mime, o.format]).toEqual(["font/otf", "opentype"])
    expect(fontFaceCss([o])).toBe(`@font-face{font-family:"Brand Display";font-weight:700;src:url(data:font/otf;base64,${Buffer.from(otf).toString("base64")}) format("opentype")}`)
    expect(() => customFontResource(new Uint8Array([0x77, 0x4f, 0x46, 0x32, 0, 0, 0, 0, 0, 0, 0, 0]), "Web", 400, "a.woff2")).toThrow(/FONT_INVALID/)
  })
  test("the faces drawn, measured and embedded are one list: a custom face is in it, one per family and weight", () => {
    const ttf = new Uint8Array(readFileSync(join(ROOT, "assets", "fonts", "JetBrainsMono-Regular.ttf")))
    const book = withCustomFonts(bundledFonts(ROOT), [customFontResource(ttf, "Acme", 400, "acme.ttf")])
    const svg = `<svg><text font-family="Acme, sans-serif">x</text><text font-family="Inter">y</text></svg>`
    const used = book.resourcesFor(svg, ["Acme", "JetBrains Mono"])
    expect(used.map(r => `${r.family} ${r.weight} ${r.origin}`)).toEqual(["Inter 400 bundled", "Inter 600 bundled", "JetBrains Mono 400 bundled", "Acme 400 custom"])
    expect(book.buffersFor(svg, "Acme")).toEqual(book.resourcesFor(svg, ["Acme"]).map(r => r.bytes))
    expect(book.face("Acme", 400).resource.source).toBe("acme.ttf")
  })
  test("a custom file is confined, asked for, then size-checked, before a byte is read", async () => {
    mkdirSync(join(ws.dir, "fonts"), { recursive: true })
    copyFileSync(join(ROOT, "assets", "fonts", "Inter-Regular.ttf"), join(ws.dir, "fonts", "brand.ttf"))
    // Every step is recorded: the host's permission check, and each read of a file's bytes (the read seam).
    const order: string[] = []
    const ask = (deny?: boolean) => async (paths: readonly string[]) => { order.push(`ask ${paths.join()}`); if (deny) throw new Error("read denied") }
    const read = (absolute: string) => { order.push(`read ${absolute.split(/[\\/]/).pop()}`); return new Uint8Array(readFileSync(absolute)) }
    // The host refuses: nothing is read.
    await expect(readCustomFonts(ws.env.workspace, [{ family: "L", path: "fonts/brand.ttf" }], ask(true), read)).rejects.toThrow("read denied")
    expect(order).toEqual(["ask fonts/brand.ttf"])
    // Allowed: asked first, then read.
    order.length = 0
    expect((await readCustomFonts(ws.env.workspace, [{ family: "L", path: "fonts/brand.ttf" }], ask(), read)).map(r => r.source)).toEqual(["fonts/brand.ttf"])
    expect(order).toEqual(["ask fonts/brand.ttf", "read brand.ttf"])
    // Outside the workspace: refused before the host is asked.
    order.length = 0
    await expect(readCustomFonts(ws.env.workspace, [{ family: "X", path: "../outside.ttf" }], ask(), read)).rejects.toThrow(/PATH_OUTSIDE_WORKSPACE/)
    expect(order).toEqual([])
    // Too large, judged from the file system after asking: a sparse file is never read.
    const big = join(ws.dir, "fonts", "big.ttf")
    writeFileSync(big, ""); truncateSync(big, MAX_CUSTOM_FONT_BYTES + 1)
    await expect(readCustomFonts(ws.env.workspace, [{ family: "B", path: "fonts/big.ttf" }], ask(), read)).rejects.toThrow(/FONT_TOO_LARGE/)
    expect(order).toEqual(["ask fonts/big.ttf"])
    order.length = 0
    for (const i of [1, 2, 3, 4]) { const f = join(ws.dir, "fonts", `part${i}.ttf`); writeFileSync(f, ""); truncateSync(f, 7 * 1024 * 1024) }
    await expect(readCustomFonts(ws.env.workspace, [1, 2, 3, 4].map(i => ({ family: `P${i}`, path: `fonts/part${i}.ttf` })), ask(), read)).rejects.toThrow(/FONT_TOO_LARGE: The theme's font files are over 24 MB together/)
    expect(order.filter(step => step.startsWith("read"))).toEqual([])
  })
  test("a render asks for read permission on the theme's font files and embeds them in SVG and HTML", async () => {
    mkdirSync(join(ws.dir, "brand"), { recursive: true })
    copyFileSync(join(ROOT, "assets", "fonts", "JetBrainsMono-Regular.ttf"), join(ws.dir, "brand", "acme.ttf"))
    asked.length = 0
    const theme = { extends: "light", font: { family: "Acme", files: [{ family: "Acme", weight: 400, path: "brand/acme.ttf" }] } }
    const r = await runTool(env, "render", { spec: BAR, data: { rows: ROWS }, title: "Brand", theme, formats: ["svg", "html"], svgText: "embed", name: "brand", inspect: false })
    expect(asked).toContainEqual({ action: "read", resources: ["brand/acme.ttf"] })
    const bytes = readFileSync(join(ws.dir, "brand", "acme.ttf")).toString("base64")
    const files = r.output.files as { svg: string; html: string }
    for (const file of [files.svg, files.html]) expect(readFileSync(join(ws.dir, file), "utf8")).toContain(`font-family:"Acme";font-weight:400;`)
    for (const file of [files.svg, files.html]) expect(readFileSync(join(ws.dir, file), "utf8")).toContain(`src:url(data:font/ttf;base64,${bytes}) format("truetype")`)
  })
})

describe("the rendered-SVG check reads attributes from tags", () => {
  test("label text that looks like markup is data", () => {
    expect(() => checkRenderedSvg(`<svg><text x="1">&lt;img src=y onerror=f()&gt; href="https://x"</text><title>&lt;/script&gt;</title></svg>`)).not.toThrow()
    expect(() => checkRenderedSvg(`<svg aria-label="say onload=1"><path d="M0,0"/></svg>`)).not.toThrow()
  })
  test("a real event handler, an external link or unreadable markup is refused", () => {
    expect(() => checkRenderedSvg(`<svg><rect onclick="x()"/></svg>`)).toThrow(/event handler/)
    expect(() => checkRenderedSvg(`<svg><a href="https://x"><text>t</text></a></svg>`)).toThrow(/external resource/)
    expect(() => checkRenderedSvg(`<svg><use xlink:href="#ok"/></svg>`)).not.toThrow()
    expect(() => checkRenderedSvg(`<svg><rect x="1" <g></svg>`)).toThrow(/could not be checked/)
  })
})
