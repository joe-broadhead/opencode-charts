import type { Plugin } from "@opencode/plugin"
import { NAMESPACE, TOOLS, type ToolName } from "./tools.js"

/**
 * The default permission block. `ctx.agent.transform` inserts it right after each agent's base `* * allow`: every tool
 * is allowed by default, the five that only read and the four that write files in the workspace (`charts_render`,
 * `charts_quick`, `charts_update`, `charts_theme_save`) alike, and so is `charts_*`, so a tool a later version adds runs at once. The
 * `access` option narrows that from each tool's class.
 * Every later rule (agent denies, the user's `permissions`, saved approvals) still wins, because the last match wins.
 * Each tool also asserts its own action on every call, so an `ask` rule prompts: the host itself only hides a plugin
 * tool on a deny. The file rules (`read` on a data file, `edit` on the output folder) are asserted as well.
 */

export interface Rule {
  action: string
  resource: string
  effect: "allow" | "deny" | "ask"
}

/** The engine's permission for a tool: `charts_<name>`. */
export const permissionOf = (name: ToolName) => `${NAMESPACE}_${name}`

/** The tools that write nothing anywhere. */
export const READ_TOOLS = (Object.keys(TOOLS) as ToolName[]).filter(name => TOOLS[name].readOnly)
export const KNOWN_READS: readonly string[] = READ_TOOLS.map(permissionOf)

/** How much the plugin's own tools may do without asking. A user's later rules always win. */
export type Access = "all" | "ask-changes" | "read-only"

export const ACCESS_VALUES: readonly Access[] = ["all", "ask-changes", "read-only"]

/** The effect a tool's class gets under one access value: a read always runs, the writers follow the option. */
const accessEffect = (readOnly: boolean, access: Access): Rule["effect"] =>
  readOnly ? "allow" : access === "ask-changes" ? "ask" : access === "read-only" ? "deny" : "allow"

/**
 * The block, generated from the tool table and the `access` option: every tool is allowed by default, and so is
 * `charts_*`, so a tool a later release adds is usable at once. `ask-changes` asks for the writers, `read-only` denies
 * them, and the reads always run.
 */
export function defaultRules(access: Access = "all"): Rule[] {
  const pattern = access === "all" ? "allow" : access === "ask-changes" ? "ask" : "deny"
  return [
    { action: `${NAMESPACE}_*`, resource: "*", effect: pattern },
    ...(Object.keys(TOOLS) as ToolName[]).map((name): Rule => ({ action: permissionOf(name), resource: "*", effect: accessEffect(TOOLS[name].readOnly, access) })),
  ]
}

/** The block for the access value in force, as the old constant named it. */
export const DEFAULT_RULES: readonly Rule[] = defaultRules()

/**
 * The fix for agents that miss the inserted block: the block first in each agent's own `permissions`, then the user's
 * top-level Charts rules again, because an agent's own rules come after the top-level ones.
 */
export const AGENT_FIX =
  "Put the default rules shown by /charts-status first in each listed agent's own permissions, in opencode.json or the agent's Markdown file, followed by your top-level rules for Charts tools."

const BASE_ALLOW: Rule = { action: "*", resource: "*", effect: "allow" }
const same = (a: Rule, b: Rule) => a.action === b.action && a.resource === b.resource && a.effect === b.effect

/** True when the block appears, in one piece, anywhere after the agent's first base allow. */
export function hasDefaultRules(rules: readonly Rule[], access: Access = "all"): boolean {
  const base = rules.findIndex(rule => same(rule, BASE_ALLOW))
  if (base === -1) return false
  return rules.some((_, start) => start > base && defaultRules(access).every((rule, offset) => {
    const candidate = rules[start + offset]
    return candidate !== undefined && same(candidate, rule)
  }))
}

/**
 * Inserts the block right after the agent's first base allow, once. An agent without a base allow (Jelly's agents, or
 * a read-only helper) gets nothing: there, unlisted tools are not allowed anyway, and the block's `ask` would loosen a
 * default deny.
 */
export function insertDefaultRules(rules: Rule[], access: Access = "all"): void {
  let base = rules.findIndex(rule => same(rule, BASE_ALLOW))
  if (base === -1 || hasDefaultRules(rules, access)) return
  // A block for another access value is replaced, so switching the option does not stack two.
  for (const value of ACCESS_VALUES) {
    if (value === access) continue
    const stale = defaultRules(value)
    for (let start = 0; start + stale.length <= rules.length; start += 1) {
      if (stale.every((rule, offset) => same(rules[start + offset]!, rule))) {
        rules.splice(start, stale.length)
        break
      }
    }
  }
  base = rules.findIndex(rule => same(rule, BASE_ALLOW))
  rules.splice(base + 1, 0, ...defaultRules(access).map(rule => ({ ...rule })))
}

/** Host wildcards: `*` matches any run of characters and `?` one character, over the whole string. */
const matches = (pattern: string, value: string) =>
  new RegExp(`^${pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".")}$`).test(value)

/** The effect of `rules` for `action` on resource `*`: the last matching rule wins, and no match asks. */
export function evaluate(rules: readonly Rule[], action: string): Rule["effect"] {
  for (let at = rules.length - 1; at >= 0; at--) {
    const rule = rules[at]!
    if (matches(rule.action, action) && matches(rule.resource, "*")) return rule.effect
  }
  return "ask"
}

/** Agents that miss the block and would run a Charts tool that writes, or a future one, without asking. */
export function unguardedAgents(agents: readonly { readonly id: string; readonly permissions: readonly Rule[] }[], access: Access = "all"): string[] {
  return agents.filter(agent => !hasDefaultRules(agent.permissions, access) && evaluate(agent.permissions, `${NAMESPACE}_unknown`) === "allow").map(agent => agent.id)
}

export function registerDefaultRules(agent: Pick<Plugin.Context["agent"], "transform">, access: Access = "all") {
  return agent.transform(editor => {
    for (const { id } of editor.list()) editor.update(id, info => insertDefaultRules(info.permissions as Rule[], access))
  })
}
