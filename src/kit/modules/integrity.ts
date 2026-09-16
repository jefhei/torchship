/**
 * M2-T2 — the authored-module integrity gate.
 *
 * `moduleProblems` is the module author's self-check, and the M2-T7 harness
 * runs it over every module: the M1-T2 kit-manifest contract (dims, sockets
 * flush in their faces, anchors inside the box) PLUS the authoring rules the
 * manifest cannot express —
 *
 *  - assemblies are named uniquely and build at least one part each;
 *  - everything the module builds stays inside its declared box, with two
 *    documented structural allowances: the deck plate hangs below the floor
 *    plane (it IS the floor's structure) and socket hardware (the hatch frame)
 *    straddles the socket plane by its frame border;
 *  - the module carries exactly one standardized `spine-door` (−z face, flush);
 *  - no solid geometry blocks a door opening (the traversal contract);
 *  - light and equipment anchors exist (the §8 room-lit precondition), and
 *  - the manifest's collision hint is DERIVED from the solid geometry — the
 *    hint may not drift from the parts it describes (same posture as
 *    catalog.test.ts pinning declared bounds to the builders).
 *
 * `moduleContractProblems` is the M2-T7 gate: the authored module must
 * reproduce the fixture-time contract kit's dimensions and door-socket
 * origins (src/validation/contractKit.ts) so the M0-T5 ships keep resolving
 * their sockets to the numbers they were authored with.
 */

import {
  MM,
  STANDARD_DOOR_CENTER_M,
  STANDARD_DOOR_SIZE,
  doorCenterDeckOffsetM,
  doorSizeOf,
  isStandardDoorCenter,
  kitManifestProblems,
} from '../../types'
import type { Aabb3, DoorSocket, DoorSize, KitManifest } from '../../types'
import { SEAM_TOLERANCES } from '../../spikes/seams/tolerances'
import { partBounds } from '../parts'
import {
  SHAFT_FACES,
  assemblyParts,
  isShaftFace,
  moduleBounds,
  moduleParts,
  moduleSolidParts,
} from './types'
import type { AuthoredModule } from './types'

/** Socket authoring budget (±0.5 mm per axis) — the M0-T2 measured tolerance. */
const SOCKET_EPS_M = SEAM_TOLERANCES.maxSocketAuthoringErrorMm * MM

/** Numeric slack for "do these two boxes/sizes agree" checks, meters. */
const MATCH_EPS_M = 1e-6

/** Deck-plate structure + hatch frame straddle the floor plane, meters. */
const SUBFLOOR_TOLERANCE_M = 0.2

/** Socket hardware (hatch frame/lens) straddles its socket plane, meters. */
const SOCKET_STRADDLE_M = 0.05

/** Slab half-depth of the doorway-clearance prism, meters (covers a 0.1 m wall). */
const DOOR_PRISM_HALF_DEPTH_M = 0.15

/** True when two boxes overlap by more than a micron on all three axes. */
function overlaps(a: Aabb3, b: Aabb3): boolean {
  for (let axis = 0; axis < 3; axis++) {
    if (
      Math.min(a.max[axis], b.max[axis]) - Math.max(a.min[axis], b.min[axis]) <=
      MATCH_EPS_M
    ) {
      return false
    }
  }
  return true
}

/**
 * The prism a door opening sweeps through its wall, module-local meters:
 * the opening's width/height straddling the socket plane.
 */
export function doorwayPrism(socket: DoorSocket): Aabb3 {
  const door: DoorSize = doorSizeOf(socket)
  const halfWidth = door.width / 2
  const halfHeight = door.height / 2
  const [px, py, pz] = socket.position
  const alongX = socket.facing === '+x' || socket.facing === '-x'
  const halfX = alongX ? DOOR_PRISM_HALF_DEPTH_M : halfWidth
  const halfZ = alongX ? halfWidth : DOOR_PRISM_HALF_DEPTH_M
  return {
    min: [px - halfX, py - halfHeight, pz - halfZ],
    max: [px + halfX, py + halfHeight, pz + halfZ],
  }
}

/**
 * Shaft-band doorway rules (M2-T6): one doorway per shaft face, each named for
 * the face it sits in, at the standard 1.0 m centre with the standard
 * 0.9 × 2.0 opening. Those four standard doorways ARE the band contract the
 * rooms land their spine-doors on (src/validation/sockets.ts
 * `spineBandDoors`); flushness in each face is the manifest contract's job
 * (`kitManifestProblems`, run first). No `spine-door` and no other doorway
 * exists on a shaft band — the shaft joins every room on a deck, so it cannot
 * privilege one face, and the ROOM owns the hatch that seals each join.
 */
