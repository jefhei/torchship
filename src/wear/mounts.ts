/**
 * M4-T4 — what the worn-detail pass is allowed to decorate, and where it may
 * not go.
 *
 * Nothing here is freehand (BUILD_PLAN rule 8). The pass mounts its detail on
 * surfaces it can DERIVE from the module instance it decorates:
 *
 *  - **wall panels** — the module's own `bulkhead` boxes that are tall, wide
 *    and thin (the kit's wall panels, src/kit/parts.ts `bulkheadParts`). The
 *    inner face is the side that faces the module's own centre, which the M1-T2
 *    authoring frame puts at the local origin; a panel's in-plane rectangle is
 *    the surface a patch is painted on or a cable drop is clipped to;
 *  - **the deck plate** — the floor plane at the module frame's local y = 0,
 *    which is where a loose prop rests;
 *  - **the module's light sockets** — a cable route starts at a fixture the
 *    module already authored (the M4-T2 rig lights exactly those), never at an
 *    invented point;
 *  - **door zones** — every door socket's opening, extruded into the room. No
 *    detail may stand in one: the doorway approach is the walk-in lane, and it
 *    is also what keeps the M3-T6 spawn pose clear of the pass.
 *
 * A wall panel carries the doorway CUT ITSELF (the kit emits the piers and
 * lintel around the opening), so mounting inside a panel's rectangle is
 * doorway-free by construction — the zones below are the belt to that braces:
 * they also keep loose floor props well clear of the openings.
 */

import { FACING_VEC } from '../types'
import { doorSizeOf } from '../types'
import type { Aabb3, Facing, Vec3 } from '../types'
import { partBounds } from '../kit/parts'
import { moduleParts } from '../kit/modules/types'
import type { AuthoredModule } from '../kit/modules/types'
import { overlapDepth } from '../assembler/collision'
import {
  WALL_MOUNT_MAX_THICKNESS_M,
  WALL_MOUNT_MIN_HEIGHT_M,
  WALL_MOUNT_MIN_WIDTH_M,
} from './recipes'

/** A wall surface the pass may mount detail on, module-local meters. */
export interface WallMount {
  /** Index into the module's own part list (`moduleParts(module)` order). */
  partIndex: number
  /** Axis the wall face's normal runs along (0 = X, 2 = Z). */
  normalAxis: 0 | 2
  /** Module-local coordinate of the inner face along that axis. */
  faceCoord: number
  /** Direction from the face into the room (+1 / −1 along `normalAxis`). */
  inward: 1 | -1
  /** The face's extent along the plane's own horizontal axis (local X or Z). */
  uLo: number
  uHi: number
  /** The face's vertical extent, meters (from the module floor). */
  vLo: number
  vHi: number
}

/**
 * The module's wall panels: every `bulkhead` box that is at least
 * `WALL_MOUNT_MIN_HEIGHT_M` tall, at least `WALL_MOUNT_MIN_WIDTH_M` wide and
 * no thicker than `WALL_MOUNT_MAX_THICKNESS_M`. Panels straddling the module
 * centre are skipped (they have no inner face), and hatch frames/leaves never
 * qualify — they are shorter than the height floor and are excluded by the
 * door zones anyway.
 */
export function wallMountsOf(module: AuthoredModule): WallMount[] {
  const mounts: WallMount[] = []
  moduleParts(module).forEach((part, partIndex) => {
    if (part.kind !== 'box' || part.materialSlot !== 'bulkhead') return
    const bounds = partBounds(part)
    const spans: [number, number, number] = [
      bounds.max[0] - bounds.min[0],
      bounds.max[1] - bounds.min[1],
      bounds.max[2] - bounds.min[2],
    ]
    if (spans[1] < WALL_MOUNT_MIN_HEIGHT_M) return
    const normalAxis = (spans[0] <= spans[2] ? 0 : 2) as 0 | 2
    const spanAxis = normalAxis === 0 ? 2 : 0
    if (spans[normalAxis] > WALL_MOUNT_MAX_THICKNESS_M) return
    if (spans[spanAxis] < WALL_MOUNT_MIN_WIDTH_M) return
    const centre = (bounds.min[normalAxis] + bounds.max[normalAxis]) / 2
    if (centre === 0) return
    const inward: 1 | -1 = centre < 0 ? 1 : -1
    mounts.push({
      partIndex,
      normalAxis,
      faceCoord: inward === 1 ? bounds.max[normalAxis] : bounds.min[normalAxis],
      inward,
      uLo: bounds.min[spanAxis],
      uHi: bounds.max[spanAxis],
      vLo: Math.max(bounds.min[1], 0),
      vHi: bounds.max[1],
    })
  })
  return mounts
}

/** The plane's horizontal axis for a wall face (the one that is not the normal). */
export function spanAxisOf(normalAxis: 0 | 2): 0 | 2 {
  return normalAxis === 0 ? 2 : 0
}

/** The module's usable floor plane, module-local meters (the M1-T2 frame). */
export interface FloorMount {
  y: number
  halfX: number
  halfZ: number
}

