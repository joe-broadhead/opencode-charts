# Configuration

The plugin's options are read from its entry in `opencode.json(c)`.

<!-- generated:configuration -->
| Option | Type | Default | Description |
|---|---|---|---|
| `access` | `all` \| `ask-changes` \| `read-only` | `"all"` | How much the plugin's methods may do. |
| `allowUntestedHost` | boolean | `false` | Start outside the tested OpenCode range. |
| `theme` | string | `"light"` | The theme every chart uses when a call names none. |
| `locale` | string | `"en-US"` | The locale numbers and dates are formatted in. |
| `outDir` | string | `"outputs/charts"` | The workspace folder files are written under. |
| `themes` | object | `{}` | Named themes from configuration, each a theme object with extends, colours and fonts. |
<!-- /generated:configuration -->

## Examples

A light default theme and a workspace folder:

```json
{
  "plugins": [
    ["github:we-the-rebel-alliance/charts-plugin#v0.0.0", { "theme": "light", "outDir": "charts" }]
  ]
}
```

Ask before any chart is written, and never write a saved theme:

```json
{
  "plugins": [
    ["github:we-the-rebel-alliance/charts-plugin#v0.0.0", { "access": "ask-changes" }]
  ]
}
```

A named theme from configuration, used with `theme: "acme"`:

```json
{
  "plugins": [
    [
      "github:we-the-rebel-alliance/charts-plugin#v0.0.0",
      { "themes": { "acme": { "extends": "light", "colors": { "accent": "#0b5fff" } } } }
    ]
  ]
}
```

`theme` and `locale` are the defaults every call may override. `outDir` is relative to the workspace; a folder outside
it is refused unless the host's `external_directory` rule allows it. A `themes` entry is the same theme object a call
may pass inline or `theme_save` may write.
