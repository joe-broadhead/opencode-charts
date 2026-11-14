import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { BOARD_COOKBOOK_EXAMPLE } from "../scripts/cookbook.ts"
import { parseBoardDocument } from "../src/board/schema.ts"
import { ChartDocumentV1Schema } from "../src/document/schema.ts"
import { TOOL_NAMES } from "../src/registry.ts"
import { runTool } from "../src/tools.ts"
import { ROOT, ROWS, workspace } from "./helpers.ts"

const PLACEHOLDER_HANDLES = new Set(["handle", "user", "username", "someone", "person", "name", "theirs", "author", "channel", "email", "example"])

function parseSkill(relPath: string): { fields: Record<string, string>; body: string; bytes: number } {
  const raw = readFileSync(join(ROOT, relPath), "utf8").replace(/\r\n/g, "\n")
  const match = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(raw)
  if (!match) throw new Error(`${relPath}: missing YAML frontmatter`)
  const fields: Record<string, string> = {}
  for (const line of match[1]!.split("\n")) {
    const at = line.indexOf(":")
    if (at < 0) continue
    fields[line.slice(0, at).trim()] = line.slice(at + 1).trim().replace(/^["'](.*)["']$/, "$1")
  }
  return { fields, body: match[2]!, bytes: Buffer.byteLength(raw, "utf8") }
}

describe("shipped plugin skills", () => {
  const charts = parseSkill("skills/charts/SKILL.md")
  const cookbook = parseSkill("skills/charts-cookbook/SKILL.md")

  test("parse cleanly, match directory names, stay within size budgets and carry triggers and anti-triggers", () => {
    expect(charts.fields.name).toBe("charts")
    expect(cookbook.fields.name).toBe("charts-cookbook")
    for (const skill of [charts, cookbook]) {
      expect(skill.fields.description).toBeDefined()
      expect(skill.fields.description!.includes("\n")).toBe(false)
      expect(skill.fields.description!.length).toBeLessThanOrEqual(1024)
    }
    expect(charts.fields.description).toContain("Use for")
    expect(charts.fields.description).toContain("Not for")
    expect(charts.bytes).toBeLessThanOrEqual(16 * 1024)
    expect(cookbook.bytes).toBeLessThanOrEqual(85 * 1024)
  })

  test("contain no machine paths, status URLs or @handle-like tokens (T0-07)", () => {
    for (const [id, skill] of [["charts", charts], ["charts-cookbook", cookbook]] as const) {
      expect({ id, path: /\/Users\/|\/private\/var\/|\.\.\/\.\.\//.test(skill.body) }).toEqual({ id, path: false })
      const handles = [...skill.body.matchAll(/@([A-Za-z0-9_]{3,})/g)]
        .map(m => m[1]!)
        .filter(h => !PLACEHOLDER_HANDLES.has(h.toLowerCase()))
      expect({ id, handles }).toEqual({ id, handles: [] })
    }
  })

  test("skills/charts/SKILL.md names all 12 tools and documents the exact interaction enums", () => {
    for (const name of TOOL_NAMES) expect(charts.body).toContain(`charts_${name}`)
    for (const value of ['"auto"', '"off"', '"static"', '"highlight"', '"none"', '"x"', '"interval"']) {
      expect(charts.body).toContain(value)
    }
    const valid = ChartDocumentV1Schema.safeParse({
      version: 1,
      chart: { kind: "recipe", recipe: "scatter", data: { rows: [{ x: 1, y: 2 }] }, bindings: { x: "x", y: "y" } },
      interactions: { tooltip: "auto", legend: "static", zoom: "none", brush: "interval" },
    })
    expect(valid.success).toBe(true)
  })

  test("the cookbook's BoardDocumentV1 example validates cleanly", () => {
    const parsed = parseBoardDocument(BOARD_COOKBOOK_EXAMPLE.board)
    expect(parsed.version).toBe(1)
    expect(parsed.panels).toHaveLength(2)
  })

  test("document calls support motion/fps delivery options and refuse authoring frame fields with INPUT_CONFLICT", async () => {
    const ws = workspace()
    const env = { ...ws.env, assertFiles: async () => undefined }
    try {
      const doc = {
        version: 1,
        title: "Revenue by region",
        chart: {
          kind: "recipe",
          recipe: "bar",
          data: { rows: ROWS },
          bindings: { category: "region", value: "revenue" },
          options: { aggregate: "sum", yTitle: "Revenue (€k)" },
        },
      }
      const res = await runTool(env, "quick", { document: doc, motion: "entrance", inspect: false, name: "anim-doc" })
      const files = (res.output as { files: { svg: string } }).files
      const svg = readFileSync(join(ws.dir, files.svg), "utf8")
      expect(svg).toContain("charts-anim")

      const conflict = await runTool(env, "quick", { document: doc, kicker: "ECONOMY", inspect: false }).catch(e => e)
      expect(conflict.code).toBe("INPUT_CONFLICT")
    } finally {
      ws.cleanup()
    }
  })
})