/** The deck-plate plane a loose prop rests on (local y = 0, footprint centred). */
export function floorMountOf(module: AuthoredModule): FloorMount {
  const [width, , depth] = module.manifest.dimensions
  return { y: 0, halfX: width / 2, halfZ: depth / 2 }
}

/**
 * The index of the module part that IS the deck plate a floor prop rests on: the
 * `deckplate` part whose walking surface is the module floor (top face at local
 * y ≈ 0) with the widest footprint. The whole-plate box is the mount a prop's
 * base must touch (the plate's own cable-run ducts sit on top of it, which is
 * exactly the deck a prop is stowed on).
 */
export function floorMountPartOf(module: AuthoredModule): number | undefined {
  const parts = moduleParts(module)
  let best: number | undefined
  let bestArea = 0
  parts.forEach((part, index) => {
    if (part.materialSlot !== 'deckplate') return
    const bounds = partBounds(part)
    if (Math.abs(bounds.max[1]) > 1e-9) return
    const area = (bounds.max[0] - bounds.min[0]) * (bounds.max[2] - bounds.min[2])
    if (area > bestArea) {
      bestArea = area
      best = index
    }
  })
  return best
}

/* ----------------------------------------------------------- door zones */

/** The minimum a door needs to describe its keep-clear zone. */
export interface DoorFace {
  center: Vec3
  facing: Facing
  width: number
  height: number
}

/** How far past the socket plane a zone still reaches (covers the plane itself). */
const DOOR_PLANE_SLACK_M = 0.05

/**
 * The volume a door's approach must stay clear of: its opening, grown
 * `lateral` across the face and along the height, extruded from the socket
 * plane `reach` meters INTO the room (the direction opposite the socket's
 * outward facing).
 *
 * The box is the opening GROWN; it is deliberately not clamped to the floor
 * plane, because the same function measures a module-local socket (floor at
 * y = 0) and a PLACED one (a real deck floor, which is below y = 0 on every
 * deck but the first — clamping there would invert the box and the
 * keep-clear rule would silently never fire; wear.test.ts pins both frames).
 */
export function doorZoneBox(door: DoorFace, reach: number, lateral: number): Aabb3 {
  const horizontal = (door.facing === '+x' || door.facing === '-x' ? 2 : 0) as 0 | 2
  const normal = horizontal === 0 ? 2 : 0
  const inward = -FACING_VEC[door.facing][normal]
  const min: [number, number, number] = [0, 0, 0]
  const max: [number, number, number] = [0, 0, 0]
  min[horizontal] = door.center[horizontal] - door.width / 2 - lateral
  max[horizontal] = door.center[horizontal] + door.width / 2 + lateral
  min[1] = door.center[1] - door.height / 2 - lateral
  max[1] = door.center[1] + door.height / 2 + lateral
  min[normal] = Math.min(
    door.center[normal] - DOOR_PLANE_SLACK_M,
    door.center[normal] + inward * reach,
  )
  max[normal] = Math.max(
    door.center[normal] + DOOR_PLANE_SLACK_M,
    door.center[normal] + inward * reach,
  )
  return { min, max }
}

/** The door keep-clear zones of one authored module, module-local meters. */
export function moduleDoorZones(
  module: AuthoredModule,
  reach: number,
  lateral: number,
): Aabb3[] {
  return module.manifest.doorSockets.map((socket) => {
    const size = doorSizeOf(socket)
    return doorZoneBox(
      {
        center: socket.position,
        facing: socket.facing,
        width: size.width,
        height: size.height,
      },
      reach,
      lateral,
    )
  })
}

/** The door keep-clear zones of one placed module instance, world meters. */
export function placedDoorZones(
  doors: readonly { center: Vec3; facing: Facing; width: number; height: number }[],
  reach: number,
  lateral: number,
): Aabb3[] {
  return doors.map((door) => doorZoneBox(door, reach, lateral))
}

/** True when `box` overlaps any zone by more than `eps` meters. */
export function overlapsAny(box: Aabb3, zones: readonly Aabb3[], eps: number): boolean {
  return zones.some((zone) => overlapDepth(box, zone) > eps)
}

/** True when `box` overlaps any of `boxes` by more than `eps` meters. */
export function overlapsAnyBox(
  box: Aabb3,
  boxes: readonly Aabb3[],
  eps: number,
): boolean {
  return boxes.some((other) => overlapDepth(box, other) > eps)
}

/** The smallest distance between two boxes (0 when they touch or overlap). */
export function boxGap(a: Aabb3, b: Aabb3): number {
  let gap = 0
  for (let axis = 0; axis < 3; axis++) {
    gap = Math.max(gap, b.min[axis] - a.max[axis], a.min[axis] - b.max[axis])
  }
  return gap
}

/** The union of two boxes. */
export function boxUnion(a: Aabb3, b: Aabb3): Aabb3 {
  return {
    min: [
      Math.min(a.min[0], b.min[0]),
      Math.min(a.min[1], b.min[1]),
      Math.min(a.min[2], b.min[2]),
    ],
    max: [
      Math.max(a.max[0], b.max[0]),
      Math.max(a.max[1], b.max[1]),
      Math.max(a.max[2], b.max[2]),
    ],
  }
}
