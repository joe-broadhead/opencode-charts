"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/gui.ts
var gui_exports = {};
__export(gui_exports, {
  CodeBlock: () => CodeBlock,
  CodeBlockAction: () => CodeBlockAction,
  Command: () => import_gui.Command,
  buildChartCard: () => buildChartCard,
  buildChartCardSvg: () => buildChartCardSvg,
  chartCardElement: () => chartCardElement,
  chartLanguages: () => chartLanguages,
  default: () => gui_default,
  hostDocument: () => hostDocument,
  readGuiThemeSeed: () => readGuiThemeSeed,
  setupGui: () => setupGui,
  syncGuiTheme: () => syncGuiTheme
});
module.exports = __toCommonJS(gui_exports);
var import_gui = require("@opencode/plugin/gui");
var import_h = __toESM(require("solid-js/h"), 1);

// src/theme-contract.ts
var import_rpc = require("@opencode/plugin/rpc");
var THEME_RPC_ID = "charts.theme";
var string = { type: "string" };
var boolean = { type: "boolean" };
var modeSchema = { enum: ["light", "dark"] };
var themeValue = { type: ["string", "object"] };
var refusalSchema = { type: "object", required: ["code", "next"], properties: { code: string, next: string }, additionalProperties: false };
var ChartsThemeContract = import_rpc.Rpc.define({
  id: THEME_RPC_ID,
  methods: {
    sync: {
      input: {
        type: "object",
        required: ["theme"],
        properties: { sessionID: string, mode: modeSchema, theme: themeValue, revision: string },
        additionalProperties: false
      },
      output: {
        type: "object",
        required: ["ok", "applied", "revision", "mode", "themeName"],
        properties: { ok: boolean, applied: boolean, revision: string, mode: modeSchema, themeName: string },
        additionalProperties: false
      },
      errors: { refused: refusalSchema }
    },
    get: {
      input: { type: "object", properties: { sessionID: string }, additionalProperties: false },
      output: {
        type: "object",
        required: ["found", "revision", "theme"],
        properties: {
          found: boolean,
          revision: { type: ["string", "null"] },
          mode: modeSchema,
          themeName: string,
          theme: {
            type: ["object", "null"],
            required: ["theme", "mode", "revision"],
            properties: { theme: themeValue, mode: modeSchema, revision: string, sessionID: string },
            additionalProperties: false
          }
        },
        additionalProperties: false
      }
    },
    clear: {
      input: { type: "object", properties: { sessionID: string }, additionalProperties: false },
      output: { type: "object", required: ["cleared"], properties: { cleared: boolean }, additionalProperties: false }
    }
  },
  events: {
    /** The theme in force changed: the same revision a `sync` returned, so a viewer can ignore its own echo. */
    changed: {
      schema: {
        type: "object",
        required: ["revision", "mode", "themeName"],
        properties: { revision: string, mode: modeSchema, themeName: string, sessionID: string },
        additionalProperties: false
      }
    }
  }
});
var isRecord = /* @__PURE__ */ __name((value) => typeof value === "object" && value !== null, "isRecord");
var clamp = /* @__PURE__ */ __name((value, minimum, maximum) => Math.min(maximum, Math.max(minimum, value)), "clamp");
var channel = /* @__PURE__ */ __name((value) => clamp(Math.round(value), 0, 255).toString(16).padStart(2, "0"), "channel");
function fromRgb(red, green, blue) {
  if (![red, green, blue].every(Number.isFinite)) return void 0;
  return `#${channel(red)}${channel(green)}${channel(blue)}`;
}
__name(fromRgb, "fromRgb");
function fromHsl(hue, saturation, lightness) {
  if (![hue, saturation, lightness].every(Number.isFinite)) return void 0;
  const turn = (hue % 360 + 360) % 360;
  const chroma = (1 - Math.abs(2 * clamp(lightness, 0, 100) / 100 - 1)) * (clamp(saturation, 0, 100) / 100);
  const second = chroma * (1 - Math.abs(turn / 60 % 2 - 1));
  const offset = clamp(lightness, 0, 100) / 100 - chroma / 2;
  const rgb = turn < 60 ? [chroma, second, 0] : turn < 120 ? [second, chroma, 0] : turn < 180 ? [0, chroma, second] : turn < 240 ? [0, second, chroma] : turn < 300 ? [second, 0, chroma] : [chroma, 0, second];
  return fromRgb((rgb[0] + offset) * 255, (rgb[1] + offset) * 255, (rgb[2] + offset) * 255);
}
__name(fromHsl, "fromHsl");
function splitArguments(value) {
  return value.split(/[\s,/]+/).map((part) => part.trim()).filter(Boolean);
}
__name(splitArguments, "splitArguments");
function fromString(raw) {
  const value = raw.trim().toLowerCase();
  if (!value) return void 0;
  const hex = /^#([0-9a-f]{3,8})$/.exec(value);
  if (hex) {
    const digits = hex[1];
    if (digits.length === 3 || digits.length === 4) return `#${digits[0]}${digits[0]}${digits[1]}${digits[1]}${digits[2]}${digits[2]}`;
    if (digits.length === 6 || digits.length === 8) return `#${digits.slice(0, 6)}`;
    return void 0;
  }
  const rgb = /^rgba?\(([^)]*)\)$/.exec(value);
  if (rgb) {
    const parts = splitArguments(rgb[1]);
    if (parts.length < 3) return void 0;
    const values = parts.slice(0, 3).map((part) => part.endsWith("%") ? Number.parseFloat(part) / 100 * 255 : Number.parseFloat(part));
    return fromRgb(values[0], values[1], values[2]);
  }
  const hsl = /^hsla?\(([^)]*)\)$/.exec(value);
  if (hsl) {
    const parts = splitArguments(hsl[1]);
    if (parts.length < 3) return void 0;
    return fromHsl(Number.parseFloat(parts[0]), Number.parseFloat(parts[1]), Number.parseFloat(parts[2]));
  }
  return void 0;
}
__name(fromString, "fromString");
function fromObject(value) {
  const toHex = value.toHex;
  if (typeof toHex === "function") {
    try {
      const printed = toHex.call(value);
      if (typeof printed === "string") {
        const hex = fromString(printed);
        if (hex) return hex;
      }
    } catch {
    }
  }
  const toInts = value.toInts;
  if (typeof toInts === "function") {
    try {
      const ints = toInts.call(value);
      if (Array.isArray(ints) && ints.length >= 3) {
        const rgb = fromRgb(Number(ints[0]), Number(ints[1]), Number(ints[2]));
        if (rgb) return rgb;
      }
    } catch {
    }
  }
  const red = value.r;
  const green = value.g;
  const blue = value.b;
  if (typeof red === "number" && typeof green === "number" && typeof blue === "number") {
    const unit = [red, green, blue].every((part) => part >= 0 && part <= 1) && [red, green, blue].some((part) => !Number.isInteger(part));
    return fromRgb(unit ? red * 255 : red, unit ? green * 255 : green, unit ? blue * 255 : blue);
  }
  return void 0;
}
__name(fromObject, "fromObject");
function toHexColor(value) {
  if (typeof value === "string") return fromString(value);
  if (isRecord(value)) return fromObject(value);
  return void 0;
}
__name(toHexColor, "toHexColor");
function colorLuminance(hex) {
  const read = /* @__PURE__ */ __name((offset) => {
    const value = Number.parseInt(hex.slice(offset, offset + 2), 16) / 255;
    if (!Number.isFinite(value)) return 0;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  }, "read");
  return 0.2126 * read(1) + 0.7152 * read(3) + 0.0722 * read(5);
}
__name(colorLuminance, "colorLuminance");
function fnv1a(value, seed) {
  let state = seed >>> 0;
  for (let index = 0; index < value.length; index++) {
    state ^= value.charCodeAt(index);
    state = Math.imul(state, 16777619) >>> 0;
  }
  return state.toString(16).padStart(8, "0");
}
__name(fnv1a, "fnv1a");
function themeRevision(mode, seed) {
  const series = Array.isArray(seed.series) ? seed.series.map((token) => String(token)) : [];
  const canonical = [mode, seed.background, seed.surface, seed.text, seed.muted, seed.border, seed.accent, ...series].map((token) => typeof token === "string" ? token : "").join("\n");
  return `${fnv1a(canonical, 2166136261)}${fnv1a(canonical, 2654435769)}`;
}
__name(themeRevision, "themeRevision");
function seedResult(tokens, modeHint) {
  const seed = {};
  for (const key of ["background", "surface", "text", "muted", "border", "accent"]) {
    const value = tokens[key];
    if (value) seed[key] = value;
  }
  if (tokens.series?.length) seed.series = [...tokens.series];
  if (Object.keys(seed).length === 0) return void 0;
  const mode = modeHint ?? (typeof tokens.background === "string" ? colorLuminance(tokens.background) > 0.45 ? "light" : "dark" : "dark");
  return { mode, seed, revision: themeRevision(mode, seed) };
}
__name(seedResult, "seedResult");
var BACKGROUND_VARIABLES = ["--v2-background-bg-base", "--background", "--surface-page", "--viz-ground"];
var SURFACE_VARIABLES = ["--v2-background-bg-raised-base", "--v2-background-bg-raised", "--card", "--muted", "--surface-raised", "--secondary"];
var TEXT_VARIABLES = ["--v2-text-text-base", "--foreground", "--viz-ink", "--text"];
var MUTED_VARIABLES = ["--v2-text-text-muted", "--muted-foreground", "--viz-muted", "--text-muted"];
var BORDER_VARIABLES = ["--v2-border-border-base", "--border", "--viz-grid", "--input"];
var ACCENT_VARIABLES = ["--v2-icon-icon-accent-base", "--v2-text-text-accent", "--primary", "--accent", "--ring", "--viz-accent"];
var SERIES_VARIABLES = ["--chart-1", "--chart-2", "--chart-3", "--chart-4", "--chart-5", "--chart-6"];
var VIZ_VARIABLES = ["--viz-1", "--viz-2", "--viz-3", "--viz-4", "--viz-5", "--viz-6"];
function computedStyle(doc) {
  const element = doc.documentElement;
  if (!element) return void 0;
  const view = doc.defaultView;
  if (view && typeof view.getComputedStyle === "function") {
    try {
      return view.getComputedStyle(element) ?? void 0;
    } catch {
      return void 0;
    }
  }
  const scope = globalThis;
  if (typeof scope.getComputedStyle === "function") {
    try {
      return scope.getComputedStyle(element) ?? void 0;
    } catch {
      return void 0;
    }
  }
  return void 0;
}
__name(computedStyle, "computedStyle");
function extractDomThemeSeed(doc, modeHint) {
  if (!doc) return void 0;
  const style = computedStyle(doc);
  if (!style) return void 0;
  const read = /* @__PURE__ */ __name((name) => {
    try {
      const raw = typeof style.getPropertyValue === "function" ? style.getPropertyValue(name) : void 0;
      return typeof raw === "string" && raw.trim() !== "" ? raw : void 0;
    } catch {
      return void 0;
    }
  }, "read");
  const first = /* @__PURE__ */ __name((names) => {
    for (const name of names) {
      const color = toHexColor(read(name));
      if (color) return color;
    }
    return void 0;
  }, "first");
  const collection = /* @__PURE__ */ __name((names) => names.map((name) => toHexColor(read(name))).filter((color) => typeof color === "string").slice(0, 6), "collection");
  const charts = collection(SERIES_VARIABLES);
  const tokens = {
    background: first(BACKGROUND_VARIABLES) ?? toHexColor(style.backgroundColor),
    surface: first(SURFACE_VARIABLES),
    text: first(TEXT_VARIABLES) ?? toHexColor(style.color),
    muted: first(MUTED_VARIABLES),
    border: first(BORDER_VARIABLES),
    accent: first(ACCENT_VARIABLES),
    series: charts.length ? charts : collection(VIZ_VARIABLES)
  };
  return seedResult(tokens, modeHint);
}
__name(extractDomThemeSeed, "extractDomThemeSeed");

