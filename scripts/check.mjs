// The one local entry point: `npm run check` runs every stage in order and stops at the first failure.
// `node scripts/check.mjs <stage>...` runs only the named stages, in the order given.
import { spawnSync } from "node:child_process"
import { existsSync, readdirSync, readFileSync } from "node:fs"
import { delimiter, join } from "node:path"
import { fileURLToPath } from "node:url"

const root = fileURLToPath(new URL("..", import.meta.url))
const env = { ...process.env, PATH: `${join(root, "node_modules", ".bin")}${delimiter}${process.env.PATH ?? ""}` }

// The approved package shape. Change it here only together with the release policy.
const FILES = ["dist", "assets", "skills", "README.md", "LICENSE", "NOTICE", "THIRD_PARTY_NOTICES.md", "licenses", "CHANGELOG.md"]
const EXPORTS = { ".": "./dist/index.js", "./icon.svg": "./assets/icon.svg", "./icon-128.png": "./assets/icon-128.png", "./icon-256.png": "./assets/icon-256.png" }
// dist/ holds the plugin, its Vega worker, the PNG rasteriser and the two runtimes inlined into interactive HTML.
const DIST = ["browser", "index.js", "resvg.wasm", "vega-worker.js"]
// The supported OpenCode line. The host provides @opencode/plugin, so the package declares no peers.
const HOST_RANGE = ">=2.2.5 <2.3.0"
const HOST_DEV_PIN = "2.2.5"
const ABSENT_FIELDS = ["dependencies", "optionalDependencies", "bundleDependencies", "bundledDependencies", "peerDependencies", "peerDependenciesMeta", "engines", "overrides"]
const LIFECYCLE_SCRIPTS = ["preinstall", "install", "postinstall", "preprepare", "prepare", "postprepare", "prepublish", "prepublishOnly", "prepack", "postpack", "publish", "postpublish"]

const stages = {
  typecheck: () => run("tsc", ["-p", "tsconfig.json"]),
  build: () => run("node", ["scripts/build.mjs"]),
  // The unit suites are the files directly in test/; test/pack packs and installs the package, so it is its own stage.
  unit: () => run("bun", ["test", ...readdirSync(join(root, "test")).filter((name) => name.endsWith(".test.ts")).sort().map((name) => `./test/${name}`)]),
  copies: () => run("node", ["scripts/check-copies.mjs"]),
  icons: () => run("node", ["scripts/check-icons.mjs"]),
  whitelist,
  pack: () => run("bun", ["test", "./test/pack"]),
  // The evals: every catalogue example renders to a checked picture, and the advice passes its gates against the
  // committed baseline. Both are deterministic and need no model.
  evals: () => run("bun", ["eval/run.ts", join(root, ".eval", "render")]) || run("bun", ["eval/recommend.ts", join(root, ".eval", "recommend")]),
  // The host suite: the tools RPC on the isolated stock 2.2.3, 2.2.4 and 2.2.5 binaries. A version without a stock
  // binary is skipped with a line, so this stage passes on a machine that has only one of them.
  host: () => run("bun", ["test", "./test/host"]),
}

const selected = process.argv.slice(2)
const unknown = selected.filter((name) => !Object.hasOwn(stages, name))
if (unknown.length) {
  console.error(`check: unknown stage ${unknown.map((name) => `"${name}"`).join(", ")}. Stages: ${Object.keys(stages).join(", ")}.`)
  process.exit(2)
}
const order = selected.length ? selected : Object.keys(stages)
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

function whitelist() {
  const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"))
  // No "private" check: only the release workflow's guard checks it.
  const problems = []
  if (JSON.stringify(pkg.files) !== JSON.stringify(FILES)) problems.push(`"files" must be exactly ${JSON.stringify(FILES)}.`)
  for (const field of ABSENT_FIELDS) if (field in pkg) problems.push(`Remove "${field}": the package ships no runtime dependencies, no host peers and no engine pins.`)
  for (const script of LIFECYCLE_SCRIPTS) if (pkg.scripts?.[script] !== undefined) problems.push(`Remove the "${script}" script: OpenCode installs with lifecycle scripts disabled.`)
  if (pkg.opencode?.host !== HOST_RANGE) problems.push(`"opencode.host" must be "${HOST_RANGE}", the supported OpenCode line.`)
  if (pkg.devDependencies?.["@opencode/plugin"] !== HOST_DEV_PIN) problems.push(`devDependency "@opencode/plugin" must be exactly ${HOST_DEV_PIN}, the tested host.`)
  if (JSON.stringify(pkg.exports) !== JSON.stringify(EXPORTS)) problems.push(`"exports" must be exactly ${JSON.stringify(EXPORTS)}.`)
  for (const field of ["main", "types", "module", "bin"]) if (field in pkg) problems.push(`Remove "${field}": "exports" is the only entry map.`)
  if (pkg.scripts?.build !== "node scripts/check.mjs build") problems.push(`"scripts"."build" must be "node scripts/check.mjs build".`)
  const dist = join(root, "dist")
  const built = existsSync(dist) ? readdirSync(dist).sort() : []
  if (JSON.stringify(built) !== JSON.stringify(DIST)) problems.push(`dist/ must hold exactly ${DIST.join(", ")}, found ${built.join(", ") || "nothing"}. Run npm run build.`)
  for (const problem of problems) console.error(`package: ${problem}`)
  if (!problems.length) console.log("package.json and dist/ match the approved package shape.")
  return problems.length ? 1 : 0
}
