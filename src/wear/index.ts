/**
 * M4-T4 — worn-detail barrel: the public surface of src/wear/.
 *
 * The pass is one derived layer, imported as a whole by the assembler
 * (`wearPlansForDeck` in assemble.ts), by the material/QA reports and by
 * tests. Everything it exports stays three-agnostic: pure data in, pure data
 * out — the renderer never learns the detail is generated (it draws the deck's
 * partition, exactly like the M3-T2 seam geometry).
 *
 * Consumers:
 *  - the assembler (M3-T1): `wearPlansForDeck` + `wearPartsOf`;
 *  - the gate: `wearProblems` (wired as `assemblyProblems` rule 13);
 *  - reports/QA: `wearReport`, `wearDrawCallDelta`;
 *  - the review loop (M5): the density knob is `AssembleOptions.wearDensity`
 *    (`WEAR_DENSITY_LEVELS` documents PRD §10's fourth degradation rung).
 */

export * from './random'
export * from './recipes'
export * from './mounts'
export * from './detail'
export * from './checks'
export * from './report'
