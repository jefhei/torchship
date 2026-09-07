/**
 * M0-T5 — canonical test ships: they exist, load, and are what they claim.
 *
 * Covers (BUILD_PLAN M0-T5 machine gate "fixtures load"):
 *  - the registry exposes exactly the four canonical fixtures in order;
 *  - every fixture is structurally sound typed data (unique deck ids, all
 *    decks populated, only kit room module ids, nose→aft floor descent,
 *    JSON-round-trippable plain data — M1-T3's preset JSON source);
 *  - the three real ships are canonical: 5/6/5-deck characters as declared,
 *    crew deck (galley, spawn) at index 1, deck floors on the canonical
 *    grid, every module ref floor-pinned and flush on the spine +z face;
 *  - the stress rig is the deliberate negative fixture: five declared
 *    defects (STRESS_DEFECTS) at the M0-T2 measured magnitudes, one clean
 *    control deck, flagged expectValid: false.
 *
 * Socket-level join math (residuals vs the ±tolerance caps) is NOT checked
 * here — that is the M1-T3 validator's job over kit geometry; this file
 * pins the spec-level data the validator will consume.
 */

import { describe, expect, it } from 'vitest'
import {
  FIXTURE_IDS,
  LONG_HAUL_SPEC,
  PATROL_SPEC,
  ROOM_MODULE_IDS,
  SCIENCE_SPEC,
  SHIP_FIXTURES,
  STRESS_DEFECTS,
  STRESS_SPEC,
  atSpine,
  expectValidFixtures,
  getShipFixture,
  spineAttachOffsetZ,
} from '../fixtures'
import type { ModuleRef, ShipSpec } from '../types'
import type { RoomModuleId } from '../fixtures'
import { deckFloorYFor } from '../types'

function refsOf(spec: ShipSpec): ModuleRef[] {
  return spec.decks.flatMap((d) => d.modules)
}

/** Deck floors must descend strictly (each lower than the one nose-ward). */
function floorYsDescend(spec: ShipSpec): boolean {
  for (let i = 1; i < spec.decks.length; i++) {
    if (!(spec.decks[i].yPosition < spec.decks[i - 1].yPosition)) return false
  }
  return true
}

describe('fixture registry', () => {
  it('lists the four canonical fixtures in order patrol → stress', () => {
    expect(SHIP_FIXTURES.map((f) => f.id)).toEqual([...FIXTURE_IDS])
    expect(SHIP_FIXTURES).toHaveLength(4)
  })

  it('gives every fixture a label and a description', () => {
    for (const f of SHIP_FIXTURES) {
      expect(f.label.length).toBeGreaterThan(0)
      expect(f.description.length).toBeGreaterThan(0)
    }
  })

  it('getShipFixture finds each fixture and throws on unknown ids', () => {
    for (const id of FIXTURE_IDS) {
      expect(getShipFixture(id).id).toBe(id)
    }
    expect(getShipFixture('patrol').spec).toBe(PATROL_SPEC)
    expect(() => getShipFixture('frigate' as never)).toThrow(/no canonical ship/)
  })

  it('expectValidFixtures returns exactly the three real ships', () => {
    expect(expectValidFixtures().map((f) => f.id)).toEqual([
      'patrol',
      'long-haul',
      'science',
    ])
    expect(getShipFixture('stress').expectValid).toBe(false)
  })
})

