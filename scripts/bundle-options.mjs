// The esbuild inputs and options the bundle uses, shared with test/unit/notice.test.ts. The NOTICE audit builds the
// same entries with `write: false`, so the packages it checks are the packages `dist/` inlines, not a hand-kept list.
import { builtinModules } from "node:module"

// Supplied by OpenCode at runtime: these stay imports and are never inlined into dist/.
export const HOST = ["@opencode/plugin", "@opencode/plugin/*", "@opentui/core", "@opentui/solid", "solid-js", "solid-js/*"]
export const allowed = path => path.startsWith("node:") || builtinModules.includes(path) || HOST.some(name => (name.endsWith("/*") ? path.startsWith(name.slice(0, -1)) : path === name))

// The browser runtimes inlined into interactive HTML and the dashboard page. The dashboard answers to `ui`, and its
// entry file is `ui-sdk.ts`; the chart engines' entries are named after them.
export const BROWSER_RUNTIMES = ["vega", "echarts", "plot", "ui"]
export const browserEntry = (root, name) => name === "ui" ? `${root}src/browser/ui-sdk.ts` : `${root}src/browser/${name}.ts`
export const browserOptions = (root, name) => ({
  entryPoints: [browserEntry(root, name)],
  absWorkingDir: root,
  bundle: true,
  format: "iife",
  platform: "browser",
  target: "es2020",
  minify: true,
  legalComments: "none",
  outfile: `${root}dist/browser/${name}.js`,
  logLevel: "warning",
  metafile: true,
})

// The node entries and the options their builds share. The plugin and the worker are minified; the TUI part is not,
// because OpenCode cannot load the minified form of its host imports from a local-path install ("Cannot find package
// 'solid-js'"). `define` is the build's compiled-in hashes and version; the audit passes {} because it reads inputs.
export const NODE_ENTRIES = {
  index: "src/index.ts",
  renderer: "src/renderer.ts",
  "vega-worker": "src/engines/vega-worker.ts",
  tui: "src/tui.ts",
}
export const nodeOptions = (root, define) => ({
  absWorkingDir: root,
  outdir: "dist",
  bundle: true,
  splitting: false,
  format: "esm",
  platform: "node",
  target: "es2022",
  external: HOST,
  define,
  // Vega's optional node-canvas is never used (text is measured with the bundled fonts); keep it out. `cssomnom`'s
  // parser is only reached by a CSS path the chart engines never take, and its module is a large one: an empty stub
  // keeps the same exports (`parse`) without carrying it.
  alias: { canvas: `${root}scripts/empty.mjs`, "cssomnom/parse": `${root}scripts/empty.mjs` },
  keepNames: true,
  legalComments: "none",
  metafile: true,
  logLevel: "warning",
})

// Data files read by path rather than imported: the wasm and the atlases' package.json files name the packages whose
// data ships, so their licences belong in the notices too.
export const DATA_INPUTS = ["@resvg/resvg-wasm/index_bg.wasm", "world-atlas/package.json", "us-atlas/package.json", "i18n-iso-countries/package.json"]
