---
name: charts-cookbook
description: Tested examples for every chart, table, diagram and dashboard the charts tools draw (recipe documents, engine specs, board documents), grouped by purpose. Read before writing a chart document, board or spec by hand.
---

# Charts cookbook

Generated from the plugin's own catalogue and recipe registry. For the 14 standard types, use a typed recipe document through `tools.charts.quick {"document": …}` (first section). Tables use `tools.charts.table`, diagrams use `tools.charts.diagram`, multi-panel dashboards use `tools.charts.board` (last section), and the remaining catalogue types use `tools.charts.render {"spec": …, "data": …}`. Rows shown are a two-row shape example; `tools.charts.catalogue {"id": "…"}` returns the full tested call with every row. Colours written `"theme:…"` (`"theme:positive"`, `"theme:categorical.0"`) follow the active theme.

## Typed recipe documents (recommended for the 14 standard types)

Pass `{"document": …}` to `tools.charts.quick`. Unknown fields fail with their JSON path; repeated groups need `options.aggregate` (default `none` refuses with `AGGREGATION_REQUIRED`); `count` counts rows and takes no measure. The result names the saved `<name>.chart.json` and its `revision`: change its theme, size, title or interactions with `tools.charts.update` (`{"documentPath": "…", "expectedRevision": "sha256:…", "patch": {…}}`), never by editing the spec or redrawing from CSV.

### Bar chart — recipe `bar`

Compare one value across categories. One row per category, or set options.aggregate to combine repeated categories. The value is a number.

- Bindings: `category` (required), `value` (required unless `aggregate` is `count`).
- Options: `aggregate` `none` / `sum` / `mean` / `median` / `min` / `max` / `count` (default none); `sort` `input` / `category-ascending` / `category-descending` / `value-ascending` / `value-descending` (default input); `xTitle`; `yTitle`.
- Interactions beyond the defaults: none (tooltip auto or off only).

Rows shown: 2 of 5, a shape example. `tools.charts.catalogue {"id": "bar"}` returns this document with every row, as `recipe.examples[0].call`.

```json
{"version":1,"chart":{"kind":"recipe","recipe":"bar","data":{"rows":[{"product":"Lattes","revenue_eur":182400},{"product":"Pastries","revenue_eur":96300}]},"bindings":{"category":"product","value":"revenue_eur"},"options":{"sort":"value-descending","yTitle":"Revenue (€)"}},"title":"Revenue by product, 2024","currency":"EUR"}
```

### Horizontal bar — recipe `horizontal_bar`

Rank many categories, or long category names, on horizontal bars. One row per category, or set options.aggregate to combine repeated categories. The value is a number.

- Bindings: `category` (required), `value` (required unless `aggregate` is `count`).
- Options: `aggregate` `none` / `sum` / `mean` / `median` / `min` / `max` / `count` (default none); `sort` `input` / `category-ascending` / `category-descending` / `value-ascending` / `value-descending` (default input); `xTitle`; `yTitle`.
- Interactions beyond the defaults: none (tooltip auto or off only).

Rows shown: 2 of 12, a shape example. `tools.charts.catalogue {"id": "horizontal_bar"}` returns this document with every row, as `recipe.examples[0].call`.

```json
{"version":1,"chart":{"kind":"recipe","recipe":"horizontal_bar","data":{"rows":[{"country":"Germany","users_k":820},{"country":"France","users_k":796}]},"bindings":{"category":"country","value":"users_k"},"options":{"sort":"value-descending","xTitle":"Active users (thousands)"}},"title":"Active users by country"}
```

### Grouped bar — recipe `grouped_bar`

Compare series side by side within each category. One row per category and series, or set options.aggregate. The value is a number.

- Bindings: `category` (required), `series` (required), `value` (required unless `aggregate` is `count`).
- Options: `aggregate` `none` / `sum` / `mean` / `median` / `min` / `max` / `count` (default none); `sort` `input` / `category-ascending` / `category-descending` (default input); `xTitle`; `yTitle`.
- Interactions beyond the defaults: legend highlight (needs a series binding).

Rows shown: 2 of 16, a shape example. `tools.charts.catalogue {"id": "grouped_bar"}` returns this document with every row, as `recipe.examples[0].call`.

```json
{"version":1,"chart":{"kind":"recipe","recipe":"grouped_bar","data":{"rows":[{"region":"North","quarter":"Q1","revenue_eur":400000},{"region":"North","quarter":"Q2","revenue_eur":535000}]},"bindings":{"category":"region","series":"quarter","value":"revenue_eur"},"options":{"yTitle":"Revenue (€)"}},"title":"Quarterly revenue by region","currency":"EUR"}
```

### Stacked bar — recipe `stacked_bar`

Show totals and their make-up across categories. One row per category and series, or set options.aggregate. The value is a number.

- Bindings: `category` (required), `series` (required), `value` (required unless `aggregate` is `count`).
- Options: `aggregate` `none` / `sum` / `mean` / `median` / `min` / `max` / `count` (default none); `sort` `input` / `category-ascending` / `category-descending` (default input); `xTitle`; `yTitle`.
- Interactions beyond the defaults: legend highlight (needs a series binding).

Rows shown: 2 of 36, a shape example. `tools.charts.catalogue {"id": "stacked_bar"}` returns this document with every row, as `recipe.examples[0].call`.

```json
{"version":1,"chart":{"kind":"recipe","recipe":"stacked_bar","data":{"rows":[{"date":"2024-01-01","series":"Web","orders":1200},{"date":"2024-02-01","series":"Web","orders":1375}]},"bindings":{"category":"date","series":"series","value":"orders"},"options":{"xTitle":"Month","yTitle":"Orders"}},"title":"Monthly orders by channel"}
```

### Line chart — recipe `line`

A value over time or along an ordered axis, one line per series. One row per x (and series), or set options.aggregate. Temporal x is an ISO date; quantitative x and y are numbers.

- Bindings: `x` (required), `y` (required unless `aggregate` is `count`), `series` (optional).
- Options: `xType` `temporal` / `quantitative` / `ordinal` (required); `aggregate` `none` / `sum` / `mean` / `median` / `min` / `max` / `count` (default none); `xSort` `input` / `ascending` / `descending` (default ascending for temporal and quantitative x; input for ordinal x); `xTitle`; `yTitle`.
- Interactions beyond the defaults: legend highlight (needs a series binding); zoom x (temporal x only).

Rows shown: 2 of 12, a shape example. `tools.charts.catalogue {"id": "line"}` returns this document with every row, as `recipe.examples[0].call`.

```json
{"version":1,"chart":{"kind":"recipe","recipe":"line","data":{"rows":[{"date":"2024-01-01","dau":42000},{"date":"2024-02-01","dau":45850}]},"bindings":{"x":"date","y":"dau"},"options":{"xType":"temporal","yTitle":"Daily active users"}},"title":"Daily active users, 2024"}
```

### Area chart — recipe `area`

A volume over time; with a series, overlapping areas. One row per x (and series), or set options.aggregate. Temporal x is an ISO date; quantitative x and y are numbers.

- Bindings: `x` (required), `y` (required unless `aggregate` is `count`), `series` (optional).
- Options: `xType` `temporal` / `quantitative` / `ordinal` (required); `aggregate` `none` / `sum` / `mean` / `median` / `min` / `max` / `count` (default none); `xSort` `input` / `ascending` / `descending` (default ascending for temporal and quantitative x; input for ordinal x); `xTitle`; `yTitle`.
- Interactions beyond the defaults: legend highlight (needs a series binding); zoom x (temporal x only).

Rows shown: 2 of 12, a shape example. `tools.charts.catalogue {"id": "area"}` returns this document with every row, as `recipe.examples[0].call`.

```json
{"version":1,"chart":{"kind":"recipe","recipe":"area","data":{"rows":[{"date":"2024-01-01","storage_tb":40},{"date":"2024-02-01","storage_tb":48}]},"bindings":{"x":"date","y":"storage_tb"},"options":{"xType":"temporal","yTitle":"Storage (TB)"}},"title":"Storage used"}
```

### Stacked area — recipe `stacked_area`

