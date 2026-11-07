# Status

The state of this tree, measured against what the plugin claims. It is written to be read by someone deciding whether
to depend on it, so it names what does not work as carefully as what does.

Last measured: 2026-11-07, on `feat/clearsight-rune-ideas` off `master` `1b0fa81`, macOS arm64, Node 22.23.2,
Bun 1.4.3. The overlap, clipping and font coverage figures come from the catalogue's own examples, rendered by
`test/output.test.ts`; the capability rows are what `charts_capabilities` returns for this build.

## Shipped

| Area | State |
|---|---|
| Engines | Vega-Lite 6.5 → Vega 6.4 in a worker; Vega 6.4; ECharts 6.1 server-side SVG. |
| Outputs | SVG, PNG at 1–3×, interactive HTML, and the resolved spec. |
| Chart types | 53, each with a working example that renders in the golden suite. |
| Themes | 7 built in (`light`, `dark`, `high-contrast`, `print`, `presentation`, `toqan`, `toqan-night`), plus saved and per-call themes; 5 `print`/`high-contrast` palettes, 20 for the rest. |
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
  the SVG, the PNG and the figure tree are the exact lane.
- **The word cloud places horizontal and vertical words only** (the deterministic replacement for Vega's canvas
  transform).
- **A palette distinguishes up to 20 series.** Past a theme's published colours the rest are generated: measured to at
  least 0.10 OKLab ΔE to twelve series and 0.06 to twenty, but not a tested colour-blind-safe set, and
  `charts_themes` says so.
- **`charts_recommend` reads English.** The task lexicon is English; a request in another language is not understood,
  and the tool says so (`unmatched`) rather than guessing. The locale data used for numbers and dates is separate and
  covers 59 locales.
- **The recommendation's draft is a draft.** For the types a builder covers it runs on the caller's own columns; for
  the rest it is the catalogue's example, labelled as such. It is never rendered before it is returned.
- **The tools RPC requires an allow rule for the three writers.** A script renders only as a session whose agent
  allows `charts_render`; an "Always allow" from an interactive session does not authorize a script. Deliberate.
- **Host support is declared `>=2.2.5 <2.3.0`.** The plugin's own host suite in this branch runs on 2.2.5.

## How this page is kept true

`test/registry.test.ts` fails when `docs/tool-parity.md`, the Jelly declaration, the default permission rules or the
README's tool table disagree with the registry. `charts_capabilities` computes the formats from the files actually
present, so a build that lost `resvg.wasm` reports `png: false` rather than claiming PNG. The known-limits list is one
array in `src/capabilities.ts`, returned to the agent and mirrored above by hand — the one pair in this repository that
a test does not compare, because it is prose.
