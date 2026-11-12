import { ChartsError, formatIssues, type ChartsCode, type Issue } from "../errors.js"

/** Codes that describe the document's shape; a document with only these fails as DOCUMENT_INVALID. */
const SHAPE_CODES = new Set<ChartsCode>(["DOCUMENT_INVALID", "UNKNOWN_PROPERTY", "FIELD_MISSING"])

/**
 * A chart document that cannot be compiled, with every problem found: each issue has its JSON path into the document
 * and one fix. The error's own code is the first problem's when that is a specific one (AGGREGATION_REQUIRED,
 * LAYOUT_UNSUPPORTED…), and DOCUMENT_INVALID for shape problems.
 */
export class DocumentInvalid extends ChartsError {
  readonly issues: readonly Issue[]
  constructor(issues: readonly Issue[]) {
    const [code, detail, hint, path] = summarise(issues)
    super(code, detail, hint, path)
    this.issues = issues
    this.name = "DocumentInvalid"
  }
}

function summarise(issues: readonly Issue[]): [ChartsCode, string, string, string | undefined] {
  const errors = issues.filter(i => i.level === "error")
  const shown = errors.length ? errors : issues
  const first = shown[0]!
  const code: ChartsCode = SHAPE_CODES.has(first.code) ? "DOCUMENT_INVALID" : first.code
  if (shown.length === 1) return [code, first.code === code ? first.message : `${first.code}: ${first.message}`, first.fix ?? "Fix it and call the tool again.", first.path]
  return [code, `The chart document has ${shown.length} problems:\n${formatIssues(shown)}\n`, "Fix the listed problems and call the tool again.", undefined]
}

/** Collects issues; `throwIfErrors` raises them together. */
export class IssueList {
  readonly items: Issue[] = []
  error(code: ChartsCode, message: string, path: string, fix?: string) { this.items.push({ level: "error", code, message, path, ...(fix ? { fix } : {}) }) }
  warn(code: ChartsCode, message: string, path: string, fix?: string) { this.items.push({ level: "warning", code, message, path, ...(fix ? { fix } : {}) }) }
  get hasErrors() { return this.items.some(i => i.level === "error") }
  throwIfErrors() { if (this.hasErrors) throw new DocumentInvalid(this.items) }
  warnings(): Issue[] { return this.items.filter(i => i.level === "warning") }
}
