// The Code Mode path on an in-process host from the public @opencode/sdk, in the shape of voice's codemode.test.ts:
// no provider and no server child. A probe plugin registers a loopback OpenAI-compatible model and makes it the
// default, so one turn runs a program through the host's `execute` tool, which is how a model reaches Charts' tools.
// It never leaves 127.0.0.1.
import { afterAll, describe, expect, setDefaultTimeout, test } from "bun:test"
import { existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { Model, Plugin, Provider } from "@opencode/plugin"
import { HOST_SDK_DIR, ROOT as root } from "./isolate.js"

setDefaultTimeout(120_000)

const SDK = HOST_SDK_DIR ? join(HOST_SDK_DIR, "node_modules", "@opencode", "sdk") : fileURLToPath(new URL("../../node_modules/@opencode/sdk", import.meta.url))
const HOST_VERSION = (JSON.parse(readFileSync(join(SDK, "package.json"), "utf8")) as { version: string }).version

// The package the host loads to talk to an OpenAI-compatible endpoint: a value it resolves, not an import.
const OPENAI_COMPATIBLE = ["@opencode", "ai", "providers", "openai-compatible"].join("/")

/** A scriptable model on loopback: `[[mock:tool:execute:<json>]]` runs a program, a tool result gets a short answer. */
function startMockModel() {
  const chunk = (delta: Record<string, unknown>, finish: string | null = null) =>
    `data: ${JSON.stringify({ id: "mock", object: "chat.completion.chunk", created: 0, model: "m1", choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`
  const stream = (write: (send: (line: string) => void) => void) =>
    new Response(new ReadableStream({ start(controller) { const encoder = new TextEncoder(); const send = (line: string) => controller.enqueue(encoder.encode(line)); try { write(send); controller.close() } catch { /* aborted */ } } }), { headers: { "content-type": "text/event-stream", "cache-control": "no-cache" } })
  const answer = (value: string) => stream((send) => { send(chunk({ role: "assistant", content: "" })); send(chunk({ content: value })); send(chunk({}, "stop")); send("data: [DONE]\n\n") })
  const text = (content: unknown): string => (typeof content === "string" ? content : Array.isArray(content) ? content.map((part) => (part as { text?: string }).text ?? "").join("") : "")
  const server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    idleTimeout: 0,
    async fetch(request) {
      const url = new URL(request.url)
      if (url.pathname.endsWith("/models")) return Response.json({ object: "list", data: [{ id: "m1", object: "model", owned_by: "mock" }] })
      if (!url.pathname.endsWith("/chat/completions")) return new Response("not found", { status: 404 })
      const body = (await request.json()) as { messages?: { role: string; content?: unknown }[]; tools?: unknown[] }
      const messages = body.messages ?? []
      const last = messages[messages.length - 1]
      if ((body.tools ?? []).length === 0) return answer("Mock title")
      if (last?.role === "tool") return answer(`after-tool: ${text(last.content).slice(0, 400)}`)
      const prompt = text([...messages].reverse().find((message) => message.role === "user")?.content)
      // Greedy on the arguments: a program may contain `]`, as `formats: ["svg"]` does.
      const directive = /\[\[mock:tool:([^:\]]+):([\s\S]*)\]\]\s*$/.exec(prompt.trim())
      if (directive) {
        const [name, args] = [directive[1]!, directive[2] ?? "{}"]
        return stream((send) => {
          send(chunk({ role: "assistant", content: null, tool_calls: [{ index: 0, id: "call_1", type: "function", function: { name, arguments: "" } }] }))
          send(chunk({ tool_calls: [{ index: 0, function: { arguments: args } }] }))
          send(chunk({}, "tool_calls"))
          send("data: [DONE]\n\n")
        })
      }
      return answer("ok")
    },
  })
  return { baseURL: `http://127.0.0.1:${server.port}/v1`, stop: () => void server.stop(true) }
}

type Access = "all" | "ask-changes" | "read-only"
interface Host {
  readonly client: any
  readonly location: { readonly directory: string }
  readonly work: string
  readonly until: (what: string, check: () => Promise<boolean>, ms?: number) => Promise<void>
}
const hosts: Host[] = []

