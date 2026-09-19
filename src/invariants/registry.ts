/**
 * M0-T6 — the PRD §8 [auto] closed-world invariant registry.
 *
 * PRD §8 lists six machine-checkable ([auto]) invariants plus three human
 * ([review]) ones. This module declares the six [auto] invariants as a
 * typed, ordered target set — each with the §8 wording, the tolerance that
 * applies (imported from the M0-T2 seam spike's SEAM_TOLERANCES — measured
 * constants, never re-derived), and the milestone that owns the real check:
 *
 *   bullet 1 (seams-watertight)  → M3-T2 assembler geometry test — LIVE at
 *                                  M3-T2 (mating geometry generated from the
 *                                  sockets + measured, see checks.ts)
 *   bullet 2 (hatch-alignment)   → M1-T3 spec validator — LIVE at M1-T3
 *                                  (socket-resolved, see checks.ts)
 *   bullet 3 (spine-connectivity)→ M1-T3 resolver refines the M0-T6
 *                                  spec-level live check (see checks.ts)
 *                                  and re-derives it socket-resolved in the
 *                                  spec validator (src/validation/)
 *   bullet 4 (collision-match)   → M3-T3 per-deck hull builder
 *   bullet 5 (spawn-inside)      → M3-T6 spawn selection (spec facet live
 *                                  at M0-T6; containment half deferred)
 *   bullet 6 (room-lit)          → M2-T7 kit test harness — LIVE at M2-T7
 *                                  (authored kit light sockets, see checks.ts)
 *
 * A check is either:
 *  - `live` — the harness runs a real check today (see src/invariants/checks.ts
 *    for the implementation), or
 *  - `stub` — a declared TARGET: the fixture data available at M0 does not
 *    carry what the check needs (collision hulls for bullet 4), so the harness
 *    reports it `deferred` with its owner and required input. The owner
 *    milestone replaces the stub with a real check; the registry entry is the
 *    contract it slots into. BUILD_PLAN M0 gate: "invariant test harness runs
 *    (may fail — that's fine, they're targets)".
 */

import { SEAM_TOLERANCES } from '../spikes/seams/tolerances'
import type { ShipSpec } from '../types'

/** The six PRD §8 [auto] invariants, in the order §8 lists them. */
export const INVARIANT_IDS = [
  'seams-watertight',
  'hatch-alignment',
  'spine-connectivity',
  'collision-match',
  'spawn-inside',
  'room-lit',
] as const

/** One of the six [auto] invariants. */
export type InvariantId = (typeof INVARIANT_IDS)[number]

/** A verdict a live check computes for one fixture. */
export type CheckStatus = 'pass' | 'fail'

/** Result of running one invariant over one fixture. */
export type RunStatus = CheckStatus | 'deferred'

/** The tolerance a §8 bullet fixes, when it fixes a number. */
export interface LimitSpec {
  value: number
  unit: 'mm' | 'm' | 'count'
  /** '<' = strictly under the cap; '<=' / '>=' = may touch it. */
  relation: '<' | '<=' | '>='
}

/** One declared [auto] invariant: metadata + live-check wiring contract. */
export interface AutoInvariant {
  /** Stable invariant id ('seams-watertight', …). */
  id: InvariantId
  /** Position in the PRD §8 [auto] list: 1..6. */
  bullet: 1 | 2 | 3 | 4 | 5 | 6
  /** Short human title. */
  title: string
  /** The §8 requirement this invariant enforces. */
  requirement: string
  /** Fixed tolerance where §8 / M0-T2 fix one; absent = qualitative. */
  limit?: LimitSpec
  /** 'live' = the harness runs a real check at M0; 'stub' = declared target. */
  status: 'live' | 'stub'
  /** The milestone/task that owns the real (full) check. */
  owner: string
  /** The input the full check needs that M0 fixtures do not yet carry. */
  needs?: string
  /** Free-text note on scope / refinement (coarse-rule limits, halves). */
  note?: string
}

