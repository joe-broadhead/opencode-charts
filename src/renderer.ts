// The renderer: every tool's implementation and every engine behind it (Vega and Vega-Lite, ECharts, Observable Plot,
// resvg, the diagram layout, the table and dashboard builders). The build makes this file its own entry,
// dist/renderer.js, and the plugin imports it on the first call that needs it (src/renderer-load.ts), so an engine
// start evaluates only the tool table, the schemas and the status.
export { runTool } from "./tools.js"
export { closeVegaWorker } from "./engines/vega-pool.js"
export { INPUTS } from "./registry.js"
