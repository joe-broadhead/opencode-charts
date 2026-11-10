import type { Plugin } from "@opencode/plugin"
import { ChartsError, formatFailure } from "./errors.js"
import { htmlProblem } from "./html.js"
import { AGENT_FIX, defaultRules, unguardedAgents, type Access, type Rule } from "./permissions.js"
import { pngProblem } from "./png.js"
import { NAMESPACE, TOOLS } from "./tools.js"
import { builtinThemes, savedThemeNames, THEME_DIR, type ThemeSources } from "./themes/store.js"

/** The OpenCode releases this plugin supports, as package.json's `opencode.host` says, and the ones its checks run on. */
export const HOST_RANGE = ">=2.2.3 <2.3.0"
export const TESTED_HOSTS: readonly string[] = ["2.2.3", "2.2.4", "2.2.5", "2.2.6"]

export const COMMANDS = { status: "charts-status" } as const
export const NOTHING_TO_DO = "Nothing to do."

type Version = readonly [number, number, number]
const parse = (value: string): Version | undefined => {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(value)
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : undefined
}
const compare = (a: Version, b: Version) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]

/** Whether `version` is a release inside `>=low <high`. Prereleases, dev builds and an unknown version are outside. */
export function inRange(version: string, range = HOST_RANGE): boolean {
  const [, low, high] = /^>=(\S+) <(\S+)$/.exec(range) ?? []
  const found = parse(version), min = low && parse(low), max = high && parse(high)
  if (!found || !min || !max) return false
  return compare(found, min) >= 0 && compare(found, max) < 0
}

/** What `/charts-status` reports. The plugin has no account and no service, so it is ready unless a renderer is missing. */
export interface StatusView {
  readonly version: string
  readonly host: { readonly version: string | null; readonly range: string; readonly tested: boolean; readonly supported: boolean }
  readonly state: "ready" | "failed"
  /** Each renderer's problem, as `CODE: what happened. Next step: …`, or null when it works. */
  readonly png: string | null
  readonly html: string | null
  readonly defaults: { readonly theme: string; readonly locale: string; readonly outDir: string }
  readonly themes: { readonly builtin: number; readonly configured: number; readonly saved: readonly string[] }
  readonly tools: { readonly visible: number; readonly total: number }
  readonly skills: { readonly loaded: readonly string[]; readonly shadowed: readonly { readonly id: string; readonly path: string }[] }
  readonly unguardedAgents: readonly string[]
  readonly permissionsBlock?: readonly Rule[]
  readonly nextStep: string
}

export interface StatusSources {
  readonly version: string
  readonly hostVersion: string
  readonly packageRoot: string
  readonly themes: ThemeSources
  readonly defaults: { readonly theme?: string; readonly locale?: string; readonly outDir: string }
  /** The agents of the plugin's location, with their rules. */
  readonly access: Access
  readonly agents: () => Promise<readonly { readonly id: string; readonly permissions: readonly Rule[] }[]>
  /** The tools OpenCode lists. */
  readonly tools: () => Promise<readonly { readonly id: string }[]>
  /** The skills OpenCode lists, and the plugin's own that loaded, by id and path. */
  readonly skills: { readonly listed: () => Promise<readonly { readonly id: string; readonly path: string }[]>; readonly own: readonly { readonly id: string; readonly path: string }[] }
  /** The skills the plugin ships. */
  readonly shipped: readonly string[]
}

