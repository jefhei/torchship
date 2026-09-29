/**
 * M4-T4 — the seeded PRNG behind the worn-detail pass.
 *
 * PRD §6: "Seed control for minor kit variation (clutter, paint patches, cable
 * routing)" and `ShipSpec.seed`'s own doc comment ("variation seed for
 * kit-level detail, M4-T4"). The whole point of a seed is that the same spec
 * produces the same ship: every detail decision below is a pure function of
 * the spec's seed plus the identity of the thing being detailed (deck index,
 * module instance, facet) — never of wall-clock time, iteration order or
 * `Math.random`.
 *
 * The generator is mulberry32, the same 32-bit algorithm the M0-T2 seam spike
 * uses for its authoring noise (src/spikes/seams/stress.ts), so a seed means
 * the same stream repo-wide; `seedFor` derives an independent stream per
 * (base seed, key…) pair by FNV-1a-mixing the key's characters into the base,
 * which is what keeps two facets of one module from drawing the same numbers.
 */

/** A deterministic random source: `rng()` returns the next value in [0, 1). */
export type Rng = () => number

/** Mulberry32: a small, fast, seed-stable 32-bit PRNG. */
export function mulberry32(seed: number): Rng {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * A stable 32-bit seed for one variation stream: the base seed mixed with the
 * ASCII of every key (FNV-1a, then a final avalanche). Same inputs → same
 * seed on every machine; the keys are the detail's identity, so no two
 * streams can collapse into one another by accident.
 */
export function seedFor(base: number, ...keys: readonly (string | number)[]): number {
  let hash = (0x811c9dc5 ^ (base >>> 0)) >>> 0
  for (const key of keys) {
    for (const char of `${key}|`) {
      hash = Math.imul(hash ^ char.charCodeAt(0), 0x01000193) >>> 0
    }
  }
  // One avalanche pass so tiny key changes move every bit.
  hash ^= hash >>> 16
  hash = Math.imul(hash, 0x7feb352d) >>> 0
  hash ^= hash >>> 15
  hash = Math.imul(hash, 0x846ca68b) >>> 0
  return (hash ^ (hash >>> 16)) >>> 0
}

/** The next number in [lo, hi). */
export function range(rng: Rng, lo: number, hi: number): number {
  return lo + rng() * (hi - lo)
}

/** The next integer in [lo, hi] (inclusive; `hi < lo` yields `lo`). */
export function intBetween(rng: Rng, lo: number, hi: number): number {
  if (hi <= lo) return lo
  return lo + Math.floor(rng() * (hi - lo + 1))
}

/** Pick one element of a non-empty list, uniform. */
export function pick<T>(rng: Rng, items: readonly T[]): T {
  if (items.length === 0) throw new Error('pick: no items to choose from')
  return items[Math.min(items.length - 1, Math.floor(rng() * items.length))]
}

/** True with probability `p`. */
export function chance(rng: Rng, p: number): boolean {
  return rng() < p
}

/** Clamp a value into [lo, hi]. */
export function clamp(value: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, value))
}

/** Normalize −0 → 0 (Object.is-strict comparisons treat signed zeros apart). */
export function n0(value: number): number {
  return value === 0 ? 0 : value
}
