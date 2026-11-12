// Writes skills/charts-cookbook/SKILL.md from the catalogue, so the cookbook the agent reads is exactly the set of
// examples the tests render. Usage: bun scripts/cookbook.ts (the test fails when the file is stale).
import { writeFileSync } from "node:fs"
import { CATALOGUE, exampleCall } from "../src/catalogue.ts"

export function cookbook(): string {
  const families = [...new Set(CATALOGUE.map(c => c.family))]
  const body = families.map(f => {
    const entries = CATALOGUE.filter(c => c.family === f).map(c => {
      const call = exampleCall(c)
      const spec = { ...call.spec } as Record<string, unknown>
      delete spec.$schema
      const rows = call.data?.rows
      const sample = rows ? `Row shape (${Math.min(2, rows.length)} of ${rows.length} rows): \`${JSON.stringify(rows.slice(0, 2))}\`\n\n` : ""
      const size = call.width !== undefined || call.height !== undefined ? `Tested at ${[call.width !== undefined ? `width ${call.width}` : "", call.height !== undefined ? `height ${call.height}` : ""].filter(Boolean).join(", ")}.\n\n` : ""
      return `### ${c.name} — \`${c.id}\` (${c.engine})\n\n${c.when}${c.avoid ? ` **Avoid:** ${c.avoid}` : ""}\n\n${sample}${size}\`\`\`json\n${JSON.stringify(spec)}\n\`\`\``
    })
    return `## ${f}\n\n${entries.join("\n\n")}`
  })
  return `---
name: charts-cookbook
description: Idiomatic, tested specs for every chart type the charts_* tools draw (Vega-Lite, Vega and ECharts), grouped by purpose, with when to use each. Read it before writing a spec by hand.
---

# Charts cookbook

Each spec below is a tested catalogue example (generated from the plugin's own catalogue). The rows shown are a shape example, the first two of the tested dataset, not the whole of it, and an example tested at a size says so. \`charts_catalogue {"id": "…"}\` returns the exact tested call: the spec with every row, the title, the currency and the size, ready to pass to \`charts_render\`. Colours written \`"theme:…"\` follow the active theme. Vega-Lite is the default engine; Vega is for layouts (treemap, sunburst, tree, force, word cloud); ECharts for flows and dashboard types (Sankey, chord, gauge, funnel, calendar, candlestick, radar, parallel).

${body.join("\n\n")}
`
}

if (import.meta.main) writeFileSync(new URL("../skills/charts-cookbook/SKILL.md", import.meta.url), cookbook())
