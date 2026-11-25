// The renderer: every method's implementation and every engine behind it (Vega and Vega-Lite, ECharts, Observable Plot,
// resvg, the diagram layout, the table and dashboard builders, the theme chain). The build makes this file its own
// entry, dist/renderer.js, and the plugin imports it on the first call that needs it (src/renderer-load.ts), so an
// engine start evaluates only the tool table, the handlers and the contract's register.
export { runBoard, runChart, runUpdate } from "./tools.js"
export { runTable, runDiagram } from "./methods/table-diagram.js"
export { runRecommend } from "./methods/recommend.js"
export { runCapabilities } from "./methods/capabilities.js"
export { runCatalogue } from "./methods/catalogue.js"
export { runThemes, runThemeSave } from "./methods/themes.js"
export { closeVegaWorker } from "./engines/vega-pool.js"
export { INPUTS } from "./registry.js"
