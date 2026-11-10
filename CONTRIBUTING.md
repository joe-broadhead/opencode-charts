# Contributing

## Setup

```sh
npm ci
npm run check
```

Node 24 and Bun 1.4.4 are what CI uses. `npm ci` is enough for every stage; no other install step is needed.

## The one command

`npm run check` runs, in order: `build`, `typecheck`, `unit`, `copies`, `forbidden`, `icons`, `whitelist`, `jelly`,
`actionlint`, `pack`, `evals` and `host`. It is the gate for every commit: never skip, weaken or delete a stage to
get a green run.

- `build` writes `dist/`: the plugin, its Vega worker, the PNG rasteriser and the two browser runtimes. The TUI part is
  unminified, and the build fails if it is minified.
- `unit` is every `test/*.test.ts`. `pack` installs the tarball into a temp project and runs it there.
- `host` starts a stock `opencode serve` for each release in `TESTED_HOSTS`, from `OPENCODE_BIN_<version>` or
  `<version>/` under `OPENCODE_STOCK_ROOT`. A missing binary prints a skip notice; in CI it fails, because a release
  that did not run is not evidence.
- `evals` renders every catalogue example and checks the advice gates against the committed baseline.

`npm run drift` compares the Jelly declaration's tool list in `package.json` with the tool table in `src/registry.ts`, prints each difference by name and exits 1 when there is one. It is a manual check, not part of `npm run check`.

## Adding or changing a chart

1. Add the catalogue entry and its working example; `test/registry.test.ts` and the golden suite hold it.
2. Render it: `golden` SVGs change only with `UPDATE_GOLDEN=1` and a reviewed gallery.
3. Regenerate what is generated: `node scripts/data.mjs` for locales and atlases, `bun scripts/cookbook.ts` for the
   skill. Both outputs are committed.

## Text

Model-facing text and docs describe what the code does now: no process narrative, no internal decision references, no
machine-local paths, no secrets. An error is `CODE: what happened. Next step: what to do.`

## Releasing

Every plugin releases as `v0.0.0`, and it installs from that GitHub tag. The release is one commit on top of a `master`
head that CI passed, and the tag points at it.

1. Set `version` to `0.0.0` in `package.json`, date the `## [0.0.0]` entry in `CHANGELOG.md`, then run `npm run check`.
2. Push that commit to `master`, and wait for CI to pass on it.
3. In a clean checkout of `master` at that commit, run `node scripts/release-commit.mjs --ci-sha <its full sha>`. It builds
   `dist/`, removes the lifecycle scripts, and creates the signed commit and the signed annotated tag `v0.0.0`. It never
   pushes; `--dry-run` shows the change first.
4. Push the tag only: `git push origin v0.0.0`.
5. Approve the run in the `release` environment. The release workflow checks the tag and its commit, installs the tag on
   each stock OpenCode host (2.2.3 to 2.2.6), packs it, and creates the GitHub Release with the notes, the tarball and
   `SHA256SUMS`.

A tag that already exists stops step 3. Delete the old tag and its Release first, then start again.


Each release has its own tag, and a Git install does not update by itself. To move to a newer release, remove the old entry with `opencode plugin remove github:joe-broadhead/opencode-charts#v0.0.0`, then add the new tag with `opencode plugin add github:joe-broadhead/opencode-charts#v<version>`.

Or add the plugin to `opencode.json` instead, with the same spec:

```json
{ "plugins": [{ "package": "github:joe-broadhead/opencode-charts#v0.0.0" }] }
```
