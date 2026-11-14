---
name: charts-cookbook
description: Idiomatic, tested examples for every chart type the charts_* tools draw - typed recipe documents for the 14 standard types, and Vega-Lite, Vega, ECharts, Observable Plot, publication-table and diagram specs for the rest of the 79 - grouped by purpose, with when to use each. Read it before writing a chart document or a spec by hand.
---

# Charts cookbook

Generated from the plugin's own catalogue and recipe registry. For the 14 standard types, the recommended path is a typed recipe document through `charts_quick` (first section). Every other type, and anything a recipe cannot express, is a raw spec through `charts_render`: the advanced path (the sections after it). Each raw spec below is a tested catalogue example. The rows shown are a shape example, the first two of the tested dataset, not the whole of it, and an example tested at a size says so. `charts_catalogue {"id": "…"}` returns the exact tested call: the spec with every row, the title, the currency and the size, ready to pass to `charts_render`. Colours written `"theme:…"` follow the active theme. All 79 types are drawn by six engines: Vega-Lite is the default (bars, lines, areas, scatter, maps, facets); Vega for layouts (treemap, sunburst, tree, force, word cloud); ECharts for flows, calendars and dashboard types (Sankey, chord, gauge, funnel, calendar, candlestick, radar, parallel, theme river); Observable Plot for statistical marks (hexbin, contours, beeswarm, Bollinger, difference, waffle, Voronoi, ridgeline, horizon) and the cartograms and flow map; the table engine for publication data-graphic tables (inline bars, sparklines, deltas, spanners, KPI scorecards); and the diagram engine for Mermaid flowcharts, sequences, states, classes and ER schemas, plus mindmaps, org charts, fishbones and architectures.

## Typed recipe documents (recommended for the 14 standard types)

Pass `{"document": …}` to `charts_quick`. Unknown fields fail with their JSON path; repeated groups need `options.aggregate` (default `none` refuses with `AGGREGATION_REQUIRED`); `count` counts rows and takes no measure. The result names the saved `<name>.chart.json` and its `revision`: change its theme, size or interactions with `charts_update`, never by editing the spec.

### Bar chart — recipe `bar`

Compare one value across categories. One row per category, or set options.aggregate to combine repeated categories. The value is a number.

- Bindings: `category` (required), `value` (required unless `aggregate` is `count`).
- Options: `aggregate` `none` / `sum` / `mean` / `median` / `min` / `max` / `count` (default none); `sort` `input` / `category-ascending` / `category-descending` / `value-ascending` / `value-descending` (default input); `xTitle`; `yTitle`.
- Interactions beyond the defaults: none (tooltip auto or off only).

Rows shown: 2 of 5, a shape example. `charts_catalogue {"id": "bar"}` returns this document with every row, as `recipe.examples[0].call`.

```json
{"version":1,"chart":{"kind":"recipe","recipe":"bar","data":{"rows":[{"product":"Lattes","revenue_eur":182400},{"product":"Pastries","revenue_eur":96300}]},"bindings":{"category":"product","value":"revenue_eur"},"options":{"sort":"value-descending","yTitle":"Revenue (€)"}},"title":"Revenue by product, 2024","currency":"EUR"}
```

### Horizontal bar — recipe `horizontal_bar`

Rank many categories, or long category names, on horizontal bars. One row per category, or set options.aggregate to combine repeated categories. The value is a number.

- Bindings: `category` (required), `value` (required unless `aggregate` is `count`).
- Options: `aggregate` `none` / `sum` / `mean` / `median` / `min` / `max` / `count` (default none); `sort` `input` / `category-ascending` / `category-descending` / `value-ascending` / `value-descending` (default input); `xTitle`; `yTitle`.
- Interactions beyond the defaults: none (tooltip auto or off only).

Rows shown: 2 of 12, a shape example. `charts_catalogue {"id": "horizontal_bar"}` returns this document with every row, as `recipe.examples[0].call`.

```json
{"version":1,"chart":{"kind":"recipe","recipe":"horizontal_bar","data":{"rows":[{"country":"Germany","users_k":820},{"country":"France","users_k":796}]},"bindings":{"category":"country","value":"users_k"},"options":{"sort":"value-descending","xTitle":"Active users (thousands)"}},"title":"Active users by country"}
```

### Grouped bar — recipe `grouped_bar`

Compare series side by side within each category. One row per category and series, or set options.aggregate. The value is a number.

- Bindings: `category` (required), `series` (required), `value` (required unless `aggregate` is `count`).
- Options: `aggregate` `none` / `sum` / `mean` / `median` / `min` / `max` / `count` (default none); `sort` `input` / `category-ascending` / `category-descending` (default input); `xTitle`; `yTitle`.
- Interactions beyond the defaults: legend highlight (needs a series binding).

Rows shown: 2 of 16, a shape example. `charts_catalogue {"id": "grouped_bar"}` returns this document with every row, as `recipe.examples[0].call`.

```json
{"version":1,"chart":{"kind":"recipe","recipe":"grouped_bar","data":{"rows":[{"region":"North","quarter":"Q1","revenue_eur":400000},{"region":"North","quarter":"Q2","revenue_eur":535000}]},"bindings":{"category":"region","series":"quarter","value":"revenue_eur"},"options":{"yTitle":"Revenue (€)"}},"title":"Quarterly revenue by region","currency":"EUR"}
```

### Stacked bar — recipe `stacked_bar`

Show totals and their make-up across categories. One row per category and series, or set options.aggregate. The value is a number.

- Bindings: `category` (required), `series` (required), `value` (required unless `aggregate` is `count`).
- Options: `aggregate` `none` / `sum` / `mean` / `median` / `min` / `max` / `count` (default none); `sort` `input` / `category-ascending` / `category-descending` (default input); `xTitle`; `yTitle`.
- Interactions beyond the defaults: legend highlight (needs a series binding).

Rows shown: 2 of 36, a shape example. `charts_catalogue {"id": "stacked_bar"}` returns this document with every row, as `recipe.examples[0].call`.

```json
{"version":1,"chart":{"kind":"recipe","recipe":"stacked_bar","data":{"rows":[{"date":"2024-01-01","series":"Web","orders":1200},{"date":"2024-02-01","series":"Web","orders":1375}]},"bindings":{"category":"date","series":"series","value":"orders"},"options":{"xTitle":"Month","yTitle":"Orders"}},"title":"Monthly orders by channel"}
```

### Line chart — recipe `line`

A value over time or along an ordered axis, one line per series. One row per x (and series), or set options.aggregate. Temporal x is an ISO date; quantitative x and y are numbers.

- Bindings: `x` (required), `y` (required unless `aggregate` is `count`), `series` (optional).
- Options: `xType` `temporal` / `quantitative` / `ordinal` (required); `aggregate` `none` / `sum` / `mean` / `median` / `min` / `max` / `count` (default none); `xSort` `input` / `ascending` / `descending` (default ascending for temporal and quantitative x; input for ordinal x); `xTitle`; `yTitle`.
- Interactions beyond the defaults: legend highlight (needs a series binding); zoom x (temporal x only).

Rows shown: 2 of 12, a shape example. `charts_catalogue {"id": "line"}` returns this document with every row, as `recipe.examples[0].call`.

```json
{"version":1,"chart":{"kind":"recipe","recipe":"line","data":{"rows":[{"date":"2024-01-01","dau":42000},{"date":"2024-02-01","dau":45850}]},"bindings":{"x":"date","y":"dau"},"options":{"xType":"temporal","yTitle":"Daily active users"}},"title":"Daily active users, 2024"}
```

### Area chart — recipe `area`

A volume over time; with a series, overlapping areas. One row per x (and series), or set options.aggregate. Temporal x is an ISO date; quantitative x and y are numbers.

- Bindings: `x` (required), `y` (required unless `aggregate` is `count`), `series` (optional).
- Options: `xType` `temporal` / `quantitative` / `ordinal` (required); `aggregate` `none` / `sum` / `mean` / `median` / `min` / `max` / `count` (default none); `xSort` `input` / `ascending` / `descending` (default ascending for temporal and quantitative x; input for ordinal x); `xTitle`; `yTitle`.
- Interactions beyond the defaults: legend highlight (needs a series binding); zoom x (temporal x only).

Rows shown: 2 of 12, a shape example. `charts_catalogue {"id": "area"}` returns this document with every row, as `recipe.examples[0].call`.

```json
{"version":1,"chart":{"kind":"recipe","recipe":"area","data":{"rows":[{"date":"2024-01-01","storage_tb":40},{"date":"2024-02-01","storage_tb":48}]},"bindings":{"x":"date","y":"storage_tb"},"options":{"xType":"temporal","yTitle":"Storage (TB)"}},"title":"Storage used"}
```

### Stacked area — recipe `stacked_area`

Totals over time and how each series contributes. One row per x and series, or set options.aggregate. Temporal x is an ISO date; y is a number.

- Bindings: `x` (required), `y` (required unless `aggregate` is `count`), `series` (required).
- Options: `xType` `temporal` / `quantitative` / `ordinal` (required); `aggregate` `none` / `sum` / `mean` / `median` / `min` / `max` / `count` (default none); `xSort` `input` / `ascending` / `descending` (default ascending for temporal and quantitative x; input for ordinal x); `xTitle`; `yTitle`.
- Interactions beyond the defaults: legend highlight (needs a series binding).

Rows shown: 2 of 48, a shape example. `charts_catalogue {"id": "stacked_area"}` returns this document with every row, as `recipe.examples[0].call`.

```json
{"version":1,"chart":{"kind":"recipe","recipe":"stacked_area","data":{"rows":[{"date":"2024-01-01","region":"North","revenue_eur":300000},{"date":"2024-02-01","region":"North","revenue_eur":336100}]},"bindings":{"x":"date","y":"revenue_eur","series":"region"},"options":{"xType":"temporal","yTitle":"Revenue (€)"}},"title":"Revenue by region","currency":"EUR"}
```

### Scatter plot — recipe `scatter`

The relationship between two numbers, one point per row. One row per point; x and y are numbers on every row.

- Bindings: `x` (required), `y` (required), `series` (optional).
- Options: `xTitle`; `yTitle`.
- Interactions beyond the defaults: legend highlight (needs a series binding); brush interval.

Rows shown: 2 of 60, a shape example. `charts_catalogue {"id": "scatter"}` returns this document with every row, as `recipe.examples[0].call`.

```json
{"version":1,"chart":{"kind":"recipe","recipe":"scatter","data":{"rows":[{"spend_k":5,"conversions":0,"channel":"Search","customers":50},{"spend_k":42,"conversions":91,"channel":"Social","customers":79}]},"bindings":{"x":"spend_k","y":"conversions","series":"channel"},"options":{"xTitle":"Spend (€k)","yTitle":"Conversions"}},"title":"Spend vs conversions"}
```

### Bubble chart — recipe `bubble`

A scatter plot with a third number as the point's area. One row per bubble; x, y and size are numbers on every row.

- Bindings: `x` (required), `y` (required), `size` (required), `series` (optional).
- Options: `xTitle`; `yTitle`.
- Interactions beyond the defaults: legend highlight (needs a series binding); brush interval.

Rows shown: 2 of 30, a shape example. `charts_catalogue {"id": "bubble"}` returns this document with every row, as `recipe.examples[0].call`.

```json
{"version":1,"chart":{"kind":"recipe","recipe":"bubble","data":{"rows":[{"spend_k":5,"conversions":0,"channel":"Search","customers":50},{"spend_k":42,"conversions":91,"channel":"Social","customers":79}]},"bindings":{"x":"spend_k","y":"conversions","size":"customers","series":"channel"},"options":{"xTitle":"Spend (€k)","yTitle":"Conversions"}},"title":"Campaigns: spend, conversions and reach"}
```

### Pie chart — recipe `pie`

Parts of one whole, for a few slices. One row per slice, or set options.aggregate to sum or count. Values are zero or more; a pie cannot show a negative part.

- Bindings: `category` (required), `value` (required unless `aggregate` is `count`).
- Options: `aggregate` `none` / `sum` / `count` (default none); `sort` `input` / `category-ascending` / `category-descending` / `value-ascending` / `value-descending` (default input).
- Interactions beyond the defaults: none (tooltip auto or off only).

Rows shown: 2 of 4, a shape example. `charts_catalogue {"id": "pie"}` returns this document with every row, as `recipe.examples[0].call`.

```json
{"version":1,"chart":{"kind":"recipe","recipe":"pie","data":{"rows":[{"source":"Search","visits":4200},{"source":"Direct","visits":2600}]},"bindings":{"category":"source","value":"visits"},"options":{"sort":"value-descending"}},"title":"Traffic sources"}
```

### Donut chart — recipe `donut`

A pie with a hole, for a few slices. One row per slice, or set options.aggregate to sum or count. Values are zero or more; a donut cannot show a negative part.

- Bindings: `category` (required), `value` (required unless `aggregate` is `count`).
- Options: `aggregate` `none` / `sum` / `count` (default none); `sort` `input` / `category-ascending` / `category-descending` / `value-ascending` / `value-descending` (default input).
- Interactions beyond the defaults: none (tooltip auto or off only).

Rows shown: 2 of 4, a shape example. `charts_catalogue {"id": "donut"}` returns this document with every row, as `recipe.examples[0].call`.

```json
{"version":1,"chart":{"kind":"recipe","recipe":"donut","data":{"rows":[{"item":"Payroll","share":0.52},{"item":"Infrastructure","share":0.21}]},"bindings":{"category":"item","value":"share"},"options":{"sort":"value-descending"}},"title":"Budget split"}
```

### Histogram — recipe `histogram`

The shape of one numeric variable: rows counted per bin. One row per observation; the value is a number. Rows without a value are left out and reported.

- Bindings: `value` (required).
- Options: `bins` 2–200 (default 24); `xTitle`; `yTitle`.
- Interactions beyond the defaults: none (tooltip auto or off only).

Rows shown: 2 of 240, a shape example. `charts_catalogue {"id": "histogram"}` returns this document with every row, as `recipe.examples[0].call`.

```json
{"version":1,"chart":{"kind":"recipe","recipe":"histogram","data":{"rows":[{"group":"A","latency_ms":229.2},{"group":"B","latency_ms":158.5}]},"bindings":{"value":"latency_ms"},"options":{"bins":24,"xTitle":"Latency (ms)","yTitle":"Requests"}},"title":"Checkout latency"}
```

### Box plot — recipe `box_plot`

Medians, spread and outliers of a value across categories. One row per observation; the value is a number. The recipe never pre-aggregates: the box summarises every row.

- Bindings: `category` (required), `value` (required).
- Options: `sort` `input` / `category-ascending` / `category-descending` (default input); `xTitle`; `yTitle`.
- Interactions beyond the defaults: none (tooltip auto or off only).

Rows shown: 2 of 240, a shape example. `charts_catalogue {"id": "box_plot"}` returns this document with every row, as `recipe.examples[0].call`.

```json
{"version":1,"chart":{"kind":"recipe","recipe":"box_plot","data":{"rows":[{"group":"A","latency_ms":229.2},{"group":"B","latency_ms":158.5}]},"bindings":{"category":"group","value":"latency_ms"},"options":{"xTitle":"Service","yTitle":"Latency (ms)"}},"title":"Latency by service"}
```

### Heatmap — recipe `heatmap`

A value across two categorical dimensions, one cell each. One row per cell (row and column), or set options.aggregate to combine repeated cells. The value is a number.

- Bindings: `column` (required), `row` (required), `value` (required unless `aggregate` is `count`).
- Options: `aggregate` `none` / `sum` / `mean` / `median` / `min` / `max` / `count` (default none); `rowSort` `input` / `ascending` / `descending` (default input); `columnSort` `input` / `ascending` / `descending` (default input); `xTitle`; `yTitle`.
- Interactions beyond the defaults: none (tooltip auto or off only).

Rows shown: 2 of 84, a shape example. `charts_catalogue {"id": "heatmap"}` returns this document with every row, as `recipe.examples[0].call`.

```json
{"version":1,"chart":{"kind":"recipe","recipe":"heatmap","data":{"rows":[{"day":"Mon","hour":"00:00","orders":20},{"day":"Mon","hour":"02:00","orders":23}]},"bindings":{"column":"hour","row":"day","value":"orders"}},"title":"Orders by weekday and hour"}
```

## comparison

### Bar chart — `bar` (vega-lite)

Compare a value across a few categories. **Avoid:** Over ~15 categories: use horizontal_bar.

Row shape (2 of 5 rows): `[{"product":"Lattes","revenue_eur":182400},{"product":"Pastries","revenue_eur":96300}]`

```json
{"mark":"bar","encoding":{"x":{"field":"product","type":"nominal","sort":"-y"},"y":{"field":"revenue_eur","type":"quantitative"}}}
```

### Horizontal bar (ranked) — `horizontal_bar` (vega-lite)

Rank many categories, or long category names.

Row shape (2 of 12 rows): `[{"country":"Germany","users_k":820},{"country":"France","users_k":796}]`

```json
{"mark":"bar","encoding":{"y":{"field":"country","type":"nominal","sort":"-x"},"x":{"field":"users_k","type":"quantitative"}}}
```

### Grouped bar — `grouped_bar` (vega-lite)

Compare sub-groups side by side within each category (xOffset). **Avoid:** More than ~4 sub-groups: use small multiples.

Row shape (2 of 16 rows): `[{"region":"North","quarter":"Q1","revenue_eur":400000},{"region":"North","quarter":"Q2","revenue_eur":535000}]`

```json
{"mark":"bar","encoding":{"x":{"field":"region","type":"nominal"},"xOffset":{"field":"quarter"},"y":{"field":"revenue_eur","type":"quantitative"},"color":{"field":"quarter","type":"nominal"}}}
```

### Stacked bar — `stacked_bar` (vega-lite)

Show totals and their make-up across categories or time.

Row shape (2 of 36 rows): `[{"date":"2024-01-01","series":"Web","orders":1200},{"date":"2024-02-01","series":"Web","orders":1375}]`

```json
{"mark":"bar","encoding":{"x":{"field":"date","type":"ordinal","timeUnit":"yearmonth","title":"Month"},"y":{"aggregate":"sum","field":"orders","type":"quantitative","title":"Orders"},"color":{"field":"series","type":"nominal","title":"Channel"}}}
```

### Diverging bar — `diverging_bar` (vega-lite)

Gains and losses around zero.

Row shape (2 of 9 rows): `[{"country":"Germany","change_pct":-0.12},{"country":"France","change_pct":-0.06}]`

```json
{"mark":"bar","encoding":{"y":{"field":"country","type":"nominal","sort":"-x"},"x":{"field":"change_pct","type":"quantitative","axis":{"format":"+.0%","labelExpr":"datum.value === 0 ? '0%' : datum.label"},"title":"Change vs 2023"},"color":{"condition":{"test":"datum.change_pct < 0","value":"theme:negative"},"value":"theme:positive"}}}
```

### Lollipop — `lollipop` (vega-lite)

A lighter bar chart for many categories.

Row shape (2 of 8 rows): `[{"store":"Germany","nps":18},{"store":"France","nps":41}]`

```json
{"encoding":{"y":{"field":"store","type":"nominal","sort":"-x","title":"Store"},"x":{"field":"nps","type":"quantitative","title":"NPS (points)"}},"layer":[{"mark":{"type":"rule","strokeWidth":2,"color":"theme:axis"},"encoding":{"x":{"datum":0},"x2":{"field":"nps"}}},{"mark":{"type":"point","filled":true,"size":120}}]}
```

### Dumbbell — `dumbbell` (vega-lite)

Before/after or two values per category.

Row shape (2 of 10 rows): `[{"area":"Search","when":"Before","score":52},{"area":"Search","when":"After","score":61}]`

```json
{"encoding":{"y":{"field":"area","type":"nominal","title":"Area"},"x":{"field":"score","type":"quantitative","scale":{"zero":false,"padding":16},"title":"Score (0–100)"}},"layer":[{"mark":{"type":"line","color":"theme:axis","strokeWidth":2},"encoding":{"detail":{"field":"area"}}},{"mark":{"type":"point","filled":true,"size":110,"opacity":1},"encoding":{"color":{"field":"when","type":"nominal","sort":["Before","After"],"title":null}}}]}
```

### Dot plot (Cleveland) — `dot_plot` (vega-lite)

Precise comparison when bars would be heavy; non-zero baselines are fine.

Row shape (2 of 7 rows): `[{"city":"Berlin","delivery_min":24},{"city":"Paris","delivery_min":41}]`

```json
{"mark":{"type":"point","filled":true,"size":90},"encoding":{"y":{"field":"city","type":"nominal","sort":"x"},"x":{"field":"delivery_min","type":"quantitative","scale":{"zero":false,"padding":16},"title":"Median delivery (min)"}}}
```

### Bullet chart — `bullet` (vega-lite)

Actual against target with qualitative bands (KPIs).

Row shape (2 of 3 rows): `[{"kpi":"Revenue (€k)","poor":600,"ok":800,"good":1000,"actual":870,"target":900},{"kpi":"New customers","poor":300,"ok":450,"good":600,"actual":510,"target":480}]`

Tested at width 520.

```json
{"facet":{"row":{"field":"kpi","type":"nominal","header":{"labelAngle":0,"labelAlign":"left","title":null}}},"resolve":{"scale":{"x":"independent"}},"spec":{"width":420,"height":26,"layer":[{"mark":{"type":"bar","color":"theme:grid"},"encoding":{"x":{"field":"good","type":"quantitative","title":null}}},{"mark":{"type":"bar","color":"theme:neutral","opacity":0.35},"encoding":{"x":{"field":"ok","type":"quantitative"}}},{"mark":{"type":"bar","size":10,"color":"theme:categorical.0"},"encoding":{"x":{"field":"actual","type":"quantitative"}}},{"mark":{"type":"tick","color":"theme:text","thickness":2,"size":22},"encoding":{"x":{"field":"target","type":"quantitative"}}}]}}
```

### Waterfall — `waterfall` (vega-lite)

How increases and decreases build from a start to an end total.

Row shape (2 of 6 rows): `[{"step":"Revenue","amount":1200},{"step":"Cost of goods","amount":-480}]`

Tested at width 560.

```json
{"transform":[{"window":[{"op":"sum","field":"amount","as":"total"}]},{"window":[{"op":"lead","field":"step","as":"lead"}]},{"calculate":"datum.step === 'Profit' ? datum.total : datum.total - datum.amount","as":"previous"},{"calculate":"datum.step === 'Profit' ? 0 : datum.total","as":"end"},{"calculate":"datum.step === 'Profit' ? 'Total' : datum.amount >= 0 ? 'Increase' : 'Decrease'","as":"kind"},{"calculate":"max(datum.previous, datum.end)","as":"top"},{"calculate":"datum.step === 'Profit' ? format(datum.total, ',.0f') : format(datum.amount, '+,.0f')","as":"label"}],"encoding":{"x":{"field":"step","type":"ordinal","sort":null,"title":null,"axis":{"labelAngle":0,"labelOverlap":false}}},"layer":[{"mark":{"type":"bar","width":{"band":0.7}},"encoding":{"y":{"field":"previous","type":"quantitative","title":"€k"},"y2":{"field":"end"},"color":{"field":"kind","type":"nominal","scale":{"domain":["Increase","Decrease","Total"],"range":["theme:positive","theme:negative","theme:neutral"]},"title":null}}},{"mark":{"type":"text","dy":-6,"baseline":"bottom"},"encoding":{"y":{"field":"top","type":"quantitative","title":"€k"},"text":{"field":"label"}}}]}
```

### Arrow change — `arrow_change` (plot)

Two measures before and after, one arrow per item: where each moved, and how far. **Avoid:** Many items, where the arrows cross: use a slope chart or a dumbbell.

Row shape (2 of 4 rows): `[{"label":"Enterprise","start":118,"end":132,"from":64,"to":71},{"label":"Self-serve","start":72,"end":96,"from":38,"to":47}]`

```json
{"width":560,"height":340,"x":{"domain":[50,152],"label":"Average order value (€)"},"y":{"domain":[22,80],"label":"Conversion (%)"},"marks":[{"type":"arrow","x1":"start","y1":"from","x2":"end","y2":"to","bend":16,"stroke":"theme:axis","strokeWidth":1.5},{"type":"dot","x":"start","y":"from","r":2.5,"fill":"theme:muted"},{"type":"dot","x":"end","y":"to","r":2.5,"fill":"theme:categorical.0"},{"type":"text","data":[{"label":"Enterprise","start":118,"end":132,"from":64,"to":71}],"x":"end","y":"to","text":"label","dx":10,"dy":-9,"textAnchor":"start","fill":"theme:text","fontSize":11},{"type":"text","data":[{"label":"Self-serve","start":72,"end":96,"from":38,"to":47}],"x":"end","y":"to","text":"label","dx":10,"dy":3,"textAnchor":"start","fill":"theme:text","fontSize":11},{"type":"text","data":[{"label":"Partners","start":64,"end":58,"from":29,"to":34}],"x":"end","y":"to","text":"label","dx":0,"dy":-11,"textAnchor":"middle","fill":"theme:text","fontSize":11},{"type":"text","data":[{"label":"SMB","start":96,"end":88,"from":51,"to":45}],"x":"end","y":"to","text":"label","dx":-10,"dy":14,"textAnchor":"end","fill":"theme:text","fontSize":11}]}
```

### Pictorial bar — `pictorial_bar` (echarts)

A ranked comparison where a repeated symbol or a capped bar makes the quantities friendlier. **Avoid:** Precision work: a plain bar chart reads more exactly.

Row shape (2 of 6 rows): `[{"country":"Germany","users_k":820},{"country":"France","users_k":796}]`

```json
{"title":{"text":"Active users by country","left":"center","textStyle":{"fontSize":16,"fontWeight":600,"color":"theme:text"}},"grid":{"left":96,"right":64,"top":72,"bottom":32},"xAxis":{"type":"value","splitLine":{"show":true},"axisLabel":{"color":"theme:muted"}},"yAxis":{"type":"category","inverse":true,"data":["Germany","France","Spain","Italy","Netherlands","Poland"],"axisLine":{"show":false},"axisTick":{"show":false},"axisLabel":{"color":"theme:text"}},"series":[{"type":"bar","barWidth":16,"itemStyle":{"color":"theme:categorical.0","borderRadius":8},"label":{"show":true,"position":"right","distance":20,"formatter":"{c}","color":"theme:text","fontSize":11},"data":[820,796,722,648,624,550]},{"type":"pictorialBar","symbol":"circle","symbolPosition":"end","symbolSize":[16,16],"z":3,"itemStyle":{"color":"theme:categorical.0"},"data":[820,796,722,648,624,550]}]}
```

## part-to-whole

### 100% stacked bar — `normalized_bar` (vega-lite)

Compare shares (not totals) across categories.

Row shape (2 of 16 rows): `[{"region":"North","channel":"Web","orders":400},{"region":"North","channel":"App","orders":535}]`

```json
{"mark":"bar","encoding":{"y":{"field":"region","type":"nominal"},"x":{"aggregate":"sum","field":"orders","type":"quantitative","stack":"normalize","axis":{"format":".0%"},"title":"Share of orders"},"color":{"field":"channel","type":"nominal"}}}
```

### Pie chart — `pie` (vega-lite)

Parts of one whole, 2–5 slices. **Avoid:** More than 5–7 slices, or comparing pies: use bars.

Row shape (2 of 4 rows): `[{"source":"Search","visits":4200},{"source":"Direct","visits":2600}]`

```json
{"mark":{"type":"arc"},"encoding":{"theta":{"field":"visits","type":"quantitative","stack":true},"color":{"field":"source","type":"nominal","sort":{"field":"visits","order":"descending"}},"order":{"field":"visits","sort":"descending"}}}
```

### Donut chart — `donut` (vega-lite)

A pie with room for a total in the middle.

Row shape (2 of 4 rows): `[{"item":"Payroll","share":0.52},{"item":"Infrastructure","share":0.21}]`

```json
{"layer":[{"mark":{"type":"arc","innerRadius":68,"outerRadius":104,"padAngle":0.015},"encoding":{"theta":{"field":"share","type":"quantitative","stack":true},"color":{"field":"item","type":"nominal","sort":null},"order":{"field":"share","sort":"descending"}}},{"transform":[{"calculate":"format(datum.share, '.0%')","as":"label"}],"mark":{"type":"text","radius":121,"fontSize":11},"encoding":{"theta":{"field":"share","type":"quantitative","stack":true},"text":{"field":"label"}}},{"data":{"values":[{}]},"mark":{"type":"text","fontSize":22,"fontWeight":500},"encoding":{"text":{"value":"€4.2M"}}}]}
```

### Radial (rose) chart — `radial` (vega-lite)

Cyclical categories such as months or directions.

Row shape (2 of 12 rows): `[{"month":"Jan","rain_mm":75},{"month":"Feb","rain_mm":76}]`

Tested at width 460, height 420.

