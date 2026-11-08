# Charts for OpenCode

Deterministic, themed charts from a spec, with no model and no network. It takes Vega-Lite, Vega or ECharts in, and
writes SVG, PNG (1–3x) and an optional offline interactive HTML page under `outputs/charts/`. The same input gives
the same bytes on the same platform, and the same picture on any: across platforms a coordinate can differ only in
its last digits. Nothing is ever loaded from the network.

Unofficial; not affiliated with OpenCode or Anomaly.

## Requirements

- OpenCode `>=2.2.3 <2.3.0`, tested on 2.2.3, 2.2.4, 2.2.5 and 2.2.6.
- macOS or Linux.
- No network, no system fonts and no provider: every render is local and deterministic.

- **Any chart.** 53 tested chart types:
  - statistical charts, facets, layers, dual axes and selections (Vega-Lite);
  - treemap, sunburst, tree, force network and word cloud (Vega);
  - Sankey, chord, gauge, funnel, calendar heatmap, candlestick, radar and parallel coordinates (ECharts);
  - world and US maps from bundled atlases.
- **Any theme.** `light`, `dark`, `high-contrast`, `print`, `presentation`, `toqan` and `toqan-night`, or your own tokens, saved by name. Palettes are colour-blind-safe and checked for contrast. Fonts are bundled (Inter, Geist, JetBrains Mono), so text measures and draws identically everywhere.
- **Right first time.**
  - Validation that teaches: `Field "revenu" is not in the data. Did you mean "revenue"?`, with the JSON path.
  - Lint for misleading or unreadable charts.
  - Overlap and clipping checks on the drawn chart.
  - The rendered PNG returned for the model to look at.
- **Safe.** No URLs, loaders or images. Workspace-confined paths, size and expression caps, and a worker with a time and memory limit.

```json
{ "plugin": ["@joe-broadhead/opencode-charts"] }
```

Options (all optional):

```json
{ "plugin": [["@joe-broadhead/opencode-charts", { "theme": "light", "locale": "en-GB", "outDir": "outputs/charts", "themes": { "acme": { "extends": "light", "colors": { "categorical": ["#0B5FFF", "#FF6A3D", "#00A87E"] } } } }]] }
```

Options, permissions, limits and errors are in
[docs/configuration.md](docs/configuration.md).

## Permissions

**Every tool is allowed by default.** The plugin inserts this block after each agent's base allow rule:

```json
[
  {"action": "charts_*", "resource": "*", "effect": "allow"},
  {"action": "charts_render", "resource": "*", "effect": "allow"},
  {"action": "charts_quick", "resource": "*", "effect": "allow"},
  {"action": "charts_validate", "resource": "*", "effect": "allow"},
  {"action": "charts_recommend", "resource": "*", "effect": "allow"},
  {"action": "charts_capabilities", "resource": "*", "effect": "allow"},
  {"action": "charts_catalogue", "resource": "*", "effect": "allow"},
  {"action": "charts_themes", "resource": "*", "effect": "allow"},
  {"action": "charts_theme_save", "resource": "*", "effect": "allow"}
]
```

So a render writes files into the project whenever an agent decides to, with no prompt; each tool still asks the host
for `read` on a data file and `edit` on its output folder.

To restrict, choose one of three:

1. **`access`**, one option for the plugin: `"all"` (the default), `"ask-changes"` (the five reads run, the writers
   ask) or `"read-only"` (the reads run, the writers are denied).
