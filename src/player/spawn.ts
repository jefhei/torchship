/**
 * M3-T6 — spawn selection: where the walkthrough puts the walker, and the
 * geometric half of PRD §8's "the spawn point is inside the crew deck, not
 * intersecting geometry".
 *
 * PRD §6.1 asks for one thing: "spawn on the crew deck at the foot of the
 * spine". The deck-plan contract makes that concrete — the crew deck is deck
 * index 1 on every canonical ship (`src/fixtures/patrol.ts` and friends all put
 * the galley there), and the spine's foot is the shaft band's own deck-level
 * face. So the spawn is not a hand-picked coordinate: it is DERIVED from the
 * two pieces of geometry that define the foot of the spine, and then MEASURED
 * against the same hull the walker is solved against before it is accepted.
 *
 * TWO CANDIDATES, DERIVED (never freehand):
 *
 *  - `doorway` — the crew deck's seated room presents its standardized
 *    `spine-door` socket to the shaft; the walker stands on that socket's own
 *    axis, `SPAWN_DOOR_STANDOFF_M` inside the room (the door's facing tells us
 *    which way "inside" is), looking INTO the room — on the canonical ships,
 *    straight at the galley's coffee station. This is the preferred pose: the
 *    player starts in the crew's heart with the ladder at their back.
 *  - `ladder-lane` — the walker stands in the trunk's LANE
 *    (`climbFeet(run, side, …)`, the strip M3-T5 measured: exactly where the
 *    capsule comes to rest against the rungs), at the run that rises from the
 *    crew deck, on the side the crew room is on, FACING the ladder. That is the
 *    arrival pose of the climb machine, and it is the fallback for a ship whose
 *    room offers no standable spot in front of its door.
 *
 * The first candidate that passes the verdict wins, in that order. If neither
 * does, there is no spawn — the invariant says so rather than the app dropping
 * the player inside a bulkhead.
 *
 * THE VERDICT IS THE INVARIANT'S OWN PREDICATE (one implementation, no drift):
 *
 *  - on the crew deck: `deckIndexAtY(feet)` is the crew deck (index 1);
 *  - inside the deck: the point lies within the world bounds of one of the
 *    crew deck's own module instances (its own placed geometry, band included);
 *  - not intersecting geometry: the standing walker's capsule (M3-T4's shape:
 *    0.25 m footprint, 1.8 m body band) is not inside anything the healer has
 *    to push it out of — measured with the SAME hull the navigation machine
 *    hands the walker each frame, i.e. every deck's M3-T3 boxes PLUS every
 *    hatch leaf in its spawn state (all shut: the navigation state starts with
 *    no hatch open). Kit below the step height is walked over, kit above the
 *    head is walked under — that is `blocksBody`, so a cable run under the feet
 *    is not a collision;
 *  - standable: the highest surface under the footprint is the deck plate (or
 *    kit within a step of it, the same rule M3-T5's landing test uses), so the
 *    walker lands on the deck instead of falling through it.
 *
 * Pure and three-agnostic: state in, evidence out. `src/invariants/checks.ts`
 * runs `chooseSpawn` as the live assembled half of §8 bullet 5, and
 * `WalkthroughScene.tsx` mounts the rig at `spawnPointOf`'s feet and yaw — one
 * selection, so the point the invariant proves is the point the player gets.
 */

import { FACING_VEC } from '../types'
import type { Aabb3, Vec3 } from '../types'
import { facingTurns } from '../assembler'
import type { DeckAssembly, PlacedModule, ShipAssembly } from '../assembler'
import type { PlacedDoor } from '../validation'
import { partBounds } from '../kit/parts'
import { depenetrate } from './collide'
import {
  STANDING_SHAPE,
  blockingBoxes,
  distanceToBoxXZ,
  supportHeightAt,
  type WalkerShape,
} from './hull'
import { hatchBlockerBoxes } from './hatch'
import {
  FLOOR_EPS_M,
  climbFeet,
  runAbove,
  type LaneSide,
  type LadderRun,
} from './ladder'
import { deckIndexAtY } from './walker'
import type { NavigationWorld } from './nav'

const AXIS_X = 0
const AXIS_Z = 2

/** Normalize −0 → 0 (Object.is-strict comparisons treat signed zeros apart). */
function n0(value: number): number {
  return value === 0 ? 0 : value
}

