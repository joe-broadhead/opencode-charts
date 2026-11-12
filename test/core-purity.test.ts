// The document and recipe core is host-free: nothing it imports, directly or through another module, reads files,
// spawns work, or touches the host. File access and permissions stay in the adapters.
import { describe, expect, test } from "bun:test"
import { existsSync, readdirSync, readFileSync } from "node:fs"
import { dirname, join, relative, resolve } from "node:path"
import { ROOT } from "./helpers.ts"

const FORBIDDEN = [/^node:(?!crypto$)/, /^@opencode\//, /^(fs|path|child_process|worker_threads|os)$/]
const CORE = ["src/document", "src/recipes"]

/** Value imports (type-only imports are erased) and dynamic imports of a source file. */
function imports(file: string): string[] {
  const text = readFileSync(file, "utf8")
  const out: string[] = []
  for (const m of text.matchAll(/^\s*(?:import|export)\s+(?!type\b)(?:[^"';]*?\bfrom\s+)?"([^"]+)"/gm)) out.push(m[1]!)
  for (const m of text.matchAll(/\bimport\(\s*"([^"]+)"\s*\)/g)) out.push(m[1]!)
  return out
}

function closure(): Map<string, string[]> {
  const seen = new Map<string, string[]>()
  const queue = CORE.flatMap(dir => readdirSync(join(ROOT, dir)).filter(f => f.endsWith(".ts")).map(f => join(ROOT, dir, f)))
  while (queue.length) {
    const file = queue.pop()!
    if (seen.has(file)) continue
    const specifiers = imports(file)
    seen.set(file, specifiers)
    for (const s of specifiers) if (s.startsWith(".")) {
      const target = resolve(dirname(file), s.replace(/\.js$/, ".ts"))
      if (existsSync(target)) queue.push(target)
    }
  }
  return seen
}

/** Host-only globals the core may not use; web-standard ones (TextEncoder, TextDecoder, structuredClone) are fine. */
const HOST_GLOBALS = /\b(Buffer|process|require|Bun|fetch|__dirname|__filename)\b/

/** Source text without comments or string and template contents, so only code is searched. */
const code = (text: string) => text
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/(^|[^:"'`\\])\/\/.*$/gm, "$1")
  .replace(/"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\.)*`/g, "\"\"")

describe("the document and recipe core", () => {
  test("uses no host global: Buffer, process, require, Bun, fetch", () => {
    const offenders: string[] = []
    for (const dir of CORE) for (const file of readdirSync(join(ROOT, dir)).filter(f => f.endsWith(".ts"))) {
      code(readFileSync(join(ROOT, dir, file), "utf8")).split("\n").forEach((line, i) => { if (HOST_GLOBALS.test(line)) offenders.push(`${dir}/${file}:${i + 1}: ${line.trim()}`) })
    }
    expect(offenders).toEqual([])
    // The search does see code: a line that uses one is caught.
    expect(HOST_GLOBALS.test(code("const n = Buffer.byteLength(text) // a comment"))).toBe(true)
    expect(HOST_GLOBALS.test(code("// Buffer in a comment\nconst s = \"process\""))).toBe(false)
  })

  test("reaches no file system, process, worker or host module", () => {
    const offenders: string[] = []
    for (const [file, specifiers] of closure()) for (const s of specifiers) if (FORBIDDEN.some(r => r.test(s))) offenders.push(`${relative(ROOT, file)} imports ${s}`)
    expect(offenders).toEqual([])
  })
  test("and does not reach the renderer, the tools adapter or the data reader", () => {
    const reached = [...closure().keys()].map(f => relative(ROOT, f)).sort()
    // The walk does follow imports out of the core (so the checks above are not vacuous).
    for (const module of ["src/themes/tokens.ts", "src/safety.ts", "src/errors.ts", "src/catalogue.ts", "src/constants.ts"]) expect(reached).toContain(module)
    for (const adapter of ["src/pipeline.ts", "src/tools.ts", "src/plugin.ts", "src/data.ts", "src/fonts.ts", "src/paths.ts", "src/engines/common.ts"]) expect(reached).not.toContain(adapter)
  })
})

describe("pure helpers that replace host ones", () => {
  test("byteLength counts UTF-8 bytes exactly as an encoder does", async () => {
    const { byteLength, decodeUtf8 } = await import("../src/document/canonical.ts")
    const samples = ["", "abc", "é", "€", "😀", "a😀b€", "\uD800", "x\uDC00y", "￿", "\u{10FFFF}", "日本語のテキスト", "\u0000\u007F\u0080߿ࠀ"]
    for (const text of samples) expect(byteLength(text)).toBe(new TextEncoder().encode(text).length)
    expect(decodeUtf8(new TextEncoder().encode("a😀€"))).toBe("a😀€")
  })
})