Totals over time and how each series contributes. One row per x and series, or set options.aggregate. Temporal x is an ISO date; y is a number.

- Bindings: `x` (required), `y` (required unless `aggregate` is `count`), `series` (required).
- Options: `xType` `temporal` / `quantitative` / `ordinal` (required); `aggregate` `none` / `sum` / `mean` / `median` / `min` / `max` / `count` (default none); `xSort` `input` / `ascending` / `descending` (default ascending for temporal and quantitative x; input for ordinal x); `xTitle`; `yTitle`.
- Interactions beyond the defaults: legend highlight (needs a series binding).

Rows shown: 2 of 48, a shape example. `tools.charts.catalogue {"id": "stacked_area"}` returns this document with every row, as `recipe.examples[0].call`.

```json
{"version":1,"chart":{"kind":"recipe","recipe":"stacked_area","data":{"rows":[{"date":"2024-01-01","region":"North","revenue_eur":300000},{"date":"2024-02-01","region":"North","revenue_eur":336100}]},"bindings":{"x":"date","y":"revenue_eur","series":"region"},"options":{"xType":"temporal","yTitle":"Revenue (€)"}},"title":"Revenue by region","currency":"EUR"}
```

### Scatter plot — recipe `scatter`

The relationship between two numbers, one point per row. One row per point; x and y are numbers on every row.

- Bindings: `x` (required), `y` (required), `series` (optional).
- Options: `xTitle`; `yTitle`.
- Interactions beyond the defaults: legend highlight (needs a series binding); brush interval.

Rows shown: 2 of 60, a shape example. `tools.charts.catalogue {"id": "scatter"}` returns this document with every row, as `recipe.examples[0].call`.

```json
{"version":1,"chart":{"kind":"recipe","recipe":"scatter","data":{"rows":[{"spend_k":5,"conversions":0,"channel":"Search","customers":50},{"spend_k":42,"conversions":91,"channel":"Social","customers":79}]},"bindings":{"x":"spend_k","y":"conversions","series":"channel"},"options":{"xTitle":"Spend (€k)","yTitle":"Conversions"}},"title":"Spend vs conversions"}
```

### Bubble chart — recipe `bubble`

A scatter plot with a third number as the point's area. One row per bubble; x, y and size are numbers on every row.

- Bindings: `x` (required), `y` (required), `size` (required), `series` (optional).
- Options: `xTitle`; `yTitle`.
- Interactions beyond the defaults: legend highlight (needs a series binding); brush interval.

Rows shown: 2 of 30, a shape example. `tools.charts.catalogue {"id": "bubble"}` returns this document with every row, as `recipe.examples[0].call`.

```json
{"version":1,"chart":{"kind":"recipe","recipe":"bubble","data":{"rows":[{"spend_k":5,"conversions":0,"channel":"Search","customers":50},{"spend_k":42,"conversions":91,"channel":"Social","customers":79}]},"bindings":{"x":"spend_k","y":"conversions","size":"customers","series":"channel"},"options":{"xTitle":"Spend (€k)","yTitle":"Conversions"}},"title":"Campaigns: spend, conversions and reach"}
```

### Pie chart — recipe `pie`

Parts of one whole, for a few slices. One row per slice, or set options.aggregate to sum or count. Values are zero or more; a pie cannot show a negative part.

- Bindings: `category` (required), `value` (required unless `aggregate` is `count`).
- Options: `aggregate` `none` / `sum` / `count` (default none); `sort` `input` / `category-ascending` / `category-descending` / `value-ascending` / `value-descending` (default input).
- Interactions beyond the defaults: none (tooltip auto or off only).

Rows shown: 2 of 4, a shape example. `tools.charts.catalogue {"id": "pie"}` returns this document with every row, as `recipe.examples[0].call`.

```json
{"version":1,"chart":{"kind":"recipe","recipe":"pie","data":{"rows":[{"source":"Search","visits":4200},{"source":"Direct","visits":2600}]},"bindings":{"category":"source","value":"visits"},"options":{"sort":"value-descending"}},"title":"Traffic sources"}
```

### Donut chart — recipe `donut`

A pie with a hole, for a few slices. One row per slice, or set options.aggregate to sum or count. Values are zero or more; a donut cannot show a negative part.

- Bindings: `category` (required), `value` (required unless `aggregate` is `count`).
- Options: `aggregate` `none` / `sum` / `count` (default none); `sort` `input` / `category-ascending` / `category-descending` / `value-ascending` / `value-descending` (default input).
- Interactions beyond the defaults: none (tooltip auto or off only).

Rows shown: 2 of 4, a shape example. `tools.charts.catalogue {"id": "donut"}` returns this document with every row, as `recipe.examples[0].call`.

```json
{"version":1,"chart":{"kind":"recipe","recipe":"donut","data":{"rows":[{"item":"Payroll","share":0.52},{"item":"Infrastructure","share":0.21}]},"bindings":{"category":"item","value":"share"},"options":{"sort":"value-descending"}},"title":"Budget split"}
```

### Histogram — recipe `histogram`

The shape of one numeric variable: rows counted per bin. One row per observation; the value is a number. Rows without a value are left out and reported.

- Bindings: `value` (required).
- Options: `bins` 2–200 (default 24); `xTitle`; `yTitle`.
- Interactions beyond the defaults: none (tooltip auto or off only).

Rows shown: 2 of 240, a shape example. `tools.charts.catalogue {"id": "histogram"}` returns this document with every row, as `recipe.examples[0].call`.

```json
{"version":1,"chart":{"kind":"recipe","recipe":"histogram","data":{"rows":[{"group":"A","latency_ms":229.2},{"group":"B","latency_ms":158.5}]},"bindings":{"value":"latency_ms"},"options":{"bins":24,"xTitle":"Latency (ms)","yTitle":"Requests"}},"title":"Checkout latency"}
```

### Box plot — recipe `box_plot`

Medians, spread and outliers of a value across categories. One row per observation; the value is a number. The recipe never pre-aggregates: the box summarises every row.

- Bindings: `category` (required), `value` (required).
- Options: `sort` `input` / `category-ascending` / `category-descending` (default input); `xTitle`; `yTitle`.
- Interactions beyond the defaults: none (tooltip auto or off only).

Rows shown: 2 of 240, a shape example. `tools.charts.catalogue {"id": "box_plot"}` returns this document with every row, as `recipe.examples[0].call`.

```json
{"version":1,"chart":{"kind":"recipe","recipe":"box_plot","data":{"rows":[{"group":"A","latency_ms":229.2},{"group":"B","latency_ms":158.5}]},"bindings":{"category":"group","value":"latency_ms"},"options":{"xTitle":"Service","yTitle":"Latency (ms)"}},"title":"Latency by service"}
```

### Heatmap — recipe `heatmap`

A value across two categorical dimensions, one cell each. One row per cell (row and column), or set options.aggregate to combine repeated cells. The value is a number.

- Bindings: `column` (required), `row` (required), `value` (required unless `aggregate` is `count`).
- Options: `aggregate` `none` / `sum` / `mean` / `median` / `min` / `max` / `count` (default none); `rowSort` `input` / `ascending` / `descending` (default input); `columnSort` `input` / `ascending` / `descending` (default input); `xTitle`; `yTitle`.
- Interactions beyond the defaults: none (tooltip auto or off only).

Rows shown: 2 of 84, a shape example. `tools.charts.catalogue {"id": "heatmap"}` returns this document with every row, as `recipe.examples[0].call`.

```json
{"version":1,"chart":{"kind":"recipe","recipe":"heatmap","data":{"rows":[{"day":"Mon","hour":"00:00","orders":20},{"day":"Mon","hour":"02:00","orders":23}]},"bindings":{"column":"hour","row":"day","value":"orders"}},"title":"Orders by weekday and hour"}
```

## comparison

### Bar chart — `bar` (vega-lite, recipe)

Compare a value across a few categories. **Avoid:** Over ~15 categories: use horizontal_bar.

Prefer the typed `bar` recipe document above via `tools.charts.quick {"document": …}`; call `tools.charts.catalogue {"id": "bar"}` when you need the raw Vega-Lite spec.

