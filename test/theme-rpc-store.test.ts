// The host-facing theme layer: a seed or a paired light + dark definition resolves through the store to a complete
// token set, a workspace `.charts/theme.json` is picked up only when a call names no theme (and only when the file is
// there), and the live `charts.theme` RPC keeps a host's theme in memory so nothing is written to the workspace.
import { afterAll, describe, expect, test } from "bun:test"
import { mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { renderBoard } from "../src/board/render-board.ts"
import { closeVegaWorker } from "../src/engines/vega-pool.ts"
import { ChartsError } from "../src/errors.ts"
import { ChartsThemeContract, ChartsThemeContract as ChartsThemeRpc, THEME_RPC_ID } from "../src/theme-contract.ts"
import { createHostThemeStore, effectiveThemeInput, hostThemeName, hostThemeRevision, MAX_SYNCED_THEMES, registerThemeRpc, type ChartsThemeRpcType, type HostThemeValue } from "../src/theme-rpc.ts"
import { checkThemeDefinition, resolveThemeAsked, resolveThemePairAsked } from "../src/themes/chain.ts"
import { DEFAULT_HOST_THEME_FILE, saveTheme, type ThemeSources } from "../src/themes/store.ts"
import { BUILTIN_THEMES } from "../src/themes/tokens.ts"
import { workspace } from "./helpers.ts"

const spaces: { cleanup: () => void }[] = []
afterAll(async () => { for (const space of spaces) space.cleanup(); await closeVegaWorker() })

/** A fresh workspace, and the theme sources every adapter builds from it. */
function setup(): { dir: string; sources: ThemeSources; env: ReturnType<typeof workspace>["env"] } {
  const space = workspace()
  spaces.push(space)
  return { dir: space.dir, env: space.env, sources: { workspace: space.env.workspace, configured: {} } }
}

const refusal = (fn: () => unknown): ChartsError => {
  try { fn() } catch (error) { if (error instanceof ChartsError) return error; throw error }
  throw new Error("expected a refusal")
}

const SEED = { background: "#FAF8F5", foreground: "#1A1A18", accent: "#C2410C" }

describe("a seed derives a complete theme", () => {
  test("the seed's colours land on their tokens, and the base keeps everything the seed omits", async () => {
    const { sources } = setup()
    expect(() => checkThemeDefinition({ seed: SEED })).not.toThrow()
    const theme = await resolveThemeAsked(sources, { seed: SEED, name: "warm" })
    expect(theme.name).toBe("warm")
    expect(theme.mode).toBe("light")
    expect(theme.colors.background).toBe("#FAF8F5")
    expect(theme.colors.text).toBe("#1A1A18")
    expect(theme.colors.highlight).toBe("#C2410C")
    // The accent leads the palette, so a seeded chart is visibly the host's own colour.
    expect(theme.colors.categorical[0]).toBe("#C2410C")
    expect(theme.font.family).toBe(BUILTIN_THEMES.light!.font.family)
    expect(theme.colors.positive).toMatch(/^#[0-9A-F]{6}$/)
  })

  test("an explicit palette, family and radius are the host's, and tokens beside the seed merge on top", async () => {
    const { sources } = setup()
    const theme = await resolveThemeAsked(sources, {
      seed: { ...SEED, series: ["#111111", "#222222", "#333333"], font: "Fraunces", mono: "Commit Mono", radius: "8px" },
      colors: { muted: "#6B6560" },
      font: { size: 14 },
    })
    expect(theme.colors.categorical.slice(0, 3)).toEqual(["#111111", "#222222", "#333333"])
    expect(theme.colors.categorical.length).toBe(8)
    expect(theme.font.family).toBe("Fraunces")
    expect(theme.font.mono).toBe("Commit Mono")
    expect(theme.marks.cornerRadius).toBe(8)
    expect(theme.colors.muted).toBe("#6B6560")
    expect(theme.font.size).toBe(14)
  })

  test("mode dark derives over the dark base, so a seed alone never paints light text on a light ground", async () => {
    const { sources } = setup()
    const theme = await resolveThemeAsked(sources, { mode: "dark", seed: { accent: "#38BDF8" } })
    expect(theme.mode).toBe("dark")
    expect(theme.colors.background).toBe(BUILTIN_THEMES.dark!.colors.background)
    expect(theme.colors.highlight).toBe("#38BDF8")
  })

  test("a misspelt seed key, a bad colour and a bad model name are refused at their path", () => {
    expect(refusal(() => checkThemeDefinition({ seed: { backgrund: "#FFFFFF" } }))).toMatchObject({ code: "THEME_INVALID", path: "/theme/seed/backgrund" })
    expect(refusal(() => checkThemeDefinition({ seed: { background: 5 } }))).toMatchObject({ code: "THEME_INVALID", path: "/theme/seed/background" })
    expect(refusal(() => checkThemeDefinition({ seed: { series: [] } }))).toMatchObject({ code: "THEME_INVALID", path: "/theme/seed/series" })
    expect(refusal(() => checkThemeDefinition({ mode: "sepia", seed: SEED }))).toMatchObject({ code: "THEME_INVALID", path: "/theme/mode" })
    expect(refusal(() => checkThemeDefinition({ seed: { background: "not a colour" } }))).toMatchObject({ code: "THEME_INVALID" })
    // A token beside a seed is still checked against the token projection, not waved through by the seed.
    expect(refusal(() => checkThemeDefinition({ seed: SEED, colours: {} }))).toMatchObject({ code: "THEME_INVALID" })
  })

  test("a seeded theme is saved by name and resolves from its file, read with permission", async () => {
    const { sources } = setup()
    const saved = saveTheme(sources, "warm-brand", { seed: SEED, description: "Warm paper" })
    expect(saved.file).toBe(".charts/themes/warm-brand.json")
    expect(saved.theme.name).toBe("warm-brand")
    expect(saved.theme.colors.background).toBe("#FAF8F5")
    const asked: string[][] = []
    const reread = await resolveThemeAsked(sources, "warm-brand", async paths => { asked.push([...paths]) })
    expect(asked).toEqual([[".charts/themes/warm-brand.json"]])
    expect(reread.name).toBe("warm-brand")
    expect(reread.colors.text).toBe("#1A1A18")
    expect(reread.description).toBe("Warm paper")
  })
})

describe("a paired light and dark definition", () => {
  const PAIR = {
    mode: "dark" as const,
    variants: {
      light: { colors: { background: "#FFFFFF", text: "#111111" } },
      dark: { colors: { background: "#101418", text: "#E6E8EB" } },
    },
  }

  test("resolves its variant for the call, and both polarities when a caller wants them", async () => {
    const { sources } = setup()
    expect(() => checkThemeDefinition(PAIR)).not.toThrow()
    const active = await resolveThemeAsked(sources, PAIR)
    expect(active.mode).toBe("dark")
    expect(active.colors.background).toBe("#101418")
    const { active: chosen, paired } = await resolveThemePairAsked(sources, PAIR)
    expect(chosen.colors.background).toBe("#101418")
    expect(paired?.light.mode).toBe("light")
    expect(paired?.light.colors.background).toBe("#FFFFFF")
    expect(paired?.dark.mode).toBe("dark")
    expect(paired?.dark.colors.background).toBe("#101418")
    // A variant the pair leaves out sits on its own polarity's built-in base.
    expect(paired?.dark.colors.categorical).toEqual(BUILTIN_THEMES.dark!.colors.categorical)
    expect(paired?.light.colors.categorical).toEqual(BUILTIN_THEMES.light!.colors.categorical)
  })

  test("a seed is derived into both polarities, and a named theme has no pair", async () => {
    const { sources } = setup()
    const { paired } = await resolveThemePairAsked(sources, { name: "brand", seed: { accent: "#D97757" } })
    expect(paired?.light.colors.highlight).toBe("#D97757")
    expect(paired?.dark.colors.highlight).toMatch(/^#[0-9A-F]{6}$/)
    expect(paired?.light.mode).toBe("light")
    expect(paired?.dark.mode).toBe("dark")
    expect(paired?.dark.colors.background).toBe(BUILTIN_THEMES.dark!.colors.background)
    saveTheme(sources, "polar", PAIR)
    const named = await resolveThemePairAsked(sources, "polar")
    expect(named.active.colors.background).toBe("#101418")
    expect(named.paired).toBeUndefined()
  })

  test("a pair with a seed inside each variant resolves each side from its own seed", async () => {
    const { sources } = setup()
    const { paired } = await resolveThemePairAsked(sources, { variants: { light: { seed: { background: "#FFFDF9" } }, dark: { seed: { background: "#0B0D10" } } } })
    expect(paired?.light.colors.background).toBe("#FFFDF9")
    expect(paired?.dark.colors.background).toBe("#0B0D10")
  })

  test("a variant that is not light or dark, and a mode that is neither, are refused", () => {
    expect(refusal(() => checkThemeDefinition({ variants: { dim: { colors: {} } } }))).toMatchObject({ code: "THEME_INVALID", path: "/theme/variants/dim" })
    expect(refusal(() => checkThemeDefinition({ variants: [] }))).toMatchObject({ code: "THEME_INVALID", path: "/theme/variants" })
    expect(refusal(() => checkThemeDefinition({ variants: { dark: { colours: {} } } }))).toMatchObject({ code: "THEME_INVALID" })
  })
})

describe("the workspace theme file", () => {
  test("is read only when a call names no theme, and only when it exists", async () => {
    const { dir, sources } = setup()
    const asked: string[][] = []
    const assertRead = async (paths: readonly string[]) => { asked.push([...paths]) }
    const none = await resolveThemeAsked(sources, undefined, assertRead)
    expect(none.name).toBe("light")
    expect(asked).toEqual([])

    mkdirSync(join(dir, ".charts"), { recursive: true })
    writeFileSync(join(dir, DEFAULT_HOST_THEME_FILE), JSON.stringify({ seed: { background: "#F7F3EE", foreground: "#1C1917", accent: "#D97757" } }, null, 2))
    const host = await resolveThemeAsked(sources, undefined, assertRead)
    expect(asked).toEqual([[DEFAULT_HOST_THEME_FILE]])
    expect(host.colors.background).toBe("#F7F3EE")
    expect(host.colors.highlight).toBe("#D97757")

    // A theme the call or the options named wins, and the file is not touched.
    asked.length = 0
    expect((await resolveThemeAsked(sources, "dark", assertRead)).name).toBe("dark")
    expect(asked).toEqual([])
  })

  test("follows its own extends chain with permission, and is refused when it is not a theme", async () => {
    const { dir, sources } = setup()
    mkdirSync(join(dir, ".charts"), { recursive: true })
    saveTheme(sources, "house", { extends: "dark", colors: { text: "#F2F2F2" } })
    writeFileSync(join(dir, DEFAULT_HOST_THEME_FILE), JSON.stringify({ extends: "house", colors: { highlight: "#38BDF8" } }, null, 2))
    const asked: string[][] = []
    const theme = await resolveThemeAsked(sources, undefined, async paths => { asked.push([...paths]) })
    expect(asked).toEqual([[DEFAULT_HOST_THEME_FILE], [".charts/themes/house.json"]])
    expect(theme.mode).toBe("dark")
    expect(theme.colors.highlight).toBe("#38BDF8")

    writeFileSync(join(dir, DEFAULT_HOST_THEME_FILE), JSON.stringify({ seed: { nope: "#FFFFFF" } }, null, 2))
    const error = await resolveThemeAsked(sources, undefined).catch((cause: unknown) => cause)
    expect(error).toBeInstanceOf(ChartsError)
    expect((error as ChartsError).code).toBe("THEME_INVALID")
  })
})

// ---------------------------------------------------------------------------------------------------------------
// The live RPC.

interface Failure { readonly type: string; readonly message: string; readonly data?: { readonly code?: string; readonly next?: string } }
interface CallContext { readonly signal: AbortSignal; readonly error: (type: string, message: string, data: { code: string; next: string }) => Failure }
type Handlers = Record<string, (input: unknown, context: CallContext) => Promise<unknown>>
const context: CallContext = { signal: new AbortController().signal, error: (type, message, data): Failure => ({ type, message, data }) }

function hostRpc() {
  const store = createHostThemeStore()
  const events: { name: string; data: Record<string, unknown> }[] = []
  const handlers: Handlers = {}
  const state = { disposed: false }
  let contract: { id: string; methods: Record<string, unknown>; events: Record<string, unknown> } = { id: "", methods: {}, events: {} }
  const rpc = {
    register: async (definition: unknown, registered: unknown) => {
      contract = definition as typeof contract
      Object.assign(handlers, registered as Handlers)
      return { events: { emit: async (name: string, data: Record<string, unknown>) => { events.push({ name, data }) } }, dispose: async () => { state.disposed = true } }
    },
  }
  return { store, events, handlers, state, contract: () => contract, rpc }
}

/**
 * The declared shape of a contract value: every key it names, which of them are required, and whether it is closed. Read
 * straight off the contract, so the test fails when the schema and the handlers drift apart rather than when the test's
 * own copy of the shape does.
 */
interface ObjectSchema { readonly type?: string | readonly string[]; readonly properties?: Readonly<Record<string, unknown>>; readonly required?: readonly string[]; readonly additionalProperties?: boolean }

/** A contract value's declared shape, read as the schema object it is; undefined for anything else. */
function schemaOf(value: unknown): ObjectSchema | undefined {
  return value && typeof value === "object" ? (value as ObjectSchema) : undefined
}

/** Every object schema in a contract, so `additionalProperties: false` can be asserted on all of them at once. */
function objectSchemas(): { at: string; schema: ObjectSchema }[] {
  const out: { at: string; schema: ObjectSchema }[] = []
  const walk = (schema: unknown, at: string): void => {
    const candidate = schemaOf(schema)
    if (!candidate) return
    const types = Array.isArray(candidate.type) ? candidate.type : [candidate.type]
    // A schema that names its members is an object schema, and must be closed. A free-form value (`a theme object`)
    // carries any shape by design, so it is the one object-typed schema that declares no members to close.
    if (types.includes("object") && candidate.properties !== undefined) out.push({ at, schema: candidate })
    for (const [name, child] of Object.entries(candidate.properties ?? {})) walk(child, `${at}/properties/${name}`)
  }
  for (const [name, method] of Object.entries(ChartsThemeContract.methods)) {
    walk(method.input, `${name}.input`)
    walk(method.output, `${name}.output`)
  }
  for (const [name, event] of Object.entries(ChartsThemeContract.events)) walk(event.schema, `changed(${name})`)
  return out
}

/** Whether a value matches a contract value's declared shape: required keys, named properties, nothing extra. */
function conforms(schema: unknown, value: unknown): string | undefined {
  const declared = schemaOf(schema)
  if (!declared || !value || typeof value !== "object" || Array.isArray(value)) return "not an object"
  const record = value as Record<string, unknown>
  for (const key of declared.required ?? []) if (!(key in record)) return `missing ${key}`
  for (const key of Object.keys(record)) {
    if (!Object.hasOwn(declared.properties ?? {}, key)) return `unexpected ${key}`
    if (record[key] === undefined) return `undefined ${key}`
  }
  return undefined
}

describe("the charts.theme RPC", () => {
  test("is declared once, and every object it declares is closed", () => {
    expect(ChartsThemeRpc).toBe(ChartsThemeContract)
    expect(THEME_RPC_ID).toBe("charts.theme")
    const schemas = objectSchemas()
    expect(schemas.length).toBeGreaterThan(6)
    for (const { at, schema } of schemas) expect({ at, additionalProperties: schema.additionalProperties }).toEqual({ at, additionalProperties: false })
    // The verbs, and what each one must answer.
    expect(Object.keys(ChartsThemeContract.methods).sort()).toEqual(["clear", "get", "sync"])
    expect(ChartsThemeContract.methods.sync.input.required).toEqual(["theme"])
    expect(ChartsThemeContract.methods.sync.output.required).toEqual(["ok", "applied", "revision", "mode", "themeName"])
    expect(ChartsThemeContract.methods.get.output.required).toEqual(["found", "revision", "theme"])
    expect(ChartsThemeContract.methods.clear.output.required).toEqual(["cleared"])
    expect(ChartsThemeContract.events.changed.schema.required).toEqual(["revision", "mode", "themeName"])
    // The type an importer names is the contract's own type.
    expect(ChartsThemeContract.methods.sync.input.properties.theme).toEqual({ type: ["string", "object"] })
    expect(({} as ChartsThemeRpcType).id).toBeUndefined()
  })

  test("registers one method per verb and the changed event, and unregisters on cleanup", async () => {
    const { sources } = setup()
    const host = hostRpc()
    const stop = await registerThemeRpc(host.rpc as never, host.store, sources)
    expect(host.contract().id).toBe(THEME_RPC_ID)
    expect(Object.keys(host.contract().methods).sort()).toEqual(["clear", "get", "sync"])
    expect(Object.keys(host.contract().events)).toEqual(["changed"])
    await stop()
    expect(host.state.disposed).toBe(true)
  })

  test("answers every verb in exactly the shape the one contract declares", async () => {
    const { sources } = setup()
    const host = hostRpc()
    const stop = await registerThemeRpc(host.rpc as never, host.store, sources)
    expect(host.contract()).toBe(ChartsThemeContract)

    const synced = await host.handlers.sync!({ sessionID: "ses_a", theme: "dark" }, context)
    expect(conforms(ChartsThemeContract.methods.sync.output, synced)).toBeUndefined()
    expect(synced).toMatchObject({ ok: true, applied: true, mode: "dark", themeName: "dark" })

    const read = await host.handlers.get!({ sessionID: "ses_a" }, context)
    expect(conforms(ChartsThemeContract.methods.get.output, read)).toBeUndefined()
    expect(read).toMatchObject({ found: true, revision: (synced as { revision: string }).revision, mode: "dark", themeName: "dark" })
    expect(conforms(schemaOf(ChartsThemeContract.methods.get.output)?.properties?.theme, (read as { theme: unknown }).theme)).toBeUndefined()

    // The event carries the revision the sync answered, and its own closed shape.
    const [event] = host.events
    expect(event!.name).toBe("changed")
    expect(conforms(ChartsThemeContract.events.changed.schema, event!.data)).toBeUndefined()
    expect(event!.data).toMatchObject({ revision: (synced as { revision: string }).revision, mode: "dark", themeName: "dark" })

    expect(conforms(ChartsThemeContract.methods.clear.output, await host.handlers.clear!({ sessionID: "ses_a" }, context))).toBeUndefined()
    expect((await host.handlers.get!({}, context) as { found: boolean }).found).toBe(false)
    await stop()
  })

  test("reports the polarity of a saved dark theme and of an inline dark seed", async () => {
    const { sources } = setup()
    saveTheme(sources, "night-shift", { extends: "dark", colors: { background: "#0B0D10", text: "#ECEFF4" } })
    const host = hostRpc()
    await registerThemeRpc(host.rpc as never, host.store, sources)
    // A name the built-ins do not have: the polarity is the resolved theme's own, not an assumption of light.
    const saved = await host.handlers.sync!({ theme: "night-shift" }, context)
    expect(saved).toMatchObject({ ok: true, mode: "dark", themeName: "night-shift" })
    expect(host.events.at(-1)?.data).toMatchObject({ mode: "dark" })
    expect((await host.handlers.get!({}, context)) as { mode?: string }).toMatchObject({ mode: "dark" })

    const inline = await host.handlers.sync!({ theme: { mode: "dark", seed: { background: "#0B0D10", foreground: "#ECEFF4" } } }, context)
    expect(inline).toMatchObject({ ok: true, mode: "dark", themeName: "seed-custom" })
    // A light seed over the dark base is still read from the theme it derives, not from the word "seed".
    const light = await host.handlers.sync!({ theme: { seed: { background: "#FAF8F5", foreground: "#1A1A18" } } }, context)
    expect(light).toMatchObject({ ok: true, mode: "light" })
    // A session's explicit mode still wins over the theme's own.
    const forced = await host.handlers.sync!({ sessionID: "ses_x", mode: "dark", theme: "light" }, context)
    expect(forced).toMatchObject({ ok: true, mode: "dark" })
  })

  test("an event raised before rpc.register resolves is delivered once the registration exists", async () => {
    const { sources } = setup()
    const store = createHostThemeStore()
    const events: { name: string; data: Record<string, unknown> }[] = []
    const handlers: Handlers = {}
    let release!: () => void
    const gate = new Promise<void>(resolve => { release = resolve })
    const rpc = {
      register: async (definition: unknown, registered: unknown) => {
        expect(definition).toBe(ChartsThemeContract)
        Object.assign(handlers, registered as Handlers)
        // A host is free to call the method it just handed over while register() is still in flight.
        void handlers.sync!({ theme: "dark" }, context)
        await gate
        return { events: { emit: async (name: string, data: Record<string, unknown>) => { events.push({ name, data }) } }, dispose: async () => undefined }
      },
    }
    const registration = registerThemeRpc(rpc as never, store, sources)
    // Let the sync run to its end; it queues its event because `reg.emit` does not exist yet.
    for (let turn = 0; turn < 12; turn++) await Promise.resolve()
    expect(events).toEqual([])
    release()
    await registration
    // The queue is flushed before registerThemeRpc resolves, so the first theme a host pushes is never lost.
    expect(events.map(event => event.name)).toEqual(["changed"])
    expect(events[0]!.data).toMatchObject({ mode: "dark", themeName: "dark" })
  })

  test("syncs a name for one session and for the whole location, and get prefers the session's", async () => {
    const { sources } = setup()
    const host = hostRpc()
    await registerThemeRpc(host.rpc as never, host.store, sources)
    expect(host.contract().id).toBe(THEME_RPC_ID)

    const synced = await host.handlers.sync!({ theme: "dark" }, context) as Record<string, unknown>
    expect(synced).toMatchObject({ ok: true, mode: "dark", themeName: "dark" })
    expect(synced.revision).toBe(hostThemeRevision("dark", "dark"))
    const session = await host.handlers.sync!({ sessionID: "ses_a", theme: { seed: { accent: "#38BDF8" } } }, context) as Record<string, unknown>
    expect(session).toMatchObject({ ok: true, mode: "light", themeName: "seed-custom" })
    expect(host.events.map(event => event.name)).toEqual(["changed", "changed"])
    // The location theme stands in for a session that has none of its own.
    expect((await host.handlers.get!({ sessionID: "ses_a" }, context) as { theme: { theme: unknown } }).theme.theme).toEqual({ seed: { accent: "#38BDF8" } })
    expect((await host.handlers.get!({ sessionID: "ses_other" }, context) as { theme: { theme: unknown } }).theme.theme).toBe("dark")
    expect((await host.handlers.get!({}, context) as { theme: { mode: string } }).theme.mode).toBe("dark")
  })

  test("the same theme gives the same revision, a host's own revision is kept, and the event repeats it", async () => {
    const { sources } = setup()
    const host = hostRpc()
    await registerThemeRpc(host.rpc as never, host.store, sources)
    const theme = { colors: { background: "#101418", highlight: "#38BDF8" } }
    const first = await host.handlers.sync!({ sessionID: "ses_a", theme }, context) as { revision: string }
    const again = await host.handlers.sync!({ sessionID: "ses_a", theme }, context) as { revision: string }
    expect(again.revision).toBe(first.revision)
    expect(host.events.at(-1)?.data.revision).toBe(first.revision)
    const owned = await host.handlers.sync!({ sessionID: "ses_a", theme, revision: "rev-7" }, context) as { revision: string }
    expect(owned.revision).toBe("rev-7")
    expect(host.store.forSession("ses_a")?.revision).toBe("rev-7")
  })

  test("clear drops a session's theme, then the location's", async () => {
    const { sources } = setup()
    const host = hostRpc()
    await registerThemeRpc(host.rpc as never, host.store, sources)
    await host.handlers.sync!({ sessionID: "ses_a", theme: "dark" }, context)
    await host.handlers.sync!({ theme: "light" }, context)
    expect(await host.handlers.clear!({ sessionID: "ses_a" }, context)).toEqual({ cleared: true })
    expect((await host.handlers.get!({ sessionID: "ses_a" }, context) as { theme: { theme: unknown } }).theme.theme).toBe("light")
    expect(await host.handlers.clear!({ sessionID: "ses_a" }, context)).toEqual({ cleared: false })
    expect(await host.handlers.clear!({}, context)).toEqual({ cleared: true })
    expect(await host.handlers.get!({ sessionID: "ses_a" }, context)).toEqual({ found: false, revision: null, theme: null })
  })

  test("a name no theme has, an empty name and a bad seed are refused with a code and a next step", async () => {
    const { sources } = setup()
    const host = hostRpc()
    await registerThemeRpc(host.rpc as never, host.store, sources)
    const missing = await host.handlers.sync!({ theme: "dakr" }, context) as Failure
    expect(missing.type).toBe("refused")
    expect(missing.data?.code).toBe("THEME_NOT_FOUND")
    expect(missing.message).toContain('Did you mean "dark"')
    expect(missing.data?.next).toContain("sync the theme's own tokens")
    expect((await host.handlers.sync!({ theme: "  " }, context) as Failure).data?.code).toBe("THEME_INVALID")
    expect((await host.handlers.sync!({ theme: { seed: { backgrund: "#FFFFFF" } } }, context) as Failure).data?.code).toBe("THEME_INVALID")
    expect((await host.handlers.sync!({}, context) as Failure).data?.code).toBe("THEME_INVALID")
    // Nothing was stored by a refusal.
    expect(host.store.default()).toBeUndefined()
    expect(host.store.size).toBe(0)
  })

  test("remembers at most MAX_SYNCED_THEMES sessions, dropping the least recently used", async () => {
    const store = createHostThemeStore()
    for (let index = 0; index < MAX_SYNCED_THEMES + 44; index += 1) store.sync({ sessionID: `ses_${index}`, theme: "dark" })
    expect(store.size).toBe(MAX_SYNCED_THEMES)
    expect(store.forSession("ses_0")).toBeUndefined()
    expect(store.forSession(`ses_${MAX_SYNCED_THEMES + 43}`)?.theme).toBe("dark")
    // Reading a session keeps it: the next sync drops the oldest untouched one, not the one just read.
    expect(store.forSession("ses_44")).toBeDefined()
    store.sync({ sessionID: "ses_new", theme: "light" })
    expect(store.forSession("ses_44")).toBeDefined()
    expect(store.forSession("ses_45")).toBeUndefined()
  })

  test("precedence is the call's theme, the session's, the location's, then the configured default", async () => {
    const store = createHostThemeStore()
    expect(effectiveThemeInput("high-contrast", "ses_a", store, "jelly")).toBe("high-contrast")
    expect(effectiveThemeInput(undefined, "ses_a", store, "jelly")).toBe("jelly")
    expect(effectiveThemeInput(undefined, "ses_a", undefined, "jelly")).toBe("jelly")
    store.sync({ theme: "dark" })
    expect(effectiveThemeInput(undefined, "ses_a", store, "jelly")).toBe("dark")
    store.sync({ sessionID: "ses_a", theme: { seed: { accent: "#C2410C" } } })
    expect(effectiveThemeInput(undefined, "ses_a", store, "jelly")).toEqual({ seed: { accent: "#C2410C" } })
    // Another session still sees the location's theme, and a call still beats both.
    expect(effectiveThemeInput(undefined, "ses_b", store, "jelly")).toBe("dark")
    expect(effectiveThemeInput("print", "ses_b", store, "jelly")).toBe("print")
    store.clear()
    expect(effectiveThemeInput(undefined, "ses_b", store, "jelly")).toBe("jelly")
    expect(effectiveThemeInput(undefined, "ses_b", store, undefined)).toBeUndefined()
    expect(hostThemeName("dark")).toBe("dark")
    expect(hostThemeName({ name: "acme" })).toBe("acme")
    expect(hostThemeName({ variants: { light: {}, dark: {} } })).toBe("variant-custom")
  })
})

// ---------------------------------------------------------------------------------------------------------------
// Boards.

describe("charts_board themes", () => {
  const board = (theme: HostThemeValue) => ({
    version: 1,
    title: "Theme board",
    datasets: { sales: { rows: [{ region: "North", revenue: 120 }, { region: "South", revenue: 80 }] } },
    theme,
    panels: [{ id: "bar", title: "Revenue", dataset: "sales", chart: { quick: { type: "bar", x: "region", y: "revenue" } } }],
  })

  test("an inline token object themes every panel and the poster", async () => {
    const { env } = setup()
    const result = await renderBoard(board({ extends: "dark", colors: { background: "#101418", highlight: "#38BDF8" } }), env, false)
    expect(result.theme).toBe("dark-custom")
    expect(result.svg).toContain("#101418")
    expect(result.issues.filter(issue => issue.level === "error")).toEqual([])
  })

  test("an inline seed themes the board too, with the accent leading the palette", async () => {
    const { env } = setup()
    const result = await renderBoard(board({ seed: { background: "#FAF8F5", foreground: "#1C1917", accent: "#D97757" } }), env, false)
    expect(result.theme).toBe("light-custom")
    expect(result.svg).toContain("#FAF8F5")
    expect(result.svg).toContain("#D97757")
    expect(result.issues.filter(issue => issue.level === "error")).toEqual([])
  })
})
