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
  "package.json", "README.md", "LICENSE", "NOTICE", "CHANGELOG.md", "THIRD_PARTY_NOTICES.md",
  "dist/index.js", "dist/renderer.js", "dist/tui.js", "dist/vega-worker.js", "dist/resvg.wasm",
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
    run("node", [join(root, "scripts", "check.mjs"), "bundle"], root)
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

  test("installs with scripts off next to @opencode/plugin alone, then loads, renders every tool and updates a saved one", async () => {
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
      const tools = new Map(), asserts = []
      const agents = []
      const ctx = {
        app: { version: "2.4.1" }, options: {}, location: { directory: ${JSON.stringify(workspace)}, project: { directory: ${JSON.stringify(workspace)} } },
        agent: { transform: async fn => { fn({ list: () => agents, update() {} }); return { dispose: async () => undefined } }, list: async () => ({ data: agents }), get: async () => ({ data: { id: "build", permissions: [{ action: "*", resource: "*", effect: "allow" }] } }) },
        session: { synthetic: async () => undefined, get: async () => ({ id: "s", agent: "build", permissions: [] }) },
        permission: { assert: async input => { asserts.push(input.action) }, hook: async () => ({ dispose: async () => undefined }) },
        rpc: { register: async () => ({ dispose: async () => undefined, events: { emit: async () => undefined } }) },
        tool: { transform: async fn => { fn({ namespace() {}, add: item => tools.set(item.name, item) }); return { dispose: async () => undefined } }, list: async () => [...tools.keys()].map(id => ({ id: "charts_" + id })) },
        skill: { transform: async fn => { fn({ add() {} }); return { dispose: async () => undefined } }, list: async () => ({ data: [] }) },
      }
      const stop = await plugin.setup(ctx)
      const call = { sessionID: "s", agent: "build", messageID: "m", id: "c", signal: new AbortController().signal, progress: async () => undefined, codemode: false }
      const planThen = async (name, input) => {
        const plan = await tools.get("plan_" + name).execute(input, call)
        return tools.get(name).execute({ planId: plan.output.planId }, call)
      }
      const result = await planThen("render", { spec: { mark: "bar", encoding: { x: { field: "k", type: "nominal" }, y: { field: "v", type: "quantitative" } } }, data: { rows: [{ k: "a", v: 1 }, { k: "b", v: 2 }] }, title: "Pack test", formats: ["svg", "png", "html"] })
      const made = await planThen("quick", { document: { version: 1, chart: { kind: "recipe", recipe: "bar", data: { rows: [{ k: "a", v: 1 }, { k: "b", v: 2 }] }, bindings: { category: "k", value: "v" } }, title: "Pack document" }, formats: ["svg", "document"] })
      const updated = await planThen("update", { documentPath: made.output.files.document, expectedRevision: made.output.revision, patch: { appearance: { theme: "dark" } }, formats: ["svg", "html", "document"] })
      // The v2 tools, from the packed build: a publication table, a diagram and its outline, a dashboard, and a seed.
      const table = await planThen("table", { data: { rows: [{ region: "North", revenue: 120, status: "Ahead" }] }, columns: [{ field: "region" }, { field: "revenue", cell: "bar" }, { field: "status", cell: "badge" }], formats: ["svg", "png", "html"], name: "pack-table" })
      const diagram = await planThen("diagram", { dsl: "flowchart LR\\n  a[Start] --> b[Done]", formats: ["svg", "png"], name: "pack-diagram" })
      const board = await planThen("board", { board: { version: 1, title: "Pack board", datasets: { sales: { rows: [{ region: "North", revenue: 120 }, { region: "South", revenue: 95 }] } }, panels: [{ id: "rev", title: "Revenue", dataset: "sales", chart: { quick: { type: "bar", x: "region", y: "revenue" } } }] }, name: "pack-board", inspect: false })
      const saved = await planThen("theme_save", { name: "pack-seed", theme: { seed: { background: "#FAF8F5", foreground: "#1A1A18", accent: "#C2410C" } } })
      const seeded = await planThen("render", { spec: { mark: "bar", encoding: { x: { field: "k", type: "nominal" }, y: { field: "v", type: "quantitative" } } }, data: { rows: [{ k: "a", v: 1 }, { k: "b", v: 2 }] }, theme: { seed: { background: "#FAF8F5", foreground: "#1A1A18", accent: "#C2410C" }, variants: { light: { seed: { background: "#FAF8F5", foreground: "#1A1A18", accent: "#C2410C" } }, dark: { seed: { background: "#141413", foreground: "#F5F3EE", accent: "#FB923C" } } } }, formats: ["svg"], name: "pack-seed-render" })
      const status = await tools.get("status").execute({}, call)
      console.log(JSON.stringify({ tools: [...tools.keys()].sort(), files: result.output.files, asserts, status: status.output, update: { from: made.output.revision, to: updated.output.revision, files: updated.output.files, generation: updated.output.generation }, v2: { table: table.output.files, diagram: { files: diagram.output.files, ascii: diagram.output.ascii }, board: board.output, seed: saved.output.file, seeded: seeded.output.files } }))
      await stop()
    `)
    const out = JSON.parse(run("bun", [script], dir).trim().split("\n").pop()!) as {
      tools: string[]
      files: Record<string, unknown>
      asserts: string[]
      status: { name: string; version: string; state: string; accounts: unknown[]; unguardedAgents: unknown[] }
      update: { from: string; to: string; files: Record<string, string>; generation: { directory: string; reused: boolean } }
      v2: { table: Record<string, string>; diagram: { files: Record<string, string>; ascii: string }; board: { files: Record<string, string>; panels: number; warnings: unknown[] }; seed: string; seeded: Record<string, string> }
    }
    // Every declared method is a tool, including status and the three theme methods.
    expect(out.tools).toEqual(["board", "capabilities", "catalogue", "diagram", "plan_board", "plan_diagram", "plan_quick", "plan_render", "plan_table", "plan_theme_clear", "plan_theme_save", "plan_theme_sync", "plan_update", "quick", "recommend", "render", "state", "status", "table", "theme_clear", "theme_get", "theme_save", "theme_sync", "themes", "update", "validate"])
    // The contract gate asserts each method's own action, then the handler asserts the host's file rules.
    for (const action of ["charts.render", "charts.quick", "charts.update", "charts.table", "charts.diagram", "charts.board", "charts.theme_save", "read", "edit"]) expect(out.asserts).toContain(action)
    // The status answer is the contract's shape, with no account.
    expect(out.status).toMatchObject({ name: "charts", version: pkg.version, state: "ready", accounts: [], unguardedAgents: [] })
    // charts_update from the packed build: a new revision in its own generation folder, with the packaged HTML runtime.
    expect(out.update.to).not.toBe(out.update.from)
    expect(out.update.generation).toMatchObject({ directory: expect.stringMatching(/^outputs\/charts\/pack-document-[0-9a-f]{16}$/), reused: false })
    for (const file of [out.update.files.svg!, out.update.files.html!, out.update.files.document!]) expect(statSync(join(workspace, file)).size).toBeGreaterThan(0)
    expect(readFileSync(join(workspace, out.update.files.document!), "utf8")).toContain(out.update.to)
    expect(out.files).toMatchObject({ svg: "outputs/charts/pack-test.svg", html: "outputs/charts/pack-test.html" })
    for (const file of ["pack-test.svg", "pack-test.png", "pack-test.html"]) expect(statSync(join(workspace, "outputs", "charts", file)).size).toBeGreaterThan(0)
    // charts.table: the SVG, the PNG and the sortable page, from the packed tarball.
    expect(out.v2.table).toMatchObject({ svg: "outputs/charts/pack-table.svg", html: "outputs/charts/pack-table.html" })
    for (const file of ["pack-table.svg", "pack-table.png", "pack-table.html"]) expect(statSync(join(workspace, "outputs", "charts", file)).size).toBeGreaterThan(0)
    // charts.diagram: the drawing, its PNG, and the Unicode outline the terminal gets.
    expect(out.v2.diagram.files.svg).toBe("outputs/charts/pack-diagram.svg")
    for (const file of ["pack-diagram.svg", "pack-diagram.png"]) expect(statSync(join(workspace, "outputs", "charts", file)).size).toBeGreaterThan(0)
    expect(out.v2.diagram.ascii).toContain("Start")
    expect(out.v2.diagram.ascii).toContain("Done")
    // charts.board: the offline dashboard, the poster PNG and the document it was built from.
    expect(out.v2.board.files).toMatchObject({ html: "outputs/charts/pack-board.board.html", board: "outputs/charts/pack-board.board.json", png: "outputs/charts/pack-board.png" })
    expect(out.v2.board.panels).toBe(1)
    expect(out.v2.board.warnings).toEqual([])
    for (const file of ["pack-board.svg", "pack-board.png", "pack-board.board.html", "pack-board.board.json"]) expect(statSync(join(workspace, "outputs", "charts", file)).size).toBeGreaterThan(0)
    // charts.theme_save from a host seed, and a render whose written SVG follows the reader's polarity in --cs- variables.
    expect(out.v2.seed).toBe(".charts/themes/pack-seed.json")
    expect(JSON.parse(readFileSync(join(workspace, out.v2.seed), "utf8")).name).toBe("pack-seed")
    const seededSvg = readFileSync(join(workspace, out.v2.seeded.svg!), "utf8")
    expect(seededSvg).toContain("--cs-")
    expect(seededSvg).toContain("@media (prefers-color-scheme: dark)")
  }, 180_000)
})
