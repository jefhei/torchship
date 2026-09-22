/**
 * M3-T5 — the navigation machine: one frame step that walks, climbs and works
 * hatches, over the assembled ship.
 *
 * BUILD_PLAN M3-T5 is "ladder-climb state machine + hatch traversal between
 * decks". Its two halves are `ladder.ts` (the climb) and `hatch.ts` (the leaves);
 * this module is the composition that the rig drives, and the only place the two
 * meet the M3-T4 walker:
 *
 *   HATCH  pressing the interact key resolves the hatch in reach (open, close,
 *          or refuse to close on the walker) and the frame's walk uses the new
 *          state — walking into a closed hatch and pressing E opens it and
 *          carries on without a frame of clipping. The ladder owns a climbing
 *          frame: a hatch is not worked from a rung.
 *   MOUNT  a walker already AT a ladder — in its lane, grounded, facing it and
 *          holding a climb key — takes the run (`mountRun`) and the frame is a
 *          climbing one. The mount is decided BEFORE the walk step, which is
 *          what makes S at a landing mean "the ladder goes down from here"
 *          instead of "step back off it".
 *   WALK   otherwise the frame goes to `stepWalker` (M3-T4) with the hull the
 *          M3-T3 builder emitted PLUS the box of every hatch leaf in its current
 *          state — the leaf's collision the M3-T3 doc hands to this task. A
 *          closed hatch therefore stops the walker exactly like a bulkhead; an
 *          open one is gone from the passage.
 *   CLIMB  a climbing frame goes to `stepClimb`: a locked slide up or down the
 *          rung line, A/D sliding along it, no hull solving (the ladder IS the
 *          constraint). The CAMERA is written from the same feet, so the eye
 *          travels the crawl opening's clear column (ladder.ts's doc).
 *   ARRIVE reaching a landing hands the walker back: their feet land on that
 *          deck's plate in the lane, grounded, and the phase returns to 'walk'.
 *
 * WHY A COMPOSED MACHINE AND NOT A FLAG IN THE WALKER. The M3-T4 walker is a
 * collision solver: it must remain the thing that answers "where can this body
 * be". Climbing is a different mode with its own answer ("on the ladder, at a
 * rung"), so it is a phase the rig switches between, and the walker state is
 * preserved across it (a climber who has left a deck and not arrived on the next
 * one still has a deck above and below them: `deckLevelAtY` keeps reporting the
 * storey they are inside, which is exactly what the HUD wants).
 *
 * `navigationWorldOf` derives everything from the M3-T1 assembly — the run list
 * from the spine bands (ladder.ts), the hatches from the modules' own leaves
 * (hatch.ts), the deck floors and the hull from the M3-T4 world (walker.ts) —
 * and `navigationProblems` is the §8-bullet-3 refinement the assembled ship can
 * answer and the spec cannot: every deck is reachable by REALLY climbing, every
 * landing's lane is a legal place to stand, the runs tile at the deck pitch and
 * the climbing camera keeps clear of the crawl openings. `src/invariants/checks.ts`
 * runs it as the live half of "the spine connects every deck".
 *
 * Pure and three-agnostic: state in, state plus a report out.
 */

import { DECK_PITCH_M } from '../types'
import type { Aabb3, Vec3 } from '../types'
import type { ShipAssembly } from '../assembler'
import { SEAM_TOLERANCES } from '../spikes/seams/tolerances'
import { CONTACT_EPS_M, depenetrate } from './collide'
import {
  hatchBlockerBoxes,
  hatchInReach,
  hatchesOf,
  toggleHatch,
  type Hatch,
  type HatchAction,
  type HatchOpenStates,
} from './hatch'
import {
  FLOOR_EPS_M,
  NAV_EYE_CLEARANCE_M,
  climbFeet,
  eyeClearanceM,
  ladderRunsOf,
  laneZ,
  mountClimb,
  mountRun,
  runAbove,
  runBelow,
  runTiles,
  stepClimb,
  type ClimbState,
  type LaneSide,
  type LadderRun,
} from './ladder'
import { blockingBoxes, shapeFor, supportHeightAt } from './hull'
import { EYE_HEIGHT_M, clampFrameDelta } from './move'
import {
  deckLevelAtY,
  spawnWalker,
  stepWalker,
  walkerWorldOf,
  type WalkerCommand,
  type WalkerState,
  type WalkerWorld,
} from './walker'

