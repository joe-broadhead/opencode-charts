// ECharts text that the browser runtime inserts as HTML: the one check both the spec check (src/safety.ts) and the
// page (bundled into dist/browser/echarts.js, so its hash is covered by the page's CSP) run, so the two cannot drift.
// No imports: the browser bundle carries this file alone.
//
// ECharts' HTML tooltip (TooltipHTMLContent) sets innerHTML to the tooltip's formatter template, after replacing
// {a}/{b}/{c}/{d} with HTML-encoded values; a component tooltip (legend, axis name, graphic element) does the same
// with its formatter, and treats a string-valued `tooltip` as its formatter. `extraCssText` is appended to the
// tooltip's style and `className` becomes its class. Every other formatter (axis, label, legend text, axisPointer
// label) is drawn as SVG text, never parsed as HTML. So every `tooltip` object or string in an option is checked,
// wherever it is (top level, series, data item, mark data, legend and its items, axes, graphic elements): its
// formatter may use only attribute-free formatting tags, and its CSS and class name only inert text. Markup the CSP
// cannot stop (a <meta http-equiv="refresh">, a <base>, a form) is refused by the same rule.

export const TOOLTIP_TAGS = ["br", "b", "strong", "i", "em", "span", "p", "div", "table", "tr", "td"] as const
const ALLOWED_TAG = new RegExp(`<\\/?(?:${TOOLTIP_TAGS.join("|")})\\s*\\/?>`, "gi")
// Character references that decode to "<": &lt (with or without ;), &#60 and &#x3c, with any leading zeros.
const LT_REFERENCE = /&(?:lt|#0*60(?![0-9])|#x0*3c(?![0-9a-f]))/i
// `@\s*import` (not the bare word) so the page that bundles this file carries no literal at-import.
const UNSAFE_CSS = /url\s*\(|expression\s*\(|@\s*import|\\/i
const CLASS_NAME = /^[A-Za-z0-9_ -]*$/

/** Why a tooltip formatter would put more than plain formatting into the page, or undefined when it would not. */
export function tooltipMarkupProblem(text: string): string | undefined {
  const rest = text.replace(ALLOWED_TAG, "")
  const at = rest.indexOf("<")
  if (at >= 0) return `markup other than attribute-free formatting tags (${JSON.stringify(rest.slice(at, at + 40))})`
  const ref = LT_REFERENCE.exec(text)
  if (ref) return `a character reference that decodes to "<" (${JSON.stringify(text.slice(ref.index, ref.index + 12))})`
  return undefined
}

export interface TooltipMarkup {
  /** JSON pointer to the refused string. */
  readonly path: string
  readonly kind: "formatter" | "css" | "className"
  readonly what: string
}

const pointerOf = (parts: readonly (string | number)[]) => parts.length === 0 ? "/" : "/" + parts.map(p => String(p).replace(/~/g, "~0").replace(/\//g, "~1")).join("/")

/** Every tooltip string in an ECharts option that ECharts would insert as HTML and that is not inert. */
export function findTooltipMarkup(option: unknown): TooltipMarkup[] {
  const found: TooltipMarkup[] = []
  const checkTooltip = (tooltip: unknown, path: (string | number)[]) => {
    if (typeof tooltip === "string") { const what = tooltipMarkupProblem(tooltip); if (what) found.push({ path: pointerOf(path), kind: "formatter", what }); return }
    if (!tooltip || typeof tooltip !== "object" || Array.isArray(tooltip)) return
    const t = tooltip as Record<string, unknown>
    if (typeof t.formatter === "string") { const what = tooltipMarkupProblem(t.formatter); if (what) found.push({ path: pointerOf([...path, "formatter"]), kind: "formatter", what }) }
    if (typeof t.extraCssText === "string" && UNSAFE_CSS.test(t.extraCssText)) found.push({ path: pointerOf([...path, "extraCssText"]), kind: "css", what: "url(), expression(), an at-rule import or a backslash in its CSS" })
    if (typeof t.className === "string" && !CLASS_NAME.test(t.className)) found.push({ path: pointerOf([...path, "className"]), kind: "className", what: "a class name with characters other than letters, digits, dashes, underscores and spaces" })
  }
  const visit = (value: unknown, path: (string | number)[]) => {
    if (Array.isArray(value)) { value.forEach((item, i) => visit(item, [...path, i])); return }
    if (!value || typeof value !== "object") return
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      // A dataset holds rows of data, whose columns may be called anything; it carries no options.
      if (key === "dataset" && path.length === 0) continue
      if (key === "tooltip") checkTooltip(child, [...path, key])
      visit(child, [...path, key])
    }
  }
  visit(option, [])
  return found
}
