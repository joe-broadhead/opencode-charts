# Security

## Supported versions

Charts supports OpenCode `>=2.4.1 <2.5.0` and is tested on 2.4.1. Outside the range the plugin refuses to start with
`HOST_UNTESTED` and a next step, unless `options.allowUntestedHost` is true.

## Reporting a vulnerability

Report privately through GitHub's vulnerability reporting at
<https://github.com/we-the-rebel-alliance/charts-plugin/security/advisories/new>. Do not open a public issue for a
vulnerability. Include the version, your plugin options and the steps to reproduce. Never include a data file, a chart
or a credential.

## Data handling

- **No network.** Nothing is fetched: no URL, loader, image, CDN, font server or telemetry, at runtime or in an output.
  The bundled fonts, atlases and locales are the only data the renderer reads.
- **The workspace is the boundary.** A `data.path`, a `documentPath` or a theme's font file is resolved inside the
  session's workspace; `..`, an absolute path elsewhere, `~`, a URL, a device file, `.git` and a symlink that leads out
  are refused with their own code. Outputs are written under `outputs/charts/` (or the configured `outDir`), which is
  created when missing. A workspace theme and a saved theme are read only when a call needs them, each with `read`
  asked for that file.
- **A spec is code-shaped.** Vega-Lite, Vega and ECharts expressions run in a worker with a time and memory limit;
  Observable Plot runs against a headless document with a seeded random; tables and diagrams are measured and drawn
  in-process. None of them evaluates caller-supplied JavaScript.
- **No telemetry and no state outside the workspace.** The only files written are the output files and
  `.charts/themes/<name>.json` when a theme is saved. A host theme synced with `theme_sync` lives in memory, per
  session, and is never written to disk.
- **Untrusted input.** A data file's content is data, never an instruction; the namespace line says so, and no handler
  follows it.

## Permissions

`register` generates one rule per method after each agent's base allow. `all` runs the methods, `ask-changes` asks for
the writes, `read-only` denies them. `theme_save`, `theme_sync` and `theme_clear` ask even under `all`. Every call
passes one permission gate on `charts.<method>`; a handler also asserts the host's `read` and `edit` rules for the files
it touches. An output folder outside the project needs the host's own `external_directory` allow. A non-read method
over RPC needs a fresh permission ask or a host-signed action grant; a saved "Always allow" from a tool door is not a
confirmation.

## Determinism

Same spec, data, theme and seed give the same bytes on the same platform; across platforms every coordinate is equal to
ten significant digits. Trigonometry in sunburst arcs and map projections can differ in the last digits because
`Math.sin` and `Math.atan2` are the platform's.
