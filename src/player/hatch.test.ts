import { describe, expect, it } from 'vitest'
import { assembleShip } from '../assembler'
import { LONG_HAUL_SPEC, PATROL_SPEC, SCIENCE_SPEC } from '../fixtures'
import type { Aabb3 } from '../types'
import {
  HATCH_FACING_WAIVE_M,
  HATCH_REACH_M,
  hatchBlockerBoxes,
  hatchInReach,
  hatchesOf,
  isHatchOpen,
  toggleHatch,
  type Hatch,
} from './hatch'
import { shapeFor } from './hull'
import { EYE_HEIGHT_M } from './move'

const ship = assembleShip(PATROL_SPEC)
const hatches = hatchesOf(ship)
const crewFloorY = ship.decks[1].floorY
const HEAD_FLOOR_Y = ship.decks[0].floorY

/** The galley's spine hatch — the one on the walkthrough's route. */
const spineHatch = (deckId: string): Hatch => {
  const hatch = hatches.find(
    (candidate) => candidate.id === `${deckId}-galley#0-spine-door`,
  )
  if (hatch === undefined) throw new Error(`no ${deckId} spine hatch`)
  return hatch
}
const crewHatch = spineHatch('crew')
const headHatch = hatches.find((hatch) => hatch.socketId === 'spine-door')!

/** The lane in front of a hatch's leaf on the crew deck (the climber's spot). */
const crewLane: [number, number, number] = [0, crewFloorY, 0.273]

function boxes(box: Aabb3): [number, number, number, number, number, number] {
  return [...box.min, ...box.max]
}

/** The box's six numbers, compared to 1e-9 (the placed-part float noise). */
function expectBox(box: Aabb3, expected: number[]): void {
  boxes(box).forEach((value, index) => {
    expect(value).toBeCloseTo(expected[index], 9)
  })
}

describe('the hatches of an assembled ship (M3-T5 derivation)', () => {
  it('finds the modules’ own leaves: one per authored hatch, on every deck', () => {
    expect(hatches).toHaveLength(9)
    expect(hatches.filter((hatch) => hatch.deckIndex === 1)).toHaveLength(2)
    expect(new Set(hatches.map((hatch) => hatch.id)).size).toBe(hatches.length)
    expect(hatches.map((hatch) => hatch.id)).toContain('crew-galley#0-spine-door')
    expect(hatches.map((hatch) => hatch.id)).toContain('crew-galley#0-side-door')
    expect(
      hatches.every((hatch) => hatch.closedBox.min[1] < hatch.closedBox.max[1]),
    ).toBe(true)
    for (const spec of [LONG_HAUL_SPEC, SCIENCE_SPEC]) {
      const theirs = hatchesOf(assembleShip(spec))
      expect(theirs.length).toBeGreaterThanOrEqual(spec.decks.length)
      expect(theirs.every((hatch) => hatch.closedBox === hatch.closedBox)).toBe(true)
      expect(new Set(theirs.map((hatch) => hatch.id)).size).toBe(theirs.length)
    }
  })

  it('measures the leaf the module authored, seated in its socket’s wall plane', () => {
    // The galley's spine hatch: the standard 0.9 × 2.0 opening less the kit's
    // 0.01 m clearance, 0.05 m thick, centred on the socket the leaf seals.
    expectBox(crewHatch.closedBox, [-0.44, -3.19, 0.675, 0.44, -1.21, 0.725])
    expectBox(crewHatch.openBox, [-1.33, -3.19, 0.675, -0.45, -1.21, 0.725])
    expect(crewHatch.horizontalAxis).toBe(0)
    for (const hatch of hatches) {
      const leaf = hatch.closedBox
      const normal = hatch.horizontalAxis === 0 ? 2 : 0
      // The leaf sits in the wall plane the socket's center names.
      expect((leaf.min[normal] + leaf.max[normal]) / 2).toBeCloseTo(
        hatch.door.center[normal],
        9,
      )
      // …and it is inside the opening it seals (never wider than its socket).
      const span = leaf.max[hatch.horizontalAxis] - leaf.min[hatch.horizontalAxis]
      expect(span).toBeLessThanOrEqual(hatch.door.width + 1e-9)
      expect(leaf.max[1] - leaf.min[1]).toBeLessThanOrEqual(hatch.door.height + 1e-9)
      expect(leaf.max[1] - leaf.min[1]).toBeGreaterThan(0.5)
    }
    // The side door's leaf is the same slab, in the X plane: retracting it
    // mirrors along Z instead.
    const side = hatches.find((hatch) => hatch.id === 'crew-galley#0-side-door')!
    expect(side.horizontalAxis).toBe(2)
    expectBox(side.closedBox, [2.075, -3.19, 3.96, 2.125, -1.21, 4.84])
    expectBox(side.openBox, [2.075, -3.19, 3.07, 2.125, -1.21, 3.95])
  })

  it('retracts the leaf into the jamb: the open box stays in the wall plane and clear of the opening', () => {
    for (const hatch of hatches) {
      const { closedBox, openBox, horizontalAxis } = hatch
      const normal = horizontalAxis === 0 ? 2 : 0
      // Same wall plane, same height: the leaf never swings into the room.
      expect(openBox.min[normal]).toBe(closedBox.min[normal])
      expect(openBox.max[normal]).toBe(closedBox.max[normal])
      expect(openBox.min[1]).toBe(closedBox.min[1])
      expect(openBox.max[1]).toBe(closedBox.max[1])
      // Folded back over the jamb, ending exactly on the opening's low edge.
      const openingLow = hatch.door.center[horizontalAxis] - hatch.door.width / 2
      expect(openBox.max[horizontalAxis]).toBeCloseTo(openingLow, 9)
      expect(openBox.max[horizontalAxis]).toBeLessThanOrEqual(openingLow + 1e-9)
      // The two states do not overlap: closing moves the leaf back into the
      // doorway, opening takes it out.
      expect(openBox.max[horizontalAxis]).toBeLessThanOrEqual(
        closedBox.min[horizontalAxis],
      )
    }
  })

  it('blocks with the leaf in its current state', () => {
    const shut = hatchBlockerBoxes(hatches, {})
    expect(shut).toContain(crewHatch.closedBox)
    expect(shut).not.toContain(crewHatch.openBox)
    const open = hatchBlockerBoxes(hatches, { [crewHatch.id]: true })
    expect(open).toContain(crewHatch.openBox)
    expect(open).not.toContain(crewHatch.closedBox)
    expect(isHatchOpen({}, crewHatch)).toBe(false)
    expect(isHatchOpen({ [crewHatch.id]: true }, crewHatch)).toBe(true)
  })
})

