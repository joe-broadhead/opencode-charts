# Status

The state of this tree, measured against what the plugin claims. It is written to be read by someone deciding whether
to depend on it, so it names what does not work as carefully as what it does.

The overlap, clipping and font-coverage figures come from the catalogue's own examples, rendered by
`test/output.test.ts`; the capability rows are what `charts_capabilities` returns for a build. Where a number here
would go stale, the tool is the source of truth.

## Shipped

| Area | State |
|---|---|
| Engines | Vega-Lite 6.5 → Vega 6.4 in a worker; Vega 6.4; ECharts 6.1 server-side SVG; Observable Plot 0.6 against a headless document; publication tables; Mermaid and structured diagrams. |
| Outputs | SVG, PNG at 1–3×, animated GIF, offline interactive HTML, a board's `.board.html`, the resolved spec, and the editable chart document (`.chart.json`). |
| Documents | `ChartDocumentV1` (version 1): 14 typed recipes and raw engine documents through `charts_quick`, `charts_render` and `charts_validate`; saved artifacts replayed by path; `charts_update` for presentation changes, published as immutable generation folders. `BoardDocumentV1` for `charts_board`. |
| Layout | Recipe sizes are the outer canvas, exact in SVG and PNG; five target profiles with readable-label floors; a three-candidate planner shared by the server and the HTML page, which re-plans responsive charts at its container's width. |
| Interactions | In HTML: recipe tooltip, legend highlight, temporal x zoom and scatter/bubble interval brush (and the documented combinations); raw Vega-Lite and Vega selections and signals; ECharts tooltip and legend toggle. Each has a real-browser test under the page's CSP. |
| Chart types | 79, each with a working example that renders in the golden suite: 26 Vega-Lite specs, 5 Vega specs, 12 ECharts options, 13 Plot specs, 14 recipe types, 2 tables and 7 diagrams. |
| Themes | 9 built in (`light`, `dark`, `geist`, `geist-dark`, `editorial-ft`, `editorial-economist`, `high-contrast`, `print`, `presentation`), plus saved, per-call and host-seeded themes. Published palettes are 5–8 colours and extend to 20; `print` and `high-contrast` are not extended. |
| Fonts | Four bundled families — Inter, Geist, JetBrains Mono and Geist Mono — covering Latin, Greek and Cyrillic, plus CSS comma stacks and workspace `.ttf`/`.otf` files. |
| Host theme | The Universal Host-Theme Contract: CSS Color 4 and DTCG `$value` normalisation, OKLCH and Machado-2009 CVD synthesis from a `seed`, paired `variants`, `.charts/theme.json`, the `charts.theme` live RPC, adaptive `--cs-*` SVGs and a `postMessage`/`MessagePort` HTML and board bridge. |
| Clients | `./tui` (`chart` and `charts-board` fences in Braille and Unicode, with live TUI theme sync) and `./gui-experimental` (`dist/gui.cjs`, chart cards in the Web and Desktop host, with live GUI theme sync). |
| Data | Inline rows; CSV, TSV, JSON, JSONL and Parquet files inside the workspace; Vega-Lite transforms. |
| Advice | `charts_recommend` over a traits table for all 79 types, graded by must/must-not cases. |
| Checks | Teaching validation, lint for misleading or unreadable charts, real label-collision and clipping measurement, duplicate ticks, WCAG contrast for theme palettes. |
| Scripts | The tools RPC v2.1, every tool a method with its class, and the `charts.theme` host-theme RPC. |
| Determinism | SVG and PNG byte-exact on one platform; 10 significant digits across platforms; a GIF is built from the same deterministic frames. |

## What does not work, and why

- **No CJK, Hangul, Arabic, Hebrew or Devanagari glyphs.** The bundled fonts cover Latin, Greek and Cyrillic. A label
  beyond them gets `FONT_GLYPH_MISSING` naming each character, and the fix is a font file through `theme.font.files`
  (`.ttf` or `.otf`). Bundling a CJK subset is 1–3 MB a face against 0.25 MB of fonts today; it has not been decided.
- **No PDF and no Plotly input.** PDF needs a new runtime dependency or a bespoke vector writer; Plotly needs a fake
  DOM and a partial bundle, which is a second engine. Both are recorded as deliberate omissions, not gaps nobody
  noticed.
