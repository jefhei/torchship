import { describe, expect, it } from 'vitest'
import { assembleShip } from '../assembler'
import { LONG_HAUL_SPEC, PATROL_SPEC, SCIENCE_SPEC, STRESS_SPEC } from '../fixtures'
import { DECK_PITCH_M } from '../types'
import type { Vec3 } from '../types'
import {
  CLIMB_LANE_CLEARANCE_M,
  CLIMB_SIDE_SPEED_M_S,
  CLIMB_SPEED_M_S,
  CLIMB_SPRINT_SPEED_M_S,
  MOUNT_FACING_DOT,
  MOUNT_LANE_TOLERANCE_M,
  climbFeet,
  eyeClearanceM,
  ladderGeometryOf,
  ladderRunsOf,
  laneZ,
  mountClimb,
  mountRun,
  rungNearest,
  runAbove,
  runBelow,
  runTiles,
  stepClimb,
  type ClimbCommand,
  type LadderRun,
} from './ladder'
import { PLAYER_RADIUS_M, STEP_HEIGHT_M } from './move'
import { blockingBoxes, shapeFor, supportHeightAt } from './hull'
import { depenetrate } from './collide'
import { walkerWorldOf } from './walker'

const DT = 0.05
const ship = assembleShip(PATROL_SPEC)
const world = walkerWorldOf(ship)
const runs = ladderRunsOf(ship)
const CREW = 1
const HEAD = 0
const ops = 2
const crewFloorY = world.decks[CREW].floorY

/** The lane feet on a deck: the spot a climber stands to work the ladder. */
function laneFeet(run: LadderRun, side: 1 | -1, floorY: number): Vec3 {
  return climbFeet(run, side, run.axisX, floorY)
}

function command(overrides: Partial<ClimbCommand> = {}): ClimbCommand {
  return {
    input: { forward: 0, strafe: 0 },
    sprint: false,
    dt: DT,
    ...overrides,
  }
}

/** Hold a climb command for `frames` frames; returns every step. */
function climb(
  state: ReturnType<typeof mountClimb>,
  cmd: ClimbCommand,
  frames: number,
): ReturnType<typeof stepClimb>[] {
  const steps: ReturnType<typeof stepClimb>[] = []
  let current = state
  for (let i = 0; i < frames; i++) {
    const step = stepClimb(current, cmd, runs)
    steps.push(step)
    current = step.state
  }
  return steps
}

describe('the ladder a spine band carries (M3-T5 derivation)', () => {
  it('measures the band’s own rungs, rails and plane', () => {
    for (const deck of ship.decks) {
      const ladder = ladderGeometryOf(deck.band)
      expect(ladder).toBeDefined()
      expect(ladder!.planeX).toBe(0)
      expect(ladder!.planeZ).toBe(0)
      // A rung is a 0.036 m bar across the 0.45 m ladder (M2-T6), the rails
      // reach 0.225 m off the line, and the run is ten rungs on a 0.3 m pitch.
      expect(ladder!.rungHalfDepthM).toBeCloseTo(0.018, 9)
      expect(ladder!.halfSpanM).toBeCloseTo(0.225, 9)
      expect(ladder!.rungYs).toHaveLength(10)
      expect(ladder!.rungYs[0] - deck.floorY).toBeCloseTo(0.3, 9)
      expect(ladder!.rungYs[9] - deck.floorY).toBeCloseTo(3.0, 9)
      for (let i = 1; i < ladder!.rungYs.length; i++) {
        expect(ladder!.rungYs[i] - ladder!.rungYs[i - 1]).toBeCloseTo(0.3, 9)
      }
    }
    // The band's ladder is the same shape on every deck (its rungs are world
    // heights, so only the band-local offsets are comparable).
    const local = (deck: (typeof ship.decks)[number]) => {
      const ladder = ladderGeometryOf(deck.band)!
      return {
        planeX: ladder.planeX,
        planeZ: ladder.planeZ,
        rungHalfDepthM: ladder.rungHalfDepthM,
        halfSpanM: ladder.halfSpanM,
        rungYs: ladder.rungYs.map((y) => y - deck.floorY),
      }
    }
    expect(local(ship.decks[0]).planeX).toBe(local(ship.decks[4]).planeX)
    expect(local(ship.decks[0]).halfSpanM).toBe(local(ship.decks[4]).halfSpanM)
    expect(local(ship.decks[0]).rungHalfDepthM).toBe(
      local(ship.decks[4]).rungHalfDepthM,
    )
    local(ship.decks[0]).rungYs.forEach((y, index) => {
      // Band-local rung heights agree to float precision across 12.8 m of ship.
      expect(y).toBeCloseTo(local(ship.decks[4]).rungYs[index], 9)
    })
  })

  it('is derived from geometry, not from the kit: a band with no rungs has none', () => {
    const stripped = {
      ...ship.decks[0].band,
      parts: ship.decks[0].band.parts.filter(
        (placed) => placed.part.kind !== 'cylinder',
      ),
    }
    expect(ladderGeometryOf(stripped)).toBeUndefined()
  })
})

