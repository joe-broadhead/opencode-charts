# evals

Two suites, both deterministic and both runnable with no model:

```
bun eval/run.ts <dir>                      # 28 render cases: does the right call draw the right chart?
bun eval/recommend.ts <dir>                # 21 advice cases: does the right chart win, and what must not?
bun eval/recommend.ts <dir> --update-baseline
bun eval/perf.ts                           # warm medians per chart
```

Each exits non-zero on a failure, so CI can gate on it.

## What these suites measure, and what they do not

Both suites run **prepared calls**: the render suite sends each case's scripted call (written by hand, or built from a
catalogue example by `exampleCall`), and the advice suite calls `charts_recommend` directly. No model chooses a tool,
writes an input or repairs an error (`--answers` grades calls a model made elsewhere; it runs no model itself). So a pass shows that the renderer and the advice are correct for those calls;
it is not evidence about how often an agent makes a correct call, or how many repairs it needs. That is measured
separately, from an agent's recorded tool trace, and reported as its own result. `npm run check` runs only these
deterministic suites.

## The render suite (`eval/run.ts`, `eval/cases.ts`)

A natural-language request with a scripted call and the properties the result must have: the marks, the engine, the
theme, formatting such as `€` and `%`, spec paths, no overlapping or clipped labels, and no warning the case did not
allow. `--answers model.jsonl` grades a real model's calls against the same expectations.

## The advice suite (`eval/recommend.ts`, `eval/recommend.cases.ts`)

Cases for `charts_recommend`, graded **by constraints, not exact matches**: each names the chart types that must
appear in the shortlist (at least one), the types that must not appear at all, and the single best answer when there
is one. The must-not half is what stops a plausible but wrong chart from winning — a funnel for a share of a whole, a
pie with sixteen slices, a US map of countries.

The gates:

| Gate | Target |
|---|---|
| must-not violations | 0 |
| top-3 recall over the cases that name a must | ≥ 0.90 |
| paraphrase stability (the same question, said differently, ranks the same top three) | ≥ 0.95 |
| top-1 accuracy | not below `baseline.json` |
| a case that passed in the baseline | must still pass |

`eval/baseline.json` is committed and reviewed in diffs. It records the catalogue size and the scoring version, so a
change to either is a visible event: regenerate it only with `--update-baseline`, in the same change that moved them.

The datasets are generated in `eval/recommend.cases.ts` from fixed arithmetic — no network, no random seed, no
third-party data — so the public repository carries no dataset licence.
