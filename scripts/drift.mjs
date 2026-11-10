// `npm run drift`: the Jelly declaration's tool list against the tool table in src/registry.ts. The registry test checks the
// same lists; this prints each difference by name and exits 1 when there is one, so a maintainer can see what moved.
import { readFileSync } from "node:fs";
import { DESCRIPTORS, NAMESPACE } from "../src/registry.js";

const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const declared = new Set(pkg.jelly.tools.map((tool) => tool.name));
const registered = new Set(DESCRIPTORS.map((tool) => `${NAMESPACE}.${tool.name}`));
const missing = [...registered].filter((name) => !declared.has(name));
const extra = [...declared].filter((name) => !registered.has(name));
for (const name of missing) console.log(`not declared in package.json jelly.tools: ${name}`);
for (const name of extra) console.log(`declared in package.json jelly.tools but not in the tool table: ${name}`);
if (missing.length || extra.length) process.exit(1);
console.log(`drift: none; ${registered.size} tools declared and in the tool table.`);