### Horizontal bar (ranked) — `horizontal_bar` (vega-lite, recipe)

Rank many categories, or long category names.

Prefer the typed `horizontal_bar` recipe document above via `tools.charts.quick {"document": …}`; call `tools.charts.catalogue {"id": "horizontal_bar"}` when you need the raw Vega-Lite spec.

### Grouped bar — `grouped_bar` (vega-lite, recipe)

Compare sub-groups side by side within each category (xOffset). **Avoid:** More than ~4 sub-groups: use small multiples.

Prefer the typed `grouped_bar` recipe document above via `tools.charts.quick {"document": …}`; call `tools.charts.catalogue {"id": "grouped_bar"}` when you need the raw Vega-Lite spec.

### Stacked bar — `stacked_bar` (vega-lite, recipe)

Show totals and their make-up across categories or time.

Prefer the typed `stacked_bar` recipe document above via `tools.charts.quick {"document": …}`; call `tools.charts.catalogue {"id": "stacked_bar"}` when you need the raw Vega-Lite spec.

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

Tested at width 520. `tools.charts.catalogue {"id": "bullet"}` returns the full tested call.

```json
{"facet":{"row":{"field":"kpi","type":"nominal","header":{"labelAngle":0,"labelAlign":"left","title":null}}},"resolve":{"scale":{"x":"independent"}},"spec":{"width":420,"height":26,"layer":[{"mark":{"type":"bar","color":"theme:grid"},"encoding":{"x":{"field":"good","type":"quantitative","title":null}}},{"mark":{"type":"bar","color":"theme:neutral","opacity":0.35},"encoding":{"x":{"field":"ok","type":"quantitative"}}},{"mark":{"type":"bar","size":10,"color":"theme:categorical.0"},"encoding":{"x":{"field":"actual","type":"quantitative"}}},{"mark":{"type":"tick","color":"theme:text","thickness":2,"size":22},"encoding":{"x":{"field":"target","type":"quantitative"}}}]}}
```

### Waterfall — `waterfall` (vega-lite)

How increases and decreases build from a start to an end total.

Row shape (2 of 6 rows): `[{"step":"Revenue","amount":1200},{"step":"Cost of goods","amount":-480}]`

Tested at width 560. `tools.charts.catalogue {"id": "waterfall"}` returns the full tested call.

```json
{"transform":[{"window":[{"op":"sum","field":"amount","as":"total"}]},{"window":[{"op":"lead","field":"step","as":"lead"}]}],"encoding":{"x":{"field":"step","type":"ordinal","sort":null,"title":null,"axis":{"labelAngle":0,"labelOverlap":false}}},"layer":[{"mark":{"type":"bar","width":{"band":0.7}},"encoding":{"y":{"field":"previous","type":"quantitative","title":"€k"},"y2":{"field":"end"},"color":{"field":"kind","type":"nominal","scale":{"domain":["Increase","Decrease","Total"],"range":["theme:positive","theme:negative","theme:neutral"]},"title":null}}},{"mark":{"type":"text","dy":-6,"baseline":"bottom"},"encoding":{"y":{"field":"top","type":"quantitative","title":"€k"},"text":{"field":"label"}}}]}
```

### Arrow change — `arrow_change` (plot)

Two measures before and after, one arrow per item: where each moved, and how far. **Avoid:** Many items, where the arrows cross: use a slope chart or a dumbbell.

Row shape (2 of 4 rows): `[{"label":"Enterprise","start":118,"end":132,"from":64,"to":71},{"label":"Self-serve","start":72,"end":96,"from":38,"to":47}]`

