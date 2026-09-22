/**
 * M3-T5 — the ladder-climb state machine: how a walker leaves a deck's plate,
 * climbs the spine's ladder and arrives on another deck.
 *
 * BUILD_PLAN M3-T5: "Ladder-climb state machine + hatch traversal between decks
 * (from M0-T4 spike)". The M0-T4 spike was human-held (it needs a browser and a
 * feel judgment — BUILD_PLAN M0 execution note), so the numbers below are this
 * module's own TUNING SET: they are exported constants, not magic values, and an
 * interactive M0-T4 session is what retunes them. What the spike would have
 * decided and this module instead DERIVES is the geometry: the rung heights, the
 * ladder's width and depth and the lane's clearance all come off the assembled
 * spine band's own parts (`ladderGeometryOf`), so the machine climbs the ladder
 * that is really in the ship (M2-T6: "the M3-T5 climb state machine can read the
 * rung heights straight off the parts instead of re-deriving them").
 *
 * WHY A STATE MACHINE AT ALL. The M3-T4 walker is a capsule solved against the
 * M3-T3 hull, and the M3-T4 tests measured what that means in the shaft: the
 * ladder's rails and rungs occupy the trunk's mid-line, the 0.7 m crawl opening
 * is smaller than the capsule's footprint plus those rungs, and the only place a
 * 0.25 m capsule fits in the trunk is the LANE — the strip either side of the
 * ladder, one capsule radius clear of the rungs (measured: z = ±0.268 m, clean
 * of every hull box and supported by the deck plate's frame). So crossing the
 * shaft is not walking: it is a climb, and the climb is a locked slide along the
 * ladder's own line. That is the whole point of this module — while climbing,
 * the walker is not solved against the hull; they are ON the ladder, and the
 * only things that can happen are climbing, resting on a rung, and arriving at a
 * landing.
 *
 * THE RUN. One `LadderRun` is one band's ladder — the storey between two deck
 * floors:
 *
 *   band i spans  [floorY(i), floorY(i) + 3.2]  =  deck i's storey
 *   its rungs sit  floorY(i) + 0.3 … floorY(i) + 3.0   (ten rungs, 0.3 m pitch)
 *   so the run connects  deck i (bottom landing)  →  deck i−1 (top landing)
 *
 * The top landing is the deck ABOVE the band, whatever the spec's pitch is (a
 * ship whose decks step off the canonical grid gets a run that steps with them —
 * `navigationProblems` (nav.ts) reports the step rather than the machine hiding it). The run
 * is climbable at both ends, which is why EVERY deck of a stacked ship is
 * reachable: deck i is the bottom landing of its own band's run and the top
 * landing of the band below's.
 *
 * MOUNTING AND ARRIVING (the tuning set):
 *  - you mount by standing in the lane, FACING the ladder, and holding a climb
 *    key: W climbs up (nose-ward — "up the ship", the PRD §8 deck-order feel),
 *    S climbs down (you back onto the ladder from a landing);
 *  - the direction picks the run: W takes the run whose BOTTOM landing is your
 *    deck (its ladder rises from your feet), S takes the run whose TOP landing
 *    is your deck (its ladder descends from your feet). At the head deck there
 *    is no run above, so W does nothing and S takes the one run down — the run
 *    never hands you a climb that has nowhere to go;
 *  - lateral keys (A/D) slide along the ladder, inside its own width;
 *  - releasing the climb keys RESTS: the feet snap to the nearest rung, always
 *    (the snap radius is half a rung pitch, so some rung is always in reach);
 *  - you arrive by reaching a landing, never by stepping off mid-storey — the
 *    only legal exits are the two the run connects (try to climb past either and
 *    the machine lands you on that deck's plate, in the lane, under-burn gravity
 *    back on).
 *
 * WHAT THE CLIMB DOES NOT DO. It does not solve the capsule against the hull.
 * The climb is a point-in-lane slide, which is the correct model for a
 * first-person climber: the CAMERA (the eye) travels up the crawl opening's own
 * clear column — inside |x| ≤ 0.35 m and |z| ≤ 0.35 m of the 0.7 m opening
 * (M2-T6) at every height — so the player never sees a surface pass through
 * them, and `navigationProblems` pins exactly that (the eye keeps
 * NAV_EYE_CLEARANCE_M off the hull's crawl-opening frame on every canonical
 * ship). The body capsule's 0.25 m radius is not carried up the ladder: a
 * climber's volume is a line along the rung pitch, and the crawl opening is
 * sized for the camera path, not for a capsule.
 *
 * Pure and three-agnostic: rung heights are numbers, the run is a record, and
 * the frame step is a function — every transition unit-tests headlessly against
 * the canonical fixtures.
 */

