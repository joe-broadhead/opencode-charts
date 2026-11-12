# In Jelly

[Jelly](https://heyjelly.ai) runs OpenCode agents. It reads the `jelly` section of this package's `package.json` as
JSON, without loading the plugin, when a person reviews the exact version, and uses it as follows.

Jelly names the plugin **Charts** (`jelly.title`), with the package name and version beneath it. Under that name it
shows the one line in `jelly.summary`, and beside it the mark in `jelly.icon` (`assets/icon.svg`, shipped in the
package): Jelly reads that file once, when it records the plugin, and keeps it only if it is a clean SVG of drawing
elements, with no script, style, link or outside reference. `scripts/check-icons.mjs`, the family's icon check, runs
Jelly's own icon cleaner over it. A Jelly whose declaration schema lacks `summary` or `icon` refuses this declaration,
because that schema accepts no unknown keys.

## Tools and permissions

9 tools are declared (5 read-only). Jelly's agents have no base "allow everything" rule, so this plugin's own
default rules, which it puts after that rule, never reach them. Jelly writes each declared `ask` or `deny` as that
tool's default instead (the person's own choice replaces it), and denies a read-only helper every tool not marked
`readOnly`. A declared `allow` changes nothing in Jelly.

- Ask: `charts.render`, `charts.quick`, `charts.update` and `charts.theme_save`, which write files in the workspace:
  charts under `outputs/charts/` (or the folder a call names), themes under `.charts/themes/`.
- Off: none.
- Everything else runs: `charts.validate`, `charts.recommend`, `charts.capabilities`, `charts.catalogue` and
  `charts.themes`, which write nothing.

Every call asserts its own action (`charts_render`, …) first, and "Always" allows that tool for the rest of the
session. Before it writes, a tool also asks the host for `edit` on its output folder, and before it reads a data file,
for `read` on that file, so the agent's own file rules apply as well.

Keep `jelly.tools` in step with the plugin's tools and default rules; `test/jelly.test.ts` checks each declared tool
and effect against them.

## Skills

Declared: `charts` (when and how to chart, and when to use code on the machine instead) and `charts-cookbook` (a
tested spec for every chart type). `charts_recommend` advises on the choice and `charts_capabilities` reports what
this build can draw, so the agent asks rather than guesses. Jelly refuses an install whose skill ids collide with another plugin's or the
agent's own.

## Saved files and inline display

- A plugin cannot call `jelly_file_save` itself: that tool reaches the host through Jelly's own RPC. Every file under
  `outputs/` is kept when the turn settles, and each result also tells the agent how to save a file now.
- Each result carries a markdown line, `![title](outputs/charts/<name>.png)`, which Jelly draws inline.
- `formats: ["html"]` writes a self-contained page with no network access (CSP `default-src 'none'`), for Jelly's
  sandboxed HTML preview.

## Status

`/charts-status` posts the plugin's state into the session: the renderers, the defaults, the themes, the skills, the
tools the agent can see, any agent that would run the writers without asking (with the rules to paste), the OpenCode
version and the next step.

## Signing in

None. The plugin needs no account and calls no service.

## Views

None.

## Versions

Jelly's curated catalogue pins an exact version. Publish each release under a new version, so that a review in Jelly
can tell two releases apart.

The declaration test runs the shared kit, `test/support/jelly-kit.ts`, which checks the declaration and this page
against Jelly's plugin authors' standard. `scripts/check-copies.mjs` holds the kit equal to the copy every plugin
carries.