```json
{"width":560,"height":340,"x":{"domain":[50,152],"label":"Average order value (€)"},"y":{"domain":[22,80],"label":"Conversion (%)"},"marks":[{"type":"arrow","x1":"start","y1":"from","x2":"end","y2":"to","bend":16,"stroke":"theme:axis","strokeWidth":1.5},{"type":"dot","x":"start","y":"from","r":2.5,"fill":"theme:muted"},{"type":"dot","x":"end","y":"to","r":2.5,"fill":"theme:categorical.0"}]}
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

### Pie chart — `pie` (vega-lite, recipe)

Parts of one whole, 2–5 slices. **Avoid:** More than 5–7 slices, or comparing pies: use bars.

Prefer the typed `pie` recipe document above via `tools.charts.quick {"document": …}`; call `tools.charts.catalogue {"id": "pie"}` when you need the raw Vega-Lite spec.

### Donut chart — `donut` (vega-lite, recipe)

A pie with room for a total in the middle.

Prefer the typed `donut` recipe document above via `tools.charts.quick {"document": …}`; call `tools.charts.catalogue {"id": "donut"}` when you need the raw Vega-Lite spec.

### Radial (rose) chart — `radial` (vega-lite)

Cyclical categories such as months or directions.

Row shape (2 of 12 rows): `[{"month":"Jan","rain_mm":75},{"month":"Feb","rain_mm":76}]`

Tested at width 460, height 420. `tools.charts.catalogue {"id": "radial"}` returns the full tested call.

```json
{"encoding":{"theta":{"field":"month","type":"nominal","sort":null},"radius":{"field":"rain_mm","type":"quantitative","scale":{"type":"sqrt","zero":true,"rangeMin":20}}},"layer":[{"mark":{"type":"arc","stroke":"theme:background","strokeWidth":1},"encoding":{"color":{"field":"rain_mm","type":"quantitative","title":"Rainfall (mm)"}}},{"transform":[{"calculate":"datum.month + ' ' + format(datum.rain_mm, ',.0f')","as":"label"}],"mark":{"type":"text","radiusOffset":20,"fontSize":11},"encoding":{"text":{"field":"label"}}}]}
```

### Funnel — `funnel` (echarts)

Drop-off through ordered stages.

Row shape (2 of 5 rows): `[{"stage":"Visited","visitors":10000,"visitors_label":"10,000"},{"stage":"Viewed product","visitors":6200,"visitors_label":"6,200"}]`

Tested at width 640, height 340. `tools.charts.catalogue {"id": "funnel"}` returns the full tested call.

```json
{"series":[{"type":"funnel","left":"4%","width":"58%","bottom":16,"sort":"descending","gap":2,"encode":{"itemName":"stage","value":"visitors"},"label":{"show":true,"position":"right","formatter":"{b}  {@[2]}"},"labelLine":{"show":true,"length":16}}]}
```

### Gauge — `gauge` (echarts)

One KPI against its range, for dashboards. **Avoid:** Several KPIs: use bullet charts.

Tested at width 400, height 320. `tools.charts.catalogue {"id": "gauge"}` returns the full tested call.

```json
{"series":[{"type":"gauge","min":99,"max":100,"splitNumber":4,"startAngle":210,"endAngle":-30,"radius":"82%","progress":{"show":true,"width":14},"axisLine":{"lineStyle":{"width":14}},"pointer":{"show":false},"axisTick":{"show":false},"splitLine":{"show":false},"axisLabel":{"distance":22,"fontSize":11},"detail":{"formatter":"{value}%","fontSize":28,"offsetCenter":[0,"4%"]},"title":{"offsetCenter":[0,"34%"]},"data":[{"value":99.94,"name":"Uptime"}]}]}
```

### Waffle — `waffle` (plot)

A part-to-whole composition as a grid of unit squares: counts readers can point at. **Avoid:** More than ~6 parts, or precise comparison: use a bar chart.

Row shape (2 of 5 rows): `[{"category":"Lattes","value":1824},{"category":"Pastries","value":963}]`

Compact `plotRecipe` form for `tools.charts.render {"spec": …, "data": {"rows": …}}` (`tools.charts.catalogue {"id": "waffle"}` also returns the expanded mark geometry).

```json
{"plotRecipe":"waffle","bindings":{"category":"category","value":"value"},"options":{"title":"Sales mix, by unit sold"}}
```

## trend

### Line chart — `line` (vega-lite, recipe)

A value over time.

Prefer the typed `line` recipe document above via `tools.charts.quick {"document": …}`; call `tools.charts.catalogue {"id": "line"}` when you need the raw Vega-Lite spec.

### Multi-series line — `multi_line` (vega-lite)

Compare a few series over time (≤ 7). **Avoid:** More than ~7 series: highlight one or use small multiples.

Row shape (2 of 48 rows): `[{"date":"2024-01-01","series":"Search","conversion_rate":0.03},{"date":"2024-02-01","series":"Search","conversion_rate":0.03361}]`

```json
{"mark":"line","encoding":{"x":{"field":"date","type":"temporal","title":null},"y":{"field":"conversion_rate","type":"quantitative","axis":{"format":".1%"},"title":"Conversion rate"},"color":{"field":"series","type":"nominal","title":"Channel"}}}
```

### Area chart — `area` (vega-lite, recipe)

A single volume over time.

Prefer the typed `area` recipe document above via `tools.charts.quick {"document": …}`; call `tools.charts.catalogue {"id": "area"}` when you need the raw Vega-Lite spec.

### Stacked area — `stacked_area` (vega-lite, recipe)

Totals over time and how parts contribute.

Prefer the typed `stacked_area` recipe document above via `tools.charts.quick {"document": …}`; call `tools.charts.catalogue {"id": "stacked_area"}` when you need the raw Vega-Lite spec.

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

Tested at width 320, height 360. `tools.charts.catalogue {"id": "slope"}` returns the full tested call.

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

Tested at width 820, height 220. `tools.charts.catalogue {"id": "calendar_heatmap"}` returns the full tested call.

```json
{"visualMap":{"min":0,"max":14,"orient":"horizontal","left":"center","bottom":4,"itemHeight":120,"calculable":false,"text":["14 commits","0"]},"calendar":{"range":"2024","cellSize":["auto",14],"left":52,"right":32,"dayLabel":{"nameMap":["Sun","Mon"]},"yearLabel":{"show":false},"splitLine":{"show":false},"itemStyle":{"color":"theme:background","borderColor":"theme:background"}},"series":[{"type":"heatmap","coordinateSystem":"calendar","encode":{"time":"date","value":"commits"},"itemStyle":{"borderColor":"theme:background","borderWidth":1}}]}
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
{"width":560,"height":340,"x":{"label":"Day"},"marks":[{"type":"differenceY","x":"day","y1":"plan","y2":"actual","positiveFill":"theme:positive","negativeFill":"theme:negative","fillOpacity":0.7},{"type":"lineY","x":"day","y":"plan","stroke":"theme:text","strokeWidth":1.5},{"type":"lineY","x":"day","y":"actual","stroke":"theme:muted","strokeWidth":1.5}]}
```

### Horizon chart — `horizon` (plot)

A long run folded into colour bands, so a year fits in a short strip. **Avoid:** Reading exact values: a folded value is not a height; use a line chart.

Row shape (2 of 120 rows): `[{"day":1,"page_views":73},{"day":2,"page_views":76}]`

Compact `plotRecipe` form for `tools.charts.render {"spec": …, "data": {"rows": …}}` (`tools.charts.catalogue {"id": "horizon"}` also returns the expanded mark geometry).

```json
{"plotRecipe":"horizon","bindings":{"x":"day","y":"page_views"},"options":{"bands":4,"title":"Page views, folded into four bands"}}
```

### Sparkline matrix — `sparkline_matrix` (echarts)

A grid of entities against metrics, each row a shape to scan: a KPI wall. **Avoid:** Exact comparison across rows: the dots share no common scale.

Row shape (2 of 4 rows): `[{"region":"North","revenue":182,"margin":24,"nps":62,"churn":8},{"region":"South","revenue":143,"margin":18,"nps":51,"churn":12}]`

Tested at width 640, height 360. `tools.charts.catalogue {"id": "sparkline_matrix"}` returns the full tested call.

```json
{"title":{"text":"Regional KPIs","left":"center","textStyle":{"fontSize":16,"fontWeight":600,"color":"theme:text"}},"aria":{"enabled":true,"label":{"description":"Regional KPIs: 4 regions across 4 metrics, each cell a small trend of its own."}},"matrix":{"left":84,"right":32,"top":66,"bottom":26,"x":{"data":["Revenue","Margin","NPS","Churn"],"label":{"color":"theme:text","fontSize":11}},"y":{"data":["North","South","East","West"],"label":{"color":"theme:text","fontSize":11}},"body":{"itemStyle":{"borderColor":"theme:grid"}}},"grid":[{"id":"spark-0-0","coordinateSystem":"matrix","matrixIndex":0,"coord":["Revenue","North"],"left":12,"top":12,"right":12,"bottom":12},{"id":"spark-0-1","coordinateSystem":"matrix","matrixIndex":0,"coord":["Margin","North"],"left":12,"top":12,"right":12,"bottom":12}],"xAxis":[{"id":"spark-0-0-x","gridId":"spark-0-0","type":"category","data":["1","2"],"show":false},{"id":"spark-0-1-x","gridId":"spark-0-1","type":"category","data":["1","2"],"show":false}],"yAxis":[{"id":"spark-0-0-y","gridId":"spark-0-0","type":"value","min":"dataMin","max":"dataMax","show":false},{"id":"spark-0-1-y","gridId":"spark-0-1","type":"value","min":"dataMin","max":"dataMax","show":false}],"series":[{"type":"line","name":"North Revenue","xAxisId":"spark-0-0-x","yAxisId":"spark-0-0-y","showSymbol":false,"silent":true,"lineStyle":{"width":1.75,"color":"theme:categorical.0"},"areaStyle":{"color":"theme:categorical.0","opacity":0.14},"data":[163.8,176.4]},{"type":"line","name":"North Margin","xAxisId":"spark-0-1-x","yAxisId":"spark-0-1-y","showSymbol":false,"silent":true,"lineStyle":{"width":1.75,"color":"theme:categorical.0"},"areaStyle":{"color":"theme:categorical.0","opacity":0.14},"data":[23.6,22.5]},{"type":"line","name":"North NPS","xAxisId":"spark-0-2-x","yAxisId":"spark-0-2-y","showSymbol":false,"silent":true,"lineStyle":{"width":1.75,"color":"theme:categorical.0"},"areaStyle":{"color":"theme:categorical.0","opacity":0.14},"data":[49,50.2]}]}
```

### Theme river — `theme_river` (echarts)

Changing composition over time as one flowing stream, where the overall shape matters more than exact values. **Avoid:** Reading one series exactly: use a multi-series line.

Tested at width 640, height 380. `tools.charts.catalogue {"id": "theme_river"}` returns the full tested call.

```json
{"title":{"text":"Sessions by channel","subtext":"Monthly sessions across four acquisition channels, 2024","left":"center","textStyle":{"fontSize":16,"fontWeight":600,"color":"theme:text"},"subtextStyle":{"color":"theme:muted","fontSize":12}},"singleAxis":{"type":"time","top":84,"bottom":64,"left":40,"right":40,"axisLabel":{"color":"theme:muted","formatter":"{MMM}"},"axisLine":{"show":true},"splitLine":{"show":false}},"legend":{"bottom":8,"textStyle":{"color":"theme:muted"}},"series":[{"type":"themeRiver","label":{"show":false},"data":[["2024-01-01",320,"Search"],["2024-01-01",525,"Social"]]}]}
```

## distribution

### Histogram — `histogram` (vega-lite, recipe)

The shape of one numeric variable.

Prefer the typed `histogram` recipe document above via `tools.charts.quick {"document": …}`; call `tools.charts.catalogue {"id": "histogram"}` when you need the raw Vega-Lite spec.

### Density plot — `density` (vega-lite)

Compare smooth distributions of a few groups.

Row shape (2 of 240 rows): `[{"group":"A","latency_ms":229.2},{"group":"B","latency_ms":158.5}]`

```json
{"transform":[{"density":"latency_ms","groupby":["group"],"extent":[20,240]}],"mark":{"type":"area","opacity":0.45,"line":true},"encoding":{"x":{"field":"value","type":"quantitative","title":"Latency (ms)"},"y":{"field":"density","type":"quantitative","title":"Density","stack":null},"color":{"field":"group","type":"nominal","title":"Service"}}}
```

### Box plot — `box_plot` (vega-lite, recipe)

Medians, spread and outliers across groups.

Prefer the typed `box_plot` recipe document above via `tools.charts.quick {"document": …}`; call `tools.charts.catalogue {"id": "box_plot"}` when you need the raw Vega-Lite spec.

### Strip plot — `strip` (vega-lite)

Every observation, for small samples.

Row shape (2 of 120 rows): `[{"group":"A","latency_ms":229.2},{"group":"B","latency_ms":158.5}]`

```json
{"mark":{"type":"tick","thickness":1.5},"encoding":{"x":{"field":"latency_ms","type":"quantitative","title":"Latency (ms)"},"y":{"field":"group","type":"nominal","title":"Service"}}}
```

### Heatmap — `heatmap` (vega-lite, recipe)

A value across two categorical dimensions (day × hour).

Prefer the typed `heatmap` recipe document above via `tools.charts.quick {"document": …}`; call `tools.charts.catalogue {"id": "heatmap"}` when you need the raw Vega-Lite spec.

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

Row shape (2 of 150 rows): `[{"group":"A","latency_ms":229.2,"position":0},{"group":"B","latency_ms":158.5,"position":1.1190476}]`

Compact `plotRecipe` form for `tools.charts.render {"spec": …, "data": {"rows": …}}` (`tools.charts.catalogue {"id": "beeswarm"}` also returns the expanded mark geometry).

```json
{"plotRecipe":"beeswarm","bindings":{"x":"group","y":"latency_ms"},"options":{"title":"Response times by service","xLabel":"Service","yLabel":"Latency (ms)"}}
```

### Ridgeline — `ridgeline` (plot)

A density curve per group, stacked so several distributions compare by shape. **Avoid:** More than ~8 groups: the curves overlap into a texture.

Row shape (2 of 240 rows): `[{"group":"A","latency_ms":229.2},{"group":"B","latency_ms":158.5}]`

Compact `plotRecipe` form for `tools.charts.render {"spec": …, "data": {"rows": …}}` (`tools.charts.catalogue {"id": "ridgeline"}` also returns the expanded mark geometry).

```json
{"plotRecipe":"ridgeline","bindings":{"x":"latency_ms","group":"group"},"options":{"title":"Latency distribution by service"}}
```

### Violin plot — `violin` (echarts)

Compare the shape of a distribution across a few groups, not just its quartiles. **Avoid:** Fewer than ~20 values per group: a box plot or a strip plot is enough.

Row shape (2 of 240 rows): `[{"group":"A","latency_ms":229.2},{"group":"B","latency_ms":158.5}]`

Tested at width 640, height 380. `tools.charts.catalogue {"id": "violin"}` returns the full tested call.

```json
{"title":{"text":"Response time by service","left":"center","textStyle":{"fontSize":16,"fontWeight":600,"color":"theme:text"}},"grid":{"left":96,"right":40,"top":64,"bottom":52},"xAxis":{"type":"value","name":"Latency (ms)","nameLocation":"middle","nameGap":30,"nameTextStyle":{"color":"theme:muted"},"splitLine":{"show":true},"axisLabel":{"color":"theme:muted"}},"yAxis":[{"type":"value","min":0,"max":3,"axisLabel":{"show":false},"axisLine":{"show":false},"axisTick":{"show":false},"splitLine":{"show":false}},{"type":"category","data":["A","B","C"],"position":"left","axisLine":{"show":false},"axisTick":{"show":false},"splitLine":{"show":false},"axisLabel":{"color":"theme:text","fontSize":11}}],"series":[{"type":"line","name":"A","data":[[52.9,2.551],[58.587097,2.572]],"showSymbol":false,"smooth":false,"silent":true,"z":3,"lineStyle":{"width":1,"color":"theme:categorical.0"},"areaStyle":{"origin":2.5,"color":"theme:categorical.0","opacity":0.32},"markArea":{"silent":true,"itemStyle":{"color":"theme:categorical.0","opacity":0.22},"data":[[{"coord":[102.15,2.26]},{"coord":[136.55,2.74]}]]},"markLine":{"silent":true,"symbol":"none","lineStyle":{"color":"theme:categorical.0","width":2},"data":[[{"coord":[120.7,2.26]},{"coord":[120.7,2.74]}]]}},{"type":"line","name":"A","data":[[229.2,2.487],[223.5129,2.488]],"showSymbol":false,"smooth":false,"silent":true,"z":3,"lineStyle":{"width":1,"color":"theme:categorical.0"},"areaStyle":{"origin":2.5,"color":"theme:categorical.0","opacity":0.32}},{"type":"line","name":"B","data":[[94.7,1.539],[99.8,1.559]],"showSymbol":false,"smooth":false,"silent":true,"z":3,"lineStyle":{"width":1,"color":"theme:categorical.1"},"areaStyle":{"origin":1.5,"color":"theme:categorical.1","opacity":0.32},"markArea":{"silent":true,"itemStyle":{"color":"theme:categorical.1","opacity":0.22},"data":[[{"coord":[146.375,1.26]},{"coord":[176.675,1.74]}]]},"markLine":{"silent":true,"symbol":"none","lineStyle":{"color":"theme:categorical.1","width":2},"data":[[{"coord":[159.65,1.26]},{"coord":[159.65,1.74]}]]}}]}
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

