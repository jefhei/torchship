/**
 * M0-T2 spike — seam & hatch-alignment measurement.
 *
 * The core question of spike 2 (BUILD_PLAN M0-T2 / PRD §11): when two
 * modules are joined at door sockets, what seam gap and socket
 * misalignment result — under exact placement, under deliberate spec
 * offsets (the pathological "offset-hatch" stress), and under authoring
 * noise? The measured answers fix the [auto] invariant tolerances
 * (PRD §8) from real numbers instead of guesses.
 *
 * Placement policies measured side by side:
 *  - 'floorPinned': module B's floor is pinned to the deck plate (its
 *    translation.y == deck floor Y) and only its XZ position comes from
 *    the door-socket target. Under-burn ships MUST floor-pin — you walk
 *    the plates. Vertical drift at the door is then whatever the authored
 *    door-center heights disagree by (measured as verticalMm).
 *  - 'doorSolved': module B's transform is solved so the mating door
 *    centers coincide exactly (translation.y floats). Doors are perfect
 *    but the module's floor lifts/steps off the deck (floorStepMm).
 *
 * `offset` is the stress input: the spec's declared socket target is
 * displaced by this vector from module A's real door center (a
 * misdeclared / pathological offset-hatch join). A normal-direction
 * offset becomes an open seam (light leak); a lateral or vertical offset
 * becomes hatch misalignment or a floor step.
 */

import type { ModuleDef, ModuleSocketDef } from './kit'
import { findSocket } from './kit'
import { STANDARD_DOOR_CENTER_M } from './kit'
import { MM } from './vec'
import { FACING_VEC, ZERO, add, dot, rotY, scale, sub } from './vec'
import type { Rotation, Vec3 } from './vec'

export type Policy = 'floorPinned' | 'doorSolved'

/** A module instance placed in the world (rotation = quarter-turns, translation = meters). */
export interface PlacedModule {
  def: ModuleDef
  rotation: Rotation
  translation: Vec3
}

export function placeModule(
  def: ModuleDef,
  rotation: Rotation,
  translation: Vec3,
): PlacedModule {
  return { def, rotation, translation }
}

export interface WorldSocket {
  center: Vec3
  /** Outward facing normal (world). */
  normal: Vec3
}

export function socketWorld(pm: PlacedModule, socketId: string): WorldSocket {
  const s = findSocket(pm.def, socketId)
  return {
    center: add(pm.translation, rotY(s.pos, pm.rotation)),
    normal: rotY(FACING_VEC[s.axis], pm.rotation),
  }
}

/** Rotation (quarter-turns) that makes socket `bSocketId` face −nA. */
export function opposingRotation(b: ModuleDef, bSocketId: string, nA: Vec3): Rotation {
  const l = FACING_VEC[findSocket(b, bSocketId).axis]
  const want = scale(nA, -1)
  for (let r = 0 as Rotation; r < 4; r++) {
    const candidate = rotY(l, r as Rotation)
    if (
      Math.abs(candidate[0] - want[0]) < 1e-12 &&
      Math.abs(candidate[2] - want[2]) < 1e-12
    ) {
      return r as Rotation
    }
  }
  throw new Error(`${b.id}: no rotation opposes ${JSON.stringify(nA)}`)
}

export interface JoinMeasureOptions {
  policy: Policy
  /**
   * Deliberate placement error (meters): module B's declared socket target
   * is displaced this far from module A's real door center.
   */
  offset?: Vec3
  /** Deck floor Y that B's floor is pinned to under 'floorPinned'. */
  deckFloorY?: number
}

export interface JoinMeasurement {
  policy: Policy
  offset: Vec3
  bRotation: Rotation
  bTranslation: Vec3
  aDoorCenter: Vec3
  /** Where the spec told B to put its door (A's center + offset). */
  declaredTarget: Vec3
  bDoorCenter: Vec3
  /**
   * Signed seam gap along the mating normal, mm. Positive = the two bulkhead
   * faces stand apart = an open light-leak seam; negative = faces overlap.
   */
  seamGapMm: number
  /** In-plane hatch misalignment perpendicular to the normal, mm (horizontal). */
  lateralMm: number
  /** Vertical hatch misalignment (door-center height difference), mm. */
  verticalMm: number
  /** |B floor Y − deck floor Y|, mm — nonzero when a door solve lifts B. */
  floorStepMm: number
  /** World Y of B's floor under the placement that was measured. */
  bFloorY: number
}

/**
 * Measure the join of module B (socket bSocketId) onto module A
 * (socket aSocketId), which is already placed.
 *
 * Seam gap / misalignment are measured between B's door center after
 * placement and A's REAL door center (not the offset-declared target), so
 * every channel is reported against the geometry that actually exists.
 */
export function measureJoin(
  a: PlacedModule,
  aSocketId: string,
  b: ModuleDef,
  bSocketId: string,
  opts: JoinMeasureOptions,
): JoinMeasurement {
  const aWorld = socketWorld(a, aSocketId)
  const { center: cA, normal: nA } = aWorld
  const sB: ModuleSocketDef = findSocket(b, bSocketId)
  const offset = opts.offset ?? ZERO
  const declared = add(cA, offset)
  const rotation = opposingRotation(b, bSocketId, nA)
  const rotPos = rotY(sB.pos, rotation)

  // Deck floor Y: explicit, else A's floor when A is a room module, else the
  // standard spine convention (spine socket center = floor + STANDARD_DOOR_CENTER_M).
  const floorY =
    opts.deckFloorY ??
    (a.def.id === 'spine' ? cA[1] - STANDARD_DOOR_CENTER_M : a.translation[1])

  let tB: Vec3
  if (opts.policy === 'doorSolved') {
    tB = sub(declared, rotPos)
  } else {
    tB = [declared[0] - rotPos[0], floorY, declared[2] - rotPos[2]]
  }

  const cB = add(tB, rotPos)
  const delta = sub(cB, cA)

  const seamGapMm = dot(delta, nA) / MM
  const perp = sub(delta, scale(nA, dot(delta, nA)))
  const verticalMm = Math.abs(perp[1]) / MM
  const lateralMm = Math.sqrt(Math.max(0, perp[0] * perp[0] + perp[2] * perp[2])) / MM
  const floorStepMm = Math.abs(tB[1] - floorY) / MM

  return {
    policy: opts.policy,
    offset,
    bRotation: rotation,
    bTranslation: tB,
    aDoorCenter: cA,
    declaredTarget: declared,
    bDoorCenter: cB,
    seamGapMm,
    lateralMm,
    verticalMm,
    floorStepMm,
    bFloorY: tB[1],
  }
}
