/**
 * M4-T2 — the practical-light archetype registry: the four recipes, their
 * physical derivation, the §4 anti-goal ceilings, and the fact that a fixture's
 * colour IS the tint its own lens is drawn with (the M4-T1 layer, read — never
 * a second palette).
 */

import { describe, expect, it } from 'vitest'
import { DEFAULT_MATERIAL_THEME, NO_EMISSION, type MaterialTheme } from '../materials'
import { slotSurface } from '../kit/render/slotSurfaces'
import type { LightKind } from '../types'
import {
  LIGHT_ARCHETYPES,
  LIGHT_INTENSITY_MAX,
  LIGHT_KINDS,
  LIGHT_TARGET_ILLUMINANCE_MAX,
  MAX_LIGHT_RANGE_M,
  RIG_AMBIENT_COLOR,
  RIG_AMBIENT_INTENSITY,
  RIG_AMBIENT_INTENSITY_MAX,
  SHADOW_LIGHTS_PER_DECK_MAX,
  assertLightArchetypesComplete,
  getLightArchetype,
  lightArchetypeProblems,
  lightArchetypesProblems,
  lightColorFor,
  rigAmbient,
  rigAmbientProblems,
  type LightArchetype,
} from './archetypes'

/** A theme with one §4 slot re-pointed at another set (the M4-T1 re-skin path). */
function withSlotSet(slot: 'panel-light' | 'screen', set: string): MaterialTheme {
  return {
    ...DEFAULT_MATERIAL_THEME,
    id: 'test-reskin',
    slots: { ...DEFAULT_MATERIAL_THEME.slots, [slot]: { set } },
  }
}

const PANEL = getLightArchetype('panel')
const TASK = getLightArchetype('task')
const SCREEN = getLightArchetype('screen')
const REACTOR = getLightArchetype('reactor')

