import { createHash } from "node:crypto"
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { initWasm, Resvg } from "@resvg/resvg-wasm"
import { ChartsError } from "./errors.js"
import type { FontBook } from "./fonts.js"
import { LIMITS } from "./safety.js"

/**
 * PNG through resvg compiled to WebAssembly: one 2.4 MB file that runs the same on linux-x64, linux-arm64 and macOS,
 * with no native prebuilds, no system fonts (only the bundled ones) and no install scripts.
 */
declare const RESVG_WASM_SHA256: string | undefined

let ready: Promise<void> | undefined
function wasmPath(packageRoot: string) {
  for (const candidate of [join(packageRoot, "dist", "resvg.wasm"), join(packageRoot, "node_modules", "@resvg", "resvg-wasm", "index_bg.wasm")]) if (existsSync(candidate)) return candidate
  throw new ChartsError("PNG_UNAVAILABLE", "The PNG renderer (resvg.wasm) is missing from the package.", "Reinstall the plugin; SVG output still works.")
}

/** The PNG renderer's problem, as a ChartsError, or undefined when the wasm is there and is the one this build expects. */
export function pngProblem(packageRoot: string): ChartsError | undefined {
  try {
    const bytes = readFileSync(wasmPath(packageRoot))
    const expected = typeof RESVG_WASM_SHA256 === "string" ? RESVG_WASM_SHA256 : undefined
    if (expected && createHash("sha256").update(bytes).digest("hex") !== expected) return new ChartsError("PNG_UNAVAILABLE", "resvg.wasm does not match the plugin build.", "Reinstall the plugin.")
    return undefined
  } catch (error) {
    if (error instanceof ChartsError) return error
    throw error
  }
}

export function initPng(packageRoot: string) {
  ready ??= (async () => {
    const bytes = readFileSync(wasmPath(packageRoot))
    // The bundle carries the hash of the wasm it was built with, so a stale or swapped file is refused.
    const expected = typeof RESVG_WASM_SHA256 === "string" ? RESVG_WASM_SHA256 : undefined
    if (expected && createHash("sha256").update(bytes).digest("hex") !== expected) throw new ChartsError("PNG_UNAVAILABLE", "resvg.wasm does not match the plugin build.", "Reinstall the plugin.")
    await initWasm(bytes)
  })()
  return ready
}

export async function svgToPng(packageRoot: string, svg: string, fonts: FontBook, scale: number, defaultFamily: string): Promise<{ png: Uint8Array; width: number; height: number }> {
  await initPng(packageRoot)
  const resvg = new Resvg(svg, { fitTo: { mode: "zoom", value: scale }, font: { fontBuffers: fonts.buffersFor(svg, defaultFamily), loadSystemFonts: false, defaultFontFamily: defaultFamily, sansSerifFamily: defaultFamily, monospaceFamily: "JetBrains Mono" } as never, shapeRendering: 2, textRendering: 1 })
  try {
    if (resvg.width * resvg.height * scale * scale > LIMITS.pngPixels) throw new ChartsError("PNG_TOO_LARGE", `A ${Math.round(resvg.width * scale)}×${Math.round(resvg.height * scale)} PNG is over the size limit.`, "Use a smaller scale or a smaller chart.")
    const image = resvg.render()
    const out = { png: image.asPng(), width: image.width, height: image.height }
    image.free()
    return out
  } finally {
    resvg.free()
  }
}

/** SVG with every glyph as a path (resvg's usvg output): exact everywhere, at the cost of size and selectable text. */
export async function svgTextToPaths(packageRoot: string, svg: string, fonts: FontBook, defaultFamily: string): Promise<string> {
  await initPng(packageRoot)
  const resvg = new Resvg(svg, { font: { fontBuffers: fonts.buffersFor(svg, defaultFamily), loadSystemFonts: false, defaultFontFamily: defaultFamily, sansSerifFamily: defaultFamily } as never })
  try { return resvg.toString() } finally { resvg.free() }
}
