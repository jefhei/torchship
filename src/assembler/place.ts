/**
 * M3-T1 — module-local → world placement (the assembler's transform layer).
 *
 * Every world-space quantity the assembler emits comes from exactly two pure
 * operations, so nothing can drift from the data it describes:
 *
 *  - `placeParts` (src/kit/modules/placement.ts — the M2-T2 pure-data twin of
 *    the renderer's `<group position rotation>`): module-local parts → world
 *    parts, with the module ref's quarter-turn yaw composed onto box yaws and
 *    cylinders re-axed;
 *  - `transformAabb`: a module-local axis-aligned box (a collision hint, a
 *    module bounds box) → its world box. A quarter-turn maps an AABB onto an
 *    AABB, so transforming all eight corners and re-taking the per-axis
 *    extremes is exact, not an approximation.
 *
 * Module origins come from `moduleOrigin` (src/validation/sockets.ts) — the
 * M1-T3 resolver is the canonical home of that math, and the fixtures were
 * authored against it. This module must never re-derive it.
 *
 * `facingTurns` is the one new primitive: the quarter-turn yaw that turns a
 * door socket's local +z (the wall normal the kit builds doors around) onto
 * the socket's world facing. It is used for the named 'door' interactives
 * (the passage's own orientation); the hatch's yaw is the module's, because a
 * hatch leaf faces INTO the room (see assemble.ts).
 */

import { FACING_VEC, rotY } from '../types'
import type {
  Aabb3,
  DeckSpec,
  Facing,
  ModuleRef,
  ModuleSource,
  Rotation,
  Vec3,
} from '../types'
import { moduleParts, moduleSolidParts } from '../kit/modules/types'
import type { AuthoredModule } from '../kit/modules/types'
import type { KitPart } from '../kit/types'
import { placeParts } from '../kit/modules/placement'
import { moduleOrigin } from '../validation'
import { pieceShapeOf } from './batches'
import type { PlacedPart } from './types'

const AXIS_X = 0
const AXIS_Y = 1
const AXIS_Z = 2

/** Normalize −0 → 0 (Object.is-strict comparisons treat signed zeros apart). */
function n0(value: number): number {
  return value === 0 ? 0 : value
}

function add(a: Vec3, b: Vec3): Vec3 {
  return [
    n0(a[AXIS_X] + b[AXIS_X]),
    n0(a[AXIS_Y] + b[AXIS_Y]),
    n0(a[AXIS_Z] + b[AXIS_Z]),
  ]
}

/**
 * The quarter-turn yaw that turns a socket's local +z (the wall normal the kit
 * seats doors on) onto the world `facing` — i.e. the yaw of a doorway standing
 * in that wall. '+z' → 0, '+x' → 1, '−z' → 2, '−x' → 3.
 */
export function facingTurns(facing: Facing): Rotation {
  for (const turns of [0, 1, 2, 3] as const) {
    const v = rotY([0, 0, 1], turns)
    if (
      v[AXIS_X] === FACING_VEC[facing][AXIS_X] &&
      v[AXIS_Z] === FACING_VEC[facing][AXIS_Z]
    ) {
      return turns
    }
  }
  // Unreachable for the four axis-aligned facings (quarter-turns permute them).
  throw new Error(`facingTurns: ${facing} is not reachable by a quarter-turn`)
}

/** The world origin of a module instance: its deck-local offset on the deck floor. */
export function worldOriginOf(ref: ModuleRef, deck: DeckSpec): Vec3 {
  return moduleOrigin(ref, deck)
}

/**
 * A module-local axis-aligned box in world space, under a module instance's
 * origin + quarter-turn yaw. Exact: a quarter-turn maps AABBs onto AABBs.
 */
export function transformAabb(box: Aabb3, origin: Vec3, rotation: Rotation): Aabb3 {
  const min: number[] = [Infinity, Infinity, Infinity]
  const max: number[] = [-Infinity, -Infinity, -Infinity]
  for (const x of [box.min[AXIS_X], box.max[AXIS_X]]) {
    for (const y of [box.min[AXIS_Y], box.max[AXIS_Y]]) {
      for (const z of [box.min[AXIS_Z], box.max[AXIS_Z]]) {
        const corner = add(rotY([x, y, z], rotation), origin)
        for (let axis = 0; axis < 3; axis++) {
          min[axis] = Math.min(min[axis], corner[axis])
          max[axis] = Math.max(max[axis], corner[axis])
        }
      }
    }
  }
  return {
    min: [n0(min[0]), n0(min[1]), n0(min[2])],
    max: [n0(max[0]), n0(max[1]), n0(max[2])],
  }
}

/**
 * The module's kit parts in world space, tagged with provenance and their
 * canonical instancing key, in the module's build order.
 */
export function worldPartsOf(
  module: AuthoredModule,
  origin: Vec3,
  rotation: Rotation,
  source: ModuleSource,
): PlacedPart[] {
  return placeParts(moduleParts(module), { position: origin, rotation }).map((part) =>
    placedPartOf(part, source),
  )
}

/**
 * One world part tagged with its provenance and canonical instancing key —
 * the shape every `PlacedPart` in the assembly takes (M3-T1's parts, and the
 * M3-T3 hull's geometry side).
 */
export function placedPartOf(part: KitPart, source: ModuleSource): PlacedPart {
  return {
    part,
    materialSlot: part.materialSlot,
    pieceId: pieceShapeOf(part).id,
    source,
  }
}

/**
 * The module's SOLID parts in world space, in build order: the geometry the
 * deck's collision hull must stand for (M3-T3). Walk-through fixtures
 * (conduit, panel lights, screens, hatch leaves) are deliberately absent —
 * `solid` is the M2 authoring declaration of what blocks a walker.
 */
export function worldSolidPartsOf(
  module: AuthoredModule,
  origin: Vec3,
  rotation: Rotation,
  source: ModuleSource,
): PlacedPart[] {
  return placeParts(moduleSolidParts(module), { position: origin, rotation }).map(
    (part) => placedPartOf(part, source),
  )
}

/** The module's collision hint in world space, one box per solid part, in order. */
export function worldBoxesOf(
  module: AuthoredModule,
  origin: Vec3,
  rotation: Rotation,
): Aabb3[] {
  return module.manifest.collisionHint.boxes.map((box) =>
    transformAabb(box, origin, rotation),
  )
}

/** True when every component of a vector is finite. */
export function isFiniteVec(v: Vec3): boolean {
  return v.every((value) => Number.isFinite(value))
}

/** True when a box is finite and non-degenerate on every axis. */
export function isWellFormedBox(box: Aabb3): boolean {
  return (
    isFiniteVec(box.min) &&
    isFiniteVec(box.max) &&
    box.min.every((lo, axis) => lo <= box.max[axis])
  )
}

/** True when `inner` lies inside `outer`, within `tolerance` meters. */
export function boxContains(outer: Aabb3, inner: Aabb3, tolerance: number): boolean {
  return inner.min.every(
    (lo, axis) =>
      lo >= outer.min[axis] - tolerance &&
      inner.max[axis] <= outer.max[axis] + tolerance,
  )
}
