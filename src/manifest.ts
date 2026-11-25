import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import type { Manifest } from "@we-the-rebel-alliance/plugin-contract/manifest"

/**
 * The installed package: its `capabilities` manifest and version, read from package.json on disk (contract §4), and the
 * root every file the plugin ships is resolved from. One level up from this module, in src/ and in dist/ alike.
 */
export const packageRoot = fileURLToPath(new URL("../", import.meta.url))

const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version: string; capabilities: Manifest }

export const version: string = pkg.version
export const manifest: Manifest = pkg.capabilities