describe('the climbable runs (M3-T5)', () => {
  it('gives Patrol one run per band that has a deck above it', () => {
    expect(runs).toHaveLength(ship.decks.length - 1)
    expect(
      runs.map((run) => [run.bandDeckIndex, run.lowerDeckIndex, run.upperDeckIndex]),
    ).toEqual([
      [1, 1, 0],
      [2, 2, 1],
      [3, 3, 2],
      [4, 4, 3],
    ])
    expect(runs.map((run) => run.lowerDeckId)).toEqual([
      'crew',
      'ops',
      'engineering',
      'aft',
    ])
    expect(runs.map((run) => run.upperDeckId)).toEqual([
      'head',
      'crew',
      'ops',
      'engineering',
    ])
    // The head deck's band has a ladder and nothing to climb to: no run.
    expect(runs.every((run) => run.bandDeckIndex !== HEAD)).toBe(true)
  })

  it('measures the lane, the rung pitch and the tiling off the ship', () => {
    for (const run of runs) {
      expect(run.axisX).toBe(0)
      expect(run.axisZ).toBe(0)
      // The lane is one capsule radius clear of the rungs, plus a hair of slack.
      expect(run.laneGapM).toBeCloseTo(
        0.018 + PLAYER_RADIUS_M + CLIMB_LANE_CLEARANCE_M,
        9,
      )
      expect(run.rungYs).toHaveLength(10)
      // Rest snaps onto a rung from anywhere: the snap radius is half a pitch.
      expect(run.snapM).toBeCloseTo(0.15, 9)
      expect(run.upperFloorY - run.lowerFloorY).toBeCloseTo(DECK_PITCH_M, 9)
      expect(run.pitchErrorMm).toBe(0)
      expect(runTiles(run)).toBe(true)
    }
  })

  it('runs every canonical ship end to end, and flags the stress rig’s stepped run', () => {
    for (const spec of [PATROL_SPEC, LONG_HAUL_SPEC, SCIENCE_SPEC]) {
      const runsOfShip = ladderRunsOf(assembleShip(spec))
      expect(runsOfShip).toHaveLength(spec.decks.length - 1)
      expect(runsOfShip.every(runTiles)).toBe(true)
      // Every deck is a landing of some run (bar a one-deck ship).
      for (const deck of spec.decks.keys()) {
        const isLanding = runsOfShip.some(
          (run) => run.lowerDeckIndex === deck || run.upperDeckIndex === deck,
        )
        const isTop = deck === 0
        if (spec.decks.length > 1) {
          expect(isLanding || isTop).toBe(true)
        }
      }
    }
    const stress = ladderRunsOf(assembleShip(STRESS_SPEC, { requireValidSpec: false }))
    expect(stress.every(runTiles)).toBe(false)
    expect(Math.max(...stress.map((run) => run.pitchErrorMm))).toBeGreaterThan(5)
  })

  it('looks runs up by the deck they start from and the deck they arrive on', () => {
    expect(runAbove(runs, CREW)!.upperDeckIndex).toBe(HEAD)
    expect(runBelow(runs, CREW)!.lowerDeckIndex).toBe(ops)
    expect(runAbove(runs, HEAD)).toBeUndefined()
    expect(runBelow(runs, ship.decks[ship.decks.length - 1].deckIndex)).toBeUndefined()
  })
})

