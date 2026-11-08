# Scripting

Charts speaks the family's tools RPC v2: `<plugin id>.tools`, at
`POST /api/rpc/charts.tools/<method>`, so a script draws and checks charts with no model and no provider spend.

```sh
# The methods, their classes and the permission each resolves.
opencode api post /api/rpc/charts.tools/describe -d '{"input":{"sessionID":"<id>"}}'

# Draw a chart.
opencode api post /api/rpc/charts.tools/render -d '{"input":{"sessionID":"<id>","input":{
  "spec":{"mark":"bar","encoding":{"x":{"field":"region","type":"nominal"},"y":{"field":"revenue","type":"quantitative"}}},
  "data":{"path":"data/sales.csv"},"formats":["svg","png"]}}}'
```

Each call returns `{ output, text }`: the structured result the model would see, and the text it would read. Images are
never inlined into a script's result — the files are in the workspace, as for a model's call.

## Methods and classes

| Method | Action | Class | Writes |
|---|---|---|---|
| `render` | `charts_render` | `export` | `outputs/charts/*` |
| `quick` | `charts_quick` | `export` | `outputs/charts/*` |
| `theme_save` | `charts_theme_save` | `export` | `.charts/themes/<name>.json` |
| `validate` | `charts_validate` | `read` | nothing |
| `recommend` | `charts_recommend` | `read` | nothing |
| `capabilities` | `charts_capabilities` | `read` | nothing |
| `catalogue` | `charts_catalogue` | `read` | nothing |
| `themes` | `charts_themes` | `read` | nothing |

The class is the worst thing a method does; it never decides whether a call runs. `docs/tool-parity.md` is generated
from the same registry, and `test/registry.test.ts` fails when the two disagree.

## What decides a call

A script runs **as a session and the agent it names**. The rule for the method's action is resolved over the agent's
rules and then the session's, last match wins, before anything runs:

- `allow` runs the method, which then asserts its own action and, for a read of a data file or a write of an output,
  the file rule (`read` / `edit`) — the same asks a model's call makes;
- `ask` is **refused before dispatch**, with `PERMISSION_DENIED` and the remedy in `next`: a script has no one to answer
  a prompt;
- `deny` is refused with no call.

**Every method is allowed by default**, so a script renders with no prompt: the tools RPC resolves the rule before
dispatch, and the default allow *is* that allow. To restrict a script, set the plugin's `access` option to
`"ask-changes"` (an `ask` is refused, because no one can answer it) or `"read-only"`, or give the script's agent its own
rule for one method:

```jsonc
// the agent the script's session names, in its own permissions
{ "action": "charts_render", "resource": "*", "effect": "deny" }
```

**A saved approval is not a rule.** An "Always allow" from an earlier interactive session lives outside the agent and
session rules, so it does not authorize an ad-hoc script. That is deliberate: a script's grant is a rule in config, or
a session a job creates for it.

## The location

The RPC runs in the location the request names. Send the header, or the query parameter, so a script in one project does
not act on another:

```sh
opencode api post /api/rpc/charts.tools/catalogue -H "x-opencode-directory:$PWD" -d '{"input":{"sessionID":"<id>","input":{"id":"line"}}}'
```

A session created elsewhere is `SESSION_UNKNOWN`, and the `next` names this header.

## Refusals

A refusal is the RPC error `failed` with `data: { code, next }`:

| Code | When | What to do |
| --- | --- | --- |
| `PERMISSION_DENIED` | the rule resolves to ask, or a deny hides the method | add an allow rule for the action to the session's agent or to the session |
| `SESSION_UNKNOWN` | the session is not known in this location | create the session in the location you mean, and pass its id |
| `SESSION_AGENT_REQUIRED` | the session names no agent | create a session that names an agent |
| `TOOL_UNAVAILABLE` | OpenCode does not list the method's tool now | call `describe` to see the methods there are |
| `CANCELLED` | the call was cancelled | call the method again if you still need the result |
| `UPSTREAM_ERROR` | a renderer failed | the tool's own code (`SPEC_INVALID`, `RENDER_FAILED`…) is in the message |

## Failures

A failure is `{ code, what, next }`, with the tool's own code: `SPEC_INVALID`, `FIELD_UNKNOWN`, `DATA_TOO_LARGE`,
`RENDER_TIMEOUT`, `PNG_UNAVAILABLE`. `what` and `next` are the message the model would read, so a script's log says
what to fix in the same words.
