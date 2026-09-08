/**
 * M0-T6 — live spec-level implementations of two PRD §8 [auto] invariants.
 *
 * The M0 fixture data (ShipSpec + the layout contract) supports REAL checks
 * for two bullets today; the other four are declared targets in registry.ts
 * until their owner milestone supplies the missing input (assembled
 * geometry, kit sockets, hulls, light sockets):
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
 *    graph reachability over deck adjacency. This is the coarse spec-level
 *    half; M1-T3 refines it with the socket-resolved module graph.
 *
 *  - checkSpawnInsideSpec    (§8 bullet 5, 'spawn-inside', spec facet): the
 *    spawn deck (index 1 by the deck-plan contract — PRD §6 "spawn on the
 *    crew deck at the foot of the spine", M3-T6) exists and hosts a galley
 *    seated at the spine foot. The geometric containment half (spawn point
 *    inside the deck, not intersecting hulls) needs collision geometry and
 *    is M3-T6's.
 *
 * Both are wired into the harness via LIVE_CHECKS; a stub invariant has no
 * entry here, which is what makes the harness report it `deferred`.
 */

import type { InvariantCheck, InvariantId } from './registry'
import {
  deckGridErrorMm,
  deckHosts,
  deckSeatSummary,
  findDeckHosting,
  moduleSeatProblems,
} from './specAnalysis'
import { SEAM_TOLERANCES } from '../spikes/seams/tolerances'
import type { ShipSpec } from '../types'

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
 * The live checks by invariant id. A stub invariant deliberately has NO
 * entry here; the harness reports stubs as `deferred` with their owner.
 * Live ids must equal liveInvariants() ids — pinned by invariants.test.ts.
 */
export const LIVE_CHECKS: Partial<Record<InvariantId, InvariantCheck>> = {
  'spine-connectivity': checkSpineConnectivity,
  'spawn-inside': checkSpawnInsideSpec,
}
