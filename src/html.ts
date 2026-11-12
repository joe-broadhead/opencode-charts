import { createHash } from "node:crypto"
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import type { Json } from "./engines/common.js"
import { ChartsError } from "./errors.js"
import type { FontResource } from "./fonts.js"
import { cssString, fontFaceCss } from "./svg.js"
import type { ThemeTokens } from "./themes/tokens.js"

/**
 * Interactive HTML that works offline in a sandboxed frame: the chart runtime is inlined (no CDN), fonts are data
 * URLs, a Content-Security-Policy forbids every network fetch and every string-to-code evaluation (no `unsafe-eval`),
 * and the static SVG is the page's first paint, so a frame that runs no script still shows the chart. Only the page's
 * own two scripts run: `script-src` lists their SHA-256 hashes and nothing else, so markup that reaches the DOM (an
 * inline event handler, a `javascript:` URL, an injected `<script>`) cannot run.
 *
 * The live chart starts in an off-screen container once the embedded fonts have loaded, and replaces the static SVG
 * only after it has initialised; on any failure, synchronous or asynchronous, the static SVG stays and the shell says
 * so. The page's runtime status is `initializing`, then `ready` or `failed`, on `<html data-chart-status>` and on the
 * `#chart-status` live region. A file that was only generated has not run anywhere: its status is `initializing`.
 *
 * Vega runs with vega-interpreter: the spec is parsed with `{ast: true}` and the View evaluates expressions by walking
 * the syntax tree, so Vega never builds a function from a string (which the CSP would refuse).
 */
declare const BROWSER_RUNTIME_SHA256: Record<string, string> | undefined

/** How long the page waits for its embedded fonts before it reports `failed` and keeps the static chart. */
export const FONT_WAIT_MS = 10_000
/** At most this many characters of the failure's message reach the page. */
export const DIAGNOSTIC_MESSAGE_LIMIT = 240

// Keyed by package and runtime, so a check of one install never answers for another.
const runtimes = new Map<string, string>()
function runtime(packageRoot: string, name: "vega" | "echarts"): string {
  const key = `${packageRoot}\0${name}`
  const cached = runtimes.get(key)
  if (cached) return cached
  const path = join(packageRoot, "dist", "browser", `${name}.js`)
  if (!existsSync(path)) throw new ChartsError("HTML_UNAVAILABLE", `The ${name} browser runtime is missing from the package.`, "Reinstall the plugin, or ask for svg and png only.")
  const source = readFileSync(path, "utf8")
  const expected = typeof BROWSER_RUNTIME_SHA256 === "object" ? BROWSER_RUNTIME_SHA256?.[name] : undefined
  if (expected && createHash("sha256").update(source).digest("hex") !== expected) throw new ChartsError("HTML_UNAVAILABLE", `The ${name} browser runtime does not match the plugin build.`, "Reinstall the plugin.")
  runtimes.set(key, source)
  return source
}

/** The interactive HTML runtimes' problem, as a ChartsError, or undefined when both are there and match this build. */
export function htmlProblem(packageRoot: string): ChartsError | undefined {
  try {
    runtime(packageRoot, "vega")
    runtime(packageRoot, "echarts")
    return undefined
  } catch (error) {
    if (error instanceof ChartsError) return error
    throw error
  }
}

/**
 * The page's policy, for exactly these inline scripts. `script-src` is their hashes, so no other script, inline event
 * handler or `javascript:` URL runs. `style-src` keeps 'unsafe-inline' because the runtimes position and style the
 * chart and its tooltip with style attributes; a style cannot run script. JSON data blocks
 * (`<script type="application/json">`) are not executed, so they are not hashed.
 */
export function contentSecurityPolicy(scripts: readonly string[]): string {
  const hashes = scripts.map(text => `'sha256-${createHash("sha256").update(text, "utf8").digest("base64")}'`)
  return `default-src 'none'; script-src ${hashes.join(" ")}; style-src 'unsafe-inline'; font-src data:; img-src data: blob:; base-uri 'none'; form-action 'none'; object-src 'none'`
}

/** JSON that is safe inside `<script>`: no `<` (so no `</script>` or `<!--`), and no line separators. */
export const scriptJson = (value: unknown) => JSON.stringify(value).replace(/</g, "\\u003c").replace(/>/g, "\\u003e").replace(/&/g, "\\u0026").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029")
const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;")

