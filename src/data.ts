import { readFileSync, statSync } from "node:fs"
import { extname } from "node:path"
import * as vega from "vega"
import { compile } from "vega-lite"
import { parquetReadObjects } from "hyparquet"
import { ChartsError } from "./errors.js"
import { confine, type Workspace } from "./paths.js"
import { LIMITS, checkCardinality, deniedLoader } from "./safety.js"

export type Row = Record<string, unknown>
export interface DataInput {
  /** Inline rows: an array of flat objects. */
  readonly rows?: readonly Row[]
  /** A workspace file: .csv, .tsv, .json (an array of objects, or {rows|data|values: [...]}), .jsonl or .parquet. */
  readonly path?: string
  readonly format?: "csv" | "tsv" | "json" | "jsonl" | "parquet"
  /** Vega-Lite transforms (filter, calculate, aggregate, window, pivot, fold, joinaggregate, bin, timeUnit…) applied before charting. */
  readonly transform?: readonly Record<string, unknown>[]
}
export interface LoadedData { readonly rows: Row[]; readonly source: string }

const FORMATS: Record<string, DataInput["format"]> = { ".csv": "csv", ".tsv": "tsv", ".txt": "tsv", ".json": "json", ".jsonl": "jsonl", ".ndjson": "jsonl", ".parquet": "parquet", ".pq": "parquet" }

function plainRows(value: unknown, where: string): Row[] {
  const array = Array.isArray(value) ? value : value && typeof value === "object" ? ((value as Row).rows ?? (value as Row).data ?? (value as Row).values) : undefined
  if (!Array.isArray(array)) throw new ChartsError("DATA_INVALID", `${where} is not an array of rows.`, "Give an array of objects, such as [{\"region\":\"North\",\"revenue\":12}].")
  if (array.length > LIMITS.dataRows) throw new ChartsError("DATA_TOO_LARGE", `${where} has ${array.length} rows, over ${LIMITS.dataRows}.`, "Aggregate first (data.transform with aggregate), or sample the data.")
  array.forEach((row, i) => { if (!row || typeof row !== "object" || Array.isArray(row)) throw new ChartsError("DATA_INVALID", `Row ${i} of ${where} is not an object.`, "Each row is an object of field: value.", `/data/rows/${i}`) })
  return array as Row[]
}

/** Numbers and booleans become numbers and booleans; dates stay ISO strings so time zones never shift them. */
function typed(rows: Row[]): Row[] {
  if (rows.length === 0) return rows
  const fields = Object.keys(rows[0]!)
  const types = (vega as unknown as { inferTypes: (rows: Row[], fields: string[]) => Record<string, string> }).inferTypes(rows, fields)
  return rows.map(row => {
    const out: Row = {}
    for (const [key, value] of Object.entries(row)) {
      const type = types[key]
      if (typeof value === "string" && (type === "integer" || type === "number")) out[key] = value.trim() === "" ? null : Number(value)
      else if (typeof value === "string" && type === "boolean") out[key] = value.trim() === "" ? null : value.trim().toLowerCase() === "true"
      else out[key] = value
    }
    return out
  })
}

const normalise = (value: unknown): unknown => {
  if (typeof value === "bigint") return Number.isSafeInteger(Number(value)) ? Number(value) : value.toString()
  if (value instanceof Date) return value.toISOString()
  if (value instanceof Uint8Array) return `<${value.byteLength} bytes>`
  return value
}

export async function loadData(workspace: Workspace, input: DataInput): Promise<LoadedData> {
  if (input.rows && input.path) throw new ChartsError("DATA_INVALID", "Give data.rows or data.path, not both.", "Keep one of them.")
  let rows: Row[], source: string
  if (input.rows) { rows = plainRows(input.rows, "data.rows"); source = `${rows.length} inline rows` }
  else if (input.path) {
    const file = confine(workspace, input.path, "read")
    const size = statSync(file.absolute).size
    if (size > LIMITS.dataBytes) throw new ChartsError("DATA_TOO_LARGE", `${file.relative} is ${(size / 1048576).toFixed(1)} MB, over ${LIMITS.dataBytes / 1048576} MB.`, "Aggregate or sample the file first.")
    const format = input.format ?? FORMATS[extname(file.absolute).toLowerCase()]
    if (!format) throw new ChartsError("DATA_FORMAT_UNKNOWN", `The format of ${file.relative} is not known from its extension.`, "Set data.format to csv, tsv, json, jsonl or parquet.")
    const bytes = readFileSync(file.absolute)
    if (format === "parquet") {
      const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
      const objects = await parquetReadObjects({ file: buffer as ArrayBuffer, rowEnd: LIMITS.dataRows + 1 })
      rows = plainRows(objects.map(row => Object.fromEntries(Object.entries(row).map(([k, v]) => [k, normalise(v)]))), file.relative)
    } else if (format === "json") {
      try { rows = plainRows(JSON.parse(bytes.toString("utf8")), file.relative) } catch (error) { if (error instanceof ChartsError) throw error; throw new ChartsError("DATA_INVALID", `${file.relative} is not valid JSON.`, "Fix the file, or set data.format.") }
    } else if (format === "jsonl") {
      rows = plainRows(bytes.toString("utf8").split(/\r?\n/).filter(line => line.trim()).map((line, i) => { try { return JSON.parse(line) } catch { throw new ChartsError("DATA_INVALID", `Line ${i + 1} of ${file.relative} is not JSON.`, "Fix that line.") } }), file.relative)
    } else {
      const text = bytes.toString("utf8").replace(/^﻿/, "")
      rows = plainRows(typed(vega.read(text, { type: format }) as Row[]), file.relative)
    }
    source = `${file.relative} (${rows.length} rows)`
  } else throw new ChartsError("DATA_MISSING", "No data was given.", "Pass data.rows (inline) or data.path (a workspace file).")
  if (input.transform?.length) {
    const { transformRows } = await import("./engines/vega-pool.js")
    rows = (await transformRows(rows, input.transform, applyTransforms)) as Row[]
  }
  return { rows, source }
}

