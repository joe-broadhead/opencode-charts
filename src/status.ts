import type { StatusAnswer } from "@we-the-rebel-alliance/plugin-contract/accounts"
import { manifest } from "./manifest.js"

/** The OpenCode range and the releases this build is tested on, from the installed manifest. */
export const HOST_RANGE: string = manifest.plugin.host.opencode
export const TESTED_HOSTS: readonly string[] = manifest.plugin.host.tested

const STATE_WORDS: Record<StatusAnswer["state"], string> = { ready: "Ready", needs_sign_in: "Sign-in needed", error: "Error" }

/** The contract's status answer as a person reads it: one row a line, the next step last. */
export function formatStatus(answer: StatusAnswer): string {
  const host = TESTED_HOSTS.includes(answer.host.version)
    ? `${answer.host.version} (tested)`
    : `${answer.host.version} (untested; supported: ${answer.host.range})`
  const agents = answer.unguardedAgents.length === 0 ? ["Agents without default rules: none"] : [`Agents without default rules: ${answer.unguardedAgents.join(", ")}`]
  return [
    "Charts status",
    `Connection: ${STATE_WORDS[answer.state]}`,
    "Account: none needed; Charts calls no service",
    `OpenCode: ${host}`,
    `Version: ${answer.version}`,
    ...agents,
    `Next step: ${answer.nextStep ?? "Nothing to do."}`,
  ].join("\n")
}