```json
{"encoding":{"theta":{"field":"month","type":"nominal","sort":null},"radius":{"field":"rain_mm","type":"quantitative","scale":{"type":"sqrt","zero":true,"rangeMin":20}}},"layer":[{"mark":{"type":"arc","stroke":"theme:background","strokeWidth":1},"encoding":{"color":{"field":"rain_mm","type":"quantitative","title":"Rainfall (mm)"}}},{"transform":[{"calculate":"datum.month + ' ' + format(datum.rain_mm, ',.0f')","as":"label"}],"mark":{"type":"text","radiusOffset":20,"fontSize":11},"encoding":{"text":{"field":"label"}}}]}
```

### Funnel — `funnel` (echarts)

Drop-off through ordered stages.

Row shape (2 of 5 rows): `[{"stage":"Visited","visitors":10000,"visitors_label":"10,000"},{"stage":"Viewed product","visitors":6200,"visitors_label":"6,200"}]`

Tested at width 640, height 340.

```json
{"series":[{"type":"funnel","left":"4%","width":"58%","bottom":16,"sort":"descending","gap":2,"encode":{"itemName":"stage","value":"visitors"},"label":{"show":true,"position":"right","formatter":"{b}  {@visitors_label}"},"labelLine":{"show":true,"length":16}}]}
```

### Gauge — `gauge` (echarts)

One KPI against its range, for dashboards. **Avoid:** Several KPIs: use bullet charts.

Tested at width 400, height 320.

```json
{"series":[{"type":"gauge","min":99,"max":100,"splitNumber":4,"startAngle":210,"endAngle":-30,"radius":"82%","progress":{"show":true,"width":14},"axisLine":{"lineStyle":{"width":14}},"pointer":{"show":false},"axisTick":{"show":false},"splitLine":{"show":false},"axisLabel":{"distance":22,"fontSize":11},"detail":{"formatter":"{value}%","fontSize":28,"offsetCenter":[0,"4%"]},"title":{"offsetCenter":[0,"34%"]},"data":[{"value":99.94,"name":"Uptime"}]}]}
```

### Waffle — `waffle` (plot)

A part-to-whole composition as a grid of unit squares: counts readers can point at. **Avoid:** More than ~6 parts, or precise comparison: use a bar chart.

Row shape (2 of 5 rows): `[{"category":"Lattes","value":1824},{"category":"Pastries","value":963}]`

```json
{"width":428,"height":296,"marginTop":8,"marginRight":8,"marginBottom":8,"marginLeft":8,"x":{"domain":[0,412],"axis":null},"y":{"domain":[0,280],"axis":null},"marks":[{"type":"rect","data":[{"x1":1.68,"x2":26.32,"y1":1.68,"y2":26.32,"series":0},{"x1":1.68,"x2":26.32,"y1":29.68,"y2":54.32,"series":0},{"x1":1.68,"x2":26.32,"y1":57.68,"y2":82.32,"series":0},{"x1":1.68,"x2":26.32,"y1":85.68,"y2":110.32,"series":0},{"x1":1.68,"x2":26.32,"y1":113.68,"y2":138.32,"series":0},{"x1":1.68,"x2":26.32,"y1":141.68,"y2":166.32,"series":0},{"x1":1.68,"x2":26.32,"y1":169.68,"y2":194.32,"series":0},{"x1":1.68,"x2":26.32,"y1":197.68,"y2":222.32,"series":0},{"x1":1.68,"x2":26.32,"y1":225.68,"y2":250.32,"series":0},{"x1":1.68,"x2":26.32,"y1":253.68,"y2":278.32,"series":0},{"x1":29.68,"x2":54.32,"y1":1.68,"y2":26.32,"series":0},{"x1":29.68,"x2":54.32,"y1":29.68,"y2":54.32,"series":0},{"x1":29.68,"x2":54.32,"y1":57.68,"y2":82.32,"series":0},{"x1":29.68,"x2":54.32,"y1":85.68,"y2":110.32,"series":0},{"x1":29.68,"x2":54.32,"y1":113.68,"y2":138.32,"series":0},{"x1":29.68,"x2":54.32,"y1":141.68,"y2":166.32,"series":0},{"x1":29.68,"x2":54.32,"y1":169.68,"y2":194.32,"series":0},{"x1":29.68,"x2":54.32,"y1":197.68,"y2":222.32,"series":0},{"x1":29.68,"x2":54.32,"y1":225.68,"y2":250.32,"series":0},{"x1":29.68,"x2":54.32,"y1":253.68,"y2":278.32,"series":0},{"x1":57.68,"x2":82.32,"y1":1.68,"y2":26.32,"series":0},{"x1":57.68,"x2":82.32,"y1":29.68,"y2":54.32,"series":0},{"x1":57.68,"x2":82.32,"y1":57.68,"y2":82.32,"series":0},{"x1":57.68,"x2":82.32,"y1":85.68,"y2":110.32,"series":0},{"x1":57.68,"x2":82.32,"y1":113.68,"y2":138.32,"series":0},{"x1":57.68,"x2":82.32,"y1":141.68,"y2":166.32,"series":0},{"x1":57.68,"x2":82.32,"y1":169.68,"y2":194.32,"series":0},{"x1":57.68,"x2":82.32,"y1":197.68,"y2":222.32,"series":0},{"x1":57.68,"x2":82.32,"y1":225.68,"y2":250.32,"series":0},{"x1":57.68,"x2":82.32,"y1":253.68,"y2":278.32,"series":0},{"x1":85.68,"x2":110.32,"y1":1.68,"y2":26.32,"series":0},{"x1":85.68,"x2":110.32,"y1":29.68,"y2":54.32,"series":0},{"x1":85.68,"x2":110.32,"y1":57.68,"y2":82.32,"series":0},{"x1":85.68,"x2":110.32,"y1":85.68,"y2":110.32,"series":0},{"x1":85.68,"x2":110.32,"y1":113.68,"y2":138.32,"series":0},{"x1":85.68,"x2":110.32,"y1":141.68,"y2":166.32,"series":0},{"x1":85.68,"x2":110.32,"y1":169.68,"y2":194.32,"series":0}],"x1":"x1","x2":"x2","y1":"y1","y2":"y2","fill":"theme:categorical.0","stroke":"none","title":"Lattes"},{"type":"rect","data":[{"x1":85.68,"x2":110.32,"y1":197.68,"y2":222.32,"series":1},{"x1":85.68,"x2":110.32,"y1":225.68,"y2":250.32,"series":1},{"x1":85.68,"x2":110.32,"y1":253.68,"y2":278.32,"series":1},{"x1":113.68,"x2":138.32,"y1":1.68,"y2":26.32,"series":1},{"x1":113.68,"x2":138.32,"y1":29.68,"y2":54.32,"series":1},{"x1":113.68,"x2":138.32,"y1":57.68,"y2":82.32,"series":1},{"x1":113.68,"x2":138.32,"y1":85.68,"y2":110.32,"series":1},{"x1":113.68,"x2":138.32,"y1":113.68,"y2":138.32,"series":1},{"x1":113.68,"x2":138.32,"y1":141.68,"y2":166.32,"series":1},{"x1":113.68,"x2":138.32,"y1":169.68,"y2":194.32,"series":1},{"x1":113.68,"x2":138.32,"y1":197.68,"y2":222.32,"series":1},{"x1":113.68,"x2":138.32,"y1":225.68,"y2":250.32,"series":1},{"x1":113.68,"x2":138.32,"y1":253.68,"y2":278.32,"series":1},{"x1":141.68,"x2":166.32,"y1":1.68,"y2":26.32,"series":1},{"x1":141.68,"x2":166.32,"y1":29.68,"y2":54.32,"series":1},{"x1":141.68,"x2":166.32,"y1":57.68,"y2":82.32,"series":1},{"x1":141.68,"x2":166.32,"y1":85.68,"y2":110.32,"series":1},{"x1":141.68,"x2":166.32,"y1":113.68,"y2":138.32,"series":1},{"x1":141.68,"x2":166.32,"y1":141.68,"y2":166.32,"series":1},{"x1":141.68,"x2":166.32,"y1":169.68,"y2":194.32,"series":1},{"x1":141.68,"x2":166.32,"y1":197.68,"y2":222.32,"series":1},{"x1":141.68,"x2":166.32,"y1":225.68,"y2":250.32,"series":1},{"x1":141.68,"x2":166.32,"y1":253.68,"y2":278.32,"series":1},{"x1":169.68,"x2":194.32,"y1":1.68,"y2":26.32,"series":1},{"x1":169.68,"x2":194.32,"y1":29.68,"y2":54.32,"series":1},{"x1":169.68,"x2":194.32,"y1":57.68,"y2":82.32,"series":1},{"x1":169.68,"x2":194.32,"y1":85.68,"y2":110.32,"series":1},{"x1":169.68,"x2":194.32,"y1":113.68,"y2":138.32,"series":1}],"x1":"x1","x2":"x2","y1":"y1","y2":"y2","fill":"theme:categorical.1","stroke":"none","title":"Beans"},{"type":"rect","data":[{"x1":169.68,"x2":194.32,"y1":141.68,"y2":166.32,"series":2},{"x1":169.68,"x2":194.32,"y1":169.68,"y2":194.32,"series":2},{"x1":169.68,"x2":194.32,"y1":197.68,"y2":222.32,"series":2},{"x1":169.68,"x2":194.32,"y1":225.68,"y2":250.32,"series":2},{"x1":169.68,"x2":194.32,"y1":253.68,"y2":278.32,"series":2},{"x1":197.68,"x2":222.32,"y1":1.68,"y2":26.32,"series":2},{"x1":197.68,"x2":222.32,"y1":29.68,"y2":54.32,"series":2},{"x1":197.68,"x2":222.32,"y1":57.68,"y2":82.32,"series":2},{"x1":197.68,"x2":222.32,"y1":85.68,"y2":110.32,"series":2},{"x1":197.68,"x2":222.32,"y1":113.68,"y2":138.32,"series":2},{"x1":197.68,"x2":222.32,"y1":141.68,"y2":166.32,"series":2},{"x1":197.68,"x2":222.32,"y1":169.68,"y2":194.32,"series":2},{"x1":197.68,"x2":222.32,"y1":197.68,"y2":222.32,"series":2},{"x1":197.68,"x2":222.32,"y1":225.68,"y2":250.32,"series":2},{"x1":197.68,"x2":222.32,"y1":253.68,"y2":278.32,"series":2},{"x1":225.68,"x2":250.32,"y1":1.68,"y2":26.32,"series":2},{"x1":225.68,"x2":250.32,"y1":29.68,"y2":54.32,"series":2},{"x1":225.68,"x2":250.32,"y1":57.68,"y2":82.32,"series":2},{"x1":225.68,"x2":250.32,"y1":85.68,"y2":110.32,"series":2}],"x1":"x1","x2":"x2","y1":"y1","y2":"y2","fill":"theme:categorical.2","stroke":"none","title":"Pastries"},{"type":"rect","data":[{"x1":225.68,"x2":250.32,"y1":113.68,"y2":138.32,"series":3},{"x1":225.68,"x2":250.32,"y1":141.68,"y2":166.32,"series":3},{"x1":225.68,"x2":250.32,"y1":169.68,"y2":194.32,"series":3},{"x1":225.68,"x2":250.32,"y1":197.68,"y2":222.32,"series":3},{"x1":225.68,"x2":250.32,"y1":225.68,"y2":250.32,"series":3},{"x1":225.68,"x2":250.32,"y1":253.68,"y2":278.32,"series":3},{"x1":253.68,"x2":278.32,"y1":1.68,"y2":26.32,"series":3},{"x1":253.68,"x2":278.32,"y1":29.68,"y2":54.32,"series":3},{"x1":253.68,"x2":278.32,"y1":57.68,"y2":82.32,"series":3},{"x1":253.68,"x2":278.32,"y1":85.68,"y2":110.32,"series":3},{"x1":253.68,"x2":278.32,"y1":113.68,"y2":138.32,"series":3}],"x1":"x1","x2":"x2","y1":"y1","y2":"y2","fill":"theme:categorical.3","stroke":"none","title":"Tea"},{"type":"rect","data":[{"x1":253.68,"x2":278.32,"y1":141.68,"y2":166.32,"series":4},{"x1":253.68,"x2":278.32,"y1":169.68,"y2":194.32,"series":4},{"x1":253.68,"x2":278.32,"y1":197.68,"y2":222.32,"series":4},{"x1":253.68,"x2":278.32,"y1":225.68,"y2":250.32,"series":4},{"x1":253.68,"x2":278.32,"y1":253.68,"y2":278.32,"series":4}],"x1":"x1","x2":"x2","y1":"y1","y2":"y2","fill":"theme:categorical.4","stroke":"none","title":"Merch"},{"type":"rect","data":[{"x1":298,"x2":310,"y1":252,"y2":274}],"x1":"x1","x2":"x2","y1":"y1","y2":"y2","fill":"theme:categorical.0","stroke":"none"},{"type":"text","data":[{"x":316,"y":270,"text":"Lattes 37%"}],"x":"x","y":"y","text":"text","textAnchor":"start","fill":"theme:muted","fontSize":11},{"type":"rect","data":[{"x1":298,"x2":310,"y1":230,"y2":252}],"x1":"x1","x2":"x2","y1":"y1","y2":"y2","fill":"theme:categorical.1","stroke":"none"},{"type":"text","data":[{"x":316,"y":248,"text":"Beans 28%"}],"x":"x","y":"y","text":"text","textAnchor":"start","fill":"theme:muted","fontSize":11},{"type":"rect","data":[{"x1":298,"x2":310,"y1":208,"y2":230}],"x1":"x1","x2":"x2","y1":"y1","y2":"y2","fill":"theme:categorical.2","stroke":"none"},{"type":"text","data":[{"x":316,"y":226,"text":"Pastries 19%"}],"x":"x","y":"y","text":"text","textAnchor":"start","fill":"theme:muted","fontSize":11},{"type":"rect","data":[{"x1":298,"x2":310,"y1":186,"y2":208}],"x1":"x1","x2":"x2","y1":"y1","y2":"y2","fill":"theme:categorical.3","stroke":"none"},{"type":"text","data":[{"x":316,"y":204,"text":"Tea 11%"}],"x":"x","y":"y","text":"text","textAnchor":"start","fill":"theme:muted","fontSize":11},{"type":"rect","data":[{"x1":298,"x2":310,"y1":164,"y2":186}],"x1":"x1","x2":"x2","y1":"y1","y2":"y2","fill":"theme:categorical.4","stroke":"none"},{"type":"text","data":[{"x":316,"y":182,"text":"Merch 5%"}],"x":"x","y":"y","text":"text","textAnchor":"start","fill":"theme:muted","fontSize":11}]}
```

## trend

### Line chart — `line` (vega-lite)

A value over time.

Row shape (2 of 12 rows): `[{"date":"2024-01-01","dau":42000},{"date":"2024-02-01","dau":45850}]`

```json
{"mark":{"type":"line","point":true},"encoding":{"x":{"field":"date","type":"temporal","title":null},"y":{"field":"dau","type":"quantitative","title":"Daily active users"}}}
```

### Multi-series line — `multi_line` (vega-lite)

Compare a few series over time (≤ 7). **Avoid:** More than ~7 series: highlight one or use small multiples.

Row shape (2 of 48 rows): `[{"date":"2024-01-01","series":"Search","conversion_rate":0.03},{"date":"2024-02-01","series":"Search","conversion_rate":0.03361}]`

```json
{"mark":"line","encoding":{"x":{"field":"date","type":"temporal","title":null},"y":{"field":"conversion_rate","type":"quantitative","axis":{"format":".1%"},"title":"Conversion rate"},"color":{"field":"series","type":"nominal","title":"Channel"}}}
```

### Area chart — `area` (vega-lite)

A single volume over time.

Row shape (2 of 12 rows): `[{"date":"2024-01-01","storage_tb":40},{"date":"2024-02-01","storage_tb":48}]`

```json
{"mark":{"type":"area","line":true},"encoding":{"x":{"field":"date","type":"temporal","title":null},"y":{"field":"storage_tb","type":"quantitative"}}}
```

### Stacked area — `stacked_area` (vega-lite)

Totals over time and how parts contribute.

Row shape (2 of 48 rows): `[{"date":"2024-01-01","region":"North","revenue_eur":300000},{"date":"2024-02-01","region":"North","revenue_eur":336100}]`

```json
{"mark":"area","encoding":{"x":{"field":"date","type":"temporal","title":null},"y":{"field":"revenue_eur","type":"quantitative","stack":"zero"},"color":{"field":"region","type":"nominal"}}}
```

### Streamgraph — `streamgraph` (vega-lite)

Changing composition where the overall shape matters more than exact values.

Row shape (2 of 60 rows): `[{"date":"2024-01-01","genre":"Pop","hours":200},{"date":"2024-02-01","genre":"Pop","hours":244}]`

```json
{"mark":"area","encoding":{"x":{"field":"date","type":"temporal","title":null,"axis":{"domain":false,"grid":false}},"y":{"aggregate":"sum","field":"hours","type":"quantitative","stack":"center","axis":null},"color":{"field":"genre","type":"nominal"}}}
```

### Step line — `step_line` (vega-lite)

Values that change at discrete moments (prices, rates, plans).

Row shape (2 of 12 rows): `[{"date":"2024-01-01","rate":0.045},{"date":"2024-02-01","rate":0.045}]`

```json
{"mark":{"type":"line","interpolate":"step-after"},"encoding":{"x":{"field":"date","type":"temporal","title":null},"y":{"field":"rate","type":"quantitative","axis":{"format":".2%"},"scale":{"zero":false},"title":"Rate"}}}
```

### Line with confidence band — `line_band` (vega-lite)

An estimate with its uncertainty.

Row shape (2 of 12 rows): `[{"date":"2024-01-01","forecast":500,"low":470,"high":530},{"date":"2024-02-01","forecast":550.2,"low":514.2,"high":586.2}]`

```json
{"encoding":{"x":{"field":"date","type":"temporal","title":null}},"layer":[{"mark":{"type":"area","opacity":0.25},"encoding":{"y":{"field":"low","type":"quantitative","title":"Units per day"},"y2":{"field":"high"}}},{"mark":"line","encoding":{"y":{"field":"forecast","type":"quantitative","title":"Units per day"}}}]}
```

### Slope chart — `slope` (vega-lite)

Change between two moments for several items.

Row shape (2 of 8 rows): `[{"brand":"Alpha","year":"2023","share":0.31},{"brand":"Alpha","year":"2024","share":0.29}]`

Tested at width 320, height 360.

```json
{"encoding":{"x":{"field":"year","type":"ordinal","axis":{"labelAngle":0},"title":null},"y":{"field":"share","type":"quantitative","axis":{"format":".0%","grid":false},"title":"Market share"},"color":{"field":"brand","type":"nominal","legend":null}},"layer":[{"mark":{"type":"line","point":true}},{"mark":{"type":"text","align":"left","dx":8},"encoding":{"text":{"field":"brand"}},"transform":[{"filter":"datum.year === '2024'"}]}]}
```

### Bump chart — `bump` (vega-lite)

Rank changes over time.

Row shape (2 of 24 rows): `[{"week":1,"team":"Lions","rank":4},{"week":2,"team":"Lions","rank":3}]`

```json
{"mark":{"type":"line","point":{"size":80,"filled":true},"interpolate":"monotone"},"encoding":{"x":{"field":"week","type":"ordinal","title":"Week"},"y":{"field":"rank","type":"ordinal","title":"Position"},"color":{"field":"team","type":"nominal"}}}
```

### Dual axis (bar + line) — `dual_axis` (vega-lite)

Two measures with different units that share time — label both axes. **Avoid:** Readers compare heights across axes; prefer two aligned charts.

Row shape (2 of 12 rows): `[{"date":"2024-01-01","orders":3200,"basket_eur":41.64},{"date":"2024-02-01","orders":3515,"basket_eur":41.07}]`

```json
{"encoding":{"x":{"field":"date","type":"temporal","timeUnit":"yearmonth","title":null}},"layer":[{"mark":{"type":"bar","opacity":0.8},"encoding":{"y":{"field":"orders","type":"quantitative","title":"Orders"},"color":{"datum":"Orders","type":"nominal","title":null,"scale":{"domain":["Orders","Average basket (€)"],"range":["theme:categorical.0","theme:categorical.1"]}}}},{"mark":{"type":"line","strokeWidth":3},"encoding":{"y":{"field":"basket_eur","type":"quantitative","title":"Average basket (€)","axis":{"titleColor":"theme:categorical.1"}},"color":{"datum":"Average basket (€)","type":"nominal","title":null,"scale":{"domain":["Orders","Average basket (€)"],"range":["theme:categorical.0","theme:categorical.1"]}}}}],"resolve":{"scale":{"y":"independent","color":"shared"}}}
```

### Small multiples (facet) — `small_multiples` (vega-lite)

Many series: one small chart each, same scales.

Row shape (2 of 48 rows): `[{"date":"2024-01-01","region":"North","signups":900},{"date":"2024-02-01","region":"North","signups":1018}]`

```json
{"facet":{"field":"region","type":"nominal","title":null},"columns":2,"spacing":24,"spec":{"width":240,"height":120,"mark":"area","encoding":{"x":{"field":"date","type":"temporal","title":null,"axis":{"format":"%b"}},"y":{"field":"signups","type":"quantitative","title":"Sign-ups"}}}}
```

### Calendar heatmap — `calendar_heatmap` (echarts)

Daily values over a year, where weekday patterns matter.

Row shape (2 of 366 rows): `[{"date":"2024-01-01","commits":3},{"date":"2024-01-02","commits":5}]`

Tested at width 820, height 220.

```json
{"visualMap":{"min":0,"max":14,"orient":"horizontal","left":"center","bottom":4,"itemHeight":120,"calculable":false,"text":["14 commits","0"]},"calendar":{"range":"2024","cellSize":["auto",14],"left":52,"right":32,"dayLabel":{"nameMap":["Sun","Mon","Tue","Wed","Thu","Fri","Sat"]},"yearLabel":{"show":false},"splitLine":{"show":false},"itemStyle":{"color":"theme:background","borderColor":"theme:background"}},"series":[{"type":"heatmap","coordinateSystem":"calendar","encode":{"time":"date","value":"commits"},"itemStyle":{"borderColor":"theme:background","borderWidth":1}}]}
```

### Candlestick — `candlestick` (echarts)

Open, high, low and close per period.

Row shape (2 of 30 rows): `[{"date":"01 Mar","open":100,"close":102.5,"low":98.8,"high":103.6},{"date":"02 Mar","open":104.75,"close":103.43,"low":101.83,"high":106.15}]`

```json
{"grid":{"left":56,"right":24,"top":64,"bottom":36},"xAxis":{"type":"category","axisLabel":{"interval":4},"splitLine":{"show":false}},"yAxis":{"type":"value","scale":true,"name":"€","nameTextStyle":{"align":"right"}},"series":[{"type":"candlestick","encode":{"x":"date","y":["open","close","low","high"]}}]}
```

### Bollinger band — `bollinger` (plot)

A time series with a moving average and a volatility band around it, so a run above or below normal shows. **Avoid:** A short series: the band needs a window of points to mean anything.

Row shape (2 of 52 rows): `[{"week":1,"sessions":4441},{"week":2,"sessions":4780}]`

```json
{"width":560,"height":340,"x":{"domain":[20,52],"label":"Week"},"y":{"label":"Sessions"},"marks":[{"type":"bollingerY","x":"week","y":"sessions","n":20,"k":2,"fill":"theme:categorical.0","fillOpacity":0.22,"stroke":"theme:categorical.0","strokeWidth":1.5}]}
```

### Difference area — `difference_area` (plot)

Two series shaded by which one is ahead: plan against actual, forecast against outcome. **Avoid:** Series that cross many times: the bands become noise; plot both lines.

Row shape (2 of 28 rows): `[{"day":1,"plan":100,"actual":98},{"day":2,"plan":102,"actual":106}]`

```json
{"width":560,"height":340,"x":{"label":"Day"},"marks":[{"type":"differenceY","x":"day","y1":"plan","y2":"actual","positiveFill":"theme:positive","negativeFill":"theme:negative","fillOpacity":0.7},{"type":"lineY","x":"day","y":"plan","stroke":"theme:text","strokeWidth":1.5},{"type":"lineY","x":"day","y":"actual","stroke":"theme:muted","strokeWidth":1.5},{"type":"text","data":[{"x":2,"y":147,"text":"Above plan"}],"x":"x","y":"y","text":"text","textAnchor":"start","fill":"theme:positive","fontSize":11,"fontWeight":600},{"type":"text","data":[{"x":2,"y":141,"text":"Below plan"}],"x":"x","y":"y","text":"text","textAnchor":"start","fill":"theme:negative","fontSize":11,"fontWeight":600},{"type":"text","data":[{"x":28,"y":154,"text":"Plan"}],"x":"x","y":"y","text":"text","textAnchor":"end","dx":-8,"dy":-11,"fill":"theme:text","fontSize":11,"fontWeight":600},{"type":"text","data":[{"x":24,"y":137.3,"text":"Actual"}],"x":"x","y":"y","text":"text","textAnchor":"start","dx":6,"dy":16,"fill":"theme:muted","fontSize":11,"fontWeight":600}]}
```

### Horizon chart — `horizon` (plot)

A long run folded into colour bands, so a year fits in a short strip. **Avoid:** Reading exact values: a folded value is not a height; use a line chart.

Row shape (2 of 120 rows): `[{"day":1,"page_views":73},{"day":2,"page_views":76}]`

