import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { spawnSync } from "node:child_process"
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { INPUTS, inputSchema, type ToolName } from "../src/registry.ts"
import { loadedRenderer, renderer } from "../src/renderer-load.ts"
import { toolTable } from "../src/tool-table-source.ts"
import { ROOT, workspace } from "./helpers.ts"

/**
 * An engine start evaluates the plugin's entry, not its renderer (src/renderer-load.ts): the built dist/index.js is
 * loaded the way OpenCode loads it, with a fake host, in a process of its own whose module loader records every dist/
 * file it evaluates. A start, a status and a script's `describe` load no engine and no zod schema; the first tool call
 * loads dist/renderer.js, once.
 */

const ws = workspace()
const START_BUDGET_BYTES = 400 * 1024

interface Probe {
  atStart: string[]
  beforeCall: string[]
  afterFirst: string[]
  afterAll: string[]
  tools: Record<string, { description: string; output: unknown; input: unknown }>
  rpcInputs: Record<string, unknown>
  first: { ok: boolean; output: unknown }
  second: { ok: boolean }
  invalid: unknown
  valid: unknown
}

// The probe runs in its own process: the unit suites share one module registry, which other files fill with dist/.
const PROBE = `
import { readFileSync } from "node:fs"
const [root, ws] = process.argv.slice(2)
const dist = root + "/dist/"
const loads = []
Bun.plugin({ name: "load-spy", setup(build) {
  build.onLoad({ filter: /\\/dist\\/.*\\.js$/ }, (args) => {
    if (args.path.startsWith(dist)) loads.push(args.path.slice(dist.length))
    return { contents: readFileSync(args.path, "utf8"), loader: "js" }
  })
} })
const plugin = (await import(dist + "index.js")).default
const tools = new Map(), rpcs = new Map(), commands = new Map()
const agents = [{ id: "build", permissions: [{ action: "*", resource: "*", effect: "allow" }] }]
const context = { signal: new AbortController().signal, error: (type, message, data) => ({ type, message, data }) }
const ctx = {
  app: { version: "2.3.0" }, options: {},
  location: { directory: ws, project: { directory: ws } },
  agent: { transform: async (fn) => fn({ list: () => agents, update: () => undefined }), list: async () => ({ data: agents }), get: async () => ({ data: agents[0] }) },
  command: { transform: async (fn) => fn({ add: (c) => commands.set(c.name, c) }) },
  session: { synthetic: async () => undefined, get: async () => ({ id: "ses_1", agent: "build", permissions: [] }) },
  permission: { assert: async () => undefined, hook: async () => ({ dispose: async () => undefined }) },
  tool: { transform: async (fn) => fn({ namespace: () => undefined, add: (t) => tools.set(t.name, t) }), list: async () => [...tools.keys()].map((name) => ({ id: "charts_" + name })) },
  skill: { transform: async (fn) => fn({ add: () => undefined }), list: async () => ({ data: [] }) },
  rpc: { register: async (contract, handlers) => { rpcs.set(contract.id, handlers); return { dispose: async () => undefined, events: { emit: async () => undefined } } } },
}
const cleanup = await plugin.setup(ctx)
const atStart = [...loads]
// What a host does without calling a tool: list the tools, describe the RPC, ask for the status, read the synced theme.
const described = await rpcs.get("charts.tools").describe({ sessionID: "ses_1" }, context)
await rpcs.get("charts").status({}, context)
await commands.get("charts-status").execute({ sessionID: "ses_1", delivery: "immediate", prompt: { text: "" } })
await rpcs.get("charts.theme").get({}, context)
const toolsSeen = Object.fromEntries([...tools].map(([name, tool]) => [name, { description: tool.description, output: tool.output, input: tool.input["~standard"].jsonSchema.input({ target: "draft-2020-12" }) }]))
const rpcInputs = Object.fromEntries((described.output?.methods ?? described.methods ?? []).map((m) => [m.name, m.input]))
const beforeCall = [...loads]
const call = { sessionID: "ses_1", agent: "build", messageID: "msg_1", id: "call_1" }
const run = async (name, input) => { try { return { ok: true, output: (await tools.get(name).execute(input, call)).output } } catch (error) { return { ok: false, output: String(error) } } }
const first = await run("capabilities", {})
const afterFirst = [...loads]
const second = await run("catalogue", { id: "bar" })
// The host validates a call's input before it runs, through the Standard Schema it was given.
const invalid = await tools.get("render").input["~standard"].validate({ banana: 1 })
const valid = await tools.get("catalogue").input["~standard"].validate({ id: "bar" })
const afterAll = [...loads]
await cleanup()
console.log(JSON.stringify({ atStart, beforeCall, afterFirst, afterAll, tools: toolsSeen, rpcInputs, first, second: { ok: second.ok }, invalid, valid }))
`

