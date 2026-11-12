# Status

The state of this tree, measured against what the plugin claims. It is written to be read by someone deciding whether
to depend on it, so it names what does not work as carefully as what does.

The overlap, clipping and font-coverage figures come from the catalogue's own examples, rendered by
`test/output.test.ts`; the capability rows are what `charts_capabilities` returns for a build. Where a number here
would go stale, the tool is the source of truth.

## Shipped

| Area | State |
|---|---|
| Engines | Vega-Lite 6.5 → Vega 6.4 in a worker; Vega 6.4; ECharts 6.1 server-side SVG. |
| Outputs | SVG, PNG at 1–3×, interactive HTML, the resolved spec, and the editable chart document (`.chart.json`). |
| Documents | `ChartDocumentV1` (version 1): 14 typed recipes and raw engine documents through `charts_quick`, `charts_render` and `charts_validate`; saved artifacts replayed by path; `charts_update` for presentation changes, published as immutable generation folders. |
| Layout | Recipe sizes are the outer canvas, exact in SVG and PNG; five target profiles with readable-label floors; a three-candidate planner shared by the server and the HTML page, which re-plans responsive charts at its container's width. |
| Interactions | In HTML: recipe tooltip, legend highlight, temporal x zoom and scatter/bubble interval brush (and the documented combinations); raw Vega-Lite and Vega selections and signals; ECharts tooltip and legend toggle. Each has a real-browser test under the page's CSP. |
| Chart types | 53, each with a working example that renders in the golden suite. |
| Themes | 5 built in (`light`, `dark`, `high-contrast`, `print`, `presentation`), plus saved and per-call themes; 5 `print`/`high-contrast` palettes, 20 for the rest. |
| Data | Inline rows; CSV, TSV, JSON, JSONL and Parquet files inside the workspace; Vega-Lite transforms. |
| Advice | `charts_recommend` over a traits table for all 53 types, graded by must/must-not cases. |
| Checks | Teaching validation, 12 lint rules, real label-collision and clipping measurement, duplicate ticks, WCAG contrast for theme palettes. |
| Scripts | The tools RPC v2.1, every tool a method with its class. |
| Determinism | SVG and PNG byte-exact on one platform; 10 significant digits across platforms. |

## What does not work, and why

- **No CJK, Hangul, Arabic, Hebrew or Devanagari glyphs.** The bundled fonts cover Latin, Greek and Cyrillic. A label
  beyond them gets `FONT_GLYPH_MISSING` naming each character, and the fix is a font file through `theme.font.files`
  (`.ttf` or `.otf`). Bundling a CJK subset is 1–3 MB a face against 0.25 MB of fonts today; it has not been decided.
- **No PDF, Plotly or Mermaid input.** PDF needs a new runtime dependency or a bespoke vector writer; Plotly needs a
  fake DOM and a partial bundle, which is a second engine; Mermaid needs a layout engine. All three are recorded as
  deliberate omissions, not gaps nobody noticed.
- **Interactive HTML differs from the SVG by a pixel or two of text layout.** The browser measures text its own way;
  the SVG, the PNG and the figure tree carry the exact promise.
- **The word cloud places horizontal and vertical words only** (the deterministic replacement for Vega's canvas
  transform). In interactive HTML the browser lays it out with Vega's own transform, so word positions can differ
  from the SVG and PNG.
- **Recipes cover the 14 quick-chart families only.** The other catalogue types are raw specs. An engine document
  keeps its native layout (`LAYOUT_UNSUPPORTED` for fixed or responsive), refuses the interaction presets and
  `categoryColors`, and keeps its own interaction syntax, which the plugin does not verify.
- **No series hiding, no export of the current browser view.** Legend highlight changes emphasis only; SVG and PNG
  always show the initial view. A responsive chart's height is fixed.
- **Browser and server text metrics differ.** A responsive chart in HTML follows the same layout policy and bounds as
  the server, not the same pixels.
- **A cosmetic update never refreshes data.** A changed source file needs a new document; an update draws the rows the
  artifact captured.
- **Agent success with documents is unmeasured.** The task corpus and its grading run in the evaluation harness with
  a scripted model; no live-model result exists yet (see `eval/README.md`).
- **ECharts has no zoom, brush, toolbox or timeline.** Those components are not in either ECharts runtime, so an
  option that uses one is refused with `ECHARTS_COMPONENT_UNSUPPORTED` and a next step; `charts_capabilities` lists
  the interactions interactive HTML does provide.
- **A palette distinguishes up to 20 series.** Past a theme's published colours the rest are generated: measured to at
  least 0.10 OKLab ΔE to twelve series and 0.06 to twenty, but not a tested colour-blind-safe set, and
  `charts_themes` says so.
- **`charts_recommend` reads English.** The task lexicon is English; a request in another language is not understood,
  and the tool says so (`unmatched`) rather than guessing. The locale data used for numbers and dates is separate and
  covers 59 locales.
- **The recommendation's draft is a draft.** For the types a builder covers it runs on the caller's own columns; for
  the rest it is the catalogue's example, labelled as such. It is never rendered before it is returned.
- **The tools RPC follows the same default.** Every method is allowed, so a script renders without a prompt; `access:
  "read-only"` denies the four writers, and a saved "Always allow" from an interactive session does not authorize a
  script.
- **Host support is `>=2.2.3 <2.3.0`, tested on 2.2.3, 2.2.4, 2.2.5 and 2.2.6.** The host suite runs on every one.

## Decisions that are not gaps

These are decisions, not gaps: each is deliberate, and `charts_capabilities` reports the same list.

- **CJK fonts are not in the main package.** If they are wanted later, they go in an optional fonts package, the
  family's optional-package pattern. Until then `charts_capabilities` states the coverage honestly — Latin, Greek and
  Cyrillic — and a label beyond it gets `FONT_GLYPH_MISSING`.
- **PDF is deferred**, because it would be the first runtime dependency. `capabilities.formats` does not advertise it.
- **Mermaid is deferred.** Rune's `crates/rune-mermaid` is the reference for a DOM-free layout later; Mermaid input is
  refused today, and the refusal is stated rather than hidden.
- **`opencode.host` is `>=2.2.3 <2.3.0`**, the family's line, and the host suite proves every tested release.

## How this page is kept true

`test/registry.test.ts` fails when `docs/tool-parity.md`, the Jelly declaration, the default permission rules or the
README's tool table disagree with the registry. `charts_capabilities` computes the formats from the files actually
present, so a build that lost `resvg.wasm` reports `png: false` rather than claiming PNG. The known-limits list is one
array in `src/capabilities.ts`, returned to the agent and mirrored above by hand — the one pair in this repository that
a test does not compare, because it is prose.
