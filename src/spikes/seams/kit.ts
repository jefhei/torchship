/**
 * M0-T2 spike — white-box module kit (six module types).
 *
 * These are NOT the M2 authored kit. They are the contract-level stand-ins:
 * dimensions + door sockets only, authored to the exactness rules the spike
 * is testing. The decision carried forward from the spike is that door
 * sockets are the ONLY join interface, so what matters here is socket
 * origin/height/axis — every socket is flush with its module face, on the
 * kit's local floor grid, at a standard door-center height above the floor.
 *
 * Scale constraints from PRD §4/§6: deck clear height 3.0 m, deck pitch
 * 3.2 m (3.0 clear + 0.2 m plate), standard hatch 0.9 × 2.0 m centered
 * 1.0 m above the floor (cramped ship — walk-through doors, not airlocks).
 * Deck index 0 is the head deck (nose, +Y); floors descend with index:
 * deckFloorY(i) = −i · DECK_PITCH.
 *
 * Non-standard doors are legal kit (the contract's DoorSocket carries a
 * deck offset) but they must be deliberate — the kit scanner below flags
 * them so the seam spike can prove the invariant that catches them.
 */

import type { Facing, Vec3 } from './vec'

export const DECK_CLEAR_M = 3.0
export const DECK_PITCH_M = 3.2
/** Standard door-center height above the module floor (door 2.0 m tall). */
export const STANDARD_DOOR_CENTER_M = 1.0
export const STANDARD_DOOR = { w: 0.9, h: 2.0 } as const
/** Spine shaft outer half-extent in XZ (shaft ~1.4 m square). */
export const SPINE_HALF_M = 0.7

/** World Y of deck i's floor. Deck 0 (head) is highest; −Y is aft/drive. */
export function deckFloorY(deckIndex: number): number {
  return -deckIndex * DECK_PITCH_M
}

export interface ModuleSocketDef {
  id: string
  /** Local position of the door-center (meters; flush with the module face). */
  pos: Vec3
  /** Local facing of the door (outward normal of the face it sits in). */
  axis: Facing
  /** Door opening size, meters. */
  door: { w: number; h: number }
  /** True when the door center is not at STANDARD_DOOR_CENTER_M. */
  nonStandardCenter: boolean
}

export interface ModuleDef {
  id: string
  /** Human label (kit type). */
  label: string
  /** White-box bounding box: x × y × z meters, floor at local y = 0. */
  dims: Vec3
  sockets: ModuleSocketDef[]
}

/** Door socket shape used while authoring the kit table below. */
type SocketSeed = {
  id: string
  pos: Vec3
  axis: Facing
  door?: { w: number; h: number }
}

function socket(seed: SocketSeed): ModuleSocketDef {
  const door = seed.door ?? STANDARD_DOOR
  return {
    id: seed.id,
    pos: seed.pos,
    axis: seed.axis,
    door,
    nonStandardCenter: seed.pos[1] !== STANDARD_DOOR_CENTER_M,
  }
}

/**
 * Room modules (the five non-spine kit types). Each carries a `spine-door`
 * on its −z face at (0, 1.0, −depth/2): the standardized spine-ward socket
 * every room presents to the shaft. Room boxes are centered on the local
 * origin in XZ, floor at local y = 0.
 *
 * `high-hatch` on engineering is deliberately non-standard (door center at
 * 1.2 m, 0.8 × 1.6 door): machinery decks step down, and the spike needs a
 * real authored height inconsistency to measure (the deck-offset field of
 * the DoorSocket contract in action).
 */
