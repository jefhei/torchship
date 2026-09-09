/**
 * M1-T3 — Ship Spec validator: schema check, socket alignment, spine graph.
 *
 * BUILD_PLAN M1-T3: "Ship Spec validator (schema check, socket alignment,
 * spine connectivity graph) + preset JSON for the four fixtures." This is
 * the module that decides, headlessly, whether an authored ShipSpec is a
 * legal ship — the gate every fixture is run through and the accept/reject
 * logic the M0-T5 registry's `expectValid` refers to:
 *
 *   expectValid fixtures (patrol / long-haul / science) → shipSpecProblems
 *   must be EMPTY; the stress rig (expectValid: false) must be REJECTED
 *   with every declared STRESS_DEFECTS category named.
 *
 * Rules, in three groups:
 *
 *  1. Schema   — the ShipSpec self-consistency contract (src/types/ship.ts):
 *     identity fields present, ≥ 1 deck, unique non-empty deck ids, every
 *     deck populated, floors descending strictly nose → aft and ON the
 *     canonical grid (deckFloorYFor — an off-grid deck steps the spine run
 *     by exactly the floor error), refs name known kit modules and are
 *     floor-pinned (offset.y reserved 0).
 *
 *  2. Socket alignment (hatch-alignment, PRD §8 bullet 2) — measured at
 *     door-socket level against the M0-T2 channels (normal / lateral /
 *     vertical, mm) and the M0-T2 caps (≤ 5 mm hatch cap on every channel,
 *     SEAM_TOLERANCES.hatchAlignMm):
 *       a. Every room instance's standardized `spine-door` must LAND on its
 *          deck's spine-band socket (the band faces its door), all channels
 *          within the cap — a normal δ is an open seam (proud) or overlap,
 *          a lateral δ is hatch misalignment, a vertical δ is floor-pin
 *          drift. This is the socket-resolved spine-seat rule.
 *       b. Any two doors (module↔module, or a module side door onto the
 *          band) whose wall faces engage (opposing normals, face planes
 *          within SOCKET_ENGAGE_RADIUS_MM, openings overlapping in the
 *          wall plane) are a MATING PAIR and must align within the cap on
 *          every channel — a door-center step (engineering's 1.2 m
 *          high-hatch mated to a standard 1.0 m door = 200 mm) is caught
 *          here as the misaligned pair it is.
 *       c. A door that engages ANOTHER MODULE'S BLANK WALL (face planes
 *          coincident, opening over the wall's extent, no opposing door
 *          socket) is a DANGLING socket — it opens into solid wall.
 *       Unjoined sockets that engage nothing (module side doors facing open
 *       deck) are LEGAL spec: the kit module carries the full socket set,
 *       the ship blanks what it does not join (documented kit rule; the
 *       real ships' side doors are all blanked and must pass).
 *
 *  3. Spine connectivity graph (PRD §8 bullet 3) — the shaft run is
 *     continuous when every deck seats ≥ 1 module on its band (rule 2a,
 *     socket-resolved — a deck whose only module cannot land is OFF the
 *     run) and the §8 endpoints exist: head at deck 0, crew deck at index
 *     1, engineering on some deck. Continuous run ⇒ crew → head and
 *     crew → engineering are reachable along shaft adjacency. (Grid
 *     exactness is schema's; it is the vertical half of run continuity.)
 *
 * M2 integration: the real authored KitManifest (M2-T1..T6) is passed as
 * `kit` and validated against the same rules; until it lands, callers use
 * the default CONTRACT_KIT (src/validation/contractKit.ts) — the
 * fixture-time white-box kit whose dims/socket origins the fixtures were
 * authored against.
 */

import { CONTRACT_KIT } from './contractKit'
import {
  doorCenterDeviationMm,
  doorLabel,
  doorPlanesCoincideFacing,
  moduleDoors,
  openingsOverlap,
  oppositeFacing,
  spineBandDoors,
  toMm,
} from './sockets'
import type { PlacedDoor } from './sockets'
import { SEAM_TOLERANCES, withinHatchAlign } from '../spikes/seams/tolerances'
import { deckFloorYFor } from '../types'
import type { DeckSpec, Facing, KitManifest, ModuleRef, ShipSpec, Vec3 } from '../types'
import { getKitModule } from '../types'

/**
 * Face-plane separation (mm) under which two opposing doors are considered
 * ENGAGED (a mating pair / a wall a door opens onto). Beyond it the doors
 * face open deck / a corridor — legal blanked sockets, not joins.
 */