/** The first thing that needs the person, from blocking problems down; `Nothing to do.` otherwise. */
function nextStep(view: Omit<StatusView, "nextStep">, shipped: number, png: ChartsError | undefined, html: ChartsError | undefined): string {
  if (png) return png.hint
  if (html) return html.hint
  const missing = view.skills.loaded.length < shipped
  const shadow = view.skills.shadowed[0]
  if (shadow) return `Rename or move the skill at ${shadow.path}, since its id, ${shadow.id}, hides the plugin's own skill.`
  if (missing) return "Reinstall the plugin, since a skill it ships did not load."
  if (view.unguardedAgents.length > 0) return AGENT_FIX
  if (!view.host.supported) return `Use OpenCode ${TESTED_HOSTS.join(" or ")}, since Charts supports OpenCode ${HOST_RANGE} and this is ${view.host.version ?? "of no known version"}.`
  if (view.tools.visible < view.tools.total) return "Check the agent's permissions, since some Charts tools are denied to it; a read-only helper is denied the three that write."
  return NOTHING_TO_DO
}
export async function buildStatus(sources: StatusSources): Promise<StatusView> {
  const known = new Set(Object.keys(TOOLS).map(name => `${NAMESPACE}_${name}`))
  const [listedAgents, ids, listedSkills] = await Promise.all([
    sources.agents(),
    sources.tools().then(list => list.map(tool => tool.id)),
    // A listing that fails says nothing about shadowing, so it shows none rather than failing the status.
    sources.skills.listed().catch(() => [] as { id: string; path: string }[]),
  ])
  const shadowed = sources.skills.own.flatMap(own => listedSkills.filter(skill => skill.id === own.id && skill.path !== own.path).map(skill => ({ id: skill.id, path: skill.path }))).slice(0, 10)
  const unguarded = unguardedAgents(listedAgents, sources.access)
  const png = pngProblem(sources.packageRoot)
  const html = htmlProblem(sources.packageRoot)
  const hostVersion = sources.hostVersion.trim() === "" ? null : sources.hostVersion
  let saved: string[] = []
  try { saved = savedThemeNames({ ...sources.themes, configured: {} }) } catch { /* a workspace without saved themes */ }
  const view: Omit<StatusView, "nextStep"> = {
    version: sources.version,
    host: { version: hostVersion, range: HOST_RANGE, tested: hostVersion !== null && TESTED_HOSTS.includes(hostVersion), supported: hostVersion !== null && inRange(hostVersion) },
    state: png || html ? "failed" : "ready",
    png: png ? png.message : null,
    html: html ? html.message : null,
    defaults: { theme: sources.defaults.theme ?? "light", locale: sources.defaults.locale ?? "en-US", outDir: sources.defaults.outDir },
    themes: { builtin: Object.keys(builtinThemes()).length, configured: Object.keys(sources.themes.configured).length, saved },
    tools: { visible: ids.filter(id => known.has(id)).length, total: known.size },
    skills: { loaded: sources.skills.own.map(skill => skill.id), shadowed },
    unguardedAgents: unguarded,
    ...(unguarded.length ? { permissionsBlock: defaultRules(sources.access).map(rule => ({ ...rule })) } : {}),
  }
  return { ...view, nextStep: nextStep(view, sources.shipped.length, png, html) }
}

const STATE_WORDS: Record<StatusView["state"], string> = { ready: "Ready", failed: "Failed" }

/** The status as the person reads it: one row a line, the next step last. */
export function formatStatus(view: StatusView): string {
  const host = view.host.version === null
    ? `of no known version (supported: ${view.host.range})`
    : `${view.host.version}${view.host.tested ? "" : view.host.supported ? `, untested (tested: ${TESTED_HOSTS.join(", ")})` : `, outside the supported range ${view.host.range}`}`
  const agents = view.unguardedAgents.length === 0
    ? ["Agents without default rules: none"]
    : [`Agents without default rules: ${view.unguardedAgents.join(", ")}`, ...(view.permissionsBlock ?? []).map(rule => `  ${JSON.stringify(rule)}`)]
  return [
    "Charts status",
    `Connection: ${STATE_WORDS[view.state]}`,
    "Account: none needed; Charts calls no service",
    `Renderers: SVG ready; PNG ${view.png ? `missing (${view.png})` : "ready"}; HTML ${view.html ? `missing (${view.html})` : "ready"}`,
    `Defaults: theme ${view.defaults.theme}, locale ${view.defaults.locale}, files under ${view.defaults.outDir}/`,
    `Themes: ${view.themes.builtin} built in, ${view.themes.configured} from options, ${view.themes.saved.length ? `saved in ${THEME_DIR}: ${view.themes.saved.join(", ")}` : `none saved in ${THEME_DIR}`}`,
    `Skills: ${view.skills.shadowed.length ? view.skills.shadowed.map(skill => `${skill.id} is hidden by ${skill.path}`).join("; ") : view.skills.loaded.join(", ") || "none loaded"}`,
    `Tools: ${view.tools.visible} of ${view.tools.total} visible to this agent`,
    ...agents,
    `OpenCode: ${host}`,
    `Version: ${view.version}`,
    `Next step: ${view.nextStep}`,
  ].join("\n")
}

type CommandEditor = Parameters<Parameters<Plugin.Context["command"]["transform"]>[0]>[0]
type Synthetic = Plugin.Context["session"]["synthetic"]

/** `/charts-status` posts the status into the session; a failure posts `STATUS_UNAVAILABLE` with its next step. */
export function commandTransform(sources: { readonly synthetic: Synthetic; readonly status: () => Promise<StatusView> }) {
  return (editor: CommandEditor) => {
    editor.add({
      name: COMMANDS.status,
      description: "Charts status: renderers, defaults, themes, skills, tools, permissions and the next step",
      async execute({ sessionID, delivery }) {
        let text: string
        try { text = formatStatus(await sources.status()) } catch (error) {
          console.warn(`STATUS_UNAVAILABLE: /${COMMANDS.status} failed: ${error instanceof Error ? error.message : String(error)}`)
          text = formatFailure("STATUS_UNAVAILABLE", "Charts status could not be read.", `Run /${COMMANDS.status} again, or check the OpenCode server log.`)
        }
        await sources.synthetic({ sessionID, delivery, text, description: "Charts status", resume: false, metadata: { source: "charts" } } as never)
      },
    })
  }
}
