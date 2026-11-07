// A small harness for the Charts host tests: an isolated stock `opencode serve`, its own HOME/XDG/TMPDIR, the built
// plugin loaded only in project A, and no model, no credential and no network.
//
// Copied in shape from the family's tools RPC v2 host harness (`~/opencode-release-rpc/shared-v2/test/host/harness.ts`,
// which is not a shared module and is not pinned), so the isolation is the same one every plugin's host suite uses.
import { execFileSync, spawn, type ChildProcess } from "node:child_process"
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { createServer } from "node:net"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { randomBytes, randomUUID } from "node:crypto"

/** The versions the family tests. A missing binary skips that version with a line in the test output. */
export const TESTED_HOSTS = ["2.2.3", "2.2.4", "2.2.5"] as const
const STOCK = "/private/var/folders/yj/xc5d3w1x3nv91lqg4nhs11ww0000gn/T/opencode"
const QA = join(process.env.HOME ?? "", "opencode-release/qa/stock")

export function binary(version: string): string {
  const override = process.env[`OPENCODE_BIN_${version.replaceAll(".", "_")}`]
  if (override) return override
  if (version === "2.2.5") return join(QA, "2.2.5", "node_modules/@opencode/cli-darwin-arm64/bin/opencode")
  return join(STOCK, `stock-opencode-${version}`, "node_modules/@opencode/cli-darwin-arm64/bin/opencode")
}

export const available = (version: string) => existsSync(binary(version))

/** The plugin under test: this repository, built, loaded by path. */
export const PLUGIN_DIR = resolve(import.meta.dir, "..", "..")

function freePort(): Promise<number> {
  return new Promise((resolvePort, reject) => {
    const server = createServer().once("error", reject).listen(0, "127.0.0.1", () => {
      const { port } = server.address() as { port: number }
      server.close(() => resolvePort(port))
    })
  })
}

export interface Host {
  readonly root: string
  readonly a: string
  readonly port: number
  readonly bin: string
  api(method: string, path: string, body?: unknown, location?: string): Promise<{ status: number; data: unknown }>
  close(): Promise<void>
}

/** A project agent's rules: `reader` allows the reads, `writer` also allows the three that write, `locked` denies. */
const AGENTS = {
  reader: {
    description: "charts host test reader",
    mode: "primary",
    permissions: [
      { action: "charts_*", resource: "*", effect: "deny" },
      { action: "charts_capabilities", resource: "*", effect: "allow" },
      { action: "charts_catalogue", resource: "*", effect: "allow" },
      { action: "charts_validate", resource: "*", effect: "allow" },
      { action: "charts_recommend", resource: "*", effect: "allow" },
    ],
  },
  writer: {
    description: "charts host test writer",
    mode: "primary",
    permissions: [{ action: "charts_render", resource: "*", effect: "allow" }, { action: "charts_validate", resource: "*", effect: "allow" }],
  },
  locked: { description: "charts host test locked", mode: "primary", permissions: [{ action: "charts_*", resource: "*", effect: "deny" }] },
  // The plugin's own default block, as an agent's rules: every Charts action asks, which a script cannot answer.
  asking: { description: "charts host test asking", mode: "primary", permissions: [{ action: "charts_*", resource: "*", effect: "ask" }] },
}

