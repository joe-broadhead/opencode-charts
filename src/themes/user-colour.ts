/**
 * A colour a caller writes into a spec field that is drawn straight into SVG (a table badge's colour, a diagram node's
 * accent): `#rgb`, `#rgba`, `#rrggbb`, `#rrggbbaa`, `rgb()`/`rgba()` with numbers only, `transparent`, a CSS named
 * colour, or a `theme:<token>` reference the pipeline resolves first. The grammar is closed, so a value can never carry
 * a quote, a bracket, a semicolon or `url(`; and every value is still escaped where it is written into an attribute
 * (`attr`).
 */

/** The shape of a user colour, as the tool schema states it. A name must also be one of `CSS_NAMED_COLOURS`. */
export const USER_COLOUR_PATTERN = /^(?:#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})|rgba?\([\d\s.,%]+\)|transparent|[A-Za-z]{3,20}|theme:[a-z]+(?:\.\d{1,3})?)$/
export const USER_COLOUR_MESSAGE = "a colour is #rgb, #rrggbb, #rrggbbaa, rgb(), rgba(), transparent, a CSS colour name such as teal, or a theme token such as theme:positive"

/** The CSS Color 4 named colours, with their sRGB values. */
export const CSS_NAMED_COLOURS: Readonly<Record<string, string>> = {
  aliceblue: "#f0f8ff", antiquewhite: "#faebd7", aqua: "#00ffff", aquamarine: "#7fffd4", azure: "#f0ffff", beige: "#f5f5dc",
  bisque: "#ffe4c4", black: "#000000", blanchedalmond: "#ffebcd", blue: "#0000ff", blueviolet: "#8a2be2", brown: "#a52a2a",
  burlywood: "#deb887", cadetblue: "#5f9ea0", chartreuse: "#7fff00", chocolate: "#d2691e", coral: "#ff7f50",
  cornflowerblue: "#6495ed", cornsilk: "#fff8dc", crimson: "#dc143c", cyan: "#00ffff", darkblue: "#00008b",
  darkcyan: "#008b8b", darkgoldenrod: "#b8860b", darkgray: "#a9a9a9", darkgreen: "#006400", darkgrey: "#a9a9a9",
  darkkhaki: "#bdb76b", darkmagenta: "#8b008b", darkolivegreen: "#556b2f", darkorange: "#ff8c00", darkorchid: "#9932cc",
  darkred: "#8b0000", darksalmon: "#e9967a", darkseagreen: "#8fbc8f", darkslateblue: "#483d8b", darkslategray: "#2f4f4f",
  darkslategrey: "#2f4f4f", darkturquoise: "#00ced1", darkviolet: "#9400d3", deeppink: "#ff1493", deepskyblue: "#00bfff",
  dimgray: "#696969", dimgrey: "#696969", dodgerblue: "#1e90ff", firebrick: "#b22222", floralwhite: "#fffaf0",
  forestgreen: "#228b22", fuchsia: "#ff00ff", gainsboro: "#dcdcdc", ghostwhite: "#f8f8ff", gold: "#ffd700",
  goldenrod: "#daa520", gray: "#808080", green: "#008000", greenyellow: "#adff2f", grey: "#808080", honeydew: "#f0fff0",
  hotpink: "#ff69b4", indianred: "#cd5c5c", indigo: "#4b0082", ivory: "#fffff0", khaki: "#f0e68c", lavender: "#e6e6fa",
  lavenderblush: "#fff0f5", lawngreen: "#7cfc00", lemonchiffon: "#fffacd", lightblue: "#add8e6", lightcoral: "#f08080",
  lightcyan: "#e0ffff", lightgoldenrodyellow: "#fafad2", lightgray: "#d3d3d3", lightgreen: "#90ee90", lightgrey: "#d3d3d3",
  lightpink: "#ffb6c1", lightsalmon: "#ffa07a", lightseagreen: "#20b2aa", lightskyblue: "#87cefa",
  lightslategray: "#778899", lightslategrey: "#778899", lightsteelblue: "#b0c4de", lightyellow: "#ffffe0", lime: "#00ff00",
  limegreen: "#32cd32", linen: "#faf0e6", magenta: "#ff00ff", maroon: "#800000", mediumaquamarine: "#66cdaa",
  mediumblue: "#0000cd", mediumorchid: "#ba55d3", mediumpurple: "#9370db", mediumseagreen: "#3cb371",
  mediumslateblue: "#7b68ee", mediumspringgreen: "#00fa9a", mediumturquoise: "#48d1cc", mediumvioletred: "#c71585",
  midnightblue: "#191970", mintcream: "#f5fffa", mistyrose: "#ffe4e1", moccasin: "#ffe4b5", navajowhite: "#ffdead",
  navy: "#000080", oldlace: "#fdf5e6", olive: "#808000", olivedrab: "#6b8e23", orange: "#ffa500", orangered: "#ff4500",
  orchid: "#da70d6", palegoldenrod: "#eee8aa", palegreen: "#98fb98", paleturquoise: "#afeeee", palevioletred: "#db7093",
  papayawhip: "#ffefd5", peachpuff: "#ffdab9", peru: "#cd853f", pink: "#ffc0cb", plum: "#dda0dd", powderblue: "#b0e0e6",
  purple: "#800080", rebeccapurple: "#663399", red: "#ff0000", rosybrown: "#bc8f8f", royalblue: "#4169e1",
  saddlebrown: "#8b4513", salmon: "#fa8072", sandybrown: "#f4a460", seagreen: "#2e8b57", seashell: "#fff5ee",
  sienna: "#a0522d", silver: "#c0c0c0", skyblue: "#87ceeb", slateblue: "#6a5acd", slategray: "#708090",
  slategrey: "#708090", snow: "#fffafa", springgreen: "#00ff7f", steelblue: "#4682b4", tan: "#d2b48c", teal: "#008080",
  thistle: "#d8bfd8", tomato: "#ff6347", turquoise: "#40e0d0", violet: "#ee82ee", wheat: "#f5deb3", white: "#ffffff",
  whitesmoke: "#f5f5f5", yellow: "#ffff00", yellowgreen: "#9acd32",
}

/** Whether `value` is a user colour: the pattern, and a real name when it is a word. */
export function isUserColour(value: string): boolean {
  const v = value.trim()
  if (!USER_COLOUR_PATTERN.test(v)) return false
  if (/^[A-Za-z]+$/.test(v)) return v.toLowerCase() === "transparent" || Object.hasOwn(CSS_NAMED_COLOURS, v.toLowerCase())
  return true
}

/** A theme token ("theme:positive") is resolved to the theme's colour before a spec is drawn; one left over is no colour. */
const isThemeToken = (value: string) => value.startsWith("theme:")

/**
 * A user colour in the form the engines draw and mix: a name becomes its hex value, anything else is returned as given.
 * `undefined` for a value that is not a user colour, so a caller can never draw one unchecked.
 */
export function userColourHex(value: string | undefined): string | undefined {
  if (value === undefined || !isUserColour(value) || isThemeToken(value.trim())) return undefined
  const v = value.trim()
  const named = CSS_NAMED_COLOURS[v.toLowerCase()]
  return named ?? (v.toLowerCase() === "transparent" ? "transparent" : v)
}

/** The closed grammar of a theme token (tokens.ts), plus the user colours: the only colour text an engine writes. */
const TOKEN = /^(?:#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})|(?:rgba?|hsla?|oklch|oklab|color)\([0-9a-zA-Z.\s,%+\/-]+\)|transparent|none)$/

/** `value` when it is colour text an engine may write (a theme token or a user colour), else `undefined`. */
export function colourToken(value: string): string | undefined {
  const v = value.trim()
  if (TOKEN.test(v)) return v
  return userColourHex(v)
}

/** A value escaped for a double-quoted XML attribute. */
export function attr(value: string | number | undefined): string {
  return String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;")
}