```json
{"width":560,"height":196,"marginTop":28,"x":{"domain":[1,120],"label":"Day"},"y":{"domain":[0,1],"axis":null},"color":{"type":"ordinal","domain":[0,1,2,3],"range":["theme:sequential.2","theme:sequential.4","theme:sequential.6","theme:sequential.7"],"legend":false},"marks":[{"type":"areaY","data":[{"x":1,"y0":0,"y1":1,"band":0},{"x":2,"y0":0,"y1":1,"band":0},{"x":3,"y0":0,"y1":1,"band":0},{"x":4,"y0":0,"y1":1,"band":0},{"x":5,"y0":0,"y1":1,"band":0},{"x":6,"y0":0,"y1":1,"band":0},{"x":7,"y0":0,"y1":1,"band":0},{"x":8,"y0":0,"y1":1,"band":0},{"x":9,"y0":0,"y1":1,"band":0},{"x":10,"y0":0,"y1":1,"band":0},{"x":11,"y0":0,"y1":1,"band":0},{"x":12,"y0":0,"y1":1,"band":0},{"x":13,"y0":0,"y1":1,"band":0},{"x":14,"y0":0,"y1":1,"band":0},{"x":15,"y0":0,"y1":1,"band":0},{"x":16,"y0":0,"y1":1,"band":0},{"x":17,"y0":0,"y1":1,"band":0},{"x":18,"y0":0,"y1":1,"band":0},{"x":19,"y0":0,"y1":1,"band":0},{"x":20,"y0":0,"y1":1,"band":0},{"x":21,"y0":0,"y1":1,"band":0},{"x":22,"y0":0,"y1":1,"band":0},{"x":23,"y0":0,"y1":1,"band":0},{"x":24,"y0":0,"y1":1,"band":0},{"x":25,"y0":0,"y1":1,"band":0},{"x":26,"y0":0,"y1":1,"band":0},{"x":27,"y0":0,"y1":1,"band":0},{"x":28,"y0":0,"y1":1,"band":0},{"x":29,"y0":0,"y1":1,"band":0},{"x":30,"y0":0,"y1":1,"band":0},{"x":31,"y0":0,"y1":1,"band":0},{"x":32,"y0":0,"y1":1,"band":0},{"x":33,"y0":0,"y1":1,"band":0},{"x":34,"y0":0,"y1":1,"band":0},{"x":35,"y0":0,"y1":1,"band":0},{"x":36,"y0":0,"y1":1,"band":0},{"x":37,"y0":0,"y1":1,"band":0},{"x":38,"y0":0,"y1":1,"band":0},{"x":39,"y0":0,"y1":1,"band":0},{"x":40,"y0":0,"y1":1,"band":0},{"x":41,"y0":0,"y1":1,"band":0},{"x":42,"y0":0,"y1":1,"band":0},{"x":43,"y0":0,"y1":1,"band":0},{"x":44,"y0":0,"y1":1,"band":0},{"x":45,"y0":0,"y1":1,"band":0},{"x":46,"y0":0,"y1":1,"band":0},{"x":47,"y0":0,"y1":1,"band":0},{"x":48,"y0":0,"y1":1,"band":0},{"x":49,"y0":0,"y1":1,"band":0},{"x":50,"y0":0,"y1":1,"band":0},{"x":51,"y0":0,"y1":1,"band":0},{"x":52,"y0":0,"y1":1,"band":0},{"x":53,"y0":0,"y1":1,"band":0},{"x":54,"y0":0,"y1":1,"band":0},{"x":55,"y0":0,"y1":1,"band":0},{"x":56,"y0":0,"y1":1,"band":0},{"x":57,"y0":0,"y1":1,"band":0},{"x":58,"y0":0,"y1":1,"band":0},{"x":59,"y0":0,"y1":1,"band":0},{"x":60,"y0":0,"y1":1,"band":0},{"x":61,"y0":0,"y1":1,"band":0},{"x":62,"y0":0,"y1":1,"band":0},{"x":63,"y0":0,"y1":1,"band":0},{"x":64,"y0":0,"y1":1,"band":0},{"x":65,"y0":0,"y1":1,"band":0},{"x":66,"y0":0,"y1":1,"band":0},{"x":67,"y0":0,"y1":1,"band":0},{"x":68,"y0":0,"y1":1,"band":0},{"x":69,"y0":0,"y1":1,"band":0},{"x":70,"y0":0,"y1":1,"band":0},{"x":71,"y0":0,"y1":1,"band":0},{"x":72,"y0":0,"y1":1,"band":0},{"x":73,"y0":0,"y1":1,"band":0},{"x":74,"y0":0,"y1":1,"band":0},{"x":75,"y0":0,"y1":1,"band":0},{"x":76,"y0":0,"y1":1,"band":0},{"x":77,"y0":0,"y1":1,"band":0},{"x":78,"y0":0,"y1":1,"band":0},{"x":79,"y0":0,"y1":1,"band":0},{"x":80,"y0":0,"y1":1,"band":0},{"x":81,"y0":0,"y1":1,"band":0},{"x":82,"y0":0,"y1":1,"band":0},{"x":83,"y0":0,"y1":1,"band":0},{"x":84,"y0":0,"y1":1,"band":0},{"x":85,"y0":0,"y1":1,"band":0},{"x":86,"y0":0,"y1":1,"band":0},{"x":87,"y0":0,"y1":1,"band":0},{"x":88,"y0":0,"y1":1,"band":0},{"x":89,"y0":0,"y1":1,"band":0},{"x":90,"y0":0,"y1":1,"band":0},{"x":91,"y0":0,"y1":1,"band":0},{"x":92,"y0":0,"y1":1,"band":0},{"x":93,"y0":0,"y1":1,"band":0},{"x":94,"y0":0,"y1":1,"band":0},{"x":95,"y0":0,"y1":1,"band":0},{"x":96,"y0":0,"y1":1,"band":0},{"x":97,"y0":0,"y1":1,"band":0},{"x":98,"y0":0,"y1":1,"band":0},{"x":99,"y0":0,"y1":1,"band":0},{"x":100,"y0":0,"y1":1,"band":0},{"x":101,"y0":0,"y1":1,"band":0},{"x":102,"y0":0,"y1":1,"band":0},{"x":103,"y0":0,"y1":1,"band":0},{"x":104,"y0":0,"y1":1,"band":0},{"x":105,"y0":0,"y1":1,"band":0},{"x":106,"y0":0,"y1":1,"band":0},{"x":107,"y0":0,"y1":1,"band":0},{"x":108,"y0":0,"y1":1,"band":0},{"x":109,"y0":0,"y1":1,"band":0},{"x":110,"y0":0,"y1":1,"band":0},{"x":111,"y0":0,"y1":1,"band":0},{"x":112,"y0":0,"y1":1,"band":0},{"x":113,"y0":0,"y1":1,"band":0},{"x":114,"y0":0,"y1":1,"band":0},{"x":115,"y0":0,"y1":1,"band":0},{"x":116,"y0":0,"y1":1,"band":0},{"x":117,"y0":0,"y1":1,"band":0},{"x":118,"y0":0,"y1":1,"band":0},{"x":119,"y0":0,"y1":1,"band":0},{"x":120,"y0":0,"y1":1,"band":0},{"x":1,"y0":0,"y1":1,"band":1},{"x":2,"y0":0,"y1":1,"band":1},{"x":3,"y0":0,"y1":1,"band":1},{"x":4,"y0":0,"y1":1,"band":1},{"x":5,"y0":0,"y1":1,"band":1},{"x":6,"y0":0,"y1":1,"band":1},{"x":7,"y0":0,"y1":1,"band":1},{"x":8,"y0":0,"y1":1,"band":1},{"x":9,"y0":0,"y1":1,"band":1},{"x":10,"y0":0,"y1":1,"band":1},{"x":11,"y0":0,"y1":1,"band":1},{"x":12,"y0":0,"y1":1,"band":1},{"x":13,"y0":0,"y1":1,"band":1},{"x":14,"y0":0,"y1":1,"band":1},{"x":15,"y0":0,"y1":1,"band":1},{"x":16,"y0":0,"y1":1,"band":1},{"x":17,"y0":0,"y1":1,"band":1},{"x":18,"y0":0,"y1":1,"band":1},{"x":19,"y0":0,"y1":1,"band":1},{"x":20,"y0":0,"y1":1,"band":1},{"x":21,"y0":0,"y1":1,"band":1},{"x":22,"y0":0,"y1":1,"band":1},{"x":23,"y0":0,"y1":1,"band":1},{"x":24,"y0":0,"y1":1,"band":1},{"x":25,"y0":0,"y1":1,"band":1},{"x":26,"y0":0,"y1":1,"band":1},{"x":27,"y0":0,"y1":1,"band":1},{"x":28,"y0":0,"y1":1,"band":1},{"x":29,"y0":0,"y1":1,"band":1},{"x":30,"y0":0,"y1":1,"band":1},{"x":31,"y0":0,"y1":1,"band":1},{"x":32,"y0":0,"y1":1,"band":1},{"x":33,"y0":0,"y1":1,"band":1},{"x":34,"y0":0,"y1":1,"band":1},{"x":35,"y0":0,"y1":1,"band":1},{"x":36,"y0":0,"y1":1,"band":1},{"x":37,"y0":0,"y1":1,"band":1},{"x":38,"y0":0,"y1":1,"band":1},{"x":39,"y0":0,"y1":1,"band":1},{"x":40,"y0":0,"y1":1,"band":1},{"x":41,"y0":0,"y1":1,"band":1},{"x":42,"y0":0,"y1":1,"band":1},{"x":43,"y0":0,"y1":1,"band":1},{"x":44,"y0":0,"y1":1,"band":1},{"x":45,"y0":0,"y1":1,"band":1},{"x":46,"y0":0,"y1":1,"band":1},{"x":47,"y0":0,"y1":1,"band":1},{"x":48,"y0":0,"y1":1,"band":1},{"x":49,"y0":0,"y1":1,"band":1},{"x":50,"y0":0,"y1":1,"band":1},{"x":51,"y0":0,"y1":1,"band":1},{"x":52,"y0":0,"y1":1,"band":1},{"x":53,"y0":0,"y1":1,"band":1},{"x":54,"y0":0,"y1":1,"band":1},{"x":55,"y0":0,"y1":1,"band":1},{"x":56,"y0":0,"y1":0.9111111111111111,"band":1},{"x":57,"y0":0,"y1":0.8666666666666667,"band":1},{"x":58,"y0":0,"y1":0.9111111111111111,"band":1},{"x":59,"y0":0,"y1":1,"band":1},{"x":60,"y0":0,"y1":1,"band":1},{"x":61,"y0":0,"y1":1,"band":1},{"x":62,"y0":0,"y1":1,"band":1},{"x":63,"y0":0,"y1":1,"band":1},{"x":64,"y0":0,"y1":1,"band":1},{"x":65,"y0":0,"y1":1,"band":1},{"x":66,"y0":0,"y1":1,"band":1},{"x":67,"y0":0,"y1":1,"band":1},{"x":68,"y0":0,"y1":1,"band":1},{"x":69,"y0":0,"y1":1,"band":1},{"x":70,"y0":0,"y1":1,"band":1},{"x":71,"y0":0,"y1":1,"band":1},{"x":72,"y0":0,"y1":1,"band":1},{"x":73,"y0":0,"y1":1,"band":1},{"x":74,"y0":0,"y1":1,"band":1},{"x":75,"y0":0,"y1":1,"band":1},{"x":76,"y0":0,"y1":1,"band":1},{"x":77,"y0":0,"y1":1,"band":1},{"x":78,"y0":0,"y1":1,"band":1},{"x":79,"y0":0,"y1":1,"band":1},{"x":80,"y0":0,"y1":1,"band":1},{"x":81,"y0":0,"y1":1,"band":1},{"x":82,"y0":0,"y1":1,"band":1},{"x":83,"y0":0,"y1":1,"band":1},{"x":84,"y0":0,"y1":1,"band":1},{"x":85,"y0":0,"y1":1,"band":1},{"x":86,"y0":0,"y1":1,"band":1},{"x":87,"y0":0,"y1":1,"band":1},{"x":88,"y0":0,"y1":1,"band":1},{"x":89,"y0":0,"y1":1,"band":1},{"x":90,"y0":0,"y1":1,"band":1},{"x":91,"y0":0,"y1":1,"band":1},{"x":92,"y0":0,"y1":1,"band":1},{"x":93,"y0":0,"y1":1,"band":1},{"x":94,"y0":0,"y1":1,"band":1},{"x":95,"y0":0,"y1":1,"band":1},{"x":96,"y0":0,"y1":1,"band":1},{"x":97,"y0":0,"y1":1,"band":1},{"x":98,"y0":0,"y1":1,"band":1},{"x":99,"y0":0,"y1":1,"band":1},{"x":100,"y0":0,"y1":1,"band":1},{"x":101,"y0":0,"y1":1,"band":1},{"x":102,"y0":0,"y1":1,"band":1},{"x":103,"y0":0,"y1":1,"band":1},{"x":104,"y0":0,"y1":1,"band":1},{"x":105,"y0":0,"y1":1,"band":1},{"x":106,"y0":0,"y1":1,"band":1},{"x":107,"y0":0,"y1":1,"band":1},{"x":108,"y0":0,"y1":1,"band":1},{"x":109,"y0":0,"y1":1,"band":1},{"x":110,"y0":0,"y1":1,"band":1},{"x":111,"y0":0,"y1":1,"band":1},{"x":112,"y0":0,"y1":1,"band":1},{"x":113,"y0":0,"y1":1,"band":1},{"x":114,"y0":0,"y1":1,"band":1},{"x":115,"y0":0,"y1":1,"band":1},{"x":116,"y0":0,"y1":1,"band":1},{"x":117,"y0":0,"y1":1,"band":1},{"x":118,"y0":0,"y1":1,"band":1},{"x":119,"y0":0,"y1":0.9111111111111111,"band":1},{"x":120,"y0":0,"y1":0.8666666666666667,"band":1},{"x":1,"y0":0,"y1":1,"band":2},{"x":2,"y0":0,"y1":1,"band":2},{"x":3,"y0":0,"y1":1,"band":2},{"x":4,"y0":0,"y1":1,"band":2},{"x":5,"y0":0,"y1":1,"band":2},{"x":6,"y0":0,"y1":1,"band":2},{"x":7,"y0":0,"y1":1,"band":2},{"x":8,"y0":0,"y1":1,"band":2},{"x":9,"y0":0,"y1":1,"band":2},{"x":10,"y0":0,"y1":1,"band":2},{"x":11,"y0":0,"y1":1,"band":2},{"x":12,"y0":0,"y1":1,"band":2},{"x":13,"y0":0,"y1":1,"band":2},{"x":14,"y0":0,"y1":1,"band":2},{"x":15,"y0":0,"y1":1,"band":2},{"x":16,"y0":0,"y1":1,"band":2},{"x":17,"y0":0,"y1":0.8444444444444444,"band":2},{"x":18,"y0":0,"y1":0.5333333333333333,"band":2},{"x":19,"y0":0,"y1":0.3111111111111111,"band":2},{"x":20,"y0":0,"y1":0.13333333333333333,"band":2},{"x":21,"y0":0,"y1":0.08888888888888889,"band":2},{"x":22,"y0":0,"y1":0.08888888888888889,"band":2},{"x":23,"y0":0,"y1":0.17777777777777778,"band":2},{"x":24,"y0":0,"y1":0.26666666666666666,"band":2},{"x":25,"y0":0,"y1":0.4,"band":2},{"x":26,"y0":0,"y1":0.4888888888888889,"band":2},{"x":27,"y0":0,"y1":0.4888888888888889,"band":2},{"x":28,"y0":0,"y1":0.4888888888888889,"band":2},{"x":29,"y0":0,"y1":0.4888888888888889,"band":2},{"x":30,"y0":0,"y1":0.4444444444444444,"band":2},{"x":31,"y0":0,"y1":0.4888888888888889,"band":2},{"x":32,"y0":0,"y1":0.5777777777777777,"band":2},{"x":33,"y0":0,"y1":0.7111111111111111,"band":2},{"x":34,"y0":0,"y1":0.9777777777777777,"band":2},{"x":35,"y0":0,"y1":1,"band":2},{"x":36,"y0":0,"y1":1,"band":2},{"x":37,"y0":0,"y1":1,"band":2},{"x":38,"y0":0,"y1":1,"band":2},{"x":39,"y0":0,"y1":1,"band":2},{"x":40,"y0":0,"y1":1,"band":2},{"x":41,"y0":0,"y1":1,"band":2},{"x":42,"y0":0,"y1":1,"band":2},{"x":43,"y0":0,"y1":1,"band":2},{"x":44,"y0":0,"y1":1,"band":2},{"x":45,"y0":0,"y1":1,"band":2},{"x":46,"y0":0,"y1":0.9777777777777777,"band":2},{"x":47,"y0":0,"y1":0.9333333333333333,"band":2},{"x":48,"y0":0,"y1":0.9333333333333333,"band":2},{"x":49,"y0":0,"y1":0.9333333333333333,"band":2},{"x":50,"y0":0,"y1":0.8888888888888888,"band":2},{"x":51,"y0":0,"y1":0.8,"band":2},{"x":52,"y0":0,"y1":0.6666666666666666,"band":2},{"x":53,"y0":0,"y1":0.4888888888888889,"band":2},{"x":54,"y0":0,"y1":0.26666666666666666,"band":2},{"x":55,"y0":0,"y1":0.044444444444444446,"band":2},{"x":56,"y0":0,"y1":0,"band":2},{"x":57,"y0":0,"y1":0,"band":2},{"x":58,"y0":0,"y1":0,"band":2},{"x":59,"y0":0,"y1":0.044444444444444446,"band":2},{"x":60,"y0":0,"y1":0.26666666666666666,"band":2},{"x":61,"y0":0,"y1":0.5333333333333333,"band":2},{"x":62,"y0":0,"y1":0.8444444444444444,"band":2},{"x":63,"y0":0,"y1":1,"band":2},{"x":64,"y0":0,"y1":1,"band":2},{"x":65,"y0":0,"y1":1,"band":2},{"x":66,"y0":0,"y1":1,"band":2},{"x":67,"y0":0,"y1":1,"band":2},{"x":68,"y0":0,"y1":1,"band":2},{"x":69,"y0":0,"y1":1,"band":2},{"x":70,"y0":0,"y1":1,"band":2},{"x":71,"y0":0,"y1":1,"band":2},{"x":72,"y0":0,"y1":1,"band":2},{"x":73,"y0":0,"y1":1,"band":2},{"x":74,"y0":0,"y1":1,"band":2},{"x":75,"y0":0,"y1":1,"band":2},{"x":76,"y0":0,"y1":1,"band":2},{"x":77,"y0":0,"y1":1,"band":2},{"x":78,"y0":0,"y1":1,"band":2},{"x":79,"y0":0,"y1":1,"band":2},{"x":80,"y0":0,"y1":0.8,"band":2},{"x":81,"y0":0,"y1":0.4888888888888889,"band":2},{"x":82,"y0":0,"y1":0.26666666666666666,"band":2},{"x":83,"y0":0,"y1":0.13333333333333333,"band":2},{"x":84,"y0":0,"y1":0.044444444444444446,"band":2},{"x":85,"y0":0,"y1":0.08888888888888889,"band":2},{"x":86,"y0":0,"y1":0.17777777777777778,"band":2},{"x":87,"y0":0,"y1":0.3111111111111111,"band":2},{"x":88,"y0":0,"y1":0.4,"band":2},{"x":89,"y0":0,"y1":0.4888888888888889,"band":2},{"x":90,"y0":0,"y1":0.4888888888888889,"band":2},{"x":91,"y0":0,"y1":0.4888888888888889,"band":2},{"x":92,"y0":0,"y1":0.4444444444444444,"band":2},{"x":93,"y0":0,"y1":0.4444444444444444,"band":2},{"x":94,"y0":0,"y1":0.4888888888888889,"band":2},{"x":95,"y0":0,"y1":0.5777777777777777,"band":2},{"x":96,"y0":0,"y1":0.7555555555555555,"band":2},{"x":97,"y0":0,"y1":1,"band":2},{"x":98,"y0":0,"y1":1,"band":2},{"x":99,"y0":0,"y1":1,"band":2},{"x":100,"y0":0,"y1":1,"band":2},{"x":101,"y0":0,"y1":1,"band":2},{"x":102,"y0":0,"y1":1,"band":2},{"x":103,"y0":0,"y1":1,"band":2},{"x":104,"y0":0,"y1":1,"band":2},{"x":105,"y0":0,"y1":1,"band":2},{"x":106,"y0":0,"y1":1,"band":2},{"x":107,"y0":0,"y1":1,"band":2},{"x":108,"y0":0,"y1":1,"band":2},{"x":109,"y0":0,"y1":0.9777777777777777,"band":2},{"x":110,"y0":0,"y1":0.9333333333333333,"band":2},{"x":111,"y0":0,"y1":0.9333333333333333,"band":2},{"x":112,"y0":0,"y1":0.9333333333333333,"band":2},{"x":113,"y0":0,"y1":0.8888888888888888,"band":2},{"x":114,"y0":0,"y1":0.8,"band":2},{"x":115,"y0":0,"y1":0.6222222222222222,"band":2},{"x":116,"y0":0,"y1":0.4444444444444444,"band":2},{"x":117,"y0":0,"y1":0.2222222222222222,"band":2},{"x":118,"y0":0,"y1":0.044444444444444446,"band":2},{"x":119,"y0":0,"y1":0,"band":2},{"x":120,"y0":0,"y1":0,"band":2},{"x":1,"y0":0,"y1":0.24444444444444444,"band":3},{"x":2,"y0":0,"y1":0.37777777777777777,"band":3},{"x":3,"y0":0,"y1":0.4222222222222222,"band":3},{"x":4,"y0":0,"y1":0.4222222222222222,"band":3},{"x":5,"y0":0,"y1":0.37777777777777777,"band":3},{"x":6,"y0":0,"y1":0.37777777777777777,"band":3},{"x":7,"y0":0,"y1":0.37777777777777777,"band":3},{"x":8,"y0":0,"y1":0.4222222222222222,"band":3},{"x":9,"y0":0,"y1":0.5111111111111111,"band":3},{"x":10,"y0":0,"y1":0.6444444444444445,"band":3},{"x":11,"y0":0,"y1":0.7333333333333333,"band":3},{"x":12,"y0":0,"y1":0.8222222222222222,"band":3},{"x":13,"y0":0,"y1":0.7777777777777778,"band":3},{"x":14,"y0":0,"y1":0.6444444444444445,"band":3},{"x":15,"y0":0,"y1":0.4222222222222222,"band":3},{"x":16,"y0":0,"y1":0.15555555555555556,"band":3},{"x":17,"y0":0,"y1":0,"band":3},{"x":18,"y0":0,"y1":0,"band":3},{"x":19,"y0":0,"y1":0,"band":3},{"x":20,"y0":0,"y1":0,"band":3},{"x":21,"y0":0,"y1":0,"band":3},{"x":22,"y0":0,"y1":0,"band":3},{"x":23,"y0":0,"y1":0,"band":3},{"x":24,"y0":0,"y1":0,"band":3},{"x":25,"y0":0,"y1":0,"band":3},{"x":26,"y0":0,"y1":0,"band":3},{"x":27,"y0":0,"y1":0,"band":3},{"x":28,"y0":0,"y1":0,"band":3},{"x":29,"y0":0,"y1":0,"band":3},{"x":30,"y0":0,"y1":0,"band":3},{"x":31,"y0":0,"y1":0,"band":3},{"x":32,"y0":0,"y1":0,"band":3},{"x":33,"y0":0,"y1":0,"band":3},{"x":34,"y0":0,"y1":0,"band":3},{"x":35,"y0":0,"y1":0.24444444444444444,"band":3},{"x":36,"y0":0,"y1":0.5111111111111111,"band":3},{"x":37,"y0":0,"y1":0.7777777777777778,"band":3},{"x":38,"y0":0,"y1":0.9555555555555556,"band":3},{"x":39,"y0":0,"y1":1,"band":3},{"x":40,"y0":0,"y1":1,"band":3},{"x":41,"y0":0,"y1":0.8666666666666667,"band":3},{"x":42,"y0":0,"y1":0.6444444444444445,"band":3},{"x":43,"y0":0,"y1":0.4666666666666667,"band":3},{"x":44,"y0":0,"y1":0.24444444444444444,"band":3},{"x":45,"y0":0,"y1":0.1111111111111111,"band":3},{"x":46,"y0":0,"y1":0,"band":3},{"x":47,"y0":0,"y1":0,"band":3},{"x":48,"y0":0,"y1":0,"band":3},{"x":49,"y0":0,"y1":0,"band":3},{"x":50,"y0":0,"y1":0,"band":3},{"x":51,"y0":0,"y1":0,"band":3},{"x":52,"y0":0,"y1":0,"band":3},{"x":53,"y0":0,"y1":0,"band":3},{"x":54,"y0":0,"y1":0,"band":3},{"x":55,"y0":0,"y1":0,"band":3},{"x":56,"y0":0,"y1":0,"band":3},{"x":57,"y0":0,"y1":0,"band":3},{"x":58,"y0":0,"y1":0,"band":3},{"x":59,"y0":0,"y1":0,"band":3},{"x":60,"y0":0,"y1":0,"band":3},{"x":61,"y0":0,"y1":0,"band":3},{"x":62,"y0":0,"y1":0,"band":3},{"x":63,"y0":0,"y1":0.06666666666666667,"band":3},{"x":64,"y0":0,"y1":0.28888888888888886,"band":3},{"x":65,"y0":0,"y1":0.37777777777777777,"band":3},{"x":66,"y0":0,"y1":0.4222222222222222,"band":3},{"x":67,"y0":0,"y1":0.4222222222222222,"band":3},{"x":68,"y0":0,"y1":0.37777777777777777,"band":3},{"x":69,"y0":0,"y1":0.37777777777777777,"band":3},{"x":70,"y0":0,"y1":0.37777777777777777,"band":3},{"x":71,"y0":0,"y1":0.4666666666666667,"band":3},{"x":72,"y0":0,"y1":0.5555555555555556,"band":3},{"x":73,"y0":0,"y1":0.6444444444444445,"band":3},{"x":74,"y0":0,"y1":0.7777777777777778,"band":3},{"x":75,"y0":0,"y1":0.8222222222222222,"band":3},{"x":76,"y0":0,"y1":0.7777777777777778,"band":3},{"x":77,"y0":0,"y1":0.6,"band":3},{"x":78,"y0":0,"y1":0.37777777777777777,"band":3},{"x":79,"y0":0,"y1":0.1111111111111111,"band":3},{"x":80,"y0":0,"y1":0,"band":3},{"x":81,"y0":0,"y1":0,"band":3},{"x":82,"y0":0,"y1":0,"band":3},{"x":83,"y0":0,"y1":0,"band":3},{"x":84,"y0":0,"y1":0,"band":3},{"x":85,"y0":0,"y1":0,"band":3},{"x":86,"y0":0,"y1":0,"band":3},{"x":87,"y0":0,"y1":0,"band":3},{"x":88,"y0":0,"y1":0,"band":3},{"x":89,"y0":0,"y1":0,"band":3},{"x":90,"y0":0,"y1":0,"band":3},{"x":91,"y0":0,"y1":0,"band":3},{"x":92,"y0":0,"y1":0,"band":3},{"x":93,"y0":0,"y1":0,"band":3},{"x":94,"y0":0,"y1":0,"band":3},{"x":95,"y0":0,"y1":0,"band":3},{"x":96,"y0":0,"y1":0,"band":3},{"x":97,"y0":0,"y1":0.022222222222222223,"band":3},{"x":98,"y0":0,"y1":0.28888888888888886,"band":3},{"x":99,"y0":0,"y1":0.5555555555555556,"band":3},{"x":100,"y0":0,"y1":0.8222222222222222,"band":3},{"x":101,"y0":0,"y1":0.9555555555555556,"band":3},{"x":102,"y0":0,"y1":1,"band":3},{"x":103,"y0":0,"y1":0.9555555555555556,"band":3},{"x":104,"y0":0,"y1":0.8222222222222222,"band":3},{"x":105,"y0":0,"y1":0.6444444444444445,"band":3},{"x":106,"y0":0,"y1":0.4222222222222222,"band":3},{"x":107,"y0":0,"y1":0.2,"band":3},{"x":108,"y0":0,"y1":0.06666666666666667,"band":3},{"x":109,"y0":0,"y1":0,"band":3},{"x":110,"y0":0,"y1":0,"band":3},{"x":111,"y0":0,"y1":0,"band":3},{"x":112,"y0":0,"y1":0,"band":3},{"x":113,"y0":0,"y1":0,"band":3},{"x":114,"y0":0,"y1":0,"band":3},{"x":115,"y0":0,"y1":0,"band":3},{"x":116,"y0":0,"y1":0,"band":3},{"x":117,"y0":0,"y1":0,"band":3},{"x":118,"y0":0,"y1":0,"band":3},{"x":119,"y0":0,"y1":0,"band":3},{"x":120,"y0":0,"y1":0,"band":3}],"x":"x","y1":"y0","y2":"y1","z":"band","fill":"band","stroke":"none"},{"type":"ruleY","data":[0],"stroke":"theme:axis","strokeWidth":1},{"type":"rect","data":[{"x1":66,"x2":71,"y1":1.08,"y2":1.18}],"x1":"x1","x2":"x2","y1":"y1","y2":"y2","fill":"theme:sequential.2","clip":false},{"type":"text","data":[{"x":72.5,"y":1.13,"text":"B1"}],"x":"x","y":"y","text":"text","textAnchor":"start","fill":"theme:muted","fontSize":10,"clip":false},{"type":"rect","data":[{"x1":80,"x2":85,"y1":1.08,"y2":1.18}],"x1":"x1","x2":"x2","y1":"y1","y2":"y2","fill":"theme:sequential.4","clip":false},{"type":"text","data":[{"x":86.5,"y":1.13,"text":"B2"}],"x":"x","y":"y","text":"text","textAnchor":"start","fill":"theme:muted","fontSize":10,"clip":false},{"type":"rect","data":[{"x1":94,"x2":99,"y1":1.08,"y2":1.18}],"x1":"x1","x2":"x2","y1":"y1","y2":"y2","fill":"theme:sequential.6","clip":false},{"type":"text","data":[{"x":100.5,"y":1.13,"text":"B3"}],"x":"x","y":"y","text":"text","textAnchor":"start","fill":"theme:muted","fontSize":10,"clip":false},{"type":"rect","data":[{"x1":108,"x2":113,"y1":1.08,"y2":1.18}],"x1":"x1","x2":"x2","y1":"y1","y2":"y2","fill":"theme:sequential.7","clip":false},{"type":"text","data":[{"x":114.5,"y":1.13,"text":"B4"}],"x":"x","y":"y","text":"text","textAnchor":"start","fill":"theme:muted","fontSize":10,"clip":false}]}
```

### Sparkline matrix — `sparkline_matrix` (echarts)

A grid of entities against metrics, each row a shape to scan: a KPI wall. **Avoid:** Exact comparison across rows: the dots share no common scale.

Row shape (2 of 4 rows): `[{"region":"North","revenue":182,"margin":24,"nps":62,"churn":8},{"region":"South","revenue":143,"margin":18,"nps":51,"churn":12}]`

Tested at width 640, height 360.

