import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { existsSync } from "node:fs"
import { join } from "node:path"
import { ROOT, workspace } from "./helpers.js"
import { ChartsError } from "../src/errors.js"
import { pluginError, TOOLS_RPC_ID } from "../src/host/tools-rpc.js"

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
const registrations = new Map<string, Registration>()
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
      // Both RPCs are registered: the tools RPC and the status RPC. Keep them by id.
      register: async (contract: unknown, handlers: unknown) => {
        const id = (contract as { id: string }).id
        registrations.set(id, { contract: contract as Registration["contract"], handlers: handlers as Registration["handlers"] })
        if (id === TOOLS_RPC_ID) registration = registrations.get(id)
        return { dispose: async () => { registrations.delete(id) } }
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
    expect(methods).toEqual(["capabilities", "catalogue", "describe", "quick", "recommend", "render", "theme_save", "themes", "update", "validate"])
  })

  test("describe reports each method's class, so a script can see what writes", async () => {
    const description = await call("describe", undefined)
    const payload = (description as { data?: unknown }).data ?? description
    const text = JSON.stringify(payload)
    for (const name of ["render", "quick", "update", "theme_save"]) expect(text).toContain(`"${name}"`)
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

  test("a catalogue example keeps its size through the RPC, and that exact call renders at it", async () => {
    const example = (await call("catalogue", { id: "calendar_heatmap" })).output?.example as Record<string, unknown>
    expect({ width: example.width, height: example.height }).toEqual({ width: 820, height: 220 })
    const rendered = await call("render", { ...example, name: "rpc-calendar", formats: ["svg"] })
    expect({ width: rendered.output?.width, height: rendered.output?.height }).toEqual({ width: 820, height: 220 })
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

  test("a chart document goes through the RPC: quick, validate, then render from the saved artifact, echoing no rows", async () => {
    const rows = [{ region: "North", revenue: 10, note: "rpc-row-marker" }, { region: "South", revenue: 20, note: "rpc-row-marker" }]
    const document = { version: 1, chart: { kind: "recipe", recipe: "bar", data: { rows }, bindings: { category: "region", value: "revenue" } }, title: "RPC document" }
    const made = await call("quick", { document, name: "rpc-doc", formats: ["svg", "document"] })
    expect(made.output?.revision).toMatch(/^sha256:[0-9a-f]{64}$/)
    expect(made.output?.files?.document).toBe(`${made.output?.generation?.directory}/rpc-doc.chart.json`)
    expect(made.output?.generation?.directory).toMatch(/^outputs\/charts\/rpc-doc-[0-9a-f]{16}$/)
    const checked = await call("validate", { document, inspect: false })
    expect(checked.output?.valid).toBe(true)
    expect(checked.output?.revision).toBe(made.output?.revision)
    const before = asserts.length
    const replay = await call("render", { documentPath: made.output?.files?.document, expectedRevision: made.output?.revision, name: "rpc-replay", formats: ["svg"] })
    expect(replay.output?.revision).toBe(made.output?.revision)
    expect(replay.output?.source?.input).toBe("documentPath")
    // Its own action, read on the artifact, then edit on the output folder.
    expect(asserts.slice(before).map(a => a.action)).toEqual(["charts_render", "read", "edit"])
    for (const result of [made, checked, replay]) expect(JSON.stringify(result)).not.toContain("rpc-row-marker")
  })

  test("charts_update goes through the RPC with the model path's asks, its own output schema, and no rows echoed", async () => {
    expect(registration!.contract.methods.update).toBeDefined()
    const rows = [{ region: "North", revenue: 10, note: "rpc-update-marker" }, { region: "South", revenue: 20, note: "rpc-update-marker" }]
    const document = { version: 1, chart: { kind: "recipe", recipe: "bar", data: { rows }, bindings: { category: "region", value: "revenue" } }, title: "RPC update" }
    const made = await call("quick", { document, name: "rpc-update", formats: ["svg", "document"] })
    const before = asserts.length
    const updated = await call("update", { documentPath: made.output?.files?.document, expectedRevision: made.output?.revision, patch: { appearance: { theme: "dark" } }, formats: ["svg", "document"] })
    expect(updated.output?.update?.from).toEqual({ documentPath: made.output?.files?.document, revision: made.output?.revision })
    expect(updated.output?.files?.document).toMatch(/^outputs\/charts\/rpc-update-[0-9a-f]{16}\/rpc-update\.chart\.json$/)
    expect(existsSync(join(ws.dir, updated.output?.files?.document))).toBe(true)
    // Its own action, read on the artifact, then edit on the output folder: as on the model path.
    expect(asserts.slice(before).map(a => a.action)).toEqual(["charts_update", "read", "edit"])
    expect(JSON.stringify(updated)).not.toContain("rpc-update-marker")
    // The method declares the registry's update output inside its envelope.
    const schema = JSON.stringify(registration!.contract.methods.update!.output)
    for (const key of ["\"update\"", "\"generation\"", "\"revision\""]) expect(schema).toContain(key)
    const stale = await call("update", { documentPath: made.output?.files?.document, expectedRevision: `sha256:${"0".repeat(64)}`, patch: {} })
    expect(stale.data?.code).toBe("DOCUMENT_REVISION_MISMATCH")
  })

  test("a call that mixes input arms is refused through the RPC with INPUT_CONFLICT, and writes nothing", async () => {
    const result = await call("render", { document: { version: 1, chart: { kind: "recipe", recipe: "bar", data: { rows: [{ k: "a", v: 1 }] }, bindings: { category: "k", value: "v" } } }, spec: { mark: "bar" }, name: "rpc-mixed" })
    expect(result.data?.code).toBe("INPUT_CONFLICT")
    expect(existsSync(join(ws.dir, "outputs", "charts", "rpc-mixed.svg"))).toBe(false)
  })

  test("an image is never inlined into a script's result: the files are on disk", async () => {
    const result = await call("validate", { spec: { mark: "bar", encoding: { x: { field: "region", type: "nominal" }, y: { field: "revenue", type: "quantitative" } } }, data: { rows: [{ region: "North", revenue: 10 }] } })
    expect(JSON.stringify(result)).not.toContain("data:image/png")
    expect(result.text).toContain("figure ")
  })
})
