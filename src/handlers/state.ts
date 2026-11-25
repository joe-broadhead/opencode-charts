import { existsSync, readdirSync } from "node:fs"
import { join } from "node:path"
import type { Json } from "../engines/common.js"
import type { HostThemeStore } from "../themes/host.js"
import { savedThemeNames, THEME_DIR } from "../themes/store.js"
import type { MethodHandler } from "./types.js"

/** The snapshot the `charts.state` source answers: the output files and the theme state. */
const STATE_OUTPUT = {
  type: "object",
  properties: {
    data: {
      type: "object",
      properties: {
        items: {
          type: "array",
          maxItems: 50,
          items: {
            type: "object",
            properties: { id: { type: "string", maxLength: 128 }, text: { type: "string", maxLength: 200 }, done: { type: "boolean" }, note: { type: "string", maxLength: 200 }, due: { type: "string" } },
            required: ["id", "text"],
            additionalProperties: false,
          },
        },
        editable: { type: "boolean" },
      },
      required: ["items", "editable"],
      additionalProperties: false,
    },
    asOf: { type: "string" },
    trust: { const: "untrusted" },
  },
  required: ["data", "asOf", "trust"],
  additionalProperties: false,
} as const

const cut = (value: string, max: number) => (value.length <= max ? value : value.slice(0, max))

/** Every file under the output folder, relative to the workspace, at most 50. */
function outputFiles(outDir: string, directory: string): string[] {
  if (!existsSync(directory)) return []
  const found: string[] = []
  const walk = (at: string, prefix: string): void => {
    if (found.length >= 50) return
    for (const entry of readdirSync(at, { withFileTypes: true })) {
      if (found.length >= 50) return
      const relative = prefix === "" ? entry.name : `${prefix}/${entry.name}`
      if (entry.isDirectory()) walk(join(at, entry.name), relative)
      else if (entry.isFile()) found.push(`${outDir}/${relative}`)
    }
  }
  walk(directory, "")
  return found.sort()
}

/**
 * charts.state: the snapshot source `charts.state` reads. It lists the files a render wrote (the output folder), the
 * saved themes and the theme synced for this session. Every write emits `changed` for this capability, so an app
 * re-reads here and remains pull-first.
 */
export function stateHandler(store: HostThemeStore): MethodHandler {
  return {
    description: "List the chart output files, the saved themes and this session's synced theme.",
    input: { type: "object", properties: {}, additionalProperties: false },
    output: STATE_OUTPUT,
    async run(env, _input, call) {
      const outDir = env.defaults.outDir
      const directory = join(env.workspace.directory, outDir)
      // Both lists are directory reads: assert before listing, not after the entries are in hand.
      await env.assertFiles("read", [`${outDir}/*`])
      const files = outputFiles(outDir, directory)
      await env.assertFiles("read", [`${THEME_DIR}/*`])
      const themes = savedThemeNames({ workspace: env.workspace, configured: env.configuredThemes })
      const items: { id: string; text: string }[] = files.map((file) => ({ id: cut(file, 128), text: cut(file, 200) }))
      for (const theme of themes.slice(0, 20)) items.push({ id: cut(`theme:${theme}`, 128), text: cut(`Saved theme ${theme}`, 200) })
      const synced = store.forSession(call.sessionID)
      if (synced !== undefined) items.push({ id: cut(`session-theme:${synced.revision}`, 128), text: `Session theme ${synced.mode}` })
      return {
        data: { items: items.slice(0, 50), editable: false },
        asOf: new Date().toISOString(),
        trust: "untrusted",
      } as unknown as Json
    },
  }
}
