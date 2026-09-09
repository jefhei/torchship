/**
 * M1-T3 — the contract white-box kit: the fixture-time KitManifest.
 *
 * The M0-T5 fixtures were authored against the layout contract
 * (src/fixtures/layout.ts: ROOM_FOOTPRINTS + the canonical spine-attach
 * pose) and the socket-origin table the M0-T2 seam spike measured
 * (src/spikes/seams/kit.ts, frozen). The real authored KitManifest does not
 * exist until M2-T1..T6, so the M1-T3 spec validator needs a kit to resolve
 * door sockets against TODAY. This module is that kit: a genuine KitManifest
 * (the M1-T2 contract type) whose five room modules reproduce the contract
 * dimensions and the M0-T2 socket origins exactly.
 *
 * What M2 must do with this (M2-T7 gate): the authored kit's modules must
 * reproduce these dimensions and socket origins — `contractModuleOrigins`
 * below is the expected-values table the gate compares against. Until then
 * every validator / invariant run resolves sockets against CONTRACT_KIT, so
 * the numbers the fixtures were authored with stay the numbers the checks
 * measure.
 *
 * White-box scope: dimensions + door sockets only. lightSockets /
 * equipmentSlots / collisionHint are empty (authored at M2); the room-lit
 * invariant stays a stub until M2-T7 supplies real light sockets.
 */

import { ROOM_FOOTPRINTS } from '../fixtures/layout'
import type { RoomModuleId } from '../fixtures/layout'
import { STANDARD_DOOR_CENTER_M } from '../types'
import type { DoorSocket, Facing, KitManifest, KitModule, Vec3 } from '../types'

/** Human kit label per room type (role wording from BUILD_PLAN M2-T2..T5). */
const ROOM_LABELS: Record<RoomModuleId, string> = {
  head: 'Bridge / head (crash couches, sensor wall)',
  galley: 'Galley / bunk (table + coffee station landmark)',
  ops: 'Ops (airlock + suit locker, workbench, med bay)',
  engineering: 'Engineering (reactor access, drive glow window)',
  storage: 'Storage (long-haul cargo variant)',
}

/**
 * Non-spine door sockets per room type, module-local meters. These are the
 * M0-T2 measured origins (spike kit table), reproduced here as the canonical
 * copy the validator resolves and M2-T7 gates against. The standardized
 * `spine-door` (−z face, standard 1.0 m center) is NOT in this table — it is
 * derived from the module depth so dims stay the single source for it (the
 * derivation is pinned to the spike numbers by contractKit.test.ts).
 *
 * Deliberate non-standard door (the contract's deck offset in action):
 * engineering's `high-hatch` sits 0.2 m above the standard center with a
 * 0.8 × 1.6 opening (M0-T2 pathological-join author).
 */
const SIDE_SOCKET_ORIGINS: Partial<Record<RoomModuleId, DoorSocket[]>> = {
  galley: [
    { id: 'side-door', position: [2.1, STANDARD_DOOR_CENTER_M, 1.2], facing: '+x' },
  ],
  ops: [
    { id: 'side-door', position: [-1.95, STANDARD_DOOR_CENTER_M, -1.0], facing: '-x' },
  ],
  engineering: [
    {
      id: 'high-hatch',
      position: [2.25, STANDARD_DOOR_CENTER_M + 0.2, 0.6],
      facing: '+x',
      door: { width: 0.8, height: 1.6 },
    },
  ],
  storage: [
    { id: 'side-door', position: [2.0, STANDARD_DOOR_CENTER_M, 1.0], facing: '+x' },
  ],
}

/** The standardized spine door of a room: −z face, flush, standard center. */
function spineDoor(moduleId: RoomModuleId): DoorSocket {
  const depth = ROOM_FOOTPRINTS[moduleId][2]
  return {
    id: 'spine-door',
    position: [0, STANDARD_DOOR_CENTER_M, -depth / 2],
    facing: '-z',
  }
}

/** Build the white-box KitModule for one room type (dims from the contract). */
function contractModule(moduleId: RoomModuleId): KitModule {
  return {
    id: moduleId,
    label: ROOM_LABELS[moduleId],
    dimensions: [...ROOM_FOOTPRINTS[moduleId]] as Vec3,
    doorSockets: [spineDoor(moduleId), ...(SIDE_SOCKET_ORIGINS[moduleId] ?? [])],
    lightSockets: [],
    equipmentSlots: [],
    collisionHint: { boxes: [] },
  }
}

/**
 * The contract kit's five room modules (ids in canonical order). Module ids
 * are exactly the fixture ROOM_MODULE_IDS vocabulary — a spec referencing any
 * other id fails schema validation as an unknown module.
 */
export const CONTRACT_KIT_MODULES: readonly KitModule[] = (
  ['head', 'galley', 'ops', 'engineering', 'storage'] as const
).map((id) => contractModule(id))

/** The fixture-time KitManifest the M1-T3 validator resolves sockets against. */
export const CONTRACT_KIT: KitManifest = { modules: [...CONTRACT_KIT_MODULES] }

/**
 * Expected door-socket origins per room type, module-local — the table
 * M2-T7 compares the authored kit against ("door sockets at spec'd origins",
 * BUILD_PLAN M2-T7). Same data as the manifest modules above, exposed as
 * { socketId → position } so a gate can diff origins without re-deriving
 * geometry.
 */
export function contractSocketOrigins(): Record<
  string,
  { position: Vec3; facing: Facing }
> {
  const out: Record<string, { position: Vec3; facing: Facing }> = {}
  for (const m of CONTRACT_KIT.modules) {
    for (const s of m.doorSockets) {
      out[`${m.id}.${s.id}`] = { position: [...s.position], facing: s.facing }
    }
  }
  return out
}
