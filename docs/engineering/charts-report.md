# Chart reliability: engineering report

> Historical record: this page is the v1 WP0–WP5 closure snapshot. Current v2 figures are in
> [docs/status.md](../status.md).

This report closes the chart reliability work (WP0–WP5). It records what changed and why, the public contract, the
compatibility decisions, every acceptance item (A01–A34) with its status and evidence, the definition of done, the
open product decisions, and what is known not to work. "Met" means a test that exercises the public path passes in
the gate; "partial" means some of the item is covered and the rest is named; nothing here is claimed from a skipped
stage.

## Branch and commits

The work starts from `5400172` (see [charts-baseline.md](charts-baseline.md)) and is on `master` through `c30942a`:
WP0/WP1 core (`470ada6`), WP1 browser (`cc4aeb1`), WP2 core (`e58d6e2`), WP2 wiring (`efc237a`), WP3 (`7194a28`),
WP4 (`fc1133c`) and the layout monotonicity fix (`c30942a`). WP5 is the branch `feat/charts-wp5-docs`, on `c30942a`:

| Commit | What |
| --- | --- |
| `feat(discovery)` | `charts_capabilities` reports document versions, the 14 recipe contracts and the layout profiles; `charts_catalogue` marks the recipe types and returns each one's contract and exact `charts_quick` document calls; `charts_recommend` drafts a recipe document on the caller's columns, with an explicit medium as its layout target, and withholds it when the aggregate would be guessed. All derived from the recipe registry. |
| `docs(documents)` | `docs/documents.md`; the cookbook generated from the catalogue and the recipe registry, and `test/generated.test.ts`, which fails when the cookbook or the recipe table is stale (the cookbook script claimed such a test; none existed). |
| `fix(documents)` | An empty recipe dataset is `DATA_EMPTY` at `/document/chart/data` (it was `SPEC_INVALID` blaming the compiled spec's fields), and `charts_validate` returns `valid: false` for a spec-level problem found while fitting instead of throwing. |
| `docs(charts)` | The skill, README, architecture (document layers, the future UI boundary), status, scripting and Jelly pages describe the shipped behaviour. |
| `feat(registry)` | `CONTRACT_VERSION` 1.0.0 → 1.1.0, with the compatibility note in `src/registry.ts`. |
| `docs(changelog)` | One `## [Unreleased]` section for WP0–WP5, with the security fix. |
| `docs(engineering)` | `eval/README.md` points at the agent corpus; this report. |

The agent task corpus and its grading adapter are in `opencode-evals`, branch `feat/charts-corpus` (see
[Agent evaluation](#agent-evaluation)).

## What changed, and why

- **One example call** (F1). `exampleCall` builds the exact tested call for the catalogue tool, cookbook, gallery,
  goldens and evals; the calendar heatmap keeps 820 × 220.
- **Legacy sizes** (F2). A raw spec's own size still wins, and now says so (`SIZE_OVERRIDE_IGNORED`, naming both values
  and the path); compiler fit/autosize warnings are no longer filtered out.
- **Browser runtime** (F4–F6, F8). Vega runs under the page's CSP with `vega-interpreter` and AST parsing; the page's
  `script-src` is the hashes of its own scripts; ECharts tooltip markup is checked against an allow-list both in the
  spec check and in the page; unsupported ECharts components are refused from one module table; the live chart starts
  off-screen after fonts load and replaces the static SVG only once ready, with `initializing`/`ready`/`failed`
  status and a kept fallback; one approved font list feeds metrics, PNG, SVG and HTML. A real-browser `browser` check
  stage exercises every advertised interaction.
- **Staged publication** (F9). Every file and the preview are made before anything is written; legacy flat files move
  in with a best-effort rollback; document calls publish one immutable generation folder.
- **Chart documents and recipes** (F3, WP2). `ChartDocumentV1`, 14 typed recipes, captured artifacts with a revision,
  replay by path, and authored intent kept apart from captured defaults.
- **Layout, appearance and interactions** (F7, WP3). Exact recipe outer sizes per target, a pure three-candidate
  planner shared with the browser, typed token overrides, a typed stable colour domain, and four interaction presets.
- **`charts_update`** (WP4). A typed presentation patch into a new generation, with revision verification and the
  analytical fields immutable.
- **Guidance and evidence** (WP5). Discovery generated from the registry, the document reference, the rewritten skill,
  the changelog, the contract version, the agent corpus and this report.

## Public API changes

`CONTRACT_VERSION` is 1.1.0 (additive). New: the `document` and `documentPath`/`expectedRevision` arms on
`charts_render`, `charts_quick` (document only) and `charts_validate`; the `document` format; `charts_update`; the
document result fields (`revision`, `fingerprint`, `source`, `appearance`, `categories`, `size`, `interactions`,
`adjustments`, `diagnostics`, `generation`, and `update` on `charts_update`); `recipe` on a catalogue entry and
`recipe: true` in the list; `document` drafts in recommendations; `documents`, `recipes`, `layouts` and
`interactions` in capabilities; typed `charts_theme_save` tokens; 19 new codes (listed in the CHANGELOG). The chart
document version is 1; the artifact envelope is `opencode-charts-artifact` version 1.

## Compatibility decisions

- Legacy calls keep their meaning, defaults and flat file names. Two refusals are defect corrections: ECharts options
  using `dataZoom`, `brush`, `toolbox`, `timeline`, `matrix` or `thumbnail` (drawn without them before, now
  `ECHARTS_COMPONENT_UNSUPPORTED`), and ECharts tooltip text that would be inserted as markup
  (`ECHARTS_MARKUP_REFUSED`). New warnings (`SIZE_OVERRIDE_IGNORED`, unfiltered `VEGA_LITE_WARNING`) are additive.
- A legacy call that asks for `document` output saves an engine document from the original unthemed spec and the
  untransformed rows; tool-level sizes, money fields and inline theme tokens are refused there with where they go.
- `.vl.json`, `.vg.json` and `.echarts.json` stay resolved specs, never read back as documents.
- The legacy quick path keeps its historical inference (for example `horizontal_bar` ranks by value); the new
  document defaults (sort `input`, aggregate `none`) apply to documents only.

## Gate and commands

`npm run check` on Linux x64 (Node 24.22.2, Bun 1.4.4), every stage, on the WP5 branch:

| Stage | Result |
| --- | --- |
| build, typecheck, copies, forbidden, icons, whitelist, jelly, actionlint | passed (actionlint installed and run) |
| unit | 719 pass, 0 fail, 44 files |
| kit | 105 pass, 0 fail |
| browser | 37 pass, 0 fail (playwright-core headless Chromium) |
| pack | 2 pass, 0 fail |
| evals | render 28/28; advice 6/6 gates (must-not 0, top-3 recall 1.000, paraphrase 1.000, top-1 1.000) |
| host | 45 pass, 0 skip, 0 fail with stock OpenCode 2.2.3, 2.2.4, 2.2.5 and 2.2.6 (`OPENCODE_BIN_*` set) |

CI on `master` at `fc1133c` passed on Linux x64 and arm64 and macOS arm64 and x64, with the browser and host stages and
the stock binaries installed by the workflow. The WP5 branch itself has not run in CI yet.

## Acceptance matrix

| ID | Status | Evidence | Left |
| --- | --- | --- | --- |
| A01 | met | `test/catalogue-call.test.ts:39` (every catalogue entry: metadata kept, validates, draws its golden), `:29` (calendar heatmap 820 × 220); `test/rpc.test.ts:91`; recipe document calls from the catalogue validate unchanged: `test/discovery.test.ts:64` | — |
| A02 | met | `test/sizing.test.ts:23`, `:81` | — |
| A03 | met | `test/sizing.test.ts:41` | — |
| A04 | met | `test/document-tools.test.ts:144`–`:191`; `test/rpc.test.ts:174` | — |
| A05 | met | `test/document-schema.test.ts:26`–`:134`; `test/document-tools.test.ts:205`, `:221` | — |
| A06 | met | `test/recipes.test.ts:37`–`:67`; `test/document-tools.test.ts:238` | — |
| A07 | met | `test/recipes.test.ts:74`–`:131`; `test/document-tools.test.ts:248` | — |
| A08 | met | null, zero, negative, temporal and three host time zones: `test/recipes.test.ts:139`–`:212`; empty data through the tools (`DATA_EMPTY`, nothing written, nothing invented): `test/empty-document.test.ts` | Before WP5 an empty recipe dataset was refused with a misleading `SPEC_INVALID`; fixed here. |
| A09 | met | `test/layout.test.ts:32`–`:60` (exact outer SVG, PNG at 1×/2×/3×, adjustments with paths) | See the long-label findings under Known limits. |
| A10 | met | Tiny outer sizes, a font override below the floor and an engine document asking for responsive layout are refused with the conflicts and no files: `test/layout.test.ts:103`–`:124`; `test/document-tools.test.ts:588`. Wider never fits worse: `test/layout-monotone.test.ts:44` (10 charts × 18 sizes up to 1280 × 720), `:67` (turned labels keep room for the axis title), `:88`–`:109` (every size a refusal names draws; `horizontal_bar` is suggested only where it fits). Probe with the agent corpus's eight 50–60-character labels at height 480, widths 360–1280 in 40 px steps: `bar` fits at every width; `horizontal_bar` is refused at 360 ("fits from 380 px wide", and it does) and fits at every width from 379 up. | A refusal names a size that fits, not the smallest one (379 fits where 380 is named). |
| A11 | met | `test/layout.test.ts:130` | One fixed-size document, repeated; same-platform promise only. |
| A12 | met | `test/document-tools.test.ts:456`; `test/update.test.ts:148`, `:160` | — |
| A13 | met | `test/layout.test.ts:222` | Exercised on the appearance resolver and compiled spec, not through a raw engine document. |
| A14 | met | `test/document-tools.test.ts:444`; `test/update.test.ts:178` | — |
| A15 | met | `test/artifact.test.ts:119`, `:141`; `test/update.test.ts:132` | — |
| A16 | met | `test/document-tools.test.ts:499`; `test/update.test.ts:404`; `test/artifact.test.ts:294` | — |
| A17 | met | `test/artifact.test.ts:199`–`:227`; `test/document-schema.test.ts:168`–`:178`; `test/document-tools.test.ts:478`; `test/update.test.ts:364` | — |
| A18 | met | `test/publication.test.ts:66`, `:76`; `test/document-tools.test.ts:290` | — |
| A19 | met | browser: `test/browser/runtime.test.ts:52` (`interactive_brush` ready, no CSP violation, no request, drag selects exactly the points inside), with the harness's own CSP sanity checks at `:24` and `:35` | — |
| A20 | met | `test/runtime.test.ts:44`–`:53` | ECharts zoom and brush are not implemented; they are refused. |
| A21 | met | browser: `test/browser/presets.test.ts:72`, `:104`, `:219`–`:260` | — |
| A22 | met | browser: `test/browser/presets.test.ts:143` | — |
| A23 | met | browser: `test/browser/presets.test.ts:197` (scatter and bubble) | — |
| A24 | met | browser: `test/browser/presets.test.ts:292` (320/480/720/1024), `:331` | One fixture with short labels; the browser re-plans with the same planner, whose width monotonicity is tested on the server side (A10); no browser test uses the corpus's long labels. Height stays fixed (as specified). |
| A25 | met | browser: `test/browser/presets.test.ts:354`, `:379` | — |
| A26 | met | browser: `test/browser/presets.test.ts:403`; `test/browser/runtime.test.ts:273`–`:306` | — |
| A27 | met | browser: `test/browser/fonts.test.ts:18`; `test/runtime.test.ts:136`–`:193` | — |
| A28 | met | browser: `test/browser/runtime.test.ts:173`–`:249`, `:325`; `test/runtime.test.ts:125`, `:207` | — |
| A29 | met | `test/interactions.test.ts:111`, `:143`; `test/document-tools.test.ts:259`; `test/update.test.ts:282` | — |
| A30 | met | `test/publication.test.ts:99`–`:118`, `:182`; `test/document-tools.test.ts:312`; `test/update.test.ts:424` | — |
| A31 | met | `test/publication.test.ts:139`–`:193`; `test/generations.test.ts:45`–`:179` (two processes); `test/update.test.ts:436`–`:461` | Legacy multi-file moves are best-effort rollback, not crash-atomic (documented). |
| A32 | met | `test/update.test.ts:497`; `test/rpc.test.ts:60`–`:180`; host: `test/host/tools-rpc.host.test.ts:52`, `:58`; `test/host/codemode.test.ts:172`, `:182` | — |
| A33 | met | `test/pack/pack.test.ts:61` (tarball installed with scripts off, renders and updates); host suite on 2.2.3–2.2.6; the `whitelist` stage (no runtime dependencies) | — |
| A34 | met | `test/registry.test.ts:23`–`:113`; host `test/host/tools-rpc.host.test.ts:85` (every result against its declared output schema); `test/jelly.test.ts`; `test/discovery.test.ts`; `test/generated.test.ts`; `test/codes.test.ts` | The prose pages (`docs/status.md` known limits, `docs/architecture.md`) are checked by hand; the generated tables and code lists are tested. |

Summary: 34 met, 0 partial, 0 not met. Items whose tests cover one fixture or one path say so in their "Left" column (A11, A13, A24, A31, A34).

## Definition of done

| # | Item | Status |
| --- | --- | --- |
| 1 | Existing calls compatible, apart from documented corrections and new warnings | Done: `test/compat.test.ts:60` against the baseline record; the corrections are listed above. |
| 2 | New contracts strict, versioned, documented, projected through the registry | Done. |
| 3 | Authoring, theme, data and revision invariants under the matrix | Done (A06–A17). |
| 4 | Every advertised interaction has a real browser test under the packaged CSP | Done: `test/browser/runtime.test.ts:373` fails when an advertised interaction has no browser test of that title. |
| 5 | Fixed sizing exact; responsive reflows; unsatisfied constraints visible | Done: sizes are exact, fitting is monotonic in size (A10), and refusals name a size that fits. |
| 6 | Permission, safety, determinism, bundle and host checks intact | Done. |
| 7 | Gates and the browser gate pass; omissions identified | Done locally on Linux x64 with every stage run; CI has not run the WP5 branch yet. |
| 8 | Representative gallery output and intentional golden changes reviewed | Partial: no golden SVG changed since the baseline. Five representative document charts (presentation dark bar, report grouped bar with legend highlight, inline line with x zoom, scatter with brush, a 360 × 480 long-label bar) were rendered at their target sizes and looked at; the full 53-type gallery was not re-reviewed in WP5. |
| 9 | Agent corpus and grading runnable; live results reported with their evidence | Done: one live baseline (`claude-agent/haiku`, 39 runs), reported below. |
| 10 | Docs, generated examples, capabilities, error tables and changelog describe the behaviour | Done. |

## Browser interaction evidence

The `browser` stage (37 tests) opens pages made through the built plugin's tools in playwright-core's headless
Chromium under the page's CSP, with CSP-violation, console and request listeners. It drags `interactive_brush`, hovers
tooltips, toggles legends and Vega signals, exercises the four recipe presets alone and combined through resize and
independent reset, re-plans at 320/480/720/1024 px, hides, shows, disposes and remounts, breaks the runtime to check
the fallback, embeds a custom TTF, and starts every catalogue example with no violation, console error or request.
A tool result never claims an interaction was verified: the browser suite is the evidence, not the render.

## Agent evaluation

In `opencode-evals` (`feat/charts-corpus`): `cases/charts`, version 1, 13 tasks (sets `corpus`, `create` 7,
`revise` 6) covering every task the brief lists, plus two `scripted` probes; `worlds/charts`, synthetic CSVs and a
build that saves the revision tasks' charts with the build under test through its tools RPC on a stock host; and a
Charts grading adapter that recomputes each saved chart's group values from its captured rows. Items grade data,
fields, aggregation and values; tools, presets and formats; preserved semantics across updates; exact size; safety;
and first-attempt efficiency. Runs record model, host, build digest and commit, the case-set lock, fixtures, tool
trace, and tokens, cost and latency when the runner supplies them.

Scripted model (no credential, nothing live): both probes pass (a saved chart graded at North 510 and West 192 from
its own rows; a refused pie zoom that saves nothing). `test/charts-corpus.test.mjs` grades hand-built good and bad
runs and checks that a run that did nothing fails every task.

### Live baseline (2026-11-12)

One baseline, not a target: no success target is set from it. Setup: the runs used `opencode-evals` `8f64003`
(case lock epoch 2); the grades below use that corpus plus one clause correction (lock epoch 3, see below), which
is opencode-evals#6 (https://github.com/joe-broadhead/opencode-evals/pull/6), not yet merged; the build under test is this repository at `07ec509` (`dist` digest
`sha256:0a17b6dd…cfe99d`, which also built the world); stock OpenCode 2.2.5; model `claude-agent/haiku`; one container
per trial, egress to `api.anthropic.com` only (197 connections, none refused); 13 tasks × 3 trials = 39 runs, plus
the 2 scripted probes. No run failed for infrastructure, and the credential appears nowhere in the recordings.

| Task | Set | Strict | All 3 strict | First chart call accepted | Refused chart calls |
| --- | --- | --- | --- | --- | --- |
| explicit-aggregation | create | 3/3 | yes | 3/3 | 0 |
| ambiguous-aggregation | create | 3/3 | yes | 1/3 | 3 |
| count-vs-measure | create | 3/3 | yes | 3/3 | 0 |
| malformed-field-names | create | 3/3 | yes | 0/3 | 3 |
| brand-theme | create | 3/3 | yes | 3/3 | 1 (a retry after it) |
| empty-data | create | 3/3 | yes | no chart call (correct) | 0 |
| long-labels-narrow | create | **0/3** | no | 0/3 | 6 |
| light-to-dark | revise | 3/3 | yes | 3/3 | 0 |
| inline-presentation-inline | revise | 2/3 | no | 3/3 | 0 |
| add-zoom | revise | 3/3 | yes | 3/3 | 0 |
| add-scatter-brush | revise | 3/3 | yes | 3/3 | 0 |
| unsupported-pie-zoom | revise | 3/3 | yes | no chart call (correct) | 0 |
| changed-csv-cosmetic | revise | 3/3 | yes | 3/3 | 0 |

- **Strict pass** (every blocker and major item): `create` 18/21, `revise` 17/18, all 35/39 (90%). **pass^3** (every
  trial strict): `create` 6/7, `revise` 5/6, all 11/13.
- **First attempt**: the first chart call was accepted in 25 of the 33 runs that made one (`create` 10/18, `revise`
  15/15). 9 runs needed repairs; 13 chart calls were refused in all, and every run that repaired reached a valid call.
- **Per run** (medians, with p90): 8 (11) model tool calls, 7 (9) turns, 19.2 s (27.1 s) wall time, 155k (259k)
  tokens, most of them cached context. Cost is not reported: the harness has no price for this model.

Failure modes, from the recordings:

1. **A width the user did not ask for** (long-labels-narrow, 3 of 3). Each run chose `horizontal_bar` for the long
   labels; 360 × 480 was refused (`LAYOUT_UNSATISFIABLE`, "fits from 380 px wide"); each run then drew at 380 × 480 and
   said so plainly, and told the user 360 px could not work. That is not true: a vertical `bar` fits 360 × 480 with
   the same labels. A refusal of one recipe names a larger size for it, never another recipe that fits the size
   asked for, so the agent took the size.
2. **Document shape errors on the first call** (9 runs, all `create`): `options.sort` given as `true` or
   `"descending"` instead of `value-descending`; `layout` or `appearance` placed inside `chart` instead of at the
   document's top level; once a legacy field mixed with `document` (`INPUT_CONFLICT`). Every one was refused with its
   path and repaired on the next call.
3. **A new document instead of an update** (inline-presentation-inline, 1 of 3): the run read the saved artifact,
   then created a new chart by copying its 24 captured rows into a fresh `charts_quick` document, and only then used
   `charts_update` for the second step. The rows and totals were right, but the presentation version was not a
   revision of the saved chart.

Grading note: the first grading of these recordings scored add-zoom, add-scatter-brush and long-labels-narrow lower
because three clauses compared the adapter's joined facts (`rows.count`, `width`, `height`, which are strings) with
numbers. The clauses were corrected to compare strings (lock epoch 3, opencode-evals#6, not yet merged) and the same recordings were regraded; no run
was repeated. As first graded: strict 29/39, pass^3 9/13. Per-run browser confirmation of an interaction is not
graded; the corpus grades the preset and format the agent chose, and the preset's behaviour is the browser suite's
evidence.

## Supported and unsupported combinations

- Recipes: the 14 quick families. Engine documents: any Vega-Lite, Vega or ECharts spec, native layout only, no
  presets, no `categoryColors`.
- Presets: tooltip on every recipe; legend highlight on grouped and stacked bars, line, area, stacked area, scatter
  and bubble with a series; x zoom on temporal line and area; interval brush on scatter and bubble. Legend + zoom and
  legend + brush combine; zoom + brush, and any preset elsewhere, is `INTERACTION_UNSUPPORTED`.
- Not supported: series hiding, exporting the current browser view, ECharts zoom/brush/toolbox/timeline, responsive
  height, layout fitting for engine documents, data refresh inside an update.

## Open product decisions

Recorded in [open-decisions.md](open-decisions.md), each implemented, tested (`test/open-decisions.test.ts`) and
changeable in one place: (1) the default display sort of a recipe document is `input`; (2) the `area` recipe with a
series draws overlapping areas, and stacking is `stacked_area`, while the legacy quick `area` keeps stacking; (3) a
saved artifact's captured rows are measured as JSON against the data limit.

## Known limits and findings

- **Long category labels in narrow layouts.** Found while writing the agent corpus: a vertical `bar` with eight
  50–60-character labels fitted at 360 px but was refused at 600 and 720 px, and the refusal suggested a
  `horizontal_bar` that did not fit. Fixed on `master` (`c30942a`): axes keep room for every label (Vega's default
  `maxExtent` had capped it), turned labels' reach is counted, refusals name sizes that draw and suggest a horizontal
  bar only where it fits, and a plot left small by its guides is reported as an adjustment at `/layout`. The
  narrowest fitting layouts with such labels are still cramped (a small plot); that is now reported, not hidden.
- Browser and server text metrics differ; responsive HTML promises the same policy and bounds, not the same pixels.
- Legacy multi-file publication is a best-effort rollback, not a crash-safe transaction.
- Same-platform byte determinism; across platforms, 10 significant digits.
- Agent behaviour is measured once, on one model (above): one baseline is not a trend, and it sets no target.

## Deviations from the brief

- The agent corpus, world and grading adapter are in `opencode-evals` rather than in this repository; this repository
  documents how to run them (`eval/README.md`).
- `charts_recommend` gives a document draft only when the caller passes data and the medium is explicit enough to be
  carried; with an assumed medium the document keeps its own default target, and with repeated groups it withholds the
  draft rather than choose an aggregate.
