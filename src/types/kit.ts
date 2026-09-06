/**
 * M1-T2 — Module Kit manifest contract (PRD §7, "kit → assembler").
 *
 * Every authored module type exposes this shape to the assembler: dimensions,
 * door sockets (the ONLY join interface — M3-T2's "never freehand" rule), the
 * light sockets the M4 practical-light rig places from, equipment slots (named
 * anchors for props / interactives), and a collision hint for the M3 per-deck
 * hulls. The spine shaft is a kit module type too (M2-T6) whose sockets sit at
 * every deck level.
 *
 * Authoring frame (standardized, matches the M0-T2 white-box kit the seam
 * spike measured): the module's floor plane is local y = 0 and its footprint
 * is centered on the local origin in XZ, so `dimensions` is the full
 * bounding box [x, y, z] with the floor at y = 0. Door sockets are flush in
 * their module faces; door centers default to the standard 1.0 m height
 * (STANDARD_DOOR_CENTER_M) with the standard 0.9 × 2.0 m opening.
 *
 * `doorCenterDeckOffsetM` is the contract's "deck offset": how far a door's
 * center sits above the standard height. A nonzero deck offset is legal kit
 * (engineering's 1.2 m high-hatch is deliberate) but every mating pair whose
 * door-center heights disagree beyond tolerance is a validator rejection
 * (M0-T2 decision 3).
 */

import type { Facing, Rotation, Vec3 } from './geometry'
import { STANDARD_DOOR_CENTER_M, STANDARD_DOOR_SIZE } from './units'
import { SEAM_TOLERANCES } from '../spikes/seams/tolerances'

/** A door opening, meters. Omitted on a DoorSocket = the standard 0.9 × 2.0 m. */
export interface DoorSize {
  width: number
  height: number
}

/**
 * A door socket — the standardized join interface. The assembler only ever
 * joins module-to-module or module-to-spine at door sockets, and mating
 * geometry is generated from them (never freehand).
 */
export interface DoorSocket {
  /** Socket id, unique within its module ('spine-door', 'side-door', …). */
  id: string
  /**
   * Door-center position in module-local meters, flush with the face the door
   * opens through. position[1] is the door-center height above the module
   * floor; the standard height is STANDARD_DOOR_CENTER_M.
   */
  position: Vec3
  /** Outward normal of the face this door sits in (doors live in vertical walls). */
  facing: Facing
  /** Opening size; omitted = standard 0.9 × 2.0 m. */
  door?: DoorSize
}

/** Light-archetype kinds the M4 practical-light rig places from. */
export type LightKind = 'panel' | 'task' | 'screen' | 'reactor'

/** A light fixture anchor: where (and what kind of) light a module carries. */
export interface LightSocket {
  /** Socket id, unique within its module ('panel-1', 'task-coffee', …). */
  id: string
  kind: LightKind
  /** Module-local position, meters (e.g. a panel light near the ceiling). */
  position: Vec3
  /** Optional orientation for directional fixtures (task/screen/reactor). */
  rotation?: Rotation
}

/** A named equipment anchor (crash couch, coffee station, locker bank, …). */
export interface EquipmentSlot {
  /** Slot id, unique within its module ('coffee-station', 'couch-pilot', …). */
  id: string
  /** Module-local position of the prop's origin, meters (rests on the floor). */
  position: Vec3
  /** Optional yaw for oriented props. */
  rotation?: Rotation
}

/** Axis-aligned box in module-local meters (min corner → max corner). */
export interface Aabb3 {
  min: Vec3
  max: Vec3
}

/** Collision hint a module exposes to the M3 per-deck hull builder. */
export interface CollisionHint {
  /** Solid volumes of the module (bulkheads, kit), module-local. */
  boxes: Aabb3[]
}

/** One authored module type of the kit. */
export interface KitModule {
  /** Module type id, unique across the kit ('head', 'galley', 'spine', …). */
  id: string
  /** Human label (kit type + role), e.g. 'Galley / bunk (table + coffee station)'. */
  label: string
  /**
   * Full bounding box in meters [x, y, z]; floor at local y = 0; footprint
   * centered on the local origin in XZ (authoring frame above).
   */
  dimensions: Vec3
  doorSockets: DoorSocket[]
  lightSockets: LightSocket[]
  equipmentSlots: EquipmentSlot[]
  collisionHint: CollisionHint
}

/** The module-kit manifest: every module type the assembler may reference. */
export interface KitManifest {
  /** Authored module types; ids unique across the manifest. */
  modules: KitModule[]
}

/** Look up a kit module by id; throws on unknown ids (spec typos surface early). */
export function getKitModule(manifest: KitManifest, moduleId: string): KitModule {
  const m = manifest.modules.find((x) => x.id === moduleId)
  if (!m) throw new Error(`kit manifest: no module "${moduleId}"`)
  return m
}

/** Door opening a socket actually carries (omitted = standard 0.9 × 2.0 m). */
export function doorSizeOf(socket: DoorSocket): DoorSize {
  return socket.door ?? STANDARD_DOOR_SIZE
}

/**
 * A socket's "deck offset": signed meters its door center sits above the
 * standard 1.0 m height. Zero = standard door; nonzero = declared non-standard
 * center (engineering's high-hatch is +0.2). Mating pairs whose offsets
 * disagree are validator rejections (M0-T2 decision 3).
 */
