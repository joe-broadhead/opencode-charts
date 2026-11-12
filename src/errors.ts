/**
 * Every failure is `CODE: what happened. Next step: what to do.`, with one next step, so a model can correct itself.
 * A spec problem also names the JSON path it is at (`/encoding/y/field`).
 */
export class ChartsError extends Error {
  constructor(
    readonly code: ChartsCode,
    readonly detail: string,
    readonly hint: string,
    readonly path?: string,
  ) {
    super(formatFailure(code, `${detail}${path ? ` (at ${path})` : ""}`, hint))
    this.name = "ChartsError"
  }
}

/**
 * Every code this plugin raises or returns: the failures `ChartsError` carries and the codes an `Issue` reports in a
 * result. The README's and `docs/configuration.md`'s error tables name each one, and `test/codes.test.ts` fails when
 * either differs from `CHART_CODES` in either direction, or when a code is raised that is in neither table.
 */
export type ChartsCode =
  | "ATLAS_UNKNOWN"
  | "AXES_MISSING"
  | "CHART_TYPE_UNKNOWN"
  | "CURRENCY_UNKNOWN"
  | "DATA_EMPTY"
  | "DATA_FORMAT_UNKNOWN"
  | "DATA_INVALID"
  | "DATA_MISSING"
  | "DATA_TOO_LARGE"
  | "DATA_TWICE"
  | "DATE_AS_CATEGORY"
  | "DUAL_AXIS"
  | "DUPLICATE_TICKS"
  | "ECHARTS_COMPONENT_UNSUPPORTED"
  | "EMPTY_DATA"
  | "FIELD_MISSING"
  | "FILE_NOT_FOUND"
  | "FONT_GLYPH_MISSING"
  | "FONT_INVALID"
  | "FONT_NOT_BUNDLED"
  | "FONT_TOO_LARGE"
  | "HTML_UNAVAILABLE"
  | "INPUT_INVALID"
  | "LABEL_CLIPPED"
  | "LABEL_COLLISION"
  | "LABEL_DENSITY"
  | "LOCALE_UNKNOWN"
  | "LOW_CONTRAST"
  | "MISSING_UNITS"
  | "NOT_A_DATE"
  | "NOT_A_FILE"
  | "NO_MARK"
  | "NO_MARKS"
  | "NO_SERIES"
  | "OPTIONS_INVALID"
  | "OUTPUT_WRITE_FAILED"
  | "OVERPLOTTING"
  | "PATH_INVALID"
  | "PATH_IS_URL"
  | "PATH_OUTSIDE_WORKSPACE"
  | "PATH_PRIVATE"
  | "PIE_NEGATIVE"
  | "PIE_TOO_MANY_SLICES"
  | "PNG_TOO_LARGE"
  | "PNG_UNAVAILABLE"
  | "RAINBOW_SEQUENTIAL"
  | "RENDER_FAILED"
  | "SANKEY_CYCLE"
  | "SCALE_INVALID"
  | "SERIES_TYPE_MISSING"
  | "SIZE_INVALID"
  | "SIZE_OVERRIDE_IGNORED"
  | "SKILLS_INVALID"
  | "SPEC_INVALID"
  | "SPEC_TOO_EXPENSIVE"
  | "SPEC_TOO_LARGE"
  | "SPEC_UNSAFE"
  | "STATUS_UNAVAILABLE"
  | "THEME_CYCLE"
  | "THEME_INVALID"
  | "THEME_NAME_INVALID"
  | "THEME_NAME_TAKEN"
  | "THEME_NOT_FOUND"
  | "TOO_MANY_SERIES"
  | "TRANSFORM_INVALID"
  | "TRUNCATED_AXIS"
  | "TYPE_MISMATCH"
  | "UNKNOWN_CHANNEL"
  | "UNKNOWN_DATASET"
  | "UNKNOWN_FIELD"
  | "UNKNOWN_MARK"
  | "UNKNOWN_PROPERTY"
  | "UNKNOWN_TYPE"
  | "UNSORTED_BARS"
  | "VEGA_LITE_WARNING"
  | "VEGA_WARNING"

