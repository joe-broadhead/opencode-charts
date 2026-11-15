---
name: charts
description: Make clear, truthful, publication-grade charts, data tables, diagrams, animated GIFs and interactive dashboards with the charts_* tools (12 tools; 79 tested types across Vega-Lite, Vega, ECharts, Observable Plot, tables and offline Mermaid/structured diagrams), revise saved charts without changing their data, and know when to use code on the machine instead. Use for any chart, graph, plot, map, cartogram, KPI table, diagram or dashboard of data. Not for photo/image editing, 3-D scientific rendering (use Python), slide-deck layout, or reading values out of a raster image.
---

# Charts

Tool names: `charts_quick`, `charts_render`, `charts_update`, `charts_validate`, `charts_board`, `charts_table`, `charts_diagram`, `charts_recommend`, `charts_capabilities`, `charts_catalogue`, `charts_themes`, `charts_theme_save` (in Code Mode: `tools.charts.<name>(…)` — use `search({ namespace: "charts" })` for signatures).

## Which way to draw

| Use the charts_* tools when | Use code on the machine (Python: matplotlib, seaborn, plotly) when |
|---|---|
| Standard or specialised charts, maps/cartograms, KPI tables, Mermaid/mindmap/fishbone diagrams, GIFs or multi-panel dashboards (79 types in `charts_catalogue`, plus `charts_board`). | Bespoke statistical model diagnostics, 3-D scientific projections, or custom raster overlays outside the six engines. |
| It must match a theme or brand, look identical every time, or be revised later without touching data. | The data needs heavy multi-GB computation first and the plot is a quick internal by-product of that script. |
| You want strict validation: field names with did-you-mean, explicit aggregation, misleading axes, overlapping/clipped labels, WCAG contrast and exact canvas size. | — |

## Choosing the right tool

1. **Standard single chart (`charts_quick` with `document`):** Always use `charts_quick {"document": …}` (never a raw `charts_render` spec) whenever one of the 14 recipe types fits (`bar`, `horizontal_bar`, `grouped_bar`, `stacked_bar`, `line`, `area`, `stacked_area`, `scatter`, `bubble`, `pie`, `donut`, `histogram`, `box_plot`, `heatmap`). Saves an editable `<name>.chart.json` in `<outDir>/<name>-<digest>/`; revise presentation later with `charts_update`. Omit `data.transform` when the dataset already covers the rows needed.
2. **Revise a saved chart (`charts_update`):** Change theme, overrides, category colours, layout target/size, title, description or interactions on an existing `<name>.chart.json` without re-reading or altering its captured data.
3. **Publication data-graphic table (`charts_table`):** Columns with inline marks (`text`, `bar`, `sparkline`, `sparkarea`, `sparkbar`, `bullet`, `delta`, `badge`, `heatmap`, `dot`), `spanner`, `rowGroupField`, `summaryRow` (`sum`, `mean`, `median`, `min`, `max` — no `count`), `zebra`, and optional sortable/copyable HTML (`formats: ["svg", "png", "html"]`).
4. **Offline diagram (`charts_diagram`):** Pass **either** `dsl` (Mermaid `flowchart`/`graph`, `sequenceDiagram`, `stateDiagram-v2`, `classDiagram`, `erDiagram` — other Mermaid types like `gantt` or `pie` are refused) **or** `kind` (`mindmap`, `org_chart`, `fishbone` with `effect` + `categories: [{category, causes: [...]}]`, `architecture`), never both. Returns `.svg`, `.png` and terminal `ascii`. A Mermaid diagram (dsl or `architecture`) may have at most 150 nodes and 200 edges (`SPEC_TOO_EXPENSIVE` past that: split it); node `color` is `#hex`, `rgb()`, a CSS colour name or `theme:<token>`.
5. **Multi-panel dashboard (`charts_board`):** Pass a `BoardDocumentV1` (`version: 1`, `title`, `datasets`, optional `filters`/`kpis`/`tabs`, and `panels`) to write `<name>.svg`, `<name>.png` (2x poster), `<name>.board.html` (offline UI SDK cross-filtering app with `window.chartsAgent`), and `<name>.board.json`.
6. **Any other catalogue chart (`charts_render`):** Raw `spec` + `data` across `vega-lite`, `vega`, `echarts` (Sankey, chord, gauge, funnel, calendar, candlestick, radar, parallel, violin, `matrix` sparklines, `timeline` stories), and `plot` (`{"marks": [...]}` or `{"plotRecipe": "hexbin"|"contour"|"beeswarm"|"bollinger"|"difference_area"|"waffle"|"voronoi"|"ridgeline"|"horizon"|"cartogram_us_hex"|"cartogram_eu_tile"|"flow_map", "bindings": {...}}`). Start from `charts_catalogue {"id": "…"}` or ask `charts_recommend` with the question and data. `charts_render` and `charts_validate` also accept `document` or `documentPath` (one arm per call — mixing `spec`/`type` or authoring fields with `document` or `documentPath` fails with `INPUT_CONFLICT`).

