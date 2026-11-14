/**
 * The bridge between a rendered chart and the host's artifact surface, in the half of the plugin that runs on the
 * server.
 *
 * The artifact API moved while the host was in beta: one release exposes it as `experimental.artifact`, another may
 * expose it as `artifact`, and the shape of a publisher differs between them. This module therefore imports nothing
 * from the host's artifact subpaths and duck-types what it finds: it calls a direct `create`/`publish` when the host
 * offers one, and otherwise registers an artifact provider through `transform`. A context with neither returns
 * `undefined`, so a caller can fall back to writing the file itself.
 */

/** One chart to publish: its identity, the HTML page, and optionally the standalone SVG it was built from. */
export interface ArtifactInput {
  readonly id: string
  readonly title: string
  readonly html: string
  readonly svg?: string
}

/** What a publish returns when the host accepted the artifact; a URL when the host could mint one. */
export interface ArtifactResult {
  readonly url?: string
}

const asRecord = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined

const asFunction = <T>(value: unknown): T | undefined => (typeof value === "function" ? (value as T) : undefined)

/**
 * The host's artifact domain on a plugin context, whichever name this release gives it. Only the presence of an
 * object is decided here; each method is checked where it is used.
 */
export function artifactDomain(ctx: unknown): Record<string, unknown> | undefined {
  const root = asRecord(ctx)
  const experimental = asRecord(root?.experimental)
  return asRecord(experimental?.artifact) ?? asRecord(root?.artifact)
}

const encoder = new TextEncoder()

/**
 * Publishes an HTML artifact for a chart. `ctx` is the server plugin's context, typed `unknown` here on purpose: the
 * function works across the host releases the plugin supports without importing any of them.
 */
export async function publishHtmlArtifact(ctx: unknown, input: ArtifactInput): Promise<ArtifactResult | undefined> {
  if (!input || typeof input.id !== "string" || typeof input.title !== "string" || typeof input.html !== "string" || input.html === "") return undefined
  const domain = artifactDomain(ctx)
  if (!domain) return undefined
  const files: Record<string, Uint8Array> = { "index.html": encoder.encode(input.html) }
  if (typeof input.svg === "string" && input.svg !== "") files["chart.svg"] = encoder.encode(input.svg)
  const request = { id: input.id, title: input.title, entry: "index.html", files }

  // The direct path: a release that publishes from a context method answers with the artifact's URL.
  for (const name of ["create", "publish"] as const) {
    const method = asFunction<(this: unknown, value: unknown) => Promise<unknown>>(domain[name])
    if (!method) continue
    try {
      const answer = await method.call(domain, request)
      const url = asRecord(answer)?.url
      return typeof url === "string" && url !== "" ? { url } : {}
    } catch {
      return undefined
    }
  }

  // The provider path: the host hands over an editor, and the definition it adds serves the files it was given.
  const transform = asFunction<(this: unknown, callback: (editor: unknown) => void) => Promise<unknown>>(domain.transform)
  if (!transform) return undefined
  const definition = {
    id: request.id,
    name: request.title,
    capabilities: ["html"],
    prompt: "Publish a chart as a self-contained HTML artifact.",
    create: async () => ({}),
    read: async () => files,
    update: async () => ({}),
    delete: async () => undefined,
  }
  try {
    await transform.call(domain, editor => {
      const add = asFunction<(this: unknown, value: unknown) => void>(asRecord(editor)?.add)
      if (add) add.call(editor, definition)
    })
    return {}
  } catch {
    return undefined
  }
}
