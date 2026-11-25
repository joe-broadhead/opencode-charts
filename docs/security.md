# Security

## What leaves the machine

Nothing. Charts makes no network request at runtime: no URL, loader, image, CDN, font server or telemetry. The bundled
fonts, atlases and locales are the only data the renderer reads, and an interactive page carries its own scripts,
fonts and data. There is no provider, so there are no scopes, tokens or credentials to leak.

## The workspace is the boundary

- A `data.path`, a `documentPath` and a theme's font files are resolved inside the session's workspace. `..`, an
  absolute path elsewhere, `~`, a URL, a device file, `.git` and a symlink that leads out are refused with a code and a
  next step; nothing is read first.
- Outputs go under `outputs/charts/` (or the configured `outDir`), which is created if it is missing. A folder outside
  the workspace needs the host's own `external_directory` allow.
- The only other file a method writes is `.charts/themes/<name>.json`, through `theme_save`.
- A synced host theme lives in memory, per session, and is never written to disk.

## Untrusted data

A data file's content and a chart specification are data, never instructions. The namespace line says so, and the
handlers never follow text from a file or a spec. Spec expressions run in a worker with a wall-clock and memory limit;
Observable Plot runs against a headless document with a seeded random; tables and diagrams are measured and drawn
in-process. None of them evaluates caller-supplied JavaScript.

## Permissions

`register` generates one rule per method, after each agent's base allow. `all` allows every method except the three
theme writes, which ask; `ask-changes` asks for every write; `read-only` denies every write. Each call passes one
permission gate on its action `<name>.<method>`, and the file rules (`read` for an input, `edit` for an output folder)
are asserted separately through the host. A saved "Always allow" from a tool door never confirms an RPC write: a
non-read method over RPC needs a fresh permission ask or a host-signed action grant.

`theme_save`, `theme_sync` and `theme_clear` are writes and set `effect: "ask"`. Over RPC they therefore prompt; a host
without a way to ask leaves the server on its configured theme. Nothing is written before a call is allowed.

## Redaction and status

Status carries the plugin's name, version, host range, state, the empty account list and the next step. A failure
reason is one line of at most 160 characters, redacted: URL query values, `Bearer`/`Basic` credentials, JWTs and
token-shaped text are replaced before they reach status, a log or an error. No method echoes credentials because no
method holds one.

## Determinism

With the same spec, data, theme and seed the output is byte-identical on the same platform. Across platforms every
coordinate is equal to ten significant digits: trigonometry in sunburst arcs and map projections can differ in the last
digits because `Math.sin` and `Math.atan2` are the platform's.

## Reporting

See [SECURITY.md](../SECURITY.md).