## Workflow: create, inspect, revise

1. **Create with a typed document (`charts_quick`):**
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
       "title": "Revenue doubled in the North",
       "currency": "EUR",
       "appearance": { "theme": "light" },
       "layout": { "target": "inline" },
       "interactions": { "tooltip": "auto", "legend": "highlight", "zoom": "x", "brush": "none" }
     },
     "name": "revenue"
   }
   ```
   `charts_validate` takes the exact same input without writing files when you want a dry run.
   - **Exact recipe `bindings` roles** (`title`, `description`, `currency`, `locale`, `appearance`, `layout`, `interactions` sit at the top level of `document`, never inside `document.chart`):
     - `bar`, `horizontal_bar`, `pie`, `donut`: `{"category": "col", "value": "num"}` (omit `value` when `options.aggregate` is `"count"`).
     - `grouped_bar`, `stacked_bar`: `{"category": "col", "series": "grp", "value": "num"}` (omit `value` for `"count"`).
     - `line`, `area`: `{"x": "col", "y": "num", "series"?: "grp"}`; `stacked_area`: `{"x": "col", "y": "num", "series": "grp"}`.
     - `scatter`: `{"x": "num1", "y": "num2", "series"?: "grp"}`; `bubble`: `{"x": "num1", "y": "num2", "size": "num3", "series"?: "grp"}`.
     - `histogram`: `{"value": "num"}`; `box_plot`: `{"category": "col", "value": "num"}`; `heatmap`: `{"column": "colX", "row": "colY", "value": "num"}`.
2. **Inspect & present:** Check `diagnostics` / `warnings`, the figure tree (`n7` marks the exact colliding or clipped label on the preview PNG), `size` and `interactions`. Fix every real warning. Put the returned `markdown` line verbatim in your reply (document outputs live under `outputs/charts/<name>-<digest>/`, not flat `outputs/charts/<name>.png`).
3. **Revise presentation with `charts_update` (never redraw from CSV for a restyle/resize/interaction change):**
   ```json
   {
     "documentPath": "outputs/charts/revenue-<digest>/revenue.chart.json",
     "expectedRevision": "sha256:…",
     "patch": { "appearance": { "theme": "dark" }, "layout": { "target": "presentation" } }
   }
   ```
   If revising a `.chart.json` already in the workspace, read that file first with `read` to get its `"revision"` (`sha256:…`) and pass that exact `"sha256:…"` string literal as `expectedRevision` — never edit `.chart.json` by hand and never call `charts_quick` or `charts_render` on the CSV when only presentation (theme, layout target/size, title, description, interactions) is changing, even if the CSV changed since. Each `charts_update` writes a new generation folder with a new `documentPath` and `revision`: chain that new path and revision on the next update. Changing data, bindings, aggregation or sorting requires a new `charts_quick` document.

## Dashboard, table & annotation shapes

- **`charts_board` (`BoardDocumentV1`):**
  ```json
  {
    "board": {
      "version": 1,
      "title": "Regional performance",
      "datasets": { "sales": { "path": "data/sales.csv" } },
      "filters": [{ "id": "qtr", "label": "Quarter", "dataset": "sales", "field": "quarter", "control": "select" }],
      "kpis": [{ "id": "rev", "label": "Revenue", "dataset": "sales", "field": "revenue_eur", "aggregate": "sum", "format": "currency" }],
      "panels": [
        { "id": "bars", "title": "By region", "dataset": "sales", "span": 6, "chart": { "quick": { "type": "bar", "x": "region", "y": "revenue_eur", "aggregate": "sum", "sort": true } } },
        { "id": "rows", "title": "Detail", "dataset": "sales", "span": 6, "chart": { "kind": "table", "columns": [{ "field": "region", "label": "Region" }, { "field": "revenue_eur", "label": "Revenue", "format": "currency", "align": "right" }] } }
      ]
    }
  }
  ```
  Filter `control`: `"segmented" | "select" | "chips" | "range" | "search"` (omit `dataset` on a filter to narrow every dataset that has `field`). Board `quick.type`: `"bar" | "line" | "area" | "point" | "scatter" | "arc" | "pie" | "donut" | "heatmap" | "rect" | "tick"` (with optional `xTitle`, `yTitle`, `aggregate`, `sort`). KPI `format`: `"currency" | "percent" | "compact" | "number" | "integer"`. Panel tables sit inside `chart: {"kind": "table", "columns": [...], "limit"?: number}` and display raw filtered rows. Build the board in one call without creating throwaway probe boards.
- **Editorial frame, `annotations` & `motion`:**
  - `kicker`, `subtitle`, `source`, `notes` and `annotations` apply to `spec`, `charts_table` and `charts_diagram` calls (refused with `INPUT_CONFLICT` alongside `document` so saved document dimensions stay exact).
  - `annotations`: `{"type": "line", "axis": "y", "value": 120, "domain": [0, 180], "label": "Target", "dashed": true}`, `{"type": "band", "axis": "x", "preset": "us-recessions"|"covid-lockdowns", "domain": ["2019-01-01", "2022-01-01"]}` (`domain` is required on `line` and `band`; `color` is `#hex`/`rgb()`/`transparent`), or `{"type": "callout", "x": 160, "y": 90, "text": "Peak"}` (`x`/`y` in plot-box pixels).
  - `motion: "none" | "entrance" | "draw" | "stagger" | "pulse"` adds scoped CSS keyframe animations to `.svg` (PNG stays static). Add `"gif"` to `formats` on `quick`/`render`/`table`/`diagram` for a deterministic animated `.gif` (up to 60 frames; `charts_update` formats exclude `"gif"`).

