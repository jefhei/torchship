import { describe, expect, it } from 'vitest'
import { MATERIAL_SLOTS } from '../types'
import type { MaterialSlot } from '../types'
import {
  DEFAULT_MATERIAL_THEME,
  DEFAULT_THEME_ID,
  MATERIAL_THEMES,
  NO_EMISSION,
  PBR_EMISSIVE_INTENSITY_MAX,
  PBR_MIN_ROUGHNESS,
  PBR_PATTERNS,
  PBR_SETS,
  SLOT_PATTERNS,
  assertPbrSetsComplete,
  assertThemesComplete,
  assignedSetId,
  getPbrSet,
  materialSetReport,
  pbrSetForSlot,
  pbrSetProblems,
  pbrSetsProblems,
  slotSetProblems,
  themeAssignsSlot,
  themeProblems,
  themeSetProblems,
  themesProblems,
} from './index'
import { AUTHORED_MODULES } from '../kit/modules/registry'
import { moduleMaterialSlots } from '../kit/modules/types'
import { moduleSlotProblems } from '../kit/harness/checks'
import { assembleShip, drawCallRows, drawCallTally } from '../assembler'
import { SHIP_FIXTURES } from '../fixtures'

const HEX = /^#[0-9a-f]{6}$/
const EMISSIVE_SLOTS: readonly MaterialSlot[] = [
  'panel-light',
  'screen',
  'coffee-accent',
]
const INERT_SLOTS = MATERIAL_SLOTS.filter((slot) => !EMISSIVE_SLOTS.includes(slot))

/** A theme of unknown shape, built by JSON round-tripping the standard one. */
function jsonTheme(damage?: (slots: Record<string, { set: string }>) => void): unknown {
  const theme = JSON.parse(JSON.stringify(DEFAULT_MATERIAL_THEME)) as {
    slots: Record<string, { set: string }>
  }
  damage?.(theme.slots)
  return theme
}

describe('PBR set registry (M4-T1)', () => {
  it('authors exactly one set per §4 slot, in vocabulary order', () => {
    expect(PBR_SETS).toHaveLength(MATERIAL_SLOTS.length)
    expect(PBR_SETS.map((set) => set.slot)).toEqual([...MATERIAL_SLOTS])
    expect(new Set(PBR_SETS.map((set) => set.id)).size).toBe(PBR_SETS.length)
    expect(pbrSetsProblems(PBR_SETS)).toEqual([])
    expect(() => assertPbrSetsComplete(PBR_SETS)).not.toThrow()
  })

  it('gives every set a label, a §4 pattern and a distinct base albedo', () => {
    for (const set of PBR_SETS) {
      expect(set.label.trim()).not.toBe('')
      expect(set.pattern).toBe(SLOT_PATTERNS[set.slot])
    }
    expect(new Set(PBR_SETS.map((set) => set.baseColor)).size).toBe(PBR_SETS.length)
    expect(new Set(PBR_PATTERNS).size).toBe(PBR_PATTERNS.length)
    expect([...PBR_PATTERNS].sort()).toEqual(
      MATERIAL_SLOTS.map((slot) => SLOT_PATTERNS[slot]).sort(),
    )
  })

  it('holds every shading value inside the contract ranges', () => {
    for (const set of PBR_SETS) {
      expect(set.baseColor).toMatch(HEX)
      expect(set.emissive).toMatch(HEX)
      expect(set.metalness).toBeGreaterThanOrEqual(0)
      expect(set.metalness).toBeLessThanOrEqual(1)
      expect(set.roughness).toBeGreaterThanOrEqual(PBR_MIN_ROUGHNESS)
      expect(set.roughness).toBeLessThanOrEqual(1)
      expect(set.emissiveIntensity).toBeGreaterThanOrEqual(0)
      expect(set.emissiveIntensity).toBeLessThanOrEqual(PBR_EMISSIVE_INTENSITY_MAX)
    }
  })

  it('makes the practical-light slots emissive and every other slot inert', () => {
    for (const slot of EMISSIVE_SLOTS) {
      const set = pbrSetForSlot(slot)
      expect(set.emissiveIntensity).toBeGreaterThan(0)
      expect(set.emissive).not.toBe(NO_EMISSION)
    }
    for (const slot of INERT_SLOTS) {
      const set = pbrSetForSlot(slot)
      expect(set.emissiveIntensity).toBe(0)
      expect(set.emissive).toBe(NO_EMISSION)
    }
  })

  it('resolves a set by id, and throws naming the registry on an unknown id', () => {
    expect(getPbrSet(PBR_SETS[0].id)).toBe(PBR_SETS[0])
    expect(() => getPbrSet('no-such-set')).toThrow(/unknown PBR set 'no-such-set'/)
    expect(() => getPbrSet('no-such-set')).toThrow(/deckplate-diamond-cable-runs/)
    expect(pbrSetForSlot('ceramic')).toBe(getPbrSet('ceramic-heat-shield-drive'))
    expect(() => pbrSetForSlot('ceramic', [])).toThrow(
      /no PBR set is authored for §4 slot 'ceramic'/,
    )
  })

  it('is plain data: a JSON round-trip is identical and still clean', () => {
    const json = JSON.parse(JSON.stringify(PBR_SETS)) as unknown[]
    expect(json).toStrictEqual(PBR_SETS)
    expect(pbrSetsProblems(json)).toEqual([])
  })
})

