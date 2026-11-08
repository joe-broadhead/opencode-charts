// One typed code table, and the docs that must match it exactly. A code that is thrown or returned anywhere must be in
// the table; the README's and docs/configuration.md's error tables must equal it in both directions; and the scripting
// guide's refusal table must equal the shared tools RPC codes Charts can return.
import { describe, expect, test } from "bun:test"
import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { ROOT } from "./helpers.ts"
import { CHART_CODES, RPC_CODES } from "../src/errors.ts"

const read = (file: string) => readFileSync(join(ROOT, file), "utf8")

/** The shared tools RPC copy: a pinned part of the family's module, with its own code type. */
const SHARED = "src/host/tools-rpc.ts"

function files(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
    const path = `${dir}/${entry.name}`
    if (entry.isDirectory()) files(path, out)
    else if (entry.name.endsWith(".ts")) out.push(path)
  }
  return out
}

/** Every code literal in a raise or return position: `new ChartsError("X"`, `formatFailure("X"`, `"X: …"`, `code: "X"`. */
function raisedIn(file: string): string[] {
  const text = read(file)
  return [
    ...[...text.matchAll(/(?:new ChartsError|formatFailure|fail|error)\(\s*"([A-Z][A-Z0-9_]{2,})"/g)].map((match) => match[1]!),
    ...[...text.matchAll(/code:\s*"([A-Z][A-Z0-9_]{2,})"/g)].map((match) => match[1]!),
    ...[...text.matchAll(/"([A-Z][A-Z0-9_]{2,}):\s/g)].map((match) => match[1]!),
  ]
}

/** The codes a Markdown table names in its first cell, including a cell that groups several. */
function tableCodes(markdown: string): string[] {
  return markdown
    .split("\n")
    .filter((line) => line.startsWith("|"))
    .map((line) => line.split("|")[1]?.trim() ?? "")
    .filter((cell) => cell.startsWith("`"))
    .flatMap((cell) => [...cell.matchAll(/`([A-Z][A-Z0-9_]{2,})`/g)].map((code) => code[1]!))
}

const section = (markdown: string, heading: string) => {
  const start = markdown.indexOf(heading)
  if (start === -1) return ""
  const next = markdown.indexOf("\n## ", start + heading.length)
  return markdown.slice(start, next === -1 ? undefined : next)
}

const README_ERRORS = section(read("README.md"), "## Errors")
const CONFIG_ERRORS = section(read("docs/configuration.md"), "## Errors")
const SCRIPTING = read("docs/scripting.md")

describe("the code table", () => {
  test("holds every code the plugin raises or returns, and nothing else", () => {
    const raised = new Set(files("src").filter((file) => file !== SHARED).flatMap(raisedIn))
    expect([...raised].filter((code) => !(CHART_CODES as readonly string[]).includes(code))).toEqual([])
    // And the other way: no code is listed that nothing raises.
    expect(CHART_CODES.filter((code) => !raised.has(code))).toEqual([])
    expect(new Set(CHART_CODES).size).toBe(CHART_CODES.length)
  })

  test("the README's error table lists exactly the plugin's codes", () => {
    expect(tableCodes(README_ERRORS).sort()).toEqual([...CHART_CODES].sort())
  })

  test("docs/configuration.md's error table lists the same codes", () => {
    expect(tableCodes(CONFIG_ERRORS).sort()).toEqual([...CHART_CODES].sort())
  })

  test("the shared tools RPC's codes are the ones Charts can return, and the guide lists them", () => {
    expect(tableCodes(section(SCRIPTING, "## Refusals")).sort()).toEqual([...RPC_CODES].sort())
    // Every code in the pinned copy's own `Code` type is either one of those or one only an MCP method or an account
    // can produce, which Charts never has.
    const shared = /type Code =([\s\S]*?)\n\n/.exec(read(SHARED))?.[1] ?? ""
    const declared = [...shared.matchAll(/"([A-Z][A-Z0-9_]{2,})"/g)].map((match) => match[1]!)
    const impossible = ["ACCOUNT_UNKNOWN", "AUTH_REQUIRED", "CONNECTING", "CONNECTION_FAILED", "DISABLED", "NOT_REGISTERED", "SERVER_CONFLICT"]
    expect(declared.filter((code) => !(RPC_CODES as readonly string[]).includes(code)).sort()).toEqual(impossible.sort())
  })
})
