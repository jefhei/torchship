/**
 * M3-T4 — the walker's queries against a deck's collision hull (M3-T3).
 *
 * The hull is the assembler's own output: `DeckNode.collision.boxes` — one
 * world-space axis-aligned box per solid part of every module instance, plus
 * the generated seam plugs (src/assembler/collision.ts). That is precisely the
 * geometry the walkthrough must not clip through, and the §8 bullet-4 invariant
 * already measures it against the visible geometry within 10 cm — so the rig
 * consumes the SAME hull rather than re-deriving a second one (BUILD_PLAN rule
 * 8: mating/collision geometry is generated, never freehand).
 *
 * Three queries, each with one job:
 *
 *  - `blocksBody` — is this box in the way of the walker's body band? The band
 *    spans `feet + STEP_HEIGHT_M` .. `feet + bodyHeight`: kit below the step is
 *    walked over (deck-plate cable runs, hatch sills), kit above the head is
 *    walked under (ceilings, conduit), and everything else is a wall. A deck
 *    plate is the interesting case that falls out of this: its top is AT the
 *    feet, i.e. below the band, so the floor never blocks a horizontal move —
 *    floors are the ground solver's business (src/player/walker.ts).
 *  - `overlapsCircleXZ` — does the walker's circular footprint touch this box
 *    in the deck plane? Used by the ground solver (whose footprint is exactly
 *    the capsule's) and by the horizontal solver's cheap rejects.
 *  - `supportHeightAt` — the highest supporting TOP surface under the walker's
 *    footprint that is at most `capY` (feet + step). That single number is what
 *    makes under-burn gravity land on deck plates, step up onto low kit, follow
 *    a shop floor down a lip, and fall clean through the spine's crawl opening
 *    (M2-T6: the opening has no plate under it, so nothing is returned and the
 *    walker drops).
 */

import type { Aabb3, Vec3 } from '../types'
import {
  BODY_HEIGHT_M,
  CROUCH_BODY_HEIGHT_M,
  PLAYER_RADIUS_M,
  STEP_HEIGHT_M,
} from './move'

const AXIS_X = 0
const AXIS_Y = 1
const AXIS_Z = 2

/**
 * A walker's collision cross-section: the footprint radius, the body band
 * height above the feet, and the step-up height. Standing and crouching differ
 * only in the body band's height — the footprint is unchanged, which is what
 * keeps a crouching walker able to use the same doorways (M3-T4 doc in move.ts).
 */
export interface WalkerShape {
  /** Capsule footprint radius, meters. */
  radius: number
  /** Body extent above the feet the walls are tested against, meters. */
  bodyHeight: number
  /** Kit at or below this height above the feet is walked over, meters. */
  stepHeight: number
}

/** The standing walker: 1.6 m eyes, 1.8 m band, 0.25 m footprint. */
export const STANDING_SHAPE: WalkerShape = {
  radius: PLAYER_RADIUS_M,
  bodyHeight: BODY_HEIGHT_M,
  stepHeight: STEP_HEIGHT_M,
}

/** The crouching walker: same footprint, a 1.2 m body band. */
export const CROUCHING_SHAPE: WalkerShape = {
  radius: PLAYER_RADIUS_M,
  bodyHeight: CROUCH_BODY_HEIGHT_M,
  stepHeight: STEP_HEIGHT_M,
}

/** The collision shape for a locomotion state (crouch lowers the body band). */
export function shapeFor(crouch: boolean): WalkerShape {
  return crouch ? CROUCHING_SHAPE : STANDING_SHAPE
}

/**
 * True when `box` stands in the walker's body band and therefore blocks a
 * horizontal move: the box's top rises past the step height (otherwise it is
 * walked over) AND its bottom is below the band's top (otherwise it is walked
 * under). Touching counts as blocking — the solver is what leaves the ±0.25 m
 * footprint clearance.
 */
export function blocksBody(box: Aabb3, feetY: number, shape: WalkerShape): boolean {
  return (
    box.max[AXIS_Y] > feetY + shape.stepHeight &&
    box.min[AXIS_Y] < feetY + shape.bodyHeight
  )
}

/** Every hull box blocking a horizontal move at these feet (the solver's input). */
export function blockingBoxes(
  hull: readonly Aabb3[],
  feetY: number,
  shape: WalkerShape,
): Aabb3[] {
  return hull.filter((box) => blocksBody(box, feetY, shape))
}

/**
 * Distance from a point in the deck plane to a box's XZ rectangle (0 when the
 * point is inside the rectangle). The plan-space primitive both other queries
 * are built from.
 */
export function distanceToBoxXZ(x: number, z: number, box: Aabb3): number {
  const dx = Math.max(box.min[AXIS_X] - x, 0, x - box.max[AXIS_X])
  const dz = Math.max(box.min[AXIS_Z] - z, 0, z - box.max[AXIS_Z])
  return Math.hypot(dx, dz)
}

/**
 * True when a circle of `radius` at (x, z) touches `box`'s XZ rectangle — the
 * walker's footprint overlap test (a circle, not an AABB: a 0.9 m doorway's
 * corners must not catch a walker who would really fit through it).
 */
export function overlapsCircleXZ(
  x: number,
  z: number,
  radius: number,
  box: Aabb3,
): boolean {
  return distanceToBoxXZ(x, z, box) <= radius
}

/**
 * The highest supporting surface under a walker's footprint at or below `capY`
 * (normally feet + step height), meters. `-Infinity` when nothing supports the
 * footprint — the walker is over a hole (the spine's crawl opening) or past the
 * ship's kit entirely, and under burn they fall.
 *
 * Only box TOPS support: a hull box's top face is the surface a walker stands
 * on (a deck plate's top is the deck floor, a locker's top is standable kit).
 * Sides and bottoms never are.
 */
export function supportHeightAt(
  hull: readonly Aabb3[],
  x: number,
  z: number,
  radius: number,
  capY: number,
): number {
  let best = Number.NEGATIVE_INFINITY
  for (const box of hull) {
    const top = box.max[AXIS_Y]
    if (top > capY || top <= best) {
      continue
    }
    if (overlapsCircleXZ(x, z, radius, box)) {
      best = top
    }
  }
  return best
}

/** The walker's body as a box (reporting, spawn checks — never collision). */
export function bodyBoxAt(feet: Vec3, shape: WalkerShape): Aabb3 {
  return {
    min: [feet[AXIS_X] - shape.radius, feet[AXIS_Y], feet[AXIS_Z] - shape.radius],
    max: [
      feet[AXIS_X] + shape.radius,
      feet[AXIS_Y] + shape.bodyHeight,
      feet[AXIS_Z] + shape.radius,
    ],
  }
}

/**
 * The hull's own bounding box, or undefined for an empty hull. Reporting only —
 * the walkthrough's spawn comes from the M3-T6 selection (`src/player/spawn.ts`),
 * which never needs a bounding box.
 */
export function hullBounds(hull: readonly Aabb3[]): Aabb3 | undefined {
  if (hull.length === 0) {
    return undefined
  }
  const min: [number, number, number] = [Infinity, Infinity, Infinity]
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity]
  for (const box of hull) {
    for (let axis = 0; axis < 3; axis++) {
      min[axis] = Math.min(min[axis], box.min[axis])
      max[axis] = Math.max(max[axis], box.max[axis])
    }
  }
  return { min, max }
}
