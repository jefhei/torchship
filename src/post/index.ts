/**
 * M4-T3 — post barrel: the public surface of src/post/.
 *
 * `./recipe.ts` — the calibrated chain as plain data: the bloom strength /
 * threshold / spread, the AO recipe, and the gates that keep both inside the
 * §4 anti-goals (subtle, no blown-out panels, no murky rooms). The luminance
 * threshold is DERIVED from M4-T1's emissive band (the dimmest lens that
 * emits) and M4-T2's ambient fill, so retuning a lens moves the threshold.
 *
 * `./plan.ts` — the plan: the recipes plus the frame-budget verdict that
 * decides whether the AO pass is mounted at all (§10 draw calls + the
 * deck-scoped light ceiling), the M4 machine-gate surface (`postProblems`) and
 * the one-line report (`postPlanOf`).
 *
 * `./ShipPost.tsx` — the R3F component that mounts the plan's passes.
 */

export * from './recipe.ts'
export * from './plan.ts'
export * from './ShipPost.tsx'
