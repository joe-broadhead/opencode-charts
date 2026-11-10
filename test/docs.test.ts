import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { ACCESS_VALUES, defaultRules } from "../src/permissions.ts"
import { DESCRIPTORS, NAMESPACE, TOOL_NAMES } from "../src/registry.ts"
import { HOST_RANGE, TESTED_HOSTS, inRange } from "../src/status.ts"
import { ROOT } from "./helpers.ts"

const read = (path: string) => readFileSync(join(ROOT, path), "utf8")
const readme = read("README.md")
const skill = read("skills/charts/SKILL.md")
const security = read("SECURITY.md")
const configuration = read("docs/configuration.md")

describe("the README", () => {
  test("opens Permissions with the default, and names the three ways to restrict", () => {
    expect(readme).toContain("**Every tool is allowed by default.**")
    expect(readme).toContain("`access`")
    expect(readme).toContain('"ask-changes"')
    expect(readme).toContain('"read-only"')
    expect(readme).toMatch(/An agent's own rules/)
    expect(readme).toMatch(/per-tool rule/)
  })

  test("prints the generated rules block in full for each access value", () => {
    const fence = "```"
    for (const access of ACCESS_VALUES) {
      const marker = new RegExp(`<!-- rules:${access} -->\\n${fence}json\\n(\\[[\\s\\S]*?\\])\\n${fence}\\n<!-- /rules:${access} -->`)
      const block = marker.exec(readme)?.[1]
      expect({ access, found: block !== undefined }).toEqual({ access, found: true })
      expect({ access, rules: JSON.parse(block!) }).toEqual({ access, rules: defaultRules(access) })
    }
  })

  test("names the external_directory rule for an output folder outside the project", () => {
    for (const document of [readme, configuration, read("docs/scripting.md")]) expect(document).toContain("external_directory")
  })
})

describe("the scripting guide", () => {
  test("every example carries the location header and the envelope, and names a real method", () => {
    const scripting = read("docs/scripting.md")
    const calls = [...scripting.matchAll(/opencode api post \/api\/rpc\/charts\.tools\/(\w+)/g)]
    expect(calls.length).toBeGreaterThan(1)
    for (const call of calls) {
      const method = call[1]!
      expect({ method, known: method === "describe" || (TOOL_NAMES as readonly string[]).includes(method) }).toEqual({ method, known: true })
      const line = scripting.slice(scripting.lastIndexOf("\n", call.index) + 1, scripting.indexOf("\n", call.index))
      expect({ method, header: line.includes('x-opencode-directory:$PWD') }).toEqual({ method, header: true })
      const at = scripting.indexOf("-d '", call.index)
      const body = balanced(scripting, at + 4)
      const envelope = JSON.parse(body) as { input?: { sessionID?: string; input?: unknown }; [key: string]: unknown }
      expect({ method, keys: Object.keys(envelope) }).toEqual({ method, keys: ["input"] })
      expect(typeof envelope.input?.sessionID).toBe("string")
      expect(typeof envelope.input?.input).toBe("object")
    }
    // The location section is the family's, and carries the unload paragraph.
    expect(scripting).toContain("## The location")
    expect(scripting).toContain("A location unloads after OpenCode's idle timeout.")
    expect(scripting).toContain("Jobs keeps its own location loaded.")
    // The shared tools RPC's own refusals, in the table a script reads.
    for (const code of ["PERMISSION_DENIED", "SESSION_UNKNOWN", "SESSION_AGENT_REQUIRED", "TOOL_UNAVAILABLE", "CANCELLED", "UPSTREAM_ERROR"]) {
      expect({ code, listed: scripting.includes(`\`${code}\``) }).toEqual({ code, listed: true })
    }
  })
})

/** The JSON object that starts at `from`, up to its matching brace. */
function balanced(text: string, from: number): string {
  let depth = 0
  for (let at = from; at < text.length; at += 1) {
    if (text[at] === "{") depth += 1
    else if (text[at] === "}") {
      depth -= 1
      if (depth === 0) return text.slice(from, at + 1)
    }
  }
  throw new Error("an example's body never closes")
}

describe("the tested hosts", () => {
  test("every \"tested on\" list in the docs is TESTED_HOSTS, 2.2.6 included", () => {
    const expected = `${TESTED_HOSTS.slice(0, -1).join(", ")} and ${TESTED_HOSTS.at(-1)}`
    expect(expected).toContain("2.2.6")
    let found = 0
    for (const document of ["README.md", "AGENTS.md", "SECURITY.md", "docs/configuration.md", "CHANGELOG.md"]) {
      const text = read(document).replace(/\s+/g, " ")
      for (let at = text.indexOf("tested on "); at !== -1; at = text.indexOf("tested on ", at + 1)) {
        found += 1
        expect({ document, after: text.slice(at + "tested on ".length, at + "tested on ".length + expected.length) }).toEqual({ document, after: expected })
      }
    }
    expect(found).toBeGreaterThan(2)
    // The untested example: inside the range, and not on the list.
    expect(inRange("2.2.99", HOST_RANGE)).toBe(true)
    expect(TESTED_HOSTS).not.toContain("2.2.99")
  })
})

describe("the model-facing text", () => {
  // Item 16: under the default every tool runs, so no description may say one asks.
  test("never describes an allowed tool as asking", () => {
    const allowing = new Set(defaultRules("all").filter(rule => rule.effect === "allow").map(rule => rule.action))
    expect(allowing).toContain(`${NAMESPACE}_*`)
    for (const descriptor of DESCRIPTORS) {
      const action = `${NAMESPACE}_${descriptor.name}`
      expect(allowing.has(action), `${action} must allow by default`).toBe(true)
      expect({ tool: descriptor.name, asks: new RegExp(`\\b${descriptor.name}\`?\\s+(?:always\\s+)?asks\\b`, "i").test(descriptor.description) }).toEqual({ tool: descriptor.name, asks: false })
    }
    for (const document of [readme, skill, security]) {
      expect(document).not.toContain("Everything else asks")
      expect(document).not.toContain("the writers ask by default")
    }
  })
})
