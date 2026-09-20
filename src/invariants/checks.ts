/**
 * M0-T6 — live spec-level implementations of PRD §8 [auto] invariants.
 *
 * The fixture data (ShipSpec + the layout contract + the M1-T3 socket
 * resolver over the fixture-time CONTRACT_KIT + the M2-T7 authored kit + the
 * M3-T1/T2/T3 assembler) supports REAL checks for all six bullets; the last
 * one (collision, bullet 4) went live at M3-T3:
 *
 *  - checkSeamsWatertight    (§8 bullet 1, 'seams-watertight', LIVE at
 *    M3-T2): the assembler generates the mating/closing geometry from the
 *    sockets (src/assembler/seams.ts) and this check reads the measured
 *    verdict — every join's sleeve gap against the < 2 mm cap, its coverage
 *    of the contact annulus, its bite past both wall planes, that it stays out
 *    of the pass-through, that every blanked socket nothing else seals is
 *    plugged through its wall, and that engaging bulkhead meets without a
 *    socket between them are gap-free.
 *
 *  - checkSpineConnectivity  (§8 bullet 3, 'spine-connectivity'): the spine
 *    run is continuous when every deck seats a module flush on the shaft
 *    band (moduleSeatProblems empty — rot-0 spine-door within the 5 mm
 *    hatch cap on every channel) AND every deck floor sits on the canonical
 *    grid (deckFloorYFor(index) — the per-deck spine bands stack
 *    floor-to-floor, so an off-grid deck steps the ladder run by exactly
 *    the floor error), AND the run's endpoints exist: deck 0 hosts the head
 *    module, deck 1 exists (the crew deck, by the deck-plan contract), and
 *    some deck hosts engineering. With the run continuous across 0..N−1,
 *    the crew→head and crew→engineering paths along the shaft exist by
 *    graph reachability over deck adjacency. M1-T3 refined the seat rule
 *    socket-resolved (src/validation/validator.ts spineConnectivityProblems
 *    — door centers vs the band socket); both give identical verdicts.
 *
 *  - checkHatchAlignment      (§8 bullet 2, 'hatch-alignment', LIVE at
 *    M1-T3): every door socket measured at socket level against the M0-T2
 *    channels and caps (validator hatchAlignmentProblems over
 *    CONTRACT_KIT): room spine-doors must land on their deck spine-band
 *    sockets within the 5 mm cap on every channel; module-to-module pairs
 *    whose wall faces engage and openings overlap must align (rig-3's
 *    200 mm door-center step is caught as the misaligned pair it is); a
 *    door opening onto another module's blank wall is dangling. Unjoined
 *    sockets that engage nothing are legal spec (blanked — the real ships'
 *    side doors).
 *
 *  - checkSpawnInsideSpec    (§8 bullet 5, 'spawn-inside', spec facet): the
 *    spawn deck (index 1 by the deck-plan contract — PRD §6 "spawn on the
 *    crew deck at the foot of the spine", M3-T6) exists and hosts a galley
 *    seated at the spine foot. The geometric containment half (spawn point
 *    inside the deck, not intersecting hulls) needs collision geometry and
 *    is M3-T6's.
 *
 *  - checkCollisionMatch     (§8 bullet 4, 'collision-match', LIVE at
 *    M3-T3): the deck hull is the modules' own collision hints placed (one box
 *    per solid part) plus the generated blanking plugs (M3-T2), measured
 *    against the world bounds of the visible geometry it stands for — within
 *    the 10 cm cap per deck, both directions — with every pass-through the
 *    joins open left clear of hull boxes.
 *
 *  - checkRoomLit            (§8 bullet 6, 'room-lit', LIVE at M2-T7): every
 *    module INSTANCE in the spec carries ≥1 light fixture, read from the
 *    AUTHORED kit's light sockets (src/kit/modules/) — light sockets are M2
 *    data, so the fixture-time CONTRACT_KIT (which predates them, and whose
 *    lightSockets are deliberately empty) cannot answer this. Instances are
 *    the spec's module refs PLUS the implicit per-deck spine band the
 *    assembler synthesizes (M2-T6), so a dark shaft counts as a dark room.
 *
 * All six are wired into the harness via LIVE_CHECKS; a stub invariant has no
 * entry here, which is what makes the harness report it `deferred`. No stub
 * remains after M3-T3.
 */

