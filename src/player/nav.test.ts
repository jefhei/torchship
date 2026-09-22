import { describe, expect, it } from 'vitest'
import { assembleShip } from '../assembler'
import { LONG_HAUL_SPEC, PATROL_SPEC, SCIENCE_SPEC, STRESS_SPEC } from '../fixtures'
import { DECK_PITCH_M } from '../types'
import type { Vec3 } from '../types'
import {
  initialNavState,
  navigationProblems,
  navigationWorldOf,
  stepNav,
  type NavCommand,
  type NavState,
  type NavStep,
  type NavigationWorld,
} from './nav'
import { EYE_HEIGHT_M, STEP_HEIGHT_M } from './move'
import { MOUNT_LANE_TOLERANCE_M } from './ladder'
import { defaultSpawnFeet } from './spawn'

const DT = 0.05
const assembly = assembleShip(PATROL_SPEC)
const world = navigationWorldOf(assembly)
const spawn = defaultSpawnFeet(assembly)
if (spawn === null) {
  throw new Error('nav.test: the Patrol ship has no crew-deck spawn')
}
const CREW = 1
const HEAD = 0
const OPS = 2
const CREW_FLOOR_Y = world.walker.decks[CREW].floorY
const CREW_HATCH = 'crew-galley#0-spine-door'
const HEAD_HATCH = 'head-head#0-spine-door'
/** The crawl opening's half width the climbing camera must stay inside (m). */
const OPENING_HALF_M = 0.35
/** Where the walker's capsule comes to rest against the run's ladder (m). */
const LANE_Z = 0.273
/** Where the galley's shut spine hatch stops the walker (m). */
const SHUT_HATCH_STOP_Z = 0.975

function command(overrides: Partial<NavCommand> = {}): NavCommand {
  return {
    input: { forward: 0, strafe: 0 },
    sprint: false,
    crouch: false,
    yaw: 0,
    dt: DT,
    interact: false,
    ...overrides,
  }
}

/** Hold a command for `frames` frames from a state (returns every frame). */
function hold(
  state: NavState,
  cmd: NavCommand,
  frames: number,
): { state: NavState; steps: NavStep[] } {
  const steps: NavStep[] = []
  let current = state
  for (let i = 0; i < frames; i++) {
    const step = stepNav(current, cmd, world)
    steps.push(step)
    current = step.state
  }
  return { state: current, steps }
}

/** Walk forward (the yaw's heading) for `frames` frames. */
const walk = (state: NavState, frames: number, yaw = 0) =>
  hold(state, command({ input: { forward: 1, strafe: 0 }, yaw }), frames)

/** Climb/descend for `frames` frames (W = up, S = down) facing the ladder. */
const climb = (state: NavState, frames: number, forward: 1 | -1 = 1) =>
  hold(state, command({ input: { forward, strafe: 0 } }), frames)

const spawnState = () => initialNavState(spawn)

/** The full journey: galley → open the hatch → cross the trunk → climb to head. */
function climbToHead(): { state: NavState; steps: NavStep[] } {
  const opened = hold(
    walk(spawnState(), 40).state,
    command({ interact: true }),
    1,
  ).state
  return climb(opened, 120, 1)
}

describe('the navigation world (M3-T5)', () => {
  it('derives the runs, the hatches and the walkable world from one assembly', () => {
    expect(world.runs).toHaveLength(4)
    expect(world.hatches).toHaveLength(9)
    expect(world.walker.decks).toHaveLength(5)
    expect(world.walker.ship.name).toBe('Firebrand')
    expect(world.runs[0].upperDeckId).toBe('head')
    expect(world.hatches.map((hatch) => hatch.id)).toContain(CREW_HATCH)
  })

  it('has no navigation problems on the three canonical ships and flags the stress rig', () => {
    for (const spec of [PATROL_SPEC, LONG_HAUL_SPEC, SCIENCE_SPEC]) {
      expect(navigationProblems(navigationWorldOf(assembleShip(spec)))).toEqual([])
    }
    const stress = navigationProblems(
      navigationWorldOf(assembleShip(STRESS_SPEC, { requireValidSpec: false })),
    )
    expect(stress.length).toBeGreaterThan(0)
    expect(stress.join(' | ')).toContain('off the 3.2 m deck pitch')
  })
})

