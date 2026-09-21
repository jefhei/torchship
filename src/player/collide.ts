/**
 * M3-T4 — horizontal collision: the walker's circle against a deck's hull, in
 * the deck plane.
 *
 * The walker is a CAPSULE: a circle of PLAYER_RADIUS_M in the deck plane,
 * carried at eye height (the ported PlanWalker model — "the camera sits at the
 * centre of a ~0.5 m-wide capsule"). The obstacles are the M3-T3 hull's
 * axis-aligned boxes, already filtered to the ones that stand in the walker's
 * body band (src/player/hull.ts `blockingBoxes`).
 *
 * Because every obstacle is axis-aligned, resolution is exactly computable with
 * no sweeping and no iteration in the common case:
 *
 *  1. `EACH AXIS IS MOVED AND CLAMPED SEPARATELY`, x then z. For a circle
 *     sliding along one axis past an axis-aligned rectangle, the extreme
 *     centre coordinate that does not overlap is closed-form: with `gap` the
 *     circle centre's distance from the rectangle ALONG THE OTHER AXIS,
 *     `reach = sqrt(radius² − gap²)` is how far the circle bulges past the
 *     rectangle's face, so the limit is `face ∓ reach` (see `slideLimit`).
 *     Clamping to that limit — instead of stopping the move — is what makes a
 *     walker SLIDE along a bulkhead and SQUEEZE through a 0.9 m doorway
 *     instead of sticking on it.
 *  2. `A PENETRATING START IS PUSHED OUT FIRST` (`depenetrate`), along the
 *     cheapest of the four face exits, so a walker that spawned or stepped
 *     into kit is healed on the next frame rather than dragged through it —
 *     the same self-heal PlanWalker's M4-T2 rig relies on.
 *
 * Axis-order (x then z) is deterministic and matches the input vector's
 * decomposition: a diagonal step into a corner resolves against x first, which
 * is what the tests pin, and no step can end up deeper inside a box than it
 * started. Step-ups are NOT resolved here: a box whose top is within
 * STEP_HEIGHT_M never reaches this solver (it is not a blocker), and the ground
 * solver raises the walker onto it (src/player/walker.ts).
 *
 * Pure deck-plane math — no three.js, no React — so every case unit-tests
 * headlessly.
 */

import type { Aabb3 } from '../types'

const AXIS_X = 0
const AXIS_Z = 2

/** Distance tolerance (m): anything within this is "touching". */
export const CONTACT_EPS_M = 1e-9

/**
 * Depenetration passes. Each pass pushes the circle out of every box it is
 * inside; a second pass catches the rare case where one push re-enters another
 * box (a pocket of two perpendicular walls). Four is far more than the ship's
 * kit can require in one frame.
 */
export const MAX_DEPENETRATION_PASSES = 4

/** A position in the deck plane (world meters). */
export interface PlanarPosition {
  x: number
  z: number
}

/** The outcome of resolving one horizontal step. */
export interface PlanarMoveResult {
  x: number
  z: number
  /** Distance actually travelled, meters. */
  travelledM: number
  /** Distance requested by the input, meters. */
  requestedM: number
  /** True when the move was cut short by hull geometry (a contact). */
  blocked: boolean
}

/** Normalize −0 → 0 (Object.is-strict comparisons treat signed zeros apart). */
function n0(value: number): number {
  return value === 0 ? 0 : value
}

function clamp(value: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, value))
}

/**
 * The extreme centre coordinate along `axis` at which a circle of `radius`
 * (whose centre sits at `otherCoord` on the other in-plane axis) stops touching
 * `box` — travelling in direction `dir` from `current`. `null` when the box
 * cannot block this axis' travel at all, in either of two ways:
 *
 *  - the circle passes the box entirely (its centre is further than `radius`
 *    away along the other axis), or
 *  - the walker is already PAST the box on this axis and moving further away
 *    from it (the guard on `current`): without it, a walker who had stepped
 *    around a wall's far face would be dragged back to its near face.
 *
 * A walker whose centre is level with the box's own span on this axis (a
 * penetration the caller is expected to have healed) is limited to that box's
 * exit face in the direction of travel, so a move can never end up deeper
 * inside the box than it started.
 */
