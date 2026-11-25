import { run, tableSpecOf, diagramSpecOf, pickFrameless, type ToolEnvironment, type ToolOutput } from "../tools.js"

/** tools.charts.table: a publication data-graphic table, drawn by the table engine. */
export function runTable(env: ToolEnvironment, input: Record<string, unknown>): Promise<ToolOutput> {
  return run(env, { spec: tableSpecOf(input), engine: "table", ...(input.data ? { data: input.data as never } : {}), ...pickFrameless(input) }, true, input.inspect as boolean | undefined)
}

/** tools.charts.diagram: Mermaid source or a structured recipe, drawn by the diagram engine. */
export function runDiagram(env: ToolEnvironment, input: Record<string, unknown>): Promise<ToolOutput> {
  // A diagram's name comes from its title, or from the effect a fishbone explains when it has no title.
  const named = input.name === undefined && input.title === undefined && typeof input.effect === "string" ? { name: input.effect } : {}
  return run(env, { spec: diagramSpecOf(input), engine: "diagram", ...named, ...pickFrameless(input) } as never, true, input.inspect as boolean | undefined)
}