describe('fixture structure (all four)', () => {
  it('every fixture carries full identity fields', () => {
    for (const f of SHIP_FIXTURES) {
      expect(f.spec.classId.length).toBeGreaterThan(0)
      expect(f.spec.name.length).toBeGreaterThan(0)
      expect(f.spec.registry.length).toBeGreaterThan(0)
      expect(Number.isFinite(f.spec.seed)).toBe(true)
    }
    expect(PATROL_SPEC.name).toBe('Firebrand')
  })

  it('every deck has a unique id and at least one module', () => {
    for (const f of SHIP_FIXTURES) {
      const ids = f.spec.decks.map((d) => d.id)
      expect(new Set(ids).size).toBe(ids.length)
      for (const d of f.spec.decks) {
        expect(d.modules.length).toBeGreaterThan(0)
        expect(d.label.length).toBeGreaterThan(0)
      }
    }
  })

  it('references only the five room module ids (spine is never referenced)', () => {
    for (const f of SHIP_FIXTURES) {
      for (const m of refsOf(f.spec)) {
        expect(ROOM_MODULE_IDS).toContain(m.moduleId)
      }
    }
  })

  it('deck floors descend strictly nose → aft', () => {
    for (const f of SHIP_FIXTURES) {
      expect(floorYsDescend(f.spec)).toBe(true)
    }
  })

  it('specs are plain data: JSON round-trip is lossless', () => {
    for (const f of SHIP_FIXTURES) {
      expect(JSON.parse(JSON.stringify(f.spec))).toStrictEqual(f.spec)
    }
  })
})

describe('patrol — the 5-deck hero ship', () => {
  it('has five decks, one room each, in canonical nose→aft order', () => {
    expect(PATROL_SPEC.decks).toHaveLength(5)
    expect(PATROL_SPEC.decks.map((d) => d.id)).toEqual([
      'head',
      'crew',
      'ops',
      'engineering',
      'aft',
    ])
    expect(PATROL_SPEC.decks.map((d) => d.modules[0].moduleId)).toEqual([
      'head',
      'galley',
      'ops',
      'engineering',
      'storage',
    ])
    expect(PATROL_SPEC.decks.every((d) => d.modules.length === 1)).toBe(true)
  })

  it('places the galley crew deck at index 1 (the spawn deck)', () => {
    const crew = PATROL_SPEC.decks[1]
    expect(crew.id).toBe('crew')
    expect(crew.modules[0].moduleId).toBe('galley')
  })
})

describe('long-haul & science variants', () => {
  it('long-haul stretches patrol with a second aft storage deck', () => {
    expect(LONG_HAUL_SPEC.decks).toHaveLength(6)
    expect(LONG_HAUL_SPEC.decks.map((d) => d.modules[0].moduleId)).toEqual([
      'head',
      'galley',
      'ops',
      'engineering',
      'storage',
      'storage',
    ])
    expect(LONG_HAUL_SPEC.decks[5].id).toBe('cargo-b')
  })

  it('science swaps the aft hold for an ops-module science deck', () => {
    expect(SCIENCE_SPEC.decks).toHaveLength(5)
    expect(SCIENCE_SPEC.decks.map((d) => d.modules[0].moduleId)).toEqual([
      'head',
      'galley',
      'ops',
      'ops',
      'engineering',
    ])
    expect(SCIENCE_SPEC.decks[3].id).toBe('science')
    // Engineering is still the aft-most deck: the reactor sits above the drive.
    expect(SCIENCE_SPEC.decks[4].modules[0].moduleId).toBe('engineering')
  })

  it('every real ship keeps the galley crew deck at index 1', () => {
    for (const f of expectValidFixtures()) {
      expect(f.spec.decks[1].modules[0].moduleId).toBe('galley')
    }
  })
})

describe('canonical layout (real ships)', () => {
  it('puts every deck floor on the canonical grid', () => {
    for (const f of expectValidFixtures()) {
      f.spec.decks.forEach((d, i) => {
        expect(d.yPosition).toBe(deckFloorYFor(i))
      })
    }
  })

  it('floor-pins every module ref flush on the spine +z face', () => {
    for (const f of expectValidFixtures()) {
      for (const m of refsOf(f.spec)) {
        expect(m.offset[1]).toBe(0)
        expect(m.offset[0]).toBe(0)
        expect(m.offset[2]).toBe(spineAttachOffsetZ(m.moduleId as RoomModuleId))
        expect(m.rotation).toBe(0)
        expect(m).toEqual(atSpine(m.moduleId as RoomModuleId))
      }
    }
  })

  it('attaches module centers at half-depth + spine half-width', () => {
    // Spot-check the geometry the offsets encode: the spine shaft center
    // line is the deck-local origin, and a rotation-0 room's spine-door
    // (its local −z face) lands flush on the shaft's +z face at z = 0.7.
    expect(PATROL_SPEC.decks[0].modules[0].offset[2]).toBeCloseTo(0.7 + 3.6 / 2, 12)
    expect(PATROL_SPEC.decks[1].modules[0].offset[2]).toBeCloseTo(0.7 + 5.0 / 2, 12)
    expect(PATROL_SPEC.decks[4].modules[0].offset[2]).toBeCloseTo(0.7 + 6.0 / 2, 12)
  })
})

