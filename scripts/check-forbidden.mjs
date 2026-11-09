// Fails when an internal reference, a machine-local path or a forbidden API appears in src/, test/, scripts/ or dist/.
// The list is the "Forbidden in this repository" list in AGENTS.md.
import { existsSync, readdirSync, readFileSync } from "node:fs"
import { extname, join, relative, sep } from "node:path"
import { fileURLToPath } from "node:url"

const root = fileURLToPath(new URL("..", import.meta.url))
const self = fileURLToPath(import.meta.url)
const ROOTS = ["src", "test", "scripts", "dist"]

const RULES = [
  // Internal wording: a shipped doc or comment states behaviour, not who decided it, and never names a team's lane.
  { id: "internal-wording", pattern: /owner'?s? (?:decision|ruling)|\bthe lead'?s?\b|hey-jelly #|\blane\s+(?:design|render|agentwork)\b/i, why: "internal wording (an owner decision, a lead, a team lane) does not belong in a shipped doc or comment" },
  { id: "v1-plugin-api", pattern: /@opencode-ai\//, why: "@opencode-ai/* is the V1 plugin API" },
  { id: "v1-hook", pattern: /["'`](?:tool\.execute\.(?:before|after)|chat\.(?:message|params)|permission\.ask)["'`]/, why: "V1 plugin hooks are not allowed" },
  { id: "opencode-ai-import", pattern: /["'`]@opencode\/ai(?:\/[^"'`]*)?["'`]/, why: "@opencode/ai breaks between patch releases; import only @opencode/plugin" },
  { id: "private-host-source", pattern: /packages\/(?:core|plugin|schema)\/src\b|opencode-[\w-]*-host\b|\bconsumer-host\b|hey-jelly-wt\b/, why: "never reference private host source, host checkouts or another checkout's worktree" },
  { id: "shell", pattern: /(?<![.\w$])(?:exec|execSync)\s*\(|\bshell\s*:\s*true\b/, why: "the plugin runs programs with an argument list (execFile, spawn), never a shell", srcOnly: true },
  { id: "network", pattern: /\b(?:fetch|XMLHttpRequest)\s*\(|\bfrom\s+["']https?:/, why: "nothing is loaded from the network in a render, a status call or an output", srcOnly: true },
  { id: "absolute-path", pattern: /\/Users\/[^/\s"'`]+\/|\/home\/[^/\s"'`]+\/|\/(?:private\/)?var\/folders\//, why: "machine-local home and temp paths do not belong in the repository" },
]

const findings = []
for (const top of ROOTS) {
  const dir = join(root, top)
  if (!existsSync(dir)) continue
  for (const file of walk(dir)) {
    if (file === self) continue
    const path = relative(root, file).split(sep).join("/")
    if (top === "dist" && [".tsx", ".jsx"].includes(extname(file))) findings.push({ path, line: 0, id: "dist-jsx-source", why: "no .tsx or .jsx ships; the TUI is prebuilt" })
    const buffer = readFileSync(file)
    if (buffer.includes(0)) continue
    const lines = buffer.toString("utf8").split(/\r?\n/)
    for (const rule of RULES) {
      if (rule.srcOnly && !path.startsWith("src/")) continue
      lines.forEach((text, index) => {
        if (rule.pattern.test(text)) findings.push({ path, line: index + 1, id: rule.id, why: rule.why, text })
      })
    }
  }
}

for (const { path, line, id, why, text } of findings) {
  console.error(`${path}${line ? `:${line}` : ""}: [${id}] ${why}${text ? `\n    ${text.trim().slice(0, 160)}` : ""}`)
}
if (findings.length) {
  console.error(`\n${findings.length} forbidden reference(s) found. Remove them; see the forbidden list in AGENTS.md.`)
  process.exit(1)
}
console.log(`No forbidden references in ${ROOTS.filter((top) => existsSync(join(root, top))).join(", ")}.`)

function* walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === ".git") continue
    const path = join(dir, entry.name)
    if (entry.isDirectory()) yield* walk(path)
    else if (entry.isFile()) yield path
  }
}
