# Chart documents

A chart document is the editable source of a chart: what it draws (a typed recipe, or a raw engine spec), its data,
and how it is presented (theme, layout, interactions). `charts_quick` and `charts_render` take one as `document`, save
it as `<name>.chart.json`, and `charts_update` changes its presentation into a new, immutable generation. The resolved
engine spec (`.vl.json`, `.vg.json`, `.echarts.json`) is a derived export, never the source of a revision.

The raw interfaces (`charts_render` with `spec`, `charts_quick` with `type` and field names) are unchanged; see
[Compatibility](#compatibility).

## The workflow

1. **Pick a recipe** if you are unsure: `charts_recommend` returns a `document` draft on your own columns for the
   types that are recipes, and `charts_catalogue {"id": "line"}` returns each recipe's contract and its examples as exact
   `charts_quick` calls.
2. **Create**: `charts_quick {"document": {…}}`. The document is checked strictly; every problem has a JSON path. A
   valid call draws, so a separate `charts_validate` first is optional: use it to preflight or repair.
3. **Inspect** the result: `diagnostics`, the preview PNG, the figure tree, `size` (requested and actual) and
   `interactions` (requested, resolved, and what each format carries).
4. **Change the presentation** with `charts_update {"documentPath", "expectedRevision", "patch"}`. A change of data,
   bindings, aggregation or sorting is a new document.

## ChartDocumentV1

```ts
type ChartDocumentV1 = {
  version: 1
  chart:
    | { kind: "recipe"; recipe: RecipeId; data: DataInput; bindings: {…}; options?: {…} }
    | { kind: "engine"; engine?: "vega-lite" | "vega" | "echarts"; spec: object; data?: DataInput }
  title?: string
  description?: string            // alt text
  locale?: string
  currency?: string
  seed?: number
  appearance?: { theme?: string; overrides?: PresentationTokenOverrides; categoryColors?: { value: string | number | boolean | null; color: string }[] }
  layout?: { target?: "inline" | "analysis" | "report" | "presentation" | "paper"; mode?: "fixed" | "responsive"; width?: number; height?: number } | { mode: "native" }
  interactions?: { tooltip?: "auto" | "off"; legend?: "static" | "highlight"; zoom?: "none" | "x"; brush?: "none" | "interval" }
}
```

`data` holds exactly one of `rows` or `path` (a workspace `.csv`, `.tsv`, `.json`, `.jsonl` or `.parquet` file), with
an optional `format` and Vega-Lite `transform` list. Bindings name fields after the transform. Unknown properties fail
with their path (`DOCUMENT_INVALID`); a version other than 1 is `DOCUMENT_VERSION_UNSUPPORTED`. Nothing is stripped or
downgraded.

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
(`bun scripts/cookbook.ts`); `?` marks an optional binding and `*` one required unless `options.aggregate` is `count`
(and refused under `count`).

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
  silent sum. `count` counts the rows of a group after `data.transform`. Other aggregates ignore a missing measure
  with a `VALUE_MISSING` diagnostic; a group with no value stays missing, never zero.
- **Sorting.** `sort` (bar, horizontal bar, pie, donut: `input`, `category-ascending`, `category-descending`,
  `value-ascending`, `value-descending`; grouped and stacked bars and box plots: `input` and the category sorts) defaults
  to `input`. Line and area charts take `xSort` (`input`, `ascending`, `descending`; default ascending for temporal and
  quantitative x, input for ordinal x). Heatmaps take `rowSort` and `columnSort`. Histograms take `bins`, 2–200,
  default 24. An option a recipe does not take fails with its path and the one it should use.
- **Missing positions.** A temporal or numeric x that is missing or not a date is `POSITION_MISSING`, never read as
  zero or today.

The `area` recipe with a series draws overlapping areas; `stacked_area` stacks. See
[engineering/open-decisions.md](engineering/open-decisions.md) for the defaults that are still product choices.

## Layout

For a recipe, `width` and `height` are the **outer** logical pixels: title, axes, legend and padding included. A
fixed SVG is exactly that size; a PNG is that size times its scale. `target` picks a profile; explicit fields override
it:

| Target | Mode | Outer size | Smallest label |
| --- | --- | --- | --- |
| `inline` (default) | responsive | 720 × 420 | 11 px |
| `analysis` | fixed | 900 × 540 | 11 px |
| `report` | fixed | 900 × 540 | 11 px |
| `presentation` | fixed | 1280 × 720 | 18 px |
| `paper` | fixed | 1000 × 650 | 11 px |

The layout planner (`src/layout/planner.ts`) tries three candidates in a fixed order (`as-designed`, `wrapped`,
`compact`: category labels wrapped or turned, long titles wrapped, the legend moved below the plot, sparser continuous
ticks), uses the first that fits, and records each adjustment in `adjustments`. It never filters
categories, samples rows, changes the aggregation or the chart type, or shrinks text below the floor. When nothing
fits, the call fails with `LAYOUT_UNSATISFIABLE`, the measured conflicts and alternatives, and writes nothing.

In `responsive` mode the width is the static export's width; in the HTML page the live chart is re-planned with the
same planner at its container's width (the height stays fixed). The browser's text metrics differ from the server's,
so the promise is the same policy and bounds, not the same pixels.

An engine document keeps its native layout: `layout` is omitted or `{"mode": "native"}`, and the spec's own sizes
mean what they mean in its engine. Fixed or responsive layout on an engine document is `LAYOUT_UNSUPPORTED`.

## Appearance

`appearance.theme` names a built-in or saved theme (default: the plugin's configured theme). `overrides` is a strict,
typed deep-partial of the theme tokens (arrays replace whole; `extends`, `name` and `description` are not overrides;
`layout.width` and `layout.height` belong in `layout`). The order is: the captured theme base, then the layout
profile's typography, then the overrides, then explicit layout sizes. A font size below the profile's floor is an
error, not a silent shrink.

A recipe with a series (or a pie or donut) has a stable **colour domain**: every category of the full transformed
data, in a type order (null, boolean, number, string), numbers numerically and strings by code point, independent of
the display sort and of interaction. Category `1` and `"1"` are different categories. `categoryColors` pins a colour
to a category; an entry for a category the data does not have is `CATEGORY_COLOR_UNUSED`. Engine documents keep their
own scales and refuse `categoryColors`.

`"theme:positive"`, `"theme:negative"` and the other semantic tokens resolve from the current theme on every compile;
a literal colour stays literal.

## Interactions

| Preset | Recipes | What it does in the HTML page |
| --- | --- | --- |
| `tooltip: "auto"` (default) | all | Hovering a mark shows the values it draws, formatted like its axis; the same values are in a keyboard-reachable data table. |
| `legend: "highlight"` | grouped and stacked bars, line, area, stacked area, scatter, bubble (with a series) | Choosing a series emphasises it; every mark, scale and stacked total stays. Clear highlight restores. |
| `zoom: "x"` | line and area with temporal x | Wheel zooms and drag pans the x domain; y keeps its domain. Reset zoom restores. |
| `brush: "interval"` | scatter, bubble | Drag a rectangle to emphasise the marks inside. Clear selection clears. |

Legend highlight combines with x zoom (line and area) or with the brush (scatter and bubble); with both a highlight
and a brush, full emphasis is their intersection, each clears on its own, and Reset all clears both. Any other
combination, or a preset on a recipe that does not support it, is `INTERACTION_UNSUPPORTED` with the allowed
alternatives. Engine documents keep their own interaction syntax and refuse the presets.

SVG and PNG are static pictures of the initial view. A document call's default formats are `svg`, `png`, `spec` and
`document`, plus `html` when an explicit interaction needs it (an omitted tooltip does not). An explicit `formats`
list is exact: if it leaves out `html` while the document asks for an interaction only HTML carries, the call fails
with `INTERACTION_FORMAT_MISMATCH` before anything is written. A result never says an interaction was verified in a
browser: the interactions are tested in the plugin's browser suite, not at render time.

## The saved artifact

`<name>.chart.json` is an envelope with `format: "opencode-charts-artifact"` and `version: 1`, holding:

- the canonical document, with `data.path` replaced by the captured rows (before the transform, which is kept once)
  and the path, format and content hash kept in provenance;
- the captured theme base, the custom fonts by content digest, the captured defaults (locale, seed, recipe option
  defaults, layout profile and version, interaction defaults) separately from what was authored, and the colour
  domain;
- the compiler and renderer versions;
- the `revision`: `sha256:` over the canonical document, the captured defaults and theme base, the data, the colour
  domain and the font digests. It excludes timestamps, absolute paths, file names and compiled specs.

A result also carries a render `fingerprint`, which covers what changes the files' bytes (renderer versions, size,
formats, scales, fonts, runtime digests, `svgText`, `marks`, inspection). Rows are measured as JSON against the data
limit (see [engineering/open-decisions.md](engineering/open-decisions.md)). A result never echoes the captured rows.

`charts_render {"documentPath", "expectedRevision"?}` draws a saved artifact again from what it captured: its rows,
theme base and defaults, even if the plugin's defaults or the saved theme have changed since. `charts_validate` takes
the same path arm and writes nothing. A changed custom font is `DOCUMENT_DEPENDENCY_CHANGED`; a stale or edited
revision is `DOCUMENT_REVISION_MISMATCH`, raised before anything is drawn.

## charts_update

```json
{ "documentPath": "outputs/charts/revenue-1a2b3c4d5e6f7a8b/revenue.chart.json", "expectedRevision": "sha256:…", "patch": { "appearance": { "theme": "dark" } } }
```

- `title` and `description`: an empty string is intentionally empty; omitted stays.
- `appearance` merges by property. A given `theme` is resolved anew and captured (the way to adopt edits to a saved
  theme); an omitted one keeps the captured base. `overrides` merge token by token, arrays whole, and `{}` clears
  them all. `categoryColors` replaces whole, and `[]` clears it.
- `layout` replaces the whole layout: `{"target": "presentation"}` takes that profile's size, not an old explicit
  width.
- `interactions` merges by property.
- Data, bindings, options, transforms, locale, currency and seed cannot change. No JSON Patch, no code, no unknown
  paths.

The revision is recomputed from the file and compared with `expectedRevision` before anything is drawn. The result is
a new generation; the source artifact and earlier generations are never overwritten. `{}` draws the saved chart
again, and an identical generation that already exists is verified and reused.

## Generations

A document call (inline `document`, `documentPath`, or `charts_update`) publishes its files as one folder
`<outDir>/<name>-<digest>/`, where the digest is of the file manifest. Every file and the preview are made first,
staged on the same file system, and the folder appears only when complete; a failure publishes nothing and removes
its staging. An existing folder with the same name is verified file by file and reused, or refused if it differs.
The result returns the exact paths.

## Compatibility

- Legacy calls draw as before. Their files keep flat names, staged and moved into place with a best-effort rollback.
- A legacy call that asks for `document` output saves an engine document built from the original unthemed spec and
  the untransformed data.
- `.vl.json`, `.vg.json` and `.echarts.json` files are resolved specs. They are never read back as documents.
- A call takes one arm: legacy fields, `document`, or `documentPath`. A mixture is `INPUT_CONFLICT`, before anything
  is read or written.
