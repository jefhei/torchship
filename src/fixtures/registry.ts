/**
 * M0-T5 — canonical ship fixture registry.
 *
 * The four fixtures BUILD_PLAN M0-T5 checks in, in canonical order. This
 * registry is the single entry point M0-T6 invariant stubs, the M1-T3
 * validator and the M3 assembler run against — never an ad-hoc scene
 * (BUILD_PLAN execution rule 5). The three real ships (patrol, long-haul,
 * science) must pass the validator and every [auto] invariant; the stress
 * rig is the deliberate negative fixture the validator must REJECT.
 */

import type { ShipSpec } from '../types'
import { LONG_HAUL_SPEC } from './longHaul'
import { PATROL_SPEC } from './patrol'
import { SCIENCE_SPEC } from './science'
import { STRESS_SPEC } from './stress'

/** Canonical fixture ids, in registry order. */
export const FIXTURE_IDS = ['patrol', 'long-haul', 'science', 'stress'] as const

/** One of the canonical fixture ids. */
export type FixtureId = (typeof FIXTURE_IDS)[number]

/** A canonical test ship (or the negative stress rig) with its metadata. */
export interface ShipFixture {
  id: FixtureId
  /** Short preset label, e.g. 'Patrol'. */
  label: string
  /** One-line description of the ship / what the fixture proves. */
  description: string
  /**
   * true = a real ship: must pass the M1-T3 spec validator and every [auto]
   * invariant. false = the negative offset-hatch stress rig: the validator
   * must REJECT it (carries the M0-T2 decision-3 reject cases).
   */
  expectValid: boolean
  spec: ShipSpec
}

/** The four canonical fixtures, in registry order (patrol → stress). */
export const SHIP_FIXTURES: readonly ShipFixture[] = [
  {
    id: 'patrol',
    label: 'Patrol',
    description:
      'Default 5-deck corvette — the hero ship, Hound-class "Firebrand". One room per deck, every kit module type exercised once; spawn on the crew deck (index 1) at the foot of the spine.',
    expectValid: true,
    spec: PATROL_SPEC,
  },
  {
    id: 'long-haul',
    label: 'Long-Haul',
    description:
      'Stretched cargo variant: Patrol plus a second aft storage deck (six decks). Proves repeated instances of one module type (storage ×2) assemble from one spec.',
    expectValid: true,
    spec: LONG_HAUL_SPEC,
  },
  {
    id: 'science',
    label: 'Science',
    description:
      'Retrofit surveyor: the aft hold is replaced by a science deck reusing the ops module as the expanded med bay / sensor suite. Proves one kit module serves two roles (ops ×2).',
    expectValid: true,
    spec: SCIENCE_SPEC,
  },
  {
    id: 'stress',
    label: 'Offset-hatch stress',
    description:
      'Negative fixture: five-deck rig carrying the M0-T2 decision-3 reject cases (≥10 mm offsets, 1.2 m high-hatch mated to a 1.0 m door, floor-pin + deck-grid violations) plus one clean control deck. The validator must reject it; see STRESS_DEFECTS in stress.ts.',
    expectValid: false,
    spec: STRESS_SPEC,
  },
]

/** Look up a fixture by id; throws on unknown ids (typos surface early). */
export function getShipFixture(id: FixtureId): ShipFixture {
  const f = SHIP_FIXTURES.find((x) => x.id === id)
  if (!f) throw new Error(`fixtures: no canonical ship "${id}"`)
  return f
}

/** The real ships — the fixtures every [auto] invariant must pass. */
export function expectValidFixtures(): ShipFixture[] {
  return SHIP_FIXTURES.filter((f) => f.expectValid)
}