Tested at width 420, height 420. `tools.charts.catalogue {"id": "sunburst"}` returns the full tested call.

```json
{"autosize":"pad","data":[{"name":"table"},{"name":"tree","source":"table","transform":[{"type":"stratify","key":"id","parentKey":"parent"},{"type":"partition","field":"size","sort":{"field":"value"},"size":[{"signal":"2 * PI"},{"signal":"min(width, height) / 2"}],"as":["a0","r0","a1","r1","depth","children"]}]}],"scales":[{"name":"color","type":"ordinal","domain":{"data":"tree","field":"group","sort":true},"range":"category"}],"marks":[{"type":"arc","from":{"data":"tree"},"encode":{"enter":{"x":{"signal":"width / 2"},"y":{"signal":"height / 2"},"fill":{"signal":"datum.depth === 0 ? 'transparent' : scale('color', datum.group)"},"fillOpacity":{"signal":"datum.depth === 1 ? 1 : 0.7"},"stroke":{"signal":"background"},"strokeWidth":{"value":1}},"update":{"startAngle":{"field":"a0"},"endAngle":{"field":"a1"},"innerRadius":{"field":"r0"},"outerRadius":{"field":"r1"}}}},{"type":"text","from":{"data":"tree"},"encode":{"enter":{"text":{"field":"name"},"fontSize":{"value":10},"align":{"value":"center"},"baseline":{"value":"middle"},"fill":{"signal":"luminance(scale('color', datum.group)) > 0.45 ? '#111111' : '#FFFFFF'"}},"update":{"x":{"signal":"width / 2 + (datum.r0 + datum.r1) / 2 * sin((datum.a0 + datum.a1) / 2)"},"y":{"signal":"height / 2 - (datum.r0 + datum.r1) / 2 * cos((datum.a0 + datum.a1) / 2)"},"opacity":{"signal":"datum.depth >= 1 && (datum.a1 - datum.a0) * (datum.r0 + datum.r1) / 2 > 34 ? 1 : 0"}}}}]}
```

### Tree (dendrogram) — `tree` (vega)

Structure of a hierarchy (org chart, taxonomy).

Row shape (2 of 15 rows): `[{"id":"root","parent":null,"name":"Company","size":0,"group":"Company"},{"id":"Product","parent":"root","name":"Product","size":0,"group":"Product"}]`

Tested at width 560, height 380. `tools.charts.catalogue {"id": "tree"}` returns the full tested call.

