# Architecture

`@joe-broadhead/opencode-charts` turns a chart spec into files. It reads only the data files a call names inside the
workspace, writes only under the output folder and `.charts/themes/`, and opens no network connection: no URL,
loader, image or CDN, at run time or in any output. The same input gives the same bytes on the same platform; across platforms a coordinate computed with trigonometry
can differ in its last digits. The design
and its evidence are in [DESIGN.md](../DESIGN.md); options, limits and errors are in
[configuration.md](configuration.md).

## Setup

`src/index.ts` exports `Plugin.define(createPlugin(...))`. `src/plugin.ts`:

1. Reads the options, the package's version and the two skills (`SKILLS_INVALID` skips a malformed one).
2. Inserts the default permission block after each agent's base allow (`src/permissions.ts`).
3. Registers the nine tools of the registry (`src/registry.ts`) under the `charts` namespace, the `/charts-status`
   command (`src/status.ts`), the skills, and the tools RPC `<plugin id>.tools` (`src/host/rpc.ts`), where every tool
   is a method with its class.

The cleanup stops the tools RPC (its permission hook and its registration) and the Vega worker.

## A call

Each tool call asserts its own action (`charts_<tool>`) first, then `read` on a data file and `edit` on the output
folder, then runs `runTool` (`src/tools.ts`):

1. **Input.** The tool's zod schema; a mismatch is `INPUT_INVALID`.
2. **Data** (`src/data.ts`). Inline rows, or a workspace file (CSV, TSV, JSON, JSONL, Parquet) confined to the
   workspace (`src/paths.ts`), with optional Vega-Lite transforms run in the worker.
3. **Safety** (`src/safety.ts`). Size, depth and expression caps, and every external reference refused. Then the
   preflight: the PNG scales, the output folder (confined, not created), and the runtimes the requested formats need;
   `charts_validate` reports a problem here as an invalid result.
4. **Engine** (`src/engines/`). Vega-Lite and Vega render in one warm worker thread with a time and memory limit
   (`vega-pool.ts`); ECharts renders server-side to SVG. Text is measured and drawn with the bundled fonts only
   (`src/fonts.ts`).
5. **Checks.** Validation with JSON paths and did-you-mean, lint, and layout checks on the drawn SVG (overlaps,
   clipping, duplicate ticks).
6. **The figure** (`src/figure.ts`). One measurement of the drawn SVG gives both the layout facts and the figure
   tree: every label with a stable id, its box and which labels collide or run past the edge. The preview PNG numbers
   the same ids, so a finding points at one label.
7. **Files** (`src/pipeline.ts`, `src/artifacts.ts`). SVG, PNG through resvg compiled to WebAssembly (`src/png.ts`),
   the spec, and on request a self-contained HTML page (`src/html.ts`) with its runtime inlined and a CSP that forbids
   every fetch and every string-to-code evaluation; its `script-src` is the hashes of the page's own two scripts, so
   no inline event handler, `javascript:` URL or injected script runs. Vega runs with vega-interpreter (the spec parsed
   with `{ast: true}`). The static SVG is the first paint; the live chart starts off-screen once the embedded fonts
   have loaded and replaces it only after it initialised. The page's status (`initializing`, `ready`, `failed`) is on
   `<html data-chart-status>`, and a failure keeps the static chart with a visible notice and a short
   `HTML_RUNTIME_FAILED` diagnostic. Every requested file, and the preview, is made in memory before anything is
   written; a PNG over the pixel limit is refused from the drawing's size first. The files are then staged beside their
   targets and moved into place one by one; if a move fails, the files already moved are put back and the staging
   files removed (`OUTPUT_WRITE_FAILED` names any that could not be). That is a best-effort rollback, not a crash-safe
   transaction. `charts_validate` writes nothing and creates no folder.

Fonts are one list of approved resources (`FontResource` in `src/fonts.ts`): each bundled or custom face's bytes,
hash, MIME type and CSS `format()`. Server metrics, the PNG, embedded-font SVG and the HTML page all take their faces
from it, so a theme's own `.ttf` or `.otf` is embedded wherever it is drawn. A custom file is confined to the
workspace, asked for with read permission, and size-checked before it is read.

The result is text for the model (what it shows, the files, the warnings, a markdown image line) and, when there is
something to look at, the PNG itself.

## Chart documents

A call takes one input arm (`src/document-tool.ts`, `selectArm`): the legacy fields (a spec, or quick's type and
fields), an inline `document`, or a saved artifact's `documentPath`. All three converge on the same pipeline
(`renderChart`); there is no second renderer. The layers, from the outside in:

1. **Tool adapter** (`src/tools.ts`, `src/document-tool.ts`): the arm, permissions (read on the artifact, data, saved
   themes and custom fonts; edit on the destination), workspace confinement, and the result's document fields.
