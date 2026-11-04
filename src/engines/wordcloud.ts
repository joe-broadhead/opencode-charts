import * as vega from "vega"
import type { FontBook } from "../fonts.js"

/**
 * A drop-in replacement for Vega's `wordcloud` transform. Vega's own needs a canvas to rasterise glyphs, which
 * Node does not have; this one takes the same parameters and output fields, places each word's box (measured with
 * the bundled font tables) on an Archimedean spiral, largest first, with no randomness, so the layout is the same
 * on every host. Rotations snap to 0 or 90 degrees. x and y are the word's centre: draw it with align "center" and
 * baseline "middle".
 */
const OUTPUT = ["x", "y", "font", "fontSize", "fontStyle", "fontWeight", "angle"]
type Accessor = (d: unknown) => unknown
type Box = { x0: number; y0: number; x1: number; y1: number }

export function installWordcloud(fonts: FontBook) {
  const V = vega as unknown as { Transform: new (...a: unknown[]) => object; inherits: (c: unknown, p: unknown, m: object) => void; transforms: Record<string, unknown>; isFunction: (f: unknown) => boolean }
  const fn = (v: unknown, d: unknown) => (typeof v === "function" ? (v as Accessor)(d) : v)
  function Wordcloud(this: { value?: unknown }, params: unknown) { V.Transform.call(this as never, null, params) }
  ;(Wordcloud as unknown as { Definition: unknown }).Definition = (V.transforms.wordcloud as { Definition: unknown }).Definition
  V.inherits(Wordcloud, V.Transform, {
    transform(this: unknown, _: Record<string, unknown>, pulse: { materialize: (f: number) => { source: Record<string, unknown>[] }; SOURCE: number; reflow: (m: boolean) => { modifies: (f: string[]) => unknown }; changed: (f: number) => boolean; ADD_REM: number }) {
      const data = pulse.materialize(pulse.SOURCE).source
      const as = (_.as as string[]) ?? OUTPUT
      const [width, height] = (_.size as [number, number]) ?? [500, 500]
      const text = _.text as Accessor
      const padding = Number(fn(_.padding ?? 1, undefined)) || 1
      const raw = data.map(d => Number(fn(_.fontSize ?? 14, d)) || 0)
      const range = _.fontSizeRange as [number, number] | null | undefined
      let size = (i: number) => raw[i]!
      if (typeof _.fontSize === "function" && range) {
        const lo = Math.sqrt(Math.max(0, Math.min(...raw))), hi = Math.sqrt(Math.max(0, Math.max(...raw)))
        size = i => (hi === lo ? (range[0] + range[1]) / 2 : range[0] + ((Math.sqrt(Math.max(0, raw[i]!)) - lo) / (hi - lo)) * (range[1] - range[0]))
      }
      const order = data.map((_d, i) => i).sort((a, b) => size(b) - size(a) || String(text(data[a])).localeCompare(String(text(data[b]))))
      const placed: Box[] = []
      const ratio = width / height
      for (const i of order) {
        const d = data[i]!
        const word = String(text(d) ?? "")
        const fontSize = Math.round(size(i))
        const font = String(fn(_.font ?? "sans-serif", d)), weight = fn(_.fontWeight ?? "normal", d) as string, style = String(fn(_.fontStyle ?? "normal", d))
        const angle = Math.abs(Number(fn(_.rotate ?? 0, d)) % 180) >= 45 && Math.abs(Number(fn(_.rotate ?? 0, d)) % 180) < 135 ? 90 : 0
        const w = fonts.measure(word, fontSize, font, weight) + padding * 2, h = fontSize * 1.1 + padding * 2
        const [bw, bh] = angle ? [h, w] : [w, h]
        d[as[0]!] = NaN; d[as[1]!] = NaN; d[as[3]!] = 0
        for (let t = 0; t < 4000; t += 0.35) {
          const cx = width / 2 + ratio * 1.6 * t * Math.cos(t), cy = height / 2 + 1.6 * t * Math.sin(t)
          const box = { x0: cx - bw / 2, y0: cy - bh / 2, x1: cx + bw / 2, y1: cy + bh / 2 }
          if (box.x0 < 0 || box.y0 < 0 || box.x1 > width || box.y1 > height) { if (1.6 * t > Math.max(width, height)) break; continue }
          if (placed.some(p => p.x0 < box.x1 && box.x0 < p.x1 && p.y0 < box.y1 && box.y0 < p.y1)) continue
          placed.push(box)
          d[as[0]!] = Math.round(cx * 10) / 10
          d[as[1]!] = Math.round(cy * 10) / 10
          d[as[2]!] = font; d[as[3]!] = fontSize; d[as[4]!] = style; d[as[5]!] = weight; d[as[6]!] = angle
          break
        }
      }
      return pulse.reflow(true).modifies(as)
    },
  })
  V.transforms.wordcloud = Wordcloud
}
