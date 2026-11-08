# Repository rules

This repository builds `@joe-broadhead/opencode-charts`, an unofficial OpenCode plugin that renders chart specs
(Vega-Lite, Vega, ECharts) to SVG, PNG and offline HTML. The README is for users; `docs/` is the reference.

- **Host.** Public `@opencode/plugin` APIs only; the tools RPC is the shared v2 module (`57377eb3…`), and its shared
  part is never edited here. `opencode.host` is `>=2.2.3 <2.3.0`, and `TESTED_HOSTS` in `src/status.ts` is the one list
  of tested releases: tested on 2.2.3, 2.2.4, 2.2.5 and 2.2.6.
- **Errors.** `CODE: what happened. Next step: what to do.` (`formatFailure` in `src/errors.ts`), with a JSON path for
  spec problems, and one typed code set the docs table mirrors.
- **Determinism is a feature.** The same input gives the same bytes on one platform. Never read system fonts, the
  clock, `Math.random` or the time zone in a render path. Golden SVGs change only with `UPDATE_GOLDEN=1`.
- **Nothing from the network.** No URL, loader, image or CDN, in any output or at runtime.
- **Catalogue.** Every entry renders with no warnings in `light`, and has a golden SVG. The cookbook skill is generated
  from the catalogue (`bun scripts/cookbook.ts`).
- **Bundles.** `npm run build` writes `dist/index.js`, `dist/vega-worker.js`, `dist/resvg.wasm` and `dist/browser/*`,
  and regenerates THIRD_PARTY_NOTICES.md and `licenses/packages/`. Outputs import only `node:` builtins and
  `@opencode/plugin`.
- **Checks.** `npm run check` is the one command (see CONTRIBUTING.md). Do not skip or weaken a stage to get green.
- **Permissions.** Every tool is allowed by default; `src/permissions.ts` generates the block from the tool table and
  the `access` option, and `test/jelly.test.ts` keeps the Jelly declaration equal to it.
- **Shared copies.** `test/support/jelly-kit.ts` and `scripts/check-icons.mjs` are the family's; never edit them here.
- **Releases.** One `## [x.y.z] - date` CHANGELOG entry per release; a release is a `v<version>` tag on `master`.
- **Commits.** `type(scope): summary`.
