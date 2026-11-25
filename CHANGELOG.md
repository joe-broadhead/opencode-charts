# Changelog

All notable changes to this project are documented in this file. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses [Semantic Versioning](https://semver.org/).

## [0.0.0] - 2026-11-25

The first release of the rebuild on plugin-contract v0. Install from the tag:
`opencode plugin add github:we-the-rebel-alliance/charts-plugin#v0.0.0`.

### Added

- The `capabilities` manifest: 16 methods (7 reads, 9 writes), no accounts, no sources, no actions, no bus events.
- `charts.theme` moved into the plugin's one contract registration as `theme_sync`, `theme_get` and `theme_clear`,
  alongside `status`, so every method is a tool in Code Mode and an RPC method under the id `charts`.
- A `plugin-kit` gate in CI (`npx plugin-kit check`) and the repository's own build, typecheck, unit, browser, eval,
  host and pack stages.

### Changed

- The package is `@we-the-rebel-alliance/charts-plugin`; its version restarts at `0.0.0`.
- One `register` call wires every door; handlers live in `src/handlers/`, one file per method.
- The file writers are class `write`, not the 4a `export`: nothing here leaves the provider. `theme_save`,
  `theme_sync` and `theme_clear` set `effect: "ask"`.
- Nothing is pinned: one namespace line of 354 characters and `search({ namespace: "charts" })` replace 43,434
  characters of pinned signatures.

### Removed

- The copied release, drift, copy, icon, forbidden and tested-host scripts, the copied kit, the app-specific
  declaration and `opencode` keys, the source-contract tools RPC, the separate theme RPC, the GUI entry
  (`./gui-experimental`), and the app-specific documentation.
