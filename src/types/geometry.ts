/**
 * M1-T2 — canonical geometry primitives for the data contracts.
 *
 * Conventions (PRD §7 seed, identical to the conventions the M0-T2 seam
 * spike measured in src/spikes/seams/vec.ts — the spike stays self-contained;
 * THIS module is the canonical home the M2 kit and M3 assembler build on):
 *
 *  - Meters everywhere (spec space; invariants convert to mm for reporting).
 *  - Y is the thrust axis: nose = +Y (deck 0 is the head deck, highest Y),
 *    under-burn "down" = −Y. Deck floors lie in the XZ plane.
 *  - Door sockets live in vertical walls, so facings are horizontal
 *    ('+x' | '-x' | '+z' | '-z').
 *  - Rotations are quarter-turns about +Y (0 = identity, 1 = 90°, …).
 *
 * The primitives are deliberately NOT three.js types: the contracts are the
 * interchange format between authoring, the assembler, and the validator, and
 * stay trivially testable headless. The M3 renderer maps these onto
 * three.Vector3 / Euler / InstancedMesh at the boundary.
 */

/** A 3-vector of meters: [x, y, z]. */
export type Vec3 = readonly [number, number, number]

/** Rotation about +Y in quarter-turns (0 = identity, 1 = 90°, 2 = 180°, 3 = 270°). */
export type Rotation = 0 | 1 | 2 | 3

/** Horizontal facing of a door socket or kit element (doors live in vertical walls). */
export type Facing = '+x' | '-x' | '+z' | '-z'

/** Unit vector for each horizontal facing. */
export const FACING_VEC: Record<Facing, Vec3> = {
  '+x': [1, 0, 0],
  '-x': [-1, 0, 0],
  '+z': [0, 0, 1],
  '-z': [0, 0, -1],
}

/** A grid-aligned pose: position in meters + quarter-turn yaw about +Y. */
export interface Transform3 {
  position: Vec3
  rotation: Rotation
  /** Optional uniform scale (kit-piece variation, clutter). Omitted = 1. */
  scale?: number
}

/** Rotate a vector by `turns` quarter-turns about +Y. One turn maps (x, z) → (z, −x). */
export function rotY(v: Vec3, turns: Rotation): Vec3 {
  let [x, y, z] = v
  for (let t = 0; t < turns; t++) {
    ;[x, z] = [z, -x]
  }
  // Normalize −0 → 0: quarter-turns legitimately produce signed zeros, and
  // Object.is-based equality (toEqual/toStrictEqual) treats them as distinct.
  return [x === 0 ? 0 : x, y === 0 ? 0 : y, z === 0 ? 0 : z]
}
