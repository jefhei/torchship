/**
 * M4-T4 — the worn-detail report (the pass's own two-sided ledger).
 *
 * BUILD_PLAN M4-T4 is measured against the numbers the earlier M4 tasks
 * produced: M3-T7's `drawCallTally` headroom (Patrol had 71 calls spare before
 * the pass) and M4-T1's `materialSetReport` slot ledger. `wearReport` stitches
 * the same three views together so the pass can never be argued about:
 *
 *  - how many plans and parts each deck gained, per facet (clutter / paint /
 *    cable) — the density rung actually applied;
 *  - what those parts COST: the deck's draw calls with the pass and without it
 *    (the same spec assembled at `wearDensity: 'off'`), summed into a ship
 *    total against the §10 ceiling — a real measurement, because the partition
 *    (merge vs instance) decides the cost, not the part count;
 *  - the §4 slot ledger stays closed: the pass draws only slots the theme
 *    already assigns, and never the reserved `coffee-accent` (wear/checks.ts).
 */

import { DRAW_CALL_CEILING } from '../assembler/drawCalls'
import type { ShipAssembly, WearDensity, WearFacet } from '../assembler/types'
import { wearDrawCallDelta, wearProblems } from './checks'
import type { DeckWearTally } from './checks'
import { WEAR_DENSITY_LEVELS, WEAR_FACETS } from './recipes'

/** The pass, measured on one assembled ship. */
export interface WearReport {
  ship: string
  seed: number
  density: WearDensity
  /** The density rung's authored per-module quota (what was asked for). */
  quota: { paint: number; cable: number; clutter: number }
  decks: DeckWearTally[]
  plans: number
  parts: number
  /** Plans per facet, in WEAR_FACETS order. */
  byFacet: Record<WearFacet, number>
  /** Authored variant ids the ship actually used, sorted (report key). */
  variants: string[]
  /** Draw calls with the pass on / with it off, and the difference. */
  withWear: number
  withoutWear: number
  addedCalls: number
  ceiling: number
  headroom: number
  problems: string[]
  detail: string
}

/** The pass's ledger for an assembled ship, problems included. */
export function wearReport(ship: ShipAssembly): WearReport {
  const cost = wearDrawCallDelta(ship)
  const problems = wearProblems(ship, cost)

  const byFacet = { paint: 0, cable: 0, clutter: 0 } as Record<WearFacet, number>
  const variants = new Set<string>()
  let plans = 0
  let parts = 0
  for (const deck of ship.decks) {
    for (const plan of deck.wear) {
      plans += 1
      parts += plan.parts.length
      byFacet[plan.facet] += 1
      variants.add(plan.variant)
    }
  }

  const tally = `${byFacet.paint} paint + ${byFacet.cable} cable + ${byFacet.clutter} clutter`
  const detail =
    `${ship.spec.name} (seed ${ship.spec.seed}, density "${ship.wearDensity}"): ` +
    `${plans} worn-detail plan(s) / ${parts} part(s) over ${ship.decks.length} deck(s) ` +
    `(${tally}); the pass costs ${cost.addedCalls} draw call(s) (${cost.withWear} with it, ` +
    `${cost.withoutWear} without) against the ${DRAW_CALL_CEILING}-call ceiling, ` +
    `headroom ${DRAW_CALL_CEILING - cost.withWear}`

  return {
    ship: ship.spec.name,
    seed: ship.spec.seed,
    density: ship.wearDensity,
    quota: WEAR_DENSITY_LEVELS[ship.wearDensity],
    decks: cost.rows,
    plans,
    parts,
    byFacet,
    variants: [...variants].sort(),
    withWear: cost.withWear,
    withoutWear: cost.withoutWear,
    addedCalls: cost.addedCalls,
    ceiling: DRAW_CALL_CEILING,
    headroom: DRAW_CALL_CEILING - cost.withWear,
    problems,
    detail,
  }
}

/** The facet names in report order (a re-export for report consumers). */
export const WEAR_REPORT_FACETS: readonly WearFacet[] = WEAR_FACETS
