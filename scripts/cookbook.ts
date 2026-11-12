// Writes skills/charts-cookbook/SKILL.md from the catalogue and the recipe registry, and the generated recipe table in
// docs/documents.md, so what the agent and the reader see is exactly the set of examples the tests render.
// Usage: bun scripts/cookbook.ts (test/generated.test.ts fails when either file is stale).
import { readFileSync, writeFileSync } from "node:fs"
import { CATALOGUE, exampleCall } from "../src/catalogue.ts"
import { recipeContract, RECIPE_IDS } from "../src/recipes/registry.ts"
import { recipeExamples } from "../src/recipes/examples.ts"

const requirement = (r: string) => (r === "always" ? "required" : r === "optional" ? "optional" : "required unless `aggregate` is `count`")

/** The recipe section of the cookbook: each recipe's contract and one example document, with a shape-example row pair. */
export function recipeSection(): string {
  const entries = RECIPE_IDS.map(id => {
    const c = recipeContract(id)
    const example = recipeExamples(id)[0]!
    const doc = example.document as { chart: { data: { rows: unknown[] } } }
    const all = doc.chart.data.rows
    const shown = { ...doc, chart: { ...doc.chart, data: { rows: all.slice(0, 2) } } }
    const options = Object.entries(c.options).map(([k, v]) => {
      const o = v as { values?: readonly string[]; default?: unknown; min?: number; max?: number; required?: boolean; maxLength?: number }
      if (o.values) return `\`${k}\` ${o.values.map(x => `\`${x}\``).join(" / ")}${o.required ? " (required)" : ""}${o.default !== undefined ? ` (default ${o.default})` : ""}`
      if (o.min !== undefined) return `\`${k}\` ${o.min}–${o.max} (default ${o.default})`
      return `\`${k}\``
    })
    const presets = Object.entries(c.interactions).filter(([k, v]) => k !== "tooltip" && v.length > 1).map(([k, v]) => `${k} ${v.slice(1).join(", ")}`)
    return `### ${c.name} — recipe \`${c.id}\`

${c.summary} ${c.dataRequirements}

- Bindings: ${c.bindings.map(b => `\`${b.role}\` (${requirement(b.required)})`).join(", ")}.
- Options: ${options.length ? options.join("; ") : "none"}.
- Interactions beyond the defaults: ${presets.length ? presets.join("; ") : "none (tooltip auto or off only)"}.

Rows shown: ${shown.chart.data.rows.length} of ${all.length}, a shape example. \`charts_catalogue {"id": "${id}"}\` returns this document with every row, as \`recipe.examples[0].call\`.

\`\`\`json
${JSON.stringify(shown)}
\`\`\``
  })
  return `## Typed recipe documents (recommended for the 14 standard types)

Pass \`{"document": …}\` to \`charts_quick\`. Unknown fields fail with their JSON path; repeated groups need \`options.aggregate\` (default \`none\` refuses with \`AGGREGATION_REQUIRED\`); \`count\` counts rows and takes no measure. The result names the saved \`<name>.chart.json\` and its \`revision\`: change its theme, size or interactions with \`charts_update\`, never by editing the spec.

${entries.join("\n\n")}`
}

/** The recipe table of docs/documents.md, between its generated markers. */
export function recipeTable(): string {
  const rows = RECIPE_IDS.map(id => {
    const c = recipeContract(id)
    const agg = (c.options as { aggregate?: { values: readonly string[] } }).aggregate
    const presets = Object.entries(c.interactions).filter(([k, v]) => k !== "tooltip" && v.length > 1).map(([k, v]) => `${k}: ${v.slice(1).join(", ")}`)
    return `| \`${id}\` | ${c.bindings.map(b => `${b.role}${b.required === "always" ? "" : b.required === "optional" ? "?" : "*"}`).join(", ")} | ${agg ? agg.values.join(", ") : "refused"} | ${c.groupBy.length ? c.groupBy.join(" + ") : "none (one mark per row)"} | ${c.colorDomain ?? "none"} | ${presets.length ? presets.join("; ") : "tooltip only"} |`
  })
  return ["| Recipe | Bindings | Aggregate | One mark per | Colour domain | Interaction presets |", "| --- | --- | --- | --- | --- | --- |", ...rows].join("\n")
}

export const TABLE_START = "<!-- generated:recipes -->"
export const TABLE_END = "<!-- /generated:recipes -->"

/** docs/documents.md with its recipe table regenerated. */
export function documentsDoc(current: string): string {
  const start = current.indexOf(TABLE_START), end = current.indexOf(TABLE_END)
  if (start < 0 || end < start) throw new Error("docs/documents.md has no generated recipe table markers")
  return `${current.slice(0, start + TABLE_START.length)}\n${recipeTable()}\n${current.slice(end)}`
}

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
description: Idiomatic, tested examples for every chart type the charts_* tools draw - typed recipe documents for the 14 standard types, and Vega-Lite, Vega and ECharts specs for the rest - grouped by purpose, with when to use each. Read it before writing a chart document or a spec by hand.
---

# Charts cookbook

Generated from the plugin's own catalogue and recipe registry. For the 14 standard types, the recommended path is a typed recipe document through \`charts_quick\` (first section). Every other type, and anything a recipe cannot express, is a raw spec through \`charts_render\`: the advanced path (the sections after it). Each raw spec below is a tested catalogue example. The rows shown are a shape example, the first two of the tested dataset, not the whole of it, and an example tested at a size says so. \`charts_catalogue {"id": "…"}\` returns the exact tested call: the spec with every row, the title, the currency and the size, ready to pass to \`charts_render\`. Colours written \`"theme:…"\` follow the active theme. Vega-Lite is the default engine; Vega is for layouts (treemap, sunburst, tree, force, word cloud); ECharts for flows and dashboard types (Sankey, chord, gauge, funnel, calendar, candlestick, radar, parallel).

${recipeSection()}

${body.join("\n\n")}
`
}

if (import.meta.main) {
  writeFileSync(new URL("../skills/charts-cookbook/SKILL.md", import.meta.url), cookbook())
  const docs = new URL("../docs/documents.md", import.meta.url)
  writeFileSync(docs, documentsDoc(readFileSync(docs, "utf8")))
}
