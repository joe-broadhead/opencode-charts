# Changelog

## 0.0.0 (2026-11-25)

The first release of Charts on plugin-contract v0, installable from
`github:we-the-rebel-alliance/charts-plugin#v0.0.0`.

- **26 methods through one `register`**: eight reads (`status`, `state`, `validate`, `recommend`, `capabilities`,
  `catalogue`, `themes`, `theme_get`), nine plans (`plan_render`, `plan_quick`, `plan_update`, `plan_board`,
  `plan_table`, `plan_diagram`, `plan_theme_save`, `plan_theme_sync`, `plan_theme_clear`) and their nine commits
  (`render`, `quick`, `update`, `board`, `table`, `diagram`, `theme_save`, `theme_sync`, `theme_clear`); every one is
  an agent tool, a Code Mode entry and an RPC method under the id `charts`.
- **Deterministic output**: Vega-Lite, Vega, ECharts, Observable Plot, tables and diagrams as SVG, PNG, GIF, offline HTML
  and editable `.chart.json` documents, drawn from bundled fonts and atlases with no network.
- **Chart documents**: typed recipes and engine charts, saved with a revision, replayed from their captured data, and
  revised presentation-first with `update` without changing what they show.
- **Access**: `all`, `ask-changes` and `read-only`; `theme_save`, `theme_sync` and `theme_clear` ask for confirmation.
- **Changed nudges**: every write emits `changed` for the `charts.state` snapshot source (the output files, saved
  themes and the session theme).
- **Verified**: plugin-kit conformance T0 and T1 on OpenCode 2.4.1, unit, browser, eval, host and pack suites, and a
  recorded conformance fixture with the status answer and every non-read method's valid input.

### Removed since v0.0.8

The 12 chart tools and the two skills remain (each write is now a plan and a commit); everything else a v0.0.8 user had is here unless listed below.

- **The `/charts-status` command.** Status is now the `charts.status` method/tool and the TUI status dialog (palette
  `/charts`); the command posted a preformatted text report that the contract's status answer replaces.
- **The `./gui-experimental` export and its GUI surface** (chart cards, code-block registries and actions, palette
  commands). The standard package exports are `./server` and `./tui`; the experimental GUI was dropped in this rebuild.
- **The `charts.tools` RPC and its `describe` diagnostics.** Every method is under the one `charts` RPC; `describe` is
  diagnostics only (contract §18), and the manifest and catalogue replace it.
- **The `charts.theme` RPC** (`sync`, `get`, `clear` and its `changed` event). The same calls are `charts.theme_sync`,
  `charts.theme_get` and `charts.theme_clear` in the one RPC; there is no theme-specific event (the theme is
  session-local and read with `theme_get`), while any commit emits the contract's `charts.state changed`, and
  `theme_sync` asks for confirmation.
- **The rich status fields** (`text`, `png`, `html`, `defaults`, `themes`, `tools`, `skills`). Status is the contract's
  `STATUS_SCHEMA` (`name`, `version`, `host`, `state`, `accounts`, `unguardedAgents`, `nextStep`); the TUI dialog
  formats that answer.
- **The old package declaration and the old `charts_*` default permission rules.** The `capabilities` manifest and the
  `charts.<method>` access rules replace them; the `access` option is unchanged.
- **The TUI's automatic theme push.** A host now calls `theme_sync` explicitly, with the contract's confirmation.
- **The old `.` and icon subpath exports.** `./server` and `./tui` are the package exports; the icons remain in the
  manifest and `assets/`.
