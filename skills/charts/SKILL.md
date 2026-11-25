---
name: charts
description: Truthful, publication-grade charts, tables, diagrams, GIFs and dashboards with the charts tools, and revising saved charts. Use for any chart, graph, plot, map, KPI table, diagram or dashboard of data. Not for photo editing, 3-D rendering (Python) or slide layout.
---

# Charts

Tool names: `tools.charts.validate`, `tools.charts.recommend`, `tools.charts.capabilities`,
`tools.charts.catalogue`, `tools.charts.themes`, `tools.charts.theme_get`, `tools.charts.status`,
`tools.charts.state`; the nine plans `tools.charts.plan_render`, `tools.charts.plan_quick`,
`tools.charts.plan_update`, `tools.charts.plan_board`, `tools.charts.plan_table`, `tools.charts.plan_diagram`,
`tools.charts.plan_theme_save`, `tools.charts.plan_theme_sync`, `tools.charts.plan_theme_clear`; and their nine
commits `tools.charts.render`, `tools.charts.quick`, `tools.charts.update`, `tools.charts.board`,
`tools.charts.table`, `tools.charts.diagram`, `tools.charts.theme_save`, `tools.charts.theme_sync`,
`tools.charts.theme_clear`. Use `search({ namespace: "charts" })` for a signature.

Every write is plan, then commit. Call the plan with the same input the write takes; it writes nothing and answers
`{ planId, method, output, changes }`, where `output` names the files it would write and `changes` says what it would
change. Then call the write with exactly `{ planId }` to write what the preview showed. A plan commits once, for
fifteen minutes, and only through the method it names; a stale or reused id is `PLAN_INVALID` or `PLAN_USED`, so plan
again. `tools.charts.validate` is a read-only dry run, not a plan: use it for the full check without a planId.

## Which way to draw

| Use Charts when | Use code on the machine (Python: matplotlib, seaborn, plotly) when |
|---|---|
| Standard or specialised charts, maps, KPI tables, Mermaid or structured diagrams, GIFs or dashboards (79 types in `tools.charts.catalogue`). | A bespoke statistical model diagnostic, a 3-D scientific projection, or a raster overlay outside the six engines. |
| It must match a theme or brand, look identical every time, or be revised later without touching its data. | The data needs heavy multi-GB computation first and the plot is a by-product of that script. |
| You want strict validation: field names with did-you-mean, explicit aggregation, misleading axes, overlapping labels, contrast and exact canvas size. | — |

## Choosing the method

1. **A standard single chart**: `plan_quick` with `document` whenever one of the 14 recipe types fits (`bar`,
   `horizontal_bar`, `grouped_bar`, `stacked_bar`, `line`, `area`, `stacked_area`, `scatter`, `bubble`, `pie`, `donut`,
   `histogram`, `box_plot`, `heatmap`), then `quick` with its `planId`. It saves an editable `<name>.chart.json` and
   lets `update` revise its presentation later.
2. **Revise a saved chart**: `plan_update` then `update` changes theme, overrides, category colours, layout, title, alt
   text or interactions without re-reading or changing its captured data.
3. **A publication table**: `plan_table` then `table` takes columns with inline marks, spanners, row groups, a summary
   row and an accessible HTML version.
4. **A diagram**: `plan_diagram` then `diagram` takes Mermaid source (`dsl`) or a structured `kind` (mindmap, org
   chart, fishbone, architecture), never both, and returns SVG, PNG and a Unicode outline.
5. **A dashboard**: `plan_board` then `board` takes a board document and writes the poster SVG and PNG, an offline
   `.board.html` and the `.board.json`.
6. **Any other catalogue chart**: `plan_render` then `render` with a raw spec and data across Vega-Lite, Vega, ECharts
   and Plot. Start from `tools.charts.catalogue` with an id, or ask `tools.charts.recommend` with the question and
   data.

`tools.charts.render` and `tools.charts.validate` also accept `document` or `documentPath`; use exactly one arm per
call. `tools.charts.validate` runs the same checks and writes nothing.

Interactions are `tooltip: "auto"` or `"off"`, `legend: "static"` or `"highlight"`, `zoom: "none"` or
`"x"`, and `brush: "none"` or `"interval"`; an unsupported combination is refused with the alternatives.

## Workflow: create, inspect, revise

1. **Create** with a typed document:

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
       "title": "Revenue by month and region"
     }
   }
   ```

   Unknown fields fail with their JSON path; repeated groups need `options.aggregate` (the default `none` refuses with
   `AGGREGATION_REQUIRED`); `count` counts rows and takes no measure. Pass the document to `tools.charts.plan_quick`:
   the plan writes nothing and its `output.files` names the files the commit will write. Then call
   `tools.charts.quick({ planId })`; the result names the written files and the document's `revision`.

2. **Inspect** the plan's `changes`, `output.files`, `output.summary` and `output.warnings`, and use
   `tools.charts.validate` for the full `figure` and `layout` check; it returns `valid: false` with the issues instead
   of writing. The PNG and SVG under `outputs/charts/` are the files a reader shows.

3. **Revise** the presentation with `tools.charts.plan_update` and `{"documentPath": "<the .chart.json>",
   "expectedRevision": "sha256:…", "patch": {…}}`, then `tools.charts.update({ planId })`. A stale revision is
   `DOCUMENT_REVISION_MISMATCH` before anything is drawn; a change of data or meaning is a new document.

## Access levels

`all` (default) runs every method; `ask-changes` asks before a commit; `read-only` turns commits off. Plans and other
reads always run. `theme_save`, `theme_sync` and `theme_clear` ask even under `all`.

## Errors

Every failure is `CODE: What happened. Next step: What to do.` The contract codes are `INPUT_INVALID` (the input or a
chart problem; its own code and JSON path are in the sentence), `TOO_LARGE` (a size limit), `PERMISSION_DENIED` (the
person's rules refuse it), `PLAN_INVALID`/`PLAN_USED` (plan again, then commit the new id), `HOST_UNTESTED`
(OpenCode outside the supported range) and `UNAVAILABLE` (the renderer could not run). Fix the named path and call
again; never retry a refusal unchanged.

Charts has no account and calls no service.
