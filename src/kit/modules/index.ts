/**
 * M2-T2 — module-authoring barrel: the public surface of src/kit/modules/.
 *
 * The M2-T2..T6 module authors, the M2-T7 harness and the M3 assembler import
 * from here, never from deep paths: the placement transform, the
 * AuthoredModule vocabulary + inspection helpers, the authored modules
 * themselves, the registry and the integrity gates.
 */

export * from './placement'
export * from './types'
export * from './head'
export * from './galley'
export * from './registry'
export * from './integrity'
export * from './render'
