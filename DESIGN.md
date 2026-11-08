# opencode-charts — design

An OpenCode plugin (and Jelly plugin) that turns a chart spec into themed, checked, deterministic files: SVG, PNG at
1–3x, optional self-contained interactive HTML, and the resolved spec. It is the *deterministic* way to chart; an
agent can still write matplotlib or plotly on its machine for bespoke analysis. Both end as files under `outputs/`,
which Jelly keeps as saved files.

## 1. What came before: open-cowork's chart MCP

Read at `joe-broadhead/open-cowork@master` (shallow clone).

**What it did.**
- `mcps/charts/` was a stdio MCP server (`src/index.ts`) with 9 template tools in `src/basic-tools.ts` (bar, line, area, scatter, pie, histogram, heatmap, boxplot, map) and 10 more in `src/advanced-tools.ts` (funnel, waterfall, bump, streamgraph, calendar heatmap, bullet, candlestick, sankey, mermaid, `custom_spec`).
- Every tool returned **a spec as text** (`src/chart-results.ts` `vegaResult`): `{"type":"vega-lite","spec":…}`. The tools never rendered anything.
- The desktop app rendered the spec:
  - statically with Vega's `toSVG` in the Electron main process (`apps/desktop/src/main/chart-renderer.ts`);
  - interactively in a sandboxed iframe with vega-embed (`apps/desktop/chart-frame.html`, `packages/app/src/chart-frame.ts`).
