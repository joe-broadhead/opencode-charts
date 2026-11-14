// Pack, install and load the published shape. The tarball holds exactly the files the package ships, installs with
// lifecycle scripts disabled next to the one host module it imports (@opencode/plugin, which OpenCode provides), and
// loads and renders a chart, a table, a diagram, a dashboard and a seed theme from there, with the repository's own
// node_modules out of reach. PACK_TARBALL names a tarball that was already packed, such as the one the release
// publishes, to test it instead.
import { afterAll, describe, expect, test } from "bun:test"
import { spawnSync } from "node:child_process"
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs"
import { basename, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const root = fileURLToPath(new URL("../..", import.meta.url))
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as { name: string; version: string; devDependencies: Record<string, string> }
// Outside the repository, so nothing resolves from the repository's own node_modules.
const work = realpathSync(mkdtempSync(join(realpathSync("/tmp"), "charts-pack-")))
afterAll(() => rmSync(work, { recursive: true, force: true }), { timeout: 120_000 })

const MAX_PACKED_BYTES = 12 * 1024 * 1024
// Every path the tarball holds is under one of these, or is one of them.
const SHIPPED = [/^package\.json$/, /^README\.md$/, /^LICENSE$/, /^NOTICE$/, /^THIRD_PARTY_NOTICES\.md$/, /^CHANGELOG\.md$/, /^dist\//, /^assets\//, /^skills\//, /^licenses\//]
const REQUIRED = [
  "package.json", "README.md", "LICENSE", "CHANGELOG.md", "THIRD_PARTY_NOTICES.md",
  "dist/index.js", "dist/tui.js", "dist/gui.cjs", "dist/vega-worker.js", "dist/resvg.wasm",
  "dist/browser/vega.js", "dist/browser/echarts.js", "dist/browser/plot.js", "dist/browser/ui.js",
  "assets/icon.svg", "assets/icon-128.png", "assets/icon-256.png",
  "skills/charts/SKILL.md", "skills/charts-cookbook/SKILL.md",
]

function run(command: string, args: string[], cwd: string): string {
  const result = spawnSync(command, args, { cwd, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 })
  if (result.status !== 0) throw new Error(`${command} ${args.join(" ")} failed (${result.status}):\n${result.stdout}\n${result.stderr}`)
  return result.stdout
}

let packed: { filename: string; size: number; files: string[] } | undefined
function pack() {
  if (packed) return packed
  const given = process.env.PACK_TARBALL
  let tarball: string
  if (given) {
    tarball = join(work, basename(resolve(given)))
    copyFileSync(resolve(given), tarball)
  } else {
    // Build first, explicitly: the package has no prepare or prepack hook, and a stale dist/ must never be packed.
    run("node", [join(root, "scripts", "check.mjs"), "build"], root)
    const result = JSON.parse(run("npm", ["pack", "--json", "--ignore-scripts", "--pack-destination", work], root)) as { filename: string }[]
    tarball = join(work, result[0]!.filename)
  }
  const files = run("tar", ["-tzf", tarball], work).trim().split("\n").filter(path => !path.endsWith("/")).map(path => path.replace(/^package\//, ""))
  packed = { filename: basename(tarball), size: statSync(tarball).size, files }
  return packed
}

describe("the packed tarball", () => {
  test("holds the shipped files and nothing else", () => {
    const { files, size } = pack()
    expect(files.filter(path => !SHIPPED.some(pattern => pattern.test(path)))).toEqual([])
    for (const path of REQUIRED) expect(files).toContain(path)
    expect(files.some(path => path.startsWith("src/") || path.startsWith("test/") || path.endsWith(".map"))).toBe(false)
    expect(size).toBeLessThan(MAX_PACKED_BYTES)
  }, 180_000)

  test("installs with scripts off next to @opencode/plugin alone, then loads, renders every v2 tool and updates a saved one", async () => {
    const dir = join(work, "project")
    mkdirSync(dir)
    writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "charts-pack-project", private: true, type: "module" }))
    run("npm", ["install", join(work, pack().filename), `@opencode/plugin@${pkg.devDependencies["@opencode/plugin"]}`, "--ignore-scripts", "--no-audit", "--no-fund", "--prefer-offline"], dir)
    const installed = join(dir, "node_modules", ...pkg.name.split("/"))
    expect(JSON.parse(readFileSync(join(installed, "package.json"), "utf8")).version).toBe(pkg.version)
    // Nothing but the plugin and the host module it imports was installed: the tarball stands alone.
    expect(existsSync(join(dir, "node_modules", "vega"))).toBe(false)

    const workspace = join(work, "workspace")
    mkdirSync(workspace)
    const script = join(dir, "load.mjs")
    writeFileSync(script, `
      const plugin = (await import(${JSON.stringify(join(installed, "dist", "index.js"))})).default
      const tools = new Map(), commands = new Map(), asserts = []
      const editor = { namespace() {}, add(item) { (item.execute.length === 1 ? commands : tools).set(item.name, item) } }
      const ctx = {
        app: { version: "2.2.5" }, options: {}, location: { directory: ${JSON.stringify(workspace)}, project: { directory: ${JSON.stringify(workspace)} } },
        agent: { transform: async fn => fn({ list: () => [], update() {} }), list: async () => ({ data: [] }), get: async () => ({ data: { id: "build", permissions: [{ action: "*", resource: "*", effect: "allow" }] } }) },
        command: { transform: async fn => fn({ add: item => commands.set(item.name, item) }) },
        session: { synthetic: async input => { console.log(JSON.stringify({ status: input.text })) }, get: async () => ({ id: "s", agent: "build", permissions: [] }) },
        permission: { assert: async input => { asserts.push(input.action) }, hook: async () => ({ dispose: async () => undefined }) },
        rpc: { register: async () => ({ dispose: async () => undefined }) },
        tool: { transform: async fn => fn({ namespace() {}, add: item => tools.set(item.name, item) }), list: async () => [...tools.keys()].map(id => ({ id: "charts_" + id })) },
        skill: { transform: async fn => fn({ add() {} }), list: async () => ({ data: [] }) },
      }
      const stop = await plugin.setup(ctx)
      const result = await tools.get("render").execute({ spec: { mark: "bar", encoding: { x: { field: "k", type: "nominal" }, y: { field: "v", type: "quantitative" } } }, data: { rows: [{ k: "a", v: 1 }, { k: "b", v: 2 }] }, title: "Pack test", formats: ["svg", "png", "html"] }, { sessionID: "s", agent: "build", messageID: "m", id: "c" })
      const call = { sessionID: "s", agent: "build", messageID: "m", id: "c" }
      const made = await tools.get("quick").execute({ document: { version: 1, chart: { kind: "recipe", recipe: "bar", data: { rows: [{ k: "a", v: 1 }, { k: "b", v: 2 }] }, bindings: { category: "k", value: "v" } }, title: "Pack document" }, formats: ["svg", "document"] }, call)
      const updated = await tools.get("update").execute({ documentPath: made.output.files.document, expectedRevision: made.output.revision, patch: { appearance: { theme: "dark" } }, formats: ["svg", "html", "document"] }, call)
      // The v2 tools, from the packed build: a publication table, a diagram and its outline, a dashboard, and a seed.
      const table = await tools.get("table").execute({ data: { rows: [{ region: "North", revenue: 120, status: "Ahead" }] }, columns: [{ field: "region" }, { field: "revenue", cell: "bar" }, { field: "status", cell: "badge" }], formats: ["svg", "png", "html"], name: "pack-table" }, call)
      const diagram = await tools.get("diagram").execute({ dsl: "flowchart LR\\n  a[Start] --> b[Done]", formats: ["svg", "png"], name: "pack-diagram" }, call)
      const board = await tools.get("board").execute({ board: { version: 1, title: "Pack board", datasets: { sales: { rows: [{ region: "North", revenue: 120 }, { region: "South", revenue: 95 }] } }, panels: [{ id: "rev", title: "Revenue", dataset: "sales", chart: { quick: { type: "bar", x: "region", y: "revenue" } } }] }, name: "pack-board", inspect: false }, call)
      const saved = await tools.get("theme_save").execute({ name: "pack-seed", theme: { seed: { background: "#FAF8F5", foreground: "#1A1A18", accent: "#C2410C" } } }, call)
      const seeded = await tools.get("render").execute({ spec: { mark: "bar", encoding: { x: { field: "k", type: "nominal" }, y: { field: "v", type: "quantitative" } } }, data: { rows: [{ k: "a", v: 1 }, { k: "b", v: 2 }] }, theme: { seed: { background: "#FAF8F5", foreground: "#1A1A18", accent: "#C2410C" }, variants: { light: { seed: { background: "#FAF8F5", foreground: "#1A1A18", accent: "#C2410C" } }, dark: { seed: { background: "#141413", foreground: "#F5F3EE", accent: "#FB923C" } } } }, formats: ["svg"], name: "pack-seed-render" }, call)
      await commands.get("charts-status").execute({ sessionID: "s", delivery: "immediate", prompt: { text: "" } })
      console.log(JSON.stringify({ tools: [...tools.keys()].sort(), files: result.output.files, asserts, update: { from: made.output.revision, to: updated.output.revision, files: updated.output.files, generation: updated.output.generation }, v2: { table: table.output.files, diagram: { files: diagram.output.files, ascii: diagram.output.ascii }, board: board.output, seed: saved.output.file, seeded: seeded.output.files } }))
      await stop()
    `)
    const lines = run("bun", [script], dir).trim().split("\n").map(line => JSON.parse(line) as Record<string, unknown>)
    const status = String(lines.find(line => "status" in line)?.status)
    const out = lines.find(line => "tools" in line) as { tools: string[]; files: Record<string, unknown>; asserts: string[]; update: { from: string; to: string; files: Record<string, string>; generation: { directory: string; reused: boolean } }; v2: { table: Record<string, string>; diagram: { files: Record<string, string>; ascii: string }; board: { files: Record<string, string>; panels: number; warnings: unknown[] }; seed: string; seeded: Record<string, string> } }
    expect(out.tools).toEqual(["board", "capabilities", "catalogue", "diagram", "quick", "recommend", "render", "table", "theme_save", "themes", "update", "validate"])
    expect(out.asserts).toEqual(["charts_render", "edit", "charts_quick", "edit", "charts_update", "read", "edit", "charts_table", "edit", "charts_diagram", "edit", "charts_board", "edit", "charts_theme_save", "edit", "charts_render", "edit"])
    // charts_update from the packed build: a new revision in its own generation folder, with the packaged HTML runtime.
    expect(out.update.to).not.toBe(out.update.from)
    expect(out.update.generation).toMatchObject({ directory: expect.stringMatching(/^outputs\/charts\/pack-document-[0-9a-f]{16}$/), reused: false })
    for (const file of [out.update.files.svg!, out.update.files.html!, out.update.files.document!]) expect(statSync(join(workspace, file)).size).toBeGreaterThan(0)
    expect(readFileSync(join(workspace, out.update.files.document!), "utf8")).toContain(out.update.to)
    expect(out.files).toMatchObject({ svg: "outputs/charts/pack-test.svg", html: "outputs/charts/pack-test.html" })
    for (const file of ["pack-test.svg", "pack-test.png", "pack-test.html"]) expect(statSync(join(workspace, "outputs", "charts", file)).size).toBeGreaterThan(0)
    // charts_table: the SVG, the PNG and the sortable page, from the packed tarball.
    expect(out.v2.table).toMatchObject({ svg: "outputs/charts/pack-table.svg", html: "outputs/charts/pack-table.html" })
    for (const file of ["pack-table.svg", "pack-table.png", "pack-table.html"]) expect(statSync(join(workspace, "outputs", "charts", file)).size).toBeGreaterThan(0)
    // charts_diagram: the drawing, its PNG, and the Unicode outline the terminal gets.
    expect(out.v2.diagram.files.svg).toBe("outputs/charts/pack-diagram.svg")
    for (const file of ["pack-diagram.svg", "pack-diagram.png"]) expect(statSync(join(workspace, "outputs", "charts", file)).size).toBeGreaterThan(0)
    expect(out.v2.diagram.ascii).toContain("Start")
    expect(out.v2.diagram.ascii).toContain("Done")
    // charts_board: the offline dashboard, the poster PNG and the document it was built from.
    expect(out.v2.board.files).toMatchObject({ html: "outputs/charts/pack-board.board.html", board: "outputs/charts/pack-board.board.json", png: "outputs/charts/pack-board.png" })
    expect(out.v2.board.panels).toBe(1)
    expect(out.v2.board.warnings).toEqual([])
    for (const file of ["pack-board.svg", "pack-board.png", "pack-board.board.html", "pack-board.board.json"]) expect(statSync(join(workspace, "outputs", "charts", file)).size).toBeGreaterThan(0)
    // charts_theme_save from a host seed, and a render whose written SVG follows the reader's polarity in --cs- variables.
    expect(out.v2.seed).toBe(".charts/themes/pack-seed.json")
    expect(JSON.parse(readFileSync(join(workspace, out.v2.seed), "utf8")).name).toBe("pack-seed")
    const seededSvg = readFileSync(join(workspace, out.v2.seeded.svg!), "utf8")
    expect(seededSvg).toContain("--cs-")
    expect(seededSvg).toContain("@media (prefers-color-scheme: dark)")
    expect(status).toContain("Renderers: SVG ready; PNG ready; HTML ready")
    expect(status).toContain(`Version: ${pkg.version}`)
  }, 180_000)
})
