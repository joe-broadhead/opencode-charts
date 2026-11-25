# Changelog

## 0.0.0 (2026-11-25)

The first release of Charts on plugin-contract v0, installable from
`github:we-the-rebel-alliance/charts-plugin#v0.0.0`.

- **16 methods through one `register`**: `render`, `quick`, `validate`, `update`, `board`, `table`, `diagram`,
  `recommend`, `capabilities`, `catalogue`, `themes`, `theme_save`, `status`, `theme_sync`, `theme_get` and
  `theme_clear`; every one is an agent tool, a Code Mode entry and an RPC method under the id `charts`.
- **Deterministic output**: Vega-Lite, Vega, ECharts, Observable Plot, tables and diagrams as SVG, PNG, GIF, offline HTML
  and editable `.chart.json` documents, drawn from bundled fonts and atlases with no network.
- **Chart documents**: typed recipes and engine charts, saved with a revision, replayed from their captured data, and
  revised presentation-first with `update` without changing what they show.
- **Access**: `all`, `ask-changes` and `read-only`; `theme_save`, `theme_sync` and `theme_clear` ask for confirmation.
- **Verified**: plugin-kit conformance T0 and T1 on OpenCode 2.4.1, unit, browser, eval, host and pack suites, and a
  recorded conformance fixture with the status answer and every non-read method's valid input.