2. **An agent's own rules**, such as a drafts-only agent: `"permissions": [{ "action": "charts_*", "resource": "*",
   "effect": "deny" }, { "action": "charts_validate", "resource": "*", "effect": "allow" }]`.
3. **A per-tool rule** in your `opencode.json`: `{ "action": "charts_render", "resource": "*", "effect": "ask" }`, or
   `"deny"` to turn one tool off.

The last matching rule wins, so a later rule of yours still decides.

## Status

`/charts-status` shows the renderers, the defaults, the themes, the skills, the tools the agent can see, any agent
that would run the writers without asking, the OpenCode version and the next step.

## Tools

| Tool | What it does |
|---|---|
| `charts_render` | Any spec (Vega-Lite, Vega or ECharts, detected) plus `data` (`rows`, or a workspace `path` to CSV, TSV, JSON, JSONL or Parquet, with optional Vega-Lite `transform`s). Writes `<name>.svg`, `<name>.png` and `<name>.vl.json` (plus `.html` on request), and returns a markdown image line to show it inline. |
| `charts_quick` | `bar`, `horizontal_bar`, `grouped_bar`, `stacked_bar`, `line`, `area`, `stacked_area`, `scatter`, `bubble`, `pie`, `donut`, `histogram`, `box_plot` and `heatmap`, from field names. |
| `charts_validate` | The same checks as render, plus the PNG, with no files written. Also returns the figure tree: every label, its box, and which ones collide or run off the edge, with ids the preview numbers. |
| `charts_recommend` | Which chart fits a question, its data and its medium: a ranked shortlist with a reason each, the encoding to use, and a ready `charts_render` call on your own columns. Advises; it never renders. |
| `charts_capabilities` | Exactly what this build can do: engines, working output formats, themes and palette sizes, bundled fonts and the scripts they cover, data formats, limits, and what is known not to work. |
| `charts_catalogue` | Every chart type, and a working example of any. |
| `charts_themes` / `charts_theme_save` | List themes and their tokens; save a brand theme to `.charts/themes/<name>.json`. |

There is one list behind all of these: `src/registry.ts` defines each tool once, and the plugin's tool registration,
the Jelly declaration, the tools RPC and `docs/tool-parity.md` are projections of it. A test fails when they drift.

Example:

```json
{
  "spec": { "mark": "bar", "encoding": { "x": { "field": "region", "type": "nominal", "sort": "-y" }, "y": { "field": "revenue_eur", "type": "quantitative" } } },
  "data": { "path": "data/sales.csv" },
  "title": "Revenue by region, 2024",
  "theme": "toqan",
  "currency": "EUR",
  "locale": "de-DE"
}
```

In a spec, refer to the data as `{"name": "table"}` (or leave `data` out), to maps as `{"atlas": "world-110m"}`,
`"us-states-10m"` or `"world-land-110m"`, and to theme colours as `"theme:positive"`, `"theme:categorical.2"` and so on.

## Errors

Every error reads `CODE: what happened (at /json/path). Next step: what to do.` The code is also in the tool error's
metadata.

## Development

```bash
npm ci
npm run check              # typecheck, build, unit tests, shared copies, icons, package shape, pack, evals, host
bun scripts/gallery.ts /tmp/gallery     # 67 charts across all themes + contact sheets
bun eval/run.ts /tmp/eval  # 30 natural-language requests, checked
bun eval/recommend.ts /tmp/rec  # 21 advice cases against the committed baseline
bun eval/perf.ts           # timings
UPDATE_GOLDEN=1 bun test test/output.test.ts   # accept a reviewed change in output
```

A release is a `v<version>` tag on `master`: `.github/workflows/release.yml` checks, packs and publishes it to npm
with provenance, after approval in the `release` environment.

`node scripts/data.mjs` regenerates the locales and atlases, and `bun scripts/cookbook.ts` regenerates the cookbook
skill. Both outputs are committed.

Bundled fonts cover Latin, Greek and Cyrillic; a label beyond them gets `FONT_GLYPH_MISSING` and the fix is a font
file with `theme.font.files`. There is no PDF output and no Plotly or Mermaid input. `charts_capabilities` reports
the same list for the build you have, and [docs/status.md](docs/status.md) says what does not work and why.

See [DESIGN.md](DESIGN.md) for the design and its evidence, [docs/architecture.md](docs/architecture.md) for how
it is built, [docs/jelly.md](docs/jelly.md) for Jelly, and
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for licences: Vega and Vega-Lite (BSD-3-Clause), ECharts
(Apache-2.0), resvg (MPL-2.0), and the fonts (OFL-1.1).