```json
{"autosize":"pad","padding":{"left":70,"right":70,"top":10,"bottom":10},"data":[{"name":"table"},{"name":"tree","source":"table","transform":[{"type":"stratify","key":"id","parentKey":"parent"},{"type":"tree","method":"tidy","size":[{"signal":"height"},{"signal":"width - 60"}],"separation":true,"as":["y","x","depth","children"]}]},{"name":"links","source":"tree","transform":[{"type":"treelinks"},{"type":"linkpath","orient":"horizontal","shape":"diagonal"}]}],"scales":[{"name":"color","type":"ordinal","domain":{"data":"tree","field":"group","sort":true},"range":"category"}],"marks":[{"type":"path","from":{"data":"links"},"encode":{"update":{"path":{"field":"path"},"stroke":{"value":"theme:axis"}}}},{"type":"symbol","from":{"data":"tree"},"encode":{"enter":{"size":{"value":90},"stroke":{"signal":"background"}},"update":{"x":{"field":"x"},"y":{"field":"y"},"fill":{"scale":"color","field":"group"}}}},{"type":"text","from":{"data":"tree"},"encode":{"enter":{"text":{"field":"name"},"fontSize":{"value":11},"baseline":{"value":"middle"}},"update":{"x":{"field":"x"},"y":{"field":"y"},"dx":{"signal":"datum.children ? -9 : 9"},"align":{"signal":"datum.children ? 'right' : 'left'"}}}}]}
```

## relationship

### Scatter plot — `scatter` (vega-lite, recipe)

Relationship between two numbers.

Prefer the typed `scatter` recipe document above via `tools.charts.quick {"document": …}`; call `tools.charts.catalogue {"id": "scatter"}` when you need the raw Vega-Lite spec.

### Bubble chart — `bubble` (vega-lite, recipe)

A scatter with a third measure as area.

Prefer the typed `bubble` recipe document above via `tools.charts.quick {"document": …}`; call `tools.charts.catalogue {"id": "bubble"}` when you need the raw Vega-Lite spec.

### Scatter with trend line — `regression` (vega-lite)

Show the overall trend through points.

Row shape (2 of 60 rows): `[{"spend_k":5,"conversions":0,"channel":"Search","customers":50},{"spend_k":42,"conversions":91,"channel":"Social","customers":79}]`

```json
{"encoding":{"x":{"field":"spend_k","type":"quantitative","title":"Spend (€k)"},"y":{"field":"conversions","type":"quantitative","title":"Conversions"}},"layer":[{"mark":{"type":"point","filled":true,"opacity":0.6}},{"mark":{"type":"line","color":"theme:highlight","strokeWidth":2.5},"transform":[{"regression":"conversions","on":"spend_k"}]}]}
```

### Correlation matrix — `correlation_matrix` (vega-lite)

Pairwise correlations between several measures.

Row shape (2 of 25 rows): `[{"a":"price","b":"price","r":1},{"a":"price","b":"rating","r":-0.3}]`

Tested at width 360, height 360. `tools.charts.catalogue {"id": "correlation_matrix"}` returns the full tested call.

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

Tested at width 640. `tools.charts.catalogue {"id": "parallel"}` returns the full tested call.

```json
{"parallelAxis":[{"dim":0,"name":"Price (€)"},{"dim":1,"name":"Weight (kg)"},{"dim":2,"name":"Battery (h)"},{"dim":3,"name":"Score"}],"parallel":{"left":60,"right":60,"top":80,"bottom":40},"series":[{"type":"parallel","lineStyle":{"width":2,"opacity":0.7},"data":[[1299,1.2,14,88],[899,1.6,10,76],[1999,1.4,18,93],[649,2.1,7,64],[1499,1.3,12,85],[1099,1.8,11,79]]}]}
```

### Radar chart — `radar` (echarts)

A profile across 4–8 comparable scores, for 1–3 items. **Avoid:** Precise comparison: use grouped bars.

Tested at width 480, height 420. `tools.charts.catalogue {"id": "radar"}` returns the full tested call.

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

Tested at width 640, height 360. `tools.charts.catalogue {"id": "sankey"}` returns the full tested call.

```json
{"series":[{"type":"sankey","left":96,"right":96,"top":40,"bottom":28,"nodeWidth":14,"nodeGap":14,"lineStyle":{"color":"gradient","opacity":0.42,"curveness":0.5},"label":{"fontSize":11,"textBorderWidth":2,"textBorderColor":"theme:background"},"data":[{"name":"Search","label":{"position":"left"}},{"name":"Social","label":{"position":"left"}},{"name":"Referral","label":{"position":"left"}},{"name":"Trial","label":{"position":"top"}},{"name":"Paid","label":{"position":"right"}},{"name":"Churned","label":{"position":"right"}}],"links":[{"source":"Search","target":"Trial","value":520},{"source":"Social","target":"Trial","value":310},{"source":"Referral","target":"Trial","value":170},{"source":"Trial","target":"Paid","value":410},{"source":"Trial","target":"Churned","value":590}]}]}
```

### Chord diagram — `chord` (echarts)

Two-way flows between a few groups.

Tested at width 460, height 440. `tools.charts.catalogue {"id": "chord"}` returns the full tested call.

```json
{"series":[{"type":"chord","radius":["70%","78%"],"label":{"show":true},"lineStyle":{"color":"source","opacity":0.4},"data":[{"name":"Free"},{"name":"Basic"},{"name":"Pro"},{"name":"Team"}],"links":[{"source":"Free","target":"Basic","value":40},{"source":"Basic","target":"Pro","value":25},{"source":"Pro","target":"Team","value":12},{"source":"Basic","target":"Free","value":10},{"source":"Pro","target":"Basic","value":8},{"source":"Team","target":"Pro","value":4}]}]}
```

### Force-directed network — `network` (vega)

Who is connected to whom.

Tested at width 520, height 360. `tools.charts.catalogue {"id": "network"}` returns the full tested call.

```json
{"autosize":"pad","data":[{"name":"node-data","values":[{"index":0,"name":"Ana","team":"Data"},{"index":1,"name":"Ben","team":"Web"}]},{"name":"link-data","values":[{"source":0,"target":1},{"source":0,"target":2}]}],"scales":[{"name":"color","type":"ordinal","domain":{"data":"node-data","field":"team","sort":true},"range":"category"}],"marks":[{"name":"nodes","type":"symbol","zindex":1,"from":{"data":"node-data"},"encode":{"enter":{"fill":{"scale":"color","field":"team"},"stroke":{"signal":"background"},"strokeWidth":{"value":1.5},"size":{"value":260}}},"transform":[{"type":"force","iterations":400,"static":true,"signal":"force","forces":[{"force":"center","x":{"signal":"width / 2"},"y":{"signal":"height / 2"}},{"force":"collide","radius":26},{"force":"nbody","strength":-120},{"force":"link","links":"link-data","distance":85}]}]},{"type":"path","from":{"data":"link-data"},"interactive":false,"encode":{"update":{"stroke":{"value":"theme:axis"},"strokeWidth":{"value":1.2}}},"transform":[{"type":"linkpath","require":{"signal":"force"},"shape":"line","sourceX":"datum.source.x","sourceY":"datum.source.y","targetX":"datum.target.x","targetY":"datum.target.y"}]},{"type":"text","from":{"data":"nodes"},"zindex":2,"encode":{"update":{"x":{"field":"x"},"y":{"field":"y","offset":-15},"text":{"field":"datum.name"},"align":{"value":"center"},"fontSize":{"value":11}}}}],"legends":[{"fill":"color","orient":"bottom-right","title":"Team"}]}
```

## map

### World choropleth — `choropleth_world` (vega-lite)

A rate by country. Join on iso_a3, iso_a2 or name from the bundled world-110m atlas. **Avoid:** Totals (bigger countries dominate): map rates, or use a bubble map.

Row shape (2 of 25 rows): `[{"iso":"USA","users_share":0.92},{"iso":"CAN","users_share":0.93}]`

Tested at width 640, height 340. `tools.charts.catalogue {"id": "choropleth_world"}` returns the full tested call.

```json
{"data":{"atlas":"world-110m"},"projection":{"type":"equalEarth"},"layer":[{"mark":{"type":"geoshape","stroke":"theme:background","strokeWidth":0.5},"encoding":{"color":{"datum":"No data","type":"nominal","scale":{"domain":["No data"],"range":["theme:grid"]},"legend":{"title":null,"orient":"bottom-right"}}}},{"transform":[{"lookup":"properties.iso_a3","from":{"data":{"name":"table"},"key":"iso","fields":["users_share"]}},{"filter":"isValid(datum.users_share)"}],"mark":{"type":"geoshape"},"encoding":{"color":{"field":"users_share","type":"quantitative","legend":{"format":".0%"},"title":"Internet users"}}}],"resolve":{"scale":{"color":"independent"}}}
```

