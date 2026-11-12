import { createHash } from "node:crypto"
import { ChartsError, pointer } from "../errors.js"

/**
 * Canonical JSON: the one serialisation a saved chart is hashed and written in. Object keys are sorted by Unicode
 * code point, arrays and rows keep their order, `undefined` object members are left out (as JSON does), -0 is 0, and
 * anything JSON cannot carry exactly (a non-finite number, a function, a symbol, a Date, a Map, `undefined` inside an
 * array) is refused with its path rather than silently turned into something else.
 */

export type JsonScalar = string | number | boolean | null
export type JsonValue = JsonScalar | readonly JsonValue[] | { readonly [key: string]: JsonValue }

/** Code-point order, independent of locale and of UTF-16 surrogate layout. */
export function compareCodePoints(a: string, b: string): number {
  if (a === b) return 0
  const ia = a[Symbol.iterator](), ib = b[Symbol.iterator]()
  for (;;) {
    const x = ia.next(), y = ib.next()
    if (x.done) return y.done ? 0 : -1
    if (y.done) return 1
    const cx = x.value.codePointAt(0)!, cy = y.value.codePointAt(0)!
    if (cx !== cy) return cx < cy ? -1 : 1
  }
}

const isPlainObject = (value: object) => {
  const proto = Object.getPrototypeOf(value)
  return proto === Object.prototype || proto === null
}

function refuse(path: readonly (string | number)[], what: string): never {
  throw new ChartsError("DATA_INVALID", `The value at ${pointer(path)} is ${what}, which JSON cannot store exactly.`, "Use null, a boolean, a finite number, a string, an array or a plain object there.", pointer(path))
}

/** A JSON-safe deep copy with sorted keys. `base` prefixes error paths. */
export function canonicalValue(value: unknown, base: readonly (string | number)[] = []): JsonValue {
  const visit = (node: unknown, path: (string | number)[]): JsonValue => {
    if (node === null || typeof node === "string" || typeof node === "boolean") return node
    if (typeof node === "number") {
      if (!Number.isFinite(node)) refuse(path, String(node))
      return Object.is(node, -0) ? 0 : node
    }
    if (Array.isArray(node)) return node.map((item, i) => {
      if (item === undefined) refuse([...path, i], "undefined")
      return visit(item, [...path, i])
    })
    if (typeof node === "object") {
      if (!isPlainObject(node)) refuse(path, `a ${(node as object).constructor?.name ?? "non-plain"} object`)
      const out: Record<string, JsonValue> = {}
      for (const key of Object.keys(node).sort(compareCodePoints)) {
        const child = (node as Record<string, unknown>)[key]
        if (child === undefined) continue
        out[key] = visit(child, [...path, key])
      }
      return out
    }
    return refuse(path, node === undefined ? "undefined" : `a ${typeof node}`)
  }
  return visit(value, [...base])
}

/** The canonical text: compact, sorted keys. Equal values give equal bytes. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalValue(value))
}

export const REVISION_PATTERN = /^sha256:[0-9a-f]{64}$/

/** `sha256:<64 hex>` of a string (UTF-8) or bytes. */
export function sha256(input: string | Uint8Array): string {
  return `sha256:${createHash("sha256").update(input).digest("hex")}`
}

export const isDigest = (value: unknown): value is string => typeof value === "string" && REVISION_PATTERN.test(value)

/** UTF-8 byte length without allocating a buffer per call site. */
export const byteLength = (text: string) => Buffer.byteLength(text, "utf8")
