import { describe, expect, it } from 'vitest'
import { assembleShip } from '../assembler'
import { PATROL_SPEC } from '../fixtures'
import { SHIP_FIXTURES, expectValidFixtures } from '../fixtures'
import { AUTHORED_MODULES } from '../kit/modules'
import { navigationWorldOf } from '../player/nav'
import {
  DECK_LABEL_SEPARATOR,
  HATCH_BLOCKED_NOTICE,
  INDICATOR_TOGGLE_KEY,
  MOMENT_HOLD_MS,
  deckIndicatorOf,
  deckIndicatorSummary,
  deckMomentFor,
  deckMomentTitle,
  deckNameOf,
  hatchAffordance,
  hatchShortName,
  ladderToBowWard,
  ladderToDriveWard,
  wayfindingDecksOf,
  wayfindingProblems,
} from './index'

/** The Patrol ship assembled once — the hero fixture most pins read. */
const patrol = assembleShip(PATROL_SPEC)
const patrolWorld = navigationWorldOf(patrol)
const patrolDecks = wayfindingDecksOf(patrol)

/** The walk-report shape a moment is read from. */
function arrival(
  deckIndex: number,
  overrides: Partial<{
    arrived: boolean
    landed: boolean
    phase: 'walk' | 'climb'
  }> = {},
) {
  return {
    deckIndex,
    arrived: overrides.arrived ?? false,
    landed: overrides.landed ?? false,
    phase: overrides.phase ?? ('walk' as const),
  }
}

describe('M5-T1 deck model', () => {
  it('splits a spec label into name + full line, and a name-only label survives', () => {
    expect(deckNameOf('Crew deck — galley & bunks')).toBe('Crew deck')
    expect(deckNameOf('  Head — bridge  ')).toBe('Head')
    expect(deckNameOf('Airlock')).toBe('Airlock')
    expect(deckNameOf('Cargo hold B — spares')).toBe('Cargo hold B')
    expect(deckNameOf('   ')).toBe('')
    expect(DECK_LABEL_SEPARATOR).toBe('—')
  })

  it('names every deck of the Patrol ship, bow → drive, with what is aboard', () => {
    expect(patrolDecks.map((deck) => deck.deckIndex)).toEqual([0, 1, 2, 3, 4])
    expect(patrolDecks.map((deck) => deck.deckId)).toEqual([
      'head',
      'crew',
      'ops',
      'engineering',
      'aft',
    ])
    expect(patrolDecks.map((deck) => deck.name)).toEqual([
      'Head',
      'Crew deck',
      'Ops deck',
      'Engineering',
      'Aft hold',
    ])
    expect(patrolDecks[1].label).toBe('Crew deck — galley & bunks')
    // One room per deck on the hero ship, named by the module's OWN manifest.
    expect(patrolDecks.map((deck) => deck.aboard.length)).toEqual([1, 1, 1, 1, 1])
    expect(patrolDecks[1].aboard[0]).toContain('Galley')
    expect(patrolDecks[0].aboard[0]).toContain('Bridge')
    expect(patrolDecks[4].aboard[0]).toContain('Storage')
  })

  it('every canonical deck has a label, a name and a room aboard', () => {
    for (const fixture of SHIP_FIXTURES) {
      const decks = wayfindingDecksOf(
        assembleShip(fixture.spec, { requireValidSpec: false }),
      )
      expect(decks.map((deck) => deck.deckIndex)).toEqual(
        fixture.spec.decks.map((_, index) => index),
      )
      for (const deck of decks) {
        expect(deck.label.trim().length).toBeGreaterThan(0)
        expect(deck.name.trim().length).toBeGreaterThan(0)
        expect(deck.label.startsWith(deck.name)).toBe(true)
        expect(deck.aboard.length).toBeGreaterThan(0)
        // The shaft band is never a room on a sign.
        expect(
          deck.aboard.every((line) => !line.toLowerCase().includes('spine shaft')),
        ).toBe(true)
      }
    }
  })

  it('reads the six-deck long-haul cargo holds and the science retrofit deck', () => {
    const longHaul = wayfindingDecksOf(
      assembleShip(SHIP_FIXTURES.find((f) => f.id === 'long-haul')!.spec),
    )
    expect(longHaul.map((deck) => deck.name)).toEqual([
      'Head',
      'Crew deck',
      'Ops deck',
      'Engineering',
      'Cargo hold A',
      'Cargo hold B',
    ])
    const science = wayfindingDecksOf(
      assembleShip(SHIP_FIXTURES.find((f) => f.id === 'science')!.spec),
    )
    expect(science.map((deck) => deck.name)).toContain('Science deck')
  })
})