/** One in-process host with the plugin at one `access` value, and a workspace of its own. */
async function startHost(access: Access): Promise<Host> {
  const mock = startMockModel()
  const pluginPath = fileURLToPath(new URL("../../dist/index.js", import.meta.url))
  const charts = (await import(pathToFileURL(pluginPath).href)).default as Plugin.Plugin
  const withAccess = Plugin.define({ id: charts.id, setup: (ctx) => charts.setup({ ...ctx, options: { ...ctx.options, access } }) })
  const probes: unknown[] = []
  const probe = Plugin.define({
    id: "charts.host-test.probe",
    async setup(ctx) {
      const providerID = Provider.ID.make("mock")
      await ctx.provider.transform((editor) => {
        editor.add({
          info: { ...Provider.Info.empty(providerID), name: "Mock", activation: "enabled", package: OPENAI_COMPATIBLE, settings: { baseURL: mock.baseURL, apiKey: "mock" } } as never,
          models: [{ ...Model.Info.default(providerID, Model.ID.make("m1")), name: "Mock 1" }],
        })
      })
      await ctx.model.transform((editor) => editor.default.set("mock", "m1"))
      probes.push(ctx)
    },
  })
  const work = join(root, `work-${access}`)
  mkdirSync(work, { recursive: true })
  const { OpenCode } = (await import(pathToFileURL(join(SDK, "dist", "index.js")).href)) as typeof import("@opencode/sdk")
  const client: any = await OpenCode.create({
    plugins: [withAccess, probe],
    app: { version: HOST_VERSION },
    config: {
      content: JSON.stringify({ providers: { lmstudio: { settings: { baseURL: "" } }, ollama: { settings: { baseURL: "" } }, vllm: { settings: { baseURL: "" } } } }),
      directory: join(root, `config-${access}`),
      project: false,
      claude: false,
    },
    database: { path: join(root, `opencode-${access}.db`) },
    models: { fetch: false },
    fs: { filewatcher: false },
    log: { level: "error" },
  } as never)
  const location = { directory: work }
  const until = async (what: string, check: () => Promise<boolean>, ms = 60_000) => {
    const deadline = Date.now() + ms
    for (;;) {
      if (await check()) return
      if (Date.now() > deadline) throw new Error(`timed out waiting until ${what}`)
      await Bun.sleep(50)
    }
  }
  await until("the Charts plugin and the probe are active", async () => {
    const { data } = await client.plugin.list({ location })
    const found = data.find((entry: { id: string }) => entry.id === charts.id)
    if (found?.state?.status === "failed") throw new Error(`the Charts plugin failed: ${JSON.stringify(found.state.error)}`)
    return found?.state?.status === "active" && probes.length > 0
  })
  const host: Host = { client, location, work, until }
  hosts.push(host)
  return host
}

afterAll(async () => {
  await Promise.all(hosts.map((host) => host.client.close().catch(() => undefined)))
  hosts.length = 0
})

/**
 * One turn in a fresh session: the program runs inside Code Mode, every permission the turn raises is answered with
 * `decision`, and the model's answer is returned.
 */
async function code(host: Host, program: string, expected: string, options: { permissions?: readonly { action: string; resource: string; effect: string }[]; decision?: "reject" | "once" } = {}) {
  const session = await host.client.session.create({ location: host.location, agent: "build", ...(options.permissions ? { permissions: options.permissions } : {}) })
  const answered: string[] = []
  const turn = host.client.session.prompt({ sessionID: session.id, text: `[[mock:tool:execute:${JSON.stringify({ code: program })}]]` })
  let text = ""
  const deadline = Date.now() + 90_000
  while (Date.now() < deadline) {
    for (const request of await host.client.permission.list({ sessionID: session.id })) {
      answered.push(request.action)
      await host.client.permission.reply({ sessionID: session.id, requestID: request.id, decision: options.decision ?? "reject" })
    }
    const context = (await host.client.session.context({ sessionID: session.id })) as { content?: { type?: string; text?: string }[] }[]
    text = context.flatMap((message) => message.content ?? []).map((part) => part.text ?? "").join("\n")
    if (text.includes("after-tool:") && text.includes(expected)) break
    await Bun.sleep(50)
  }
  await turn.catch(() => undefined)
  return { sessionID: session.id, text, answered }
}

/** The rendered files in a workspace, if any: a refusal means none. */
const outputs = (host: Host) => (existsSync(join(host.work, "outputs", "charts")) ? readdirSync(join(host.work, "outputs", "charts")) : [])
const SPEC = { mark: "bar", encoding: { x: { field: "region", type: "nominal" }, y: { field: "revenue", type: "quantitative", title: "Revenue (k)" } } }
const RENDER = `tools.charts.render({ spec: ${JSON.stringify(SPEC)}, data: { rows: [{ region: "North", revenue: 120 }, { region: "South", revenue: 80 }] }, formats: ["svg"] })`

describe("the Code Mode path", () => {
  test("a read runs inside a program, and a render runs under the default allow", async () => {
    const host = await startHost("all")
    const read = await code(host, "const r = await tools.charts.capabilities({}); return JSON.stringify(r).slice(0, 200)", '"engines"')
    expect(read.text).toContain("after-tool:")
    expect(read.answered).toEqual([])
    const rendered = await code(host, `const r = await ${RENDER}; return JSON.stringify(r).slice(0, 120)`, "svg")
    expect(rendered.text).toContain("after-tool:")
    expect(outputs(host).some((file) => file.endsWith(".svg"))).toBe(true)
  })

  // R2: a rule that asks is refused, and no render runs.
  test("an ask under access ask-changes is refused inside execute, and nothing is written", async () => {
    const host = await startHost("ask-changes")
    const before = outputs(host).length
    const asked = await code(host, `try { await ${RENDER}; return 'ran' } catch (error) { return 'refused' }`, "refused")
    expect(asked.answered).toContain("charts_render")
    expect(asked.text).toContain("after-tool: refused")
    expect(outputs(host)).toHaveLength(before)
  })

  // R2: a deny is refused with no prompt and nothing written.
  test("a deny is refused inside execute, with no prompt and nothing written", async () => {
    const host = await startHost("all")
    const before = outputs(host).length
    const denied = await code(host, `try { await ${RENDER}; return 'ran' } catch (error) { return 'refused' }`, "refused", {
      permissions: [{ action: "charts_render", resource: "*", effect: "deny" }],
    })
    expect(denied.answered).toEqual([])
    expect(denied.text).toContain("after-tool: refused")
    expect(outputs(host)).toHaveLength(before)
  })

  // R2: a name that is not a tool has none to call.
  test("an unknown name is refused inside execute", async () => {
    const host = await startHost("all")
    const unknown = await code(host, "try { await tools.charts.no_such_tool({}); return 'ran' } catch (error) { return 'refused' }", "refused")
    expect(unknown.text).toContain("after-tool: refused")
  })
})