```json
{"title":{"text":"Regional KPIs","left":"center","textStyle":{"fontSize":16,"fontWeight":600,"color":"theme:text"}},"aria":{"enabled":true,"label":{"description":"Regional KPIs: 4 regions across 4 metrics, each cell a small trend of its own."}},"matrix":{"left":84,"right":32,"top":66,"bottom":26,"x":{"data":["Revenue","Margin","NPS","Churn"],"label":{"color":"theme:text","fontSize":11}},"y":{"data":["North","South","East","West"],"label":{"color":"theme:text","fontSize":11}},"body":{"itemStyle":{"borderColor":"theme:grid"}}},"grid":[{"id":"spark-0-0","coordinateSystem":"matrix","matrixIndex":0,"coord":["Revenue","North"],"left":12,"top":12,"right":12,"bottom":12},{"id":"spark-0-1","coordinateSystem":"matrix","matrixIndex":0,"coord":["Margin","North"],"left":12,"top":12,"right":12,"bottom":12},{"id":"spark-0-2","coordinateSystem":"matrix","matrixIndex":0,"coord":["NPS","North"],"left":12,"top":12,"right":12,"bottom":12},{"id":"spark-0-3","coordinateSystem":"matrix","matrixIndex":0,"coord":["Churn","North"],"left":12,"top":12,"right":12,"bottom":12},{"id":"spark-1-0","coordinateSystem":"matrix","matrixIndex":0,"coord":["Revenue","South"],"left":12,"top":12,"right":12,"bottom":12},{"id":"spark-1-1","coordinateSystem":"matrix","matrixIndex":0,"coord":["Margin","South"],"left":12,"top":12,"right":12,"bottom":12},{"id":"spark-1-2","coordinateSystem":"matrix","matrixIndex":0,"coord":["NPS","South"],"left":12,"top":12,"right":12,"bottom":12},{"id":"spark-1-3","coordinateSystem":"matrix","matrixIndex":0,"coord":["Churn","South"],"left":12,"top":12,"right":12,"bottom":12},{"id":"spark-2-0","coordinateSystem":"matrix","matrixIndex":0,"coord":["Revenue","East"],"left":12,"top":12,"right":12,"bottom":12},{"id":"spark-2-1","coordinateSystem":"matrix","matrixIndex":0,"coord":["Margin","East"],"left":12,"top":12,"right":12,"bottom":12},{"id":"spark-2-2","coordinateSystem":"matrix","matrixIndex":0,"coord":["NPS","East"],"left":12,"top":12,"right":12,"bottom":12},{"id":"spark-2-3","coordinateSystem":"matrix","matrixIndex":0,"coord":["Churn","East"],"left":12,"top":12,"right":12,"bottom":12},{"id":"spark-3-0","coordinateSystem":"matrix","matrixIndex":0,"coord":["Revenue","West"],"left":12,"top":12,"right":12,"bottom":12},{"id":"spark-3-1","coordinateSystem":"matrix","matrixIndex":0,"coord":["Margin","West"],"left":12,"top":12,"right":12,"bottom":12},{"id":"spark-3-2","coordinateSystem":"matrix","matrixIndex":0,"coord":["NPS","West"],"left":12,"top":12,"right":12,"bottom":12},{"id":"spark-3-3","coordinateSystem":"matrix","matrixIndex":0,"coord":["Churn","West"],"left":12,"top":12,"right":12,"bottom":12}],"xAxis":[{"id":"spark-0-0-x","gridId":"spark-0-0","type":"category","data":["1","2","3","4","5","6","7","8"],"show":false},{"id":"spark-0-1-x","gridId":"spark-0-1","type":"category","data":["1","2","3","4","5","6","7","8"],"show":false},{"id":"spark-0-2-x","gridId":"spark-0-2","type":"category","data":["1","2","3","4","5","6","7","8"],"show":false},{"id":"spark-0-3-x","gridId":"spark-0-3","type":"category","data":["1","2","3","4","5","6","7","8"],"show":false},{"id":"spark-1-0-x","gridId":"spark-1-0","type":"category","data":["1","2","3","4","5","6","7","8"],"show":false},{"id":"spark-1-1-x","gridId":"spark-1-1","type":"category","data":["1","2","3","4","5","6","7","8"],"show":false},{"id":"spark-1-2-x","gridId":"spark-1-2","type":"category","data":["1","2","3","4","5","6","7","8"],"show":false},{"id":"spark-1-3-x","gridId":"spark-1-3","type":"category","data":["1","2","3","4","5","6","7","8"],"show":false},{"id":"spark-2-0-x","gridId":"spark-2-0","type":"category","data":["1","2","3","4","5","6","7","8"],"show":false},{"id":"spark-2-1-x","gridId":"spark-2-1","type":"category","data":["1","2","3","4","5","6","7","8"],"show":false},{"id":"spark-2-2-x","gridId":"spark-2-2","type":"category","data":["1","2","3","4","5","6","7","8"],"show":false},{"id":"spark-2-3-x","gridId":"spark-2-3","type":"category","data":["1","2","3","4","5","6","7","8"],"show":false},{"id":"spark-3-0-x","gridId":"spark-3-0","type":"category","data":["1","2","3","4","5","6","7","8"],"show":false},{"id":"spark-3-1-x","gridId":"spark-3-1","type":"category","data":["1","2","3","4","5","6","7","8"],"show":false},{"id":"spark-3-2-x","gridId":"spark-3-2","type":"category","data":["1","2","3","4","5","6","7","8"],"show":false},{"id":"spark-3-3-x","gridId":"spark-3-3","type":"category","data":["1","2","3","4","5","6","7","8"],"show":false}],"yAxis":[{"id":"spark-0-0-y","gridId":"spark-0-0","type":"value","min":"dataMin","max":"dataMax","show":false},{"id":"spark-0-1-y","gridId":"spark-0-1","type":"value","min":"dataMin","max":"dataMax","show":false},{"id":"spark-0-2-y","gridId":"spark-0-2","type":"value","min":"dataMin","max":"dataMax","show":false},{"id":"spark-0-3-y","gridId":"spark-0-3","type":"value","min":"dataMin","max":"dataMax","show":false},{"id":"spark-1-0-y","gridId":"spark-1-0","type":"value","min":"dataMin","max":"dataMax","show":false},{"id":"spark-1-1-y","gridId":"spark-1-1","type":"value","min":"dataMin","max":"dataMax","show":false},{"id":"spark-1-2-y","gridId":"spark-1-2","type":"value","min":"dataMin","max":"dataMax","show":false},{"id":"spark-1-3-y","gridId":"spark-1-3","type":"value","min":"dataMin","max":"dataMax","show":false},{"id":"spark-2-0-y","gridId":"spark-2-0","type":"value","min":"dataMin","max":"dataMax","show":false},{"id":"spark-2-1-y","gridId":"spark-2-1","type":"value","min":"dataMin","max":"dataMax","show":false},{"id":"spark-2-2-y","gridId":"spark-2-2","type":"value","min":"dataMin","max":"dataMax","show":false},{"id":"spark-2-3-y","gridId":"spark-2-3","type":"value","min":"dataMin","max":"dataMax","show":false},{"id":"spark-3-0-y","gridId":"spark-3-0","type":"value","min":"dataMin","max":"dataMax","show":false},{"id":"spark-3-1-y","gridId":"spark-3-1","type":"value","min":"dataMin","max":"dataMax","show":false},{"id":"spark-3-2-y","gridId":"spark-3-2","type":"value","min":"dataMin","max":"dataMax","show":false},{"id":"spark-3-3-y","gridId":"spark-3-3","type":"value","min":"dataMin","max":"dataMax","show":false}],"series":[{"type":"line","name":"North Revenue","xAxisId":"spark-0-0-x","yAxisId":"spark-0-0-y","showSymbol":false,"silent":true,"lineStyle":{"width":1.75,"color":"theme:categorical.0"},"areaStyle":{"color":"theme:categorical.0","opacity":0.14},"data":[163.8,176.4,185.2,187.8,183.8,175.1,165,157.4]},{"type":"line","name":"North Margin","xAxisId":"spark-0-1-x","yAxisId":"spark-0-1-y","showSymbol":false,"silent":true,"lineStyle":{"width":1.75,"color":"theme:categorical.0"},"areaStyle":{"color":"theme:categorical.0","opacity":0.14},"data":[23.6,22.5,21.1,20.1,19.7,20.3,21.6,23.3]},{"type":"line","name":"North NPS","xAxisId":"spark-0-2-x","yAxisId":"spark-0-2-y","showSymbol":false,"silent":true,"lineStyle":{"width":1.75,"color":"theme:categorical.0"},"areaStyle":{"color":"theme:categorical.0","opacity":0.14},"data":[49,50.2,53.5,57.8,62,64.8,65.3,63.7]},{"type":"line","name":"North Churn","xAxisId":"spark-0-3-x","yAxisId":"spark-0-3-y","showSymbol":false,"silent":true,"lineStyle":{"width":1.75,"color":"theme:categorical.0"},"areaStyle":{"color":"theme:categorical.0","opacity":0.14},"data":[7.7,8.1,8.2,8,7.6,7.2,6.8,6.8]},{"type":"line","name":"South Revenue","xAxisId":"spark-1-0-x","yAxisId":"spark-1-0-y","showSymbol":false,"silent":true,"lineStyle":{"width":1.75,"color":"theme:categorical.0"},"areaStyle":{"color":"theme:categorical.0","opacity":0.14},"data":[143.6,139.4,132,124.3,119.2,118.8,123.7,132.6]},{"type":"line","name":"South Margin","xAxisId":"spark-1-1-x","yAxisId":"spark-1-1-y","showSymbol":false,"silent":true,"lineStyle":{"width":1.75,"color":"theme:categorical.0"},"areaStyle":{"color":"theme:categorical.0","opacity":0.14},"data":[14.5,14.4,14.9,16,17.3,18.4,19,19]},{"type":"line","name":"South NPS","xAxisId":"spark-1-2-x","yAxisId":"spark-1-2-y","showSymbol":false,"silent":true,"lineStyle":{"width":1.75,"color":"theme:categorical.0"},"areaStyle":{"color":"theme:categorical.0","opacity":0.14},"data":[47.1,50.4,52.2,52.3,50.6,47.8,45.2,43.5]},{"type":"line","name":"South Churn","xAxisId":"spark-1-3-x","yAxisId":"spark-1-3-y","showSymbol":false,"silent":true,"lineStyle":{"width":1.75,"color":"theme:categorical.0"},"areaStyle":{"color":"theme:categorical.0","opacity":0.14},"data":[11.6,10.9,10.3,9.9,9.9,10.3,11.1,11.9]},{"type":"line","name":"East Revenue","xAxisId":"spark-2-0-x","yAxisId":"spark-2-0-y","showSymbol":false,"silent":true,"lineStyle":{"width":1.75,"color":"theme:categorical.0"},"areaStyle":{"color":"theme:categorical.0","opacity":0.14},"data":[171.5,165.6,166.8,175.4,189,203.7,214.9,219.6]},{"type":"line","name":"East Margin","xAxisId":"spark-2-1-x","yAxisId":"spark-2-1-y","showSymbol":false,"silent":true,"lineStyle":{"width":1.75,"color":"theme:categorical.0"},"areaStyle":{"color":"theme:categorical.0","opacity":0.14},"data":[23.8,25.7,27.2,27.9,27.6,26.5,25,23.7]},{"type":"line","name":"East NPS","xAxisId":"spark-2-2-x","yAxisId":"spark-2-2-y","showSymbol":false,"silent":true,"lineStyle":{"width":1.75,"color":"theme:categorical.0"},"areaStyle":{"color":"theme:categorical.0","opacity":0.14},"data":[67.6,64.9,61.2,57.8,56.1,56.9,60,64.6]},{"type":"line","name":"East Churn","xAxisId":"spark-2-3-x","yAxisId":"spark-2-3-y","showSymbol":false,"silent":true,"lineStyle":{"width":1.75,"color":"theme:categorical.0"},"areaStyle":{"color":"theme:categorical.0","opacity":0.14},"data":[4.8,4.8,5.1,5.5,5.9,6.2,6.3,6.2]},{"type":"line","name":"West Revenue","xAxisId":"spark-3-0-x","yAxisId":"spark-3-0-y","showSymbol":false,"silent":true,"lineStyle":{"width":1.75,"color":"theme:categorical.0"},"areaStyle":{"color":"theme:categorical.0","opacity":0.14},"data":[99.1,107.2,115.3,121,122.7,120.1,114.4,107.8]},{"type":"line","name":"West Margin","xAxisId":"spark-3-1-x","yAxisId":"spark-3-1-y","showSymbol":false,"silent":true,"lineStyle":{"width":1.75,"color":"theme:categorical.0"},"areaStyle":{"color":"theme:categorical.0","opacity":0.14},"data":[21.2,20.8,19.8,18.6,17.7,17.4,17.9,19.1]},{"type":"line","name":"West NPS","xAxisId":"spark-3-2-x","yAxisId":"spark-3-2-y","showSymbol":false,"silent":true,"lineStyle":{"width":1.75,"color":"theme:categorical.0"},"areaStyle":{"color":"theme:categorical.0","opacity":0.14},"data":[35.9,35.1,36,38.3,41.4,44.4,46.3,46.7]},{"type":"line","name":"West Churn","xAxisId":"spark-3-3-x","yAxisId":"spark-3-3-y","showSymbol":false,"silent":true,"lineStyle":{"width":1.75,"color":"theme:categorical.0"},"areaStyle":{"color":"theme:categorical.0","opacity":0.14},"data":[13.6,14.6,15.3,15.5,15.1,14.4,13.5,12.9]}]}
```

### Theme river — `theme_river` (echarts)

Changing composition over time as one flowing stream, where the overall shape matters more than exact values. **Avoid:** Reading one series exactly: use a multi-series line.

Tested at width 640, height 380.

```json
{"title":{"text":"Sessions by channel","subtext":"Monthly sessions across four acquisition channels, 2024","left":"center","textStyle":{"fontSize":16,"fontWeight":600,"color":"theme:text"},"subtextStyle":{"color":"theme:muted","fontSize":12}},"singleAxis":{"type":"time","top":84,"bottom":64,"left":40,"right":40,"axisLabel":{"color":"theme:muted","formatter":"{MMM}"},"axisLine":{"show":true},"splitLine":{"show":false}},"legend":{"bottom":8,"textStyle":{"color":"theme:muted"}},"series":[{"type":"themeRiver","label":{"show":false},"data":[["2024-01-01",320,"Search"],["2024-01-01",525,"Social"],["2024-01-01",702,"Email"],["2024-01-01",801,"Direct"],["2024-02-01",357,"Search"],["2024-02-01",551,"Social"],["2024-02-01",690,"Email"],["2024-02-01",757,"Direct"],["2024-03-01",385,"Search"],["2024-03-01",555,"Social"],["2024-03-01",660,"Email"],["2024-03-01",717,"Direct"],["2024-04-01",399,"Search"],["2024-04-01",540,"Social"],["2024-04-01",622,"Email"],["2024-04-01",694,"Direct"],["2024-05-01",397,"Search"],["2024-05-01",512,"Social"],["2024-05-01",590,"Email"],["2024-05-01",699,"Direct"],["2024-06-01",381,"Search"],["2024-06-01",481,"Social"],["2024-06-01",577,"Email"],["2024-06-01",734,"Direct"],["2024-07-01",357,"Search"],["2024-07-01",458,"Social"],["2024-07-01",588,"Email"],["2024-07-01",795,"Direct"],["2024-08-01",334,"Search"],["2024-08-01",452,"Social"],["2024-08-01",624,"Email"],["2024-08-01",869,"Direct"],["2024-09-01",319,"Search"],["2024-09-01",466,"Social"],["2024-09-01",679,"Email"],["2024-09-01",939,"Direct"],["2024-10-01",318,"Search"],["2024-10-01",501,"Social"],["2024-10-01",742,"Email"],["2024-10-01",992,"Direct"],["2024-11-01",333,"Search"],["2024-11-01",548,"Social"],["2024-11-01",797,"Email"],["2024-11-01",1016,"Direct"],["2024-12-01",362,"Search"],["2024-12-01",597,"Social"],["2024-12-01",834,"Email"],["2024-12-01",1009,"Direct"]]}]}
```

## distribution

### Histogram — `histogram` (vega-lite)

The shape of one numeric variable.

Row shape (2 of 240 rows): `[{"group":"A","latency_ms":229.2},{"group":"B","latency_ms":158.5}]`

```json
{"mark":"bar","encoding":{"x":{"field":"latency_ms","type":"quantitative","bin":{"maxbins":24},"title":"Latency (ms)"},"y":{"aggregate":"count","type":"quantitative","title":"Requests"}}}
```

### Density plot — `density` (vega-lite)

Compare smooth distributions of a few groups.

Row shape (2 of 240 rows): `[{"group":"A","latency_ms":229.2},{"group":"B","latency_ms":158.5}]`

```json
{"transform":[{"density":"latency_ms","groupby":["group"],"extent":[20,240]}],"mark":{"type":"area","opacity":0.45,"line":true},"encoding":{"x":{"field":"value","type":"quantitative","title":"Latency (ms)"},"y":{"field":"density","type":"quantitative","title":"Density","stack":null},"color":{"field":"group","type":"nominal","title":"Service"}}}
```

### Box plot — `box_plot` (vega-lite)

Medians, spread and outliers across groups.

Row shape (2 of 240 rows): `[{"group":"A","latency_ms":229.2},{"group":"B","latency_ms":158.5}]`

```json
{"mark":{"type":"boxplot","extent":1.5},"encoding":{"x":{"field":"group","type":"nominal","title":"Service"},"y":{"field":"latency_ms","type":"quantitative","title":"Latency (ms)"},"color":{"field":"group","type":"nominal","legend":null}}}
```

### Strip plot — `strip` (vega-lite)

Every observation, for small samples.

Row shape (2 of 120 rows): `[{"group":"A","latency_ms":229.2},{"group":"B","latency_ms":158.5}]`

```json
{"mark":{"type":"tick","thickness":1.5},"encoding":{"x":{"field":"latency_ms","type":"quantitative","title":"Latency (ms)"},"y":{"field":"group","type":"nominal","title":"Service"}}}
```

### Heatmap — `heatmap` (vega-lite)

A value across two categorical dimensions (day × hour).

Row shape (2 of 84 rows): `[{"day":"Mon","hour":"00:00","orders":20},{"day":"Mon","hour":"02:00","orders":23}]`

```json
{"mark":"rect","encoding":{"x":{"field":"hour","type":"ordinal","title":null},"y":{"field":"day","type":"ordinal","title":null},"color":{"field":"orders","type":"quantitative","title":"Orders"}}}
```

### 2-D histogram — `binned_heatmap` (vega-lite)

Where many points concentrate (instead of an overplotted scatter).

Row shape (2 of 60 rows): `[{"spend_k":5,"conversions":0,"channel":"Search","customers":50},{"spend_k":42,"conversions":91,"channel":"Social","customers":79}]`

```json
{"mark":"rect","encoding":{"x":{"field":"spend_k","type":"quantitative","bin":{"maxbins":12},"title":"Spend (€k)"},"y":{"field":"conversions","type":"quantitative","bin":{"maxbins":10},"title":"Conversions"},"color":{"aggregate":"count","type":"quantitative","title":"Campaigns"}}}
```

### Density contours — `contour` (plot)

Where two measures pile up, as filled contour bands rather than individual points. **Avoid:** Few rows, where every value matters: use scatter.

Row shape (2 of 220 rows): `[{"spend_k":110.5,"conversions":183},{"spend_k":51.2,"conversions":117}]`

```json
{"width":560,"height":340,"clip":true,"x":{"label":"Spend (€k)"},"y":{"label":"Conversions"},"color":{"type":"linear","range":"theme:sequential","legend":false},"marks":[{"type":"density","x":"spend_k","y":"conversions","fill":"density","thresholds":10,"stroke":"theme:background","strokeWidth":0.5}]}
```

### Beeswarm — `beeswarm` (plot)

Every observation as one dot, dodged sideways where values collide, so a small sample reads exactly. **Avoid:** Thousands of rows, where the swarm becomes a block: use a box plot.

Row shape (2 of 150 rows): `[{"group":"A","latency_ms":229.2,"position":0},{"group":"B","latency_ms":158.5,"position":1.119047619047619}]`

```json
{"width":560,"height":340,"marginBottom":50,"x":{"domain":[-0.5,2.5],"axis":null},"y":{"label":"Latency (ms)","insetTop":12,"insetBottom":12},"marks":[{"type":"dot","x":"position","y":"latency_ms","r":4,"fill":"theme:categorical.0","fillOpacity":0.65},{"type":"text","data":[{"position":0,"base":33.4,"name":"A"},{"position":1,"base":33.4,"name":"B"},{"position":2,"base":33.4,"name":"C"}],"x":"position","y":"base","text":"name","textAnchor":"middle","dy":18,"fill":"theme:muted","fontSize":11},{"type":"text","data":[{"position":1,"base":33.4,"text":"Service"}],"x":"position","y":"base","text":"text","textAnchor":"middle","dy":35,"fill":"theme:muted","fontSize":11}]}
```

### Ridgeline — `ridgeline` (plot)

A density curve per group, stacked so several distributions compare by shape. **Avoid:** More than ~8 groups: the curves overlap into a texture.

Row shape (2 of 240 rows): `[{"group":"A","latency_ms":229.2},{"group":"B","latency_ms":158.5}]`

```json
{"width":560,"height":360,"x":{"label":"Latency (ms)"},"y":{"domain":[0,3],"axis":null},"color":{"type":"ordinal","domain":["A","B","C"],"range":"theme:categorical","legend":false},"marks":[{"type":"areaY","data":[{"x":33.4,"base":2,"ridge":2.122056919750685,"category":"C"},{"x":38.06808510638298,"base":2,"ridge":2.1664092864537574,"category":"C"},{"x":42.736170212765956,"base":2,"ridge":2.214696614930538,"category":"C"},{"x":47.40425531914894,"base":2,"ridge":2.2663831560193595,"category":"C"},{"x":52.07234042553191,"base":2,"ridge":2.3231426031471667,"category":"C"},{"x":56.740425531914894,"base":2,"ridge":2.3883098531346976,"category":"C"},{"x":61.40851063829787,"base":2,"ridge":2.464701966187979,"category":"C"},{"x":66.07659574468084,"base":2,"ridge":2.55182325824596,"category":"C"},{"x":70.74468085106383,"base":2,"ridge":2.644445480797075,"category":"C"},{"x":75.41276595744681,"base":2,"ridge":2.733931545670415,"category":"C"},{"x":80.08085106382978,"base":2,"ridge":2.811450120826302,"category":"C"},{"x":84.74893617021277,"base":2,"ridge":2.8705539285986124,"category":"C"},{"x":89.41702127659575,"base":2,"ridge":2.9074813438556917,"category":"C"},{"x":94.08510638297872,"base":2,"ridge":2.92,"category":"C"},{"x":98.75319148936171,"base":2,"ridge":2.906727816111284,"category":"C"},{"x":103.42127659574467,"base":2,"ridge":2.867720106635788,"category":"C"},{"x":108.08936170212766,"base":2,"ridge":2.8056114077874437,"category":"C"},{"x":112.75744680851065,"base":2,"ridge":2.726286918263173,"category":"C"},{"x":117.42553191489361,"base":2,"ridge":2.638414268246833,"category":"C"},{"x":122.0936170212766,"base":2,"ridge":2.5515430745044156,"category":"C"},{"x":126.76170212765956,"base":2,"ridge":2.473239374203312,"category":"C"},{"x":131.42978723404255,"base":2,"ridge":2.406710456244946,"category":"C"},{"x":136.09787234042554,"base":2,"ridge":2.350419223177008,"category":"C"},{"x":140.7659574468085,"base":2,"ridge":2.2999366173867437,"category":"C"},{"x":145.4340425531915,"base":2,"ridge":2.2509114533919523,"category":"C"},{"x":150.10212765957448,"base":2,"ridge":2.201593823909014,"category":"C"},{"x":154.77021276595747,"base":2,"ridge":2.1537270915973217,"category":"C"},{"x":159.43829787234043,"base":2,"ridge":2.1114094507949064,"category":"C"},{"x":164.10638297872342,"base":2,"ridge":2.0785698153317385,"category":"C"},{"x":168.7744680851064,"base":2,"ridge":2.0565917376819156,"category":"C"},{"x":173.44255319148937,"base":2,"ridge":2.0435923200164345,"category":"C"},{"x":178.11063829787236,"base":2,"ridge":2.0357106035586225,"category":"C"},{"x":182.77872340425532,"base":2,"ridge":2.0293329687670982,"category":"C"},{"x":187.4468085106383,"base":2,"ridge":2.0226646944639706,"category":"C"},{"x":192.1148936170213,"base":2,"ridge":2.015808162884959,"category":"C"},{"x":196.78297872340426,"base":2,"ridge":2.0097469824721093,"category":"C"},{"x":201.45106382978724,"base":2,"ridge":2.0052621858477644,"category":"C"},{"x":206.11914893617023,"base":2,"ridge":2.0024771099288787,"category":"C"},{"x":210.78723404255322,"base":2,"ridge":2.0010148779806802,"category":"C"},{"x":215.45531914893618,"base":2,"ridge":2.000361597978151,"category":"C"},{"x":220.12340425531914,"base":2,"ridge":2.000112003138003,"category":"C"},{"x":224.79148936170213,"base":2,"ridge":2.000030155012907,"category":"C"},{"x":229.45957446808512,"base":2,"ridge":2.0000070564171266,"category":"C"},{"x":234.1276595744681,"base":2,"ridge":2.0000014351294366,"category":"C"},{"x":238.79574468085107,"base":2,"ridge":2.0000002536728676,"category":"C"},{"x":243.46382978723406,"base":2,"ridge":2.0000000389699975,"category":"C"},{"x":248.13191489361702,"base":2,"ridge":2.000000005203061,"category":"C"},{"x":252.80000000000004,"base":2,"ridge":2.0000000006037526,"category":"C"},{"x":33.4,"base":1,"ridge":1.000000179956499,"category":"B"},{"x":38.06808510638298,"base":1,"ridge":1.0000010327626954,"category":"B"},{"x":42.736170212765956,"base":1,"ridge":1.0000051674180286,"category":"B"},{"x":47.40425531914894,"base":1,"ridge":1.000022555670687,"category":"B"},{"x":52.07234042553191,"base":1,"ridge":1.0000859765543286,"category":"B"},{"x":56.740425531914894,"base":1,"ridge":1.0002866449635655,"category":"B"},{"x":61.40851063829787,"base":1,"ridge":1.0008380514248039,"category":"B"},{"x":66.07659574468084,"base":1,"ridge":1.002157486482499,"category":"B"},{"x":70.74468085106383,"base":1,"ridge":1.004922366336018,"category":"B"},{"x":75.41276595744681,"base":1,"ridge":1.0100498618394613,"category":"B"},{"x":80.08085106382978,"base":1,"ridge":1.0186137744124784,"category":"B"},{"x":84.74893617021277,"base":1,"ridge":1.0318158630304513,"category":"B"},{"x":89.41702127659575,"base":1,"ridge":1.0510932770715757,"category":"B"},{"x":94.08510638297872,"base":1,"ridge":1.0781563035112731,"category":"B"},{"x":98.75319148936171,"base":1,"ridge":1.114497456278761,"category":"B"},{"x":103.42127659574467,"base":1,"ridge":1.1602475061013424,"category":"B"},{"x":108.08936170212766,"base":1,"ridge":1.213199808902745,"category":"B"},{"x":112.75744680851065,"base":1,"ridge":1.2693992578989257,"category":"B"},{"x":117.42553191489361,"base":1,"ridge":1.3257960161481048,"category":"B"},{"x":122.0936170212766,"base":1,"ridge":1.383382968552066,"category":"B"},{"x":126.76170212765956,"base":1,"ridge":1.4478528136670221,"category":"B"},{"x":131.42978723404255,"base":1,"ridge":1.525959844857757,"category":"B"},{"x":136.09787234042554,"base":1,"ridge":1.619230973210846,"category":"B"},{"x":140.7659574468085,"base":1,"ridge":1.719722247208161,"category":"B"},{"x":145.4340425531915,"base":1,"ridge":1.8119148088860686,"category":"B"},{"x":150.10212765957448,"base":1,"ridge":1.880139086140069,"category":"B"},{"x":154.77021276595747,"base":1,"ridge":1.9159771347126027,"category":"B"},{"x":159.43829787234043,"base":1,"ridge":1.92,"category":"B"},{"x":164.10638297872342,"base":1,"ridge":1.8975551433763074,"category":"B"},{"x":168.7744680851064,"base":1,"ridge":1.853701358545869,"category":"B"},{"x":173.44255319148937,"base":1,"ridge":1.7920838645269948,"category":"B"},{"x":178.11063829787236,"base":1,"ridge":1.7173059477929624,"category":"B"},{"x":182.77872340425532,"base":1,"ridge":1.636472821830282,"category":"B"},{"x":187.4468085106383,"base":1,"ridge":1.557210068611898,"category":"B"},{"x":192.1148936170213,"base":1,"ridge":1.4840069404090084,"category":"B"},{"x":196.78297872340426,"base":1,"ridge":1.4167148752287633,"category":"B"},{"x":201.45106382978724,"base":1,"ridge":1.3526417650809461,"category":"B"},{"x":206.11914893617023,"base":1,"ridge":1.2900835101709125,"category":"B"},{"x":210.78723404255322,"base":1,"ridge":1.230145429461828,"category":"B"},{"x":215.45531914893618,"base":1,"ridge":1.1758112441179005,"category":"B"},{"x":220.12340425531914,"base":1,"ridge":1.1298056502830784,"category":"B"},{"x":224.79148936170213,"base":1,"ridge":1.093341933548663,"category":"B"},{"x":229.45957446808512,"base":1,"ridge":1.0663400317541356,"category":"B"},{"x":234.1276595744681,"base":1,"ridge":1.048133004596608,"category":"B"},{"x":238.79574468085107,"base":1,"ridge":1.0376145076172187,"category":"B"},{"x":243.46382978723406,"base":1,"ridge":1.0328678957813184,"category":"B"},{"x":248.13191489361702,"base":1,"ridge":1.0311081651067477,"category":"B"},{"x":252.80000000000004,"base":1,"ridge":1.0294434995346307,"category":"B"},{"x":33.4,"base":0,"ridge":0.015821629862262133,"category":"A"},{"x":38.06808510638298,"base":0,"ridge":0.028321913909229418,"category":"A"},{"x":42.736170212765956,"base":0,"ridge":0.04649745940438662,"category":"A"},{"x":47.40425531914894,"base":0,"ridge":0.07065953261312398,"category":"A"},{"x":52.07234042553191,"base":0,"ridge":0.10053669027760881,"category":"A"},{"x":56.740425531914894,"base":0,"ridge":0.13570110847877456,"category":"A"},{"x":61.40851063829787,"base":0,"ridge":0.17603176444653804,"category":"A"},{"x":66.07659574468084,"base":0,"ridge":0.22173837457198745,"category":"A"},{"x":70.74468085106383,"base":0,"ridge":0.27283702082432326,"category":"A"},{"x":75.41276595744681,"base":0,"ridge":0.3286130122654594,"category":"A"},{"x":80.08085106382978,"base":0,"ridge":0.3878267321004846,"category":"A"},{"x":84.74893617021277,"base":0,"ridge":0.44975975080748,"category":"A"},{"x":89.41702127659575,"base":0,"ridge":0.5151507899175775,"category":"A"},{"x":94.08510638297872,"base":0,"ridge":0.5857649702247354,"category":"A"},{"x":98.75319148936171,"base":0,"ridge":0.662334660797981,"category":"A"},{"x":103.42127659574467,"base":0,"ridge":0.7421160353473369,"category":"A"},{"x":108.08936170212766,"base":0,"ridge":0.8178834718133734,"category":"A"},{"x":112.75744680851065,"base":0,"ridge":0.8792598869523294,"category":"A"},{"x":117.42553191489361,"base":0,"ridge":0.9157467436648353,"category":"A"},{"x":122.0936170212766,"base":0,"ridge":0.92,"category":"A"},{"x":126.76170212765956,"base":0,"ridge":0.8901429922836829,"category":"A"},{"x":131.42978723404255,"base":0,"ridge":0.8304979662506193,"category":"A"},{"x":136.09787234042554,"base":0,"ridge":0.7504746156570916,"category":"A"},{"x":140.7659574468085,"base":0,"ridge":0.6617334522655302,"category":"A"},{"x":145.4340425531915,"base":0,"ridge":0.5745146969896299,"category":"A"},{"x":150.10212765957448,"base":0,"ridge":0.49476192738980157,"category":"A"},{"x":154.77021276595747,"base":0,"ridge":0.4234923628384912,"category":"A"},{"x":159.43829787234043,"base":0,"ridge":0.35858025275410066,"category":"A"},{"x":164.10638297872342,"base":0,"ridge":0.2976294319541896,"category":"A"},{"x":168.7744680851064,"base":0,"ridge":0.24008601189882298,"category":"A"},{"x":173.44255319148937,"base":0,"ridge":0.1875208680985311,"category":"A"},{"x":178.11063829787236,"base":0,"ridge":0.1423644451848858,"category":"A"},{"x":182.77872340425532,"base":0,"ridge":0.10626038639318816,"category":"A"},{"x":187.4468085106383,"base":0,"ridge":0.07914917840514175,"category":"A"},{"x":192.1148936170213,"base":0,"ridge":0.0594872196668041,"category":"A"},{"x":196.78297872340426,"base":0,"ridge":0.0452412123701259,"category":"A"},{"x":201.45106382978724,"base":0,"ridge":0.034903912138579817,"category":"A"},{"x":206.11914893617023,"base":0,"ridge":0.02788999183432747,"category":"A"},{"x":210.78723404255322,"base":0,"ridge":0.024158229072025215,"category":"A"},{"x":215.45531914893618,"base":0,"ridge":0.02344148416162846,"category":"A"},{"x":220.12340425531914,"base":0,"ridge":0.02470292740414678,"category":"A"},{"x":224.79148936170213,"base":0,"ridge":0.026236561785949422,"category":"A"},{"x":229.45957446808512,"base":0,"ridge":0.02634891332824225,"category":"A"},{"x":234.1276595744681,"base":0,"ridge":0.02413931724455435,"category":"A"},{"x":238.79574468085107,"base":0,"ridge":0.019840726732164544,"category":"A"},{"x":243.46382978723406,"base":0,"ridge":0.014526684561091716,"category":"A"},{"x":248.13191489361702,"base":0,"ridge":0.009446487732709152,"category":"A"},{"x":252.80000000000004,"base":0,"ridge":0.005449345658020846,"category":"A"}],"x":"x","y1":"base","y2":"ridge","z":"category","fill":"category","fillOpacity":0.85,"curve":"basis"},{"type":"ruleY","data":[{"y":2,"category":"A"},{"y":1,"category":"B"},{"y":0,"category":"C"}],"y":"y","stroke":"theme:grid","strokeWidth":0.75},{"type":"text","data":[{"x":36.690999999999995,"ridge":2.34,"category":"C"},{"x":36.690999999999995,"ridge":1.34,"category":"B"},{"x":36.690999999999995,"ridge":0.34,"category":"A"}],"x":"x","y":"ridge","text":"category","textAnchor":"start","dx":2,"fill":"theme:muted","fontSize":11}]}
```

