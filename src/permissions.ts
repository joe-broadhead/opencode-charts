import type { Plugin } from "@opencode/plugin"
import { NAMESPACE, TOOLS, type ToolName } from "./tools.js"

/**
 * The default permission block. `ctx.agent.transform` inserts it right after each agent's base `* * allow`: the three
 * tools that only read run without a prompt, and everything else under `charts_*` asks, which is the three that write
 * files in the workspace (`charts_render`, `charts_quick`, `charts_theme_save`) and any tool a later version adds.
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

export const DEFAULT_RULES: readonly Rule[] = [
  { action: `${NAMESPACE}_*`, resource: "*", effect: "ask" },
  ...KNOWN_READS.map((action): Rule => ({ action, resource: "*", effect: "allow" })),
]

/**
 * The fix for agents that miss the inserted block: the block first in each agent's own `permissions`, then the user's
 * top-level Charts rules again, because an agent's own rules come after the top-level ones.
 */
export const AGENT_FIX =
  "Put the default rules shown by /charts-status first in each listed agent's own permissions, in opencode.json or the agent's Markdown file, followed by your top-level rules for Charts tools."

const BASE_ALLOW: Rule = { action: "*", resource: "*", effect: "allow" }
const same = (a: Rule, b: Rule) => a.action === b.action && a.resource === b.resource && a.effect === b.effect

/** True when the block appears, in one piece, anywhere after the agent's first base allow. */
export function hasDefaultRules(rules: readonly Rule[]): boolean {
  const base = rules.findIndex(rule => same(rule, BASE_ALLOW))
  if (base === -1) return false
  return rules.some((_, start) => start > base && DEFAULT_RULES.every((rule, offset) => {
    const candidate = rules[start + offset]
    return candidate !== undefined && same(candidate, rule)
  }))
}

/**
 * Inserts the block right after the agent's first base allow, once. An agent without a base allow (Jelly's agents, or
 * a read-only helper) gets nothing: there, unlisted tools are not allowed anyway, and the block's `ask` would loosen a
 * default deny.
 */
export function insertDefaultRules(rules: Rule[]): void {
  const base = rules.findIndex(rule => same(rule, BASE_ALLOW))
  if (base === -1 || hasDefaultRules(rules)) return
  rules.splice(base + 1, 0, ...DEFAULT_RULES.map(rule => ({ ...rule })))
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
export function unguardedAgents(agents: readonly { readonly id: string; readonly permissions: readonly Rule[] }[]): string[] {
  return agents.filter(agent => !hasDefaultRules(agent.permissions) && evaluate(agent.permissions, `${NAMESPACE}_unknown`) === "allow").map(agent => agent.id)
}

export function registerDefaultRules(agent: Pick<Plugin.Context["agent"], "transform">) {
  return agent.transform(editor => {
    for (const { id } of editor.list()) editor.update(id, info => insertDefaultRules(info.permissions as Rule[]))
  })
}
