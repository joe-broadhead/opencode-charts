// Run by test/recipes.test.ts under several TZ values: prints the compiled marks of one temporal document, which must
// be the same bytes whatever the host's time zone.
import { parseDocument } from "../src/document/index.ts"
import { compileRecipe } from "../src/recipes/index.ts"

const rows = [
  { d: "2024-03-31", v: 1 }, { d: "2024-03-31 01:30", v: 2 }, { d: "2024-03-31T02:30:00+02:00", v: 3 },
  { d: "2024-10-27T01:30", v: 4 }, { d: "2024-12-31T23:59:59.999Z", v: 5 }, { d: "1969-12-31", v: 6 }, { d: "0099-01-01", v: 7 },
]
const doc = parseDocument({ version: 1, chart: { kind: "recipe", recipe: "line", data: { rows }, bindings: { x: "d", y: "v" }, options: { xType: "temporal", xSort: "input" } } })
process.stdout.write(JSON.stringify(compileRecipe(doc.chart as never, rows).values))
