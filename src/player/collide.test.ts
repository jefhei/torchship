import { describe, expect, it } from 'vitest'
import type { Aabb3 } from '../types'
import {
  CONTACT_EPS_M,
  depenetrate,
  resolveHorizontalMove,
  slideLimit,
} from './collide'

const RADIUS = 0.25

/** A wall box in the deck plane: x0..x1 × z0..z1, floor-to-ceiling in Y. */
function wall(x0: number, x1: number, z0: number, z1: number): Aabb3 {
  return { min: [x0, 0, z0], max: [x1, 3, z1] }
}

describe('slideLimit (M3-T4 collision primitives)', () => {
  const box = wall(1, 2, -5, 5)

  it('stops a circle at the near face when it is level with the box', () => {
    expect(slideLimit(box, 0, 1, 0, 0, RADIUS)).toBeCloseTo(0.75, 12)
    expect(slideLimit(box, 0, -1, 3, 0, RADIUS)).toBeCloseTo(2.25, 12)
  })

  it('shortens the reach when the circle is off the box by less than its radius', () => {
    // 0.2 m past the box edge: reach = sqrt(0.25² − 0.2²) = 0.15
    expect(slideLimit(box, 0, 1, 0, 5.2, RADIUS)).toBeCloseTo(1 - 0.15, 12)
    expect(slideLimit(box, 0, 1, 0, -5.2, RADIUS)).toBeCloseTo(1 - 0.15, 12)
  })

  it('ignores a box the circle passes by (further than its radius off)', () => {
    expect(slideLimit(box, 0, 1, 0, 5.3, RADIUS)).toBeNull()
    expect(slideLimit(box, 0, 1, 0, -5.3, RADIUS)).toBeNull()
  })

  it('never pulls a walker back past a box they are already clear of', () => {
    // Standing past the far face, walking away: no limit at all.
    expect(slideLimit(box, 0, 1, 2.5, 0, RADIUS)).toBeNull()
    expect(slideLimit(box, 0, -1, 0.5, 0, RADIUS)).toBeNull()
    // Inside the box's own span, the limit is the exit face ahead.
    expect(slideLimit(box, 0, 1, 1.5, 0, RADIUS)).toBeCloseTo(2.25, 12)
    expect(slideLimit(box, 0, -1, 1.5, 0, RADIUS)).toBeCloseTo(0.75, 12)
  })
})