describe('mounting the ladder (M3-T5 tuning set)', () => {
  const crewRun = runAbove(runs, CREW)!
  const lane = laneFeet(crewRun, 1, crewFloorY)

  it('mounts from the lane, facing the ladder, climbing up on W', () => {
    const mount = mountRun(runs, CREW, true, lane, 0, { forward: 1, strafe: 0 })
    expect(mount).toBeDefined()
    expect(mount!.run.upperDeckId).toBe('head')
    expect(mount!.side).toBe(1)
    const state = mountClimb(mount!.run, mount!.runIndex, mount!.side, lane)
    expect(state.feet).toEqual([0, crewFloorY, crewRun.laneGapM])
  })

  it('takes the descending run on S — you back onto the ladder from a landing', () => {
    const mount = mountRun(runs, CREW, true, lane, 0, { forward: -1, strafe: 0 })
    expect(mount).toBeDefined()
    expect(mount!.run.lowerDeckId).toBe('ops')
    expect(mount!.run.upperDeckId).toBe('crew')
  })

  it('climbs from either face of the ladder', () => {
    const fromAft = laneFeet(crewRun, -1, crewFloorY)
    const mount = mountRun(runs, CREW, true, fromAft, Math.PI, {
      forward: 1,
      strafe: 0,
    })
    expect(mount).toBeDefined()
    expect(mount!.side).toBe(-1)
  })

  it('never mounts without a climb key, while falling, or out of reach', () => {
    expect(
      mountRun(runs, CREW, true, lane, 0, { forward: 0, strafe: 0 }),
    ).toBeUndefined()
    // Walking, not grabbing: the walker is only grounded when the frame says so.
    expect(
      mountRun(runs, CREW, false, lane, 0, { forward: 1, strafe: 0 }),
    ).toBeUndefined()
    // Facing away from the ladder (the camera looks +z), and beyond the trunk.
    expect(
      mountRun(runs, CREW, true, lane, Math.PI, { forward: 1, strafe: 0 }),
    ).toBeUndefined()
    // Mid-trunk, still walking toward the ladder: no mount yet (the mount never
    // teleports a walker crossing the shaft onto the rung line).
    expect(
      mountRun(
        runs,
        CREW,
        true,
        [0, crewFloorY, crewRun.laneGapM + MOUNT_LANE_TOLERANCE_M + 0.01],
        0,
        {
          forward: 1,
          strafe: 0,
        },
      ),
    ).toBeUndefined()
    // Off the ladder laterally (a bay away in the trunk).
    expect(
      mountRun(
        runs,
        CREW,
        true,
        [crewRun.laneHalfSpanM + 0.2, crewFloorY, lane[2]],
        0,
        {
          forward: 1,
          strafe: 0,
        },
      ),
    ).toBeUndefined()
    // …while at the lane (where walking into the ladder leaves you) it takes.
    expect(
      mountRun(runs, CREW, true, [0, crewFloorY, crewRun.laneGapM], 0, {
        forward: 1,
        strafe: 0,
      }),
    ).toBeDefined()
  })

  it('offers no climb at the ends of the run: the head deck has nothing above', () => {
    const headRun = runBelow(runs, HEAD)!
    const headLane = laneFeet(headRun, 1, world.decks[HEAD].floorY)
    expect(
      mountRun(runs, HEAD, true, headLane, 0, { forward: 1, strafe: 0 }),
    ).toBeUndefined()
    const down = mountRun(runs, HEAD, true, headLane, 0, { forward: -1, strafe: 0 })
    expect(down).toBeDefined()
    expect(down!.run.lowerDeckId).toBe('crew')

    const deepest = ship.decks[ship.decks.length - 1].deckIndex
    const deepestRun = runAbove(runs, deepest)!
    const deepestLane = laneFeet(deepestRun, 1, world.decks[deepest].floorY)
    expect(
      mountRun(runs, deepest, true, deepestLane, 0, { forward: -1, strafe: 0 }),
    ).toBeUndefined()
    expect(
      mountRun(runs, deepest, true, deepestLane, 0, { forward: 1, strafe: 0 }),
    ).toBeDefined()
  })

  it('faces the ladder squarely enough (the mount dot is the documented one)', () => {
    const yawOk = Math.acos(MOUNT_FACING_DOT) - 0.01
    const yawNo = Math.acos(MOUNT_FACING_DOT) + 0.05
    expect(
      mountRun(runs, CREW, true, lane, yawOk, { forward: 1, strafe: 0 }),
    ).toBeDefined()
    expect(
      mountRun(runs, CREW, true, lane, yawNo, { forward: 1, strafe: 0 }),
    ).toBeUndefined()
  })
})

