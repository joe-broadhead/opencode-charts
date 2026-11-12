import { catalogueEntry, exampleCall, type ExampleCall } from "../catalogue.js"
import type { RecipeExample, RecipeId } from "./types.js"

/**
 * Executable examples, built from the catalogue's exact tested calls (`exampleCall`): the same rows, title, currency
 * and locale that charts_catalogue hands out and the golden suite renders, so every surface shares one source. A
 * derived example reshapes those rows to show an option, and keeps every value. A call's width and height are not
 * carried: they size the raw spec's plot, while a document's layout sizes the outer canvas.
 */

type Rows = Record<string, unknown>[]
const call = (id: string): ExampleCall => exampleCall(catalogueEntry(id)!)
const rows = (from: ExampleCall): Rows => (from.data?.rows ?? []).map(row => ({ ...row }))

/** A document from a catalogue call: its rows, and its title, currency and locale unless `extra` overrides them. */
function fromCall(recipe: RecipeId, id: string, bindings: Record<string, string>, options: Record<string, unknown> | undefined, extra: Record<string, unknown> = {}, reshape?: (rows: Rows) => Rows) {
  const from = call(id)
  return {
    version: 1,
    chart: { kind: "recipe", recipe, data: { rows: reshape ? reshape(rows(from)) : rows(from) }, bindings, ...(options ? { options } : {}) },
    title: from.title,
    ...(from.currency ? { currency: from.currency } : {}),
    ...(from.locale ? { locale: from.locale } : {}),
    ...extra,
  }
}

const example = (name: string, description: string, catalogue: string, document: Record<string, unknown>, derived = false): RecipeExample => ({ name, description, document, source: { catalogue, derived } })

export function recipeExamples(id: RecipeId): RecipeExample[] {
  switch (id) {
    case "bar": return [
      example("bar", "Revenue per product, largest first.", "bar", fromCall("bar", "bar", { category: "product", value: "revenue_eur" }, { sort: "value-descending", yTitle: "Revenue (€)" })),
      example("bar-count", "Rows counted per channel: count needs no value binding.", "scatter", fromCall("bar", "scatter", { category: "channel" }, { aggregate: "count", yTitle: "Campaigns" }, { title: "Campaigns per channel" })),
    ]
    case "horizontal_bar": return [example("horizontal_bar", "Users per country, ranked.", "horizontal_bar", fromCall("horizontal_bar", "horizontal_bar", { category: "country", value: "users_k" }, { sort: "value-descending", xTitle: "Active users (thousands)" }))]
    case "grouped_bar": return [example("grouped_bar", "Quarterly revenue, one bar per quarter within each region.", "grouped_bar", fromCall("grouped_bar", "grouped_bar", { category: "region", series: "quarter", value: "revenue_eur" }, { yTitle: "Revenue (€)" }))]
    case "stacked_bar": return [example("stacked_bar", "Monthly orders stacked by channel.", "stacked_bar", fromCall("stacked_bar", "stacked_bar", { category: "date", series: "series", value: "orders" }, { xTitle: "Month", yTitle: "Orders" }))]
    case "line": {
      // Two rows per month and region (a 60/40 split of the stacked-area call's rows), so the sum is the original value.
      const split = (all: Rows) => all.flatMap(row => {
        const total = row.revenue_eur as number, first = Math.round(total * 0.6)
        return [{ month: row.date, region: row.region, channel: "Online", revenue_eur: first }, { month: row.date, region: row.region, channel: "Store", revenue_eur: total - first }]
      })
      return [
        example("line", "Daily active users over 2024.", "line", fromCall("line", "line", { x: "date", y: "dau" }, { xType: "temporal", yTitle: "Daily active users" })),
        example("line-sum", "Revenue by month and region, summing the two channel rows of each month.", "stacked_area", fromCall("line", "stacked_area", { x: "month", y: "revenue_eur", series: "region" }, { xType: "temporal", aggregate: "sum", yTitle: "Revenue (€)" }, { title: "Revenue by month and region" }, split), true),
      ]
    }
    case "area": return [example("area", "Storage used over 2024.", "area", fromCall("area", "area", { x: "date", y: "storage_tb" }, { xType: "temporal", yTitle: "Storage (TB)" }))]
    case "stacked_area": return [example("stacked_area", "Revenue over 2024, stacked by region.", "stacked_area", fromCall("stacked_area", "stacked_area", { x: "date", y: "revenue_eur", series: "region" }, { xType: "temporal", yTitle: "Revenue (€)" }))]
    case "scatter": return [example("scatter", "Spend against conversions, coloured by channel.", "scatter", fromCall("scatter", "scatter", { x: "spend_k", y: "conversions", series: "channel" }, { xTitle: "Spend (€k)", yTitle: "Conversions" }))]
    case "bubble": return [example("bubble", "Spend against conversions, with customers as the bubble area.", "bubble", fromCall("bubble", "bubble", { x: "spend_k", y: "conversions", size: "customers", series: "channel" }, { xTitle: "Spend (€k)", yTitle: "Conversions" }))]
    case "pie": return [example("pie", "Visits per traffic source, largest slice first.", "pie", fromCall("pie", "pie", { category: "source", value: "visits" }, { sort: "value-descending" }))]
    case "donut": return [example("donut", "Budget shares per item, largest first.", "donut", fromCall("donut", "donut", { category: "item", value: "share" }, { sort: "value-descending" }))]
    case "histogram": return [example("histogram", "Checkout latency in at most 24 bins.", "histogram", fromCall("histogram", "histogram", { value: "latency_ms" }, { bins: 24, xTitle: "Latency (ms)", yTitle: "Requests" }))]
    case "box_plot": return [example("box_plot", "Latency distribution per service.", "box_plot", fromCall("box_plot", "box_plot", { category: "group", value: "latency_ms" }, { xTitle: "Service", yTitle: "Latency (ms)" }))]
    case "heatmap": return [example("heatmap", "Orders per weekday and hour, one cell each.", "heatmap", fromCall("heatmap", "heatmap", { column: "hour", row: "day", value: "orders" }, undefined))]
  }
}
