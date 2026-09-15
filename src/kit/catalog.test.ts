import { describe, expect, it } from 'vitest'
import { MATERIAL_SLOTS, STANDARD_DOOR_SIZE } from '../types'
import type { Aabb3 } from '../types'
import {
  KIT_PRIMITIVES,
  PRIMITIVE_IDS,
  assertKitPrimitivesIntegrity,
  defaultPrimitiveParts,
  getKitPrimitive,
  kitPrimitiveMaterialSlots,
  kitPrimitiveProblems,
  primitiveBounds,
  primitiveDimensions,
  primitivesInCategory,
} from './catalog'
import { partMaterialSlots, partsBounds } from './parts'
import type { KitPrimitive, PrimitiveId } from './types'

/** Deep clone of the catalog that a test may damage. */
function cloneCatalog(): KitPrimitive[] {
  return JSON.parse(JSON.stringify(KIT_PRIMITIVES)) as KitPrimitive[]
}

function expectBoundsClose(actual: Aabb3, expected: Aabb3): void {
  for (let axis = 0; axis < 3; axis++) {
    expect(actual.min[axis]).toBeCloseTo(expected.min[axis], 9)
    expect(actual.max[axis]).toBeCloseTo(expected.max[axis], 9)
  }
}

describe('kit primitive catalog (M2-T1)', () => {
  it('lists the BUILD_PLAN M2-T1 vocabulary in canonical order', () => {
    expect(PRIMITIVE_IDS).toEqual([
      'bulkhead',
      'deck-plate',
      'conduit-run',
      'panel-light',
      'hatch',
      'ladder-segment',
      'locker',
      'screen',
      'couch',
      'table',
      'coffee-station',
      'suit-rack',
      'heat-shield',
      'glow-window',
      'radiation-sign',
      'cargo-crate',
    ])
  })

  it('gives every primitive a unique id, a label and a non-degenerate box', () => {
    const ids = KIT_PRIMITIVES.map((primitive) => primitive.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const primitive of KIT_PRIMITIVES) {
      expect(primitive.label.trim()).not.toBe('')
      const size = primitiveDimensions(primitive)
      for (const extent of size) expect(extent).toBeGreaterThan(0)
    }
  })

  it('is internally intact (integrity gate is clean)', () => {
    expect(kitPrimitiveProblems(KIT_PRIMITIVES)).toEqual([])
    expect(() => assertKitPrimitivesIntegrity(KIT_PRIMITIVES)).not.toThrow()
  })

  it('declares bounds that match what its default instance actually builds', () => {
    for (const primitive of KIT_PRIMITIVES) {
      const build = defaultPrimitiveParts(primitive.id)
      expect(build.length).toBeGreaterThan(0)
      // Contained …
      const actual = partsBounds(build)
      const declared = primitive.bounds
      for (let axis = 0; axis < 3; axis++) {
        expect(actual.min[axis]).toBeGreaterThanOrEqual(declared.min[axis] - 1e-9)
        expect(actual.max[axis]).toBeLessThanOrEqual(declared.max[axis] + 1e-9)
      }
      // … and tight, so the table can never drift from the geometry.
      expectBoundsClose(actual, declared)
    }
  })

  it('declares exactly the material slots its default instance draws from', () => {
    for (const primitive of KIT_PRIMITIVES) {
      expect(primitive.materialSlots).toEqual(
        partMaterialSlots(defaultPrimitiveParts(primitive.id)),
      )
    }
  })

  it('the kit collectively fills every one of the nine §4 slots', () => {
    expect(kitPrimitiveMaterialSlots()).toEqual([...MATERIAL_SLOTS])
    const union = new Set(KIT_PRIMITIVES.flatMap((p) => [...p.materialSlots]))
    expect(union.size).toBe(9)
  })

  it('resolves primitives by id and throws on unknown ids', () => {
    expect(getKitPrimitive('hatch').id).toBe('hatch')
    expect(getKitPrimitive('coffee-station').category).toBe('prop')
    expect(() => getKitPrimitive('airlock')).toThrow(/no primitive "airlock"/)
  })

  it('marks only the hatch as filling a door socket', () => {
    const socketFillers = KIT_PRIMITIVES.filter((p) => p.fillsSocket).map((p) => p.id)
    expect(socketFillers).toEqual(['hatch'])
  })

  it('the hatch default seals the standard 0.9 × 2.0 m opening', () => {
    const hatch = getKitPrimitive('hatch')
    // Bounds = opening ± half the frame border on X and Y, ± frame depth on Z.
    const openingHalfW = STANDARD_DOOR_SIZE.width / 2 + 0.05
    const openingHalfH = STANDARD_DOOR_SIZE.height / 2 + 0.05
    expect(hatch.bounds.min[0]).toBeCloseTo(-openingHalfW, 9)
    expect(hatch.bounds.max[0]).toBeCloseTo(openingHalfW, 9)
    expect(hatch.bounds.min[1]).toBeCloseTo(-openingHalfH, 9)
    expect(hatch.bounds.max[1]).toBeCloseTo(openingHalfH, 9)
  })

  it('groups primitives by category', () => {
    expect(primitivesInCategory('shell').map((p) => p.id)).toEqual([
      'bulkhead',
      'deck-plate',
    ])
    expect(primitivesInCategory('utility').map((p) => p.id)).toEqual([
      'conduit-run',
      'panel-light',
    ])
    expect(primitivesInCategory('navigation').map((p) => p.id)).toEqual([
      'hatch',
      'ladder-segment',
    ])
    expect(primitivesInCategory('prop')).toHaveLength(7)
    expect(primitivesInCategory('thermal').map((p) => p.id)).toEqual([
      'heat-shield',
      'glow-window',
      'radiation-sign',
    ])
  })

  it('primitiveBounds/primitiveDimensions report the declared box', () => {
    const bulkhead = getKitPrimitive('bulkhead')
    expect(primitiveBounds(bulkhead)).toBe(bulkhead.bounds)
    expect(primitiveDimensions(bulkhead)).toEqual([4.8, 3, 0.1])
  })

  it('every primitive id has a default instance (exhaustive dispatch)', () => {
    for (const id of PRIMITIVE_IDS) {
      expect(defaultPrimitiveParts(id).length).toBeGreaterThan(0)
    }
    expect(() => defaultPrimitiveParts('airlock' as PrimitiveId)).toThrow(
      /no default instance/,
    )
  })

  it('catches a duplicated id, blank label, empty box, bad slots and slot order', () => {
    const duplicated = cloneCatalog()
    duplicated.push(cloneCatalog()[0])
    expect(kitPrimitiveProblems(duplicated)[0]).toMatch(/duplicated in the catalog/)

    const blankLabel = cloneCatalog()
    blankLabel[0].label = '  '
    expect(kitPrimitiveProblems(blankLabel)).toContainEqual(
      expect.stringMatching(/label is required/),
    )

    const emptyBox = cloneCatalog()
    emptyBox[0].bounds = { min: [0, 0, 0], max: [0, 3, 0.1] }
    expect(kitPrimitiveProblems(emptyBox)).toContainEqual(
      expect.stringMatching(/bounds are empty on the x axis/),
    )

    const noSlots = cloneCatalog()
    noSlots[0].materialSlots = []
    expect(kitPrimitiveProblems(noSlots)).toContainEqual(
      expect.stringMatching(/declares no material slots/),
    )

    const duplicatedSlot = cloneCatalog()
    duplicatedSlot[3].materialSlots = ['bulkhead', 'bulkhead']
    expect(kitPrimitiveProblems(duplicatedSlot)).toContainEqual(
      expect.stringMatching(/listed twice/),
    )

    const wrongOrder = cloneCatalog()
    const deckPlate = wrongOrder.find((p) => p.id === 'deck-plate') as KitPrimitive
    deckPlate.materialSlots = ['conduit', 'deckplate']
    expect(kitPrimitiveProblems(wrongOrder)).toContainEqual(
      expect.stringMatching(/not in MATERIAL_SLOTS order/),
    )
  })

  it('assertKitPrimitivesIntegrity throws listing every problem', () => {
    const broken = cloneCatalog()
    broken[0].label = ''
    broken[1].bounds = { min: [0, 0, 0], max: [0, 0, 0] }
    expect(() => assertKitPrimitivesIntegrity(broken)).toThrow(
      /kit primitive catalog integrity/,
    )
    expect(() => assertKitPrimitivesIntegrity(broken)).toThrow(/label is required/)
  })

  it('every default part carries a legal §4 slot', () => {
    for (const primitive of KIT_PRIMITIVES) {
      for (const part of defaultPrimitiveParts(primitive.id)) {
        expect(MATERIAL_SLOTS).toContain(part.materialSlot)
      }
    }
  })
})