import { DECK_PITCH_M, MM } from '../types'
import type { Aabb3, Vec3 } from '../types'
import type { DeckAssembly, PlacedModule, ShipAssembly } from '../assembler'
import { partBounds } from '../kit/parts'
import { withinHatchAlign } from '../spikes/seams/tolerances'
import { PLAYER_RADIUS_M, clampFrameDelta } from './move'
import type { MoveInput } from './move'

/** Normalize −0 → 0 (Object.is-strict comparisons treat signed zeros apart). */
function n0(value: number): number {
  return value === 0 ? 0 : value
}

function clamp(value: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, value))
}

/** Two heights are the same landing when they agree to a nanometre (m). */
export const FLOOR_EPS_M = 1e-9

/* -------------------------------------------------------------- tuning set */

/**
 * Climb speed (m/s). Slower than a walk (2.2 m/s) on purpose: a ladder is the
 * deliberate route between decks, and a storey is 3.2 m — 2.3 s of climbing.
 */
export const CLIMB_SPEED_M_S = 1.4

/** Climb speed while Shift is held (m/s): a hurried climb, still sub-walk. */
export const CLIMB_SPRINT_SPEED_M_S = 2.0

/** Speed of sliding sideways along the ladder while A/D is held (m/s). */
export const CLIMB_SIDE_SPEED_M_S = 0.9

/**
 * Feet offset beyond the rung's own depth that clears the walker's capsule (m).
 * The lane is `rungHalfDepth + PLAYER_RADIUS_M + this` off the ladder plane —
 * the tightest strip in the ship, so it carries a hair of slack rather than
 * sitting exactly on the contact tolerance.
 */
export const CLIMB_LANE_CLEARANCE_M = 0.005

/**
 * How squarely the camera must face the ladder plane to mount (cosine of the
 * angle: 0.5 ≈ 60°). Facing away from the ladder means walking past it, not
 * grabbing it.
 */
export const MOUNT_FACING_DOT = 0.5

/**
 * How far off the LANE (m, in the deck plane) a mount still takes. The lane is
 * where the walker's capsule comes to rest against the rungs, so "at the ladder"
 * is the natural pose to grab one from — and it keeps the mount from teleporting
 * a walker who is still crossing the trunk onto the rung line.
 */
export const MOUNT_LANE_TOLERANCE_M = 0.05

/**
 * Lateral slack past the ladder's own width where a mount still takes (m): the
 * climber slides onto the rung line (the mount clamps X into the ladder).
 */
export const MOUNT_SPAN_SLACK_M = 0.1

/**
 * Clearance the climbing camera keeps off the hull's geometry (m) — the
 * `navigationProblems` eye test. The crawl opening's frame is 0.077 m off the
 * camera's line (0.35 m opening half-width − 0.273 m lane), so 0.05 m proves the
 * eye travels the opening rather than a wall.
 */
export const NAV_EYE_CLEARANCE_M = 0.05

/* -------------------------------------------------------- the ladder itself */

/**
 * The ladder a spine band carries, measured off its own parts: where its rung
 * line runs (world x/z), how deep the rungs are across it, how wide the ladder
 * is (rails included), and every rung height in world Y, ascending.
 */
