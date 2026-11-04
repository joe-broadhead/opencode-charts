# In Jelly

[Jelly](https://heyjelly.ai) runs OpenCode agents. It reads the `jelly` section of this package's `package.json` as
JSON, without loading the plugin, when a person reviews the exact version.

Jelly names the plugin **Charts** (`jelly.title`), with the package name and version beneath it.

## Tools and permissions

6 tools are declared (3 read-only).

- `charts.validate`, `charts.catalogue` and `charts.themes` change nothing.
- `charts.render`, `charts.quick` and `charts.theme_save` write files in the workspace: charts under `outputs/charts/`, themes under `.charts/themes/`. Before writing, each asks the host for `edit` on that folder, and before reading a data file it asks for `read` on that file, so the agent's own file rules apply.
- All six are declared `allow`, which writes nothing in Jelly. A read-only helper is denied the three that write.

## Skills

Declared: `charts` (when and how to chart, and when to use code on the machine instead) and `charts-cookbook` (a
tested spec for every chart type).

## Artifacts and inline display

- A plugin cannot call `jelly_artifact_save` itself: that tool reaches the host through Jelly's own RPC. Every file under `outputs/` is kept when the turn settles, and each result also tells the agent how to save a file now.
- Each result carries a markdown line, `![title](outputs/charts/<name>.png)`, for inline display.
- `formats: ["html"]` writes a self-contained page with no network access (CSP `default-src 'none'`), for Jelly's sandboxed HTML preview.

## Signing in

None. The plugin needs no account and calls no service.

## Views

None.

## Versions

Jelly's curated catalogue pins an exact version. Publish each release under a new version, so that a review in
Jelly can tell two releases apart.
