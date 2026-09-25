import { describe, expect, it } from 'vitest'
import { MATERIAL_SLOTS } from '../types'
import type { MaterialSlots } from '../types'
import type { MaterialSlotSpec, MaterialTheme } from './index'
import {
  DEFAULT_THEME_ID,
  MATERIAL_THEMES,
  assertThemesComplete,
  getPbrSet,
  getMaterialTheme,
  themeIdOf,
  themeProblems,
  themeSetProblems,
  themesProblems,
} from './index'

const defaultTheme = MATERIAL_THEMES[0]

/** A deep copy of the canonical theme's slots that tests may damage. */
function cloneDefaultSlots(): MaterialSlots<MaterialSlotSpec> {
  return JSON.parse(
    JSON.stringify(defaultTheme.slots),
  ) as MaterialSlots<MaterialSlotSpec>
}

describe('material theme registry (M1-T4)', () => {
  it('the slot vocabulary is the nine PRD §7 slots, unique and stable', () => {
    expect(MATERIAL_SLOTS).toHaveLength(9)
    expect(new Set(MATERIAL_SLOTS).size).toBe(9)
    expect([...MATERIAL_SLOTS]).toEqual([
      'deckplate',
      'bulkhead',
      'conduit',
      'panel-light',
      'screen',
      'hazard',
      'ceramic',
      'webbing',
      'coffee-accent',
    ])
  })

  it('registers the ship theme under a unique id, resolvable by lookup', () => {
    expect(MATERIAL_THEMES.length).toBeGreaterThanOrEqual(1)
    const ids = MATERIAL_THEMES.map((theme) => theme.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids).toContain(DEFAULT_THEME_ID)
    expect(getMaterialTheme(DEFAULT_THEME_ID)).toBe(defaultTheme)
    expect(() => getMaterialTheme('no-such-theme')).toThrow(/unknown material theme/)
  })

  it('gate: every registered theme is slot-complete (unassigned slot = failed build)', () => {
    expect(themesProblems(MATERIAL_THEMES)).toEqual([])
    expect(() => assertThemesComplete(MATERIAL_THEMES)).not.toThrow()
  })

  it('the default theme fills all nine slots with distinct, resolvable PBR set ids', () => {
    const slots = defaultTheme.slots as Record<string, MaterialSlotSpec>
    expect(Object.keys(slots).sort()).toEqual([...MATERIAL_SLOTS].sort())
    const setIds = MATERIAL_SLOTS.map((slot) => slots[slot].set)
    for (const id of setIds) {
      expect(typeof id).toBe('string')
      expect(id.trim()).not.toBe('')
    }
    expect(new Set(setIds).size).toBe(9)
    // M4-T1: the ids are not just distinct, they RESOLVE — each one names the
    // set the registry declares for that very slot.
    for (const slot of MATERIAL_SLOTS) {
      expect(getPbrSet(slots[slot].set).slot).toBe(slot)
    }
    expect(themeSetProblems(defaultTheme)).toEqual([])
  })

  it('omitting any single slot is caught, naming that slot', () => {
    for (const slot of MATERIAL_SLOTS) {
      const slots = cloneDefaultSlots() as Record<string, unknown>
      delete slots[slot]
      const problems = themeProblems({ ...defaultTheme, slots })
      expect(problems.some((p) => p.includes(`unassigned slot(s): ${slot}`))).toBe(true)
    }
  })

  it('an assigned-but-blank payload is caught, not just a missing key', () => {
    const blanks: unknown[] = [{ set: '   ' }, { set: '' }, {}, null, 'pbr']
    for (const blank of blanks) {
      const problems = themeProblems({
        ...defaultTheme,
        slots: { ...cloneDefaultSlots(), deckplate: blank },
      })
      expect(
        problems.some((p) =>
          p.includes(`slot 'deckplate' is assigned an empty payload`),
        ),
      ).toBe(true)
    }
  })

  it('treats a value of undefined as unassigned', () => {
    const problems = themeProblems({
      ...defaultTheme,
      slots: { ...cloneDefaultSlots(), webbing: undefined },
    })
    expect(problems.some((p) => p.includes('unassigned slot(s): webbing'))).toBe(true)
  })

  it('requires a theme id and label', () => {
    expect(themeProblems({ ...defaultTheme, id: '   ' })).toContain(
      'theme id is required',
    )
    const nameless = themeProblems({ ...defaultTheme, label: '' })
    expect(nameless.some((p) => p.includes('theme label is required'))).toBe(true)
    expect(themeProblems(null)).toEqual(['theme is not an object'])
    expect(themeProblems({ slots: {} }).join('\n')).toMatch(/theme id is required/)
  })

  it('catches duplicate theme ids across the registry', () => {
    expect(themesProblems([defaultTheme, defaultTheme])).toContain(
      `duplicate theme id '${DEFAULT_THEME_ID}' (2 themes)`,
    )
  })

  it('assertThemesComplete throws listing every problem, naming theme and slot', () => {
    const slots = cloneDefaultSlots() as Record<string, unknown>
    delete slots.screen
    delete slots.ceramic
    const broken = { ...defaultTheme, id: 'broken', slots }
    expect(() => assertThemesComplete([...MATERIAL_THEMES, broken])).toThrow(
      /material-slot completeness/,
    )
    expect(() => assertThemesComplete([broken])).toThrow(/broken/)
    expect(() => assertThemesComplete([broken])).toThrow(/screen/)
    expect(() => assertThemesComplete([broken])).toThrow(/ceramic/)
  })

  it('JSON themes (preset/export path) validate the same way', () => {
    const jsonThemes = JSON.parse(JSON.stringify(MATERIAL_THEMES)) as unknown[]
    expect(jsonThemes).toStrictEqual(MATERIAL_THEMES)
    expect(themesProblems(jsonThemes)).toEqual([])

    const brokenJson = JSON.parse(JSON.stringify(defaultTheme)) as {
      slots: Record<string, unknown>
    }
    delete brokenJson.slots.ceramic
    expect(themeProblems(brokenJson).some((p) => p.includes('ceramic'))).toBe(true)
  })

  it('themeIdOf extracts only a usable id', () => {
    expect(themeIdOf(defaultTheme)).toBe(DEFAULT_THEME_ID)
    expect(themeIdOf({ id: '  spaced  ' })).toBe('  spaced  ')
    expect(themeIdOf({ id: '   ' })).toBeUndefined()
    expect(themeIdOf({ id: 7 })).toBeUndefined()
    expect(themeIdOf(null)).toBeUndefined()
  })

  it('MaterialTheme.slots requires all nine slots at compile time', () => {
    // @ts-expect-error — 'coffee-accent' omitted; MaterialSlots requires it.
    const incompleteSlots: MaterialSlots<MaterialSlotSpec> = {
      deckplate: { set: 'a' },
      bulkhead: { set: 'a' },
      conduit: { set: 'a' },
      'panel-light': { set: 'a' },
      screen: { set: 'a' },
      hazard: { set: 'a' },
      ceramic: { set: 'a' },
      webbing: { set: 'a' },
    }
    const incomplete: MaterialTheme = {
      id: 'incomplete',
      label: 'Incomplete',
      slots: incompleteSlots,
    }
    expect(incomplete).toBeDefined()
  })
})
