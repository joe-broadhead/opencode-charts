# Contributing

## Setup

```sh
npm ci
npx playwright-core install --only-shell chromium   # once; on Linux add --with-deps
npm run check
```

Node 24 and Bun 1.4.4 are what CI uses. The `browser` stage needs playwright-core's headless Chromium, at the build the
exact `playwright-core` version in `package-lock.json` pins.

## The one command

`npm run check` runs, in order: build, typecheck, `plugin-kit check`, unit, browser, evals, host and pack. It is the
gate for every commit: never skip, weaken or delete a stage to get a green run.

- `plugin-kit check` is the contract gate: T0 (the namespace line, the skill descriptions, declared tools, generated
  docs) and T1 (the built plugin on OpenCode 2.4.1, its permissions and its clean refusal of an unsupported host),
  plus the required doc files and the forbidden-text scan.
- `build` writes `dist/`: the entry, the renderer it loads on first use, the Vega worker, the PNG rasteriser, the TUI
  part and the four browser runtimes. The TUI part is unminified, and the build fails if it is minified.
- `browser` opens interactive HTML made through the built plugin in headless Chromium: each page starts under its own
  CSP with no violation and no request.
- `host` starts a stock OpenCode 2.4.1 and loads the built plugin from a local path; a missing binary fails in CI,
  because a release that did not run is not evidence.
- `evals` renders every catalogue example and checks the advice gates against the committed baseline.

## Adding or changing a chart

1. Add the catalogue entry and its working example in `src/catalogue.ts`; the golden suite holds its drawing.
2. Regenerate what is generated: `node scripts/data.mjs` for locales and atlases, `bun scripts/cookbook.ts` for the
   cookbook skill and the recipe table. Both outputs are committed.
3. A golden SVG changes only with `UPDATE_GOLDEN=1` and a reviewed gallery.

## Text

Model-facing text and docs describe what the code does now: no process narrative, no internal decision references, no
machine-local paths, no secrets. An error is `CODE: what happened. Next step: what to do.`

## Releasing

The lead cuts releases after a pull request merges. A release is the tag `v<version>` on `master`; CI publishes the
GitHub Release with `dist/`, `SHA256SUMS` and the conformance report. `CHANGELOG.md` already carries the version's
section. Nobody tags a release by hand.
