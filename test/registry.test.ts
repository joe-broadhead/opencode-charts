import { describe, expect, test } from "bun:test"
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { capabilities } from "../src/capabilities.ts"
import { CATALOGUE } from "../src/catalogue.js"
import { KNOWN_READS, defaultRules } from "../src/permissions.js"
import { CONTRACT_VERSION, DESCRIPTORS, NAMESPACE, TOOL_NAMES, inputSchema, manifest, type ToolName } from "../src/registry.js"
import { QUICK_TYPES } from "../src/quick.js"
import { TRAITS_BY_ID } from "../src/recommend/traits.js"
import { ROOT, workspace } from "./helpers.js"

/**
 * The registry is the product: every surface is a projection of `src/registry.ts`, so a tool that exists on one and
 * not another is a defect. These tests are the conformance suite that keeps them in step (MCP Clearsight's
 * `docs/tool-parity.md` drift test, adapted).
 */

const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as { version: string; jelly: { tools: { name: string; permission: string; effect: string; readOnly: boolean }[] } }
const readme = readFileSync(join(ROOT, "README.md"), "utf8")
const parity = readFileSync(join(ROOT, "docs", "tool-parity.md"), "utf8")

describe("the registry", () => {
  test("is the only list: every surface names exactly its tools, in its order", () => {
    expect(pkg.jelly.tools.map(tool => tool.name)).toEqual(TOOL_NAMES.map(name => `${NAMESPACE}.${name}`))
    for (const tool of pkg.jelly.tools) expect(tool.permission).toBe(`${NAMESPACE}_${tool.name.split(".")[1]!}`)
    for (const descriptor of DESCRIPTORS) expect(pkg.jelly.tools.find(tool => tool.name === `${NAMESPACE}.${descriptor.name}`)?.readOnly).toBe(descriptor.readOnly)
    // Jelly's read-only helper is denied every tool that is not marked readOnly, so the flag is the same fact twice.
    expect(pkg.jelly.tools.filter(tool => tool.readOnly).map(tool => tool.permission).sort()).toEqual([...KNOWN_READS].sort())
    // Every tool is allowed by default; the read-only flag is still the one fact Jelly's helper reads.
    expect(defaultRules().filter(rule => rule.effect === "allow").map(rule => rule.action)).toContain(`${NAMESPACE}_*`)
    for (const name of KNOWN_READS) expect(defaultRules("read-only")).toContainEqual({ action: name, resource: "*", effect: "allow" })
  })

  test("gives every tool one class, one permission and a documented anchor", () => {
    for (const descriptor of DESCRIPTORS) {
      expect(["read", "export"]).toContain(descriptor.class)
      expect(descriptor.readOnly).toBe(descriptor.class === "read")
      expect(descriptor.description.length).toBeGreaterThan(40)
      expect(descriptor.description.split(" ").length).toBeLessThan(140)
    }
  })

  test("converts every input to JSON Schema, which is what the tools RPC and capabilities publish", () => {
    for (const descriptor of DESCRIPTORS) {
      const schema = inputSchema(descriptor.name as ToolName)
      expect(schema.type).toBe("object")
      expect(schema).toHaveProperty("properties")
    }
  })

  test("the chart tools take the document arms, and document is a format, on every surface's schema", () => {
    for (const name of ["render", "validate"] as const) {
      const schema = inputSchema(name) as { properties: Record<string, any>; required?: string[] }
      for (const key of ["spec", "document", "documentPath", "expectedRevision"]) expect(Object.keys(schema.properties)).toContain(key)
      // One of three arms per call, so no arm is required by the transport schema; the tool refuses a mixture.
      expect(schema.required ?? []).not.toContain("spec")
      expect(schema.properties.formats.items.enum).toEqual(["svg", "png", "html", "spec", "document"])
    }
    const quick = inputSchema("quick") as { properties: Record<string, any>; required?: string[] }
    expect(Object.keys(quick.properties)).toContain("document")
    expect(Object.keys(quick.properties)).not.toContain("documentPath")
    expect(quick.required ?? []).toEqual([])
    // The document's description lists every recipe with its bindings, from the recipe registry.
    for (const id of ["bar", "grouped_bar", "line", "bubble", "histogram", "heatmap"]) expect(String(quick.properties.document.description)).toContain(`${id}(`)
  })

  test("the chart tools' output schemas declare the document fields, with no pattern anywhere", () => {
    for (const name of ["render", "quick", "validate"] as const) {
      const output = DESCRIPTORS.find(d => d.name === name)!.output as { properties: Record<string, unknown> }
      for (const key of ["revision", "fingerprint", "source", "appearance", "categories", "size", "interactions", "adjustments", "diagnostics", "generation"]) expect(Object.keys(output.properties)).toContain(key)
      expect(JSON.stringify(output)).not.toContain('"pattern"')
    }
  })

  test("charts_update is one writer on every surface: registry, Jelly, permissions, RPC schema and parity table", () => {
    const update = DESCRIPTORS.find(d => d.name === "update")!
    expect({ class: update.class, readOnly: update.readOnly }).toEqual({ class: "export", readOnly: false })
    expect(pkg.jelly.tools.find(tool => tool.name === "charts.update")).toEqual({ name: "charts.update", permission: "charts_update", effect: "allow", readOnly: false })
    expect(KNOWN_READS).not.toContain("charts_update")
    const input = inputSchema("update") as { properties: Record<string, any>; required?: string[]; additionalProperties?: unknown }
    // The source, its revision precondition and the patch are required; the delivery fields go with them; nothing else.
    expect([...(input.required ?? [])].sort()).toEqual(["documentPath", "expectedRevision", "patch"])
    expect(Object.keys(input.properties).sort()).toEqual(["documentPath", "expectedRevision", "formats", "inspect", "marks", "name", "outDir", "patch", "scales", "svgText"])
    expect(input.additionalProperties).toBe(false)
    expect(input.properties.formats.items.enum).toEqual(["svg", "png", "html", "spec", "document"])
    for (const field of ["title", "description", "appearance", "layout", "interactions"]) expect(String(input.properties.patch.description)).toContain(`"${field}"`)
    const output = update.output as { properties: Record<string, unknown>; required: string[] }
    for (const key of ["revision", "fingerprint", "source", "appearance", "size", "interactions", "diagnostics", "update", "generation"]) expect(Object.keys(output.properties)).toContain(key)
    expect(output.required).toEqual(expect.arrayContaining(["files", "revision", "update"]))
    expect(JSON.stringify(output)).not.toContain('"pattern"')
    expect(parity).toContain("| `update` | model | export | yes | yes |")
  })

  test("README's table lists every tool once", () => {
    for (const name of TOOL_NAMES) {
      const pattern = new RegExp(`\\\`${NAMESPACE}_${name}\\\``, "g")
      expect(readme.match(pattern)?.length ?? 0, `README does not document ${NAMESPACE}_${name}`).toBeGreaterThan(0)
    }
  })

  test("docs/tool-parity.md is generated from the registry and matches it row for row", () => {
    const rows = [...parity.matchAll(/^\| `([a-z_]+)` \| ([^|]+) \| ([^|]+) \| ([^|]+) \| ([^|]+) \|$/gm)].map(m => ({ name: m[1]!, audience: m[2]!.trim(), class: m[3]!.trim(), rpc: m[4]!.trim(), Jelly: m[5]!.trim() }))
    expect(rows.map(row => row.name)).toEqual([...TOOL_NAMES])
    for (const row of rows) {
      const descriptor = DESCRIPTORS.find(d => d.name === row.name)!
      expect(row.class).toBe(descriptor.class)
      expect(row.rpc).toBe("yes")
      expect(row.Jelly).toBe("yes")
      expect(row.audience).toBe("model")
    }
  })

  test("the manifest is the registry as data, under one contract version", () => {
    const m = manifest(pkg.version)
    expect(m.contract_version).toBe(CONTRACT_VERSION)
    expect(m.tools.map(tool => tool.name)).toEqual([...TOOL_NAMES])
    for (const tool of m.tools) expect(tool.placements).toEqual(["plugin", "rpc"])
  })
})

