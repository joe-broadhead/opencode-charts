# Capabilities

Every method, source, action and bus event the manifest declares.

<!-- generated:capabilities -->
### Methods

| Method | Class | Accounts | Operations |
|---|---|---|---|
| `status` | read | none | — |
| `render` | write | none | `charts.render`, `file.read`, `file.write` |
| `quick` | write | none | `charts.quick`, `file.read`, `file.write` |
| `validate` | read | none | `charts.validate`, `file.read` |
| `update` | write | none | `charts.update`, `file.read`, `file.write` |
| `board` | write | none | `charts.board`, `file.read`, `file.write` |
| `table` | write | none | `charts.table`, `file.read`, `file.write` |
| `diagram` | write | none | `charts.diagram`, `file.read`, `file.write` |
| `recommend` | read | none | `charts.recommend`, `file.read` |
| `capabilities` | read | none | `charts.capabilities` |
| `catalogue` | read | none | `charts.catalogue` |
| `themes` | read | none | `charts.themes`, `file.read` |
| `theme_save` | write | none | `charts.theme_save`, `file.read`, `file.write` |
| `theme_sync` | write | none | `charts.theme_sync` |
| `theme_get` | read | none | `charts.theme_get` |
| `theme_clear` | write | none | `charts.theme_clear` |

### Sources

| Source | Kind | Reads or output | Method | Cost |
|---|---|---|---|---|

### Actions

None.

### Bus events

None.
<!-- /generated:capabilities -->

## The methods

- **`render`** draws any chart from a spec, a chart document or a saved artifact and writes the files it asks for.
- **`quick`** builds a standard chart from a type and field names, or a typed recipe document.
- **`validate`** runs the same checks and writes nothing.
- **`update`** changes a saved chart's presentation into a new generation folder.
- **`board`**, **`table`** and **`diagram`** draw their own product: a dashboard, a data-graphic table, a diagram.
- **`recommend`** ranks chart types for a question and data and never renders.
- **`capabilities`**, **`catalogue`** and **`themes`** describe the build and its themes; they write nothing.
- **`theme_save`** writes a named theme to `.charts/themes/<name>.json`.
- **`status`** is the contract's status answer for this plugin.
- **`theme_sync`**, **`theme_get`** and **`theme_clear`** are the host theme bridge: the theme a host shows, applied to
  this session's renders.

Every method is a tool in Code Mode and an RPC method under the one id `charts`; none is RPC-only and none is pinned.
`search({ namespace: "charts", query })` and the two skills find them.

## Classes

The contract's `export` class means data that leaves the provider. Charts has no provider and writes only local files,
so the seven file writers are `write`; the 4a registry called them `export`, and the manifest is the authority now. The
three theme methods are `write` because they change what later renders use, and they set `effect: "ask"` so they ask
even under `all`.

## Operations

For a local plugin the manifest's `operations` are the method's own action (`charts.<method>`) plus the host file rules
the handler asserts: `file.read` for an input a call names, `file.write` for the folder it writes. The exact paths — a
data file, a generation folder under `outDir`, `.charts/themes/<name>.json` — stay in the handler code and in the docs
that describe them; a JSON Schema operation cannot be a path glob.

## Sources, actions and bus events

Charts declares no source: it reads no feed and has no cursor. It declares no action: a file write is not a provider
action and needs no grant. It declares no bus event: the contract's `changed` names a source that changed, and Charts
has none for an app to re-read; a theme sync is session-local and a host reads it with `theme_get`. Writing files is
visible to the host directly.
