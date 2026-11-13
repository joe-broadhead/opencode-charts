var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// src/tui.ts
import { Plugin } from "@opencode/plugin/tui";
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
  tui_default as default,
  setupView,
  viewMessage
};
