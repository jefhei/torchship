/**
 * M1-T3 — Ship Spec validator tests (schema, socket alignment, spine graph).
 *
 * Pins (BUILD_PLAN M1-T3 machine gate "spec validator passes on all four
 * fixtures", read via the M0-T5 registry's expectValid):
 *  - the contract white-box kit (CONTRACT_KIT) is a genuine KitManifest that
 *    passes the M1-T2 integrity checker and reproduces the contract dims
 *    (ROOM_FOOTPRINTS) and the M0-T2 socket origins (spike kit table) the
 *    fixtures were authored against — spine doors flush at −depth/2,
 *    engineering's 1.2 m high-hatch is the one non-standard door;
 *  - world-space socket resolution is exact: canonical spine doors land on
 *    their band sockets at 0.000 mm on every M0-T2 channel, rotated modules
 *    land on the opposing band face, side doors resolve to their authored
 *    world poses;
 *  - the validator ACCEPTS the three real ships (empty problem set) and
 *    REJECTS the stress rig, naming every declared STRESS_DEFECTS category
 *    (10 mm proud / 25 mm lateral / 200 mm door-center step / floor-pin /
 *    off-grid deck) at its deck;
 *  - schema rules catch synthetic violations (identity, deck order, grid,
 *    unknown modules, floor-pin, rotation);
 *  - socket rules catch synthetic mis-seats (normal/lateral/vertical),
 *    misaligned module-to-module pairs, and doors opening onto blank walls
 *    (dangling), while legal blanked side doors pass;
 *  - the socket-resolved spine connectivity graph agrees with the M0-T6
 *    live spec-level check on all four fixtures.
 */

import { describe, expect, it } from 'vitest'
import {
  CONTRACT_KIT,
  assertValidShipSpec,
  doorCenterDeviationMm,
  doorTallies,
  hatchAlignmentProblems,
  isValidShipSpec,
  moduleDoors,
  moduleLandingProblems,
  openingsOverlap,
  oppositeFacing,
  schemaProblems,
  shipSpecProblems,
  spineBandDoors,
  spineConnectivityProblems,
} from '../validation'
import type { KitManifest, ModuleRef, ShipSpec, DeckSpec } from '../types'
import {
  LONG_HAUL_SPEC,
  PATROL_SPEC,
  SCIENCE_SPEC,
  STRESS_DEFECTS,
  STRESS_SPEC,
  atSpine,
  expectValidFixtures,
  spineAttachOffsetZ,
} from '../fixtures'
import { MM, deckFloorYFor, kitManifestProblems } from '../types'
import { checkSpineConnectivity } from '../invariants'
import { SEAM_TOLERANCES } from '../spikes/seams/tolerances'

/* ---------- helpers ------------------------------------------------ */

/** A deck holding the given module refs at a world floor Y. */
function deckAt(id: string, y: number, modules: ModuleRef[]): DeckSpec {
  return { id, label: `${id} deck`, yPosition: y, modules }
}

/** A single-deck spec (deck 0) — enough for socket-rule tests. */
function singleDeckSpec(deck: DeckSpec): ShipSpec {
  return {
    classId: 'hound',
    name: 'OneDeck',
    registry: 'TEST-1',
    seed: 0,
    decks: [deck],
  }
}

/** The canonical three-deck mini ship (head → crew/galley → engineering). */
function miniThree(): ShipSpec {
  return {
    classId: 'hound',
    name: 'Mini',
    registry: 'MINI-1',
    seed: 0,
    decks: [
      deckAt('head', deckFloorYFor(0), [atSpine('head')]),
      deckAt('crew', deckFloorYFor(1), [atSpine('galley')]),
      deckAt('engineering', deckFloorYFor(2), [atSpine('engineering')]),
    ],
  }
}

/** CONTRACT_KIT minus engineering's high-hatch (a blank +x wall there). */
const KIT_WITHOUT_HATCH: KitManifest = {
  modules: CONTRACT_KIT.modules.map((m) =>
    m.id === 'engineering'
      ? { ...m, doorSockets: m.doorSockets.filter((s) => s.id !== 'high-hatch') }
      : m,
  ),
}

/** STRESS rig-3 as a standalone deck (engineering + side-mated ops). */
const RIG3_DECK = STRESS_SPEC.decks[3]

