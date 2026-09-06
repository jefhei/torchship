import { describe, expect, it } from 'vitest'
import { MATERIAL_SLOTS, MM, doorCenterDeckOffsetM, getKitModule, rotY } from './index'
import type { MaterialSlot, ModuleRef, Rotation, ShipSpec, Vec3 } from './index'

/**
 * Barrel smoke test: the src/types public surface resolves — value helpers
 * (used at runtime by the assembler/validator) and type exports (used across
 * every milestone) all import from the single entry point.
 */
describe('src/types barrel (M1-T2)', () => {
  it('re-exports the runtime contract helpers', () => {
    expect(MM).toBe(0.001)
    expect(rotY([1, 0, 0], 1)).toEqual([0, 0, -1])
    expect(MATERIAL_SLOTS).toHaveLength(9)
    const manifest = { modules: [] }
    expect(() => getKitModule(manifest, 'head')).toThrow()
  })

  it('re-exports the type surface (compile-time only, exercised via tsc)', () => {
    const spec: ShipSpec = {
      classId: 'hound',
      name: 'Firebrand',
      registry: 'HCS-417',
      seed: 0,
      decks: [
        {
          id: 'deck-0',
          label: 'Head — bridge',
          yPosition: 0,
          modules: [
            { moduleId: 'head', rotation: 0 as Rotation, offset: [0, 0, 0] as Vec3 },
          ],
        },
      ],
    }
    const deck = spec.decks[0]
    const ref: ModuleRef = deck.modules[0]
    expect(ref.moduleId).toBe('head')
    expect(deck.yPosition).toBe(0)
    const slot: MaterialSlot = 'coffee-accent'
    expect(slot).toBe('coffee-accent')
    expect(
      doorCenterDeckOffsetM({ id: 'd', position: [0, 1.0, -1], facing: '-z' }),
    ).toBe(0)
  })
})
