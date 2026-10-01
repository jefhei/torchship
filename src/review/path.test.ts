import { describe, expect, it } from 'vitest'
import { rotY } from '../types'
import type { Vec3 } from '../types'
import { assembleShip } from '../assembler'
import { PATROL_SPEC, SHIP_FIXTURES, expectValidFixtures } from '../fixtures'
import { STANDING_SHAPE } from '../player/hull'
import { navigationWorldOf } from '../player/nav'
import { spawnPointOf } from '../player/spawn'
import {
  COFFEE_RUN_KIND,
  COFFEE_STANDOFF_M,
  coffeeRunScript,
  planCoffeeRun,
} from './path'
import { REVIEW_CELL_M, cellCenter, deckRouteGrid, nearestWalkable } from './route'

const patrol = assembleShip(PATROL_SPEC)
const world = navigationWorldOf(patrol)

/** −0 → 0, the normalization the placement transform applies. */
function n0(value: number): number {
  return value === 0 ? 0 : value
}

describe('M5-T2 coffee-run derivation', () => {
  it('derives the spawn → coffee station → back run for every real ship', () => {
    for (const fixture of expectValidFixtures()) {
      const ship = assembleShip(fixture.spec, { requireValidSpec: false })
      const shipWorld = navigationWorldOf(ship)
      const script = coffeeRunScript(ship, shipWorld)
      expect(script).not.toBeNull()
      expect(script!.kind).toBe(COFFEE_RUN_KIND)
      expect(script!.ship).toBe(fixture.spec.name)
      expect(script!.waypoints.map((w) => w.id)).toEqual([
        'spawn',
        'coffee-station',
        'return',
      ])
      expect(script!.waypoints.map((w) => w.kind)).toEqual([
        'spawn',
        'landmark',
        'return',
      ])
      // The whole run is one deck — the crew deck (index 1).
      expect(script!.waypoints.every((w) => w.deckIndex === 1)).toBe(true)
      // It closes its loop: the return is the spawn pose again.
      expect(script!.waypoints[2].point).toEqual(script!.waypoints[0].point)
      // Every waypoint carries a derivation note, never a hand-placed point.
      expect(script!.waypoints.every((w) => w.note.length > 0)).toBe(true)
    }
  })

  it('stands COFFEE_STANDOFF_M in front of the galley’s own anchor (recomputed here)', () => {
    const galley = patrol.decks[1].modules.find(
      (owner) => owner.source.moduleId === 'galley',
    )!
    const anchor = galley.module.manifest.equipmentSlots.find(
      (slot) => slot.id === 'coffee-station',
    )!
    // The station's front is its primitive +z face; the anchor's own rotation
    // turns that into a module-local direction, the module placement to world.
    const front = rotY([0, 0, 1], anchor.rotation ?? 0)
    const local: Vec3 = [
      anchor.position[0] + front[0] * COFFEE_STANDOFF_M,
      0,
      anchor.position[2] + front[2] * COFFEE_STANDOFF_M,
    ]
    const [rx, ry, rz] = rotY(local, galley.rotation)
    const expected: Vec3 = [
      n0(galley.origin[0] + rx),
      n0(galley.origin[1] + ry),
      n0(galley.origin[2] + rz),
    ]
    expect(coffeeRunScript(patrol, world)!.waypoints[1].point).toEqual(expected)
    // …and that is AFT of the station (toward the spine door it faces).
    const anchorWorldZ = galley.origin[2] + rotY(anchor.position, galley.rotation)[2]
    expect(expected[2]).toBeLessThan(anchorWorldZ)
  })

  it('starts and ends at the M3-T6 spawn pose', () => {
    const spawn = spawnPointOf(patrol, world)!
    const script = coffeeRunScript(patrol, world)!
    expect(script.waypoints[0].point).toEqual(spawn.feet)
    expect(script.waypoints[2].point).toEqual(spawn.feet)
    expect(script.waypoints[0].note).toBe(spawn.note)
  })

  it('puts the landmark on real standing room', () => {
    const script = coffeeRunScript(patrol, world)!
    const stand = script.waypoints[1].point
    const grid = deckRouteGrid(patrol, world, 1, STANDING_SHAPE)!
    const cell = nearestWalkable(grid, stand[0], stand[2])
    expect(cell).not.toBeNull()
    const centre = cellCenter(grid, cell!)
    expect(Math.hypot(centre.x - stand[0], centre.z - stand[2])).toBeLessThanOrEqual(
      REVIEW_CELL_M,
    )
  })
})

describe('M5-T2 coffee-run refusals', () => {
  it('reports the crew deck of the stress rig, which seats no galley', () => {
    const stress = SHIP_FIXTURES.find((fixture) => fixture.id === 'stress')!
    const ship = assembleShip(stress.spec, { requireValidSpec: false })
    const plan = planCoffeeRun(ship, navigationWorldOf(ship))
    expect(plan.script).toBeNull()
    expect(plan.problems.some((line) => line.includes('seats no galley'))).toBe(true)
  })

  it('reports a ship with no crew deck', () => {
    const noCrew = {
      ...patrol,
      decks: patrol.decks.filter((deck) => deck.deckIndex !== 1),
    }
    const plan = planCoffeeRun(noCrew, world)
    expect(plan.script).toBeNull()
    expect(plan.problems.some((line) => line.includes('no legal spawn'))).toBe(true)
  })

  it('reports a galley with no coffee-station anchor', () => {
    const stripped = {
      ...patrol,
      decks: patrol.decks.map((deck) =>
        deck.deckIndex !== 1
          ? deck
          : {
              ...deck,
              modules: deck.modules.map((owner) =>
                owner.source.moduleId !== 'galley'
                  ? owner
                  : {
                      ...owner,
                      module: {
                        ...owner.module,
                        manifest: {
                          ...owner.module.manifest,
                          equipmentSlots: owner.module.manifest.equipmentSlots.filter(
                            (slot) => slot.id !== 'coffee-station',
                          ),
                        },
                      },
                    },
              ),
            },
      ),
    }
    const plan = planCoffeeRun(stripped, world)
    expect(plan.script).toBeNull()
    expect(
      plan.problems.some((line) =>
        line.includes('no "coffee-station" equipment anchor'),
      ),
    ).toBe(true)
  })
})