export interface HtmlInput {
  readonly engine: "vega" | "echarts"
  /** A compiled Vega spec, or an ECharts option (functions removed). */
  readonly spec: Json
  readonly svg: string
  readonly title: string
  readonly description: string
  readonly theme: ThemeTokens
  readonly echartsTheme?: Json
  /** The approved font resources to embed: the same list the PNG was drawn with. */
  readonly fonts: readonly FontResource[]
  readonly compactSpec: string
  readonly localeId: string
}

/** The page's shared shell script: status, failure notice, off-screen stage, swap, and font readiness. */
const SHELL = `var root=document.documentElement,host=document.getElementById("chart"),statusEl=document.getElementById("chart-status"),failEl=document.getElementById("chart-failure"),diagEl=document.getElementById("chart-diagnostic");
var state="initializing",stage=null,cleanups=[];
function setStatus(s,text){state=s;root.setAttribute("data-chart-status",s);statusEl.setAttribute("data-status",s);statusEl.textContent=text;}
function dispose(){while(cleanups.length){try{cleanups.pop()()}catch(e){}}if(stage&&stage.parentNode)stage.parentNode.removeChild(stage);stage=null;}
function fail(step,err){if(state!=="initializing")return;var m=err&&err.message?err.message:String(err);var d={code:"HTML_RUNTIME_FAILED",engine:ENGINE,stage:step,message:m.slice(0,${DIAGNOSTIC_MESSAGE_LIMIT})};dispose();diagEl.textContent=JSON.stringify(d);failEl.hidden=false;setStatus("failed","The interactive view did not start; the static chart is shown.");}
function swap(live){if(state!=="initializing")return;host.textContent="";host.appendChild(live);if(stage&&stage.parentNode)stage.parentNode.removeChild(stage);stage=null;setStatus("ready","Interactive view ready.");}
function onError(e){fail("async",e&&(e.error||e.reason||e.message)||e);}
window.addEventListener("error",onError);window.addEventListener("unhandledrejection",onError);
function fontsReady(){var faces=FACES;if(!faces.length)return Promise.resolve();if(!document.fonts||!document.fonts.load)return Promise.reject(new Error("This browser cannot report font loading."));
var loads=Promise.all(faces.map(function(f){return document.fonts.load(f[1]+" 16px "+f[0]);})).then(function(){return document.fonts.ready;});
var limit=new Promise(function(_,reject){setTimeout(function(){reject(new Error("The embedded fonts did not load within ${FONT_WAIT_MS / 1000} s."))},${FONT_WAIT_MS})});
return Promise.race([loads,limit]).then(function(){var missing=faces.filter(function(f){return !document.fonts.check(f[1]+" 16px "+f[0]);});if(missing.length)throw new Error("Embedded font did not load: "+missing.map(function(f){return f[0]+" "+f[1]}).join(", "));root.setAttribute("data-chart-fonts","loaded");});}
function start(init){stage=document.createElement("div");stage.setAttribute("aria-hidden","true");stage.style.cssText="position:absolute;left:-100000px;top:0;";document.body.appendChild(stage);
fontsReady().then(function(){if(state!=="initializing")return;return init(stage);}).then(function(live){if(live)swap(live);}).catch(function(e){fail(state==="initializing"&&root.getAttribute("data-chart-fonts")!=="loaded"?"fonts":"init",e);});}`

function vegaBoot(theme: ThemeTokens): string {
  return `if(typeof vega==="undefined"||typeof vegaInterpreter==="undefined"||typeof chartsCompact==="undefined")throw new Error("The Vega runtime is not available.");
vega.expressionFunction("compact",chartsCompact);
var deny=function(){return Promise.reject(new Error("Charts load nothing."))};
var spec=JSON.parse(document.getElementById("chart-spec").textContent);
start(function(el){var errors=[];var logger={level:function(){return logger},error:function(){errors.push([].slice.call(arguments).map(String).join(" "));return logger},warn:function(){return logger},info:function(){return logger},debug:function(){return logger}};
var view=new vega.View(vega.parse(spec,null,{ast:true}),{expr:vegaInterpreter,renderer:"svg",hover:true,loader:{load:deny,sanitize:deny,http:deny,file:deny},logger:logger,logLevel:vega.Error});
cleanups.push(function(){view.finalize()});
if(window.vegaTooltip)view.tooltip(new vegaTooltip.Handler({theme:${scriptJson(theme.mode)}}).call);
var live=document.createElement("div");el.appendChild(live);
return view.initialize(live).runAsync().then(function(){if(errors.length)throw new Error(errors[0]);cleanups.length=0;return live;});});`
}

