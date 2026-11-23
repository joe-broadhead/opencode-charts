var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// src/tui.ts
import { Plugin } from "@opencode/plugin/tui";
import { TextRenderable } from "@opentui/core";
import { createSignal } from "solid-js";

// src/errors.ts
function formatFailure(code, what, next) {
  return `${code}: ${what.trimEnd()} Next step: ${next}`;
}
__name(formatFailure, "formatFailure");

// src/constants.ts
var PLUGIN_ID = "charts";

// src/status-rpc.ts
import { Rpc } from "@opencode/plugin/rpc";
var string = { type: "string" };
var ChartsStatus = Rpc.define({
  id: PLUGIN_ID,
  methods: {
    status: {
      input: { type: "object" },
      output: {
        type: "object",
        required: ["version", "host", "state", "unguardedAgents", "nextStep", "text"],
        properties: {
          version: string,
          host: {
            type: "object",
            required: ["version", "range", "tested"],
            properties: { version: { type: ["string", "null"] }, range: string, tested: { type: "boolean" }, supported: { type: "boolean" } }
          },
          state: { enum: ["ready", "failed"] },
          unguardedAgents: { type: "array", items: string },
          nextStep: string,
          /** The report as `/charts-status` prints it, so the dialog needs no copy of the status model. */
          text: string,
          png: { type: ["string", "null"] },
          html: { type: ["string", "null"] },
          defaults: { type: "object" },
          themes: { type: "object" },
          tools: { type: "object" },
          skills: { type: "object" }
        }
      },
      errors: { unavailable: { type: "object", properties: { nextStep: string }, required: ["nextStep"] } }
    }
  },
  events: {}
});

