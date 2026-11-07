/**
 * Runs the `charts_recommend` eval and applies its gates.
 *
 *   bun eval/recommend.ts [out-dir]                  grade against eval/baseline.json
 *   bun eval/recommend.ts [out-dir] --update-baseline  rewrite the baseline after a reviewed change
 *
 * The gates, from the eval design (`~/opencode-release/evals-lab/EVALS-DESIGN.md`) and MCP Clearsight's ranking gates:
 *
 *   - zero must-not violations;
 *   - top-3 recall at least 0.90 over the cases that name a must;
 *   - top-1 accuracy at least the committed baseline, and no case that passed in the baseline failing now;
 *   - paraphrase stability at least 0.95: the same question, said differently, ranks the same top three.
 *
 * The baseline carries the catalogue and scoring versions, so a change to either is a visible event with an eval diff.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { CATALOGUE } from "../src/catalogue.ts"
import { recommend } from "../src/recommend/rank.ts"
import { SCORING } from "../src/recommend/traits.ts"
import { CASES, DATASETS, PARAPHRASE_PAIRS } from "./recommend.cases.ts"

const args = process.argv.slice(2)
const out = resolve(args.find(a => !a.startsWith("--")) ?? join(tmpdir(), "charts-recommend-eval"))
const updateBaseline = args.includes("--update-baseline")
const env = { workspace: { directory: out } }
const BASELINE = join(import.meta.dir, "baseline.json")

mkdirSync(out, { recursive: true })

interface Result {
  readonly id: string
  readonly request: string
  readonly ok: boolean
  readonly top1: string | null
  readonly top3: readonly string[]
  readonly violations: readonly string[]
  readonly missing: readonly string[]
  readonly top1ok: boolean | null
  readonly abstained: boolean
}

const results: Result[] = []
for (const c of CASES) {
  const rows = DATASETS[c.dataset]
  if (!rows) throw new Error(`no dataset ${c.dataset} for ${c.id}`)
  const { result } = await recommend({ request: c.request, data: { rows }, ...(c.medium ? { medium: c.medium } : {}), limit: 5 }, env as never)
  const ids = result.recommendations.map(r => r.id)
  const top3 = ids.slice(0, 3)
  const violations = (c.mustNot ?? []).filter(id => ids.includes(id))
  // `must` is "at least one of these": a case lists the acceptable chart types for its question.
  const missing = c.must.length && !c.must.some(id => ids.includes(id)) ? [...c.must] : []
  const top1ok = c.top1 === undefined ? null : ids[0] === c.top1
  results.push({ id: c.id, request: c.request, ok: violations.length === 0 && missing.length === 0 && top1ok !== false, top1: ids[0] ?? null, top3, violations, missing, top1ok, abstained: result.abstain !== undefined })
}

const graded = results.filter(r => r.top3.length > 0 || !r.abstained)
const recalled = graded.filter(r => r.missing.length === 0).length
const top3Recall = graded.length ? recalled / graded.length : 1
const withTop1 = results.filter(r => r.top1ok !== null)
const top1Accuracy = withTop1.length ? withTop1.filter(r => r.top1ok).length / withTop1.length : 1
const violations = results.reduce((sum, r) => sum + r.violations.length, 0)

// Paraphrase stability: the same question, said differently, gives the same top three.
let stable = 0
const unstable: string[] = []
for (const pair of PARAPHRASE_PAIRS) {
  const c = CASES.find(entry => entry.id === pair.id)!
  const rows = DATASETS[c.dataset]
  const first = await recommend({ request: pair.a, data: { rows }, ...(c.medium ? { medium: c.medium } : {}), limit: 5 }, env as never)
  const second = await recommend({ request: pair.b, data: { rows }, ...(c.medium ? { medium: c.medium } : {}), limit: 5 }, env as never)
  const a = first.result.recommendations.slice(0, 3).map(r => r.id).join(",")
  const b = second.result.recommendations.slice(0, 3).map(r => r.id).join(",")
  if (a === b) stable++
  else unstable.push(`${pair.id}: "${pair.a}" → ${a}; "${pair.b}" → ${b}`)
}
const paraphraseStability = PARAPHRASE_PAIRS.length ? stable / PARAPHRASE_PAIRS.length : 1

const versions = { catalogueVersion: String(CATALOGUE.length), scoringVersion: SCORING.version }
const previous = existsSync(BASELINE) ? JSON.parse(readFileSync(BASELINE, "utf8")) as { versions: typeof versions; perCase: Record<string, boolean>; top1Accuracy: number } : undefined

const gates: { gate: string; value: string; target: string; pass: boolean }[] = [
  { gate: "must-not violations", value: String(violations), target: "0", pass: violations === 0 },
  { gate: "top-3 recall", value: top3Recall.toFixed(3), target: ">= 0.90", pass: top3Recall >= 0.9 },
  { gate: "paraphrase stability", value: paraphraseStability.toFixed(3), target: ">= 0.95", pass: paraphraseStability >= 0.95 },
  { gate: "top-1 accuracy", value: top1Accuracy.toFixed(3), target: `>= ${previous?.top1Accuracy ?? top1Accuracy} (baseline)`, pass: previous ? top1Accuracy >= previous.top1Accuracy : true },
  { gate: "baseline regressions", value: String(previous ? results.filter(r => previous.perCase[r.id] === true && !r.ok).length : 0), target: "0", pass: previous ? results.every(r => previous.perCase[r.id] !== true || r.ok) : true },
  { gate: "versions", value: `${versions.catalogueVersion}/${versions.scoringVersion}`, target: previous ? `${previous.versions.catalogueVersion}/${previous.versions.scoringVersion}` : "any (no baseline)", pass: true },
]

const passed = gates.filter(g => g.pass).length
writeFileSync(join(out, "report.json"), JSON.stringify({ versions, gates, results }, null, 1))
writeFileSync(join(out, "report.md"), [
  `# Recommend eval: ${passed}/${gates.length} gates pass`,
  "",
  "| Gate | Value | Target | Result |",
  "|---|---|---|---|",
  ...gates.map(g => `| ${g.gate} | ${g.value} | ${g.target} | ${g.pass ? "pass" : "FAIL"} |`),
  "",
  "| Case | Request | Top 3 | Result |",
  "|---|---|---|---|",
  ...results.map(r => `| ${r.id} | ${r.request} | ${r.top3.join(", ") || "—"} | ${r.ok ? "pass" : `FAIL: ${[...r.violations.map(v => `must not ${v}`), ...r.missing.map(m => `missing ${m}`), ...(r.top1ok === false ? [`top 1 is ${r.top1}`] : [])].join("; ")}`} |`),
  ...(unstable.length ? ["", "## Paraphrase instability", "", ...unstable.map(line => `- ${line}`)] : []),
].join("\n") + "\n")

if (updateBaseline) {
  writeFileSync(BASELINE, JSON.stringify({ measured: "see docs/status.md", versions, top1Accuracy: Number(top1Accuracy.toFixed(3)), gates: Object.fromEntries(gates.map(g => [g.gate, g.value])), perCase: Object.fromEntries(results.map(r => [r.id, r.ok])) }, null, 1) + "\n")
  console.log(`baseline written: ${BASELINE}`)
}

console.log(`recommend eval: ${passed}/${gates.length} gates (${out})`)
for (const g of gates) console.log(`  ${g.pass ? "pass" : "FAIL"} ${g.gate}: ${g.value} (${g.target})`)
for (const r of results) if (!r.ok) console.log(`  FAIL ${r.id}: ${[...r.violations.map(v => `must not ${v}`), ...r.missing.map(m => `missing ${m}`), ...(r.top1ok === false ? [`top 1 is ${r.top1}`] : [])].join("; ")} (top 3: ${r.top3.join(", ")})`)
process.exit(passed === gates.length ? 0 : 1)