export interface LadderGeometry {
  /** World X of the rung line (the ladder's own centre). */
  planeX: number
  /** World Z of the rung line (the plane the climber stands parallel to). */
  planeZ: number
  /** Half the rungs' depth across the plane, meters (the lane's clearance term). */
  rungHalfDepthM: number
  /** Half the ladder's width along X, rails included, meters. */
  halfSpanM: number
  /** World Y of every rung, ascending. */
  rungYs: number[]
}

/** The world boxes of a module's cylinder parts moulded along `axis`. */
function cylinderBounds(module: PlacedModule, axis: 'x' | 'y'): Aabb3[] {
  return module.parts
    .filter((placed) => placed.part.kind === 'cylinder' && placed.part.axis === axis)
    .map((placed) => partBounds(placed.part))
}

/**
 * The ladder of a spine band, measured from the band's own placed parts — or
 * `undefined` when the band carries none (a kit whose shaft has no ladder; the
 * machine then simply has no run at that deck).
 *
 * Rungs are the band's cylinders moulded along X: a rung is a horizontal bar
 * spanning the ladder's width, which is exactly what a climber who faces ±Z
 * grips. Rails are the tall cylinders along Y on the rung line's Z — the band's
 * other vertical conduit (the M2-T6 cable trees) stands in the trunk's diagonal
 * corners, 0.525 m off the line, so the Z filter separates them without naming
 * either.
 */
export function ladderGeometryOf(band: PlacedModule): LadderGeometry | undefined {
  const rungs = cylinderBounds(band, 'x')
  if (rungs.length === 0) {
    return undefined
  }
  const planeX =
    (Math.min(...rungs.map((box) => box.min[0])) +
      Math.max(...rungs.map((box) => box.max[0]))) /
    2
  const planeZ =
    (Math.min(...rungs.map((box) => box.min[2])) +
      Math.max(...rungs.map((box) => box.max[2]))) /
    2
  const rungHalfDepthM = Math.max(
    ...rungs.map((box) => Math.max(box.max[2] - planeZ, planeZ - box.min[2])),
  )
  const rails = cylinderBounds(band, 'y').filter(
    (box) =>
      // A storey-tall rail, not a bracket…
      box.max[1] - box.min[1] > 0.5 &&
      // …and on the rung line (the cable trees are 0.525 m off it in Z).
      Math.abs((box.min[2] + box.max[2]) / 2 - planeZ) <= rungHalfDepthM + 1e-9,
  )
  const widths = [...rungs, ...rails].map((box) =>
    Math.max(box.max[0] - planeX, planeX - box.min[0]),
  )
  return {
    planeX: n0(planeX),
    planeZ: n0(planeZ),
    rungHalfDepthM,
    halfSpanM: Math.max(...widths),
    rungYs: rungs.map((box) => n0((box.min[1] + box.max[1]) / 2)).sort((a, b) => a - b),
  }
}

/**
 * One climbable run: a band's ladder, the two deck floors it connects, and the
 * lane the climber's feet travel in. `side` is not part of the run — the same
 * ladder is climbed from either face of the trunk — so the lane is the pair of
 * strips at `axisZ ± laneGapM`.
 */
export interface LadderRun {
  /** The band that owns the ladder (its deck's index/id). */
  bandDeckIndex: number
  bandDeckId: string
  /** The deck floor the run starts from (the band's own deck). */
  lowerDeckIndex: number
  lowerDeckId: string
  lowerFloorY: number
  /** The deck floor the run arrives on (the deck above the band). */
  upperDeckIndex: number
  upperDeckId: string
  upperFloorY: number
  /** World Y of every rung, ascending (the band's own rung heights). */
  rungYs: number[]
  /** World X/Z of the ladder's rung line. */
  axisX: number
  axisZ: number
  /** Feet offset from the rung line that clears the rungs, meters. */
  laneGapM: number
  /** How far along ±X the climber may slide (the ladder's own width), meters. */
  laneHalfSpanM: number
  /**
   * Rest snap radius, meters: half the rung pitch, so releasing the climb keys
   * always settles the feet on some rung. 0 for a single-rung (or rungless) run.
   */
  snapM: number
  /** How far the run's span is off the canonical deck pitch, millimeters. */
  pitchErrorMm: number
}

