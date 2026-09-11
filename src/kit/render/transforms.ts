/**
 * M2-T1 — pure part → transform helpers for the render layer.
 *
 * Kept separate from the components (and in a `.ts` file) so the mapping is
 * unit-testable headless: jsdom has no WebGL, so only these numbers can be
 * asserted in tests (see references/testing-r3f-in-jsdom.md).
 *
 * three's default cylinder and box are both axis-aligned about +Y, so:
 *  - a box's stored quarter-turn yaw maps straight onto a Y Euler rotation,
 *  - a cylinder's `axis` needs a 90° roll about Z (to run along X) or about X
 *    (to run along Z).
 */

import type { Rotation, Vec3 } from '../../types'
import type { PartAxis } from '../types'

/** A mutable three-compatible triple (R3F's `args`/`position` take tuples). */
export type Tuple3 = [number, number, number]

const QUARTER_TURN = Math.PI / 2

/** `Vec3` is a readonly tuple; R3F constructor args want a mutable one. */
export function vec3Tuple(v: Vec3): Tuple3 {
  return [v[0], v[1], v[2]]
}

/** Euler triple for a box's stored quarter-turn yaw about +Y. */
export function boxEuler(rotation: Rotation): Tuple3 {
  return [0, rotation * QUARTER_TURN, 0]
}

/** Euler triple that turns three's default +Y cylinder onto `axis`. */
export function cylinderEuler(axis: PartAxis): Tuple3 {
  switch (axis) {
    case 'x':
      return [0, 0, QUARTER_TURN]
    case 'y':
      return [0, 0, 0]
    case 'z':
      return [QUARTER_TURN, 0, 0]
  }
}