## Getting it right first time

- **Aggregation is explicit.** Repeated groups without `options.aggregate` (`"sum" | "mean" | "median" | "min" | "max" | "count"`) fail with `AGGREGATION_REQUIRED`. Choose from what the measure means:
  - Totals ("total revenue") → `"sum"`.
  - Rates, percentages or ratios ("conversion rate by region") → **never sum**; aggregate across repeated rows into the requested grouping (`bar` by `region`, not a `line` over time unless time was asked) using `"mean"` or `"median"`, format `0..1` proportions with `options.valueFormat: ".0%"` (never multiply by 100 in `data.transform`), and state in your reply how rows were combined (or ask if genuinely ambiguous).
  - Row counts ("how many orders per channel?") → `"count"` with **no `value`/`y` binding** (never sum an amount column when asked how many).
- **Size is the outer canvas.** `layout: {"target": "inline"}` (default, 720×420, responsive in HTML), `"report"`/`"analysis"` (900×540), `"presentation"` (1280×720, labels ≥18 px), or `"paper"` (1000×650); `layout.width` and `layout.height` set exact outer pixels (including title, axes and legend). Engine documents allow `{"mode": "native"}` only.
  - **`LAYOUT_UNSATISFIABLE`:** Follow the refusal's own next step **in order**. It first names a same-family recipe that fits the requested size (`bar` ↔ `horizontal_bar`): switch immediately to that recipe **keeping the exact requested `width` and `height` and keeping every row** (never render test charts at a wider/taller width or height than the user asked for, never filter out categories with `data.transform`, and never drop to a raw spec to bypass the check). Only change canvas size if no size was requested and the refusal says no swap fits.
