import { NO_ACCOUNTS, STATUS_SCHEMA, statusAnswer } from "@we-the-rebel-alliance/plugin-contract/accounts"
import type { Manifest } from "@we-the-rebel-alliance/plugin-contract/manifest"
import type { Json } from "../engines/common.js"
import type { MethodHandler } from "./types.js"

/** What status knows before a call: the installed manifest and the two versions. */
export interface StatusParts {
  readonly manifest: Manifest
  readonly version: string
  readonly hostVersion: string
}

const EMPTY = { type: "object", properties: {}, additionalProperties: false } as const

/**
 * charts.status: the contract's answer (contract §11) from the status builder.
 *
 * The agents the generated rules miss are asked for on every call; `statusAnswer` reads the answer's `ok` and reports a
 * failed list as an error with one redacted next step. Nothing is kept between `register` and a handler.
 */
export function statusHandler(parts: StatusParts): MethodHandler {
  return {
    description: "Read Charts' state, its host range and its (empty) account list.",
    input: EMPTY,
    output: STATUS_SCHEMA,
    async run(_env, _input, call) {
      return statusAnswer({
        manifest: parts.manifest,
        version: parts.version,
        hostVersion: parts.hostVersion,
        accounts: NO_ACCOUNTS,
        unguardedAgents: await call.unguardedAgents(),
      }) as unknown as Json
    },
  }
}
