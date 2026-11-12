---
name: charts
description: Make clear, truthful, on-brand charts with the charts_* tools (typed chart documents, or Vega-Lite, Vega and ECharts specs, rendered to SVG, PNG and offline HTML), revise them without changing their data, and know when to use code on the machine (matplotlib, plotly, seaborn) instead. Use for any chart, graph, plot, map or diagram of data.
---

# Charts

## Which way to draw

| Use the charts_* tools when | Use code on the machine (Python: matplotlib, seaborn, plotly, pandas) when |
|---|---|
| The chart is a standard type (bar, line, scatter, map, Sankey, treemap… see `charts_catalogue`). | The chart is bespoke analysis output: a statistical model's diagnostics, a custom annotation-heavy figure, anything the catalogue cannot express. |
| It must match a theme or brand exactly, look the same every time, or be revised later. | The data needs heavy processing first and the plot is a by-product of that script. |
| You want it checked: field names, aggregation, misleading axes, overlapping labels, exact size. | You need a library feature (3-D, scientific projections, image overlays). |

## Workflow

1. **Pick a recipe** if you are unsure. The 14 standard types (`bar`, `horizontal_bar`, `grouped_bar`, `stacked_bar`, `line`, `area`, `stacked_area`, `scatter`, `bubble`, `pie`, `donut`, `histogram`, `box_plot`, `heatmap`) are typed recipes. `charts_recommend` with the question and the data returns a ranked shortlist and, for a recipe, a `document` draft on those columns. `charts_catalogue {"id": "line"}` returns a recipe's bindings, options and interactions and an exact `charts_quick` call.
2. **Make one typed document call**: `charts_quick {"document": {"version": 1, "chart": {"kind": "recipe", "recipe": "line", "data": {"path": "data/rev.csv"}, "bindings": {"x": "month", "y": "revenue_eur", "series": "region"}, "options": {"xType": "temporal", "aggregate": "sum", "yTitle": "Revenue (€)"}}, "title": "Revenue by month and region", "currency": "EUR"}, "name": "revenue"}`. The document is checked strictly and every problem has a JSON path. A valid call draws: `charts_validate` first is optional, for preflight or repair.
3. **Inspect** the result: `diagnostics`, the PNG, the figure tree (every label with an id; "n7 is clipped" points at one label), `size` and `interactions`. Fix every real warning.
4. **Change the presentation with `charts_update`**: `{"documentPath": "<the .chart.json from the result>", "expectedRevision": "<its revision>", "patch": {"appearance": {"theme": "dark"}}}`. It writes a new generation folder with a new revision and never touches the saved chart. Use the new path and revision for the next update. A change of data, fields, aggregation or sorting is a new `charts_quick` document, never an update.
5. **Show it**: put the returned markdown line in your reply. To hand files over, save them with the host's file-saving tool (in Jelly: `jelly_file_save` with the path).

The raw path is for everything else: `charts_render {"spec": …, "data": …}` with a Vega-Lite, Vega or ECharts spec (start from `charts_catalogue {"id": "…"}`). It also takes `document` (a recipe, or `{"kind": "engine", "spec": …}`) and `documentPath` (draw a saved chart again from what it captured). One arm per call: mixing `spec`/`type` with `document` or `documentPath` is `INPUT_CONFLICT`.

## Getting it right first time

- **Aggregation is explicit.** Several rows per bar, point in time or cell need `options.aggregate` (`sum`, `mean`, `median`, `min`, `max`, `count`); without it the call fails with `AGGREGATION_REQUIRED`. Choose the aggregate from what the measure means: never sum rates or ratios. `count` counts rows and takes no value binding.
- **Size is the outer canvas.** `layout: {"target": "presentation"}` (1280 × 720, labels at least 18 px), `"report"`/`"analysis"` (900 × 540), `"paper"` (1000 × 650) or `"inline"` (the default, 720 × 420, responsive in HTML); `width`/`height` override it and include title, axes and legend. `LAYOUT_UNSATISFIABLE` means it cannot fit readably at that size: do what the refusal's own next step says (it lists the measured conflicts, and what would fit or the size it needs); do not switch chart type or shrink labels on a guess.
- **Interactions** (HTML only): `tooltip: "auto"` (the default), `legend: "highlight"` (charts with a series), `zoom: "x"` (temporal line and area), `brush: "interval"` (scatter and bubble). Anything else, such as zoom on a pie, is `INTERACTION_UNSUPPORTED`. An explicit `formats` list without `"html"` and an explicit interaction is `INTERACTION_FORMAT_MISMATCH`. SVG and PNG show the initial view.
- One message per chart. A title that states the finding ("Revenue doubled in Q3"). Units on every quantitative axis: `"yTitle": "Revenue (€k)"`. Money: `currency: "EUR"` (and `locale: "de-DE"`).
- Time on x as `"xType": "temporal"` with ISO dates (`2024-03-01`). Everything is UTC.
- Colour: use the theme. Pin a series colour with `appearance.categoryColors: [{"value": "North", "color": "#0B5FFF"}]`; in raw specs refer to `"theme:positive"`, `"theme:categorical.2"`.
- Pie or donut only for 2–5 parts of one whole; otherwise bars. Maps (raw specs): `{"atlas": "world-110m"}`, `us-states-10m`, `world-land-110m`; nothing loads from the network.
- Empty data is an error, never invented values: say the data is empty rather than drawing sample rows.

## Themes

Built in: `light` (default), `dark`, `high-contrast`, `print`, `presentation`. A brand: `charts_theme_save {"name": "acme-light", "theme": {"extends": "light", "colors": {"categorical": ["#…", …]}}}` (and `acme-dark` extending `dark`), then `appearance: {"theme": "acme-light"}`. `charts_themes {"name": "light"}` shows every token; `appearance.overrides` takes any subset of them. Bundled fonts: Inter, JetBrains Mono; a theme can add workspace `.ttf`/`.otf` files with `font.files`. `FONT_GLYPH_MISSING` means no bundled face has those characters.

## Before relying on an output

`charts_capabilities` reports what this build does: formats, engines, recipes and their interactions, layout targets, fonts and scripts, limits, and what is known not to work. Call it before promising a PDF, a Chinese label or an interaction.

## Errors

Every error is `CODE: what happened (at /json/path). Next step.` Do what the next step says; do not retry the same call unchanged. `DOCUMENT_REVISION_MISMATCH` means the saved chart changed: read the latest revision from the call that wrote it.