describe('PBR set validation (M4-T1)', () => {
  const standard = PBR_SETS[0]

  it('rejects a non-object and a nameless set', () => {
    expect(pbrSetProblems(null)).toEqual(['PBR set is not an object'])
    expect(pbrSetProblems({ ...standard, id: '   ' })).toContain(
      'PBR set id is required',
    )
  })

  it('rejects an unknown §4 slot and a blank label', () => {
    const problems = pbrSetProblems({ ...standard, slot: 'deckplates', label: ' ' })
    expect(
      problems.some((p) => p.includes("slot 'deckplates' is not a §4 material slot")),
    ).toBe(true)
    expect(problems.some((p) => p.includes('label is required'))).toBe(true)
  })

  it('rejects malformed colours', () => {
    for (const baseColor of ['blue', '#FFF', '#12345', '#GGGGGG', 12, undefined]) {
      const problems = pbrSetProblems({ ...standard, baseColor })
      expect(problems.some((p) => p.includes('is not a #rrggbb colour'))).toBe(true)
    }
    const emissive = pbrSetProblems({ ...standard, emissive: 'nope' })
    expect(
      emissive.some((p) => p.includes("emissive 'nope' is not a #rrggbb colour")),
    ).toBe(true)
  })

  it('rejects out-of-range shading and a surface below the gloss floor', () => {
    const metal = pbrSetProblems({ ...standard, metalness: 1.4 })
    expect(metal.some((p) => p.includes('metalness 1.4 is outside 0…1'))).toBe(true)

    const rough = pbrSetProblems({ ...standard, roughness: -0.1 })
    expect(rough.some((p) => p.includes('roughness -0.1 is outside 0…1'))).toBe(true)

    const gloss = pbrSetProblems({ ...standard, roughness: 0.05 })
    expect(
      gloss.some((p) => p.includes(`below the ${PBR_MIN_ROUGHNESS} gloss floor`)),
    ).toBe(true)
  })

  it('rejects an emissive strength outside the no-blown-panels ceiling', () => {
    const problems = pbrSetProblems({
      ...standard,
      emissive: '#ff0000',
      emissiveIntensity: PBR_EMISSIVE_INTENSITY_MAX + 1,
    })
    expect(problems.some((p) => p.includes('no blown-out panels'))).toBe(true)
  })

  it('rejects emissive data that emits nothing, in both directions', () => {
    const deadTint = pbrSetProblems({
      ...standard,
      emissive: '#ff0000',
      emissiveIntensity: 0,
    })
    expect(
      deadTint.some((p) =>
        p.includes("emissive '#ff0000' at intensity 0 emits nothing"),
      ),
    ).toBe(true)
    const deadIntensity = pbrSetProblems({
      ...standard,
      emissive: NO_EMISSION,
      emissiveIntensity: 2,
    })
    expect(
      deadIntensity.some((p) =>
        p.includes(`on an inert '${NO_EMISSION}' tint emits nothing`),
      ),
    ).toBe(true)
  })

  it('rejects an unknown pattern and a pattern that is not the slot’s treatment', () => {
    const unknown = pbrSetProblems({ ...standard, pattern: 'glossy' })
    expect(
      unknown.some((p) => p.includes("pattern 'glossy' is not a §4 surface treatment")),
    ).toBe(true)
    const crossTalk = pbrSetProblems({ ...standard, pattern: 'canvas-webbing' })
    expect(
      crossTalk.some((p) =>
        p.includes("is not the treatment slot 'deckplate' reads as ('diamond-plate')"),
      ),
    ).toBe(true)
  })

  it('catches duplicate ids and §4 coverage gaps, and assert lists them all', () => {
    const duplicated = [...PBR_SETS, { ...PBR_SETS[0], id: 'deckplate-twin' }]
    const dupProblems = pbrSetsProblems(duplicated)
    expect(
      dupProblems.some((p) => p.includes("§4 slot 'deckplate' has 2 PBR sets")),
    ).toBe(true)

    const missing = PBR_SETS.filter((set) => set.slot !== 'screen')
    const missingProblems = pbrSetsProblems(missing)
    expect(missingProblems).toContain("no PBR set is authored for §4 slot 'screen'")

    const idProblems = pbrSetsProblems([PBR_SETS[0], PBR_SETS[0]])
    expect(
      idProblems.some((p) =>
        p.includes("duplicate PBR set id 'deckplate-diamond-cable-runs'"),
      ),
    ).toBe(true)

    expect(() => assertPbrSetsComplete(missing)).toThrow(/pbr-set completeness/)
    expect(() => assertPbrSetsComplete(missing)).toThrow(/screen/)
  })
})