describe('M5-T1 deck indicator', () => {
  it('stacks every deck bow-first with exactly one current row', () => {
    for (const deck of patrolDecks) {
      const indicator = deckIndicatorOf(patrol, patrolWorld, deck.deckIndex)
      expect(indicator.rows.map((row) => row.deckIndex)).toEqual([0, 1, 2, 3, 4])
      expect(indicator.rows.filter((row) => row.isCurrent)).toHaveLength(1)
      expect(indicator.current.deckIndex).toBe(deck.deckIndex)
      expect(indicator.current.name).toBe(deck.name)
      expect(indicator.currentIndex).toBe(deck.deckIndex)
    }
  })

  it('marks only the ladder climbs M3-T5’s run list really affords', () => {
    // Runs: band i connects deck i (lower) to deck i−1 (upper); Patrol has four.
    expect(patrolWorld.runs).toHaveLength(4)
    const rows = deckIndicatorOf(patrol, patrolWorld, 1).rows
    expect(rows.map((row) => row.climbsBowWard)).toEqual([
      false,
      true,
      true,
      true,
      true,
    ])
    expect(rows.map((row) => row.climbsDriveWard)).toEqual([
      true,
      true,
      true,
      true,
      false,
    ])
    expect(ladderToBowWard(patrolWorld, 0)).toBeNull()
    expect(ladderToBowWard(patrolWorld, 1)).toBe(0)
    expect(ladderToDriveWard(patrolWorld, 0)).toBe(1)
    expect(ladderToDriveWard(patrolWorld, 4)).toBeNull()
  })

  it('points the current deck’s ladder both ways, and stops at the ends', () => {
    const crew = deckIndicatorOf(patrol, patrolWorld, 1)
    expect(crew.bowWard).toEqual({ deckId: 'head', name: 'Head' })
    expect(crew.driveWard).toEqual({ deckId: 'ops', name: 'Ops deck' })
    const head = deckIndicatorOf(patrol, patrolWorld, 0)
    expect(head.bowWard).toBeNull()
    expect(head.driveWard).toEqual({ deckId: 'crew', name: 'Crew deck' })
    const aft = deckIndicatorOf(patrol, patrolWorld, 4)
    expect(aft.bowWard).toEqual({ deckId: 'engineering', name: 'Engineering' })
    expect(aft.driveWard).toBeNull()
  })

  it('summarises the stack in the ship’s own words', () => {
    expect(deckIndicatorSummary(deckIndicatorOf(patrol, patrolWorld, 1))).toBe(
      'Deck 1 · Crew deck · ladder ▲ Head, ▼ Ops deck',
    )
    expect(deckIndicatorSummary(deckIndicatorOf(patrol, patrolWorld, 0))).toBe(
      'Deck 0 · Head · ladder ▼ Crew deck',
    )
    expect(deckIndicatorSummary(deckIndicatorOf(patrol, patrolWorld, 4))).toBe(
      'Deck 4 · Aft hold · ladder ▲ Engineering',
    )
  })

  it('clamps a stale deck index the way the walker does instead of throwing', () => {
    const high = deckIndicatorOf(patrol, patrolWorld, 9)
    expect(high.currentIndex).toBe(4)
    expect(high.current.deckId).toBe('aft')
    const low = deckIndicatorOf(patrol, patrolWorld, -3)
    expect(low.currentIndex).toBe(0)
    expect(low.current.deckId).toBe('head')
    // The clamp agrees with the walker's own deck resolution.
    expect(high.rows.filter((row) => row.isCurrent)).toHaveLength(1)
  })

  it('toggles on `I`, a key the locomotion set does not use', () => {
    expect(INDICATOR_TOGGLE_KEY).toBe('KeyI')
  })
})