describe('climbing (M3-T5 state machine)', () => {
  const crewRun = runAbove(runs, CREW)!
  const lane = laneFeet(crewRun, 1, crewFloorY)
  const mounted = mountClimb(crewRun, runs.indexOf(crewRun), 1, lane)

  it('climbs up the rung line at the tuned speed, in the lane', () => {
    const [first] = climb(mounted, command({ input: { forward: 1, strafe: 0 } }), 1)
    expect(first.climbedM).toBeCloseTo(CLIMB_SPEED_M_S * DT, 9)
    expect(first.state.feet[1]).toBeCloseTo(crewFloorY + CLIMB_SPEED_M_S * DT, 9)
    expect(first.state.feet[2]).toBeCloseTo(crewRun.laneGapM, 9)
    expect(first.state.feet[0]).toBe(0)
    expect(first.direction).toBe('up')
    expect(first.arrived).toBe(false)
  })

  it('sprints faster while Shift is held', () => {
    const [walked] = climb(mounted, command({ input: { forward: 1, strafe: 0 } }), 1)
    const [sprinted] = climb(
      mounted,
      command({ input: { forward: 1, strafe: 0 }, sprint: true }),
      1,
    )
    expect(sprinted.climbedM).toBeCloseTo(CLIMB_SPRINT_SPEED_M_S * DT, 9)
    expect(sprinted.climbedM).toBeGreaterThan(walked.climbedM)
    expect(CLIMB_SPRINT_SPEED_M_S).toBeLessThan(2.2) // still slower than a walk
  })

  it('slides along the ladder on A/D, inside its own width', () => {
    const [right] = climb(mounted, command({ input: { forward: 0, strafe: 1 } }), 1)
    expect(right.state.feet[0]).toBeCloseTo(CLIMB_SIDE_SPEED_M_S * DT, 9)
    const far = climb(mounted, command({ input: { forward: 0, strafe: 1 } }), 20)
    expect(far[far.length - 1].state.feet[0]).toBeCloseTo(crewRun.laneHalfSpanM, 9)
    const left = climb(mounted, command({ input: { forward: 0, strafe: -1 } }), 20)
    expect(left[left.length - 1].state.feet[0]).toBeCloseTo(-crewRun.laneHalfSpanM, 9)
  })

  it('rests on a rung when the climb keys are released', () => {
    const held = climb(mounted, command({ input: { forward: 1, strafe: 0 } }), 5)
    const resting = stepClimb(held[held.length - 1].state, command(), runs)
    expect(resting.direction).toBeNull()
    const rungs = crewRun.rungYs.filter((y) => y > crewFloorY)
    expect(rungs).toContain(resting.state.feet[1])
    expect(resting.rungIndex).not.toBeNull()
    expect(resting.state.feet[2]).toBeCloseTo(crewRun.laneGapM, 9)
  })

  it('arrives on the deck above after climbing the whole storey', () => {
    const steps = climb(mounted, command({ input: { forward: 1, strafe: 0 } }), 80)
    const arrival = steps.find((step) => step.arrived)
    expect(arrival).toBeDefined()
    expect(arrival!.arrivalDeckIndex).toBe(HEAD)
    expect(arrival!.arrivalDeckId).toBe('head')
    expect(arrival!.arrivalFeet).toEqual([0, 0, crewRun.laneGapM])
    expect(arrival!.state.feet[1]).toBe(world.decks[HEAD].floorY)
    // The climb takes the storey's height at the tuned speed (to one frame).
    const frames = steps.findIndex((step) => step.arrived) + 1
    const expected = DECK_PITCH_M / (CLIMB_SPEED_M_S * DT)
    expect(Math.abs(frames - expected)).toBeLessThanOrEqual(1)
  })

  it('arrives on the deck below after descending from a landing', () => {
    const downRun = runBelow(runs, CREW)!
    const topLane = laneFeet(downRun, 1, crewFloorY)
    const climber = mountClimb(downRun, runs.indexOf(downRun), 1, topLane)
    const steps = climb(climber, command({ input: { forward: -1, strafe: 0 } }), 80)
    const arrival = steps.find((step) => step.arrived)
    expect(arrival).toBeDefined()
    expect(arrival!.arrivalDeckId).toBe('ops')
    expect(arrival!.arrivalFeet).toEqual([0, world.decks[ops].floorY, downRun.laneGapM])
    expect(steps.at(-1)!.state.feet[1]).toBe(world.decks[ops].floorY)
  })

  it('never climbs past a landing, however long the key is held', () => {
    const up = climb(mounted, command({ input: { forward: 1, strafe: 0 } }), 400)
    expect(Math.max(...up.map((step) => step.state.feet[1]))).toBeLessThanOrEqual(
      world.decks[HEAD].floorY,
    )
    expect(up.filter((step) => step.arrived)).toHaveLength(1)
    const down = climb(mounted, command({ input: { forward: -1, strafe: 0 } }), 400)
    expect(Math.min(...down.map((step) => step.state.feet[1]))).toBeGreaterThanOrEqual(
      world.decks[ops].floorY,
    )
    // Mounted at the crew floor, the descending run's TOP landing is the crew
    // deck itself: pressing S into the run below only arrives if it descends.
    expect(down.filter((step) => step.arrived)).toHaveLength(0)
  })

  it('does not move on a stalled frame, and clamps an oversized one', () => {
    const stalled = stepClimb(
      mounted,
      command({ input: { forward: 1, strafe: 0 }, dt: 0 }),
      runs,
    )
    expect(stalled.state.feet).toEqual(mounted.feet)
    expect(stalled.climbedM).toBe(0)
    const huge = stepClimb(
      mounted,
      command({ input: { forward: 1, strafe: 0 }, dt: 30 }),
      runs,
    )
    expect(huge.climbedM).toBeCloseTo(CLIMB_SPEED_M_S * 0.05, 9)
  })

  it('is deterministic: the same climb gives the same climber', () => {
    const a = climb(mounted, command({ input: { forward: 1, strafe: 1 } }), 20)
    const b = climb(mounted, command({ input: { forward: 1, strafe: 1 } }), 20)
    expect(a.map((step) => step.state)).toEqual(b.map((step) => step.state))
  })
})

