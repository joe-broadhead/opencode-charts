/// <reference lib="dom" />
/// <reference lib="dom.iterable" />
/**
 * The browser stage's harness: the built plugin (dist/index.js) loaded the way OpenCode loads it, with a fake host,
 * so every page under test is generated through the public tools; and a pinned headless Chromium (playwright-core's
 * own build, exact version in package-lock.json) that opens each page from disk with listeners for CSP violations,
 * console errors, page errors and every request.
 *
 * A missing browser fails the stage: it is never skipped. Install it once with
 *   npx playwright-core install --only-shell chromium
 * (on Linux, add --with-deps to install the system libraries it needs).
 */
import { existsSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { pathToFileURL } from "node:url"
import { chromium, type Browser, type Page } from "playwright-core"

export const ROOT = resolve(import.meta.dir, "..", "..")
export const INSTALL = "npx playwright-core install --only-shell chromium (on Linux add --with-deps)"

export interface ToolResult { output: Record<string, unknown>; content: { type: string; text?: string }[] }
export interface Plugin { dir: string; call: (name: string, input: unknown) => Promise<ToolResult>; close: () => Promise<void> }

/** The built plugin with a fake host whose workspace is a fresh temp folder; every permission is granted and recorded. */
export async function startPlugin(): Promise<Plugin & { asserts: { action: string; resources: string[] }[] }> {
  if (!existsSync(join(ROOT, "dist", "index.js"))) throw new Error("dist/index.js is missing. Run npm run build first (npm run check builds before this stage).")
  const dir = mkdtempSync(join(tmpdir(), "charts-browser-"))
  const plugin = (await import(join(ROOT, "dist", "index.js"))).default
  const tools = new Map<string, { execute: (input: unknown, ctx: unknown) => Promise<ToolResult> }>()
  const asserts: { action: string; resources: string[] }[] = []
  const agents = [{ id: "build", permissions: [{ action: "*", resource: "*", effect: "allow" }] }]
  const cleanup = await plugin.setup({
    app: { version: "2.2.5" },
    options: { theme: "light" },
    location: { directory: dir, project: { directory: dir } },
    agent: {
      transform: async (fn: (editor: unknown) => void) => fn({ list: () => agents.map(agent => ({ id: agent.id })), update: (id: string, change: (info: unknown) => void) => change(agents.find(agent => agent.id === id)!) }),
      list: async () => ({ data: agents }),
    },
    command: { transform: async (fn: (editor: unknown) => void) => fn({ add: () => undefined }) },
    rpc: { register: async () => ({ dispose: async () => undefined }) },
    session: { synthetic: async () => undefined },
    permission: {
      assert: async (input: { action: string; resources: string[] }) => { asserts.push({ action: input.action, resources: input.resources }) },
      hook: async () => ({ dispose: async () => undefined }),
    },
    tool: {
      transform: async (fn: (editor: unknown) => void) => fn({ namespace: () => undefined, add: (t: { name: string }) => tools.set(t.name, t as never) }),
      list: async () => [...tools.keys()].map(name => ({ id: `charts_${name}` })),
    },
    skill: { transform: async (fn: (editor: unknown) => void) => fn({ add: () => undefined }), list: async () => ({ data: [] }) },
  })
  return {
    dir,
    asserts,
    call: (name, input) => tools.get(name)!.execute(input, { sessionID: "ses_browser", agent: "build", messageID: "msg_1", id: "call_1" }),
    close: async () => { await cleanup?.(); rmSync(dir, { recursive: true, force: true }) },
  }
}

/** The catalogue's own example call for an id, as charts_catalogue returns it. */
export async function catalogueCall(plugin: Plugin, id: string): Promise<Record<string, unknown>> {
  const result = await plugin.call("catalogue", { id })
  return result.output.example as Record<string, unknown>
}

/** Renders through charts_render and returns the HTML file's absolute path. */
export async function renderHtml(plugin: Plugin, input: Record<string, unknown>): Promise<{ html: string; result: ToolResult }> {
  const result = await plugin.call("render", { inspect: false, ...input, formats: input.formats ?? ["html"] })
  const files = result.output.files as { html?: string }
  if (!files.html) throw new Error(`charts_render wrote no HTML: ${JSON.stringify(result.output.files)}`)
  return { html: join(plugin.dir, files.html), result }
}

let browser: Browser | undefined
/** The pinned headless Chromium; a missing browser is an error that says how to install it, never a skip. */
export async function launch(): Promise<Browser> {
  if (browser) return browser
  try {
    browser = await chromium.launch({ headless: true })
  } catch (error) {
    throw new Error(`The browser stage needs playwright-core's headless Chromium, which did not start: ${(error as Error).message.split("\n")[0]}\nInstall it with: ${INSTALL}`)
  }
  return browser
}
export async function closeBrowser() { await browser?.close(); browser = undefined }

export interface Opened {
  readonly page: Page
  readonly url: string
  /** `directive blockedURI` for each securitypolicyviolation event. */
  readonly violations: string[]
  /** console.error messages and uncaught page errors. (Browser performance hints arrive as warnings and are not errors.) */
  readonly errors: string[]
  /** Every request the page made, other than the file itself and data: URLs. */
  readonly requests: string[]
  /** Sequence of shell events seen by a MutationObserver: fonts loaded, first live SVG in the off-screen stage, status. */
  readonly sequence: () => Promise<string[]>
  readonly status: () => Promise<string | null>
  readonly close: () => Promise<void>
}

/** Opens a page from disk in a fresh context, records what it does, and waits for the shell to leave `initializing`. */
export async function open(file: string, options: { wait?: boolean; viewport?: { width: number; height: number } } = {}): Promise<Opened> {
  const b = await launch()
  const context = await b.newContext({ viewport: options.viewport ?? { width: 1280, height: 900 } })
  const page = await context.newPage()
  const url = pathToFileURL(file).href
  const violations: string[] = [], errors: string[] = [], requests: string[] = []
  page.on("console", message => { if (message.type() === "error") errors.push(`console.${message.type()}: ${message.text()}`) })
  page.on("pageerror", error => errors.push(`pageerror: ${error.message}`))
  page.on("request", request => { if (request.url() !== url && !request.url().startsWith("data:")) requests.push(request.url()) })
  // Anything other than the file itself is refused at the network layer too, so a request cannot succeed unnoticed.
  await context.route("**/*", route => (route.request().url() === url || route.request().url().startsWith("data:") ? route.continue() : route.abort()))
  await page.exposeBinding("__chartsViolation", (_source, text: string) => { violations.push(text) })
  await page.addInitScript(() => {
    const w = window as unknown as { __chartsViolation: (s: string) => void; __chartsSequence: string[] }
    w.__chartsSequence = []
    document.addEventListener("securitypolicyviolation", event => w.__chartsViolation(`${event.violatedDirective} ${event.blockedURI}`))
    new MutationObserver(records => {
      for (const record of records) {
        if (record.type === "attributes" && record.target === document.documentElement) w.__chartsSequence.push(`${record.attributeName}=${document.documentElement.getAttribute(record.attributeName!)}`)
        if (record.type === "childList") for (const node of record.addedNodes) if (node instanceof Element && (node.tagName.toLowerCase() === "svg" || node.querySelector?.("svg") || node.tagName.toLowerCase() === "canvas")) {
          const inStage = !!node.closest?.('[aria-hidden="true"]') && !node.closest?.("#chart")
          w.__chartsSequence.push(inStage ? "live-svg-in-stage" : node.closest?.("#chart") ? "svg-in-chart" : "svg-elsewhere")
        }
      }
    }).observe(document, { subtree: true, childList: true, attributes: true, attributeFilter: ["data-chart-status", "data-chart-fonts"] })
  })
  await page.goto(url)
  const status = () => page.evaluate(() => document.documentElement.getAttribute("data-chart-status"))
  if (options.wait !== false) await page.waitForFunction(() => document.documentElement.getAttribute("data-chart-status") !== "initializing", undefined, { timeout: 15_000 })
  return {
    page, url, violations, errors, requests, status,
    sequence: () => page.evaluate(() => (window as unknown as { __chartsSequence: string[] }).__chartsSequence),
    close: () => context.close(),
  }
}

export const workDir = () => mkdtempSync(join(tmpdir(), "charts-browser-file-"))