/** The nav-grid sampling resolution of the climbing-eye clearance test (m). */
export const NAV_EYE_SAMPLE_M = 0.1

/* --------------------------------------------------------------- the world */

/** Everything the navigation machine needs: the walkable world, its runs, its hatches. */
export interface NavigationWorld {
  /** Deck floors + the M3-T3 hull (M3-T4's walkable world — never re-derived). */
  walker: WalkerWorld
  /** The climbable runs, in deck order (ladder.ts). */
  runs: LadderRun[]
  /** Every hatch leaf of the ship (hatch.ts). */
  hatches: Hatch[]
}

/**
 * The navigation world of an assembled ship: the M3-T4 walker world plus the
 * runs and hatches derived from the same assembly. One derivation, so a hatch
 * the renderer draws is a hatch the machine can open.
 */
export function navigationWorldOf(ship: ShipAssembly): NavigationWorld {
  return {
    walker: walkerWorldOf(ship),
    runs: ladderRunsOf(ship),
    hatches: hatchesOf(ship),
  }
}

/* --------------------------------------------------------------- the state */

/** Which mode the navigation machine is in. */
export type NavPhase = 'walk' | 'climb'

/** The whole navigation state: the mode, the walker, the climber, the hatches. */
export interface NavState {
  phase: NavPhase
  /** The walker (authoritative while `phase === 'walk'`). */
  walker: WalkerState
  /** The climber (set while `phase === 'climb'`). */
  climb: ClimbState | null
  /** Which hatches are open (id → true); unlisted hatches are shut. */
  open: HatchOpenStates
}

/** A frame's command: the walker's input plus the interact key. */
export interface NavCommand extends WalkerCommand {
  /** True on the frame the interact key was pressed (edge, not held). */
  interact: boolean
}

/** A walker dropped at `spawn` with every hatch shut and both feet on the deck. */
export function initialNavState(spawn: Vec3): NavState {
  return { phase: 'walk', walker: spawnWalker(spawn), climb: null, open: {} }
}

/** One frame's outcome: the next state plus everything a HUD or test reads. */
export interface NavStep {
  state: NavState
  phase: NavPhase
  /** The walker's feet (or the climber's feet on the rung line), world meters. */
  feet: Vec3
  eyeHeightM: number
  crouched: boolean
  deckIndex: number
  deckId: string
  deckLabel: string
  /** Walk travel, or climb travel while climbing, meters. */
  movedM: number
  blocked: boolean
  /** True on the frame the walker touches down after a fall, or arrives on a deck. */
  landed: boolean
  impactMps: number
  airborne: boolean
  arrested: boolean
  depenetrations: number
  /** 'up'/'down' while climbing, null while walking or resting. */
  climbDirection: 'up' | 'down' | null
  /** The rung nearest the climber's feet (null while walking). */
  rungIndex: number | null
  /** True on the frame a climb arrives at a landing. */
  arrived: boolean
  /** The hatch the interact key could act on right now (HUD prompt), or null. */
  hatchPrompt: Hatch | null
  /** What the interact key did this frame, if anything. */
  hatchAction: HatchAction | null
  /** The hatch the interact key acted on, if any. */
  hatchTarget: Hatch | null
}

/** The idle-climb report fields for a walking frame. */
const WALKING_CLIMB_FIELDS = {
  climbDirection: null,
  rungIndex: null,
  arrived: false,
} as const

/**
 * Press the interact key: open/close the hatch in reach of the walker. Returns
 * the (possibly new) open-state map plus what happened, so the frame can report
 * it and the walk can use the fresh state.
 */
