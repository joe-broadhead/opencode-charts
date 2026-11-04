// Renders every catalogue example (each in a theme, cycling) plus one chart in every built-in theme, into a folder,
// with an HTML contact sheet. Usage: bun scripts/gallery.ts <out-dir>
import { mkdirSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { CATALOGUE } from "../src/catalogue.ts"
import { renderChart } from "../src/pipeline.ts"
import { builtinThemes } from "../src/themes/store.ts"

const out = resolve(process.argv[2] ?? "gallery-out")
mkdirSync(out, { recursive: true })
const root = resolve(import.meta.dir, "..")
const env = { workspace: { directory: out }, packageRoot: root, configuredThemes: {}, defaults: { outDir: "charts" } }
const themes = Object.keys(builtinThemes(root))
const cycle = ["light", "dark", "toqan", "toqan-night", "presentation", "high-contrast", "print"]
const cards: string[] = []
const failures: string[] = []
const report: { id: string; theme: string; ms: number; issues: string[] }[] = []
const jobs = [
  ...CATALOGUE.map((entry, i) => ({ id: entry.id, entry, theme: cycle[i % cycle.length]! })),
  ...themes.map(theme => ({ id: `theme-${theme}`, entry: CATALOGUE.find(e => e.id === "grouped_bar")!, theme })),
  ...themes.map(theme => ({ id: `theme-sankey-${theme}`, entry: CATALOGUE.find(e => e.id === "sankey")!, theme })),
]
for (const job of jobs) {
  const ex = job.entry.example(); const t0 = performance.now(); if (process.env.TRACE) process.stdout.write(`${job.id} ${job.theme} ...`)
  try {
    const r = await renderChart({ spec: ex.spec, ...(ex.rows ? { data: { rows: ex.rows } } : {}), title: ex.title, theme: job.theme, name: `${job.id}-${job.theme}`, formats: ["svg", "png", "spec"], ...(ex.currency ? { currency: ex.currency } : {}), ...(ex.width ? { width: ex.width } : {}), ...(ex.height ? { height: ex.height } : {}) }, env as never)
    if (process.env.TRACE) console.log(Math.round(performance.now() - t0)); report.push({ id: job.id, theme: job.theme, ms: r.ms, issues: r.issues.map(i => `${i.code}: ${i.message}`) })
    cards.push(`<figure><img src="${r.files.png[0]}" loading="lazy"><figcaption><b>${job.entry.name}</b> · ${job.entry.engine} · ${job.theme} · ${r.ms} ms${r.issues.length ? ` · <span class=w>${r.issues.map(i => i.code).join(", ")}</span>` : ""}</figcaption></figure>`)
  } catch (error) {
    if (process.env.TRACE) console.log("FAILED"); failures.push(`${job.id} (${job.theme}): ${(error as Error).message}`)
  }
}
writeFileSync(join(out, "index.html"), `<!doctype html><meta charset=utf-8><title>opencode-charts gallery</title><style>body{font:14px system-ui;margin:24px;background:#f6f6f4}main{display:grid;grid-template-columns:repeat(auto-fill,minmax(420px,1fr));gap:20px}figure{margin:0;background:#fff;padding:10px;border:1px solid #ddd}img{width:100%;height:auto}figcaption{margin-top:6px;color:#333}.w{color:#a40}</style><h1>opencode-charts gallery — ${jobs.length} charts</h1><main>${cards.join("\n")}</main>`)
writeFileSync(join(out, "report.json"), JSON.stringify({ failures, report }, null, 1))
console.log(`${report.length} rendered, ${failures.length} failed`)
for (const f of failures) console.log("FAIL", f)
for (const r of report) if (r.issues.length) console.log("WARN", r.id, r.theme, r.issues.join(" | ").slice(0, 300))
const times = report.map(r => r.ms).sort((a, b) => a - b)
console.log("median ms", times[Math.floor(times.length / 2)], "p90", times[Math.floor(times.length * 0.9)])

// Contact sheets: 12 charts a page, as PNGs, for review without a browser.
import { readFileSync as read } from "node:fs"
import { svgToPng } from "../src/png.ts"
import { bundledFonts } from "../src/fonts.ts"
import { closeVegaWorker } from "../src/engines/vega-pool.ts"
const entries = report.map(r => ({ ...r, png: join(out, "charts", `${r.id.replaceAll("_", "-")}-${r.theme}.png`), name: (CATALOGUE.find(c => c.id === r.id)?.name ?? r.id) }))
const esc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;")
const W = 520, H = 380, COLS = 3, ROWS_PER = 4
for (let page = 0; page * COLS * ROWS_PER < entries.length; page++) {
  const slice = entries.slice(page * COLS * ROWS_PER, (page + 1) * COLS * ROWS_PER)
  const cells = slice.map((e, i) => {
    const x = (i % COLS) * (W + 20) + 20, y = Math.floor(i / COLS) * (H + 50) + 60
    const png = read(e.png)
    const pw = png.readUInt32BE(16), ph = png.readUInt32BE(20)
    const scale = Math.min(W / pw, H / ph)
    return `<rect x="${x - 1}" y="${y - 1}" width="${W + 2}" height="${H + 2}" fill="#fff" stroke="#ddd"/><image x="${x + (W - pw * scale) / 2}" y="${y + (H - ph * scale) / 2}" width="${pw * scale}" height="${ph * scale}" href="data:image/png;base64,${png.toString("base64")}"/><text x="${x}" y="${y + H + 22}" font-family="Inter" font-size="14" fill="#222">${esc(e.name)} · ${e.theme} · ${e.ms} ms${e.issues.length ? " · " + esc(e.issues.map(i => i.split(":")[0]).join(", ")) : ""}</text>`
  }).join("")
  const width = COLS * (W + 20) + 20, height = ROWS_PER * (H + 50) + 70
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="#F3F3F1"/><text x="20" y="36" font-family="Inter" font-weight="600" font-size="20" fill="#111">opencode-charts gallery — page ${page + 1} of ${Math.ceil(entries.length / (COLS * ROWS_PER))}</text>${cells}</svg>`
  const { png } = await svgToPng(root, svg, bundledFonts(root), 1, "Inter")
  writeFileSync(join(out, `contact-${String(page + 1).padStart(2, "0")}.png`), png)
}
console.log(`contact sheets written to ${out}`)
await closeVegaWorker()
