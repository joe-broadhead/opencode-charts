// Times typical charts end to end (validate, render, SVG + 2x PNG + spec files), warm, and reports wall time and
// CPU time (process.cpuUsage covers the worker thread too), so a busy machine does not hide the real cost.
//   bun eval/perf.ts
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { CATALOGUE, exampleCall } from "../src/catalogue.ts"
import { closeVegaWorker } from "../src/engines/vega-pool.ts"
import { renderChart } from "../src/pipeline.ts"

const env = { workspace: { directory: mkdtempSync(join(tmpdir(), "charts-perf-")) }, packageRoot: resolve(import.meta.dir, ".."), configuredThemes: {}, defaults: { outDir: "outputs/charts" } }
const ids = ["bar", "grouped_bar", "line", "multi_line", "stacked_area", "scatter", "histogram", "heatmap", "pie", "sankey", "funnel", "treemap", "choropleth_world"]
const median = (xs: number[]) => xs.slice().sort((a, b) => a - b)[Math.floor(xs.length / 2)]!
const rows: string[] = []
const cold = performance.now()
await renderChart({ spec: { mark: "bar", encoding: {} }, data: { rows: [{ a: 1 }] } }, env).catch(() => undefined)
const first = performance.now() - cold
const all: number[] = []
for (const id of ids) {
  const call = exampleCall(CATALOGUE.find(c => c.id === id)!)
  const wall: number[] = [], cpu: number[] = []
  for (let i = 0; i < 7; i++) {
    const t = performance.now(), c = process.cpuUsage()
    await renderChart({ ...call, name: id }, env)
    const d = process.cpuUsage(c)
    wall.push(performance.now() - t); cpu.push((d.user + d.system) / 1000)
  }
  all.push(median(wall))
  rows.push(`| ${id} | ${Math.round(median(wall))} | ${Math.round(median(cpu))} |`)
}
await closeVegaWorker()
console.log(`First call (loads engines, wasm, fonts): ${Math.round(first)} ms\n\n| Chart | wall ms (median of 7) | CPU ms |\n|---|---|---|\n${rows.join("\n")}\n\nMedian across charts: ${Math.round(median(all))} ms; slowest: ${Math.round(Math.max(...all))} ms.`)
