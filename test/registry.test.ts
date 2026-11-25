import { describe, expect, test } from "bun:test"
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { capabilities } from "../src/capabilities.ts"
import { CATALOGUE } from "../src/catalogue.js"
import { manifest as installed } from "../src/manifest.js"
import { CONTRACT_VERSION, DESCRIPTORS, NAMESPACE, TOOL_NAMES, inputSchema, type ToolName } from "../src/registry.js"
import { QUICK_TYPES } from "../src/quick.js"
import { TRAITS_BY_ID } from "../src/recommend/traits.js"
import { ROOT, workspace } from "./helpers.js"

/**
 * The registry is the product: every surface is a projection of `src/registry.ts`, so a tool that exists on one and
 * not another is a defect. The manifest is the registry as data; the handlers are its methods; capabilities lists it.
 */

const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as { version: string }
const methods = installed.methods

describe("the registry", () => {
  test("is the manifest's method table: every tool once, its class and its own action", () => {
    for (const descriptor of DESCRIPTORS) {
      const item = methods[descriptor.name]
      expect({ name: descriptor.name, declared: item !== undefined }).toEqual({ name: descriptor.name, declared: true })
      expect({ name: descriptor.name, class: item!.class }).toEqual({ name: descriptor.name, class: descriptor.class === "read" ? "read" : "write" })
      expect(item!.accounts).toBe("none")
      expect(item!.operations).toContain(`charts.${descriptor.name}`)
    }
    const declaredTools = Object.keys(methods).filter(name => DESCRIPTORS.some(descriptor => descriptor.name === name))
    expect(declaredTools.sort()).toEqual([...TOOL_NAMES].sort())
  })

  test("gives every tool one class, a documented anchor and a description a model can read", () => {
    for (const descriptor of DESCRIPTORS) {
      expect(["read", "write"]).toContain(descriptor.class)
      expect(descriptor.readOnly).toBe(descriptor.class === "read")
      expect(descriptor.description.length).toBeGreaterThan(40)
      expect(descriptor.description.split(" ").length).toBeLessThan(140)
    }
  })

  test("converts every input to plain JSON Schema, which the register checks against", () => {
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
      expect(schema.required ?? []).not.toContain("spec")
      expect(schema.properties.formats.items.enum).toEqual(["svg", "png", "gif", "html", "spec", "document"])
    }
    const quick = inputSchema("quick") as { properties: Record<string, any>; required?: string[] }
    expect(Object.keys(quick.properties)).toContain("document")
    expect(Object.keys(quick.properties)).not.toContain("documentPath")
    expect(quick.required ?? []).toEqual([])
    for (const id of ["bar", "grouped_bar", "line", "bubble", "histogram", "heatmap"]) expect(String(quick.properties.document.description)).toContain(`${id}(`)
  })

  test("the chart tools' output schemas declare the document fields, with no pattern anywhere", () => {
    for (const name of ["render", "quick", "validate"] as const) {
      const output = DESCRIPTORS.find(d => d.name === name)!.output as { properties: Record<string, unknown> }
      for (const key of ["revision", "fingerprint", "source", "appearance", "categories", "size", "interactions", "adjustments", "diagnostics", "generation"]) expect(Object.keys(output.properties)).toContain(key)
      expect(JSON.stringify(output)).not.toContain('"pattern"')
    }
  })

  test("charts_update is one writer on every surface: registry, manifest, handler schema and output", () => {
    const update = DESCRIPTORS.find(d => d.name === "update")!
    expect({ class: update.class, readOnly: update.readOnly }).toEqual({ class: "write", readOnly: false })
    expect(methods.update).toMatchObject({ class: "write", accounts: "none" })
    const input = inputSchema("update") as { properties: Record<string, any>; required?: string[]; additionalProperties?: unknown }
    expect([...(input.required ?? [])].sort()).toEqual(["documentPath", "expectedRevision", "patch"])
    expect(Object.keys(input.properties).sort()).toEqual(["documentPath", "expectedRevision", "formats", "inspect", "marks", "name", "outDir", "patch", "scales", "svgText"])
    expect(input.additionalProperties).toBe(false)
    expect(input.properties.formats.items.enum).toEqual(["svg", "png", "html", "spec", "document"])
    for (const field of ["title", "description", "appearance", "layout", "interactions"]) expect(String(input.properties.patch.description)).toContain(`"${field}"`)
    const output = update.output as { properties: Record<string, unknown>; required: string[] }
    for (const key of ["revision", "fingerprint", "source", "appearance", "size", "interactions", "diagnostics", "update", "generation"]) expect(Object.keys(output.properties)).toContain(key)
    expect(output.required).toEqual(expect.arrayContaining(["files", "revision", "update"]))
    expect(JSON.stringify(output)).not.toContain('"pattern"')
  })

  test("the installed manifest is the package's capabilities, under one wire version", () => {
    const pkgFull = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as { capabilities: typeof installed }
    expect(installed).toEqual(pkgFull.capabilities)
    expect(installed.version).toBe(1)
    expect(pkg.version).toBe("0.0.0")
    expect(CONTRACT_VERSION.length).toBeGreaterThan(0)
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
