import { Plugin } from "@opencode/plugin"
import { assertHost, register } from "@we-the-rebel-alliance/plugin-contract/register"
import { createHandlers } from "./handlers/index.js"
import { manifest, packageRoot, version } from "./manifest.js"
import { options } from "./options.js"
import { loadedRenderer } from "./renderer-load.js"
import { loadSkills } from "./skills.js"

/** The skills the package ships, under skills/<id>/SKILL.md. */
export const SKILLS = ["charts", "charts-cookbook"] as const

/**
 * The plugin: the host gate, one `register` call for every method through every door, and the two skills.
 *
 * `register` builds the access rules, the tools, the one RPC id and the bus writer; nothing here opens a second
 * registration. A start loads no engine: the renderer loads on the first call that needs it.
 */
export default Plugin.define({
  id: manifest.plugin.name,
  async setup(ctx) {
    assertHost(ctx, manifest)
    const handlers = createHandlers({
      manifest,
      version,
      hostVersion: ctx.app.version,
      packageRoot,
      workspace: { directory: ctx.location.directory, projectDirectory: ctx.location.project.directory },
      options: options(ctx.options),
      permission: ctx.permission,
    })
    const registration = await register(ctx, manifest, handlers)
    try {
      const skills = await loadSkills(packageRoot, SKILLS)
      if (skills.length > 0) await ctx.skill.transform((editor) => { for (const skill of skills) editor.add(skill as never) })
    } catch (error) {
      await registration.dispose()
      throw error
    }
    return async () => {
      await registration.dispose()
      // A start that never drew anything never loaded the renderer, so there is no worker to stop.
      await loadedRenderer()?.closeVegaWorker()
    }
  },
})
