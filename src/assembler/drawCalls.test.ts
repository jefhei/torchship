/**
 * M3-T7 — draw-call measurement tests (src/assembler/drawCalls.ts).
 *
 * The M3 machine gate's second half is "draw calls under ceiling": ≤ 250 after
 * merging deck geometry + instancing (PRD §10, §11). These tests pin the
 * ceiling, the measured numbers on all four canonical ships, and — the part
 * that makes it a gate rather than a comment — that the assembler's own
 * `assemblyProblems` reports an over-ceiling partition (rule 12), demonstrated
 * by assembling Patrol with the instancing knob turned off (`minInstances: 1`,
 * the pre-M3-T7 per-part behaviour) which measures 300 calls.
 *
 * The identity that ties the number to the renderer (`deckDrawPlan(deck).length
 * === deckDrawCalls(deck)`) is pinned per deck in src/player/deckGeometry.test.ts,
 * where the geometry actually exists.
 */

import { describe, expect, it } from 'vitest'
import {
  LONG_HAUL_SPEC,
  PATROL_SPEC,
  SCIENCE_SPEC,
  SHIP_FIXTURES,
  STRESS_SPEC,
} from '../fixtures'
import type { ShipFixture } from '../fixtures'
import { assembleShip } from './assemble'
import { assemblyProblems } from './checks'
import {
  DRAW_CALL_CEILING,
  deckDrawCalls,
  drawCallProblems,
  drawCallRows,
  drawCallTally,
} from './drawCalls'
import type { ShipAssembly } from './types'

function shipOf(fixture: ShipFixture): ShipAssembly {
  return assembleShip(fixture.spec, { requireValidSpec: fixture.expectValid })
}

/** Placed parts a deck's partition accounts for (merged + instanced). */
function partitionedParts(deck: ShipAssembly['decks'][number]): number {
  return (
    deck.groups.reduce((sum, plan) => sum + plan.parts.length, 0) +
    deck.batches.reduce((sum, plan) => sum + plan.parts.length, 0)
  )
}

describe('the ceiling', () => {
  it('is the PRD §10 budget line: 250 draw calls', () => {
    expect(DRAW_CALL_CEILING).toBe(250)
  })
})

describe('deckDrawCalls', () => {
  it('reads the partition the renderer draws: one call per group and per batch', () => {
    for (const fixture of SHIP_FIXTURES) {
      const ship = shipOf(fixture)
      for (const deck of ship.decks) {
        expect(deckDrawCalls(deck), fixture.id).toBe(
          deck.groups.length + deck.batches.length,
        )
      }
    }
  })

  it('is never more calls than the deck has parts (a partition can only merge)', () => {
    for (const fixture of SHIP_FIXTURES) {
      for (const deck of shipOf(fixture).decks) {
        expect(deckDrawCalls(deck)).toBeLessThanOrEqual(partitionedParts(deck))
      }
    }
  })
})

describe('drawCallRows', () => {
  it('accounts for every placed part exactly once, per deck', () => {
    for (const fixture of SHIP_FIXTURES) {
      for (const row of drawCallRows(shipOf(fixture))) {
        expect(row.mergedParts + row.instancedParts, fixture.id).toBe(row.parts)
      }
    }
  })

  it('pins Patrol deck by deck (the measured partition)', () => {
    const rows = drawCallRows(assembleShip(PATROL_SPEC))
    expect(
      rows.map((row) => [
        row.deckId,
        row.parts,
        row.mergedParts,
        row.instancedParts,
        row.groups,
        row.batches,
        row.calls,
      ]),
    ).toEqual([
      ['head', 116, 9, 107, 5, 30, 35],
      ['crew', 145, 25, 120, 6, 32, 38],
      ['ops', 136, 26, 110, 6, 30, 36],
      ['engineering', 143, 33, 110, 7, 29, 36],
      ['aft', 196, 14, 182, 5, 29, 34],
    ])
    expect(rows.map((row) => row.label)).toEqual([
      'Head — bridge',
      'Crew deck — galley & bunks',
      'Ops deck — airlock, suit locker, med bay',
      'Engineering — reactor & drive glow',
      'Aft hold — cargo & spares',
    ])
  })

  it('sums to the ship total, deck order preserved', () => {
    for (const fixture of SHIP_FIXTURES) {
      const ship = shipOf(fixture)
      const rows = drawCallRows(ship)
      expect(rows.map((row) => row.deckIndex)).toEqual(
        ship.decks.map((deck) => deck.deckIndex),
      )
      expect(rows.reduce((sum, row) => sum + row.calls, 0)).toBe(
        drawCallTally(ship).total,
      )
    }
  })
})