export function doorCenterDeckOffsetM(socket: DoorSocket): number {
  return socket.position[1] - STANDARD_DOOR_CENTER_M
}

/** True when the door center is at the standard 1.0 m height. */
export function isStandardDoorCenter(socket: DoorSocket): boolean {
  return doorCenterDeckOffsetM(socket) === 0
}

/**
 * Authoring tolerance for socket placement, meters: the M0-T2 measured budget
 * maxSocketAuthoringErrorMm (±0.5 mm per axis) — sockets must sit flush in
 * their faces within this, or the 2× watertight margin is lost.
 */
const SOCKET_EPS_M = SEAM_TOLERANCES.maxSocketAuthoringErrorMm * 1e-3

/**
 * Structural problems in a kit manifest, as human-readable strings (one per
 * problem). Covers the authoring-frame contract: unique ids, positive
 * dimensions, door sockets flush in their faces with openings that fit the
 * module box, and light/equipment anchors inside the box. Empty = intact.
 * (This checks the KIT against its own contract; the M1-T3 validator checks
 * how a ShipSpec joins kit modules together.)
 */
export function kitManifestProblems(manifest: KitManifest): string[] {
  const problems: string[] = []

  const seenModuleIds = new Set<string>()
  for (const m of manifest.modules) {
    if (seenModuleIds.has(m.id)) {
      problems.push(`module id "${m.id}" is duplicated in the manifest`)
    }
    seenModuleIds.add(m.id)

    const [dx, dy, dz] = m.dimensions
    if (!(dx > 0 && dy > 0 && dz > 0)) {
      problems.push(
        `module "${m.id}": dimensions must be positive, got [${dx}, ${dy}, ${dz}]`,
      )
    }

    const halfX = dx / 2
    const halfZ = dz / 2

    const seenDoor = new Set<string>()
    for (const s of m.doorSockets) {
      if (seenDoor.has(s.id)) {
        problems.push(`module "${m.id}": door socket id "${s.id}" is duplicated`)
      }
      seenDoor.add(s.id)

      const [px, py, pz] = s.position
      const door = doorSizeOf(s)
      const hw = door.width / 2
      const hh = door.height / 2

      // Flush in the face the socket faces (within the ±0.5 mm authoring budget).
      const onFace =
        s.facing === '+x' || s.facing === '-x'
          ? Math.abs(px - (s.facing === '+x' ? halfX : -halfX))
          : Math.abs(pz - (s.facing === '+z' ? halfZ : -halfZ))
      if (onFace > SOCKET_EPS_M) {
        problems.push(
          `module "${m.id}": door socket "${s.id}" sits ${onFace.toFixed(4)} m off its ${s.facing} face`,
        )
      }

      // The opening must fit inside the module box: along the face horizontally,
      // and between floor (y = 0) and ceiling (y = dims.y) vertically.
      const alongAxis = s.facing === '+x' || s.facing === '-x' ? pz : px
      const halfAlong = s.facing === '+x' || s.facing === '-x' ? halfZ : halfX
      if (
        alongAxis - hw < -halfAlong - SOCKET_EPS_M ||
        alongAxis + hw > halfAlong + SOCKET_EPS_M
      ) {
        problems.push(
          `module "${m.id}": door "${s.id}" (${door.width} m wide) overhangs its ${s.facing} face`,
        )
      }
      if (py - hh < -SOCKET_EPS_M || py + hh > dy + SOCKET_EPS_M) {
        problems.push(
          `module "${m.id}": door "${s.id}" (${door.height} m tall at center y ${py}) does not fit floor-to-ceiling (${dy} m)`,
        )
      }
    }

    const inside = (what: string, id: string, [x, y, z]: Vec3): boolean => {
      const ok =
        x >= -halfX - SOCKET_EPS_M &&
        x <= halfX + SOCKET_EPS_M &&
        z >= -halfZ - SOCKET_EPS_M &&
        z <= halfZ + SOCKET_EPS_M &&
        y >= -SOCKET_EPS_M &&
        y <= dy + SOCKET_EPS_M
      if (!ok) {
        problems.push(
          `module "${m.id}": ${what} "${id}" at [${x}, ${y}, ${z}] is outside the module box [${dx} × ${dy} × ${dz}]`,
        )
      }
      return ok
    }

    const seenLight = new Set<string>()
    for (const l of m.lightSockets) {
      if (seenLight.has(l.id)) {
        problems.push(`module "${m.id}": light socket id "${l.id}" is duplicated`)
      }
      seenLight.add(l.id)
      inside('light socket', l.id, l.position)
    }

    const seenEquip = new Set<string>()
    for (const e of m.equipmentSlots) {
      if (seenEquip.has(e.id)) {
        problems.push(`module "${m.id}": equipment slot id "${e.id}" is duplicated`)
      }
      seenEquip.add(e.id)
      inside('equipment slot', e.id, e.position)
    }
  }

  return problems
}

/**
 * Kit-manifest integrity gate: throws (listing every problem) when the
 * manifest violates its own contract. Fixtures (M0-T5), the kit harness
 * (M2-T7) and CI call this so a malformed kit fails the build, not the walk.
 */
export function assertKitManifestIntegrity(manifest: KitManifest): void {
  const problems = kitManifestProblems(manifest)
  if (problems.length > 0) {
    throw new Error(`kit manifest integrity:\n- ${problems.join('\n- ')}`)
  }
}
