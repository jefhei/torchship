/**
 * M1-T3 — Ship Spec validator barrel: the public surface of src/validation/.
 *
 * Milestones import the validator and the fixture-time contract kit from
 * here (e.g. `import { shipSpecProblems, CONTRACT_KIT } from '../validation'`),
 * never from deep paths. M2-T7 gates the authored kit's socket origins
 * against contractSocketOrigins(); M3's assembler runs specs through
 * assertValidShipSpec() before assembling; the invariant harness wires the
 * hatch-alignment check in src/invariants/checks.ts.
 */

export * from './contractKit'
export * from './sockets'
export * from './validator'