describe('the lane and the ladder line are physically real (measured on Patrol)', () => {
  it('stands the climber clear of the hull and supported at every landing', () => {
    for (const run of runs) {
      for (const floorY of [run.lowerFloorY, run.upperFloorY]) {
        for (const side of [1, -1] as const) {
          const feet = laneFeet(run, side, floorY)
          expect(feet[2]).toBeCloseTo(
            side * (0.018 + PLAYER_RADIUS_M + CLIMB_LANE_CLEARANCE_M),
            9,
          )
          const blockers = blockingBoxes(world.hull, floorY, shapeFor(false))
          expect(depenetrate(feet[0], feet[2], blockers, PLAYER_RADIUS_M).fixes).toBe(0)
          const support = supportHeightAt(
            world.hull,
            feet[0],
            feet[2],
            PLAYER_RADIUS_M,
            floorY + STEP_HEIGHT_M,
          )
          expect(support).toBeCloseTo(floorY, 9)
        }
      }
    }
  })

  it('keeps the climbing camera inside the crawl opening’s clear column', () => {
    // The eye travels the opening (0.7 m square, M2-T6) rather than a wall: it
    // stays inside the opening's half width at every height of the climb.
    for (const run of runs) {
      for (const side of [1, -1] as const) {
        for (let feetY = run.lowerFloorY; feetY <= run.upperFloorY; feetY += 0.1) {
          const eye: Vec3 = [0, feetY + 1.6, laneZ(run, side)]
          expect(Math.abs(eye[0])).toBeLessThan(0.35)
          expect(Math.abs(eye[2])).toBeLessThan(0.35)
          expect(eyeClearanceM(world.hull, eye)).toBeGreaterThan(0.05)
        }
      }
    }
  })

  it('names the rung under the climber, and the lane for a side', () => {
    const run = runs[0]
    expect(rungNearest(run, run.lowerFloorY + 0.31)).toEqual({
      index: 0,
      y: run.rungYs[0],
    })
    expect(rungNearest(run, run.rungYs[4] + 0.01)!.index).toBe(4)
    expect(laneZ(run, 1)).toBeCloseTo(run.laneGapM, 9)
    expect(laneZ(run, -1)).toBeCloseTo(-run.laneGapM, 9)
  })
})
