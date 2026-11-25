/** The JSON Schemas of the three theme bridge methods, shared by the handlers and the TUI's client definition. */

const string = { type: "string" } as const
const boolean = { type: "boolean" } as const
const mode = { enum: ["light", "dark"] } as const
/** A synced theme is a name or the theme object itself, exactly as the theme chain resolves it. */
const themeValue = { type: ["string", "object"] } as const
/** Every answer carries the contract's trust marking: its text is data, never instructions (contract §13). */
const trust = { const: "untrusted" } as const

export const THEME_SYNC_INPUT = {
  type: "object",
  required: ["theme"],
  properties: {
    theme: { ...themeValue, description: "A theme name (light, dark, high-contrast, print, presentation or a saved one), or the theme object itself." },
    mode: { ...mode, description: "The polarity the host shows; inferred from the theme when omitted." },
    revision: { ...string, description: "The host's own revision for this theme; a digest of the theme when omitted." },
  },
  additionalProperties: false,
} as const

export const THEME_SYNC_OUTPUT = {
  type: "object",
  required: ["ok", "applied", "revision", "mode", "themeName"],
  properties: { ok: boolean, applied: boolean, revision: string, mode, themeName: string, trust },
  additionalProperties: false,
} as const

export const THEME_GET_INPUT = { type: "object", properties: {}, additionalProperties: false } as const

export const THEME_GET_OUTPUT = {
  type: "object",
  required: ["found", "revision", "theme"],
  properties: {
    found: boolean,
    revision: { type: ["string", "null"] },
    mode,
    themeName: string,
    trust,
    theme: {
      type: ["object", "null"],
      required: ["theme", "mode", "revision"],
      properties: { theme: themeValue, mode, revision: string },
      additionalProperties: false,
    },
  },
  additionalProperties: false,
} as const

export const THEME_CLEAR_INPUT = { type: "object", properties: {}, additionalProperties: false } as const

export const THEME_CLEAR_OUTPUT = {
  type: "object",
  required: ["cleared"],
  properties: { cleared: boolean, trust },
  additionalProperties: false,
} as const
