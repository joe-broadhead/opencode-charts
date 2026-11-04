// Writes skills/charts-cookbook/SKILL.md from the catalogue, so the cookbook the agent reads is exactly the set of
// examples the tests render. Usage: bun scripts/cookbook.ts (the test fails when the file is stale).
import { writeFileSync } from "node:fs"
import { CATALOGUE } from "../src/catalogue.ts"

export function cookbook(): string {
  const families = [...new Set(CATALOGUE.map(c => c.family))]
  const body = families.map(f => {
    const entries = CATALOGUE.filter(c => c.family === f).map(c => {
      const ex = c.example()
      const spec = { ...ex.spec } as Record<string, unknown>
      delete spec.$schema
      const sample = ex.rows ? `Rows like: \`${JSON.stringify(ex.rows.slice(0, 2))}\`\n\n` : ""
      return `### ${c.name} — \`${c.id}\` (${c.engine})\n\n${c.when}${c.avoid ? ` **Avoid:** ${c.avoid}` : ""}\n\n${sample}\`\`\`json\n${JSON.stringify(spec)}\n\`\`\``
    })
    return `## ${f}\n\n${entries.join("\n\n")}`
  })
  return `---
name: charts-cookbook
description: Idiomatic, tested specs for every chart type the charts_* tools draw (Vega-Lite, Vega and ECharts), grouped by purpose, with when to use each. Read it before writing a spec by hand.
---

# Charts cookbook

Each spec below renders as-is with \`charts_render\` and the rows shown passed as \`data.rows\` (generated from the plugin's own catalogue; \`charts_catalogue {"id": "…"}\` returns any of them with full data). Colours written \`"theme:…"\` follow the active theme. Vega-Lite is the default engine; Vega is for layouts (treemap, sunburst, tree, force, word cloud); ECharts for flows and dashboard types (Sankey, chord, gauge, funnel, calendar, candlestick, radar, parallel).

${body.join("\n\n")}
`
}

if (import.meta.main) writeFileSync(new URL("../skills/charts-cookbook/SKILL.md", import.meta.url), cookbook())