/* ---------- contract kit ------------------------------------------- */

describe('CONTRACT_KIT — the fixture-time white-box manifest', () => {
  it('is a genuine KitManifest passing the M1-T2 integrity checker', () => {
    expect(kitManifestProblems(CONTRACT_KIT)).toEqual([])
    expect(CONTRACT_KIT.modules.map((m) => m.id)).toEqual([
      'head',
      'galley',
      'ops',
      'engineering',
      'storage',
    ])
  })

  it('reproduces the contract dims from ROOM_FOOTPRINTS', () => {
    const dims = (id: string) =>
      CONTRACT_KIT.modules.find((m) => m.id === id)!.dimensions
    expect(dims('head')).toEqual([4.8, 3.0, 3.6])
    expect(dims('galley')).toEqual([4.2, 3.0, 5.0])
    expect(dims('ops')).toEqual([3.9, 3.0, 4.6])
    expect(dims('engineering')).toEqual([4.5, 3.0, 4.8])
    expect(dims('storage')).toEqual([4.0, 3.0, 6.0])
  })

  it('puts every spine door flush on the −z face at the standard 1.0 m center', () => {
    const spineDoor = (id: string) =>
      CONTRACT_KIT.modules
        .find((m) => m.id === id)!
        .doorSockets.find((s) => s.id === 'spine-door')!
    // Origins must match the M0-T2 spike table exactly (half-depth on −z).
    const expectedZ: Record<string, number> = {
      head: -1.8,
      galley: -2.5,
      ops: -2.3,
      engineering: -2.4,
      storage: -3.0,
    }
    for (const [id, z] of Object.entries(expectedZ)) {
      const door = spineDoor(id)
      expect(door.position).toEqual([0, SEAM_TOLERANCES.standardDoorCenterM, z])
      expect(door.facing).toBe('-z')
      expect(door.door).toBeUndefined() // standard 0.9 × 2.0
    }
  })

  it('reproduces the M0-T2 side-socket origins and the one non-standard door', () => {
    const doorsOf = (id: string) =>
      CONTRACT_KIT.modules
        .find((m) => m.id === id)!
        .doorSockets.filter((s) => s.id !== 'spine-door')
    expect(doorsOf('head')).toEqual([])
    expect(doorsOf('galley')).toEqual([
      { id: 'side-door', position: [2.1, 1.0, 1.2], facing: '+x' },
    ])
    expect(doorsOf('ops')).toEqual([
      { id: 'side-door', position: [-1.95, 1.0, -1.0], facing: '-x' },
    ])
    expect(doorsOf('engineering')).toEqual([
      {
        id: 'high-hatch',
        position: [2.25, 1.2, 0.6],
        facing: '+x',
        door: { width: 0.8, height: 1.6 },
      },
    ])
    expect(doorsOf('storage')).toEqual([
      { id: 'side-door', position: [2.0, 1.0, 1.0], facing: '+x' },
    ])
    // Engineering's high-hatch is the ONLY non-standard door center (+0.2 m).
    const nonStandard = CONTRACT_KIT.modules.flatMap((m) =>
      m.doorSockets
        .filter((s) => s.position[1] !== SEAM_TOLERANCES.standardDoorCenterM)
        .map((s) => `${m.id}.${s.id}`),
    )
    expect(nonStandard).toEqual(['engineering.high-hatch'])
  })
})

/* ---------- socket resolution --------------------------------------- */

