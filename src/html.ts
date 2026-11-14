import { createHash } from "node:crypto"
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { browserPalette, THEME_BRIDGE_SOURCE } from "./browser/theme-bridge.js"
import type { Json } from "./engines/common.js"
import { ChartsError } from "./errors.js"
import type { FontResource } from "./fonts.js"
import { cssFontStack, cssString, fontFaceCss } from "./svg.js"
import type { ThemeTokens } from "./themes/tokens.js"
import type { RuntimePresentation } from "./layout/present.js"

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
 * Before ECharts starts, the page runs the same tooltip-markup check as the spec check (engines/echarts-markup.ts,
 * bundled into the ECharts runtime): markup that reaches the page anyway, including what a CSP cannot stop such as a
 * meta refresh, puts it in `failed` with the static chart, and ECharts never sees it.
 *
 * Vega runs with vega-interpreter: the spec is parsed with `{ast: true}` and the View evaluates expressions by walking
 * the syntax tree, so Vega never builds a function from a string (which the CSP would refuse).
 *
 * A Plot page is the same shell with Plot in the runtime slot: the marks answer the pointer (`tip: true`), and the rows
 * the spec's marks read travel once, in their own JSON block. A page with no chart runtime at all (a table's interactive
 * markup, a diagram) is `static`: its body scripts are signed by the same policy, so they run and nothing else does.
 *
 * Every page also carries the host-theme bridge (src/browser/theme-bridge.ts) inside its one boot script: a host view
 * may send a theme as a `postMessage` or over a transferred `MessagePort`, and the page restates its canvas, ink, every
 * `--cs-…` adaptive drawing and its live ECharts or Plot view in place. A page given both polarities of its theme
 * follows the reader's colour scheme until a host speaks. No second script element is added: the policy signs exactly
 * the scripts the page ships, and the bridge is part of one of them.
 */
declare const BROWSER_RUNTIME_SHA256: Record<string, string> | undefined

/** The browser runtimes inlined into interactive HTML and the dashboard page, each a file in `dist/browser/`. */
export type BrowserRuntimeName = "vega" | "echarts" | "plot" | "ui"

/** Every runtime a page may need: the chart engines, and the dashboard controller. */
const BROWSER_RUNTIMES: readonly BrowserRuntimeName[] = ["vega", "echarts", "plot", "ui"]

/** How long the page waits for its embedded fonts before it reports `failed` and keeps the static chart. */
export const FONT_WAIT_MS = 10_000
/** At most this many characters of the failure's message reach the page. */
export const DIAGNOSTIC_MESSAGE_LIMIT = 240

