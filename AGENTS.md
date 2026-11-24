# Repository rules

This repository builds `@we-the-rebel-alliance/charts-plugin`, an unofficial OpenCode plugin that renders chart, table,
diagram and dashboard documents (Vega-Lite, Vega, ECharts, Observable Plot, tables, diagrams) to SVG, PNG, GIF and
offline HTML. The README is for users; `docs/` is the reference.

- **Host.** Public `@opencode/plugin` 2.4.1 APIs only; the tools RPC transport is
  `@we-the-rebel-alliance/source-contract/tools-rpc`, bundled into `dist/index.js`; Charts' part is `src/tools-rpc.ts`.
  `opencode.host` is `>=2.4.1 <2.5.0`, and `TESTED_HOSTS` in `src/status.ts` is the one list of tested releases: tested
  on 2.4.1.
- **No pins.** No tool is pinned, so Code Mode sends only the namespace line; `search({ namespace: "charts", query })`
  finds a signature and the two skills carry the workflow. Do not add a pin or a per-request hook.
- **Errors.** `CODE: what happened. Next step: what to do.` (`formatFailure` in `src/errors.ts`), with a JSON path for
  spec problems, and one typed code set the docs table mirrors.
- **Determinism is a feature.** The same input gives the same bytes on one platform. Never read system fonts, the
  clock, `Math.random` or the time zone in a render path. Golden SVGs change only with `UPDATE_GOLDEN=1`.
- **Nothing from the network.** No URL, loader, image or CDN, in any output or at runtime.
- **Catalogue.** Every entry renders with no warnings in `light`, and has a golden SVG. The cookbook skill is generated
  from the catalogue (`bun scripts/cookbook.ts`).
- **Bundles.** `npm run build` writes `dist/index.js`, `dist/renderer.js`, `dist/chunks/`, `dist/vega-worker.js`,
  `dist/resvg.wasm`, `dist/tui.js`, `dist/gui.cjs` and `dist/browser/{vega,echarts,plot,ui}.js`, and regenerates
  THIRD_PARTY_NOTICES.md and `licenses/packages/`. Outputs import only `node:` builtins, the host packages
  (`@opencode/plugin`, `@opencode/plugin/*`, `@opentui/core`, `@opentui/solid`, `solid-js` and `solid-js/*`) and, for
  the plugin, its own chunks.
- **Engine start.** `dist/index.js` is what every engine start evaluates: the tool table (plain data the build computes
  from the registry, `src/tool-table.ts`), settings, status and RPCs, with no zod schema and no engine. Everything else
  is in `dist/renderer.js`, which `src/renderer-load.ts` imports on the first call that needs it. Never import the
  renderer, the registry's schemas or an engine from a module the entry reaches; `test/lazy-start.test.ts` and the
  build fail when it does.
- **Checks.** `npm run check` is the one command (see CONTRIBUTING.md): `build`, `typecheck`, `unit`, `kit`, `browser`,
  `copies`, `forbidden`, `icons`, `whitelist`, `jelly`, `actionlint`, `pack`, `evals` and `host`. Do not skip or weaken
  a stage to get green.
- **Permissions.** Every tool is allowed by default; `src/permissions.ts` generates the block from the tool table and
  the `access` option, and `test/jelly.test.ts` keeps the Jelly declaration equal to it.
- **Shared copies.** `test/support/jelly-kit.ts`, `test/support/jelly-settings.ts` and `scripts/check-icons.mjs` are the
  family's; keep them in step with the family rather than editing them alone.
- **Forbidden.** V1 plugin APIs and hooks (`@opencode-ai/*`, `tool.execute.*`, `permission.ask`), `@opencode/ai`
  imports, a shell, private host source, another checkout's worktree, machine-local paths, and internal wording (who
  decided something, a lead, a team lane). `scripts/check-forbidden.mjs` is the list, and it runs in `npm run check`.
- **Releases** come only from `.github/workflows/release.yml` ("Releasing" in [CONTRIBUTING.md](CONTRIBUTING.md)), or
  from the plugin kit once it replaces the copied scripts. A release is a tag the workflow makes after the owner
  approves the `release` environment. Never push a tag or a `release/*` branch, and never commit, tag or publish a
  release by hand. Agents never approve a release, never call the deployment-approval API, and never bypass a ruleset or
  the environment.
- **No personal email in anything we publish.** Commits carry a GitHub noreply address (this machine's
  `…[bot]@users.noreply.github.com` identity is fine), never a work or personal address or a local hostname. The
  release commit and tag are made as `github-actions[bot]`.
- **Commits.** `type(scope): summary`.
