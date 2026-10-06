/**
 * M6-T3 — share barrel: the public surface of src/share/.
 *
 * Consumers import from here (`import { resolveShareState, ShareControl } from
 * './share'`), never from deep paths — the same convention as src/player/,
 * src/wear/ and the other milestone barrels.
 *
 * The layer is: `codec` (ShareState ⇆ query string), `storage` (localStorage
 * autosave), `url` (address-bar read/write), `resolve` (which ship to load +
 * how a change is applied) and `ShareControl` (the DOM affordance).
 */

export * from './types'
export * from './codec'
export * from './storage'
export * from './url'
export * from './resolve'
export * from './ShareControl'
