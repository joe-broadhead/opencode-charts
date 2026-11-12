// ---------------------------------------------------------------------------------------------------------------
// The compact number format: 1.2k, 3.4M, 5.6B, with an optional currency. One self-contained function, registered
// with Vega for SVG and PNG and bundled into both browser runtimes for interactive HTML, so all format identically.
// The format string is "<symbol>|<p|s>|<decimal>": symbol, prefix or suffix placement, decimal separator.

export function compactFormat(value: unknown, spec: unknown): string {
  const n = typeof value === "number" ? value : Number(value)
  if (!Number.isFinite(n)) return String(value ?? "")
  const parts = String(spec ?? "").split("|")
  const symbol = parts[0] || "", suffix = parts[1] === "s", decimal = parts[2] || "."
  const abs = Math.abs(n)
  const units: [number, string][] = [[1e12, "T"], [1e9, "B"], [1e6, "M"], [1e3, "k"]]
  let body = ""
  const trim = (x: number, digits: number) => { let s = x.toFixed(digits); if (s.indexOf(".") >= 0) s = s.replace(/0+$/, "").replace(/\.$/, ""); return s }
  for (const [size, unit] of units) if (abs >= size) { const v = abs / size; body = trim(v, v < 10 ? 1 : 0) + unit; break }
  if (!body) body = trim(abs, abs < 1 ? 2 : abs < 10 ? 1 : 0)
  body = body.replace(".", decimal)
  const sign = n < 0 ? "−" : ""
  if (!symbol) return sign + body
  return suffix ? `${sign}${body} ${symbol}` : `${sign}${symbol}${body}`
}

export function compactSpec(currency: [string, string] | undefined, decimal: string): string {
  if (!currency || (currency[0] === "" && currency[1] === "")) return `||${decimal}`
  const suffix = currency[0] === ""
  const symbol = (suffix ? currency[1] : currency[0]).replace(/ /g, "").trim()
  return `${symbol}|${suffix ? "s" : "p"}|${decimal}`
}
