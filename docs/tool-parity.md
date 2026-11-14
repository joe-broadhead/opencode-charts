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
| `update` | model | export | yes | yes |
| `board` | model | export | yes | yes |
| `table` | model | export | yes | yes |
| `diagram` | model | export | yes | yes |
| `recommend` | model | read | yes | yes |
| `capabilities` | model | read | yes | yes |
| `catalogue` | model | read | yes | yes |
| `themes` | model | read | yes | yes |
| `theme_save` | model | export | yes | yes |

There is no host audience: every tool here is for the model, and the reads a script most often wants (`validate`,
`catalogue`, `themes`, `recommend`, `capabilities`) run with no prompt. `render`, `quick`, `update`, `board`, `table`,
`diagram` and `theme_save` are the seven `export` tools, so a script needs an agent rule that allows any of them
(`docs/scripting.md`).

`charts.theme` is not a registry tool: it is a separate host-theme RPC contract (`docs/scripting.md`), so it has no
row here and no class.