describe('stress rig — the negative fixture', () => {
  it('is a five-deck rig whose control deck is clean', () => {
    expect(STRESS_SPEC.decks).toHaveLength(5)
    expect(STRESS_SPEC.decks[0].id).toBe('rig-0')
    expect(STRESS_SPEC.decks[0].modules).toEqual([atSpine('head')])
  })

  it('declares one defect of every reject category on rig-1..rig-4', () => {
    expect(STRESS_DEFECTS).toHaveLength(5)
    expect(new Set(STRESS_DEFECTS.map((d) => d.id)).size).toBe(5)
    expect(STRESS_DEFECTS.map((d) => d.kind).sort()).toEqual(
      [
        'normal-offset',
        'lateral-offset',
        'hatch-height',
        'floor-pin',
        'deck-grid',
      ].sort(),
    )
    const deckIds = new Set(STRESS_SPEC.decks.map((d) => d.id))
    for (const d of STRESS_DEFECTS) {
      expect(deckIds.has(d.deckId)).toBe(true)
      expect(d.detail.length).toBeGreaterThan(0)
    }
    // No defect claims the control deck.
    expect(STRESS_DEFECTS.every((d) => d.deckId !== 'rig-0')).toBe(true)
  })

  it('rig-1: head door 10 mm proud of the spine face (open seam)', () => {
    const ref = STRESS_SPEC.decks[1].modules[0]
    expect(ref.moduleId).toBe('head')
    expect(ref.offset[2] - spineAttachOffsetZ('head')).toBeCloseTo(10e-3, 9)
    expect(ref.offset[0]).toBe(0)
  })

  it('rig-2: ops door 25 mm off the spine socket center (misalignment)', () => {
    const ref = STRESS_SPEC.decks[2].modules[0]
    expect(ref.moduleId).toBe('ops')
    expect(ref.offset[0]).toBeCloseTo(25e-3, 9)
    expect(ref.offset[2]).toBe(spineAttachOffsetZ('ops'))
  })

  it('rig-3: engineering at spine, ops 4.2 m +x / 1.6 m +z (hatch mate)', () => {
    const [eng, ops] = STRESS_SPEC.decks[3].modules
    expect(eng).toEqual(atSpine('engineering'))
    expect(ops.moduleId).toBe('ops')
    expect(ops.offset[1]).toBe(0)
    expect(ops.offset[0] - eng.offset[0]).toBeCloseTo(4.2, 9)
    expect(ops.offset[2] - eng.offset[2]).toBeCloseTo(1.6, 9)
  })

  it('rig-4: floor-pin violation and an off-grid deck floor', () => {
    const deck = STRESS_SPEC.decks[4]
    expect(deck.yPosition).toBe(-12.75)
    expect(Math.abs(deck.yPosition - deckFloorYFor(4))).toBeCloseTo(50e-3, 9)
    const ref = deck.modules[0]
    expect(ref.moduleId).toBe('galley')
    expect(ref.offset[1]).toBeCloseTo(200e-3, 9)
    expect(ref.offset[2]).toBe(spineAttachOffsetZ('galley'))
  })

  it('keeps the floor-pinned violation isolated to the declared deck', () => {
    // Every non-declared ref on the rig is otherwise canonical.
    const declared = new Set(
      STRESS_DEFECTS.filter((d) => d.kind === 'floor-pin').map((d) => d.deckId),
    )
    for (const deck of STRESS_SPEC.decks) {
      for (const m of deck.modules) {
        expect(m.rotation).toBe(0)
        if (!declared.has(deck.id)) {
          expect(m.offset[1]).toBe(0)
        }
      }
    }
  })
})
