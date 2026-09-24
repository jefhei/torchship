/**
 * M3-T7 — the merge/instance geometry builders (the render half of the
 * draw-call pass; the measurement half is src/assembler/drawCalls.ts).
 *
 * This is the one place a `KitPart` becomes a three.js `BufferGeometry`:
 *
 *  - `partGeometry` / `placedPartGeometry` — one part's shape, in its own
 *    frame and in world space. Boxes are origin-centred (three's `BoxGeometry`
 *    is, matching a `BoxPart.position` being the centre); cylinders are
 *    three's default +Y cylinder re-axed by the SAME Euler triples the
 *    per-part renderer uses (`boxEuler` / `cylinderEuler`, transforms.ts), so
 *    the merged geometry is the per-part meshes' geometry, baked;
 *  - `mergedPartsGeometry` — a whole material group as ONE geometry: the
 *    `mergeGeometries` of its placed parts = one mesh = one draw call (the
 *    partition in src/assembler/batches.ts is the plan this executes);
 *  - `mouldGeometry` + `placementMatrix` — an instance batch's mould (the
 *    piece at the origin) and the `Matrix4` each `InstanceBatch.placement`
 *    applies to it. Together they are the three.js twin of the assembler's
 *    pure `placePart(mouldOf(shape), placementFor(shape, part))` identity:
 *    `mould + placement` IS the world part, so an `InstancedMesh` draws
 *    exactly what the per-part meshes drew (pinned in merged.test.ts).
 *
 * Everything here is CPU-side math: three.js geometry construction needs no
 * WebGL context, so this module — unlike the components in MergedParts.tsx —
 * is unit-testable headless in jsdom (src/test-setup.ts stubs `getContext` for
 * exactly that reason).
 *
 * The cylinder tessellation matches the per-part renderer (`KitPartMesh` uses
 * 16 radial segments) so the swap to instancing cannot change the silhouette.
 * A 16-gon's bounding box is still exactly the analytic bounds `partBounds`
 * computes (its vertices reach ±1 on both axes), which is what lets the tests
 * compare merged geometry against the assembler's own numbers.
 */

import { BoxGeometry, CylinderGeometry, Euler, Matrix4, Vector3 } from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import type { BufferGeometry } from 'three'
import type { Aabb3, Transform3, Vec3 } from '../../types'
import type { KitPart } from '../types'
import { boxEuler, cylinderEuler } from './transforms'

/** Radial segments for a cylinder part — the per-part renderer's own value. */
export const CYLINDER_SEGMENTS = 16

/** Normalize −0 → 0 (Object.is-strict comparisons treat signed zeros apart). */
function n0(value: number): number {
  return value === 0 ? 0 : value
}

/** One part's shape in its own local frame (no position, no rotation). */
export function partGeometry(part: KitPart): BufferGeometry {
  if (part.kind === 'box') {
    return new BoxGeometry(part.size[0], part.size[1], part.size[2])
  }
  return new CylinderGeometry(part.radius, part.radius, part.length, CYLINDER_SEGMENTS)
}

/**
 * The matrix an `InstanceBatch.placement` applies to the batch's mould:
 * translate ∘ rotate, the same composition as an R3F `<mesh position rotation>`
 * — `makeRotationFromEuler` writes the rotation then `setPosition` writes the
 * translation column, so the matrix is exactly `T · R`. A placement's rotation
 * is its quarter-turn yaw (0…3), the yaw that carries the MOULD's axis onto the
 * world part's (batches.ts `placementFor`), so the mould geometry is built
 * once in its own axis (see `mouldGeometry`) and every instance is a yawed,
 * translated copy — nothing is re-derived here.
 */
export function placementMatrix(transform: Transform3): Matrix4 {
  const [rx, ry, rz] = boxEuler(transform.rotation)
  const matrix = new Matrix4().makeRotationFromEuler(new Euler(rx, ry, rz))
  const scale = transform.scale
  if (scale !== undefined && scale !== 1) {
    matrix.multiply(new Matrix4().makeScale(scale, scale, scale))
  }
  matrix.setPosition(new Vector3(...transform.position))
  return matrix
}

/** One part's geometry in world space: its shape, placed by its own transform. */
export function placedPartGeometry(part: KitPart): BufferGeometry {
  const geometry = partGeometry(part)
  const euler =
    part.kind === 'box' ? boxEuler(part.rotation ?? 0) : cylinderEuler(part.axis)
  geometry.applyMatrix4(
    new Matrix4()
      .makeRotationFromEuler(new Euler(euler[0], euler[1], euler[2]))
      .setPosition(new Vector3(part.position[0], part.position[1], part.position[2])),
  )
  return geometry
}

/**
 * A whole group as one merged geometry — the single mesh one merged
 * `GeometryGroup` draws. Returns `null` for an empty list (nothing to merge:
 * the assembler gate forbids an empty group, so a renderer sees this only if
 * it was handed a hand-built group).
 *
 * The parts' own geometries are disposed once merged (they were never
 * uploaded — merging is CPU-side — but their attribute arrays are the bulk of
 * the memory).
 */
export function mergedPartsGeometry(parts: readonly KitPart[]): BufferGeometry | null {
  if (parts.length === 0) return null
  const geometries = parts.map(placedPartGeometry)
  const merged = mergeGeometries(geometries)
  for (const geometry of geometries) geometry.dispose()
  if (merged === null) {
    throw new Error(
      `mergedPartsGeometry: could not merge ${parts.length} part geometries — ` +
        'incompatible attributes (the kit emits boxes and 16-segment cylinders only)',
    )
  }
  return merged
}

/**
 * An instance batch's mould: the canonical piece at the origin, built from the
 * assembler's `mouldOf(shape)` part (batches.ts) so the geometry and the
 * placement math cannot disagree about the mould's axis. A cylinder mould runs
 * along the mould's OWN axis (`shape.mouldAxis`: 'y', or 'x' for the XZ pair)
 * because the placement yaw only ever yaws about +Y — that is exactly the
 * division of labour `mouldOf` + `placementFor` define.
 */
export function mouldGeometry(mould: KitPart): BufferGeometry {
  return placedPartGeometry(mould)
}

/** The world bounds of a geometry — `partBounds`' three.js twin. */
export function geometryBounds(geometry: BufferGeometry): Aabb3 {
  geometry.computeBoundingBox()
  const box = geometry.boundingBox
  if (box === null) {
    throw new Error('geometryBounds: geometry has no position attribute')
  }
  const min: Vec3 = [n0(box.min.x), n0(box.min.y), n0(box.min.z)]
  const max: Vec3 = [n0(box.max.x), n0(box.max.y), n0(box.max.z)]
  return { min, max }
}
