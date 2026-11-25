import { readFile } from "node:fs/promises"
import { join } from "node:path"
import { Skill } from "@opencode/plugin"
import { formatFailure } from "./errors.js"

/** One skill the package ships, in the host's own `Skill.Info` shape. */
export type LoadedSkill = Skill.Info

/**
 * Read one `skills/<id>/SKILL.md`: its front matter gives the name and the description, its body is the content. A
 * missing or malformed skill is skipped with a warning rather than taking the plugin down, and status is what names it.
 */
export async function loadSkills(packageRoot: string, ids: readonly string[]): Promise<LoadedSkill[]> {
  const loaded = await Promise.all(ids.map(async (id) => {
    const path = join(packageRoot, "skills", id, "SKILL.md")
    try {
      const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/.exec(await readFile(path, "utf8"))
      const fields = Object.fromEntries((match?.[1] ?? "").split(/\r?\n/).map(line => /^(\w+):\s*(.+?)\s*$/.exec(line)).filter(m => m !== null).map(m => [m[1], m[2]]))
      if (!match || fields.name !== id || !fields.description) throw new Error("bad front matter")
      return Skill.Info.make({ id: Skill.ID.make(id), name: Skill.Name.make(id), description: fields.description, path: path as Skill.Info["path"], content: match[2]!.trim(), autoinvoke: true })
    } catch {
      console.warn(formatFailure("SKILLS_INVALID", `The skill ${id} is missing or malformed, so it was skipped.`, "Reinstall the plugin."))
      return undefined
    }
  }))
  return loaded.filter((skill): skill is LoadedSkill => skill !== undefined)
}
