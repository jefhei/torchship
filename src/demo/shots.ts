/**
 * M6-T4 — the demo SHOT LIST: the screenshots the README shows, DERIVED from
 * the assembled ships rather than hand-placed.
 *
 * The shot list is a small, authored CHOICE (which preset is photographed from
 * where) layered on a DERIVED pose: the camera stands in a deck's seated room,
 * `SPAWN_DOOR_STANDOFF_M` inside its own standardized `spine-door` socket,
 * looking into the room — the M3-T6 spawn derivation re-used off the crew deck.
 * So a ship that changes shape moves its own screenshots; nothing is a frozen
 * coordinate.
 *
 *  - HERO DECK: the default preset is shot on the crew deck (the galley — the
 *    ship's warm heart, PRD §4); each variant is shot on its AFT-MOST deck (the
 *    hold / retrofit deck that is what makes it that variant). `heroDeckIndex`
 *    states that rule; `planDemo` derives the pose on it.
 *  - COFFEE-RUN CLIP: the M5-T2 scripted walk (crew deck → the galley's coffee
 *    station → back) replayed headlessly; its frames ARE the clip's camera path,
 *    sampled to `CLIP_FRAMES` poses at `CLIP_FPS`.
 *
 * Every pose is MEASURED before it is accepted (`poseProblems`: on the deck,
 * inside a module instance's own geometry, carried by the deck plate, not
 * depenetrating the hull), so the shot list can never point a camera inside a
 * bulkhead. Pure and three-agnostic: geometry in, poses out (the renderer lives
 * in `scripts/blender-render.py`).
 */

import type { Vec3 } from '../types'
import { FACING_VEC } from '../types'
import type { FixtureId, ShipFixture } from '../fixtures'
import { expectValidFixtures } from '../fixtures'
import type { DeckAssembly, ShipAssembly } from '../assembler'
import { assembleShip, facingTurns } from '../assembler'
import { eyePosition } from '../player/move'
import { STANDING_SHAPE, blockingBoxes, supportHeightAt } from '../player/hull'
import { depenetrate } from '../player/collide'
import { FLOOR_EPS_M } from '../player/ladder'
import { navigationWorldOf, type NavigationWorld } from '../player/nav'
import {
  CREW_DECK_INDEX,
  SPAWN_DOOR_STANDOFF_M,
  moduleWorldBounds,
} from '../player/spawn'
import { coffeeRunScript, recordWalk } from '../review'

/** The `public/` subdirectory the demo assets live in. */
export const DEMO_DIR = 'demo'

/** How many evenly-spaced poses the coffee-run clip samples from the walk. */
export const CLIP_FRAMES = 24

/** The clip's playback rate (a shorter, loopable loop than the 60 Hz replay). */
export const CLIP_FPS = 12

/** The preset the coffee run is filmed on (the default ship). */
export const COFFEE_RUN_CLIP_FIXTURE: FixtureId = 'patrol'

/** One camera pose, in ship world space (Y is the thrust axis; up is +Y). */
export interface CameraPose {
  /** The floor point under the camera, world meters. */
  feet: Vec3
  /** The eye the camera sits at (feet + EYE_HEIGHT_M), world meters. */
  eye: Vec3
  /** Camera yaw (three.js `rotation.y`; yaw 0 looks along −Z), radians. */
  yaw: number
  /** The deck the pose stands on. */
  deckIndex: number
  deckId: string
  /** The deck's own label, e.g. `Deck 1 — Crew deck`. */
  deckLabel: string
}

/** A still screenshot in the README gallery. */
export interface DemoStill {
  kind: 'still'
  /** Stable id, e.g. `patrol-interior`. */
  id: string
  /** The canonical preset the shot is of. */
  presetId: FixtureId
  /** The ship's identity name. */
  ship: string
  label: string
  /** The deck/space the camera stands in (table column). */
  space: string
  /** `public`-relative asset path, e.g. `demo/patrol.png`. */
  asset: string
  pose: CameraPose
}