describe('theme → set resolution (M4-T1)', () => {
  it('the standard theme assigns every slot to the set declared for that slot', () => {
    for (const slot of MATERIAL_SLOTS) {
      const set = pbrSetForSlot(slot)
      expect(DEFAULT_MATERIAL_THEME.slots[slot].set).toBe(set.id)
      expect(themeAssignsSlot(DEFAULT_MATERIAL_THEME, slot)).toBe(true)
      expect(slotSetProblems(DEFAULT_MATERIAL_THEME.slots[slot], slot)).toEqual([])
    }
    expect(slotSetProblems(DEFAULT_MATERIAL_THEME, 'deckplate')).toEqual([])
    expect(themeSetProblems(DEFAULT_MATERIAL_THEME)).toEqual([])
    expect(themeProblems(DEFAULT_MATERIAL_THEME)).toEqual([])
    expect(themesProblems(MATERIAL_THEMES)).toEqual([])
    expect(() => assertThemesComplete(MATERIAL_THEMES)).not.toThrow()
    expect(DEFAULT_MATERIAL_THEME.id).toBe(DEFAULT_THEME_ID)
    expect(getPbrSet(DEFAULT_MATERIAL_THEME.slots.deckplate.set).slot).toBe('deckplate')
  })

  it('names an unknown set id, with the slot that points at it', () => {
    const theme = jsonTheme((slots) => {
      slots.deckplate = { set: 'deckplate-titanium' }
    })
    const problems = slotSetProblems({ set: 'deckplate-titanium' }, 'deckplate')
    expect(problems).toEqual([
      "slot 'deckplate' names PBR set 'deckplate-titanium', which the registry does not know",
    ])
    expect(themeSetProblems(theme)).toEqual(problems)
    expect(
      themeProblems(theme).some(
        (p) => p.includes(DEFAULT_THEME_ID) && p.includes('deckplate-titanium'),
      ),
    ).toBe(true)
    expect(() => assertPbrSetsComplete(PBR_SETS)).not.toThrow()
  })

  it('refuses a set declared for another slot (no painting the deck with screens)', () => {
    const problems = slotSetProblems({ set: 'screen-glass-emissive' }, 'deckplate')
    expect(problems).toEqual([
      "slot 'deckplate' names PBR set 'screen-glass-emissive', which is declared for slot 'screen'",
    ])
    const theme = jsonTheme((slots) => {
      slots.webbing = { set: 'hazard-striping-worn' }
    })
    expect(
      themeProblems(theme).some((p) => p.includes("declared for slot 'hazard'")),
    ).toBe(true)
    expect(themesProblems([theme])).not.toEqual([])
  })

  it('leaves unassigned payloads to the completeness rule (no double-reporting)', () => {
    for (const payload of [undefined, null, {}, 'pbr', { set: '' }, { set: '   ' }]) {
      expect(assignedSetId(payload)).toBeUndefined()
      expect(slotSetProblems(payload, 'deckplate')).toEqual([])
    }
    expect(assignedSetId({ set: ' deckplate-diamond-cable-runs ' })).toBe(
      ' deckplate-diamond-cable-runs ',
    )
    expect(themeSetProblems(jsonTheme((slots) => delete slots.coffee))).toEqual([])
    expect(themeSetProblems(null)).toEqual([])
    expect(themeSetProblems({ label: 'no slots' })).toEqual([])
  })

  it('carries the resolution verdict per ship as a material report', () => {
    for (const fixture of SHIP_FIXTURES) {
      // The negative rig carries deliberate spec defects: assemble it anyway.
      const assembly = assembleShip(fixture.spec, {
        requireValidSpec: fixture.expectValid,
      })
      const report = materialSetReport(assembly)
      expect(report.problems).toEqual([])
      expect(report.ship).toBe(fixture.spec.name)
      expect(report.themeId).toBe(DEFAULT_THEME_ID)
      expect(report.partsBySlot.map((row) => row.slot)).toEqual([...MATERIAL_SLOTS])
      expect(report.partsBySlot.map((row) => row.setId)).toEqual(
        MATERIAL_SLOTS.map((slot) => pbrSetForSlot(slot).id),
      )
      // The material report is the material side of the draw-call tally.
      expect(report.parts).toBe(
        drawCallRows(assembly).reduce((sum, row) => sum + row.parts, 0),
      )
      expect(report.calls).toBe(drawCallTally(assembly).total)
      expect(report.detail).toContain(`theme '${DEFAULT_THEME_ID}'`)
      // Measured: all four canonical fixtures — the negative rig included, whose
      // defects are geometry, not materials — draw every one of the nine slots.
      expect(report.usedSlots).toEqual([...MATERIAL_SLOTS])
      for (const row of report.partsBySlot) expect(row.parts).toBeGreaterThan(0)
      expect(
        report.partsBySlot.find((row) => row.slot === 'coffee-accent')?.parts,
      ).toBe(1)
    }
  })
})

