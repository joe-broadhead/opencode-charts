import { afterAll, describe, expect, test } from "bun:test"
import { mkdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { closeVegaWorker } from "../src/engines/vega-pool.ts"
import { ChartsError } from "../src/errors.ts"
import { runTool, type ToolName } from "../src/tools.ts"
import { BAR, ROWS, workspace } from "./helpers.ts"

/**
 * Saved theme files and inline theme objects at the edges: a folder where a saved theme's file goes is a coded
 * refusal (the path is confined for writing, so nothing else checks that it is a file), and `extends: null` in a theme
 * object means "no parent" (light), as it did before theme objects were checked against the typed token projection.
 */
const spaces: { cleanup: () => void }[] = []
afterAll(async () => { for (const s of spaces) s.cleanup(); await closeVegaWorker() })

function setup() {
  const ws = workspace()
  spaces.push(ws)
  const env = { ...ws.env, assertFiles: async () => undefined }
  const call = async (tool: ToolName, input: Record<string, unknown>) => (await runTool(env as never, tool, input)).output as Record<string, any>
  const refusal = async (tool: ToolName, input: Record<string, unknown>) => {
    const outcome: unknown = await runTool(env as never, tool, input).catch((error: unknown) => error)
    if (outcome instanceof ChartsError) return outcome
    throw outcome instanceof Error ? outcome : new Error("expected a refusal")
  }
  return { dir: ws.dir, call, refusal }
}

describe("a folder where a saved theme's file goes", () => {
  test("is NOT_A_FILE, naming the path, for every tool that reads or saves the theme; never a raw EISDIR", async () => {
    const t = setup()
    mkdirSync(join(t.dir, ".charts", "themes", "acme.json"), { recursive: true })
    const document = { version: 1, chart: { kind: "recipe", recipe: "bar", data: { rows: ROWS }, bindings: { category: "region", value: "revenue" } }, appearance: { theme: "acme" } }
    const calls: [ToolName, Record<string, unknown>, string | undefined][] = [
      ["render", { spec: BAR, data: { rows: ROWS }, theme: "acme", formats: ["svg"] }, undefined],
      ["render", { spec: BAR, data: { rows: ROWS }, theme: { extends: "acme" }, formats: ["svg"] }, undefined],
      ["validate", { document }, "/document/appearance/theme"],
      ["themes", { name: "acme" }, undefined],
      ["theme_save", { name: "acme", theme: { extends: "light" } }, undefined],
      ["theme_save", { name: "brand", theme: { extends: "acme" } }, undefined],
    ]
    for (const [tool, input, path] of calls) {
      const error = await t.refusal(tool, input)
      expect([tool, error.code]).toEqual([tool, "NOT_A_FILE"])
      expect(error.detail).toContain(".charts/themes/acme.json")
      expect(error.hint).toContain("Move or remove")
      expect(error.path).toBe(path)
    }
    // The listing names only saved themes that are files.
    expect((await t.call("themes", {})).saved).toEqual([])
  })
})

describe("extends: null in a theme object", () => {
  test("means no parent: the tokens apply over light, inline and when saved", async () => {
    const t = setup()
    const inline = await t.call("render", { spec: BAR, data: { rows: ROWS }, theme: { extends: null, colors: { text: "#202020" } }, formats: ["svg"] })
    const omitted = await t.call("render", { spec: BAR, data: { rows: ROWS }, theme: { colors: { text: "#202020" } }, formats: ["svg"], name: "omitted" })
    expect(inline.theme).toBe("light-custom")
    expect(readFileSync(join(t.dir, inline.files.svg), "utf8")).toBe(readFileSync(join(t.dir, omitted.files.svg), "utf8"))
    const saved = await t.call("theme_save", { name: "plain", theme: { extends: null, colors: { text: "#202020" } } })
    expect(saved.theme.colors.background).toBe("#FFFFFF")
    expect(saved.theme.colors.text).toBe("#202020")
    expect((await t.call("render", { spec: BAR, data: { rows: ROWS }, theme: "plain", formats: ["svg"], name: "plain" })).theme).toBe("plain")
  })
})