describe('light archetypes (PRD §4 practical lighting, M4-T2)', () => {
  it('declares exactly the four §4 kinds, one archetype each, in order', () => {
    expect(LIGHT_KINDS).toEqual(['panel', 'task', 'screen', 'reactor'])
    expect(LIGHT_ARCHETYPES.map((a) => a.kind)).toEqual([...LIGHT_KINDS])
    expect(new Set(LIGHT_ARCHETYPES.map((a) => a.kind)).size).toBe(
      LIGHT_ARCHETYPES.length,
    )
  })

  it('is a complete, well-formed registry: no problems, assert does not throw', () => {
    expect(lightArchetypesProblems()).toEqual([])
    expect(() => assertLightArchetypesComplete()).not.toThrow()
  })

  it('derives every intensity as target illuminance × throw² (candela, physical falloff)', () => {
    for (const archetype of LIGHT_ARCHETYPES) {
      const derived = archetype.targetIlluminance * archetype.throwM * archetype.throwM
      // Float ulps: `0.8 × 1.5 × 1.5` is 1.8000000000000003 — the gate carries
      // the same slack, so compare at 9 decimals, never with toBe.
      expect(archetype.intensity).toBeCloseTo(derived, 9)
      expect(archetype.decay).toBe(2)
    }
    // The four authored recipes, pinned: panel 1.0 × 3², task 3.6 × 1²,
    // screen 0.8 × 1.5², drive glow 1.2 × 4².
    const recipes = [PANEL, TASK, SCREEN, REACTOR]
    const expectedIntensities = [9, 3.6, 1.8, 19.2]
    for (const [index, expected] of expectedIntensities.entries()) {
      expect(recipes[index].intensity).toBeCloseTo(expected, 9)
    }
    expect(recipes.map((a) => a.throwM)).toEqual([3, 1, 1.5, 4])
  })

  it('keeps every recipe inside the §4 anti-goal ceilings (no blown-out panels)', () => {
    for (const archetype of LIGHT_ARCHETYPES) {
      expect(archetype.targetIlluminance).toBeLessThanOrEqual(
        LIGHT_TARGET_ILLUMINANCE_MAX,
      )
      expect(archetype.intensity).toBeLessThanOrEqual(LIGHT_INTENSITY_MAX)
    }
    // The drive glow is the hottest fixture in the ship, by design — and it
    // still sits under the ceiling.
    const hottest = [...LIGHT_ARCHETYPES].sort((a, b) => b.intensity - a.intensity)[0]
    expect(hottest.kind).toBe('reactor')
    expect(hottest.intensity).toBeLessThan(LIGHT_INTENSITY_MAX)
  })

  it('gives every recipe a reach that covers its own throw without crossing a deck', () => {
    for (const archetype of LIGHT_ARCHETYPES) {
      expect(archetype.distanceM).toBeGreaterThanOrEqual(archetype.throwM)
      expect(archetype.distanceM).toBeLessThanOrEqual(MAX_LIGHT_RANGE_M)
    }
    // A task strip is a pool; a ceiling panel washes a room.
    expect(TASK.distanceM).toBeLessThan(PANEL.distanceM)
  })

  it('asks for a shadow map only on the kind PRD §11 budgets one for (task)', () => {
    const asking = LIGHT_ARCHETYPES.filter((a) => a.wantShadow).map((a) => a.kind)
    expect(asking).toEqual(['task'])
    expect(SHADOW_LIGHTS_PER_DECK_MAX).toBe(1)
  })

  it('tints each light with the emissive of the slot its own lens is drawn with', () => {
    // panel / task / reactor glow all anchor on `panel-light` lenses (the M2 kit
    // draws the coffee strip and the drive glow lens with that slot); screens
    // anchor on `screen`.
    expect(PANEL.lensSlot).toBe('panel-light')
    expect(TASK.lensSlot).toBe('panel-light')
    expect(REACTOR.lensSlot).toBe('panel-light')
    expect(SCREEN.lensSlot).toBe('screen')

    for (const archetype of LIGHT_ARCHETYPES) {
      expect(lightColorFor(archetype)).toBe(slotSurface(archetype.lensSlot).emissive)
      expect(lightColorFor(archetype)).not.toBe(NO_EMISSION)
    }
    // The shipped tints: the amber panel lens and the teal screen — and the
    // drive glow is the same lens the kit draws it with, not a second palette.
    expect(lightColorFor(PANEL)).toBe(slotSurface('panel-light').emissive)
    expect(lightColorFor(SCREEN)).toBe(slotSurface('screen').emissive)
    expect(lightColorFor(REACTOR)).toBe(lightColorFor(PANEL))
    expect(lightColorFor(PANEL)).not.toBe(lightColorFor(SCREEN))
  })

  it('follows the theme: re-skinning a lens re-lights the fixture', () => {
    const reskinned = withSlotSet('panel-light', 'screen-glass-emissive')
    expect(lightColorFor(PANEL, reskinned)).toBe(
      slotSurface('screen', reskinned).emissive,
    )
    expect(lightColorFor(PANEL, reskinned)).not.toBe(lightColorFor(PANEL))
  })

  it('refuses a fixture whose lens emits nothing', () => {
    const inert = withSlotSet('panel-light', 'deckplate-diamond-cable-runs')
    expect(() => lightColorFor(PANEL, inert)).toThrow(/emits nothing/)
    expect(lightArchetypeProblems(PANEL, inert).join('; ')).toMatch(
      /panel-light.*emits nothing/,
    )
  })

  it('flags a target illuminance over the §4 ceiling (a blown-out room)', () => {
    const floodlit: LightArchetype = { ...PANEL, targetIlluminance: 9, intensity: 81 }
    expect(lightArchetypeProblems(floodlit).join('; ')).toMatch(
      /target illuminance 9 is over the §4 ceiling of 4/,
    )
  })

  it('flags an intensity that is not target × throw², and one over the ceiling', () => {
    const mismatched: LightArchetype = { ...PANEL, intensity: 12 }
    expect(lightArchetypeProblems(mismatched).join('; ')).toMatch(
      /intensity 12 cd is not target × throw²/,
    )
    const blazing: LightArchetype = { ...PANEL, targetIlluminance: 4, intensity: 36 }
    expect(lightArchetypeProblems(blazing).join('; ')).toMatch(
      /intensity 36 cd is over the §4 ceiling of 24 cd/,
    )
  })

  it('flags a reach that stops short of the throw, and one that crosses decks', () => {
    const shortsighted: LightArchetype = { ...PANEL, distanceM: 2 }
    expect(lightArchetypeProblems(shortsighted).join('; ')).toMatch(
      /range 2 m does not reach its own 3 m throw/,
    )
    const leaking: LightArchetype = { ...PANEL, distanceM: 12 }
    expect(lightArchetypeProblems(leaking).join('; ')).toMatch(
      /range 12 m is over the 8 m cap/,
    )
  })

  it('flags non-physical decay and a shadow request from a non-task light', () => {
    expect(lightArchetypeProblems({ ...PANEL, decay: 0 }).join('; ')).toMatch(
      /decay 0 is not physical/,
    )
    expect(lightArchetypeProblems({ ...PANEL, wantShadow: true }).join('; ')).toMatch(
      /only task lights may ask for a shadow map/,
    )
    expect(lightArchetypeProblems({ ...PANEL, throwM: 0 }).join('; ')).toMatch(
      /throw 0 m must be positive/,
    )
  })

  it('flags a missing kind, a duplicate kind, and a dark registry', () => {
    const short = LIGHT_ARCHETYPES.filter((a) => a.kind !== 'reactor')
    expect(lightArchetypesProblems(short).join('; ')).toMatch(
      /no archetype for kind 'reactor'/,
    )
    expect(lightArchetypesProblems([...LIGHT_ARCHETYPES, PANEL]).join('; ')).toMatch(
      /duplicate archetype for kind 'panel'/,
    )
    expect(() => assertLightArchetypesComplete(short)).toThrow(/reactor/)
    expect(() => assertLightArchetypesComplete(LIGHT_ARCHETYPES)).not.toThrow()
  })

  it('looks an archetype up by kind and throws on a kind the rig does not know', () => {
    expect(getLightArchetype('task')).toBe(TASK)
    expect(() => getLightArchetype('floodlight' as LightKind)).toThrow(
      /no archetype for kind 'floodlight'/,
    )
  })

  it('ships a warm, dim, gated ambient fill — never a sun', () => {
    const ambient = rigAmbient()
    expect(ambient).toEqual({
      color: RIG_AMBIENT_COLOR,
      intensity: RIG_AMBIENT_INTENSITY,
    })
    expect(RIG_AMBIENT_INTENSITY).toBeGreaterThan(0)
    expect(RIG_AMBIENT_INTENSITY).toBeLessThanOrEqual(RIG_AMBIENT_INTENSITY_MAX)
    expect(rigAmbientProblems()).toEqual([])
    expect(lightArchetypesProblems()).toEqual([])
  })

  it('flags a fill that would flatten the interior, or that is not a colour', () => {
    expect(
      rigAmbientProblems({
        color: '#ffffff',
        intensity: RIG_AMBIENT_INTENSITY_MAX + 0.4,
      }).join('; '),
    ).toMatch(/over the 0.5 cap — a fill that strong flattens the interior/)
    expect(rigAmbientProblems({ color: 'warm', intensity: 0.2 }).join('; ')).toMatch(
      /is not a #rrggbb hex/,
    )
    expect(rigAmbientProblems({ color: '#4a443c', intensity: 0 }).join('; ')).toMatch(
      /must be positive/,
    )
  })
})
