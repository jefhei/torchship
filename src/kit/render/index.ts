/**
 * M2-T1 — render-layer barrel: part → mesh mapping for the kit primitives.
 *
 * The pure half (transforms, slot surfaces, the M3-T7 merge/instance geometry
 * builders) is unit-tested headless; the components are exercised by the build
 * (tsc) and by the M2-T7 harness inside a real <Canvas> (jsdom can't mount
 * one).
 */

export * from './transforms'
export * from './slotSurfaces'
export * from './merged'
export * from './SlotMaterial'
export * from './KitParts'
export * from './MergedParts'
export * from './primitives'
