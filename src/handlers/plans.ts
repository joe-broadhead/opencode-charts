import { COMMIT_INPUT, RegisterError, refusal } from "@we-the-rebel-alliance/plugin-contract/register"
import type { Json } from "../engines/common.js"
import { hostThemeName } from "../themes/host.js"
import { THEME_DIR } from "../constants.js"
import type { PlanVault } from "./plan-vault.js"
import type { HandlerCall, MethodHandler } from "./types.js"

/** A plan's preview is ordinary JSON; the contract publishes only the fields it names. */
const PREVIEW = { type: "object", additionalProperties: true } as const

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value)

/** The part of a write's answer a person needs to confirm the write, without the SVG and the figure tree. */
function previewOf(method: string, value: Json): Json {
  const answer = isRecord(value) ? value : {}
  const pick = (...keys: string[]) => Object.fromEntries(keys.filter(key => answer[key] !== undefined).map(key => [key, answer[key]])) as Json
  switch (method) {
    case "render":
    case "quick":
    case "table":
    case "diagram":
      return pick("engine", "theme", "title", "description", "width", "height", "files", "markdown", "summary", "warnings", "notes", "layout", "generation", "revision", "fingerprint", "ms")
    case "update":
      return pick("engine", "theme", "title", "description", "width", "height", "files", "markdown", "summary", "warnings", "notes", "layout", "generation", "revision", "fingerprint", "ms", "update")
    case "board":
      return pick("engine", "theme", "title", "description", "width", "height", "files", "markdown", "summary", "warnings", "issues", "panels", "rows", "ms")
    case "theme_save":
      return pick("file", "theme", "warnings")
    default:
      return answer as Json
  }
}

/**
 * A planning method for a write that stages files: it runs the write's own code with a capture sink, so the preview
 * reports exactly the files and bytes the commit will publish, and nothing reaches the workspace.
 */
export function capturePlanHandler(method: string, write: MethodHandler, vault: PlanVault, input: Record<string, unknown>, description: string): MethodHandler {
  return {
    description,
    input,
    output: PREVIEW,
    async run(env, raw, call: HandlerCall) {
      const session = vault.begin(env.workspace, method)
      const result = await write.run({ ...env, plan: session.sink }, raw, call)
      session.keep(result)
      return { method, output: previewOf(method, result), changes: [...session.changes], stage: session.stage, trust: "untrusted" }
    },
  }
}

/** A commit for a staged plan: it publishes exactly the bytes the preview reported. */
export function captureCommitHandler(method: string, write: MethodHandler, vault: PlanVault, description: string): MethodHandler {
  return {
    description,
    input: COMMIT_INPUT,
    output: write.output,
    async run(env, _raw, call: HandlerCall) {
      const plan = isRecord(call.plan) ? call.plan : {}
      const stage = typeof plan.stage === "string" ? plan.stage : undefined
      const session = stage === undefined ? undefined : vault.take(stage)
      if (session === undefined || session.method !== method) {
        throw new RegisterError(refusal("PLAN_INVALID", `${method} has no live plan${stage === undefined ? "" : ` for ${stage}`}.`, "Plan the write again, then commit the new planId."))
      }
      if (session.edits.length > 0) await env.assertFiles("edit", [...session.edits])
      await session.commit(env.workspace)
      return (session.result ?? (isRecord(plan.output) ? plan.output : {})) as Json
    },
  }
}

/** A planning method for the two in-memory theme writes: it checks and resolves without applying. */
export function themePlanHandler(method: "theme_sync" | "theme_clear", write: MethodHandler, input: Record<string, unknown>, description: string): MethodHandler {
  return {
    description,
    input,
    output: PREVIEW,
    async run(env, raw) {
      if (method === "theme_clear") {
        return { method, output: { cleared: true }, changes: ["Clear this session's synced theme."], input: raw, trust: "untrusted" }
      }
      const input = raw as { theme?: string | Record<string, unknown>; mode?: "light" | "dark"; revision?: string }
      // A named theme may resolve through `.charts/themes/`, so ask for that read before the chain touches it.
      if (typeof input.theme === "string") await env.assertFiles("read", [`${THEME_DIR}/*`])
      const { resolveHostTheme } = await import("../theme-rpc.js")
      const resolved = await resolveHostTheme({ workspace: env.workspace, configured: env.configuredThemes }, input, paths => env.assertFiles("read", paths))
      const themeName = hostThemeName(resolved.theme)
      return {
        method,
        output: { ok: true, applied: true, revision: resolved.revision, mode: resolved.mode, themeName },
        changes: [`Apply the theme "${themeName}" to this session.`],
        input: raw,
        trust: "untrusted",
      }
    },
  }
}

/** A commit for an in-memory theme plan: it runs the write the preview checked, with the input the preview kept. */
export function themeCommitHandler(method: "theme_sync" | "theme_clear", write: MethodHandler, description: string): MethodHandler {
  return {
    description,
    input: COMMIT_INPUT,
    output: write.output,
    async run(env, _raw, call: HandlerCall) {
      const plan = isRecord(call.plan) ? call.plan : {}
      if (!isRecord(plan.input)) {
        throw new RegisterError(refusal("PLAN_INVALID", `${method} has no live plan.`, "Plan the write again, then commit the new planId."))
      }
      return write.run(env, plan.input, call)
    },
  }
}