let probe: Probe
beforeAll(() => {
  expect(existsSync(join(ROOT, "dist/index.js"))).toBe(true)
  const script = join(ws.dir, "probe.mjs")
  writeFileSync(script, PROBE)
  const result = spawnSync(process.execPath, [script, ROOT, ws.dir], { cwd: ws.dir, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, timeout: 240_000 })
  if (result.status !== 0) throw new Error(`the probe failed (${result.status}):\n${result.stdout}\n${result.stderr}`)
  probe = JSON.parse(result.stdout.trim().split("\n").pop()!) as Probe
}, 300_000)
afterAll(() => ws.cleanup())

const bytes = (files: readonly string[]) => files.reduce((sum, file) => sum + statSync(join(ROOT, "dist", file)).size, 0)
const count = (files: readonly string[], file: string) => files.filter(entry => entry === file).length

describe("an engine start", () => {
  test("evaluates the entry and its shared chunks, never the renderer", () => {
    expect(probe.atStart[0]).toBe("index.js")
    expect(probe.atStart).not.toContain("renderer.js")
    expect(probe.atStart.every(file => file === "index.js" || file.startsWith("chunks/"))).toBe(true)
    expect(bytes(probe.atStart)).toBeLessThan(START_BUDGET_BYTES)
  })

  test("builds no zod schema and no engine", () => {
    // A string each library's own code carries: zod's core, Vega's dataflow, ECharts' renderer, the diagram layout.
    const markers = { zod: "$ZodType", vega: "Unrecognized signal", echarts: "zrender", elk: "org.eclipse.elk" }
    for (const file of probe.atStart) {
      const text = readFileSync(join(ROOT, "dist", file), "utf8")
      expect({ file, found: Object.entries(markers).filter(([, marker]) => text.includes(marker)).map(([name]) => name) }).toEqual({ file, found: [] })
    }
    // The markers are real: the renderer's own files carry each of them.
    const all = ["renderer.js", ...probe.afterAll].map(file => readFileSync(join(ROOT, "dist", file), "utf8")).join("\n")
    for (const marker of Object.values(markers)) expect(all.includes(marker)).toBe(true)
  })

  test("lists the tools, answers describe, the status and the theme RPC without loading the renderer", () => {
    expect(probe.beforeCall).not.toContain("renderer.js")
    expect(Object.keys(probe.tools).sort()).toEqual(Object.keys(INPUTS).sort())
  })
})

describe("the first tool call", () => {
  test("loads the renderer, once, and runs", () => {
    expect(probe.first.ok).toBe(true)
    expect(count(probe.afterFirst, "renderer.js")).toBe(1)
    expect(probe.second.ok).toBe(true)
    expect(count(probe.afterAll, "renderer.js")).toBe(1)
  })

  test("validates a call's input with the tool's zod schema, issues and parsed value alike", async () => {
    expect(probe.invalid).toEqual(JSON.parse(JSON.stringify(await INPUTS.render["~standard"].validate({ banana: 1 }))))
    expect(probe.valid).toEqual(JSON.parse(JSON.stringify(await INPUTS.catalogue["~standard"].validate({ id: "bar" }))))
  })
})

describe("the compiled tool table", () => {
  test("is the registry's: descriptions, output schemas, and zod's own input JSON Schema", () => {
    const table = toolTable()
    for (const tool of table.tools) {
      const seen = probe.tools[tool.name]!
      expect(seen.description).toBe(tool.description)
      expect(seen.output).toEqual(tool.output)
      // What OpenCode asked zod for before this table existed: the input side, draft 2020-12.
      expect(seen.input).toEqual(INPUTS[tool.name as ToolName]["~standard"].jsonSchema!.input({ target: "draft-2020-12" }))
      expect(seen.input).toEqual(inputSchema(tool.name as ToolName))
    }
  })

  test("gives the tools RPC the same input schemas", () => {
    for (const name of Object.keys(INPUTS) as ToolName[]) expect(probe.rpcInputs[name]).toEqual(inputSchema(name))
  })
})

describe("the renderer loader", () => {
  test("loads one module and keeps it", async () => {
    const first = await renderer()
    expect(await renderer()).toBe(first)
    expect(loadedRenderer()).toBe(first)
    expect(typeof first.runTool).toBe("function")
  })
})
