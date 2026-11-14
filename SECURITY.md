# Security

## Supported versions

Charts is tested on 2.2.3, 2.2.4, 2.2.5 and 2.2.6. Inside `>=2.2.3 <2.3.0` an untested patch release still starts and
status says the host is untested; outside the range the plugin reports `HOST_UNTESTED`.

## Reporting a vulnerability

Report privately through GitHub's vulnerability reporting on
<https://github.com/joe-broadhead/opencode-charts/security/advisories/new>. Do not open a public issue for a
vulnerability. Include the version, your plugin options and the steps to reproduce. Never include a data file, a chart
or a credential.

## Data handling

- **No network.** Nothing is fetched: no URL, loader, image, CDN or font server, at runtime or in an output. The
  bundled fonts, atlases and locales are the only data the renderer reads.
- **The workspace is the boundary.** A `data.path` is resolved inside the workspace; a path outside it, a URL, a
  device file or a dotfile is refused with `PATH_OUTSIDE_WORKSPACE`, `PATH_IS_URL` or `PATH_PRIVATE`. Outputs are
  written under `outputs/charts/` (or the configured `outDir`), which is created if it is missing. A workspace theme
  (`.charts/theme.json`) and a saved theme (`.charts/themes/<name>.json`) are read only when a call needs them, each
  with `read` asked for that file.
- **A chart spec is code-shaped.** Vega-Lite, Vega and ECharts expressions run in a worker with a time and memory
  limit; the expression and size caps are in `docs/configuration.md`. Observable Plot runs against a headless
  document with a seeded random; tables and diagrams are measured and drawn in-process, Mermaid source through
  `beautiful-mermaid`. None of them evaluates caller-supplied code.
- **No telemetry and no state outside the workspace.** The only files written are the output files, and
  `.charts/themes/<name>.json` when a theme is saved. A host theme synced through `charts.theme` lives in memory only,
  per session and for the location, bounded to 256 sessions, and is never written to disk.
- **Untrusted input.** A data file's content is data, never an instruction; the tools describe it that way and the
  namespace text says so.

## Permissions

**Every tool is allowed by default.** The plugin inserts a block after each agent's base allow that allows all twelve
tools, so an agent can write chart, table, diagram and board files into the project, and save a theme, with no prompt.
The `access` option restricts that in one line (`"ask-changes"` asks for the seven writers, `"read-only"` denies
them), and a per-tool rule does it for one tool. Each tool asserts its own action and the file rules inside `execute`,
because the host asserts nothing for a plugin tool by itself. An output folder outside the project needs an
`external_directory` allow as well
(`{ "action": "external_directory", "resource": "/path/to/charts/*", "effect": "allow" }`); a refusal that names it
costs nothing, because nothing was written.

## Host themes and HTML

A host theme is data, not code. The `charts.theme` RPC accepts a theme name or a plain object, checks it against the
same typed definition as an inline theme before storing it, and holds it in memory. A colour function the build cannot
parse is refused with `THEME_INVALID` at its path. A seed is normalised to hex once, so a spec never receives an
uninterpreted colour string.

An output that carries text — an interactive HTML page, a board page, a table or a diagram — serialises every font
stack through one CSS-string function, which hex-escapes quotes, backslashes, angle brackets and control characters.
A theme or a font name therefore cannot close its CSS string, its rule or its `<style>` element. The interactive pages
keep their CSP: `default-src 'none'`, no `unsafe-eval`, and a `script-src` of the hashes of exactly their own scripts.
An HTML or board page accepts a live theme over `postMessage` or a transferred `MessagePort` only from itself or its
parent, ignores a numbered message that arrives after a later one, and applies only the tokens it can read; a malformed
message changes nothing.

## Scripts

The tools RPC (`charts.tools`) resolves the rule before dispatch, from a prior explicit allow only: an `ask` is refused
with no prompt and no call, and a `deny` is refused. The default allow *is* that allow, so a script can call every
method unless the user restricts it with `access` or an agent rule. A saved "Always allow" does not authorize an
ad-hoc script. The shared module is pinned by `scripts/check-copies.mjs`; do not edit its shared part here.
