/**
 * M3-T5 — hatch traversal: the leaf state machine, and the collision the closed
 * leaf owns.
 *
 * PRD §6.1 makes vertical navigation "a first-class mechanic", and the spine's
 * four face doorways are sealed by the ROOM's own hatch leaf (M2-T2: the module
 * authors a `fillsSocket` hatch on each door socket it owns, and the M3-T1
 * assembler emits it as a named `kind: 'hatch'` interactive). The M3-T3 collision
 * doc states the split this module implements:
 *
 *   "a hatch leaf is interactive geometry whose collision belongs to the M3-T5
 *    state machine, so neither contributes a static box"
 *
 * So the deck's static hull deliberately does NOT contain hatch leaves — a
 * doorway with a closed hatch must stay walkable for the tests that walk the
 * *geometry* (M3-T4's walker enters the shaft through it) — and the state
 * machine adds the leaf's box while it is closed. That is what makes a hatch a
 * door: walking into a closed one stops you; press E and it retracts into the
 * jamb and you pass. `nav.ts` merges `hatchBlockerBoxes` into the hull it hands
 * the walker each frame, so no second collision model exists anywhere.
 *
 * THE LEAF IS MEASURED, NOT MODELLED. A hatch's closed box is the world box of
 * the leaf part the module actually authored (`selfSealingAssemblyOf` seated on
 * the socket — M3-T2's own pairing rule, the socket IS the hatch's anchor), one
 * box for one leaf, so the blocker the walker meets is the geometry the renderer
 * draws (BUILD_PLAN rule 8).
 *
 * OPEN = RETRACTED INTO THE JAMB. A hatch leaf is 0.88 × 1.98 × 0.05 m — wider
 * than a 0.9 m opening's jamb has room to swing across in a ship this cramped
 * (the bridge's crash couches sit either side of its spine door). So an opened
 * leaf folds back IN THE WALL'S OWN PLANE over the lower jamb, mirrored about the
 * opening's own edge (taken from the door socket's width — never freehand), which
 * puts the open box inside the wall's own hull: an open hatch obstructs nothing,
 * and a closed one seals the doorway. The hinge side is the socket's lower
 * in-plane edge, deterministic on every ship.
 *
 * INTERACTION. One interact key (E) with a reach and a facing test, so the HUD
 * can name the hatch you are standing at ("E — open hatch"). Opening is always
 * allowed (the leaf is moving out of the passage); CLOSING is refused when the
 * walker's own body would be inside the leaf (`blocked`) — a hatch never squashes
 * the player, and a walker standing in a doorway can see why it did not close.
 *
 * Pure and three-agnostic: hatches are derived records, the toggle is a state
 * transition, and the reach test is arithmetic — all of it unit-tests headlessly.
 */

import type { Aabb3, Facing, Vec3 } from '../types'
import type { PlacedModule, ShipAssembly } from '../assembler'
import { selfSealingAssemblyOf } from '../assembler'
import type { PlacedDoor } from '../validation'
import { assemblyParts } from '../kit/modules/types'
import { placeParts } from '../kit/modules/placement'
import { partBounds } from '../kit/parts'
import { CONTACT_EPS_M } from './collide'
import { bodyBoxAt, distanceToBoxXZ, type WalkerShape } from './hull'
import { EYE_HEIGHT_M } from './move'

const AXIS_X = 0
const AXIS_Y = 1
const AXIS_Z = 2

/** Normalize −0 → 0 (Object.is-strict comparisons treat signed zeros apart). */
function n0(value: number): number {
  return value === 0 ? 0 : value
}

/* -------------------------------------------------------------- tuning set */

/**
 * How close a walker's feet must be to a hatch's leaf to interact with it (m,
 * in the deck plane). A doorway is 0.9 m wide, so this reaches from the lane in
 * front of the leaf to about a metre back into the room.
 */
export const HATCH_REACH_M = 1.1

/**
 * How squarely the camera must face a hatch to interact with it (cosine: 0.35 ≈
 * 70°). Deliberately loose — a hatch is a wall of a thing, and you often reach
 * for it without squaring up to it.
 */
export const HATCH_FACING_DOT = 0.35

/**
 * Within this distance (m, in the deck plane) the facing test is WAIVED: a
 * walker standing against a hatch can work it without turning round. That is the
 * pose the climb leaves you in — a climber arrives in the trunk facing the
 * ladder, with the deck's own hatch behind them — and making the player turn on
 * the rung line to open a door they are touching is exactly the fiddly-ladder
 * feel the M0-T4 spike was about.
 */
export const HATCH_FACING_WAIVE_M = 0.5

/** Vertical window around the doorway's own span a walker can reach into (m). */
export const HATCH_VERTICAL_REACH_M = 1.4

/* ---------------------------------------------------------------- the leaf */