/* ------------------------------------------------------------- the contract */

/**
 * The crew/spawn deck index. PRD §6.1 asks to spawn "on the crew deck", and the
 * deck-plan contract (`src/fixtures/layout.ts`, the M1-T3 validator) puts it at
 * index 1 on every canonical ship: deck 0 is the bridge, deck 1 the crew deck.
 * The §8 spec facet of the invariant (`checkSpawnInside`) already requires that deck to exist
 * and to host a galley seated on the spine band, so this is a contract constant,
 * not a guess.
 */
export const CREW_DECK_INDEX = 1

/**
 * How far inside the crew room's spine doorway the doorway candidate stands (m).
 *
 * Measured: the galley's own deck-plate cable run crosses the room at
 * z = 1.24…1.36 m, and the walker's 0.25 m footprint at 1.0 m past the door
 * plane (z = 1.70 m) leads it 0.09 m clear of that run — so the spawn stands on
 * the plate itself (support == the deck floor exactly), not on top of the kit
 * that runs across the room. The verdict re-measures this on every ship: if a
 * ship's room has something at this standoff, the candidate is rejected and the
 * ladder lane is taken instead.
 */
export const SPAWN_DOOR_STANDOFF_M = 1.0

/** A quarter turn in radians — the rig's camera yaw unit (`facingTurns` → yaw). */
const QUARTER_TURN = Math.PI / 2

/* ----------------------------------------------------------------- the pose */

/** Which derived pose a spawn candidate is. */
export type SpawnKind = 'doorway' | 'ladder-lane'

/**
 * One candidate spawn pose, derived from the ship's own geometry. `feet` is the
 * walker's feet in world meters (the eye is `EYE_HEIGHT_M` above them) and `yaw`
 * the initial camera yaw (three.js `rotation.y`: 0 looks along −Z).
 */
export interface SpawnCandidate {
  kind: SpawnKind
  feet: Vec3
  yaw: number
  deckIndex: number
  deckId: string
  /** The module instance the pose stands in (its kit module id + spec index; −1 = the shaft band). */
  moduleId: string
  moduleIndex: number
  /** The door socket the pose is derived from (the room's `spine-door`, or the shaft face the lane faces). */
  socketId: string
  /** How the pose was derived, for the invariant's report. */
  note: string
}

/* ------------------------------------------------------------ the selection */

/** The crew deck of an assembly, or undefined when the ship has no deck 1. */
export function crewDeckOf(assembly: ShipAssembly): DeckAssembly | undefined {
  return assembly.decks.find((deck) => deck.deckIndex === CREW_DECK_INDEX)
}

/** The room instance at the foot of the spine on a deck (the first non-band module). */
function seatedRoomOf(deck: DeckAssembly): PlacedModule | undefined {
  return deck.modules.find((owner) => !owner.band)
}

/** The socket a room presents to the shaft (the kit's standardized `spine-door`). */
function spineDoorOf(room: PlacedModule): PlacedDoor | undefined {
  return room.doors.find((door) => door.socketId === 'spine-door') ?? room.doors[0]
}

/**
 * Which side of a run's ladder the deck's room stands on: the room's spine-door
 * faces the shaft from the room's own side, so the sign of its offset from the
 * rung line is the side. A room on the shaft's ±X face has no lane of its own
 * (the lanes are the ±Z pair); the +Z lane is the deterministic default there —
 * both faces are proven walkable by M3-T5's `navigationProblems` either way.
 */
function roomLaneSide(run: LadderRun, room: PlacedModule | undefined): LaneSide {
  const door = room === undefined ? undefined : spineDoorOf(room)
  if (door === undefined) {
    return 1
  }
  const dz = door.center[AXIS_Z] - run.axisZ
  if (dz !== 0) {
    return dz > 0 ? 1 : -1
  }
  return door.center[AXIS_X] - run.axisX >= 0 ? 1 : -1
}