- PNGs were captured **client-side** from vega-embed and written per session (`apps/desktop/src/main/chart-artifacts.ts`, "captured client-side (vega-embed's `view.toImageURL`)").
- Safety came in two passes:
  - `mcps/charts/src/schemas.ts` and `packages/shared/src/chart-spec-safety.ts`: byte, array and depth caps, `url`/`href`/`src` refused, image marks refused;
  - `apps/desktop/src/main/chart-spec-safety.ts`: a static cardinality bound on the compiled Vega spec (audit #865).

  `chart-renderer.ts` also gives Vega a loader that refuses every load.
- The tests drove the Electron app:
  - `apps/desktop/tests/chart-render.smoke.test.ts` and `artifact-chart-render.eval.test.ts`: an inline spec renders, a `data.url` spec is refused;
  - `agent-chart-regression.smoke.test.ts`: the chart agent and skill survive a runtime rebuild.
- `skills/chart-creator/SKILL.md` taught chart choice and data rules.
- `THIRD_PARTY_LICENSES/vega@6.2.0/` and `vega-lite@6.4.3/` carry the BSD-3 texts.

**What worked, and is carried over.**
- Vega-Lite as the grammar.
- The safety model, ported almost line for line into `src/safety.ts`:
  - the refused resource keys;
  - the image-mark ban;
  - the static cardinality guard, with its allow-list of row-safe transforms and its bounds on `sequence`, `fold`, `flatten`, density, quantile and grid transforms;
  - the deny-all loader;
  - the post-render SVG check.
- The field-escaping lesson in `advanced-tools.ts` `vegaField`: never interpolate field names into expressions.
- Date-only temporal polish and calendar ordering of months and weekdays (`src/chart-utils.ts`).
- The skill's data rules: chronological time, units, no invented rows, bars for ranking, pies for few parts.

**What is dropped, and why.**

| Dropped | Why | Replaced by |
|---|---|---|
| Specs returned as text for a client to render | A plugin in Jelly has no client renderer of its own. PNG capture in a browser is not deterministic across machines. | The plugin renders headless and writes files. |
| One tool per template (19 tools) | Every chart cost the model a tool choice, and `custom_spec` was the escape hatch anyway. | One `charts_render` for any spec; `charts_quick` for the basics; a catalogue of 53 tested examples the agent adapts. |
| `mermaid` | It needs a DOM to render, so it is not a chart engine for this plugin. | Left to whichever surface renders Mermaid. |
| The ad-hoc dark map colours, `scheme: 'plasma'` promotion, `',.2f'` on every number | They fought the theme, and two decimals on every number reads badly. | Theme tokens and smart formats. |
| The timeout race in `chart-renderer.ts` | Its own comment (audit #865) says a timer cannot interrupt Vega's synchronous dataflow. | A worker thread with a hard wall-clock limit and a heap cap (`src/engines/vega-pool.ts`). It is tested: a 6-million-row `impute` is killed after 1.5 s and the next render works (`test/safety.test.ts`). |

## 2. How the owner's plugins are built (and how this one follows)

Read on the `jelly` branches of `opencode-tavily` (fe5ba2b), `opencode-utilities` and `opencode-gws` (ee21aa2).

- **Package.** Each is published as `@joe-broadhead/opencode-<name>`, `type: module`, with `exports["."] = ./dist/index.js`. `files` is a whitelist, and there are no install scripts. `opencode.host` is an exact minor range (`>=2.2.3 <2.3.0`). All dependencies are devDependencies and bundled.
- **Entry.** `Plugin.define({ id, setup(ctx) })` (utilities `src/index.ts`, `src/host/plugin.ts`). Tools come from `ctx.tool.transform` with `editor.namespace` and `editor.add({ name, description, input: zod, options: { namespace, permission } })` (utilities `src/host/tools.ts`).
- **Behaviour.**
  - Skills come from `skills/<id>/SKILL.md` through `ctx.skill.transform` (utilities `src/host/skills.ts`).
  - File effects assert the host's own `read` and `edit` actions (utilities `src/runtime/permissions.ts`).
  - Errors read `CODE: what happened. Next step: what to do.` (Jelly's plugin authors' standard, item 8).
- **Build.** esbuild bundles each output to one self-contained file that imports only `node:` modules and `@opencode/plugin`; the build fails otherwise (tavily `tools/build.mjs`).
- **Branches.** One branch: releases are cut from a `v<version>` tag on the default branch, `master`. (The `jelly` branches read above were merged into each default branch and retired on 6 November 2026; tag `jelly-retired` keeps each old head.)

**This repo follows all of it**, with two deliberate differences:

1. **Data files in `dist/`.** Besides `index.js`, `dist/` has `vega-worker.js` (a worker needs its own file), `resvg.wasm` and `browser/{vega,echarts}.js` (inlined into HTML, never loaded by the plugin). The build compiles each file's SHA-256 into `index.js`, so a stale or swapped sibling is refused rather than used. This answers the same in-place-update concern that makes the owner keep `dist/` to one file.
2. **Minified bundles.** The bundles are minified with names kept: three chart engines would be 4.5 MB unminified.

The plugin is MCP-free: an OpenCode plugin's own tools need no server process. There are no sign-ins.

## 3. Jelly's contract

From hey-jelly's plugin contract.

- **Declaration.**
  - `protocol/contracts/src/plugin-contract.ts` `PluginDeclarationSchema`: `title` (≤60), `tools[] {name, permission, effect, readOnly}`, `skills`, `rpc`, `views`, `signIns`, `contributes`. It is `.strict()`, so unknown keys are refused.
  - `summary` and `icon` are not in this checkout's schema yet; a later contract version adds them.
  - The owner's plugins already declared them on their `jelly` branches (now merged into each default branch), and so does this one: `jelly.summary` is "Charts, maps and diagrams…" and `jelly.icon` is `assets/icon.svg`, a clean SVG of `rect`, `path` and `circle` only, checked by `test/plugin.test.ts`.
  - **Jelly hard-codes nothing:** the title, summary and icon all come from the package.
- **Sign-ins.** `plugin-sign-ins.ts`: none declared (`signIns: []`).
- **Effects.** `docs/architecture/tools-and-connections.md` §npm plugins: a declared `ask`/`deny` becomes the tool's default on Jelly agents, and a declared `allow` writes nothing. Read-only helpers are denied every tool not marked `readOnly`. So `validate`, `catalogue` and `themes` are `readOnly: true` and `allow`, and `render`, `quick` and `theme_save` (which write files) are not read-only and are `ask`, as the plugin authors' standard requires of every local file write. The plugin's own default block (`src/permissions.ts`) gives the same effects in plain OpenCode, and each call asserts its own action so an `ask` prompts.
- **Saved files.** Jelly's `jelly_file_save` (called `jelly_artifact_save` until Jelly's rd266) reaches the host through the `jelly.core` RPC, which only Jelly's first-party plugin family can use. **A third-party plugin cannot save a file itself.** It does not need to: `docs/architecture/protocol.md` ("A file the agent wrote under `outputs/` in its workspace is kept when the turn settles") makes every file under `outputs/charts/` a saved file. The tool result also says how to save one now: "save it with your host's file-saving tool (in Jelly: `jelly_file_save` with the path)". OpenCode 2.2.5 has `ctx.experimental.artifact`, but the owner's plugins forbid it (utilities `AGENTS.md` Forbidden list), and Jelly's saved files are Jelly's own.
- **Inline display.** Workspace images by markdown and sandboxed self-contained HTML with no network are planned; this version ships the PNG and the SVG.
  - Every result carries `markdown: "![title](outputs/charts/<name>.png)"`. The PNG is pixel-exact everywhere; SVG text depends on the viewer's fonts unless `svgText: "paths"` or `"embed"` is used.
  - The HTML has a CSP of `default-src 'none'`, inlined runtimes and data-URL fonts, and the static SVG as its first paint, so a frame that runs no script still shows the chart.

## 4. Engines: coverage, quality, footprint

| Need | Engine | Evidence |
|---|---|---|
| Statistical charts: bar, grouped and stacked, line, area, scatter, bubble, histogram, density, box, heatmap, layers, facets, dual axis, selections, maps | **Vega-Lite 6.5** compiled to Vega 6.4 | The grammar the owner used before; 40 catalogue types. |
| Layouts Vega-Lite cannot express: treemap, sunburst, tree or dendrogram, force network, word cloud | **Vega 6.4** | 5 catalogue types. Vega's own `wordcloud` needs a canvas and throws in Node (`vega-wordcloud.js:102`, `canvas.height = 1` on null); it is replaced by a deterministic drop-in transform with the same parameters (`src/engines/wordcloud.ts`). |
| Gaps: Sankey, chord, gauge, funnel, calendar heatmap, candlestick, radar, parallel coordinates | **ECharts 6.1** server-side SVG (`init(null, theme, {ssr: true, renderer: "svg"})`, no DOM) | Vega templates exist for some of these (open-cowork's `sankey.ts` was 324 lines of hand layout), but ECharts' layouts are mature, and its SSR renderer measures text through a pluggable API (`setPlatformAPI({measureText})`), so it shares the bundled font metrics. Tree-shaken to the 20 series and 17 components used: 906 KB minified. Determinism: its `zrN-` id and class counters are global, so ids are renumbered per chart. |

Rejected:
- A browser (Puppeteer or Playwright): it brings a hundred megabytes and a process to supervise.
- node-canvas: a native build per platform, and system fonts.
- Mermaid: it needs a DOM.

## 5. Rendering

- **SVG.** Vega's `View.toSVG()` with `renderer: "none"` and the deny-all loader, running in the worker; then ECharts `renderToSVGString()`.
- **Fonts, identical everywhere.**
  - Bundled: Inter (Regular, SemiBold), Geist (Regular, Medium) and JetBrains Mono, subset to Latin, Greek and Cyrillic with **OpenType layout features removed**. A string's width is then exactly the sum of its advances.
  - Vega's documented user hook (`textMetrics.width`, as vl-convert uses) and ECharts' `measureText` both measure with tables parsed from those files (`src/fonts.ts`). resvg draws with the same files and never reads a system font.
  - `test/output.test.ts` checks that the drawn width equals the measured width within 1.5 px over 35-character strings for every face. A subsetting bug that the test caught: name ID 16 had been dropped, so SemiBold drew as Regular.
- **PNG.** `@resvg/resvg-wasm` 2.6.2 (MPL-2.0), wasm, not the native prebuild. The wasm is 2.4 MB, one file for linux-x64, linux-arm64 and macOS; each native prebuild is 3.5–4.4 MB (`@resvg/resvg-js-linux-x64-gnu` 4.38 MB, `darwin-arm64` 3.54 MB) and needs per-platform optional dependencies with glibc/musl selection. Speed is fine: passing only the faces an SVG uses (resvg parses every buffer it is given: 5 faces cost 232 ms, 2 faces 66 ms) puts a 2x PNG at about 60 ms.
- **HTML.** The compiled Vega spec with an inlined Vega and vega-tooltip runtime (541 KB), or the ECharts option with an inlined ECharts runtime (891 KB). The compact number format is inlined by its source text, so labels format the same as in the SVG.
- **Determinism.** The same input gives byte-identical SVG on one platform (`test/output.test.ts` "determinism"). Across platforms, a coordinate computed with trigonometry (sunburst arcs, map projections) can differ in its last digits, because `Math.sin` and `Math.atan2` come from the platform: CI on Linux and Intel macOS gave `66.29585392720162` where macOS arm64 gives `…165`. The golden test is therefore byte-exact where the goldens were made, and elsewhere equal with every number to 10 significant digits:
  1. Vega mutates input rows in place (a force layout's second run starts from the first run's positions), so every render deep-clones its input.
  2. Ids and ECharts classes are renumbered in order of appearance, under a content-hash prefix, so they are stable, and two charts on one page never collide.
  3. Layouts are seeded (`seed`, default 1).
  4. Every temporal scale and time unit is forced to UTC, so the host's time zone cannot shift a date.
  5. No timestamps are written.
- **Accessibility.** Each SVG gets `role="img"`, `<title>`, `<desc>` and `aria-labelledby`. The description is generated from the encoding and the data ("Bar chart of Revenue (€) by Region. Highest: North (1,250,000); lowest: West (410,000).") and is returned to the agent as text. Vega's per-mark ARIA labels stay.

## 6. Safety (`src/safety.ts`, `src/paths.ts`, `src/engines/vega-pool.ts`)

1. Before compiling:
   - spec ≤ 512 KB, ≤ 20,000 array items, ≤ 20,000 objects, depth ≤ 40;
   - `url`, `href`, `src`, `link`, `sublink`, `loader` and `backgroundImage` refused anywhere (except `{"atlas": …}`, which the plugin resolves to bundled data);
   - external-looking strings (`http:`, `//`, `file:`, `javascript:`, `image://`, non-SVG `data:`) refused outside data rows;
   - image marks and ECharts image graphics refused, and so are `custom` series (they need functions) and `map`/`geo` (use the atlases);
   - expressions ≤ 1,000 characters, ≤ 400 per spec.
2. On the compiled Vega spec: open-cowork's cardinality guard. It is extended to accept Vega-Lite's own facet `sequence`s, whose stop is a `length(data(...))` count; `impute` is left to the worker, because its cost is data-dependent.
3. In the worker:
   - a wall-clock limit (default 10 s, `CHARTS_RENDER_TIMEOUT_MS`) and a 256 MB heap cap;
   - a runaway render is terminated and the worker replaced (`data.transform` runs there too);
   - jobs are tied to their worker, so one worker's exit never fails another's jobs (a bug the test found).
4. On output: no `<image>`, `<foreignObject>`, `<script>`, `<iframe>`, event attributes or external `href`.
5. Files:
   - `data.path`, theme font files and `outDir` must resolve inside the session directory or the project directory, after following links;
   - `~`, `..`, absolute paths elsewhere, URLs and `.git/` are refused;
   - data ≤ 100,000 rows and ≤ 32 MB; PNG ≤ 40 M pixels.
6. Permissions. Reads assert the host's `read`, and writes assert `edit` on `outputs/charts/*`, so OpenCode's and Jelly's file rules apply as they do to the agent's own file tools.

## 7. Agents get it right first time

- **Teaching validation** (`src/engines/vegalite.ts`, `vega.ts`, `echarts.ts`). Every problem is listed at once, with a JSON pointer and a fix. For example: `UNKNOWN_FIELD at /encoding/y/field: Field "revenu" is not in the data. Did you mean "revenue"? The fields are: region, revenue. Fix: Set field to "revenue".` Fields created by transforms count.
  - Also covered: unknown marks, channels, types and top-level keys (did-you-mean); type aliases (`Q`, `category`); text encoded as a number; an undefined Vega dataset; an unknown ECharts dimension; a Sankey cycle; missing axes.
- **Lint.** Each lint warning carries a fix:
  - `PIE_TOO_MANY_SLICES`, `PIE_NEGATIVE`, `TOO_MANY_SERIES`;
  - `TRUNCATED_AXIS` (a bar or area axis that does not start at zero), `RAINBOW_SEQUENTIAL`, `OVERPLOTTING`;
  - `MISSING_UNITS`, `UNSORTED_BARS`, `DATE_AS_CATEGORY`, `DUAL_AXIS`, `LOW_CONTRAST` (WCAG);
  - from the drawn SVG: `LABEL_COLLISION` (separating-axis test on rotated label boxes), `LABEL_CLIPPED` and `DUPLICATE_TICKS`.
- **Inspect.**
  - `charts_validate` returns the rendered PNG to the model as a tool `file` part. OpenCode's own `@opencode/plugin-browser@2.2.5` does the same for screenshots (`dist/tools.js` `exportResult`: `{type: "file", uri: "data:image/png;base64,…"}`).
  - `charts_render` returns it when there are warnings, or with `inspect: true`.
  - Layout facts (labels, overlaps, clipped) are always in the result.
- **Smart defaults.** Each fills only a gap the spec left; the result's `notes` say what was applied.
  - **Numbers.** Locale formats from d3's locale data (56 number locales, 35 time locales). Currency by ISO code in compact form (`1,2M €` in de-DE). Values ≥ 10,000 are shown compactly (k, M, B). `_pct` and `_share` fields between 0 and 1 are shown as `%`.
  - **Axis titles from field names, with units.** `revenue_eur` becomes "Revenue (€)".
  - **Category labels.** Long or crowded labels are angled before they collide (measured with the real font). Months and weekdays are sorted in calendar order.
  - **Sizing and ticks.** Discrete axes are sized to their category count; tick counts follow the plot size.
  - **Baselines.** Lines and points get no forced zero when the data sits far from it; bars keep zero.
  - **Legends.** A legend of more than 8 entries moves below the chart in columns.
- **Data in.**
  - Inline rows.
  - A workspace CSV, TSV, JSON, JSONL or **Parquet** file. Parquet uses hyparquet, pure JS with no dependencies, about 50 KB in the bundle.
  - A Vega-Lite transform pipeline (`filter`, `calculate`, `aggregate`, `window`, `pivot`, `fold`, …) run through Vega's own dataflow.
- **Knowledge.**
  - The `charts` skill: when to use which tool, the workflow, and the plugin versus machine libraries.
  - The `charts-cookbook` skill: generated from the catalogue by `scripts/cookbook.ts`, so every snippet is a tested example.
  - `charts_catalogue` returns any example as a working call.

## 8. Themes

- **Tokens** (`src/themes/tokens.ts`):
  - colours: background, text, muted, grid, axis; categorical, sequential and diverging palettes; positive, negative, neutral and highlight;
  - fonts: family, mono, sizes, title weight, and workspace font files;
  - layout, axis, marks and legend.
- **One token set, three adapters** (`src/themes/adapters.ts`): the Vega-Lite config, the Vega config and the ECharts theme. A brand looks the same in every chart type.
- **Built-in themes.** Palettes are published colour-blind-safe sets: Paul Tol "bright", Okabe–Ito (its yellow, 1.3:1 on white, swapped for Tol's wine), ColorBrewer RdBu, viridis. Every built-in passes its own contrast check (`test/themes-data.test.ts`).
  - `light` (the default)
  - `dark`
  - `high-contrast`: heavier strokes
  - `print`: greyscale-safe
  - `presentation`: 16:9 with large type
- **Toqan.** `toqan` and `toqan-night` are **built from Toqan's own token file** (`assets/brand/toqan-tokens.json`, copied byte-identical; `src/themes/toqan.ts` resolves its `{references}` and modes, and retypes no colour).
  - The ground is `colour.viz.ground` (ochre/200 `#EDD1AA`).
  - Series 1 and 2 are `colour.viz.series-1/2` (blue/700, blue/500), then the coral and blue scales.
  - Neutrals are paper, ink and night only; Geist is used throughout, Medium at most; there are no gradients or shadows.
  - Text is ink, never coral/500 on a light ground.
  - `toqan-night` draws directly on night with paper text. The token file sets `viz.ground` to ochre in night mode too, which suits a chart *panel* on a night slide. **Which one night charts want is unconfirmed**; both are one token away.
  - Season Mix is not bundled: its licence is unconfirmed.
- **Custom themes.** Tokens over any base with `"extends"`, inline per chart, saved by name (`charts_theme_save` writes `.charts/themes/<name>.json`) or set in the plugin's options (`themes: {name: tokens}`). A theme can add workspace `.ttf`/`.otf` files with `font.files`; they are measured and drawn like the bundled fonts.
- **Colour tokens in specs.** Any string `"theme:<token>"` in a spec (for example `"theme:negative"` or `"theme:categorical.2"`) becomes the active theme's colour, so a spec stays on-brand in every theme.

**A palette that never runs out.** A theme's published colours stay first, byte for byte. Past them, hues are generated
in OKLCH at the theme's own median lightness and chroma, stepped by the golden angle and held to a minimum OKLab
distance (0.10 to twelve series, 0.075 to sixteen, 0.06 to twenty), so a thirteen-series chart does not draw series 13
in series 2's colour. `print` and `high-contrast` are not extended: their constraint is what they are for. Adapted from
Rune's `chart.rs` series hues, with the arithmetic in TypeScript.

## 9. Tools

| Tool | Read-only | What it does |
|---|---|---|
| `charts_render` | no | Any spec (Vega-Lite, Vega, ECharts; detected), data, theme, locale and currency, to files under `outputs/charts/`. |
| `charts_quick` | no | 14 basic types from field names. Returns the spec it built. |
| `charts_validate` | yes | The same checks and the PNG preview, with no files written, plus the figure tree. |
| `charts_recommend` | yes | Which chart for a question, its data and its medium: a ranked shortlist with reasons, the encoding, and a ready `charts_render` call on the caller's columns. Never renders. |
| `charts_capabilities` | yes | Exactly what this build can do, computed: formats, engines, themes and palette sizes, font coverage, data formats, limits, tools, and what is known not to work. |
| `charts_catalogue` | yes | 53 chart types by family, and any one as a working call. |
| `charts_themes` | yes | Built-in and saved themes, and any theme's full tokens. |
| `charts_theme_save` | no | Saves a named workspace theme, after checking it and its contrast. |

**One registry.** `src/registry.ts` defines each tool once — name, class, read-only flag, description, zod input — and
the plugin's registration, the Jelly declaration, the tools RPC, `charts_capabilities` and `docs/tool-parity.md` are
projections of it. `test/registry.test.ts` fails when any of them drifts.

**Declared outputs.** Every tool declares its output schema, from the registry, because OpenCode 2.2.5 fails a result
that carries `output` from a tool that declares none (0.0.3's fix). The schema is a real one — the fields the tool
returns, with `additionalProperties` open so a later field cannot fail a call — and the tools RPC validates each
script's result against the same object, which also enforces the shared module's rule that an owned output schema may
carry no `pattern`. A host case calls all eight tools on 2.2.3, 2.2.4 and 2.2.5 and asserts each result is accepted.

**The tools RPC.** `charts.tools`, v2.1 of the family module, makes every tool a method with its class, so a script
draws and checks charts with no model. The five reads need only an agent that allows them; the three that write need an
allow rule, because an `ask` is refused before dispatch (a script has no one to answer it).


**Result.** Text for the model:
- what was drawn, with the inline markdown line;
- the files;
- what the chart shows;
- the defaults applied;
- warnings with fixes;
- the layout facts and the figure tree;
- how to save a file now.

**The figure tree.** Every label in the drawing, with a stable id (document order, on an already id-normalised SVG), its
box, and whether it collides or runs past the edge; the preview PNG numbers the same ids. A count tells a model that
something is wrong; the tree tells it which label, where, and what text to change. Designed after Rune's semantic tree
and set-of-marks (`research/16-research-agent-generative-ui.md` §3–§4).

Structured `output` carries the same, for scripts. A `file` part carries the PNG when it is useful to look at.

## 10. Plugin or machine libraries

The `charts` skill tells the agent:
- **Use the plugin** for standard charts, anything that must match a theme or brand, and anything that should be checked.
- **Use Python on the machine** (matplotlib, seaborn, plotly; a later version adds them) for bespoke analysis figures, for plots that come out of a processing script, or for library-only features.

Both write to `outputs/`, so both become saved files the same way.

## 11. Proof

- **Tests.** `npm test` runs 184 tests:
  - golden SVGs for all 53 catalogue types;
  - determinism;
  - PNG at 1, 2 and 3x;
  - HTML with no network references;
  - font-metric parity;
  - every safety refusal, and the worker kill;
  - validation and lint teaching;
  - themes, Toqan from tokens, data formats;
  - the built bundle loaded with a fake host;
  - the registry's projections of every surface (registry, palette, recommend, figure, RPC);
  - the tools RPC called through the fake host.
- **Gallery.** `bun scripts/gallery.ts <dir>`: 67 charts (all 53 types, cycling the 7 themes, plus two charts in every theme), with an HTML contact sheet and contact-sheet PNGs.
- **Host tests.** `npm run check` runs the `host` stage: the tools RPC on the isolated stock 2.2.3, 2.2.4 and 2.2.5 binaries, seven cases a version — a read runs, a deny refuses, a write that would ask writes nothing, an allowed write lands, a bad spec comes back as findings, and an unknown session names the header.
- **Eval.** `bun eval/run.ts <dir>`: 30 natural-language requests, each with a scripted call and checked properties (marks, engine, theme, formatting, spec paths, no overlaps or clipping, no unexpected warnings). `--answers model.jsonl` grades a real model's calls against the same expectations.
- **Advice eval.** `bun eval/recommend.ts`: 22 cases for `charts_recommend`, graded by musts and must-nots, gated on zero violations, top-3 recall ≥ 0.90, paraphrase stability ≥ 0.95 and a committed baseline. Both evals run in `npm run check`.
- **Performance.** `bun eval/perf.ts`: warm medians of 33–208 ms wall time and 37–151 ms CPU per chart, including the SVG, the 2x PNG and the spec file, on a shared Mac at load average 40. The first call loads the engines in 280 ms.
- **Footprint.** Tarball 2.85 MB, unpacked 7.5 MB, no runtime dependencies.

| File | Size |
|---|---|
| `resvg.wasm` | 2.4 MB |
| `index.js` | 2.2 MB |
| `vega-worker.js` | 0.9 MB |
| `browser/*` | 1.4 MB |
| `assets/fonts` | 0.4 MB |
| `assets/data` | 0.3 MB |

## 12. Known limits

- Text beyond Latin, Greek and Cyrillic (CJK, Arabic) has no bundled glyphs. A label that needs them gets
  `FONT_GLYPH_MISSING` naming each character; add a font with `theme.font.files`.
- Interactive HTML lays text out with the browser's metrics, so it can differ by a pixel or two from the SVG.
- The word cloud places horizontal and vertical words only.
- ECharts renders in the calling thread. Its layouts are bounded by its inputs, so it does not have Vega's runaway transforms.
