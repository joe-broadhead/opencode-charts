import { createHash, randomBytes } from "node:crypto"
import { copyFileSync, existsSync, linkSync, lstatSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs"
import { basename, join } from "node:path"
import { ChartsError } from "./errors.js"
import { ensureDirectory, type Workspace } from "./paths.js"

/** One finished file of a render, held in memory until every requested file is ready. */
export interface Artifact {
  readonly kind: "svg" | "png" | "html" | "spec" | "document"
  /** The file name inside the output folder. */
  readonly file: string
  readonly bytes: string | Uint8Array
}

/** Called before each file is moved into place; throwing simulates that step failing. A test seam only. */
export type CommitProbe = (file: string) => void

/**
 * Writes a render's files into the output folder, for the flat legacy layout (`<name>.svg`, `<name>.png`, …).
 *
 * Every file is complete in memory before this runs, so a failure while preparing a format never touches the folder.
 * Here the bytes are first staged as hidden files beside their targets (same folder, so the same filesystem), and only
 * then moved into place one by one; a file being replaced is kept until the end. If staging fails, nothing is
 * replaced. If a move fails, the files already moved are put back (or removed when they are new) and the staging files
 * are deleted. This is a best-effort rollback, not a crash-safe transaction: several renames cannot be made atomic
 * together, and the error says exactly which files could not be restored. Files the render does not name are never
 * touched. Staging names carry a random token; they never reach the files' contents.
 *
 * The rollback works within one process only. Renders from different processes that write the same file names are not
 * coordinated (there is no lock), so the last move wins file by file and a set can mix their outputs. A crash or a
 * killed process between staging and clean-up can leave hidden `.<file>.<token>.tmp` (staged bytes) or
 * `.<file>.<token>.bak` (the previous version of a replaced file) beside the charts; they are never read back, and are
 * safe to delete when no render is running.
 */
export function publish(workspace: Workspace, outDir: string, artifacts: readonly Artifact[], probe?: CommitProbe): string[] {
  const dir = ensureDirectory(workspace, outDir)
  const shown = (file: string) => `${dir.relative === "." ? "" : `${dir.relative}/`}${file}`
  const token = `${process.pid.toString(36)}-${randomBytes(6).toString("hex")}`
  const staged: { file: string; target: string; temp: string }[] = []
  const discard = (paths: readonly string[]) => { for (const path of paths) { try { rmSync(path, { force: true }) } catch { /* best effort */ } } }

  try {
    for (const artifact of artifacts) {
      const temp = join(dir.absolute, `.${artifact.file}.${token}.tmp`)
      writeFileSync(temp, artifact.bytes, { flag: "wx" })
      staged.push({ file: artifact.file, target: join(dir.absolute, artifact.file), temp })
    }
  } catch (error) {
    discard(staged.map(s => s.temp))
    throw new ChartsError("OUTPUT_WRITE_FAILED", `Staging the chart files in ${dir.relative} failed (${(error as Error).message}); no file was replaced or created.`, "Check that the output folder is writable and has free space, then call again.", `/outDir`)
  }

  const moved: { file: string; target: string; backup?: string }[] = []
  let current = ""
  try {
    for (const item of staged) {
      current = item.file
      probe?.(item.file)
      let backup: string | undefined
      if (existsSync(item.target)) {
        backup = join(dir.absolute, `.${item.file}.${token}.bak`)
        try { linkSync(item.target, backup) } catch { copyFileSync(item.target, backup) }
      }
      try {
        renameSync(item.temp, item.target)
      } catch (error) {
        if (backup) discard([backup])
        throw error
      }
      moved.push({ file: item.file, target: item.target, ...(backup ? { backup } : {}) })
    }
  } catch (error) {
    const unrestored: string[] = []
    for (const done of moved.reverse()) {
      try {
        if (done.backup) renameSync(done.backup, done.target)
        else rmSync(done.target, { force: true })
      } catch {
        unrestored.push(`${shown(done.file)}${done.backup && existsSync(done.backup) ? ` (its previous version is kept as ${shown(basename(done.backup))})` : ""}`)
      }
    }
    discard(staged.map(s => s.temp))
    const outcome = unrestored.length
      ? `These files could not be put back and may hold the new chart: ${unrestored.join(", ")}.`
      : moved.length ? `The ${moved.length} file(s) already written were put back as they were.` : "No file was replaced or created."
    throw new ChartsError("OUTPUT_WRITE_FAILED", `Writing ${shown(current)} failed (${(error as Error).message}). ${outcome}`, "Check that the output folder is writable, has free space and has no folder where a chart file goes, then call again.", `/outDir`)
  }
  discard(moved.flatMap(m => (m.backup ? [m.backup] : [])))
  return artifacts.map(a => shown(a.file))
}

/** A published generation: its folder (workspace-relative), the bundle digest it is named by, and whether it existed. */
export interface Generation {
  readonly directory: string
  /** `sha256:` over the bundle's file manifest (each file's name, size and digest). */
  readonly digest: string
  /** True when an identical generation was already there and was verified byte for byte instead of written again. */
  readonly reused: boolean
  /** The files, workspace-relative, in the order given. */
  readonly files: readonly string[]
}

/** Hex digits of the bundle digest in a generation folder's name: 64 bits, verified in full on reuse. */
export const GENERATION_DIGEST_CHARS = 16
const GENERATION_DOMAIN = "opencode-charts-generation/1\n"

const digestOf = (bytes: string | Uint8Array) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`

/** The bundle's manifest, by file name: what a generation folder is named by and verified against. */
export function bundleManifest(artifacts: readonly Artifact[]): { readonly digest: string; readonly entries: readonly { file: string; bytes: number; sha256: string }[] } {
  const entries = artifacts.map(a => ({ file: a.file, bytes: typeof a.bytes === "string" ? Buffer.byteLength(a.bytes) : a.bytes.byteLength, sha256: digestOf(a.bytes) }))
    .sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : 0))
  const digest = digestOf(GENERATION_DOMAIN + entries.map(e => `${e.file}\u0000${e.bytes}\u0000${e.sha256}`).join("\n"))
  return { digest, entries }
}

/**
 * Publishes a complete bundle as a new immutable generation folder, `<outDir>/<name>-<digest prefix>/`, for charts_update.
 *
 * The folder is named by the digest of the bundle's own file manifest, so it is content-addressed: an earlier
 * generation, and the artifact an update started from, are never overwritten. The files are written into a hidden
 * staging folder beside it (`.<folder>.<token>.tmp`, same filesystem) and the folder appears in one rename, only once
 * every file is there; a failure removes the staging folder and leaves no partial generation. When the folder already
 * exists (a no-op update, or the same update made twice at once), every file in it is compared with the bundle's bytes:
 * an identical generation is reused, and anything else (another file set, different bytes) is OUTPUT_WRITE_FAILED with
 * nothing touched. Hidden entries in a folder (names starting with ".") are not part of a generation. Files outside the
 * folder are never touched.
 */
export function publishGeneration(workspace: Workspace, outDir: string, name: string, artifacts: readonly Artifact[], probe?: CommitProbe): Generation {
  const dir = ensureDirectory(workspace, outDir)
  const { digest, entries } = bundleManifest(artifacts)
  const folder = `${name}-${digest.slice("sha256:".length, "sha256:".length + GENERATION_DIGEST_CHARS)}`
  const target = join(dir.absolute, folder)
  const shownFolder = `${dir.relative === "." ? "" : `${dir.relative}/`}${folder}`
  const result = (reused: boolean): Generation => ({ directory: shownFolder, digest, reused, files: artifacts.map(a => `${shownFolder}/${a.file}`) })

  /** Whether the existing folder holds exactly this bundle; anything else is a collision, never overwritten. */
  const verify = (): boolean => {
    let names: string[]
    try { names = readdirSync(target).filter(n => !n.startsWith(".")).sort() } catch { return false }
    if (names.join("\u0000") !== entries.map(e => e.file).join("\u0000")) return false
    return entries.every(e => {
      try { const path = join(target, e.file); return lstatSync(path).isFile() && digestOf(readFileSync(path)) === e.sha256 } catch { return false }
    })
  }
  const collision = () => new ChartsError("OUTPUT_WRITE_FAILED", `${shownFolder} already exists and does not hold this chart's files (a different file set or different bytes); it was not overwritten, and nothing was written.`, `Move or remove ${shownFolder} if it is not a chart generation you need, or write to another outDir, then call again.`, "/outDir")
  if (existsSync(target)) {
    if (verify()) return result(true)
    throw collision()
  }

  const token = `${process.pid.toString(36)}-${randomBytes(6).toString("hex")}`
  const staging = join(dir.absolute, `.${folder}.${token}.tmp`)
  const clean = () => { try { rmSync(staging, { recursive: true, force: true }) } catch { /* best effort */ } }
  let current = folder
  try {
    mkdirSync(staging)
    for (const artifact of artifacts) {
      current = artifact.file
      probe?.(artifact.file)
      writeFileSync(join(staging, artifact.file), artifact.bytes, { flag: "wx" })
    }
    current = folder
    probe?.(folder)
    renameSync(staging, target)
  } catch (error) {
    clean()
    // Another call may have published the same generation meanwhile: reuse it when it is identical.
    if (existsSync(target)) {
      if (verify()) return result(true)
      throw collision()
    }
    throw new ChartsError("OUTPUT_WRITE_FAILED", `Writing the generation ${shownFolder} failed at ${current} (${(error as Error).message}); its staging folder was removed and no generation was published.`, "Check that the output folder is writable and has free space, then call again.", "/outDir")
  }
  return result(false)
}