describe("capabilities", () => {
  const ws = workspace()
  const view = capabilities(ws.env)

  test("advertises only what this build has: every format it names has its file", () => {
    expect(view.formats.svg).toBe(true)
    expect(view.formats.spec).toBe(true)
    expect(view.formats.document).toBe(true)
    expect(view.formats.png).toBe(existsSync(join(ROOT, "dist", "resvg.wasm")))
    expect(view.formats.html).toBe(existsSync(join(ROOT, "dist", "browser", "vega.js")) && existsSync(join(ROOT, "dist", "browser", "echarts.js")))
  })

  test("lists every tool with the registry's class, and the catalogue's own counts", () => {
    expect(view.tools.map(tool => tool.name)).toEqual([...TOOL_NAMES])
    for (const tool of view.tools) expect(tool.class).toBe(DESCRIPTORS.find(d => d.name === tool.name)!.class)
    expect(view.catalogue.count).toBe(CATALOGUE.length)
    expect(Object.values(view.catalogue.byFamily).reduce((a, b) => a + b, 0)).toBe(CATALOGUE.length)
    expect(Object.values(view.catalogue.byEngine).reduce((a, b) => a + b, 0)).toBe(CATALOGUE.length)
  })

  test("names the scripts the bundled fonts cover, and does not claim CJK", () => {
    expect(view.fonts.length).toBeGreaterThan(0)
    expect(view.fonts[0]!.scripts).toContain("Latin")
    expect(view.fonts[0]!.scripts).toContain("Cyrillic")
    expect(view.fonts[0]!.scripts).not.toContain("CJK")
    expect(view.knownLimits.join(" ")).toContain("CJK")
  })

  test("reports a palette it can fill, and says which entries are generated", () => {
    const light = view.themes.find(theme => theme.name === "light")!
    expect(light.categorical.published).toBeGreaterThan(4)
    expect(light.categorical.available).toBeGreaterThanOrEqual(light.categorical.published)
    expect(light.categorical.generated).toBe(light.categorical.available - light.categorical.published)
  })

  test("the quick types are a subset of the catalogue, so no tool promises a type it cannot draw", () => {
    const ids = new Set(CATALOGUE.map(entry => entry.id))
    for (const quick of QUICK_TYPES) expect(ids.has(quick)).toBe(true)
  })

  test("every catalogue entry has advice, and every trait names a real entry", () => {
    const ids = new Set(CATALOGUE.map(entry => entry.id))
    for (const entry of CATALOGUE) expect(TRAITS_BY_ID.has(entry.id), `no advice for ${entry.id}`).toBe(true)
    for (const id of TRAITS_BY_ID.keys()) expect(ids.has(id), `advice for a chart that does not exist: ${id}`).toBe(true)
  })
})
