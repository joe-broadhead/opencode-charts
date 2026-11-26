// RD-100: the root NOTICE must carry every package dist/ inlines, with the licence text verbatim. This builds the same
// browser and node entries with the bundle's own esbuild options (`write: false`), collects the node_modules inputs the
// way scripts/build.mjs does, and checks each package's exact heading and licence text in NOTICE.
import { describe, expect, test } from "bun:test"
import { readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { build, type BuildOptions } from "esbuild"
import { BROWSER_RUNTIMES, browserOptions, DATA_INPUTS, NODE_ENTRIES, nodeOptions } from "../../scripts/bundle-options.mjs"
import { collectPackages, packageAt } from "../../scripts/notices.mjs"

const ROOT = fileURLToPath(new URL("../../", import.meta.url))
const LICENCE_FILE = /^(licen[cs]e|copying)(\.|$)/i

async function bundledInputs(): Promise<{ inputs: string[]; text: string }> {
  const inputs = new Set<string>()
  const text: string[] = []
  const collect = async (options: BuildOptions) => {
    const result = await build({ ...options, write: false })
    for (const input of Object.keys(result.metafile?.inputs ?? {})) inputs.add(input)
    for (const output of result.outputFiles ?? []) text.push(output.text)
  }
  for (const name of BROWSER_RUNTIMES) await collect(browserOptions(ROOT, name))
  const shared = nodeOptions(ROOT, {})
  await collect({ ...shared, entryPoints: { index: NODE_ENTRIES.index, renderer: NODE_ENTRIES.renderer }, splitting: true, chunkNames: "chunks/[name]-[hash]", minify: true })
  await collect({ ...shared, entryPoints: { "vega-worker": NODE_ENTRIES["vega-worker"] }, minify: true })
  await collect({ ...shared, entryPoints: { tui: NODE_ENTRIES.tui }, minify: false })
  // Read by path rather than imported; the build adds the same four inputs.
  for (const data of DATA_INPUTS) inputs.add(`node_modules/${data}`)
  return { inputs: [...inputs], text: text.join("\n") }
}

const bundle = await bundledInputs()
// zod can be carried pre-bundled inside the contract, where no node_modules/zod input exists. Its code in the output is
// the evidence that it ships, not an input named after it; with no code there is no block to assert.
const zodInBundle = bundle.text.includes("$ZodType") || bundle.text.includes("ZodError")
const packages = collectPackages(ROOT, bundle.inputs).filter(pkg => pkg.name !== "zod")
if (zodInBundle) packages.push(packageAt(join(ROOT, "node_modules", "zod")))
packages.sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version))
const notice = readFileSync(join(ROOT, "NOTICE"), "utf8")
const heading = (pkg: (typeof packages)[number]) => `## ${pkg.name} ${pkg.version} (${pkg.license})`

describe("NOTICE", () => {
  test("the audit finds the packages the bundle inlines, including the contract and yaml", () => {
    const names = packages.map(pkg => `${pkg.name}@${pkg.version}`)
    expect(names).toContain("@we-the-rebel-alliance/plugin-contract@0.0.0")
    expect(names).toContain("yaml@2.9.1")
  })

  test("the contract's block is carried even when no metafile input names it", () => {
    const contract = packages.find(pkg => pkg.name === "@we-the-rebel-alliance/plugin-contract")
    expect(contract).toBeDefined()
    expect(notice).toContain(`## @we-the-rebel-alliance/plugin-contract ${contract!.version} (MIT)`)
    expect(notice).toContain("Copyright (c) 2026 Joe Broadhead")
  })

  test("zod is carried only when its code is in the bundle", () => {
    expect(packages.some(pkg => pkg.name === "zod")).toBe(zodInBundle)
  })

  test("every inlined package has its exact heading and verbatim licence text", () => {
    for (const pkg of packages) {
      const file = readdirSync(pkg.dir).find(name => LICENCE_FILE.test(name))
      let text: string
      if (file) text = readFileSync(join(pkg.dir, file), "utf8")
      else {
        // resvg-wasm's npm package carries no licence file; the bundle ships the MPL-2.0 text kept in licenses/.
        expect(pkg.name).toBe("@resvg/resvg-wasm")
        text = readFileSync(join(ROOT, "licenses", "MPL-2.0.txt"), "utf8")
      }
      expect(notice, `${pkg.name}@${pkg.version}: NOTICE has no exact heading`).toContain(heading(pkg))
      expect(notice, `${pkg.name}@${pkg.version}: NOTICE does not carry its licence text verbatim`).toContain(`${heading(pkg)}\n\n${text.trimEnd()}`)
    }
  })

  test("NOTICE has no package heading the bundle does not inline", () => {
    const found = [...notice.matchAll(/^## (\S+) (\S+) \(([^()]+)\)$/gm)].map(match => `## ${match[1]} ${match[2]} (${match[3]})`)
    expect(found.sort()).toEqual(packages.map(heading).sort())
  })
})
