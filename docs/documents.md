# Chart documents

A chart document is the editable source of a chart: what it draws (a typed recipe, or a raw engine spec), its data,
and how it is presented (theme, layout, interactions). `tools.charts.quick` and `tools.charts.render` take one as
`document`, save it as `<name>.chart.json`, and `tools.charts.update` changes its presentation into a new, immutable
generation. The resolved engine spec (`.vl.json`, `.vg.json`, `.echarts.json`) is a derived export, never the source of
a revision.

The raw interfaces (`tools.charts.render` with `spec`, `tools.charts.quick` with `type` and field names) remain for
calls that do not need a saved document.

## The workflow

1. **Pick a recipe** if you are unsure: `tools.charts.recommend` returns a `document` draft on your own columns for the
   types that are recipes, and `tools.charts.catalogue` with an id returns each recipe's contract and its examples as
   exact `tools.charts.quick` calls.
2. **Create**: `tools.charts.quick` with `document`. The document is checked strictly; every problem has a JSON path. A
   valid call draws, so a separate `tools.charts.validate` first is optional: use it to preflight or repair.
3. **Inspect** the result: `diagnostics`, the figure tree, `size` (requested and actual) and `interactions` (requested,
   resolved, and what each format carries). The result names the written PNG, which the host's file tool can show.
4. **Change the presentation** with `tools.charts.update` (`documentPath`, `expectedRevision`, `patch`). A change of
   data, bindings, aggregation or sorting is a new document.

## ChartDocumentV1

```ts
type ChartDocumentV1 = {
  version: 1
  chart:
    | { kind: "recipe"; recipe: RecipeId; data: DataInput; bindings: Record<string, string>; options?: Record<string, unknown> }
    | { kind: "engine"; engine?: "vega-lite" | "vega" | "echarts"; spec: object; data?: DataInput }
  title?: string
  description?: string // alt text
  locale?: string
  currency?: string
  seed?: number
  appearance?: { theme?: string; overrides?: Record<string, unknown>; categoryColors?: { value: string | number | boolean | null; color: string }[] }
  layout?: { target?: "inline" | "analysis" | "report" | "presentation" | "paper"; mode?: "fixed" | "responsive"; width?: number; height?: number } | { mode: "native" }
  interactions?: { tooltip?: "auto" | "off"; legend?: "static" | "highlight"; zoom?: "none" | "x"; brush?: "none" | "interval" }
}
```

`data` holds exactly one of `rows` or `path` (a workspace `.csv`, `.tsv`, `.json`, `.jsonl` or `.parquet` file), with
an optional `format` and Vega-Lite `transform` list. Bindings name fields after the transform. An unknown property fails
with its path (`DOCUMENT_INVALID`); a version other than 1 is `DOCUMENT_VERSION_UNSUPPORTED`.

`motion` and `fps` are call-level delivery inputs, alongside `formats`, `scales`, `name`, `outDir`, `inspect` and
`svgText`, so a document call can also emit a CSS-animated `.svg` or `.gif` without changing its saved `.chart.json`.

A recommended call:

```json
{
  "document": {
    "version": 1,
    "chart": {
      "kind": "recipe",
      "recipe": "line",
      "data": { "path": "data/revenue.csv" },
      "bindings": { "x": "month", "y": "revenue_eur", "series": "region" },
      "options": { "xType": "temporal", "aggregate": "sum", "yTitle": "Revenue (€)" }
    },
    "title": "Revenue by month and region",
    "currency": "EUR",
    "appearance": { "theme": "dark" },
    "layout": { "target": "inline", "mode": "responsive", "width": 720, "height": 420 },
    "interactions": { "tooltip": "auto", "legend": "highlight", "zoom": "x", "brush": "none" }
  },
  "name": "revenue-by-region",
  "formats": ["document", "svg", "png", "spec", "html"]
}
```

## Recipes

The 14 recipes are the quick-chart families, each a typed contract. The table is generated from the recipe registry
(`bun scripts/cookbook.ts`); `?` marks an optional binding and `*` one required unless `options.aggregate` is `count`.

