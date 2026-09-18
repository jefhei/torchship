/**
 * M3-T1 — the generated spine run (BUILD_PLAN M3-T1: "generate spine run").
 *
 * The vertical trunk is NEVER referenced by a spec (src/types/ship.ts: "the
 * spine shaft is not referenced — the assembler synthesizes one spine band per
 * deck"). This module is that synthesis: it finds the authored kit's shaft
 * module (the one flagged `shaft`, M2-T6 `spine`), places ONE BAND PER DECK at
 * the deck-local origin — the shaft axis runs through (x, z) = (0, 0) on every
 * deck (src/fixtures/layout.ts) — and pins the claim that makes the result a
 * RUN rather than a stack of unrelated boxes:
 *
 *   band i's top (floorY(i) + DECK_PITCH_M) IS band i−1's floor (floorY(i−1))
 *
 * because the band is authored one full deck pitch tall (`dimensions[1] ===
 * DECK_PITCH_M`, M2-T6) with the deck plate slab occupying the top 0.2 m —
 * the slab every deck's plate occupies, so the ladder phase is continuous
 * across a deck boundary (last rung at 3.0 → deck above's floor at 3.2 → its
 * first rung at 3.5).
 *
 * `spineRunProblems` is the run's own tiling check (measured from the deck
 * floors, mm): it is the VERTICAL half of PRD §8 bullet 3 as the assembled
 * geometry sees it. The socket-resolved seat rule and the §8 endpoints are the
 * validator's (src/validation/validator.ts) and the invariant harness's
 * (src/invariants/checks.ts) — this module adds no second opinion on those.
 */

import { DECK_PITCH_M, MM } from '../types'
import type { ModuleRef, Rotation, ShipSpec, Vec3 } from '../types'
import { SEAM_TOLERANCES } from '../spikes/seams/tolerances'
import type { AuthoredModule } from '../kit/modules/types'
import type { SpineBandRun } from './types'

/** The authored shaft band of a kit (throws when the kit has no `shaft` module). */
export function shaftModuleOf(modules: readonly AuthoredModule[]): AuthoredModule {
  const band = modules.find((module) => module.shaft === true)
  if (band === undefined) {
    const known = modules.map((module) => module.manifest.id).join(', ')
    throw new Error(
      `assembler: the kit has no shaft module (none is flagged \`shaft\`) — ` +
        `the spine run cannot be generated (known modules: ${known})`,
    )
  }
  return band
}

/**
 * The implicit ref a band is instantiated with: the deck-local origin, no yaw.
 * A synthesized `ModuleRef` so the band travels the exact same placement path
 * as a spec ref (moduleOrigin → placeParts) — it can never be special-cased
 * into a divergent frame.
 */
export function bandRef(modules: readonly AuthoredModule[]): ModuleRef {
  return {
    moduleId: shaftModuleOf(modules).manifest.id,
    rotation: 0,
    offset: [0, 0, 0],
  }
}

/** The world position of a deck's band origin: the shaft axis on that floor. */
export function bandPosition(floorY: number): Vec3 {
  return [0, floorY, 0]
}

/** One generated band per deck, nose → aft (the order the decks are stacked in). */
export function spineRun(spec: ShipSpec): SpineBandRun[] {
  const rotation: Rotation = 0
  return spec.decks.map((deck, deckIndex) => ({
    deckIndex,
    deckId: deck.id,
    floorY: deck.yPosition,
    position: bandPosition(deck.yPosition),
    rotation,
  }))
}

/**
 * Run-tiling problems, mm: consecutive bands must meet at the deck pitch
 * (band i's top = band i+1's floor), or the ladder run steps by the error.
 * Empty = the generated run is continuous. Uses the M0-T2 measured hatch cap
 * for the "is this a step" decision — never a re-derived number.
 */
export function spineRunProblems(spec: ShipSpec): string[] {
  const problems: string[] = []
  for (let i = 1; i < spec.decks.length; i++) {
    const above = spec.decks[i - 1]
    const here = spec.decks[i]
    const pitchM = above.yPosition - here.yPosition
    const stepMm = Math.round(Math.abs(pitchM - DECK_PITCH_M) / MM)
    if (stepMm > SEAM_TOLERANCES.hatchAlignMm) {
      problems.push(
        `deck ${i} ("${here.id}"): the shaft run steps ${stepMm.toFixed(1)} mm between the ` +
          `"${above.id}" band and this deck's band (floor ${here.yPosition} m is ` +
          `${(pitchM - DECK_PITCH_M).toFixed(3)} m off the ${DECK_PITCH_M} m pitch) — ` +
          `the ladder phase breaks here`,
      )
    }
  }
  return problems
}