export const SOCKET_ENGAGE_RADIUS_MM = 50

const AXIS_X = 0
const AXIS_Y = 1
const AXIS_Z = 2

/** The horizontal axis a facing's wall is perpendicular to. */
function wallAxisOf(f: Facing): 0 | 2 {
  return f === '+x' || f === '-x' ? AXIS_X : AXIS_Z
}

function halfExtents(dims: Vec3): { halfX: number; halfZ: number; clear: number } {
  return { halfX: dims[AXIS_X] / 2, halfZ: dims[AXIS_Z] / 2, clear: dims[AXIS_Y] }
}

/* ==================================================================== *
 *  1. Schema
 * ==================================================================== */

/** ShipSpec schema problems: identity, deck order/grid, ref contract. */
export function schemaProblems(spec: ShipSpec, kit: KitManifest): string[] {
  const problems: string[] = []

  if (spec.classId.length === 0) problems.push('ship classId is empty')
  if (spec.name.length === 0) problems.push('ship name is empty')
  if (spec.registry.length === 0) problems.push('ship registry is empty')
  if (!Number.isFinite(spec.seed)) problems.push('ship seed is not a finite number')

  if (spec.decks.length === 0) {
    problems.push('spec has no decks')
    return problems
  }

  const known = new Set(kit.modules.map((m) => m.id))
  const seenDeckIds = new Set<string>()

  spec.decks.forEach((deck, i) => {
    if (deck.id.length === 0) {
      problems.push(`deck ${i} has an empty id`)
    } else if (seenDeckIds.has(deck.id)) {
      problems.push(`deck id "${deck.id}" is duplicated (deck ${i})`)
    }
    seenDeckIds.add(deck.id)

    if (deck.label.length === 0)
      problems.push(`deck ${i} ("${deck.id}") has an empty label`)
    if (!Number.isFinite(deck.yPosition)) {
      problems.push(`deck ${i} ("${deck.id}"): floor Y is not a finite number`)
    }
    if (deck.modules.length === 0) {
      problems.push(`deck ${i} ("${deck.id}") has no modules`)
    }

    if (i > 0) {
      const prev = spec.decks[i - 1]
      if (!(deck.yPosition < prev.yPosition)) {
        problems.push(
          `deck ${i} ("${deck.id}"): floor ${deck.yPosition} m is not below deck ${i - 1} ` +
            `("${prev.id}") floor ${prev.yPosition} m — decks must descend nose → aft`,
        )
      }
    }

    // Grid consistency: canonical specs place floors at deckFloorYFor(index).
    const canonical = deckFloorYFor(i)
    const gridMm = toMm(Math.abs(deck.yPosition - canonical))
    if (gridMm > 1e-6) {
      problems.push(
        `deck ${i} ("${deck.id}"): yPosition ${deck.yPosition} m is off the canonical grid — ` +
          `deckFloorYFor(${i}) = ${canonical} m (${gridMm.toFixed(1)} mm step)`,
      )
    }

    deck.modules.forEach((ref, j) => {
      if (!known.has(ref.moduleId)) {
        problems.push(
          `deck ${i} ("${deck.id}") module ${j}: references unknown kit module "${ref.moduleId}"`,
        )
        return // socket rules cannot resolve it
      }
      if (!Number.isInteger(ref.rotation) || ref.rotation < 0 || ref.rotation > 3) {
        problems.push(
          `deck ${i} ("${deck.id}") ${ref.moduleId}#${j}: rotation ${ref.rotation} is not a quarter-turn (0|1|2|3)`,
        )
      }
      const [x, y, z] = ref.offset
      if (![x, y, z].every(Number.isFinite)) {
        problems.push(
          `deck ${i} ("${deck.id}") ${ref.moduleId}#${j}: offset [${x}, ${y}, ${z}] is not finite`,
        )
      }
      if (y !== 0) {
        problems.push(
          `deck ${i} ("${deck.id}") ${ref.moduleId}#${j}: offset.y = ${y} m — floor-pinned ` +
            `assembly violation (ModuleRef.offset.y reserved 0)`,
        )
      }
    })
  })

  return problems
}

/* ==================================================================== *
 *  2. Socket alignment (hatch-alignment)
 * ==================================================================== */

/** Channel-cap phrase shared by the socket problems. */
function capPhrase(): string {
  return `cap ${SEAM_TOLERANCES.hatchAlignMm} mm`
}

