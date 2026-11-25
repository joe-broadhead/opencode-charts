// One typed code table: every code the plugin raises or reports as an issue is in it, and nothing is listed that
// nothing raises. The contract-facing codes a failure is mapped to come from the contract's own closed table.
import { describe, expect, test } from "bun:test"
import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { CHART_CODES } from "../src/errors.ts"
import { ROOT } from "./helpers.ts"

const read = (file: string) => readFileSync(join(ROOT, file), "utf8")

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

describe("the code table", () => {
  test("holds every code the plugin raises or returns, and nothing else", () => {
    const raised = new Set(files("src").flatMap(raisedIn))
    expect([...raised].filter((code) => !(CHART_CODES as readonly string[]).includes(code))).toEqual([])
    // And the other way: no code is listed that nothing raises.
    expect(CHART_CODES.filter((code) => !raised.has(code))).toEqual([])
    expect(new Set(CHART_CODES).size).toBe(CHART_CODES.length)
  })

  test("a Charts failure is mapped to one of the contract's own codes, never to an invented one", () => {
    const mapping = read("src/handlers/errors.ts")
    for (const code of ["INPUT_INVALID", "TOO_LARGE", "UNAVAILABLE"]) expect(mapping).toContain(`"${code}"`)
    expect(mapping).not.toContain('"CHART_')
  })
})
