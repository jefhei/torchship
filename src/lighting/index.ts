/**
 * M4-T2 — lighting barrel: the public surface of src/lighting/.
 *
 * `./archetypes.ts` — the four practical kinds (panel / task / screen /
 * reactor) as physical recipes: the §4 lens slot whose emissive tint colours
 * the light, the designed throw, the target illuminance, the derived candela
 * intensity, the reach and decay, and the shadow request. Plus the rig's warm
 * ambient fill and the gates that keep all of it inside the §4 anti-goals
 * (no blown-out panels, no sun, no flat fill).
 *
 * `./rig.ts` — the rig itself: one fixture per light socket of an assembled
 * ship, in world space, the frame-budget selection the renderer mounts
 * (`activeLightsFor`), the shadow spend, the verdict (`lightRigProblems`) and
 * the report (`lightRigReport`).
 *
 * `./ShipLighting.tsx` — the R3F component that mounts the selection.
 */

export * from './archetypes.ts'
export * from './rig.ts'
export * from './ShipLighting.tsx'
