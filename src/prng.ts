/**
 * A seeded pseudo-random generator, so anything a renderer decides at random — ECharts' beeswarm jitter, its force
 * layout, a scatter that overlaps — is the same on every render of the same spec with the same seed. Output is
 * compared byte for byte in the tests, so the generator is part of the output contract and never changes.
 */

/** SplitMix-flavoured 32-bit generator (mulberry32): fast, tiny, and identical on every platform. */
export function mulberry32(seed: number): () => number {
  // The seed is folded to an unsigned 32-bit integer, so 1, 1.0 and 1.9 are the same seed and -1 is not.
  let state = Math.trunc(seed) >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296
  }
}

/**
 * Runs `fn` with `Math.random` replaced by the seeded generator, and restores the previous generator in a `finally`
 * block, so a render that throws cannot leave the process with a fixed sequence. Renders are synchronous, so the
 * replacement is never visible to another render.
 */
export function withSeededRandom<T>(seed: number, fn: () => T): T {
  const previous = Math.random
  Math.random = mulberry32(seed)
  try {
    return fn()
  } finally {
    Math.random = previous
  }
}
