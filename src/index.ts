import { fileURLToPath } from "node:url"
import { Plugin } from "@opencode/plugin"
import { createPlugin } from "./plugin.js"

// One level below the package root both as source (src/) and as the bundle (dist/).
export default Plugin.define(createPlugin({ packageRoot: fileURLToPath(new URL("../", import.meta.url)) }))
