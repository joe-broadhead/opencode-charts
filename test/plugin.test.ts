import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { existsSync } from "node:fs"
import { join } from "node:path"
import { TOOLS } from "../src/tools.ts"
import { ROOT, workspace } from "./helpers.ts"

/**
 * The built bundle, loaded the way OpenCode loads it, with a fake host context: the tools it registers, what they
 * return, and the permissions they ask for. Run `npm run build` first (npm test does).
 */
const ws = workspace()
const asserts: { action: string; resources: string[] }[] = []
const tools = new Map<string, { name: string; description: string; options: { namespace: string; permission: string }; execute: (input: unknown, ctx: unknown) => Promise<{ output: Record<string, unknown>; content: { type: string; text?: string; mime?: string; uri?: string }[] }> }>()
const skills: { id: string; content: string; path: string }[] = []
const commands = new Map<string, { name: string; execute: (input: { sessionID: string; delivery: string; prompt: { text: string } }) => Promise<void> }>()
const posted: { sessionID: string; text: string; description: string }[] = []
// Agents as OpenCode lists them: build with its base allow, and a read-only helper with none.
const agents = [
  { id: "build", permissions: [{ action: "*", resource: "*", effect: "allow" }] as { action: string; resource: string; effect: string }[] },
  { id: "explore", permissions: [{ action: "*", resource: "*", effect: "deny" }, { action: "read", resource: "*", effect: "allow" }] as { action: string; resource: string; effect: string }[] },
]
let cleanup: (() => Promise<void>) | undefined
let deny: string | undefined
const call = (name: string, input: unknown) => tools.get(name)!.execute(input, { sessionID: "ses_1", agent: "build", messageID: "msg_1", id: "call_1" })

beforeAll(async () => {
  expect(existsSync(join(ROOT, "dist/index.js"))).toBe(true)
  const plugin = (await import(join(ROOT, "dist/index.js"))).default
  const ctx = {
    app: { version: "2.2.5" },
    options: { theme: "light" },
    location: { directory: ws.dir, project: { directory: ws.dir } },
    agent: {
      transform: async (fn: (editor: unknown) => void) => fn({ list: () => agents.map(agent => ({ id: agent.id })), update: (id: string, change: (info: unknown) => void) => change(agents.find(agent => agent.id === id)!) }),
      list: async () => ({ data: agents }),
    },
    command: { transform: async (fn: (editor: unknown) => void) => fn({ add: (c: never) => commands.set((c as { name: string }).name, c) }) },
    session: { synthetic: async (input: { sessionID: string; text: string; description: string }) => { posted.push(input) } },
    permission: { assert: async (input: { action: string; resources: string[] }) => { asserts.push({ action: input.action, resources: input.resources }); if (input.action === deny) throw new Error(`${deny} denied`) } },
    tool: {
      transform: async (fn: (editor: unknown) => void) => fn({ namespace: () => undefined, add: (t: never) => tools.set((t as { name: string }).name, t) }),
      list: async () => [...tools.keys()].map(name => ({ id: `charts_${name}` })),
    },
    skill: {
      transform: async (fn: (editor: unknown) => void) => fn({ add: (s: never) => skills.push(s) }),
      list: async () => ({ data: skills.map(skill => ({ id: skill.id, path: skill.path })) }),
    },
  }
  cleanup = await plugin.setup(ctx)
})
afterAll(async () => { await cleanup?.(); ws.cleanup() })

