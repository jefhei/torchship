import { describe, expect, it } from 'vitest'
import type { Vec3 } from '../types'
import { assembleShip } from '../assembler'
import { PATROL_SPEC, SHIP_FIXTURES, expectValidFixtures } from '../fixtures'
import { navigationWorldOf } from '../player/nav'
import { coffeeRunScript, planCoffeeRun } from './path'
import { recordWalk } from './record'
import { coffeeRunProblems, recordCoffeeRun, scriptDeck, walkProblems } from './checks'
import type { WalkRecording, WalkScript } from './types'

const patrol = assembleShip(PATROL_SPEC)
const world = navigationWorldOf(patrol)
const script = coffeeRunScript(patrol, world)!
const recording = recordWalk(patrol, world, script)

/** The pristine Patrol recording with one frame replaced. */
function withFrame(
  source: WalkRecording,
  index: number,
  patch: Partial<WalkRecording['frames'][number]>,
): WalkRecording {
  return {
    ...source,
    frames: source.frames.map((frame, at) =>
      at === index ? { ...frame, ...patch } : frame,
    ),
  }
}

describe('M5-T2 coffee-run gate', () => {
  it('is clean on every real ship', () => {
    for (const fixture of expectValidFixtures()) {
      const ship = assembleShip(fixture.spec, { requireValidSpec: false })
      expect(coffeeRunProblems(ship, navigationWorldOf(ship))).toEqual([])
    }
  })

  it('reports the stress rig, which has no coffee run to make', () => {
    const stress = SHIP_FIXTURES.find((fixture) => fixture.id === 'stress')!
    const ship = assembleShip(stress.spec, { requireValidSpec: false })
    const problems = coffeeRunProblems(ship, navigationWorldOf(ship))
    expect(problems).toHaveLength(1)
    expect(problems[0]).toContain('seats no galley')
  })

  it('plans and records a coffee run in one call', () => {
    const run = recordCoffeeRun(patrol, world)
    expect(run).not.toBeNull()
    expect(run!.script).toEqual(script)
    expect(run!.recording.complete).toBe(true)
    const stress = SHIP_FIXTURES.find((fixture) => fixture.id === 'stress')!
    const stressShip = assembleShip(stress.spec, { requireValidSpec: false })
    expect(recordCoffeeRun(stressShip, navigationWorldOf(stressShip))).toBeNull()
  })

  it('passes the clean recording', () => {
    expect(walkProblems(recording)).toEqual([])
  })
})

describe('M5-T2 walk-defect detection', () => {
  it('names a waypoint the walk never reached', () => {
    const unreached: WalkRecording = {
      ...recording,
      waypoints: recording.waypoints.map((waypoint) =>
        waypoint.id === 'coffee-station'
          ? { ...waypoint, reached: false, closestM: 1.234 }
          : waypoint,
      ),
    }
    const problems = walkProblems(unreached)
    expect(
      problems.some((line) =>
        line.includes('never reached "coffee-station" (The coffee station)'),
      ),
    ).toBe(true)
    expect(problems.some((line) => line.includes('1.234 m'))).toBe(true)
  })

  it('catches a clip, a fall out of the ship and a non-finite frame', () => {
    expect(
      walkProblems(withFrame(recording, 5, { depenetrations: 2 })).some((line) =>
        line.includes('clipped through kit at frame 5'),
      ),
    ).toBe(true)
    expect(
      walkProblems(withFrame(recording, 7, { arrested: true })).some((line) =>
        line.includes('fell out of the ship at frame 7'),
      ),
    ).toBe(true)
    expect(
      walkProblems(withFrame(recording, 3, { feet: [NaN, -3.2, 1.7] as Vec3 })).some(
        (line) => line.includes('non-finite at frame 3'),
      ),
    ).toBe(true)
  })

  it('catches an unplanned climb and a stray deck', () => {
    const climbed: WalkRecording = {
      ...recording,
      events: [
        ...recording.events,
        {
          frame: 4,
          kind: 'climb',
          detail:
            'the walker mounted the ladder at frame 4 — a walking script must not climb',
        },
      ],
    }
    expect(
      walkProblems(climbed).some((line) => line.includes('mounted the ladder')),
    ).toBe(true)
    const stray: WalkRecording = { ...recording, decksVisited: [1, 2] }
    expect(
      walkProblems(stray).some((line) => line.includes('left its deck 1 for deck 2')),
    ).toBe(true)
  })

  it('reports an unreachable or stalled walk, and a silent early stop', () => {
    const unreachable: WalkRecording = {
      ...recording,
      events: [
        ...recording.events,
        {
          frame: 9,
          kind: 'unreachable',
          detail: 'cannot route to "coffee-station": no walkable route exists',
        },
      ],
    }
    expect(
      walkProblems(unreachable).some((line) => line.includes('could not finish')),
    ).toBe(true)

    const silentStop: WalkRecording = {
      ...recording,
      truncated: true,
      events: recording.events.filter((event) => event.kind === 'waypoint'),
    }
    expect(
      walkProblems(silentStop).some((line) => line.includes('stopped early')),
    ).toBe(true)
  })

  it('reads a script’s deck, or none when it spans decks', () => {
    expect(scriptDeck(script)).toBe(1)
    const multi: WalkScript = {
      ship: 'x',
      kind: 'multi',
      waypoints: [
        {
          id: 'a',
          kind: 'spawn',
          point: [0, -3.2, 0] as Vec3,
          deckIndex: 1,
          label: 'a',
          note: 'n',
        },
        {
          id: 'b',
          kind: 'landmark',
          point: [0, -6.4, 0] as Vec3,
          deckIndex: 2,
          label: 'b',
          note: 'n',
        },
      ],
    }
    expect(scriptDeck(multi)).toBeNull()
    expect(scriptDeck({ ship: 'x', kind: 'empty', waypoints: [] })).toBeNull()
  })

  it('plans the coffee run for the ship the gate is given', () => {
    // A cross-pin: the gate's own plan is the derivation's plan.
    expect(planCoffeeRun(patrol, world).script).toEqual(script)
  })
})
