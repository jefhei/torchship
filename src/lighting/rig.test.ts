/**
 * M4-T2 — the practical-light rig over the assembled ships.
 *
 * Pins (BUILD_PLAN M4-T2 gate "frame budget met on Patrol"; PRD §8 bullet 6
 * "every module instance has ≥ 1 light fixture"):
 *  - one fixture per authored light socket, for every canonical ship — the rig
 *    mounts what the kit's authors placed, in world space, with the measured
 *    positions pinned so a placement regression shows up here;
 *  - every fixture sits inside the module instance that authored it;
 *  - the frame budget: `activeLightsFor` never mounts more than
 *    `LIGHTS_ACTIVE_MAX`, and when a deck overflows it keeps the fixtures that
 *    matter most (landmarks first, ceiling fill last);
 *  - the shadow spend: one map per deck, task lights only;
 *  - the verdict rules: a dark instance, a dropped fixture, a duplicate id and
 *    an over-budget deck are all reported, never silently repaired.
 */

import { describe, expect, it } from 'vitest'
import { assembleShip, boxContains } from '../assembler'
import type { ShipAssembly } from '../assembler'
import { SHIP_FIXTURES, getShipFixture } from '../fixtures'
import { partBounds } from '../kit/parts'
import type { Aabb3 } from '../types'
import type { LightKind } from '../types'
import {
  LIGHTS_ACTIVE_MAX,
  LIGHTS_PER_DECK_MAX,
  SHADOW_LIGHTS_PER_DECK_MAX,
  getLightArchetype,
  lightColorFor,
  rigAmbient,
} from './archetypes'
import {
  activeLightsFor,
  lightLabel,
  lightRigCoverageProblems,
  lightRigOf,
  lightRigProblems,
  lightRigReport,
  lightRigTally,
  lightsOfDeck,
  moduleInstanceCountOf,
  rigCoverageProblems,
  shadowCastersOf,
  socketCountOf,
  withShadowCasters,
  type LightRig,
  type PlacedLight,
} from './rig'

/** Assemble a canonical fixture exactly as the app does (the rig rejects one). */
function shipOf(fixtureId: Parameters<typeof getShipFixture>[0]): ShipAssembly {
  const fixture = getShipFixture(fixtureId)
  return assembleShip(fixture.spec, { requireValidSpec: fixture.expectValid })
}

const PATROL = shipOf('patrol')
const CREW_DECK = 1

/** The world bounds of a module instance's own placed geometry. */
function boundsOf(ship: ShipAssembly, deckIndex: number, moduleIndex: number): Aabb3 {
  const deck = ship.decks[deckIndex]
  const module = deck.modules.find((m) => m.source.moduleIndex === moduleIndex)
  if (module === undefined) throw new Error('probe: no such module instance')
  const boxes = module.parts.map((placed) => partBounds(placed.part))
  return {
    min: [0, 1, 2].map((axis) => Math.min(...boxes.map((box) => box.min[axis]))) as [
      number,
      number,
      number,
    ],
    max: [0, 1, 2].map((axis) => Math.max(...boxes.map((box) => box.max[axis]))) as [
      number,
      number,
      number,
    ],
  }
}

/** A synthetic fixture, for the cases no canonical ship can produce. */
function fakeLight(id: string, kind: LightKind, deckIndex = 0): PlacedLight {
  const archetype = getLightArchetype(kind)
  return {
    id,
    kind,
    deckIndex,
    deckId: `deck-${deckIndex}`,
    source: { deckId: `deck-${deckIndex}`, moduleId: 'test', moduleIndex: 0 },
    socketId: id,
    position: [0, 0, 0],
    color: lightColorFor(archetype),
    intensity: archetype.intensity,
    distanceM: archetype.distanceM,
    decay: archetype.decay,
    castsShadow: false,
  }
}

function fakeRig(lights: PlacedLight[]): LightRig {
  return {
    ship: 'test',
    themeId: 'test',
    lights,
    byDeck: [lights],
    ambient: rigAmbient(),
  }
}

