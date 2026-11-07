import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { existsSync } from "node:fs"
import { join } from "node:path"
import { ROOT, workspace } from "./helpers.js"
import { ChartsError } from "../src/errors.js"
import { pluginError } from "../src/host/tools-rpc.js"

/**
 * The tools RPC: `<plugin id>.tools`, with every tool a method and a class, callable with no model.
 *
 * This is the unit suite — the fake host from `test/plugin.test.ts` registers the contract, and each method is called
 * the way the host calls it. The host suite (`test/host/tools-rpc.host.test.ts`) proves the same on the stock 2.2.3,
 * 2.2.4 and 2.2.5 binaries, where the permission rules are the host's.
 */

interface Registration {
  contract: { id: string; methods: Record<string, { input?: unknown; output?: unknown }> }
  handlers: Record<string, (input: unknown, context: unknown) => Promise<unknown>>
}

const ws = workspace()
const asserts: { action: string; resources: string[] }[] = []
let registration: Registration | undefined
let cleanup: (() => Promise<void>) | undefined

const context = { signal: new AbortController().signal, error: (type: string, message: string, data: unknown) => ({ type, message, data }) }

/** Calls a method as the host does: `{ sessionID, input }`. */
const call = async (method: string, input: unknown, sessionID = "ses_1") => (await registration!.handlers[method]!(method === "describe" ? { sessionID } : { sessionID, input }, context)) as { output?: Record<string, any>; text?: string; data?: { code?: string } }

beforeAll(async () => {
  expect(existsSync(join(ROOT, "dist/index.js"))).toBe(true)
  const plugin = (await import(join(ROOT, "dist/index.js"))).default
  const agents = [{ id: "build", permissions: [{ action: "*", resource: "*", effect: "allow" }] }]
  const ctx = {
    app: { version: "2.2.5" },
    options: {},
    location: { directory: ws.dir, project: { directory: ws.dir } },
    agent: { transform: async (fn: (editor: unknown) => void) => fn({ list: () => agents, update: () => undefined }), list: async () => ({ data: agents }), get: async () => ({ data: agents[0] }) },
    command: { transform: async (fn: (editor: unknown) => void) => fn({ add: () => undefined }) },
    session: { synthetic: async () => undefined, get: async () => ({ id: "ses_1", agent: "build", permissions: [] }) },
    permission: { assert: async (input: { action: string; resources: string[] }) => { asserts.push({ action: input.action, resources: input.resources }) }, hook: async () => ({ dispose: async () => undefined }) },
    tool: { transform: async (fn: (editor: unknown) => void) => fn({ namespace: () => undefined, add: () => undefined }), list: async () => [] },
    skill: { transform: async (fn: (editor: unknown) => void) => fn({ add: () => undefined }), list: async () => ({ data: [] }) },
    rpc: {
      register: async (contract: unknown, handlers: unknown) => {
        registration = { contract: contract as Registration["contract"], handlers: handlers as Registration["handlers"] }
        return { dispose: async () => { registration = undefined } }
      },
    },
  }
  cleanup = await (plugin.setup(ctx) as Promise<() => Promise<void>>)
})
afterAll(async () => { await cleanup?.(); ws.cleanup() })

describe("the tools RPC", () => {
  test("is registered as charts.tools, with one method per tool and no MCP method", () => {
    expect(registration?.contract.id).toBe("charts.tools")
    const methods = Object.keys(registration!.contract.methods).sort()
    expect(methods).toEqual(["capabilities", "catalogue", "describe", "quick", "recommend", "render", "theme_save", "themes", "validate"])
  })

  test("describe reports each method's class, so a script can see what writes", async () => {
    const description = await call("describe", undefined)
    const payload = (description as { data?: unknown }).data ?? description
    const text = JSON.stringify(payload)
    for (const name of ["render", "quick", "theme_save"]) expect(text).toContain(`"${name}"`)
    expect(text).toContain("export")
    expect(text).toContain("read")
  })

  test("a read runs with no prompt beyond its own allow, and answers with output and text", async () => {
    const before = asserts.length
    const result = await call("capabilities", {})
    expect(result.output).toBeDefined()
    expect(typeof result.text).toBe("string")
    expect(result.text).toContain("Charts")
    expect(asserts.slice(before).map(a => a.action)).toEqual(["charts_capabilities"])
  })

  test("catalogue with an id returns the working example", async () => {
    const result = await call("catalogue", { id: "bar" })
    expect(result.output?.id).toBe("bar")
    expect(JSON.stringify(result.output)).toContain("spec")
  })

  test("recommend answers from the data's shape, and is the same call as the model's", async () => {
    const result = await call("recommend", { request: "which region has the most revenue?", data: { rows: [{ region: "North", revenue: 10 }, { region: "South", revenue: 20 }] } })
    expect(result.output?.recommendations?.[0]?.id).toBeDefined()
    expect(result.text).toContain("Which chart for")
  })

  test("validate reports a bad spec as findings, not as a thrown error, as the model path does", async () => {
    const result = await call("validate", { spec: { mark: "banana", encoding: {} } })
    expect(result.output?.valid).toBe(false)
    expect(result.text).toContain("Not valid yet")
    expect(result.text).toContain("banana")
  })

  test("a render failure carries the tool's own code and next step, never a stack trace", async () => {
    const failure = pluginError(new ChartsError("SPEC_INVALID", "The chart spec has 1 problem.", "Fix the listed problems and call the tool again."))
    expect(failure).toEqual({ code: "SPEC_INVALID", what: "The chart spec has 1 problem", next: "Fix the listed problems and call the tool again." })
    expect(pluginError(new Error("boom"))).toBeUndefined()
    expect(pluginError({ code: "not a code" })).toBeUndefined()
  })

  test("render writes its files through the same permission asks as the model path", async () => {
    const before = asserts.length
    const result = await call("render", { spec: { mark: "bar", encoding: { x: { field: "region", type: "nominal" }, y: { field: "revenue", type: "quantitative" } } }, data: { rows: [{ region: "North", revenue: 10 }] }, formats: ["svg"] })
    expect(result.output?.files?.svg).toBeDefined()
    const actions = asserts.slice(before).map(a => a.action)
    // Its own action, then `edit` on the output folder: the same two asks a model's call makes.
    expect(actions).toEqual(["charts_render", "edit"])
  })

  test("an image is never inlined into a script's result: the files are on disk", async () => {
    const result = await call("validate", { spec: { mark: "bar", encoding: { x: { field: "region", type: "nominal" }, y: { field: "revenue", type: "quantitative" } } }, data: { rows: [{ region: "North", revenue: 10 }] } })
    expect(JSON.stringify(result)).not.toContain("data:image/png")
    expect(result.text).toContain("figure ")
  })
})