/**
 * One hatch of a ship: the door socket it seals, and the leaf's box in each of
 * its two states. The state itself lives in the navigation state (a hatch's
 * open/closed flag is player state, not ship geometry).
 */
export interface Hatch {
  /** Stable id: `deck-${deckIndex}-${moduleId}#${moduleIndex}-${socketId}`. */
  id: string
  deckIndex: number
  deckId: string
  moduleId: string
  moduleIndex: number
  socketId: string
  /** The door socket the leaf seals (its center, facing and opening). */
  door: PlacedDoor
  /** The leaf's box while the hatch is shut — the geometry that blocks. */
  closedBox: Aabb3
  /** The leaf's box once retracted into the jamb (in the wall's own plane). */
  openBox: Aabb3
  /** The in-plane horizontal world axis the leaf spans (0 = X, 2 = Z). */
  horizontalAxis: 0 | 2
}

/** The in-plane horizontal axis of a wall facing (its normal is the other one). */
function horizontalAxisOf(facing: Facing): 0 | 2 {
  return facing === '+x' || facing === '-x' ? AXIS_Z : AXIS_X
}

/**
 * The leaf's retracted box: the closed box mirrored in-plane about the opening's
 * LOWER edge (from the socket's own width), so the leaf folds back over the jamb
 * inside the wall's plane. The normal axis is untouched — the retracted leaf lies
 * in the doorway's own plane rather than swinging into the room.
 */
function retractedBox(closed: Aabb3, door: PlacedDoor, horizontal: 0 | 2): Aabb3 {
  const low = door.center[horizontal] - door.width / 2
  const width = closed.max[horizontal] - closed.min[horizontal]
  const min: [number, number, number] = [...closed.min]
  const max: [number, number, number] = [...closed.max]
  // Mirror the leaf's own span about the opening's low edge: [low − width, low].
  min[horizontal] = n0(low - width)
  max[horizontal] = n0(low)
  return { min, max }
}

/**
 * Every hatch of an assembled ship, deck by deck: the module instances' own
 * `fillsSocket` leaves. A hatch whose leaf geometry cannot be found is skipped
 * (the M3-T2 seam plan reports an unpaired hatch as a problem, never this
 * module) — a hatch is only ever as real as the geometry behind it.
 */
export function hatchesOf(ship: ShipAssembly): Hatch[] {
  const hatches: Hatch[] = []
  for (const deck of ship.decks) {
    for (const owner of deck.modules) {
      if (owner.band) continue
      for (const door of owner.doors) {
        const assembly = selfSealingAssemblyOf(owner, door)
        if (assembly === undefined) continue
        const leafParts = placeParts(assemblyParts(assembly), {
          position: owner.origin,
          rotation: owner.rotation,
        })
        const leaf = leafParts[0]
        if (leaf === undefined) continue
        const closedBox = partBounds(leaf)
        const horizontalAxis = horizontalAxisOf(door.facing)
        hatches.push({
          id: hatchId(deck.deckId, owner, door),
          deckIndex: deck.deckIndex,
          deckId: deck.deckId,
          moduleId: owner.source.moduleId,
          moduleIndex: owner.source.moduleIndex,
          socketId: door.socketId,
          door,
          closedBox,
          openBox: retractedBox(closedBox, door, horizontalAxis),
          horizontalAxis,
        })
      }
    }
  }
  return hatches
}

/** Stable hatch id (deck + module instance + socket — unique per ship). */
export function hatchId(
  deckId: string,
  owner: Pick<PlacedModule, 'source'>,
  door: PlacedDoor,
): string {
  return `${deckId}-${owner.source.moduleId}#${owner.source.moduleIndex}-${door.socketId}`
}

/** Human label for a hatch, e.g. `crew deck "galley#0" hatch "spine-door"`. */
export function hatchLabel(hatch: Hatch): string {
  return `deck ${hatch.deckIndex} "${hatch.deckId}" ${hatch.moduleId}#${hatch.moduleIndex} hatch "${hatch.socketId}"`
}

/** The hatches of one deck. */
export function hatchesOnDeck(hatches: readonly Hatch[], deckIndex: number): Hatch[] {
  return hatches.filter((hatch) => hatch.deckIndex === deckIndex)
}

/** Which hatches are open: hatch id → true. Closed/unlisted = shut. */
export type HatchOpenStates = Readonly<Record<string, boolean>>

/** True when a hatch is open in `open` (unlisted = shut). */
export function isHatchOpen(open: HatchOpenStates, hatch: Hatch): boolean {
  return open[hatch.id] === true
}

/** Every hatch's box in its current state — the blockers the walker also meets. */
export function hatchBlockerBoxes(
  hatches: readonly Hatch[],
  open: HatchOpenStates,
): Aabb3[] {
  return hatches.map((hatch) =>
    isHatchOpen(open, hatch) ? hatch.openBox : hatch.closedBox,
  )
}