export const CHART_CODES: readonly ChartsCode[] = [
  "ATLAS_UNKNOWN",
  "AXES_MISSING",
  "CHART_TYPE_UNKNOWN",
  "CURRENCY_UNKNOWN",
  "DATA_EMPTY",
  "DATA_FORMAT_UNKNOWN",
  "DATA_INVALID",
  "DATA_MISSING",
  "DATA_TOO_LARGE",
  "DATA_TWICE",
  "DATE_AS_CATEGORY",
  "DUAL_AXIS",
  "DUPLICATE_TICKS",
  "ECHARTS_COMPONENT_UNSUPPORTED",
  "EMPTY_DATA",
  "FIELD_MISSING",
  "FILE_NOT_FOUND",
  "FONT_GLYPH_MISSING",
  "FONT_INVALID",
  "FONT_NOT_BUNDLED",
  "FONT_TOO_LARGE",
  "HTML_UNAVAILABLE",
  "INPUT_INVALID",
  "LABEL_CLIPPED",
  "LABEL_COLLISION",
  "LABEL_DENSITY",
  "LOCALE_UNKNOWN",
  "LOW_CONTRAST",
  "MISSING_UNITS",
  "NOT_A_DATE",
  "NOT_A_FILE",
  "NO_MARK",
  "NO_MARKS",
  "NO_SERIES",
  "OPTIONS_INVALID",
  "OUTPUT_WRITE_FAILED",
  "OVERPLOTTING",
  "PATH_INVALID",
  "PATH_IS_URL",
  "PATH_OUTSIDE_WORKSPACE",
  "PATH_PRIVATE",
  "PIE_NEGATIVE",
  "PIE_TOO_MANY_SLICES",
  "PNG_TOO_LARGE",
  "PNG_UNAVAILABLE",
  "RAINBOW_SEQUENTIAL",
  "RENDER_FAILED",
  "SANKEY_CYCLE",
  "SCALE_INVALID",
  "SERIES_TYPE_MISSING",
  "SIZE_INVALID",
  "SIZE_OVERRIDE_IGNORED",
  "SKILLS_INVALID",
  "SPEC_INVALID",
  "SPEC_TOO_EXPENSIVE",
  "SPEC_TOO_LARGE",
  "SPEC_UNSAFE",
  "STATUS_UNAVAILABLE",
  "THEME_CYCLE",
  "THEME_INVALID",
  "THEME_NAME_INVALID",
  "THEME_NAME_TAKEN",
  "THEME_NOT_FOUND",
  "TOO_MANY_SERIES",
  "TRANSFORM_INVALID",
  "TRUNCATED_AXIS",
  "TYPE_MISMATCH",
  "UNKNOWN_CHANNEL",
  "UNKNOWN_DATASET",
  "UNKNOWN_FIELD",
  "UNKNOWN_MARK",
  "UNKNOWN_PROPERTY",
  "UNKNOWN_TYPE",
  "UNSORTED_BARS",
  "VEGA_LITE_WARNING",
  "VEGA_WARNING",
]

/**
 * The codes the shared tools RPC module returns for a script's call, which `docs/scripting.md` documents beside the
 * plugin's own. `src/host/tools-rpc.ts` is a pinned copy of the family's module and is never edited here; its
 * `Code` union has seven more that only an MCP method or a per-account server can return, and Charts has neither.
 */
export type RpcCode =
  | "CANCELLED"
  | "PERMISSION_DENIED"
  | "SESSION_AGENT_REQUIRED"
  | "SESSION_UNKNOWN"
  | "TOOL_UNAVAILABLE"
  | "UPSTREAM_ERROR"

export const RPC_CODES: readonly RpcCode[] = [
  "CANCELLED",
  "PERMISSION_DENIED",
  "SESSION_AGENT_REQUIRED",
  "SESSION_UNKNOWN",
  "TOOL_UNAVAILABLE",
  "UPSTREAM_ERROR",
]

/** One failure in the family's form: `CODE: what happened. Next step: what to do.` */
export function formatFailure(code: ChartsCode, what: string, next: string): string {
  return `${code}: ${what.trimEnd()} Next step: ${next}`
}

/** A problem found while checking a spec. `error` stops the render; `warning` is reported with the result. */
export interface Issue {
  readonly level: "error" | "warning"
  readonly code: ChartsCode
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
