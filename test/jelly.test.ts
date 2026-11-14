import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { ACCESS_VALUES, KNOWN_READS, defaultRules, permissionOf } from "../src/permissions.ts"
import { SKILLS, options } from "../src/plugin.ts"
import { TOOLS, type ToolName } from "../src/tools.ts"
import { type Declaration, type DeclaredTool, declarationProblems, docProblems, effectFromRules, readPackage } from "./support/jelly-kit.ts"
import { ACCESS_CHOICES, settingChoices, type PluginSetting, settingsProblems, settingValueIssue } from "./support/jelly-settings.ts"

/**
 * The `jelly` section of package.json, which Jelly reads without loading the plugin. Jelly's agents have no base
 * "allow everything" rule, so this plugin's own default rules never reach them; Jelly writes each declared "ask" or
 * "deny" as that tool's default instead. The shared kit checks the declaration against Jelly's plugin authors'
 * standard; the tests below add what only Charts declares.
 */

const ROOT = new URL("../", import.meta.url)
const pkg = readPackage(ROOT)
const jelly = pkg.jelly as Declaration & { title: string; tools: DeclaredTool[]; skills: string[]; signIns: unknown[]; rpc: unknown[]; views: unknown[]; contributes: { homeFeeds: unknown[]; homeWidgets: unknown[]; workKinds: unknown[]; settings: PluginSetting[] } }
const { settings } = jelly.contributes
const doc = readFileSync(new URL("docs/jelly.md", ROOT), "utf8")
const names = Object.keys(TOOLS) as ToolName[]

describe("the jelly declaration", () => {
  test("follows the plugin authors' standard, with the effects the plugin's own default rules give", () => {
    expect(declarationProblems(ROOT, { effectOf: effectFromRules(defaultRules()), registered: names.map(permissionOf) })).toEqual([])
  })

  test("declares exactly the plugin's tools, in order, read-only only where they write nothing", () => {
    expect(jelly.tools.map(tool => tool.permission)).toEqual(names.map(permissionOf))
    for (const name of names) expect(jelly.tools.find(tool => tool.permission === permissionOf(name))?.readOnly).toBe(TOOLS[name].readOnly)
    expect(jelly.tools.filter(tool => tool.readOnly).map(tool => tool.permission)).toEqual([...KNOWN_READS])
  })

  test("allows every tool by default, and each access value narrows the writers", () => {
    for (const tool of jelly.tools) expect(tool.effect).toBe("allow")
    const rules = [{ action: "*", resource: "*", effect: "allow" as const }, ...defaultRules("ask-changes")]
    for (const name of names.filter(name => !TOOLS[name].readOnly)) expect(effectFromRules(rules)(permissionOf(name))).toBe("ask")
    const denied = [{ action: "*", resource: "*", effect: "allow" as const }, ...defaultRules("read-only")]
    for (const name of names.filter(name => !TOOLS[name].readOnly)) expect(effectFromRules(denied)(permissionOf(name))).toBe("deny")
  })

  test("is titled Charts, names the skills it loads, and declares the access setting", () => {
    expect(jelly.title).toBe("Charts")
    expect(jelly.skills).toEqual([...SKILLS])
    expect(jelly.signIns).toEqual([])
    expect(jelly.rpc).toEqual([])
    expect(jelly.views).toEqual([])
    expect(jelly.contributes).toEqual({
      homeFeeds: [],
      homeWidgets: [],
      workKinds: [],
      settings: [
        {
          key: "access",
          label: "Access",
          type: "string",
          description: "How much the plugin's tools may do. Generates default rules for agents with a base allow rule.",
          choices: ACCESS_CHOICES,
          default: "all",
        },
      ],
    })
  })

  test("the settings follow Jelly's rules for a declared setting", () => {
    expect(settingsProblems(settings)).toEqual([])
  })

  test("the options parser takes every declared access choice, its default included, and refuses a value outside them", () => {
    const access = settings.find(setting => setting.key === "access")!
    const values = (settingChoices(access) ?? []).map(choice => choice.value)
    expect(values).toEqual([...ACCESS_VALUES])
    for (const value of values) expect<string>(options({ access: value }).access).toBe(value)
    expect<string>(options({}).access).toBe(access.default as string)
    expect(settingValueIssue(access, "write")).not.toBeNull()
    expect(() => options({ access: "write" })).toThrow("OPTIONS_INVALID")
  })
})

describe("docs/jelly.md", () => {
  test("follows the plugin authors' standard", () => {
    expect(docProblems(ROOT)).toEqual([])
  })

  test("names every tool, and the status command", () => {
    for (const tool of jelly.tools) expect(doc).toContain(`\`${tool.name}\``)
    expect(doc).toContain("/charts-status")
  })

  test("says each tool runs as declared at Allowed", () => {
    expect(jelly.tools.every((tool) => tool.effect === "allow")).toBe(true)
    expect(doc).toContain("- Ask: none. Every tool is allowed by default, in Jelly as in OpenCode")
    expect(jelly.tools).toHaveLength(12)
    expect(doc).not.toMatch(/^- (Ask|Off): `/m)
  })
})
