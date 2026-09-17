/**
 * M2-T1 — kit-runtime barrel: the public surface of src/kit/.
 *
 * Modules (M2-T2..T6) and the M2-T7 harness import the primitive catalog, the
 * part builders and the R3F primitive components from here, never from deep
 * paths. `./types` is type-only (`export type *`); the rest carries the
 * builders, the catalog data, the render layer and the kit harness.
 */

export type * from './types'
export * from './parts'
export * from './catalog'
export * from './render'
export * from './modules'
export * from './harness'
