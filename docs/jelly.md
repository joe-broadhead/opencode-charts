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

12 tools are declared (5 read-only). Jelly's agents have no base "allow everywhere" rule, so this plugin's own
default rules, which it puts after that rule, never reach them. Jelly writes each declared `ask` or `deny` as that
tool's default instead (the person's own choice replaces it), and denies a read-only helper every tool not marked
`readOnly`.

- Ask: none. Every tool is allowed by default, in Jelly as in OpenCode, the seven that write files included:
  `charts.render`, `charts.quick`, `charts.update`, `charts.board`, `charts.table`, `charts.diagram` and
  `charts.theme_save` write charts, tables, diagrams and dashboards under `outputs/charts/` (or the folder a call names)
  and themes under `.charts/themes/`. They are declared not `readOnly`, so a read-only helper never gets them,
  **Ask before changes** asks for them and **Read only** denies them.
- Off: none.
- The other five, `charts.validate`, `charts.recommend`, `charts.capabilities`, `charts.catalogue` and
  `charts.themes`, write nothing and are declared `readOnly`.

Every call asserts its own action (`charts_render`, …) first; where that asks, "Always" allows the tool for the rest
of the session. Before it writes, a tool also asks the host for `edit` on its output folder, and before it reads a data file,
for `read` on that file, so the agent's own file rules apply as well.

Keep `jelly.tools` in step with the plugin's tools and default rules; `test/jelly.test.ts` checks each declared tool
and effect against them.

## Skills

Declared: `charts` (when and how to chart, and when to use code on the machine instead) and `charts-cookbook` (a
tested example for every chart type: a typed recipe document for the 14 standard types, a spec for the rest). `charts_recommend` advises on the choice and `charts_capabilities` reports what
this build can draw, so the agent asks rather than guesses. Jelly refuses an install whose skill ids collide with another plugin's or the
agent's own.

## Saved files and inline display

- A plugin cannot call `jelly_file_save` itself: that tool reaches the host through Jelly's own RPC. Every file under
  `outputs/` is kept when the turn settles, and each result also tells the agent how to save a file now.
- Each result carries a markdown line, `![title](outputs/charts/<name>.png)`, which Jelly draws inline. A chart
  document's files (and every `charts_update`) go into their own generation folder,
  `outputs/charts/<name>-<digest>/`, and the line points there.
- `formats: ["html"]` writes a self-contained page with no network access (CSP `default-src 'none'`), for Jelly's
  sandboxed HTML preview.

## Status

`/charts-status` posts the plugin's state into the session: the renderers, the defaults, the themes, the skills, the
tools the agent can see, any agent that would run the writers without asking (with the rules to paste), the OpenCode
version and the next step.

## Signing in

None. The plugin needs no account and calls no service.

## Views

None. The standalone offline HTML page is the interactive surface; a host view for charts is not part of this
plugin.

## Settings

`jelly.contributes.settings` declares one setting, `access`, the option of the same name, as a choice of three:
**Allowed** (`all`, the default), **Ask before changes** (`ask-changes`) and **Read only** (`read-only`), with Jelly's
own line for each. Jelly draws it as a choice, never as free text, and saves only one of the three. A Jelly that does
not know declared choices yet refuses the whole declaration, so this needs a Jelly that does.

The other options, `theme`, `locale`, `outDir` and `themes`, are not declared: they are set in `opencode.json`.

## Versions

Jelly's curated catalogue pins an exact version. Publish each release under a new version, so that a review in Jelly
can tell two releases apart.

The declaration test runs the shared kit, `test/support/jelly-kit.ts`, which checks the declaration and this page
against Jelly's plugin authors' standard. `scripts/check-copies.mjs` holds the kit equal to the copy every plugin
carries.
