# Capabilities

Every method, source, action and bus event the manifest declares.

<!-- generated:capabilities -->
### Methods

| Method | Class | Accounts | Operations |
|---|---|---|---|
| `status` | read | none | — |
| `state` | read | none | `file.read` |
| `plan_render` | read | none | `charts.plan_render`, `charts.render`, `file.read` |
| `render` | write | none | `charts.render`, `file.read`, `file.write` |
| `plan_quick` | read | none | `charts.plan_quick`, `charts.quick`, `file.read` |
| `quick` | write | none | `charts.quick`, `file.read`, `file.write` |
| `plan_update` | read | none | `charts.plan_update`, `charts.update`, `file.read` |
| `update` | write | none | `charts.update`, `file.read`, `file.write` |
| `plan_board` | read | none | `charts.plan_board`, `charts.board`, `file.read` |
| `board` | write | none | `charts.board`, `file.read`, `file.write` |
| `plan_table` | read | none | `charts.plan_table`, `charts.table`, `file.read` |
| `table` | write | none | `charts.table`, `file.read`, `file.write` |
| `plan_diagram` | read | none | `charts.plan_diagram`, `charts.diagram`, `file.read` |
| `diagram` | write | none | `charts.diagram`, `file.read`, `file.write` |
| `plan_theme_save` | read | none | `charts.plan_theme_save`, `charts.theme_save`, `file.read` |
| `theme_save` | write | none | `charts.theme_save`, `file.read`, `file.write` |
| `plan_theme_sync` | read | none | `charts.plan_theme_sync`, `charts.theme_sync`, `file.read` |
| `theme_sync` | write | none | `charts.theme_sync`, `file.read` |
| `plan_theme_clear` | read | none | `charts.plan_theme_clear`, `charts.theme_clear` |
| `theme_clear` | write | none | `charts.theme_clear` |
| `validate` | read | none | `charts.validate`, `file.read` |
| `recommend` | read | none | `charts.recommend`, `file.read` |
| `capabilities` | read | none | `charts.capabilities` |
| `catalogue` | read | none | `charts.catalogue` |
| `themes` | read | none | `charts.themes`, `file.read` |
| `theme_get` | read | none | `charts.theme_get` |

### Sources

| Source | Kind | Reads or output | Method | Cost |
|---|---|---|---|---|
| `charts.state` | snapshot | `list` | `state` | free |

### Actions

None.

### Bus events

`rpc.charts.changed`
<!-- /generated:capabilities -->

## The methods

- **`render`** draws any chart from a spec, a chart document or a saved artifact and writes the files it asks for.
- **`quick`** builds a standard chart from a type and field names, or a typed recipe document.
- **`plan_render`**, **`plan_quick`**, **`plan_update`**, **`plan_board`**, **`plan_table`**, **`plan_diagram`**,
  **`plan_theme_save`**, **`plan_theme_sync`** and **`plan_theme_clear`** preview those writes: same input, no file or
  session change, a `planId` and the files/changes the commit will apply.
- **`validate`** runs the same checks and writes nothing.
- **`update`** changes a saved chart's presentation into a new generation folder.
- **`board`**, **`table`** and **`diagram`** draw their own product: a dashboard, a data-graphic table, a diagram.
- **`recommend`** ranks chart types for a question and data and never renders.
- **`capabilities`**, **`catalogue`** and **`themes`** describe the build and its themes; they write nothing.
- **`theme_save`** writes a named theme to `.charts/themes/<name>.json`.
- **`status`** is the contract's status answer for this plugin.
- **`state`** is the `charts.state` snapshot: the output files, the saved themes and this session's synced theme.
- **`theme_sync`**, **`theme_get`** and **`theme_clear`** are the host theme bridge: the theme a host shows, applied to
  this session's renders.

Every method is a tool in Code Mode and an RPC method under the one id `charts`; none is RPC-only and none is pinned.
`search({ namespace: "charts", query })` and the two skills find them.

## Classes

The contract's `export` class means data that leaves the provider. Charts has no provider and writes only local files,
so its nine writes are `write`; the 4a registry called them `export`, and the manifest is the authority now. Every write
has a `plan_<write>` read that previews it and a commit that takes the plan's id. The three theme writes set
`effect: "ask"` even under `all`.

## Operations

For a local plugin the manifest's `operations` are the method's own action (`charts.<method>`) plus the host file rules
the handler asserts: `file.read` for an input a call names, `file.write` for the folder it writes. The exact paths — a
data file, a generation folder under `outDir`, `.charts/themes/<name>.json` — stay in the handler code and in the docs
that describe them; a JSON Schema operation cannot be a path glob.

## Sources, actions and bus events

Charts declares one snapshot source, `charts.state`: the output files, the saved themes and the session's synced theme.
Every write emits `changed` for that capability, so an app re-reads it; there is no events source and no cursor. It
declares no action: a file write is local and is not a provider action. Writing files is visible to the host directly.

## Plan and commit

Each of the nine writes is a pair. The planning method (`plan_render`, `plan_quick`, `plan_update`, `plan_board`,
`plan_table`, `plan_diagram`, `plan_theme_save`, `plan_theme_sync`, `plan_theme_clear`) has the write's input, is class
`read`, and answers the preview fields `output` and `changes` without writing. Its commit (`render`, `quick`, `update`,
`board`, `table`, `diagram`, `theme_save`, `theme_sync`, `theme_clear`) takes exactly `{ planId }` and applies what the
preview showed. A plan commits once, for fifteen minutes, only through the method it names; a stale or reused id is
`PLAN_INVALID` or `PLAN_USED`. `validate` is a read-only dry run with no plan id.