/* ----------------------------------------------------------- interaction */

/** The hatch action one interact press resolves to. */
export type HatchAction = 'opened' | 'closed' | 'blocked'

/** The outcome of an interact press. */
export interface HatchToggle {
  /** The new open-state map (a fresh object; the input is never mutated). */
  open: HatchOpenStates
  /** The hatch acted on, or null when nothing was in reach. */
  hatch: Hatch | null
  /** What happened (undefined when no hatch was in reach). */
  action: HatchAction | undefined
  /** Why a close was refused, or the action's own summary. */
  detail: string
}

/** The camera's planar forward at a yaw (`rotation.y`, radians). */
function facingVector(yaw: number): { x: number; z: number } {
  const x = -Math.sin(yaw)
  const z = -Math.cos(yaw)
  return { x: x === 0 ? 0 : x, z: z === 0 ? 0 : z }
}

/**
 * The hatch a walker at `feet`, looking at `yaw`, can interact with — the
 * nearest one on their deck within HATCH_REACH_M of the leaf in the deck plane,
 * through the doorway's own vertical span, and in front of them (HATCH_FACING_DOT
 * — the facing test is waived within HATCH_FACING_WAIVE_M, since a walker
 * standing against a hatch has nothing to square up to).
 */
export function hatchInReach(
  hatches: readonly Hatch[],
  deckIndex: number,
  feet: Vec3,
  yaw: number,
): Hatch | null {
  const facing = facingVector(yaw)
  let best: { hatch: Hatch; distance: number } | null = null
  for (const hatch of hatchesOnDeck(hatches, deckIndex)) {
    const distance = distanceToBoxXZ(feet[0], feet[2], hatch.closedBox)
    if (distance > HATCH_REACH_M) continue
    const centreY = (hatch.closedBox.min[AXIS_Y] + hatch.closedBox.max[AXIS_Y]) / 2
    if (Math.abs(centreY - (feet[1] + EYE_HEIGHT_M / 2)) > HATCH_VERTICAL_REACH_M) {
      continue
    }
    if (distance > HATCH_FACING_WAIVE_M) {
      const dx =
        (hatch.closedBox.min[AXIS_X] + hatch.closedBox.max[AXIS_X]) / 2 - feet[0]
      const dz =
        (hatch.closedBox.min[AXIS_Z] + hatch.closedBox.max[AXIS_Z]) / 2 - feet[2]
      const length = Math.hypot(dx, dz)
      if ((facing.x * dx + facing.z * dz) / length < HATCH_FACING_DOT) {
        continue
      }
    }
    if (best === null || distance < best.distance) {
      best = { hatch, distance }
    }
  }
  return best === null ? null : best.hatch
}

/** True when a walker's body overlaps a box on any axis (a real intersection). */
function bodyOverlaps(box: Aabb3, feet: Vec3, shape: WalkerShape): boolean {
  const body = bodyBoxAt(feet, shape)
  for (let axis = 0; axis < 3; axis++) {
    const overlap =
      Math.min(body.max[axis], box.max[axis]) - Math.max(body.min[axis], box.min[axis])
    if (overlap <= CONTACT_EPS_M) {
      return false
    }
  }
  return true
}

/**
 * Press the interact key: open the hatch in reach, close it, or refuse to close
 * one the walker is standing in. `feet`/`shape` are the walker's own body (the
 * squash test); `deckIndex` their deck.
 *
 * Returns a fresh open-state map plus what happened, so the caller can report
 * the action (the HUD's "hatch opened") without holding a second state copy.
 * Nothing in reach is not an error: the map comes back unchanged with a null
 * hatch.
 */
export function toggleHatch(
  open: HatchOpenStates,
  hatches: readonly Hatch[],
  deckIndex: number,
  feet: Vec3,
  yaw: number,
  shape: WalkerShape,
): HatchToggle {
  const hatch = hatchInReach(hatches, deckIndex, feet, yaw)
  if (hatch === null) {
    return { open, hatch: null, action: undefined, detail: 'no hatch in reach' }
  }
  if (!isHatchOpen(open, hatch)) {
    return {
      open: { ...open, [hatch.id]: true },
      hatch,
      action: 'opened',
      detail: `${hatchLabel(hatch)} retracted into its jamb`,
    }
  }
  if (bodyOverlaps(hatch.closedBox, feet, shape)) {
    return {
      open,
      hatch,
      action: 'blocked',
      detail: `${hatchLabel(hatch)} cannot close: the walker is standing in it`,
    }
  }
  return {
    open: { ...open, [hatch.id]: false },
    hatch,
    action: 'closed',
    detail: `${hatchLabel(hatch)} shut`,
  }
}