describe('M5-T1 label moments', () => {
  it('raises a spawn moment on the first deck of a session', () => {
    const moment = deckMomentFor(patrol, patrolWorld, arrival(1), null)
    expect(moment).not.toBeNull()
    expect(moment!.kind).toBe('spawn')
    expect(moment!.direction).toBeNull()
    expect(moment!.title).toBe('DECK 1 · Crew deck')
    expect(moment!.detail).toBe('Crew deck — galley & bunks')
    expect(moment!.aboard).toHaveLength(1)
    expect(moment!.aboard[0]).toContain('Galley')
    expect(moment!.arrivalLine).toBe('first step aboard')
    expect(moment!.extent).toBeNull()
    expect(moment!.bowWard).toEqual({ deckId: 'head', name: 'Head' })
    expect(moment!.driveWard).toEqual({ deckId: 'ops', name: 'Ops deck' })
  })

  it('raises nothing when the deck did not change', () => {
    expect(deckMomentFor(patrol, patrolWorld, arrival(1), 1)).toBeNull()
    expect(
      deckMomentFor(patrol, patrolWorld, arrival(1, { arrived: true }), 1),
    ).toBeNull()
  })

  it('reads a climb arrival in the ship’s own direction (lower index = up under burn)', () => {
    const up = deckMomentFor(
      patrol,
      patrolWorld,
      arrival(1, { arrived: true, landed: true }),
      2,
    )
    expect(up!.kind).toBe('climb')
    expect(up!.direction).toBe('bow-ward')
    expect(up!.arrivalLine).toBe('up the ladder from Ops deck — toward the bow')
    const down = deckMomentFor(
      patrol,
      patrolWorld,
      arrival(3, { arrived: true, landed: true }),
      2,
    )
    expect(down!.kind).toBe('climb')
    expect(down!.direction).toBe('drive-ward')
    expect(down!.arrivalLine).toBe('down the ladder from Ops deck — toward the drive')
  })

  it('reads a fall and a plain deck change', () => {
    const fall = deckMomentFor(patrol, patrolWorld, arrival(1, { landed: true }), 0)
    expect(fall!.kind).toBe('fall')
    expect(fall!.arrivalLine).toBe('fell from Head')
    const walked = deckMomentFor(patrol, patrolWorld, arrival(4), 3)
    expect(walked!.kind).toBe('walk')
    expect(walked!.arrivalLine).toBe('came from Engineering')
  })

  it('names the ends of the ship and stops promising ladders at them', () => {
    const bow = deckMomentFor(patrol, patrolWorld, arrival(0, { arrived: true }), 1)!
    expect(bow.extent).toBe('bow')
    expect(bow.title).toBe('DECK 0 · Head')
    expect(bow.bowWard).toBeNull()
    expect(bow.driveWard).toEqual({ deckId: 'crew', name: 'Crew deck' })
    const drive = deckMomentFor(patrol, patrolWorld, arrival(4, { arrived: true }), 3)!
    expect(drive.extent).toBe('drive')
    expect(drive.title).toBe('DECK 4 · Aft hold')
    expect(drive.driveWard).toBeNull()
    expect(drive.bowWard).toEqual({ deckId: 'engineering', name: 'Engineering' })
  })

  it('raises a moment on every deck of every canonical ship', () => {
    for (const fixture of SHIP_FIXTURES) {
      const ship = assembleShip(fixture.spec, { requireValidSpec: false })
      const world = navigationWorldOf(ship)
      const decks = wayfindingDecksOf(ship)
      for (const deck of decks) {
        const from = deck.deckIndex === 0 ? 1 : deck.deckIndex - 1
        const moment = deckMomentFor(
          ship,
          world,
          arrival(deck.deckIndex, { arrived: true, landed: true }),
          from,
        )
        expect(moment).not.toBeNull()
        expect(moment!.detail).toBe(deck.label)
        expect(moment!.title).toBe(deckMomentTitle(deck))
        expect(moment!.aboard.length).toBeGreaterThan(0)
      }
    }
  })

  it('holds a sign for a readable moment and clears it', () => {
    expect(MOMENT_HOLD_MS).toBe(4000)
  })
})

describe('M5-T1 hatch affordances', () => {
  const crewHatch = patrolWorld.hatches.find(
    (hatch) => hatch.id === 'crew-galley#0-spine-door',
  )!
  const crewDeck = patrolDecks[1]

  it('finds the crew spine hatch and names it in the ship’s terms', () => {
    expect(crewHatch).toBeDefined()
    expect(crewHatch.deckIndex).toBe(1)
    expect(crewHatch.socketId).toBe('spine-door')
    expect(hatchShortName(crewHatch)).toBe('spine hatch')
  })

  it('signs what the interact key will do from the leaf’s own state', () => {
    const shut = hatchAffordance(crewHatch, false, crewDeck)
    expect(shut.action).toBe('open')
    expect(shut.isOpen).toBe(false)
    expect(shut.text).toBe('E — open the spine hatch')
    expect(shut.detail).toBe('Crew deck · galley#0 · "spine-door"')
    expect(shut.hatchId).toBe('crew-galley#0-spine-door')
    const open = hatchAffordance(crewHatch, true, crewDeck)
    expect(open.action).toBe('close')
    expect(open.isOpen).toBe(true)
    expect(open.text).toBe('E — close the spine hatch')
  })

  it('names the other socket kinds and falls back when the deck is unknown', () => {
    const highHatch = patrolWorld.hatches.find(
      (hatch) => hatch.socketId === 'high-hatch',
    )
    expect(highHatch).toBeDefined()
    expect(hatchShortName(highHatch!)).toBe('high hatch')
    const beforePatch = { ...crewHatch, socketId: 'side-door' }
    expect(hatchShortName(beforePatch)).toBe('side hatch')
    const unknown = hatchAffordance(crewHatch, false, null)
    expect(unknown.detail).toBe('deck 1 "crew" · galley#0 · "spine-door"')
    expect(HATCH_BLOCKED_NOTICE).toBe('the hatch will not close on you')
  })

  it('signs every hatch of every canonical ship, both states', () => {
    for (const fixture of SHIP_FIXTURES) {
      const ship = assembleShip(fixture.spec, { requireValidSpec: false })
      const world = navigationWorldOf(ship)
      const decks = wayfindingDecksOf(ship)
      expect(world.hatches.length).toBeGreaterThan(0)
      for (const hatch of world.hatches) {
        const deck = decks.find((candidate) => candidate.deckIndex === hatch.deckIndex)!
        const shut = hatchAffordance(hatch, false, deck)
        const open = hatchAffordance(hatch, true, deck)
        expect(shut.text).toMatch(/^E — open the .+ hatch$/)
        expect(open.text).toMatch(/^E — close the .+ hatch$/)
        expect(shut.detail).toContain(deck.name)
      }
    }
  })
})

