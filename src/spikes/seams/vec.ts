/**
 * M0-T2 spike — minimal 3-vector + Y-rotation math for seam measurement.
 *
 * Deliberately NOT three.js: the seam spike runs in spec space on plain
 * meter-tuples so the math is trivially testable headless and the numbers
 * serialize straight into docs/spikes.md. If M3's assembler needs it in
 * three.Vector3 space it can re-home this trivially.
 *
 * Conventions (PRD §7 seed): Y is the thrust axis, nose = +Y (deck 0 is the
 * head deck, highest Y), under-burn "down" = −Y. Deck floors lie in the XZ
 * plane. All door sockets live in vertical walls, so facings are horizontal.
 * Rotations are quarter-turns about +Y (Rotation = 0|1|2|3).
 */

export type Vec3 = readonly [number, number, number]

/** Rotation about +Y in quarter-turns (0 = identity, 1 = 90°, …). */
export type Rotation = 0 | 1 | 2 | 3

/** Horizontal facing of a door socket (doors live in vertical walls). */
export type Facing = '+x' | '-x' | '+z' | '-z'

/** Meters per millimeter — report metric = value / MM. */
export const MM = 1e-3

export const ZERO: Vec3 = [0, 0, 0]

export const FACING_VEC: Record<Facing, Vec3> = {
  '+x': [1, 0, 0],
  '-x': [-1, 0, 0],
  '+z': [0, 0, 1],
  '-z': [0, 0, -1],
}

/** Quarter-turn about +Y. One turn maps (x, z) → (z, −x). */
export function rotY(v: Vec3, turns: Rotation): Vec3 {
  let [x, y, z] = v
  for (let t = 0; t < turns; t++) {
    ;[x, z] = [z, -x]
  }
  return [x, y, z]
}

export function add(a: Vec3, b: Vec3): Vec3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
}

export function sub(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
}

export function scale(v: Vec3, s: number): Vec3 {
  return [v[0] * s, v[1] * s, v[2] * s]
}

export function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}

export function mag(v: Vec3): number {
  return Math.sqrt(dot(v, v))
}
