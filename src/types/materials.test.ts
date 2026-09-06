import { describe, expect, it } from 'vitest'
import { MATERIAL_SLOTS, assertMaterialSlotsComplete } from './materials'
import type { MaterialSlots } from './materials'

const NINE_SLOT_THEME: Record<string, unknown> = {
  deckplate: 'pbr',
  bulkhead: 'pbr',
  conduit: 'pbr',
  'panel-light': 'pbr',
  screen: 'pbr',
  hazard: 'pbr',
  ceramic: 'pbr',
  webbing: 'pbr',
  'coffee-accent': 'pbr',
}

describe('material contract (M1-T2)', () => {
  it('the slot vocabulary is the nine PRD §7 slots, unique and stable', () => {
    expect(MATERIAL_SLOTS).toHaveLength(9)
    expect(new Set(MATERIAL_SLOTS).size).toBe(9)
    expect(MATERIAL_SLOTS).toContain('deckplate')
    expect(MATERIAL_SLOTS).toContain('bulkhead')
    expect(MATERIAL_SLOTS).toContain('conduit')
    expect(MATERIAL_SLOTS).toContain('panel-light')
    expect(MATERIAL_SLOTS).toContain('screen')
    expect(MATERIAL_SLOTS).toContain('hazard')
    expect(MATERIAL_SLOTS).toContain('ceramic')
    expect(MATERIAL_SLOTS).toContain('webbing')
    expect(MATERIAL_SLOTS).toContain('coffee-accent')
  })

  it('MaterialSlots<T> compiles only when every slot is assigned', () => {
    // Complete assignments typecheck...
    const complete: MaterialSlots<string> = {
      deckplate: '',
      bulkhead: '',
      conduit: '',
      'panel-light': '',
      screen: '',
      hazard: '',
      ceramic: '',
      webbing: '',
      'coffee-accent': '',
    }
    expect(Object.keys(complete)).toHaveLength(9)
    // ...and omitting any slot is a compile error ("unassigned slot = failed build").
    // @ts-expect-error — MaterialSlots requires all nine slots; 'bulkhead' is missing.
    const partial: MaterialSlots<string> = {
      deckplate: '',
      conduit: '',
      'panel-light': '',
      screen: '',
      hazard: '',
      ceramic: '',
      webbing: '',
      'coffee-accent': '',
    }
    expect(partial).toBeDefined()
  })

  it('assertMaterialSlotsComplete passes a theme with all nine slots assigned', () => {
    expect(() => assertMaterialSlotsComplete(NINE_SLOT_THEME)).not.toThrow()
  })

  it('throws listing every unassigned slot', () => {
    const missing: Record<string, unknown> = { ...NINE_SLOT_THEME }
    delete missing.screen
    delete missing.ceramic
    expect(() => assertMaterialSlotsComplete(missing)).toThrow(/screen/)
    expect(() => assertMaterialSlotsComplete(missing)).toThrow(/ceramic/)
  })

  it('throws when a slot key is present but its value is undefined', () => {
    const unset: Record<string, unknown> = { ...NINE_SLOT_THEME, webbing: undefined }
    expect(() => assertMaterialSlotsComplete(unset)).toThrow(/webbing/)
  })

  it('ignores unknown extra keys (a newer theme may carry more slots)', () => {
    expect(() =>
      assertMaterialSlotsComplete({ ...NINE_SLOT_THEME, 'glow-stripe': 'pbr' }),
    ).not.toThrow()
  })
})
