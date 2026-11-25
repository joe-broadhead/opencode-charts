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

### Removed since v0.0.8

The 12 tools and the two skills are unchanged; everything else a v0.0.8 user had is here unless listed below.

- **The `/charts-status` command.** Status is now the `charts.status` method/tool and the TUI status dialog (palette
  `/charts`); the command posted a preformatted text report that the contract's status answer replaces.
- **The `./gui-experimental` export and its GUI surface** (chart cards, code-block registries and actions, palette
  commands). The standard package exports are `./server` and `./tui`; the experimental GUI was dropped in this rebuild.
- **The `charts.tools` RPC and its `describe` diagnostics.** Every method is under the one `charts` RPC; `describe` is
  diagnostics only (contract §18), and the manifest and catalogue replace it.
- **The `charts.theme` RPC** (`sync`, `get`, `clear` and the `changed` event). The same calls are `charts.theme_sync`,
  `charts.theme_get` and `charts.theme_clear` in the one RPC; no bus event is emitted (the theme is session-local and
  read with `theme_get`), and `theme_sync` asks for confirmation.
- **The rich status fields** (`text`, `png`, `html`, `defaults`, `themes`, `tools`, `skills`). Status is the contract's
  `STATUS_SCHEMA` (`name`, `version`, `host`, `state`, `accounts`, `unguardedAgents`, `nextStep`); the TUI dialog
  formats that answer.
- **The old package declaration and the old `charts_*` default permission rules.** The `capabilities` manifest and the
  `charts.<method>` access rules replace them; the `access` option is unchanged.
- **The TUI's automatic theme push.** A host now calls `theme_sync` explicitly, with the contract's confirmation.
- **The old `.` and icon subpath exports.** `./server` and `./tui` are the package exports; the icons remain in the
  manifest and `assets/`.