// src/theme-contract.ts
import { Rpc as Rpc2 } from "@opencode/plugin/rpc";
var THEME_RPC_ID = "charts.theme";
var string2 = { type: "string" };
var boolean = { type: "boolean" };
var modeSchema = { enum: ["light", "dark"] };
var themeValue = { type: ["string", "object"] };
var refusalSchema = { type: "object", required: ["code", "next"], properties: { code: string2, next: string2 }, additionalProperties: false };
var ChartsThemeContract = Rpc2.define({
  id: THEME_RPC_ID,
  methods: {
    sync: {
      input: {
        type: "object",
        required: ["theme"],
        properties: { sessionID: string2, mode: modeSchema, theme: themeValue, revision: string2 },
        additionalProperties: false
      },
      output: {
        type: "object",
        required: ["ok", "applied", "revision", "mode", "themeName"],
        properties: { ok: boolean, applied: boolean, revision: string2, mode: modeSchema, themeName: string2 },
        additionalProperties: false
      },
      errors: { refused: refusalSchema }
    },
    get: {
      input: { type: "object", properties: { sessionID: string2 }, additionalProperties: false },
      output: {
        type: "object",
        required: ["found", "revision", "theme"],
        properties: {
          found: boolean,
          revision: { type: ["string", "null"] },
          mode: modeSchema,
          themeName: string2,
          theme: {
            type: ["object", "null"],
            required: ["theme", "mode", "revision"],
            properties: { theme: themeValue, mode: modeSchema, revision: string2, sessionID: string2 },
            additionalProperties: false
          }
        },
        additionalProperties: false
      }
    },
    clear: {
      input: { type: "object", properties: { sessionID: string2 }, additionalProperties: false },
      output: { type: "object", required: ["cleared"], properties: { cleared: boolean }, additionalProperties: false }
    }
  },
  events: {
    /** The theme in force changed: the same revision a `sync` returned, so a viewer can ignore its own echo. */
    changed: {
      schema: {
        type: "object",
        required: ["revision", "mode", "themeName"],
        properties: { revision: string2, mode: modeSchema, themeName: string2, sessionID: string2 },
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
function member(value, ...path) {
  let cursor = value;
  for (const key of path) {
    if (!isRecord(cursor)) return void 0;
    cursor = cursor[key];
  }
  return cursor;
}
__name(member, "member");
function hueStep(value) {
  return toHexColor(member(value, "600")) ?? toHexColor(member(value, "500")) ?? toHexColor(member(value, "400")) ?? toHexColor(member(value, "base"));
}
__name(hueStep, "hueStep");
function extractTuiThemeSeed(theme, mode) {
  if (!isRecord(theme)) return void 0;
  const categorical = Array.isArray(theme.categorical) ? theme.categorical : [];
  const series = categorical.map((entry) => hueStep(entry)).filter((color) => typeof color === "string").slice(0, 6);
  const tokens = {
    background: toHexColor(member(theme, "background", "base")),
    surface: toHexColor(member(theme, "background", "raised", "base")),
    text: toHexColor(member(theme, "text", "base")),
    muted: toHexColor(member(theme, "text", "muted")),
    border: toHexColor(member(theme, "border", "base")),
    accent: hueStep(member(theme, "hue", "accent")) ?? hueStep(member(theme, "hue", "interactive")) ?? series[0],
    series
  };
  return seedResult(tokens, mode);
}
__name(extractTuiThemeSeed, "extractTuiThemeSeed");
var ANSI_SERIES = { 31: 5, 32: 3, 33: 2, 34: 4, 35: 1, 36: 0, 95: 7, 96: 6 };
function applyTuiAnsiTheme(text, seed) {
  if (!text.includes("\x1B[")) return text;
  const series = Array.isArray(seed.series) ? seed.series.filter((color) => typeof color === "string") : [];
  const accent = typeof seed.accent === "string" ? seed.accent : void 0;
  const repaint = /* @__PURE__ */ __name((code) => {
    const index = ANSI_SERIES[code];
    if (index === void 0) return void 0;
    const hex = series[index] ?? accent;
    if (!hex) return void 0;
    const red = Number.parseInt(hex.slice(1, 3), 16);
    const green = Number.parseInt(hex.slice(3, 5), 16);
    const blue = Number.parseInt(hex.slice(5, 7), 16);
    if (![red, green, blue].every(Number.isFinite)) return void 0;
    return `\x1B[38;2;${red};${green};${blue}m`;
  }, "repaint");
  return text.replace(/\u001b\[(\d+)m/g, (match, digits) => repaint(Number(digits)) ?? match);
}
__name(applyTuiAnsiTheme, "applyTuiAnsiTheme");

// src/tui-chart.ts
var RESET = "\x1B[0m";
var STYLES = { bold: "\x1B[1m", dim: "\x1B[2m" };
var COLORS = [36, 35, 33, 32, 34, 31, 96, 95];
var EIGHTHS = ["", "\u258F", "\u258E", "\u258D", "\u258C", "\u258B", "\u258A", "\u2589"];
var SPARK = ["\u2581", "\u2582", "\u2583", "\u2584", "\u2585", "\u2586", "\u2587", "\u2588"];
var SHADES = ["\u2588", "\u2593", "\u2592", "\u2591", "\u2599", "\u259A", "\u259E", "\u259B"];
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
function formatCompact(value) {
  const abs = Math.abs(value);
  const units = [
    [1e12, "T"],
    [1e9, "B"],
    [1e6, "M"],
    [1e3, "k"]
  ];
  for (const [size, suffix] of units) {
    if (abs >= size) return `${trimNumber(value / size)}${suffix}`;
  }
  return trimNumber(value);
}
__name(formatCompact, "formatCompact");
function trimNumber(value) {
  const rounded = Math.round(value * 100) / 100;
  if (Object.is(rounded, -0)) return "0";
  return String(rounded);
}
__name(trimNumber, "trimNumber");
var clip = /* @__PURE__ */ __name((text, width) => {
  if (width <= 0) return "";
  const chars = Array.from(text);
  if (chars.length <= width) return text;
  if (width === 1) return "\u2026";
  return `${chars.slice(0, width - 1).join("")}\u2026`;
}, "clip");
var pad = /* @__PURE__ */ __name((text, width, side = "end") => {
  const clipped = clip(text, width);
  const fill = " ".repeat(Math.max(0, width - clipped.length));
  return side === "start" ? `${fill}${clipped}` : `${clipped}${fill}`;
}, "pad");
var stripAnsi = /* @__PURE__ */ __name((text) => text.replace(/\u001b\[[0-9;]*m/g, ""), "stripAnsi");
var paint = /* @__PURE__ */ __name((text, style, ansi) => {
  if (!ansi) return text;
  const code = typeof style === "number" ? `\x1B[${style}m` : STYLES[style];
  return `${code}${text}${RESET}`;
}, "paint");
var textWidth = /* @__PURE__ */ __name((text) => stripAnsi(text).length, "textWidth");
var LEFT_BITS = [1, 2, 4, 64];
var RIGHT_BITS = [8, 16, 32, 128];
var BrailleCanvas = class {
  static {
    __name(this, "BrailleCanvas");
  }
  columns;
  rows;
  pixelWidth;
  pixelHeight;
  bits;
  marks;
  constructor(columns, rows) {
    this.columns = Math.max(1, Math.floor(columns));
    this.rows = Math.max(1, Math.floor(rows));
    this.pixelWidth = this.columns * 2;
    this.pixelHeight = this.rows * 4;
    this.bits = new Uint8Array(this.columns * this.rows);
    this.marks = new Int16Array(this.columns * this.rows).fill(-1);
  }
  /** Lights one dot. Out-of-range coordinates are ignored. */
  set(x, y, color = 0) {
    const px = Math.round(x);
    const py = Math.round(y);
    if (px < 0 || py < 0 || px >= this.pixelWidth || py >= this.pixelHeight) return this;
    const cell = (py >> 2) * this.columns + (px >> 1);
    const bit = px & 1 ? RIGHT_BITS[py & 3] : LEFT_BITS[py & 3];
    this.bits[cell] = this.bits[cell] | bit;
    if (this.marks[cell] < 0) this.marks[cell] = color;
    return this;
  }
  /** Lights one dot; an alias that reads better for scatter points. */
  dot(x, y, color = 0) {
    return this.set(x, y, color);
  }
  /** A straight line between two pixel positions. */
  line(x0, y0, x1, y1, color = 0) {
    let x = Math.round(x0);
    let y = Math.round(y0);
    const endX = Math.round(x1);
    const endY = Math.round(y1);
    const dx = Math.abs(endX - x);
    const dy = -Math.abs(endY - y);
    const stepX = x < endX ? 1 : -1;
    const stepY = y < endY ? 1 : -1;
    let error = dx + dy;
    for (; ; ) {
      this.set(x, y, color);
      if (x === endX && y === endY) break;
      const twice = error * 2;
      if (twice >= dy) {
        error += dy;
        x += stepX;
      }
      if (twice <= dx) {
        error += dx;
        y += stepY;
      }
    }
    return this;
  }
  /** Fills the pixels of one column from a dot down to the baseline. */
  fillDown(x, fromY, color = 0) {
    const px = Math.round(x);
    const top = Math.max(0, Math.min(this.pixelHeight - 1, Math.round(fromY)));
    for (let y = top; y < this.pixelHeight; y++) this.set(px, y, color);
    return this;
  }
  /** The character of one cell, or a space while it has no dots. */
  charAt(column, row) {
    if (column < 0 || row < 0 || column >= this.columns || row >= this.rows) return " ";
    const bits = this.bits[row * this.columns + column];
    return bits === 0 ? " " : String.fromCharCode(10240 + bits);
  }
  /** The colour index of one cell; -1 for a cell with no dots. */
  colorAt(column, row) {
    if (column < 0 || row < 0 || column >= this.columns || row >= this.rows) return -1;
    return this.marks[row * this.columns + column];
  }
  /** Every row as text and, per cell, its colour index; the row's characters are single width. */
  lines() {
    const out = [];
    for (let row = 0; row < this.rows; row++) {
      let text = "";
      const colors = [];
      for (let column = 0; column < this.columns; column++) {
        text += this.charAt(column, row);
        colors.push(this.colorAt(column, row));
      }
      out.push({ text, colors });
    }
    return out;
  }
  toString() {
    return this.lines().map((line) => line.text).join("\n");
  }
};
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
  const label = /* @__PURE__ */ __name((row, index) => {
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
      points.push({ x: label(row, index), y: toNumber(row[field]) ?? 0 });
      groups.set(name, points);
    });
    return [...groups].map(([name, points]) => ({ name, points }));
  }
  return yFields.map((field) => ({
    name: yFields.length > 1 ? field : seriesName(input) ?? field,
    points: objects.map((row, index) => ({ x: label(row, index), y: toNumber(row[field]) ?? 0 }))
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
var colorOf = /* @__PURE__ */ __name((index) => COLORS[index % COLORS.length], "colorOf");
function headerLines(model, width, ansi) {
  const lines = [];
  if (model.title) lines.push(paint(clip(model.title, width), "bold", ansi));
  if (model.unit) lines.push(paint(clip(`Unit: ${model.unit}`, width), "dim", ansi));
  return lines;
}
__name(headerLines, "headerLines");
function blockBar(value, maximum, cells) {
  const ratio = maximum === 0 ? 0 : Math.min(1, Math.abs(value) / maximum);
  const eighths = Math.round(ratio * cells * 8);
  const full = Math.floor(eighths / 8);
  const rest = eighths % 8;
  return `${"\u2588".repeat(full)}${EIGHTHS[rest]}`;
}
__name(blockBar, "blockBar");
function renderBars(model, width, height, ansi) {
  const points = [...model.series[0]?.points ?? []].sort((left, right) => right.y - left.y);
  const lines = headerLines(model, width, ansi);
  if (!points.length) return [...lines, paint("No data", "dim", ansi)];
  const maximum = points.reduce((most, point) => Math.max(most, Math.abs(point.y)), 0);
  const values = points.map((point) => formatCompact(point.y));
  const valueWidth = values.reduce((most, value) => Math.max(most, value.length), 1);
  const labelWidth = Math.min(24, Math.max(3, points.reduce((most, point) => Math.max(most, point.x.length), 3)));
  const barWidth = Math.max(1, width - labelWidth - valueWidth - 3);
  const room = Math.max(0, height - lines.length);
  const shown = points.length > room ? points.slice(0, Math.max(0, room - 1)) : points;
  shown.forEach((point, index) => {
    const bar = paint(pad(blockBar(point.y, maximum, barWidth), barWidth), colorOf(index), ansi);
    lines.push(`${pad(point.x, labelWidth)} ${bar} ${pad(values[index], valueWidth, "start")}`);
  });
  const hidden = points.length - shown.length;
  if (hidden > 0) lines.push(paint(clip(`\u2026 ${hidden} more`, width), "dim", ansi));
  return lines;
}
__name(renderBars, "renderBars");
function xLabels(plotWidth, labels) {
  const left = clip(labels[0] ?? "", plotWidth);
  const right = clip(labels[labels.length - 1] ?? "", plotWidth);
  const cells = Array.from(" ".repeat(plotWidth));
  const place = /* @__PURE__ */ __name((text, at) => {
    Array.from(text).forEach((character, index) => {
      const position = at + index;
      if (position >= 0 && position < cells.length) cells[position] = character;
    });
  }, "place");
  if (labels.length < 3 || plotWidth < 12) {
    place(left, 0);
    if (right !== left) place(right, plotWidth - right.length);
    return cells.join("");
  }
  const middle = clip(labels[1] ?? "", plotWidth);
  const middleAt = Math.max(0, Math.floor((plotWidth - middle.length) / 2));
  place(left, 0);
  if (middleAt >= left.length + 1 && middleAt + middle.length <= plotWidth - right.length - 1) place(middle, middleAt);
  place(right, plotWidth - right.length);
  return cells.join("");
}
__name(xLabels, "xLabels");
function legendLine(series, width, ansi) {
  let plain = "";
  let painted = "";
  series.forEach((entry, index) => {
    const name = clip(entry.name, 18);
    const plainPiece = `${plain ? "  " : ""}\u25CF ${name}`;
    if (plain.length + plainPiece.length > width) {
      if (!plain) painted = clip(plainPiece, width);
      return;
    }
    plain += plainPiece;
    painted += `${painted ? "  " : ""}${paint("\u25CF", colorOf(index), ansi)} ${name}`;
  });
  return painted;
}
__name(legendLine, "legendLine");
function renderBrailleChart(model, width, height, ansi) {
  const series = model.series;
  if (!series.length) return [...headerLines(model, width, ansi), paint("No data", "dim", ansi)];
  const all = series.flatMap((entry) => entry.points.map((point) => point.y));
  let minimum = Math.min(...all);
  let maximum = Math.max(...all);
  if (minimum === maximum) {
    minimum -= 1;
    maximum += 1;
  }
  const middle = (minimum + maximum) / 2;
  const ticks = [maximum, middle, minimum].map((value) => formatCompact(value));
  const tickWidth = ticks.reduce((most, tick) => Math.max(most, tick.length), 1);
  const plotWidth = Math.max(4, width - tickWidth - 2);
  const legend = series.length > 0;
  const plotRows = Math.max(2, height - 2 - (legend ? 1 : 0));
  const canvas = new BrailleCanvas(plotWidth, plotRows);
  const pixelsWide = canvas.pixelWidth;
  const pixelsHigh = canvas.pixelHeight;
  const yOf = /* @__PURE__ */ __name((value) => Math.round((maximum - value) / (maximum - minimum) * (pixelsHigh - 1)), "yOf");
  const scatter = model.type === "scatter";
  series.forEach((entry, index) => {
    const count = entry.points.length;
    const xOf = /* @__PURE__ */ __name((position) => count <= 1 ? 0 : Math.round(position / (count - 1) * (pixelsWide - 1)), "xOf");
    if (model.type === "area") {
      for (let position = 0; position < count; position++) {
        const point = entry.points[position];
        const next = entry.points[position + 1];
        const fromX = xOf(position);
        const fromY = yOf(point.y);
        if (!next) {
          canvas.fillDown(fromX, fromY, index);
          continue;
        }
        const toX = xOf(position + 1);
        const toY = yOf(next.y);
        for (let x = fromX; x < toX; x++) {
          const ratio = toX === fromX ? 0 : (x - fromX) / (toX - fromX);
          canvas.fillDown(x, Math.round(fromY + (toY - fromY) * ratio), index);
        }
      }
    }
    entry.points.forEach((point, position) => {
      const x = xOf(position);
      const y = yOf(point.y);
      if (scatter) canvas.set(x, y, index);
      else if (position > 0) {
        const previous = entry.points[position - 1];
        canvas.line(xOf(position - 1), yOf(previous.y), x, y, index);
      } else canvas.set(x, y, index);
    });
  });
  const lines = headerLines(model, width, ansi);
  const rows = canvas.lines();
  const tickRows = /* @__PURE__ */ new Map([
    [0, ticks[0]],
    [Math.floor((plotRows - 1) / 2), ticks[1]],
    [plotRows - 1, ticks[2]]
  ]);
  rows.forEach((row, index) => {
    let body = "";
    row.text.split("").forEach((character, column) => {
      const color = row.colors[column] ?? -1;
      body += character === " " || color < 0 ? character : paint(character, colorOf(color), ansi);
    });
    const tick = tickRows.get(index);
    const axis = index === plotRows - 1 ? "\u2514" : "\u2524";
    lines.push(`${pad(tick ?? "", tickWidth)} ${axis}${body}`);
  });
  const first = series[0].points;
  const last = series.reduce((longest, entry) => entry.points.length > longest.points.length ? entry : longest, series[0]).points;
  const labels = scatter ? [first[0]?.x ?? "", first[Math.floor((first.length - 1) / 2)]?.x ?? "", last[last.length - 1]?.x ?? ""] : [first[0]?.x ?? "", last[last.length - 1]?.x ?? ""];
  lines.push(`${" ".repeat(tickWidth + 1)} ${xLabels(plotWidth, labels)}`);
  if (legend) lines.push(legendLine(series, width, ansi));
  return lines;
}
__name(renderBrailleChart, "renderBrailleChart");
function renderSparkline(model, width, height, ansi) {
  const points = model.series[0]?.points ?? [];
  const lines = headerLines(model, width, ansi);
  if (!points.length) return [...lines, paint("No data", "dim", ansi)];
  const values = points.map((point) => point.y);
  const minimum = Math.min(...values);
  const maximum = Math.max(...values);
  const span = maximum - minimum;
  const room = Math.max(1, Math.min(width, points.length));
  const taken = points.slice(points.length - room);
  const spark = taken.map((point) => {
    const level = span === 0 ? 0 : Math.round((point.y - minimum) / span * (SPARK.length - 1));
    return paint(SPARK[Math.max(0, Math.min(SPARK.length - 1, level))], colorOf(0), ansi);
  }).join("");
  lines.push(spark);
  const lastValue = values[values.length - 1];
  lines.push(paint(clip(`min ${formatCompact(minimum)} \xB7 last ${formatCompact(lastValue)} \xB7 max ${formatCompact(maximum)}`, width), "dim", ansi));
  return lines;
}
__name(renderSparkline, "renderSparkline");
function renderPie(model, width, height, ansi) {
  const points = model.series[0]?.points ?? [];
  const lines = headerLines(model, width, ansi);
  if (!points.length) return [...lines, paint("No data", "dim", ansi)];
  const positive = points.map((point) => ({ ...point, y: Math.max(0, point.y) }));
  const total = positive.reduce((sum, point) => sum + point.y, 0);
  const stripWidth = Math.max(1, Math.min(width, 72));
  const shares = positive.map((point) => total === 0 ? 0 : point.y / total);
  let filled = 0;
  let strip = "";
  shares.forEach((share, index) => {
    const end = Math.round(shares.slice(0, index + 1).reduce((sum, part) => sum + part, 0) * stripWidth);
    const cells = Math.max(0, end - filled);
    filled += cells;
    strip += paint(SHADES[index % SHADES.length].repeat(cells), colorOf(index), ansi);
  });
  strip += " ".repeat(Math.max(0, stripWidth - filled));
  lines.push(strip);
  const entries = points.map((point, index) => {
    const percent = total === 0 ? 0 : Math.round(Math.max(0, point.y) / total * 100);
    return { plain: `${SHADES[index % SHADES.length]} ${point.x} ${percent}%`, painted: `${paint(SHADES[index % SHADES.length], colorOf(index), ansi)} ${point.x} ${percent}%` };
  });
  let plain = "";
  let painted = "";
  for (const entry of entries) {
    const piece = `${plain ? " \xB7 " : ""}${entry.plain}`;
    if (plain.length + piece.length > width) {
      if (!plain) painted = clip(entry.plain, width);
      break;
    }
    plain += piece;
    painted += `${painted ? " \xB7 " : ""}${entry.painted}`;
  }
  lines.push(painted);
  if (model.type === "donut") lines.push(paint(clip(`total ${formatCompact(total)}`, width), "dim", ansi));
  if (lines.length > height) return lines.slice(0, Math.max(1, height));
  return lines;
}
__name(renderPie, "renderPie");
function cellText(value, width) {
  if (Array.isArray(value)) {
    const values = value.map((item) => toNumber(item) ?? 0);
    const minimum = Math.min(...values);
    const maximum = Math.max(...values);
    const span = maximum - minimum;
    const spark = values.slice(0, Math.max(1, width)).map((item) => SPARK[span === 0 ? 0 : Math.max(0, Math.min(SPARK.length - 1, Math.round((item - minimum) / span * (SPARK.length - 1))))]).join("");
    return { text: spark, numeric: false };
  }
  if (typeof value === "number") return { text: formatCompact(value), numeric: true };
  if (value === null || value === void 0) return { text: "", numeric: false };
  return { text: String(value), numeric: false };
}
__name(cellText, "cellText");
function renderTable(model, width, height, ansi) {
  const lines = headerLines(model, width, ansi);
  const columns = model.columns;
  if (!columns.length) return [...lines, paint("No data", "dim", ansi)];
  const body = model.rows.map((row) => columns.map((_, index) => cellText(row[index], 16)));
  const widths = columns.map((column, index) => body.reduce((most, row) => Math.max(most, row[index].text.length), Math.max(column.length, 2)));
  const total = /* @__PURE__ */ __name(() => widths.reduce((sum, value) => sum + value, 0) + 3 * columns.length + 1, "total");
  while (total() > width) {
    let widest = -1;
    widths.forEach((value, index) => {
      if (value > 3 && (widest < 0 || value > widths[widest])) widest = index;
    });
    if (widest < 0) break;
    widths[widest] = widths[widest] - 1;
  }
  const border = /* @__PURE__ */ __name((left, middle, right) => `${left}${widths.map((value) => "\u2500".repeat(value + 2)).join(middle)}${right}`, "border");
  const rowLine = /* @__PURE__ */ __name((cells) => {
    const rendered = cells.map((cell, index) => pad(cell.text, widths[index], cell.numeric ? "start" : "end"));
    return `\u2502 ${rendered.join(" \u2502 ")} \u2502`;
  }, "rowLine");
  lines.push(clip(border("\u250C", "\u252C", "\u2510"), width));
  lines.push(clip(rowLine(columns.map((column) => ({ text: column, numeric: false }))), width));
  lines.push(clip(border("\u251C", "\u253C", "\u2524"), width));
  const room = Math.max(0, height - lines.length - 1);
  const shown = body.length > room ? body.slice(0, room) : body;
  for (const row of shown) lines.push(clip(rowLine(row), width));
  lines.push(clip(border("\u2514", "\u2534", "\u2518"), width));
  return lines;
}
__name(renderTable, "renderTable");
function renderTerminalChart(spec, options = {}) {
  const model = normalizeChart(spec);
  const width = Math.max(12, Math.min(140, Math.floor(options.width ?? spec.width ?? 64)));
  const ansi = options.ansi ?? spec.ansi ?? false;
  const fallbackHeight = model.type === "bar" || model.type === "horizontal_bar" ? 30 : model.type === "table" ? 24 : model.type === "sparkline" ? 4 : 14;
  const height = Math.max(3, Math.min(60, Math.floor(options.height ?? spec.height ?? fallbackHeight)));
  const lines = model.type === "table" ? renderTable(model, width, height, ansi) : model.type === "sparkline" ? renderSparkline(model, width, height, ansi) : model.type === "pie" || model.type === "donut" ? renderPie(model, width, height, ansi) : model.type === "line" || model.type === "multi_line" || model.type === "area" || model.type === "scatter" ? renderBrailleChart(model, width, height, ansi) : renderBars(model, width, height, ansi);
  return lines.map((line) => {
    if (textWidth(line) <= width) return line;
    return clip(stripAnsi(line), width);
  }).join("\n");
}
__name(renderTerminalChart, "renderTerminalChart");
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
function fnv1aHex(value) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}
__name(fnv1aHex, "fnv1aHex");
var STABLE_PREFIX = 64;
var ChartBlockCache = class _ChartBlockCache {
  static {
    __name(this, "ChartBlockCache");
  }
  limit;
  good = /* @__PURE__ */ new Map();
  constructor(limit = 16) {
    this.limit = Math.max(1, Math.floor(limit));
  }
  static key(code) {
    return `${code.length}:${fnv1aHex(code)}`;
  }
  /** The chart for this text now, or the last chart this block drew while the text was incomplete. */
  update(code, options = {}) {
    const key = _ChartBlockCache.key(code);
    const spec = parseChartFence(code);
    if (!spec) {
      const exact = this.good.get(key);
      if (exact) return exact.chart;
      if (code.length < STABLE_PREFIX) return void 0;
      for (const entry of [...this.good.values()].reverse()) if (entry.text.startsWith(code)) return entry.chart;
      return void 0;
    }
    const chart = renderTerminalChart(spec, options);
    this.good.delete(key);
    this.good.set(key, { text: code, chart });
    while (this.good.size > this.limit) {
      const oldest = this.good.keys().next();
      if (oldest.done) break;
      this.good.delete(oldest.value);
    }
    return chart;
  }
  /** Forgets every block's chart. */
  clear() {
    this.good.clear();
  }
  /** How many blocks have a chart remembered. */
  get size() {
    return this.good.size;
  }
};

// src/tui.ts
var TITLE = "Charts status";
var KEYS = "r refresh \xB7 esc close";
function viewMessage(result) {
  if ("status" in result) return `${result.status.text.split("\n").slice(1).join("\n")}

${KEYS}`;
  const { error } = result;
  const type = typeof error === "object" && error !== null && "type" in error ? error.type : void 0;
  if (type === "unavailable") {
    const { message, data } = error;
    if (typeof message === "string") return `${message}${typeof data?.nextStep === "string" ? ` Next step: ${data.nextStep}` : ""}

${KEYS}`;
  }
  if (type === "rpc.unavailable" || type === "rpc.method_not_found") {
    return `${formatFailure("STATUS_UNAVAILABLE", "The Charts plugin is not running on this OpenCode server.", "Run /plugins to see why it did not start.")}

${KEYS}`;
  }
  return `${formatFailure("STATUS_UNAVAILABLE", "Could not read Charts status.", "Restart OpenCode, then run /charts.")}

${KEYS}`;
}
__name(viewMessage, "viewMessage");
function chartBlockWidth(columns) {
  return Math.max(24, Math.min(88, Math.floor(columns) - 12));
}
__name(chartBlockWidth, "chartBlockWidth");
function setupView(context) {
  let open;
  let latest = 0;
  let stops = [];
  const unsubscribe = /* @__PURE__ */ __name(() => {
    for (const stop of stops.splice(0)) stop();
  }, "unsubscribe");
  const subscribe = /* @__PURE__ */ __name(() => {
    if (stops.length) return;
    stops = [context.data.on("server.connected", refresh), context.data.on("agent.updated", refresh)];
  }, "subscribe");
  const [shown, setShown] = createSignal(false);
  const show = /* @__PURE__ */ __name(async (refresh2) => {
    if (refresh2 && open === void 0) return;
    const request = ++latest;
    const location = context.location;
    const result = await context.client.rpc(ChartsStatus).status({}, location ? { location } : {}).then((status) => ({ status }), (error) => ({ error }));
    if (request !== latest || refresh2 && open === void 0) return;
    open = request;
    setShown(true);
    subscribe();
    void context.ui.dialog.alert({ title: TITLE, message: viewMessage(result) }).then(() => {
      if (open !== request) return;
      open = void 0;
      setShown(false);
      unsubscribe();
    });
    context.ui.dialog.set({ size: "large" });
  }, "show");
  const refresh = /* @__PURE__ */ __name(() => void show(true), "refresh");
  const readTheme = /* @__PURE__ */ __name(() => {
    try {
      if (context.theme === void 0 && context.themeMode === void 0) return void 0;
      return extractTuiThemeSeed(context.theme, context.themeMode);
    } catch {
      return void 0;
    }
  }, "readTheme");
  let pushed;
  const pushTheme = /* @__PURE__ */ __name(async () => {
    const seed = readTheme();
    if (seed === void 0 || pushed === seed.revision) return;
    const revision = seed.revision;
    try {
      const call = context.client.rpc(ChartsThemeContract).sync({ mode: seed.mode, theme: { seed: seed.seed }, revision }, context.location ? { location: context.location } : {});
      const result = await Promise.resolve(call);
      if (result?.applied === true || result?.ok === true) pushed = revision;
    } catch {
    }
  }, "pushTheme");
  const themeStops = [];
  try {
    const stop = context.data.on("server.connected", () => {
      pushed = void 0;
      void pushTheme();
    });
    if (typeof stop === "function") themeStops.push(stop);
  } catch {
  }
  void pushTheme();
  const charts = new ChartBlockCache();
  const chartStops = [];
  const markdown = context.markdown;
  if (markdown && typeof markdown.registerCodeBlockRenderer === "function") {
    const stop = markdown.registerCodeBlockRenderer("chart", (token) => {
      const renderer = context.renderer;
      if (!renderer) return void 0;
      try {
        const seed = readTheme();
        const text = charts.update(token.text, { width: chartBlockWidth(renderer.width), height: 14, ansi: seed !== void 0 });
        if (!text) return void 0;
        const content = seed === void 0 ? text : applyTuiAnsiTheme(text, seed.seed);
        const foreground = typeof seed?.seed.text === "string" ? seed.seed.text : context.theme?.text.base;
        return new TextRenderable(renderer, { content, fg: foreground });
      } catch {
        return void 0;
      }
    });
    if (typeof stop === "function") chartStops.push(stop);
  }
  context.keymap.layer(() => ({
    mode: "global",
    commands: [
      {
        id: `${PLUGIN_ID}.status`,
        title: "Charts: Status",
        description: "The renderers, themes, tools and permission posture, and the next step",
        group: "Charts",
        palette: true,
        slash: { name: "charts" },
        run: /* @__PURE__ */ __name(() => show(false), "run")
      },
      { id: `${PLUGIN_ID}.status.refresh`, title: "Refresh Charts status", group: "Charts", bind: "r", enabled: shown, run: refresh }
    ]
  }));
  return () => {
    for (const stop of chartStops.splice(0)) stop();
    for (const stop of themeStops.splice(0)) stop();
    unsubscribe();
    if (open === void 0) return;
    open = void 0;
    setShown(false);
    context.ui.dialog.clear();
  };
}
__name(setupView, "setupView");
var tui_default = Plugin.define({ id: `${PLUGIN_ID}.tui`, setup: setupView });
export {
  chartBlockWidth,
  tui_default as default,
  setupView,
  viewMessage
};