describe('PBR sets across every module and every deck (M4-T1)', () => {
  it('resolves every slot the authored kit draws, and the kit covers the §4 vocabulary', () => {
    const drawn = new Set<MaterialSlot>()
    for (const module of AUTHORED_MODULES) {
      const slots = moduleMaterialSlots(module)
      expect(slots.length).toBeGreaterThan(0)
      for (const slot of slots) {
        drawn.add(slot)
        expect(themeAssignsSlot(DEFAULT_MATERIAL_THEME, slot)).toBe(true)
        expect(slotSetProblems(DEFAULT_MATERIAL_THEME.slots[slot], slot)).toEqual([])
      }
      expect(moduleSlotProblems(module, DEFAULT_MATERIAL_THEME)).toEqual([])
    }
    // Every one of the nine sets is drawn by real geometry — no dead set.
    expect([...drawn].sort()).toEqual([...MATERIAL_SLOTS].sort())
  })

  it('resolves the material of every draw call the assembler partitions, on all four ships', () => {
    for (const fixture of SHIP_FIXTURES) {
      const assembly = assembleShip(fixture.spec, {
        requireValidSpec: fixture.expectValid,
      })
      const drawn = new Set<MaterialSlot>()
      for (const deck of assembly.decks) {
        expect(deck.groups.length + deck.batches.length).toBeGreaterThan(0)
        for (const plan of deck.groups) {
          drawn.add(plan.group.materialSlot)
          expect(pbrSetForSlot(plan.group.materialSlot).id).toBe(
            DEFAULT_MATERIAL_THEME.slots[plan.group.materialSlot].set,
          )
        }
        for (const plan of deck.batches) {
          drawn.add(plan.batch.materialSlot)
          expect(
            slotSetProblems(
              DEFAULT_MATERIAL_THEME.slots[plan.batch.materialSlot],
              plan.batch.materialSlot,
            ),
          ).toEqual([])
        }
      }
      // The negative rig is geometry-defective, not material-defective: every
      // slot it draws resolves, and it draws all nine just like the real ships.
      expect([...drawn].sort()).toEqual([...MATERIAL_SLOTS].sort())
    }
  })
})
