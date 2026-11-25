// The one local entry point: `npm run check` runs every stage in order and stops at the first failure.
// `node scripts/check.mjs <stage>...` runs only the named stages, in the order given.
//
// The contract gate is `plugin-kit check` (T0/T1, the doc file set, forbidden text, no bundled kit). Everything else is
// about this repository: the esbuild build, the typecheck, the unit, browser, eval, host and pack suites.
import { spawnSync } from "node:child_process"
import { readdirSync } from "node:fs"
import { delimiter, join } from "node:path"
import { fileURLToPath } from "node:url"

const root = fileURLToPath(new URL("..", import.meta.url))
const env = { ...process.env, PATH: `${join(root, "node_modules", ".bin")}${delimiter}${process.env.PATH ?? ""}` }

const stages = {
  // The tests import dist/, so the build comes first: a fresh clone must pass.
  build: () => run("node", ["scripts/build.mjs"]),
  typecheck: () => run("tsc", ["-p", "tsconfig.json"]),
  // The contract gate: conformance T0/T1, the doc file set, forbidden text, and no kit in a runtime build.
  kit: () => run("npx", ["--no-install", "plugin-kit", "check"]),
  // The unit suites are the files directly in test/; test/host, test/browser and test/pack are their own stages.
  unit: () => run("bun", ["test", ...readdirSync(join(root, "test")).filter((name) => name.endsWith(".test.ts")).sort().map((name) => `./test/${name}`)]),
  // Interactive HTML in a real browser: playwright-core's headless Chromium. A missing browser fails this stage, never
  // skips it; install it once with `npx playwright-core install --only-shell chromium` (on Linux add --with-deps).
  browser,
  // The evals: every catalogue example renders to a checked picture, and the advice passes its gates against the
  // committed baseline. Both are deterministic and need no model.
  evals: () => run("bun", ["eval/run.ts", join(root, ".eval", "render")]) || run("bun", ["eval/recommend.ts", join(root, ".eval", "recommend")]),
  // The host suite: the built plugin on the stock 2.4.1 binary, from OPENCODE_BIN_2_4_1 or $OPENCODE_STOCK_ROOT/2.4.1.
  // A missing binary is skipped with a line on a laptop and fails in CI, where a release that did not run is not evidence.
  host: () => run("bun", ["test", "./test/host"]),
  pack: () => run("bun", ["test", "./test/pack"]),
}

const selected = process.argv.slice(2)
const unknown = selected.filter((name) => !Object.hasOwn(stages, name))
if (unknown.length) {
  console.error(`check: unknown stage ${unknown.map((name) => `"${name}"`).join(", ")}. Stages: ${Object.keys(stages).join(", ")}.`)
  process.exit(2)
}
const order = selected.length ? selected : ["build", "typecheck", "kit", "unit", "browser", "evals", "host", "pack"]
for (const name of order) {
  console.log(`\n[check] ${name}`)
  const code = stages[name]()
  if (code !== 0) {
    console.error(`\n[check] FAILED at stage "${name}". Fix it, then rerun: node scripts/check.mjs ${name}`)
    process.exit(code || 1)
  }
}
console.log(`\n[check] passed: ${order.join(", ")}`)

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { cwd: options.cwd ?? root, env: { ...env, ...options.env }, stdio: "inherit" })
  if (result.error?.code === "ENOENT") {
    console.error(`${command} was not found. Run npm ci first; install Bun from https://bun.sh if bun is missing.`)
    return 127
  }
  if (result.error) throw result.error
  return result.status ?? 1
}

function browser() {
  const probe = spawnSync("node", ["-e", "const {chromium}=require('playwright-core');chromium.launch().then(b=>b.close(),e=>{console.error(e.message.split('\\n')[0]);process.exit(1)})"], { cwd: root, env, encoding: "utf8" })
  if (probe.status !== 0) {
    console.error(`[check] browser: playwright-core's headless Chromium did not start: ${(probe.stderr || probe.stdout || "").trim()}`)
    console.error("[check] browser: install it with: npx playwright-core install --only-shell chromium (on Linux add --with-deps). This stage does not skip.")
    return 1
  }
  return run("bun", ["test", "./test/browser"])
}
