// Host tests for the plugin's one RPC, on the isolated stock OpenCode 2.4.1 binary.
//
// These are the tests the unit suite cannot be: the permission rules are the host's, the session is the host's, and the
// plugin is installed from the built package rather than called through a fake context. The plugin is loaded only in
// project A, so the location case is the real one. Every non-read method over RPC needs a permission ask or a grant
// (contract §8), so the write calls here prove the refusal and the Code Mode suite proves the write.
import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { existsSync } from "node:fs"
import { join } from "node:path"
import { rpc, session, startHost, TESTED_HOST, unwrap, refusedCode, type Host } from "./harness.js"

/** A plan's id, from the read method that previews a write. */
async function planId(host: Host, method: string, sessionID: string, input: unknown): Promise<string> {
  const planned = await rpc(host, `plan_${method}`, sessionID, input)
  const answer = unwrap(planned.data)
  if (planned.status !== 200 || typeof answer.planId !== "string") throw new Error(`plan_${method} answered ${planned.status}: ${JSON.stringify(planned.data).slice(0, 400)}`)
  return answer.planId
}

// The stock binary is required: a tested release that did not run is not evidence, so this suite fails when it is
// missing instead of skipping.
describe(`the Charts RPC on stock ${TESTED_HOST}`, () => {
  let host: Host
  let readonlyHost: Host
  let reader = ""
  let writer = ""
  let locked = ""
  let asking = ""
  let readonly = ""

  beforeAll(async () => {
    host = await startHost(TESTED_HOST)
    readonlyHost = await startHost(TESTED_HOST, { access: "read-only" })
    console.log(`stock OpenCode ${TESTED_HOST}: started`)
    reader = await session(host, "reader")
    writer = await session(host, "writer")
    locked = await session(host, "locked")
    asking = await session(host, "asking")
    readonly = await session(readonlyHost, "writer")
  }, 240_000)

  afterAll(async () => { await host?.close(); await readonlyHost?.close() })

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
    const input = { spec: { mark: "bar", encoding: { x: { field: "k", type: "nominal" }, y: { field: "v", type: "quantitative" } } }, data: { rows: [{ k: "a", v: 1 }] }, formats: ["svg"] }
    const before = existsSync(join(host.a, "outputs"))
    const planned = await planId(host, "render", writer, input)
    const result = await rpc(host, "render", writer, { planId: planned })
    expect(refusedCode(result.data)).toBe("PERMISSION_DENIED")
    expect(JSON.stringify(result.data)).toContain("confirmation")
    expect(existsSync(join(host.a, "outputs"))).toBe(before)
  })

  test("the theme bridge: a read answers not-found, and both writes are non-reads that need a confirmation", async () => {
    expect(unwrap((await rpc(host, "theme_get", reader, {})).data)).toMatchObject({ found: false, revision: null, theme: null, trust: "untrusted" })
    for (const [method, input] of [["theme_sync", { theme: "light" }], ["theme_clear", {}]] as const) {
      const planned = await planId(host, method, writer, input)
      const result = await rpc(host, method, writer, { planId: planned })
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
      ["state", {}],
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

  test("access read-only refuses a file write over RPC, and writes nothing", async () => {
    const input = { spec: { mark: "bar", encoding: { x: { field: "k", type: "nominal" }, y: { field: "v", type: "quantitative" } } }, data: { rows: [{ k: "a", v: 1 }] }, formats: ["svg"] }
    const before = existsSync(join(readonlyHost.a, "outputs"))
    const planned = await planId(readonlyHost, "render", readonly, input)
    const result = await rpc(readonlyHost, "render", readonly, { planId: planned })
    expect(refusedCode(result.data)).toBe("PERMISSION_DENIED")
    expect(JSON.stringify(result.data)).toContain("read-only")
    expect(existsSync(join(readonlyHost.a, "outputs"))).toBe(before)
  })

  test("a method whose session is unknown is refused with a code and a next step", async () => {
    const result = await rpc(host, "capabilities", "ses_doesnotexist", {})
    expect(["UNAVAILABLE", "PERMISSION_DENIED"]).toContain(String(refusedCode(result.data)))
    expect(JSON.stringify(result.data)).toContain("Next step:")
  })
})
