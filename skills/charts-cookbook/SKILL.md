---
name: charts-cookbook
description: Idiomatic, tested specs for every chart type the charts_* tools draw (Vega-Lite, Vega and ECharts), grouped by purpose, with when to use each. Read it before writing a spec by hand.
---

# Charts cookbook

Each spec below is a tested catalogue example (generated from the plugin's own catalogue). The rows shown are a shape example, the first two of the tested dataset, not the whole of it, and an example tested at a size says so. `charts_catalogue {"id": "…"}` returns the exact tested call: the spec with every row, the title, the currency and the size, ready to pass to `charts_render`. Colours written `"theme:…"` follow the active theme. Vega-Lite is the default engine; Vega is for layouts (treemap, sunburst, tree, force, word cloud); ECharts for flows and dashboard types (Sankey, chord, gauge, funnel, calendar, candlestick, radar, parallel).

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
{"mark":"bar","encoding":{"y":{"field":"country","type":"nominal","sort":"-x"},"x":{"field":"change_pct","type":"quantitative","axis":{"format":"+.0%"},"title":"Change vs 2023"},"color":{"condition":{"test":"datum.change_pct < 0","value":"theme:negative"},"value":"theme:positive"}}}
```

### Lollipop — `lollipop` (vega-lite)

A lighter bar chart for many categories.

Row shape (2 of 8 rows): `[{"store":"Germany","nps":18},{"store":"France","nps":41}]`

```json
{"encoding":{"y":{"field":"store","type":"nominal","sort":"-x"},"x":{"field":"nps","type":"quantitative","title":"NPS (points)"}},"layer":[{"mark":{"type":"rule","strokeWidth":2,"color":"theme:axis"},"encoding":{"x":{"datum":0},"x2":{"field":"nps"}}},{"mark":{"type":"point","filled":true,"size":120}}]}
```

### Dumbbell — `dumbbell` (vega-lite)

Before/after or two values per category.

Row shape (2 of 10 rows): `[{"area":"Search","when":"Before","score":52},{"area":"Search","when":"After","score":61}]`

```json
{"encoding":{"y":{"field":"area","type":"nominal"},"x":{"field":"score","type":"quantitative","scale":{"zero":false},"title":"Score (0–100)"}},"layer":[{"mark":{"type":"line","color":"theme:axis","strokeWidth":2},"encoding":{"detail":{"field":"area"}}},{"mark":{"type":"point","filled":true,"size":110,"opacity":1},"encoding":{"color":{"field":"when","type":"nominal","sort":["Before","After"],"title":null}}}]}
```

### Dot plot (Cleveland) — `dot_plot` (vega-lite)

Precise comparison when bars would be heavy; non-zero baselines are fine.

Row shape (2 of 7 rows): `[{"city":"Berlin","delivery_min":24},{"city":"Paris","delivery_min":41}]`

```json
{"mark":{"type":"point","filled":true,"size":90},"encoding":{"y":{"field":"city","type":"nominal","sort":"x"},"x":{"field":"delivery_min","type":"quantitative","scale":{"zero":false},"title":"Median delivery (min)"}}}
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

```json
{"transform":[{"window":[{"op":"sum","field":"amount","as":"total"}]},{"window":[{"op":"lead","field":"step","as":"lead"}]},{"calculate":"datum.step === 'Profit' ? datum.total : datum.total - datum.amount","as":"previous"},{"calculate":"datum.step === 'Profit' ? 0 : datum.total","as":"end"},{"calculate":"datum.step === 'Profit' ? 'Total' : datum.amount >= 0 ? 'Increase' : 'Decrease'","as":"kind"}],"encoding":{"x":{"field":"step","type":"ordinal","sort":null,"title":null}},"layer":[{"mark":{"type":"bar","width":{"band":0.7}},"encoding":{"y":{"field":"previous","type":"quantitative","title":"€k"},"y2":{"field":"end"},"color":{"field":"kind","type":"nominal","scale":{"domain":["Increase","Decrease","Total"],"range":["theme:positive","theme:negative","theme:neutral"]},"title":null}}},{"mark":{"type":"text","dy":-8,"baseline":"bottom"},"encoding":{"y":{"field":"previous","type":"quantitative","aggregate":"max"},"text":{"field":"amount","type":"quantitative","format":"+,.0f"}},"transform":[{"filter":"datum.step !== 'Profit'"}]}]}
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
{"layer":[{"mark":{"type":"arc","innerRadius":70,"padAngle":0.01},"encoding":{"theta":{"field":"share","type":"quantitative","stack":true},"color":{"field":"item","type":"nominal","sort":null},"order":{"field":"share","sort":"descending"}}},{"data":{"values":[{}]},"mark":{"type":"text","fontSize":22,"fontWeight":500},"encoding":{"text":{"value":"€4.2M"}}}]}
```

### Radial (rose) chart — `radial` (vega-lite)

Cyclical categories such as months or directions.

Row shape (2 of 12 rows): `[{"month":"Jan","rain_mm":75},{"month":"Feb","rain_mm":76}]`

```json
{"mark":{"type":"arc","stroke":"theme:background","strokeWidth":1},"encoding":{"theta":{"field":"month","type":"nominal","sort":null},"radius":{"field":"rain_mm","type":"quantitative","scale":{"type":"sqrt","zero":true,"rangeMin":20}},"color":{"field":"rain_mm","type":"quantitative","legend":null}}}
```

### Funnel — `funnel` (echarts)

Drop-off through ordered stages.

```json
{"series":[{"type":"funnel","left":"10%","width":"80%","sort":"descending","gap":2,"label":{"show":true,"position":"inside","formatter":"{b}  {c}"},"data":[{"name":"Visited","value":10000},{"name":"Viewed product","value":6200},{"name":"Added to basket","value":2400},{"name":"Checkout","value":1300},{"name":"Paid","value":980}]}]}
```

### Gauge — `gauge` (echarts)

One KPI against its range, for dashboards. **Avoid:** Several KPIs: use bullet charts.

Tested at width 400, height 320.

```json
{"series":[{"type":"gauge","min":99,"max":100,"splitNumber":4,"startAngle":210,"endAngle":-30,"radius":"82%","progress":{"show":true,"width":14},"axisLine":{"lineStyle":{"width":14}},"pointer":{"show":false},"axisTick":{"show":false},"splitLine":{"show":false},"axisLabel":{"distance":22,"fontSize":11},"detail":{"formatter":"{value}%","fontSize":28,"offsetCenter":[0,"4%"]},"title":{"offsetCenter":[0,"34%"]},"data":[{"value":99.94,"name":"Uptime"}]}]}
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
{"encoding":{"x":{"field":"date","type":"temporal","title":null}},"layer":[{"mark":{"type":"area","opacity":0.25},"encoding":{"y":{"field":"low","type":"quantitative","title":"Units per day"},"y2":{"field":"high"}}},{"mark":"line","encoding":{"y":{"field":"forecast","type":"quantitative"}}}]}
```

### Slope chart — `slope` (vega-lite)

Change between two moments for several items.

Row shape (2 of 8 rows): `[{"brand":"Alpha","year":"2023","share":0.31},{"brand":"Alpha","year":"2024","share":0.29}]`

Tested at width 320, height 360.

```json
{"encoding":{"x":{"field":"year","type":"ordinal","axis":{"labelAngle":0},"title":null},"y":{"field":"share","type":"quantitative","axis":{"format":".0%"},"title":"Market share"},"color":{"field":"brand","type":"nominal","legend":null}},"layer":[{"mark":{"type":"line","point":true}},{"mark":{"type":"text","align":"left","dx":8},"encoding":{"text":{"field":"brand"}},"transform":[{"filter":"datum.year === '2024'"}]}]}
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
{"encoding":{"x":{"field":"date","type":"temporal","timeUnit":"yearmonth","title":null}},"layer":[{"mark":{"type":"bar","opacity":0.8},"encoding":{"y":{"field":"orders","type":"quantitative","title":"Orders"}}},{"mark":{"type":"line","color":"theme:categorical.1","strokeWidth":3},"encoding":{"y":{"field":"basket_eur","type":"quantitative","title":"Average basket (€)","axis":{"titleColor":"theme:categorical.1"}}}}],"resolve":{"scale":{"y":"independent"}}}
```

### Small multiples (facet) — `small_multiples` (vega-lite)

Many series: one small chart each, same scales.

Row shape (2 of 48 rows): `[{"date":"2024-01-01","region":"North","signups":900},{"date":"2024-02-01","region":"North","signups":1018}]`

```json
{"facet":{"field":"region","type":"nominal","title":null},"columns":2,"spec":{"width":240,"height":120,"mark":"area","encoding":{"x":{"field":"date","type":"temporal","title":null,"axis":{"format":"%b"}},"y":{"field":"signups","type":"quantitative","title":"Sign-ups"}}}}
```

### Calendar heatmap — `calendar_heatmap` (echarts)

Daily values over a year, where weekday patterns matter.

Row shape (2 of 366 rows): `[{"date":"2024-01-01","commits":3},{"date":"2024-01-02","commits":5}]`

Tested at width 820, height 220.

```json
{"visualMap":{"min":0,"max":14,"orient":"horizontal","left":"center","bottom":4,"itemHeight":120,"calculable":false},"calendar":{"range":"2024","cellSize":["auto",14],"left":64,"right":24},"series":[{"type":"heatmap","coordinateSystem":"calendar","encode":{"time":"date","value":"commits"}}]}
```

### Candlestick — `candlestick` (echarts)

Open, high, low and close per period.

Row shape (2 of 30 rows): `[{"date":"2024-03-01","open":100,"close":102.5,"low":98.8,"high":103.6},{"date":"2024-03-02","open":104.75,"close":103.43,"low":101.83,"high":106.15}]`

```json
{"xAxis":{"type":"category","axisLabel":{"interval":4}},"yAxis":{"type":"value","scale":true,"name":"€"},"series":[{"type":"candlestick","encode":{"x":"date","y":["open","close","low","high"]}}]}
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

## hierarchy

### Treemap — `treemap` (vega)

Sizes within a hierarchy (budget, disk use).

Row shape (2 of 15 rows): `[{"id":"root","parent":null,"name":"Company","size":0,"group":"Company"},{"id":"Product","parent":"root","name":"Product","size":0,"group":"Product"}]`

```json
{"autosize":"pad","data":[{"name":"table"},{"name":"tree","source":"table","transform":[{"type":"stratify","key":"id","parentKey":"parent"},{"type":"treemap","field":"size","sort":{"field":"value","order":"descending"},"round":true,"method":"squarify","paddingInner":2,"paddingOuter":0,"size":[{"signal":"width"},{"signal":"height"}]}]},{"name":"leaves","source":"tree","transform":[{"type":"filter","expr":"!datum.children"}]}],"scales":[{"name":"color","type":"ordinal","domain":{"data":"leaves","field":"group","sort":true},"range":"category"}],"marks":[{"type":"rect","from":{"data":"leaves"},"encode":{"enter":{"fill":{"scale":"color","field":"group"},"stroke":{"signal":"background"}},"update":{"x":{"field":"x0"},"y":{"field":"y0"},"x2":{"field":"x1"},"y2":{"field":"y1"}}}},{"type":"text","from":{"data":"leaves"},"encode":{"enter":{"text":{"signal":"datum.name + ' · ' + datum.size"},"fontSize":{"value":11},"fill":{"signal":"luminance(scale('color', datum.group)) > 0.45 ? '#111111' : '#FFFFFF'"}},"update":{"x":{"signal":"datum.x0 + 6"},"y":{"signal":"datum.y0 + 16"},"limit":{"signal":"datum.x1 - datum.x0 - 10"},"opacity":{"signal":"datum.y1 - datum.y0 > 22 && datum.x1 - datum.x0 > 36 ? 1 : 0"}}}}],"legends":[{"fill":"color","orient":"bottom","direction":"horizontal","title":"Department"}]}
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
{"mark":{"type":"line","point":true},"encoding":{"x":{"field":"unemployment","type":"quantitative","axis":{"format":".1%"},"scale":{"zero":false},"title":"Unemployment"},"y":{"field":"inflation","type":"quantitative","axis":{"format":".0%"},"title":"Inflation"},"order":{"field":"year"}}}
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
{"params":[{"name":"brush","select":"interval"}],"mark":{"type":"point","filled":true},"encoding":{"x":{"field":"spend_k","type":"quantitative","title":"Spend (€k)"},"y":{"field":"conversions","type":"quantitative","title":"Conversions"},"color":{"condition":{"param":"brush","field":"channel","type":"nominal"},"value":"theme:grid"}}}
```

## flow

### Sankey diagram — `sankey` (echarts)

Volumes flowing between stages or categories. **Avoid:** Cycles: a Sankey flows one way.

Tested at width 640, height 360.

```json
{"series":[{"type":"sankey","nodeGap":12,"label":{"position":"right"},"data":[{"name":"Search"},{"name":"Social"},{"name":"Referral"},{"name":"Trial"},{"name":"Paid"},{"name":"Churned"}],"links":[{"source":"Search","target":"Trial","value":520},{"source":"Social","target":"Trial","value":310},{"source":"Referral","target":"Trial","value":170},{"source":"Trial","target":"Paid","value":410},{"source":"Trial","target":"Churned","value":590}]}]}
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
{"autosize":"pad","data":[{"name":"node-data","values":[{"index":0,"name":"Ana","team":"Data"},{"index":1,"name":"Ben","team":"Web"},{"index":2,"name":"Chloe","team":"Ops"},{"index":3,"name":"Dev","team":"Data"},{"index":4,"name":"Eva","team":"Web"},{"index":5,"name":"Finn","team":"Ops"},{"index":6,"name":"Gus","team":"Data"},{"index":7,"name":"Hana","team":"Web"},{"index":8,"name":"Ivo","team":"Ops"},{"index":9,"name":"Jun","team":"Data"}]},{"name":"link-data","values":[{"source":0,"target":1},{"source":0,"target":2},{"source":1,"target":2},{"source":2,"target":3},{"source":3,"target":4},{"source":4,"target":5},{"source":5,"target":6},{"source":6,"target":3},{"source":7,"target":8},{"source":8,"target":9},{"source":9,"target":7},{"source":0,"target":7},{"source":4,"target":8}]}],"scales":[{"name":"color","type":"ordinal","domain":{"data":"node-data","field":"team","sort":true},"range":"category"}],"marks":[{"name":"nodes","type":"symbol","zindex":1,"from":{"data":"node-data"},"encode":{"enter":{"fill":{"scale":"color","field":"team"},"stroke":{"signal":"background"},"strokeWidth":{"value":1.5},"size":{"value":260}}},"transform":[{"type":"force","iterations":300,"static":true,"signal":"force","forces":[{"force":"center","x":{"signal":"width / 2"},"y":{"signal":"height / 2"}},{"force":"collide","radius":14},{"force":"nbody","strength":-60},{"force":"link","links":"link-data","distance":60}]}]},{"type":"path","from":{"data":"link-data"},"interactive":false,"encode":{"update":{"stroke":{"value":"theme:axis"},"strokeWidth":{"value":1.2}}},"transform":[{"type":"linkpath","require":{"signal":"force"},"shape":"line","sourceX":"datum.source.x","sourceY":"datum.source.y","targetX":"datum.target.x","targetY":"datum.target.y"}]},{"type":"text","from":{"data":"nodes"},"zindex":2,"encode":{"update":{"x":{"field":"x"},"y":{"field":"y","offset":-14},"text":{"field":"datum.name"},"align":{"value":"center"},"fontSize":{"value":11}}}}],"legends":[{"fill":"color","orient":"bottom-right","title":"Team"}]}
```

## map

### World choropleth — `choropleth_world` (vega-lite)

A rate by country. Join on iso_a3, iso_a2 or name from the bundled world-110m atlas. **Avoid:** Totals (bigger countries dominate): map rates, or use a bubble map.

Row shape (2 of 25 rows): `[{"iso":"USA","users_share":0.92},{"iso":"CAN","users_share":0.93}]`

Tested at width 640, height 340.

```json
{"data":{"atlas":"world-110m"},"projection":{"type":"equalEarth"},"transform":[{"lookup":"properties.iso_a3","from":{"data":{"name":"table"},"key":"iso","fields":["users_share"]}}],"mark":{"type":"geoshape"},"encoding":{"color":{"field":"users_share","type":"quantitative","legend":{"format":".0%"},"title":"Internet users","condition":{"test":"datum.users_share == null","value":"theme:grid"}}}}
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

## text

### Word cloud — `word_cloud` (vega)

A light overview of frequent terms; never for precise comparison.

Row shape (2 of 20 rows): `[{"text":"delivery","count":96},{"text":"price","count":81}]`

Tested at width 520, height 300.

```json
{"autosize":"pad","data":[{"name":"table"}],"scales":[{"name":"color","type":"ordinal","domain":{"data":"table","field":"text"},"range":"category"}],"marks":[{"type":"text","from":{"data":"table"},"encode":{"enter":{"text":{"field":"text"},"align":{"value":"center"},"baseline":{"value":"middle"},"fill":{"scale":"color","field":"text"}}},"transform":[{"type":"wordcloud","size":[{"signal":"width"},{"signal":"height"}],"text":{"field":"text"},"rotate":{"expr":"datum.count < 20 && length(datum.text) < 6 ? 90 : 0"},"font":"theme:font","fontSize":{"field":"datum.count"},"fontWeight":"600","fontSizeRange":[12,52],"padding":3}]}]}
```
