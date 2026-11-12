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
- **Checks.** `npm run check` is the one command (see CONTRIBUTING.md): `build`, `typecheck`, `unit`, `browser`, `copies`,
  `forbidden`, `icons`, `whitelist`, `jelly`, `actionlint`, `pack`, `evals` and `host`. Do not skip or weaken a stage to
  get green.
- **Permissions.** Every tool is allowed by default; `src/permissions.ts` generates the block from the tool table and
  the `access` option, and `test/jelly.test.ts` keeps the Jelly declaration equal to it.
- **Shared copies.** `test/support/jelly-kit.ts` and `scripts/check-icons.mjs` are the family's; never edit them here.
- **Forbidden.** V1 plugin APIs and hooks (`@opencode-ai/*`, `tool.execute.*`, `permission.ask`), `@opencode/ai`
  imports, a shell, private host source, another checkout's worktree, machine-local paths, and internal wording (who
  decided something, a lead, a team lane). `scripts/check-forbidden.mjs` is the list, and it runs in `npm run check`.
- **Releases** come only from `.github/workflows/release.yml` ("Releasing" in [CONTRIBUTING.md](CONTRIBUTING.md)). A
  release-prep PR sets `version` in `package.json` and the install specs and runs `node scripts/changelog.mjs release`;
  once it is on `master` and CI passed, start the release with
  `gh workflow run release.yml --ref master -f sha=<its full sha>`. The workflow builds `dist/`, makes the release
  commit on a temporary `release/v<version>` branch, checks and stages everything, and waits for the owner to approve
  the `release` environment; only then does it create the tag `v<version>` and the GitHub Release. Never push a tag or a
  `release/*` branch, and never commit, tag or publish a release by hand. Agents never approve a release, never call the
  deployment-approval API, and never bypass a ruleset or the environment.
- **No personal email in anything we publish.** Every commit is authored and committed as
  `joe-broadhead <91376460+joe-broadhead@users.noreply.github.com>`, except the release commit and tag, which the
  release workflow makes as `github-actions[bot]`. Before committing or tagging, check that
  `git config user.email` is that address: a fresh clone inherits the machine's global identity, which is not that
  address. Never commit, tag or publish with a work or personal address, or with a local hostname.
- **Commits.** `type(scope): summary`.