### Violin plot — `violin` (echarts)

Compare the shape of a distribution across a few groups, not just its quartiles. **Avoid:** Fewer than ~20 values per group: a box plot or a strip plot is enough.

Row shape (2 of 240 rows): `[{"group":"A","latency_ms":229.2},{"group":"B","latency_ms":158.5}]`

Tested at width 640, height 380.

```json
{"title":{"text":"Response time by service","left":"center","textStyle":{"fontSize":16,"fontWeight":600,"color":"theme:text"}},"grid":{"left":96,"right":40,"top":64,"bottom":52},"xAxis":{"type":"value","name":"Latency (ms)","nameLocation":"middle","nameGap":30,"nameTextStyle":{"color":"theme:muted"},"splitLine":{"show":true},"axisLabel":{"color":"theme:muted"}},"yAxis":[{"type":"value","min":0,"max":3,"axisLabel":{"show":false},"axisLine":{"show":false},"axisTick":{"show":false},"splitLine":{"show":false}},{"type":"category","data":["A","B","C"],"position":"left","axisLine":{"show":false},"axisTick":{"show":false},"splitLine":{"show":false},"axisLabel":{"color":"theme:text","fontSize":11}}],"series":[{"type":"line","name":"A","data":[[52.9,2.551],[58.58709677419355,2.572],[64.27419354838709,2.597],[69.96129032258064,2.626],[75.64838709677419,2.658],[81.33548387096774,2.693],[87.02258064516128,2.73],[92.70967741935483,2.769],[98.39677419354838,2.813],[104.08387096774193,2.86],[109.77096774193546,2.902],[115.45806451612901,2.931],[121.14516129032256,2.94],[126.83225806451611,2.924],[132.51935483870966,2.888],[138.2064516129032,2.839],[143.89354838709676,2.788],[149.5806451612903,2.74],[155.26774193548385,2.699],[160.9548387096774,2.662],[166.64193548387095,2.627],[172.3290322580645,2.595],[178.01612903225805,2.568],[183.7032258064516,2.548],[189.39032258064515,2.533],[195.07741935483872,2.524],[200.76451612903224,2.517],[206.4516129032258,2.513],[212.13870967741934,2.511],[217.8258064516129,2.511],[223.51290322580644,2.512],[229.2,2.513]],"showSymbol":false,"smooth":false,"silent":true,"z":3,"lineStyle":{"width":1,"color":"theme:categorical.0"},"areaStyle":{"origin":2.5,"color":"theme:categorical.0","opacity":0.32},"markArea":{"silent":true,"itemStyle":{"color":"theme:categorical.0","opacity":0.22},"data":[[{"coord":[102.15,2.26]},{"coord":[136.55,2.74]}]]},"markLine":{"silent":true,"symbol":"none","lineStyle":{"color":"theme:categorical.0","width":2},"data":[[{"coord":[120.69999999999999,2.26]},{"coord":[120.69999999999999,2.74]}]]}},{"type":"line","name":"A","data":[[229.2,2.487],[223.51290322580644,2.488],[217.8258064516129,2.489],[212.13870967741934,2.489],[206.4516129032258,2.487],[200.76451612903224,2.483],[195.07741935483872,2.476],[189.39032258064515,2.467],[183.7032258064516,2.452],[178.01612903225805,2.432],[172.3290322580645,2.405],[166.64193548387095,2.373],[160.9548387096774,2.338],[155.26774193548385,2.301],[149.5806451612903,2.26],[143.89354838709676,2.212],[138.2064516129032,2.161],[132.51935483870966,2.112],[126.83225806451611,2.076],[121.14516129032256,2.06],[115.45806451612901,2.069],[109.77096774193546,2.098],[104.08387096774193,2.14],[98.39677419354838,2.187],[92.70967741935483,2.231],[87.02258064516128,2.27],[81.33548387096774,2.307],[75.64838709677419,2.342],[69.96129032258064,2.374],[64.27419354838709,2.403],[58.58709677419355,2.428],[52.9,2.449]],"showSymbol":false,"smooth":false,"silent":true,"z":3,"lineStyle":{"width":1,"color":"theme:categorical.0"},"areaStyle":{"origin":2.5,"color":"theme:categorical.0","opacity":0.32}},{"type":"line","name":"B","data":[[94.7,1.539],[99.8,1.559],[104.9,1.584],[110,1.613],[115.10000000000001,1.642],[120.2,1.672],[125.30000000000001,1.704],[130.4,1.743],[135.5,1.79],[140.60000000000002,1.843],[145.70000000000002,1.891],[150.8,1.925],[155.9,1.94],[161,1.938],[166.10000000000002,1.922],[171.20000000000002,1.894],[176.3,1.858],[181.4,1.816],[186.5,1.774],[191.60000000000002,1.735],[196.70000000000002,1.7],[201.8,1.666],[206.90000000000003,1.634],[212.00000000000003,1.603],[217.10000000000002,1.576],[222.20000000000002,1.554],[227.3,1.537],[232.40000000000003,1.526],[237.50000000000006,1.519],[242.60000000000002,1.516],[247.70000000000005,1.515],[252.8,1.514]],"showSymbol":false,"smooth":false,"silent":true,"z":3,"lineStyle":{"width":1,"color":"theme:categorical.1"},"areaStyle":{"origin":1.5,"color":"theme:categorical.1","opacity":0.32},"markArea":{"silent":true,"itemStyle":{"color":"theme:categorical.1","opacity":0.22},"data":[[{"coord":[146.375,1.26]},{"coord":[176.675,1.74]}]]},"markLine":{"silent":true,"symbol":"none","lineStyle":{"color":"theme:categorical.1","width":2},"data":[[{"coord":[159.64999999999998,1.26]},{"coord":[159.64999999999998,1.74]}]]}},{"type":"line","name":"B","data":[[252.8,1.486],[247.70000000000005,1.485],[242.60000000000002,1.484],[237.50000000000006,1.481],[232.40000000000003,1.474],[227.3,1.463],[222.20000000000002,1.446],[217.10000000000002,1.424],[212.00000000000003,1.397],[206.90000000000003,1.366],[201.8,1.334],[196.70000000000002,1.3],[191.60000000000002,1.265],[186.5,1.226],[181.4,1.184],[176.3,1.142],[171.20000000000002,1.106],[166.10000000000002,1.078],[161,1.062],[155.9,1.06],[150.8,1.075],[145.70000000000002,1.109],[140.60000000000002,1.157],[135.5,1.21],[130.4,1.257],[125.30000000000001,1.296],[120.2,1.328],[115.10000000000001,1.358],[110,1.387],[104.9,1.416],[99.8,1.441],[94.7,1.461]],"showSymbol":false,"smooth":false,"silent":true,"z":3,"lineStyle":{"width":1,"color":"theme:categorical.1"},"areaStyle":{"origin":1.5,"color":"theme:categorical.1","opacity":0.32}},{"type":"line","name":"C","data":[[33.4,0.558],[38.09032258064516,0.58],[42.78064516129032,0.603],[47.47096774193548,0.628],[52.16129032258064,0.655],[56.851612903225806,0.687],[61.54193548387097,0.723],[66.23225806451613,0.765],[70.92258064516129,0.81],[75.61290322580646,0.853],[80.30322580645162,0.89],[84.99354838709678,0.918],[89.68387096774194,0.935],[94.3741935483871,0.94],[99.06451612903226,0.933],[103.75483870967741,0.913],[108.44516129032257,0.883],[113.13548387096773,0.844],[117.82580645161292,0.802],[122.51612903225805,0.76],[127.20645161290324,0.723],[131.8967741935484,0.692],[136.58709677419355,0.665],[141.2774193548387,0.641],[145.96774193548387,0.617],[150.65806451612903,0.594],[155.3483870967742,0.571],[160.03870967741935,0.551],[164.72903225806454,0.536],[169.4193548387097,0.526],[174.10967741935485,0.52],[178.8,0.517]],"showSymbol":false,"smooth":false,"silent":true,"z":3,"lineStyle":{"width":1,"color":"theme:categorical.2"},"areaStyle":{"origin":0.5,"color":"theme:categorical.2","opacity":0.32},"markArea":{"silent":true,"itemStyle":{"color":"theme:categorical.2","opacity":0.22},"data":[[{"coord":[77.475,0.26]},{"coord":[113.95,0.74]}]]},"markLine":{"silent":true,"symbol":"none","lineStyle":{"color":"theme:categorical.2","width":2},"data":[[{"coord":[95.5,0.26]},{"coord":[95.5,0.74]}]]}},{"type":"line","name":"C","data":[[178.8,0.483],[174.10967741935485,0.48],[169.4193548387097,0.474],[164.72903225806454,0.464],[160.03870967741935,0.449],[155.3483870967742,0.429],[150.65806451612903,0.406],[145.96774193548387,0.383],[141.2774193548387,0.359],[136.58709677419355,0.335],[131.8967741935484,0.308],[127.20645161290324,0.277],[122.51612903225805,0.24],[117.82580645161292,0.198],[113.13548387096773,0.156],[108.44516129032257,0.117],[103.75483870967741,0.087],[99.06451612903226,0.067],[94.3741935483871,0.06],[89.68387096774194,0.065],[84.99354838709678,0.082],[80.30322580645162,0.11],[75.61290322580646,0.147],[70.92258064516129,0.19],[66.23225806451613,0.235],[61.54193548387097,0.277],[56.851612903225806,0.313],[52.16129032258064,0.345],[47.47096774193548,0.372],[42.78064516129032,0.397],[38.09032258064516,0.42],[33.4,0.442]],"showSymbol":false,"smooth":false,"silent":true,"z":3,"lineStyle":{"width":1,"color":"theme:categorical.2"},"areaStyle":{"origin":0.5,"color":"theme:categorical.2","opacity":0.32}}]}
```

## hierarchy

### Treemap — `treemap` (vega)

Sizes within a hierarchy (budget, disk use).

Row shape (2 of 15 rows): `[{"id":"root","parent":null,"name":"Company","size":0,"group":"Company"},{"id":"Product","parent":"root","name":"Product","size":0,"group":"Product"}]`

```json
{"autosize":"pad","data":[{"name":"table"},{"name":"tree","source":"table","transform":[{"type":"stratify","key":"id","parentKey":"parent"},{"type":"treemap","field":"size","sort":{"field":"value","order":"descending"},"round":true,"method":"squarify","paddingInner":2,"paddingOuter":0,"size":[{"signal":"width"},{"signal":"height"}]}]},{"name":"leaves","source":"tree","transform":[{"type":"filter","expr":"!datum.children"}]}],"scales":[{"name":"color","type":"ordinal","domain":{"data":"leaves","field":"group","sort":true},"range":"category"}],"marks":[{"type":"rect","from":{"data":"leaves"},"encode":{"enter":{"fill":{"scale":"color","field":"group"},"stroke":{"signal":"background"}},"update":{"x":{"field":"x0"},"y":{"field":"y0"},"x2":{"field":"x1"},"y2":{"field":"y1"}}}},{"type":"text","from":{"data":"leaves"},"encode":{"enter":{"text":{"signal":"datum.name + ' · ' + datum.size"},"fontSize":{"value":11},"fill":{"signal":"luminance(scale('color', datum.group)) > 0.19 ? '#111111' : '#FFFFFF'"}},"update":{"x":{"signal":"datum.x0 + 6"},"y":{"signal":"datum.y0 + 16"},"opacity":{"signal":"datum.y1 - datum.y0 >= 22 && datum.x1 - datum.x0 >= 12 + length(datum.name + ' · ' + datum.size) * 6 ? 1 : 0"}}}},{"type":"text","from":{"data":"leaves"},"encode":{"enter":{"text":{"signal":"datum.name"},"fontSize":{"value":11},"fill":{"signal":"luminance(scale('color', datum.group)) > 0.19 ? '#111111' : '#FFFFFF'"}},"update":{"x":{"signal":"datum.x0 + 6"},"y":{"signal":"datum.y0 + 16"},"opacity":{"signal":"datum.y1 - datum.y0 >= 22 && datum.x1 - datum.x0 < 12 + length(datum.name + ' · ' + datum.size) * 6 && datum.x1 - datum.x0 >= 12 + length(datum.name) * 6 ? 1 : 0"}}}}],"legends":[{"fill":"color","orient":"bottom","direction":"horizontal","title":"Department"}]}
```

### Sunburst — `sunburst` (vega)

A hierarchy as nested rings.

Row shape (2 of 15 rows): `[{"id":"root","parent":null,"name":"Company","size":0,"group":"Company"},{"id":"Product","parent":"root","name":"Product","size":0,"group":"Product"}]`

Tested at width 420, height 420.

```json
{"autosize":"pad","data":[{"name":"table"},{"name":"tree","source":"table","transform":[{"type":"stratify","key":"id","parentKey":"parent"},{"type":"partition","field":"size","sort":{"field":"value"},"size":[{"signal":"2 * PI"},{"signal":"min(width, height) / 2"}],"as":["a0","r0","a1","r1","depth","children"]}]}],"scales":[{"name":"color","type":"ordinal","domain":{"data":"tree","field":"group","sort":true},"range":"category"}],"marks":[{"type":"arc","from":{"data":"tree"},"encode":{"enter":{"x":{"signal":"width / 2"},"y":{"signal":"height / 2"},"fill":{"signal":"datum.depth === 0 ? 'transparent' : scale('color', datum.group)"},"fillOpacity":{"signal":"datum.depth === 1 ? 1 : 0.7"},"stroke":{"signal":"background"},"strokeWidth":{"value":1}},"update":{"startAngle":{"field":"a0"},"endAngle":{"field":"a1"},"innerRadius":{"field":"r0"},"outerRadius":{"field":"r1"}}}},{"type":"text","from":{"data":"tree"},"encode":{"enter":{"text":{"field":"name"},"fontSize":{"value":10},"align":{"value":"center"},"baseline":{"value":"middle"},"fill":{"signal":"luminance(scale('color', datum.group)) > 0.45 ? '#111111' : '#FFFFFF'"}},"update":{"x":{"signal":"width / 2 + (datum.r0 + datum.r1) / 2 * sin((datum.a0 + datum.a1) / 2)"},"y":{"signal":"height / 2 - (datum.r0 + datum.r1) / 2 * cos((datum.a0 + datum.a1) / 2)"},"opacity":{"signal":"datum.depth >= 1 && (datum.a1 - datum.a0) * (datum.r0 + datum.r1) / 2 > 34 ? 1 : 0"}}}}]}
```

### Tree (dendrogram) — `tree` (vega)

Structure of a hierarchy (org chart, taxonomy).

Row shape (2 of 15 rows): `[{"id":"root","parent":null,"name":"Company","size":0,"group":"Company"},{"id":"Product","parent":"root","name":"Product","size":0,"group":"Product"}]`

Tested at width 560, height 380.

```json
{"autosize":"pad","padding":{"left":70,"right":70,"top":10,"bottom":10},"data":[{"name":"table"},{"name":"tree","source":"table","transform":[{"type":"stratify","key":"id","parentKey":"parent"},{"type":"tree","method":"tidy","size":[{"signal":"height"},{"signal":"width - 60"}],"separation":true,"as":["y","x","depth","children"]}]},{"name":"links","source":"tree","transform":[{"type":"treelinks"},{"type":"linkpath","orient":"horizontal","shape":"diagonal"}]}],"scales":[{"name":"color","type":"ordinal","domain":{"data":"tree","field":"group","sort":true},"range":"category"}],"marks":[{"type":"path","from":{"data":"links"},"encode":{"update":{"path":{"field":"path"},"stroke":{"value":"theme:axis"}}}},{"type":"symbol","from":{"data":"tree"},"encode":{"enter":{"size":{"value":90},"stroke":{"signal":"background"}},"update":{"x":{"field":"x"},"y":{"field":"y"},"fill":{"scale":"color","field":"group"}}}},{"type":"text","from":{"data":"tree"},"encode":{"enter":{"text":{"field":"name"},"fontSize":{"value":11},"baseline":{"value":"middle"}},"update":{"x":{"field":"x"},"y":{"field":"y"},"dx":{"signal":"datum.children ? -9 : 9"},"align":{"signal":"datum.children ? 'right' : 'left'"}}}}]}
```

## relationship

### Scatter plot — `scatter` (vega-lite)

Relationship between two numbers.

Row shape (2 of 60 rows): `[{"spend_k":5,"conversions":0,"channel":"Search","customers":50},{"spend_k":42,"conversions":91,"channel":"Social","customers":79}]`

```json
{"mark":{"type":"point","filled":true,"opacity":0.8},"encoding":{"x":{"field":"spend_k","type":"quantitative","title":"Spend (€k)"},"y":{"field":"conversions","type":"quantitative","title":"Conversions"},"color":{"field":"channel","type":"nominal"}}}
```

### Bubble chart — `bubble` (vega-lite)

A scatter with a third measure as area.

Row shape (2 of 30 rows): `[{"spend_k":5,"conversions":0,"channel":"Search","customers":50},{"spend_k":42,"conversions":91,"channel":"Social","customers":79}]`

```json
{"mark":{"type":"circle","opacity":0.6,"stroke":"theme:background","strokeWidth":1},"encoding":{"x":{"field":"spend_k","type":"quantitative","title":"Spend (€k)"},"y":{"field":"conversions","type":"quantitative","title":"Conversions"},"size":{"field":"customers","type":"quantitative","title":"Customers","scale":{"range":[30,900]}},"color":{"field":"channel","type":"nominal"}}}
```

### Scatter with trend line — `regression` (vega-lite)

Show the overall trend through points.

Row shape (2 of 60 rows): `[{"spend_k":5,"conversions":0,"channel":"Search","customers":50},{"spend_k":42,"conversions":91,"channel":"Social","customers":79}]`

```json
{"encoding":{"x":{"field":"spend_k","type":"quantitative","title":"Spend (€k)"},"y":{"field":"conversions","type":"quantitative","title":"Conversions"}},"layer":[{"mark":{"type":"point","filled":true,"opacity":0.6}},{"mark":{"type":"line","color":"theme:highlight","strokeWidth":2.5},"transform":[{"regression":"conversions","on":"spend_k"}]}]}
```

### Correlation matrix — `correlation_matrix` (vega-lite)

Pairwise correlations between several measures.

Row shape (2 of 25 rows): `[{"a":"price","b":"price","r":1},{"a":"price","b":"rating","r":-0.3}]`

Tested at width 360, height 360.

```json
{"encoding":{"x":{"field":"a","type":"nominal","sort":["price","rating","reviews","returns","margin"],"title":null},"y":{"field":"b","type":"nominal","sort":["price","rating","reviews","returns","margin"],"title":null}},"layer":[{"mark":"rect","encoding":{"color":{"field":"r","type":"quantitative","scale":{"domain":[-1,1],"scheme":"redblue","reverse":true},"title":"r"}}},{"mark":{"type":"text","fontSize":11},"encoding":{"text":{"field":"r","type":"quantitative","format":".1f"},"color":{"condition":{"test":"abs(datum.r) > 0.5","value":"#FFFFFF"},"value":"#111111"}}}]}
```

### Connected scatter — `connected_scatter` (vega-lite)

How two measures moved together over time.

Row shape (2 of 10 rows): `[{"year":2015,"unemployment":0.1,"inflation":0.001},{"year":2016,"unemployment":0.096,"inflation":0.002}]`

```json
{"encoding":{"x":{"field":"unemployment","type":"quantitative","axis":{"format":".1%"},"scale":{"zero":false},"title":"Unemployment"},"y":{"field":"inflation","type":"quantitative","axis":{"format":".0%"},"title":"Inflation"},"order":{"field":"year"}},"layer":[{"mark":{"type":"line","point":true}},{"mark":{"type":"text","align":"left","dx":7,"dy":-7,"fontSize":10},"encoding":{"text":{"field":"year","type":"nominal"}}}]}
```

### Parallel coordinates — `parallel` (echarts)

Many measures per item; spot clusters and trade-offs.

Tested at width 640.

```json
{"parallelAxis":[{"dim":0,"name":"Price (€)"},{"dim":1,"name":"Weight (kg)"},{"dim":2,"name":"Battery (h)"},{"dim":3,"name":"Score"}],"parallel":{"left":60,"right":60,"top":80,"bottom":40},"series":[{"type":"parallel","lineStyle":{"width":2,"opacity":0.7},"data":[[1299,1.2,14,88],[899,1.6,10,76],[1999,1.4,18,93],[649,2.1,7,64],[1499,1.3,12,85],[1099,1.8,11,79]]}]}
```

### Radar chart — `radar` (echarts)

A profile across 4–8 comparable scores, for 1–3 items. **Avoid:** Precise comparison: use grouped bars.

Tested at width 480, height 420.

```json
{"legend":{"data":["Model A","Model B"]},"radar":{"indicator":[{"name":"Speed","max":10},{"name":"Cost","max":10},{"name":"Quality","max":10},{"name":"Support","max":10},{"name":"Features","max":10}]},"series":[{"type":"radar","areaStyle":{"opacity":0.2},"data":[{"name":"Model A","value":[8,5,7,6,9]},{"name":"Model B","value":[6,8,8,7,5]}]}]}
```

### Brushable scatter — `interactive_brush` (vega-lite)

Interactive HTML: drag to highlight a region.

Row shape (2 of 60 rows): `[{"spend_k":5,"conversions":0,"channel":"Search","customers":50},{"spend_k":42,"conversions":91,"channel":"Social","customers":79}]`

```json
{"params":[{"name":"brush","select":"interval"}],"mark":{"type":"point","filled":true},"encoding":{"x":{"field":"spend_k","type":"quantitative","title":"Spend (€k)"},"y":{"field":"conversions","type":"quantitative","title":"Conversions"},"color":{"condition":{"param":"brush","field":"channel","type":"nominal","title":"Channel"},"value":"theme:grid"}}}
```

### Hexbin scatter — `hexbin` (plot)

Two numbers with hundreds of rows: bin them into hexagons and shade each by how many rows land in it. **Avoid:** Fewer than ~200 rows, or an exact value: a scatter plot keeps every point.

Row shape (2 of 220 rows): `[{"spend_k":110.5,"conversions":183},{"spend_k":51.2,"conversions":117}]`

```json
{"width":560,"height":340,"x":{"label":"Spend (€k)"},"y":{"label":"Conversions"},"color":{"type":"linear","range":"theme:sequential","legend":false},"marks":[{"type":"hexbin","x":"spend_k","y":"conversions","outputs":{"fill":"count"},"binWidth":16,"inset":-0.4},{"type":"text","data":[{"text":"Darker = more campaigns"}],"text":"text","frameAnchor":"top-left","dx":6,"dy":12,"fill":"theme:muted","fontSize":10}]}
```

### Voronoi tessellation — `voronoi` (plot)

Split the plane into the region nearest each point, so local density and gaps read at once. **Avoid:** Reading exact positions: the cells hide the points' own values.

Row shape (2 of 70 rows): `[{"spend_k":110.5,"conversions":183},{"spend_k":51.2,"conversions":117}]`

