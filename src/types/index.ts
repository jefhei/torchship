/**
 * M1-T2 — data-contract barrel: the public surface of src/types/.
 *
 * Milestones import the contracts from here (e.g.
 * `import type { ShipSpec, KitModule } from '../types'`), never from deep
 * paths. Value exports (constants + helpers) and type exports are re-exported
 * together; type-only modules use `export type *` so the barrel adds no
 * runtime weight for them.
 */

export * from './geometry'
export * from './units'
export type * from './ship'
export * from './kit'
export * from './materials'
export type * from './scene'