function shaftDoorProblems(module: AuthoredModule, where: string): string[] {
  const problems: string[] = []
  const sockets = module.manifest.doorSockets

  for (const face of SHAFT_FACES) {
    const onFace = sockets.filter((socket) => socket.id === face)
    if (onFace.length !== 1) {
      problems.push(
        `${where}: shaft needs exactly one "${face}" doorway, found ${onFace.length}`,
      )
      continue
    }
    const socket = onFace[0]
    if (socket.facing !== face) {
      problems.push(
        `${where}: shaft doorway "${face}" faces ${socket.facing}, expected ${face}`,
      )
    }
    if (!isStandardDoorCenter(socket)) {
      const offsetMm = (doorCenterDeckOffsetM(socket) / MM).toFixed(1)
      problems.push(
        `${where}: shaft doorway "${face}" sits ${offsetMm} mm off the standard ` +
          `${STANDARD_DOOR_CENTER_M} m centre (the band's doorways are all standard — ` +
          `a non-standard centre would step every room that lands on it)`,
      )
    }
    const door = doorSizeOf(socket)
    if (
      door.width !== STANDARD_DOOR_SIZE.width ||
      door.height !== STANDARD_DOOR_SIZE.height
    ) {
      problems.push(
        `${where}: shaft doorway "${face}" opening is ${door.width} × ${door.height} m, ` +
          `expected the standard ${STANDARD_DOOR_SIZE.width} × ${STANDARD_DOOR_SIZE.height} m`,
      )
    }
  }

  const extra = sockets.filter((socket) => !isShaftFace(socket.id))
  if (extra.length > 0) {
    const ids = extra.map((socket) => socket.id).join(', ')
    problems.push(
      `${where}: declares doorway(s) ${ids} that are not shaft faces ` +
        `(a band presents one doorway per face: ${SHAFT_FACES.join(', ')})`,
    )
  }

  return problems
}

/**
 * Every way an authored module can violate its own contract, as
 * human-readable problems. Empty array = the module is intact.
 */
export function moduleProblems(module: AuthoredModule): string[] {
  const problems: string[] = []
  const { manifest } = module
  const where = `module "${manifest.id}"`

  // The M1-T2 manifest contract: dims, sockets flush in their faces, openings
  // fitting the box, light/equipment anchors inside it.
  problems.push(...kitManifestProblems({ modules: [manifest] }))

  // Assemblies: named uniquely, and non-empty.
  if (module.assemblies.length === 0) {
    problems.push(`${where}: has no assemblies`)
    return problems
  }
  const seen = new Set<string>()
  for (const assembly of module.assemblies) {
    if (assembly.id.trim() === '') problems.push(`${where}: an assembly has no id`)
    if (seen.has(assembly.id)) {
      problems.push(`${where}: assembly id "${assembly.id}" is duplicated`)
    }
    seen.add(assembly.id)
    if (assembly.parts.length === 0) {
      problems.push(`${where}: assembly "${assembly.id}" builds no parts`)
    }
  }

  const parts = moduleParts(module)
  if (parts.length === 0) {
    problems.push(`${where}: builds no kit parts`)
    return problems
  }

  // Everything lives inside the declared box, within the structural
  // allowances (deck plate below the floor, socket hardware across the plane).
  const box = moduleBounds(module)
  for (const assembly of module.assemblies) {
    for (const part of assemblyParts(assembly)) {
      const b = partBounds(part)
      const inside =
        b.min[0] >= box.min[0] - SOCKET_STRADDLE_M &&
        b.max[0] <= box.max[0] + SOCKET_STRADDLE_M &&
        b.min[1] >= box.min[1] - SUBFLOOR_TOLERANCE_M &&
        b.max[1] <= box.max[1] + SOCKET_STRADDLE_M &&
        b.min[2] >= box.min[2] - SOCKET_STRADDLE_M &&
        b.max[2] <= box.max[2] + SOCKET_STRADDLE_M
      if (!inside) {
        problems.push(
          `${where}: assembly "${assembly.id}" builds outside the module box ` +
            `[${manifest.dimensions.join(' × ')} m]`,
        )
        break
      }
    }
  }

  // Doorways. A ROOM presents exactly one standardized spine-door, flush in
  // its −z face (the M0-T5 layout); the SHAFT presents one doorway per face,
  // every one of them the standard door — the four sockets the validator's
  // synthesized per-deck band presents to the rooms that land on it.
  if (module.shaft === true) {
    problems.push(...shaftDoorProblems(module, where))
  } else {
    const spineDoors = manifest.doorSockets.filter(
      (socket) => socket.id === 'spine-door',
    )
    if (spineDoors.length !== 1) {
      problems.push(
        `${where}: needs exactly one "spine-door" socket, found ${spineDoors.length}`,
      )
    } else {
      const door = spineDoors[0]
      if (door.facing !== '-z') {
        problems.push(`${where}: spine-door faces ${door.facing}, expected −z`)
      }
      const expectedZ = -manifest.dimensions[2] / 2
      const offFaceM = Math.abs(door.position[2] - expectedZ)
      if (offFaceM > SOCKET_EPS_M) {
        problems.push(
          `${where}: spine-door sits ${(offFaceM / MM).toFixed(1)} mm off its −z face`,
        )
      }
    }
  }

  // Anchors: the room-lit invariant and the M4/M5 rigs need both.
  if (manifest.lightSockets.length === 0) {
    problems.push(`${where}: has no light sockets (no legally-dark room in the spec)`)
  }
  if (manifest.equipmentSlots.length === 0) {
    problems.push(`${where}: has no equipment slots (no landmark authored)`)
  }

  // Doorways stay traversable: no geometry (except the socket filler) may
  // occupy the opening.
  for (const socket of manifest.doorSockets) {
    const prism = doorwayPrism(socket)
    for (const assembly of module.assemblies) {
      if (assembly.fillsSocket === true) continue
      const blocked = assemblyParts(assembly).some((part) =>
        overlaps(partBounds(part), prism),
      )
      if (blocked) {
        problems.push(
          `${where}: assembly "${assembly.id}" blocks the "${socket.id}" doorway`,
        )
      }
    }
  }

  // The collision hint must be the geometry's own hull, in order.
  const solidParts = moduleSolidParts(module)
  const boxes = manifest.collisionHint.boxes
  if (solidParts.length === 0) {
    problems.push(`${where}: declares no solid geometry (empty collision hint)`)
  } else if (boxes.length !== solidParts.length) {
    problems.push(
      `${where}: collision hint has ${boxes.length} box(es) for ` +
        `${solidParts.length} solid part(s) — it must be derived from the geometry`,
    )
  } else {
    boxes.forEach((hint, index) => {
      const expected = partBounds(solidParts[index])
      for (let axis = 0; axis < 3; axis++) {
        if (
          Math.abs(hint.min[axis] - expected.min[axis]) > MATCH_EPS_M ||
          Math.abs(hint.max[axis] - expected.max[axis]) > MATCH_EPS_M
        ) {
          problems.push(
            `${where}: collision box ${index} has drifted from solid part ${index}`,
          )
          break
        }
      }
    })
  }

  return problems
}

