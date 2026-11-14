import { deepMerge, isObject, type Json } from "./common.js"

/**
 * The one thing an ECharts timeline option needs beyond what ECharts itself draws: a frame as a chart that stands on
 * its own. Every other ECharts type the catalogue ships is plain option data the spec author writes; a timeline is the
 * only shape whose frames the pipeline has to unfold, because a still SVG shows one frame and a GIF or a story page
 * wants all of them.
 */

/** A frame as a chart on its own: the base option with that frame's own axes and data merged in, timeline hidden. */
function mergeFrame(base: Json, frame: Json): Json {
  const merged = deepMerge(structuredClone(base), frame) as Json
  const timeline = isObject(merged.timeline) ? merged.timeline as Json : {}
  merged.timeline = { ...timeline, show: false }
  return merged
}

/**
 * Every frame of a timeline option as an option that stands on its own, with the timeline hidden: what a server-side
 * renderer draws, one SVG per frame. The base option is merged with that frame, so a frame carries its own data and
 * its own axes; nothing here is interactive.
 */
export function extractTimelineFrameSvgOptions(option: Json): Json[] {
  const base = isObject(option.baseOption) ? option.baseOption as Json : {}
  const frames = Array.isArray(option.options) ? option.options as Json[] : []
  const timeline = isObject(option.timeline) ? option.timeline as Json : isObject(base.timeline) ? base.timeline as Json : {}
  return frames.map((frame, index) => {
    const merged = mergeFrame(base, isObject(frame) ? frame : {})
    merged.timeline = { ...timeline, currentIndex: index, show: false }
    return merged
  })
}
