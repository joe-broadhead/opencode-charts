import { afterAll, describe, expect, test } from "bun:test"
import { rulesFor } from "@we-the-rebel-alliance/plugin-contract/access"
import { statusAnswer } from "@we-the-rebel-alliance/plugin-contract/accounts"
import { createHandlers, runTool } from "../src/handlers/index.js"
import { manifest, version, packageRoot } from "../src/manifest.js"
import { options } from "../src/options.js"
import type { HandlerCall } from "../src/handlers/types.js"
import { BAR, ROWS, workspace } from "./helpers.js"

/**
 * The handler table and the access rules the register generates: every method declared once, every schema plain JSON,
 * and the status and theme bridge answering from the call with no state kept between setup and a run.
 */

const ws = workspace()
afterAll(async () => {
  const { closeVegaWorker } = await import("../src/engines/vega-pool.ts")
  await closeVegaWorker()
  ws.cleanup()
})

const CALL: HandlerCall = {
  sessionID: "ses_1",
  agent: "build",
  messageID: "msg_1",
  id: "call_1",
  signal: new AbortController().signal,
  account: "default",
  door: "tool",
  bus: { name: "charts", emit: async () => ({ ok: true }) },
  unguardedAgents: async () => ({ ok: true, agents: [] }),
}

function handlers(asserts: { action: string; resources: string[] }[] = []) {
  return createHandlers({
    manifest,
    version,
    hostVersion: "2.4.1",
    packageRoot,
    workspace: { directory: ws.dir, projectDirectory: ws.dir },
    options: options({ theme: "light" }),
    permission: { assert: async (input) => { asserts.push({ action: input.action, resources: [...input.resources] }) } },
  })
}

const env = { ...ws.env, assertFiles: async () => undefined }

describe("the handler table", () => {
  test("is exactly the manifest's methods, one handler each", () => {
    expect(Object.keys(handlers()).sort()).toEqual(Object.keys(manifest.methods).sort())
  })

  test("declares a JSON Schema object for every input and answer", () => {
    for (const [name, handler] of Object.entries(handlers())) {
      expect({ name, input: handler.input.type }).toEqual({ name, input: "object" })
      expect({ name, output: handler.output.type }).toEqual({ name, output: "object" })
    }
  })

  test("classifies all 26 methods: 17 reads (eight reads and nine plans) and 9 writes, none pinned, none an account method", () => {
    const methods = Object.entries(manifest.methods)
    expect(methods).toHaveLength(26)
    const reads = ["capabilities", "catalogue", "recommend", "state", "status", "theme_get", "themes", "validate"]
    for (const write of ["render", "quick", "update", "board", "table", "diagram", "theme_save", "theme_sync", "theme_clear"]) reads.push(`plan_${write}`)
    expect(methods.filter(([, item]) => item.class === "read").map(([name]) => name).sort()).toEqual(reads.sort())
    expect(methods.filter(([, item]) => item.class === "write")).toHaveLength(9)
    for (const write of ["render", "quick", "update", "board", "table", "diagram", "theme_save", "theme_sync", "theme_clear"]) expect(manifest.methods[write]!.commits).toBe(`plan_${write}`)
    for (const [, item] of methods) {
      expect(item.accounts).toBe("none")
      expect((item as { pinned?: boolean }).pinned).toBeUndefined()
    }
  })
})

describe("the access rules", () => {
  const rule = (level: "all" | "ask-changes" | "read-only", action: string) => rulesFor(manifest, level).find((entry) => entry.action === action)!

  test("every method runs under all except the three that ask, and a read always runs", () => {
    const asking = new Set(["theme_save", "theme_sync", "theme_clear"])
    for (const name of Object.keys(manifest.methods)) {
      const effect = asking.has(name) ? "ask" : "allow"
      expect({ name, rule: rule("all", `charts.${name}`) }).toEqual({ name, rule: { action: `charts.${name}`, resource: "*", effect } })
    }
    expect(rule("read-only", "charts.validate")?.effect).toBe("allow")
  })

  test("ask-changes asks for the writers, and read-only denies them", () => {
    expect(rule("ask-changes", "charts.render")?.effect).toBe("ask")
    expect(rule("read-only", "charts.render")?.effect).toBe("deny")
  })

  test("theme_save, theme_sync and theme_clear ask even under all: each overwrites what a later render uses", () => {
    for (const name of ["charts.theme_save", "charts.theme_sync", "charts.theme_clear"]) expect({ name, effect: rule("all", name)?.effect }).toEqual({ name, effect: "ask" })
    expect(rule("read-only", "charts.theme_save")?.effect).toBe("deny")
  })
})