export function slideLimit(
  box: Aabb3,
  axis: 0 | 2,
  dir: 1 | -1,
  current: number,
  otherCoord: number,
  radius: number,
): number | null {
  const otherAxis = axis === AXIS_X ? AXIS_Z : AXIS_X
  const lo = box.min[otherAxis]
  const hi = box.max[otherAxis]
  const gap = otherCoord < lo ? lo - otherCoord : otherCoord > hi ? otherCoord - hi : 0
  if (gap >= radius) {
    return null
  }
  const reach = Math.sqrt(Math.max(0, radius * radius - gap * gap))
  if (dir > 0) {
    if (current >= box.max[axis]) {
      return null
    }
    return current <= box.min[axis] ? box.min[axis] - reach : box.max[axis] + reach
  }
  if (current <= box.min[axis]) {
    return null
  }
  return current >= box.max[axis] ? box.max[axis] + reach : box.min[axis] - reach
}

/**
 * `from` + `delta`, with each axis clamped against every blocker (x first, then
 * z), so the circle slides along walls instead of clipping through them. The
 * start position must be penetration-free — call `depenetrate` first (the
 * walker's frame step does).
 */
export function resolveHorizontalMove(
  from: PlanarPosition,
  delta: PlanarPosition,
  blockers: readonly Aabb3[],
  radius: number,
): PlanarMoveResult {
  let x = from.x
  let z = from.z

  if (delta.x !== 0) {
    const dir: 1 | -1 = delta.x > 0 ? 1 : -1
    let target = x + delta.x
    for (const box of blockers) {
      const limit = slideLimit(box, AXIS_X, dir, x, z, radius)
      if (limit === null) {
        continue
      }
      target = dir > 0 ? Math.min(target, limit) : Math.max(target, limit)
    }
    x = target
  }

  if (delta.z !== 0) {
    const dir: 1 | -1 = delta.z > 0 ? 1 : -1
    let target = z + delta.z
    for (const box of blockers) {
      const limit = slideLimit(box, AXIS_Z, dir, z, x, radius)
      if (limit === null) {
        continue
      }
      target = dir > 0 ? Math.min(target, limit) : Math.max(target, limit)
    }
    z = target
  }

  const requestedM = Math.hypot(delta.x, delta.z)
  const travelledM = Math.hypot(x - from.x, z - from.z)
  return {
    x: n0(x),
    z: n0(z),
    travelledM,
    requestedM,
    blocked: requestedM - travelledM > CONTACT_EPS_M,
  }
}

/** The outcome of a depenetration pass. */
export interface DepenetrationResult {
  x: number
  z: number
  /** Number of boxes the walker was found inside and pushed out of. */
  fixes: number
}

/**
 * Push a circle out of every box it overlaps, along the cheapest exit
 * (`fixes` = how many boxes it was inside). Distances below the tolerance
 * (touching exactly) are left alone: a walker standing flush against a bulkhead
 * is legal, and floating-point noise must not shove them around.
 */
export function depenetrate(
  x: number,
  z: number,
  blockers: readonly Aabb3[],
  radius: number,
): DepenetrationResult {
  let px = x
  let pz = z
  let fixes = 0
  for (let pass = 0; pass < MAX_DEPENETRATION_PASSES; pass++) {
    let fixedThisPass = false
    for (const box of blockers) {
      const cx = clamp(px, box.min[AXIS_X], box.max[AXIS_X])
      const cz = clamp(pz, box.min[AXIS_Z], box.max[AXIS_Z])
      const dx = px - cx
      const dz = pz - cz
      const distance = Math.hypot(dx, dz)
      if (distance >= radius - CONTACT_EPS_M) {
        // Clear of the box, or exactly touching it: nothing to fix.
        continue
      }
      if (distance > CONTACT_EPS_M) {
        // Outside the rectangle but inside the radius: push straight out.
        const scale = radius / distance
        px = cx + dx * scale
        pz = cz + dz * scale
      } else {
        // The centre is inside the rectangle: take the cheapest face exit.
        const exits = [
          {
            travel: px - (box.min[AXIS_X] - radius),
            x: box.min[AXIS_X] - radius,
            z: pz,
          },
          { travel: box.max[AXIS_X] + radius - px, x: box.max[AXIS_X] + radius, z: pz },
          {
            travel: pz - (box.min[AXIS_Z] - radius),
            x: px,
            z: box.min[AXIS_Z] - radius,
          },
          { travel: box.max[AXIS_Z] + radius - pz, x: px, z: box.max[AXIS_Z] + radius },
        ]
        let best = exits[0]
        for (const exit of exits) {
          if (exit.travel < best.travel) {
            best = exit
          }
        }
        px = best.x
        pz = best.z
      }
      fixes += 1
      fixedThisPass = true
    }
    if (!fixedThisPass) {
      break
    }
  }
  return { x: n0(px), z: n0(pz), fixes }
}