/** The coffee-run GIF: a camera path sampled from a recorded walk. */
export interface DemoClip {
  kind: 'clip'
  id: string
  presetId: FixtureId
  ship: string
  label: string
  space: string
  /** `public`-relative asset path, e.g. `demo/coffee-run.gif`. */
  asset: string
  fps: number
  frames: CameraPose[]
}

export type DemoShot = DemoStill | DemoClip

/** The shot list plus any reason a shot could not be derived. */
export interface DemoPlan {
  shots: DemoShot[]
  problems: string[]
}

/* ------------------------------------------------------------------ helpers */

const QUARTER_TURN = Math.PI / 2

/** Normalize −0 → 0 (Object.is-strict comparisons treat signed zeros apart). */
function n0(value: number): number {
  return value === 0 ? 0 : value
}

/** One line for a vector in the report style. */
function fmtVec(v: Vec3): string {
  return `(${v[0].toFixed(3)}, ${v[1].toFixed(3)}, ${v[2].toFixed(3)})`
}

/** True when a point lies within an axis-aligned box on every axis. */
function boxContainsPoint(box: { min: Vec3; max: Vec3 }, point: Vec3): boolean {
  for (let axis = 0; axis < 3; axis++) {
    if (point[axis] < box.min[axis] || point[axis] > box.max[axis]) {
      return false
    }
  }
  return true
}

/** The room seated on a deck (the first non-band module instance). */
function seatedRoomOf(deck: DeckAssembly) {
  return deck.modules.find((owner) => !owner.band)
}

/* -------------------------------------------------------------- the choices */

/**
 * Which deck a preset is photographed on, DERIVED from the ship's own deck plan:
 *
 *  - the default preset (no module type repeats) shows the crew deck — its galley,
 *    the ship's warm heart (PRD §4);
 *  - a VARIANT shows its signature deck: the last deck that hosts a module type
 *    the ship carries more than once (Long-Haul's second cargo hold, Science's
 *    ops-module retrofit). That is the deck that makes the variant a variant.
 *
 * The rule reads the spec's module refs; the pose is then derived from whatever
 * deck it names.
 */
export function heroDeckIndex(fixture: ShipFixture): number {
  const counts = new Map<string, number>()
  for (const deck of fixture.spec.decks) {
    for (const ref of deck.modules) {
      counts.set(ref.moduleId, (counts.get(ref.moduleId) ?? 0) + 1)
    }
  }
  for (let index = fixture.spec.decks.length - 1; index >= 0; index--) {
    const repeated = fixture.spec.decks[index].modules.some(
      (ref) => (counts.get(ref.moduleId) ?? 0) > 1,
    )
    if (repeated) {
      return index
    }
  }
  return CREW_DECK_INDEX
}

/* ---------------------------------------------------------------- the poses */

/**
 * The camera pose standing in a deck's seated room, `SPAWN_DOOR_STANDOFF_M`
 * inside its own `spine-door` socket and looking into the room — the M3-T6
 * doorway candidate, generalized to any deck. Null when the deck seats no room.
 */
export function doorwayPose(
  assembly: ShipAssembly,
  deckIndex: number,
): CameraPose | null {
  const deck = assembly.decks.find((d) => d.deckIndex === deckIndex)
  if (deck === undefined) {
    return null
  }
  const room = seatedRoomOf(deck)
  if (room === undefined) {
    return null
  }
  const door = room.doors.find((d) => d.socketId === 'spine-door') ?? room.doors[0]
  if (door === undefined) {
    return null
  }
  const outward = FACING_VEC[door.facing]
  const feet: Vec3 = [
    n0(door.center[0] - outward[0] * SPAWN_DOOR_STANDOFF_M),
    deck.floorY,
    n0(door.center[2] - outward[2] * SPAWN_DOOR_STANDOFF_M),
  ]
  return {
    feet,
    eye: eyePosition(feet, false),
    yaw: facingTurns(door.facing) * QUARTER_TURN,
    deckIndex: deck.deckIndex,
    deckId: deck.deckId,
    deckLabel: deck.label,
  }
}

