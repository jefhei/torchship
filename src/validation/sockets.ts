/**
 * M1-T3 — world-space door-socket resolution + the M0-T2 join channels.
 *
 * The spec validator's socket rules need every door socket of a placed
 * module as a WORLD door: center (meters), facing, and opening — plus the
 * synthesized per-deck spine-band sockets the rooms land on. Resolution is
 * pure rotation/translation math over the M1-T2 canonical primitives:
 *
 *   module origin (deck-local) = [ref.offset.x, deck.yPosition +
 *     ref.offset.y, ref.offset.z]  (offset.y is reserved 0 — floor-pinned)
 *   socket center (world) = origin + rotY(socket.position, ref.rotation)
 *   socket facing (world) = rotY applied to the local facing (quarter-turns
 *     keep horizontal facings axis-aligned)
 *
 * The M0-T2 seam spike measured three independent deviation channels between
 * a door center and its socket target (docs/spikes.md): along the join
 * normal (normal — a δ becomes an open seam of exactly δ), along the wall
 * face horizontally (lateral — δ becomes hatch misalignment of exactly δ),
 * and vertically (vertical — floor-pin drift / door-center step). The
 * validator measures those same three channels between door centers, in mm
 * rounded to 0.001 (float noise floor), and compares them to the measured
 * caps (SEAM_TOLERANCES — never re-derived).
 *
 * This module is deliberately socket-level: it does not judge whether a join
 * is legal (that is validator.ts's rules). It resolves geometry and measures.
 */

import { FACING_VEC, MM, rotY, STANDARD_DOOR_CENTER_M } from '../types'
import type {
  DeckSpec,
  DoorSocket,
  Facing,
  KitManifest,
  ModuleRef,
  Rotation,
  Vec3,
} from '../types'
import { doorSizeOf, getKitModule } from '../types'
import { SPINE_HALF_M } from '../fixtures/layout'

/** Meters → millimeters, rounded to 0.001 mm (float noise floor). */
export function toMm(meters: number): number {
  return Math.round((meters / MM) * 1000) / 1000
}

/** A door socket of a placed module, in world meters. */
export interface PlacedDoor {
  deckIndex: number
  deckId: string
  /** Kit module id of the owner ('spine' for a synthesized deck band). */
  moduleId: string
  /** Index into the deck's modules[] (−1 for the implicit spine band). */
  moduleIndex: number
  /** Socket id within its module (kit socket id, or the band face, e.g. '+z'). */
  socketId: string
  /** Door-center world position, meters. */
  center: Vec3
  /** World outward facing (axis-aligned: quarter-turns keep facings axial). */
  facing: Facing
  /** Resolved opening size (omitted kit door = standard 0.9 × 2.0). */
  width: number
  height: number
}

const AXIS_X = 0
const AXIS_Y = 1
const AXIS_Z = 2

function add(a: Vec3, b: Vec3): Vec3 {
  return [a[AXIS_X] + b[AXIS_X], a[AXIS_Y] + b[AXIS_Y], a[AXIS_Z] + b[AXIS_Z]]
}

function sub(a: Vec3, b: Vec3): Vec3 {
  return [a[AXIS_X] - b[AXIS_X], a[AXIS_Y] - b[AXIS_Y], a[AXIS_Z] - b[AXIS_Z]]
}

function dot(a: Vec3, b: Vec3): number {
  return a[AXIS_X] * b[AXIS_X] + a[AXIS_Y] * b[AXIS_Y] + a[AXIS_Z] * b[AXIS_Z]
}

/** The facing opposite `f` (the normal a mating door must present). */
export function oppositeFacing(f: Facing): Facing {
  switch (f) {
    case '+x':
      return '-x'
    case '-x':
      return '+x'
    case '+z':
      return '-z'
    case '-z':
      return '+z'
  }
}

/** Apply a quarter-turn yaw to a horizontal facing (result stays axial). */
export function rotateFacing(f: Facing, turns: Rotation): Facing {
  const v = rotY(FACING_VEC[f], turns)
  for (const key of Object.keys(FACING_VEC) as Facing[]) {
    if (
      FACING_VEC[key][AXIS_X] === v[AXIS_X] &&
      FACING_VEC[key][AXIS_Z] === v[AXIS_Z]
    ) {
      return key
    }
  }
  // Unreachable for horizontal facings under quarter-turns; keeps TS total.
  throw new Error(`rotateFacing: ${f} × ${turns} left the horizontal plane`)
}

/** Deck-local origin of a placed module (floor-pinned onto the deck plate). */
export function moduleOrigin(ref: ModuleRef, deck: DeckSpec): Vec3 {
  return [ref.offset[AXIS_X], deck.yPosition + ref.offset[AXIS_Y], ref.offset[AXIS_Z]]
}

/** World door for one kit door socket of a placed module. */
export function placeDoor(
  origin: Vec3,
  rotation: Rotation,
  socket: DoorSocket,
  meta: Pick<PlacedDoor, 'deckIndex' | 'deckId' | 'moduleId' | 'moduleIndex'>,
): PlacedDoor {
  const size = doorSizeOf(socket)
  return {
    ...meta,
    socketId: socket.id,
    center: add(origin, rotY(socket.position, rotation)),
    facing: rotateFacing(socket.facing, rotation),
    width: size.width,
    height: size.height,
  }
}

