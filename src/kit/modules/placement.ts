/**
 * M2-T2 — primitive-local → module-local placement (the pure-data twin of the
 * render layer's `<group position rotation>`).
 *
 * A kit builder (src/kit/parts.ts) emits parts in the PRIMITIVE's own local
 * frame. A module author places that primitive with a `PrimitivePlacement`
 * (module-local position + quarter-turn yaw) — exactly the props the R3F
 * primitives take (src/kit/render/primitives.tsx). Module authoring needs the
 * same transform in DATA space: a flattened module part list that the tests,
 * the collision-hint derivation (M3-T3's input) and the M3-T1 merge pass can
 * measure headless, with the placement already baked in.
 *
 * The transform is nothing more than the group transform, and it must stay
 * that way, so the mapping matches `boxEuler` / `cylinderEuler`:
 *  - a box's quarter-turn yaw composes: turns add modulo 4, size unchanged;
 *  - a cylinder has no yaw field, so an odd turn RE-AXES it (X ↔ Z; Y is the
 *    yaw axis and stays);
 *  - positions rotate by `rotY` (src/types/geometry.ts), then translate.
 *
 * Every computed coordinate passes through `n0` (−0 → 0): Object.is-strict
 * matchers treat signed zeros as distinct, and quarter-turns emit them (repo
 * convention — src/types/geometry.ts, src/types/units.ts, src/kit/parts.ts).
 */

import { rotY } from '../../types'
import type { Rotation, Vec3 } from '../../types'
import type { KitPart, PartAxis, PrimitivePlacement } from '../types'

const ZERO: Vec3 = [0, 0, 0]

/** Normalize −0 → 0 so downstream Object.is-strict comparisons stay clean. */
function n0(value: number): number {
  return value === 0 ? 0 : value
}

/** Quarter-turn yaw addition, wrapped back into 0..3. */
export function addTurns(turns: Rotation, extra: Rotation): Rotation {
  return ((turns + extra) % 4) as Rotation
}

/** The axis a part runs along after `turns` quarter-turns about +Y. */
export function rotateAxis(axis: PartAxis, turns: Rotation): PartAxis {
  if (turns % 2 === 0) return axis
  if (axis === 'y') return 'y'
  return axis === 'x' ? 'z' : 'x'
}

/**
 * One POINT in primitive-local space, transformed into module-local space by
 * a placement: rotate by `rotY`, then translate. The point twin of
 * `placePart`, for the anchors a module derives from a point INSIDE a
 * primitive rather than from its origin — e.g. the galley's coffee-station
 * task-light socket, which sits on the cabinet's own front face. Same
 * transform, same normalization, so an anchor can never disagree with the
 * geometry it was read from.
 */
export function placePoint(point: Vec3, placement: PrimitivePlacement = {}): Vec3 {
  const turns = placement.rotation ?? 0
  const [dx, dy, dz] = placement.position ?? ZERO
  const [rx, ry, rz] = rotY(point, turns)
  return [n0(rx + dx), n0(ry + dy), n0(rz + dz)]
}

/**
 * One part translated by `placement.position` and yawed by `placement.rotation`
 * (the renderer's group transform, in meters). Returns a new part; the input is
 * never mutated.
 */
export function placePart(part: KitPart, placement: PrimitivePlacement = {}): KitPart {
  const turns = placement.rotation ?? 0
  const position = placePoint(part.position, placement)
  if (turns === 0) return { ...part, position }
  if (part.kind === 'box') {
    return { ...part, position, rotation: addTurns(part.rotation ?? 0, turns) }
  }
  return { ...part, position, axis: rotateAxis(part.axis, turns) }
}

/** A whole part list placed into module-local space, in builder order. */
export function placeParts(
  parts: readonly KitPart[],
  placement: PrimitivePlacement = {},
): KitPart[] {
  return parts.map((part) => placePart(part, placement))
}