/**
 * Measure one pose against the ship: on its deck, inside a module instance's own
 * placed geometry, carried by the deck plate, not depenetrating the hull. Empty
 * means the camera is somewhere a person could stand.
 */
export function poseProblems(
  assembly: ShipAssembly,
  world: NavigationWorld,
  pose: CameraPose,
): string[] {
  const problems: string[] = []
  const deck = assembly.decks.find((d) => d.deckIndex === pose.deckIndex)
  if (deck === undefined) {
    return [`deck ${pose.deckIndex} is not in the ship`]
  }
  const inside = deck.modules.some((owner) =>
    boxContainsPoint(moduleWorldBounds(owner), pose.feet),
  )
  if (!inside) {
    problems.push(
      `the pose at ${fmtVec(pose.feet)} is outside every module instance on deck ${pose.deckIndex}`,
    )
  }
  const shape = STANDING_SHAPE
  const hull = world.walker.hull
  const healed = depenetrate(
    pose.feet[0],
    pose.feet[2],
    blockingBoxes(hull, pose.feet[1], shape),
    shape.radius,
  )
  if (healed.fixes > 0) {
    problems.push(
      `the pose is inside ${healed.fixes} hull box(es) — a bulkhead or prop stands there`,
    )
  }
  const support = supportHeightAt(
    hull,
    pose.feet[0],
    pose.feet[2],
    shape.radius,
    pose.feet[1] + shape.stepHeight,
  )
  // The same "standable" rule the spawn uses (M3-T6): the deck plate carries the
  // pose, allowing kit within a step of it (a cable duct underfoot is walked
  // over, not fallen through) but nothing higher.
  const onPlate = Number.isFinite(support) && support >= pose.feet[1] - FLOOR_EPS_M
  const carried = onPlate && support <= pose.feet[1] + shape.stepHeight + FLOOR_EPS_M
  if (!carried) {
    problems.push(
      `the deck plate does not carry the pose (highest surface under the footprint ` +
        `${Number.isFinite(support) ? `${support.toFixed(3)} m` : 'none'}, floor ${deck.floorY.toFixed(3)} m)`,
    )
  }
  return problems
}

/* ----------------------------------------------------------------- the plan */

/** A pose from a recorded walk frame, snapped onto the ship's decks. */
function poseFromFrame(
  assembly: ShipAssembly,
  frame: { feet: Vec3; yaw: number; deckIndex: number },
): CameraPose {
  const deck = assembly.decks.find((d) => d.deckIndex === frame.deckIndex)
  return {
    feet: frame.feet,
    eye: eyePosition(frame.feet, false),
    yaw: frame.yaw,
    deckIndex: frame.deckIndex,
    deckId: deck?.deckId ?? '',
    deckLabel: deck?.label ?? '',
  }
}

/** Evenly sample `count` poses from a walk's frames (all of them when short). */
function samplePoses(
  assembly: ShipAssembly,
  frames: readonly { feet: Vec3; yaw: number; deckIndex: number }[],
  count: number,
): CameraPose[] {
  if (frames.length === 0) {
    return []
  }
  if (frames.length <= count) {
    return frames.map((frame) => poseFromFrame(assembly, frame))
  }
  const poses: CameraPose[] = []
  for (let i = 0; i < count; i++) {
    const at = Math.round((i * (frames.length - 1)) / (count - 1))
    poses.push(poseFromFrame(assembly, frames[at]))
  }
  return poses
}

/**
 * Build the demo shot list: one still per real preset + the coffee-run clip.
 * Never throws — a shot that cannot be derived lands in `problems` with the
 * reason, and the gate (`demo.test.ts`) requires `problems` to be empty.
 */
