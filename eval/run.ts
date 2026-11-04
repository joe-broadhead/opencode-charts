// Runs the chart eval: each natural-language request's tool call is executed through the plugin's own tool code,
// and the result is checked against the request's expected properties: it renders, uses the right marks and engine,
// applies the theme and formatting, has no overlapping or clipped labels, and has no unexpected warnings.
//
//   bun eval/run.ts [out-dir]                       scripted calls (the reference answers)
//   bun eval/run.ts [out-dir] --answers model.jsonl  a model's calls: one {"id","tool","input"} per line
//
// Writes report.json and report.md to out-dir, and exits non-zero when a case fails.
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { closeVegaWorker } from "../src/engines/vega-pool.ts"
import { runTool } from "../src/tools.ts"
import { CASES, type Case } from "./cases.ts"

const args = process.argv.slice(2)
const answersAt = args.indexOf("--answers")
const answers = answersAt >= 0 ? new Map(readFileSync(args[answersAt + 1]!, "utf8").split("\n").filter(Boolean).map(line => { const a = JSON.parse(line); return [a.id, a] as const })) : undefined
const out = resolve(args.find((a, i) => !a.startsWith("--") && (answersAt < 0 || i !== answersAt + 1)) ?? mkdtempSync(join(tmpdir(), "charts-eval-")))
mkdirSync(join(out, "data"), { recursive: true })
writeFileSync(join(out, "data/sales.csv"), "region,revenue_eur\nNorth,1250000\nSouth,830000\nEast,990000\nWest,410000\n")
const env = { workspace: { directory: out }, packageRoot: resolve(import.meta.dir, ".."), configuredThemes: {}, defaults: { outDir: "outputs/charts" }, assertFiles: async () => undefined }

const get = (obj: unknown, path: string): unknown => path.split(".").reduce<unknown>((o, k) => (o && typeof o === "object" ? (o as Record<string, unknown>)[k] : undefined), obj)
function marksOf(spec: Record<string, unknown>): Set<string> {
  const found = new Set<string>()
  const visit = (n: unknown) => {
    if (Array.isArray(n)) { n.forEach(visit); return }
    if (!n || typeof n !== "object") return
    const o = n as Record<string, unknown>
    if (typeof o.mark === "string") found.add(o.mark)
    if (o.mark && typeof o.mark === "object" && typeof (o.mark as Record<string, unknown>).type === "string") found.add((o.mark as Record<string, unknown>).type as string)
    if (Array.isArray(o.marks)) for (const m of o.marks) if (m && typeof m === "object" && typeof (m as Record<string, unknown>).type === "string") found.add((m as Record<string, unknown>).type as string)
    if (Array.isArray(o.series)) for (const s of o.series) if (s && typeof s === "object" && typeof (s as Record<string, unknown>).type === "string") found.add((s as Record<string, unknown>).type as string)
    for (const [k, v] of Object.entries(o)) if (k !== "values" && k !== "data") visit(v)
  }
  visit(spec)
  return found
}

async function grade(c: Case) {
  const call = answers ? answers.get(c.id) : { tool: c.tool, input: { ...c.input, name: c.id } }
  const failures: string[] = []
  if (!call) return { id: c.id, request: c.request, ok: false, failures: ["no answer for this case"], ms: 0 }
  const started = performance.now()
  try {
    const input = { ...call.input, name: c.id } as Record<string, unknown>
    if (Array.isArray(input.formats) && !input.formats.includes("spec")) input.formats = [...input.formats, "spec"]
    if (Array.isArray(input.formats) && !input.formats.includes("svg")) input.formats = [...input.formats, "svg"]
    const result = await runTool(env as never, call.tool, input)
    const o = result.output as Record<string, any>
    const svg = readFileSync(join(out, o.files.svg), "utf8")
    const spec = JSON.parse(readFileSync(join(out, o.files.spec), "utf8"))
    const marks = marksOf(spec)
    for (const m of c.expect.marks ?? []) if (!marks.has(m)) failures.push(`mark ${m} missing (has ${[...marks].join(", ")})`)
    if (c.expect.engine && o.engine !== c.expect.engine) failures.push(`engine ${o.engine}, expected ${c.expect.engine}`)
    if (c.expect.theme && o.theme !== c.expect.theme) failures.push(`theme ${o.theme}, expected ${c.expect.theme}`)
    for (const s of c.expect.svgContains ?? []) if (!svg.includes(s)) failures.push(`SVG lacks "${s}"`)
    for (const path of c.expect.specHas ?? []) {
      const [p, value] = path.split("=")
      const got = get(spec, p!)
      if (got === undefined || (value !== undefined && String(got) !== value)) failures.push(`spec ${p} is ${JSON.stringify(got)}${value !== undefined ? `, expected ${value}` : ""}`)
    }
    for (const f of c.expect.formats ?? []) if (!(f === "png" ? o.files.png.length : o.files[f])) failures.push(`no ${f} file`)
    if (o.files.html) { const html = readFileSync(join(out, o.files.html), "utf8"); if (/<script[^>]+src=|<link\b|(src|href)=["']https?:/i.test(html)) failures.push("HTML references the network") }
    if (o.layout.overlaps.length) failures.push(`overlapping labels: ${JSON.stringify(o.layout.overlaps.slice(0, 2))}`)
    if (o.layout.clipped.length) failures.push(`clipped labels: ${o.layout.clipped.slice(0, 3).join(", ")}`)
    const unexpected = (o.warnings as { code: string; message: string }[]).filter(w => !(c.expect.allowWarnings ?? []).includes(w.code))
    if (unexpected.length) failures.push(`warnings: ${unexpected.map(w => `${w.code} (${w.message.slice(0, 80)})`).join("; ")}`)
    return { id: c.id, request: c.request, ok: failures.length === 0, failures, ms: Math.round(performance.now() - started), png: o.files.png[0] }
  } catch (error) {
    return { id: c.id, request: c.request, ok: false, failures: [`error: ${(error as Error).message.slice(0, 300)}`], ms: Math.round(performance.now() - started) }
  }
}

const results = []
for (const c of CASES) results.push(await grade(c))
await closeVegaWorker()
const passed = results.filter(r => r.ok).length
writeFileSync(join(out, "report.json"), JSON.stringify({ mode: answers ? "answers" : "scripted", passed, total: results.length, results }, null, 1))
writeFileSync(join(out, "report.md"), `# Chart eval (${answers ? "model answers" : "scripted"}): ${passed}/${results.length}\n\n| Case | Request | Result | ms |\n|---|---|---|---|\n${results.map(r => `| ${r.id} | ${r.request} | ${r.ok ? "pass" : `FAIL: ${r.failures.join("; ")}`} | ${r.ms} |`).join("\n")}\n`)
console.log(`eval: ${passed}/${results.length} passed (${out})`)
for (const r of results) if (!r.ok) console.log(`FAIL ${r.id}: ${r.failures.join("; ")}`)
process.exit(passed === results.length ? 0 : 1)