2. **Document core** (`src/document/`): the strict `ChartDocumentV1` schema, the canonical captured document (rows
   captured before `data.transform`, the transform kept once), captured defaults kept apart from authored intent, the
   colour domain, the revision hash, and the artifact envelope. It takes plain values: no host call, no file access.
3. **Recipes** (`src/recipes/`): one registry of the 14 recipes. Each definition owns its input schemas, compiler,
   examples, data requirements, interaction and layout support; `charts_catalogue`, `charts_capabilities`, the
   cookbook and `docs/documents.md` are generated from it.
4. **Layout and appearance** (`src/layout/`): the pure planner shared with the browser runtime (three fixed
   candidates, one work budget), the profile table, typed token overrides and category colours by domain position.
5. **Interactions** (`src/interactions/`): the presets compiled to Vega-Lite parameters with collision-safe names;
   the browser side (`src/browser/present.ts`) adds the reset controls, the data table and responsive re-planning.
6. **Publication** (`src/artifacts.ts`): a document call's bundle is staged whole and published as one immutable
   generation folder named by its manifest digest; legacy calls keep flat names with a best-effort rollback.

`charts_update` reads an artifact through the same resolver as a `documentPath` replay, recomputes and checks its
revision, applies a typed presentation patch (`src/document/patch.ts`) and publishes a new generation.

## The future UI boundary

There is no general UI plugin here, and none is planned inside this package. If one is built, the boundary is:

- Charts owns analytical semantics, chart compilation, layout, themes, chart-local interactions and exports.
- A separate UI plugin may own component composition, cross-widget state, tables, cards, forms, navigation and
  explicitly granted host actions.
- The shared contract is a chart document, an available viewport, a resolved theme, and local selection and domain
  events. A UI component calls the same chart core (the document core, recipes, planner and runtime); it does not
  reimplement chart behaviour or run model-generated callback code.
- Host view, payload and grant constraints have to be verified in that project. The standalone offline HTML page is
  the interactive surface today; it is not a host-action bridge.

A component framework such as `@json-render/core` is a candidate for that work, not a dependency here. Any prototype
needs prop validation after binding resolution, state and event round-trip tests, bounded trees, visible errors and
host-enforced action authorisation, and keeps this package's CSP and no-network rules.

## Determinism, two ways

The promise has two forms, exact and within a tolerance, and they are not the same claim (after Rune's
`research/14-research-determinism-verification.md` §1–§2):

- **Exact**: SVG and PNG are byte-identical for the same call on the same platform, warm worker or cold. Ids are
  renumbered in document order under a content hash, layouts are seeded, every temporal scale and time unit is UTC,
  no timestamp reaches an output, and every glyph is drawn from the bundled font bytes.
- **Tolerance**: across platforms a coordinate computed with trigonometry (`Math.sin`, `Math.atan2` — sunburst arcs,
  map projections) can differ in the last digits. The golden test is byte-exact where the goldens were made and equal
  to 10 significant digits elsewhere, and its failure names the first differing file.

`charts_capabilities` returns both, so a caller can depend on the one it needs.

## The registry

`src/registry.ts` defines each tool once: its name, class (`read` or `export`), read-only flag, description, zod input
and documentation anchor. The plugin's tool registration, the Jelly declaration, the tools RPC table,
`charts_capabilities` and `docs/tool-parity.md` are projections of it, and `test/registry.test.ts` fails when any of
them drifts. A tool that exists on one surface and not another is a defect, not a feature.

## The bundle

`node scripts/build.mjs` makes `dist/index.js`, `dist/vega-worker.js`, `dist/resvg.wasm` and `dist/browser/*` (from
`src/browser/vega.ts` and `src/browser/echarts.ts`; the ECharts modules both runtimes register come from one table,
`src/runtime-support.ts`, which also lists the interactions interactive HTML provides), and
regenerates `THIRD_PARTY_NOTICES.md` and `licenses/packages/`. The outputs import only `node:` builtins and
`@opencode/plugin`, so the tarball stands alone with no runtime dependencies. The SHA-256 of the wasm and of each
browser runtime is compiled into `index.js`, so a stale or swapped file is refused (`PNG_UNAVAILABLE`,
`HTML_UNAVAILABLE`), and `/charts-status` reports it.

## Checks

`npm run check` (`scripts/check.mjs`) runs, in order: `build`, `typecheck`, `unit` (the suites in `test/`, golden SVGs
included), `browser` (interactive HTML in a pinned headless Chromium: it starts under its CSP with no request,
and each advertised interaction changes the drawing), `copies` (the shared declaration kit), `forbidden`, `icons`
(the family icon contract), `whitelist` (the package shape), `jelly`, `actionlint`, `pack` (the packed tarball,
installed with scripts off next to `@opencode/plugin` alone, loads, renders and updates a saved chart), `evals` (the
deterministic render and advice suites) and `host` (the tools RPC on each tested stock OpenCode release).

Agent behaviour is measured separately from these checks: the task corpus for live agents lives with the evaluation
harness, and `eval/README.md` says how to run it and what its results do and do not show.