/** The deck above a floor (the nearest floor higher than `floorY`), if any. */
function deckAbove(ship: ShipAssembly, floorY: number): DeckAssembly | undefined {
  return ship.decks
    .filter((deck) => deck.floorY > floorY)
    .sort((a, b) => a.floorY - b.floorY)[0]
}

/**
 * Every climbable run of a ship, in deck order: one per band whose ladder really
 * exists and that has a deck above it to arrive on. A band on the head deck has
 * a ladder but no deck above, so it contributes no run — its rungs lead into the
 * top deck's ceiling, and the machine never offers a climb with nowhere to go.
 */
export function ladderRunsOf(ship: ShipAssembly): LadderRun[] {
  const runs: LadderRun[] = []
  for (const deck of ship.decks) {
    const ladder = ladderGeometryOf(deck.band)
    if (ladder === undefined) continue
    const above = deckAbove(ship, deck.floorY)
    if (above === undefined) continue
    const rungYs = ladder.rungYs
    const pitch = rungYs.length > 1 ? rungYs[1] - rungYs[0] : 0
    runs.push({
      bandDeckIndex: deck.deckIndex,
      bandDeckId: deck.deckId,
      lowerDeckIndex: deck.deckIndex,
      lowerDeckId: deck.deckId,
      lowerFloorY: deck.floorY,
      upperDeckIndex: above.deckIndex,
      upperDeckId: above.deckId,
      upperFloorY: above.floorY,
      rungYs,
      axisX: ladder.planeX,
      axisZ: ladder.planeZ,
      laneGapM: ladder.rungHalfDepthM + PLAYER_RADIUS_M + CLIMB_LANE_CLEARANCE_M,
      laneHalfSpanM: ladder.halfSpanM,
      snapM: pitch / 2,
      pitchErrorMm: Math.round(
        Math.abs(above.floorY - deck.floorY - DECK_PITCH_M) / MM,
      ),
    })
  }
  return runs
}

/** The run that rises from a deck's floor (its own band's ladder), if any. */
export function runAbove(
  runs: readonly LadderRun[],
  deckIndex: number,
): LadderRun | undefined {
  return runs.find((run) => run.lowerDeckIndex === deckIndex)
}

/** The run that arrives on a deck's floor (the band below's ladder), if any. */
export function runBelow(
  runs: readonly LadderRun[],
  deckIndex: number,
): LadderRun | undefined {
  return runs.find((run) => run.upperDeckIndex === deckIndex)
}

/** True when the run's span is within the M0-T2 hatch cap of the deck pitch. */
export function runTiles(run: LadderRun): boolean {
  return withinHatchAlign(run.pitchErrorMm)
}

/* --------------------------------------------------------------- the climb */

/** Which face of the ladder plane the climber is on ('+z' = z > the plane). */
export type LaneSide = 1 | -1

/**
 * A climber on a ladder: the run they are on, the face they are on, and the feet
 * on the rung line. `feet[2]` is always the lane (`axisZ + side × laneGapM`).
 */
export interface ClimbState {
  /** Index into the navigation world's run list. */
  runIndex: number
  side: LaneSide
  feet: Vec3
}

/** One climbing frame: the planar input is the climb/strafe, nothing else. */
export interface ClimbCommand {
  input: MoveInput
  /** Shift: a hurried climb (CLIMB_SPRINT_SPEED_M_S). */
  sprint: boolean
  /** Raw frame delta in seconds (clamped inside). */
  dt: number
}

/** What one climbing frame did. */
export interface ClimbStep {
  state: ClimbState
  /** Vertical distance actually climbed this frame, meters. */
  climbedM: number
  /** 'up' while climbing toward the nose, 'down' toward the drive, null resting. */
  direction: 'up' | 'down' | null
  /** Index of the rung nearest the feet (null when the run has no rungs). */
  rungIndex: number | null
  /** True when the climber reached a landing this frame. */
  arrived: boolean
  /** The deck they arrived on, when `arrived`. */
  arrivalDeckIndex: number | null
  arrivalDeckId: string | null
  /** Feet on the arrival landing, when `arrived` (grounded, in the lane). */
  arrivalFeet: Vec3 | null
}