/**
 * The spawn candidates for a ship, in preference order — derived from the crew
 * deck's own geometry, never hand-placed:
 *
 *  1. `doorway`: `SPAWN_DOOR_STANDOFF_M` inside the seated room's spine doorway,
 *     on the socket's own axis, looking into the room;
 *  2. `ladder-lane`: the lane of the run rising from the crew deck, on the
 *     room's side of the ladder, looking at the ladder (the climb's arrival
 *     pose — pressing W mounts it).
 *
 * Empty when the ship has no crew deck. A deck carrying no room instance gets
 * only the ladder lane (the shaft is still a place to stand, and the ladder
 * still has to be reachable).
 */
export function spawnCandidates(
  assembly: ShipAssembly,
  world: NavigationWorld,
): SpawnCandidate[] {
  const deck = crewDeckOf(assembly)
  if (deck === undefined) {
    return []
  }
  const candidates: SpawnCandidate[] = []
  const room = seatedRoomOf(deck)
  const door = room === undefined ? undefined : spineDoorOf(room)

  if (room !== undefined && door !== undefined) {
    const outward = FACING_VEC[door.facing]
    candidates.push({
      kind: 'doorway',
      feet: [
        n0(door.center[AXIS_X] - outward[AXIS_X] * SPAWN_DOOR_STANDOFF_M),
        deck.floorY,
        n0(door.center[AXIS_Z] - outward[AXIS_Z] * SPAWN_DOOR_STANDOFF_M),
      ],
      // The camera looks along its own −Z, and `facingTurns(facing)` is the yaw
      // that lays the socket's OUTWARD normal on +Z — so this yaw points the
      // camera the opposite way: straight into the room, away from the shaft
      // (on the canonical ships, at the galley's coffee station).
      yaw: facingTurns(door.facing) * QUARTER_TURN,
      deckIndex: deck.deckIndex,
      deckId: deck.deckId,
      moduleId: room.source.moduleId,
      moduleIndex: room.source.moduleIndex,
      socketId: door.socketId,
      note: `${SPAWN_DOOR_STANDOFF_M} m inside the "${room.source.moduleId}" module's "${door.socketId}" doorway`,
    })
  }

  const run = runAbove(world.runs, deck.deckIndex)
  if (run !== undefined) {
    const side = roomLaneSide(run, room)
    const band = deck.band
    candidates.push({
      kind: 'ladder-lane',
      feet: climbFeet(run, side, run.axisX, deck.floorY),
      // Facing the ladder: the walker stands one lane off the rung line, and
      // the yaw that looks ACROSS the trunk is the lane's own opposite facing —
      // yaw 0 in the +Z lane, looking −Z. That is also the pose the climb
      // machine's mount test wants, so W climbs from the spawn with no turn.
      yaw: facingTurns(side > 0 ? '+z' : '-z') * QUARTER_TURN,
      deckIndex: deck.deckIndex,
      deckId: deck.deckId,
      moduleId: band.source.moduleId,
      moduleIndex: band.source.moduleIndex,
      socketId: side > 0 ? '+z' : '-z',
      note: `the lane of the "${band.source.moduleId}" band's ladder at z = ${laneOf(run, side).toFixed(3)} m (the run rising to the deck above)`,
    })
  }

  return candidates
}

/** The lane's world Z for a run and side (the strip the walker's feet travel in). */
function laneOf(run: LadderRun, side: LaneSide): number {
  return n0(run.axisZ + side * run.laneGapM)
}

/* ---------------------------------------------------------------- the verdict */

/** Where a candidate stands, in the deck's own terms (for the report). */
export interface SpawnContainment {
  moduleId: string
  moduleIndex: number
  /** True when the point stands in the synthesized shaft band rather than a room. */
  band: boolean
}

/** The evidence one candidate's standability is judged on. */
export interface SpawnVerdict {
  /** True when the candidate is a legal spawn (every problem below is empty). */
  ok: boolean
  problems: string[]
  /** World Y of the highest surface under the footprint, meters (−Infinity = nothing). */
  supportM: number
  /** True when that surface IS the deck floor (the walker stands on the plate). */
  onPlate: boolean
  /** Boxes the standing healer had to push the walker out of (0 = nothing intersects the body). */
  healFixes: number
  /** Distance from the capsule to the nearest blocking kit, meters (Infinity = nothing near). */
  clearanceM: number
  /** The module instance whose own geometry contains the point (null = outside every module). */
  containing: SpawnContainment | null
}

