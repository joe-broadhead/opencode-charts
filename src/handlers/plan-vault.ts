import { randomBytes } from "node:crypto"
import { basename, dirname } from "node:path"
import { RegisterError, refusal } from "@we-the-rebel-alliance/plugin-contract/register"
import { bundleManifest, publish, publishGeneration, type Artifact, type Generation } from "../artifacts.js"
import { confine, type Workspace } from "../paths.js"
import type { PlanSink } from "../pipeline.js"

/**
 * The plan vault: a planning method renders a write with the same code, but the bytes stay here instead of reaching
 * the workspace. The plan answer carries an unguessable token as private data; the commit handler takes it and writes
 * exactly the bytes the preview reported. Plans live in memory for the same fifteen minutes as the contract's plan
 * store, and a reload forgets both together.
 */

/** How long a staged plan is kept: the contract's own plan lifetime. */
export const STAGED_PLAN_TTL_MS = 15 * 60_000
/** The most one staged plan may hold: a cap on a process's memory, not the contract's 64 KB answer cap. */
export const STAGED_PLAN_MAX_BYTES = 64 * 1024 * 1024

type StagedWrite =
  | { readonly kind: "flat"; readonly outDir: string; readonly artifacts: readonly Artifact[] }
  | { readonly kind: "generation"; readonly outDir: string; readonly name: string; readonly artifacts: readonly Artifact[] }
  | { readonly kind: "theme"; readonly relative: string; readonly bytes: string }

/** One plan's staged writes and the preview lines that name them. */
export interface PlanSession {
  readonly stage: string
  readonly method: string
  readonly changes: readonly string[]
  /** The host `edit` resources the commit must assert before it writes. */
  readonly edits: readonly string[]
  readonly sink: PlanSink
  /** Keep the write's full answer for the commit, beside the bytes; only the preview goes in the plan JSON. */
  keep(result: unknown): void
  readonly result: unknown
  commit(workspace: Workspace): Promise<void>
}

export interface PlanVault {
  begin(workspace: Workspace, method: string): PlanSession
  take(stage: string): PlanSession | undefined
}

interface Stored {
  readonly at: number
  readonly method: string
  readonly writes: StagedWrite[]
  readonly changes: string[]
  readonly edits: string[]
  bytes: number
  result?: unknown
}

/** Publish every staged write: each group keeps the atomic publication its own writer uses. */
async function runWrites(target: Workspace, writes: readonly StagedWrite[]): Promise<void> {
  for (const write of writes) {
    if (write.kind === "flat") publish(target, write.outDir, write.artifacts)
    else if (write.kind === "generation") publishGeneration(target, write.outDir, write.name, write.artifacts)
    else publish(target, dirname(write.relative), [{ kind: "document", file: basename(write.relative), bytes: write.bytes }])
  }
}

export function createPlanVault(now: () => number = Date.now): PlanVault {
  const plans = new Map<string, Stored>()
  const prune = () => {
    const at = now()
    for (const [key, plan] of plans) if (plan.at + STAGED_PLAN_TTL_MS <= at) plans.delete(key)
  }
  return {
    begin(workspace, method) {
      prune()
      let stage = randomBytes(16).toString("base64url")
      while (plans.has(stage)) stage = randomBytes(16).toString("base64url")
      const stored: Stored = { at: now(), method, writes: [], changes: [], edits: [], bytes: 0 }
      plans.set(stage, stored)
      const add = (relative: string, bytes: string | Uint8Array) => {
        const size = typeof bytes === "string" ? Buffer.byteLength(bytes) : bytes.byteLength
        if (stored.bytes + size > STAGED_PLAN_MAX_BYTES) {
          plans.delete(stage)
          throw new RegisterError(refusal("PLAN_INVALID", `The planned write is over the ${STAGED_PLAN_MAX_BYTES}-byte staging limit.`, "Write fewer or smaller files in one call."))
        }
        stored.bytes += size
        if (stored.changes.length < 20) stored.changes.push(`Write ${relative}`)
      }
      const sink: PlanSink = {
        flat(outDir, artifacts) {
          const dir = confine(workspace, outDir, "write")
          const shown = (file: string) => (dir.relative === "." ? file : `${dir.relative}/${file}`)
          const paths = artifacts.map(artifact => shown(artifact.file))
          stored.writes.push({ kind: "flat", outDir: dir.relative, artifacts })
          stored.edits.push(`${dir.relative}/*`)
          artifacts.forEach((artifact, index) => add(paths[index]!, artifact.bytes))
          return paths
        },
        generation(outDir, name, artifacts) {
          const dir = confine(workspace, outDir, "write")
          const { digest } = bundleManifest(artifacts)
          const folder = `${name}-${digest.slice("sha256:".length, "sha256:".length + 16)}`
          const shownFolder = dir.relative === "." ? folder : `${dir.relative}/${folder}`
          const files = artifacts.map(artifact => `${shownFolder}/${artifact.file}`)
          stored.writes.push({ kind: "generation", outDir: dir.relative, name, artifacts })
          stored.edits.push(`${dir.relative}/*`)
          artifacts.forEach((artifact, index) => add(files[index]!, artifact.bytes))
          const generation: Generation = { directory: shownFolder, digest, reused: false, files }
          return generation
        },
        theme(relative, bytes) {
          const file = confine(workspace, relative, "write")
          stored.writes.push({ kind: "theme", relative: file.relative, bytes })
          stored.edits.push(file.relative)
          add(file.relative, bytes)
          return file.relative
        },
      }
      return {
        stage,
        method,
        get changes() {
          return stored.changes
        },
        get edits() {
          return stored.edits
        },
        keep(result) {
          stored.result = result
        },
        get result() {
          return stored.result
        },
        sink,
        async commit(target) {
          await runWrites(target, stored.writes)
        },
      }
    },
    take(stage) {
      prune()
      const plan = plans.get(stage)
      if (plan === undefined) return undefined
      plans.delete(stage)
      // The session is rebuilt around the stored writes without the token: a commit is the only way to use it.
      return {
        stage,
        method: plan.method,
        get changes() {
          return plan.changes
        },
        get edits() {
          return plan.edits
        },
        keep() {
          throw new Error("a plan session is no longer capturing")
        },
        get result() {
          return plan.result
        },
        sink: {
          flat() {
            throw new Error("a plan session is no longer capturing")
          },
          generation() {
            throw new Error("a plan session is no longer capturing")
          },
          theme() {
            throw new Error("a plan session is no longer capturing")
          },
        },
        async commit(target) {
          await runWrites(target, plan.writes)
        },
      }
    },
  }
}