describe('world-space socket resolution', () => {
  it('places spine-band doors at the shaft faces on the deck floor grid', () => {
    const patrol0 = PATROL_SPEC.decks[0] // floor Y 0
    const band = spineBandDoors(patrol0, 0)
    const byFace = Object.fromEntries(band.map((d) => [d.socketId, d]))
    expect(Object.keys(byFace).sort()).toEqual(['+x', '+z', '-x', '-z'])
    expect(byFace['+z'].center).toEqual([0, 1.0, 0.7])
    expect(byFace['-z'].center).toEqual([0, 1.0, -0.7])
    expect(byFace['+x'].center).toEqual([0.7, 1.0, 0])
    expect(byFace['-x'].center).toEqual([-0.7, 1.0, 0])
    for (const d of Object.values(byFace)) {
      expect(d.width).toBe(0.9)
      expect(d.height).toBe(2.0)
      expect(d.facing).toBe(d.socketId)
    }
    // Deck 2's band sits one pitch lower (3.2 m) — bands stack floor-to-floor.
    const band2 = spineBandDoors(PATROL_SPEC.decks[2], 2)
    expect(band2.find((d) => d.socketId === '+z')!.center[1]).toBeCloseTo(-5.4, 12)
  })

  it('resolves a canonical spine door exactly onto its band socket (0.000 mm)', () => {
    const deck0 = PATROL_SPEC.decks[0]
    const head = moduleDoors(deck0, 0, deck0.modules[0], 0, CONTRACT_KIT)
    const spine = head.find((d) => d.socketId === 'spine-door')!
    expect(spine.center).toEqual([0, 1.0, 0.7]) // the band +z socket center
    expect(spine.facing).toBe('-z')
    const band = spineBandDoors(deck0, 0).find((d) => d.socketId === '+z')!
    const dev = doorCenterDeviationMm(band, spine)
    expect(dev).toEqual({ normalMm: 0, lateralMm: 0, verticalMm: 0 })
  })

  it('resolves room side doors to their authored world poses', () => {
    const crew = PATROL_SPEC.decks[1] // galley, floor −3.2, z-center 3.2
    const galley = moduleDoors(crew, 1, crew.modules[0], 0, CONTRACT_KIT)
    const side = galley.find((d) => d.socketId === 'side-door')!
    expect(side.center).toEqual([2.1, -2.2, 4.4]) // origin + rotY([2.1, 1, 1.2])
    expect(side.facing).toBe('+x')
    expect(side.width).toBe(0.9)
    expect(side.height).toBe(2.0)
  })

  it('rotates module sockets with the ref (a 180° head lands on the −z band face)', () => {
    const rotated: ModuleRef = {
      moduleId: 'head',
      rotation: 2,
      offset: [0, 0, -(0.7 + 3.6 / 2)], // mirror pose: flush on the −z face
    }
    const deck = deckAt('head', deckFloorYFor(0), [rotated])
    const doors = moduleDoors(deck, 0, rotated, 0, CONTRACT_KIT)
    const spine = doors.find((d) => d.socketId === 'spine-door')!
    expect(spine.center).toEqual([0, 1.0, -0.7])
    expect(spine.facing).toBe('+z')
    const bandMinusZ = spineBandDoors(deck, 0).find((d) => d.socketId === '-z')!
    expect(doorCenterDeviationMm(bandMinusZ, spine)).toEqual({
      normalMm: 0,
      lateralMm: 0,
      verticalMm: 0,
    })
    // The rotated module seats with no landing problems.
    expect(moduleLandingProblems(deck, 0, rotated, 0, CONTRACT_KIT)).toEqual([])
  })

  it('measures the stress magnitudes exactly at socket level (10 / 25 / 200 mm)', () => {
    const bandOf = (deckIndex: number) =>
      spineBandDoors(STRESS_SPEC.decks[deckIndex], deckIndex).find(
        (d) => d.socketId === '+z',
      )!
    // rig-1: head spine door 10 mm proud along the join normal.
    const rig1Door = moduleDoors(
      STRESS_SPEC.decks[1],
      1,
      STRESS_SPEC.decks[1].modules[0],
      0,
      CONTRACT_KIT,
    )[0]
    expect(doorCenterDeviationMm(bandOf(1), rig1Door).normalMm).toBe(10)
    // rig-2: ops spine door 25 mm lateral.
    const rig2Door = moduleDoors(
      STRESS_SPEC.decks[2],
      2,
      STRESS_SPEC.decks[2].modules[0],
      0,
      CONTRACT_KIT,
    )[0]
    expect(doorCenterDeviationMm(bandOf(2), rig2Door).lateralMm).toBe(25)
    // rig-4: galley lifted 0.2 m off the deck plate → 200 mm vertical.
    const rig4Door = moduleDoors(
      STRESS_SPEC.decks[4],
      4,
      STRESS_SPEC.decks[4].modules[0],
      0,
      CONTRACT_KIT,
    )[0]
    expect(doorCenterDeviationMm(bandOf(4), rig4Door).verticalMm).toBe(200)
  })

  it('reports opening overlap only for pass-through-compatible doors', () => {
    // rig-3's pair: high-hatch × ops side-door overlap in their shared wall.
    const [eng, ops] = RIG3_DECK.modules
    const engDoors = moduleDoors(RIG3_DECK, 3, eng, 0, CONTRACT_KIT)
    const opsDoors = moduleDoors(RIG3_DECK, 3, ops, 1, CONTRACT_KIT)
    const hatch = engDoors.find((d) => d.socketId === 'high-hatch')!
    const side = opsDoors.find((d) => d.socketId === 'side-door')!
    expect(side.facing).toBe(oppositeFacing(hatch.facing))
    expect(openingsOverlap(hatch, side)).toBe(true)
    // A spine door 4.2 m down the face does not overlap the band opening.
    const farDoor = moduleDoors(RIG3_DECK, 3, ops, 1, CONTRACT_KIT)[0] // ops spine door
    const bandZ = spineBandDoors(RIG3_DECK, 3).find((d) => d.socketId === '+z')!
    expect(openingsOverlap(bandZ, farDoor)).toBe(false)
  })
})

