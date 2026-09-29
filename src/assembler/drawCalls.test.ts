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
      ['head', 121, 12, 109, 6, 31, 37],
      ['crew', 152, 30, 122, 6, 33, 39],
      ['ops', 144, 34, 110, 6, 30, 36],
      ['engineering', 151, 39, 112, 8, 30, 38],
      ['aft', 204, 22, 182, 7, 29, 36],
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
      ['patrol', 186, 64, 'crew', 39],
      ['long-haul', 221, 29, 'crew', 40],
      ['science', 185, 65, 'crew', 39],
      ['stress', 204, 46, 'rig-3', 55],
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
    expect(tally.total).toBe(186)
    expect(tally.headroom).toBe(DRAW_CALL_CEILING - 186)
    expect(tally.rows).toHaveLength(5)
  })

  it('honours an injected ceiling (the budget M4 measures its passes against)', () => {
    const tally = drawCallTally(assembleShip(SCIENCE_SPEC), 200)
    expect(tally.ceiling).toBe(200)
    expect(tally.headroom).toBe(15)
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
    expect(drawCallProblems(patrol, 186)).toEqual([])
  })

  it('reports the ship total and the worst deck when the budget is blown', () => {
    const problems = drawCallProblems(assembleShip(PATROL_SPEC), 185)
    expect(problems).toHaveLength(1)
    expect(problems[0]).toMatch(
      /ship "Firebrand" draws 186 draw call\(s\) — over the 185-call ceiling \(§10, after merging \+ instancing\) \(worst deck 1 "crew" at 39\)/,
    )
  })

  it('names the over-ceiling decks, not just the ship', () => {
    const problems = drawCallProblems(assembleShip(PATROL_SPEC), 36)
    // The ship total, then each deck that costs more than 36 on its own: head
    // 37, crew 39, engineering 38 (ops and aft each sit exactly on 36 — legal).
    expect(problems).toHaveLength(4)
    expect(problems[0]).toMatch(/draws 186 draw call\(s\) — over the 36-call ceiling/)
    expect(problems.slice(1)).toEqual([
      'deck 0 ("head") draws 37 draw call(s) — over the 36-call ceiling on its own',
      'deck 1 ("crew") draws 39 draw call(s) — over the 36-call ceiling on its own',
      'deck 3 ("engineering") draws 38 draw call(s) — over the 36-call ceiling on its own',
    ])
    // A ceiling no deck exceeds leaves only the ship-total finding.
    expect(drawCallProblems(assembleShip(PATROL_SPEC), 39)).toEqual([
      'ship "Firebrand" draws 186 draw call(s) — over the 39-call ceiling ' +
        '(§10, after merging + instancing) (worst deck 1 "crew" at 39)',
    ])
  })

  it('measures the QA rig too (a rejected spec still gets a budget verdict)', () => {
    const rig = assembleShip(STRESS_SPEC, { requireValidSpec: false })
    expect(drawCallTally(rig).total).toBe(204)
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

  it('fails an over-ceiling partition: no merging at all is 290 calls on Patrol', () => {
    // `minInstances: 1` gives every distinct mould its own batch — merging
    // turned off (the pre-M3-T7 shape of the problem: one mesh per part).
    const perPart = assembleShip(PATROL_SPEC, { minInstances: 1 })
    const tally = drawCallTally(perPart)
    expect(tally.total).toBe(290)
    expect(tally.headroom).toBe(DRAW_CALL_CEILING - 290)
    expect(tally.rows.every((row) => row.groups === 0)).toBe(true)

    const problems = assemblyProblems(perPart, 1)
    expect(problems).toContain(
      'ship "Firebrand" draws 290 draw call(s) — over the 250-call ceiling ' +
        '(§10, after merging + instancing) (worst deck 3 "engineering" at 69)',
    )
    expect(problems.filter((problem) => /on its own/.test(problem))).toEqual([]) // 69 < 250: the failure is the ship's total, not one deck's
    // The clean default partition of the same ship stays clean.
    expect(assemblyProblems(assembleShip(PATROL_SPEC))).toEqual([])
  })
})

describe('the long-haul stretch is the tightest ship', () => {
  it('stays under the ceiling with 29 calls of headroom', () => {
    const tally = drawCallTally(assembleShip(LONG_HAUL_SPEC))
    expect(tally.rows).toHaveLength(6)
    expect(tally.total).toBe(221)
    expect(tally.headroom).toBe(29)
    expect(drawCallProblems(assembleShip(LONG_HAUL_SPEC))).toEqual([])
  })
})
