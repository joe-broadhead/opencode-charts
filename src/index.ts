import { Plugin } from "@opencode/plugin"
import { assertHost, register } from "@we-the-rebel-alliance/plugin-contract/register"
import { createHandlers } from "./handlers/index.js"
import { manifest, packageRoot, version } from "./manifest.js"
import { options } from "./options.js"
import { loadedRenderer } from "./renderer-load.js"
import { registerSkills } from "./skills.js"

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
    let skills: Awaited<ReturnType<typeof registerSkills>>
    try {
      // No module filter: every directory under skills/ is this plugin's, so both charts and charts-cookbook register.
      skills = await registerSkills(ctx)
    } catch (error) {
      await registration.dispose()
      throw error
    }
    return async () => {
      await registration.dispose()
      await skills.dispose()
      // A start that never drew anything never loaded the renderer, so there is no worker to stop.
      await loadedRenderer()?.closeVegaWorker()
    }
  },
})
