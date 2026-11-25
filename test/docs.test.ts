import { describe, expect, test } from "bun:test"
import { hostInRange } from "@we-the-rebel-alliance/plugin-contract/manifest"
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { manifest, version } from "../src/manifest.js"
import { HOST_RANGE, TESTED_HOSTS } from "../src/status.ts"
import { ROOT } from "./helpers.ts"
import { TESTED_HOST } from "./host/harness.ts"

const read = (path: string) => readFileSync(join(ROOT, path), "utf8")

const DOCS = ["README.md", "AGENTS.md", "CONTRIBUTING.md", "SECURITY.md", "CHANGELOG.md", "docs/capabilities.md", "docs/accounts.md", "docs/configuration.md", "docs/architecture.md", "docs/automations.md", "docs/security.md"]

describe("the docs set", () => {
  test("has every file the standard names", () => {
    for (const file of DOCS) expect({ file, exists: existsSync(join(ROOT, file)) }).toEqual({ file, exists: true })
  })

  test("README installs from a release tag, never from an untagged branch", () => {
    const readme = read("README.md")
    expect(readme).toContain(`github:we-the-rebel-alliance/charts-plugin#v${version}`)
    expect(readme).not.toMatch(/plugin add github:we-the-rebel-alliance\/charts-plugin\s*$/m)
    expect(readme).not.toContain("#master")
    expect(readme).toContain("Nothing to sign in to")
    for (const level of ["`all`", "`ask-changes`", "`read-only`"]) expect(readme).toContain(level)
  })

  test("accounts says there are none, and architecture says there is no provider client", () => {
    expect(read("docs/accounts.md")).toContain("signs in to nothing")
    expect(read("docs/architecture.md")).toContain("There is no provider client")
    expect(existsSync(join(ROOT, "src", "provider"))).toBe(false)
  })

  test("the generated sections are present in the files the kit writes", () => {
    expect(read("README.md")).toContain("<!-- generated:capabilities -->")
    expect(read("README.md")).toContain("<!-- generated:errors -->")
    expect(read("docs/capabilities.md")).toContain("<!-- generated:capabilities -->")
    expect(read("docs/configuration.md")).toContain("<!-- generated:configuration -->")
  })
})

describe("the tested hosts", () => {
  test("every \"tested on\" list is TESTED_HOSTS, which is 2.4.1 alone", () => {
    expect([...TESTED_HOSTS]).toEqual(["2.4.1"])
    expect(TESTED_HOST).toBe(TESTED_HOSTS[0]!)
    expect(HOST_RANGE).toBe(manifest.plugin.host.opencode)
    const expected = TESTED_HOSTS.join(", ")
    let found = 0
    for (const document of ["README.md", "AGENTS.md", "SECURITY.md", "docs/configuration.md", "CHANGELOG.md"]) {
      const text = read(document).replace(/\s+/g, " ")
      for (let at = text.indexOf("tested on "); at !== -1; at = text.indexOf("tested on ", at + 1)) {
        found += 1
        expect({ document, after: text.slice(at + "tested on ".length, at + "tested on ".length + expected.length) }).toEqual({ document, after: expected })
      }
    }
    expect(found).toBeGreaterThan(0)
    // Inside the range but untested, and outside it.
    expect(hostInRange("2.4.99")).toBe(true)
    expect(hostInRange("2.5.0")).toBe(false)
    expect(hostInRange("2.3.2")).toBe(false)
    expect(TESTED_HOSTS).not.toContain("2.4.99")
  })
})

describe("the model-facing text", () => {
  test("no skill or doc says a tool asks under the default, and every write is named as a write", () => {
    const reads = Object.entries(manifest.methods).filter(([, item]) => item.class === "read").map(([name]) => name)
    expect(reads.sort()).toEqual(["capabilities", "catalogue", "recommend", "status", "theme_get", "themes", "validate"].sort())
    const text = [read("README.md"), read("skills/charts/SKILL.md"), read("docs/capabilities.md")].join("\n")
    expect(text).not.toContain("the writers ask by default")
    for (const name of ["theme_save", "theme_sync", "theme_clear"]) expect(manifest.methods[name]!.effect).toBe("ask")
  })
})
