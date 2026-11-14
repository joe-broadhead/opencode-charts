// Writes skills/charts-cookbook/SKILL.md from the catalogue and the recipe registry, and the generated recipe table in
// docs/documents.md, so what the agent and the reader see is exactly the set of examples the tests render.
// Usage: bun scripts/cookbook.ts (test/generated.test.ts fails when either file is stale).
import { readFileSync, writeFileSync } from "node:fs"
import { CATALOGUE, exampleCall } from "../src/catalogue.ts"
import { isRecipeId, recipeContract, RECIPE_IDS } from "../src/recipes/registry.ts"
import { recipeExamples } from "../src/recipes/examples.ts"

const requirement = (r: string) => (r === "always" ? "required" : r === "optional" ? "optional" : "required unless `aggregate` is `count`")

/**
 * Keeps inline array literals in displayed specs small enough to read as a shape example while `charts_catalogue`
 * returns the full tested call verbatim. Precomputed polygon/grid arrays stay at 2 items so no line exceeds ~2 KB.
 */
function trimSpecForDisplay(value: unknown, key?: string): unknown {
  if (typeof value === "number" && !Number.isInteger(value)) return Number(value.toPrecision(8))
  if (Array.isArray(value)) {
    const cap = key === "grid" || key === "xAxis" || key === "yAxis" || key === "series" || key === "marks" ? 4 : 6
    const sliced = value.length > cap ? value.slice(0, key === "marks" || key === "series" ? 3 : 2) : value
    return sliced.map(item => trimSpecForDisplay(item))
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = trimSpecForDisplay(v, k)
    return out
  }
  return value
}

/** Turn-key `plotRecipe` calls for the Plot types whose catalogue example expands geometry in advance. */
const PLOT_RECIPE_HINTS: Readonly<Record<string, Record<string, unknown>>> = {
  cartogram_us_hex: { plotRecipe: "cartogram_us_hex", bindings: { state: "postal", value: "broadband_pct" }, options: { title: "Adults with home broadband, by state" } },
  cartogram_eu_tile: { plotRecipe: "cartogram_eu_tile", bindings: { country: "iso3", value: "index_points" }, options: { title: "Digital index, by country" } },
  flow_map: { plotRecipe: "flow_map", bindings: { originLat: "originLat", originLon: "originLon", destLat: "destLat", destLon: "destLon", value: "value", label: "label" }, options: { title: "Where travellers fly", labels: true } },
  beeswarm: { plotRecipe: "beeswarm", bindings: { x: "group", y: "latency_ms" }, options: { title: "Response times by service", xLabel: "Service", yLabel: "Latency (ms)" } },
  waffle: { plotRecipe: "waffle", bindings: { category: "category", value: "value" }, options: { title: "Sales mix, by unit sold" } },
  ridgeline: { plotRecipe: "ridgeline", bindings: { x: "latency_ms", group: "group" }, options: { title: "Latency distribution by service" } },
  horizon: { plotRecipe: "horizon", bindings: { x: "day", y: "page_views" }, options: { bands: 4, title: "Page views, folded into four bands" } },
}

/** Complete, schema-checked `BoardDocumentV1` example included at the end of the cookbook. */
export const BOARD_COOKBOOK_EXAMPLE = {
  board: {
    version: 1,
    kicker: "Quarterly review",
    title: "Regional revenue and conversion",
    subtitle: "Filter by quarter; KPIs, chart and table update together offline",
    source: "Source: finance close",
    datasets: {
      sales: {
        rows: [
          { region: "North", quarter: "Q1", month: "2026-01", revenue: 510, conversion: 0.12 },
          { region: "South", quarter: "Q1", month: "2026-01", revenue: 390, conversion: 0.09 },
        ],
      },
    },
    filters: [
      { id: "quarter", label: "Quarter", dataset: "sales", field: "quarter", control: "segmented" },
    ],
    kpis: [
      { id: "rev", label: "Total revenue", dataset: "sales", field: "revenue", aggregate: "sum", format: "currency", delta: { value: 0.14, label: "vs prior quarter" }, sparkline: { x: "month", y: "revenue", aggregate: "sum" } },
      { id: "conv", label: "Mean conversion", dataset: "sales", field: "conversion", aggregate: "mean", format: "percent", decimals: 1 },
    ],
    panels: [
      { id: "by_region", title: "Revenue by region", dataset: "sales", span: 6, chart: { quick: { type: "bar", x: "region", y: "revenue", aggregate: "sum", sort: true } } },
      { id: "detail", title: "Regional detail", dataset: "sales", span: 6, chart: { kind: "table", columns: [{ field: "region", label: "Region" }, { field: "quarter", label: "Quarter" }, { field: "revenue", label: "Revenue", format: "currency", align: "right" }], limit: 20 } },
    ],
  },
  currency: "EUR",
  name: "regional-review",
} as const

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

