import { describe, expect, it } from 'vitest'
import { MATERIAL_SLOTS } from '../../types'
import type { MaterialSlot } from '../../types'
import { PLACEHOLDER_SLOT_SURFACES, slotSurface } from './slotSurfaces'

const HEX = /^#[0-9a-f]{6}$/
const NON_EMISSIVE: readonly MaterialSlot[] = [
  'deckplate',
  'bulkhead',
  'conduit',
  'hazard',
  'ceramic',
  'webbing',
]

describe('interim slot surfaces (M2-T1)', () => {
  it('fills all nine §4 slots', () => {
    expect(Object.keys(PLACEHOLDER_SLOT_SURFACES).sort()).toEqual(
      [...MATERIAL_SLOTS].sort(),
    )
  })

  it('gives every slot a distinct, well-formed surface', () => {
    const colors = MATERIAL_SLOTS.map((slot) => PLACEHOLDER_SLOT_SURFACES[slot].color)
    for (const color of colors) expect(color).toMatch(HEX)
    expect(new Set(colors).size).toBe(colors.length)

    for (const slot of MATERIAL_SLOTS) {
      const surface = PLACEHOLDER_SLOT_SURFACES[slot]
      expect(surface.emissive).toMatch(HEX)
      expect(surface.emissiveIntensity).toBeGreaterThanOrEqual(0)
      expect(surface.metalness).toBeGreaterThanOrEqual(0)
      expect(surface.metalness).toBeLessThanOrEqual(1)
      expect(surface.roughness).toBeGreaterThanOrEqual(0)
      expect(surface.roughness).toBeLessThanOrEqual(1)
    }
  })

  it('makes the practical-light and screen slots emissive, and nothing else', () => {
    for (const slot of ['panel-light', 'screen'] as const) {
      expect(PLACEHOLDER_SLOT_SURFACES[slot].emissiveIntensity).toBeGreaterThan(0)
      expect(PLACEHOLDER_SLOT_SURFACES[slot].emissive).not.toBe('#000000')
    }
    for (const slot of NON_EMISSIVE) {
      expect(PLACEHOLDER_SLOT_SURFACES[slot].emissiveIntensity).toBe(0)
    }
  })

  it('resolves a surface by slot', () => {
    expect(slotSurface('coffee-accent')).toBe(
      PLACEHOLDER_SLOT_SURFACES['coffee-accent'],
    )
  })
})