/**
 * Rule 2a — one module's spine-door landing: problems when the module's
 * standardized `spine-door` does not seat on its deck's spine-band socket
 * within the hatch cap on every channel. Empty = the module seats.
 * Unknown kit modules return [] (schema names them) — they cannot seat, so
 * callers treat them as unseated with the schema problem as the reason.
 */
export function moduleLandingProblems(
  deck: DeckSpec,
  deckIndex: number,
  ref: ModuleRef,
  moduleIndex: number,
  kit: KitManifest,
): string[] {
  let doors: PlacedDoor[]
  try {
    doors = moduleDoors(deck, deckIndex, ref, moduleIndex, kit)
  } catch {
    return []
  }
  const spine = doors.find((d) => d.socketId === 'spine-door')
  if (!spine) {
    return [
      `deck ${deckIndex} ("${deck.id}") ${ref.moduleId}#${moduleIndex}: kit module has no ` +
        `"spine-door" socket — every room instance must seat on the spine band`,
    ]
  }
  const band = spineBandDoors(deck, deckIndex).find(
    (d) => d.facing === oppositeFacing(spine.facing),
  )
  if (!band) return [] // band always presents the opposing face; defensive
  const dev = doorCenterDeviationMm(band, spine)

  const problems: string[] = []
  const who = `deck ${deckIndex} ("${deck.id}") ${ref.moduleId}#${moduleIndex}`
  if (!withinHatchAlign(dev.lateralMm)) {
    problems.push(
      `${who}: spine-door center is ${dev.lateralMm.toFixed(1)} mm off the spine socket center ` +
        `laterally; ${capPhrase()}`,
    )
  }
  if (!withinHatchAlign(dev.verticalMm)) {
    problems.push(
      `${who}: spine-door center sits ${dev.verticalMm.toFixed(1)} mm off the standard ` +
        `1.0 m height (offset.y floor-pin drift); ${capPhrase()}`,
    )
  }
  if (!withinHatchAlign(dev.normalMm)) {
    const how =
      dev.normalMm > 0
        ? 'proud of the spine face (open gap along the join normal)'
        : 'pushed into the spine band (overlap)'
    problems.push(
      `${who}: spine-door face is ${Math.abs(dev.normalMm).toFixed(1)} mm ${how}; ${capPhrase()}`,
    )
  }
  return problems
}

/** Short owner label for a placed door (no deck prefix — callers add it). */
function shortDoorLabel(d: PlacedDoor): string {
  const who = d.moduleId === 'spine' ? 'spine band' : `${d.moduleId}#${d.moduleIndex}`
  return `${who} socket "${d.socketId}"`
}

/**
 * Rules 2a + 2b + 2c for one deck: every module's spine-door landing, every
 * engaged mating pair's alignment, every door opening onto a blank wall.
 */
