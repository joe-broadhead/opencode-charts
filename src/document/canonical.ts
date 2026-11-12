import { createHash } from "node:crypto"
import { ChartsError, pointer, type ChartsCode } from "../errors.js"
import { LIMITS, PROTOTYPE_KEYS } from "../safety.js"

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

/** Levels a whole document or artifact adds above a row or a spec (envelope, document, chart, data, rows, row…). */
export const NESTING_ALLOWANCE = 8
/** The deepest a whole document or artifact may nest: each row or spec within it is held to LIMITS.depth. */
export const DOCUMENT_DEPTH = LIMITS.depth + NESTING_ALLOWANCE

export interface ScanOptions {
  /** Path of `root` inside the document, for error pointers. */
  readonly base?: readonly (string | number)[]
  /** The deepest nesting allowed below `root`. */
  readonly maxDepth: number
  readonly code: ChartsCode
  /** What is being read, for the message: "The document", "The artifact", "Row 3". */
  readonly what: string
}

/**
 * Walks parsed JSON without recursion, before anything recursive touches it: refuses prototype keys (`__proto__`,
 * `constructor`, `prototype`) and nesting deeper than `maxDepth`, each with a coded error and its JSON pointer.
 */
export function scanJson(root: unknown, options: ScanOptions) {
  const base = options.base ?? []
  const stack: { node: unknown; path: (string | number)[]; depth: number }[] = [{ node: root, path: [...base], depth: 0 }]
  while (stack.length) {
    const { node, path, depth } = stack.pop()!
    if (!node || typeof node !== "object") continue
    if (depth > options.maxDepth) throw new ChartsError(options.code, `${options.what} is nested deeper than ${options.maxDepth} levels (at ${pointer(path)}).`, "Flatten the nested values; chart data, specs and documents need far fewer levels.", pointer(path))
    if (Array.isArray(node)) { for (let i = node.length - 1; i >= 0; i--) stack.push({ node: node[i], path: [...path, i], depth: depth + 1 }); continue }
    for (const key of Object.keys(node)) {
      if (PROTOTYPE_KEYS.has(key)) throw new ChartsError(options.code, `${options.what} has the key "${key}", which names an object's prototype and is not allowed.`, "Rename that key; chart data, specs and documents never need __proto__, constructor or prototype.", pointer([...path, key]))
      stack.push({ node: (node as Record<string, unknown>)[key], path: [...path, key], depth: depth + 1 })
    }
  }
}

/**
 * A JSON-safe deep copy with sorted keys. `base` prefixes error paths; `maxDepth` bounds the nesting below `value`,
 * checked before the copy recurses. Prototype keys are refused, and every member is defined, never assigned.
 */
export function canonicalValue(value: unknown, base: readonly (string | number)[] = [], maxDepth = DOCUMENT_DEPTH): JsonValue {
  scanJson(value, { base, maxDepth, code: "DATA_INVALID", what: "The value" })
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
        Object.defineProperty(out, key, { value: visit(child, [...path, key]), enumerable: true, writable: true, configurable: true })
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

/**
 * UTF-8 byte length, computed from the UTF-16 code units without allocating: a surrogate pair is 4 bytes, and a lone
 * surrogate 3 (it encodes as U+FFFD, as TextEncoder does).
 */
export function byteLength(text: string): number {
  let bytes = 0
  for (let i = 0; i < text.length; i++) {
    const unit = text.charCodeAt(i)
    if (unit < 0x80) bytes += 1
    else if (unit < 0x800) bytes += 2
    else if (unit >= 0xd800 && unit <= 0xdbff && i + 1 < text.length && (text.charCodeAt(i + 1) & 0xfc00) === 0xdc00) { bytes += 4; i++ }
    else bytes += 3
  }
  return bytes
}

/** UTF-8 text from bytes, with the platform-neutral decoder. */
export const decodeUtf8 = (bytes: Uint8Array) => new TextDecoder("utf-8").decode(bytes)
