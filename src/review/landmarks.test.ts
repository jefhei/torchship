import { describe, expect, it } from 'vitest'
import { assembleShip } from '../assembler'
import { SHIP_FIXTURES, expectValidFixtures, atSpine } from '../fixtures'
import { navigationWorldOf } from '../player/nav'
import { deckFloorYFor, type ModuleRef, type ShipSpec } from '../types'
import {
  SHIP_LANDMARKS,
  landmarkEvidence,
  landmarkProblems,
  landmarkTally,
} from './landmarks'
import { PATROL_SPEC } from '../fixtures'

function assembled(spec: ShipSpec) {
  const ship = assembleShip(spec, { requireValidSpec: false })
  return { ship, world: navigationWorldOf(ship) }
}

describe('M5-T3 §4 landmark checklist', () => {
  it('lists the six §4 signature landmarks in brief order', () => {
    expect(SHIP_LANDMARKS.map((landmark) => landmark.id)).toEqual([
      'bridge',
      'galley',
      'airlock',
      'med-bay',
      'reactor-room',
      'spine',
    ])
    for (const landmark of SHIP_LANDMARKS) {
      expect(landmark.title.trim().length).toBeGreaterThan(0)
      expect(landmark.note.trim().length).toBeGreaterThan(0)
    }
  })

  it('is fully present and problem-free on every real ship', () => {
    for (const fixture of expectValidFixtures()) {
      const { ship, world } = assembled(fixture.spec)
      expect(landmarkProblems(ship, world)).toEqual([])
      expect(landmarkEvidence(ship, world).every((entry) => entry.present)).toBe(true)
      expect(landmarkTally(landmarkEvidence(ship, world))).toBe(
        '6/6 §4 landmarks present',
      )
    }
  })

  it('measures the spine as a band on every deck plus a real ladder run', () => {
    const { ship, world } = assembled(PATROL_SPEC)
    const spine = landmarkEvidence(ship, world).find((entry) => entry.id === 'spine')!
    expect(spine.present).toBe(true)
    expect(spine.deckIndex).toBeNull()
    expect(spine.detail).toContain(`${ship.decks.length} deck(s)`)
    expect(spine.detail).toContain(`${world.runs.length} ladder run(s)`)
    expect(world.runs.length).toBe(ship.decks.length - 1)
  })

  it('reports the landmark the assembled ship does not carry', () => {
    const spec: ShipSpec = {
      ...PATROL_SPEC,
      name: 'NoGalley',
      decks: PATROL_SPEC.decks.map((deck) =>
        deck.yPosition === deckFloorYFor(1)
          ? { ...deck, modules: [atSpine('storage')] satisfies ModuleRef[] }
          : deck,
      ),
    }
    const { ship, world } = assembled(spec)
    const problems = landmarkProblems(ship, world)
    expect(problems.some((line) => line.includes('coffee station'))).toBe(true)
    expect(problems.some((line) => line.includes('coffee-station'))).toBe(true)
    const evidence = landmarkEvidence(ship, world)
    expect(evidence.find((entry) => entry.id === 'galley')!.present).toBe(false)
    expect(evidence.find((entry) => entry.id === 'bridge')!.present).toBe(true)
    expect(landmarkTally(evidence)).toBe('5/6 §4 landmarks present')
  })

  it('reports a bridge-less ship too', () => {
    const spec: ShipSpec = {
      ...PATROL_SPEC,
      name: 'NoBridge',
      decks: PATROL_SPEC.decks.map((deck) =>
        deck.yPosition === deckFloorYFor(0)
          ? { ...deck, modules: [atSpine('storage')] satisfies ModuleRef[] }
          : deck,
      ),
    }
    const { ship, world } = assembled(spec)
    expect(
      landmarkProblems(ship, world).some((line) => line.includes('head (bridge)')),
    ).toBe(true)
  })

  it('finds the stress rig geometrically complete (its defects are alignment, not landmarks)', () => {
    const stress = SHIP_FIXTURES.find((fixture) => fixture.id === 'stress')!
    const { ship, world } = assembled(stress.spec)
    expect(landmarkProblems(ship, world)).toEqual([])
  })
})
