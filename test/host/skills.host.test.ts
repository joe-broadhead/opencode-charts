// The skills load only because the plugin registers them with `ctx.skill.transform`; the contract's `register` does
// not. This test asks the real stock 2.4.1 server for its skills and checks that exactly the package's own two are
// there. It runs in the host stage, which installs the stock binary.
import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { existsSync, readFileSync, readdirSync } from "node:fs"
import { join, resolve, sep } from "node:path"
import { startHost, TESTED_HOST, type Host } from "./harness.js"

const ROOT = resolve(import.meta.dir, "../..")
/** Every skill id the package ships, from skills/<id>/SKILL.md. */
const SHIPPED = readdirSync(join(ROOT, "skills"), { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && existsSync(join(ROOT, "skills", entry.name, "SKILL.md")))
  .map((entry) => entry.name)
  .sort()

describe(`the skills on stock ${TESTED_HOST}`, () => {
  let host: Host
  beforeAll(async () => { host = await startHost(TESTED_HOST) }, 240_000)
  afterAll(async () => { await host?.close() })

  test("GET /api/skill lists exactly the skills the package ships", async () => {
    expect(SHIPPED).toEqual(["charts", "charts-cookbook"])
    // The host's project is the harness's empty temp project, not this repository: a project's own skills/ directory
    // is discovered by OpenCode 2.4.1, and none may stand in for the plugin's registration.
    expect(host.a).not.toBe(ROOT)
    expect(existsSync(join(host.a, "skills"))).toBe(false)
    const response = await host.api("GET", "/api/skill", undefined, host.a)
    expect(response.status).toBe(200)
    const body = response.data as { data?: { id: string; name?: string; path?: string; description?: string }[] } | { id: string; name?: string; path?: string; description?: string }[]
    const skills = Array.isArray(body) ? body : body.data
    expect(Array.isArray(skills)).toBe(true)
    // The host also lists its own built-in skills (browser, opencode, report); this plugin's are the ones whose path is
    // under the package's skills/ directory, and exactly those two must be there.
    const pluginSkills = (skills ?? []).filter((skill) => String(skill.path ?? "").startsWith(join(ROOT, "skills") + sep))
    expect(pluginSkills.map((skill) => String(skill.id)).sort()).toEqual(SHIPPED)
    for (const skill of pluginSkills) {
      const id = String(skill.id)
      expect(String(skill.name ?? "")).toBe(id)
      expect(String(skill.path ?? "")).toContain(join("skills", id, "SKILL.md"))
      // Parse the real front matter, not the host's rendering: a folded/block description must never arrive as ">"/"|".
      const source = readFileSync(join(ROOT, "skills", id, "SKILL.md"), "utf8")
      const front = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(source)
      expect(front).not.toBeNull()
      const parsed = Bun.YAML.parse(front![1]!) as { description?: unknown }
      const description = typeof parsed.description === "string" ? parsed.description.trim() : ""
      expect({ id, description }).not.toEqual({ id, description: "" })
      expect({ id, description }).not.toEqual({ id, description: ">" })
      expect({ id, description }).not.toEqual({ id, description: "|" })
      expect({ id, startsWithBlock: /^[>|]/.test(description) }).toEqual({ id, startsWithBlock: false })
      expect({ id, registered: String(skill.description ?? "") }).toEqual({ id, registered: description })
    }
    // And both are present in the whole list a client reads, not only in the filtered one.
    const ids = (skills ?? []).map((skill) => String(skill.id))
    for (const id of SHIPPED) expect(ids).toContain(id)
  })
})
