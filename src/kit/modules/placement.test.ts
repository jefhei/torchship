import { describe, expect, it } from 'vitest'
import { partBounds } from '../parts'
import type { BoxPart, CylinderPart, KitPart, PrimitivePlacement } from '../types'
import { addTurns, placePart, placeParts, placePoint, rotateAxis } from './placement'

const BOX: BoxPart = {
  kind: 'box',
  materialSlot: 'bulkhead',
  size: [2, 1, 0.5],
  position: [1, 0, -0.5],
}

const PIPE: CylinderPart = {
  kind: 'cylinder',
  materialSlot: 'conduit',
  radius: 0.05,
  length: 3,
  axis: 'x',
  position: [0, 1, 0],
}

/** placePart narrowed to a box (the union hides the yaw field otherwise). */
function placedBox(part: KitPart, placement?: PrimitivePlacement): BoxPart {
  const placed = placePart(part, placement)
  if (placed.kind !== 'box') throw new Error('expected a box part')
  return placed
}

/** placePart narrowed to a cylinder. */
function placedCylinder(part: KitPart, placement?: PrimitivePlacement): CylinderPart {
  const placed = placePart(part, placement)
  if (placed.kind !== 'cylinder') throw new Error('expected a cylinder part')
  return placed
}

/** Vector comparison at nm scale — computed sums differ from literals in ulps. */
function expectVec(actual: readonly number[], expected: readonly number[]): void {
  expect(actual).toHaveLength(expected.length)
  for (let i = 0; i < expected.length; i++) {
    expect(actual[i]).toBeCloseTo(expected[i], 9)
  }
}

describe('module placement transform (M2-T2)', () => {
  it('is the identity for an empty placement, without mutating the input', () => {
    expect(placePart(BOX)).toEqual(BOX)
    expect(BOX.position).toEqual([1, 0, -0.5])
    expect(BOX.rotation).toBeUndefined()
  })

  it('translates a part by the placement position', () => {
    expect(placePart(BOX, { position: [1, 2, 3] }).position).toEqual([2, 2, 2.5])
    expect(placePart(PIPE, { position: [0, -1, 0.25] }).position).toEqual([0, 0, 0.25])
  })

  it('yaws a box position by whole quarter-turns: (x, z) → (z, −x)', () => {
    const placed = placedBox(BOX, { rotation: 1 })
    expect(placed.position).toEqual([-0.5, 0, -1])
    expect(placed.rotation).toBe(1)
    // …and its bounds follow: a quarter-turn swaps the X and Z extents.
    expect(partBounds(placed)).toEqual({
      min: [-0.75, -0.5, -2],
      max: [-0.25, 0.5, 0],
    })
  })

  it('composes a box’s own yaw with the placement yaw', () => {
    const turned: BoxPart = { ...BOX, rotation: 3 }
    expect(placedBox(turned, { rotation: 2 }).rotation).toBe(1)
    expect(placedBox(turned).rotation).toBe(3)
    expect(addTurns(3, 3)).toBe(2)
    expect(addTurns(0, 0)).toBe(0)
  })

  it('re-axes a cylinder on odd quarter-turns (Y is the yaw axis)', () => {
    expect(placedCylinder(PIPE).axis).toBe('x')
    expect(placedCylinder(PIPE, { rotation: 1 }).axis).toBe('z')
    expect(placedCylinder(PIPE, { rotation: 2 }).axis).toBe('x')
    expect(placedCylinder(PIPE, { rotation: 3 }).axis).toBe('z')
    expect(rotateAxis('y', 1)).toBe('y')
    expect(rotateAxis('y', 2)).toBe('y')
    expect(rotateAxis('z', 1)).toBe('x')
    expect(rotateAxis('z', 2)).toBe('z')
  })

  it('normalizes signed zeros away (Object.is-clean positions)', () => {
    const origin: CylinderPart = { ...PIPE, position: [0, 0, 0] }
    const placed = placePart(origin, { rotation: 1 })
    for (const component of placed.position) {
      expect(Object.is(component, 0), `${component}`).toBe(true)
    }
  })

  it('places a whole part list, in order', () => {
    const placed = placeParts([BOX, PIPE], { position: [0, 1, 0], rotation: 2 })
    expect(placed).toHaveLength(2)
    expect(placed.map((part) => part.kind)).toEqual(['box', 'cylinder'])
    expect(placed[0].position).toEqual([-1, 1, 0.5])
    expect(placed[1].position).toEqual([0, 2, 0])
  })

  it('places a point the same way it places a part (placePoint)', () => {
    // Identity: translate only.
    expect(placePoint([1, 2, 3], { position: [1, 2, 3] })).toEqual([2, 4, 6])
    // A quarter-turn maps (x, z) → (z, −x): the primitive's +z face turns to
    // module +x, which is how a wall fixture's face is aimed into a room.
    expect(placePoint([0, 0, 0.325], { rotation: 1 })).toEqual([0.325, 0, 0])
    expect(placePoint([0, 0, 0.325], { rotation: 2 })).toEqual([0, 0, -0.325])
    // The coffee station's task-light strip: front face to the entry (yaw 2),
    // cabinet against the forward wall at z = 2.1.
    const strip = placePoint([0.6, 0.87, 0.325], {
      position: [0.7, 0, 2.1],
      rotation: 2,
    })
    expectVec(strip, [0.1, 0.87, 1.775])
    // It agrees with placePart for the same point (one transform, no drift).
    expect(placePoint([1, 0, -0.5], { rotation: 1 })).toEqual(
      placePart(BOX, { rotation: 1 }).position,
    )
    // Signed zeros are normalized away, like every other grid-math return.
    for (const component of placePoint([0, 0, 0], { rotation: 1 })) {
      expect(Object.is(component, 0), `${component}`).toBe(true)
    }
  })
})