describe("the status answer", () => {
  test("is the contract's shape, with no account and the agents the rules miss", async () => {
    const status = (await handlers().status!.run({}, { ...CALL, unguardedAgents: async () => ({ ok: true, agents: ["reviewer"] }) })) as Record<string, any>
    expect(status).toEqual({
      name: "charts",
      version,
      host: { version: "2.4.1", range: ">=2.4.1 <2.5.0", tested: ["2.4.1"] },
      state: "ready",
      accounts: [],
      unguardedAgents: ["reviewer"],
      nextStep: null,
    })
    expect(status).toEqual(statusAnswer({ manifest, version, hostVersion: "2.4.1", accounts: [], unguardedAgents: { ok: true, agents: ["reviewer"] } }) as unknown as Record<string, unknown>)
  })

  test("an unreadable agent list is unknown, never zero: error, with one redacted next step", async () => {
    const status = (await handlers().status!.run({}, { ...CALL, unguardedAgents: async () => ({ ok: false, error: "the agent list failed at https://example.test/hook?token=secret" }) })) as Record<string, any>
    expect(status.state).toBe("error")
    expect(status.unguardedAgents).toEqual([])
    expect(String(status.nextStep)).not.toContain("secret")
  })
})

describe("the theme bridge", () => {
  test("syncs, reads and clears a theme for the call's session", async () => {
    const table = handlers()
    const syncPlan = (await table.plan_theme_sync!.run({ theme: "dark" }, CALL)) as Record<string, any>
    const synced = (await table.theme_sync!.run({ planId: "plan" }, { ...CALL, plan: syncPlan })) as Record<string, any>
    expect(synced).toMatchObject({ ok: true, applied: true, mode: "dark", themeName: "dark" })
    const found = (await table.theme_get!.run({}, CALL)) as Record<string, any>
    expect(found).toMatchObject({ found: true, mode: "dark", themeName: "dark", theme: { theme: "dark", mode: "dark" } })
    const clearPlan = (await table.plan_theme_clear!.run({}, CALL)) as Record<string, any>
    expect(await table.theme_clear!.run({ planId: "plan" }, { ...CALL, plan: clearPlan })).toEqual({ cleared: true, trust: "untrusted" })
    expect(await table.theme_get!.run({}, CALL)).toEqual({ found: false, revision: null, theme: null, trust: "untrusted" })
  })
})

describe("a tool through the handler", () => {
  test("render writes files under outputs/charts and answers the files and markdown line", async () => {
    const { output } = await runTool(env as never, "render", { spec: BAR, data: { rows: ROWS }, title: "Handler test" })
    const answer = output as Record<string, any>
    expect(answer.files).toEqual({ png: ["outputs/charts/handler-test.png"], svg: "outputs/charts/handler-test.svg", spec: "outputs/charts/handler-test.vl.json" })
    expect(answer.markdown).toBe("![Handler test](outputs/charts/handler-test.png)")
    expect(answer.figure).toBeDefined()
    expect(answer).not.toHaveProperty("content")
  })

  test("a bad spec is the plugin's own code with its path and next step, for the unit seam", async () => {
    const error = (await runTool(env as never, "render", { spec: { data: { url: "https://x" }, mark: "bar" } }).catch((caught: unknown) => caught)) as Error & { code?: string; path?: string }
    expect(error.message).toMatch(/^SPEC_UNSAFE: .+ \(at \/data\/url\) Next step: .+\.$/)
    expect({ code: error.code, path: error.path }).toEqual({ code: "SPEC_UNSAFE", path: "/data/url" })
  })

  test("every call asserts the tool's own file rules through the environment it is given", async () => {
    const asserts: { action: string; resources: string[] }[] = []
    const table = handlers(asserts)
    await table.catalogue!.run({}, CALL)
    expect(asserts).toEqual([])
    const plan = (await table.plan_theme_save!.run({ name: "asked", theme: { extends: "light" } }, CALL)) as Record<string, any>
    expect(asserts).toEqual([])
    await table.theme_save!.run({ planId: "plan" }, { ...CALL, plan })
    expect(asserts).toEqual([{ action: "edit", resources: [".charts/themes/asked.json"] }])
  })
})

