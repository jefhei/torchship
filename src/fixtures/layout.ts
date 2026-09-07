/**
 * M0-T5 — canonical fixture layout conventions + kit-footprint table.
 *
 * The canonical test ships (src/fixtures/) are typed ShipSpecs whose module
 * refs are placed by ONE repeatable convention, so the M1-T3 validator,
 * the M0-T6 invariant stubs and the M3 assembler all read the same layout:
 *
 *  - Deck-local XZ is shared with every other deck (only the floor height
 *    differs), and the SPINE SHAFT runs through the deck-local origin on
 *    every deck — its center line is (x, z) = (0, 0) top to bottom, so the
 *    synthesized per-deck spine bands (never referenced in specs; the
 *    assembler adds one per deck) stack into one continuous vertical run.
 *  - A room attaches to the spine's +z face: rotation 0 (its standardized
 *    `spine-door` socket, local −z face, faces the shaft), floor on the
 *    deck plate (offset.y = 0 — floor-pinned, M0-T2 decision 4), center at
 *    offset z = SPINE_HALF_M + module depth/2 so the door center lands at
 *    (0, 1.0, SPINE_HALF_M) — flush with the spine band's +z face socket.
 *
 * Footprints are the CONTRACT-LEVEL bounds the M0-T2 seam spike measured
 * (its white-box table in src/spikes/seams/kit.ts is frozen and
 * self-contained; the numbers are reproduced here as the canonical copy).
 * The M2 authored kit must reproduce these bounds and socket origins (M2-T7
 * gate), so fixture offsets computed from this table stay valid when the
 * real KitManifest lands; until then this table IS the dimension source for
 * fixture-time geometry.
 */

import type { ModuleRef, Vec3 } from '../types'
import { DECK_CLEAR_M } from '../types'

/** The five room module types of the kit (spine is never referenced). */
export const ROOM_MODULE_IDS = [
  'head',
  'galley',
  'ops',
  'engineering',
  'storage',
] as const

/** One of the five room module ids a fixture deck may place. */
export type RoomModuleId = (typeof ROOM_MODULE_IDS)[number]

/**
 * Contract-level footprints [x, y, z] in meters, floor at local y = 0,
 * footprint centered on the local origin in XZ (M1-T2 authoring frame).
 * Source: the M0-T2 white-box kit table (head 4.8×3.6, galley 4.2×5.0,
 * ops 3.9×4.6, engineering 4.5×4.8, storage 4.0×6.0) with the canonical
 * 3.0 m deck clear height from src/types/units.ts.
 */
export const ROOM_FOOTPRINTS: Record<RoomModuleId, Vec3> = {
  head: [4.8, DECK_CLEAR_M, 3.6],
  galley: [4.2, DECK_CLEAR_M, 5.0],
  ops: [3.9, DECK_CLEAR_M, 4.6],
  engineering: [4.5, DECK_CLEAR_M, 4.8],
  storage: [4.0, DECK_CLEAR_M, 6.0],
}

/** Spine shaft half-width, meters (shaft ~1.4 m square — M0-T2 spine band). */
export const SPINE_HALF_M = 0.7

/**
 * Canonical deck-local z of a rotation-0 room's center when its spine-door
 * is flush against the spine's +z face: half the room depth beyond the
 * shaft face. (0.7 + depth/2 — the M0-T2 measured attach position.)
 */
export function spineAttachOffsetZ(moduleId: RoomModuleId): number {
  return SPINE_HALF_M + ROOM_FOOTPRINTS[moduleId][2] / 2
}

/**
 * A floor-pinned module ref at the canonical spine +z-face attach pose:
 * rotation 0, offset [0, 0, spineAttachOffsetZ(moduleId)] — the pose every
 * clean room in the canonical ships takes. Defective fixtures deviate from
 * this on purpose (see stress.ts).
 */
export function atSpine(moduleId: RoomModuleId): ModuleRef {
  return { moduleId, rotation: 0, offset: [0, 0, spineAttachOffsetZ(moduleId)] }
}
