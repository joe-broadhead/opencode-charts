// Host tests for the plugin's one RPC, on the isolated stock OpenCode 2.4.1 binary.
//
// These are the tests the unit suite cannot be: the permission rules are the host's, the session is the host's, and the
// plugin is installed from the built package rather than called through a fake context. The plugin is loaded only in
// project A, so the location case is the real one. Every non-read method over RPC needs a permission ask or a grant
// (contract §8), so the write calls here prove the refusal and the Code Mode suite proves the write.
import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { existsSync } from "node:fs"
import { join } from "node:path"
import { available, binary, rpc, session, startHost, TESTED_HOST, unwrap, refusedCode, type Host } from "./harness.js"
import { stockGate } from "../support/stock-gate.js"

// A missing stock binary skips with a line on a laptop and fails in CI: a release that did not run is not evidence.
const gate = stockGate(TESTED_HOST, binary(TESTED_HOST), available(TESTED_HOST))
describe.skipIf(gate === "skip")(`the Charts RPC on stock ${TESTED_HOST}`, () => {
  let host: Host
  let reader = ""
  let writer = ""
  let locked = ""
  let asking = ""

  beforeAll(async () => {
    host = await startHost(TESTED_HOST)
    console.log(`stock OpenCode ${TESTED_HOST}: started`)
    reader = await session(host, "reader")
    writer = await session(host, "writer")
    locked = await session(host, "locked")
    asking = await session(host, "asking")
  }, 240_000)

  afterAll(async () => { await host?.close() })

  test("the one RPC answers status with the contract's shape, and capabilities lists the build", async () => {
    const status = await rpc(host, "status", reader, {})
    expect(status.status).toBe(200)
    expect(unwrap(status.data)).toMatchObject({
      name: "charts",
      host: { version: "2.4.1", range: ">=2.4.1 <2.5.0", tested: ["2.4.1"] },
      state: "ready",
      accounts: [],
      nextStep: null,
    })
    const capabilities = await rpc(host, "capabilities", reader, {})
    expect(capabilities.status).toBe(200)
    expect(unwrap(capabilities.data).catalogue.count).toBeGreaterThan(50)
  })

  test("a read the agent denies is refused before dispatch, with no prompt", async () => {
    const result = await rpc(host, "catalogue", locked, { id: "bar" })
    expect(refusedCode(result.data)).toBe("PERMISSION_DENIED")
    expect(JSON.stringify(result.data)).toContain("Permission denied")
  })

  test("a write with only an allow rule is refused (LD-5), and nothing is written", async () => {
    const before = existsSync(join(host.a, "outputs"))
    const result = await rpc(host, "render", writer, { spec: { mark: "bar", encoding: { x: { field: "k", type: "nominal" }, y: { field: "v", type: "quantitative" } } }, data: { rows: [{ k: "a", v: 1 }] }, formats: ["svg"] })
    expect(refusedCode(result.data)).toBe("PERMISSION_DENIED")
    expect(JSON.stringify(result.data)).toContain("confirmation")
    expect(existsSync(join(host.a, "outputs"))).toBe(before)
  })

  test("the theme bridge: a read answers not-found, and both writes are non-reads that need a confirmation", async () => {
    expect(unwrap((await rpc(host, "theme_get", reader, {})).data)).toMatchObject({ found: false, revision: null, theme: null, trust: "untrusted" })
    for (const [method, input] of [["theme_sync", { theme: "light" }], ["theme_clear", {}]] as const) {
      const result = await rpc(host, method, writer, input)
      expect({ method, code: refusedCode(result.data) }).toEqual({ method, code: "PERMISSION_DENIED" })
    }
  })

  test("validate answers valid: false with the issues that name the problem", async () => {
    const result = await rpc(host, "validate", reader, { spec: { mark: "banana", encoding: {} } })
    expect(result.status).toBe(200)
    const output = unwrap(result.data)
    expect(output.valid).toBe(false)
    expect(JSON.stringify(output.issues)).toContain("banana")
  })

  test("every read's answer is accepted against the output schema it declares", async () => {
    // The RPC validates each result against the handler's own output schema on the way out, so a 200 is a result the
    // real host accepts and a schema the host's validator accepts.
    const calls: [string, unknown][] = [
      ["status", {}],
      ["capabilities", {}],
      ["catalogue", {}],
      ["catalogue", { id: "bar" }],
      ["themes", {}],
      ["themes", { name: "light" }],
      ["theme_get", {}],
      ["recommend", { request: "which region has the most revenue?", data: { rows: [{ region: "North", revenue: 10 }, { region: "South", revenue: 20 }] } }],
      ["validate", { spec: { mark: "bar", encoding: { x: { field: "region", type: "nominal" }, y: { field: "revenue", type: "quantitative" } } }, data: { rows: [{ region: "North", revenue: 10 }] }, inspect: false }],
      ["validate", { spec: { mark: "banana", encoding: {} }, inspect: false }],
    ]
    for (const [method, input] of calls) {
      const result = await rpc(host, method, reader, input)
      expect(result.status, `${method} was refused: ${JSON.stringify(result.data).slice(0, 300)}`).toBe(200)
      expect(unwrap(result.data), `${method} returned no answer`).toBeDefined()
    }
  })

  test("a method whose session is unknown is refused with a code and a next step", async () => {
    const result = await rpc(host, "capabilities", "ses_doesnotexist", {})
    expect(["UNAVAILABLE", "PERMISSION_DENIED"]).toContain(String(refusedCode(result.data)))
    expect(JSON.stringify(result.data)).toContain("Next step:")
  })
})
