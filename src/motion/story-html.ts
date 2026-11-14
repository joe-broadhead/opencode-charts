import { ChartsError } from "../errors.js"
import type { FontResource } from "../fonts.js"
import { contentSecurityPolicy, scriptJson } from "../html.js"
import { cssString, fontFaceCss } from "../svg.js"
import type { ThemeTokens } from "../themes/tokens.js"

/**
 * A self-contained story page: one step per frame of an animation, with the first step already drawn as static SVG so
 * the page shows the chart before (or without) any script. Controls are a real button, a real range input and a real
 * select, each labelled; Space plays and pauses, the arrow keys step. Nothing is fetched: the fonts are data URLs, the
 * drawings are inline, and `script-src` is the SHA-256 of the page's one script, so an injected handler cannot run.
 *
 * Everything the page needs is in the file, so it opens from a disk with no server and no network.
 */

export interface StoryStep {
  /** The step's name: what the reader is looking at now. */
  readonly title: string
  /** One sentence on what changed (optional). */
  readonly caption?: string
  /** The step's drawing, already checked as rendered SVG. */
  readonly svg: string
}

export interface StoryHtmlInput {
  readonly title: string
  readonly description?: string
  readonly steps: readonly StoryStep[]
  readonly theme: ThemeTokens
  /** The approved font resources to embed: the same list the drawings were measured with. */
  readonly fonts?: readonly FontResource[]
  /** How long one step is shown for at 1×. */
  readonly frameMs?: number
  /** Start playing once the page opens (off by default; a reader's reduced-motion setting also keeps it paused). */
  readonly autoplay?: boolean
}

const escapeHtml = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;")

/**
 * The page's behaviour: step switching, play/pause, the scrubber, the speed selector and the keyboard shortcuts. It
 * touches only the elements the page has, never a string as code, and never the network.
 */
const BEHAVIOUR = `(function(){
var root=document.documentElement;
var data=JSON.parse(document.getElementById("story-data").textContent);
var steps=data.steps;
var figures=[].slice.call(document.querySelectorAll(".story-step"));
var play=document.getElementById("story-play");
var scrub=document.getElementById("story-scrubber");
var speed=document.getElementById("story-speed");
var titleEl=document.getElementById("story-step-title");
var captionEl=document.getElementById("story-step-caption");
var counter=document.getElementById("story-counter");
var current=0,playing=false,timer=null,rate=1;
function set(i){
if(i<0)i=steps.length-1;
if(i>=steps.length)i=0;
current=i;
for(var k=0;k<figures.length;k++){var on=k===i;if(on){figures[k].removeAttribute("hidden")}else{figures[k].setAttribute("hidden","")}figures[k].setAttribute("aria-hidden",on?"false":"true");}
titleEl.textContent=steps[i].title;
captionEl.textContent=steps[i].caption||"";
counter.textContent=(i+1)+" of "+steps.length;
scrub.value=String(i);
root.setAttribute("data-story-step",String(i));
}
function stop(){if(timer){clearInterval(timer);timer=null}playing=false;play.textContent="Play";play.setAttribute("aria-pressed","false");root.setAttribute("data-story-status","paused");}
function start(){if(steps.length<2)return;if(timer){clearInterval(timer)}playing=true;play.textContent="Pause";play.setAttribute("aria-pressed","true");root.setAttribute("data-story-status","playing");timer=setInterval(function(){set(current+1)},Math.max(80,Math.round(data.frameMs/rate)));}
function toggle(){if(playing){stop()}else{start()}}
play.addEventListener("click",toggle);
scrub.addEventListener("input",function(){stop();set(Number(scrub.value)||0)});
speed.addEventListener("change",function(){rate=Number(speed.value)||1;if(playing){start()}});
document.addEventListener("keydown",function(event){
var tag=event.target&&event.target.tagName;
// Space keeps its meaning in a field, and on a button it already presses it; the arrows stay free after a click.
var typing=tag==="INPUT"||tag==="SELECT"||tag==="TEXTAREA";
var onButton=tag==="BUTTON";
if(event.key===" "||event.key==="Spacebar"){if(typing||onButton){return}event.preventDefault();toggle();return}
if(event.key==="ArrowRight"){if(typing){return}event.preventDefault();stop();set(current+1);return}
if(event.key==="ArrowLeft"){if(typing){return}event.preventDefault();stop();set(current-1);return}
});
set(0);
root.setAttribute("data-chart-status","ready");
if(data.autoplay&&!(window.matchMedia&&window.matchMedia("(prefers-reduced-motion: reduce)").matches)){start()}
})();`

/**
 * The page. `script-src` is exactly the hash of `BEHAVIOUR`, so the only script that can run is the one written here;
 * the step list is a JSON block, which a browser never executes and so is not hashed.
 */
