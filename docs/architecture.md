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
3. Registers the six tools under the `charts` namespace, the `/charts-status` command (`src/status.ts`) and the
   skills.

The cleanup stops the Vega worker.

## A call

Each tool call asserts its own action (`charts_<tool>`) first, then `read` on a data file and `edit` on the output
folder, then runs `runTool` (`src/tools.ts`):

1. **Input.** The tool's zod schema; a mismatch is `INPUT_INVALID`.
2. **Data** (`src/data.ts`). Inline rows, or a workspace file (CSV, TSV, JSON, JSONL, Parquet) confined to the
   workspace (`src/paths.ts`), with optional Vega-Lite transforms run in the worker.
3. **Safety** (`src/safety.ts`). Size, depth and expression caps, and every external reference refused.
4. **Engine** (`src/engines/`). Vega-Lite and Vega render in one warm worker thread with a time and memory limit
   (`vega-pool.ts`); ECharts renders server-side to SVG. Text is measured and drawn with the bundled fonts only
   (`src/fonts.ts`).
5. **Checks.** Validation with JSON paths and did-you-mean, lint, and layout checks on the drawn SVG (overlaps,
   clipping, duplicate ticks).
6. **Files** (`src/pipeline.ts`). SVG, PNG through resvg compiled to WebAssembly (`src/png.ts`), the spec, and on
   request a self-contained HTML page (`src/html.ts`) with its runtime inlined and a CSP that forbids every fetch.

The result is text for the model (what it shows, the files, the warnings, a markdown image line) and, when there is
something to look at, the PNG itself.

## The bundle

`node scripts/build.mjs` makes `dist/index.js`, `dist/vega-worker.js`, `dist/resvg.wasm` and `dist/browser/*`, and
regenerates `THIRD_PARTY_NOTICES.md` and `licenses/packages/`. The outputs import only `node:` builtins and
`@opencode/plugin`, so the tarball stands alone with no runtime dependencies. The SHA-256 of the wasm and of each
browser runtime is compiled into `index.js`, so a stale or swapped file is refused (`PNG_UNAVAILABLE`,
`HTML_UNAVAILABLE`), and `/charts-status` reports it.

## Checks

`npm run check` (`scripts/check.mjs`) runs, in order: `typecheck`, `build`, `unit` (the suites in `test/`, golden SVGs
included), `copies` (the shared declaration kit), `icons` (the family icon contract), `whitelist` (the package shape)
and `pack` (the packed tarball, installed with scripts off next to `@opencode/plugin` alone, loads and renders).