```json
{"width":560,"height":340,"x":{"label":"Spend (€k)"},"y":{"label":"Conversions"},"marks":[{"type":"voronoi","x":"spend_k","y":"conversions","fill":"theme:categorical.0","fillOpacity":0.12,"stroke":"theme:axis","strokeOpacity":0.42,"strokeWidth":0.9},{"type":"dot","x":"spend_k","y":"conversions","r":3,"fill":"theme:categorical.1"}]}
```

## flow

### Sankey diagram — `sankey` (echarts)

Volumes flowing between stages or categories. **Avoid:** Cycles: a Sankey flows one way.

Tested at width 640, height 360.

```json
{"series":[{"type":"sankey","left":96,"right":96,"top":40,"bottom":28,"nodeWidth":14,"nodeGap":14,"lineStyle":{"color":"gradient","opacity":0.42,"curveness":0.5},"label":{"fontSize":11,"textBorderWidth":2,"textBorderColor":"theme:background"},"data":[{"name":"Search","label":{"position":"left"}},{"name":"Social","label":{"position":"left"}},{"name":"Referral","label":{"position":"left"}},{"name":"Trial","label":{"position":"top"}},{"name":"Paid","label":{"position":"right"}},{"name":"Churned","label":{"position":"right"}}],"links":[{"source":"Search","target":"Trial","value":520},{"source":"Social","target":"Trial","value":310},{"source":"Referral","target":"Trial","value":170},{"source":"Trial","target":"Paid","value":410},{"source":"Trial","target":"Churned","value":590}]}]}
```

### Chord diagram — `chord` (echarts)

Two-way flows between a few groups.

Tested at width 460, height 440.

```json
{"series":[{"type":"chord","radius":["70%","78%"],"label":{"show":true},"lineStyle":{"color":"source","opacity":0.4},"data":[{"name":"Free"},{"name":"Basic"},{"name":"Pro"},{"name":"Team"}],"links":[{"source":"Free","target":"Basic","value":40},{"source":"Basic","target":"Pro","value":25},{"source":"Pro","target":"Team","value":12},{"source":"Basic","target":"Free","value":10},{"source":"Pro","target":"Basic","value":8},{"source":"Team","target":"Pro","value":4}]}]}
```

### Force-directed network — `network` (vega)

Who is connected to whom.

Tested at width 520, height 360.

```json
{"autosize":"pad","data":[{"name":"node-data","values":[{"index":0,"name":"Ana","team":"Data"},{"index":1,"name":"Ben","team":"Web"},{"index":2,"name":"Chloe","team":"Ops"},{"index":3,"name":"Dev","team":"Data"},{"index":4,"name":"Eva","team":"Web"},{"index":5,"name":"Finn","team":"Ops"},{"index":6,"name":"Gus","team":"Data"},{"index":7,"name":"Hana","team":"Web"},{"index":8,"name":"Ivo","team":"Ops"},{"index":9,"name":"Jun","team":"Data"}]},{"name":"link-data","values":[{"source":0,"target":1},{"source":0,"target":2},{"source":1,"target":2},{"source":2,"target":3},{"source":3,"target":4},{"source":4,"target":5},{"source":5,"target":6},{"source":6,"target":3},{"source":7,"target":8},{"source":8,"target":9},{"source":9,"target":7},{"source":0,"target":7},{"source":4,"target":8}]}],"scales":[{"name":"color","type":"ordinal","domain":{"data":"node-data","field":"team","sort":true},"range":"category"}],"marks":[{"name":"nodes","type":"symbol","zindex":1,"from":{"data":"node-data"},"encode":{"enter":{"fill":{"scale":"color","field":"team"},"stroke":{"signal":"background"},"strokeWidth":{"value":1.5},"size":{"value":260}}},"transform":[{"type":"force","iterations":400,"static":true,"signal":"force","forces":[{"force":"center","x":{"signal":"width / 2"},"y":{"signal":"height / 2"}},{"force":"collide","radius":26},{"force":"nbody","strength":-120},{"force":"link","links":"link-data","distance":85}]}]},{"type":"path","from":{"data":"link-data"},"interactive":false,"encode":{"update":{"stroke":{"value":"theme:axis"},"strokeWidth":{"value":1.2}}},"transform":[{"type":"linkpath","require":{"signal":"force"},"shape":"line","sourceX":"datum.source.x","sourceY":"datum.source.y","targetX":"datum.target.x","targetY":"datum.target.y"}]},{"type":"text","from":{"data":"nodes"},"zindex":2,"encode":{"update":{"x":{"field":"x"},"y":{"field":"y","offset":-15},"text":{"field":"datum.name"},"align":{"value":"center"},"fontSize":{"value":11}}}}],"legends":[{"fill":"color","orient":"bottom-right","title":"Team"}]}
```

## map

### World choropleth — `choropleth_world` (vega-lite)

A rate by country. Join on iso_a3, iso_a2 or name from the bundled world-110m atlas. **Avoid:** Totals (bigger countries dominate): map rates, or use a bubble map.

Row shape (2 of 25 rows): `[{"iso":"USA","users_share":0.92},{"iso":"CAN","users_share":0.93}]`

Tested at width 640, height 340.

```json
{"data":{"atlas":"world-110m"},"projection":{"type":"equalEarth"},"layer":[{"mark":{"type":"geoshape","stroke":"theme:background","strokeWidth":0.5},"encoding":{"color":{"datum":"No data","type":"nominal","scale":{"domain":["No data"],"range":["theme:grid"]},"legend":{"title":null,"orient":"bottom-right"}}}},{"transform":[{"lookup":"properties.iso_a3","from":{"data":{"name":"table"},"key":"iso","fields":["users_share"]}},{"filter":"isValid(datum.users_share)"}],"mark":{"type":"geoshape"},"encoding":{"color":{"field":"users_share","type":"quantitative","legend":{"format":".0%"},"title":"Internet users"}}}],"resolve":{"scale":{"color":"independent"}}}
```

### US states choropleth — `choropleth_us` (vega-lite)

A rate by US state (join on postal, name or FIPS id).

Row shape (2 of 51 rows): `[{"postal":"CA","unemployment":0.025},{"postal":"TX","unemployment":0.032}]`

Tested at width 600, height 360.

```json
{"data":{"atlas":"us-states-10m"},"projection":{"type":"albersUsa"},"transform":[{"lookup":"properties.postal","from":{"data":{"name":"table"},"key":"postal","fields":["unemployment"]}}],"mark":"geoshape","encoding":{"color":{"field":"unemployment","type":"quantitative","legend":{"format":".1%"},"title":"Unemployment"}}}
```

### Point / bubble map — `point_map` (vega-lite)

Values at places (cities, stores) on a world base map.

Row shape (2 of 10 rows): `[{"city":"London","lat":51.5,"lon":-0.13,"customers":1200},{"city":"New York","lat":40.7,"lon":-74,"customers":2100}]`

Tested at width 640, height 340.

```json
{"projection":{"type":"equalEarth"},"layer":[{"data":{"atlas":"world-land-110m"},"mark":{"type":"geoshape","fill":"theme:grid","stroke":null}},{"data":{"name":"table"},"mark":{"type":"circle","opacity":0.75,"stroke":"theme:background","strokeWidth":1},"encoding":{"longitude":{"field":"lon","type":"quantitative"},"latitude":{"field":"lat","type":"quantitative"},"size":{"field":"customers","type":"quantitative","scale":{"range":[40,900]},"title":"Customers"}}}]}
```

### US state hex cartogram — `cartogram_us_hex` (plot)

Compare a value across US states, where every state deserves the same space whatever its area. **Avoid:** Geographic shape or position itself: use the US states choropleth.

Row shape (2 of 51 rows): `[{"postal":"AK","state":"Alaska","broadband_pct":62},{"postal":"ME","state":"Maine","broadband_pct":65}]`

```json
{"width":620,"height":331,"marginTop":10,"marginRight":10,"marginBottom":10,"marginLeft":10,"x":{"domain":[0,600.0000000000001],"axis":null},"y":{"domain":[0,311.2671016500592],"axis":null},"marks":[{"type":"lineY","data":[{"x":21.565217391304355,"y":311.2671016500592,"code":"AK","fill":"theme:sequential.5"},{"x":43.13043478260871,"y":298.8164175840568,"code":"AK","fill":"theme:sequential.5"},{"x":43.13043478260871,"y":273.91504945205213,"code":"AK","fill":"theme:sequential.5"},{"x":21.565217391304355,"y":261.46436538604974,"code":"AK","fill":"theme:sequential.5"},{"x":0,"y":273.91504945205213,"code":"AK","fill":"theme:sequential.5"},{"x":3.552713678800501e-15,"y":298.81641758405686,"code":"AK","fill":"theme:sequential.5"},{"x":452.86956521739137,"y":311.2671016500592,"code":"ME","fill":"theme:sequential.5"},{"x":474.43478260869574,"y":298.8164175840568,"code":"ME","fill":"theme:sequential.5"},{"x":474.43478260869574,"y":273.91504945205213,"code":"ME","fill":"theme:sequential.5"},{"x":452.86956521739137,"y":261.46436538604974,"code":"ME","fill":"theme:sequential.5"},{"x":431.304347826087,"y":273.91504945205213,"code":"ME","fill":"theme:sequential.5"},{"x":431.304347826087,"y":298.81641758405686,"code":"ME","fill":"theme:sequential.5"},{"x":431.30434782608705,"y":273.91504945205213,"code":"VT","fill":"theme:sequential.5"},{"x":452.8695652173914,"y":261.46436538604974,"code":"VT","fill":"theme:sequential.5"},{"x":452.8695652173914,"y":236.562997254045,"code":"VT","fill":"theme:sequential.5"},{"x":431.30434782608705,"y":224.11231318804263,"code":"VT","fill":"theme:sequential.5"},{"x":409.7391304347827,"y":236.562997254045,"code":"VT","fill":"theme:sequential.5"},{"x":409.7391304347827,"y":261.46436538604974,"code":"VT","fill":"theme:sequential.5"},{"x":474.43478260869574,"y":273.91504945205213,"code":"NH","fill":"theme:sequential.5"},{"x":496.0000000000001,"y":261.46436538604974,"code":"NH","fill":"theme:sequential.5"},{"x":496.0000000000001,"y":236.562997254045,"code":"NH","fill":"theme:sequential.5"},{"x":474.43478260869574,"y":224.11231318804263,"code":"NH","fill":"theme:sequential.5"},{"x":452.86956521739137,"y":236.562997254045,"code":"NH","fill":"theme:sequential.5"},{"x":452.86956521739137,"y":261.46436538604974,"code":"NH","fill":"theme:sequential.5"},{"x":21.565217391304355,"y":236.562997254045,"code":"WA","fill":"theme:sequential.6"},{"x":43.13043478260871,"y":224.11231318804263,"code":"WA","fill":"theme:sequential.6"},{"x":43.13043478260871,"y":199.2109450560379,"code":"WA","fill":"theme:sequential.6"},{"x":21.565217391304355,"y":186.76026099003553,"code":"WA","fill":"theme:sequential.6"},{"x":0,"y":199.2109450560379,"code":"WA","fill":"theme:sequential.6"},{"x":3.552713678800501e-15,"y":224.11231318804263,"code":"WA","fill":"theme:sequential.6"},{"x":64.69565217391306,"y":236.562997254045,"code":"ID","fill":"theme:sequential.6"},{"x":86.26086956521742,"y":224.11231318804263,"code":"ID","fill":"theme:sequential.6"},{"x":86.26086956521742,"y":199.2109450560379,"code":"ID","fill":"theme:sequential.6"},{"x":64.69565217391306,"y":186.76026099003553,"code":"ID","fill":"theme:sequential.6"},{"x":43.1304347826087,"y":199.2109450560379,"code":"ID","fill":"theme:sequential.6"},{"x":43.1304347826087,"y":224.11231318804263,"code":"ID","fill":"theme:sequential.6"},{"x":107.82608695652176,"y":236.562997254045,"code":"MT","fill":"theme:sequential.6"},{"x":129.39130434782612,"y":224.11231318804263,"code":"MT","fill":"theme:sequential.6"},{"x":129.39130434782612,"y":199.2109450560379,"code":"MT","fill":"theme:sequential.6"},{"x":107.82608695652176,"y":186.76026099003553,"code":"MT","fill":"theme:sequential.6"},{"x":86.2608695652174,"y":199.2109450560379,"code":"MT","fill":"theme:sequential.6"},{"x":86.26086956521742,"y":224.11231318804263,"code":"MT","fill":"theme:sequential.6"},{"x":150.95652173913047,"y":236.562997254045,"code":"ND","fill":"theme:sequential.6"},{"x":172.5217391304348,"y":224.11231318804263,"code":"ND","fill":"theme:sequential.6"},{"x":172.5217391304348,"y":199.2109450560379,"code":"ND","fill":"theme:sequential.6"},{"x":150.95652173913047,"y":186.76026099003553,"code":"ND","fill":"theme:sequential.6"},{"x":129.39130434782612,"y":199.2109450560379,"code":"ND","fill":"theme:sequential.6"},{"x":129.39130434782612,"y":224.11231318804263,"code":"ND","fill":"theme:sequential.6"},{"x":194.08695652173915,"y":236.562997254045,"code":"MN","fill":"theme:sequential.7"},{"x":215.6521739130435,"y":224.11231318804263,"code":"MN","fill":"theme:sequential.7"},{"x":215.6521739130435,"y":199.2109450560379,"code":"MN","fill":"theme:sequential.7"},{"x":194.08695652173915,"y":186.76026099003553,"code":"MN","fill":"theme:sequential.7"},{"x":172.5217391304348,"y":199.2109450560379,"code":"MN","fill":"theme:sequential.7"},{"x":172.5217391304348,"y":224.11231318804263,"code":"MN","fill":"theme:sequential.7"},{"x":237.21739130434784,"y":236.562997254045,"code":"IL","fill":"theme:sequential.7"},{"x":258.7826086956522,"y":224.11231318804263,"code":"IL","fill":"theme:sequential.7"},{"x":258.7826086956522,"y":199.2109450560379,"code":"IL","fill":"theme:sequential.7"},{"x":237.21739130434784,"y":186.76026099003553,"code":"IL","fill":"theme:sequential.7"},{"x":215.6521739130435,"y":199.2109450560379,"code":"IL","fill":"theme:sequential.7"},{"x":215.6521739130435,"y":224.11231318804263,"code":"IL","fill":"theme:sequential.7"},{"x":280.3478260869566,"y":236.562997254045,"code":"WI","fill":"theme:sequential.7"},{"x":301.913043478261,"y":224.11231318804263,"code":"WI","fill":"theme:sequential.7"},{"x":301.913043478261,"y":199.2109450560379,"code":"WI","fill":"theme:sequential.7"},{"x":280.3478260869566,"y":186.76026099003553,"code":"WI","fill":"theme:sequential.7"},{"x":258.78260869565224,"y":199.2109450560379,"code":"WI","fill":"theme:sequential.7"},{"x":258.78260869565224,"y":224.11231318804263,"code":"WI","fill":"theme:sequential.7"},{"x":323.4782608695653,"y":236.562997254045,"code":"MI","fill":"theme:sequential.7"},{"x":345.0434782608697,"y":224.11231318804263,"code":"MI","fill":"theme:sequential.7"},{"x":345.0434782608697,"y":199.2109450560379,"code":"MI","fill":"theme:sequential.7"},{"x":323.4782608695653,"y":186.76026099003553,"code":"MI","fill":"theme:sequential.7"},{"x":301.91304347826093,"y":199.2109450560379,"code":"MI","fill":"theme:sequential.7"},{"x":301.91304347826093,"y":224.11231318804263,"code":"MI","fill":"theme:sequential.7"},{"x":366.608695652174,"y":236.562997254045,"code":"NY","fill":"theme:sequential.5"},{"x":388.17391304347836,"y":224.11231318804263,"code":"NY","fill":"theme:sequential.5"},{"x":388.17391304347836,"y":199.2109450560379,"code":"NY","fill":"theme:sequential.5"},{"x":366.608695652174,"y":186.76026099003553,"code":"NY","fill":"theme:sequential.5"},{"x":345.0434782608696,"y":199.2109450560379,"code":"NY","fill":"theme:sequential.5"},{"x":345.0434782608696,"y":224.11231318804263,"code":"NY","fill":"theme:sequential.5"},{"x":409.7391304347827,"y":236.562997254045,"code":"MA","fill":"theme:sequential.5"},{"x":431.30434782608705,"y":224.11231318804263,"code":"MA","fill":"theme:sequential.5"},{"x":431.30434782608705,"y":199.2109450560379,"code":"MA","fill":"theme:sequential.5"},{"x":409.7391304347827,"y":186.76026099003553,"code":"MA","fill":"theme:sequential.5"},{"x":388.1739130434783,"y":199.2109450560379,"code":"MA","fill":"theme:sequential.5"},{"x":388.1739130434783,"y":224.11231318804263,"code":"MA","fill":"theme:sequential.5"},{"x":452.86956521739137,"y":236.562997254045,"code":"RI","fill":"theme:sequential.5"},{"x":474.43478260869574,"y":224.11231318804263,"code":"RI","fill":"theme:sequential.5"},{"x":474.43478260869574,"y":199.2109450560379,"code":"RI","fill":"theme:sequential.5"},{"x":452.86956521739137,"y":186.76026099003553,"code":"RI","fill":"theme:sequential.5"},{"x":431.304347826087,"y":199.2109450560379,"code":"RI","fill":"theme:sequential.5"},{"x":431.304347826087,"y":224.11231318804263,"code":"RI","fill":"theme:sequential.5"},{"x":43.1304347826087,"y":199.2109450560379,"code":"OR","fill":"theme:sequential.6"},{"x":64.69565217391306,"y":186.76026099003553,"code":"OR","fill":"theme:sequential.6"},{"x":64.69565217391306,"y":161.8588928580308,"code":"OR","fill":"theme:sequential.6"},{"x":43.1304347826087,"y":149.40820879202843,"code":"OR","fill":"theme:sequential.6"},{"x":21.56521739130435,"y":161.8588928580308,"code":"OR","fill":"theme:sequential.6"},{"x":21.565217391304355,"y":186.76026099003553,"code":"OR","fill":"theme:sequential.6"},{"x":86.26086956521742,"y":199.2109450560379,"code":"NV","fill":"theme:sequential.6"},{"x":107.82608695652178,"y":186.76026099003553,"code":"NV","fill":"theme:sequential.6"},{"x":107.82608695652178,"y":161.8588928580308,"code":"NV","fill":"theme:sequential.6"},{"x":86.26086956521742,"y":149.40820879202843,"code":"NV","fill":"theme:sequential.6"},{"x":64.69565217391306,"y":161.8588928580308,"code":"NV","fill":"theme:sequential.6"},{"x":64.69565217391306,"y":186.76026099003553,"code":"NV","fill":"theme:sequential.6"},{"x":129.3913043478261,"y":199.2109450560379,"code":"WY","fill":"theme:sequential.6"},{"x":150.95652173913044,"y":186.76026099003553,"code":"WY","fill":"theme:sequential.6"},{"x":150.95652173913044,"y":161.8588928580308,"code":"WY","fill":"theme:sequential.6"},{"x":129.3913043478261,"y":149.40820879202843,"code":"WY","fill":"theme:sequential.6"},{"x":107.82608695652175,"y":161.8588928580308,"code":"WY","fill":"theme:sequential.6"},{"x":107.82608695652176,"y":186.76026099003553,"code":"WY","fill":"theme:sequential.6"},{"x":172.5217391304348,"y":199.2109450560379,"code":"SD","fill":"theme:sequential.6"},{"x":194.08695652173915,"y":186.76026099003553,"code":"SD","fill":"theme:sequential.6"},{"x":194.08695652173915,"y":161.8588928580308,"code":"SD","fill":"theme:sequential.6"},{"x":172.5217391304348,"y":149.40820879202843,"code":"SD","fill":"theme:sequential.6"},{"x":150.95652173913047,"y":161.8588928580308,"code":"SD","fill":"theme:sequential.6"},{"x":150.95652173913047,"y":186.76026099003553,"code":"SD","fill":"theme:sequential.6"},{"x":215.6521739130435,"y":199.2109450560379,"code":"IA","fill":"theme:sequential.7"},{"x":237.21739130434784,"y":186.76026099003553,"code":"IA","fill":"theme:sequential.7"},{"x":237.21739130434784,"y":161.8588928580308,"code":"IA","fill":"theme:sequential.7"},{"x":215.6521739130435,"y":149.40820879202843,"code":"IA","fill":"theme:sequential.7"},{"x":194.08695652173915,"y":161.8588928580308,"code":"IA","fill":"theme:sequential.7"},{"x":194.08695652173915,"y":186.76026099003553,"code":"IA","fill":"theme:sequential.7"},{"x":258.7826086956522,"y":199.2109450560379,"code":"IN","fill":"theme:sequential.7"},{"x":280.34782608695656,"y":186.76026099003553,"code":"IN","fill":"theme:sequential.7"},{"x":280.34782608695656,"y":161.8588928580308,"code":"IN","fill":"theme:sequential.7"},{"x":258.7826086956522,"y":149.40820879202843,"code":"IN","fill":"theme:sequential.7"},{"x":237.21739130434784,"y":161.8588928580308,"code":"IN","fill":"theme:sequential.7"},{"x":237.21739130434784,"y":186.76026099003553,"code":"IN","fill":"theme:sequential.7"},{"x":301.913043478261,"y":199.2109450560379,"code":"OH","fill":"theme:sequential.7"},{"x":323.47826086956536,"y":186.76026099003553,"code":"OH","fill":"theme:sequential.7"},{"x":323.47826086956536,"y":161.8588928580308,"code":"OH","fill":"theme:sequential.7"},{"x":301.913043478261,"y":149.40820879202843,"code":"OH","fill":"theme:sequential.7"},{"x":280.3478260869566,"y":161.8588928580308,"code":"OH","fill":"theme:sequential.7"},{"x":280.3478260869566,"y":186.76026099003553,"code":"OH","fill":"theme:sequential.7"},{"x":345.0434782608697,"y":199.2109450560379,"code":"PA","fill":"theme:sequential.7"},{"x":366.60869565217405,"y":186.76026099003553,"code":"PA","fill":"theme:sequential.7"},{"x":366.60869565217405,"y":161.8588928580308,"code":"PA","fill":"theme:sequential.7"},{"x":345.0434782608697,"y":149.40820879202843,"code":"PA","fill":"theme:sequential.7"},{"x":323.4782608695653,"y":161.8588928580308,"code":"PA","fill":"theme:sequential.7"},{"x":323.4782608695653,"y":186.76026099003553,"code":"PA","fill":"theme:sequential.7"},{"x":388.17391304347836,"y":199.2109450560379,"code":"NJ","fill":"theme:sequential.5"},{"x":409.73913043478274,"y":186.76026099003553,"code":"NJ","fill":"theme:sequential.5"},{"x":409.73913043478274,"y":161.8588928580308,"code":"NJ","fill":"theme:sequential.5"},{"x":388.17391304347836,"y":149.40820879202843,"code":"NJ","fill":"theme:sequential.5"},{"x":366.608695652174,"y":161.8588928580308,"code":"NJ","fill":"theme:sequential.5"},{"x":366.608695652174,"y":186.76026099003553,"code":"NJ","fill":"theme:sequential.5"},{"x":431.30434782608705,"y":199.2109450560379,"code":"CT","fill":"theme:sequential.5"},{"x":452.8695652173914,"y":186.76026099003553,"code":"CT","fill":"theme:sequential.5"},{"x":452.8695652173914,"y":161.8588928580308,"code":"CT","fill":"theme:sequential.5"},{"x":431.30434782608705,"y":149.40820879202843,"code":"CT","fill":"theme:sequential.5"},{"x":409.7391304347827,"y":161.8588928580308,"code":"CT","fill":"theme:sequential.5"},{"x":409.7391304347827,"y":186.76026099003553,"code":"CT","fill":"theme:sequential.5"},{"x":21.565217391304355,"y":161.8588928580308,"code":"CA","fill":"theme:sequential.5"},{"x":43.13043478260871,"y":149.40820879202843,"code":"CA","fill":"theme:sequential.5"},{"x":43.13043478260871,"y":124.5068406600237,"code":"CA","fill":"theme:sequential.5"},{"x":21.565217391304355,"y":112.05615659402133,"code":"CA","fill":"theme:sequential.5"},{"x":0,"y":124.5068406600237,"code":"CA","fill":"theme:sequential.5"},{"x":3.552713678800501e-15,"y":149.40820879202843,"code":"CA","fill":"theme:sequential.5"},{"x":64.69565217391306,"y":161.8588928580308,"code":"UT","fill":"theme:sequential.5"},{"x":86.26086956521742,"y":149.40820879202843,"code":"UT","fill":"theme:sequential.5"},{"x":86.26086956521742,"y":124.5068406600237,"code":"UT","fill":"theme:sequential.5"},{"x":64.69565217391306,"y":112.05615659402133,"code":"UT","fill":"theme:sequential.5"},{"x":43.1304347826087,"y":124.5068406600237,"code":"UT","fill":"theme:sequential.5"},{"x":43.1304347826087,"y":149.40820879202843,"code":"UT","fill":"theme:sequential.5"},{"x":107.82608695652176,"y":161.8588928580308,"code":"CO","fill":"theme:sequential.6"},{"x":129.39130434782612,"y":149.40820879202843,"code":"CO","fill":"theme:sequential.6"},{"x":129.39130434782612,"y":124.5068406600237,"code":"CO","fill":"theme:sequential.6"},{"x":107.82608695652176,"y":112.05615659402133,"code":"CO","fill":"theme:sequential.6"},{"x":86.2608695652174,"y":124.5068406600237,"code":"CO","fill":"theme:sequential.6"},{"x":86.26086956521742,"y":149.40820879202843,"code":"CO","fill":"theme:sequential.6"},{"x":150.95652173913047,"y":161.8588928580308,"code":"NE","fill":"theme:sequential.6"},{"x":172.5217391304348,"y":149.40820879202843,"code":"NE","fill":"theme:sequential.6"},{"x":172.5217391304348,"y":124.5068406600237,"code":"NE","fill":"theme:sequential.6"},{"x":150.95652173913047,"y":112.05615659402133,"code":"NE","fill":"theme:sequential.6"},{"x":129.39130434782612,"y":124.5068406600237,"code":"NE","fill":"theme:sequential.6"},{"x":129.39130434782612,"y":149.40820879202843,"code":"NE","fill":"theme:sequential.6"},{"x":194.08695652173915,"y":161.8588928580308,"code":"MO","fill":"theme:sequential.6"},{"x":215.6521739130435,"y":149.40820879202843,"code":"MO","fill":"theme:sequential.6"},{"x":215.6521739130435,"y":124.5068406600237,"code":"MO","fill":"theme:sequential.6"},{"x":194.08695652173915,"y":112.05615659402133,"code":"MO","fill":"theme:sequential.6"},{"x":172.5217391304348,"y":124.5068406600237,"code":"MO","fill":"theme:sequential.6"},{"x":172.5217391304348,"y":149.40820879202843,"code":"MO","fill":"theme:sequential.6"},{"x":237.21739130434784,"y":161.8588928580308,"code":"KY","fill":"theme:sequential.7"},{"x":258.7826086956522,"y":149.40820879202843,"code":"KY","fill":"theme:sequential.7"},{"x":258.7826086956522,"y":124.5068406600237,"code":"KY","fill":"theme:sequential.7"},{"x":237.21739130434784,"y":112.05615659402133,"code":"KY","fill":"theme:sequential.7"},{"x":215.6521739130435,"y":124.5068406600237,"code":"KY","fill":"theme:sequential.7"},{"x":215.6521739130435,"y":149.40820879202843,"code":"KY","fill":"theme:sequential.7"},{"x":280.3478260869566,"y":161.8588928580308,"code":"WV","fill":"theme:sequential.7"},{"x":301.913043478261,"y":149.40820879202843,"code":"WV","fill":"theme:sequential.7"},{"x":301.913043478261,"y":124.5068406600237,"code":"WV","fill":"theme:sequential.7"},{"x":280.3478260869566,"y":112.05615659402133,"code":"WV","fill":"theme:sequential.7"},{"x":258.78260869565224,"y":124.5068406600237,"code":"WV","fill":"theme:sequential.7"},{"x":258.78260869565224,"y":149.40820879202843,"code":"WV","fill":"theme:sequential.7"},{"x":323.4782608695653,"y":161.8588928580308,"code":"VA","fill":"theme:sequential.7"},{"x":345.0434782608697,"y":149.40820879202843,"code":"VA","fill":"theme:sequential.7"},{"x":345.0434782608697,"y":124.5068406600237,"code":"VA","fill":"theme:sequential.7"},{"x":323.4782608695653,"y":112.05615659402133,"code":"VA","fill":"theme:sequential.7"},{"x":301.91304347826093,"y":124.5068406600237,"code":"VA","fill":"theme:sequential.7"},{"x":301.91304347826093,"y":149.40820879202843,"code":"VA","fill":"theme:sequential.7"},{"x":366.608695652174,"y":161.8588928580308,"code":"MD","fill":"theme:sequential.7"},{"x":388.17391304347836,"y":149.40820879202843,"code":"MD","fill":"theme:sequential.7"},{"x":388.17391304347836,"y":124.5068406600237,"code":"MD","fill":"theme:sequential.7"},{"x":366.608695652174,"y":112.05615659402133,"code":"MD","fill":"theme:sequential.7"},{"x":345.0434782608696,"y":124.5068406600237,"code":"MD","fill":"theme:sequential.7"},{"x":345.0434782608696,"y":149.40820879202843,"code":"MD","fill":"theme:sequential.7"},{"x":409.7391304347827,"y":161.8588928580308,"code":"DE","fill":"theme:sequential.5"},{"x":431.30434782608705,"y":149.40820879202843,"code":"DE","fill":"theme:sequential.5"},{"x":431.30434782608705,"y":124.5068406600237,"code":"DE","fill":"theme:sequential.5"},{"x":409.7391304347827,"y":112.05615659402133,"code":"DE","fill":"theme:sequential.5"},{"x":388.1739130434783,"y":124.5068406600237,"code":"DE","fill":"theme:sequential.5"},{"x":388.1739130434783,"y":149.40820879202843,"code":"DE","fill":"theme:sequential.5"},{"x":86.26086956521742,"y":124.5068406600237,"code":"AZ","fill":"theme:sequential.5"},{"x":107.82608695652178,"y":112.05615659402133,"code":"AZ","fill":"theme:sequential.5"},{"x":107.82608695652178,"y":87.1547884620166,"code":"AZ","fill":"theme:sequential.5"},{"x":86.26086956521742,"y":74.70410439601423,"code":"AZ","fill":"theme:sequential.5"},{"x":64.69565217391306,"y":87.1547884620166,"code":"AZ","fill":"theme:sequential.5"},{"x":64.69565217391306,"y":112.05615659402133,"code":"AZ","fill":"theme:sequential.5"},{"x":129.3913043478261,"y":124.5068406600237,"code":"NM","fill":"theme:sequential.5"},{"x":150.95652173913044,"y":112.05615659402133,"code":"NM","fill":"theme:sequential.5"},{"x":150.95652173913044,"y":87.1547884620166,"code":"NM","fill":"theme:sequential.5"},{"x":129.3913043478261,"y":74.70410439601423,"code":"NM","fill":"theme:sequential.5"},{"x":107.82608695652175,"y":87.1547884620166,"code":"NM","fill":"theme:sequential.5"},{"x":107.82608695652176,"y":112.05615659402133,"code":"NM","fill":"theme:sequential.5"},{"x":172.5217391304348,"y":124.5068406600237,"code":"KS","fill":"theme:sequential.5"},{"x":194.08695652173915,"y":112.05615659402133,"code":"KS","fill":"theme:sequential.5"},{"x":194.08695652173915,"y":87.1547884620166,"code":"KS","fill":"theme:sequential.5"},{"x":172.5217391304348,"y":74.70410439601423,"code":"KS","fill":"theme:sequential.5"},{"x":150.95652173913047,"y":87.1547884620166,"code":"KS","fill":"theme:sequential.5"},{"x":150.95652173913047,"y":112.05615659402133,"code":"KS","fill":"theme:sequential.5"},{"x":215.6521739130435,"y":124.5068406600237,"code":"AR","fill":"theme:sequential.6"},{"x":237.21739130434784,"y":112.05615659402133,"code":"AR","fill":"theme:sequential.6"},{"x":237.21739130434784,"y":87.1547884620166,"code":"AR","fill":"theme:sequential.6"},{"x":215.6521739130435,"y":74.70410439601423,"code":"AR","fill":"theme:sequential.6"},{"x":194.08695652173915,"y":87.1547884620166,"code":"AR","fill":"theme:sequential.6"},{"x":194.08695652173915,"y":112.05615659402133,"code":"AR","fill":"theme:sequential.6"},{"x":258.7826086956522,"y":124.5068406600237,"code":"TN","fill":"theme:sequential.6"},{"x":280.34782608695656,"y":112.05615659402133,"code":"TN","fill":"theme:sequential.6"},{"x":280.34782608695656,"y":87.1547884620166,"code":"TN","fill":"theme:sequential.6"},{"x":258.7826086956522,"y":74.70410439601423,"code":"TN","fill":"theme:sequential.6"},{"x":237.21739130434784,"y":87.1547884620166,"code":"TN","fill":"theme:sequential.6"},{"x":237.21739130434784,"y":112.05615659402133,"code":"TN","fill":"theme:sequential.6"},{"x":301.913043478261,"y":124.5068406600237,"code":"NC","fill":"theme:sequential.6"},{"x":323.47826086956536,"y":112.05615659402133,"code":"NC","fill":"theme:sequential.6"},{"x":323.47826086956536,"y":87.1547884620166,"code":"NC","fill":"theme:sequential.6"},{"x":301.913043478261,"y":74.70410439601423,"code":"NC","fill":"theme:sequential.6"},{"x":280.3478260869566,"y":87.1547884620166,"code":"NC","fill":"theme:sequential.6"},{"x":280.3478260869566,"y":112.05615659402133,"code":"NC","fill":"theme:sequential.6"},{"x":345.0434782608697,"y":124.5068406600237,"code":"SC","fill":"theme:sequential.6"},{"x":366.60869565217405,"y":112.05615659402133,"code":"SC","fill":"theme:sequential.6"},{"x":366.60869565217405,"y":87.1547884620166,"code":"SC","fill":"theme:sequential.6"},{"x":345.0434782608697,"y":74.70410439601423,"code":"SC","fill":"theme:sequential.6"},{"x":323.4782608695653,"y":87.1547884620166,"code":"SC","fill":"theme:sequential.6"},{"x":323.4782608695653,"y":112.05615659402133,"code":"SC","fill":"theme:sequential.6"},{"x":388.17391304347836,"y":124.5068406600237,"code":"DC","fill":"theme:sequential.7"},{"x":409.73913043478274,"y":112.05615659402133,"code":"DC","fill":"theme:sequential.7"},{"x":409.73913043478274,"y":87.1547884620166,"code":"DC","fill":"theme:sequential.7"},{"x":388.17391304347836,"y":74.70410439601423,"code":"DC","fill":"theme:sequential.7"},{"x":366.608695652174,"y":87.1547884620166,"code":"DC","fill":"theme:sequential.7"},{"x":366.608695652174,"y":112.05615659402133,"code":"DC","fill":"theme:sequential.7"},{"x":64.69565217391306,"y":87.1547884620166,"code":"OK","fill":"theme:sequential.7"},{"x":86.26086956521742,"y":74.70410439601423,"code":"OK","fill":"theme:sequential.7"},{"x":86.26086956521742,"y":49.802736264009496,"code":"OK","fill":"theme:sequential.7"},{"x":64.69565217391306,"y":37.35205219800713,"code":"OK","fill":"theme:sequential.7"},{"x":43.1304347826087,"y":49.802736264009496,"code":"OK","fill":"theme:sequential.7"},{"x":43.1304347826087,"y":74.70410439601423,"code":"OK","fill":"theme:sequential.7"},{"x":107.82608695652176,"y":87.1547884620166,"code":"LA","fill":"theme:sequential.7"},{"x":129.39130434782612,"y":74.70410439601423,"code":"LA","fill":"theme:sequential.7"},{"x":129.39130434782612,"y":49.802736264009496,"code":"LA","fill":"theme:sequential.7"},{"x":107.82608695652176,"y":37.35205219800713,"code":"LA","fill":"theme:sequential.7"},{"x":86.2608695652174,"y":49.802736264009496,"code":"LA","fill":"theme:sequential.7"},{"x":86.26086956521742,"y":74.70410439601423,"code":"LA","fill":"theme:sequential.7"},{"x":150.95652173913047,"y":87.1547884620166,"code":"MS","fill":"theme:sequential.7"},{"x":172.5217391304348,"y":74.70410439601423,"code":"MS","fill":"theme:sequential.7"},{"x":172.5217391304348,"y":49.802736264009496,"code":"MS","fill":"theme:sequential.7"},{"x":150.95652173913047,"y":37.35205219800713,"code":"MS","fill":"theme:sequential.7"},{"x":129.39130434782612,"y":49.802736264009496,"code":"MS","fill":"theme:sequential.7"},{"x":129.39130434782612,"y":74.70410439601423,"code":"MS","fill":"theme:sequential.7"},{"x":194.08695652173915,"y":87.1547884620166,"code":"AL","fill":"theme:sequential.5"},{"x":215.6521739130435,"y":74.70410439601423,"code":"AL","fill":"theme:sequential.5"},{"x":215.6521739130435,"y":49.802736264009496,"code":"AL","fill":"theme:sequential.5"},{"x":194.08695652173915,"y":37.35205219800713,"code":"AL","fill":"theme:sequential.5"},{"x":172.5217391304348,"y":49.802736264009496,"code":"AL","fill":"theme:sequential.5"},{"x":172.5217391304348,"y":74.70410439601423,"code":"AL","fill":"theme:sequential.5"},{"x":237.21739130434784,"y":87.1547884620166,"code":"GA","fill":"theme:sequential.5"},{"x":258.7826086956522,"y":74.70410439601423,"code":"GA","fill":"theme:sequential.5"},{"x":258.7826086956522,"y":49.802736264009496,"code":"GA","fill":"theme:sequential.5"},{"x":237.21739130434784,"y":37.35205219800713,"code":"GA","fill":"theme:sequential.5"},{"x":215.6521739130435,"y":49.802736264009496,"code":"GA","fill":"theme:sequential.5"},{"x":215.6521739130435,"y":74.70410439601423,"code":"GA","fill":"theme:sequential.5"},{"x":43.1304347826087,"y":49.80273626400947,"code":"HI","fill":"theme:sequential.5"},{"x":64.69565217391306,"y":37.3520521980071,"code":"HI","fill":"theme:sequential.5"},{"x":64.69565217391306,"y":12.450684066002395,"code":"HI","fill":"theme:sequential.5"},{"x":43.1304347826087,"y":0,"code":"HI","fill":"theme:sequential.5"},{"x":21.56521739130435,"y":12.450684066002395,"code":"HI","fill":"theme:sequential.5"},{"x":21.565217391304355,"y":37.3520521980071,"code":"HI","fill":"theme:sequential.5"},{"x":86.26086956521742,"y":49.80273626400947,"code":"TX","fill":"theme:sequential.6"},{"x":107.82608695652178,"y":37.3520521980071,"code":"TX","fill":"theme:sequential.6"},{"x":107.82608695652178,"y":12.450684066002395,"code":"TX","fill":"theme:sequential.6"},{"x":86.26086956521742,"y":0,"code":"TX","fill":"theme:sequential.6"},{"x":64.69565217391306,"y":12.450684066002395,"code":"TX","fill":"theme:sequential.6"},{"x":64.69565217391306,"y":37.3520521980071,"code":"TX","fill":"theme:sequential.6"},{"x":388.17391304347836,"y":49.80273626400947,"code":"FL","fill":"theme:sequential.6"},{"x":409.73913043478274,"y":37.3520521980071,"code":"FL","fill":"theme:sequential.6"},{"x":409.73913043478274,"y":12.450684066002395,"code":"FL","fill":"theme:sequential.6"},{"x":388.17391304347836,"y":0,"code":"FL","fill":"theme:sequential.6"},{"x":366.608695652174,"y":12.450684066002395,"code":"FL","fill":"theme:sequential.6"},{"x":366.608695652174,"y":37.3520521980071,"code":"FL","fill":"theme:sequential.6"}],"x":"x","y":"y","z":"code","fill":"fill","stroke":"theme:background","strokeWidth":1,"curve":"linear-closed"},{"type":"text","data":[{"x":21.56521739130436,"y":289.36573351805447,"text":"AK"},{"x":452.86956521739137,"y":289.36573351805447,"text":"ME"},{"x":431.3043478260871,"y":252.01368132004737,"text":"VT"},{"x":474.43478260869574,"y":252.01368132004737,"text":"NH"},{"x":21.56521739130436,"y":214.66162912204027,"text":"WA"},{"x":64.69565217391306,"y":214.66162912204027,"text":"ID"},{"x":107.82608695652176,"y":214.66162912204027,"text":"MT"},{"x":150.95652173913047,"y":214.66162912204027,"text":"ND"},{"x":194.08695652173915,"y":214.66162912204027,"text":"MN"},{"x":237.21739130434784,"y":214.66162912204027,"text":"IL"},{"x":280.3478260869567,"y":214.66162912204027,"text":"WI"},{"x":323.4782608695653,"y":214.66162912204027,"text":"MI"},{"x":366.608695652174,"y":214.66162912204027,"text":"NY"},{"x":409.7391304347826,"y":214.66162912204027,"text":"MA"},{"x":452.86956521739137,"y":214.66162912204027,"text":"RI"},{"x":43.1304347826087,"y":177.30957692403317,"text":"OR"},{"x":86.26086956521742,"y":177.30957692403317,"text":"NV"},{"x":129.3913043478261,"y":177.30957692403317,"text":"WY"},{"x":172.52173913043478,"y":177.30957692403317,"text":"SD"},{"x":215.65217391304353,"y":177.30957692403317,"text":"IA"},{"x":258.7826086956522,"y":177.30957692403317,"text":"IN"},{"x":301.913043478261,"y":177.30957692403317,"text":"OH"},{"x":345.0434782608696,"y":177.30957692403317,"text":"PA"},{"x":388.1739130434784,"y":177.30957692403317,"text":"NJ"},{"x":431.3043478260871,"y":177.30957692403317,"text":"CT"},{"x":21.56521739130436,"y":139.95752472602607,"text":"CA"},{"x":64.69565217391306,"y":139.95752472602607,"text":"UT"},{"x":107.82608695652176,"y":139.95752472602607,"text":"CO"},{"x":150.95652173913047,"y":139.95752472602607,"text":"NE"},{"x":194.08695652173915,"y":139.95752472602607,"text":"MO"},{"x":237.21739130434784,"y":139.95752472602607,"text":"KY"},{"x":280.3478260869567,"y":139.95752472602607,"text":"WV"},{"x":323.4782608695653,"y":139.95752472602607,"text":"VA"},{"x":366.608695652174,"y":139.95752472602607,"text":"MD"},{"x":409.7391304347826,"y":139.95752472602607,"text":"DE"},{"x":86.26086956521742,"y":102.60547252801896,"text":"AZ"},{"x":129.3913043478261,"y":102.60547252801896,"text":"NM"},{"x":172.52173913043478,"y":102.60547252801896,"text":"KS"},{"x":215.65217391304353,"y":102.60547252801896,"text":"AR"},{"x":258.7826086956522,"y":102.60547252801896,"text":"TN"},{"x":301.913043478261,"y":102.60547252801896,"text":"NC"},{"x":345.0434782608696,"y":102.60547252801896,"text":"SC"},{"x":388.1739130434784,"y":102.60547252801896,"text":"DC"},{"x":64.69565217391306,"y":65.25342033001186,"text":"OK"},{"x":107.82608695652176,"y":65.25342033001186,"text":"LA"},{"x":150.95652173913047,"y":65.25342033001186,"text":"MS"},{"x":194.08695652173915,"y":65.25342033001186,"text":"AL"},{"x":237.21739130434784,"y":65.25342033001186,"text":"GA"},{"x":43.1304347826087,"y":27.901368132004734,"text":"HI"},{"x":86.26086956521742,"y":27.901368132004734,"text":"TX"},{"x":388.1739130434784,"y":27.901368132004734,"text":"FL"}],"x":"x","y":"y","text":"text","textAnchor":"middle","fill":"theme:background","fontWeight":600,"fontSize":15},{"type":"rect","data":[{"x1":518.0000000000001,"x2":538.0000000000001,"y1":238.57703640255033,"y2":285.2671016500592}],"x1":"x1","x2":"x2","y1":"y1","y2":"y2","fill":"theme:sequential.5","stroke":"theme:background","strokeWidth":0.5},{"type":"rect","data":[{"x1":518.0000000000001,"x2":538.0000000000001,"y1":191.88697115504146,"y2":238.57703640255033}],"x1":"x1","x2":"x2","y1":"y1","y2":"y2","fill":"theme:sequential.6","stroke":"theme:background","strokeWidth":0.5},{"type":"rect","data":[{"x1":518.0000000000001,"x2":538.0000000000001,"y1":145.19690590753257,"y2":191.88697115504146}],"x1":"x1","x2":"x2","y1":"y1","y2":"y2","fill":"theme:sequential.7","stroke":"theme:background","strokeWidth":0.5},{"type":"text","data":[{"x":544.0000000000001,"y":285.2671016500592,"text":"95"}],"x":"x","y":"y","text":"text","textAnchor":"start","fill":"theme:muted","fontSize":12},{"type":"text","data":[{"x":544.0000000000001,"y":215.2320037787959,"text":"79"}],"x":"x","y":"y","text":"text","textAnchor":"start","fill":"theme:muted","fontSize":12},{"type":"text","data":[{"x":544.0000000000001,"y":145.19690590753257,"text":"62"}],"x":"x","y":"y","text":"text","textAnchor":"start","fill":"theme:muted","fontSize":12},{"type":"text","data":[{"x":518.0000000000001,"y":301.2671016500592,"text":"Adults online"}],"x":"x","y":"y","text":"text","textAnchor":"start","fill":"theme:text","fontSize":13,"fontWeight":600}]}
```