export function buildStoryHtml(input: StoryHtmlInput): string {
  if (input.steps.length === 0) throw new ChartsError("SIZE_INVALID", "A story needs at least one step.", "Render the frames, then pass them as steps.")
  const theme = input.theme
  const steps = input.steps.map(step => ({ title: step.title, caption: step.caption ?? "" }))
  const data = scriptJson({ steps, frameMs: Math.max(120, Math.round(input.frameMs ?? 900)), autoplay: input.autoplay === true })
  const policy = contentSecurityPolicy([BEHAVIOUR])
  const family = `${cssString(theme.font.family)}, sans-serif`
  const faces = input.fonts && input.fonts.length ? fontFaceCss(input.fonts, true) : ""
  const figures = input.steps.map((step, index) =>
    `<figure class="story-step" data-step="${index}"${index === 0 ? "" : " hidden"} aria-hidden="${index === 0 ? "false" : "true"}">${step.svg}</figure>`).join("\n")
  return `<!doctype html>
<html lang="en" data-story-status="paused" data-story-step="0">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="${theme.mode === "dark" ? "dark" : "light"}">
<meta http-equiv="Content-Security-Policy" content="${policy}">
<title>${escapeHtml(input.title)}</title>
<style>${faces}
:root{color-scheme:${theme.mode === "dark" ? "dark" : "light"}}
*{box-sizing:border-box}
body{margin:0;padding:24px;background:${theme.colors.background};color:${theme.colors.text};font-family:${family};font-size:${theme.font.size}px;line-height:1.45}
.story{max-width:${theme.layout.width + 2 * theme.layout.padding}px;margin:0 auto}
h1{margin:0 0 4px;font-size:${theme.font.titleSize}px;font-weight:${theme.font.titleWeight}}
.story-description{margin:0 0 16px;color:${theme.colors.muted}}
.story-stage{margin:0;padding:0;min-height:${theme.layout.height}px}
.story-step{margin:0;padding:0;border:0}
.story-step[hidden]{display:none}
.story-step svg{display:block;width:100%;height:auto}
.story-footer{margin-top:16px;display:flex;flex-wrap:wrap;gap:12px;align-items:center}
.story-controls{display:flex;gap:12px;align-items:center;flex-wrap:wrap}
button,input[type="range"],select{font:inherit;color:inherit}
button{min-width:84px;min-height:36px;padding:6px 14px;border:1px solid ${theme.colors.axis};border-radius:6px;background:${theme.colors.background};cursor:pointer}
button:hover{border-color:${theme.colors.highlight}}
button:focus-visible,input:focus-visible,select:focus-visible{outline:2px solid ${theme.colors.highlight};outline-offset:2px}
input[type="range"]{min-width:200px;accent-color:${theme.colors.highlight}}
select{min-height:36px;padding:4px 8px;border:1px solid ${theme.colors.axis};border-radius:6px;background:${theme.colors.background}}
.story-caption{margin:8px 0 0;color:${theme.colors.muted};min-height:1.45em}
.story-step-title{margin:8px 0 0;font-weight:600}
.story-counter{margin:0;color:${theme.colors.muted};font-variant-numeric:tabular-nums}
.story-legend{margin:0;font-size:${Math.max(11, theme.font.size - 2)}px;color:${theme.colors.muted}}
.story-sr{position:absolute;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0}
@media (prefers-reduced-motion: reduce){*,*::before,*::after{animation-duration:.01ms !important;animation-iteration-count:1 !important;transition-duration:.01ms !important}}
</style>
</head>
<body>
<main class="story">
<h1>${escapeHtml(input.title)}</h1>
${input.description ? `<p class="story-description">${escapeHtml(input.description)}</p>` : ""}
<div class="story-stage" role="group" aria-roledescription="animation" aria-label="${escapeHtml(input.title)}">
${figures}
</div>
<div class="story-footer">
<div class="story-controls">
<button id="story-play" type="button" aria-pressed="false" aria-label="Play the story">Play</button>
<label class="story-sr" for="story-scrubber">Step</label>
<input id="story-scrubber" type="range" min="0" max="${Math.max(0, input.steps.length - 1)}" step="1" value="0" aria-valuetext="Step 1 of ${input.steps.length}">
<label class="story-sr" for="story-speed">Speed</label>
<select id="story-speed" aria-label="Playback speed">
<option value="0.5">0.5×</option>
<option value="1" selected>1×</option>
<option value="2">2×</option>
</select>
<p class="story-counter" id="story-counter">1 of ${input.steps.length}</p>
</div>
<p class="story-caption" id="story-step-caption"></p>
<p class="story-legend">Space plays and pauses; the left and right arrow keys step.</p>
<div class="story-live" role="status" aria-live="polite"><p class="story-step-title" id="story-step-title">${escapeHtml(input.steps[0]!.title)}</p></div>
</div>
</main>
<script type="application/json" id="story-data">${data}</script>
<script>${BEHAVIOUR}</script>
</body>
</html>
`
}