export function deckSocketAlignmentProblems(
  deck: DeckSpec,
  deckIndex: number,
  kit: KitManifest,
): string[] {
  const problems: string[] = []

  // 2a — spine-door landing, per module instance.
  deck.modules.forEach((ref, j) => {
    problems.push(...moduleLandingProblems(deck, deckIndex, ref, j, kit))
  })

  // Placed module doors (schema-checked refs only), for 2b/2c pair scans.
  const placed: { ref: ModuleRef; index: number; doors: PlacedDoor[] }[] = []
  deck.modules.forEach((ref, j) => {
    try {
      placed.push({ ref, index: j, doors: moduleDoors(deck, deckIndex, ref, j, kit) })
    } catch {
      /* unknown module — schema reports it */
    }
  })
  const band = spineBandDoors(deck, deckIndex)
  const allDoors = [...placed.flatMap((p) => p.doors), ...band]

  // 2b — engaged mating pairs must align on every channel.
  const pairProblems = new Set<string>()
  for (let i = 0; i < allDoors.length; i++) {
    for (let j = i + 1; j < allDoors.length; j++) {
      const a = allDoors[i]
      const b = allDoors[j]
      // Same rigid body: two sockets of one module cannot mate each other.
      const bothModules = a.moduleId !== 'spine' && b.moduleId !== 'spine'
      if (bothModules && a.moduleIndex === b.moduleIndex) continue
      if (a.moduleId === 'spine' && b.moduleId === 'spine') continue
      // The standardized spine-door → band join is rule 2a's, not a pair.
      const spineToBand =
        (a.moduleId === 'spine' && b.socketId === 'spine-door') ||
        (b.moduleId === 'spine' && a.socketId === 'spine-door')
      if (spineToBand) continue
      if (!doorPlanesCoincideFacing(a, b)) continue

      const dev = doorCenterDeviationMm(a, b)
      if (Math.abs(dev.normalMm) > SOCKET_ENGAGE_RADIUS_MM) continue // faces do not engage
      if (!openingsOverlap(a, b)) continue // openings do not line up as a pass-through

      const failing: string[] = []
      if (!withinHatchAlign(dev.verticalMm)) {
        failing.push(
          `door centers disagree by ${dev.verticalMm.toFixed(1)} mm vertically (door-center step)`,
        )
      }
      if (!withinHatchAlign(dev.lateralMm)) {
        failing.push(
          `socket centers are ${dev.lateralMm.toFixed(1)} mm off laterally along the face`,
        )
      }
      if (!withinHatchAlign(dev.normalMm)) {
        failing.push(
          `wall faces stand ${Math.abs(dev.normalMm).toFixed(1)} mm apart along the join normal (open seam)`,
        )
      }
      if (failing.length > 0) {
        pairProblems.add(
          `deck ${deckIndex} ("${deck.id}"): ${shortDoorLabel(a)} (facing ${a.facing}) faces ` +
            `${shortDoorLabel(b)} (facing ${b.facing}) — ${failing.join('; ')}; ${capPhrase()}`,
        )
      }
    }
  }
  problems.push(...pairProblems)

  // 2c — a door opening onto another module's blank wall (dangling).
  for (const a of placed) {
    for (const d of a.doors) {
      for (const b of placed) {
        if (a.index === b.index) continue
        const blocked = blockedByWall(d, b, deck.yPosition, kit)
        if (blocked) problems.push(blocked)
      }
    }
  }

  return problems
}

/**
 * Rule 2c for one door × one other module: when the door's wall face is
 * coincident (within the engage radius) with the module's opposing wall and
 * the opening falls over the wall's extent with NO opposing door socket
 * there, the door opens into solid wall. Returns the problem string, or
 * null when the wall does not block (open deck, or a real door mates).
 */
function blockedByWall(
  d: PlacedDoor,
  other: { ref: ModuleRef; index: number; doors: PlacedDoor[] },
  deckFloorY: number,
  kit: KitManifest,
): string | null {
  let dims: Vec3
  try {
    dims = getKitModule(kit, other.ref.moduleId).dimensions
  } catch {
    return null
  }
  // The wall of `other` that faces d's door: its outward normal opposes d.
  const wall = oppositeFacing(d.facing)
  const axis = wallAxisOf(wall)
  const { halfX, halfZ, clear } = halfExtents(dims)
  const o = other.ref.offset
  const wallCoord =
    wall === '+x' || wall === '-x'
      ? o[AXIS_X] + (wall === '+x' ? halfX : -halfX)
      : o[AXIS_Z] + (wall === '+z' ? halfZ : -halfZ)
  if (Math.abs(d.center[axis] - wallCoord) > SOCKET_ENGAGE_RADIUS_MM / 1e3) {
    return null // wall is not at the door plane — the door faces open deck
  }

  // The opening must fall over the wall's extent (horizontal + vertical).
  // The wall spans its module's floor (deck Y + the ref's floor pin) to the
  // ceiling in WORLD Y — compare in world space, where the door lives.
  const horizontal = axis === AXIS_X ? AXIS_Z : AXIS_X
  const halfAlong = horizontal === AXIS_Z ? halfZ : halfX
  const oLo = d.center[horizontal] - d.width / 2
  const oHi = d.center[horizontal] + d.width / 2
  const wLo = o[horizontal] - halfAlong
  const wHi = o[horizontal] + halfAlong
  if (oHi <= wLo || wHi <= oLo) return null
  const wallFloor = deckFloorY + o[AXIS_Y]
  const dBot = d.center[AXIS_Y] - d.height / 2
  const dTop = d.center[AXIS_Y] + d.height / 2
  if (dTop <= wallFloor || dBot >= wallFloor + clear) return null

  // A real door on that wall whose opening overlaps this one = a mating
  // pair (rule 2b owns its alignment); otherwise the wall blocks the door.
  const hasOpposingDoor = other.doors.some(
    (od) => od.facing === wall && openingsOverlap(d, od),
  )
  if (hasOpposingDoor) return null

  return (
    `${doorLabel(d)} (facing ${d.facing}) opens onto the ${wall} wall of ` +
    `${other.ref.moduleId}#${other.index} — no opposing door socket there (dangling socket)`
  )
}

