# Changelog

All notable changes to this project are documented in this file. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses [Semantic Versioning](https://semver.org/).

## 0.0.0 (unreleased)

### Changed

- **The package is `@we-the-rebel-alliance/charts-plugin`**, in `we-the-rebel-alliance/charts-plugin`, and its version
  restarts at `0.0.0`. Install `github:we-the-rebel-alliance/charts-plugin`; the 0.0.0 release is not cut yet.
- **OpenCode `>=2.4.1 <2.5.0`, tested on 2.4.1.** `@opencode/plugin` and `@opencode/sdk` are `2.4.1`. The 2.2 and 2.3
  host matrix, its runners and its documented versions are gone.
- **Nothing is pinned.** The five tools Code Mode sent on every turn (`quick`, `render`, `board`, `table` and
  `diagram`, about 43,000 characters) are no longer pinned: one namespace line, `search({ namespace: "charts", query })`
  and the two skills find every tool.
- **The app guide is gone.** `docs/jelly.md` is removed; the `jelly` declaration in `package.json` stays for the app
  that reads it, and an app's guide belongs in that app's repository.