export async function startHost(version: string): Promise<Host> {
  const root = mkdtempSync(join(tmpdir(), `charts-rpc-${version}-`))
  const home = join(root, "home")
  const a = join(root, "project")
  for (const dir of [join(home, ".config/opencode"), join(home, ".local/share"), join(home, ".cache"), join(home, ".local/state"), join(root, "tmp"), join(a, ".opencode")]) mkdirSync(dir, { recursive: true })
  execFileSync("/usr/bin/git", ["init", "-q", a])
  writeFileSync(join(a, "README.md"), "# project\n")
  execFileSync("/usr/bin/git", ["-C", a, "-c", "user.email=s@s", "-c", "user.name=s", "add", "."])
  execFileSync("/usr/bin/git", ["-C", a, "-c", "user.email=s@s", "-c", "user.name=s", "commit", "-qm", "init"])

  const bin = binary(version)
  const port = await freePort()
  const password = randomBytes(18).toString("base64url")
  const env: Record<string, string> = {
    HOME: home,
    OPENCODE_TEST_HOME: home,
    TMPDIR: join(root, "tmp"),
    XDG_CONFIG_HOME: join(home, ".config"),
    XDG_DATA_HOME: join(home, ".local/share"),
    XDG_CACHE_HOME: join(home, ".cache"),
    XDG_STATE_HOME: join(home, ".local/state"),
    PATH: "/usr/bin:/bin",
    OPENCODE_PASSWORD: password,
    OPENCODE_DISABLE_AUTOUPDATE: "1",
    OPENCODE_DISABLE_MODELS_FETCH: "1",
    OPENCODE_DISABLE_FREE_MODELS: "1",
    OPENCODE_DISABLE_CLAUDE_CODE: "1",
    OPENCODE_DISABLE_FILEWATCHER: "1",
    HTTP_PROXY: "http://127.0.0.1:9",
    HTTPS_PROXY: "http://127.0.0.1:9",
    http_proxy: "http://127.0.0.1:9",
    https_proxy: "http://127.0.0.1:9",
    NO_PROXY: "127.0.0.1,localhost",
    no_proxy: "127.0.0.1,localhost",
  }

  // Isolation first: every path OpenCode reports is inside the root.
  const paths = execFileSync(bin, ["debug", "paths"], { env, cwd: a, encoding: "utf8" }).trim()
  const listed = paths.split("\n").flatMap(line => {
    const value = line.trim().split(/\s+/).slice(1).join(" ")
    return value ? [value] : []
  })
  const outside = listed.filter(path => !path.startsWith(root) && !path.startsWith(join("/private", root)))
  if (listed.length < 8 || outside.length) throw new Error(`isolation failed: ${paths}`)

  writeFileSync(join(home, ".config/opencode/opencode.json"), JSON.stringify({ agents: AGENTS }, null, 2))
  writeFileSync(join(a, ".opencode/opencode.json"), JSON.stringify({ plugins: [PLUGIN_DIR], agents: AGENTS }, null, 2))

  let server: ChildProcess | undefined
  const authorization = `Basic ${Buffer.from(`opencode:${password}`).toString("base64")}`
  const host: Host = {
    root, a, port, bin,
    async api(method, path, body, location) {
      const url = new URL(path, `http://127.0.0.1:${port}`)
      if (location) url.searchParams.set("location[directory]", location)
      const response = await fetch(url, { method, headers: { authorization, "content-type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
      const text = await response.text()
      let data: unknown = text
      try { data = JSON.parse(text) } catch {}
      return { status: response.status, data }
    },
    async close() {
      if (server && server.exitCode === null && server.signalCode === null) {
        const exited = new Promise(resolveExit => server!.once("exit", resolveExit))
        try { process.kill(-server.pid!, "SIGTERM") } catch {}
        const done = await Promise.race([exited.then(() => true), new Promise(resolveWait => setTimeout(() => resolveWait(false), 10_000))])
        if (!done) {
          try { process.kill(-server.pid!, "SIGKILL") } catch {}
          await exited
        }
      }
      if (!process.env.KEEP) rmSync(root, { recursive: true, force: true })
    },
  }

  server = spawn(bin, ["serve", "--hostname", "127.0.0.1", "--port", String(port), "--print-logs", "--log-level", "info"], { cwd: root, env, detached: true, stdio: ["ignore", "pipe", "pipe"] })
  const log = join(root, "server.log")
  server.stdout!.on("data", chunk => appendFileSync(log, chunk))
  server.stderr!.on("data", chunk => appendFileSync(log, chunk))

  const deadline = Date.now() + 90_000
  for (;;) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/openapi.json`, { headers: { authorization } })
      if (response.ok) break
    } catch {}
    if (Date.now() > deadline) throw new Error(`server did not answer; log: ${log}`)
    await new Promise(resolveWait => setTimeout(resolveWait, 200))
  }
  // Load location A, then wait for the plugin to register its RPC: a 200 from `describe` is the registration.
  for (;;) {
    const described = await host.api("POST", "/api/rpc/charts.tools/describe", { input: {} }, a)
    if (described.status === 200) break
    if (Date.now() > deadline + 60_000) {
      const probe = await host.api("POST", "/api/rpc/charts.tools/describe", { input: {} }, a)
      throw new Error(`the charts plugin did not register its RPC (describe answered ${probe.status}: ${JSON.stringify(probe.data).slice(0, 400)}); log: ${log}`)
    }
    await new Promise(resolveWait => setTimeout(resolveWait, 250))
  }
  return host
}

/** A session in project A, with optional session rules on top of the agent's. */
export async function session(host: Host, agent: string, permissions?: readonly { action: string; resource: string; effect: string }[]): Promise<string> {
  const created = await host.api("POST", "/api/session", { title: `charts-${agent}-${randomUUID().slice(0, 6)}`, agent, ...(permissions ? { permissions } : {}) }, host.a)
  const data = ((created.data as { data?: unknown })?.data ?? created.data) as { id?: string }
  if (!data.id) throw new Error(`no session id: ${JSON.stringify(created.data)}`)
  return data.id
}

/** Calls one method as the host does, in project A. */
export async function rpc(host: Host, method: string, sessionID: string, input: unknown): Promise<{ status: number; data: unknown }> {
  return host.api("POST", `/api/rpc/charts.tools/${method}`, { input: { sessionID, input } }, host.a)
}

/** The RPC's output, or the error body itself. */
export const unwrap = (data: unknown) => ((data as { output?: unknown })?.output ?? data) as Record<string, any>
/** The failure code of an RPC error: the body is the RpcError, with `data: { code, next }`. */
export const refusedCode = (data: unknown) => (data as { data?: { code?: string } })?.data?.code