/** The lane's Z for a run and side (the strip the climber's feet travel in). */
export function laneZ(run: LadderRun, side: LaneSide): number {
  return n0(run.axisZ + side * run.laneGapM)
}

/** The climber's feet on a run at height `y`, on `side`, at lateral `x`. */
export function climbFeet(run: LadderRun, side: LaneSide, x: number, y: number): Vec3 {
  return [
    n0(clamp(x, run.axisX - run.laneHalfSpanM, run.axisX + run.laneHalfSpanM)),
    y,
    laneZ(run, side),
  ]
}

/** Begin a climb of `run`, from the feet of a walker standing at its lane. */
export function mountClimb(
  run: LadderRun,
  runIndex: number,
  side: LaneSide,
  from: Vec3,
): ClimbState {
  return {
    runIndex,
    side,
    // The mount slides the climber onto the rung line's width and onto the lane.
    feet: climbFeet(run, side, from[0], from[1]),
  }
}

/** The nearest rung to `y` on a run, with its index (null for a rungless run). */
export function rungNearest(
  run: LadderRun,
  y: number,
): { index: number; y: number } | null {
  let best: { index: number; y: number } | null = null
  run.rungYs.forEach((rungY, index) => {
    if (best === null || Math.abs(rungY - y) < Math.abs(best.y - y)) {
      best = { index, y: rungY }
    }
  })
  return best
}

/**
 * Advance a climb one frame. W/S climb up/down along the run (clamped to its two
 * landings), A/D slides along the ladder, no input rests on the nearest rung.
 * Reaching a landing ARRIVES: the returned `arrivalFeet` are on that deck's
 * plate in the lane, ready for the walker (`nav.ts` does the handover).
 */
export function stepClimb(
  state: ClimbState,
  command: ClimbCommand,
  runs: readonly LadderRun[],
): ClimbStep {
  const run = runs[state.runIndex]
  const dt = clampFrameDelta(command.dt)
  let x = state.feet[0]
  let y = state.feet[1]
  let climbedM = 0
  const desired = command.input.forward
  const direction: 'up' | 'down' | null =
    desired > 0 ? 'up' : desired < 0 ? 'down' : null

  if (dt > 0) {
    if (direction !== null) {
      const speed = command.sprint ? CLIMB_SPRINT_SPEED_M_S : CLIMB_SPEED_M_S
      const next = clamp(
        y + (direction === 'up' ? 1 : -1) * speed * dt,
        run.lowerFloorY,
        run.upperFloorY,
      )
      climbedM = Math.abs(next - y)
      y = next
    } else {
      // Resting: settle onto a rung (the snap radius is half a rung pitch, so
      // some rung is always in reach).
      const rung = rungNearest(run, y)
      if (rung !== null && Math.abs(rung.y - y) <= run.snapM) {
        climbedM = Math.abs(rung.y - y)
        y = rung.y
      }
    }
    if (command.input.strafe !== 0) {
      x = clamp(
        x + command.input.strafe * CLIMB_SIDE_SPEED_M_S * dt,
        run.axisX - run.laneHalfSpanM,
        run.axisX + run.laneHalfSpanM,
      )
    }
  }

  // Arrival is a TRANSITION: a climber who climbs into a landing arrives once,
  // and holding the key on a landing they are already standing on does nothing
  // (otherwise every frame at the top would re-report an arrival).
  const startedAtTop = state.feet[1] >= run.upperFloorY - FLOOR_EPS_M
  const startedAtBottom = state.feet[1] <= run.lowerFloorY + FLOOR_EPS_M
  const reachedTop = direction === 'up' && y >= run.upperFloorY && !startedAtTop
  const reachedBottom = direction === 'down' && y <= run.lowerFloorY && !startedAtBottom
  const arrived = reachedTop || reachedBottom
  const rung = rungNearest(run, y)

  if (!arrived) {
    return {
      state: { ...state, feet: climbFeet(run, state.side, x, y) },
      climbedM,
      direction,
      rungIndex: rung === null ? null : rung.index,
      arrived: false,
      arrivalDeckIndex: null,
      arrivalDeckId: null,
      arrivalFeet: null,
    }
  }

  const arrival = reachedTop
    ? { index: run.upperDeckIndex, id: run.upperDeckId, floorY: run.upperFloorY }
    : { index: run.lowerDeckIndex, id: run.lowerDeckId, floorY: run.lowerFloorY }
  const arrivalFeet = climbFeet(run, state.side, x, arrival.floorY)
  return {
    state: { ...state, feet: arrivalFeet },
    climbedM,
    direction,
    rungIndex: rung === null ? null : rung.index,
    arrived: true,
    arrivalDeckIndex: arrival.index,
    arrivalDeckId: arrival.id,
    arrivalFeet,
  }
}

