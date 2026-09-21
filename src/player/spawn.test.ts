import { describe, expect, it } from 'vitest'
import { assembleDeck, assembleShip } from '../assembler'
import { LONG_HAUL_SPEC, PATROL_SPEC, SCIENCE_SPEC } from '../fixtures'
import { atSpine } from '../fixtures'
import type { ShipSpec } from '../types'
import { PROVISIONAL_SPAWN_DECK_INDEX, defaultSpawnFeet } from './spawn'
import { stepWalker, walkerWorldOf } from './walker'

const ONE_DECK_SPEC: ShipSpec = {
  classId: 'hound',
  name: 'Testbed',
  registry: 'T-1',
  seed: 7,
  decks: [
    { id: 'head', label: 'Head — bridge', yPosition: 0, modules: [atSpine('head')] },
  ],
}

describe('provisional spawn point (M3-T4 plumbing, replaced by M3-T6)', () => {
  it('spawns in the crew deck’s first room on every canonical ship', () => {
    for (const spec of [PATROL_SPEC, LONG_HAUL_SPEC, SCIENCE_SPEC]) {
      const assembly = assembleShip(spec)
      const feet = defaultSpawnFeet(assembly)
      expect(feet).not.toBeNull()
      const crew = assembly.decks[PROVISIONAL_SPAWN_DECK_INDEX]
      expect(crew.deckId).toBe('crew')
      expect(feet![0]).toBe(0)
      expect(feet![1]).toBeCloseTo(crew.floorY, 10)
      expect(feet![2]).toBeGreaterThan(0)
    }
  })

  it('drops the walker onto a walkable spot on every canonical ship', () => {
    for (const spec of [PATROL_SPEC, LONG_HAUL_SPEC, SCIENCE_SPEC]) {
      const assembly = assembleShip(spec)
      const feet = defaultSpawnFeet(assembly)!
      let state = stepWalker(
        { feet, verticalSpeedMps: 0, grounded: false },
        {
          input: { forward: 0, strafe: 0 },
          sprint: false,
          crouch: false,
          yaw: 0,
          dt: 0.05,
        },
        walkerWorldOf(assembly),
      ).state
      for (let i = 0; i < 4; i++) {
        state = stepWalker(
          state,
          {
            input: { forward: 0, strafe: 0 },
            sprint: false,
            crouch: false,
            yaw: 0,
            dt: 0.05,
          },
          walkerWorldOf(assembly),
        ).state
      }
      expect(state.grounded).toBe(true)
      expect(Math.abs(state.feet[1] - feet[1])).toBeLessThan(0.1)
    }
  })

  it('falls back to deck 0 on a one-deck ship (defensive; the validator rejects one)', () => {
    // The M1-T3 validator requires a crew deck at index 1, so a one-deck spec
    // never reaches a walker in the app — the fallback is here so the spawn
    // helper cannot return a point on a deck that does not exist.
    const assembly = assembleShip(ONE_DECK_SPEC, { requireValidSpec: false })
    const feet = defaultSpawnFeet(assembly)
    expect(feet).not.toBeNull()
    expect(feet![1]).toBe(0)
  })

  it('returns null when there is no room instance to spawn in', () => {
    // A deck carrying only its synthesized spine band: no room, no spawn.
    const assembly = assembleShip(PATROL_SPEC)
    const empty = assembleDeck(
      { id: 'empty', label: 'Empty', yPosition: 0, modules: [] },
      0,
    )
    expect(defaultSpawnFeet({ ...assembly, decks: [empty] })).toBeNull()
  })
})