import type { InvariantCheck, InvariantId } from './registry'
import {
  deckGridErrorMm,
  deckHosts,
  deckSeatSummary,
  findDeckHosting,
  moduleSeatProblems,
} from './specAnalysis'
import { MM } from '../types'
import { SEAM_TOLERANCES } from '../spikes/seams/tolerances'
import type { KitManifest, ShipSpec } from '../types'
import { CONTRACT_KIT, doorTallies, hatchAlignmentProblems } from '../validation'
import { AUTHORED_KIT, AUTHORED_MODULES } from '../kit/modules/registry'
import {
  COLLISION_MATCH_TOLERANCE_M,
  assembleShip,
  collisionProblems,
  collisionTally,
  seamTally,
  seamsWatertightProblems,
} from '../assembler'
import type { ShipAssembly } from '../assembler'

/**
 * §8 bullet 3 live check. Fails when the spine run is broken at any deck
 * (no seated module → no shaft access; off-grid floor → a step in the run)
 * or an endpoint is missing. Detail lists every problem as a defect-log
 * line; pass detail summarizes the run.
 */
export const checkSpineConnectivity: InvariantCheck = (spec: ShipSpec) => {
  const problems: string[] = []

  // Horizontal run continuity: every deck must seat ≥ 1 module on the band.
  spec.decks.forEach((deck, i) => {
    const seat = deckSeatSummary(deck, i)
    if (!seat.seated) {
      problems.push(
        `deck ${i} (${seat.deckId}): no module seated on the spine band: ${seat.problems.join('; ')}`,
      )
    }
  })

  // Vertical run continuity: deck floors on the canonical grid, so the
  // per-deck spine bands stack at the fixed 3.2 m pitch.
  spec.decks.forEach((deck, i) => {
    const gridMm = deckGridErrorMm(deck, i)
    if (gridMm > SEAM_TOLERANCES.hatchAlignMm) {
      problems.push(
        `deck ${i} (${deck.id}): floor is ${gridMm.toFixed(1)} mm off the canonical grid ` +
          `deckFloorYFor(${i}) — the spine run steps at this deck (cap ${SEAM_TOLERANCES.hatchAlignMm} mm)`,
      )
    }
  })

  // Endpoints of the §8 run: head (deck 0, nose), crew (deck 1), engineering.
  if (spec.decks.length === 0) {
    problems.push('spec has no decks — there is no spine run')
  } else if (!deckHosts(spec.decks[0], 'head')) {
    problems.push(
      `deck 0 (${spec.decks[0].id}) does not host the head module — the run has no head endpoint`,
    )
  }
  if (spec.decks.length < 2) {
    problems.push(
      `spec has ${spec.decks.length} deck${spec.decks.length === 1 ? '' : 's'} — no crew deck at index 1 to start the run from`,
    )
  }
  if (findDeckHosting(spec, 'engineering') === -1) {
    problems.push(
      'no deck hosts an engineering module — the run has no engineering endpoint',
    )
  }

  if (problems.length > 0) {
    return {
      status: 'fail',
      detail: problems.join('; '),
    }
  }
  const engDeck = findDeckHosting(spec, 'engineering')
  return {
    status: 'pass',
    detail:
      `spine run continuous across all ${spec.decks.length} decks (every deck seats a module on the band ` +
      `within ${SEAM_TOLERANCES.hatchAlignMm} mm on the canonical floor grid); crew (deck 1) → head (deck 0) ` +
      `and crew → engineering (deck ${engDeck}) are reachable along the shaft`,
  }
}

/**
 * §8 bullet 5 live check — the spec facet. Fails when the crew/spawn deck
 * (index 1) is missing, does not host a galley, or the galley is not seated
 * at the spine foot. The containment half (spawn point inside the deck,
 * clear of hulls) is M3-T6's and is called out in the pass detail.
 */
