import { describe, expect, it } from 'vitest'
import type { Vec3 } from '../types'
import { assembleShip } from '../assembler'
import { PATROL_SPEC } from '../fixtures'
import { WALK_SPEED_M_S } from '../player/move'
import { navigationWorldOf } from '../player/nav'
import { coffeeRunScript } from './path'
import { recordWalk, walkSummary } from './record'
import { REVIEW_FRAME_DT_S, type WalkScript } from './types'

const patrol = assembleShip(PATROL_SPEC)
const world = navigationWorldOf(patrol)
const script = coffeeRunScript(patrol, world)!
const spawn = script.waypoints[0].point

describe('M5-T2 walk recorder', () => {
  it('records a complete coffee run on the crew deck', () => {
    const recording = recordWalk(patrol, world, script)
    expect(recording.complete).toBe(true)
    expect(recording.truncated).toBe(false)
    expect(recording.framesRun).toBe(177)
    expect(recording.elapsedS).toBeCloseTo(177 * REVIEW_FRAME_DT_S, 9)
    expect(recording.distanceM).toBeGreaterThan(6)
    expect(recording.distanceM).toBeLessThan(7)
    expect(recording.decksVisited).toEqual([1])
    expect(recording.maxDepenetrations).toBe(0)
  })

  it('reaches every waypoint, in order, starting at the spawn', () => {
    const recording = recordWalk(patrol, world, script)
    expect(recording.waypoints.map((waypoint) => waypoint.reached)).toEqual([
      true,
      true,
      true,
    ])
    expect(recording.waypoints.map((waypoint) => waypoint.frame)).toEqual([0, 91, 177])
    expect(recording.waypoints[0].closestM).toBe(0)
    // The landmark and the return are both approached within the arrival radius.
    expect(recording.waypoints[1].closestM).toBeLessThanOrEqual(0.2)
    expect(recording.waypoints[2].closestM).toBeLessThanOrEqual(0.2)
    // One event per arrival, and no stalls or replans on a clean ship.
    const kinds = recording.events.map((event) => event.kind)
    expect(kinds).toEqual(['waypoint', 'waypoint', 'waypoint'])
  })

  it('is deterministic — the same script is the same walk', () => {
    expect(recordWalk(patrol, world, script)).toEqual(recordWalk(patrol, world, script))
  })

  it('never clips, never leaves the deck, and stays inside the walk speed', () => {
    const recording = recordWalk(patrol, world, script)
    expect(recording.frames.every((frame) => frame.depenetrations === 0)).toBe(true)
    expect(recording.frames.some((frame) => frame.arrested)).toBe(false)
    expect(recording.frames.every((frame) => frame.grounded)).toBe(true)
    expect(recording.frames.every((frame) => frame.phase === 'walk')).toBe(true)
    expect(recording.frames.every((frame) => frame.deckIndex === 1)).toBe(true)
    const cap = WALK_SPEED_M_S * REVIEW_FRAME_DT_S + 1e-9
    expect(recording.frames.every((frame) => frame.movedM <= cap)).toBe(true)
    // Time marches forward, one fixed step per recorded frame.
    expect(
      recording.frames.every(
        (frame, index) =>
          index === 0 ||
          Math.abs(frame.t - (recording.frames[index - 1].t + REVIEW_FRAME_DT_S)) <
            1e-9,
      ),
    ).toBe(true)
    expect(
      recording.frames.every(
        (frame, index) => index === 0 || frame.t > recording.frames[index - 1].t,
      ),
    ).toBe(true)
  })

  it('honours the frame budget and reports the walk as incomplete', () => {
    const recording = recordWalk(patrol, world, script, { maxFrames: 20 })
    expect(recording.framesRun).toBe(20)
    expect(recording.truncated).toBe(true)
    expect(recording.complete).toBe(false)
    expect(recording.waypoints[2].reached).toBe(false)
  })

  it('handles an empty script without inventing a walk', () => {
    const empty: WalkScript = { ship: 'Firebrand', kind: 'empty', waypoints: [] }
    const recording = recordWalk(patrol, world, empty)
    expect(recording.framesRun).toBe(0)
    expect(recording.complete).toBe(true)
    expect(recording.truncated).toBe(false)
    expect(recording.decksVisited).toEqual([])
  })

  it('reports an unreachable waypoint rather than looping', () => {
    const nowhere: WalkScript = {
      ship: 'Firebrand',
      kind: 'test',
      waypoints: [
        {
          id: 'start',
          kind: 'spawn',
          point: spawn,
          deckIndex: 1,
          label: 'Start',
          note: 'the spawn',
        },
        {
          id: 'nowhere',
          kind: 'landmark',
          point: [50, -3.2, 50] as Vec3,
          deckIndex: 1,
          label: 'Nowhere',
          note: 'off the deck entirely',
        },
      ],
    }
    const recording = recordWalk(patrol, world, nowhere)
    expect(recording.truncated).toBe(true)
    expect(recording.complete).toBe(false)
    expect(recording.waypoints[1].reached).toBe(false)
    const unreachable = recording.events.find((event) => event.kind === 'unreachable')
    expect(unreachable).toBeDefined()
    expect(unreachable!.detail).toContain('cannot route to "nowhere"')
  })

  it('summarises a walk in one line', () => {
    const recording = recordWalk(patrol, world, script)
    expect(walkSummary(recording)).toContain('Firebrand · coffee-run · complete')
    expect(walkSummary(recording)).toContain('3/3 waypoints')
    expect(walkSummary(recording)).toContain('177 frames')
  })
})
