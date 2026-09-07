/**
 * M0-T5 — fixtures barrel: the public surface of src/fixtures/.
 *
 * Milestones import the canonical test ships from here (e.g.
 * `import { SHIP_FIXTURES } from '../fixtures'`), never from deep paths.
 * The four specs are plain data — JSON-round-trippable — so M1-T3 can emit
 * its preset JSON straight from these objects.
 */

export * from './layout'
export * from './patrol'
export * from './longHaul'
export * from './science'
export * from './stress'
export * from './registry'
