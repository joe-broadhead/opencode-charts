// One engine detection rule: the renderer and chart documents use the same function, so a raw spec and an engine
// document holding it can never be read as different engines.
import { describe, expect, test } from "bun:test"
import { detectEngine as core } from "../src/document/engine.ts"
import { detectEngine as pipeline } from "../src/pipeline.ts"

describe("detectEngine", () => {
  test("the pipeline's is the core's, not a copy", () => {
    expect(pipeline).toBe(core)
  })
  test("the rule", () => {
    expect(core({ mark: "bar" })).toBe("vega-lite")
    expect(core({ $schema: "https://vega.github.io/schema/vega/v6.json" })).toBe("vega")
    expect(core({ marks: [] })).toBe("vega")
    expect(core({ series: [] })).toBe("echarts")
    expect(core({ $schema: "https://vega.github.io/schema/vega-lite/v6.json", series: [] })).toBe("vega-lite")
  })
})