export const checkSpawnInsideSpec: InvariantCheck = (spec: ShipSpec) => {
  if (spec.decks.length < 2) {
    return {
      status: 'fail',
      detail:
        `spec has ${spec.decks.length} deck${spec.decks.length === 1 ? '' : 's'} — the crew/spawn deck ` +
        `(index 1, by the deck-plan contract) does not exist`,
    }
  }
  const crew = spec.decks[1]
  const galley = crew.modules.find((m) => m.moduleId === 'galley')
  if (!galley) {
    return {
      status: 'fail',
      detail:
        `crew/spawn deck (index 1, "${crew.id}") does not host a galley module — spawn is defined at the ` +
        `foot of the spine on the crew deck`,
    }
  }
  const seatProblems = moduleSeatProblems(galley)
  if (seatProblems.length > 0) {
    return {
      status: 'fail',
      detail: `spawn deck galley is not seated at the spine foot: ${seatProblems.join('; ')}`,
    }
  }
  return {
    status: 'pass',
    detail:
      `crew/spawn deck (index 1, "${crew.id}") hosts a galley seated on the spine band — the spawn point's ` +
      `geometric containment (inside the deck, clear of hulls) is M3-T6's half of this invariant`,
  }
}

/**
 * §8 bullet 2 live check (LIVE at M1-T3). Socket-resolved over the
 * fixture-time CONTRACT_KIT (the authored M2 manifest replaces it when it
 * lands): every door socket is measured against the M0-T2 channels and the
 * 5 mm hatch cap. Fails when a room spine-door does not land on its deck
 * spine-band socket, an engaged module-to-module pair is misaligned, or a
 * door opens onto another module's blank wall. Unjoined sockets that engage
 * nothing are legal (blanked) and counted in the pass detail.
 */
export const checkHatchAlignment: InvariantCheck = (spec: ShipSpec) => {
  const problems = hatchAlignmentProblems(spec, CONTRACT_KIT)
  if (problems.length > 0) {
    return { status: 'fail', detail: problems.join('; ') }
  }
  const { spineDoors, sideDoors } = doorTallies(spec, CONTRACT_KIT)
  return {
    status: 'pass',
    detail:
      `all ${spineDoors} room spine-doors land on their deck spine-band sockets within ` +
      `${SEAM_TOLERANCES.hatchAlignMm} mm on every channel (lateral/vertical/face); ` +
      `${sideDoors} side socket${sideDoors === 1 ? '' : 's'} unjoined ` +
      `(blanked — legal by the kit contract); no misaligned or wall-blocked mating pairs`,
  }
}

/**
 * Id of the vertical trunk module — the authored module flagged `shaft` (M2-T6
 * `spine`), which the assembler instantiates once per deck. Sourced from the
 * authored registry, never hard-coded: the band's identity is M2-T6's data.
 */
const SHAFT_BAND_ID =
  AUTHORED_MODULES.find((module) => module.shaft === true)?.manifest.id ?? 'spine'

/**
 * §8 bullet 1 live check (LIVE at M3-T2). "For every door-socket join and
 * bulkhead meet, the gap is < 2 mm" — measured on the ASSEMBLED geometry: the
 * assembler generates the mating/closing geometry from the sockets
 * (src/assembler/seams.ts) and this check reads its verdicts — the sleeve gap
 * at every join, its coverage of the contact annulus, its bite past both wall
 * planes, that it never enters the pass-through, that every blanked socket
 * nothing else seals is plugged through its wall, and that module faces which
 * engage without a door socket between them are gap-free.
 *
 * It assembles the spec itself (the harness hands checks a spec, not a ship),
 * with the validator gate off so a REJECTED rig still reports its assembled
 * seam verdict instead of throwing — the validator stays the accept/reject
 * gate for "would this ship walk", this check is the geometry's own view.
 */