describe('reaching a hatch (M3-T5 interaction)', () => {
  it('is out of reach from across the room and in reach from the lane', () => {
    // The galley spawn: 2.5 m of room between the walker and the leaf.
    expect(hatchInReach(hatches, 1, [0, crewFloorY, 3.2], 0)).toBeNull()
    // Walked up to the leaf: the lane in the trunk, facing the ladder — the
    // facing test is waived at this distance (HATCH_FACING_WAIVE_M).
    expect(hatchInReach(hatches, 1, crewLane, 0)).toBe(crewHatch)
    expect(HATCH_FACING_WAIVE_M).toBeGreaterThan(0.4)
  })

  it('needs the camera to face the hatch once you are back from it', () => {
    const back: [number, number, number] = [
      0,
      crewFloorY,
      0.7 + HATCH_FACING_WAIVE_M + 0.3,
    ]
    expect(hatchInReach(hatches, 1, back, 0)).toBe(crewHatch)
    expect(hatchInReach(hatches, 1, back, Math.PI)).toBeNull()
    // Right at the reach limit it is still offered; past it, not.
    const limit: [number, number, number] = [0, crewFloorY, 0.725 + HATCH_REACH_M]
    expect(hatchInReach(hatches, 1, limit, 0)).toBe(crewHatch)
    const past: [number, number, number] = [0, crewFloorY, 0.725 + HATCH_REACH_M + 0.01]
    expect(hatchInReach(hatches, 1, past, 0)).toBeNull()
  })

  it('only offers hatches on the walker’s own deck', () => {
    expect(hatchInReach(hatches, 0, crewLane, 0)).toBeNull()
    expect(hatchInReach(hatches, 0, [0, HEAD_FLOOR_Y, 0.273], 0)).toBe(headHatch)
    // The doorway is 1.4 m above the feet at the top: the vertical window covers
    // a crouched walker too.
    expect(hatchInReach(hatches, 1, [0, crewFloorY, 0.9], 0)).toBe(crewHatch)
  })
})

describe('working a hatch (M3-T5 toggle)', () => {
  const shape = shapeFor(false)

  it('opens the hatch in reach and reports it', () => {
    const result = toggleHatch({}, hatches, 1, crewLane, 0, shape)
    expect(result.action).toBe('opened')
    expect(result.hatch?.id).toBe(crewHatch.id)
    expect(result.open).toEqual({ [crewHatch.id]: true })
    // The input map is never mutated.
    const original = {}
    toggleHatch(original, hatches, 1, crewLane, 0, shape)
    expect(original).toEqual({})
  })

  it('closes an open hatch from the lane, and refuses with the walker in it', () => {
    const open = { [crewHatch.id]: true }
    const shut = toggleHatch(open, hatches, 1, crewLane, 0, shape)
    expect(shut.action).toBe('closed')
    expect(shut.open).toEqual({ [crewHatch.id]: false })

    // Standing in the doorway itself (z = 0.7 is inside the leaf's 0.05 m slab),
    // the leaf would close through the walker: refused, state untouched.
    const inTheDoorway: [number, number, number] = [0, crewFloorY, 0.7]
    const blocked = toggleHatch(open, hatches, 1, inTheDoorway, 0, shape)
    expect(blocked.action).toBe('blocked')
    expect(blocked.open).toEqual(open)
    expect(blocked.detail).toContain('standing in it')
    // Half a metre off the wall the leaf closes cleanly.
    const clear: [number, number, number] = [0, crewFloorY, 1.2]
    expect(toggleHatch(open, hatches, 1, clear, 0, shape).action).toBe('closed')
  })

  it('does nothing when no hatch is in reach', () => {
    const result = toggleHatch({}, hatches, 1, [0, crewFloorY, 4.5], 0, shape)
    expect(result.hatch).toBeNull()
    expect(result.action).toBeUndefined()
    expect(result.open).toEqual({})
  })

  it('opens the deck you arrive on: the head deck’s hatch, from its lane', () => {
    const lane: [number, number, number] = [0, HEAD_FLOOR_Y, 0.273]
    const result = toggleHatch({}, hatches, 0, lane, 0, shape)
    expect(result.hatch?.id).toBe(headHatch.id)
    expect(result.action).toBe('opened')
    expect(result.open).toEqual({ [headHatch.id]: true })
  })

  it('keeps the eye-height window honest: a crouched walker still reaches', () => {
    // The doorway's center sits EYE_HEIGHT_M / 2 above standing eyes: the window
    // (HATCH_VERTICAL_REACH_M = 1.4 m) reaches it from crouching too.
    expect(hatchInReach(hatches, 1, [0, crewFloorY, 0.9], 0)).toBe(crewHatch)
    expect(EYE_HEIGHT_M).toBeGreaterThan(1)
  })
})
