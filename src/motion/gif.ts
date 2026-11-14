import { Resvg } from "@resvg/resvg-wasm"
import { ChartsError } from "../errors.js"
import type { FontBook } from "../fonts.js"
import { initPng } from "../png.js"

/**
 * Animated files from SVG: a `.gif` built frame by frame in this process (gifenc for the encoding, resvg for the
 * pixels, both bundled, no network and no native install). The frames are ordinary SVG drawings, so every engine's
 * output works, and the same frames always produce the same bytes: the palette is computed once from the final frame
 * and reused, and gifenc's `rgb565` quantisation is fixed.
 *
 * The size caps keep a GIF from turning into a memory problem: at most 60 frames, at most 1280×960 pixels each.
 */

/** Frames per file, and the size of a frame: more than this is a video, not a chart. */
export const MAX_GIF_FRAMES = 60
export const MAX_GIF_WIDTH = 1280
export const MAX_GIF_HEIGHT = 960

export interface GifOptions {
  /** Zoom applied before the caps, as a PNG's scale is. */
  readonly scale?: number
  /** Frames per second: the per-frame delay is 1000 / fps. */
  readonly fps?: number
  /** 0 loops forever (the default), a positive number plays that many times. */
  readonly repeat?: number
  /** The family resvg falls back to for text without one of its own. */
  readonly defaultFamily?: string
  /** How many extra times the final frame is shown, so a reader sees the end state. */
  readonly holdLastFrames?: number
}

export interface GifResult {
  readonly gif: Uint8Array
  readonly width: number
  readonly height: number
  readonly frames: number
}

interface Encoder {
  writeFrame(index: Uint8Array, width: number, height: number, options?: { palette?: readonly (readonly number[])[]; delay?: number; repeat?: number; first?: boolean }): void
  finish(): void
  bytes(): Uint8Array
}

interface Gifenc {
  GIFEncoder(options?: { initialCapacity?: number; auto?: boolean }): Encoder
  quantize(rgba: Uint8Array, maxColors: number, options?: { format?: "rgb565" | "rgb444" | "rgba4444" }): number[][]
  applyPalette(rgba: Uint8Array, palette: number[][], format?: "rgb565" | "rgb444" | "rgba4444"): Uint8Array
}

/** gifenc ships no type declarations; the three functions used here are typed above. */
async function gifenc(): Promise<Gifenc> {
  return (await import("gifenc" as string)) as Gifenc
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value))
}

/** SVG text as resvg draws it: the same font files and fallbacks the PNG output uses. */
function rasterise(packageRoot: string, svg: string, fonts: FontBook, scale: number, defaultFamily: string) {
  const resvg = new Resvg(svg, {
    fitTo: { mode: "zoom", value: scale },
    font: { fontBuffers: fonts.buffersFor(svg, defaultFamily), loadSystemFonts: false, defaultFontFamily: defaultFamily, sansSerifFamily: defaultFamily, monospaceFamily: "JetBrains Mono" } as never,
    shapeRendering: 2,
    textRendering: 1,
  })
  try {
    const image = resvg.render()
    const frame = { pixels: new Uint8Array(image.pixels), width: image.width, height: image.height }
    image.free()
    return frame
  } finally {
    resvg.free()
  }
}

/**
 * Renders SVG frames to an animated GIF. Every frame is drawn at the same size, the palette is quantised from the
 * final frame (`rgb565`, 256 colours) and applied to all of them, and the delay is `1000 / fps`; two calls on the
 * same frames therefore return the same bytes.
 */