export const checkSeamsWatertight: InvariantCheck = (spec: ShipSpec) => {
  let ship: ShipAssembly
  try {
    ship = assembleShip(spec, { requireValidSpec: false })
  } catch (error) {
    return {
      status: 'fail',
      detail:
        `the ship cannot be assembled, so its seams cannot be measured: ` +
        `${error instanceof Error ? error.message : String(error)}`,
    }
  }

  const problems = seamsWatertightProblems(ship)
  if (problems.length > 0) {
    return { status: 'fail', detail: problems.join('; ') }
  }

  const tally = seamTally(ship)
  return {
    status: 'pass',
    detail:
      `every one of the ${tally.joins} door-socket join${tally.joins === 1 ? '' : 's'} is ` +
      `sleeved from its sockets and measured watertight: max gap ${tally.maxGapMm.toFixed(1)} mm ` +
      `(< ${SEAM_TOLERANCES.watertightGapMm} mm cap), min bite past the mating wall planes ` +
      `${(tally.minBiteM / MM).toFixed(1)} mm, no sleeve entering a pass-through and no ` +
      `engaging bulkhead meet left unsealed; of ${tally.blanks} blanked socket` +
      `${tally.blanks === 1 ? '' : 's'}, ${tally.hatchSealed} sealed by their own module's ` +
      `hatch and ${tally.plugged} plugged from the socket (${tally.parts} generated seam parts)`,
  }
}

/**
 * §8 bullet 4 live check (LIVE at M3-T3). "Collision hull matches visible
 * geometry within 10 cm per deck" — measured on the ASSEMBLED ship: the deck
 * hull is the modules' own collision hints placed (one box per solid part,
 * M2) plus the generated blanking plugs (M3-T2), and this check reads the
 * assembler's verdict on it (src/assembler/collision.ts) — every hull box is
 * accounted for one-for-one with the geometry it stands for, differs from it
 * by ≤ 10 cm in both directions (uncovered: a clippable wall; excess: an
 * invisible wall), and stands clear of every door-socket pass-through (the
 * walker can pass between mated modules).
 *
 * Like the seams check it assembles the spec itself (the harness hands checks
 * a spec, not a ship), with the validator gate off so a REJECTED rig still
 * reports its hull verdict instead of throwing.
 */
export const checkCollisionMatch: InvariantCheck = (spec: ShipSpec) => {
  let ship: ShipAssembly
  try {
    ship = assembleShip(spec, { requireValidSpec: false })
  } catch (error) {
    return {
      status: 'fail',
      detail:
        `the ship cannot be assembled, so its collision hull cannot be measured: ` +
        `${error instanceof Error ? error.message : String(error)}`,
    }
  }

  const problems = collisionProblems(ship)
  if (problems.length > 0) {
    return { status: 'fail', detail: problems.join('; ') }
  }

  const tally = collisionTally(ship)
  const capMm = COLLISION_MATCH_TOLERANCE_M / MM
  return {
    status: 'pass',
    detail:
      `every deck's hull matches its visible geometry: ${tally.boxes} box(es) ` +
      `(${tally.moduleBoxes} placed module hint${tally.moduleBoxes === 1 ? '' : 's'} + ` +
      `${tally.seamBoxes} generated plug${tally.seamBoxes === 1 ? '' : 's'}) over ` +
      `${tally.decks.length} deck${tally.decks.length === 1 ? '' : 's'}, max deviation ` +
      `${(tally.maxDeviationM / MM).toFixed(1)} mm (cap ≤ ${capMm} mm per deck), and all ` +
      `${tally.joins} door-socket pass-through${tally.joins === 1 ? '' : 's'} left clear of ` +
      `hull boxes (max intrusion ${(tally.maxIntrusionM / MM).toFixed(1)} mm)`,
  }
}

/**
 * §8 bullet 6 rule: every module INSTANCE in the spec carries ≥1 light fixture
 * — no legally-dark room. Instances are the spec's module refs PLUS the implicit
 * per-deck spine band (M2-T6: the assembler synthesizes one band per deck, so a
 * dark shaft is a dark room), and the fixtures come from the AUTHORED kit's
 * light sockets (M2-T7 — light sockets are M2 data).
 *
 * Fails on: a ref whose module type is not in the kit (its fixtures are unknown
 * — the room is unaccounted for), a ref'd module with zero light sockets, the
 * shaft band with zero light sockets, and a spec with no module instances at all.
 */