/**
 * Every world door of one placed module (all its kit door sockets, rotated
 * and translated). Throws when the ref names a module the kit does not know
 * — callers schema-check refs first.
 */
export function moduleDoors(
  deck: DeckSpec,
  deckIndex: number,
  ref: ModuleRef,
  moduleIndex: number,
  kit: KitManifest,
): PlacedDoor[] {
  const kitModule = getKitModule(kit, ref.moduleId)
  const origin = moduleOrigin(ref, deck)
  return kitModule.doorSockets.map((socket) =>
    placeDoor(origin, ref.rotation, socket, {
      deckIndex,
      deckId: deck.id,
      moduleId: ref.moduleId,
      moduleIndex,
    }),
  )
}

/**
 * The synthesized spine-band doors of one deck: the continuous shaft column
 * at the deck-local origin presents one standard door socket per face at the
 * standard 1.0 m center (M0-T2 spine band convention — rooms land their
 * spine-doors on these). The band is implicit per deck (never referenced in
 * specs); the assembler materializes it at M3.
 */
export function spineBandDoors(deck: DeckSpec, deckIndex: number): PlacedDoor[] {
  const y = deck.yPosition + STANDARD_DOOR_CENTER_M
  const h = SPINE_HALF_M
  const meta = {
    deckIndex,
    deckId: deck.id,
    moduleId: 'spine',
    moduleIndex: -1,
  }
  // Standard opening (0.9 × 2.0), matching the room spine-doors that land here.
  const standard = doorSizeOf({ id: 'band', position: [0, y, 0], facing: '+z' })
  const centers: Record<Facing, Vec3> = {
    '+x': [h, y, 0],
    '-x': [-h, y, 0],
    '+z': [0, y, h],
    '-z': [0, y, -h],
  }
  return (['+z', '-z', '+x', '-x'] as const).map((facing) => ({
    ...meta,
    socketId: facing,
    center: centers[facing],
    facing,
    width: standard.width,
    height: standard.height,
  }))
}

/**
 * The three M0-T2 deviation channels between two door centers, mm (rounded
 * to 0.001). Measured against `reference` (its outward normal is the join
 * normal):
 *
 *   normalMm   — signed (cOther − cReference) · nReference: positive = the
 *                other door stands proud along the normal (open seam /
 *                proud of the face); negative = pushed in (overlap).
 *   lateralMm  — in-plane horizontal offset along the wall face.
 *   verticalMm — |Δy|, door-center height disagreement (a door-center step
 *                when the pair is a would-be mating join).
 */
export function doorCenterDeviationMm(
  reference: PlacedDoor,
  other: PlacedDoor,
): { normalMm: number; lateralMm: number; verticalMm: number } {
  const delta = sub(other.center, reference.center)
  const n = FACING_VEC[reference.facing]
  const normal = dot(delta, n)
  const perp = sub(delta, [n[0] * normal, n[1] * normal, n[2] * normal])
  return {
    normalMm: toMm(normal),
    lateralMm: toMm(
      Math.sqrt(perp[AXIS_X] * perp[AXIS_X] + perp[AXIS_Z] * perp[AXIS_Z]),
    ),
    verticalMm: toMm(Math.abs(perp[AXIS_Y])),
  }
}

/** True when both doors sit in one axis-aligned vertical wall pair. */
export function doorPlanesCoincideFacing(a: PlacedDoor, b: PlacedDoor): boolean {
  return a.facing === oppositeFacing(b.facing)
}

/**
 * True when two door OPENINGS overlap in their shared wall plane: intervals
 * overlap both along the wall's horizontal axis and vertically. Two doors
 * whose openings do not overlap cannot be a mating pair (they do not line
 * up as a pass-through), no matter how close their centers are.
 */
export function openingsOverlap(a: PlacedDoor, b: PlacedDoor): boolean {
  const horizontal = a.facing === '+x' || a.facing === '-x' ? AXIS_Z : AXIS_X
  const aLo = a.center[horizontal] - a.width / 2
  const aHi = a.center[horizontal] + a.width / 2
  const bLo = b.center[horizontal] - b.width / 2
  const bHi = b.center[horizontal] + b.width / 2
  const horizontalOverlap = aLo < bHi && bLo < aHi
  const aBot = a.center[AXIS_Y] - a.height / 2
  const aTop = a.center[AXIS_Y] + a.height / 2
  const bBot = b.center[AXIS_Y] - b.height / 2
  const bTop = b.center[AXIS_Y] + b.height / 2
  return horizontalOverlap && aBot < bTop && bBot < aTop
}

/** Human label for a placed door, e.g. 'deck 2 "ops" galley#0 socket "side-door"'. */
export function doorLabel(d: PlacedDoor): string {
  const who =
    d.moduleId === 'spine'
      ? `deck ${d.deckIndex} "${d.deckId}" spine band`
      : `deck ${d.deckIndex} "${d.deckId}" ${d.moduleId}#${d.moduleIndex}`
  return `${who} socket "${d.socketId}"`
}