function interact(
  state: NavState,
  command: NavCommand,
  world: NavigationWorld,
): Pick<NavStep, 'hatchAction' | 'hatchTarget'> & { open: HatchOpenStates } {
  const deck = deckLevelAtY(world.walker, state.walker.feet[1])
  const toggle = toggleHatch(
    state.open,
    world.hatches,
    deck.deckIndex,
    state.walker.feet,
    command.yaw,
    shapeFor(command.crouch),
  )
  return {
    open: toggle.open,
    hatchAction: toggle.action ?? null,
    hatchTarget: toggle.hatch,
  }
}

/** The hull the walker is solved against this frame: the decks' boxes + shut leaves. */
function blockingHull(world: NavigationWorld, open: HatchOpenStates): Aabb3[] {
  return [...world.walker.hull, ...hatchBlockerBoxes(world.hatches, open)]
}

/** Advance one walking frame, mounting a ladder when the walker asks for one. */
function stepWalkFrame(
  state: NavState,
  command: NavCommand,
  world: NavigationWorld,
  open: HatchOpenStates,
  hatchAction: HatchAction | null,
  hatchTarget: Hatch | null,
): NavStep {
  const step = stepWalker(state.walker, command, {
    ...world.walker,
    hull: blockingHull(world, open),
  })
  const hatchPrompt = hatchInReach(
    world.hatches,
    step.deckIndex,
    step.state.feet,
    command.yaw,
  )
  const nextState: NavState = { phase: 'walk', walker: step.state, climb: null, open }
  return {
    state: nextState,
    phase: nextState.phase,
    feet: step.state.feet,
    eyeHeightM: step.eyeHeightM,
    crouched: step.crouched,
    deckIndex: step.deckIndex,
    deckId: step.deckId,
    deckLabel: step.deckLabel,
    movedM: step.movedM,
    blocked: step.blocked,
    landed: step.landed,
    impactMps: step.impactMps,
    airborne: step.airborne,
    arrested: step.arrested,
    depenetrations: step.depenetrations,
    ...WALKING_CLIMB_FIELDS,
    hatchPrompt,
    hatchAction,
    hatchTarget,
  }
}

/** Advance one climbing frame, handing the walker back on arrival. */
function stepClimbFrame(
  state: NavState & { climb: ClimbState },
  command: NavCommand,
  world: NavigationWorld,
): NavStep {
  const step = stepClimb(state.climb, command, world.runs)
  const feet = step.state.feet
  const deck = deckLevelAtY(world.walker, feet[1])
  const landed = step.arrived
  const nextState: NavState = step.arrived
    ? {
        phase: 'walk',
        walker: {
          feet: step.arrivalFeet ?? feet,
          verticalSpeedMps: 0,
          grounded: true,
        },
        climb: null,
        open: state.open,
      }
    : { phase: 'climb', walker: state.walker, climb: step.state, open: state.open }
  return {
    state: nextState,
    phase: nextState.phase,
    feet: landed ? (step.arrivalFeet ?? feet) : feet,
    eyeHeightM: EYE_HEIGHT_M,
    crouched: command.crouch,
    deckIndex: deck.deckIndex,
    deckId: deck.deckId,
    deckLabel: deck.label,
    movedM: step.climbedM,
    blocked: false,
    landed,
    impactMps: 0,
    airborne: false,
    arrested: false,
    depenetrations: 0,
    climbDirection: step.direction,
    rungIndex: step.rungIndex,
    arrived: step.arrived,
    hatchPrompt: null,
    hatchAction: null,
    hatchTarget: null,
  }
}

/**
 * Advance the navigation machine one frame — the whole of M3-T5 as one call.
 * See the module doc for the frame's phases; the state returned is fresh.
 *
 * The MOUNT is decided BEFORE the frame's walk, on where the walker already is:
 * a walker at the ladder who presses S is taking the ladder down, not stepping
 * back off it, and the walk step would otherwise carry them out of the lane
 * before the mount could be seen. A mount also takes this frame's climbing step,
 * so grabbing the ladder and moving on it are one motion.
 */
