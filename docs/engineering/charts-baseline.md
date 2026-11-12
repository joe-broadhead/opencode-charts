# Chart reliability: baseline and regression targets

The reliability work starts from commit `5400172bc4b603f3cb6d0552f7a525dbc3674009` (`origin/master`). This file
records the state of that commit, and maps each source finding (F1–F10) to the test that holds it and the work package
that owns the fix.

## The gate at the baseline

`npm run check` passed every stage at the baseline commit, on Linux x64 with Node 24.22.2 and Bun 1.4.4:

| Stage | Result |
|---|---|
| build, typecheck, copies, forbidden, icons, whitelist, jelly, pack, evals | passed |
| unit | 203 pass, 0 fail, across 15 files |
| actionlint | skipped: `actionlint` is not installed on the machine (the stage prints a notice and passes) |
| host | 5 pass, 40 skip, 0 fail: no stock OpenCode binary was set (`OPENCODE_BIN_2_2_3` … `OPENCODE_BIN_2_2_6` unset), so every per-release case skipped; in CI a missing binary fails |

The two skips are environment gaps, not passes: neither the workflows' lint nor the stock-host RPC path ran.

## Compatibility fixtures

`test/compat.test.ts` sends representative legacy calls through `runTool`, the function the plugin and the tools RPC
both call, and compares each result with `test/compat/legacy-calls.json`: engine, theme, width and height, the files
written, the warning codes, and a hash of the drawing (the portable SVG form the golden suite uses). The record was
written from the baseline code. The calls cover `charts_quick` with and without `width`/`height`, a raw Vega-Lite spec
unsized, sized by the tool, sized by the spec, with equal sizes and with conflicting sizes, a raw Vega spec with and
without tool sizes, an ECharts option with and without tool sizes and with conflicting sizes, and `charts_validate`.
The record changes only with `UPDATE_GOLDEN=1` and a reviewed diff.

## Findings and their regression targets

| ID | Finding at the baseline | Regression target | Owned by |
|---|---|---|---|
| F1 | `charts_catalogue` built its example call without the example's `width`/`height` (and `locale`), while the golden, eval, gallery and recommend adapters each built their own call, with the sizes. | A01: `test/catalogue-call.test.ts` sends the exact call `charts_catalogue` returns for every entry through `charts_validate` and `charts_render`; the calendar heatmap stays 820 × 220. | WP1 core |
| F2 | A spec's own `width`/`height` silently beat the tool's, and the compiler's fit/autosize warnings were filtered out. | A02 and A03 in `test/sizing.test.ts`: a spec width of 500 with a tool width of 900 keeps the 500 geometry and returns `SIZE_OVERRIDE_IGNORED` naming both values and `/spec/width`; equal sizes return no warning and the same geometry; signal and object sizes are reported as written; fit/autosize warnings reach the result as `VEGA_LITE_WARNING`. | WP1 core |
| F3 | Theme configuration is saved into the resolved spec and later read back as authored overrides. | A12/A13: a saved-document light → dark → light sequence. | WP2 (documents) and WP3 (appearance) |
| F4 | Vega HTML uses the default `Function`-based expression evaluator under a CSP without `unsafe-eval`. | A19: real generated HTML in a browser under the packaged CSP, with the `interactive_brush` example. | WP1 browser runtime |
| F5 | The ECharts browser runtime registers no DataZoom or Brush component. | A20: unsupported `dataZoom`/`brush` options are rejected with an actionable error. | WP1 browser runtime |
| F6 | HTML tests inspect the page's content but never execute an interaction. | A19, A25, A26: browser tests that change state, resize, reset and fail. | WP1 browser runtime |
| F7 | Theme tokens are typed internally, but tool overrides are largely opaque records. | Strict typed partial overrides derived from the token definitions. | WP2/WP3 |
| F8 | Custom fonts are measured and rasterised, but HTML and embedded-font SVG embed bundled fonts only. | A27: custom-font HTML and SVG export. | WP1 browser runtime |
| F9 | Writing files started before every requested format and the preview had been made, so a late failure left a partial set, and an invalid PNG scale was found after the SVG was written. | A18, A30 and the legacy part of A31 in `test/publication.test.ts`: validation creates nothing on disk; a failure while preparing HTML, PNG or the preview leaves existing files untouched and writes nothing; a failure while committing restores the files it replaced and removes its staging files. | WP1 core (legacy flat files); WP4 (document generations) |
| F10 | The default evaluations execute prepared reference calls; no model is involved. | Kept as deterministic checks; a trace-based agent evaluation is added separately and its results reported as such (see `eval/README.md`). | WP5 |

## Source and runtime findings

F1, F2, F3, F7, F9 and F10 were found by reading the source and are reproduced by the tests named above. F4, F5, F6
and F8 concern the browser runtime: the expected browser symptom of F4 has not been reproduced end to end at the
baseline, and only a real browser test can show it.

## Observed while adding the tests

Under `bun test`, a reply from the Vega worker thread (`src/engines/vega-pool.ts`, which `unref`s the worker) was seen
to wait until the 10 s render timeout fired when nothing else was pending, so an ordinary render failed as
`SPEC_TOO_EXPENSIVE`. It reproduced only inside the test runner, in one test order, and not in a plain `bun` script.
`test/publication.test.ts` therefore renders in the calling thread (`CHARTS_IN_PROCESS=1`, restored afterwards). The
worker pool itself is unchanged; whether the same delay can happen inside a host process is not established.