- **Mermaid covers five diagram kinds.** `charts_diagram` draws `flowchart`/`graph`, `sequenceDiagram`,
  `stateDiagram-v2`, `classDiagram` and `erDiagram`, and the structured recipes cover `mindmap`, `org_chart`,
  `fishbone` and `architecture`. Other Mermaid kinds (`gantt`, `pie`, `journey`, `gitGraph`) are refused with the
  kinds that work rather than drawn badly.
- **Interactive HTML differs from the SVG by a pixel or two of text layout.** The browser measures text its own way;
  the SVG, the PNG and the figure tree carry the exact promise.
- **The word cloud places horizontal and vertical words only** (the deterministic replacement for Vega's canvas
  transform). In interactive HTML the browser lays it out with Vega's own transform, so word positions can differ
  from the SVG and PNG.
- **Recipes cover the 14 quick-chart families only.** The other 65 catalogue entries are not recipes: 56 are raw
  engine specs, 2 are tables and 7 are diagrams. An engine document keeps its native layout (`LAYOUT_UNSUPPORTED` for
  fixed or responsive), refuses the interaction presets and `categoryColors`, and keeps its own interaction syntax,
  which the plugin does not verify.
- **No series hiding, no export of the current browser view.** Legend highlight changes emphasis only; SVG and PNG
  always show the initial view. A responsive chart's height is fixed.
- **Browser and server text metrics differ.** A responsive chart in HTML follows the same layout policy and bounds as
  the server, not the same pixels.
- **A cosmetic update never refreshes data.** A changed source file needs a new document; an update draws the rows the
  artifact captured.
- **Agent success with documents is measured once.** One live baseline (`claude-agent/haiku`, 13 tasks × 3 trials):
  35 of 39 runs strict, 11 of 13 tasks strict in every trial. The misses are a narrow panel drawn wider than asked,
  and a presentation version made as a new chart instead of an update (`docs/engineering/charts-report.md`).
- **An authored ECharts `dataZoom`, `brush`, `toolbox`, `timeline` or `thumbnail` is refused in a static option.**
  Those components are not part of a static SVG; a `timeline` option is drawn as a story (one step per frame, plus a
  GIF) instead of a scrubber. `charts_capabilities` lists the interactions interactive HTML does provide.
- **A palette distinguishes up to 20 series.** Past a theme's published colours the rest are generated: measured to at
  least 0.10 OKLab ΔE to twelve series and 0.06 to twenty, but not a tested colour-blind-safe set, and
  `charts_themes` says so.
- **`charts_recommend` reads English.** The task lexicon is English; a request in another language is not understood,
  and the tool says so (`unmatched`) rather than guessing. The locale data used for numbers and dates is separate and
  covers 59 locales.
- **The recommendation's draft is a draft.** For the types a builder covers it runs on the caller's own columns; for
  the rest it is the catalogue's example, labelled as such. It is never rendered before it is returned.
- **The tools RPC follows the same default.** Every method is allowed, so a script renders without a prompt; `access:
  "read-only"` denies the seven writers, and a saved "Always allow" from an interactive session does not authorize a
  script.
- **Host support is `>=2.2.3 <2.3.0`, tested on 2.2.3, 2.2.4, 2.2.5 and 2.2.6.** The host suite runs on every one.

## Decisions that are not gaps

These are decisions, not gaps: each is deliberate, and `charts_capabilities` reports the same list.

- **CJK fonts are not in the main package.** If they are wanted later, they go in an optional fonts package, the
  family's optional-package pattern. Until then `charts_capabilities` states the coverage honestly — Latin, Greek and
  Cyrillic — and a label beyond it gets `FONT_GLYPH_MISSING`.
- **PDF is deferred**, because it would be the first runtime dependency. `capabilities.formats` does not advertise it.
- **Five Mermaid kinds are supported, the rest are deferred.** `charts_diagram` draws flowcharts, sequence, state,
  class and ER diagrams; `gantt`, `pie`, `journey` and `gitGraph` are outside its layout model and are refused with
  the kinds that work. Rune's `crates/rune-mermaid` remains the reference for a wider DOM-free layout later.
- **`opencode.host` is `>=2.2.3 <2.3.0`**, the family's line, and the host suite proves every tested release.

## How this page is kept true

`test/registry.test.ts` fails when `docs/tool-parity.md`, the Jelly declaration, the default permission rules or the
README's tool table disagree with the registry. `charts_capabilities` computes the formats from the files actually
present, so a build that lost `resvg.wasm` reports `png: false` rather than claiming PNG. The known-limits list is one
array in `src/capabilities.ts`, returned to the agent and mirrored above by hand — the one pair in this repository that
a test does not compare, because it is prose.
