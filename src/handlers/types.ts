import type { UnguardedAgentsResult } from "@we-the-rebel-alliance/plugin-contract/access"
import type { Bus } from "@we-the-rebel-alliance/plugin-contract/bus"
import type { Json } from "../engines/common.js"
import type { ToolEnvironment } from "../tools.js"

/** What a handler knows about the call it runs: the session and door, and the one status asks. */
export interface HandlerCall {
  readonly sessionID: string
  readonly agent: string
  readonly messageID: string
  readonly id: string
  readonly signal: AbortSignal
  readonly account: string
  readonly door: "tool" | "codemode" | "rpc"
  /** A commit's plan: the planning handler's whole answer, as the register kept it. */
  readonly plan?: unknown
  /** The typed bus writer: always present, and the nudge after a write. */
  readonly bus: Bus
  /** The agents whose rules no longer give every generated rule its effect: an answer, never a throw. */
  unguardedAgents(): Promise<UnguardedAgentsResult>
}

/** One method's work: the environment it runs in, the checked input, and the call. */
export type MethodRun = (env: ToolEnvironment, input: Record<string, unknown>, call: HandlerCall) => Promise<Json>

/** One declared method, in the shape the contract's register takes. */
export interface MethodHandler {
  readonly description: string
  readonly input: Record<string, unknown>
  readonly output: Record<string, unknown>
  run: MethodRun
}
