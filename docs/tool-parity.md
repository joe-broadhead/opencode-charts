# Tool parity

Every tool of the registry (`src/registry.ts`), the surfaces it is placed on, and its class. `test/registry.test.ts`
fails when this table and the registry disagree, and its failure message names the row to fix. Generate the rows from
`DESCRIPTORS` rather than editing them by hand.

**Class** is the worst thing a tool does: `read` reads only, `export` writes a local file. It never decides whether a
call runs — the permission rules do — but it is what `describe` reports on the tools RPC and what Jelly needs in order
to hide a writer from a read-only agent.

| Tool | Audience | Class | RPC | Jelly |
|---|---|---|---|---|
| `render` | model | export | yes | yes |
| `quick` | model | export | yes | yes |
| `validate` | model | read | yes | yes |
| `recommend` | model | read | yes | yes |
| `capabilities` | model | read | yes | yes |
| `catalogue` | model | read | yes | yes |
| `themes` | model | read | yes | yes |
| `theme_save` | model | export | yes | yes |

There is no host audience: every tool here is for the model, and the two that a script most often wants
(`validate`, `catalogue`) are `read`, so a script runs them with no prompt. `render`, `quick` and `theme_save` are
`export`, so a script needs an agent rule that allows them (`docs/scripting.md`).
