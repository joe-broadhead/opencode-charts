import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import type { BoardLocale } from "../src/board/cube.ts"
import type { Environment } from "../src/pipeline.ts"

export const ROOT = resolve(import.meta.dir, "..")

/** A fresh workspace in the temp folder, removed by `cleanup`. */
export function workspace(): { dir: string; env: Environment; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), "charts-test-"))
  return { dir, env: { workspace: { directory: dir }, packageRoot: ROOT, configuredThemes: {}, defaults: { outDir: "outputs/charts" } }, cleanup: () => rmSync(dir, { recursive: true, force: true }) }
}

export const BAR = { mark: "bar", encoding: { x: { field: "region", type: "nominal" }, y: { field: "revenue", type: "quantitative", title: "Revenue (€k)" } } }
export const ROWS = [{ region: "North", revenue: 120 }, { region: "South", revenue: 80 }, { region: "East", revenue: 95 }, { region: "West", revenue: 40 }]

/**
 * An SVG as it must compare across platforms: a floating-point result can differ in its last digits (the runtime's
 * Math.sin and Math.atan2 come from the platform), and the id prefix hashes the content, so both are set aside.
 */
export const portable = (svg: string) =>
  svg
    .replace(/\bc[0-9a-f]{8}-(\d+)/g, "c-$1")
    .replace(/-?\d+\.\d+(?:e[-+]?\d+)?/g, n => String(Number(Number(n).toPrecision(10))))

/** The locale a board fixture formats its KPIs with, as `en-US` resolves it. */
export const BOARD_LOCALE: BoardLocale = { id: "en-US", number: { decimal: ".", thousands: ",", grouping: [3], currency: ["$", ""] } }

export const BOARD_REGIONS = ["North", "South", "East", "West"]
export const BOARD_SEGMENTS = ["Consumer", "Enterprise", "SMB"]
export const BOARD_MONTHS = ["2026-01-01", "2026-02-01", "2026-03-01", "2026-04-01", "2026-05-01", "2026-06-01"]

/** Six months of sales across four regions and three segments, the rows every board test reads. */
export function boardRows(): Record<string, unknown>[] {
  const rows: Record<string, unknown>[] = []
  let n = 0
  for (const month of BOARD_MONTHS) for (const region of BOARD_REGIONS) for (const segment of BOARD_SEGMENTS) {
    rows.push({ month, region, segment, channel: n % 2 === 0 ? "Web" : "App", revenue: 40 + ((n * 37) % 160), orders: 5 + ((n * 13) % 40) })
    n += 1
  }
  return rows
}

/** A complete board document: two datasets, four filters, four KPIs, four panels across two tabs. */
export function boardDocument(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    version: 1,
    title: "Revenue overview",
    subtitle: "Monthly revenue by region and segment",
    kicker: "FY 2026",
    source: "Sales extract",
    datasets: {
      sales: { rows: boardRows() },
      // A second dataset with its own fields: the region and segment filters say nothing about it.
      channels: { rows: [{ channel: "Web", revenue: 640 }, { channel: "App", revenue: 480 }] },
    },
    filters: [
      { id: "region", label: "Region", field: "region", control: "segmented", defaultValue: "North" },
      { id: "segment", label: "Segment", field: "segment", control: "chips" },
      { id: "revenue", label: "Revenue up to", field: "revenue", control: "range" },
      { id: "search", label: "Search", field: "*", control: "search" },
    ],
    kpis: [
      { id: "revenue", label: "Total revenue", dataset: "sales", field: "revenue", aggregate: "sum", format: "currency", delta: { value: 12.4, label: "vs last year" }, sparkline: { x: "month", y: "revenue" } },
      { id: "orders", label: "Rows", dataset: "sales", aggregate: "count", format: "integer" },
      { id: "average", label: "Average revenue", dataset: "sales", field: "revenue", aggregate: "mean", format: "number", decimals: 1 },
      { id: "median", label: "Median revenue", dataset: "sales", field: "revenue", aggregate: "median", format: "compact" },
    ],
    panels: [
      { id: "trend", title: "Revenue by month", subtitle: "Summed per month", dataset: "sales", tab: "overview", span: 8, height: 300, chart: { quick: { type: "line", x: "month", y: "revenue", aggregate: "sum" } } },
      { id: "share", title: "Revenue by segment", dataset: "sales", tab: "overview", span: 4, height: 300, chart: { quick: { type: "bar", x: "segment", y: "revenue", aggregate: "sum", color: "segment", sort: true } } },
      {
        id: "channel",
        title: "Revenue by channel",
        dataset: "channels",
        tab: "detail",
        span: 6,
        height: 300,
        chart: { engine: "echarts", spec: { series: [{ type: "pie", radius: ["38%", "68%"], encode: { itemName: "channel", value: "revenue" } }] } },
      },
      { id: "table", title: "Rows", dataset: "sales", tab: "detail", span: 6, height: 300, chart: { kind: "table", columns: [{ field: "month", label: "Month" }, { field: "region", label: "Region" }, { field: "segment", label: "Segment" }, { field: "revenue", label: "Revenue", format: "currency" }, { field: "orders", label: "Orders" }], limit: 8 } },
    ],
    tabs: [
      { id: "overview", label: "Overview" },
      { id: "detail", label: "Detail" },
    ],
    ...overrides,
  }
}
