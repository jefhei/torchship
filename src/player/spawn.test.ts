import { describe, expect, it } from 'vitest'
import { assembleDeck, assembleShip } from '../assembler'
import { LONG_HAUL_SPEC, PATROL_SPEC, SCIENCE_SPEC, atSpine } from '../fixtures'
import { FACING_VEC } from '../types'
import type { Aabb3, ShipSpec, Vec3 } from '../types'
import { CLIMB_LANE_CLEARANCE_M } from './ladder'
import { moveInputToWorldVector } from './move'
import {
  initialNavState,
  navigationWorldOf,
  stepNav,
  type NavigationWorld,
} from './nav'
import {
  CREW_DECK_INDEX,
  SPAWN_DOOR_STANDOFF_M,
  chooseSpawn,
  spawnCandidates,
  spawnLabel,
  spawnPointOf,
  spawnProblems,
  spawnVerdict,
  type SpawnCandidate,
} from './spawn'

const DT = 0.05
const CREW = CREW_DECK_INDEX
/** The canonical ships all put the galley on deck 1 — the deck-plan contract. */
const SHIPS = [PATROL_SPEC, LONG_HAUL_SPEC, SCIENCE_SPEC]
const patrol = assembleShip(PATROL_SPEC)
const patrolWorld = navigationWorldOf(patrol)
const patrolFloor = patrolWorld.walker.decks[CREW].floorY

/** A one-deck spec (the validator rejects it — used to probe the no-crew-deck path). */
const ONE_DECK_SPEC: ShipSpec = {
  classId: 'hound',
  name: 'Testbed',
  registry: 'T-1',
  seed: 7,
  decks: [
    { id: 'head', label: 'Head — bridge', yPosition: 0, modules: [atSpine('head')] },
  ],
}

/** A crate-sized blocker at a point, for failure injections. */
function crateAt(feet: Vec3, half = 0.5, height = 1.2): Aabb3 {
  return {
    min: [feet[0] - half, feet[1], feet[2] - half],
    max: [feet[0] + half, feet[1] + height, feet[2] + half],
  }
}

/** The world with extra hull boxes injected (a kit regression, simulated). */
function withBoxes(world: NavigationWorld, boxes: Aabb3[]): NavigationWorld {
  return {
    ...world,
    walker: { ...world.walker, hull: [...world.walker.hull, ...boxes] },
  }
}

