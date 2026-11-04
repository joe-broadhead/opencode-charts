import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { existsSync, readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { TOOLS } from "../src/tools.ts"
import { ROOT, workspace } from "./helpers.ts"

/**
 * The built bundle, loaded the way OpenCode loads it, with a fake host context: the tools it registers, what they
 * return, and the permissions they ask for. Run `npm run build` first (npm test does).
 */
const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"))
const ws = workspace()
const asserts: { action: string; resources: string[] }[] = []
const tools = new Map<string, { name: string; description: string; options: { namespace: string; permission: string }; execute: (input: unknown, ctx: unknown) => Promise<{ output: Record<string, unknown>; content: { type: string; text?: string; mime?: string; uri?: string }[] }> }>()
const skills: { id: string; content: string }[] = []
let cleanup: (() => Promise<void>) | undefined
const call = (name: string, input: unknown) => tools.get(name)!.execute(input, { sessionID: "ses_1", agent: "build", messageID: "msg_1", id: "call_1" })

beforeAll(async () => {
  expect(existsSync(join(ROOT, "dist/index.js"))).toBe(true)
  const plugin = (await import(join(ROOT, "dist/index.js"))).default
  const ctx = {
    options: { theme: "light" },
    location: { directory: ws.dir, project: { directory: ws.dir } },
    permission: { assert: async (input: { action: string; resources: string[] }) => { asserts.push({ action: input.action, resources: input.resources }) } },
    tool: { transform: async (fn: (editor: unknown) => void) => fn({ namespace: () => undefined, add: (t: never) => tools.set((t as { name: string }).name, t) }) },
    skill: { transform: async (fn: (editor: unknown) => void) => fn({ add: (s: never) => skills.push(s) }) },
  }
  cleanup = await plugin.setup(ctx)
})
afterAll(async () => { await cleanup?.(); ws.cleanup() })

describe("the plugin", () => {
  test("registers exactly its tools, namespaced charts_, each with its own permission", () => {
    expect([...tools.keys()].sort()).toEqual(Object.keys(TOOLS).sort())
    for (const tool of tools.values()) expect(tool.options).toMatchObject({ namespace: "charts", permission: `charts_${tool.name}` })
  })
  test("loads both skills", () => {
    expect(skills.map(s => s.id).sort()).toEqual(["charts", "charts-cookbook"])
  })
  test("render writes files under outputs/charts, asks to edit there, and returns a markdown image line", async () => {
    const result = await call("render", { spec: { mark: "bar", encoding: { x: { field: "k", type: "nominal", sort: "-y" }, y: { field: "v", type: "quantitative", title: "Value (n)" } } }, data: { rows: [{ k: "a", v: 1 }, { k: "b", v: 2 }] }, title: "Plugin test" })
    expect(result.output.files).toEqual({ png: ["outputs/charts/plugin-test.png"], svg: "outputs/charts/plugin-test.svg", spec: "outputs/charts/plugin-test.vl.json" })
    expect(result.output.markdown).toBe("![Plugin test](outputs/charts/plugin-test.png)")
    expect(result.content[0]!.text).toContain("jelly_artifact_save")
    expect(asserts).toContainEqual({ action: "edit", resources: ["outputs/charts/*"] })
    expect(existsSync(join(ws.dir, "outputs/charts/plugin-test.png"))).toBe(true)
  })
  test("validate returns the picture to the model as an image, and writes nothing", async () => {
    const result = await call("validate", { spec: { mark: "point", encoding: { x: { field: "k", type: "nominal" } } }, data: { rows: [{ k: "a" }] } })
    const image = result.content.find(c => c.type === "file")!
    expect(image.mime).toBe("image/png")
    expect(image.uri).toStartWith("data:image/png;base64,iVBORw0KGgo")
    expect(result.output.files).toEqual({ png: [] })
  })
  test("reading a workspace file asks to read it", async () => {
    await Bun.write(join(ws.dir, "d.csv"), "k,v\na,1\n")
    await call("quick", { type: "bar", data: { path: "d.csv" }, x: "k", y: "v", formats: ["svg"] })
    expect(asserts).toContainEqual({ action: "read", resources: ["d.csv"] })
  })
  test("failures are CODE: what happened. Next step, with the code in metadata", async () => {
    let error: { message: string; metadata?: Record<string, unknown> } | undefined
    try { await call("render", { spec: { data: { url: "https://x" }, mark: "bar" } }) } catch (e) { error = e as never }
    expect(error!.message).toMatch(/^SPEC_UNSAFE: .+ \(at \/data\/url\) .+\.$/)
    expect(error!.metadata).toMatchObject({ code: "SPEC_UNSAFE", path: "/data/url" })
  })
  test("catalogue and themes answer without files", async () => {
    expect((await call("catalogue", {})).content[0]!.text).toContain("sankey")
    expect((await call("catalogue", { id: "sankey" })).content[0]!.text).toContain('"type":"sankey"')
    expect((await call("themes", {})).content[0]!.text).toContain("toqan-night")
  })
})

describe("the jelly declaration", () => {
  const jelly = pkg.jelly as { title: string; summary?: string; icon?: string; tools: { name: string; permission: string; effect: string; readOnly: boolean }[]; skills: string[]; signIns: unknown[] }
  test("names itself, and declares every tool with its read-only flag", () => {
    expect(jelly.title).toBe("Charts")
    expect(jelly.tools.map(t => t.permission).sort()).toEqual(Object.keys(TOOLS).map(t => `charts_${t}`).sort())
    for (const tool of jelly.tools) {
      expect(tool.name.replaceAll(".", "_")).toBe(tool.permission)
      expect(tool.readOnly).toBe(TOOLS[tool.permission.slice(7) as keyof typeof TOOLS].readOnly)
    }
  })
  test("declares the skills it ships, and no sign-ins", () => {
    expect([...jelly.skills].sort()).toEqual(readdirSync(join(ROOT, "skills")).sort())
    expect(jelly.signIns).toEqual([])
  })
  test("an icon, when declared, is a shipped, clean SVG of drawing elements", () => {
    if (!jelly.icon) return
    expect(pkg.files as string[]).toContain(jelly.icon.split("/")[0]!)
    const svg = readFileSync(join(ROOT, jelly.icon), "utf8")
    expect(svg).toStartWith("<svg")
    expect(svg).not.toMatch(/<(script|style|image|foreignObject|use|a)\b|href|url\(|on\w+=/i)
    const tags = [...svg.matchAll(/<([a-zA-Z]+)/g)].map(m => m[1])
    for (const tag of tags) expect(["svg", "rect", "path", "circle", "g", "line"]).toContain(tag!)
  })
})