// src/tui-chart.ts
var isRecord2 = /* @__PURE__ */ __name((value) => typeof value === "object" && value !== null && !Array.isArray(value), "isRecord");
function toNumber(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : void 0;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : void 0;
  }
  return void 0;
}
__name(toNumber, "toNumber");
var axisField = /* @__PURE__ */ __name((axis) => {
  if (typeof axis === "string") return axis;
  if (isRecord2(axis) && typeof axis.field === "string") return axis.field;
  return void 0;
}, "axisField");
var axisTitle = /* @__PURE__ */ __name((axis) => {
  if (isRecord2(axis)) {
    if (typeof axis.title === "string") return axis.title;
    if (isRecord2(axis.title) && typeof axis.title.text === "string") return axis.title.text;
  }
  return void 0;
}, "axisTitle");
var TYPE_ALIASES = {
  bar: "bar",
  column: "bar",
  horizontalbar: "horizontal_bar",
  horizontal: "horizontal_bar",
  hbar: "horizontal_bar",
  line: "line",
  multiline: "multi_line",
  multilinechart: "multi_line",
  area: "area",
  scatter: "scatter",
  point: "scatter",
  circle: "scatter",
  square: "scatter",
  tick: "scatter",
  sparkline: "sparkline",
  pie: "pie",
  arc: "pie",
  donut: "donut",
  doughnut: "donut",
  table: "table"
};
function chartType(input) {
  const mark = input.mark;
  const raw = typeof input.type === "string" ? input.type : typeof mark === "string" ? mark : isRecord2(mark) && typeof mark.type === "string" ? mark.type : void 0;
  const key = (raw ?? "bar").toLowerCase().replace(/[\s_-]/g, "");
  if (key === "arc" && isRecord2(mark) && toNumber(mark.innerRadius) !== void 0 && toNumber(mark.innerRadius) > 0) return "donut";
  return TYPE_ALIASES[key] ?? "bar";
}
__name(chartType, "chartType");
function titleText(title) {
  if (typeof title === "string") return title;
  if (isRecord2(title) && typeof title.text === "string") return title.text;
  return "";
}
__name(titleText, "titleText");
function dataRows(input) {
  const data = input.data;
  if (Array.isArray(data)) return data;
  if (isRecord2(data)) {
    if (Array.isArray(data.values)) return data.values;
    if (Array.isArray(data.rows)) return data.rows;
  }
  return [];
}
__name(dataRows, "dataRows");
function objectRows(input) {
  return dataRows(input).filter(isRecord2);
}
__name(objectRows, "objectRows");
function namedSeries(input) {
  const series = input.series;
  if (!Array.isArray(series)) return void 0;
  const labels = input.labels ?? [];
  const out = series.filter(isRecord2).map((entry, index) => {
    const values = Array.isArray(entry.values) ? entry.values : [];
    return {
      name: typeof entry.name === "string" && entry.name !== "" ? entry.name : `Series ${index + 1}`,
      points: values.map((value, position) => ({ x: String(labels[position] ?? position + 1), y: toNumber(value) ?? 0 }))
    };
  });
  return out.length ? out : void 0;
}
__name(namedSeries, "namedSeries");
function numericSeries(input) {
  if (!Array.isArray(input.values)) return void 0;
  const labels = input.labels ?? [];
  return [
    {
      name: seriesName(input) ?? "Value",
      points: input.values.map((value, index) => ({ x: String(labels[index] ?? index + 1), y: toNumber(value) ?? 0 }))
    }
  ];
}
__name(numericSeries, "numericSeries");
function seriesName(input) {
  const y = input.encoding?.y;
  if (typeof input.y === "string") return input.y;
  if (Array.isArray(input.y) && input.y.length === 1) return input.y[0];
  return axisTitle(y) ?? axisField(y);
}
__name(seriesName, "seriesName");
function recordSeries(input) {
  const objects = objectRows(input);
  if (!objects.length) return void 0;
  const first = objects[0];
  const keys = Object.keys(first);
  const xField = axisField(input.encoding?.x) ?? input.x ?? keys.find((key) => typeof first[key] === "string") ?? keys[0] ?? "x";
  const requested = axisField(input.encoding?.y);
  const declared = Array.isArray(input.y) ? input.y : input.y ? [input.y] : [];
  const numeric = keys.filter((key) => objects.some((row) => toNumber(row[key]) !== void 0));
  const yFields = requested ? [requested] : declared.length ? [...declared] : [numeric[0] ?? keys[1] ?? "y"];
  const seriesField = axisField(input.encoding?.color) ?? (typeof input.series === "string" ? input.series : void 0);
  const label2 = /* @__PURE__ */ __name((row, index) => {
    const value = row[xField];
    if (value === void 0 || value === null) return String(index + 1);
    return String(value);
  }, "label");
  if (seriesField && keys.includes(seriesField) && yFields.length === 1) {
    const field = yFields[0];
    const groups = /* @__PURE__ */ new Map();
    objects.forEach((row, index) => {
      const name = row[seriesField] === void 0 || row[seriesField] === null ? "\u2014" : String(row[seriesField]);
      const points = groups.get(name) ?? [];
      points.push({ x: label2(row, index), y: toNumber(row[field]) ?? 0 });
      groups.set(name, points);
    });
    return [...groups].map(([name, points]) => ({ name, points }));
  }
  return yFields.map((field) => ({
    name: yFields.length > 1 ? field : seriesName(input) ?? field,
    points: objects.map((row, index) => ({ x: label2(row, index), y: toNumber(row[field]) ?? 0 }))
  }));
}
__name(recordSeries, "recordSeries");
function normalizeChart(input) {
  const type = chartType(input);
  const title = titleText(input.title);
  const unit = input.unit ?? axisTitle(input.encoding?.y) ?? "";
  if (type === "table") {
    const objects = objectRows(input);
    const columns = input.columns ?? (objects.length ? Object.keys(objects[0]) : ["value"]);
    const rows = input.rows ?? (objects.length ? objects.map((row) => columns.map((column) => row[column])) : []);
    const numeric = !objects.length && Array.isArray(input.values);
    return {
      type,
      title,
      unit,
      series: [],
      columns: numeric ? input.columns ?? ["x", seriesName(input) ?? "value"] : columns,
      rows: numeric ? (input.values ?? []).map((value, index) => [input.labels?.[index] ?? index + 1, value]) : rows
    };
  }
  const series = namedSeries(input) ?? recordSeries(input) ?? numericSeries(input) ?? [];
  return { type, title, unit, series: series.filter((entry) => entry.points.length > 0), columns: [], rows: [] };
}
__name(normalizeChart, "normalizeChart");
function fenceBody(code) {
  const trimmed = code.trim();
  if (!trimmed.startsWith("```")) return trimmed;
  const firstBreak = trimmed.indexOf("\n");
  if (firstBreak < 0) return "";
  const rest = trimmed.slice(firstBreak + 1);
  const closing = rest.lastIndexOf("```");
  return (closing >= 0 ? rest.slice(0, closing) : rest).trim();
}
__name(fenceBody, "fenceBody");
function parseChartFence(code) {
  const body = fenceBody(code);
  if (!body) return void 0;
  let parsed;
  try {
    parsed = JSON.parse(body);
  } catch {
    return void 0;
  }
  if (!isRecord2(parsed)) return void 0;
  const encoding = isRecord2(parsed.encoding) ? parsed.encoding : void 0;
  const spec = {
    type: typeof parsed.type === "string" ? parsed.type : void 0,
    mark: typeof parsed.mark === "string" || isRecord2(parsed.mark) ? parsed.mark : void 0,
    title: typeof parsed.title === "string" || isRecord2(parsed.title) ? parsed.title : void 0,
    unit: typeof parsed.unit === "string" ? parsed.unit : void 0,
    data: parsed.data,
    x: typeof parsed.x === "string" ? parsed.x : void 0,
    y: typeof parsed.y === "string" || Array.isArray(parsed.y) ? parsed.y : void 0,
    series: typeof parsed.series === "string" || Array.isArray(parsed.series) ? parsed.series : void 0,
    encoding: encoding ? {
      x: encoding.x,
      y: encoding.y,
      color: encoding.color
    } : void 0,
    columns: Array.isArray(parsed.columns) ? parsed.columns : void 0,
    rows: Array.isArray(parsed.rows) ? parsed.rows : void 0,
    labels: Array.isArray(parsed.labels) ? parsed.labels : void 0,
    values: Array.isArray(parsed.values) ? parsed.values : void 0,
    width: toNumber(parsed.width),
    height: toNumber(parsed.height),
    ansi: typeof parsed.ansi === "boolean" ? parsed.ansi : void 0
  };
  return spec;
}
__name(parseChartFence, "parseChartFence");