export function stepNav(
  state: NavState,
  command: NavCommand,
  world: NavigationWorld,
): NavStep {
  const clamped: NavCommand = { ...command, dt: clampFrameDelta(command.dt) }
  if (state.phase === 'climb' && state.climb !== null) {
    const step = stepClimbFrame({ ...state, climb: state.climb }, clamped, world)
    return {
      ...step,
      // The ladder owns the frame: hatches are not worked from a rung.
      hatchAction: null,
      hatchTarget: null,
    }
  }
  const action = clamped.interact ? interact(state, clamped, world) : null
  const open = action?.open ?? state.open
  const deck = deckLevelAtY(world.walker, state.walker.feet[1])
  const mount = mountRun(
    world.runs,
    deck.deckIndex,
    state.walker.grounded,
    state.walker.feet,
    clamped.yaw,
    clamped.input,
  )
  if (mount !== undefined) {
    return stepClimbFrame(
      {
        phase: 'climb',
        walker: state.walker,
        climb: mountClimb(mount.run, mount.runIndex, mount.side, state.walker.feet),
        open,
      },
      clamped,
      world,
    )
  }
  return stepWalkFrame(
    state,
    clamped,
    world,
    open,
    action?.hatchAction ?? null,
    action?.hatchTarget ?? null,
  )
}

/* -------------------------------------------------------- the §8 bullet-3 check */

/** The §8 hatch cap in mm — the step a run may not take (M0-T2's number). */
const HATCH_CAP_MM = SEAM_TOLERANCES.hatchAlignMm

/**
 * The assembled ship's own answer to PRD §8 bullet 3 ("the spine connects every
 * deck"), the half the spec cannot answer:
 *
 *  1. RUN GEOMETRY — every run's ladder really spans its two landings (rungs
 *     strictly inside them, ascending) and its span tiles at the deck pitch
 *     within the M0-T2 hatch cap (a stepped run is what breaks a climb);
 *  2. LANDINGS — the lane at both ends of every run, on both faces, is a legal
 *     standing spot: nothing pushes the walker out of it (M3-T3's hull) and the
 *     deck plate supports them there. This is the half that makes a landing a
 *     landing rather than a ledge;
 *  3. THE CAMERA PATH — the climbing eye keeps NAV_EYE_CLEARANCE_M off the
 *     hull at every height of the climb, sampled on a NAV_EYE_SAMPLE_M grid, so
 *     the climber passes the crawl openings rather than a wall;
 *  4. REACHABILITY — walking the runs as a graph from the crew deck reaches
 *     every deck of the ship (the graph is the machine's own run list, not a
 *     second model of it).
 *
 * Problems are human-readable defect lines; empty means the assembled spine is
 * navigable end to end.
 */
