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

A release is a `v<version>` tag on `master`. `.github/workflows/release.yml` checks, packs and publishes with
provenance, after approval in the `release` environment, and refuses a tag that differs from `package.json`.
