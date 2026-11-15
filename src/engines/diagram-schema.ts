import * as z from "zod"
import { isUserColour, USER_COLOUR_MESSAGE, USER_COLOUR_PATTERN } from "../themes/user-colour.js"

// The diagram spec, apart from the engine that draws it: the tool schemas read it at every start, and the engine
// (src/engines/diagram.ts, which carries the Mermaid layout) loads only with the renderer.

export const DiagramNodeSchema = z.strictObject({
  id: z.string().min(1).max(80),
  label: z.string().min(1).max(200),
  /** A second line: a role on an org chart, a short note on a mindmap branch. */
  subtitle: z.string().max(200).optional(),
  /** The parent node's id; a node with no parent hangs from the root. */
  parent: z.string().max(80).optional(),
  /** A department or theme name; its colour comes from the theme's categorical palette. */
  group: z.string().max(80).optional(),
  /** An explicit accent colour for this node's card or pill: #hex, rgb(), rgba(), transparent or a CSS colour name. */
  color: z.string().trim().max(64).regex(USER_COLOUR_PATTERN, USER_COLOUR_MESSAGE).refine(isUserColour, USER_COLOUR_MESSAGE).optional(),
})

export const DiagramEdgeSchema = z.strictObject({
  from: z.string().min(1).max(80),
  to: z.string().min(1).max(80),
  label: z.string().max(120).optional(),
  style: z.enum(["solid", "dotted", "thick"]).optional(),
})

export const DiagramGroupSchema = z.strictObject({
  id: z.string().min(1).max(80),
  label: z.string().min(1).max(160),
  nodes: z.array(z.string().max(80)).max(80),
})

export const FishboneCategorySchema = z.strictObject({
  category: z.string().min(1).max(120),
  causes: z.array(z.string().min(1).max(160)).max(12),
})

export const DiagramSpecSchema = z
  .strictObject({
    /** Mermaid source: `graph TD`, `flowchart LR`, `sequenceDiagram`, `stateDiagram-v2`, `classDiagram` or `erDiagram`. */
    dsl: z.string().min(1).max(20000).optional(),
    /** A structured recipe, laid out by this engine. */
    kind: z.enum(["mindmap", "org_chart", "fishbone", "architecture"]).optional(),
    /** Mindmap balance: a horizontal tree (the default) or a radial one. */
    layout: z.enum(["horizontal", "radial"]).optional(),
    /** The flow direction of an architecture diagram, or of a `graph`/`flowchart` dsl. */
    direction: z.enum(["TD", "TB", "LR", "BT", "RL"]).optional(),
    title: z.string().min(1).max(300).optional(),
    subtitle: z.string().min(1).max(300).optional(),
    kicker: z.string().min(1).max(120).optional(),
    source: z.string().min(1).max(300).optional(),
    notes: z.string().min(1).max(500).optional(),
    /** The question a fishbone explains, such as "Late deliveries". */
    effect: z.string().min(1).max(200).optional(),
    /** The mindmap's centre, when the nodes do not already name one root. */
    root: z.strictObject({ id: z.string().min(1).max(80).optional(), label: z.string().min(1).max(200) }).optional(),
    nodes: z.array(DiagramNodeSchema).max(200).optional(),
    edges: z.array(DiagramEdgeSchema).max(400).optional(),
    /** Architecture groups, drawn as Mermaid subgraphs. */
    groups: z.array(DiagramGroupSchema).max(30).optional(),
    /** Fishbone categories, each with its causes (`causes` is accepted as an alias). */
    categories: z.array(FishboneCategorySchema).max(12).optional(),
    causes: z.array(FishboneCategorySchema).max(12).optional(),
    /** The drawn width in px; the height follows the content's aspect. */
    width: z.number().min(20).max(4000).optional(),
    height: z.number().min(20).max(4000).optional(),
  })
  .refine(spec => Boolean(spec.dsl) !== Boolean(spec.kind), {
    message: "Give either dsl (Mermaid source) or kind (a diagram recipe), and not both.",
    path: ["dsl"],
  })

export type DiagramNode = z.infer<typeof DiagramNodeSchema>
export type DiagramEdge = z.infer<typeof DiagramEdgeSchema>
export type DiagramGroup = z.infer<typeof DiagramGroupSchema>
export type FishboneCategory = z.infer<typeof FishboneCategorySchema>
export type DiagramSpec = z.infer<typeof DiagramSpecSchema>
export type DiagramKind = NonNullable<DiagramSpec["kind"]>
