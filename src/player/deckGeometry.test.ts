/**
 * M3-T7 — the deck draw-call plan tests (src/player/deckGeometry.ts).
 *
 * This is where the ceiling's proof lives. `src/assembler/drawCalls.ts` counts
 * `groups + batches`; these tests build the actual GL geometry the renderer
 * mounts and check, on EVERY deck of ALL FOUR canonical ships, that:
 *
 *  - the plan has exactly that many entries — one merged mesh per slot group,
 *    one `InstancedMesh` per batch, named and slotted by the scene graph's own
 *    ids (`deck-${i}-${slot}`, `deck-${i}-batch-${n}`), nothing skipped;
 *  - a merged call's geometry is the union of its group's parts, and a merged
 *    call is never handed an empty group (no phantom draw call);
 *  - an instanced call's mould + each of its placements reproduces that
 *    instance's world part exactly (the three.js form of the assembler's
 *    `placePart(mouldOf(shape), placementFor(shape, part)) ≡ world part` pin) —
 *    so swapping per-part meshes for instancing cannot move or resize anything;
 *  - together they draw every placed part exactly once, and the ship stays
 *    under the §10 250-call ceiling.
 *
 * The tolerance is float32: three stores vertex positions single-precision, so
 * a GL bounding box and the analytic `partBounds` agree to ~1e-7 relative, not
 * to the last double.
 */

import { describe, expect, it, vi } from 'vitest'
import { SHIP_FIXTURES } from '../fixtures'
import type { ShipFixture } from '../fixtures'
import {
  DRAW_CALL_CEILING,
  assembleShip,
  deckDrawCalls,
  drawCallRows,
  placedPartsOf,
} from '../assembler'
import type { DeckAssembly, PlacedPart, ShipAssembly } from '../assembler'
import { partBounds } from '../kit/parts'
import { geometryBounds, partGeometry, placementMatrix } from '../kit/render'
import type { Aabb3 } from '../types'
import { deckDrawPlan, disposeDrawPlan } from './deckGeometry'

const FLOAT32_DIGITS = 5

function expectBoxClose(actual: Aabb3, expected: Aabb3, label?: string): void {
  ;(['min', 'max'] as const).forEach((edge) => {
    actual[edge].forEach((value, axis) => {
      expect(value, `${label ?? ''} ${edge}[${axis}]`.trim()).toBeCloseTo(
        expected[edge][axis],
        FLOAT32_DIGITS,
      )
    })
  })
}

/** The union of a part list's analytic bounds (the box a merged group spans). */
function unionBounds(parts: readonly PlacedPart[]): Aabb3 {
  const lo: number[] = [Infinity, Infinity, Infinity]
  const hi: number[] = [-Infinity, -Infinity, -Infinity]
  for (const entry of parts) {
    const bounds = partBounds(entry.part)
    bounds.min.forEach((value, axis) => {
      lo[axis] = Math.min(lo[axis], value)
    })
    bounds.max.forEach((value, axis) => {
      hi[axis] = Math.max(hi[axis], value)
    })
  }
  return { min: [lo[0], lo[1], lo[2]], max: [hi[0], hi[1], hi[2]] }
}

function shipOf(fixture: ShipFixture): ShipAssembly {
  return assembleShip(fixture.spec, { requireValidSpec: fixture.expectValid })
}

/** Every deck of every canonical ship, labelled `fixture/deck` for messages. */
function allDecks(): { id: string; deck: DeckAssembly }[] {
  const decks: { id: string; deck: DeckAssembly }[] = []
  for (const fixture of SHIP_FIXTURES) {
    for (const deck of shipOf(fixture).decks) {
      decks.push({ id: `${fixture.id}/${deck.deckId}`, deck })
    }
  }
  return decks
}