Pass \`{"document": …}\` to \`charts_quick\`. Unknown fields fail with their JSON path; repeated groups need \`options.aggregate\` (default \`none\` refuses with \`AGGREGATION_REQUIRED\`); \`count\` counts rows and takes no measure. The result names the saved \`<name>.chart.json\` and its \`revision\`: change its theme, size, title or interactions with \`charts_update\` (\`{"documentPath": "…", "expectedRevision": "sha256:…", "patch": {…}}\`), never by editing the spec or redrawing from CSV.

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
      if (isRecipeId(c.id)) {
        return `### ${c.name} — \`${c.id}\` (${c.engine}, recipe)\n\n${c.when}${c.avoid ? ` **Avoid:** ${c.avoid}` : ""}\n\nPrefer the typed \`${c.id}\` recipe document above via \`charts_quick {"document": …}\`; call \`charts_catalogue {"id": "${c.id}"}\` when you need the raw Vega-Lite spec.`
      }
      const call = exampleCall(c)
      const rawSpec = { ...call.spec } as Record<string, unknown>
      delete rawSpec.$schema
      const rows = call.data?.rows
      const sampleRows = rows ? (trimSpecForDisplay(rows.slice(0, 2)) as Record<string, unknown>[]) : undefined

      if (c.engine === "table") {
        const tableCall = { data: { rows: sampleRows ?? [] }, ...rawSpec, formats: ["svg", "png", "html"] }
        return `### ${c.name} — \`${c.id}\` (\`charts_table\`)\n\n${c.when}${c.avoid ? ` **Avoid:** ${c.avoid}` : ""}\n\nPass directly to \`charts_table\` (rows shown: ${sampleRows?.length ?? 0} of ${rows?.length ?? 0}; \`charts_catalogue {"id": "${c.id}"}\` has every row):\n\n\`\`\`json\n${JSON.stringify(tableCall)}\n\`\`\``
      }
      if (c.engine === "diagram") {
        return `### ${c.name} — \`${c.id}\` (\`charts_diagram\`)\n\n${c.when}${c.avoid ? ` **Avoid:** ${c.avoid}` : ""}\n\nPass directly to \`charts_diagram\` (returns SVG, PNG and Unicode \`ascii\`):\n\n\`\`\`json\n${JSON.stringify(rawSpec)}\n\`\`\``
      }

      const recipeHint = PLOT_RECIPE_HINTS[c.id]
      const shownSpec = recipeHint ?? trimSpecForDisplay(rawSpec)
      const sample = sampleRows ? `Row shape (${sampleRows.length} of ${rows!.length} rows): \`${JSON.stringify(sampleRows)}\`\n\n` : ""
      const size = call.width !== undefined || call.height !== undefined ? `Tested at ${[call.width !== undefined ? `width ${call.width}` : "", call.height !== undefined ? `height ${call.height}` : ""].filter(Boolean).join(", ")}. ` : ""
      const note = recipeHint ? `Compact \`plotRecipe\` form for \`charts_render {"spec": …, "data": {"rows": …}}\` (\`charts_catalogue {"id": "${c.id}"}\` also returns the expanded mark geometry).\n\n` : size ? `${size}\`charts_catalogue {"id": "${c.id}"}\` returns the full tested call.\n\n` : ""
      return `### ${c.name} — \`${c.id}\` (${c.engine})\n\n${c.when}${c.avoid ? ` **Avoid:** ${c.avoid}` : ""}\n\n${sample}${note}\`\`\`json\n${JSON.stringify(shownSpec)}\n\`\`\``
    })
    return `## ${f}\n\n${entries.join("\n\n")}`
  })
  const boardSection = `## dashboards (\`charts_board\`)

Multi-panel cross-filtered dashboards use \`charts_board\` with a \`BoardDocumentV1\` (\`version: 1\`, \`title\`, \`datasets\`, optional \`filters\`/\`kpis\`/\`tabs\`, and \`panels\`). Always writes four files: \`<name>.svg\`, \`<name>.png\` (2x poster), \`<name>.board.html\` (self-contained UI SDK cross-filtering page), and \`<name>.board.json\`.

\`\`\`json
${JSON.stringify(BOARD_COOKBOOK_EXAMPLE)}
\`\`\``

  return `---
name: charts-cookbook
description: Idiomatic, tested examples for every chart, table, diagram and dashboard the charts_* tools draw - typed recipe documents for the 14 standard types, specs and native calls for the other 65 catalogue types across Vega-Lite, Vega, ECharts, Observable Plot, tables and diagrams, plus a BoardDocumentV1 dashboard - grouped by purpose, with when to use each. Read before writing a chart document, board or spec by hand.
---

# Charts cookbook

Generated from the plugin's own catalogue and recipe registry. For the 14 standard types, use a typed recipe document through \`charts_quick {"document": …}\` (first section). Tables use \`charts_table\`, diagrams use \`charts_diagram\`, multi-panel dashboards use \`charts_board\` (last section), and the remaining catalogue types use \`charts_render {"spec": …, "data": …}\`. Rows shown are a two-row shape example; \`charts_catalogue {"id": "…"}\` returns the full tested call with every row. Colours written \`"theme:…"\` (\`"theme:positive"\`, \`"theme:categorical.0"\`) follow the active theme.

${recipeSection()}

${body.join("\n\n")}

${boardSection}
`
}

if (import.meta.main) {
  writeFileSync(new URL("../skills/charts-cookbook/SKILL.md", import.meta.url), cookbook())
  const docs = new URL("../docs/documents.md", import.meta.url)
  writeFileSync(docs, documentsDoc(readFileSync(docs, "utf8")))
}
