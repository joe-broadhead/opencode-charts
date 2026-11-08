// Imported first, before anything loads OpenCode. The in-process host derives its global paths from the environment,
// so the whole environment is replaced with a fresh temp root: HOME, OPENCODE_TEST_HOME, XDG_* and TMPDIR. The stock
// binaries' OPENCODE_BIN_* overrides and CI are kept, because the stock host suite in this folder reads them later.
import { mkdirSync, mkdtempSync, realpathSync } from "node:fs"
import { join, resolve } from "node:path"

/** A folder whose node_modules holds another @opencode/sdk 2.2.x, such as 2.2.4, to host the suite instead. */
export const HOST_SDK_DIR = process.env.HOST_SDK_DIR ? resolve(process.env.HOST_SDK_DIR) : undefined
export const ROOT = realpathSync(mkdtempSync(join(realpathSync("/tmp"), "charts-host-")))
const home = join(ROOT, "home")
const KEEP = ["PATH", "LANG", "TZ", "TERM", "CI"]
for (const key of Object.keys(process.env)) {
  if (KEEP.includes(key) || key.startsWith("BUN_") || key.startsWith("OPENCODE_BIN_") || key === "HOST_SDK_DIR") continue
  delete process.env[key]
}
Object.assign(process.env, {
  HOME: home,
  OPENCODE_TEST_HOME: home,
  XDG_CONFIG_HOME: join(home, ".config"),
  XDG_DATA_HOME: join(home, ".local", "share"),
  XDG_CACHE_HOME: join(home, ".cache"),
  XDG_STATE_HOME: join(home, ".local", "state"),
  TMPDIR: join(ROOT, "tmp"),
})
for (const dir of [home, join(ROOT, "tmp")]) mkdirSync(dir, { recursive: true })