/** Runs Vega-Lite transforms over rows, through Vega's own dataflow, after the same cardinality checks as a chart. */
export function applyTransforms(rows: Row[], transform: readonly Record<string, unknown>[]): Row[] {
  const spec = { data: { values: structuredClone(rows) }, transform: structuredClone(transform), mark: "point" } as never
  let compiled: Record<string, unknown>
  try { compiled = compile(spec).spec as Record<string, unknown> }
  catch (error) { throw new ChartsError("TRANSFORM_INVALID", `data.transform is invalid: ${(error as Error).message}`, "Check each step against the Vega-Lite transform docs; charts_catalogue shows examples.", "/data/transform") }
  checkCardinality(compiled, rows.length)
  const marks = compiled.marks as { from?: { data?: string } }[] | undefined
  const name = marks?.[0]?.from?.data
  if (!name) throw new ChartsError("TRANSFORM_INVALID", "data.transform produced no dataset.", "Check the transform steps.", "/data/transform")
  const view = new vega.View(vega.parse(compiled as never), { renderer: "none", loader: deniedLoader() as never })
  view.run()
  const out = (view.data(name) as Row[]).map(row => Object.fromEntries(Object.entries(row).map(([k, v]) => [k, normalise(v)])))
  view.finalize()
  return out
}

// ---------------------------------------------------------------------------------------------------------------
// Data profile: what the agent hears about the data, and what validation and lint check fields against.

export interface FieldProfile {
  readonly name: string
  readonly type: "number" | "temporal" | "string" | "boolean" | "mixed" | "empty"
  readonly distinct: number
  readonly missing: number
  readonly min?: number | string
  readonly max?: number | string
  readonly mean?: number
  readonly top?: readonly string[]
}
export interface Profile { readonly rows: number; readonly fields: readonly FieldProfile[] }

const DATE = /^\d{4}-\d{2}(-\d{2})?([T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$/

export function profile(rows: readonly Row[]): Profile {
  const names = [...new Set(rows.slice(0, 2000).flatMap(row => Object.keys(row)))]
  const fields = names.map((name): FieldProfile => {
    const values = rows.map(row => row[name]).filter(v => v !== null && v !== undefined && v !== "")
    const missing = rows.length - values.length
    const distinct = new Set(values.map(v => (typeof v === "object" ? JSON.stringify(v) : String(v)))).size
    if (values.length === 0) return { name, type: "empty", distinct: 0, missing }
    if (values.every(v => typeof v === "number" && Number.isFinite(v))) {
      const nums = values as number[]
      let min = Infinity, max = -Infinity, sum = 0
      for (const n of nums) { if (n < min) min = n; if (n > max) max = n; sum += n }
      return { name, type: "number", distinct, missing, min, max, mean: sum / nums.length }
    }
    if (values.every(v => typeof v === "boolean")) return { name, type: "boolean", distinct, missing }
    if (values.every(v => typeof v === "string" && DATE.test(v))) {
      const sorted = (values as string[]).slice().sort()
      return { name, type: "temporal", distinct, missing, min: sorted[0], max: sorted[sorted.length - 1] }
    }
    if (values.every(v => typeof v === "string")) {
      const counts = new Map<string, number>()
      for (const v of values as string[]) counts.set(v, (counts.get(v) ?? 0) + 1)
      const top = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 5).map(([v]) => v)
      return { name, type: "string", distinct, missing, top }
    }
    return { name, type: "mixed", distinct, missing }
  })
  return { rows: rows.length, fields }
}

const fmt = (n: number) => Math.abs(n) >= 1e6 ? `${(n / 1e6).toFixed(2)}M` : Math.abs(n) >= 1e4 ? `${(n / 1e3).toFixed(1)}k` : Number.isInteger(n) ? String(n) : n.toFixed(2)

export function describeProfile(p: Profile): string {
  const parts = p.fields.slice(0, 16).map(f => {
    if (f.type === "number") return `${f.name} (number ${fmt(f.min as number)}–${fmt(f.max as number)}, mean ${fmt(f.mean!)})`
    if (f.type === "temporal") return `${f.name} (date ${f.min}–${f.max})`
    if (f.type === "string") return `${f.name} (${f.distinct} categories${f.top?.length ? `: ${f.top.slice(0, 3).join(", ")}${f.distinct > 3 ? "…" : ""}` : ""})`
    return `${f.name} (${f.type})`
  })
  return `${p.rows} rows; fields: ${parts.join("; ")}${p.fields.length > 16 ? `; and ${p.fields.length - 16} more` : ""}.`
}