/**
 * The world bounds of a module instance's own placed geometry. `PlacedModule.parts`
 * are ALREADY world parts (M3-T1 placed them through the instance's origin and
 * yaw), so this is a plain union — transforming them again would double-apply
 * the pose.
 */
function moduleWorldBounds(owner: PlacedModule): Aabb3 {
  const min: [number, number, number] = [Infinity, Infinity, Infinity]
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity]
  for (const placed of owner.parts) {
    const box = partBounds(placed.part)
    for (let axis = 0; axis < 3; axis++) {
      min[axis] = Math.min(min[axis], box.min[axis])
      max[axis] = Math.max(max[axis], box.max[axis])
    }
  }
  return { min, max }
}

/** True when a point lies within an axis-aligned box on every axis. */
function boxContainsPoint(box: Aabb3, point: Vec3): boolean {
  for (let axis = 0; axis < 3; axis++) {
    if (point[axis] < box.min[axis] || point[axis] > box.max[axis]) {
      return false
    }
  }
  return true
}

/** The hull the walker is solved against at spawn: every deck's boxes + every shut leaf. */
function spawnHull(world: NavigationWorld): Aabb3[] {
  // The same composition the navigation machine hands the walker each frame
  // (`nav.ts` blockingHull); an EMPTY open-state map is the spawn state — every
  // hatch shut, which is what `initialNavState` starts with.
  return [...world.walker.hull, ...hatchBlockerBoxes(world.hatches, {})]
}

/** One line for a vector in the report style. */
function fmtVec(v: Vec3): string {
  return `(${v[0].toFixed(3)}, ${v[1].toFixed(3)}, ${v[2].toFixed(3)})`
}

/**
 * Measure one candidate: is this a legal spawn on the crew deck?
 *
 * `assembly` is what answers "inside which module instance", `world` what
 * answers "inside the ship and standing on it" — the same world the navigation
 * machine walks the player through.
 */
export function spawnVerdict(
  assembly: ShipAssembly,
  world: NavigationWorld,
  candidate: SpawnCandidate,
  shape: WalkerShape = STANDING_SHAPE,
): SpawnVerdict {
  const problems: string[] = []
  const feet = candidate.feet
  const deck = assembly.decks.find((d) => d.deckIndex === candidate.deckIndex)
  const deckAt = deckIndexAtY(world.walker, feet[1])
  if (deckAt !== CREW_DECK_INDEX) {
    problems.push(
      `its feet are on deck ${deckAt}, not the crew deck (index ${CREW_DECK_INDEX})`,
    )
  }

  // Inside the deck: within one of the crew deck's own module instances.
  let containing: SpawnContainment | null = null
  if (deck !== undefined) {
    for (const owner of deck.modules) {
      if (boxContainsPoint(moduleWorldBounds(owner), feet)) {
        containing = {
          moduleId: owner.source.moduleId,
          moduleIndex: owner.source.moduleIndex,
          band: owner.band,
        }
        break
      }
    }
  }
  if (containing === null) {
    problems.push('it is outside every module instance of the crew deck')
  }

  // Not intersecting geometry: the standing capsule against the spawn hull.
  const hull = spawnHull(world)
  const blockers = blockingBoxes(hull, feet[1], shape)
  const healed = depenetrate(feet[0], feet[2], blockers, shape.radius)
  const healFixes = healed.fixes
  if (healFixes > 0) {
    problems.push(
      `the walker's body is inside ${healFixes} hull box(es) — the heal pass would push them out of it`,
    )
  }
  let clearanceM = Infinity
  for (const box of blockers) {
    clearanceM = Math.min(
      clearanceM,
      distanceToBoxXZ(feet[0], feet[2], box) - shape.radius,
    )
  }

  // Standable: the deck plate (or kit within a step of it) carries the feet.
  const supportM = supportHeightAt(
    hull,
    feet[0],
    feet[2],
    shape.radius,
    feet[1] + shape.stepHeight,
  )
  const onPlate = supportM >= feet[1] - FLOOR_EPS_M
  const supported =
    onPlate &&
    supportM <= feet[1] + shape.stepHeight + FLOOR_EPS_M &&
    Number.isFinite(supportM)
  if (!supported) {
    problems.push(
      `the deck plate does not carry them (highest surface under the footprint ` +
        `${Number.isFinite(supportM) ? `${supportM.toFixed(3)} m` : 'none'}, floor ${feet[1].toFixed(3)} m)`,
    )
  }

  return {
    ok: problems.length === 0,
    problems,
    supportM,
    onPlate: supported && supportM <= feet[1] + FLOOR_EPS_M,
    healFixes,
    clearanceM,
    containing,
  }
}