describe('the M3-T6 spawn: crew deck, foot of the spine', () => {
  it('derives exactly two candidates from the crew deck’s own geometry', () => {
    const candidates = spawnCandidates(patrol, patrolWorld)
    expect(candidates.map((candidate) => candidate.kind)).toEqual([
      'doorway',
      'ladder-lane',
    ])
    for (const candidate of candidates) {
      expect(candidate.deckIndex).toBe(CREW)
      expect(candidate.deckId).toBe('crew')
      expect(candidate.feet[1]).toBe(patrolFloor)
    }
  })

  it('takes the doorway candidate from the room’s own spine-door socket', () => {
    const [doorway] = spawnCandidates(patrol, patrolWorld)
    const room = patrol.decks[CREW].modules.find((owner) => !owner.band)
    const door = room?.doors.find((candidate) => candidate.socketId === 'spine-door')
    expect(door).toBeDefined()
    expect(doorway.moduleId).toBe('galley')
    expect(doorway.moduleIndex).toBe(0)
    expect(doorway.socketId).toBe('spine-door')
    // Feet = the socket's own axis, SPAWN_DOOR_STANDOFF_M into the room (the
    // side the door's facing points away from), on the deck floor.
    const outward = FACING_VEC[door!.facing]
    expect(doorway.feet[0]).toBeCloseTo(
      door!.center[0] - outward[0] * SPAWN_DOOR_STANDOFF_M,
      9,
    )
    expect(doorway.feet[2]).toBeCloseTo(
      door!.center[2] - outward[2] * SPAWN_DOOR_STANDOFF_M,
      9,
    )
    expect(doorway.note).toMatch(/inside the "galley" module's "spine-door" doorway/)
  })

  it('takes the ladder-lane candidate from the run rising off the crew deck', () => {
    const lane = spawnCandidates(patrol, patrolWorld)[1]
    const run = patrolWorld.runs.find((candidate) => candidate.lowerDeckIndex === CREW)
    expect(run).toBeDefined()
    expect(lane.moduleId).toBe('spine')
    expect(lane.moduleIndex).toBe(-1)
    expect(lane.socketId).toBe('+z')
    expect(lane.feet[0]).toBe(0)
    // The lane the climb machine itself rests the capsule in (M3-T5).
    expect(lane.feet[2]).toBeCloseTo(run!.axisZ + run!.laneGapM, 9)
    expect(lane.yaw).toBe(0)
  })

  it('chooses the doorway pose, inside the crew room, on every canonical ship', () => {
    for (const spec of SHIPS) {
      const assembly = assembleShip(spec)
      const world = navigationWorldOf(assembly)
      const point = spawnPointOf(assembly, world)
      expect(point).not.toBeNull()
      expect(point!.kind).toBe('doorway')
      expect(point!.deckId).toBe('crew')
      expect(point!.moduleId).toBe('galley')
      expect(point!.feet).toEqual([
        point!.feet[0],
        world.walker.decks[CREW].floorY,
        point!.feet[2],
      ])
      expect(spawnProblems(assembly, world)).toEqual([])
    }
  })

  it('stands the walker on the deck plate, clear of the hull, inside the room', () => {
    const point = spawnPointOf(patrol, patrolWorld)!
    const { verdict } = chooseSpawn(patrol, patrolWorld).trials[0]
    expect(point.verdict.ok).toBe(true)
    expect(verdict.onPlate).toBe(true)
    // The plate carries them exactly — not a cable run 60 mm up.
    expect(point.verdict.supportM).toBe(patrolFloor)
    expect(point.verdict.healFixes).toBe(0)
    expect(point.verdict.containing).toEqual({
      moduleId: 'galley',
      moduleIndex: 0,
      band: false,
    })
    // …and nothing blocking is within the capsule (measured 0.36 m in the galley).
    expect(point.verdict.clearanceM).toBeGreaterThan(0.3)
    expect(point.verdict.problems).toEqual([])
  })

  it('spawns clear of the ladder’s own solid mid-line', () => {
    // The trunk's rung line is solid (M3-T5): a spawn must not sit in it — the
    // doorway pose is inside the room, past the shut leaf's plane.
    const point = spawnPointOf(patrol, patrolWorld)!
    const leaf = patrolWorld.hatches.find(
      (hatch) => hatch.id === 'crew-galley#0-spine-door',
    )
    expect(leaf).toBeDefined()
    expect(point.feet[2]).toBeGreaterThan(leaf!.closedBox.max[2])
    // The lane fallback is off the rung line by the capsule's own clearance.
    const lane = spawnCandidates(patrol, patrolWorld)[1]
    expect(Math.abs(lane.feet[2])).toBeGreaterThan(0.25)
  })

  it('faces the walker into the crew room, away from the shaft', () => {
    const point = spawnPointOf(patrol, patrolWorld)!
    // The camera looks along −Z at yaw 0; the room is on the +Z side of the
    // spine doorway, so the pose that faces into the room looks +Z.
    const forward = moveInputToWorldVector({ forward: 1, strafe: 0 }, point.yaw)
    expect(forward.z).toBeCloseTo(1, 9)
    expect(forward.x).toBeCloseTo(0, 9)

    // Behaviourally: holding W from the spawn walks DEEPER into the galley.
    let state = initialNavState(point.feet)
    let last = stepNav(
      state,
      {
        input: { forward: 1, strafe: 0 },
        sprint: false,
        crouch: false,
        yaw: point.yaw,
        dt: DT,
        interact: false,
      },
      patrolWorld,
    )
    for (let i = 1; i < 20; i++) {
      last = stepNav(
        last.state,
        {
          input: { forward: 1, strafe: 0 },
          sprint: false,
          crouch: false,
          yaw: point.yaw,
          dt: DT,
          interact: false,
        },
        patrolWorld,
      )
    }
    state = last.state
    expect(state.phase).toBe('walk')
    expect(state.walker.feet[2]).toBeGreaterThan(point.feet[2] + 2)
    expect(last.deckId).toBe('crew')
    expect(last.hatchPrompt).toBeNull()
  })

  it('treats the ladder lane as a legal standing pose too, at the rung clearance', () => {
    const lane = spawnCandidates(patrol, patrolWorld)[1]
    const verdict = spawnVerdict(patrol, patrolWorld, lane)
    expect(verdict.ok).toBe(true)
    expect(verdict.onPlate).toBe(true)
    expect(verdict.supportM).toBe(patrolFloor)
    expect(verdict.healFixes).toBe(0)
    expect(verdict.containing).toEqual({
      moduleId: 'spine',
      moduleIndex: -1,
      band: true,
    })
    // The lane is the tightest strip in the ship, by construction: the capsule
    // clears the rung face by CLIMB_LANE_CLEARANCE_M.
    expect(verdict.clearanceM).toBeCloseTo(CLIMB_LANE_CLEARANCE_M, 9)
  })

  it('hands the ladder lane a climb: holding W mounts the run without turning', () => {
    const lane = spawnCandidates(patrol, patrolWorld)[1]
    const command = {
      input: { forward: 1 as const, strafe: 0 as const },
      sprint: false,
      crouch: false,
      yaw: lane.yaw,
      dt: DT,
      interact: false,
    }
    // The spawn state is airborne for its first frames (the rig drops the
    // walker onto the plate), so the mount lands once they are grounded.
    let step = stepNav(initialNavState(lane.feet), command, patrolWorld)
    for (let i = 0; i < 4 && step.phase === 'walk'; i++) {
      step = stepNav(step.state, command, patrolWorld)
    }
    expect(step.phase).toBe('climb')
    expect(step.climbDirection).toBe('up')
    expect(step.deckId).toBe('crew')
    // The grab slid the climber onto the rung line, never across the trunk.
    expect(step.feet[2]).toBeCloseTo(lane.feet[2], 9)
  })

  it('settles the walker at the spawn without healing them out of it', () => {
    const point = spawnPointOf(patrol, patrolWorld)!
    let state = initialNavState(point.feet)
    for (let i = 0; i < 10; i++) {
      state = stepNav(
        state,
        {
          input: { forward: 0, strafe: 0 },
          sprint: false,
          crouch: false,
          yaw: point.yaw,
          dt: DT,
          interact: false,
        },
        patrolWorld,
      ).state
    }
    expect(state.walker.grounded).toBe(true)
    expect(state.walker.feet[1]).toBeCloseTo(patrolFloor, 9)
    expect(state.walker.feet[0]).toBe(point.feet[0])
    expect(state.walker.feet[2]).toBe(point.feet[2])
  })

  it('falls back to the ladder lane when the room’s doorway pose is blocked', () => {
    const doorway = spawnCandidates(patrol, patrolWorld)[0]
    const blocked = withBoxes(patrolWorld, [crateAt(doorway.feet)])
    const choice = chooseSpawn(patrol, blocked)
    expect(choice.point).not.toBeNull()
    expect(choice.point!.kind).toBe('ladder-lane')
    expect(choice.trials[0].verdict.ok).toBe(false)
    expect(choice.trials[0].verdict.problems.join(' | ')).toMatch(/inside 1 hull box/)
    expect(spawnProblems(patrol, blocked)).toEqual([])
  })

  it('reports every candidate when none is legal', () => {
    const [doorway, lane] = spawnCandidates(patrol, patrolWorld)
    const blocked = withBoxes(patrolWorld, [crateAt(doorway.feet), crateAt(lane.feet)])
    const choice = chooseSpawn(patrol, blocked)
    expect(choice.point).toBeNull()
    expect(choice.problems).toHaveLength(2)
    expect(choice.problems[0]).toMatch(/^the doorway spawn at \(/)
    expect(choice.problems[1]).toMatch(/^the ladder-lane spawn at \(/)
    expect(choice.problems.join(' | ')).toMatch(
      /outside every module instance|hull box/,
    )
  })

  it('measures the spawn against the shut hatch leaves (a leaf is not a floor)', () => {
    const leaf = patrolWorld.hatches.find(
      (hatch) => hatch.id === 'crew-galley#0-spine-door',
    )!
    const centre = leaf.closedBox
    const inLeaf: SpawnCandidate = {
      ...spawnCandidates(patrol, patrolWorld)[0],
      kind: 'doorway',
      feet: [
        (centre.min[0] + centre.max[0]) / 2,
        patrolFloor,
        (centre.min[2] + centre.max[2]) / 2,
      ],
      note: 'inside the shut crew hatch',
    }
    const verdict = spawnVerdict(patrol, patrolWorld, inLeaf)
    expect(verdict.ok).toBe(false)
    expect(verdict.healFixes).toBeGreaterThan(0)
    expect(verdict.problems.join(' | ')).toMatch(/inside \d+ hull box/)
  })

  it('has no spawn on a ship with no crew deck', () => {
    const single = assembleShip(ONE_DECK_SPEC, { requireValidSpec: false })
    const world = navigationWorldOf(single)
    expect(spawnCandidates(single, world)).toEqual([])
    expect(spawnPointOf(single, world)).toBeNull()
    expect(spawnProblems(single, world)).toEqual([
      `the assembled ship has no crew deck (index ${CREW_DECK_INDEX}) — there is nowhere to spawn`,
    ])
  })

  it('has no spawn on a crew deck that offers no candidate', () => {
    // A deck carrying only its synthesized shaft band: no room, and no run
    // rising off it (nothing above), so there is no pose to derive.
    const empty = assembleDeck(
      { id: 'crew', label: 'Empty', yPosition: patrolFloor, modules: [] },
      CREW,
    )
    const bare = { ...patrol, decks: [empty] }
    const world = navigationWorldOf(bare)
    const choice = chooseSpawn(bare, world)
    expect(choice.point).toBeNull()
    expect(choice.problems.join(' | ')).toMatch(/offers no spawn candidate/)
  })

  it('names the chosen spawn for the invariant’s report', () => {
    const point = spawnPointOf(patrol, patrolWorld)!
    expect(spawnLabel(point)).toBe(
      '(0.000, -3.200, 1.700) m inside the "galley" module#0 on the crew deck ("crew", deck 1), ' +
        'standing on the deck plate (-3.200 m), 0 heal fixes against the hull',
    )
  })
})
