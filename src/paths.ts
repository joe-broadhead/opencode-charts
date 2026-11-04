import { existsSync, lstatSync, mkdirSync, realpathSync } from "node:fs"
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path"
import { ChartsError } from "./errors.js"

/** Where the tools may read and write: the session's directory, and the project's directory when it differs. */
export interface Workspace {
  readonly directory: string
  readonly projectDirectory?: string
}

const inside = (parent: string, child: string) => {
  const rel = relative(parent, child)
  return rel === "" || (!isAbsolute(rel) && rel !== ".." && !rel.startsWith(`..${sep}`))
}

/** The nearest existing ancestor's real path, joined with the rest, so a symbolic link cannot carry a path outside. */
function realish(path: string) {
  let cursor = path
  const rest: string[] = []
  while (!existsSync(cursor)) {
    const parent = dirname(cursor)
    if (parent === cursor) break
    rest.unshift(cursor.slice(parent.length + 1))
    cursor = parent
  }
  return join(realpathSync.native(cursor), ...rest)
}

export interface Confined { readonly absolute: string; readonly relative: string }

/**
 * Resolves a workspace-relative path and refuses anything outside the workspace: `..`, an absolute path elsewhere,
 * `~`, or a symbolic link that leads out. Paths under `.git/` are refused as well.
 */
export function confine(workspace: Workspace, path: string, purpose: "read" | "write"): Confined {
  if (typeof path !== "string" || path.trim() === "" || path.includes("\0")) throw new ChartsError("PATH_INVALID", "The path is empty.", "Give a path relative to the workspace, such as data/sales.csv.")
  if (path.startsWith("~")) throw new ChartsError("PATH_OUTSIDE_WORKSPACE", `"${path}" is outside the workspace.`, "Copy the file into the workspace and use a relative path.")
  if (/^[a-z][a-z0-9+.-]*:/i.test(path) && !/^[a-z]:[\\/]/i.test(path)) throw new ChartsError("PATH_IS_URL", `"${path}" is a URL; charts read only workspace files.`, "Download the data into the workspace first, or pass the rows inline.")
  const roots = [workspace.directory, workspace.projectDirectory].filter((r): r is string => !!r).map(r => realish(resolve(r)))
  const absolute = resolve(workspace.directory, path)
  const real = realish(absolute)
  const root = roots.find(r => inside(r, real))
  if (!root) throw new ChartsError("PATH_OUTSIDE_WORKSPACE", `"${path}" is outside the workspace.`, "Use a path inside the workspace, without ../ or a link that leads out.")
  const rel = relative(roots[0]!, real) || "."
  if (rel.split(sep).includes(".git")) throw new ChartsError("PATH_PRIVATE", `"${path}" is inside .git.`, "Use a path outside .git.")
  if (purpose === "read") {
    if (!existsSync(real)) throw new ChartsError("FILE_NOT_FOUND", `"${path}" does not exist.`, "Check the path; it is relative to the workspace.")
    const info = lstatSync(real)
    if (!info.isFile()) throw new ChartsError("NOT_A_FILE", `"${path}" is not a regular file.`, "Name a file, not a folder or a device.")
  }
  return { absolute: real, relative: rel.split(sep).join("/") }
}

/** Creates the output directory inside the workspace. */
export function ensureDirectory(workspace: Workspace, path: string): Confined {
  const confined = confine(workspace, path, "write")
  mkdirSync(confined.absolute, { recursive: true })
  return confine(workspace, path, "write")
}

/** A file-name slug: lowercase ascii letters, digits and dashes, at most 64 characters. */
export function slug(value: string) {
  const s = value.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 64).replace(/-+$/g, "")
  return s || "chart"
}