- **Interactions (HTML only, exact enums):**
  - `tooltip`: `"auto"` (default) or `"off"`.
  - `legend`: `"static"` (default) or `"highlight"` (charts with a series).
  - `zoom`: `"none"` (default) or `"x"` (**temporal `line` and `area` only**).
  - `brush`: `"none"` (default) or `"interval"` (**`scatter` and `bubble` only**).
  - Unsupported combinations (e.g. zoom on a `pie` or `bar`) fail with `INTERACTION_UNSUPPORTED`: tell the user clearly that pie/bar charts do not support zoom (zoom is for temporal line/area charts) and offer a supported alternative (`tooltip`, or a `bar` / temporal `line` chart) — never claim zoom was enabled. When setting `zoom: "x"` or `brush: "interval"`, omit `formats` (which auto-includes `"html"`) or include `"html"` explicitly (`INTERACTION_FORMAT_MISMATCH` otherwise), and mention the `.html` file in your reply.
- **Data honesty & craft:** Empty data fails with `DATA_EMPTY` — say explicitly that the data is empty (has no rows), and **never** invent sample rows, draw a placeholder chart or edit the data file. Use ISO UTC dates (`2024-03-01`) with `"xType": "temporal"`. Put units on quantitative axes (`"yTitle": "Revenue (€k)"`), set `currency` (`"EUR"`), use `pie`/`donut` only for 2–5 parts of a whole, pin series colours via `appearance.categoryColors: [{"value": "North", "color": "#0B5FFF"}]`, use `"theme:positive"` / `"theme:categorical.0"` in raw specs, and use bundled atlases (`{"atlas": "world-110m"}`, `"us-states-10m"`, `"world-land-110m"` — nothing loads from the network).

## Themes, host seeds & capabilities

- **Built-in themes (9):** `light` (default), `dark`, `geist`, `geist-dark`, `editorial-ft`, `editorial-economist`, `high-contrast`, `print`, `presentation`.
- **Saved brand themes:** `charts_theme_save {"name": "acme-light", "theme": {"extends": "light", "colors": {"categorical": ["#0B5FFF", "#FF6A3D", "#00A87E"]}}}` (or with `theme: {"seed": {...}}`), then use `appearance: {"theme": "acme-light"}` in documents or `theme: "acme-light"` on calls. `charts_themes {"name": "light"}` shows every token.
- **UI host seed synthesis:** Pass `{"seed": {"background": "#FAF8F5", "foreground": "#1A1A18", "accent": "#C2410C", "font": "Geist, Inter, sans-serif", "radius": 6}}` (`#hex`, `oklch()`, `hsl()`, `rgb()` or W3C DTCG `$value`) to `charts_themes` to preview, to `charts_theme_save` under `theme`, or inline as `theme` on `spec`/`table`/`diagram`/`board` calls. Inline `seed` or `variants` on `spec`/`table`/`diagram` writes a dual-polarity adaptive `.svg` (`prefers-color-scheme` + `[data-theme]`) and paired live `.html`; `.charts/theme.json` and the `charts.theme` RPC provide workspace/session defaults; named saved themes (`theme: "acme-light"`) and `document` calls draw their single active polarity.
- **Fonts & capabilities:** Bundled OFL-1.1 faces cover Latin, Greek and Cyrillic (`Inter`, `Geist`, `JetBrains Mono`, `Geist Mono`); add `.ttf`/`.otf` via `theme.font.files` when `FONT_GLYPH_MISSING` warns on CJK/Arabic/Devanagari. Call `charts_capabilities` before promising an output format, script or interaction.

## Errors

Errors report `CODE: what happened (at /json/path). Next step.` Follow the next step directly (`UNKNOWN_PROPERTY` names the closest valid field; `DOCUMENT_REVISION_MISMATCH` means re-read the latest `.chart.json` revision). Do not retry an identical failing call unchanged.
