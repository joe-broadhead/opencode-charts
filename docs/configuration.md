# Configuration

Plugin ID: `charts`. Options live on the plugin's entry in `opencode.json`. Every key is optional; a key of the wrong
type is ignored and its default used.

```json
{
  "plugins": [["github:joe-broadhead/opencode-charts#v0.0.3", {
    "theme": "light",
    "locale": "en-GB",
    "outDir": "outputs/charts",
    "themes": { "acme": { "extends": "light", "colors": { "categorical": ["#0B5FFF", "#FF6A3D", "#00A87E"] } } }
  }]]
}
```

## Options

| Key | Type | Default | Rule |
| --- | --- | --- | --- |
| `theme` | string | `light` | The theme of every chart whose call names none: a built-in theme, a saved one, or one from `themes`. |
| `locale` | string | `en-US` | Number and date formats, such as `en-GB` or `de-DE`. |
| `outDir` | string | `outputs/charts` | The workspace folder charts are written to when a call names none. It must stay inside the workspace. |
| `themes` | object of name to theme tokens | `{}` | Named themes, each with `extends` naming its base. A theme may also carry a host `seed` (the few colours a host knows) or paired `variants` (`{ "light": {…}, "dark": {…} }`). A theme saved in the workspace (`.charts/themes/<name>.json`) wins over one of the same name here; a built-in name cannot be replaced. |

## Themes

A theme resolves in this order: the call's own `theme`; the live theme synced with `charts.theme` for its session;
the live theme synced for the location; the plugin's `theme` option; the workspace's `.charts/theme.json`; then
`light`. The live store is in memory and never written to disk. `.charts/theme.json` is read only when the file
exists, when nothing earlier named a theme, and it takes the same tokens, `seed` or `variants` as any other theme.

A call's `theme`, an entry in the plugin's `themes`, and the workspace's `.charts/theme.json` may each be a seed:

```json
{ "theme": { "seed": { "background": "#FAF8F5", "foreground": "#1A1A18", "accent": "#C2410C", "font": "Geist, Inter, sans-serif" } } }
```

The seed may use `#hex`, `oklch(...)`, `oklab(...)`, `hsl(...)`, space-separated `rgb(...)`, `color(display-p3 ...)`
or a W3C DTCG `$value`. The build synthesises the grid, axis and muted hairlines, the ramps and a colour-blind-safe
categorical ring in OKLCH. `variants` carries explicit light and dark definitions instead; an adaptive SVG publishes
both and follows the reader's polarity.

## Environment

| Variable | Default | Rule |
| --- | --- | --- |
| `CHARTS_RENDER_TIMEOUT_MS` | `10000` | The wall-clock limit of one Vega render, 1,000 to 60,000. |
| `CHARTS_IN_PROCESS` | unset | `1` renders Vega in the calling thread, for a host without worker threads. The time and memory limits then do not apply. |

## Permissions

The plugin puts a default block right after each agent's base `* * allow` rule. Every tool is allowed by default, and
so is `charts_*`, so a tool a later version adds runs at once:

```json
[
  {"action": "charts_*", "resource": "*", "effect": "allow"},
  {"action": "charts_render", "resource": "*", "effect": "allow"},
  {"action": "charts_quick", "resource": "*", "effect": "allow"},
  {"action": "charts_validate", "resource": "*", "effect": "allow"},
  {"action": "charts_update", "resource": "*", "effect": "allow"},
  {"action": "charts_board", "resource": "*", "effect": "allow"},
  {"action": "charts_table", "resource": "*", "effect": "allow"},
  {"action": "charts_diagram", "resource": "*", "effect": "allow"},
  {"action": "charts_recommend", "resource": "*", "effect": "allow"},
  {"action": "charts_capabilities", "resource": "*", "effect": "allow"},
  {"action": "charts_catalogue", "resource": "*", "effect": "allow"},
  {"action": "charts_themes", "resource": "*", "effect": "allow"},
  {"action": "charts_theme_save", "resource": "*", "effect": "allow"}
]
```