/* ---------- schema rules -------------------------------------------- */

describe('schema rules', () => {
  it('passes clean canonical specs and catches empty identity fields', () => {
    expect(schemaProblems(miniThree(), CONTRACT_KIT)).toEqual([])
    const noName = { ...miniThree(), name: '' }
    expect(schemaProblems(noName, CONTRACT_KIT).join(' ')).toMatch(/ship name is empty/)
    const noClass = { ...miniThree(), classId: '' }
    expect(schemaProblems(noClass, CONTRACT_KIT).join(' ')).toMatch(/classId is empty/)
  })

  it('rejects duplicate and empty deck ids, empty labels, empty decks', () => {
    const dup: ShipSpec = {
      ...miniThree(),
      decks: [miniThree().decks[0], { ...miniThree().decks[1], id: 'head' }],
    }
    expect(schemaProblems(dup, CONTRACT_KIT).join(' ')).toMatch(
      /deck id "head" is duplicated/,
    )
    const empty = deckAt('void', 0, [])
    expect(schemaProblems(singleDeckSpec(empty), CONTRACT_KIT).join(' ')).toMatch(
      /has no modules/,
    )
  })

  it('rejects floors that do not descend nose → aft', () => {
    const flat: ShipSpec = {
      ...miniThree(),
      decks: [
        deckAt('head', 0, [atSpine('head')]),
        deckAt('crew', 0, [atSpine('galley')]), // same floor as deck 0
      ],
    }
    expect(schemaProblems(flat, CONTRACT_KIT).join(' ')).toMatch(/not below deck 0/)
  })

  it('rejects deck floors off the canonical grid', () => {
    const offGrid: ShipSpec = {
      ...miniThree(),
      decks: [
        miniThree().decks[0],
        { ...miniThree().decks[1], yPosition: deckFloorYFor(1) + 50 * MM },
        miniThree().decks[2],
      ],
    }
    const text = schemaProblems(offGrid, CONTRACT_KIT).join(' ')
    expect(text).toMatch(/off the canonical grid/)
    expect(text).toMatch(/50\.0 mm step/)
  })

  it('rejects unknown kit modules and invalid rotations', () => {
    const unknown: ShipSpec = {
      ...miniThree(),
      decks: [deckAt('head', 0, [{ moduleId: 'lab', rotation: 0, offset: [0, 0, 1] }])],
    }
    expect(schemaProblems(unknown, CONTRACT_KIT).join(' ')).toMatch(
      /unknown kit module "lab"/,
    )
    const badRot: ShipSpec = {
      ...miniThree(),
      decks: [
        deckAt('head', 0, [
          { moduleId: 'head', rotation: 4 as never, offset: [0, 0, 0] },
        ]),
      ],
    }
    expect(schemaProblems(badRot, CONTRACT_KIT).join(' ')).toMatch(/rotation 4/)
  })

  it('rejects floor-pinned violations (offset.y reserved 0)', () => {
    const floated: ShipSpec = {
      ...miniThree(),
      decks: [
        deckAt('head', 0, [{ moduleId: 'head', rotation: 0, offset: [0, 0.2, 0] }]),
      ],
    }
    expect(schemaProblems(floated, CONTRACT_KIT).join(' ')).toMatch(
      /offset\.y = 0\.2 m — floor-pinned assembly violation/,
    )
  })
})

