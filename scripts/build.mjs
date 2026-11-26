// Builds what the host loads, each file self-contained:
//   dist/index.js         the plugin's entry: its tools, schemas, settings, status and RPCs, evaluated at every start
//   dist/renderer.js      the renderer (Vega, Vega-Lite, ECharts, Plot, resvg's loader, the diagram layout, the table
//                         and dashboard builders, hyparquet), which index.js imports on the first call that needs it
//   dist/chunks/*.js      code index.js and renderer.js share, and the renderer's own on-demand parts
//   dist/tui.js           the terminal UI part: the status dialog, with the status model and the RPC contract inlined
//   dist/vega-worker.js   the thread Vega renders in, with a time and memory limit
//   dist/resvg.wasm       the PNG rasteriser
//   dist/browser/*.js     the runtimes inlined into interactive HTML and the dashboard page: vega, echarts, plot, ui
//                         (never loaded by the plugin itself)
// OpenCode supplies @opencode/plugin at runtime, so it stays an import; the build fails if an output imports
// anything else. The wasm and browser runtimes are data files read by path: their SHA-256 is compiled into
// index.js, so a stale or swapped sibling is refused rather than used.
import { createHash } from "node:crypto"
import { copyFileSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { build } from "esbuild"
import { allowed, BROWSER_RUNTIMES, browserOptions, DATA_INPUTS, NODE_ENTRIES, nodeOptions } from "./bundle-options.mjs"
import { collectPackages, notice, thirdPartyNotices, writeLicenceFiles } from "./notices.mjs"

const ROOT = fileURLToPath(new URL("../", import.meta.url))
const sha256 = file => createHash("sha256").update(readFileSync(file)).digest("hex")
const kib = file => `${(statSync(file).size / 1024).toFixed(0)} KiB`
// A minified bundle writes its imports without spaces (`from"x"`, `import{a}`). The TUI part must keep them plain.
const MINIFIED_IMPORT = /\bfrom"|\bimport[{*]/

rmSync(`${ROOT}dist`, { recursive: true, force: true })
mkdirSync(`${ROOT}dist/browser`, { recursive: true })

// 1. Browser runtimes for interactive HTML and the dashboard page, from their entry files in src/browser/. The ECharts
//    one registers the browser half of src/runtime-support.ts's module table; the Vega one carries vega-interpreter
//    (released from the same Vega commit as vega 6.4.0), so the page evaluates expressions without generating code;
//    Plot answers the pointer itself (`tip: true`); and the dashboard runtime is the dashboard controller.
// The dashboard answers to `ui`, and its entry file is `ui-sdk.ts`; the chart engines' entries are named after them.
const browserHashes = {}
const bundledInputs = new Set()
for (const name of BROWSER_RUNTIMES) {
  const outfile = `${ROOT}dist/browser/${name}.js`
  const r = await build(browserOptions(ROOT, name))
  for (const input of Object.keys(r.metafile.inputs)) bundledInputs.add(input)
  browserHashes[name] = sha256(outfile)
}

// 2. resvg's wasm.
copyFileSync(`${ROOT}node_modules/@resvg/resvg-wasm/index_bg.wasm`, `${ROOT}dist/resvg.wasm`)

// 3. The tool table (src/tool-table.ts): each tool's name, class, description and JSON Schemas. The build evaluates
//    src/tool-table-source.ts once, from a bundle of it held in memory, and compiles the result into the plugin in that
//    module's place, so an engine start reads plain data and never builds the registry's zod schemas.
//    test/lazy-start.test.ts checks the compiled table equals the registry's.
const tableBundle = await build({ absWorkingDir: ROOT, entryPoints: ["src/tool-table-source.ts"], bundle: true, write: false, format: "esm", platform: "node", target: "es2022", alias: { canvas: `${ROOT}scripts/empty.mjs`, "cssomnom/parse": `${ROOT}scripts/empty.mjs` }, logLevel: "warning" })
const toolTable = (await import(`data:text/javascript;base64,${Buffer.from(tableBundle.outputFiles[0].text).toString("base64")}`)).toolTable()
const builtToolTable = {
  name: "built-tool-table",
  setup(b) {
    b.onResolve({ filter: /^\.\/tool-table-source\.js$/ }, (args) => (/[\\/]src[\\/]tool-table\.ts$/.test(args.importer) ? { path: "tool-table", namespace: "built-tool-table" } : undefined))
    b.onLoad({ filter: /.*/, namespace: "built-tool-table" }, () => ({ contents: `export const toolTable = () => JSON.parse(${JSON.stringify(JSON.stringify(toolTable))})\n`, loader: "js" }))
  },
}

// 4. The plugin, its worker and the TUI part. The plugin and worker are minified; the TUI part is not, because OpenCode
//    cannot load the minified form of its host imports from a local-path install ("Cannot find package 'solid-js'").
const shared = nodeOptions(ROOT, { RESVG_WASM_SHA256: JSON.stringify(sha256(`${ROOT}dist/resvg.wasm`)), BROWSER_RUNTIME_SHA256: JSON.stringify(browserHashes), RESVG_VERSION: JSON.stringify(JSON.parse(readFileSync(`${ROOT}node_modules/@resvg/resvg-wasm/package.json`, "utf8")).version) })
// Minified: the bundle carries the chart engines; names stay so stack traces still read. The plugin is split: index.js
// is what an engine start evaluates, and renderer.js, with every engine, is a second entry that index.js reaches only
// through its one dynamic import (src/renderer-load.ts), so the first call pays for the engines and a start does not.
// Code both use goes to dist/chunks/, so each module is evaluated once. The worker stays one file of its own.
// The YAML parser is CommonJS and reads `process` with require(); the plugin is ESM, so give the entry a real require.
const requireBanner = { js: `import { createRequire } from "node:module";\nconst require = createRequire(import.meta.url);` }
const plugin = await build({ ...shared, entryPoints: { index: NODE_ENTRIES.index, renderer: NODE_ENTRIES.renderer }, splitting: true, chunkNames: "chunks/[name]-[hash]", plugins: [builtToolTable], banner: requireBanner, minify: true })
const worker = await build({ ...shared, entryPoints: { "vega-worker": NODE_ENTRIES["vega-worker"] }, minify: true })
const tui = await build({ ...shared, entryPoints: { tui: NODE_ENTRIES.tui }, minify: false })
const metafiles = [plugin.metafile, worker.metafile, tui.metafile]
for (const metafile of metafiles) for (const input of Object.keys(metafile.inputs)) bundledInputs.add(input)
if (MINIFIED_IMPORT.test(readFileSync(`${ROOT}dist/tui.js`, "utf8"))) throw new Error("build: dist/tui.js is minified. OpenCode cannot load its host imports from a local-path install, so build the TUI part with minify: false.")
for (const data of DATA_INPUTS) bundledInputs.add(`node_modules/${data}`)
writeNotices([...bundledInputs])
const outputs = metafiles.flatMap((metafile) => Object.keys(metafile.outputs)).sort()
const named = outputs.filter(file => !file.startsWith("dist/chunks/"))
if (named.join() !== "dist/index.js,dist/renderer.js,dist/tui.js,dist/vega-worker.js") throw new Error(`build: expected dist/index.js, dist/renderer.js, dist/tui.js and dist/vega-worker.js besides dist/chunks/, got ${named.join(", ")}.`)
// The plugin's own files import each other (its chunks); every other import is a builtin or a host package.
const own = new Set(Object.keys(plugin.metafile.outputs))
const unexpected = metafiles.flatMap((metafile) => Object.entries(metafile.outputs)).flatMap(([file, output]) => output.imports.filter(entry => !allowed(entry.path) && !(own.has(file) && own.has(entry.path))).map(entry => `${file}: ${entry.path}`))
// Only the plugin is split: the TUI part and the worker are one file each.
for (const [file, output] of [worker, tui].flatMap((result) => Object.entries(result.metafile.outputs))) if (output.imports.some(entry => entry.path.startsWith("dist/"))) throw new Error(`build: ${file} imports another dist/ file; it must stand alone.`)
// index.js reaches the renderer only by its dynamic import, never statically: a static path would evaluate the engines
// at every start again.
const eager = new Set(["dist/index.js"])
for (const queue = ["dist/index.js"]; queue.length;) for (const entry of plugin.metafile.outputs[queue.shift()].imports) if (entry.kind === "import-statement" && own.has(entry.path) && !eager.has(entry.path)) { eager.add(entry.path); queue.push(entry.path) }
if (eager.has("dist/renderer.js")) throw new Error("build: dist/index.js imports dist/renderer.js statically; it must load it on first use.")
const eagerBytes = [...eager].reduce((sum, file) => sum + plugin.metafile.outputs[file].bytes, 0)
if (unexpected.length > 0) throw new Error(`build: outputs import modules the host does not supply:\n  ${unexpected.join("\n  ")}`)
console.log(`built dist/index.js and the chunks it loads at start (${(eagerBytes / 1024).toFixed(0)} KiB); dist/renderer.js with its chunks on first use`)
for (const file of ["dist/index.js", "dist/renderer.js", "dist/tui.js", "dist/vega-worker.js", "dist/resvg.wasm", "dist/browser/vega.js", "dist/browser/echarts.js", "dist/browser/plot.js", "dist/browser/ui.js"]) console.log(`built ${file} (${kib(`${ROOT}${file}`)})`)

// THIRD_PARTY_NOTICES.md, NOTICE and licenses/: every package any output bundles, with its licence text, and the
// bundled fonts and data. Regenerated by every build, so it cannot drift from what ships.
function writeNotices(inputs) {
  const packages = collectPackages(ROOT, inputs)
  writeLicenceFiles(ROOT, packages)
  writeFileSync(`${ROOT}THIRD_PARTY_NOTICES.md`, thirdPartyNotices(ROOT, packages))
  writeFileSync(`${ROOT}NOTICE`, notice(readFileSync(`${ROOT}NOTICE`, "utf8"), ROOT, packages))
}
