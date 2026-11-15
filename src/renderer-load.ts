// Loads the renderer (src/renderer.ts) once, on the first call that needs it, and keeps it.
//
// The specifier is this fixed literal, never a path or name from a call: the build resolves it to the plugin's own
// dist/renderer.js. A load that fails is not kept, so the next call tries again rather than repeating the failure.
type Renderer = typeof import("./renderer.js")

let loading: Promise<Renderer> | undefined
let loaded: Renderer | undefined

/** The renderer, loaded on the first call and the same module after it. */
export function renderer(): Promise<Renderer> {
  loading ??= import("./renderer.js").then(
    (module) => (loaded = module),
    (error: unknown) => {
      loading = undefined
      throw error
    },
  )
  return loading
}

/** The renderer when a call has already loaded it, without loading it: for cleanup, which has nothing to stop otherwise. */
export const loadedRenderer = (): Renderer | undefined => loaded