/* ---------- socket alignment rules ---------------------------------- */

describe('socket alignment rules (hatch-alignment)', () => {
  it('passes the canonical mini ship and real ships (side doors legally blanked)', () => {
    expect(hatchAlignmentProblems(miniThree(), CONTRACT_KIT)).toEqual([])
    for (const f of expectValidFixtures()) {
      expect(hatchAlignmentProblems(f.spec, CONTRACT_KIT)).toEqual([])
    }
  })

  it('catches a spine door 10 mm proud of the spine face (open seam)', () => {
    const proud: ShipSpec = singleDeckSpec(
      deckAt('rig', 0, [
        {
          moduleId: 'head',
          rotation: 0,
          offset: [0, 0, spineAttachOffsetZ('head') + 10 * MM],
        },
      ]),
    )
    const text = hatchAlignmentProblems(proud, CONTRACT_KIT).join(' ')
    expect(text).toMatch(/spine-door face is 10\.0 mm proud of the spine face/)
    expect(text).toMatch(/cap 5 mm/)
  })

  it('catches a spine door 25 mm off laterally (hatch misalignment)', () => {
    const lateral: ShipSpec = singleDeckSpec(
      deckAt('rig', 0, [
        {
          moduleId: 'ops',
          rotation: 0,
          offset: [25 * MM, 0, spineAttachOffsetZ('ops')],
        },
      ]),
    )
    expect(hatchAlignmentProblems(lateral, CONTRACT_KIT).join(' ')).toMatch(
      /spine-door center is 25\.0 mm off the spine socket center laterally/,
    )
  })

  it('catches floor-pin drift as a vertical spine-door miss', () => {
    const drifted: ShipSpec = singleDeckSpec(
      deckAt('rig', 0, [
        {
          moduleId: 'galley',
          rotation: 0,
          offset: [0, 200 * MM, spineAttachOffsetZ('galley')],
        },
      ]),
    )
    expect(hatchAlignmentProblems(drifted, CONTRACT_KIT).join(' ')).toMatch(
      /spine-door center sits 200\.0 mm off the standard 1\.0 m height/,
    )
  })

  it('catches the rig-3 mating pair: high-hatch vs door, 200 mm step', () => {
    const problems = hatchAlignmentProblems(singleDeckSpec(RIG3_DECK), CONTRACT_KIT)
    const text = problems.join(' ')
    expect(text).toMatch(
      /engineering#0 socket "high-hatch" \(facing \+x\) faces ops#1 socket "side-door"/,
    )
    expect(text).toMatch(
      /door centers disagree by 200\.0 mm vertically \(door-center step\)/,
    )
  })

  it('flags a door opening onto a blank module wall as dangling', () => {
    // Same rig-3 pair, but engineering has NO high-hatch on its +x wall:
    // ops' side-door now opens into solid wall instead of a mating hatch.
    const problems = hatchAlignmentProblems(
      singleDeckSpec(RIG3_DECK),
      KIT_WITHOUT_HATCH,
    )
    const text = problems.join(' ')
    expect(text).toMatch(
      /ops#1 socket "side-door" \(facing -x\) opens onto the \+x wall of engineering#0/,
    )
    expect(text).toMatch(/dangling socket/)
  })

  it('does not flag the side-door when the opposing hatch exists (real rig-3)', () => {
    const text = hatchAlignmentProblems(singleDeckSpec(RIG3_DECK), CONTRACT_KIT).join(
      ' ',
    )
    expect(text).not.toMatch(/dangling socket/)
  })

  it('tallies spine doors vs blankable side sockets per ship', () => {
    expect(doorTallies(PATROL_SPEC, CONTRACT_KIT)).toEqual({
      spineDoors: 5,
      sideDoors: 4,
    })
    expect(doorTallies(LONG_HAUL_SPEC, CONTRACT_KIT)).toEqual({
      spineDoors: 6,
      sideDoors: 5,
    })
    expect(doorTallies(SCIENCE_SPEC, CONTRACT_KIT)).toEqual({
      spineDoors: 5,
      sideDoors: 4,
    })
    expect(doorTallies(miniThree(), CONTRACT_KIT)).toEqual({
      spineDoors: 3,
      sideDoors: 2, // galley side-door + engineering high-hatch on the mini
    })
  })
})