export const ROOM_MODULES: ModuleDef[] = [
  {
    id: 'head',
    label: 'Bridge / head (crash couches, sensor wall)',
    dims: [4.8, DECK_CLEAR_M, 3.6],
    sockets: [
      socket({ id: 'spine-door', pos: [0, STANDARD_DOOR_CENTER_M, -1.8], axis: '-z' }),
    ],
  },
  {
    id: 'galley',
    label: 'Galley / bunk (table + coffee station)',
    dims: [4.2, DECK_CLEAR_M, 5.0],
    sockets: [
      socket({ id: 'spine-door', pos: [0, STANDARD_DOOR_CENTER_M, -2.5], axis: '-z' }),
      socket({ id: 'side-door', pos: [2.1, STANDARD_DOOR_CENTER_M, 1.2], axis: '+x' }),
    ],
  },
  {
    id: 'ops',
    label: 'Ops (airlock + suit locker, workbench, med bay)',
    dims: [3.9, DECK_CLEAR_M, 4.6],
    sockets: [
      socket({ id: 'spine-door', pos: [0, STANDARD_DOOR_CENTER_M, -2.3], axis: '-z' }),
      socket({
        id: 'side-door',
        pos: [-1.95, STANDARD_DOOR_CENTER_M, -1.0],
        axis: '-x',
      }),
    ],
  },
  {
    id: 'engineering',
    label: 'Engineering (reactor access, drive glow window)',
    dims: [4.5, DECK_CLEAR_M, 4.8],
    sockets: [
      socket({ id: 'spine-door', pos: [0, STANDARD_DOOR_CENTER_M, -2.4], axis: '-z' }),
      // Deliberate non-standard deck offset: 0.2 m above the standard center.
      socket({
        id: 'high-hatch',
        pos: [2.25, STANDARD_DOOR_CENTER_M + 0.2, 0.6],
        axis: '+x',
        door: { w: 0.8, h: 1.6 },
      }),
    ],
  },
  {
    id: 'storage',
    label: 'Storage (long-haul variant)',
    dims: [4.0, DECK_CLEAR_M, 6.0],
    sockets: [
      socket({ id: 'spine-door', pos: [0, STANDARD_DOOR_CENTER_M, -3.0], axis: '-z' }),
      socket({ id: 'side-door', pos: [2.0, STANDARD_DOOR_CENTER_M, 1.0], axis: '+x' }),
    ],
  },
]

/**
 * Spine shaft kit type: one continuous vertical band per deck with four
 * outward-facing hatch sockets (one per face). Socket y-centers sit at
 * STANDARD_DOOR_CENTER_M above the deck floor.
 */
export function spineDeckBand(deckIndex: number): ModuleDef {
  const y = deckFloorY(deckIndex) + STANDARD_DOOR_CENTER_M
  const h = SPINE_HALF_M
  const face = (id: string, x: number, z: number, axis: Facing): ModuleSocketDef =>
    socket({ id, pos: [x, y, z], axis })
  return {
    id: 'spine',
    label: `Spine shaft, deck ${deckIndex}`,
    dims: [SPINE_HALF_M * 2, DECK_CLEAR_M, SPINE_HALF_M * 2],
    sockets: [
      face('+z', 0, h, '+z'),
      face('-z', 0, -h, '-z'),
      face('+x', h, 0, '+x'),
      face('-x', -h, 0, '-x'),
    ],
  }
}

/** All six module types of the spike: five rooms + one spine deck band. */
export function kitSix(deckIndex = 0): ModuleDef[] {
  return [...ROOM_MODULES, spineDeckBand(deckIndex)]
}

export function findSocket(def: ModuleDef, socketId: string): ModuleSocketDef {
  const s = def.sockets.find((x) => x.id === socketId)
  if (!s) throw new Error(`${def.id}: no socket "${socketId}"`)
  return s
}

/** Kit scan: rooms whose door centers deviate from the standard height. */
export function nonStandardDoors(): {
  moduleId: string
  socketId: string
  centerY: number
}[] {
  const out: { moduleId: string; socketId: string; centerY: number }[] = []
  for (const m of ROOM_MODULES) {
    for (const s of m.sockets) {
      if (s.nonStandardCenter) {
        out.push({ moduleId: m.id, socketId: s.id, centerY: s.pos[1] })
      }
    }
  }
  return out
}
