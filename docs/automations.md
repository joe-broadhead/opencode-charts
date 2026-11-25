# Automations

Charts declares one snapshot source (`charts.state`) and no events source, so it has no cursor and no generated timer recipe. An automation refreshes a chart by
calling one of the plugin's methods; the automation owns the cadence and Charts owns the drawing.

A nightly rerender from a workspace file:

```ts
// In an OpenCode automation, one turn a day:
const checked = await tools.charts.validate({
  spec: { mark: "line", encoding: { x: { field: "month", type: "temporal" }, y: { field: "revenue", type: "quantitative" } } },
  data: { path: "data/revenue.csv" },
})
if (checked.valid) {
  const plan = await tools.charts.plan_render({ documentPath: "outputs/charts/revenue.chart.json", expectedRevision: "sha256:…" })
  await tools.charts.render({ planId: plan.planId })
}
```

- A new chart is `tools.charts.plan_render`/`render` or `plan_quick`/`quick`; a saved chart whose data changed is a new
  document, and one whose presentation changed is `plan_update`/`update`.
- `tools.charts.recommend` answers which chart fits a question, and `tools.charts.catalogue` hands out a working call.
- Charts writes local files only: schedule it when the reader wants the file, and keep the output folder inside the
  workspace.
- `access: "read-only"` lets the plans run but makes every commit fail cleanly; use `ask-changes` or `all` for a
  scheduled writer, or have the automation ask the person to confirm.

OpenCode automations are the scheduler. Do not add a cron job or a systemd timer in this repository.
