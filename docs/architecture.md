# Architecture

## Layers

```
src/index.ts            one Plugin.define: assertHost, one register, the two skills
  src/handlers/         one file per method, and the table register takes
  src/tools.ts          the shared render core: run, document, update, board
  src/methods/          the method implementations the renderer entry exports
src/renderer.ts         the lazy entry: engines, table, diagram, themes, catalogue
  src/engines/          Vega-Lite, Vega, ECharts, Observable Plot, table, diagram
  src/document/         the chart document: schema, compiler, patch, artifact
  src/themes/           tokens, palettes, contrast, the theme chain and the host store
  src/browser/          the runtimes inlined into interactive HTML and boards
```

`src/index.ts` does four things: refuse an untested host, build the handler table, call `register` once, and register
the two skills. The contract's `register` owns the access rules, the tools, the one RPC registration and the bus; no
code in this package calls `ctx.tool.transform`, `ctx.rpc.register` or `ctx.agent.transform` itself.

## There is no provider client

Charts has no external provider. It reads workspace files and draws them, so there is no `src/provider/` directory and
no endpoint, URL or binary is named anywhere. The "provider" is the local filesystem, and its one boundary is
`src/paths.ts`: a path is resolved inside the session's workspace, and `..`, a URL, a device file, `.git` and a symlink
that leads out are refused with their own code.

## The renderer is a second entry

An engine start evaluates `src/index.ts` and the handlers. `src/renderer-load.ts` imports `./renderer.js` on the first
call that needs an engine, and the build makes that a second entry (`dist/renderer.js`) with its own chunks. The build
fails if `dist/index.js` imports it statically. The handlers' input schemas are plain JSON in `src/tool-table.ts`; in
the bundle the build compiles the registry's table into that module's place, so a start reads no chart schema.

The renderer loads zod and the chart schemas with the engines; the contract's `register` uses zod for its own input and
answer validation at setup, which is part of the contract, not the chart renderer.

## What is cached

- **The renderer module** is loaded once and kept for the life of the plugin instance.
- **The Vega worker** is started on the first Vega render and reused; it is stopped when the plugin is disposed.
- **The host theme store** is in memory, per session, bounded to 256 sessions; it is never written to disk. A theme is
  applied to the session that synced it, and a render that names its own theme ignores it.
- **Nothing else.** Data files are read on the call that needs them, documents are resolved from disk, and a render
  writes its files each time. There is no cross-call cache of rows, specs or pictures.

## OpenCode APIs used

- `Plugin.define` and `setup` from `@opencode/plugin` 2.4.1.
- `register`, `assertHost`, `statusAnswer`, `NO_ACCOUNTS`, `STATUS_SCHEMA`, `rulesFor`/`applyAccess` (through
  `register`) from `@we-the-rebel-alliance/plugin-contract`.
- `ctx.skill.transform`, for the two skills only.
- `ctx.permission.assert`, through the handlers' file assertions (`read` and `edit`).
- The TUI entry (`dist/tui.js`) uses the public TUI context for its status dialog and its `chart` code-block renderer.

No private OpenCode module is imported, and no per-request hook is installed.

## Determinism

Same spec, same data, same seed, same bytes: temporal scales and time units are forced to UTC, ids are renumbered under
a content hash, fonts are bundled bytes and no timestamp reaches a file. The exact-promise and its platform tolerance
are described in `docs/security.md`.