function echartsBoot(input: HtmlInput): string {
  return `if(typeof echarts==="undefined"||typeof chartsCompact==="undefined")throw new Error("The ECharts runtime is not available.");
var option=JSON.parse(document.getElementById("chart-spec").textContent);
var theme=JSON.parse(document.getElementById("chart-theme").textContent);
var compact=chartsCompact;
var spec=${scriptJson(input.compactSpec)};
var fmt=function(v){return Math.abs(v)>=10000?compact(v,spec):Number(v).toLocaleString(${scriptJson(input.localeId)})};
["xAxis","yAxis","radiusAxis","singleAxis"].forEach(function(k){var a=option[k];(Array.isArray(a)?a:a?[a]:[]).forEach(function(x){if((x.type==="value"||x.type==="log")&&!(x.axisLabel&&x.axisLabel.formatter)){x.axisLabel=Object.assign({},x.axisLabel,{formatter:fmt});}});});
if(!option.tooltip)option.tooltip={trigger:(option.series||[]).some(function(s){return s.type==="line"||s.type==="bar"})?"axis":"item",confine:true};
echarts.registerTheme("chart",theme);
var first=host.firstElementChild,w=first?first.getAttribute("width"):null,h=first?first.getAttribute("height"):null;
start(function(el){var live=document.createElement("div");live.style.width=(w||640)+"px";live.style.height=(h||400)+"px";el.appendChild(live);
var chart=echarts.init(live,"chart",{renderer:"svg"});cleanups.push(function(){chart.dispose()});
chart.setOption(option);cleanups.length=0;return live;});`
}

export function buildHtml(packageRoot: string, input: HtmlInput): string {
  const code = runtime(packageRoot, input.engine)
  const faces = fontFaceCss(input.fonts, true)
  const c = input.theme.colors
  const family = cssString(input.theme.font.family)
  const boot = input.engine === "vega" ? vegaBoot(input.theme) : echartsBoot(input)
  // [family as a CSS string, weight]: what `document.fonts.load` must resolve before the live chart measures text.
  const faceList = scriptJson(input.fonts.map(f => [cssString(f.family), String(f.weight)]))
  const runtimeScript = code.replace(/<\/script/gi, "<\\/script")
  const bootScript = `(function(){var ENGINE=${scriptJson(input.engine)},FACES=${faceList};
${SHELL}
try{${boot}}catch(e){fail("init",e)}})();`
  return `<!doctype html>
<html lang="en" data-chart-status="initializing">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${contentSecurityPolicy([runtimeScript, bootScript])}">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(input.title)}</title>
<style>
${faces}
html,body{margin:0;background:${c.background};color:${c.text};font-family:${family},sans-serif}
main{padding:12px;display:flex;flex-direction:column;align-items:center}
#chart{max-width:100%;overflow-x:auto}
#chart>svg{max-width:100%;height:auto}
#vg-tooltip-element{font-family:${family},sans-serif}
.chart-sr{position:absolute;left:-9999px;width:1px;height:1px;overflow:hidden}
#chart-failure{margin:8px 0 0;padding:8px 12px;border:1px solid ${c.negative};border-radius:4px;color:${c.text};font-size:13px;max-width:100%}
#chart-failure[hidden]{display:none}
#chart-diagnostic{display:block;margin-top:4px;color:${c.muted};font-family:${cssString(input.theme.font.mono)},monospace;font-size:11px;white-space:pre-wrap;word-break:break-word}
</style>
</head>
<body>
<main><figure style="margin:0"><div id="chart" role="img" aria-label="${escapeHtml(input.title)}">${input.svg}</div><figcaption class="chart-sr">${escapeHtml(input.description)}</figcaption></figure>
<p id="chart-status" class="chart-sr" role="status" aria-live="polite" data-status="initializing">The static chart is shown; the interactive view is starting.</p>
<div id="chart-failure" role="alert" hidden>The interactive view could not start. The static chart above is complete; hover details and selections are not available.<code id="chart-diagnostic"></code></div></main>
<script type="application/json" id="chart-spec">${scriptJson(input.spec)}</script>
${input.echartsTheme ? `<script type="application/json" id="chart-theme">${scriptJson(input.echartsTheme)}</script>` : ""}
<script>${runtimeScript}</script>
<script>${bootScript}</script>
</body>
</html>
`
}