export function roomLitProblems(
  spec: ShipSpec,
  kit: KitManifest = AUTHORED_KIT,
): string[] {
  const problems: string[] = []
  const { roomInstances, bands } = roomLightTally(spec, kit)

  if (roomInstances === 0) {
    problems.push('spec has no module instances — there is no room to light')
    return problems
  }
  if (bands === 0) {
    problems.push('the spine run has no shaft band — the trunk between decks is unlit')
  }

  spec.decks.forEach((deck, index) => {
    for (const ref of deck.modules) {
      const entry = kit.modules.find((module) => module.id === ref.moduleId)
      if (entry === undefined) {
        problems.push(
          `deck ${index} (${deck.id}): module "${ref.moduleId}" is not in the kit — ` +
            `its light fixtures are unknown, so the room cannot be proven lit`,
        )
        continue
      }
      if (entry.lightSockets.length === 0) {
        problems.push(
          `deck ${index} (${deck.id}): module "${ref.moduleId}" has no light socket — ` +
            `a legally-dark room in the spec`,
        )
      }
    }
  })

  const band = kit.modules.find((module) => module.id === SHAFT_BAND_ID)
  if (band !== undefined && band.lightSockets.length === 0) {
    problems.push(
      `the shaft band ("${SHAFT_BAND_ID}") has no light socket — every deck's trunk is dark`,
    )
  }

  return problems
}

/** Instance + fixture tallies for the room-lit check's report line. */
export function roomLightTally(
  spec: ShipSpec,
  kit: KitManifest = AUTHORED_KIT,
): { roomInstances: number; bandInstances: number; bands: number; fixtures: number } {
  const fixturesOf = (moduleId: string): number =>
    kit.modules.find((module) => module.id === moduleId)?.lightSockets.length ?? 0

  let roomInstances = 0
  let fixtures = 0
  for (const deck of spec.decks) {
    for (const ref of deck.modules) {
      roomInstances += 1
      fixtures += fixturesOf(ref.moduleId)
    }
  }

  // One implicit shaft band per deck (M2-T6); a spec with no decks has none.
  const bands = spec.decks.length
  return {
    roomInstances,
    bandInstances: bands,
    bands,
    fixtures: fixtures + bands * fixturesOf(SHAFT_BAND_ID),
  }
}

/**
 * §8 bullet 6 live check (LIVE at M2-T7). "Every module instance has ≥ 1 light
 * fixture (no legally-dark room in the spec)" — measured over the AUTHORED kit,
 * which is the first kit that carries light sockets at all.
 */
export const checkRoomLit: InvariantCheck = (spec: ShipSpec) => {
  const problems = roomLitProblems(spec)
  if (problems.length > 0) {
    return { status: 'fail', detail: problems.join('; ') }
  }
  const tally = roomLightTally(spec)
  return {
    status: 'pass',
    detail:
      `every module instance carries ≥ 1 light fixture: ${tally.roomInstances} room instance` +
      `${tally.roomInstances === 1 ? '' : 's'} + ${tally.bands} shaft band` +
      `${tally.bands === 1 ? '' : 's'} resolve to ${tally.fixtures} practical light sockets ` +
      `in the authored kit (M2-T7) — no spec-dark rooms`,
  }
}

/**
 * The live checks by invariant id. A stub invariant deliberately has NO
 * entry here; the harness reports stubs as `deferred` with their owner.
 * Live ids must equal liveInvariants() ids — pinned by invariants.test.ts.
 */
export const LIVE_CHECKS: Partial<Record<InvariantId, InvariantCheck>> = {
  'seams-watertight': checkSeamsWatertight,
  'hatch-alignment': checkHatchAlignment,
  'spine-connectivity': checkSpineConnectivity,
  'collision-match': checkCollisionMatch,
  'spawn-inside': checkSpawnInsideSpec,
  'room-lit': checkRoomLit,
}