describe('the shut hatch is a door (M3-T5 hatch traversal)', () => {
  it('stops the walk out of the galley at the spine hatch, and offers it', () => {
    const { state, steps } = walk(spawnState(), 40)
    expect(state.phase).toBe('walk')
    expect(state.walker.feet[2]).toBeCloseTo(SHUT_HATCH_STOP_Z, 6)
    expect(state.walker.feet[1]).toBeCloseTo(CREW_FLOOR_Y, 9)
    const last = steps[steps.length - 1]
    expect(last.deckId).toBe('crew')
    expect(last.blocked).toBe(true)
    expect(last.hatchPrompt?.id).toBe(CREW_HATCH)
    expect(last.hatchAction).toBeNull()
    // Every frame of the walk stayed on the room side of the leaf: the leaf's
    // box is a wall like any other.
    for (const step of steps) {
      expect(step.feet[2]).toBeGreaterThanOrEqual(0.725 - 1e-9)
      expect(step.phase).toBe('walk')
    }
  })

  it('opens on E, then the walker crosses the trunk and mounts the ladder', () => {
    const atDoor = walk(spawnState(), 40).state
    const opened = hold(atDoor, command({ interact: true }), 1)
    expect(opened.steps[0].hatchAction).toBe('opened')
    expect(opened.state.open[CREW_HATCH]).toBe(true)
    // A second press closes it again (the walker is standing clear of the leaf).
    const closed = hold(opened.state, command({ interact: true }), 1)
    expect(closed.steps[0].hatchAction).toBe('closed')
    const reopened = hold(closed.state, command({ interact: true }), 1)
    expect(reopened.steps[0].hatchAction).toBe('opened')

    // Through the doorway, across the trunk, onto the ladder.
    const on = walk(reopened.state, 40)
    expect(on.state.phase).toBe('climb')
    // The mount happens where the walker comes to rest against the rungs — no
    // teleport across the trunk: the mount frame's feet are the lane, and the
    // frame before it was the walk stop against the ladder.
    const mountFrame = on.steps.findIndex((step) => step.phase === 'climb')
    const before = on.steps[mountFrame - 1]
    expect(on.steps[mountFrame].feet[2]).toBeCloseTo(LANE_Z, 3)
    // The grab slides the climber onto the rung line by at most the mount
    // tolerance — never the metre across the trunk a mount-at-reach would cost.
    expect(Math.abs(on.steps[mountFrame].feet[2] - before.feet[2])).toBeLessThanOrEqual(
      MOUNT_LANE_TOLERANCE_M + 1e-9,
    )
    // …and it mounted from the crew floor, on the crew deck.
    expect(before.feet[1]).toBeCloseTo(CREW_FLOOR_Y, 9)
    expect(before.deckId).toBe('crew')
  })
})

