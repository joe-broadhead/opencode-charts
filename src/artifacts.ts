import { randomBytes } from "node:crypto"
import { copyFileSync, existsSync, linkSync, renameSync, rmSync, writeFileSync } from "node:fs"
import { basename, join } from "node:path"
import { ChartsError } from "./errors.js"
import { ensureDirectory, type Workspace } from "./paths.js"

/** One finished file of a render, held in memory until every requested file is ready. */
export interface Artifact {
  readonly kind: "svg" | "png" | "html" | "spec"
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