describe('light rig (M4-T2)', () => {
  it('mounts one fixture per authored light socket, on every canonical ship', () => {
    for (const fixture of SHIP_FIXTURES) {
      const ship = assembleShip(fixture.spec, { requireValidSpec: fixture.expectValid })
      const rig = lightRigOf(ship)
      expect(rig.lights.length).toBe(socketCountOf(ship))
      expect(rig.lights.length).toBeGreaterThan(0)
      expect(new Set(rig.lights.map((light) => light.id)).size).toBe(rig.lights.length)
      // The rig is lit AND complete: only the M4 frame budget can complain.
      expect(lightRigCoverageProblems(ship)).toEqual([])
    }
  })

  it('measures Patrol: 43 fixtures, 28 panel + 6 task + 8 screen + 1 reactor', () => {
    const tally = lightRigTally(lightRigOf(PATROL))
    expect(tally.lights).toBe(43)
    expect(tally.byKind).toEqual({ panel: 28, task: 6, screen: 8, reactor: 1 })
    expect(tally.decks).toBe(5)
    expect(tally.maxPerDeck).toBe(10)
    // The worst deck is the bridge, which carries the most fixtures.
    expect(lightRigReport(PATROL).activeMax).toBe(10)
    expect(tally.maxPerDeck).toBeLessThanOrEqual(LIGHTS_ACTIVE_MAX)
    expect(tally.maxPerDeck).toBeLessThanOrEqual(LIGHTS_PER_DECK_MAX)
  })

  it('places fixtures in world space at the sockets the modules authored', () => {
    // The galley's coffee-station task light: the room's own strip lens, on the
    // crew deck (floor −3.2 m), at the measured world point.
    const galley = lightRigOf(PATROL).lights.find(
      (light) => light.socketId === 'coffee-station-task',
    )
    expect(galley).toBeDefined()
    expect(galley?.deckIndex).toBe(CREW_DECK)
    expect(galley?.kind).toBe('task')
    expect(galley?.source).toEqual({
      deckId: 'crew',
      moduleId: 'galley',
      moduleIndex: 0,
    })
    expect(galley?.position[0]).toBeCloseTo(0.7, 6)
    expect(galley?.position[1]).toBeCloseTo(-2.33, 6)
    expect(galley?.position[2]).toBeCloseTo(4.975, 6)

    // The drive glow's own lens, the only reactor fixture in the ship.
    const reactor = lightRigOf(PATROL).lights.filter(
      (light) => light.kind === 'reactor',
    )
    expect(reactor).toHaveLength(1)
    expect(reactor[0].socketId).toBe('reactor-glow')
    expect(reactor[0].source.moduleId).toBe('engineering')
    expect(reactor[0].color).toBe(lightColorFor(getLightArchetype('reactor')))
  })

  it('keeps every fixture inside the module instance that authored it', () => {
    for (const fixture of SHIP_FIXTURES) {
      const ship = assembleShip(fixture.spec, { requireValidSpec: fixture.expectValid })
      const rig = lightRigOf(ship)
      for (const light of rig.lights) {
        const bounds = boundsOf(ship, light.deckIndex, light.source.moduleIndex)
        expect(
          boxContains(bounds, { min: light.position, max: light.position }, 0.05),
        ).toBe(true)
      }
    }
  })

  it('lights the shaft band of every deck, one fixture set per deck', () => {
    const rig = lightRigOf(PATROL)
    expect(rig.byDeck).toHaveLength(PATROL.decks.length)
    for (const deck of rig.byDeck) {
      const band = deck.filter((light) => light.source.moduleId === 'spine')
      expect(band).toHaveLength(2)
      for (const light of band) {
        expect(light.source.moduleIndex).toBe(-1)
        expect(light.kind).toBe('panel')
      }
    }
    // Rooms + bands: the rig accounts for every instance the assembler placed.
    const instances = moduleInstanceCountOf(PATROL)
    expect(instances).toBe(
      PATROL.decks.reduce((total, deck) => total + deck.modules.length, 0),
    )
    expect(rig.lights.length).toBeGreaterThan(instances)
  })

  it('mounts a deck whole when it fits the budget, and nothing for a deck that is not there', () => {
    const rig = lightRigOf(PATROL)
    expect(activeLightsFor(rig, CREW_DECK)).toEqual(lightsOfDeck(rig, CREW_DECK))
    expect(activeLightsFor(rig, CREW_DECK)).toHaveLength(8)
    // The crew deck is the spawn deck: it is lit before the first step.
    expect(activeLightsFor(rig, 99)).toEqual([])
    expect(lightsOfDeck(rig, -1)).toEqual([])
  })

  it('caps an over-budget deck at the frame budget, keeping landmarks and work lights', () => {
    const lights = [
      ...Array.from({ length: 6 }, (_unused, i) =>
        fakeLight(`deck-0-t-0-panel-${i}`, 'panel'),
      ),
      ...Array.from({ length: 4 }, (_unused, i) =>
        fakeLight(`deck-0-t-0-task-${i}`, 'task'),
      ),
      ...Array.from({ length: 2 }, (_unused, i) =>
        fakeLight(`deck-0-t-0-screen-${i}`, 'screen'),
      ),
      ...Array.from({ length: 2 }, (_unused, i) =>
        fakeLight(`deck-0-t-0-reactor-${i}`, 'reactor'),
      ),
    ]
    const rig = fakeRig(lights)
    const active = activeLightsFor(rig, 0)
    expect(active).toHaveLength(LIGHTS_ACTIVE_MAX)
    // Landmarks first (both reactors), then the lights people work under (all
    // four task strips and both screens) — the 6-panel fill is what gets cut.
    expect(active.filter((light) => light.kind === 'reactor')).toHaveLength(2)
    expect(active.filter((light) => light.kind === 'task')).toHaveLength(4)
    expect(active.filter((light) => light.kind === 'screen')).toHaveLength(2)
    expect(active.filter((light) => light.kind === 'panel').map((l) => l.id)).toEqual([
      'deck-0-t-0-panel-0',
      'deck-0-t-0-panel-1',
      'deck-0-t-0-panel-2',
      'deck-0-t-0-panel-3',
    ])
    // Deterministic: the same deck always mounts the same list.
    expect(activeLightsFor(rig, 0).map((l) => l.id)).toEqual(active.map((l) => l.id))
  })

  it('never mounts more than the frame budget, on any deck of any ship', () => {
    for (const fixture of SHIP_FIXTURES) {
      const ship = assembleShip(fixture.spec, { requireValidSpec: fixture.expectValid })
      const rig = lightRigOf(ship)
      for (const deck of ship.decks) {
        expect(activeLightsFor(rig, deck.deckIndex).length).toBeLessThanOrEqual(
          LIGHTS_ACTIVE_MAX,
        )
      }
    }
  })

  it('spends at most one shadow map per deck, on task lights only', () => {
    const rig = withShadowCasters(lightRigOf(PATROL))
    const casters = shadowCastersOf(rig)
    expect(casters).toHaveLength(PATROL.decks.length)
    expect(casters.every((light) => light.kind === 'task')).toBe(true)
    for (const deck of rig.byDeck) {
      expect(deck.filter((light) => light.castsShadow).length).toBeLessThanOrEqual(
        SHADOW_LIGHTS_PER_DECK_MAX,
      )
    }
    // Every fixture the rig did not spend a map on is explicit about it.
    expect(rig.lights.filter((light) => !light.castsShadow)).toHaveLength(43 - 5)
    expect(lightRigTally(rig).shadowCasters).toBe(5)
  })

  it('marks shadow casters without mutating the rig it was handed', () => {
    const bare = lightRigOf(PATROL)
    const lit = withShadowCasters(bare)
    expect(bare.lights.every((light) => !light.castsShadow)).toBe(true)
    expect(lit.lights.some((light) => light.castsShadow)).toBe(true)
    expect(bare).not.toBe(lit)
  })

  it('carries each fixture its archetype recipe and its lens tint', () => {
    const rig = lightRigOf(PATROL)
    for (const light of rig.lights) {
      const archetype = getLightArchetype(light.kind)
      expect(light.intensity).toBe(archetype.intensity)
      expect(light.distanceM).toBe(archetype.distanceM)
      expect(light.decay).toBe(2)
      expect(light.color).toBe(lightColorFor(archetype))
      expect(light.deckId).toBe(PATROL.decks[light.deckIndex].deckId)
    }
  })

  it('reports a dark instance (the §8 bullet-6 half, on the assembled ship)', () => {
    const dark = withDarkenedGalley(PATROL)
    const problems = lightRigProblems(dark)
    expect(problems.join('; ')).toMatch(
      /dark instance: deck 1 \(crew\) builds "galley#0"/,
    )
    expect(problems.join('; ')).toMatch(/a legally-dark room on the assembled ship/)
    // The rig and the ship's socket count stay CONSISTENT (both read the same
    // manifest) — this fixture is dark, not incomplete.
    expect(problems.join('; ')).not.toMatch(/fixtures mounted/)
    expect(lightRigCoverageProblems(dark).join('; ')).toMatch(/dark instance/)
  })

  it('reports a fixture the rig dropped, and a duplicated id', () => {
    const rig = withShadowCasters(lightRigOf(PATROL))
    const dropped: LightRig = {
      ...rig,
      lights: rig.lights.slice(1),
      byDeck: rig.byDeck.map((deck, index) => (index === 0 ? deck.slice(1) : deck)),
    }
    expect(rigCoverageProblems(dropped, PATROL).join('; ')).toMatch(
      /43 light sockets in the ship but 42 fixtures mounted/,
    )

    const doubled: LightRig = { ...rig, lights: [...rig.lights, rig.lights[0]] }
    expect(rigCoverageProblems(doubled, PATROL).join('; ')).toMatch(
      /duplicate fixture id 'deck-0-head-0-panel-light-1'/,
    )
    // The same two rules are what `lightRigProblems` runs, before the budget.
    expect(lightRigProblems(PATROL)).toEqual([])
  })

  it('reports a deck over the frame budget (and the QA rig is one)', () => {
    const rig = lightRigReport(shipOf('stress'))
    expect(rig.problems.join('; ')).toMatch(
      /frame budget: deck 3 \(rig-3\) carries 15 fixtures over the 12/,
    )
    expect(rig.activeMax).toBe(LIGHTS_ACTIVE_MAX)
    // Patrol is the ship the M4 gate names: it is inside the budget.
    expect(lightRigProblems(PATROL)).toEqual([])
    expect(lightRigReport(PATROL).problems).toEqual([])
  })

  it('reports a duplicated fixture id', () => {
    const doubled: ShipAssembly = {
      ...PATROL,
      decks: PATROL.decks.map((deck) =>
        deck.deckIndex === CREW_DECK
          ? { ...deck, modules: [...deck.modules, deck.modules[0]] }
          : deck,
      ),
    }
    expect(lightRigProblems(doubled).join('; ')).toMatch(
      /duplicate fixture id 'deck-1-galley-0-coffee-station-task'/,
    )
  })

  it('summarises a ship in one report line and one label per fixture', () => {
    const report = lightRigReport(PATROL)
    expect(report.ship).toBe('Firebrand')
    expect(report.themeId).toBe('firebrand')
    expect(report.detail).toBe(
      'practical lighting: 43 fixtures (28 panel + 6 task + 8 screen + 1 reactor) over ' +
        '5 decks, 10 mounted at once (budget 12), 5 shadow-casting, ambient #4a443c @ 0.28',
    )
    expect(report.decks.map((row) => row.lights)).toEqual([10, 8, 9, 8, 8])
    expect(report.decks.every((row) => row.active === row.lights)).toBe(true)
    expect(report.ambient).toEqual(rigAmbient())

    const galley = report.decks[CREW_DECK]
    const light = lightsOfDeck(lightRigOf(PATROL), CREW_DECK)[4]
    expect(lightLabel(light)).toMatch(
      /^task light 'coffee-station-task' of galley#0 on deck 1 \(crew\) at 0\.700, -2\.330, 4\.975 m$/,
    )
    expect(galley.label).toBe('Crew deck — galley & bunks')
  })
})

/** Patrol with the galley's light sockets stripped (no canonical ship is dark). */
function withDarkenedGalley(ship: ShipAssembly): ShipAssembly {
  return {
    ...ship,
    decks: ship.decks.map((deck) => ({
      ...deck,
      modules: deck.modules.map((module) =>
        module.source.moduleId === 'galley' && module.source.moduleIndex === 0
          ? {
              ...module,
              module: {
                ...module.module,
                manifest: { ...module.module.manifest, lightSockets: [] },
              },
            }
          : module,
      ),
    })),
  }
}
