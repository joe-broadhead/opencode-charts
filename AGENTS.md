# Repository rules

This repository builds `@joe-broadhead/opencode-charts`, an unofficial OpenCode plugin that renders chart specs
(Vega-Lite, Vega, ECharts) to SVG, PNG and offline HTML. The README is for users. DESIGN.md is the design and its
evidence. docs/jelly.md describes how Jelly reads the declaration.

- **Host.** Public `@opencode/plugin` APIs only. Never `ctx.experimental.artifact`.
- **Errors.** `CODE: what happened. Next step.`, with a JSON path for spec problems.
- **Determinism is a feature.** The same input gives the same bytes. Never read system fonts, the clock, `Math.random` or the time zone in a render path. Golden SVGs change only with `UPDATE_GOLDEN=1` and a reviewed gallery.
- **Nothing from the network.** No URL, loader, image or CDN, in any output or at runtime.
- **Catalogue.** Every catalogue entry renders without warnings in `light`, and has a golden SVG. The cookbook skill is generated from the catalogue (`bun scripts/cookbook.ts`).
- **Toqan.** The toqan themes read `assets/brand/toqan-tokens.json`; never retype a brand colour.
- **Bundles.** `npm run build` makes `dist/index.js`, `dist/vega-worker.js`, `dist/resvg.wasm` and `dist/browser/*`, and regenerates THIRD_PARTY_NOTICES.md and `licenses/packages/`. Outputs import only `node:` builtins and `@opencode/plugin`.
- **Checks.** `npm run check` is the one command. Do not skip or weaken a test to get green.
- **Commits.** `type(scope): summary`.