/**
 * The full socket-alignment rule set (PRD §8 bullet 2, hatch-alignment),
 * over every deck. Empty = every socket lands or is legally blanked.
 */
export function hatchAlignmentProblems(spec: ShipSpec, kit: KitManifest): string[] {
  return spec.decks.flatMap((deck, i) => deckSocketAlignmentProblems(deck, i, kit))
}

/* ==================================================================== *
 *  3. Spine connectivity graph
 * ==================================================================== */

/**
 * The spine connectivity rule set (PRD §8 bullet 3) at spec level: every
 * deck must seat ≥ 1 module on its spine band (rule 2a, socket-resolved),
 * and the run's endpoints must exist (head on deck 0, crew deck at index 1,
 * engineering somewhere). A deck whose modules cannot land is OFF the
 * continuous shaft run, breaking crew → head / crew → engineering
 * reachability along the ladder.
 */
export function spineConnectivityProblems(spec: ShipSpec, kit: KitManifest): string[] {
  const problems: string[] = []

  spec.decks.forEach((deck, i) => {
    if (deck.modules.length === 0) {
      problems.push(
        `deck ${i} ("${deck.id}"): deck has no modules — nothing seats on the spine band`,
      )
      return
    }
    const perModule = deck.modules.map((ref, j) => ({
      ref,
      index: j,
      problems: moduleLandingProblems(deck, i, ref, j, kit),
    }))
    const seated = perModule.some((m) => m.problems.length === 0)
    if (!seated) {
      const reasons = perModule.flatMap((m) => m.problems)
      problems.push(
        `deck ${i} ("${deck.id}"): no module seated on the spine band — ${reasons.join('; ')}`,
      )
    }
  })

  if (spec.decks.length === 0) {
    problems.push('spec has no decks — there is no spine run')
  } else if (!spec.decks[0].modules.some((m) => m.moduleId === 'head')) {
    problems.push(
      `deck 0 ("${spec.decks[0].id}") does not host the head module — the run has no head endpoint`,
    )
  }
  if (spec.decks.length < 2) {
    problems.push(
      `spec has ${spec.decks.length} deck${spec.decks.length === 1 ? '' : 's'} — no crew deck at index 1 to start the run from`,
    )
  }
  if (!spec.decks.some((d) => d.modules.some((m) => m.moduleId === 'engineering'))) {
    problems.push(
      'no deck hosts an engineering module — the run has no engineering endpoint',
    )
  }

  return problems
}

/* ==================================================================== *
 *  Top level
 * ==================================================================== */

/**
 * Every validator problem for a spec, in rule order: schema, socket
 * alignment (hatch), spine connectivity graph. Empty = the spec is a legal
 * ship. Runs against CONTRACT_KIT unless an authored manifest is passed
 * (M2+).
 */
export function shipSpecProblems(
  spec: ShipSpec,
  kit: KitManifest = CONTRACT_KIT,
): string[] {
  return [
    ...schemaProblems(spec, kit),
    ...hatchAlignmentProblems(spec, kit),
    ...spineConnectivityProblems(spec, kit),
  ]
}

/** True when the spec passes every validator rule. */
export function isValidShipSpec(
  spec: ShipSpec,
  kit: KitManifest = CONTRACT_KIT,
): boolean {
  return shipSpecProblems(spec, kit).length === 0
}

/** Validator gate: throws listing every problem (kit-integrity style). */
export function assertValidShipSpec(
  spec: ShipSpec,
  kit: KitManifest = CONTRACT_KIT,
): void {
  const problems = shipSpecProblems(spec, kit)
  if (problems.length > 0) {
    throw new Error(`ship spec "${spec.name}" is invalid:\n- ${problems.join('\n- ')}`)
  }
}

/** Door tallies for pass-detail wording (spine doors vs blankable sides). */
export function doorTallies(
  spec: ShipSpec,
  kit: KitManifest,
): {
  spineDoors: number
  sideDoors: number
} {
  let spineDoors = 0
  let sideDoors = 0
  spec.decks.forEach((deck, i) => {
    deck.modules.forEach((ref, j) => {
      try {
        for (const d of moduleDoors(deck, i, ref, j, kit)) {
          if (d.socketId === 'spine-door') spineDoors++
          else sideDoors++
        }
      } catch {
        /* unknown module — schema reports it */
      }
    })
  })
  return { spineDoors, sideDoors }
}