The `access` option narrows it from each tool's class. `"all"` is the default, as above. `"ask-changes"` makes the
seven that write files — `charts_render`, `charts_quick`, `charts_update`, `charts_board`, `charts_table`,
`charts_diagram` and `charts_theme_save` — and any tool a later version adds ask, while `charts_validate`,
`charts_recommend`, `charts_capabilities`, `charts_catalogue` and `charts_themes` run. `"read-only"` denies those
seven writers and runs the five reads. The README prints the block for each value. Every later rule wins, so your own
`permissions` can allow or stop one tool. An agent without a base allow gets no block. `/charts-status` lists an
agent that is missing the block, so neither the default nor the `access` value reaches it, with the block to paste.

Each tool also asks for the files it touches: `read` on a data file, `edit` on the output folder or the theme file.
When the output folder is outside the project, OpenCode asks for `external_directory` on it as well, so allow the
folder too:

```json
{ "permissions": [{ "action": "external_directory", "resource": "/path/to/charts/*", "effect": "allow" }] }
```

A refusal that names `external_directory` costs nothing: nothing was read and nothing was written.

## Output files

A render makes every requested file, and the preview, in memory before it writes anything, so a failure while
preparing a format leaves the output folder as it was. The files are then staged beside their targets and moved into
place one by one; if a move fails, the files already moved are put back, the staging files are removed, and
`OUTPUT_WRITE_FAILED` names any file that could not be restored. Files the render does not name are never touched.

- The rollback is best-effort, within one process. Several renames cannot be made atomic together.
- A document call publishes as one immutable generation folder `<outDir>/<name>-<digest>/`, never as flat files, and a
  board writes `<name>.svg`, `<name>.png` and `<name>.board.html` beside each other.
- A table writes `<name>.svg` and `<name>.png`, and `<name>.html` when `html` is in the format list; a diagram
  writes `<name>.svg` and `<name>.png`, and returns its Unicode outline in the result.
- `formats: ["gif"]` writes `<name>.gif`: at most 60 frames, each at most 1280 × 960 pixels, with `fps` from 1 to 30
  (default 8). The PNG stays the final frame.
- Renders from different processes that write the same file names are not coordinated: there is no lock, so the last
  move wins file by file. Give concurrent renders different `name`s or `outDir`s.
- A crash or a killed process mid-write can leave hidden `.<file>.<token>.tmp` (staged bytes) or `.<file>.<token>.bak`
  (the previous version of a replaced file) in the output folder, such as `.revenue.svg.1a2b-3c4d5e6f7a8b.tmp`. They are
  never read back; delete them when no render is running.
- `charts_validate` writes nothing and creates no folder.

## Limits

| What | Limit |
| --- | --- |
| A spec | 512 KB, 40 levels deep, 20,000 array items and 20,000 objects, 400 expressions of at most 1,000 characters |
| Data | 100,000 rows; a data file at most 32 MB |
| Size | 20 to 4,000 pixels a side; a PNG at most 40 million pixels |
| Generated data | 20,000 generated rows, 250,000 estimated rows, 4,000,000 grid cells |

## Errors

Every error reads `CODE: what happened (at /json/path). Next step: what to do.` The code is also in the tool error's
metadata (`code`, `hint`, `path`).

