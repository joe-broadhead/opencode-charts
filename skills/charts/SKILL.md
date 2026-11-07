---
name: charts
description: Make clear, truthful, on-brand charts with the charts_* tools (Vega-Lite, Vega and ECharts specs rendered to SVG, PNG and offline HTML), and know when to use code on the machine (matplotlib, plotly, seaborn) instead. Use for any chart, graph, plot, map or diagram of data.
---

# Charts

## Which way to draw

| Use the charts_* tools when | Use code on the machine (Python: matplotlib, seaborn, plotly, pandas) when |
|---|---|
| The chart is a standard type (bar, line, scatter, map, Sankey, treemap… see `charts_catalogue`). | The chart is bespoke analysis output: a statistical model's diagnostics, a custom annotation-heavy figure, anything the catalogue cannot express. |
| It must match a theme or brand exactly, and look the same every time. | The data needs heavy processing first and the plot is a by-product of that script. |
| You want it checked: field names, misleading axes, overlapping labels. | You need a library feature (3-D, scientific projections, image overlays). |

Both end the same way: a file under `outputs/` that the person can open. Prefer the tools: they are deterministic, themed, checked and fast.

## Workflow

1. **Pick the type.** When you are not sure which chart answers the question, call `charts_recommend` with the request and the data: it returns a ranked shortlist with a reason each, the encoding to use and a ready `charts_render` call on those columns. If it abstains, it says what was missing. `charts_catalogue` lists every type with when to use it; `charts_catalogue {"id": "…"}` gives a working call to adapt. For a basic chart, `charts_quick` builds the spec from field names.
2. **Pass data separately**: `data.rows` (inline) or `data.path` (a workspace CSV, TSV, JSON, JSONL or Parquet file). Reshape with `data.transform` (Vega-Lite transforms: `filter`, `calculate`, `aggregate`, `window`, `pivot`, `fold`) rather than by hand. In the spec, refer to the rows as `{"name": "table"}` or leave `data` out.
3. **Check, then render.** `charts_validate` returns every problem with its JSON path and a fix ("Field "regoin" is not in the data. Did you mean "region"?"), lint warnings, layout facts and the picture. Fix, then `charts_render`.
4. **Look at it.** The result includes the PNG when there are warnings (or with `inspect: true`), and the **figure tree**: every label with an id, its box, and which ones collide or run past the edge. The picture numbers the same ids, so "n7 is clipped" points at one label — fix that label rather than guessing. Fix every warning that is real: overlapping labels, clipped text, a pie with too many slices, a bar axis that does not start at zero, missing units.
   - `FONT_GLYPH_MISSING` means no bundled face has those characters: they draw as blank boxes. Add a font with `theme.font.files`, or change the labels. `charts_capabilities` says which scripts this build covers.
5. **Show it**: put the returned markdown line (`![title](outputs/charts/name.png)`) in your reply. To hand files over, save them with the host's file-saving tool (in Jelly: `jelly_file_save` with the path); files under `outputs/` are also kept when the turn ends. Ask for `formats: ["svg","png","html"]` when the person wants an interactive version.

## Getting it right first time

- One message per chart. A title that states the finding ("Revenue doubled in Q3"), not the variables.
- Units on every quantitative axis: `"title": "Revenue (€k)"`. Field names like `revenue_eur` are humanised to "Revenue (€)" automatically.
- Money: pass `currency: "EUR"` (and `locale: "de-DE"` for German separators). Large numbers are shown compactly (1.2M) automatically.
- Time on x as `"type": "temporal"` with ISO dates (`2024-03-01`). Everything is UTC, so output is the same on every machine.
- Order categories by value (`"sort": "-y"`), except natural orders (months and weekdays are ordered for you).
- Colour: use the theme. Refer to theme colours as `"theme:positive"`, `"theme:negative"`, `"theme:highlight"`, `"theme:categorical.2"`. Sequential data gets the theme's sequential ramp; never a rainbow.
- Maps: `{"atlas": "world-110m"}` (join on `properties.iso_a3`, `iso_a2` or `name`), `us-states-10m` (join on `properties.postal`), `world-land-110m` (base map). Nothing loads from the network; URLs are refused.
- Pie or donut only for 2–5 parts of one whole; otherwise bars.

## Themes

Built in: `light` (default), `dark`, `high-contrast`, `print`, `presentation`, `toqan`, `toqan-night`. Each theme's palette carries its published colours first and then generated ones (up to 20 series), so a chart with more series than the published set still differs by colour; `print` and `high-contrast` stay as published. A brand: `charts_theme_save {"name": "acme", "theme": {"extends": "light", "colors": {"categorical": ["#…", …]}, "font": {"family": "Geist"}}}`, then `theme: "acme"` everywhere. `charts_themes {"name": "light"}` shows every token to copy. Bundled fonts: Inter, Geist, JetBrains Mono; a theme can add workspace `.ttf` files with `font.files`.

## Before relying on an output

`charts_capabilities` reports exactly what this build can do: the output formats that work here, the engines and the
families each draws, the fonts and the scripts they cover, the limits, and what is known not to work. Call it before
promising a PDF, a Chinese label or an SVG the person can edit on another machine.

## Errors

Every error is `CODE: what happened (at /json/path). Next step.` Do what the next step says; do not retry the same call unchanged.
