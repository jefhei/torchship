/**
 * M0-T6 — closed-world [auto] invariant harness barrel (PRD §8).
 *
 * Milestones import the invariant registry, the live spec-level checks and
 * the harness from here (e.g. `import { AUTO_INVARIANTS, runInvariantHarness }
 * from '../invariants'`), never from deep paths. M1-T3 wired the
 * hatch-alignment stub into LIVE_CHECKS, M2-T7 wired room-lit (the authored
 * kit's light sockets) and M3-T2 wired seams-watertight (the assembler's
 * generated mating geometry); M3-T3 wired the LAST bullet, collision-match
 * (the deck hull built in src/assembler/collision.ts) — all six §8 [auto]
 * invariants are live, so the harness no longer reports any `deferred` run.
 */

export * from './registry'
export * from './specAnalysis'
export * from './checks'
export * from './harness'
