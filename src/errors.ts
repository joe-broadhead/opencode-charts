/**
 * Every failure is `CODE: what happened. Next step: what to do.`, with one next step, so a model can correct itself.
 * A spec problem also names the JSON path it is at (`/encoding/y/field`).
 */
export class ChartsError extends Error {
  constructor(
    readonly code: string,
    readonly detail: string,
    readonly hint: string,
    readonly path?: string,
  ) {
    super(formatFailure(code, `${detail}${path ? ` (at ${path})` : ""}`, hint))
    this.name = "ChartsError"
  }
}

/** One failure in the family's form: `CODE: what happened. Next step: what to do.` */
export function formatFailure(code: string, what: string, next: string): string {
  return `${code}: ${what.trimEnd()} Next step: ${next}`
}

/** A problem found while checking a spec. `error` stops the render; `warning` is reported with the result. */
export interface Issue {
  readonly level: "error" | "warning"
  readonly code: string
  readonly message: string
  /** JSON pointer into the spec, such as `/encoding/x/field`. */
  readonly path?: string
  /** One concrete fix. */
  readonly fix?: string
}

export const isChartsError = (error: unknown): error is ChartsError => error instanceof ChartsError

export function formatIssues(issues: readonly Issue[]): string {
  return issues.map(issue => `- [${issue.level}] ${issue.code}${issue.path ? ` at ${issue.path}` : ""}: ${issue.message}${issue.fix ? ` Fix: ${issue.fix}` : ""}`).join("\n")
}

/** The spec cannot render; carries every error found so the model can fix them all in one go. */
export class SpecInvalid extends ChartsError {
  constructor(readonly issues: readonly Issue[]) {
    super("SPEC_INVALID", `The chart spec has ${issues.filter(i => i.level === "error").length} problem(s):\n${formatIssues(issues)}\n`, "Fix the listed problems and call the tool again.")
  }
}

/** Levenshtein distance, for "did you mean". */
export function distance(a: string, b: string): number {
  const m = a.length, n = b.length
  const row = Array.from({ length: n + 1 }, (_, j) => j)
  for (let i = 1; i <= m; i++) {
    let prev = row[0]!
    row[0] = i
    for (let j = 1; j <= n; j++) {
      const tmp = row[j]!
      row[j] = Math.min(row[j]! + 1, row[j - 1]! + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1))
      prev = tmp
    }
  }
  return row[n]!
}

/** The closest candidates to `name`, case-insensitively, best first. */
export function suggest(name: string, candidates: readonly string[], max = 3): string[] {
  const lower = name.toLowerCase()
  return candidates
    .map(candidate => {
      const c = candidate.toLowerCase()
      const score = distance(lower, c)
      return { candidate, score, contained: c.includes(lower) || lower.includes(c) }
    })
    .filter(({ score, candidate, contained }) => contained || score <= Math.max(2, Math.floor(candidate.length / 3)))
    .sort((a, b) => a.score - b.score || a.candidate.localeCompare(b.candidate))
    .slice(0, max)
    .map(({ candidate }) => candidate)
}

export const pointer = (parts: readonly (string | number)[]) => parts.length === 0 ? "/" : "/" + parts.map(p => String(p).replaceAll("~", "~0").replaceAll("/", "~1")).join("/")