<!-- generated:recipes -->
| Recipe | Bindings | Aggregate | One mark per | Colour domain | Interaction presets |
| --- | --- | --- | --- | --- | --- |
| `bar` | category, value* | none, sum, mean, median, min, max, count | category | none | tooltip only |
| `horizontal_bar` | category, value* | none, sum, mean, median, min, max, count | category | none | tooltip only |
| `grouped_bar` | category, series, value* | none, sum, mean, median, min, max, count | category + series | series | legend: highlight (needs a series binding) |
| `stacked_bar` | category, series, value* | none, sum, mean, median, min, max, count | category + series | series | legend: highlight (needs a series binding) |
| `line` | x, y*, series? | none, sum, mean, median, min, max, count | x + series | series | legend: highlight (needs a series binding); zoom: x (temporal x only) |
| `area` | x, y*, series? | none, sum, mean, median, min, max, count | x + series | series | legend: highlight (needs a series binding); zoom: x (temporal x only) |
| `stacked_area` | x, y*, series | none, sum, mean, median, min, max, count | x + series | series | legend: highlight (needs a series binding) |
| `scatter` | x, y, series? | refused | none (one mark per row) | series | legend: highlight (needs a series binding); brush: interval |
| `bubble` | x, y, size, series? | refused | none (one mark per row) | series | legend: highlight (needs a series binding); brush: interval |
| `pie` | category, value* | none, sum, count | category | category | tooltip only |
| `donut` | category, value* | none, sum, count | category | category | tooltip only |
| `histogram` | value | refused | none (one mark per row) | none | tooltip only |
| `box_plot` | category, value | refused | none (one mark per row) | none | tooltip only |
| `heatmap` | column, row, value* | none, sum, mean, median, min, max, count | column + row | none | tooltip only |
<!-- /generated:recipes -->

- **Aggregation is explicit.** The default is `none`: several rows for one mark is `AGGREGATION_REQUIRED`, never a
  silent sum. `count` counts the rows of a group after `data.transform`.
- **Sorting** is `input`, the category orders or the value orders; line and area take `xSort`, heatmaps take `rowSort`
  and `columnSort`, histograms take `bins`.
- **Missing positions** are `POSITION_MISSING`, never read as zero or today.

## Layout

For a recipe, `width` and `height` are the outer logical pixels: title, axes, legend and padding included. A fixed SVG
is exactly that size; a PNG is that size times its scale. `target` picks a profile; explicit fields override it:

| Target | Mode | Outer size | Smallest label |
| --- | --- | --- | --- |
| `inline` (default) | responsive | 720 × 420 | 11 px |
| `analysis` | fixed | 900 × 540 | 11 px |
| `report` | fixed | 900 × 540 | 11 px |
| `presentation` | fixed | 1280 × 720 | 18 px |
| `paper` | fixed | 1000 × 650 | 11 px |

The layout planner tries three candidates in a fixed order and records each adjustment. It never filters categories,
samples rows, changes the aggregation or shrinks text below the floor. When nothing fits, the call fails with
`LAYOUT_UNSATISFIABLE` and writes nothing.

An engine document keeps its native layout: `layout` is omitted or `{"mode": "native"}`.

## Appearance

`appearance.theme` names a built-in or saved theme (default: the plugin's configured theme). `overrides` is a strict,
typed deep-partial of the theme tokens; arrays replace whole. A recipe with a series has a stable colour domain over
the full transformed data, independent of the display sort; `categoryColors` pins a colour, and an entry for a category
the data does not have is `CATEGORY_COLOR_UNUSED`. `"theme:positive"`-style semantic tokens resolve from the current
theme on every compile.

## Interactions

| Preset | Recipes | What it does in the HTML page |
| --- | --- | --- |
| `tooltip: "auto"` (default) | all | Hover shows the values a mark draws; the same values are in a keyboard-reachable data table. |
| `legend: "highlight"` | grouped and stacked bars, line, area, stacked area, scatter, bubble | Choosing a series emphasises it; every mark and scale stays. |
| `zoom: "x"` | line and area with temporal x | Wheel zooms and drag pans x; y keeps its domain. |
| `brush: "interval"` | scatter, bubble | Drag a rectangle to emphasise the marks inside. |

An unsupported combination is `INTERACTION_UNSUPPORTED` with the allowed alternatives. SVG and PNG are static pictures
of the initial view. A result never says an interaction was verified in a browser: the interactions are tested in the
plugin's browser suite, not at render time.

## The saved artifact

`<name>.chart.json` is an envelope with `format: "charts-artifact"` and `version: 1`, holding the canonical
document with captured rows (and the path, format and content hash in provenance), the captured theme base, the custom
fonts by content digest, the captured defaults, the compiler and renderer versions, and the `revision`.

`tools.charts.render` with `documentPath` and `expectedRevision` draws a saved artifact again from what it captured, even
if the plugin's defaults or the saved theme have changed since. A changed custom font is `DOCUMENT_DEPENDENCY_CHANGED`; a
stale or edited revision is `DOCUMENT_REVISION_MISMATCH`, raised before anything is drawn.
