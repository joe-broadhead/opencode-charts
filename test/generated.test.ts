import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { cookbook, documentsDoc } from "../scripts/cookbook.ts"
import { RECIPE_IDS } from "../src/recipes/types.ts"
import { ROOT } from "./helpers.ts"

/**
 * The generated files are what their generator writes from the catalogue and the recipe registry today: the cookbook
 * skill and the recipe table in docs/documents.md. A stale file fails here; `bun scripts/cookbook.ts` regenerates both.
 */

const read = (path: string) => readFileSync(join(ROOT, path), "utf8")

describe("generated documentation", () => {
  test("skills/charts-cookbook/SKILL.md is the generator's output", () => {
    expect(read("skills/charts-cookbook/SKILL.md")).toBe(cookbook())
  })

  test("docs/documents.md carries the generated recipe table", () => {
    const doc = read("docs/documents.md")
    expect(doc).toBe(documentsDoc(doc))
    for (const id of RECIPE_IDS) expect(doc).toContain(`| \`${id}\` |`)
  })

  test("the cookbook labels its recipe rows as a shape example and points at the full fixture", () => {
    const text = cookbook()
    for (const id of RECIPE_IDS) expect(text).toContain(`\`charts_catalogue {"id": "${id}"}\` returns this document with every row`)
  })
})