describe('deckDrawPlan', () => {
  it('issues exactly one call per merged group and per instanced batch', () => {
    for (const { id, deck } of allDecks()) {
      const plan = deckDrawPlan(deck)
      expect(plan.length, id).toBe(deckDrawCalls(deck))
      expect(plan.filter((call) => call.kind === 'merged').length, id).toBe(
        deck.groups.length,
      )
      expect(plan.filter((call) => call.kind === 'instanced').length, id).toBe(
        deck.batches.length,
      )
    }
  })

  it('names and slots its calls by the scene graph (the export contract)', () => {
    for (const { id, deck } of allDecks()) {
      const plan = deckDrawPlan(deck)
      const expectedIds = [
        ...deck.groups.map((group) => group.group.id),
        ...deck.batches.map((batch) => batch.batch.id),
      ]
      expect(
        plan.map((call) => call.id),
        id,
      ).toEqual(expectedIds)
      const slots = new Map<string, string>()
      for (const group of deck.groups) {
        slots.set(group.group.id, group.group.materialSlot)
      }
      for (const batch of deck.batches) {
        slots.set(batch.batch.id, batch.batch.materialSlot)
      }
      for (const call of plan) {
        expect(call.id.startsWith(`deck-${deck.deckIndex}-`), `${id} ${call.id}`).toBe(
          true,
        )
        expect(call.materialSlot, `${id} ${call.id}`).toBe(slots.get(call.id))
      }
    }
  })

  it('draws every placed part exactly once across its calls', () => {
    for (const { id, deck } of allDecks()) {
      const plan = deckDrawPlan(deck)
      const merged = plan.filter((call) => call.kind === 'merged')
      const instanced = plan.filter((call) => call.kind === 'instanced')
      const mergedParts = deck.groups.reduce(
        (sum, group) => sum + group.parts.length,
        0,
      )
      const instancedParts = deck.batches.reduce(
        (sum, batch) => sum + batch.parts.length,
        0,
      )
      expect(mergedParts + instancedParts, id).toBe(placedPartsOf(deck).length)
      // Every merged call is the whole group it stands for (no group skipped).
      merged.forEach((call, index) => {
        const vertices = deck.groups[index].parts.reduce(
          (sum, entry) => sum + partGeometry(entry.part).attributes.position.count,
          0,
        )
        expect(call.geometry.attributes.position.count, `${id} ${call.id}`).toBe(
          vertices,
        )
      })
      // Every instanced call carries its own batch's placements, one per part.
      instanced.forEach((call, index) => {
        expect(call.placements).toBe(deck.batches[index].batch.placements)
        expect(call.placements.length, `${id} ${call.id}`).toBe(
          deck.batches[index].parts.length,
        )
      })
    }
  })

  it('merges each group into the union of its parts', () => {
    for (const { id, deck } of allDecks()) {
      const merged = deckDrawPlan(deck).filter((call) => call.kind === 'merged')
      deck.groups.forEach((group, index) => {
        expect(group.parts.length, `${id} group ${index}`).toBeGreaterThan(0)
        expectBoxClose(geometryBounds(merged[index].geometry), unionBounds(group.parts))
      })
    }
  })

  it('instances each batch from a mould that reproduces every world part', () => {
    for (const { id, deck } of allDecks()) {
      const instanced = deckDrawPlan(deck).filter((call) => call.kind === 'instanced')
      deck.batches.forEach((batch, batchIndex) => {
        const call = instanced[batchIndex]
        batch.parts.forEach((entry, instance) => {
          const geometry = call.geometry.clone()
          geometry.applyMatrix4(placementMatrix(call.placements[instance]))
          expectBoxClose(
            geometryBounds(geometry),
            partBounds(entry.part),
            `${id} ${call.id} instance ${instance}`,
          )
          geometry.dispose()
        })
      })
    }
  })

  it('is deterministic (a re-render must not change what is drawn)', () => {
    const planFor = () => deckDrawPlan(shipOf(SHIP_FIXTURES[0]).decks[1])
    const first = planFor()
    const second = planFor()
    expect(second.map((call) => [call.id, call.kind])).toEqual(
      first.map((call) => [call.id, call.kind]),
    )
    expectBoxClose(
      geometryBounds(second[1].geometry),
      geometryBounds(first[1].geometry),
    )
  })
})

describe('the frame budget at the renderer', () => {
  it('draws every canonical ship under the 250-call ceiling', () => {
    for (const fixture of SHIP_FIXTURES) {
      const ship = shipOf(fixture)
      const calls = ship.decks.reduce((sum, deck) => sum + deckDrawPlan(deck).length, 0)
      expect(calls, fixture.id).toBe(
        drawCallRows(ship).reduce((sum, row) => sum + row.calls, 0),
      )
      expect(calls, fixture.id).toBeLessThanOrEqual(DRAW_CALL_CEILING)
    }
  })

  it("pins Patrol's plan at 179 calls over 736 parts (the M3 gate number)", () => {
    const ship = shipOf(SHIP_FIXTURES[0])
    expect(ship.spec.name).toBe('Firebrand')
    const calls = ship.decks.reduce((sum, deck) => sum + deckDrawPlan(deck).length, 0)
    const parts = ship.decks.reduce((sum, deck) => sum + placedPartsOf(deck).length, 0)
    expect(parts).toBe(736)
    expect(calls).toBe(179)
    expect(parts / calls).toBeGreaterThan(4) // the merge/instance win
  })
})

describe('disposeDrawPlan', () => {
  it('frees every geometry a deck plan owns', () => {
    const deck = shipOf(SHIP_FIXTURES[0]).decks[0]
    const plan = deckDrawPlan(deck)
    const disposers = plan.map(() => vi.fn())
    plan.forEach((call, index) => {
      call.geometry.addEventListener('dispose', disposers[index])
    })
    disposeDrawPlan(plan)
    for (const disposer of disposers) expect(disposer).toHaveBeenCalledTimes(1)
  })

  it('leaves another deck alone and accepts an empty plan', () => {
    const ship = shipOf(SHIP_FIXTURES[0])
    const plan = deckDrawPlan(ship.decks[0])
    const other = deckDrawPlan(ship.decks[1])
    const spy = vi.fn()
    other[0].geometry.addEventListener('dispose', spy)
    disposeDrawPlan(plan)
    expect(spy).not.toHaveBeenCalled()
    disposeDrawPlan([])
  })
})