/** The six declared invariants, in §8 order (stable iteration order). */
export const AUTO_INVARIANTS: readonly AutoInvariant[] = [
  {
    id: 'seams-watertight',
    bullet: 1,
    title: 'Module seams are watertight',
    requirement:
      'For every door-socket join and bulkhead meet, the gap is < 2 mm in spec space (assembler geometry test).',
    limit: {
      value: SEAM_TOLERANCES.watertightGapMm,
      unit: 'mm',
      relation: '<',
    },
    status: 'live',
    owner: 'M3-T2',
    note: 'Live at M3-T2 (checks.ts checkSeamsWatertight): the assembler GENERATES the mating geometry from the sockets and this check measures it (src/assembler/seams.ts) — every join sleeve\u2019s along-normal gap against the < 2 mm cap, its coverage of the contact annulus between the two wall faces, its bite past both planes, that it never intrudes into the pass-through, and that every blanked socket nothing else seals is plugged through the wall it sits in. Also the "bulkhead meet" half: module faces that engage with overlapping rectangles and no door socket between them must be gap-free. M0-T2 proved socket-solved joins measure 0.000 mm — the join math is never the error source; this guards the ASSEMBLER output.',
  },
  {
    id: 'hatch-alignment',
    bullet: 2,
    title: 'Hatch alignment',
    requirement:
      "Every module's door sockets land on the spine or a mating module within 5 mm; no dangling sockets (spec validator).",
    limit: {
      value: SEAM_TOLERANCES.hatchAlignMm,
      unit: 'mm',
      relation: '<=',
    },
    status: 'live',
    owner: 'M1-T3',
    note: 'Live at M1-T3 (checks.ts checkHatchAlignment): the socket resolver measures every door socket in world space against the M0-T2 channels and caps: a room spine-door must land on its deck spine-band socket within 5 mm on lateral/vertical/face; module-to-module pairs whose wall faces engage and openings overlap must align (rig-3 1.2 m high-hatch vs 1.0 m door = 200 mm step is caught as the misaligned pair it is); a door opening onto another module blank wall is dangling. Unjoined sockets that engage nothing are legal (blanked; the real ships side doors). Runs over the fixture-time CONTRACT_KIT until M2 supplies the authored manifest.',
  },
  {
    id: 'spine-connectivity',
    bullet: 3,
    title: 'The spine connects every deck',
    requirement:
      'The ladder/crawl run is continuous from the crew deck to the head and to engineering (graph reachability test on the spec).',
    status: 'live',
    owner: 'M1-T3',
    note: 'Live at M0-T6 as the spec-level run-continuity check: every deck must seat a module flush on the spine band (within the 5 mm hatch cap) on the canonical floor grid, with head / crew / engineering endpoints. M1-T3 refined the seat rule socket-resolved (door centers vs the band socket, src/validation/validator.ts spineConnectivityProblems) — the coarse pose rule and the resolver give identical verdicts on all four fixtures.',
  },
  {
    id: 'collision-match',
    bullet: 4,
    title: 'Collision hull matches visible geometry',
    requirement:
      'The per-deck collision hull matches visible geometry within 10 cm per deck.',
    limit: { value: 0.1, unit: 'm', relation: '<=' },
    status: 'stub',
    owner: 'M3-T3',
    needs:
      'per-deck collision hulls and the assembled geometry they must match (M3-T1 / M3-T3 output)',
  },
  {
    id: 'spawn-inside',
    bullet: 5,
    title: 'Spawn point is inside the crew deck',
    requirement: 'The spawn point is inside the crew deck, not intersecting geometry.',
    status: 'live',
    owner: 'M3-T6',
    note: 'Spec facet live at M0-T6: the spawn deck (index 1, by the deck-plan contract) exists and hosts a galley seated at the foot of the spine. The geometric containment half (inside the deck, clear of hulls) needs collision hulls and is M3-T6\u2019s.',
  },
  {
    id: 'room-lit',
    bullet: 6,
    title: 'Every module instance has \u2265 1 light fixture',
    requirement:
      'Every module instance has \u2265 1 light fixture (no legally-dark room in the spec).',
    limit: { value: 1, unit: 'count', relation: '>=' },
    status: 'live',
    owner: 'M2-T7',
    note: 'Live at M2-T7 (checks.ts checkRoomLit): light sockets are M2 authorship data (the fixture-time CONTRACT_KIT predates them and carries none), so the check reads the AUTHORED kit (src/kit/modules/registry.ts) and counts fixtures per module INSTANCE — every spec ref plus the implicit per-deck shaft band the assembler synthesizes (M2-T6). Fails on a ref to a module the kit does not know (its fixtures are unknown), a ref\u2019d module with zero light sockets, a dark shaft band, or a spec with no instances. The kit harness (src/kit/harness/) is what proves the sockets themselves are real: 35 sockets across the six authored modules, each anchored on audited geometry, gated by the M2 machine gate.',
  },
]

/** Look up an invariant by id; throws on unknown ids (typos surface early). */
export function getAutoInvariant(id: InvariantId): AutoInvariant {
  const inv = AUTO_INVARIANTS.find((x) => x.id === id)
  if (!inv) throw new Error(`invariants: no PRD \u00a78 [auto] invariant "${id}"`)
  return inv
}

/** Convenience: the invariants whose status is 'live' (have real checks). */
export function liveInvariants(): AutoInvariant[] {
  return AUTO_INVARIANTS.filter((x) => x.status === 'live')
}

/** Convenience: the declared targets — stubs awaiting their owner milestone. */
export function stubInvariants(): AutoInvariant[] {
  return AUTO_INVARIANTS.filter((x) => x.status === 'stub')
}

/**
 * Shape a live check must have: pure spec in, verdict out. Later milestones
 * implement stub bodies against this same shape (spec-only inputs that need
 * assembled data receive it via the spec's fixtures at their milestone).
 */
export type InvariantCheck = (spec: ShipSpec) => { status: CheckStatus; detail: string }