describe("the plugin", () => {
  test("registers exactly its tools, namespaced charts_, each with its own permission", () => {
    expect([...tools.keys()].sort()).toEqual(Object.keys(TOOLS).sort())
    for (const tool of tools.values()) expect(tool.options).toMatchObject({ namespace: "charts", permission: `charts_${tool.name}` })
  })
  test("each tool declares an output schema, since each returns output (OpenCode refuses it otherwise)", () => {
    for (const tool of tools.values()) expect((tool as { output?: unknown }).output).toEqual({})
  })

  test("loads both skills", () => {
    expect(skills.map(s => s.id).sort()).toEqual(["charts", "charts-cookbook"])
  })
  test("render writes files under outputs/charts, asks to edit there, and returns a markdown image line", async () => {
    const result = await call("render", { spec: { mark: "bar", encoding: { x: { field: "k", type: "nominal", sort: "-y" }, y: { field: "v", type: "quantitative", title: "Value (n)" } } }, data: { rows: [{ k: "a", v: 1 }, { k: "b", v: 2 }] }, title: "Plugin test" })
    expect(result.output.files).toEqual({ png: ["outputs/charts/plugin-test.png"], svg: "outputs/charts/plugin-test.svg", spec: "outputs/charts/plugin-test.vl.json" })
    expect(result.output.markdown).toBe("![Plugin test](outputs/charts/plugin-test.png)")
    expect(result.content[0]!.text).toContain("jelly_file_save")
    expect(asserts).toContainEqual({ action: "charts_render", resources: ["*"] })
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
  test("every call asserts the tool's own action first, before any file", async () => {
    asserts.length = 0
    await call("catalogue", {})
    expect(asserts).toEqual([{ action: "charts_catalogue", resources: ["*"] }])
  })
  test("a denied tool action stops the call before anything is written", async () => {
    const before = asserts.length
    deny = "charts_theme_save"
    try {
      await expect(call("theme_save", { name: "denied", theme: { extends: "light" } })).rejects.toThrow("denied")
      expect(asserts.slice(before)).toEqual([{ action: "charts_theme_save", resources: ["*"] }])
      expect(existsSync(join(ws.dir, ".charts/themes/denied.json"))).toBe(false)
    } finally { deny = undefined }
  })
  test("failures are CODE: what happened. Next step: what to do, with the code in metadata", async () => {
    let error: { message: string; metadata?: Record<string, unknown> } | undefined
    try { await call("render", { spec: { data: { url: "https://x" }, mark: "bar" } }) } catch (e) { error = e as never }
    expect(error!.message).toMatch(/^SPEC_UNSAFE: .+ \(at \/data\/url\) Next step: .+\.$/)
    expect(error!.metadata).toMatchObject({ code: "SPEC_UNSAFE", path: "/data/url" })
  })
  test("catalogue and themes answer without files", async () => {
    expect((await call("catalogue", {})).content[0]!.text).toContain("sankey")
    expect((await call("catalogue", { id: "sankey" })).content[0]!.text).toContain('"type":"sankey"')
    expect((await call("themes", {})).content[0]!.text).toContain("toqan-night")
  })
})

describe("the default rules", () => {
  test("go right after an agent's base allow: the writers ask, the reads run, and an agent without one gets none", () => {
    expect(agents[0]!.permissions).toEqual([
      { action: "*", resource: "*", effect: "allow" },
      { action: "charts_*", resource: "*", effect: "ask" },
      { action: "charts_validate", resource: "*", effect: "allow" },
      { action: "charts_catalogue", resource: "*", effect: "allow" },
      { action: "charts_themes", resource: "*", effect: "allow" },
    ])
    expect(agents[1]!.permissions).toHaveLength(2)
  })
})

describe("/charts-status", () => {
  const status = async () => {
    posted.length = 0
    await commands.get("charts-status")!.execute({ sessionID: "ses_1", delivery: "immediate", prompt: { text: "" } })
    expect(posted).toHaveLength(1)
    return posted[0]!
  }
  test("is the one command", () => {
    expect([...commands.keys()]).toEqual(["charts-status"])
  })
  test("posts the renderers, defaults, themes, skills, tools and the next step into the session", async () => {
    const { text, description, sessionID } = await status()
    expect(sessionID).toBe("ses_1")
    expect(description).toBe("Charts status")
    expect(text.split("\n")).toEqual([
      "Charts status",
      "Connection: Ready",
      "Account: none needed; Charts calls no service",
      "Renderers: SVG ready; PNG ready; HTML ready",
      "Defaults: theme light, locale en-US, files under outputs/charts/",
      "Themes: 7 built in, 0 from options, none saved in .charts/themes",
      "Skills: charts, charts-cookbook",
      "Tools: 6 of 6 visible to this agent",
      "Agents without default rules: none",
      "OpenCode: 2.2.5",
      `Version: ${(await Bun.file(join(ROOT, "package.json")).json()).version}`,
      "Next step: Nothing to do.",
    ])
  })
  test("lists an agent that would run the writers without asking, with the rules to paste", async () => {
    agents.push({ id: "reviewer", permissions: [{ action: "*", resource: "*", effect: "allow" }, { action: "charts_*", resource: "*", effect: "allow" }] })
    try {
      const { text } = await status()
      expect(text).toContain("Agents without default rules: reviewer\n  {\"action\":\"charts_*\",\"resource\":\"*\",\"effect\":\"ask\"}")
      expect(text).toEndWith("Next step: Put the default rules shown by /charts-status first in each listed agent's own permissions, in opencode.json or the agent's Markdown file, followed by your top-level rules for Charts tools.")
    } finally { agents.pop() }
  })
})