export function planDemo(
  fixtures: readonly ShipFixture[] = expectValidFixtures(),
): DemoPlan {
  const shots: DemoShot[] = []
  const problems: string[] = []

  for (const fixture of fixtures) {
    const assembly = assembleShip(fixture.spec)
    const world = navigationWorldOf(assembly)
    const deckIndex = heroDeckIndex(fixture)
    const pose = doorwayPose(assembly, deckIndex)
    if (pose === null) {
      problems.push(
        `${fixture.id}: deck ${deckIndex} seats no room to stand a camera in`,
      )
      continue
    }
    const issues = poseProblems(assembly, world, pose)
    if (issues.length > 0) {
      problems.push(
        `${fixture.id}: the hero pose on deck ${deckIndex} is not standable — ${issues.join('; ')}`,
      )
      continue
    }
    shots.push({
      kind: 'still',
      id: `${fixture.id}-interior`,
      presetId: fixture.id,
      ship: fixture.spec.name,
      label: fixture.label,
      space: pose.deckLabel,
      asset: `${DEMO_DIR}/${fixture.id}.png`,
      pose,
    })
  }

  const clipFixture = fixtures.find((f) => f.id === COFFEE_RUN_CLIP_FIXTURE)
  if (clipFixture === undefined) {
    problems.push(
      `no "${COFFEE_RUN_CLIP_FIXTURE}" preset in the fixture set — the coffee run has no ship`,
    )
  } else {
    const assembly = assembleShip(clipFixture.spec)
    const world = navigationWorldOf(assembly)
    const script = coffeeRunScript(assembly, world)
    if (script === null) {
      problems.push(
        `the coffee run cannot be planned on "${clipFixture.id}" (no crew-deck spawn or no coffee station)`,
      )
    } else {
      const recording = recordWalk(assembly, world, script)
      const frames = samplePoses(assembly, recording.frames, CLIP_FRAMES)
      if (frames.length < 2) {
        problems.push(
          `the coffee-run recording on "${clipFixture.id}" produced ${frames.length} frame(s)`,
        )
      } else if (!recording.complete) {
        problems.push(
          `the coffee run on "${clipFixture.id}" did not complete (${frames.length} sampled frames)`,
        )
      } else {
        shots.push({
          kind: 'clip',
          id: 'coffee-run',
          presetId: clipFixture.id,
          ship: clipFixture.spec.name,
          label: 'The coffee run',
          space: 'Crew deck → the coffee station → back',
          asset: `${DEMO_DIR}/coffee-run.gif`,
          fps: CLIP_FPS,
          frames,
        })
      }
    }
  }

  return { shots, problems }
}

/** Just the stills, in plan order (the README gallery). */
export function demoStills(plan: DemoPlan): DemoStill[] {
  return plan.shots.filter((shot): shot is DemoStill => shot.kind === 'still')
}

/** The coffee-run clip, or null when it is not in the plan. */
export function demoClip(plan: DemoPlan): DemoClip | null {
  return plan.shots.find((shot): shot is DemoClip => shot.kind === 'clip') ?? null
}

/* --------------------------------------------------------------- the assets */

/**
 * The gate over the committed demo assets: every shot's file exists under
 * `public/` and carries the extension its kind needs (`.png` for a still, `.gif`
 * for a clip). `existing` is a list of `public/`-relative paths (the caller
 * reads the disk). Empty = the README's images are all really there.
 */
export function assetProblems(existing: readonly string[], plan: DemoPlan): string[] {
  const problems: string[] = []
  const have = new Set(existing.map((path) => path.replace(/\\/g, '/')))
  for (const shot of plan.shots) {
    if (!have.has(shot.asset)) {
      problems.push(
        `the "${shot.id}" shot names ${shot.asset} but public/ has no such file`,
      )
      continue
    }
    const wanted = shot.kind === 'still' ? '.png' : '.gif'
    if (!shot.asset.endsWith(wanted)) {
      problems.push(
        `the "${shot.id}" ${shot.kind} asset must be a ${wanted} file (got ${shot.asset})`,
      )
    }
  }
  return problems
}
