# Changelog

## 0.0.1 (unreleased)

- First version: `charts_render`, `charts_quick`, `charts_validate`, `charts_catalogue`, `charts_themes` and `charts_theme_save`.
- Engines: Vega-Lite and Vega (rendered in a worker with time and memory limits) and ECharts server-side SVG. PNG through resvg (wasm). Offline interactive HTML.
- Seven built-in themes, including `toqan` and `toqan-night` built from Toqan's design tokens, plus custom and saved themes. Bundled fonts: Inter, Geist and JetBrains Mono.
- Validation with did-you-mean and JSON paths; lint; layout checks (label collisions, clipping, duplicate ticks); PNG previews for the model.
- 53-type catalogue, a cookbook skill generated from it, 110 tests, a 67-chart gallery and a 30-request eval.