describe('resolveHorizontalMove', () => {
  it('moves freely with no obstacles', () => {
    const result = resolveHorizontalMove(
      { x: 0, z: 0 },
      { x: 0.3, z: -0.4 },
      [],
      RADIUS,
    )
    expect(result.x).toBeCloseTo(0.3, 12)
    expect(result.z).toBeCloseTo(-0.4, 12)
    expect(result.blocked).toBe(false)
    expect(result.requestedM).toBeCloseTo(0.5, 12)
    expect(result.travelledM).toBeCloseTo(0.5, 12)
  })

  it('slides along a bulkhead instead of sticking to it', () => {
    // A wall at x ≥ 1: a diagonal step that reaches it keeps its z travel and
    // stops at x = 0.75 (one radius short of the wall face).
    const result = resolveHorizontalMove(
      { x: 0.6, z: 0 },
      { x: 0.3, z: 0.3 },
      [wall(1, 2, -5, 5)],
      RADIUS,
    )
    expect(result.x).toBeCloseTo(0.75, 12)
    expect(result.z).toBeCloseTo(0.3, 12)
    expect(result.blocked).toBe(true)
    expect(result.travelledM).toBeLessThan(result.requestedM)
  })

  it('does not clamp a step that stops short of the wall', () => {
    const result = resolveHorizontalMove(
      { x: 0, z: 0 },
      { x: 0.3, z: 0.3 },
      [wall(1, 2, -5, 5)],
      RADIUS,
    )
    expect(result.x).toBeCloseTo(0.3, 12)
    expect(result.z).toBeCloseTo(0.3, 12)
    expect(result.blocked).toBe(false)
  })

  it('walks a walker away from a wall they are touching', () => {
    const result = resolveHorizontalMove(
      { x: 0.75, z: 0 },
      { x: -0.3, z: 0 },
      [wall(1, 2, -5, 5)],
      RADIUS,
    )
    expect(result.x).toBeCloseTo(0.45, 12)
    expect(result.blocked).toBe(false)
  })

  it('passes a 0.9 m doorway between two piers, leaving the 0.4 m centre corridor', () => {
    // A standard doorway: piers either side of a 0.9 m opening at x = ±0.45.
    const piers = [wall(-4, -0.45, 1, 1.1), wall(0.45, 4, 1, 1.1)]
    const through = resolveHorizontalMove(
      { x: 0, z: 1.6 },
      { x: 0, z: -1.2 },
      piers,
      RADIUS,
    )
    expect(through.z).toBeCloseTo(0.4, 12)
    expect(through.blocked).toBe(false)
    // A walker exactly at the corridor's edge (0.25 m off the opening centre
    // line) just brushes the pier corner and still passes.
    const brushing = resolveHorizontalMove(
      { x: 0.2, z: 1.6 },
      { x: 0, z: -1.2 },
      piers,
      RADIUS,
    )
    expect(brushing.z).toBeCloseTo(0.4, 12)
    expect(brushing.blocked).toBe(false)
  })

  it('catches a walker who is not inside the doorway corridor (radius honoured)', () => {
    const piers = [wall(-4, -0.45, 1, 1.1), wall(0.45, 4, 1, 1.1)]
    // 0.3 m off the centre line: the pier's rounded corner stops the walker
    // short of the wall plane instead of letting the capsule clip the jamb.
    const stopped = resolveHorizontalMove(
      { x: 0.3, z: 1.6 },
      { x: 0, z: -1.2 },
      piers,
      RADIUS,
    )
    expect(stopped.z).toBeCloseTo(1.1 + Math.sqrt(RADIUS * RADIUS - 0.15 * 0.15), 12)
    expect(stopped.blocked).toBe(true)
    // And from the far side, approaching the same jamb: same corner, mirrored.
    const otherSide = resolveHorizontalMove(
      { x: 0.3, z: 0.4 },
      { x: 0, z: 0.6 },
      piers,
      RADIUS,
    )
    expect(otherSide.z).toBeCloseTo(1 - Math.sqrt(RADIUS * RADIUS - 0.15 * 0.15), 12)
    expect(otherSide.blocked).toBe(true)
  })

  it('resolves a diagonal into a corner deterministically (x first, then z)', () => {
    const corner = [wall(1, 2, -5, 5), wall(-5, 5, 1, 2)]
    const result = resolveHorizontalMove(
      { x: 0.5, z: 0.5 },
      { x: 0.5, z: 0.5 },
      corner,
      RADIUS,
    )
    expect(result.x).toBeCloseTo(0.75, 12)
    expect(result.z).toBeCloseTo(0.75, 12)
    expect(result.blocked).toBe(true)
  })

  it('treats a zero delta as a no-op', () => {
    const result = resolveHorizontalMove(
      { x: 1, z: 2 },
      { x: 0, z: 0 },
      [wall(0, 1, 0, 1)],
      RADIUS,
    )
    expect(result.x).toBe(1)
    expect(result.z).toBe(2)
    expect(result.blocked).toBe(false)
    expect(result.travelledM).toBe(0)
  })
})

describe('depenetrate', () => {
  it('leaves a clean position alone', () => {
    const result = depenetrate(0, 0, [wall(1, 2, -5, 5)], RADIUS)
    expect(result).toEqual({ x: 0, z: 0, fixes: 0 })
  })

  it('pushes a walker standing clear but inside the radius out to exactly the radius', () => {
    const result = depenetrate(0.9, 0, [wall(1, 2, -5, 5)], RADIUS)
    expect(result.fixes).toBe(1)
    expect(result.x).toBeCloseTo(0.75, 12)
    expect(result.z).toBe(0)
  })

  it('pushes a walker whose centre is inside a box out through the cheapest face', () => {
    // Centre just inside the near face: the −x exit is the cheapest.
    const result = depenetrate(1.02, 0, [wall(1, 2, -5, 5)], RADIUS)
    expect(result.fixes).toBeGreaterThan(0)
    expect(result.x).toBeCloseTo(0.75, 12)
    // Deep inside, the cheapest exit is still a face of the box.
    const deep = depenetrate(1.5, 0, [wall(1, 2, -5, 5)], RADIUS)
    expect(deep.x === 0.75 || deep.x === 2.25).toBe(true)
  })

  it('resolves a two-wall pocket without leaving the walker inside either box', () => {
    const pocket = [wall(1, 2, -5, 5), wall(-5, 5, 1, 2)]
    const result = depenetrate(1.3, 1.3, pocket, RADIUS)
    expect(result.x).toBeCloseTo(0.75, 12)
    expect(result.z).toBeCloseTo(0.75, 12)
    expect(Math.hypot(result.x - 1, result.z - 1)).toBeGreaterThanOrEqual(
      RADIUS - CONTACT_EPS_M,
    )
  })

  it('keeps a walker who is exactly touching where they are (no jitter)', () => {
    const result = depenetrate(0.75, 0, [wall(1, 2, -5, 5)], RADIUS)
    expect(result.fixes).toBe(0)
    expect(result.x).toBe(0.75)
  })
})