// Keyed by package and runtime, so a check of one install never answers for another.
const runtimes = new Map<string, string>()
function runtime(packageRoot: string, name: BrowserRuntimeName): string {
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

/**
 * One browser runtime's source, read once per package and verified against the SHA-256 compiled into this build. A
 * packed install ships the file, so this is a read and a hash: no bundler runs while a page is made.
 */
export function browserRuntime(packageRoot: string, name: BrowserRuntimeName): string {
  return runtime(packageRoot, name)
}

/** The interactive HTML runtimes' problem, as a ChartsError, or undefined when all four are there and match this build. */
export function htmlProblem(packageRoot: string): ChartsError | undefined {
  try {
    for (const name of BROWSER_RUNTIMES) runtime(packageRoot, name)
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
  readonly engine: "vega" | "echarts" | "plot" | "static"
  /** A compiled Vega spec, an ECharts option (functions removed), or a Plot spec: the page's own JSON block. */
  readonly spec?: Json
  /** Plot's rows: the data its marks read, carried once for the page. */
  readonly rows?: readonly unknown[]
  /**
   * Markup for a page with no chart runtime (a table's interactive HTML, a diagram): it takes the chart's place, and any
   * `<script>` it carries is signed into the policy, so the body's own script runs and nothing else does.
   */
  readonly htmlBody?: string
  readonly svg: string
  readonly title: string
  readonly description: string
  readonly theme: ThemeTokens
  /**
   * Both polarities of one theme, when the page should follow the reader's colour scheme by itself. Without it the page
   * draws `theme` until a host view sends a theme; with it, `prefers-color-scheme` picks one, and `data-theme` wins.
   */
  readonly pairedThemes?: { readonly light: ThemeTokens; readonly dark: ThemeTokens }
  readonly echartsTheme?: Json
  /** The approved font resources to embed: the same list the PNG was drawn with. */
  readonly fonts: readonly FontResource[]
  readonly compactSpec: string
  readonly localeId: string
  /** A recipe chart's layout plan and controls (Vega only): responsive reflow, keyboard controls, a values table. */
  readonly presentation?: RuntimePresentation
}

/** The page's shared shell script: status, failure notice, off-screen stage, swap, and font readiness. */
const SHELL = `var root=document.documentElement,host=document.getElementById("chart"),statusEl=document.getElementById("chart-status"),failEl=document.getElementById("chart-failure"),diagEl=document.getElementById("chart-diagnostic");
var state="initializing",stage=null,cleanups=[],teardown=null,onReady=null,INIT=null,STATIC=host.innerHTML;
function setStatus(s,text){state=s;root.setAttribute("data-chart-status",s);statusEl.setAttribute("data-status",s);statusEl.textContent=text;}
function dispose(){while(cleanups.length){try{cleanups.pop()()}catch(e){}}if(stage&&stage.parentNode)stage.parentNode.removeChild(stage);stage=null;}
function fail(step,err){if(state!=="initializing")return;var m=err&&err.message?err.message:String(err);var d={code:"HTML_RUNTIME_FAILED",engine:ENGINE,stage:step,message:m.slice(0,${DIAGNOSTIC_MESSAGE_LIMIT})};dispose();diagEl.textContent=JSON.stringify(d);failEl.hidden=false;setStatus("failed","The interactive view did not start; the static chart is shown.");}
function swap(live){if(state!=="initializing")return;host.textContent="";host.appendChild(live);if(stage&&stage.parentNode)stage.parentNode.removeChild(stage);stage=null;setStatus("ready","Interactive view ready.");if(onReady){var r=onReady;onReady=null;r();}}
window.chartsRuntime={status:function(){return state},stats:function(){return teardown&&teardown.stats?teardown.stats():null},
dispose:function(){if(state!=="ready")return;var t=teardown;teardown=null;onReady=null;if(t)t();host.innerHTML=STATIC;setStatus("disposed","The static chart is shown; the interactive view is stopped.");},
mount:function(){if(state!=="disposed"||!INIT)return;setStatus("initializing","The static chart is shown; the interactive view is starting.");start(INIT);},
setTheme:function(p){return themeBridge.apply(p)},theme:function(){return themeBridge.theme()},
addThemeHook:function(f){themeBridge.hooks.push(f);var t=themeBridge.theme();if(t)try{f(t)}catch(e){}return t}};
function onError(e){fail("async",e&&(e.error||e.reason||e.message)||e);}
window.addEventListener("error",onError);window.addEventListener("unhandledrejection",onError);
function fontsReady(){var faces=FACES;if(!faces.length)return Promise.resolve();if(!document.fonts||!document.fonts.load)return Promise.reject(new Error("This browser cannot report font loading."));
var loads=Promise.all(faces.map(function(f){return document.fonts.load(f[1]+" 16px "+f[0]);})).then(function(){return document.fonts.ready;});
var limit=new Promise(function(_,reject){setTimeout(function(){reject(new Error("The embedded fonts did not load within ${FONT_WAIT_MS / 1000} s."))},${FONT_WAIT_MS})});
return Promise.race([loads,limit]).then(function(){var missing=faces.filter(function(f){return !document.fonts.check(f[1]+" 16px "+f[0]);});if(missing.length)throw new Error("Embedded font did not load: "+missing.map(function(f){return f[0]+" "+f[1]}).join(", "));root.setAttribute("data-chart-fonts","loaded");});}
function start(init){INIT=init;stage=document.createElement("div");stage.setAttribute("aria-hidden","true");stage.style.cssText="position:absolute;left:-100000px;top:0;";document.body.appendChild(stage);
fontsReady().then(function(){if(state!=="initializing")return;return init(stage);}).then(function(live){if(live)swap(live);}).catch(function(e){fail(state==="initializing"&&root.getAttribute("data-chart-fonts")!=="loaded"?"fonts":"init",e);});}`

function vegaBoot(theme: ThemeTokens, present: boolean): string {
  return `if(typeof vega==="undefined"||typeof vegaInterpreter==="undefined"||typeof chartsCompact==="undefined"${present ? '||typeof chartsPresent==="undefined"' : ""})throw new Error("The Vega runtime is not available.");
vega.expressionFunction("compact",chartsCompact);
var deny=function(){return Promise.reject(new Error("Charts load nothing."))};
var spec=JSON.parse(document.getElementById("chart-spec").textContent);
var present=${present ? 'JSON.parse(document.getElementById("chart-presentation").textContent)' : "null"};
start(function(el){var errors=[];var logger={level:function(){return logger},error:function(){errors.push([].slice.call(arguments).map(String).join(" "));return logger},warn:function(){return logger},info:function(){return logger},debug:function(){return logger}};
var view=new vega.View(vega.parse(spec,null,{ast:true}),{expr:vegaInterpreter,renderer:"svg",hover:true,loader:{load:deny,sanitize:deny,http:deny,file:deny},logger:logger,logLevel:vega.Error});
cleanups.push(function(){view.finalize()});
if(window.vegaTooltip)view.tooltip(new vegaTooltip.Handler({theme:${scriptJson(theme.mode)}}).call);
var live=document.createElement("div");el.appendChild(live);
var att=present?chartsPresent.attach(view,present,document):null;
if(att)cleanups.push(function(){att.dispose()});
return view.initialize(live).runAsync().then(function(){if(errors.length)throw new Error(errors[0]);cleanups.length=0;
teardown=function(){if(att)att.dispose();view.finalize()};teardown.stats=function(){var s=att?att.stats():{observers:0,listeners:0};s.views=1;return s};
if(att)onReady=att.ready;return live;});});`
}

function echartsBoot(input: HtmlInput): string {
  return `if(typeof echarts==="undefined"||typeof chartsCompact==="undefined"||typeof chartsTooltipMarkup==="undefined")throw new Error("The ECharts runtime is not available.");
var option=JSON.parse(document.getElementById("chart-spec").textContent);
var theme=JSON.parse(document.getElementById("chart-theme").textContent);
var compact=chartsCompact;
var spec=${scriptJson(input.compactSpec)};
var fmt=function(v){return Math.abs(v)>=10000?compact(v,spec):Number(v).toLocaleString(${scriptJson(input.localeId)})};
["xAxis","yAxis","radiusAxis","singleAxis"].forEach(function(k){var a=option[k];(Array.isArray(a)?a:a?[a]:[]).forEach(function(x){if((x.type==="value"||x.type==="log")&&!(x.axisLabel&&x.axisLabel.formatter)){x.axisLabel=Object.assign({},x.axisLabel,{formatter:fmt});}});});
if(!option.tooltip)option.tooltip={trigger:(option.series||[]).some(function(s){return s.type==="line"||s.type==="bar"})?"axis":"item",confine:true};
echarts.registerTheme("chart",theme);
var first=host.firstElementChild,w=first?first.getAttribute("width"):null,h=first?first.getAttribute("height"):null;
start(function(el){var refused=chartsTooltipMarkup(option);if(refused.length)throw new Error("Refused tooltip markup at "+refused[0].path+": "+refused[0].what);
var live=document.createElement("div");live.style.width=(w||640)+"px";live.style.height=(h||400)+"px";el.appendChild(live);
var chart=echarts.init(live,"chart",{renderer:"svg"});cleanups.push(function(){chart.dispose()});
chart.setOption(option);cleanups.length=0;teardown=function(){chart.dispose()};teardown.stats=function(){return{views:1,observers:0,listeners:0}};
window.chartsRuntime.addThemeHook(function(t){if(!chart||!chart.getDom)return;var box=chart.getDom();if(!box||!box.parentNode)return;
echarts.registerTheme("chart",t.echartsTheme);chart.dispose();chart=echarts.init(box,"chart",{renderer:"svg"});chart.setOption(option);});
return live;});`
}

export function buildHtml(packageRoot: string, input: HtmlInput): string {
  const code = input.engine === "static" ? "" : runtime(packageRoot, input.engine)
  const faces = fontFaceCss(input.fonts, true)
  const c = input.theme.colors
  const family = cssFontStack(input.theme.font.family, "sans-serif")
  const mono = cssFontStack(input.theme.font.mono, "monospace")
  const present = input.engine === "vega" ? input.presentation : undefined
  const boot = input.engine === "vega" ? vegaBoot(input.theme, !!present) : input.engine === "echarts" ? echartsBoot(input) : input.engine === "plot" ? plotBoot() : staticBoot()
  // [family as a CSS string, weight]: what `document.fonts.load` must resolve before the live chart measures text.
  const faceList = scriptJson(input.fonts.map(f => [cssString(f.family), String(f.weight)]))
  // The host-theme bridge's own configuration: the page's palette is the base a partial payload builds on, and both
  // polarities, when the page has them, are what `prefers-color-scheme` picks between until a host speaks.
  const themeBridge = scriptJson({
    palette: browserPalette(input.theme),
    paired: input.pairedThemes ? { light: browserPalette(input.pairedThemes.light), dark: browserPalette(input.pairedThemes.dark) } : null,
  })
  const runtimeScript = code.replace(/<\/script/gi, "<\\/script")
  const bootScript = `(function(){var ENGINE=${scriptJson(input.engine)},FACES=${faceList};
${SHELL}
var themeBridge=(${THEME_BRIDGE_SOURCE})(window,document,${themeBridge});
try{${boot}}catch(e){fail("init",e)}})();`
  // A static page runs only the body's own scripts, each signed by the policy; no chart runtime is inlined at all.
  const bodyScripts = input.engine === "static" ? inlineScripts(input.htmlBody ?? "") : []
  const scripts = [...(code ? [runtimeScript] : []), bootScript, ...bodyScripts]
  const plot = input.engine === "plot"
  // A body's own markup (a table, a diagram) takes the chart's place; the static drawing is the first paint otherwise.
  const chartAttributes = input.htmlBody ? "" : ` role="img" aria-label="${escapeHtml(input.title)}"`
  const caption = input.htmlBody ? "" : `<figcaption class="chart-sr">${escapeHtml(input.description)}</figcaption>`
  return `<!doctype html>
<html lang="en" data-chart-status="initializing">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${contentSecurityPolicy(scripts)}">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(input.title)}</title>
<style>
${faces}
html,body{margin:0;background:${c.background};color:${c.text};font-family:${family}}
main{padding:12px;display:flex;flex-direction:column;align-items:center}
#chart{max-width:100%;overflow-x:auto}
#chart>svg{max-width:100%;height:auto}
#vg-tooltip-element{font-family:${family}}
.chart-sr{position:absolute;left:-9999px;width:1px;height:1px;overflow:hidden}
#chart-failure{margin:8px 0 0;padding:8px 12px;border:1px solid ${c.negative};border-radius:4px;color:${c.text};font-size:13px;max-width:100%}
#chart-failure[hidden]{display:none}
#chart-diagnostic{display:block;margin-top:4px;color:${c.muted};font-family:${mono};font-size:11px;white-space:pre-wrap;word-break:break-word}
${present ? presentationCss(input.theme, present) : ""}</style>
</head>
<body>
<main><figure style="margin:0"><div id="chart"${chartAttributes}>${input.htmlBody ?? input.svg}</div>${caption}</figure>
<p id="chart-status" class="chart-sr" role="status" aria-live="polite" data-status="initializing">The static chart is shown; the interactive view is starting.</p>
<div id="chart-failure" role="alert" hidden>The interactive view could not start. The static chart above is complete; hover details and selections are not available.<code id="chart-diagnostic"></code></div>${present ? presentationMarkup(present) : ""}</main>
${input.spec !== undefined ? `<script type="application/json" id="chart-spec">${scriptJson(input.spec)}</script>` : ""}
${plot ? `<script type="application/json" id="chart-rows">${scriptJson(input.rows ?? [])}</script>` : ""}
${present ? `<script type="application/json" id="chart-presentation">${scriptJson(present)}</script>` : ""}
${plot ? `<script type="application/json" id="chart-theme">${scriptJson(plotTheme(input.theme))}</script>` : input.echartsTheme ? `<script type="application/json" id="chart-theme">${scriptJson(input.echartsTheme)}</script>` : ""}
${code ? `<script>${runtimeScript}</script>` : ""}
<script>${bootScript}</script>
</body>
</html>
`
}

/** The tokens a Plot page needs, as `src/browser/plot.ts` reads them: the canvas, the type and the two colour ramps. */
function plotTheme(theme: ThemeTokens): Json {
  return {
    colors: {
      background: theme.colors.background,
      text: theme.colors.text,
      muted: theme.colors.muted,
      grid: theme.colors.grid,
      axis: theme.colors.axis,
      categorical: [...theme.colors.categorical],
      sequential: [...theme.colors.sequential],
    },
    font: { family: theme.font.family, size: theme.font.size, labelSize: theme.font.labelSize },
  }
}

/** Plot's boot: the marks answer the pointer themselves, so the live view is one render into the swap's container. */
function plotBoot(): string {
  return `if(typeof chartsPlot==="undefined")throw new Error("The Plot runtime is not available.");
var spec=JSON.parse(document.getElementById("chart-spec").textContent),rowsEl=document.getElementById("chart-rows"),rows=rowsEl?JSON.parse(rowsEl.textContent):undefined;
var themeEl=document.getElementById("chart-theme"),theme=themeEl?JSON.parse(themeEl.textContent):undefined;
start(function(el){var live=document.createElement("div");el.appendChild(live);chartsPlot.render(live,spec,rows,theme);
window.chartsRuntime.addThemeHook(function(t){chartsPlot.render(live,spec,rows,t.plotTheme)});
cleanups.length=0;teardown=function(){};teardown.stats=function(){return{views:1,observers:0,listeners:0}};return live;});`
}

/** A page with no chart runtime: its body (a table, a diagram, a drawing) is the finished view. */
function staticBoot(): string {
  return `if(!document.getElementById("chart"))throw new Error("The static view has no content to show.");
setStatus("ready","Static view ready.");`
}

/** The exact text of each inline `<script>` a static page's body carries: the policy signs these, so they run. */
function inlineScripts(html: string): string[] {
  return [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)].map(match => match[1]!)
}

/**
 * A recipe chart's controls, rendered hidden and shown by the runtime once the live view is ready (they do nothing
 * without it): a button per series to highlight it, a clear button per persistent selection, reset-all when there are
 * two, a values table, and a layout notice. Labels are data, escaped here and set as text by the runtime.
 */
function presentationMarkup(p: RuntimePresentation): string {
  const c = p.controls
  const buttons: string[] = []
  if (c.legend) {
    buttons.push(`<span class="chart-group" role="group" aria-label="Highlight a series">${c.legend.series.map((s, i) => `<button type="button" data-series="${i}" aria-pressed="false" aria-label="Highlight ${escapeHtml(s.label)}">${escapeHtml(s.label)}</button>`).join("")}</span>`)
    buttons.push(`<button type="button" data-action="clear-legend">Clear highlight</button>`)
  }
  if (c.zoom) buttons.push(`<button type="button" data-action="clear-zoom">Reset zoom</button>`)
  if (c.brush) buttons.push(`<button type="button" data-action="clear-brush">Clear selection</button>`)
  if ([c.legend, c.zoom, c.brush].filter(Boolean).length > 1) buttons.push(`<button type="button" data-action="reset-all">Reset all</button>`)
  return `
<p id="chart-layout" role="status" hidden></p>
${buttons.length ? `<div id="chart-controls" role="toolbar" aria-label="Chart controls" hidden>${buttons.join("")}</div>` : ""}
${c.details ? `<details id="chart-details" hidden><summary>Data table</summary><div id="chart-table"></div></details>` : ""}`
}

function presentationCss(theme: ThemeTokens, p: RuntimePresentation): string {
  const c = theme.colors
  const responsive = p.mode === "responsive" ? "main{align-items:stretch}figure{width:100%}#chart{width:100%}" : ""
  return `${responsive}
#chart-controls,#chart-details,#chart-layout{margin:8px 0 0;max-width:100%;font-size:13px}
#chart-controls{display:flex;flex-wrap:wrap;gap:6px;align-items:center}
.chart-group{display:contents}
#chart-controls[hidden],#chart-details[hidden],#chart-layout[hidden]{display:none}
#chart-controls button{font:inherit;color:${c.text};background:${c.background};border:1px solid ${c.axis};border-radius:4px;padding:3px 10px;cursor:pointer}
#chart-controls button[aria-pressed="true"]{border-color:${c.text};font-weight:600}
#chart-controls button:focus-visible,#chart-details summary:focus-visible{outline:2px solid ${c.text};outline-offset:2px}
#chart-details table{border-collapse:collapse;margin-top:4px}
#chart-details th,#chart-details td{border-bottom:1px solid ${c.grid};padding:2px 8px;text-align:left}
#chart-layout{color:${c.text};border-left:3px solid ${c.negative};padding-left:8px}
`
}