export function navigationProblems(world: NavigationWorld): string[] {
  const problems: string[] = []
  const shape = shapeFor(false)
  const { walker, runs } = world

  for (const run of runs) {
    const where = `the "${run.bandDeckId}" band's ladder (${run.lowerDeckId} → ${run.upperDeckId})`
    if (run.rungYs.length === 0) {
      problems.push(`${where} has no rungs — there is nothing to climb`)
    }
    for (const rungY of run.rungYs) {
      if (!(rungY > run.lowerFloorY && rungY < run.upperFloorY)) {
        problems.push(
          `${where} has a rung at ${rungY.toFixed(3)} m outside its own span ` +
            `(${run.lowerFloorY.toFixed(3)} → ${run.upperFloorY.toFixed(3)} m) — the climb steps or reverses`,
        )
        break
      }
    }
    if (!runTiles(run)) {
      problems.push(
        `${where} spans ${(run.upperFloorY - run.lowerFloorY).toFixed(3)} m, ` +
          `${run.pitchErrorMm.toFixed(1)} mm off the ${DECK_PITCH_M} m deck pitch ` +
          `(cap ${HATCH_CAP_MM} mm) — the run steps between the two decks`,
      )
    }
    for (const landing of [run.lowerFloorY, run.upperFloorY]) {
      const deckId = landing === run.lowerFloorY ? run.lowerDeckId : run.upperDeckId
      for (const side of [1, -1] as LaneSide[]) {
        const lane = climbFeet(run, side, run.axisX, landing)
        const blockers = blockingBoxes(walker.hull, landing, shape)
        const healed = depenetrate(lane[0], lane[2], blockers, shape.radius)
        if (healed.fixes > 0) {
          problems.push(
            `the lane at ${where}'s ${deckId} landing (z ${lane[2].toFixed(3)} m) is ` +
              `inside ${healed.fixes} hull box(es) — a climber arrives inside the kit`,
          )
        }
        const support = supportHeightAt(
          walker.hull,
          lane[0],
          lane[2],
          shape.radius,
          landing + shape.stepHeight,
        )
        if (!(
          support >= landing - FLOOR_EPS_M && support <= landing + shape.stepHeight
        )) {
          problems.push(
            `the lane at ${where}'s ${deckId} landing (z ${lane[2].toFixed(3)} m) is ` +
              `not supported by the deck plate (highest surface ` +
              `${Number.isFinite(support) ? `${support.toFixed(3)} m` : 'none'}, floor ` +
              `${landing.toFixed(3)} m) — a climber would fall on arrival`,
          )
        }
        // The climbing camera's own path: the eye must clear the hull the whole
        // way up, or the player climbs through the crawl opening's frame.
        for (
          let feetY = run.lowerFloorY;
          feetY <= run.upperFloorY + CONTACT_EPS_M;
          feetY += NAV_EYE_SAMPLE_M
        ) {
          const eye: Vec3 = [run.axisX, feetY + EYE_HEIGHT_M, laneZ(run, side)]
          const clearance = eyeClearanceM(walker.hull, eye)
          if (clearance < NAV_EYE_CLEARANCE_M) {
            problems.push(
              `the climbing eye at z ${eye[2].toFixed(3)} m, ${(feetY - run.lowerFloorY).toFixed(2)} m ` +
                `up ${where} is ${(clearance * 1000).toFixed(1)} mm from the hull ` +
                `(cap ${(NAV_EYE_CLEARANCE_M * 1000).toFixed(0)} mm) — the camera would clip`,
            )
            break
          }
        }
      }
    }
  }

  // Reachability: the run graph, walked from the crew deck.
  const decks = walker.decks.map((deck) => deck.deckIndex)
  const start = decks.includes(1) ? 1 : decks[0]
  const reached = new Set<number>()
  const queue: number[] = decks.length === 0 ? [] : [start]
  while (queue.length > 0) {
    const deckIndex = queue.shift() as number
    if (reached.has(deckIndex)) continue
    reached.add(deckIndex)
    for (const run of runs) {
      if (run.lowerDeckIndex === deckIndex && !reached.has(run.upperDeckIndex)) {
        queue.push(run.upperDeckIndex)
      }
      if (run.upperDeckIndex === deckIndex && !reached.has(run.lowerDeckIndex)) {
        queue.push(run.lowerDeckIndex)
      }
    }
  }
  for (const deck of walker.decks) {
    if (!reached.has(deck.deckIndex)) {
      problems.push(
        `deck ${deck.deckIndex} ("${deck.deckId}") is not reachable by climbing ` +
          `from deck ${start} — no run lands on it`,
      )
    }
  }
  if (decks.length === 0) {
    problems.push('the world has no decks — there is no spine run to climb')
  }
  return problems
}

/** The runs above and below a deck, for reports and the HUD's climb hints. */
export function runsAtDeck(
  world: NavigationWorld,
  deckIndex: number,
): { up: LadderRun | undefined; down: LadderRun | undefined } {
  return { up: runAbove(world.runs, deckIndex), down: runBelow(world.runs, deckIndex) }
}
