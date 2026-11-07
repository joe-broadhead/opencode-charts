import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { DEFAULT_RULES, KNOWN_READS, permissionOf } from "../src/permissions.ts"
import { SKILLS } from "../src/plugin.ts"
import { TOOLS, type ToolName } from "../src/tools.ts"
import { type Declaration, type DeclaredTool, declarationProblems, docProblems, effectFromRules, readPackage } from "./support/jelly-kit.ts"

/**
 * The `jelly` section of package.json, which Jelly reads without loading the plugin. Jelly's agents have no base
 * "allow everything" rule, so this plugin's own default rules never reach them; Jelly writes each declared "ask" or
 * "deny" as that tool's default instead. The shared kit checks the declaration against Jelly's plugin authors'
 * standard; the tests below add what only Charts declares.
 */

const ROOT = new URL("../", import.meta.url)
const pkg = readPackage(ROOT)
const jelly = pkg.jelly as Declaration & { title: string; tools: DeclaredTool[]; skills: string[]; signIns: unknown[]; rpc: unknown[]; views: unknown[]; contributes: unknown }
const doc = readFileSync(new URL("docs/jelly.md", ROOT), "utf8")
const names = Object.keys(TOOLS) as ToolName[]

describe("the jelly declaration", () => {
  test("follows the plugin authors' standard, with the effects the plugin's own default rules give", () => {
    expect(declarationProblems(ROOT, { effectOf: effectFromRules(DEFAULT_RULES), registered: names.map(permissionOf) })).toEqual([])
  })

  test("declares exactly the plugin's tools, in order, read-only only where they write nothing", () => {
    expect(jelly.tools.map(tool => tool.permission)).toEqual(names.map(permissionOf))
    for (const name of names) expect(jelly.tools.find(tool => tool.permission === permissionOf(name))?.readOnly).toBe(TOOLS[name].readOnly)
    expect(jelly.tools.filter(tool => tool.readOnly).map(tool => tool.permission)).toEqual([...KNOWN_READS])
  })

  test("asks before every tool that writes a file in the workspace", () => {
    expect(jelly.tools.filter(tool => tool.effect === "ask").map(tool => tool.name)).toEqual(["charts.render", "charts.quick", "charts.theme_save"])
    for (const tool of jelly.tools) expect(tool.effect).toBe(tool.readOnly ? "allow" : "ask")
  })

  test("is titled Charts, names the skills it loads, and has no sign-ins, RPC, views or contributions", () => {
    expect(jelly.title).toBe("Charts")
    expect(jelly.skills).toEqual([...SKILLS])
    expect(jelly.signIns).toEqual([])
    expect(jelly.rpc).toEqual([])
    expect(jelly.views).toEqual([])
    expect(jelly.contributes).toEqual({ homeFeeds: [], homeWidgets: [], workKinds: [], settings: [] })
  })
})

describe("docs/jelly.md", () => {
  test("follows the plugin authors' standard", () => {
    expect(docProblems(ROOT)).toEqual([])
  })

  test("names the tools that ask, and the status command", () => {
    for (const tool of jelly.tools.filter(tool => tool.effect === "ask")) expect(doc).toContain(`\`${tool.name}\``)
    expect(doc).toContain("/charts-status")
  })
})
