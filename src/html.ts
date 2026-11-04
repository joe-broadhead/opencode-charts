import { createHash } from "node:crypto"
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { compactFormat, type Json } from "./engines/common.js"
import { ChartsError } from "./errors.js"
import type { ThemeTokens } from "./themes/tokens.js"

/**
 * Interactive HTML that works offline in a sandboxed frame: the chart runtime is inlined (no CDN), fonts are data
 * URLs, a Content-Security-Policy forbids every network fetch, and the static SVG is the page's first paint, so a
 * frame that runs no script still shows the chart.
 */
declare const BROWSER_RUNTIME_SHA256: Record<string, string> | undefined

const runtimes = new Map<string, string>()
function runtime(packageRoot: string, name: "vega" | "echarts"): string {
  const cached = runtimes.get(name)
  if (cached) return cached
  const path = join(packageRoot, "dist", "browser", `${name}.js`)
  if (!existsSync(path)) throw new ChartsError("HTML_UNAVAILABLE", `The ${name} browser runtime is missing from the package.`, "Reinstall the plugin, or ask for svg and png only.")
  const source = readFileSync(path, "utf8")
  const expected = typeof BROWSER_RUNTIME_SHA256 === "object" ? BROWSER_RUNTIME_SHA256?.[name] : undefined
  if (expected && createHash("sha256").update(source).digest("hex") !== expected) throw new ChartsError("HTML_UNAVAILABLE", `The ${name} browser runtime does not match the plugin build.`, "Reinstall the plugin.")
  runtimes.set(name, source)
  return source
}

const json = (value: unknown) => JSON.stringify(value).replace(/</g, "\\u003c").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029")
const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")

export interface HtmlInput {
  readonly engine: "vega" | "echarts"
  /** A compiled Vega spec, or an ECharts option (functions removed). */
  readonly spec: Json
  readonly svg: string
  readonly title: string
  readonly description: string
  readonly theme: ThemeTokens
  readonly echartsTheme?: Json
  readonly fonts: readonly { family: string; weight: number; woff2: Uint8Array }[]
  readonly compactSpec: string
  readonly localeId: string
}

export function buildHtml(packageRoot: string, input: HtmlInput): string {
  const code = runtime(packageRoot, input.engine)
  const faces = input.fonts.map(f => `@font-face{font-family:"${f.family}";font-weight:${f.weight};font-display:block;src:url(data:font/woff2;base64,${Buffer.from(f.woff2).toString("base64")}) format("woff2")}`).join("\n")
  const c = input.theme.colors
  const boot = input.engine === "vega"
    ? `var spec=JSON.parse(document.getElementById("chart-spec").textContent);
vega.expressionFunction("compact",${compactFormat.toString()});
var deny=function(){return Promise.reject(new Error("Charts load nothing."))};
var host=document.getElementById("chart");
var view=new vega.View(vega.parse(spec),{renderer:"svg",hover:true,loader:{load:deny,sanitize:deny,http:deny,file:deny}});
if(window.vegaTooltip)view.tooltip(new vegaTooltip.Handler({theme:"${input.theme.mode}"}).call);
view.initialize(document.createElement("div")).runAsync().then(function(v){host.textContent="";host.appendChild(v.container());});`
    : `var option=JSON.parse(document.getElementById("chart-spec").textContent);
var theme=JSON.parse(document.getElementById("chart-theme").textContent);
var compact=${compactFormat.toString()};
var spec=${json(input.compactSpec)};
var fmt=function(v){return Math.abs(v)>=10000?compact(v,spec):Number(v).toLocaleString(${json(input.localeId)})};
["xAxis","yAxis","radiusAxis","singleAxis"].forEach(function(k){var a=option[k];(Array.isArray(a)?a:a?[a]:[]).forEach(function(x){if((x.type==="value"||x.type==="log")&&!(x.axisLabel&&x.axisLabel.formatter)){x.axisLabel=Object.assign({},x.axisLabel,{formatter:fmt});}});});
if(!option.tooltip)option.tooltip={trigger:(option.series||[]).some(function(s){return s.type==="line"||s.type==="bar"})?"axis":"item",confine:true};
echarts.registerTheme("chart",theme);
var host=document.getElementById("chart");
var w=host.firstElementChild?host.firstElementChild.getAttribute("width"):null,h=host.firstElementChild?host.firstElementChild.getAttribute("height"):null;
host.textContent="";host.style.width=(w||640)+"px";host.style.height=(h||400)+"px";
echarts.init(host,"chart",{renderer:"svg"}).setOption(option);`
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; font-src data:; img-src data: blob:">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(input.title)}</title>
<style>
${faces}
html,body{margin:0;background:${c.background};color:${c.text};font-family:"${input.theme.font.family}",sans-serif}
main{padding:12px;display:flex;justify-content:center}
#chart svg{max-width:100%;height:auto}
#vg-tooltip-element{font-family:"${input.theme.font.family}",sans-serif}
</style>
</head>
<body>
<main><figure style="margin:0"><div id="chart" role="img" aria-label="${escapeHtml(input.title)}">${input.svg}</div><figcaption style="position:absolute;left:-9999px">${escapeHtml(input.description)}</figcaption></figure></main>
<script type="application/json" id="chart-spec">${json(input.spec)}</script>
${input.echartsTheme ? `<script type="application/json" id="chart-theme">${json(input.echartsTheme)}</script>` : ""}
<script>${code.replace(/<\/script/gi, "<\\/script")}</script>
<script>(function(){try{${boot}}catch(e){console.error(e)}})();</script>
</body>
</html>
`
}