/* ---------- spine connectivity graph -------------------------------- */

describe('spine connectivity graph (socket-resolved)', () => {
  it('passes the real ships and the canonical mini ship', () => {
    expect(spineConnectivityProblems(miniThree(), CONTRACT_KIT)).toEqual([])
    for (const f of expectValidFixtures()) {
      expect(spineConnectivityProblems(f.spec, CONTRACT_KIT)).toEqual([])
    }
  })

  it('names the unseated decks of the stress rig (rig-1 / rig-2 / rig-4)', () => {
    const text = spineConnectivityProblems(STRESS_SPEC, CONTRACT_KIT).join(' ')
    expect(text).toMatch(/deck 1 \("rig-1"\): no module seated/)
    expect(text).toMatch(/deck 2 \("rig-2"\): no module seated/)
    expect(text).toMatch(/deck 4 \("rig-4"\): no module seated/)
    // rig-3 seats engineering (ops' own spine door is a hatch problem, not a
    // run break) and rig-0 is the clean control deck.
    expect(text).not.toMatch(/rig-0/)
    expect(text).not.toMatch(/deck 3 \("rig-3"\): no module seated/)
  })

  it('requires the §8 endpoints: head on deck 0, crew deck, engineering', () => {
    const headless: ShipSpec = {
      ...miniThree(),
      decks: [deckAt('crew0', 0, [atSpine('galley')]), miniThree().decks[1]],
    }
    expect(spineConnectivityProblems(headless, CONTRACT_KIT).join(' ')).toMatch(
      /does not host the head module/,
    )
    const noEng: ShipSpec = {
      ...miniThree(),
      decks: [miniThree().decks[0], miniThree().decks[1]],
    }
    expect(spineConnectivityProblems(noEng, CONTRACT_KIT).join(' ')).toMatch(
      /no deck hosts an engineering module/,
    )
    const single = singleDeckSpec(deckAt('head', 0, [atSpine('head')]))
    expect(spineConnectivityProblems(single, CONTRACT_KIT).join(' ')).toMatch(
      /no crew deck at index 1/,
    )
  })

  it('agrees with the M0-T6 live spec-level check on all four fixtures', () => {
    for (const f of [PATROL_SPEC, LONG_HAUL_SPEC, SCIENCE_SPEC, STRESS_SPEC]) {
      const resolved = spineConnectivityProblems(f, CONTRACT_KIT).length === 0
      const live = checkSpineConnectivity(f).status === 'pass'
      expect(resolved).toBe(live)
    }
  })
})

/* ---------- fixtures accept / reject -------------------------------- */

describe('the validator over the four canonical fixtures', () => {
  it('accepts every expectValid fixture (problem-free spec)', () => {
    for (const f of expectValidFixtures()) {
      expect(shipSpecProblems(f.spec)).toEqual([])
      expect(isValidShipSpec(f.spec)).toBe(true)
      expect(() => assertValidShipSpec(f.spec)).not.toThrow()
    }
  })

  it('rejects the stress rig, naming every declared defect category', () => {
    const problems = shipSpecProblems(STRESS_SPEC)
    const text = problems.join('\n')
    expect(problems.length).toBeGreaterThanOrEqual(5)
    expect(isValidShipSpec(STRESS_SPEC)).toBe(false)
    expect(() => assertValidShipSpec(STRESS_SPEC)).toThrow(
      /ship spec "Offspec" is invalid/,
    )

    const kindPatterns: Record<string, RegExp> = {
      'normal-offset': /deck 1 \("rig-1"\).*10\.0 mm proud/,
      'lateral-offset':
        /deck 2 \("rig-2"\).*25\.0 mm off the spine socket center laterally/,
      'hatch-height': /rig-3.*door centers disagree by 200\.0 mm vertically/,
      'floor-pin': /deck 4 \("rig-4"\).*floor-pinned assembly violation/,
      'deck-grid': /deck 4 \("rig-4"\).*off the canonical grid.*50\.0 mm step/,
    }
    for (const defect of STRESS_DEFECTS) {
      expect(text).toMatch(kindPatterns[defect.kind])
    }
  })

  it('keeps the stress control deck (rig-0) out of every problem', () => {
    const text = shipSpecProblems(STRESS_SPEC).join('\n')
    expect(text).not.toMatch(/rig-0/)
  })
})
