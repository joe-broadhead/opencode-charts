import { createHash } from "node:crypto"
import { existsSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { Worker } from "node:worker_threads"
import { ChartsError, type ChartsCode } from "../errors.js"
import type { FontBook } from "../fonts.js"
import type { Json } from "./common.js"
import { renderVegaInProcess, type VegaRender } from "./vega-render.js"
import { renderDiagram, ASCII_DEADLINE_MS, asciiTooSlowIssue, type DiagramRender, type DiagramRenderOptions } from "./diagram.js"

/**
 * Vega, data transforms and diagrams render in one warm worker thread, with a wall-clock limit
 * (`CHARTS_RENDER_TIMEOUT_MS`, default 10 s) and a heap cap (`WORKER_HEAP_MB`): a spec that would run away is stopped
 * and the worker replaced, and the OpenCode process never blocks. A diagram's ASCII outline is a second job with its
 * own, shorter deadline, so an outline that cannot finish costs the outline and not the drawing. `CHARTS_IN_PROCESS=1`
 * renders in the calling thread instead (for hosts without worker threads); a Mermaid diagram then has no ASCII
 * outline, because nothing could stop one that does not finish.
 */
const timeoutMs = () => Math.min(60_000, Math.max(1_000, Number(process.env.CHARTS_RENDER_TIMEOUT_MS) || 10_000))
/** The worker's V8 heap cap, in MB. A job that needs more is stopped with SPEC_TOO_EXPENSIVE. */
export const WORKER_HEAP_MB = 256

let worker: Worker | undefined
let sentFonts = ""
let nextId = 1
interface Job { resolve: (r: any) => void; reject: (e: unknown) => void; timer: ReturnType<typeof setTimeout>; retry: () => void; worker?: Worker }
const pending = new Map<number, Job>()

function workerUrl(): URL | undefined {
  const here = import.meta.url
  // Source (tests, bun): the .ts file beside this one. Bundle: dist/vega-worker.js, beside dist/renderer.js or one
  // folder above the dist/chunks/ file this code is split into.
  for (const candidate of here.endsWith(".ts") ? ["./vega-worker.ts"] : ["./vega-worker.js", "../vega-worker.js"]) {
    const url = new URL(candidate, here)
    if (existsSync(fileURLToPath(url))) return url
  }
  return undefined
}

function spawn(): Worker | undefined {
  const url = workerUrl()
  if (!url) return undefined
  const w = new Worker(url, { resourceLimits: { maxOldGenerationSizeMb: WORKER_HEAP_MB } })
  w.unref()
  w.on("message", (message: { id: number; rows?: unknown[]; result?: unknown; svg?: string; width?: number; height?: number; warnings?: string[]; error?: { code: ChartsCode; detail: string; hint: string; path?: string }; needFonts?: boolean }) => {
    const job = pending.get(message.id)
    if (!job) return
    if (message.needFonts) { sentFonts = ""; job.retry(); return }
    pending.delete(message.id)
    clearTimeout(job.timer)
    if (message.error) job.reject(new ChartsError(message.error.code, message.error.detail, message.error.hint, message.error.path))
    else if (message.rows) job.resolve(message.rows)
    else if (message.result !== undefined) job.resolve(message.result)
    else job.resolve({ svg: message.svg!, width: message.width!, height: message.height!, warnings: message.warnings ?? [] })
  })
  const fail = (error: unknown) => {
    for (const [id, job] of pending) if (job.worker === w) { clearTimeout(job.timer); pending.delete(id); job.reject(error instanceof ChartsError ? error : new ChartsError("RENDER_FAILED", `The renderer stopped: ${(error as Error)?.message ?? error}`, "Simplify the spec (fewer rows or generated values) and try again.")) }
    if (worker === w) { worker = undefined; sentFonts = "" }
  }
  w.on("error", fail)
  w.on("exit", code => { if (code !== 0) fail(new ChartsError("SPEC_TOO_EXPENSIVE", `The chart needed more memory than a chart may use (${WORKER_HEAP_MB} MB).`, "Reduce the data (aggregate first), the generated values, or the diagram's nodes and edges.")) })
  return w
}

/** The worker keeps the faces it was sent until this changes: the approved resources' families, weights and content hashes. */
const fontsKey = (fonts: FontBook) => createHash("sha256").update(fonts.list().map(f => `${f.family}:${f.weight}:${f.resource.sha256}`).join("|")).digest("hex")

/**
 * One job in the worker, under a hard deadline: when it passes, the worker is terminated (which stops the work, however
 * synchronous) and the job is refused with `onTimeout`. `fonts` sends the font book along when the worker does not hold it.
 */
function inWorker<T>(payload: Record<string, unknown>, fonts: FontBook | undefined, deadlineMs: number, onTimeout: () => ChartsError, inProcess: () => Promise<T>): Promise<T> {
  const id = nextId++
  const key = fonts ? fontsKey(fonts) : ""
  return new Promise<T>((resolve, reject) => {
    const send = () => {
      const w = worker ?? (worker = spawn())
      if (!w) { const job = pending.get(id); if (job) clearTimeout(job.timer); pending.delete(id); inProcess().then(resolve, reject); return }
      const job = pending.get(id); if (job) job.worker = w
      const withFonts = fonts !== undefined && sentFonts !== key
      w.postMessage({ id, ...payload, ...(fonts ? { fontsKey: key } : {}), ...(withFonts ? { fonts: fonts!.list().map(f => ({ family: f.family, weight: f.weight, bytes: f.bytes })) } : {}) })
      if (fonts) sentFonts = key
    }
    const timer = setTimeout(() => {
      pending.delete(id)
      const w = worker
      worker = undefined; sentFonts = ""
      void w?.terminate()
      reject(onTimeout())
    }, deadlineMs)
    pending.set(id, { resolve, reject, timer, retry: send })
    send()
  })
}

export async function renderVega(spec: Json, fonts: FontBook, seed: number): Promise<VegaRender> {
  if (process.env.CHARTS_IN_PROCESS === "1") return renderVegaInProcess(spec, fonts, seed)
  worker ??= spawn()
  if (!worker) return renderVegaInProcess(spec, fonts, seed)
  return inWorker<VegaRender>({ spec, seed }, fonts, timeoutMs(),
    () => new ChartsError("SPEC_TOO_EXPENSIVE", `The chart took longer than ${timeoutMs() / 1000} s to render.`, "Reduce the data (aggregate first), the number of marks, or generated values."),
    () => renderVegaInProcess(spec, fonts, seed))
}

/** Runs data.transform in the worker, under the same limits as a render. */
export async function transformRows(rows: Record<string, unknown>[], transform: readonly Record<string, unknown>[], inProcess: (r: Record<string, unknown>[], t: readonly Record<string, unknown>[]) => Record<string, unknown>[]): Promise<Record<string, unknown>[]> {
  if (process.env.CHARTS_IN_PROCESS === "1") return inProcess(rows, transform)
  worker ??= spawn()
  if (!worker) return inProcess(rows, transform)
  return inWorker<Record<string, unknown>[]>({ kind: "transform", rows, transform }, undefined, timeoutMs(),
    () => new ChartsError("SPEC_TOO_EXPENSIVE", `data.transform took longer than ${timeoutMs() / 1000} s.`, "Aggregate earlier, or pass fewer rows."),
    async () => inProcess(rows, transform))
}

/**
 * Draws a diagram in the worker, under the render deadline and the heap cap, then its Mermaid ASCII outline as a second
 * job under `ASCII_DEADLINE_MS`. The size limits (`DIAGRAM_LIMITS`) are checked first, in the worker, before any layout.
 * An outline that does not finish in time, or needs more memory than the worker has, is left out with a warning: the
 * drawing stands, and the outline falls back to the diagram's title.
 */
export async function renderDiagramBounded(spec: unknown, options: DiagramRenderOptions): Promise<DiagramRender> {
  const { theme, fonts, width, height } = options
  if (process.env.CHARTS_IN_PROCESS === "1") return renderDiagram(spec, { ...options, mermaidAscii: "skip" })
  worker ??= spawn()
  if (!worker) return renderDiagram(spec, { ...options, mermaidAscii: "skip" })
  const deadline = timeoutMs()
  const drawn = await inWorker<DiagramRender>({ kind: "diagram", spec, theme, ...(width !== undefined ? { width } : {}), ...(height !== undefined ? { height } : {}) }, fonts, deadline,
    () => new ChartsError("SPEC_TOO_EXPENSIVE", `The diagram took longer than ${deadline / 1000} s to lay out.`, "Split it into smaller diagrams, or use fewer nodes and edges."),
    () => renderDiagram(spec, { ...options, mermaidAscii: "skip" }))
  if (drawn.asciiSource === undefined) return drawn
  const { asciiSource, ...rest } = drawn
  const asciiDeadline = Math.min(ASCII_DEADLINE_MS, deadline)
  try {
    const ascii = await inWorker<string>({ kind: "ascii", source: asciiSource }, undefined, asciiDeadline,
      () => new ChartsError("SPEC_TOO_EXPENSIVE", `The ASCII outline took longer than ${asciiDeadline / 1000} s.`, "The drawing is unaffected."),
      async () => "")
    return ascii.trim() ? { ...rest, ascii } : rest
  } catch {
    return { ...rest, issues: [...rest.issues, asciiTooSlowIssue(asciiDeadline)] }
  }
}

/** Stops the worker (plugin cleanup and tests). */
export async function closeVegaWorker() {
  const w = worker
  worker = undefined; sentFonts = ""
  await w?.terminate()
}
