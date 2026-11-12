// Builds what the host loads, each file self-contained:
//   dist/index.js         the plugin (Vega, Vega-Lite, ECharts, resvg's loader, hyparquet and zod bundled in)
//   dist/tui.js           the terminal UI part: the status dialog, with the status model and the RPC contract inlined
//   dist/vega-worker.js   the thread Vega renders in, with a time and memory limit
//   dist/resvg.wasm       the PNG rasteriser
//   dist/browser/*.js     the runtimes inlined into interactive HTML (never loaded by the plugin itself)
// OpenCode supplies @opencode/plugin at runtime, so it stays an import; the build fails if an output imports
// anything else. The wasm and browser runtimes are data files read by path: their SHA-256 is compiled into
// index.js, so a stale or swapped sibling is refused rather than used.
import { createHash } from "node:crypto"
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { builtinModules } from "node:module"
import { build } from "esbuild"

const ROOT = fileURLToPath(new URL("../", import.meta.url))
const HOST = ["@opencode/plugin", "@opencode/plugin/*", "@opentui/core", "@opentui/solid", "solid-js", "solid-js/*"]
const allowed = path => path.startsWith("node:") || builtinModules.includes(path) || HOST.some(name => (name.endsWith("/*") ? path.startsWith(name.slice(0, -1)) : path === name))
const sha256 = file => createHash("sha256").update(readFileSync(file)).digest("hex")
const kib = file => `${(statSync(file).size / 1024).toFixed(0)} KiB`
// A minified bundle writes its imports without spaces (`from"x"`, `import{a}`). The TUI part must keep them plain.
const MINIFIED_IMPORT = /\bfrom"|\bimport[{*]/

rmSync(`${ROOT}dist`, { recursive: true, force: true })
mkdirSync(`${ROOT}dist/browser`, { recursive: true })

// 1. Browser runtimes for interactive HTML, from their entry files in src/browser/. The ECharts one registers the
//    browser half of src/runtime-support.ts's module table; the Vega one carries vega-interpreter (released from the
//    same Vega commit as vega 6.4.0), so the page evaluates expressions without generating code.
const browserHashes = {}
const bundledInputs = new Set()
for (const name of ["vega", "echarts"]) {
  const outfile = `${ROOT}dist/browser/${name}.js`
  const r = await build({ entryPoints: [`${ROOT}src/browser/${name}.ts`], absWorkingDir: ROOT, bundle: true, format: "iife", platform: "browser", target: "es2020", minify: true, legalComments: "none", outfile, logLevel: "warning", metafile: true })
  for (const input of Object.keys(r.metafile.inputs)) bundledInputs.add(input)
  browserHashes[name] = sha256(outfile)
}

// 2. resvg's wasm.
copyFileSync(`${ROOT}node_modules/@resvg/resvg-wasm/index_bg.wasm`, `${ROOT}dist/resvg.wasm`)

// 3. The plugin, its worker and the TUI part. The plugin and worker are minified; the TUI part is not, because OpenCode
//    cannot load the minified form of its host imports from a local-path install ("Cannot find package 'solid-js'").
const shared = {
  absWorkingDir: ROOT,
  outdir: "dist",
  bundle: true,
  splitting: false,
  format: "esm",
  platform: "node",
  target: "es2022",
  external: HOST,
  define: { RESVG_WASM_SHA256: JSON.stringify(sha256(`${ROOT}dist/resvg.wasm`)), BROWSER_RUNTIME_SHA256: JSON.stringify(browserHashes) },
  // Vega's optional node-canvas is never used (text is measured with the bundled fonts); keep it out.
  alias: { canvas: `${ROOT}scripts/empty.mjs` },
  keepNames: true,
  legalComments: "none",
  metafile: true,
  logLevel: "warning",
}
// Minified: the bundle carries three chart engines; names stay so stack traces still read.
const plugin = await build({ ...shared, entryPoints: { index: "src/index.ts", "vega-worker": "src/engines/vega-worker.ts" }, minify: true })
const tui = await build({ ...shared, entryPoints: { tui: "src/tui.ts" }, minify: false })
const metafiles = [plugin.metafile, tui.metafile]
for (const metafile of metafiles) for (const input of Object.keys(metafile.inputs)) bundledInputs.add(input)
if (MINIFIED_IMPORT.test(readFileSync(`${ROOT}dist/tui.js`, "utf8"))) throw new Error("build: dist/tui.js is minified. OpenCode cannot load its host imports from a local-path install, so build the TUI part with minify: false.")
for (const data of ["@resvg/resvg-wasm/index_bg.wasm", "world-atlas/package.json", "us-atlas/package.json", "i18n-iso-countries/package.json"]) bundledInputs.add(`node_modules/${data}`)
writeNotices([...bundledInputs])
const outputs = metafiles.flatMap((metafile) => Object.keys(metafile.outputs)).sort()
if (outputs.join() !== "dist/index.js,dist/tui.js,dist/vega-worker.js") throw new Error(`build: expected dist/index.js, dist/tui.js and dist/vega-worker.js, got ${outputs.join(", ")}.`)
const unexpected = metafiles.flatMap((metafile) => Object.entries(metafile.outputs)).flatMap(([file, output]) => output.imports.filter(entry => !allowed(entry.path)).map(entry => `${file}: ${entry.path}`))
if (unexpected.length > 0) throw new Error(`build: outputs import modules the host does not supply:\n  ${unexpected.join("\n  ")}`)
for (const file of ["dist/index.js", "dist/tui.js", "dist/vega-worker.js", "dist/resvg.wasm", "dist/browser/vega.js", "dist/browser/echarts.js"]) console.log(`built ${file} (${kib(`${ROOT}${file}`)})`)