### US states choropleth — `choropleth_us` (vega-lite)

A rate by US state (join on postal, name or FIPS id).

Row shape (2 of 51 rows): `[{"postal":"CA","unemployment":0.025},{"postal":"TX","unemployment":0.032}]`

Tested at width 600, height 360. `tools.charts.catalogue {"id": "choropleth_us"}` returns the full tested call.

```json
{"data":{"atlas":"us-states-10m"},"projection":{"type":"albersUsa"},"transform":[{"lookup":"properties.postal","from":{"data":{"name":"table"},"key":"postal","fields":["unemployment"]}}],"mark":"geoshape","encoding":{"color":{"field":"unemployment","type":"quantitative","legend":{"format":".1%"},"title":"Unemployment"}}}
```

### Point / bubble map — `point_map` (vega-lite)

Values at places (cities, stores) on a world base map.

Row shape (2 of 10 rows): `[{"city":"London","lat":51.5,"lon":-0.13,"customers":1200},{"city":"New York","lat":40.7,"lon":-74,"customers":2100}]`

Tested at width 640, height 340. `tools.charts.catalogue {"id": "point_map"}` returns the full tested call.

```json
{"projection":{"type":"equalEarth"},"layer":[{"data":{"atlas":"world-land-110m"},"mark":{"type":"geoshape","fill":"theme:grid","stroke":null}},{"data":{"name":"table"},"mark":{"type":"circle","opacity":0.75,"stroke":"theme:background","strokeWidth":1},"encoding":{"longitude":{"field":"lon","type":"quantitative"},"latitude":{"field":"lat","type":"quantitative"},"size":{"field":"customers","type":"quantitative","scale":{"range":[40,900]},"title":"Customers"}}}]}
```

### US state hex cartogram — `cartogram_us_hex` (plot)

Compare a value across US states, where every state deserves the same space whatever its area. **Avoid:** Geographic shape or position itself: use the US states choropleth.

Row shape (2 of 51 rows): `[{"postal":"AK","state":"Alaska","broadband_pct":62},{"postal":"ME","state":"Maine","broadband_pct":65}]`

Compact `plotRecipe` form for `tools.charts.render {"spec": …, "data": {"rows": …}}` (`tools.charts.catalogue {"id": "cartogram_us_hex"}` also returns the expanded mark geometry).

```json
{"plotRecipe":"cartogram_us_hex","bindings":{"state":"postal","value":"broadband_pct"},"options":{"title":"Adults with home broadband, by state"}}
```

### Europe tile cartogram — `cartogram_eu_tile` (plot)

Compare a value across European countries as equal tiles: the 27 EU members plus the UK, Switzerland, Norway, Iceland and Ukraine. **Avoid:** A world comparison: use the world choropleth.

Row shape (2 of 32 rows): `[{"iso3":"ISL","country":"Iceland","index_points":10},{"iso3":"NOR","country":"Norway","index_points":39}]`

Compact `plotRecipe` form for `tools.charts.render {"spec": …, "data": {"rows": …}}` (`tools.charts.catalogue {"id": "cartogram_eu_tile"}` also returns the expanded mark geometry).

```json
{"plotRecipe":"cartogram_eu_tile","bindings":{"country":"iso3","value":"index_points"},"options":{"title":"Digital index, by country"}}
```

### Geodesic flow map — `flow_map` (plot)

Volumes moving between places as great-circle arcs over a world land base. **Avoid:** One-way stage volumes with no geography: use a Sankey.

Row shape (2 of 6 rows): `[{"originLat":40.7,"originLon":-74,"destLat":51.5,"destLon":-0.1,"value":9,"label":"New York"},{"originLat":40.7,"originLon":-74,"destLat":25.2,"destLon":55.3,"value":4,"label":"New York"}]`

Compact `plotRecipe` form for `tools.charts.render {"spec": …, "data": {"rows": …}}` (`tools.charts.catalogue {"id": "flow_map"}` also returns the expanded mark geometry).

```json
{"plotRecipe":"flow_map","bindings":{"originLat":"originLat","originLon":"originLon","destLat":"destLat","destLon":"destLon","value":"value","label":"label"},"options":{"title":"Where travellers fly","labels":true}}
```

## text

### Word cloud — `word_cloud` (vega)

A light overview of frequent terms; never for precise comparison.

Row shape (2 of 20 rows): `[{"text":"delivery","count":96},{"text":"price","count":81}]`

Tested at width 520, height 300. `tools.charts.catalogue {"id": "word_cloud"}` returns the full tested call.

```json
{"autosize":"pad","data":[{"name":"table"}],"scales":[{"name":"color","type":"ordinal","domain":{"data":"table","field":"text"},"range":"category"}],"marks":[{"type":"text","from":{"data":"table"},"encode":{"enter":{"text":{"field":"text"},"align":{"value":"center"},"baseline":{"value":"middle"},"fill":{"scale":"color","field":"text"}}},"transform":[{"type":"wordcloud","size":[{"signal":"width"},{"signal":"height"}],"text":{"field":"text"},"rotate":{"expr":"datum.count < 20 && length(datum.text) < 6 ? 90 : 0"},"font":"theme:font","fontSize":{"field":"datum.count"},"fontWeight":"600","fontSizeRange":[12,52],"padding":3}]}]}
```

## table

### Publication data table — `data_table` (`tools.charts.table`)

A ranked list where the reader needs the number and its shape: inline bars, sparklines and signed deltas beside the values. **Avoid:** One measure across many categories: a bar chart compares faster.

Pass directly to `tools.charts.table` (rows shown: 2 of 4; `tools.charts.catalogue {"id": "data_table"}` has every row):

```json
{"data":{"rows":[{"region":"North","revenue":1240500,"growth":0.142,"status":"On track","trend":[12,15,11,19,24],"mix":"Enterprise"},{"region":"South","revenue":890400,"growth":-0.031,"status":"At risk","trend":[18,16,14,13,12],"mix":"SMB"}]},"title":"Regional revenue, 2026","subtitle":"Growth against last year, with a five-month trend","kicker":"Commercial review","source":"Source: finance close, November 2026","notes":"Growth is year on year; the trend is monthly revenue.","zebra":true,"rowGroupField":"mix","columns":[{"field":"region","label":"Region"},{"field":"revenue","label":"Revenue","spanner":"Money","format":"currency","cell":"bar"},{"field":"growth","label":"Growth","spanner":"Money","format":"percent","cell":"delta"},{"field":"status","label":"Status","spanner":"Delivery","cell":"badge","badgeColors":{"At risk":"theme:negative","Ahead":"theme:positive"}},{"field":"trend","label":"Trend","spanner":"Shape","cell":"sparkline"}],"summaryRow":{"label":"Total","operations":{"revenue":"sum","growth":"mean"}},"formats":["svg","png","html"]}
```

### KPI scorecard table — `kpi_table` (`tools.charts.table`)

An executive scorecard: actual against target with a bullet bar, a sparkline of the run up to it, and a heatmap of shares. **Avoid:** A single KPI: a headline value or a bullet chart is smaller.

Pass directly to `tools.charts.table` (rows shown: 2 of 4; `tools.charts.catalogue {"id": "kpi_table"}` has every row):

```json
{"data":{"rows":[{"team":"Support","csat":91,"csat_target":88,"tickets_share":0.34,"weekly":[82,86,88,90,91]},{"team":"Sales","csat":84,"csat_target":90,"tickets_share":0.21,"weekly":[79,82,83,84,84]}]},"title":"Service KPIs, this quarter","subtitle":"Satisfaction against target, tickets and the weekly run","kicker":"Operations review","source":"Source: support platform, week 12","columns":[{"field":"team","label":"Team"},{"field":"csat","label":"CSAT","format":"integer","cell":"bullet","targetField":"csat_target","domain":[70,100]},{"field":"weekly","label":"Last five weeks","cell":"sparkarea"},{"field":"tickets_share","label":"Share of tickets","format":"percent","cell":"heatmap"}],"summaryRow":{"label":"Team mean","operations":{"csat":"mean","tickets_share":"sum"}},"formats":["svg","png","html"]}
```