describe('drawCallTally', () => {
  it('measures all four canonical ships under the ceiling (the M3 machine gate)', () => {
    const measured = SHIP_FIXTURES.map((fixture) => {
      const tally = drawCallTally(shipOf(fixture))
      return [
        fixture.id,
        tally.total,
        tally.headroom,
        tally.worstDeck?.deckId,
        tally.worstDeck?.calls,
      ]
    })
    expect(measured).toEqual([
      ['patrol', 179, 71, 'crew', 38],
      ['long-haul', 213, 37, 'crew', 38],
      ['science', 181, 69, 'crew', 38],
      ['stress', 194, 56, 'rig-3', 51],
    ])
    for (const fixture of SHIP_FIXTURES) {
      const tally = drawCallTally(shipOf(fixture))
      expect(tally.total, fixture.id).toBeLessThanOrEqual(DRAW_CALL_CEILING)
      expect(tally.ceiling).toBe(DRAW_CALL_CEILING)
    }
  })

  it('names the ship and reports the budget arithmetic', () => {
    const tally = drawCallTally(assembleShip(PATROL_SPEC))
    expect(tally.ship).toBe('Firebrand')
    expect(tally.total).toBe(179)
    expect(tally.headroom).toBe(DRAW_CALL_CEILING - 179)
    expect(tally.rows).toHaveLength(5)
  })

  it('honours an injected ceiling (the budget M4 adds clutter against)', () => {
    const tally = drawCallTally(assembleShip(SCIENCE_SPEC), 200)
    expect(tally.ceiling).toBe(200)
    expect(tally.headroom).toBe(19)
  })
})

describe('drawCallProblems', () => {
  it('is empty for every canonical ship', () => {
    for (const fixture of SHIP_FIXTURES) {
      expect(drawCallProblems(shipOf(fixture)), fixture.id).toEqual([])
    }
  })

  it('passes a ship sitting exactly ON the ceiling (≤ 250, not < 250)', () => {
    const patrol = assembleShip(PATROL_SPEC)
    expect(drawCallProblems(patrol, 179)).toEqual([])
  })

  it('reports the ship total and the worst deck when the budget is blown', () => {
    const problems = drawCallProblems(assembleShip(PATROL_SPEC), 178)
    expect(problems).toHaveLength(1)
    expect(problems[0]).toMatch(
      /ship "Firebrand" draws 179 draw call\(s\) — over the 178-call ceiling \(§10, after merging \+ instancing\) \(worst deck 1 "crew" at 38\)/,
    )
  })

  it('names a single over-ceiling deck, not just the ship', () => {
    const problems = drawCallProblems(assembleShip(PATROL_SPEC), 36)
    expect(problems).toHaveLength(2)
    expect(problems[0]).toMatch(/draws 179 draw call\(s\) — over the 36-call ceiling/)
    expect(problems[1]).toMatch(
      /deck 1 \("crew"\) draws 38 draw call\(s\) — over the 36-call ceiling on its own/,
    )
  })

  it('measures the QA rig too (a rejected spec still gets a budget verdict)', () => {
    const rig = assembleShip(STRESS_SPEC, { requireValidSpec: false })
    expect(drawCallTally(rig).total).toBe(194)
    expect(drawCallProblems(rig)).toEqual([])
  })
})

describe('the assembler gate carries the ceiling (rule 12)', () => {
  it('says nothing about draw calls for a clean ship', () => {
    for (const fixture of SHIP_FIXTURES) {
      const problems = assemblyProblems(shipOf(fixture))
      expect(
        problems.filter((problem) => /draw call/.test(problem)),
        fixture.id,
      ).toEqual([])
    }
  })

  it('fails an over-ceiling partition: no merging at all is 257 calls on Patrol', () => {
    // `minInstances: 1` gives every distinct mould its own batch — merging
    // turned off (the pre-M3-T7 shape of the problem: one mesh per part).
    const perPart = assembleShip(PATROL_SPEC, { minInstances: 1 })
    const tally = drawCallTally(perPart)
    expect(tally.total).toBe(257)
    expect(tally.headroom).toBe(DRAW_CALL_CEILING - 257)
    expect(tally.rows.every((row) => row.groups === 0)).toBe(true)

    const problems = assemblyProblems(perPart, 1)
    expect(problems).toContain(
      'ship "Firebrand" draws 257 draw call(s) — over the 250-call ceiling ' +
        '(§10, after merging + instancing) (worst deck 3 "engineering" at 62)',
    )
    expect(problems.filter((problem) => /on its own/.test(problem))).toEqual([]) // 62 < 250: the failure is the ship's total, not one deck's
    // The clean default partition of the same ship stays clean.
    expect(assemblyProblems(assembleShip(PATROL_SPEC))).toEqual([])
  })
})

describe('the long-haul stretch is the tightest ship', () => {
  it('stays under the ceiling with 37 calls of headroom', () => {
    const tally = drawCallTally(assembleShip(LONG_HAUL_SPEC))
    expect(tally.rows).toHaveLength(6)
    expect(tally.total).toBe(213)
    expect(tally.headroom).toBe(37)
    expect(drawCallProblems(assembleShip(LONG_HAUL_SPEC))).toEqual([])
  })
})