/**
 * The run a walker standing at `feet` is trying to mount, or undefined when they
 * are not. A mount needs all of:
 *
 *  - a climb key held (W or S) — W takes the run rising from this deck, S the
 *    one descending onto it (so a deck with two runs climbs both ways and the
 *    head deck's only run is still reachable, downward);
 *  - the walker AT the ladder: in its lane (within MOUNT_LANE_TOLERANCE_M of the
 *    strip the capsule rests on against the rungs) and within its width (plus
 *    MOUNT_SPAN_SLACK_M) — which is where walking into a ladder leaves you;
 *  - the camera facing the ladder plane (MOUNT_FACING_DOT): you grab what you
 *    look at, so walking past the shaft with the ladder behind you never mounts.
 *
 * `grounded` is the caller's verdict from the walker step (a falling walker
 * cannot mount), and `deckIndex` the deck their feet are on.
 */
export function mountRun(
  runs: readonly LadderRun[],
  deckIndex: number,
  grounded: boolean,
  feet: Vec3,
  yaw: number,
  input: MoveInput,
): { run: LadderRun; runIndex: number; side: LaneSide } | undefined {
  if (!grounded || input.forward === 0) {
    return undefined
  }
  const run = input.forward > 0 ? runAbove(runs, deckIndex) : runBelow(runs, deckIndex)
  if (run === undefined) {
    return undefined
  }
  if (Math.abs(feet[0] - run.axisX) > run.laneHalfSpanM + MOUNT_SPAN_SLACK_M) {
    return undefined
  }
  const dz = feet[2] - run.axisZ
  if (Math.abs(dz) > run.laneGapM + MOUNT_LANE_TOLERANCE_M) {
    return undefined
  }
  const side: LaneSide = dz >= 0 ? 1 : -1
  // Camera forward is (−sin yaw, 0, −cos yaw) (src/player/move.ts); the ladder
  // plane is at dz = 0, so facing it means the camera looks −side in Z.
  const facingZ = -Math.cos(yaw)
  if (-side * facingZ < MOUNT_FACING_DOT) {
    return undefined
  }
  return { run, runIndex: runs.indexOf(run), side }
}

/**
 * How far the climbing eye is from the hull's geometry: 0 when the eye is inside
 * a box, otherwise the distance to the nearest box (meters). The `navigationProblems`
 * clearance test — a climbing camera must never be inside the crawl opening's
 * frame.
 */
export function eyeClearanceM(hull: readonly Aabb3[], eye: Vec3): number {
  let nearest = Number.POSITIVE_INFINITY
  for (const box of hull) {
    const dx = Math.max(box.min[0] - eye[0], 0, eye[0] - box.max[0])
    const dy = Math.max(box.min[1] - eye[1], 0, eye[1] - box.max[1])
    const dz = Math.max(box.min[2] - eye[2], 0, eye[2] - box.max[2])
    nearest = Math.min(nearest, Math.hypot(dx, dy, dz))
  }
  return nearest
}
