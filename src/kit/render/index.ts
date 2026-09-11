/**
 * M2-T1 — render-layer barrel: part → mesh mapping for the kit primitives.
 *
 * The pure half (transforms, slot surfaces) is unit-tested headless; the
 * components are exercised by the build (tsc) and by the M2-T7 harness inside
 * a real <Canvas> (jsdom can't mount one).
 */

export * from './transforms'
export * from './slotSurfaces'
export * from './SlotMaterial'
export * from './KitParts'
export * from './primitives'
