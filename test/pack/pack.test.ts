// Pack, install and load the published shape. The tarball holds exactly the files the package ships, installs with
// lifecycle scripts disabled next to the one host module it imports (@opencode/plugin, which OpenCode provides), and
// loads and renders a chart from there, with the repository's own node_modules out of reach.
// PACK_TARBALL names a tarball that was already packed, such as the one the release publishes, to test it instead.
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
  "dist/index.js", "dist/vega-worker.js", "dist/resvg.wasm", "dist/browser/vega.js", "dist/browser/echarts.js",
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

  test("installs with scripts off next to @opencode/plugin alone, then loads and renders a chart", async () => {
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
        agent: { transform: async fn => fn({ list: () => [], update() {} }), list: async () => ({ data: [] }) },
        command: { transform: async fn => fn({ add: item => commands.set(item.name, item) }) },
        session: { synthetic: async input => { console.log(JSON.stringify({ status: input.text })) } },
        permission: { assert: async input => { asserts.push(input.action) } },
        tool: { transform: async fn => fn({ namespace() {}, add: item => tools.set(item.name, item) }), list: async () => [...tools.keys()].map(id => ({ id: "charts_" + id })) },
        skill: { transform: async fn => fn({ add() {} }), list: async () => ({ data: [] }) },
      }
      const stop = await plugin.setup(ctx)
      const result = await tools.get("render").execute({ spec: { mark: "bar", encoding: { x: { field: "k", type: "nominal" }, y: { field: "v", type: "quantitative" } } }, data: { rows: [{ k: "a", v: 1 }, { k: "b", v: 2 }] }, title: "Pack test", formats: ["svg", "png", "html"] }, { sessionID: "s", agent: "build", messageID: "m", id: "c" })
      await commands.get("charts-status").execute({ sessionID: "s", delivery: "immediate", prompt: { text: "" } })
      console.log(JSON.stringify({ tools: [...tools.keys()].sort(), files: result.output.files, asserts }))
      await stop()
    `)
    const lines = run("bun", [script], dir).trim().split("\n").map(line => JSON.parse(line) as Record<string, unknown>)
    const status = String(lines.find(line => "status" in line)?.status)
    const out = lines.find(line => "tools" in line) as { tools: string[]; files: Record<string, unknown>; asserts: string[] }
    expect(out.tools).toEqual(["catalogue", "quick", "render", "theme_save", "themes", "validate"])
    expect(out.asserts).toEqual(["charts_render", "edit"])
    expect(out.files).toMatchObject({ svg: "outputs/charts/pack-test.svg", html: "outputs/charts/pack-test.html" })
    for (const file of ["pack-test.svg", "pack-test.png", "pack-test.html"]) expect(statSync(join(workspace, "outputs", "charts", file)).size).toBeGreaterThan(0)
    expect(status).toContain("Renderers: SVG ready; PNG ready; HTML ready")
    expect(status).toContain(`Version: ${pkg.version}`)
  }, 180_000)
})
