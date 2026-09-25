import { describe, expect, it } from 'vitest'
import { MATERIAL_SLOTS } from '../../types'
import type { MaterialSlot } from '../../types'
import {
  DEFAULT_MATERIAL_THEME,
  NO_EMISSION,
  getPbrSet,
  pbrSetForSlot,
  slotSetProblems,
} from '../../materials'
import type { MaterialTheme } from '../../materials'
import { SLOT_SURFACES, slotSurface, slotSurfacesFor } from './slotSurfaces'

const HEX = /^#[0-9a-f]{6}$/
const EMISSIVE: readonly MaterialSlot[] = ['panel-light', 'screen', 'coffee-accent']
const INERT = MATERIAL_SLOTS.filter((slot) => !EMISSIVE.includes(slot))

/** A theme of unknown shape with one slot re-pointed at another set. */
function retargeted(slot: MaterialSlot, set: string): MaterialTheme {
  return {
    ...DEFAULT_MATERIAL_THEME,
    slots: { ...DEFAULT_MATERIAL_THEME.slots, [slot]: { set } },
  }
}

describe('slot → PBR surface bridge (M4-T1)', () => {
  it('fills all nine §4 slots', () => {
    expect(Object.keys(SLOT_SURFACES).sort()).toEqual([...MATERIAL_SLOTS].sort())
  })

  it('gives every slot the shading of the set its theme resolves to', () => {
    for (const slot of MATERIAL_SLOTS) {
      const set = getPbrSet(DEFAULT_MATERIAL_THEME.slots[slot].set)
      expect(SLOT_SURFACES[slot]).toEqual({
        color: set.baseColor,
        emissive: set.emissive,
        emissiveIntensity: set.emissiveIntensity,
        metalness: set.metalness,
        roughness: set.roughness,
      })
    }
  })

  it('gives every slot a distinct, well-formed surface', () => {
    const colors = MATERIAL_SLOTS.map((slot) => SLOT_SURFACES[slot].color)
    for (const color of colors) expect(color).toMatch(HEX)
    expect(new Set(colors).size).toBe(colors.length)

    for (const slot of MATERIAL_SLOTS) {
      const surface = SLOT_SURFACES[slot]
      expect(surface.emissive).toMatch(HEX)
      expect(surface.emissiveIntensity).toBeGreaterThanOrEqual(0)
      expect(surface.metalness).toBeGreaterThanOrEqual(0)
      expect(surface.metalness).toBeLessThanOrEqual(1)
      expect(surface.roughness).toBeGreaterThanOrEqual(0)
      expect(surface.roughness).toBeLessThanOrEqual(1)
    }
  })

  it('makes the practical-light and screen slots emissive and the rest inert', () => {
    for (const slot of EMISSIVE) {
      expect(SLOT_SURFACES[slot].emissiveIntensity).toBeGreaterThan(0)
      expect(SLOT_SURFACES[slot].emissive).not.toBe(NO_EMISSION)
    }
    for (const slot of INERT) {
      expect(SLOT_SURFACES[slot].emissiveIntensity).toBe(0)
      expect(SLOT_SURFACES[slot].emissive).toBe(NO_EMISSION)
    }
  })

  it('resolves a slot by identity for the standard theme', () => {
    expect(slotSurface('coffee-accent')).toBe(SLOT_SURFACES['coffee-accent'])
    expect(slotSurface('deckplate', DEFAULT_MATERIAL_THEME)).toBe(
      SLOT_SURFACES.deckplate,
    )
  })

  it('follows the theme a caller passes, not a hard-coded table', () => {
    const surfaces = slotSurfacesFor(retargeted('hazard', 'ceramic-heat-shield-drive'))
    expect(surfaces.hazard).toEqual(SLOT_SURFACES.ceramic)
    expect(slotSurface('hazard', DEFAULT_MATERIAL_THEME)).toEqual(SLOT_SURFACES.hazard)
    // …and that cross-slot assignment is exactly what the theme gate refuses.
    expect(slotSetProblems({ set: 'ceramic-heat-shield-drive' }, 'hazard')).not.toEqual(
      [],
    )
    for (const slot of MATERIAL_SLOTS) {
      expect(surfaces[slot].color).toMatch(HEX)
    }
    expect(Object.keys(surfaces)).toHaveLength(MATERIAL_SLOTS.length)
  })

  it('throws loudly when a theme names a set the registry does not know', () => {
    const broken = retargeted('webbing', 'webbing-kevlar')
    expect(() => slotSurface('webbing', broken)).toThrow(
      /unknown PBR set 'webbing-kevlar'/,
    )
    expect(() => slotSurfacesFor(broken)).toThrow(/unknown PBR set/)
    expect(pbrSetForSlot('webbing')).toBe(getPbrSet('webbing-canvas-strap'))
  })
})
