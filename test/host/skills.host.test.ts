// The skills load only because the plugin registers them with `ctx.skill.transform`; the contract's `register` does
// not. This test asks the real stock 2.4.1 server for its skills and checks that exactly the package's own two are
// there. It runs in the host stage, which installs the stock binary.
import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { existsSync, readdirSync } from "node:fs"
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
    const response = await host.api("GET", "/api/skill", undefined, host.a)
    expect(response.status).toBe(200)
    const body = response.data as { data?: { id: string; name?: string; path?: string }[] } | { id: string; name?: string; path?: string }[]
    const skills = Array.isArray(body) ? body : body.data
    expect(Array.isArray(skills)).toBe(true)
    // The host also lists its own built-in skills (browser, opencode, report); this plugin's are the ones whose path is
    // under the package's skills/ directory, and exactly those two must be there.
    const pluginSkills = (skills ?? []).filter((skill) => String(skill.path ?? "").startsWith(join(ROOT, "skills") + sep))
    expect(pluginSkills.map((skill) => String(skill.id)).sort()).toEqual(SHIPPED)
    for (const skill of pluginSkills) {
      expect(String(skill.name ?? "")).toBe(String(skill.id))
      expect(String(skill.path ?? "")).toContain(join("skills", String(skill.id), "SKILL.md"))
    }
    // And both are present in the whole list a client reads, not only in the filtered one.
    const ids = (skills ?? []).map((skill) => String(skill.id))
    for (const id of SHIPPED) expect(ids).toContain(id)
  })
})