| Code | When |
| --- | --- |
| `SPEC_INVALID`, `SPEC_UNSAFE`, `SPEC_TOO_LARGE`, `SPEC_TOO_EXPENSIVE` | The spec cannot render, would load something, or is too large or slow. |
| `INPUT_INVALID`, `OPTIONS_INVALID` | The call does not match the tool's parameters, or the plugin's options are not valid. |
| `INPUT_CONFLICT` | A chart call mixes input arms: a legacy spec (or quick's type and fields), `document` and `documentPath` are one per call. Nothing is read or written; the error says where each legacy field goes in a document. |
| `DATA_INVALID`, `DATA_EMPTY`, `DATA_TOO_LARGE`, `DATA_FORMAT_UNKNOWN`, `TRANSFORM_INVALID` | The data or its transform; `DATA_EMPTY` is a table with no rows. |
| `PATH_INVALID`, `PATH_OUTSIDE_WORKSPACE`, `PATH_IS_URL`, `PATH_PRIVATE`, `FILE_NOT_FOUND`, `NOT_A_FILE` | A workspace path. |
| `THEME_NOT_FOUND`, `THEME_INVALID`, `THEME_CYCLE`, `THEME_NAME_INVALID`, `THEME_NAME_TAKEN`, `FONT_INVALID`, `FONT_TOO_LARGE` | A theme, a theme name, or its fonts. |
| `LOCALE_UNKNOWN`, `CURRENCY_UNKNOWN`, `ATLAS_UNKNOWN`, `CHART_TYPE_UNKNOWN`, `FIELD_MISSING`, `SIZE_INVALID`, `SCALE_INVALID` | A name or a value the call gives. |
| `PNG_UNAVAILABLE`, `PNG_TOO_LARGE`, `HTML_UNAVAILABLE`, `RENDER_FAILED` | A renderer. |
| `HTML_RUNTIME_FAILED` | Shown in an interactive HTML page, not returned by a tool: the live chart did not start in the browser, so the page keeps the static chart and shows the failure with a short diagnostic. |
| `OUTPUT_WRITE_FAILED` | Writing the files failed; every file is made before any is written, and the error names any file that could not be put back as it was. |
| `SKILLS_INVALID`, `STATUS_UNAVAILABLE` | Setup could not load a skill, or `/charts-status` could not be read (in the server log, or the session). |
| `NO_MARK`, `NO_MARKS`, `NO_SERIES`, `DATA_TWICE`, `AXES_MISSING`, `SANKEY_CYCLE`, `SERIES_TYPE_MISSING`, `ECHARTS_COMPONENT_UNSUPPORTED`, `ECHARTS_MARKUP_REFUSED`, `UNKNOWN_MARK`, `UNKNOWN_CHANNEL`, `UNKNOWN_PROPERTY`, `UNKNOWN_TYPE`, `UNKNOWN_DATASET`, `UNKNOWN_FIELD`, `TYPE_MISMATCH`, `PIE_NEGATIVE`, `DATA_MISSING` | A spec or data problem that stops the render, reported inside `SPEC_INVALID` with its JSON path and a fix. |
| `DOCUMENT_INVALID`, `DOCUMENT_VERSION_UNSUPPORTED`, `DOCUMENT_REVISION_MISMATCH`, `DOCUMENT_DEPENDENCY_CHANGED`, `ARTIFACT_INVALID` | A chart document or a saved `.chart.json` artifact: its shape (with the JSON path), a version this build does not read, a revision that is stale or does not match the content, a custom font whose bytes changed, or a file that is not a chart artifact. |
| `AGGREGATION_REQUIRED`, `POSITION_MISSING`, `LAYOUT_UNSUPPORTED`, `INTERACTION_UNSUPPORTED` | A recipe document that cannot compile as written: several rows for one mark without `options.aggregate`, a temporal or numeric x missing, or a layout or interaction preset its chart kind does not support. |
| `LAYOUT_UNSATISFIABLE` | A recipe chart that cannot be drawn as asked: no layout candidate fits the outer size with every label and legend entry at or above the target's readability floor (or a font override is below it). The error lists the measured conflicts and alternatives; nothing is written. |
| `INTERACTION_FORMAT_MISMATCH` | A document asks for an interaction only the HTML page carries (an explicit tooltip, legend highlight, x zoom or a brush), and the explicit `formats` list has no `html`. Refused before any file is written. |
| `VALUE_MISSING`, `CATEGORY_COLOR_UNUSED` | A recipe warning: rows without a measure (left out and counted, never read as zero), or a category colour for a category the data does not have. |
| `EMPTY_DATA`, `NOT_A_DATE`, `DATE_AS_CATEGORY`, `MISSING_UNITS`, `TRUNCATED_AXIS`, `DUAL_AXIS`, `DUPLICATE_TICKS`, `UNSORTED_BARS`, `OVERPLOTTING`, `TOO_MANY_SERIES`, `PIE_TOO_MANY_SLICES`, `RAINBOW_SEQUENTIAL`, `LOW_CONTRAST`, `LABEL_COLLISION`, `LABEL_CLIPPED`, `LABEL_DENSITY`, `FONT_NOT_BUNDLED`, `FONT_GLYPH_MISSING`, `VEGA_LITE_WARNING`, `VEGA_WARNING` | A lint or drawing warning, returned with the result beside the chart. |
| `SIZE_OVERRIDE_IGNORED` | The spec's own `width` or `height` beats the tool's (the spec keeps precedence), or an ECharts size is not a pixel count; the warning names both values and the path, such as `/spec/width`. |
