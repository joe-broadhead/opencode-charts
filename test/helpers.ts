import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import type { Environment } from "../src/pipeline.ts"

export const ROOT = resolve(import.meta.dir, "..")

/** A fresh workspace in the temp folder, removed by `cleanup`. */
export function workspace(): { dir: string; env: Environment; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), "charts-test-"))
  return { dir, env: { workspace: { directory: dir }, packageRoot: ROOT, configuredThemes: {}, defaults: { outDir: "outputs/charts" } }, cleanup: () => rmSync(dir, { recursive: true, force: true }) }
}

export const BAR = { mark: "bar", encoding: { x: { field: "region", type: "nominal" }, y: { field: "revenue", type: "quantitative", title: "Revenue (€k)" } } }
export const ROWS = [{ region: "North", revenue: 120 }, { region: "South", revenue: 80 }, { region: "East", revenue: 95 }, { region: "West", revenue: 40 }]
