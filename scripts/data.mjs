// Generates the offline data the plugin ships in assets/data/: number and time locales (from d3-format and
// d3-time-format), and map atlases (from world-atlas and us-atlas) with ISO 3166 codes added to each country so a
// choropleth can join on a name, an alpha-2 or an alpha-3 code. The output is committed; run this after changing a
// pinned data package (`node scripts/data.mjs`). It reads only node_modules and writes only assets/data/.
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

const ROOT = fileURLToPath(new URL("../", import.meta.url))
const require = createRequire(import.meta.url)
const OUT = join(ROOT, "assets", "data")
mkdirSync(OUT, { recursive: true })
const json = path => JSON.parse(readFileSync(path, "utf8"))
const nm = (...parts) => join(ROOT, "node_modules", ...parts)

// Locales: every number locale, and the time locale where d3 has one.
const numbers = Object.fromEntries(readdirSync(nm("d3-format", "locale")).filter(f => f.endsWith(".json")).map(f => [f.slice(0, -5), json(nm("d3-format", "locale", f))]))
const times = Object.fromEntries(readdirSync(nm("d3-time-format", "locale")).filter(f => f.endsWith(".json")).map(f => [f.slice(0, -5), json(nm("d3-time-format", "locale", f))]))
writeFileSync(join(OUT, "locales.json"), JSON.stringify({ number: numbers, time: times }))

// World countries, 1:110m, with ISO codes.
const countries = require("i18n-iso-countries")
countries.registerLocale(json(nm("i18n-iso-countries", "langs", "en.json")))
const world = json(nm("world-atlas", "countries-110m.json"))
for (const geometry of world.objects.countries.geometries) {
  const numeric = geometry.id
  const a2 = numeric ? countries.numericToAlpha2(numeric) : undefined
  const a3 = numeric ? countries.numericToAlpha3(numeric) : undefined
  geometry.properties = { ...geometry.properties, iso_n3: numeric ?? null, iso_a2: a2 ?? null, iso_a3: a3 ?? null }
}
writeFileSync(join(OUT, "world-110m.json"), JSON.stringify(world))
writeFileSync(join(OUT, "world-land-110m.json"), JSON.stringify(json(nm("world-atlas", "land-110m.json"))))

// US states, 1:10m (longitude/latitude; project with albersUsa), with postal codes.
const POSTAL = { "01": "AL", "02": "AK", "04": "AZ", "05": "AR", "06": "CA", "08": "CO", "09": "CT", "10": "DE", "11": "DC", "12": "FL", "13": "GA", "15": "HI", "16": "ID", "17": "IL", "18": "IN", "19": "IA", "20": "KS", "21": "KY", "22": "LA", "23": "ME", "24": "MD", "25": "MA", "26": "MI", "27": "MN", "28": "MS", "29": "MO", "30": "MT", "31": "NE", "32": "NV", "33": "NH", "34": "NJ", "35": "NM", "36": "NY", "37": "NC", "38": "ND", "39": "OH", "40": "OK", "41": "OR", "42": "PA", "44": "RI", "45": "SC", "46": "SD", "47": "TN", "48": "TX", "49": "UT", "50": "VT", "51": "VA", "53": "WA", "54": "WV", "55": "WI", "56": "WY", "60": "AS", "66": "GU", "69": "MP", "72": "PR", "78": "VI" }
const us = json(nm("us-atlas", "states-10m.json"))
for (const geometry of us.objects.states.geometries) geometry.properties = { ...geometry.properties, fips: geometry.id, postal: POSTAL[geometry.id] ?? null }
delete us.objects.counties
writeFileSync(join(OUT, "us-states-10m.json"), JSON.stringify(us))

for (const file of readdirSync(OUT)) console.log(`wrote assets/data/${file} (${(readFileSync(join(OUT, file)).length / 1024).toFixed(0)} KiB)`)
