import type { Manifest } from "@we-the-rebel-alliance/plugin-contract/manifest"
import type { Json } from "../engines/common.js"
import type { ChartsOptions } from "../options.js"
import type { Workspace } from "../paths.js"
import type { BaseToolName, ToolName } from "../registry.js"
import type { ToolEnvironment, ToolOutput } from "../tools.js"
import { createHostThemeStore, effectiveThemeInput } from "../themes/host.js"
import type { ThemeOverrides } from "../themes/tokens.js"
import { board } from "./board.js"
import { capabilities } from "./capabilities.js"
import { catalogue } from "./catalogue.js"
import { contractFailure } from "./errors.js"
import { diagram } from "./diagram.js"
import { parseInput } from "./input.js"
import { toolEntry } from "../tool-table.js"
import { captureCommitHandler, capturePlanHandler, themeCommitHandler, themePlanHandler } from "./plans.js"
import { createPlanVault } from "./plan-vault.js"
import { quick } from "./quick.js"
import { recommend } from "./recommend.js"
import { render } from "./render.js"
import { stateHandler } from "./state.js"
import { statusHandler } from "./status.js"
import { table } from "./table.js"
import { themeClearHandler } from "./theme_clear.js"
import { themeGetHandler } from "./theme_get.js"
import { themeSave } from "./theme_save.js"
import { themeSyncHandler } from "./theme_sync.js"
import { themes } from "./themes.js"
import type { HandlerCall, MethodHandler } from "./types.js"
import { update } from "./update.js"
import { validate } from "./validate.js"

/**
 * The one handler table: one module per declared method, wired by the contract's `register`.
 *
 * Nothing is kept between `register` and a call: the environment a handler runs in is built per call from the session
 * (its synced theme), the workspace and the method's own file assertions, and the status's agent list is asked for on
 * the call. The renderer loads on the first call that needs an engine.
 */

export interface PermissionContext {
  assert(input: {
    readonly sessionID: string
    readonly agent?: string
    readonly action: string
    readonly resources: readonly string[]
    readonly save?: readonly string[]
    readonly source?: { readonly type: "tool"; readonly messageID: string; readonly id: string }
  }): Promise<void>
}

export interface HandlerParts {
  readonly manifest: Manifest
  readonly version: string
  readonly hostVersion: string
  readonly packageRoot: string
  readonly workspace: Workspace
  readonly options: ChartsOptions
  readonly permission: PermissionContext
}

/** One declared method as the register takes it: the input and answer schemas, and the work. */
export interface DeclaredHandler {
  readonly description: string
  readonly input: Record<string, unknown>
  readonly output: Record<string, unknown>
  run(input: Record<string, unknown>, call: HandlerCall): Promise<Json>
}

/** The base tools, by name: what `runTool` (the unit and eval seam) drives. Plan and commit are contract methods around them. */
const TOOLS: Readonly<Record<BaseToolName, MethodHandler>> = { render, quick, validate, update, board, table, diagram, recommend, capabilities, catalogue, themes, theme_save: themeSave }

/** The register's one handler table, with each method's failure mapped to the contract's form. */
export function createHandlers(parts: HandlerParts): Record<string, DeclaredHandler> {
  const store = createHostThemeStore()
  const vault = createPlanVault()
  const methods: Record<string, MethodHandler> = {
    validate,
    recommend,
    capabilities,
    catalogue,
    themes,
    status: statusHandler({ manifest: parts.manifest, version: parts.version, hostVersion: parts.hostVersion }),
    state: stateHandler(store),
    theme_get: themeGetHandler(store),
  }
  // Every write commits a plan made by its own read method: the two in-memory theme writes check without applying,
  // and the file writers render with a capture sink so the commit publishes exactly the bytes the preview reported.
  const writes: Readonly<Record<string, MethodHandler>> = {
    render,
    quick,
    update,
    board,
    table,
    diagram,
    theme_save: themeSave,
    theme_sync: themeSyncHandler(store),
    theme_clear: themeClearHandler(store),
  }
  for (const [name, write] of Object.entries(writes)) {
    const theme = name === "theme_sync" || name === "theme_clear"
    const plan = toolEntry(`plan_${name}` as ToolName)
    const commit = toolEntry(name as ToolName)
    methods[`plan_${name}`] = theme ? themePlanHandler(name, write, plan.input, plan.description) : capturePlanHandler(name, write, vault, plan.input, plan.description)
    methods[name] = theme ? themeCommitHandler(name, write, write.description, store) : captureCommitHandler(name, write, vault, commit.description)
  }
  const base = {
    workspace: parts.workspace,
    packageRoot: parts.packageRoot,
    configuredThemes: parts.options.themes,
    defaults: { theme: parts.options.theme, locale: parts.options.locale, outDir: parts.options.outDir },
  }
  const environment = (call: HandlerCall): ToolEnvironment => {
    const synced = effectiveThemeInput(undefined, call.sessionID, store, parts.options.theme)
    const object = typeof synced === "object" && synced !== null
    return {
      ...base,
      ...(object
        ? { configuredThemes: { ...base.configuredThemes, "host-synced": synced as ThemeOverrides }, defaults: { ...base.defaults, theme: "host-synced" } }
        : { defaults: { ...base.defaults, theme: synced ?? parts.options.theme } }),
      assertFiles: (action, resources) =>
        parts.permission.assert({
          sessionID: call.sessionID,
          agent: call.agent,
          action,
          resources: [...resources],
          ...(call.door === "rpc" ? {} : { save: ["*"] }),
          source: { type: "tool", messageID: call.messageID, id: call.id },
        }),
    }
  }
  return Object.fromEntries(
    Object.entries(methods).map(([name, handler]) => [
      name,
      {
        description: handler.description,
        input: handler.input,
        output: handler.output,
        async run(input: Record<string, unknown>, call: HandlerCall): Promise<Json> {
          try {
            const value = await handler.run(environment(call), input, call)
            // After a write, nudge every app through the one capability this plugin declares: `charts.state`.
            if (parts.manifest.methods[name]?.class !== "read") {
              await call.bus.emit("changed", { capability: "charts.state", account: call.account, reason: "write" }).catch(() => undefined)
            }
            // Every answer is untrusted data (contract §13); status is the contract's own fixed shape and takes none.
            return name === "status" || typeof value !== "object" || value === null || Array.isArray(value) ? value : { ...value, trust: "untrusted" }
          } catch (error) {
            contractFailure(error)
          }
        },
      } satisfies DeclaredHandler,
    ]),
  )
}

/** The synthetic call the unit and eval suites use: no host, no bus, no ask. */
const TEST_CALL: HandlerCall = {
  sessionID: "test",
  agent: "test",
  messageID: "test",
  id: "test",
  signal: new AbortController().signal,
  account: "default",
  door: "tool",
  bus: { name: "charts", emit: async () => ({ ok: true }) },
  unguardedAgents: async () => ({ ok: true, agents: [] }),
}

/**
 * One tool through the same handler a real call runs, for the unit and eval suites. The environment already carries
 * its file assertions, so nothing here reaches a host.
 */
export async function runTool(env: ToolEnvironment, name: ToolName, raw: unknown): Promise<ToolOutput> {
  const handler = TOOLS[name as BaseToolName]
  if (handler === undefined) throw new Error(`${name} is not one of the base tools the unit seam drives`)
  const input = await parseInput(name, raw)
  const output = await handler.run(env, input, TEST_CALL)
  return { output: typeof output === "object" && output !== null && !Array.isArray(output) ? { ...output, trust: "untrusted" } : output }
}