describe('climbing the spine end to end (M3-T5)', () => {
  it('arrives on the head deck, walking, in the lane', () => {
    const { state, steps } = climbToHead()
    expect(state.phase).toBe('walk')
    expect(state.walker.grounded).toBe(true)
    expect(state.walker.feet[1]).toBe(0)
    // The arrival frame puts the feet exactly in the lane on the head deck…
    const arrival = steps.find((step) => step.arrived)
    expect(arrival).toBeDefined()
    expect(arrival!.feet).toEqual([0, 0, LANE_Z])
    expect(arrival!.deckId).toBe('head')
    expect(arrival!.landed).toBe(true)
    expect(arrival!.phase).toBe('walk')
    // …and the held W then walks the walker into the ladder, where they stop.
    expect(state.walker.feet[2]).toBeGreaterThanOrEqual(LANE_Z - 0.01)
    expect(state.walker.feet[2]).toBeLessThanOrEqual(LANE_Z)
    // The climb crossed exactly one deck boundary, and reported the climb while
    // it was happening.
    const climbing = steps.filter((step) => step.phase === 'climb')
    expect(climbing.length).toBeGreaterThan(40)
    expect(climbing.every((step) => step.climbDirection === 'up')).toBe(true)
    expect(new Set(steps.map((step) => step.deckIndex))).toEqual(new Set([CREW, HEAD]))
  })

  it('keeps the climbing camera inside the crawl opening’s clear column', () => {
    const { steps } = climbToHead()
    const climbing = steps.filter((step) => step.phase === 'climb')
    expect(climbing.length).toBeGreaterThan(0)
    for (const step of climbing) {
      const eye: Vec3 = [step.feet[0], step.feet[1] + step.eyeHeightM, step.feet[2]]
      expect(Math.abs(eye[0])).toBeLessThan(OPENING_HALF_M)
      expect(Math.abs(eye[2])).toBeLessThan(OPENING_HALF_M)
      expect(step.eyeHeightM).toBe(EYE_HEIGHT_M)
    }
  })

  it('opens the hatch on the deck it arrived at and walks into the bridge', () => {
    const arrived = climbToHead().state
    // Facing the ladder, the head deck's hatch is right behind the climber: the
    // facing test is waived at that distance, so E works from the arrival pose.
    const opened = hold(arrived, command({ interact: true }), 1)
    expect(opened.steps[0].hatchAction).toBe('opened')
    expect(opened.steps[0].hatchPrompt?.id).toBe(HEAD_HATCH)
    expect(opened.state.open[HEAD_HATCH]).toBe(true)

    // Before opening, walking off the line into the bridge was blocked; now the
    // walker turns around and steps out onto the head deck.
    const blocked = hold(
      arrived,
      command({ input: { forward: 1, strafe: 0 }, yaw: Math.PI }),
      20,
    )
    expect(blocked.state.walker.feet[2]).toBeCloseTo(0.675 - 0.25, 6)
    expect(blocked.state.phase).toBe('walk')
    const out = hold(
      opened.state,
      command({ input: { forward: 1, strafe: 0 }, yaw: Math.PI }),
      20,
    )
    expect(out.state.walker.feet[2]).toBeGreaterThan(1.0)
    // On the bridge's plate: its cable runs are 0.06 m of step-up, walked over.
    expect(out.state.walker.feet[1]).toBeGreaterThanOrEqual(0)
    expect(out.state.walker.feet[1]).toBeLessThanOrEqual(STEP_HEIGHT_M)
    expect(out.steps[out.steps.length - 1].deckId).toBe('head')
  })

  it('rides the runs down the whole ship, one deck at a time', () => {
    const arrived = climbToHead().state
    // S from a landing takes the run that descends from it: crew → ops →
    // engineering → aft, each arrival a real floor of the ship.
    const { state, steps } = climb(arrived, 600, -1)
    const arrivals = steps.filter((step) => step.arrived).map((step) => step.deckId)
    expect(arrivals).toEqual(['crew', 'ops', 'engineering', 'aft'])
    expect(state.phase).toBe('walk')
    expect(state.walker.grounded).toBe(true)
    expect(state.walker.feet[1]).toBeCloseTo(world.walker.decks[4].floorY, 9)
    expect(CREW_FLOOR_Y).toBeCloseTo(-DECK_PITCH_M, 9)
    expect(state.walker.feet[1]).toBeCloseTo(-4 * DECK_PITCH_M, 9)
  })
})

describe('hatches and the walker together (M3-T5)', () => {
  it('refuses to close a hatch on the walker standing in its doorway', () => {
    // Walked to the lane with the hatch open, then stepped back into the
    // doorway: the leaf cannot close through them.
    const opened = hold(
      walk(spawnState(), 40).state,
      command({ interact: true }),
      1,
    ).state
    const inDoorway: NavState = {
      ...opened,
      walker: { feet: [0, CREW_FLOOR_Y, 0.7], verticalSpeedMps: 0, grounded: true },
    }
    const refused = hold(inDoorway, command({ interact: true }), 1)
    expect(refused.steps[0].hatchAction).toBe('blocked')
    expect(refused.state.open[CREW_HATCH]).toBe(true)
    // Standing clear of the leaf, the same press closes it.
    const clear: NavState = {
      ...opened,
      walker: { feet: [0, CREW_FLOOR_Y, 1.3], verticalSpeedMps: 0, grounded: true },
    }
    const shut = hold(clear, command({ interact: true }), 1)
    expect(shut.steps[0].hatchAction).toBe('closed')
    expect(shut.state.open[CREW_HATCH]).toBe(false)
  })

  it('does not make a hatch a floor: a fall still lands on the deck plate', () => {
    const dropped = initialNavState([spawn[0], CREW_FLOOR_Y + 2, spawn[2]])
    const { state, steps } = hold(dropped, command(), 60)
    const landed = steps.find((step) => step.landed)
    expect(landed).toBeDefined()
    expect(state.walker.grounded).toBe(true)
    expect(state.walker.feet[1]).toBeGreaterThanOrEqual(CREW_FLOOR_Y - 1e-9)
    expect(state.walker.feet[1]).toBeLessThanOrEqual(CREW_FLOOR_Y + STEP_HEIGHT_M)
    expect(landed!.deckId).toBe('crew')
  })

  it('ignores the interact key while climbing (the ladder owns the frame)', () => {
    const opened = hold(
      walk(spawnState(), 40).state,
      command({ interact: true }),
      1,
    ).state
    const onLadder = climb(opened, 40, 1).state
    expect(onLadder.phase).toBe('climb')
    const pressed = hold(onLadder, command({ interact: true }), 1)
    expect(pressed.steps[0].hatchPrompt).toBeNull()
    expect(pressed.steps[0].hatchAction).toBeNull()
    // …and the hatch it is standing beside is untouched.
    expect(pressed.state.open[CREW_HATCH]).toBe(true)
    expect(pressed.state.open[HEAD_HATCH]).toBeUndefined()
  })

  it('is deterministic: the same journey gives the same state', () => {
    const a = climbToHeadLike()
    const b = climbToHeadLike()
    expect(a).toEqual(b)
  })

  function climbToHeadLike(): NavState {
    const opened = hold(
      walk(spawnState(), 40).state,
      command({ interact: true }),
      1,
    ).state
    return climb(opened, 120, 1).state
  }
})

