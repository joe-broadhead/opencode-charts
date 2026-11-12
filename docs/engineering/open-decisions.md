# Open decisions: chart documents and recipes

Three behaviours of the chart document core (`src/document/`, `src/recipes/`) are product choices the brief leaves
open. Each is implemented as described below and covered by tests, and each can be changed in one place before the
document path is released. This page records what the code does, why, and what changing it would take.

## 1. The default display sort is `input`

**What the code does.** When a recipe document omits `options.sort` (bar, horizontal bar, pie, donut, grouped and
stacked bars, box plot) or `rowSort`/`columnSort` (heatmap), the compiler uses `input`: categories appear in the order
their first row arrives after `data.transform`. The default is captured in the saved artifact
(`captured.defaults.recipeOptions`), so a replay keeps it even if the default later changes. `xSort` for line and area
charts is specified by the brief (ascending for temporal and quantitative x, input for ordinal x) and is not part of
this decision.

**Why.** Input order is the only order that needs no assumption about the data: the author, or their query, already
chose it, and an explicit `category-*` or `value-*` sort is one option away. A value sort would reorder a chart whose
categories have a natural order (months, stages, age bands) without being asked, and a category sort would put
"10" before "9". The legacy quick path differs (`horizontal_bar` ranks by value by default); that path is unchanged.

**To change it.** `optionDefaults` in `src/recipes/definitions.ts`. Existing artifacts keep their captured value.

## 2. An area recipe with a series draws overlapping areas, not stacked ones

**What the code does.** The `area` recipe with a `series` binding draws one translucent area per series from the zero
baseline (`stack: null`, opacity 0.55). Stacking is the `stacked_area` recipe, which requires a series. The legacy
quick `area` type with `color` keeps Vega-Lite's default, which stacks.

**Why.** With two recipes, each should mean one thing. If `area` also stacked, `area` + series and `stacked_area`
would be the same chart, and a reader of `area` could not tell whether a band's top edge is its own value or a running
total. Overlapping areas keep every series' value at its true height, which is what a plain area chart claims. The
legacy behaviour is preserved because changing existing charts is out of scope.

**To change it.** The `area` branch of `compileRecipe` in `src/recipes/compile.ts`; the recipe compiler version
(`RECIPE_COMPILER_VERSION`) should move with it, since the same document would compile to a different spec.

## 3. Captured rows are measured as JSON against the data limit

**What the code does.** A saved artifact stores the rows it captured as canonical JSON, and their size is checked
against the existing data limit (`LIMITS.dataBytes`, 32 MiB) as that JSON, not as the size of the source file. The
same check runs when an artifact is written and when it is read.

**Why.** The limit protects the reader of the artifact, which parses JSON; the JSON is what has to fit. Measuring the
source file instead would let a 30 MiB CSV (whose JSON form, with every field name repeated per row, can be two to three
times larger) produce an artifact the plugin could then refuse, or parse at a cost the limit was meant to bound. The
consequence is that a source file close to the limit can fail at capture with `DATA_TOO_LARGE`, with a fix to
aggregate or sample first, while the same file still renders through the legacy path, which never writes rows out.

**To change it.** `ARTIFACT_LIMITS` in `src/document/artifact.ts`. A larger data allowance raises the artifact's total
size limit with it, and a reader of older artifacts needs no change.
