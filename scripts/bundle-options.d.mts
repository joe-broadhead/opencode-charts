// Types for scripts/bundle-options.mjs, imported by test/unit/notice.test.ts.
import type { BuildOptions } from "esbuild"

export const HOST: string[]
export const allowed: (path: string) => boolean
export const BROWSER_RUNTIMES: string[]
export function browserEntry(root: string, name: string): string
export function browserOptions(root: string, name: string): BuildOptions
export const NODE_ENTRIES: {
  index: string
  renderer: string
  "vega-worker": string
  tui: string
}
export function nodeOptions(root: string, define: Record<string, string>): BuildOptions
export const DATA_INPUTS: string[]