describe('a walker and a climber in the same world (M3-T5 boundaries)', () => {
  it('never lets a walk frame put the walker inside a shut leaf', () => {
    // Straight at the shut hatch from every yaw: the leaf stops the capsule one
    // radius short, whatever direction the walker approaches from.
    for (let i = 0; i < 8; i++) {
      const yaw = (i / 8) * 2 * Math.PI
      const { steps } = walk(spawnState(), 60, yaw)
      for (const step of steps) {
        // The galley's shut spine leaf spans |x| ≤ 0.44, z ∈ [0.675, 0.725].
        const insideLeaf =
          Math.abs(step.feet[0]) < 0.44 - 0.25 + 1e-9 &&
          step.feet[2] > 0.675 &&
          step.feet[2] < 0.725
        expect(insideLeaf).toBe(false)
      }
    }
  })

  it('reports the deck and the mode for a HUD, frame by frame', () => {
    const { steps } = climbToHead()
    const climbing = steps.filter((step) => step.phase === 'climb')
    expect(climbing[0].deckId).toBe('crew')
    // The climber's deck is the storey they are inside: the last climb frame
    // before arrival is still the crew deck's storey.
    expect(climbing[climbing.length - 1].deckId).toBe('crew')
    expect(climbing[10].rungIndex).not.toBeNull()
    const last = steps[steps.length - 1]
    expect(last.deckLabel).toBe('Head — bridge')
    expect(last.airborne).toBe(false)
    expect(last.arrested).toBe(false)
  })
})

/** A world with no runs or hatches: the machine must still walk (M3-T4 intact). */
const bareWorld: NavigationWorld = { walker: world.walker, runs: [], hatches: [] }

describe('the machine without ladders or hatches (M3-T4 parity)', () => {
  it('walks exactly like the M3-T4 rig did', () => {
    const bare = initialNavState(spawn)
    const { state } = hold(bare, command({ input: { forward: 1, strafe: 0 } }), 1)
    expect(state.phase).toBe('walk')
    expect(state.climb).toBeNull()
    // One frame of W: the ported walk speed, along the deck plate.
    const moved = Math.abs(state.walker.feet[2] - spawn[2])
    expect(moved).toBeCloseTo(2.2 * DT, 6)
    // Mounting is offered by the runs, so there is nothing to mount here.
    const long = hold(bare, command({ input: { forward: 1, strafe: 0 } }), 60)
    expect(long.state.phase).toBe('walk')
    // …and a ship whose kit carries no ladder is flagged unnavigable: every deck
    // but the crew deck is unreachable by climbing.
    const problems = navigationProblems(bareWorld)
    expect(problems).toHaveLength(4)
    expect(
      problems.every((problem) => problem.includes('not reachable by climbing')),
    ).toBe(true)
  })

  it('knows both runs of a deck, for the HUD’s climb hints', () => {
    expect(world.runs.some((run) => run.lowerDeckIndex === CREW)).toBe(true)
    expect(world.runs.some((run) => run.upperDeckIndex === CREW)).toBe(true)
    expect(world.runs.some((run) => run.lowerDeckIndex === OPS)).toBe(true)
  })
})