/* ---------------------------------------------------------------- the choice */

/** A candidate with its measured verdict. */
export interface SpawnTrial {
  candidate: SpawnCandidate
  verdict: SpawnVerdict
}

/** The chosen spawn pose plus the measurement that accepted it. */
export interface SpawnPoint extends SpawnCandidate {
  verdict: SpawnVerdict
}

/** The whole selection: every candidate tried, the one chosen, and why not. */
export interface SpawnChoice {
  /** The first candidate that passed, or null when none did. */
  point: SpawnPoint | null
  trials: SpawnTrial[]
  /** Human-readable reasons for a missing/illegal spawn (empty when `point` is set). */
  problems: string[]
}

/**
 * Choose the spawn: try every derived candidate in preference order and take
 * the first legal one, measuring each against the ship's own hull. No spawn is
 * the honest answer for a ship whose crew deck provides none.
 */
export function chooseSpawn(
  assembly: ShipAssembly,
  world: NavigationWorld,
  shape: WalkerShape = STANDING_SHAPE,
): SpawnChoice {
  const deck = crewDeckOf(assembly)
  if (deck === undefined) {
    return {
      point: null,
      trials: [],
      problems: [
        `the assembled ship has no crew deck (index ${CREW_DECK_INDEX}) — there is nowhere to spawn`,
      ],
    }
  }
  const trials: SpawnTrial[] = spawnCandidates(assembly, world).map((candidate) => ({
    candidate,
    verdict: spawnVerdict(assembly, world, candidate, shape),
  }))
  if (trials.length === 0) {
    return {
      point: null,
      trials,
      problems: [
        `the crew deck ("${deck.deckId}") offers no spawn candidate — no room instance at the spine foot and no ladder run rising from it`,
      ],
    }
  }
  const chosen = trials.find((trial) => trial.verdict.ok)
  if (chosen === undefined) {
    return {
      point: null,
      trials,
      problems: trials.map(
        (trial) =>
          `the ${trial.candidate.kind} spawn at ${fmtVec(trial.candidate.feet)} ` +
          `(${trial.candidate.note}) is not legal: ${trial.verdict.problems.join('; ')}`,
      ),
    }
  }
  return {
    point: { ...chosen.candidate, verdict: chosen.verdict },
    trials,
    problems: [],
  }
}

/** The chosen spawn of an assembled ship, or null when it has none. */
export function spawnPointOf(
  assembly: ShipAssembly,
  world: NavigationWorld,
  shape: WalkerShape = STANDING_SHAPE,
): SpawnPoint | null {
  return chooseSpawn(assembly, world, shape).point
}

/**
 * The assembled half of PRD §8 bullet 5: is there a legal spawn on this ship?
 * Empty means the walker starts on the crew deck's plate, inside a module
 * instance, clear of the hull and of every shut hatch leaf.
 */
export function spawnProblems(
  assembly: ShipAssembly,
  world: NavigationWorld,
  shape: WalkerShape = STANDING_SHAPE,
): string[] {
  return chooseSpawn(assembly, world, shape).problems
}

/** One line naming a chosen spawn (the invariant's pass detail). */
export function spawnLabel(point: SpawnPoint): string {
  const where =
    point.verdict.containing === null
      ? 'the crew deck'
      : `the ${point.verdict.containing.band ? 'shaft band' : `"${point.verdict.containing.moduleId}" module`}${
          point.verdict.containing.band
            ? ''
            : `#${point.verdict.containing.moduleIndex}`
        }`
  const support = point.verdict.onPlate
    ? `on the deck plate (${point.verdict.supportM.toFixed(3)} m)`
    : `on kit within a step of the plate (${point.verdict.supportM.toFixed(3)} m)`
  return (
    `${fmtVec(point.feet)} m inside ${where} on the crew deck ("${point.deckId}", deck ${point.deckIndex}), ` +
    `standing ${support}, ${point.verdict.healFixes} heal fixes against the hull`
  )
}
