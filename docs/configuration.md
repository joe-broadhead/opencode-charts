# Configuration

Plugin ID: `charts`. Options live on the plugin's entry in `opencode.json`. Every key is optional; a key of the wrong
type is ignored and its default used.

```json
{
  "plugin": [["@joe-broadhead/opencode-charts", {
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
| `themes` | object of name to theme tokens | `{}` | Named themes, each with `extends` naming its base. A theme saved in the workspace (`.charts/themes/<name>.json`) wins over one of the same name here; a built-in name cannot be replaced. |

## Environment

| Variable | Default | Rule |
| --- | --- | --- |
| `CHARTS_RENDER_TIMEOUT_MS` | `10000` | The wall-clock limit of one Vega render, 1,000 to 60,000. |
| `CHARTS_IN_PROCESS` | unset | `1` renders Vega in the calling thread, for a host without worker threads. The time and memory limits then do not apply. |

## Permissions

The plugin puts a default block right after each agent's base `* * allow` rule:

```json
{ "action": "charts_*", "resource": "*", "effect": "ask" },
{ "action": "charts_validate", "resource": "*", "effect": "allow" },
{ "action": "charts_catalogue", "resource": "*", "effect": "allow" },
{ "action": "charts_themes", "resource": "*", "effect": "allow" }
```

So `charts_render`, `charts_quick` and `charts_theme_save`, which write files, ask, and any tool a later version adds
asks too; the three reads run. Every later rule wins, so your own `permissions` can allow the writers. An agent
without a base allow gets no block. `/charts-status` lists an agent that would run the writers without asking, with
the block to paste.

Each tool also asks for the files it touches: `read` on a data file, `edit` on the output folder or the theme file.

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
| `DATA_INVALID`, `DATA_MISSING`, `DATA_EMPTY`, `DATA_TOO_LARGE`, `DATA_FORMAT_UNKNOWN`, `TRANSFORM_INVALID` | The data or its transform; `DATA_EMPTY` is a table with no rows. |
| `PATH_INVALID`, `PATH_OUTSIDE_WORKSPACE`, `PATH_IS_URL`, `PATH_PRIVATE`, `FILE_NOT_FOUND`, `NOT_A_FILE` | A workspace path. |
| `THEME_NOT_FOUND`, `THEME_INVALID`, `THEME_CYCLE`, `THEME_NAME_INVALID`, `THEME_NAME_TAKEN`, `FONT_INVALID`, `FONT_TOO_LARGE` | A theme, a theme name, or its fonts. |
| `LOCALE_UNKNOWN`, `CURRENCY_UNKNOWN`, `ATLAS_UNKNOWN`, `CHART_TYPE_UNKNOWN`, `FIELD_MISSING`, `SIZE_INVALID`, `SCALE_INVALID` | A name or a value the call gives. |
| `PNG_UNAVAILABLE`, `PNG_TOO_LARGE`, `HTML_UNAVAILABLE`, `RENDER_FAILED` | A renderer. |
| `INPUT_INVALID` | The call does not match the tool's parameters. |
| `SKILLS_INVALID`, `STATUS_UNAVAILABLE` | Setup could not load a skill, or `/charts-status` could not be read (in the server log, or the session). |
