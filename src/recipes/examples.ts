import { catalogueEntry } from "../catalogue.js"
import type { RecipeExample, RecipeId } from "./types.js"

/**
 * Executable examples: complete chart documents whose rows are the catalogue's full fixture for the same family, so a
 * recipe example and the raw catalogue example draw the same data. No row is abbreviated.
 */

type Rows = Record<string, unknown>[]
const rows = (id: string): Rows => (catalogueEntry(id)!.example().rows ?? []).map(row => ({ ...row }))

const doc = (recipe: RecipeId, data: Rows, bindings: Record<string, string>, options: Record<string, unknown> | undefined, extra: Record<string, unknown>) => ({
  version: 1,
  chart: { kind: "recipe", recipe, data: { rows: data }, bindings, ...(options ? { options } : {}) },
  ...extra,
})

const example = (name: string, description: string, document: Record<string, unknown>): RecipeExample => ({ name, description, document })

export function recipeExamples(id: RecipeId): RecipeExample[] {
  switch (id) {
    case "bar": return [
      example("bar", "Revenue per product, largest first.", doc("bar", rows("bar"), { category: "product", value: "revenue_eur" }, { sort: "value-descending", yTitle: "Revenue (€)" }, { title: "Revenue by product, 2024", currency: "EUR" })),
      example("bar-count", "Rows counted per channel: count needs no value binding.", doc("bar", rows("scatter"), { category: "channel" }, { aggregate: "count", yTitle: "Campaigns" }, { title: "Campaigns per channel" })),
    ]
    case "horizontal_bar": return [example("horizontal_bar", "Users per country, ranked.", doc("horizontal_bar", rows("horizontal_bar"), { category: "country", value: "users_k" }, { sort: "value-descending", xTitle: "Active users (thousands)" }, { title: "Active users by country" }))]
    case "grouped_bar": return [example("grouped_bar", "Quarterly revenue, one bar per quarter within each region.", doc("grouped_bar", rows("grouped_bar"), { category: "region", series: "quarter", value: "revenue_eur" }, { yTitle: "Revenue (€)" }, { title: "Quarterly revenue by region", currency: "EUR" }))]
    case "stacked_bar": return [example("stacked_bar", "Monthly orders stacked by channel.", doc("stacked_bar", rows("stacked_bar"), { category: "date", series: "series", value: "orders" }, { xTitle: "Month", yTitle: "Orders" }, { title: "Monthly orders by channel" }))]
    case "line": {
      // Two rows per month and region (a 60/40 split of the stacked-area fixture), so the sum is the fixture's value.
      const split = rows("stacked_area").flatMap(row => {
        const total = row.revenue_eur as number, first = Math.round(total * 0.6)
        return [{ month: row.date, region: row.region, channel: "Online", revenue_eur: first }, { month: row.date, region: row.region, channel: "Store", revenue_eur: total - first }]
      })
      return [
        example("line", "Daily active users over 2024.", doc("line", rows("line"), { x: "date", y: "dau" }, { xType: "temporal", yTitle: "Daily active users" }, { title: "Daily active users, 2024" })),
        example("line-sum", "Revenue by month and region, summing the two channel rows of each month.", doc("line", split, { x: "month", y: "revenue_eur", series: "region" }, { xType: "temporal", aggregate: "sum", yTitle: "Revenue (€)" }, { title: "Revenue by month and region", currency: "EUR" })),
      ]
    }
    case "area": return [example("area", "Storage used over 2024.", doc("area", rows("area"), { x: "date", y: "storage_tb" }, { xType: "temporal", yTitle: "Storage (TB)" }, { title: "Storage used" }))]
    case "stacked_area": return [example("stacked_area", "Revenue over 2024, stacked by region.", doc("stacked_area", rows("stacked_area"), { x: "date", y: "revenue_eur", series: "region" }, { xType: "temporal", yTitle: "Revenue (€)" }, { title: "Revenue by region", currency: "EUR" }))]
    case "scatter": return [example("scatter", "Spend against conversions, coloured by channel.", doc("scatter", rows("scatter"), { x: "spend_k", y: "conversions", series: "channel" }, { xTitle: "Spend (€k)", yTitle: "Conversions" }, { title: "Spend vs conversions" }))]
    case "bubble": return [example("bubble", "Spend against conversions, with customers as the bubble area.", doc("bubble", rows("bubble"), { x: "spend_k", y: "conversions", size: "customers", series: "channel" }, { xTitle: "Spend (€k)", yTitle: "Conversions" }, { title: "Campaigns: spend, conversions and reach" }))]
    case "pie": return [example("pie", "Visits per traffic source, largest slice first.", doc("pie", rows("pie"), { category: "source", value: "visits" }, { sort: "value-descending" }, { title: "Traffic sources" }))]
    case "donut": return [example("donut", "Budget shares per item, largest first.", doc("donut", rows("donut"), { category: "item", value: "share" }, { sort: "value-descending" }, { title: "Budget split" }))]
    case "histogram": return [example("histogram", "Checkout latency in at most 24 bins.", doc("histogram", rows("histogram"), { value: "latency_ms" }, { bins: 24, xTitle: "Latency (ms)", yTitle: "Requests" }, { title: "Checkout latency" }))]
    case "box_plot": return [example("box_plot", "Latency distribution per service.", doc("box_plot", rows("box_plot"), { category: "group", value: "latency_ms" }, { xTitle: "Service", yTitle: "Latency (ms)" }, { title: "Latency by service" }))]
    case "heatmap": return [example("heatmap", "Orders per weekday and hour, one cell each.", doc("heatmap", rows("heatmap"), { column: "hour", row: "day", value: "orders" }, undefined, { title: "Orders by weekday and hour" }))]
  }
}
