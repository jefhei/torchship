/**
 * M0-T6 — closed-world [auto] invariant harness barrel (PRD §8).
 *
 * Milestones import the invariant registry, the live spec-level checks and
 * the harness from here (e.g. `import { AUTO_INVARIANTS, runInvariantHarness }
 * from '../invariants'`), never from deep paths. M1-T3 wired the
 * hatch-alignment stub into LIVE_CHECKS, M2-T7 wired room-lit (the authored
 * kit's light sockets) and M3-T2 wired seams-watertight (the assembler's
 * generated mating geometry); M3-T3 (collision) does the same for the last
 * bullet — the registry entry is the contract each real check slots into.
 */

export * from './registry'
export * from './specAnalysis'
export * from './checks'
export * from './harness'
