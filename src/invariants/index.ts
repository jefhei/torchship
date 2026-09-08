/**
 * M0-T6 — closed-world [auto] invariant harness barrel (PRD §8).
 *
 * Milestones import the invariant registry, the live spec-level checks and
 * the harness from here (e.g. `import { AUTO_INVARIANTS, runInvariantHarness }
 * from '../invariants'`), never from deep paths. M1-T3 wires the
 * hatch-alignment stub into LIVE_CHECKS; M3-T2/M3-T3/M3-T6 and M2-T7 do the
 * same for their bullets — the registry entry is the contract each real
 * check slots into.
 */

export * from './registry'
export * from './specAnalysis'
export * from './checks'
export * from './harness'