/** Module integrity gate: throws (listing every problem) on a broken module. */
export function assertModuleIntegrity(module: AuthoredModule): void {
  const problems = moduleProblems(module)
  if (problems.length > 0) {
    throw new Error(`module integrity:\n- ${problems.join('\n- ')}`)
  }
}

/**
 * The M2-T7 gate: does this authored module reproduce the contract kit's
 * entry of the same id — dimensions and door-socket origins? Returns [] when
 * the contract carries no such module (e.g. 'spine', which has no fixture-time
 * entry) — modules the contract knows about must match it on every channel.
 */
export function moduleContractProblems(
  module: AuthoredModule,
  contractKit: KitManifest,
): string[] {
  const contract = contractKit.modules.find((entry) => entry.id === module.manifest.id)
  if (contract === undefined) return []

  const problems: string[] = []
  const where = `module "${module.manifest.id}"`
  const dims = module.manifest.dimensions

  for (let axis = 0; axis < 3; axis++) {
    if (Math.abs(dims[axis] - contract.dimensions[axis]) > MATCH_EPS_M) {
      problems.push(
        `${where}: dimensions [${dims.join(', ')}] do not reproduce the contract ` +
          `[${contract.dimensions.join(', ')}]`,
      )
      break
    }
  }

  for (const socket of contract.doorSockets) {
    const authored = module.manifest.doorSockets.find((s) => s.id === socket.id)
    if (authored === undefined) {
      problems.push(`${where}: is missing the contract door socket "${socket.id}"`)
      continue
    }
    if (authored.facing !== socket.facing) {
      problems.push(
        `${where}: door socket "${socket.id}" faces ${authored.facing}, ` +
          `contract says ${socket.facing}`,
      )
    }
    for (let axis = 0; axis < 3; axis++) {
      const offM = Math.abs(authored.position[axis] - socket.position[axis])
      if (offM > SOCKET_EPS_M) {
        problems.push(
          `${where}: door socket "${socket.id}" sits ${(offM / MM).toFixed(1)} mm ` +
            `off the contract origin on axis ${axis}`,
        )
      }
    }
    const authoredDoor = doorSizeOf(authored)
    const contractDoor = doorSizeOf(socket)
    if (
      authoredDoor.width !== contractDoor.width ||
      authoredDoor.height !== contractDoor.height
    ) {
      problems.push(
        `${where}: door socket "${socket.id}" opening ` +
          `${authoredDoor.width} × ${authoredDoor.height} m does not match the ` +
          `contract ${contractDoor.width} × ${contractDoor.height} m`,
      )
    }
  }

  for (const socket of module.manifest.doorSockets) {
    if (!contract.doorSockets.some((known) => known.id === socket.id)) {
      problems.push(
        `${where}: declares door socket "${socket.id}", which the contract does not have`,
      )
    }
  }

  return problems
}
