import { createHash } from "node:crypto"
import { existsSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { Worker } from "node:worker_threads"
import { ChartsError } from "../errors.js"
import type { FontBook } from "../fonts.js"
import type { Json } from "./common.js"
import { renderVegaInProcess, type VegaRender } from "./vega-render.js"

/**
 * Vega renders in one warm worker thread, with a wall-clock limit (`CHARTS_RENDER_TIMEOUT_MS`, default 10 s) and a
 * heap cap (256 MB): a spec that would run away is stopped and the worker replaced, and the OpenCode process never
 * blocks. `CHARTS_IN_PROCESS=1` renders in the calling thread instead (for hosts without worker threads).
 */
const timeoutMs = () => Math.min(60_000, Math.max(1_000, Number(process.env.CHARTS_RENDER_TIMEOUT_MS) || 10_000))

let worker: Worker | undefined
let sentFonts = ""
let nextId = 1
const pending = new Map<number, { resolve: (r: any) => void; reject: (e: unknown) => void; timer: ReturnType<typeof setTimeout>; retry: () => void; worker?: Worker }>()

function workerUrl(): URL | undefined {
  const here = import.meta.url
  // Source (tests, bun): the .ts file beside this one. Bundle: dist/vega-worker.js beside dist/index.js.
  for (const candidate of here.endsWith(".ts") ? ["./vega-worker.ts"] : ["./vega-worker.js"]) {
    const url = new URL(candidate, here)
    if (existsSync(fileURLToPath(url))) return url
  }
  return undefined
}

function spawn(): Worker | undefined {
  const url = workerUrl()
  if (!url) return undefined
  const w = new Worker(url, { resourceLimits: { maxOldGenerationSizeMb: 256 } })
  w.unref()
  w.on("message", (message: { id: number; rows?: unknown[]; svg?: string; width?: number; height?: number; warnings?: string[]; error?: { code: string; detail: string; hint: string; path?: string }; needFonts?: boolean }) => {
    const job = pending.get(message.id)
    if (!job) return
    if (message.needFonts) { sentFonts = ""; job.retry(); return }
    pending.delete(message.id)
    clearTimeout(job.timer)
    if (message.error) job.reject(new ChartsError(message.error.code, message.error.detail, message.error.hint, message.error.path))
    else if (message.rows) job.resolve(message.rows)
    else job.resolve({ svg: message.svg!, width: message.width!, height: message.height!, warnings: message.warnings ?? [] })
  })
  const fail = (error: unknown) => {
    for (const [id, job] of pending) if (job.worker === w) { clearTimeout(job.timer); pending.delete(id); job.reject(error instanceof ChartsError ? error : new ChartsError("RENDER_FAILED", `The renderer stopped: ${(error as Error)?.message ?? error}`, "Simplify the spec (fewer rows or generated values) and try again.")) }
    if (worker === w) { worker = undefined; sentFonts = "" }
  }
  w.on("error", fail)
  w.on("exit", code => { if (code !== 0) fail(new ChartsError("SPEC_TOO_EXPENSIVE", "The chart needed more memory than a chart may use.", "Reduce the data (aggregate first) or the generated values.")) })
  return w
}

const fontsKey = (fonts: FontBook) => createHash("sha256").update(fonts.list().map(f => `${f.family}:${f.weight}:${f.bytes.byteLength}`).join("|")).digest("hex")

export async function renderVega(spec: Json, fonts: FontBook, seed: number): Promise<VegaRender> {
  if (process.env.CHARTS_IN_PROCESS === "1") return renderVegaInProcess(spec, fonts, seed)
  worker ??= spawn()
  if (!worker) return renderVegaInProcess(spec, fonts, seed)
  const id = nextId++
  const key = fontsKey(fonts)
  return new Promise<VegaRender>((resolve, reject) => {
    const send = () => {
      const w = worker ?? (worker = spawn())
      if (!w) { pending.delete(id); renderVegaInProcess(spec, fonts, seed).then(resolve, reject); return }
      const withFonts = sentFonts !== key
      const job = pending.get(id); if (job) job.worker = w
      w.postMessage({ id, spec, seed, fontsKey: key, ...(withFonts ? { fonts: fonts.list().map(f => ({ family: f.family, weight: f.weight, bytes: f.bytes })) } : {}) })
      sentFonts = key
    }
    const timer = setTimeout(() => {
      pending.delete(id)
      const w = worker
      worker = undefined; sentFonts = ""
      void w?.terminate()
      reject(new ChartsError("SPEC_TOO_EXPENSIVE", `The chart took longer than ${timeoutMs() / 1000} s to render.`, "Reduce the data (aggregate first), the number of marks, or generated values."))
    }, timeoutMs())
    pending.set(id, { resolve, reject, timer, retry: send })
    send()
  })
}

/** Runs data.transform in the worker, under the same limits as a render. */
export async function transformRows(rows: Record<string, unknown>[], transform: readonly Record<string, unknown>[], inProcess: (r: Record<string, unknown>[], t: readonly Record<string, unknown>[]) => Record<string, unknown>[]): Promise<Record<string, unknown>[]> {
  if (process.env.CHARTS_IN_PROCESS === "1") return inProcess(rows, transform)
  worker ??= spawn()
  if (!worker) return inProcess(rows, transform)
  const id = nextId++
  return new Promise((resolve, reject) => {
    const send = () => { const w = worker ?? (worker = spawn()); if (!w) { pending.delete(id); try { resolve(inProcess(rows, transform)) } catch (e) { reject(e) } return } const job = pending.get(id); if (job) job.worker = w; w.postMessage({ id, kind: "transform", rows, transform }) }
    const timer = setTimeout(() => { pending.delete(id); const w = worker; worker = undefined; sentFonts = ""; void w?.terminate(); reject(new ChartsError("SPEC_TOO_EXPENSIVE", `data.transform took longer than ${timeoutMs() / 1000} s.`, "Aggregate earlier, or pass fewer rows.")) }, timeoutMs())
    pending.set(id, { resolve, reject, timer, retry: send })
    send()
  })
}

/** Stops the worker (plugin cleanup and tests). */
export async function closeVegaWorker() {
  const w = worker
  worker = undefined; sentFonts = ""
  await w?.terminate()
}
