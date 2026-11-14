---
name: charts
description: Make clear, truthful, publication-grade charts, data-graphic tables, diagrams, animated GIFs and interactive dashboards with the charts_* tools (79 chart/plot/cartogram/table/diagram types across Vega-Lite, Observable Plot, Vega, ECharts 6, Tables and Mermaid/Mindmap/Fishbone, rendered offline to SVG, PNG, GIF and @ui-sdk HTML), revise them without changing their data, and know when to use code on the machine instead.
---

# Charts

## Which way to draw

| Use the charts_* tools when | Use code on the machine (Python: matplotlib, seaborn, plotly, pandas) when |
|---|---|
| Standard or specialized charts, maps/cartograms, publication tables with sparklines, Mermaid/mindmap/fishbone diagrams, animated GIFs or interactive multi-panel dashboards (79 types in `charts_catalogue`). | Bespoke scientific model diagnostics, 3-D scientific projections, or custom raster image overlays outside the six engines. |
| It must match a theme or brand (`light`, `dark`, `geist`, `geist-dark`, `editorial-ft`, `editorial-economist`, `high-contrast`, `print`, `presentation`), look identical every time, or be revised later. | The data needs heavy multi-GB computation first and the plot is a quick internal by-product of that script. |
| You want it checked: field names, aggregation, misleading axes, overlapping/clipped labels, contrast, and exact size. | — |

## Choosing the right tool

1. **Standard single chart (`charts_quick`):** Pass a typed `document` for the 14 core recipes (`bar`, `horizontal_bar`, `grouped_bar`, `stacked_bar`, `line`, `area`, `stacked_area`, `scatter`, `bubble`, `pie`, `donut`, `histogram`, `box_plot`, `heatmap`). Saves an editable `<name>.chart.json`; revise presentation later with `charts_update`.
2. **Any of the 79 types, Observable Plot, Cartograms, ECharts 6 Matrix/Timelines, Editorial Frames, Annotations & Motion (`charts_render`):**
   - Engines (`engine` optional, auto-detected): `vega-lite`, `plot` (hexbin, contour, beeswarm, bollinger, difference_area, waffle, ridgeline, horizon, `cartogram_us_hex`, `cartogram_eu_tile`, `flow_map`), `vega` (treemap, sunburst, force network, word cloud), `echarts` (Sankey, chord, gauge, funnel, calendar, candlestick, radar, parallel, violin, ECharts 6 `matrix` sparkline grids, `timeline` races), `table`, `diagram`.
   - Start from `charts_catalogue {"id": "..."}` or ask `charts_recommend` with the question and data.
3. **Publication Data-Graphic Tables (`charts_table`):** Render NYT/FT/Stripe-style tables with spanners, row groups, summary rows, and inline cell graphics (`bar`, `sparkline`, `sparkarea`, `sparkbar`, `bullet`, `delta`, `badge`, `heatmap`, `dot`) to crisp SVG, 2× PNG, and sortable/copyable HTML.
4. **Offline Diagrams (`charts_diagram`):** Render Mermaid DSL (`flowchart`, `sequenceDiagram`, `stateDiagram-v2`, `classDiagram`, `erDiagram`) or structured `mindmap`, `org_chart`, `fishbone`, and `architecture` specs to themed SVG, 2× PNG, and terminal `ascii`.
5. **Interactive Multi-Panel Dashboards (`charts_board`):** Pass a `BoardDocumentV1` (`datasets`, `filters`, `kpis` with deltas and sparklines, `tabs`, and Bento `panels` of charts and tables) to produce both a 2× retina Bento poster PNG (`.png`) and a self-contained offline `@ui-sdk` cross-filtering dashboard (`.board.html`) with `window.chartsAgent` (`snapshot`/`act`/`undo`).

## Editorial craft, annotations & motion

- **Five-part editorial frame:** Pass `kicker` (uppercase eyebrow), `title` (state the finding, e.g. `"Solar output doubled since 2021"`), `subtitle` (context/units), and `source` / `notes` (hairline-separated footer).
- **Annotations:** Pass `annotations` (`line` reference/target rules, `band` intervals or `preset: "us-recessions"` / `"covid-lockdowns"`, and `callout` leader-line notes).
- **Motion & Animated Exports:**
  - `motion: "draw" | "entrance" | "stagger" | "pulse"` injects portable zero-JS CSS `@keyframes` (with `prefers-reduced-motion` support) into `.svg` while keeping `.png` as the crisp final frame.
  - Add `"gif"` to `formats` (`formats: ["svg", "png", "gif", "html"]`) for a deterministic animated `.gif` (progressive reveal, or frame-by-frame animation for ECharts `timeline` bar-chart races and bubble stories).
- **Inline TUI/GUI fences:** Besides showing `![title](outputs/charts/<name>.png)`, TUI and Web/Desktop clients also render fenced ```` ```chart ```` JSON blocks inline.

## Getting it right first time

- **Aggregation is explicit** in recipe documents (`options.aggregate`: `sum`, `mean`, `median`, `min`, `max`, `count`); never sum rates or ratios.
- **Size is the outer canvas** for recipes: `layout: {"target": "presentation"}` (1280×720), `"report"`/`"analysis"` (900×540), `"paper"` (1000×650), or `"inline"` (720×420). Follow `LAYOUT_UNSATISFIABLE` suggestions in order.
- **Inspect warnings & figure tree:** Fix every real collision, clipped label (`n7` on the preview PNG), missing unit, or contrast warning before presenting.
- **Themes & Universal Host-Seed Synthesis:**
  - Built in: `light` (default), `dark`, `geist`, `geist-dark`, `editorial-ft`, `editorial-economist`, `high-contrast`, `print`, `presentation`.
  - **UI Seed to Full Data-Viz Theme:** Pass `{ "seed": { "background": "#FAF8F5", "foreground": "#1A1A18", "accent": "#C2410C", "font": "Geist, Inter, sans-serif", "radius": 6 } }` (in `#hex`, `oklch(...)`, `hsl(...)`, `rgb(...)` or W3C DTCG `$value`) inline as `theme` on any tool, to `charts_themes` to preview, or to `charts_theme_save` to save. It deterministically synthesises hue-locked grid/axis/muted hairlines, an 8-colour Machado-CVD-safe categorical ring, OKLCH ramps, and paired light/dark adaptive `.svg` (`prefers-color-scheme` + `[data-theme]`) and live `.html`/`.board.html` `postMessage`/`MessagePort` support.
  - **Workspace and live themes:** `.charts/theme.json` is the workspace fallback when no call or option names a theme; the live `charts.theme` RPC (`sync`, `get`, `clear`, `changed`) carries the host's own theme for a session or location without writing a file. A call's own `theme` still wins.
  - **Fonts bundled:** `Inter`, `Geist`, `JetBrains Mono`, `Geist Mono` (plus CSS comma stacks); add workspace `.ttf`/`.otf` files via `theme.font.files` for non-Latin scripts (`CJK`, `Arabic`, `Devanagari`).

## Errors

Every error is `CODE: what happened (at /json/path). Next step.` Follow the next step rather than retrying the same call unchanged.