### Europe tile cartogram — `cartogram_eu_tile` (plot)

Compare a value across European countries as equal tiles: the 27 EU members plus the UK, Switzerland, Norway, Iceland and Ukraine. **Avoid:** A world comparison: use the world choropleth.

Row shape (2 of 32 rows): `[{"iso3":"ISL","country":"Iceland","index_points":10},{"iso3":"NOR","country":"Norway","index_points":39}]`

```json
{"width":684,"height":468,"marginTop":10,"marginRight":10,"marginBottom":10,"marginLeft":10,"x":{"domain":[0,664],"axis":null},"y":{"domain":[0,448],"axis":null},"marks":[{"type":"rect","data":[{"x1":113.5,"x2":166.5,"y1":393.5,"y2":446.5,"fill":"theme:sequential.5"},{"x1":169.5,"x2":222.5,"y1":337.5,"y2":390.5,"fill":"theme:sequential.6"},{"x1":281.5,"x2":334.5,"y1":337.5,"y2":390.5,"fill":"theme:sequential.7"},{"x1":393.5,"x2":446.5,"y1":337.5,"y2":390.5,"fill":"theme:sequential.5"},{"x1":449.5,"x2":502.5,"y1":337.5,"y2":390.5,"fill":"theme:sequential.6"},{"x1":57.5,"x2":110.5,"y1":281.5,"y2":334.5,"fill":"theme:sequential.7"},{"x1":113.5,"x2":166.5,"y1":281.5,"y2":334.5,"fill":"theme:sequential.5"},{"x1":281.5,"x2":334.5,"y1":281.5,"y2":334.5,"fill":"theme:sequential.6"},{"x1":449.5,"x2":502.5,"y1":281.5,"y2":334.5,"fill":"theme:sequential.7"},{"x1":1.5,"x2":54.5,"y1":225.5,"y2":278.5,"fill":"theme:sequential.5"},{"x1":57.5,"x2":110.5,"y1":225.5,"y2":278.5,"fill":"theme:sequential.6"},{"x1":169.5,"x2":222.5,"y1":225.5,"y2":278.5,"fill":"theme:sequential.7"},{"x1":225.5,"x2":278.5,"y1":225.5,"y2":278.5,"fill":"theme:sequential.5"},{"x1":281.5,"x2":334.5,"y1":225.5,"y2":278.5,"fill":"theme:sequential.7"},{"x1":337.5,"x2":390.5,"y1":225.5,"y2":278.5,"fill":"theme:sequential.5"},{"x1":393.5,"x2":446.5,"y1":225.5,"y2":278.5,"fill":"theme:sequential.6"},{"x1":449.5,"x2":502.5,"y1":225.5,"y2":278.5,"fill":"theme:sequential.7"},{"x1":169.5,"x2":222.5,"y1":169.5,"y2":222.5,"fill":"theme:sequential.5"},{"x1":225.5,"x2":278.5,"y1":169.5,"y2":222.5,"fill":"theme:sequential.6"},{"x1":281.5,"x2":334.5,"y1":169.5,"y2":222.5,"fill":"theme:sequential.7"},{"x1":337.5,"x2":390.5,"y1":169.5,"y2":222.5,"fill":"theme:sequential.5"},{"x1":393.5,"x2":446.5,"y1":169.5,"y2":222.5,"fill":"theme:sequential.6"},{"x1":449.5,"x2":502.5,"y1":169.5,"y2":222.5,"fill":"theme:sequential.7"},{"x1":169.5,"x2":222.5,"y1":113.5,"y2":166.5,"fill":"theme:sequential.5"},{"x1":281.5,"x2":334.5,"y1":113.5,"y2":166.5,"fill":"theme:sequential.6"},{"x1":337.5,"x2":390.5,"y1":113.5,"y2":166.5,"fill":"theme:sequential.7"},{"x1":449.5,"x2":502.5,"y1":113.5,"y2":166.5,"fill":"theme:sequential.5"},{"x1":505.5,"x2":558.5,"y1":113.5,"y2":166.5,"fill":"theme:sequential.7"},{"x1":113.5,"x2":166.5,"y1":57.5,"y2":110.5,"fill":"theme:sequential.5"},{"x1":337.5,"x2":390.5,"y1":57.5,"y2":110.5,"fill":"theme:sequential.6"},{"x1":393.5,"x2":446.5,"y1":57.5,"y2":110.5,"fill":"theme:sequential.7"},{"x1":449.5,"x2":502.5,"y1":1.5,"y2":54.5,"fill":"theme:sequential.5"}],"x1":"x1","x2":"x2","y1":"y1","y2":"y2","fill":"fill","stroke":"theme:background","strokeWidth":1},{"type":"text","data":[{"x":140,"y":425,"text":"IS"},{"x":196,"y":369,"text":"NO"},{"x":308,"y":369,"text":"SE"},{"x":420,"y":369,"text":"FI"},{"x":476,"y":369,"text":"EE"},{"x":84,"y":313,"text":"IE"},{"x":140,"y":313,"text":"GB"},{"x":308,"y":313,"text":"DK"},{"x":476,"y":313,"text":"LV"},{"x":28,"y":257,"text":"PT"},{"x":84,"y":257,"text":"ES"},{"x":196,"y":257,"text":"FR"},{"x":252,"y":257,"text":"BE"},{"x":308,"y":257,"text":"NL"},{"x":364,"y":257,"text":"DE"},{"x":420,"y":257,"text":"PL"},{"x":476,"y":257,"text":"LT"},{"x":196,"y":201,"text":"CH"},{"x":252,"y":201,"text":"LU"},{"x":308,"y":201,"text":"AT"},{"x":364,"y":201,"text":"CZ"},{"x":420,"y":201,"text":"SK"},{"x":476,"y":201,"text":"HU"},{"x":196,"y":145,"text":"IT"},{"x":308,"y":145,"text":"SI"},{"x":364,"y":145,"text":"HR"},{"x":476,"y":145,"text":"RO"},{"x":532,"y":145,"text":"UA"},{"x":140,"y":89,"text":"MT"},{"x":364,"y":89,"text":"GR"},{"x":420,"y":89,"text":"BG"},{"x":476,"y":33,"text":"CY"}],"x":"x","y":"y","text":"text","textAnchor":"middle","fill":"theme:background","fontWeight":600,"fontSize":18},{"type":"rect","data":[{"x1":582,"x2":602,"y1":372,"y2":422}],"x1":"x1","x2":"x2","y1":"y1","y2":"y2","fill":"theme:sequential.5","stroke":"theme:background","strokeWidth":0.5},{"type":"rect","data":[{"x1":582,"x2":602,"y1":322,"y2":372}],"x1":"x1","x2":"x2","y1":"y1","y2":"y2","fill":"theme:sequential.6","stroke":"theme:background","strokeWidth":0.5},{"type":"rect","data":[{"x1":582,"x2":602,"y1":272,"y2":322}],"x1":"x1","x2":"x2","y1":"y1","y2":"y2","fill":"theme:sequential.7","stroke":"theme:background","strokeWidth":0.5},{"type":"text","data":[{"x":608,"y":422,"text":"87"}],"x":"x","y":"y","text":"text","textAnchor":"start","fill":"theme:muted","fontSize":12},{"type":"text","data":[{"x":608,"y":347,"text":"49"}],"x":"x","y":"y","text":"text","textAnchor":"start","fill":"theme:muted","fontSize":12},{"type":"text","data":[{"x":608,"y":272,"text":"10"}],"x":"x","y":"y","text":"text","textAnchor":"start","fill":"theme:muted","fontSize":12},{"type":"text","data":[{"x":582,"y":438,"text":"Index"}],"x":"x","y":"y","text":"text","textAnchor":"start","fill":"theme:text","fontSize":13,"fontWeight":600}]}
```

### Geodesic flow map — `flow_map` (plot)

Volumes moving between places as great-circle arcs over a world land base. **Avoid:** One-way stage volumes with no geography: use a Sankey.

Row shape (2 of 6 rows): `[{"originLat":40.7,"originLon":-74,"destLat":51.5,"destLon":-0.1,"value":9,"label":"New York"},{"originLat":40.7,"originLon":-74,"destLat":25.2,"destLon":55.3,"value":4,"label":"New York"}]`