// THIRD_PARTY_NOTICES.md and licenses/: every package any output bundles, with its licence text, and the bundled
// fonts and data. Regenerated by every build, so it cannot drift from what ships.
function writeNotices(inputs) {
  const packages = new Map()
  for (const input of inputs) {
    // The innermost package: npm nests a second version (echarts' own tslib) under its dependant's node_modules.
    const m = /^(?:.*?\/)??(node_modules\/(?:.*\/node_modules\/)?(?:@[^/]+\/)?[^/]+)\//.exec(input)
    if (!m) continue
    const dir = `${ROOT}${m[1]}`
    const pkg = JSON.parse(readFileSync(`${dir}/package.json`, "utf8"))
    packages.set(`${pkg.name}@${pkg.version}`, { name: pkg.name, version: pkg.version, license: typeof pkg.license === "string" ? pkg.license : pkg.license?.type ?? "SEE LICENSE", dir, repo: typeof pkg.repository === "string" ? pkg.repository : pkg.repository?.url ?? "" })
  }
  rmSync(`${ROOT}licenses/packages`, { recursive: true, force: true })
  mkdirSync(`${ROOT}licenses/packages`, { recursive: true })
  const rows = []
  for (const p of [...packages.values()].sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version))) {
    const file = readdirSync(p.dir).find(f => /^(licen[cs]e|copying)(\.|$)/i.test(f))
    const target = `licenses/packages/${p.name.replace("/", "__")}@${p.version}.txt`
    if (file) copyFileSync(`${p.dir}/${file}`, `${ROOT}${target}`)
    const notice = readdirSync(p.dir).find(f => /^notice(\.|$)/i.test(f))
    if (notice) copyFileSync(`${p.dir}/${notice}`, `${ROOT}${target.replace(/\.txt$/, ".NOTICE.txt")}`)
    // resvg-wasm's npm package carries no licence file: the MPL-2.0 text is kept in licenses/, and MPL asks that
    // the Source Code Form be available: it is github.com/thx/resvg-js at the same version (the wasm is built from it).
    const text = file ? target : p.license === "MPL-2.0" ? "licenses/MPL-2.0.txt (source: github.com/thx/resvg-js, tag v" + p.version + ")" : "(no licence file in the package)"
    rows.push(`| ${p.name} | ${p.version} | ${p.license} | ${text} |`)
  }
  writeFileSync(`${ROOT}THIRD_PARTY_NOTICES.md`, `# Third-party notices

The published package bundles the code below into \`dist/\` (generated by \`npm run build\` from the bundler's
own list of inputs). Each licence text is in \`licenses/packages/\`.

| Package | Version | Licence | Text |
|---|---|---|---|
${rows.join("\n")}

## Fonts (assets/fonts/)

Subset to Latin, Greek and Cyrillic with OpenType layout features removed, so text widths are exact. Each is under
the SIL Open Font License 1.1; the licence travels beside the font. Reserved Font Names are not used for the subsets'
file names beyond the family name, as the OFL allows for unmodified-name subsets distributed with their licence.

| Font | Source | Licence |
|---|---|---|
| Inter 4.1 (Regular, SemiBold) | github.com/rsms/inter | OFL-1.1, assets/fonts/Inter-OFL.txt |
| JetBrains Mono 2.304 (Regular) | github.com/JetBrains/JetBrainsMono | OFL-1.1, assets/fonts/JetBrainsMono-OFL.txt |

## Data (assets/data/)

| Data | Source | Licence |
|---|---|---|
| world-110m, world-land-110m | world-atlas 2.0.2 (Natural Earth, public domain) | ISC, licenses/packages/world-atlas@2.0.2.txt |
| us-states-10m | us-atlas 3.0.1 (US Census Bureau, public domain) | ISC, licenses/packages/us-atlas@3.0.1.txt |
| ISO 3166 codes added to world-110m | i18n-iso-countries 7.14.0 (build time only) | MIT |
| Number and time locales | d3-format 3.1.0, d3-time-format 4.1.0 | ISC |
`)
}
