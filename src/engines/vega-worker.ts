import { parentPort } from "node:worker_threads"
import { FontBook, parseFont } from "../fonts.js"
import { applyTransforms } from "../data.js"
import type { ThemeTokens } from "../themes/tokens.js"
import { renderDiagram, renderMermaidOutline } from "./diagram.js"
import { renderVegaInProcess } from "./vega-render.js"

/**
 * The render worker. Vega's dataflow and a diagram's layout are synchronous, so a costly spec would block the OpenCode
 * process and no timer could stop it; here it blocks only this thread, which the plugin terminates after the time
 * limit, and the thread's heap is capped. One worker is kept warm and reused.
 */
interface Request {
  id: number
  kind?: "render" | "transform" | "diagram" | "ascii"
  spec: Record<string, unknown>
  seed: number
  fontsKey: string
  fonts?: { family: string; weight: number; bytes: Uint8Array }[]
  rows?: Record<string, unknown>[]
  transform?: Record<string, unknown>[]
  theme?: ThemeTokens
  width?: number
  height?: number
  source?: string
}

let book: FontBook | undefined, bookKey = ""
parentPort?.on("message", async (message: Request) => {
  try {
    if (message.kind === "transform") { parentPort!.postMessage({ id: message.id, rows: applyTransforms(message.rows ?? [], message.transform ?? []) }); return }
    if (message.kind === "ascii") { parentPort!.postMessage({ id: message.id, result: renderMermaidOutline(message.source ?? "") }); return }
    if (message.fonts) {
      const next = new FontBook()
      for (const f of message.fonts) next.add(parseFont(f.bytes, f.family, f.weight))
      book = next; bookKey = message.fontsKey
    }
    if (!book || bookKey !== message.fontsKey) { parentPort!.postMessage({ id: message.id, needFonts: true }); return }
    if (message.kind === "diagram") {
      const out = await renderDiagram(message.spec, { theme: message.theme!, fonts: book, mermaidAscii: "defer", ...(message.width !== undefined ? { width: message.width } : {}), ...(message.height !== undefined ? { height: message.height } : {}) })
      parentPort!.postMessage({ id: message.id, result: out })
      return
    }
    const out = await renderVegaInProcess(message.spec, book, message.seed)
    parentPort!.postMessage({ id: message.id, svg: out.svg, width: out.width, height: out.height, warnings: out.warnings })
  } catch (error) {
    const e = error as { code?: string; detail?: string; hint?: string; path?: string; message?: string }
    parentPort!.postMessage({ id: message.id, error: { code: e.code ?? "RENDER_FAILED", detail: e.detail ?? e.message ?? String(error), hint: e.hint ?? "Check the spec.", path: e.path } })
  }
})