export async function renderSvgFramesToGif(packageRoot: string, svgFrames: readonly string[], fonts: FontBook, options: GifOptions = {}): Promise<GifResult> {
  if (svgFrames.length === 0) throw new ChartsError("SIZE_INVALID", "There are no frames to write a GIF from.", "Render at least one SVG frame, such as generateProgressiveRevealFrames's output.")
  if (svgFrames.length > MAX_GIF_FRAMES) throw new ChartsError("SIZE_INVALID", `A GIF has at most ${MAX_GIF_FRAMES} frames; ${svgFrames.length} were given.`, `Sample at most ${MAX_GIF_FRAMES} frames, or publish an interactive story page with formats: ["html"].`)
  const fps = clamp(Math.round(options.fps ?? 12), 1, 50)
  const hold = clamp(Math.round(options.holdLastFrames ?? 0), 0, 30)
  const defaultFamily = options.defaultFamily ?? "Inter"
  await initPng(packageRoot)

  // The final frame sets the size and the palette: it is the most complete drawing, so the earlier frames borrow its
  // colours, and one global colour table keeps the file small.
  const lastSvg = svgFrames[svgFrames.length - 1]!
  const measured = rasterise(packageRoot, lastSvg, fonts, 1, defaultFamily)
  const scale = Math.min(options.scale ?? 1, MAX_GIF_WIDTH / measured.width, MAX_GIF_HEIGHT / measured.height)
  const last = scale === 1 ? measured : rasterise(packageRoot, lastSvg, fonts, scale, defaultFamily)
  const width = Math.max(1, last.width), height = Math.max(1, last.height)
  const { GIFEncoder, quantize, applyPalette } = await gifenc()
  const palette = quantize(last.pixels, 256, { format: "rgb565" })
  const encoder = GIFEncoder()
  const delay = Math.max(20, Math.round(1000 / fps))
  const repeat = options.repeat ?? 0
  let first = true
  const push = (pixels: Uint8Array) => {
    encoder.writeFrame(applyPalette(pixels, palette, "rgb565"), width, height, first ? { palette, delay, repeat } : { delay })
    first = false
  }
  for (const svg of svgFrames) {
    const raster = first && svg === lastSvg && scale === 1 ? measured : rasterise(packageRoot, svg, fonts, scale, defaultFamily)
    if (raster.width !== width || raster.height !== height) throw new ChartsError("SIZE_INVALID", `A GIF's frames must all be the same size: one is ${raster.width}×${raster.height}, another ${width}×${height}.`, "Draw every frame at one size, as the timeline and reveal builders do.")
    push(raster.pixels)
  }
  for (let i = 0; i < hold; i++) push(last.pixels)
  encoder.finish()
  return { gif: encoder.bytes(), width, height, frames: svgFrames.length + hold }
}

/**
 * One drawing as a clip reveal: the whole SVG inside a clip path whose width grows from the first frame to the last,
 * so a single line, area, Sankey or bar chart becomes a smooth animation. The plot area is not measured: the reveal
 * runs across the whole drawing, which reads the same on any engine's output and needs no knowledge of its layout.
 */
export function generateProgressiveRevealFrames(svg: string, frameCount = 24): string[] {
  const count = clamp(Math.round(frameCount), 2, MAX_GIF_FRAMES)
  const open = /<svg\b((?:"[^"]*"|'[^']*'|[^>"'])*)>/.exec(svg)
  if (!open) throw new ChartsError("RENDER_FAILED", "There is no <svg> element to reveal.", "Pass a rendered chart's SVG.")
  const close = svg.lastIndexOf("</svg>")
  if (close < 0) throw new ChartsError("RENDER_FAILED", "The SVG does not close.", "Pass a rendered chart's SVG.")
  const viewBox = /viewBox\s*=\s*"([^"]*)"/.exec(open[1] ?? "")
  const numbers = viewBox ? viewBox[1]!.trim().split(/[\s,]+/).map(Number) : []
  const width = numbers.length === 4 && Number.isFinite(numbers[2]!) ? numbers[2]! : Number(/\bwidth\s*=\s*"([\d.]+)"/.exec(open[1] ?? "")?.[1] ?? 0)
  const height = numbers.length === 4 && Number.isFinite(numbers[3]!) ? numbers[3]! : Number(/\bheight\s*=\s*"([\d.]+)"/.exec(open[1] ?? "")?.[1] ?? 0)
  if (!(width > 0)) throw new ChartsError("RENDER_FAILED", "The SVG has no width to reveal across.", "Render the chart with a width, or keep the viewBox the renderer writes.")
  const tall = height > 0 ? `${height}` : "100%"
  const inner = svg.slice(open.index + open[0].length, close)
  const tail = svg.slice(close)
  const root = `charts-reveal`
  return Array.from({ length: count }, (_, index) => {
    const revealed = Math.round((width * (index + 1)) / count * 1000) / 1000
    const defs = `<defs><clipPath id="${root}"><rect x="0" y="0" width="${revealed}" height="${tall}"/></clipPath></defs>`
    return `${svg.slice(0, open.index)}${open[0]}${defs}<g clip-path="url(#${root})">${inner}</g>${tail}`
  })
}