```json
{"width":640,"height":360,"projection":"equal-earth","marginTop":10,"marginRight":14,"marginBottom":20,"marginLeft":14,"marks":[{"type":"sphere","fill":"none","stroke":"theme:grid","strokeWidth":1},{"type":"graticule","stroke":"theme:grid","strokeWidth":0.5,"strokeOpacity":0.7},{"type":"geo","atlas":"world-land-110m","fill":"theme:grid","stroke":"theme:background","strokeWidth":0.4},{"type":"lineY","data":[{"lon":-74,"lat":40.70000000000001,"flow":"0-0","weight":1.4000000000000001},{"lon":-72.36580735381656,"lat":41.6697730815719,"flow":"0-0","weight":1.6058359946920775},{"lon":-70.68225214051381,"lat":42.615696233447856,"flow":"0-0","weight":1.8096896762338692},{"lon":-68.94747409598855,"lat":43.53621731292258,"flow":"0-0","weight":2.0095978222343707},{"lon":-67.15971630020967,"lat":44.4297052849283,"flow":"0-0","weight":2.2036352079666885},{"lon":-65.31736268193606,"lat":45.29445148979314,"flow":"0-0","weight":2.3899331473345953},{"lon":-63.41898069757593,"lat":46.12867243541418,"flow":"0-0","weight":2.5666974893411645},{"lon":-61.463369099393496,"lat":46.93051440142021,"flow":"0-0","weight":2.732225896743656},{"lon":-59.449610433532406,"lat":47.698060151971994,"flow":"0-0","weight":2.88492424049175},{"lon":-57.37712755963165,"lat":48.42933804889765,"flow":"0-0","weight":3.023321952061748},{"lon":-55.245743062562966,"lat":49.12233383295694,"flow":"0-0","weight":3.146086185835345},{"lon":-53.05573994349232,"lat":49.77500529308583,"flow":"0-0","weight":3.252034655131545},{"lon":-50.80792145457761,"lat":50.38529996683816,"flow":"0-0","weight":3.3401470182737025},{"lon":-48.50366741614496,"lat":50.95117590651834,"flow":"0-0","weight":3.4095747050376386},{"lon":-46.14498387959538,"lat":51.47062540357631,"flow":"0-0","weight":3.459649088846784},{"lon":-43.734542640060646,"lat":51.94170139100596,"flow":"0-0","weight":3.489887926011613},{"lon":-41.27570693556997,"lat":52.36254604648877,"flow":"0-0","weight":3.5},{"lon":-38.772539770033816,"lat":52.73142090971399,"flow":"0-0","weight":3.4898879260116136},{"lon":-36.2297917289624,"lat":53.04673762268783,"flow":"0-0","weight":3.459649088846784},{"lon":-33.6528659549983,"lat":53.307088223117205,"flow":"0-0","weight":3.4095747050376386},{"lon":-31.04775910784278,"lat":53.511273791470636,"flow":"0-0","weight":3.3401470182737025},{"lon":-28.420978589307335,"lat":53.65833019446115,"flow":"0-0","weight":3.2520346551315455},{"lon":-25.77943795231843,"lat":53.747549699101455,"flow":"0-0","weight":3.1460861858353453},{"lon":-23.130334068762007,"lat":53.77849736125036,"flow":"0-0","weight":3.023321952061748},{"lon":-20.481011114518722,"lat":53.751021318368075,"flow":"0-0","weight":2.88492424049175},{"lon":-17.838817553734028,"lat":53.66525642307175,"flow":"0-0","weight":2.732225896743656},{"lon":-15.210962917791502,"lat":53.521621015543765,"flow":"0-0","weight":2.5666974893411645},{"lon":-12.604381192616403,"lat":53.32080701425606,"flow":"0-0","weight":2.3899331473345957},{"lon":-10.025607048284705,"lat":53.063763868146104,"flow":"0-0","weight":2.2036352079666885},{"lon":-7.480670047870993,"lat":52.751677224340305,"flow":"0-0","weight":2.009597822234371},{"lon":-4.9750105053622775,"lat":52.385943396680645,"flow":"0-0","weight":1.8096896762338701},{"lon":-2.5134190112149373,"lat":51.96814085597609,"flow":"0-0","weight":1.6058359946920777},{"lon":-0.10000000000002272,"lat":51.5,"flow":"0-0","weight":1.4000000000000004},{"lon":-74,"lat":40.70000000000001,"flow":"1-0","weight":0.7142857142857143},{"lon":-71.00790784510826,"lat":42.84445558667652,"flow":"1-0","weight":0.8193040789245292},{"lon":-67.80496147665473,"lat":44.905479800501126,"flow":"1-0","weight":0.9233110593029945},{"lon":-64.36959195042468,"lat":46.87042908243734,"flow":"1-0","weight":1.0253050113440667},{"lon":-60.680802501625095,"lat":48.72494868990987,"flow":"1-0","weight":1.1243036775340247},{"lon":-56.719656010324876,"lat":50.45292004563818,"flow":"1-0","weight":1.2193536465992831},{"lon":-52.47135520552049,"lat":52.036531866798086,"flow":"1-0","weight":1.3095395353781452},{"lon":-47.927932669474295,"lat":53.45653994826807,"flow":"1-0","weight":1.3939928044610488},{"lon":-43.09141232689233,"lat":54.69278518176284,"flow":"1-0","weight":1.4719001226998722},{"lon":-37.977059999317085,"lat":55.72502496960235,"flow":"1-0","weight":1.542511200031504},{"lon":-32.61604711492596,"lat":56.53408804428729,"flow":"1-0","weight":1.6051460131812985},{"lon":-27.056625997029048,"lat":57.10328193927203,"flow":"1-0","weight":1.6592013546589515},{"lon":-21.362940931782585,"lat":57.41987892533878,"flow":"1-0","weight":1.7041566419763785},{"lon":-15.611031459062096,"lat":57.476417625920035,"flow":"1-0","weight":1.7395789311416523},{"lon":-9.882390583726277,"lat":57.271535477171625,"flow":"1-0","weight":1.7651270861463182},{"lon":-4.256310226664429,"lat":56.81012635757252,"flow":"1-0","weight":1.7805550642916392},{"lon":1.1972770880271089,"lat":56.10278251496923,"flow":"1-0","weight":1.7857142857142856},{"lon":6.422949660603056,"lat":55.164662769537344,"flow":"1-0","weight":1.7805550642916395},{"lon":11.382184231521565,"lat":54.014050545300115,"flow":"1-0","weight":1.7651270861463182},{"lon":16.053109117666022,"lat":52.67088506055815,"flow":"1-0","weight":1.7395789311416523},{"lon":20.42836608315421,"lat":51.15548290485507,"flow":"1-0","weight":1.7041566419763785},{"lon":24.512013629124883,"lat":49.48756427277462,"flow":"1-0","weight":1.6592013546589517},{"lon":28.31626319361584,"lat":47.685604570254554,"flow":"1-0","weight":1.6051460131812985},{"lon":31.858556229276118,"lat":45.76647140063237,"flow":"1-0","weight":1.542511200031504},{"lon":35.159215776108056,"lat":43.74528051195828,"flow":"1-0","weight":1.4719001226998722},{"lon":38.239711557990915,"lat":41.63540221042249,"flow":"1-0","weight":1.3939928044610488},{"lon":41.12147034518303,"lat":39.44856034727441,"flow":"1-0","weight":1.3095395353781452},{"lon":43.82512163008052,"lat":37.194980602368,"flow":"1-0","weight":1.2193536465992834},{"lon":46.370065963287345,"lat":34.883558578508755,"flow":"1-0","weight":1.1243036775340247},{"lon":48.774268917786685,"lat":32.52202923633498,"flow":"1-0","weight":1.025305011344067},{"lon":51.0542048390626,"lat":30.117127146232985,"flow":"1-0","weight":0.9233110593029948},{"lon":53.22489480542169,"lat":27.67473235434256,"flow":"1-0","weight":0.8193040789245294},{"lon":55.299999999999955,"lat":25.199999999999996,"flow":"1-0","weight":0.7142857142857144},{"lon":139.70000000000005,"lat":35.7,"flow":"2-0","weight":0.9885714285714287},{"lon":138.26074598161722,"lat":34.776990587509125,"flow":"2-0","weight":1.1339168452315487},{"lon":136.85361915111835,"lat":33.837420435767484,"flow":"2-0","weight":1.2778625060753446},{"lon":135.47734575455615,"lat":32.88221644512805,"flow":"2-0","weight":1.4190221357001884},{"lon":134.1306468846078,"lat":31.912263234068675,"flow":"2-0","weight":1.5560362897070905},{"lon":132.81224595528246,"lat":30.92840449240224,"flow":"2-0","weight":1.6875854468934082},{"lon":131.52087490220825,"lat":29.93144449301945,"flow":"2-0","weight":1.812402716963353},{"lon":130.2552792453779,"lat":28.92214971844252,"flow":"2-0","weight":1.9292860413740915},{"lon":129.01422214520233,"lat":27.901250565333022,"flow":"2-0","weight":2.0371097698166234},{"lon":127.79648757464574,"lat":26.86944309627043,"flow":"2-0","weight":2.1348355008436015},{"lon":126.60088272089442,"lat":25.827390813593436,"flow":"2-0","weight":2.221522082242917},{"lon":125.42623972007055,"lat":24.775726434897383,"flow":"2-0","weight":2.2963346748479894},{"lon":124.27141681840926,"lat":23.715053653945933,"flow":"2-0","weight":2.3585527924953085},{"lon":123.13529904340595,"lat":22.645948874334,"flow":"2-0","weight":2.407577240700047},{"lon":122.01679845895725,"lat":21.56896290628691,"flow":"2-0","weight":2.4429358872265046},{"lon":120.91485406960872,"lat":20.48462261955447,"flow":"2-0","weight":2.464288208979629},{"lon":119.82843143078291,"lat":19.393432547514752,"flow":"2-0","weight":2.4714285714285715},{"lon":118.75652201433448,"lat":18.29587643939349,"flow":"2-0","weight":2.4642882089796294},{"lon":117.69814237197407,"lat":17.19241875898158,"flow":"2-0","weight":2.4429358872265046},{"lon":116.65233313300546,"lat":16.083506129439698,"flow":"2-0","weight":2.407577240700047},{"lon":115.6181578673982,"lat":14.96956872475653,"flow":"2-0","weight":2.3585527924953085},{"lon":114.59470184042833,"lat":13.85102160921173,"flow":"2-0","weight":2.2963346748479894},{"lon":113.581070680915,"lat":12.72826602681811,"flow":"2-0","weight":2.2215220822429176},{"lon":112.57638898140941,"lat":11.601690643206647,"flow":"2-0","weight":2.1348355008436015},{"lon":111.57979884550397,"lat":10.471672742797686,"flow":"2-0","weight":2.0371097698166234},{"lon":110.59045839467566,"lat":9.338579384391613,"flow":"2-0","weight":1.9292860413740915},{"lon":109.6075402447103,"lat":8.202768518529872,"flow":"2-0","weight":1.812402716963353},{"lon":108.63022995973284,"lat":7.064590070137433,"flow":"2-0","weight":1.6875854468934084},{"lon":107.6577244901538,"lat":5.924386990072989,"flow":"2-0","weight":1.5560362897070905},{"lon":106.68923059939792,"lat":4.782496279293151,"flow":"2-0","weight":1.4190221357001886},{"lon":105.72396328308044,"lat":3.639249989390853,"flow":"2-0","weight":1.277862506075345},{"lon":104.76114418330926,"lat":2.4949762033026075,"flow":"2-0","weight":1.133916845231549},{"lon":103.79999999999995,"lat":1.35,"flow":"2-0","weight":0.9885714285714288},{"lon":-0.10000000000002272,"lat":51.5,"flow":"3-0","weight":0.5771428571428572},{"lon":6.941100295932553,"lat":53.625759662425764,"flow":"3-0","weight":0.6619976957710196},{"lon":14.64400849669662,"lat":55.297698028174345,"flow":"3-0","weight":0.7460353359168196},{"lon":22.91298666460555,"lat":56.44673337711749,"flow":"3-0","weight":0.8284464491660058},{"lon":31.563451967314986,"lat":57.01739518269856,"flow":"3-0","weight":0.908437371447492},{"lon":40.33822829943997,"lat":56.97931227220799,"flow":"3-0","weight":0.9852377464522208},{"lon":48.954169036983714,"lat":56.33457447079936,"flow":"3-0","weight":1.0581079445855412},{"lon":57.1611060836517,"lat":55.11720146126405,"flow":"3-0","weight":1.1263461860045274},{"lon":64.78527245581051,"lat":53.38500719099981,"flow":"3-0","weight":1.189295299141497},{"lon":71.74158635002061,"lat":51.20795083700261,"flow":"3-0","weight":1.2463490496254552},{"lon":78.01976287915073,"lat":48.657591885575286,"flow":"3-0","weight":1.2969579786504892},{"lon":83.65937028465049,"lat":45.800108410376104,"flow":"3-0","weight":1.340634694564433},{"lon":88.72622282931341,"lat":42.69297880190281,"flow":"3-0","weight":1.376958566716914},{"lon":93.29541604112656,"lat":39.38426025021348,"flow":"3-0","weight":1.4055797763624551},{"lon":97.44122888954941,"lat":35.913287552813586,"flow":"3-0","weight":1.4262226856062252},{"lon":101.23212018588964,"lat":32.31194985516588,"flow":"3-0","weight":1.4386884919476446},{"lon":104.72889339411155,"lat":28.60606882783446,"flow":"3-0","weight":1.4428571428571428},{"lon":107.9845944005121,"lat":24.81665858133458,"flow":"3-0","weight":1.4386884919476448},{"lon":111.04524135786366,"lat":20.96099339078402,"flow":"3-0","weight":1.4262226856062252},{"lon":113.95088068363332,"lat":17.053480078156383,"flow":"3-0","weight":1.4055797763624551},{"lon":116.73671168048391,"lat":13.106360672930691,"flow":"3-0","weight":1.376958566716914},{"lon":119.43416465502943,"lat":9.130279092270507,"flow":"3-0","weight":1.340634694564433},{"lon":122.0718939022039,"lat":5.134744847131052,"flow":"3-0","weight":1.2969579786504892},{"lon":124.67668576347391,"lat":1.1285230825757093,"flow":"3-0","weight":1.2463490496254552},{"lon":127.27430056734711,"lat":-2.880023699384345,"flow":"3-0","weight":1.189295299141497},{"lon":129.89027553849917,"lat":-6.882619979909976,"flow":"3-0","weight":1.1263461860045274},{"lon":132.5507189826676,"lat":-10.870767183578819,"flow":"3-0","weight":1.0581079445855412},{"lon":135.28312663681663,"lat":-14.835419218699894,"flow":"3-0","weight":0.9852377464522211},{"lon":138.117249500269,"lat":-18.76662253268261,"flow":"3-0","weight":0.908437371447492},{"lon":141.08603746702704,"lat":-22.653097219063024,"flow":"3-0","weight":0.8284464491660061},{"lon":144.2266711596024,"lat":-26.48173216078377,"flow":"3-0","weight":0.7460353359168199},{"lon":147.58166850417726,"lat":-30.236963143822013,"flow":"3-0","weight":0.6619976957710199},{"lon":151.20000000000007,"lat":-33.9,"flow":"3-0","weight":0.5771428571428573},{"lon":2.5,"lat":49,"flow":"4-0","weight":0.8514285714285714},{"lon":0.14775313590624523,"lat":49.58491643874726,"flow":"4-0","weight":0.9766104620780389},{"lon":-2.2591565625648333,"lat":50.121039728165975,"flow":"4-0","weight":1.1005867826891695},{"lon":-4.717960994549218,"lat":50.606321279828734,"flow":"4-0","weight":1.2221635735221275},{"lon":-7.2251828990875,"lat":51.03881061475621,"flow":"4-0","weight":1.3401699836205576},{"lon":-9.776629364295752,"lat":51.41668760010223,"flow":"4-0","weight":1.4534695467463457},{"lon":-12.367406847558552,"lat":51.738295240775855,"flow":"4-0","weight":1.560971126170749},{"lon":-14.991960019314785,"lat":52.00217185380227,"flow":"4-0","weight":1.6616394229175702},{"lon":-17.644135493301608,"lat":52.20708132037621,"flow":"4-0","weight":1.7545049462582478},{"lon":-20.317269953557247,"lat":52.352040058370314,"flow":"4-0","weight":1.8386733504375528},{"lon":-23.00430046307049,"lat":52.436339404960904,"flow":"4-0","weight":1.9133340477121077},{"lon":-25.697893018958773,"lat":52.45956225359806,"flow":"4-0","weight":1.9777680147534704},{"lon":-28.39058390738204,"lat":52.421593047457584,"flow":"4-0","weight":2.0313547172358435},{"lon":-31.074927302757693,"lat":52.32262057454561,"flow":"4-0","weight":2.0735780859208495},{"lon":-33.74364200126885,"lat":52.16313340722172,"flow":"4-0","weight":2.1040314866864116},{"lon":-36.389750256069114,"lat":51.94390824222288,"flow":"4-0","weight":2.122421636635634},{"lon":-39.006702380015724,"lat":51.6659917850389,"flow":"4-0","weight":2.1285714285714286},{"lon":-41.58848200360172,"lat":51.33067714738202,"flow":"4-0","weight":2.1224216366356345},{"lon":-44.12968845637816,"lat":50.939475960635455,"flow":"4-0","weight":2.1040314866864116},{"lon":-46.625594479593346,"lat":50.49408753664748,"flow":"4-0","weight":2.0735780859208495},{"lon":-49.072179176302846,"lat":49.996366429028996,"flow":"4-0","weight":2.0313547172358435},{"lon":-51.46613759449366,"lat":49.44828967450047,"flow":"4-0","weight":1.9777680147534706},{"lon":-53.804869502565126,"lat":48.85192484503308,"flow":"4-0","weight":1.913334047712108},{"lon":-56.0864506983858,"lat":48.2093998424437,"flow":"4-0","weight":1.8386733504375528},{"lon":-58.3095905924066,"lat":47.52287514318714,"flow":"4-0","weight":1.7545049462582478},{"lon":-60.47357986461671,"lat":46.79451897504773,"flow":"4-0","weight":1.6616394229175702},{"lon":-62.57823178429156,"lat":46.02648569711316,"flow":"4-0","weight":1.560971126170749},{"lon":-64.62382038141861,"lat":45.220897471942706,"flow":"4-0","weight":1.4534695467463459},{"lon":-66.61101814834204,"lat":44.37982917077332,"flow":"4-0","weight":1.3401699836205576},{"lon":-68.54083539765831,"lat":43.5052963407634,"flow":"4-0","weight":1.2221635735221277},{"lon":-70.41456286044637,"lat":42.59924598592752,"flow":"4-0","weight":1.10058678268917},{"lon":-72.23371861383566,"lat":41.6635498665265,"flow":"4-0","weight":0.9766104620780391},{"lon":-74,"lat":40.70000000000001,"flow":"4-0","weight":0.8514285714285715},{"lon":-46.60000000000002,"lat":-23.5,"flow":"5-0","weight":0.44000000000000006},{"lon":-45.30488613471971,"lat":-21.11669675822271,"flow":"5-0","weight":0.5046913126175101},{"lon":-44.05082616311962,"lat":-18.723866929529514,"flow":"5-0","weight":0.5687596125306447},{"lon":-42.83184985731988,"lat":-16.322925905478165,"flow":"5-0","weight":0.6315878869879451},{"lon":-41.642485642770396,"lat":-13.915159984244934,"flow":"5-0","weight":0.6925710653609594},{"lon":-40.477673546256845,"lat":-11.501750025892775,"flow":"5-0","weight":0.7511218463051585},{"lon":-39.332688126882374,"lat":-9.08379194124976,"flow":"5-0","weight":0.8066763537929376},{"lon":-38.20306947244109,"lat":-6.66231469220592,"flow":"5-0","weight":0.8586995675480061},{"lon":-37.08456055231197,"lat":-4.23829637330618,"flow":"5-0","weight":0.9066904755831214},{"lon":-35.97304939299111,"lat":-1.8126788622589756,"flow":"5-0","weight":0.9501868992194066},{"lon":-34.86451468053026,"lat":0.6136185336870763,"flow":"5-0","weight":0.9887699441196799},{"lon":-33.75497349482561,"lat":3.0396860507018384,"flow":"5-0","weight":1.0220680344699142},{"lon":-32.64042994428611,"lat":5.464610701682499,"flow":"5-0","weight":1.0497604914574494},{"lon":-31.516823496472785,"lat":7.887463421731736,"flow":"5-0","weight":1.071580621583258},{"lon":-30.37997579114845,"lat":10.307285773982597,"flow":"5-0","weight":1.0873182850661323},{"lon":-29.22553467670451,"lat":12.72307584567049,"flow":"5-0","weight":1.09682191960365},{"lon":-28.048914128658673,"lat":15.13377293049183,"flow":"5-0","weight":1.1},{"lon":-26.845228589296948,"lat":17.538240542096315,"flow":"5-0","weight":1.0968219196036502},{"lon":-25.609220110559075,"lat":19.9352472324174,"flow":"5-0","weight":1.0873182850661323},{"lon":-24.33517648959338,"lat":22.323444593878985,"flow":"5-0","weight":1.071580621583258},{"lon":-23.016838363263613,"lat":24.70134170170607,"flow":"5-0","weight":1.0497604914574494},{"lon":-21.64729298630297,"lat":27.06727509590257,"flow":"5-0","weight":1.0220680344699145},{"lon":-20.218852181934203,"lat":29.419373205217425,"flow":"5-0","weight":0.9887699441196801},{"lon":-18.72291176864113,"lat":31.755513870200996,"flow":"5-0","weight":0.9501868992194066},{"lon":-17.14978971245092,"lat":34.073273322064104,"flow":"5-0","weight":0.9066904755831214},{"lon":-15.488540468341206,"lat":36.36986461339054,"flow":"5-0","weight":0.8586995675480061},{"lon":-13.726743688409236,"lat":38.642063076546634,"flow":"5-0","weight":0.8066763537929376},{"lon":-11.850267067918951,"lat":40.88611591944852,"flow":"5-0","weight":0.7511218463051587},{"lon":-9.843006183773632,"lat":43.09763259525266,"flow":"5-0","weight":0.6925710653609594},{"lon":-7.686609711678336,"lat":45.27145218917906,"flow":"5-0","weight":0.6315878869879453},{"lon":-5.360207846828616,"lat":47.401483923511904,"flow":"5-0","weight":0.5687596125306449},{"lon":-2.8401772221648667,"lat":49.48051730708325,"flow":"5-0","weight":0.5046913126175102},{"lon":-0.10000000000002272,"lat":51.5,"flow":"5-0","weight":0.4400000000000001}],"x":"lon","y":"lat","z":"flow","stroke":"theme:categorical.0","strokeWidth":"weight","strokeOpacity":0.85,"curve":"linear"},{"type":"dot","data":[{"lon":-74,"lat":40.7,"label":"New York"},{"lon":-0.10000000000002274,"lat":51.5},{"lon":55.299999999999955,"lat":25.2},{"lon":139.70000000000005,"lat":35.7,"label":"Tokyo"},{"lon":103.79999999999995,"lat":1.35},{"lon":151.20000000000005,"lat":-33.9},{"lon":2.5,"lat":49,"label":"Paris"},{"lon":-46.60000000000002,"lat":-23.5,"label":"São Paulo"}],"x":"lon","y":"lat","r":2.6,"fill":"theme:categorical.0","stroke":"theme:background","strokeWidth":0.8}]}
```

## text

### Word cloud — `word_cloud` (vega)

A light overview of frequent terms; never for precise comparison.

Row shape (2 of 20 rows): `[{"text":"delivery","count":96},{"text":"price","count":81}]`

Tested at width 520, height 300.

```json
{"autosize":"pad","data":[{"name":"table"}],"scales":[{"name":"color","type":"ordinal","domain":{"data":"table","field":"text"},"range":"category"}],"marks":[{"type":"text","from":{"data":"table"},"encode":{"enter":{"text":{"field":"text"},"align":{"value":"center"},"baseline":{"value":"middle"},"fill":{"scale":"color","field":"text"}}},"transform":[{"type":"wordcloud","size":[{"signal":"width"},{"signal":"height"}],"text":{"field":"text"},"rotate":{"expr":"datum.count < 20 && length(datum.text) < 6 ? 90 : 0"},"font":"theme:font","fontSize":{"field":"datum.count"},"fontWeight":"600","fontSizeRange":[12,52],"padding":3}]}]}
```

## table

### Publication data table — `data_table` (table)

A ranked list where the reader needs the number and its shape: inline bars, sparklines and signed deltas beside the values. **Avoid:** One measure across many categories: a bar chart compares faster.

Row shape (2 of 4 rows): `[{"region":"North","revenue":1240500,"growth":0.142,"status":"On track","trend":[12,15,11,19,24],"mix":"Enterprise"},{"region":"South","revenue":890400,"growth":-0.031,"status":"At risk","trend":[18,16,14,13,12],"mix":"SMB"}]`

```json
{"title":"Regional revenue, 2026","subtitle":"Growth against last year, with a five-month trend","kicker":"Commercial review","source":"Source: finance close, November 2026","notes":"Growth is year on year; the trend is monthly revenue.","zebra":true,"rowGroupField":"mix","columns":[{"field":"region","label":"Region"},{"field":"revenue","label":"Revenue","spanner":"Money","format":"currency","cell":"bar"},{"field":"growth","label":"Growth","spanner":"Money","format":"percent","cell":"delta"},{"field":"status","label":"Status","spanner":"Delivery","cell":"badge","badgeColors":{"At risk":"theme:negative","Ahead":"theme:positive"}},{"field":"trend","label":"Trend","spanner":"Shape","cell":"sparkline"}],"summaryRow":{"label":"Total","operations":{"revenue":"sum","growth":"mean"}}}
```

### KPI scorecard table — `kpi_table` (table)

An executive scorecard: actual against target with a bullet bar, a sparkline of the run up to it, and a heatmap of shares. **Avoid:** A single KPI: a headline value or a bullet chart is smaller.

Row shape (2 of 4 rows): `[{"team":"Support","csat":91,"csat_target":88,"tickets_share":0.34,"weekly":[82,86,88,90,91]},{"team":"Sales","csat":84,"csat_target":90,"tickets_share":0.21,"weekly":[79,82,83,84,84]}]`

```json
{"title":"Service KPIs, this quarter","subtitle":"Satisfaction against target, tickets and the weekly run","kicker":"Operations review","source":"Source: support platform, week 12","columns":[{"field":"team","label":"Team"},{"field":"csat","label":"CSAT","format":"integer","cell":"bullet","targetField":"csat_target","domain":[70,100]},{"field":"weekly","label":"Last five weeks","cell":"sparkarea"},{"field":"tickets_share","label":"Share of tickets","format":"percent","cell":"heatmap"}],"summaryRow":{"label":"Team mean","operations":{"csat":"mean","tickets_share":"sum"}}}
```

## diagram

### Flowchart — `flowchart` (diagram)

A process with decisions and branches, as boxes and arrows a reader can follow. **Avoid:** Volumes moving between stages: use a Sankey, whose widths carry the amounts.

```json
{"dsl":"flowchart LR\n  A[Invoice received] --> B{Under 500?}\n  B -->|yes| C[Auto-approve]\n  B -->|no| D[Manager review]\n  D --> E{Approved?}\n  E -->|yes| F[Pay run]\n  E -->|no| G[Query raised]\n  G --> A","title":"Invoice triage","kicker":"Finance operations","source":"Process owner: accounts payable"}
```

### Sequence diagram — `sequence_diagram` (diagram)

Who calls whom, in what order: a protocol, an API handshake, a checkout. **Avoid:** State that does not move forward in time: use a state diagram.

```json
{"dsl":"sequenceDiagram\n  participant C as Customer\n  participant S as Shop\n  participant P as Payment provider\n  C->>S: Place order\n  S->>P: Authorise\n  P-->>S: Approved\n  S-->>C: Confirmation\n  P->>S: Settlement","title":"Card payment","subtitle":"Authorisation, then settlement","source":"Protocol: 3-D Secure"}
```

### State diagram — `state_diagram` (diagram)

The states one thing moves through, and the events that move it. **Avoid:** Several actors and their messages: use a sequence diagram.

```json
{"dsl":"stateDiagram-v2\n  [*] --> Trial\n  Trial --> Active : payment\n  Trial --> Expired : no payment\n  Active --> Paused : request\n  Paused --> Active : resume\n  Active --> Cancelled : cancel\n  Cancelled --> [*]\n  Expired --> [*]","title":"Subscription lifecycle","kicker":"Billing","source":"States as at November 2026"}
```

### Entity-relationship diagram — `er_diagram` (diagram)

A schema: entities, their keys and the cardinality between them. **Avoid:** Runtime order of calls: use a sequence diagram.

```json
{"dsl":"erDiagram\n  CUSTOMER {\n    string customer_id PK\n    string email\n  }\n  ORDER {\n    string order_id PK\n    date placed_on\n  }\n  LINE_ITEM {\n    int quantity\n    decimal unit_price\n  }\n  PRODUCT {\n    string sku PK\n    decimal price\n  }\n  CATEGORY {\n    string code PK\n    string name\n  }\n  CUSTOMER ||--o{ ORDER : places\n  ORDER ||--|{ LINE_ITEM : contains\n  PRODUCT ||--o{ LINE_ITEM : appears_in\n  CATEGORY ||--o{ PRODUCT : groups","title":"Orders schema","subtitle":"Five tables across customers, orders and products","source":"Schema version 12"}
```

### Mindmap — `mindmap` (diagram)

A central topic and its branches, for scope or a brainstorm, laid out as a tree. **Avoid:** Values within a hierarchy: a treemap carries the sizes.

```json
{"kind":"mindmap","title":"Charts platform","subtitle":"What the plugin covers","root":{"label":"Charts"},"nodes":[{"id":"render","label":"Rendering"},{"id":"vega","label":"Vega and Vega-Lite","parent":"render"},{"id":"echarts","label":"ECharts","parent":"render"},{"id":"plot","label":"Observable Plot","parent":"render"},{"id":"data","label":"Data"},{"id":"rows","label":"Inline rows","parent":"data"},{"id":"files","label":"Workspace files","parent":"data"},{"id":"out","label":"Output"},{"id":"svg","label":"SVG and PNG","parent":"out"},{"id":"html","label":"Interactive HTML","parent":"out"},{"id":"table","label":"Tables and diagrams","parent":"out"}]}
```

### Org chart — `org_chart` (diagram)

Who reports to whom, with roles under each name. **Avoid:** Team sizes: a treemap shows how many people each team has.

```json
{"kind":"org_chart","title":"Product organisation","subtitle":"Reporting lines, November 2026","groups":[{"id":"eng","label":"Engineering","nodes":["cto","infra"]},{"id":"prod","label":"Product","nodes":["cpo"]}],"nodes":[{"id":"ceo","label":"Dana Reed","subtitle":"Chief Executive"},{"id":"cto","label":"Sam Ortiz","subtitle":"Engineering","parent":"ceo","group":"eng"},{"id":"cpo","label":"Lee Park","subtitle":"Product","parent":"ceo","group":"prod"},{"id":"infra","label":"Ada Chen","subtitle":"Infrastructure","parent":"cto","group":"eng"},{"id":"design","label":"Noah Silva","subtitle":"Design","parent":"cpo","group":"prod"}]}
```

### Fishbone (Ishikawa) — `fishbone` (diagram)

Root causes of one effect, grouped by category, for a review or a post-mortem. **Avoid:** Causes with volumes or order: use a flowchart.

```json
{"kind":"fishbone","title":"Why deliveries slipped","effect":"Late deliveries","kicker":"Post-mortem","causes":[{"category":"People","causes":["Two open roles","Onboarding gap"]},{"category":"Process","causes":["Manual handoffs","No buffer","Late QA"]},{"category":"Systems","causes":["Slow build"]},{"category":"Suppliers","causes":["Single source","Long lead time"]}]}
```