describe('M5-T1 wayfinding gate', () => {
  it('signs every canonical ship — the three real ships and the QA rig', () => {
    for (const fixture of SHIP_FIXTURES) {
      const ship = assembleShip(fixture.spec, { requireValidSpec: false })
      const world = navigationWorldOf(ship)
      expect(wayfindingProblems(ship, world)).toEqual([])
    }
  })

  it('is clean on the three real ships when read the way the app reads them', () => {
    for (const fixture of expectValidFixtures()) {
      const ship = assembleShip(fixture.spec, { requireValidSpec: false })
      const world = navigationWorldOf(ship)
      const indicator = deckIndicatorOf(ship, world, 1)
      expect(indicator.rows).toHaveLength(fixture.spec.decks.length)
      expect(wayfindingProblems(ship, world)).toEqual([])
    }
  })

  it('catches a deck with no label to sign', () => {
    // Injected on the assembled ship: assembleShip validates specs, so a real
    // spec could never carry a blank label — the check's own rule is what is
    // under test here.
    const ship = {
      ...patrol,
      decks: patrol.decks.map((deck, index) =>
        index === 1 ? { ...deck, label: '   ' } : deck,
      ),
    }
    const problems = wayfindingProblems(ship, patrolWorld)
    expect(problems.some((line) => line.includes('has no label to sign'))).toBe(true)
    expect(problems.some((line) => line.includes('with no name in it'))).toBe(true)
  })

  it('catches a deck that seats no room — a sign with nothing to name', () => {
    const ship = {
      ...patrol,
      decks: patrol.decks.map((deck, index) =>
        index === 2 ? { ...deck, modules: [deck.band] } : deck,
      ),
    }
    const problems = wayfindingProblems(ship, patrolWorld)
    expect(problems.some((line) => line.includes('seats no room'))).toBe(true)
  })

  it('catches a room whose kit manifest has no label to put on the sign', () => {
    const unnamed = AUTHORED_MODULES.map((module) =>
      module.manifest.id === 'galley'
        ? { ...module, manifest: { ...module.manifest, label: '   ' } }
        : module,
    )
    const ship = assembleShip(PATROL_SPEC, { modules: unnamed })
    const problems = wayfindingProblems(ship, navigationWorldOf(ship))
    expect(problems.some((line) => line.includes('names an unnamed room'))).toBe(true)
  })

  it('catches duplicated and unknown-deck hatches', () => {
    const first = patrolWorld.hatches[0]
    const doubled = wayfindingProblems(patrol, {
      ...patrolWorld,
      hatches: [first, first],
    })
    expect(
      doubled.some((line) => line.includes(`two hatches share the id "${first.id}"`)),
    ).toBe(true)
    const ghostDeck = wayfindingProblems(patrol, {
      ...patrolWorld,
      hatches: [{ ...first, deckIndex: 9 }],
    })
    expect(
      ghostDeck.some((line) => line.includes('which the deck stack does not know')),
    ).toBe(true)
  })

  it('catches a ladder mark that lands on a deck the stack does not know', () => {
    const doctored = wayfindingProblems(patrol, {
      ...patrolWorld,
      runs: [
        {
          ...patrolWorld.runs[0],
          lowerDeckIndex: 1,
          lowerDeckId: 'crew',
          upperDeckIndex: 9,
          upperDeckId: 'ghost',
        },
      ],
    })
    expect(
      doctored.some((line) =>
        line.includes('lands on deck 9, which the deck stack does not know'),
      ),
    ).toBe(true)
  })

  it('reports a shipless ship rather than inventing a sign for it', () => {
    expect(wayfindingProblems({ ...patrol, decks: [] }, patrolWorld)).toEqual([
      'the ship has no decks — there is nothing to sign',
    ])
  })
})