## diagram

### Flowchart — `flowchart` (`tools.charts.diagram`)

A process with decisions and branches, as boxes and arrows a reader can follow. **Avoid:** Volumes moving between stages: use a Sankey, whose widths carry the amounts.

Pass directly to `tools.charts.diagram` (returns SVG, PNG and Unicode `ascii`):

```json
{"dsl":"flowchart LR\n  A[Invoice received] --> B{Under 500?}\n  B -->|yes| C[Auto-approve]\n  B -->|no| D[Manager review]\n  D --> E{Approved?}\n  E -->|yes| F[Pay run]\n  E -->|no| G[Query raised]\n  G --> A","title":"Invoice triage","kicker":"Finance operations","source":"Process owner: accounts payable"}
```

### Sequence diagram — `sequence_diagram` (`tools.charts.diagram`)

Who calls whom, in what order: a protocol, an API handshake, a checkout. **Avoid:** State that does not move forward in time: use a state diagram.

Pass directly to `tools.charts.diagram` (returns SVG, PNG and Unicode `ascii`):

```json
{"dsl":"sequenceDiagram\n  participant C as Customer\n  participant S as Shop\n  participant P as Payment provider\n  C->>S: Place order\n  S->>P: Authorise\n  P-->>S: Approved\n  S-->>C: Confirmation\n  P->>S: Settlement","title":"Card payment","subtitle":"Authorisation, then settlement","source":"Protocol: 3-D Secure"}
```

### State diagram — `state_diagram` (`tools.charts.diagram`)

The states one thing moves through, and the events that move it. **Avoid:** Several actors and their messages: use a sequence diagram.

Pass directly to `tools.charts.diagram` (returns SVG, PNG and Unicode `ascii`):

```json
{"dsl":"stateDiagram-v2\n  [*] --> Trial\n  Trial --> Active : payment\n  Trial --> Expired : no payment\n  Active --> Paused : request\n  Paused --> Active : resume\n  Active --> Cancelled : cancel\n  Cancelled --> [*]\n  Expired --> [*]","title":"Subscription lifecycle","kicker":"Billing","source":"States as at November 2026"}
```

### Entity-relationship diagram — `er_diagram` (`tools.charts.diagram`)

A schema: entities, their keys and the cardinality between them. **Avoid:** Runtime order of calls: use a sequence diagram.

Pass directly to `tools.charts.diagram` (returns SVG, PNG and Unicode `ascii`):

```json
{"dsl":"erDiagram\n  CUSTOMER {\n    string customer_id PK\n    string email\n  }\n  ORDER {\n    string order_id PK\n    date placed_on\n  }\n  LINE_ITEM {\n    int quantity\n    decimal unit_price\n  }\n  PRODUCT {\n    string sku PK\n    decimal price\n  }\n  CATEGORY {\n    string code PK\n    string name\n  }\n  CUSTOMER ||--o{ ORDER : places\n  ORDER ||--|{ LINE_ITEM : contains\n  PRODUCT ||--o{ LINE_ITEM : appears_in\n  CATEGORY ||--o{ PRODUCT : groups","title":"Orders schema","subtitle":"Five tables across customers, orders and products","source":"Schema version 12"}
```

### Mindmap — `mindmap` (`tools.charts.diagram`)

A central topic and its branches, for scope or a brainstorm, laid out as a tree. **Avoid:** Values within a hierarchy: a treemap carries the sizes.

Pass directly to `tools.charts.diagram` (returns SVG, PNG and Unicode `ascii`):

```json
{"kind":"mindmap","title":"Charts platform","subtitle":"What the plugin covers","root":{"label":"Charts"},"nodes":[{"id":"render","label":"Rendering"},{"id":"vega","label":"Vega and Vega-Lite","parent":"render"},{"id":"echarts","label":"ECharts","parent":"render"},{"id":"plot","label":"Observable Plot","parent":"render"},{"id":"data","label":"Data"},{"id":"rows","label":"Inline rows","parent":"data"},{"id":"files","label":"Workspace files","parent":"data"},{"id":"out","label":"Output"},{"id":"svg","label":"SVG and PNG","parent":"out"},{"id":"html","label":"Interactive HTML","parent":"out"},{"id":"table","label":"Tables and diagrams","parent":"out"}]}
```

### Org chart — `org_chart` (`tools.charts.diagram`)

Who reports to whom, with roles under each name. **Avoid:** Team sizes: a treemap shows how many people each team has.

Pass directly to `tools.charts.diagram` (returns SVG, PNG and Unicode `ascii`):

```json
{"kind":"org_chart","title":"Product organisation","subtitle":"Reporting lines, November 2026","groups":[{"id":"eng","label":"Engineering","nodes":["cto","infra"]},{"id":"prod","label":"Product","nodes":["cpo"]}],"nodes":[{"id":"ceo","label":"Dana Reed","subtitle":"Chief Executive"},{"id":"cto","label":"Sam Ortiz","subtitle":"Engineering","parent":"ceo","group":"eng"},{"id":"cpo","label":"Lee Park","subtitle":"Product","parent":"ceo","group":"prod"},{"id":"infra","label":"Ada Chen","subtitle":"Infrastructure","parent":"cto","group":"eng"},{"id":"design","label":"Noah Silva","subtitle":"Design","parent":"cpo","group":"prod"}]}
```

### Fishbone (Ishikawa) — `fishbone` (`tools.charts.diagram`)

Root causes of one effect, grouped by category, for a review or a post-mortem. **Avoid:** Causes with volumes or order: use a flowchart.

Pass directly to `tools.charts.diagram` (returns SVG, PNG and Unicode `ascii`):

```json
{"kind":"fishbone","title":"Why deliveries slipped","effect":"Late deliveries","kicker":"Post-mortem","categories":[{"category":"People","causes":["Two open roles","Onboarding gap"]},{"category":"Process","causes":["Manual handoffs","No buffer","Late QA"]},{"category":"Systems","causes":["Slow build"]},{"category":"Suppliers","causes":["Single source","Long lead time"]}]}
```

## dashboards (`tools.charts.board`)

Multi-panel cross-filtered dashboards use `tools.charts.board` with a `BoardDocumentV1` (`version: 1`, `title`, `datasets`, optional `filters`/`kpis`/`tabs`, and `panels`). Always writes four files: `<name>.svg`, `<name>.png` (2x poster), `<name>.board.html` (self-contained UI SDK cross-filtering page), and `<name>.board.json`.

```json
{"board":{"version":1,"kicker":"Quarterly review","title":"Regional revenue and conversion","subtitle":"Filter by quarter; KPIs, chart and table update together offline","source":"Source: finance close","datasets":{"sales":{"rows":[{"region":"North","quarter":"Q1","month":"2026-01","revenue":510,"conversion":0.12},{"region":"South","quarter":"Q1","month":"2026-01","revenue":390,"conversion":0.09}]}},"filters":[{"id":"quarter","label":"Quarter","dataset":"sales","field":"quarter","control":"segmented"}],"kpis":[{"id":"rev","label":"Total revenue","dataset":"sales","field":"revenue","aggregate":"sum","format":"currency","delta":{"value":0.14,"label":"vs prior quarter"},"sparkline":{"x":"month","y":"revenue","aggregate":"sum"}},{"id":"conv","label":"Mean conversion","dataset":"sales","field":"conversion","aggregate":"mean","format":"percent","decimals":1}],"panels":[{"id":"by_region","title":"Revenue by region","dataset":"sales","span":6,"chart":{"quick":{"type":"bar","x":"region","y":"revenue","aggregate":"sum","sort":true}}},{"id":"detail","title":"Regional detail","dataset":"sales","span":6,"chart":{"kind":"table","columns":[{"field":"region","label":"Region"},{"field":"quarter","label":"Quarter"},{"field":"revenue","label":"Revenue","format":"currency","align":"right"}],"limit":20}}]},"currency":"EUR","name":"regional-review"}
```