// src/gui.ts
var chartLanguages = ["chart", "charts-board"];
var CodeBlock = import_gui.Registry.define("charts.codeBlock");
var CodeBlockAction = import_gui.Registry.define("charts.codeBlockAction");
var PALETTES = {
  light: {
    background: "#ffffff",
    surface: "#f6f8fa",
    text: "#1f2328",
    muted: "#6e7781",
    grid: "#e6e8eb",
    series: ["#0969da", "#8250df", "#bc4c00", "#1a7f37", "#cf222e", "#9a6700"]
  },
  dark: {
    background: "#0d1117",
    surface: "#161b22",
    text: "#e6edf3",
    muted: "#8b949e",
    grid: "#21262d",
    series: ["#58a6ff", "#bc8cff", "#f0883e", "#3fb950", "#f85149", "#d29922"]
  }
};
var HEX_COLOR = /^#[0-9a-f]{6}$/i;
function hostColor(seed, key) {
  const value = seed?.[key];
  return typeof value === "string" && HEX_COLOR.test(value) ? value : void 0;
}
__name(hostColor, "hostColor");
function paletteFor(mode, seed) {
  const base = PALETTES[mode];
  if (!seed) return base;
  const host = Array.isArray(seed.series) ? seed.series.filter((color) => typeof color === "string" && HEX_COLOR.test(color)) : [];
  const series = host.length ? Array.from({ length: base.series.length }, (_, index) => host[index % host.length]) : base.series;
  return {
    background: hostColor(seed, "background") ?? base.background,
    surface: hostColor(seed, "surface") ?? base.surface,
    text: hostColor(seed, "text") ?? base.text,
    muted: hostColor(seed, "muted") ?? base.muted,
    grid: hostColor(seed, "border") ?? base.grid,
    series
  };
}
__name(paletteFor, "paletteFor");
var WIDTH = 640;
var HEIGHT = 300;
var LEFT = 150;
var RIGHT = 616;
var TOP = 78;
var BOTTOM = 252;
var FONT = "ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif";
var MONO = "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";
var escapeXml = /* @__PURE__ */ __name((value) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;"), "escapeXml");
var round = /* @__PURE__ */ __name((value) => Math.round(value * 100) / 100, "round");
var span = /* @__PURE__ */ __name((value, minimum, maximum, from, to) => maximum === minimum ? (from + to) / 2 : from + (value - minimum) / (maximum - minimum) * (to - from), "span");
var label = /* @__PURE__ */ __name((x, y, content, options) => `<text x="${round(x)}" y="${round(y)}" fill="${options.fill}" font-family="${options.mono ? MONO : FONT}" font-size="${options.size ?? 12}"${options.anchor ? ` text-anchor="${options.anchor}"` : ""}${options.weight ? ` font-weight="${options.weight}"` : ""}>${escapeXml(content)}</text>`, "label");
var line = /* @__PURE__ */ __name((x1, y1, x2, y2, color, width = 1, dash) => `<line x1="${round(x1)}" y1="${round(y1)}" x2="${round(x2)}" y2="${round(y2)}" stroke="${color}" stroke-width="${width}"${dash ? ` stroke-dasharray="${dash}"` : ""}/>`, "line");
var rect = /* @__PURE__ */ __name((x, y, width, height, fill, radius = 3, opacity) => `<rect x="${round(x)}" y="${round(y)}" width="${round(Math.max(0, width))}" height="${round(Math.max(0, height))}" rx="${radius}" fill="${fill}"${opacity === void 0 ? "" : ` fill-opacity="${opacity}"`}/>`, "rect");
function frame(model, palette, description) {
  const title = model.title || "Chart";
  return [
    `<rect x="0.5" y="0.5" width="${WIDTH - 1}" height="${HEIGHT - 1}" rx="12" fill="${palette.background}" stroke="${palette.grid}"/>`,
    label(24, 38, title, { fill: palette.text, size: 18, weight: 600 }),
    ...model.unit ? [label(WIDTH - 24, 38, model.unit, { fill: palette.muted, size: 12, anchor: "end" })] : [],
    ...description ? [label(24, 58, description, { fill: palette.muted, size: 11 })] : []
  ];
}
__name(frame, "frame");
function seriesColor(palette, index) {
  return palette.series[index % palette.series.length];
}
__name(seriesColor, "seriesColor");
function barCard(series, palette, model) {
  const points = [...series[0]?.points ?? []].sort((left, right) => right.y - left.y).slice(0, 8);
  const maximum = points.reduce((most, point) => Math.max(most, Math.abs(point.y)), 0) || 1;
  const rowHeight = Math.min(26, (BOTTOM - TOP) / Math.max(1, points.length));
  const bars = [];
  points.forEach((point, index) => {
    const y = TOP + index * rowHeight;
    const width = (RIGHT - 70 - LEFT) * Math.abs(point.y) / maximum;
    bars.push(label(LEFT - 12, y + rowHeight * 0.68, point.x, { fill: palette.text, size: 12, anchor: "end" }));
    bars.push(rect(LEFT, y + 4, width, Math.max(6, rowHeight - 10), seriesColor(palette, index), 3));
    bars.push(label(RIGHT - 4, y + rowHeight * 0.68, String(point.y), { fill: palette.muted, size: 11, anchor: "end", mono: true }));
  });
  return [...frame(model, palette, `${points.length} categories`), ...bars];
}
__name(barCard, "barCard");
function lineCard(series, palette, model, area) {
  const values = series.flatMap((entry) => entry.points.map((point) => point.y));
  const minimum = Math.min(...values);
  const maximum = Math.max(...values);
  const body = [];
  for (let tick = 0; tick <= 2; tick++) {
    const value = minimum + (maximum - minimum) * (2 - tick) / 2;
    const y = TOP + (BOTTOM - TOP) * tick / 2;
    body.push(line(LEFT, y, RIGHT, y, palette.grid, 1));
    body.push(label(LEFT - 10, y + 4, String(round(value)), { fill: palette.muted, size: 11, anchor: "end", mono: true }));
  }
  series.forEach((entry, index) => {
    const color = seriesColor(palette, index);
    const count = entry.points.length;
    const points = entry.points.map((point, position) => {
      const x = span(position, 0, Math.max(1, count - 1), LEFT, RIGHT);
      const y = span(point.y, minimum, maximum, BOTTOM, TOP);
      return `${round(x)},${round(y)}`;
    });
    if (area && points.length) {
      body.push(`<path d="M ${LEFT},${BOTTOM} L ${points.join(" L ")} L ${RIGHT},${BOTTOM} Z" fill="${color}" fill-opacity="0.16" stroke="none"/>`);
    }
    if (points.length > 1) body.push(`<polyline points="${points.join(" ")}" fill="none" stroke="${color}" stroke-width="2.25" stroke-linejoin="round" stroke-linecap="round"/>`);
    const last2 = points[points.length - 1];
    if (last2) {
      const [x, y] = last2.split(",");
      body.push(`<circle cx="${x}" cy="${y}" r="3.2" fill="${color}"/>`);
    }
  });
  const legend = [];
  series.slice(0, 5).forEach((entry, index) => {
    const x = LEFT + index * 118;
    legend.push(`<circle cx="${x}" cy="${TOP - 16}" r="3.2" fill="${seriesColor(palette, index)}"/>`);
    legend.push(label(x + 9, TOP - 12, entry.name, { fill: palette.muted, size: 11 }));
  });
  const first = series[0]?.points[0]?.x ?? "";
  const last = series[0]?.points[series[0].points.length - 1]?.x ?? "";
  return [
    ...frame(model, palette, `${series.length} series`),
    ...body,
    ...legend,
    label(LEFT, BOTTOM + 24, first, { fill: palette.muted, size: 11 }),
    label(RIGHT, BOTTOM + 24, last, { fill: palette.muted, size: 11, anchor: "end" })
  ];
}
__name(lineCard, "lineCard");
function scatterCard(series, palette, model) {
  const values = series.flatMap((entry) => entry.points.map((point) => point.y));
  const minimum = Math.min(...values);
  const maximum = Math.max(...values);
  const body = [line(LEFT, BOTTOM, RIGHT, BOTTOM, palette.grid), line(LEFT, TOP, LEFT, BOTTOM, palette.grid)];
  series.forEach((entry, index) => {
    const count = entry.points.length;
    entry.points.forEach((point, position) => {
      const x = span(position, 0, Math.max(1, count - 1), LEFT, RIGHT);
      const y = span(point.y, minimum, maximum, BOTTOM, TOP);
      body.push(`<circle cx="${round(x)}" cy="${round(y)}" r="2.8" fill="${seriesColor(palette, index)}" fill-opacity="0.85"/>`);
    });
  });
  return [...frame(model, palette, `${values.length} points`), ...body, label(LEFT, BOTTOM + 24, String(round(minimum)), { fill: palette.muted, size: 11 }), label(RIGHT, BOTTOM + 24, String(round(maximum)), { fill: palette.muted, size: 11, anchor: "end" })];
}
__name(scatterCard, "scatterCard");
function arc(cx, cy, radius, from, to) {
  const start = { x: cx + radius * Math.cos(from), y: cy + radius * Math.sin(from) };
  const end = { x: cx + radius * Math.cos(to), y: cy + radius * Math.sin(to) };
  const large = to - from > Math.PI ? 1 : 0;
  return `M ${round(start.x)} ${round(start.y)} A ${radius} ${radius} 0 ${large} 1 ${round(end.x)} ${round(end.y)}`;
}
__name(arc, "arc");
function sweepArc(cx, cy, radius, from, to) {
  const end = { x: cx + radius * Math.cos(to), y: cy + radius * Math.sin(to) };
  const large = to - from > Math.PI ? 1 : 0;
  return `A ${radius} ${radius} 0 ${large} 1 ${round(end.x)} ${round(end.y)}`;
}
__name(sweepArc, "sweepArc");
function pieCard(series, palette, model, donut) {
  const points = series[0]?.points ?? [];
  const total = points.reduce((sum, point) => sum + Math.max(0, point.y), 0) || 1;
  const cx = 210;
  const cy = 166;
  const radius = donut ? 82 : 92;
  const body = [];
  let angle = -Math.PI / 2;
  points.forEach((point, index) => {
    const sweep = Math.max(0, point.y) / total * Math.PI * 2;
    const color = seriesColor(palette, index);
    if (sweep > 0) {
      body.push(
        donut ? `<path d="${arc(cx, cy, radius, angle, angle + sweep)}" fill="none" stroke="${color}" stroke-width="30" stroke-linecap="butt"/>` : `<path d="M ${cx} ${cy} L ${round(cx + radius * Math.cos(angle))} ${round(cy + radius * Math.sin(angle))} ${sweepArc(cx, cy, radius, angle, angle + sweep)} Z" fill="${color}"/>`
      );
    }
    angle += sweep;
  });
  if (donut) body.push(label(cx, cy + 2, String(round(total)), { fill: palette.text, size: 22, anchor: "middle", weight: 600 }), label(cx, cy + 20, model.unit || "total", { fill: palette.muted, size: 11, anchor: "middle" }));
  points.slice(0, 6).forEach((point, index) => {
    const y = TOP + index * 26;
    body.push(rect(390, y - 9, 10, 10, seriesColor(palette, index), 2));
    body.push(label(410, y, point.x, { fill: palette.text, size: 12 }));
    body.push(label(WIDTH - 24, y, `${Math.round(Math.max(0, point.y) / total * 100)}%`, { fill: palette.muted, size: 12, anchor: "end", mono: true }));
  });
  return [...frame(model, palette, `${points.length} slices`), ...body];
}
__name(pieCard, "pieCard");
function sparkCard(series, palette, model) {
  const values = series[0]?.points.map((point) => point.y) ?? [];
  const minimum = Math.min(...values);
  const maximum = Math.max(...values);
  const points = values.map((value, index) => {
    const x = span(index, 0, Math.max(1, values.length - 1), LEFT, RIGHT);
    const y = span(value, minimum, maximum, BOTTOM, TOP);
    return `${round(x)},${round(y)}`;
  });
  const body = points.length > 1 ? [`<polyline points="${points.join(" ")}" fill="none" stroke="${seriesColor(palette, 0)}" stroke-width="2.5" stroke-linejoin="round"/>`] : [];
  return [...frame(model, palette, `${values.length} points`), ...body, label(LEFT, BOTTOM + 24, `min ${round(minimum)}`, { fill: palette.muted, size: 11 }), label(RIGHT, BOTTOM + 24, `last ${round(values[values.length - 1] ?? 0)}`, { fill: palette.muted, size: 11, anchor: "end" })];
}
__name(sparkCard, "sparkCard");
function kpiCard(series, palette, model) {
  const first = series[0]?.points[0];
  const value = first?.y ?? 0;
  return [
    ...frame(model, palette, "Latest value"),
    label(WIDTH / 2, 176, first?.x ?? model.title, { fill: palette.muted, size: 13, anchor: "middle" }),
    label(WIDTH / 2, 226, String(round(value)), { fill: palette.text, size: 58, anchor: "middle", weight: 650 }),
    label(WIDTH / 2, 250, model.unit, { fill: palette.muted, size: 12, anchor: "middle" })
  ];
}
__name(kpiCard, "kpiCard");
function tableCard(columns, rows, palette, model) {
  const shown = rows.slice(0, 6);
  const columnWidth = (RIGHT - LEFT) / Math.max(1, columns.length);
  const body = [];
  columns.forEach((column, index) => {
    body.push(label(LEFT + index * columnWidth, TOP, column, { fill: palette.muted, size: 11 }));
  });
  body.push(line(LEFT, TOP + 8, RIGHT, TOP + 8, palette.grid));
  shown.forEach((row, rowIndex) => {
    const y = TOP + 30 + rowIndex * 24;
    row.forEach((cell, index) => {
      if (Array.isArray(cell)) {
        const values = cell.map((value) => typeof value === "number" ? value : Number(value) || 0);
        const minimum = Math.min(...values);
        const maximum = Math.max(...values);
        const points = values.map((value, position) => `${round(LEFT + index * columnWidth + position / Math.max(1, values.length - 1) * (columnWidth - 24))},${round(y - 4 - span(value, minimum, maximum, 0, 14))}`);
        if (points.length > 1) body.push(`<polyline points="${points.join(" ")}" fill="none" stroke="${seriesColor(palette, index)}" stroke-width="1.6"/>`);
        return;
      }
      body.push(label(LEFT + index * columnWidth, y, String(cell ?? ""), { fill: palette.text, size: 12, mono: index > 0 }));
    });
  });
  return [...frame(model, palette, `${rows.length} rows`), ...body];
}
__name(tableCard, "tableCard");
function buildChartCardSvg(spec, options = {}) {
  const palette = paletteFor(options.mode ?? "dark", options.seed);
  const model = normalizeChart(spec);
  const raw = typeof spec.type === "string" ? spec.type.toLowerCase() : "";
  const kpi = raw === "kpi" || raw === "metric";
  let body;
  if (spec.columns?.length || model.type === "table") {
    if (!model.columns.length || !model.rows.length) return void 0;
    body = tableCard(model.columns, model.rows, palette, model);
  } else if (kpi) {
    if (!model.series.length) return void 0;
    body = kpiCard(model.series, palette, model);
  } else if (model.type === "pie" || model.type === "donut") {
    if (!model.series.length) return void 0;
    body = pieCard(model.series, palette, model, model.type === "donut");
  } else if (model.type === "sparkline") {
    if (!model.series.length) return void 0;
    body = sparkCard(model.series, palette, model);
  } else if (model.type === "scatter") {
    if (!model.series.length) return void 0;
    body = scatterCard(model.series, palette, model);
  } else if (model.type === "line" || model.type === "multi_line" || model.type === "area") {
    if (!model.series.length) return void 0;
    body = lineCard(model.series, palette, model, model.type === "area");
  } else {
    if (!model.series.length) return void 0;
    body = barCard(model.series, palette, model);
  }
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${WIDTH} ${HEIGHT}" width="${WIDTH}" height="${HEIGHT}" role="img" aria-label="${escapeXml(model.title || "Chart")}">`,
    `<title>${escapeXml(model.title || "Chart")}</title>`,
    ...body,
    `</svg>`
  ].join("");
}
__name(buildChartCardSvg, "buildChartCardSvg");
function buildChartCard(code, options = {}) {
  const spec = parseChartFence(code);
  if (!spec) return void 0;
  const svg = buildChartCardSvg(spec, options);
  if (!svg) return void 0;
  const model = normalizeChart(spec);
  const raw = typeof spec.type === "string" ? spec.type.toLowerCase() : "";
  const kind = raw === "kpi" || raw === "metric" ? "kpi" : model.type;
  return { svg, kind, title: model.title || "Chart" };
}
__name(buildChartCard, "buildChartCard");
function chartCardElement(card) {
  return (0, import_h.default)("div", { class: "charts-card", "data-charts-kind": card.kind, "data-charts-title": card.title, innerHTML: card.svg });
}
__name(chartCardElement, "chartCardElement");
var pushedGuiThemes = /* @__PURE__ */ new WeakMap();
function hostDocument() {
  try {
    return globalThis.document;
  } catch {
    return void 0;
  }
}
__name(hostDocument, "hostDocument");
function readGuiThemeSeed(doc, mode) {
  try {
    return extractDomThemeSeed(doc, mode);
  } catch {
    return void 0;
  }
}
__name(readGuiThemeSeed, "readGuiThemeSeed");
function syncGuiTheme(client, doc, mode) {
  const seed = readGuiThemeSeed(doc, mode);
  if (!seed) return Promise.resolve(false);
  const key = typeof client === "object" && client !== null ? client : void 0;
  if (key && pushedGuiThemes.get(key) === seed.revision) return Promise.resolve(false);
  const { revision } = seed;
  const rpc = client?.rpc;
  if (typeof rpc !== "function") return Promise.resolve(false);
  try {
    const bridge = rpc.call(client, ChartsThemeContract);
    if (!bridge || typeof bridge.sync !== "function") return Promise.resolve(false);
    const call = bridge.sync({ mode: seed.mode, theme: { seed: seed.seed }, revision });
    return Promise.resolve(call).then(
      (result) => {
        const answer = result;
        if (answer?.applied !== true && answer?.ok !== true) return false;
        if (key) pushedGuiThemes.set(key, revision);
        return true;
      },
      () => false
    );
  } catch {
    return Promise.resolve(false);
  }
}
__name(syncGuiTheme, "syncGuiTheme");
function hostMode(ctx) {
  try {
    const appearance = ctx.appearance;
    const value = typeof appearance?.mode === "function" ? appearance.mode() : void 0;
    return value === "light" ? "light" : "dark";
  } catch {
    return "dark";
  }
}
__name(hostMode, "hostMode");
function setupGui(ctx) {
  const [prefs, setPrefs] = ctx.storage.memory("charts.gui", { initial: { mode: hostMode(ctx) } });
  const mode = /* @__PURE__ */ __name(() => prefs.mode, "mode");
  const seed = /* @__PURE__ */ __name(() => readGuiThemeSeed(hostDocument(), mode())?.seed, "seed");
  const add = /* @__PURE__ */ __name((register) => {
    try {
      register();
    } catch {
    }
  }, "add");
  add(
    () => ctx.add(CodeBlock, {
      id: "chart",
      languages: chartLanguages,
      render: /* @__PURE__ */ __name(({ code }) => {
        const card = buildChartCard(code, { mode: mode(), seed: seed() });
        return card ? chartCardElement(card) : void 0;
      }, "render")
    })
  );
  add(
    () => ctx.add(CodeBlockAction, {
      id: "copy-json",
      languages: chartLanguages,
      title: "Copy chart JSON",
      run: /* @__PURE__ */ __name(({ code }) => ctx.system.copy(code), "run")
    })
  );
  ctx.add(import_gui.Command, {
    id: "toggleTheme",
    title: "Charts: Toggle card theme",
    description: "Switch chart cards between the light and dark palette",
    group: "Charts",
    run: /* @__PURE__ */ __name(() => setPrefs((draft) => {
      draft.mode = draft.mode === "dark" ? "light" : "dark";
    }), "run")
  });
  ctx.add(import_gui.Command, {
    id: "openStatus",
    title: "Charts: Card status",
    description: "The fence languages chart cards answer to",
    group: "Charts",
    run: /* @__PURE__ */ __name(() => {
      const languages = [...new Set(ctx.list(CodeBlock).flatMap((block) => block.languages))];
      const blocks = ctx.list(CodeBlock).length;
      ctx.toast.show({ title: "Charts", description: `${blocks} code block(s): ${languages.join(", ") || "none"}.` });
    }, "run")
  });
  try {
    void syncGuiTheme(ctx.client, hostDocument(), mode());
  } catch {
  }
}
__name(setupGui, "setupGui");
var gui_default = import_gui.Plugin.define({ setup: setupGui });
