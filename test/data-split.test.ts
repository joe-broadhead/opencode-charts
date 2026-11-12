// loadData split into parse (capture) and transform. Every legacy caller still calls loadData, and loadData must stay
// exactly parse + transform: same rows, same order, same source text, same errors. The parse half never transforms,
// which is what a saved document captures.
import { afterAll, describe, expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { parquetWriteBuffer } from "hyparquet-writer"
import { applyTransforms, loadData, parseData, parseDataBytes, transformData, type DataInput } from "../src/data.ts"
import { closeVegaWorker } from "../src/engines/vega-pool.ts"
import { workspace } from "./helpers.ts"

const ws = workspace()
afterAll(async () => { ws.cleanup(); await closeVegaWorker() })
mkdirSync(join(ws.dir, "data"), { recursive: true })
const CSV = "﻿region,revenue,when,flag\nNorth,120,2024-01-01,true\nSouth,80,2024-02-01,false\nNorth,30,2024-03-01,\nEast,,2024-04-01,true\n"
writeFileSync(join(ws.dir, "data/s.csv"), CSV)
writeFileSync(join(ws.dir, "data/s.tsv"), "region\trevenue\nNorth\t120\nSouth\t80\nNorth\t30\n")
writeFileSync(join(ws.dir, "data/s.json"), JSON.stringify({ data: [{ region: "North", revenue: 120 }, { region: "South", revenue: 80 }, { region: "North", revenue: 30 }] }))
writeFileSync(join(ws.dir, "data/s.jsonl"), '{"region":"North","revenue":120}\n\n{"region":"South","revenue":80}\n{"region":"North","revenue":30}\n')
writeFileSync(join(ws.dir, "data/s.parquet"), new Uint8Array(parquetWriteBuffer({ columnData: [{ name: "region", data: ["North", "South", "North"], type: "STRING" }, { name: "revenue", data: [120, 80, 30], type: "INT32" }] })))
writeFileSync(join(ws.dir, "data/s.dat"), "region,revenue\nNorth,1\n")

const SOURCE_ROWS: Record<string, number> = { inline: 3, "data/s.csv": 4, "data/s.tsv": 3, "data/s.json": 3, "data/s.jsonl": 3, "data/s.parquet": 3, "data/s.dat": 1 }
const TRANSFORMS: readonly (DataInput["transform"])[] = [
  undefined,
  [],
  [{ filter: "datum.revenue > 35" }],
  [{ calculate: "datum.revenue * 2", as: "revenue" }, { aggregate: [{ op: "sum", field: "revenue", as: "total" }], groupby: ["region"] }, { window: [{ op: "rank", as: "rank" }], sort: [{ field: "total", order: "descending" }] }],
]
const INPUTS: DataInput[] = [
  { rows: [{ region: "North", revenue: 120 }, { region: "South", revenue: 80 }, { region: "North", revenue: 30 }] },
  { path: "data/s.csv" }, { path: "data/s.tsv" }, { path: "data/s.json" }, { path: "data/s.jsonl" }, { path: "data/s.parquet" },
  { path: "data/s.dat", format: "csv" },
]

describe("loadData = parseData + transformData", () => {
  for (const input of INPUTS) for (const transform of TRANSFORMS) {
    test(`${input.path ?? "inline rows"} with ${transform === undefined ? "no" : transform.length} transform step(s)`, async () => {
      const full = { ...input, ...(transform ? { transform } : {}) }
      const legacy = await loadData(ws.env.workspace, full)
      const parsed = await parseData(ws.env.workspace, full)
      const split = await transformData(parsed.rows, full.transform)
      expect(split).toEqual(legacy.rows)
      expect(parsed.source).toBe(legacy.source)
      // The parse half applies no transform: it sees every row of the source.
      expect(parsed.rows.length).toBe(SOURCE_ROWS[input.path ?? "inline"]!)
    })
  }

  test("the parse half types CSV values exactly as before (the baseline's output) and applies no transform", async () => {
    const parsed = await parseData(ws.env.workspace, { path: "data/s.csv", transform: [{ filter: "false" }] })
    // Recorded from the baseline loadData: an empty cell makes the flag column text, and an empty number is null.
    expect(parsed.rows).toEqual([
      { region: "North", revenue: 120, when: "2024-01-01", flag: "true" },
      { region: "South", revenue: 80, when: "2024-02-01", flag: "false" },
      { region: "North", revenue: 30, when: "2024-03-01", flag: "" },
      { region: "East", revenue: null, when: "2024-04-01", flag: "true" },
    ])
    expect((await loadData(ws.env.workspace, { path: "data/s.csv", transform: [{ filter: "false" }] })).rows).toEqual([])
  })

  test("inline rows without a transform come back as the same array, as before", async () => {
    const rows = [{ a: 1 }]
    expect((await loadData(ws.env.workspace, { rows })).rows).toBe(rows)
    expect((await parseData(ws.env.workspace, { rows })).rows).toBe(rows)
  })

  test("provenance only when asked: the relative path, the format and the digest of the bytes read", async () => {
    expect((await parseData(ws.env.workspace, { path: "data/s.csv" })).provenance).toBeUndefined()
    expect((await parseData(ws.env.workspace, { rows: [{ a: 1 }] }, { provenance: true })).provenance).toBeUndefined()
    const bytes = readFileSync(join(ws.dir, "data/s.csv"))
    expect((await parseData(ws.env.workspace, { path: "./data/s.csv" }, { provenance: true })).provenance).toEqual({ path: "data/s.csv", format: "csv", sha256: `sha256:${createHash("sha256").update(bytes).digest("hex")}`, bytes: bytes.byteLength })
  })

  test("the same errors in the same order: both, neither, unknown format, outside the workspace", async () => {
    for (const input of [{ rows: [{ a: 1 }], path: "data/s.csv" }, {}, { path: "data/s.unknown" }, { path: "../x.csv" }, { rows: [1] as never }] as DataInput[]) {
      const a = await loadData(ws.env.workspace, input).then(() => "ok", (e: Error) => e.message)
      const b = await parseData(ws.env.workspace, input).then(() => "ok", (e: Error) => e.message)
      expect(b).toBe(a)
      expect(a).not.toBe("ok")
    }
  })

  test("parseDataBytes needs no file access, and the in-process transform matches the worker's", async () => {
    const rows = await parseDataBytes(new TextEncoder().encode("a,b\n1,x\n2,y\n"), "csv", "inline.csv")
    expect(rows).toEqual([{ a: 1, b: "x" }, { a: 2, b: "y" }])
    const t = TRANSFORMS[3]!
    const parsed = (await parseData(ws.env.workspace, INPUTS[0]!)).rows
    expect(applyTransforms(structuredClone(parsed), t!)).toEqual(await transformData(parsed, t))
  })
})
