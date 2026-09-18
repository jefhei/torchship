/**
 * M3-T1 — the deck's socket scan: which door sockets actually JOIN.
 *
 * BUILD_PLAN M3-T1: "join modules at door sockets". The spec already carries
 * the offsets (authoring chose them); the assembler's job at assembly time is
 * to resolve which sockets form a join, because the join set is the input for
 * M3-T2 (mating/sealing geometry generated FROM the socket — never freehand,
 * rule 8) and M3-T5 (hatch traversal). Two sockets join when, exactly as the
 * M1-T3 validator decides it (src/validation/validator.ts):
 *
 *  - their wall faces engage: opposing facings, face planes within
 *    `SOCKET_ENGAGE_RADIUS_MM`, and openings that overlap in the wall plane as
 *    a pass-through (a door whose opening does not line up is not a join,
 *    however close its center is);
 *  - they belong to different rigid bodies (two sockets of one module cannot
 *    mate each other, and one band never mates another band).
 *
 * A ROOM's standardized `spine-door` is always reported as the special
 * `kind: 'spine'` join when its deck's band presents the opposing face — that
 * landing is what makes the spine run navigable, and the validator's rule 2a
 * (not the generic pair scan) owns its verdict.
 *
 * Everything else a socket meets is measured on the three M0-T2 channels
 * (normal / lateral / vertical, mm — `doorCenterDeviationMm`, imported, never
 * re-derived) and flagged `aligned` against the measured hatch cap. A join
 * whose centers disagree is still a JOIN — M3-T2 must seal what is there, and
 * the validator is the gate that rejects the spec in the first place.
 *
 * Sockets that join nothing are returned as `blanks`: legal by the kit
 * contract (a module carries its full socket set; the ship blanks whatever it
 * does not join — the real ships' side doors) and the sockets M3-T2 sleeves.
 */

import {
  SOCKET_ENGAGE_RADIUS_MM,
  doorCenterDeviationMm,
  doorPlanesCoincideFacing,
  openingsOverlap,
} from '../validation'
import { withinHatchAlign } from '../spikes/seams/tolerances'
import type { PlacedDoor } from '../validation'
import type { DeckJoin, JoinKind, PlacedModule, SocketScan } from './types'

/** One door with its owner, for the pair scan. */
interface OwnedDoor {
  door: PlacedDoor
  owner: PlacedModule
}

/** Measure a candidate pair and shape it into a join record. */
function makeJoin(kind: JoinKind, a: PlacedDoor, b: PlacedDoor): DeckJoin {
  const dev = doorCenterDeviationMm(a, b)
  return {
    kind,
    a,
    b,
    normalMm: dev.normalMm,
    lateralMm: dev.lateralMm,
    verticalMm: dev.verticalMm,
    aligned:
      withinHatchAlign(dev.normalMm) &&
      withinHatchAlign(dev.lateralMm) &&
      withinHatchAlign(dev.verticalMm),
  }
}

/**
 * Every join a deck's placed modules form, plus the sockets that stay blank.
 * Deterministic: spine joins in deck/spec order, then room-to-room mates in
 * spec order; the pair scan is over the doors in that same order.
 */
export function scanDeckSockets(modules: readonly PlacedModule[]): SocketScan {
  const band = modules.find((module) => module.band)
  const rooms = modules.filter((module) => !module.band)
  const joins: DeckJoin[] = []
  const joined = new Set<PlacedDoor>()

  // 1. Spine landings: every room's standardized spine-door onto its deck band.
  for (const room of rooms) {
    const spineDoor = room.doors.find((door) => door.socketId === 'spine-door')
    if (spineDoor === undefined || band === undefined) continue
    const target = band.doors.find(
      (door) =>
        doorPlanesCoincideFacing(door, spineDoor) && openingsOverlap(door, spineDoor),
    )
    if (target === undefined) continue
    // The band socket is the reference: its outward normal is the join normal.
    joins.push(makeJoin('spine', target, spineDoor))
    joined.add(spineDoor)
    joined.add(target)
  }

  // 2. Room-to-room mates: engaged faces whose openings line up.
  const all: OwnedDoor[] = modules.flatMap((owner) =>
    owner.doors.map((door) => ({ door, owner })),
  )
  for (let i = 0; i < all.length; i++) {
    for (let j = i + 1; j < all.length; j++) {
      const a = all[i]
      const b = all[j]
      if (a.owner === b.owner) continue // one rigid body cannot mate itself
      if (a.owner.band && b.owner.band) continue // the band never mates a band
      if (joined.has(a.door) || joined.has(b.door)) continue
      if (!doorPlanesCoincideFacing(a.door, b.door)) continue
      const dev = doorCenterDeviationMm(a.door, b.door)
      if (Math.abs(dev.normalMm) > SOCKET_ENGAGE_RADIUS_MM) continue // faces do not engage
      if (!openingsOverlap(a.door, b.door)) continue // openings do not line up
      joins.push(makeJoin('module', a.door, b.door))
      joined.add(a.door)
      joined.add(b.door)
    }
  }

  const blanks = all.map((entry) => entry.door).filter((door) => !joined.has(door))

  return { joins, blanks }
}

/**
 * A room's spine-door join on its deck: the landing that makes the deck
 * reachable. Returns the join, or undefined when the room has none (the deck
 * is off the run — validator rule 2a's verdict, reported by the assembler's
 * own problem list, never silently repaired).
 */
export function spineJoinOf(
  room: PlacedModule,
  joins: readonly DeckJoin[],
): DeckJoin | undefined {
  return joins.find(
    (join) =>
      join.kind === 'spine' &&
      join.b.moduleId === room.source.moduleId &&
      join.b.moduleIndex === room.source.moduleIndex,
  )
}

/** Human label for one joined socket, e.g. `spine band "+z" ↔ galley#0 "spine-door"`. */
export function joinLabel(join: DeckJoin): string {
  const name = (door: PlacedDoor): string =>
    door.moduleIndex === -1
      ? `spine band "${door.socketId}"`
      : `${door.moduleId}#${door.moduleIndex} "${door.socketId}"`
  return `${name(join.a)} \u2194 ${name(join.b)}`
}
