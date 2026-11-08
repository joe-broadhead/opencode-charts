// Host tests for the tools RPC, on the isolated stock binaries in TESTED_HOSTS: 2.2.3 to 2.2.6.
//
// These are the tests the unit suite cannot be: the permission rules are the host's, the session is the host's, and the
// plugin is installed from the built package rather than called through a fake context. The plugin is loaded only in
// project A, so the location case is the real one.
import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { existsSync } from "node:fs"
import { join } from "node:path"
import { available, binary, rpc, session, startHost, TESTED_HOSTS, unwrap, refusedCode, type Host } from "./harness.js"

for (const version of TESTED_HOSTS) {
  if (!available(version)) {
    test(`${version}: the stock binary is missing, so this version is skipped`, () => {
      // R11: a skip is loud, and in CI it is a failure: a release that did not run is not evidence.
      if (process.env.CI === "true" || process.env.CI === "1") throw new Error(`no stock binary for ${version} at ${binary(version)}`)
      console.log(`skip: no stock binary for ${version} at ${binary(version)}; set OPENCODE_BIN_${version.replaceAll(".", "_")}`)
    })
    continue
  }

  describe(`the Charts tools RPC on stock ${version}`, () => {
    let host: Host
    let reader = ""
    let writer = ""
    let locked = ""
    let asking = ""

    beforeAll(async () => {
      host = await startHost(version)
      reader = await session(host, "reader")
      writer = await session(host, "writer")
      locked = await session(host, "locked")
      asking = await session(host, "asking")
    }, 240_000)

    afterAll(async () => { await host?.close() })

    test("describe lists every tool with its class, and no method is unclassified", async () => {
      const described = (await rpc(host, "describe", reader, undefined)).data as { output?: { methods?: { name: string; class: string; kind: string }[]; unclassified?: unknown[] } }
      const methods = described.output?.methods ?? []
      expect(methods.map(method => method.name).sort()).toEqual(["capabilities", "catalogue", "quick", "recommend", "render", "theme_save", "themes", "validate"])
      expect(methods.map(method => method.class).sort()).toEqual(["export", "export", "export", "read", "read", "read", "read", "read"])
      expect(described.output?.unclassified ?? []).toEqual([])
    })

    test("a read the agent allows runs, and answers with the tool's output and text", async () => {
      const result = await rpc(host, "capabilities", reader, {})
      expect(result.status).toBe(200)
      const output = unwrap(result.data)
      expect(output.output.catalogue.count).toBeGreaterThan(50)
      expect(String(output.text)).toContain("Charts")
    })

    test("a tool the agent denies is refused before dispatch, with no call and no prompt", async () => {
      const result = await rpc(host, "catalogue", locked, { id: "bar" })
      expect(refusedCode(result.data)).toBe("PERMISSION_DENIED")
      expect(JSON.stringify(result.data)).toContain("deny rule")
    })

    test("a write that would ask is refused before dispatch, and writes nothing", async () => {
      const before = existsSync(join(host.a, "outputs"))
      // `asking` carries the plugin's own default rule, so the action resolves to ask.
      const result = await rpc(host, "render", asking, { spec: { mark: "bar", encoding: { x: { field: "k", type: "nominal" }, y: { field: "v", type: "quantitative" } } }, data: { rows: [{ k: "a", v: 1 }] }, formats: ["svg"] })
      expect(refusedCode(result.data)).toBe("PERMISSION_DENIED")
      expect(JSON.stringify(result.data)).toContain("would ask")
      expect(existsSync(join(host.a, "outputs"))).toBe(before)
    })

    test("a write the run session allows runs, and the file lands in the project", async () => {
      const result = await rpc(host, "render", writer, { spec: { mark: "bar", encoding: { x: { field: "k", type: "nominal" }, y: { field: "v", type: "quantitative" } } }, data: { rows: [{ k: "a", v: 1 }, { k: "b", v: 2 }] }, formats: ["svg"], name: `host-${version.replaceAll(".", "-")}` })
      expect(result.status).toBe(200)
      const output = unwrap(result.data)
      expect(output.output.files.svg).toContain("outputs/charts/")
      expect(existsSync(join(host.a, output.output.files.svg))).toBe(true)
      // The picture is not inlined into a script's result; the figure tree is.
      expect(JSON.stringify(result.data)).not.toContain("data:image/png")
      expect(String(output.text)).toContain("figure ")
    })

    test("a bad spec comes back as the tool's own code and next step", async () => {
      const result = await rpc(host, "validate", reader, { spec: { mark: "banana", encoding: {} } })
      const output = unwrap(result.data)
      expect(output.output.valid).toBe(false)
      expect(String(output.text)).toContain("banana")
    })

    test("every tool's result is accepted against the output schema it declares", async () => {
      // Each RPC method's output nests the tool's own schema, so the host validates the real result against exactly
      // the schema OpenCode applies on the model path. A call that comes back 200 is a result OpenCode accepts, and a
      // schema the host's own validator accepts too (an owned schema may carry no `pattern`).
      const calls: [string, unknown][] = [
        ["capabilities", {}],
        ["catalogue", {}],
        ["catalogue", { id: "bar" }],
        ["themes", {}],
        ["themes", { name: "light" }],
        ["recommend", { request: "which region has the most revenue?", data: { rows: [{ region: "North", revenue: 10 }, { region: "South", revenue: 20 }] } }],
        ["validate", { spec: { mark: "bar", encoding: { x: { field: "region", type: "nominal" }, y: { field: "revenue", type: "quantitative" } } }, data: { rows: [{ region: "North", revenue: 10 }] }, inspect: false }],
        ["validate", { spec: { mark: "banana", encoding: {} }, inspect: false }],
        ["render", { spec: { mark: "bar", encoding: { x: { field: "k", type: "nominal" }, y: { field: "v", type: "quantitative" } } }, data: { rows: [{ k: "a", v: 1 }] }, formats: ["svg"], name: `accept-${version.replaceAll(".", "-")}` }],
        ["quick", { type: "bar", data: { rows: [{ k: "a", v: 1 }] }, x: "k", y: "v", formats: ["svg"], name: `accept-quick-${version.replaceAll(".", "-")}` }],
        ["theme_save", { name: "host-accept", theme: { extends: "light", colors: { text: "#111111" } } }],
      ]
      for (const [method, input] of calls) {
        const result = await rpc(host, method, writer, input)
        expect(result.status, `${method} was refused: ${JSON.stringify(result.data).slice(0, 300)}`).toBe(200)
        expect(unwrap(result.data).output, `${method} returned no output`).toBeDefined()
      }
    })

    test("a method whose session has no agent is refused with the code that names it", async () => {
      // The RPC reads the session's agent; an unknown session id is the location case, and the next step names the
      // header. This asserts the code rather than the whole message, which the shared module owns.
      const result = await rpc(host, "capabilities", "ses_doesnotexist", {})
      expect(["SESSION_UNKNOWN", "SESSION_AGENT_REQUIRED"]).toContain(String(refusedCode(result.data)))
    })
  })
}
