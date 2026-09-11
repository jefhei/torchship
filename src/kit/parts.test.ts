import { describe, expect, it } from 'vitest'
import { DECK_CLEAR_M, STANDARD_DOOR_CENTER_M, STANDARD_DOOR_SIZE } from '../types'
import type { Aabb3 } from '../types'
import {
  bulkheadParts,
  coffeeStationParts,
  conduitRunParts,
  couchParts,
  deckPlateParts,
  hatchParts,
  heatShieldParts,
  ladderSegmentParts,
  lockerParts,
  partBounds,
  partCount,
  partMaterialSlots,
  panelLightParts,
  partsBounds,
  partsSize,
  screenParts,
  tableParts,
} from './parts'
import type { BoxPart, CylinderPart, KitPart } from './types'

/** Every part in the list must carry the given slot (order-independent). */
function slotsOf(parts: readonly KitPart[]): string[] {
  return parts.map((part) => part.materialSlot)
}

function boxAt(parts: readonly KitPart[], index: number): BoxPart {
  const part = parts[index]
  expect(part.kind).toBe('box')
  return part as BoxPart
}

function cylinderAt(parts: readonly KitPart[], index: number): CylinderPart {
  const part = parts[index]
  expect(part.kind).toBe('cylinder')
  return part as CylinderPart
}

function expectVec(actual: readonly number[], expected: readonly number[]): void {
  expect(actual).toHaveLength(expected.length)
  for (let i = 0; i < expected.length; i++) {
    expect(actual[i]).toBeCloseTo(expected[i], 9)
  }
}

describe('kit part builders (M2-T1)', () => {
  describe('bulkhead', () => {
    it('a solid panel is one box standing on local y = 0', () => {
      const parts = bulkheadParts({ width: 4.8, height: 3, thickness: 0.1 })
      expect(parts).toHaveLength(1)
      const panel = boxAt(parts, 0)
      expectVec(panel.size, [4.8, 3, 0.1])
      expectVec(panel.position, [0, 1.5, 0])
      expect(slotsOf(parts)).toEqual(['bulkhead'])
    })

    it('a standard doorway is a hole of exactly door.width × door.height', () => {
      const parts = bulkheadParts({
        width: 4.8,
        height: 3,
        thickness: 0.1,
        door: { ...STANDARD_DOOR_SIZE, centerY: STANDARD_DOOR_CENTER_M },
      })
      // Two piers + a lintel above the door; the door bottom sits on the floor,
      // so there is no sill.
      expect(parts).toHaveLength(3)

      const doorWidth = STANDARD_DOOR_SIZE.width
      const doorHeight = STANDARD_DOOR_SIZE.height
      const pierWidth = (4.8 - doorWidth) / 2
      const leftPier = boxAt(parts, 0)
      const rightPier = boxAt(parts, 1)
      const lintel = boxAt(parts, 2)
      expectVec(leftPier.size, [pierWidth, 3, 0.1])
      expectVec(leftPier.position, [-(4.8 + doorWidth) / 4, 1.5, 0])
      expectVec(rightPier.position, [(4.8 + doorWidth) / 4, 1.5, 0])
      expectVec(lintel.size, [doorWidth, 3 - doorHeight, 0.1])
      expect(lintel.position[1]).toBeCloseTo((doorHeight + 3) / 2, 9)

      // The piers' inner edges and the lintel's underside bound the opening.
      const innerLeft = leftPier.position[0] + leftPier.size[0] / 2
      const innerRight = rightPier.position[0] - rightPier.size[0] / 2
      expect(innerLeft).toBeCloseTo(-doorWidth / 2, 9)
      expect(innerRight).toBeCloseTo(doorWidth / 2, 9)
      expect(lintel.position[1] - lintel.size[1] / 2).toBeCloseTo(doorHeight, 9)

      // Wall material removed == the doorway area (the build's whole point).
      const solid = parts.reduce((area, part) => {
        const box = part as BoxPart
        return area + box.size[0] * box.size[1]
      }, 0)
      expect(solid).toBeCloseTo(4.8 * 3 - doorWidth * doorHeight, 9)
    })

    it('a raised doorway also emits the sill below it', () => {
      const parts = bulkheadParts({
        width: 4.8,
        height: 3,
        thickness: 0.1,
        door: { width: 0.8, height: 1.6, centerY: 1.2 },
      })
      expect(parts).toHaveLength(4)
      const sill = boxAt(parts, 2)
      // 1.2 − 1.6/2 = 0.4 m of wall under the opening.
      expectVec(sill.size, [0.8, 0.4, 0.1])
      expectVec(sill.position, [0, 0.2, 0])
      const lintel = boxAt(parts, 3)
      expectVec(lintel.size, [0.8, 1, 0.1])
    })

    it('rejects a doorway that leaves no panel or does not fit the wall', () => {
      expect(() =>
        bulkheadParts({
          width: 4.8,
          height: 3,
          thickness: 0.1,
          door: { width: 4.8, height: 2, centerY: 1 },
        }),
      ).toThrow(/leaves no panel/)
      expect(() =>
        bulkheadParts({
          width: 4.8,
          height: 3,
          thickness: 0.1,
          door: { width: 0.9, height: 2, centerY: 2.5 },
        }),
      ).toThrow(/does not fit/)
      expect(() => bulkheadParts({ width: 0, height: 3, thickness: 0.1 })).toThrow(
        /must be positive/,
      )
    })
  })

  describe('deck plate', () => {
    it('puts the walking surface at local y = 0 with the plate beneath it', () => {
      const parts = deckPlateParts({ width: 4.8, depth: 5, thickness: 0.2 })
      expect(parts).toHaveLength(1)
      const plate = boxAt(parts, 0)
      expect(plate.materialSlot).toBe('deckplate')
      expectVec(plate.size, [4.8, 0.2, 5])
      expectVec(plate.position, [0, -0.1, 0])
      expect(partsBounds(parts).max[1]).toBe(0)
    })

    it('lays cable runs centred on the plate, in the conduit slot', () => {
      const parts = deckPlateParts({
        width: 4.8,
        depth: 5,
        thickness: 0.2,
        cableRuns: { count: 3, width: 0.12, height: 0.06, spacing: 1.6 },
      })
      expect(parts).toHaveLength(4)
      expect(slotsOf(parts)).toEqual(['deckplate', 'conduit', 'conduit', 'conduit'])
      const zs = parts.slice(1).map((part) => part.position[2])
      expectVec(zs, [-1.6, 0, 1.6])
      expectVec(boxAt(parts, 1).size, [4.8, 0.06, 0.12])
    })

    it('rejects a non-integer cable-run count', () => {
      expect(() =>
        deckPlateParts({
          width: 4.8,
          depth: 5,
          thickness: 0.2,
          cableRuns: { count: 1.5, width: 0.12, height: 0.06, spacing: 1.6 },
        }),
      ).toThrow(/non-negative integer/)
    })
  })

  describe('conduit run', () => {
    it('is a bare cylinder along its axis', () => {
      const parts = conduitRunParts({ length: 3, radius: 0.05, axis: 'x' })
      expect(parts).toHaveLength(1)
      const pipe = cylinderAt(parts, 0)
      expect(pipe.materialSlot).toBe('conduit')
      expect(pipe.axis).toBe('x')
      expect(pipe.length).toBe(3)
      expect(pipe.radius).toBe(0.05)
    })

    it('adds evenly spaced clamps sized around the pipe', () => {
      const parts = conduitRunParts({
        length: 3,
        radius: 0.05,
        axis: 'x',
        brackets: 4,
        clampThickness: 0.03,
      })
      expect(parts).toHaveLength(5)
      // 2r + strap = 0.13 m across, at 3/5 splits of the run.
      const clamp = boxAt(parts, 1)
      expectVec(clamp.size, [0.03, 0.13, 0.13])
      expectVec(
        parts.slice(1).map((part) => part.position[0]),
        [-0.9, -0.3, 0.3, 0.9],
      )
    })

    it('orients clamps for a Y or Z run too', () => {
      const yRun = conduitRunParts({ length: 2, radius: 0.04, axis: 'y', brackets: 1 })
      expectVec(boxAt(yRun, 1).size, [0.11, 0.03, 0.11])
      const zRun = conduitRunParts({ length: 2, radius: 0.04, axis: 'z', brackets: 1 })
      expectVec(boxAt(zRun, 1).size, [0.11, 0.11, 0.03])
    })

    it('rejects a negative bracket count', () => {
      expect(() =>
        conduitRunParts({ length: 3, radius: 0.05, axis: 'x', brackets: -1 }),
      ).toThrow(/non-negative integer/)
    })
  })

  describe('panel light', () => {
    it('is a bulkhead housing with an emissive lens below it', () => {
      const parts = panelLightParts({
        width: 0.6,
        depth: 0.3,
        housingThickness: 0.06,
        lensInset: 0.08,
      })
      expect(parts).toHaveLength(2)
      expect(slotsOf(parts)).toEqual(['bulkhead', 'panel-light'])
      const lens = boxAt(parts, 1)
      expectVec(lens.size, [0.6 * 0.84, 0.06 * 0.6, 0.3 * 0.84])
      expectVec(lens.position, [0, -0.03, 0])
      // Lens hangs below the housing centre (ceiling mount).
      expect(lens.position[1] + lens.size[1] / 2).toBeLessThan(0)
    })

    it('rejects a lens inset that would erase the lens', () => {
      expect(() =>
        panelLightParts({
          width: 0.6,
          depth: 0.3,
          housingThickness: 0.06,
          lensInset: 0.5,
        }),
      ).toThrow(/lensInset/)
    })
  })

  describe('hatch', () => {
    const standardHatch = () =>
      hatchParts({
        door: { width: STANDARD_DOOR_SIZE.width, height: STANDARD_DOOR_SIZE.height },
        leafThickness: 0.05,
        frameWidth: 0.05,
        clearance: 0.01,
      })

    it('is socket-centred: the leaf is centred on the local origin', () => {
      const parts = standardHatch()
      expect(parts).toHaveLength(6)
      const leaf = boxAt(parts, 0)
      expectVec(leaf.position, [0, 0, 0])
      // Leaf is inset from the opening by the clearance all round.
      expectVec(leaf.size, [
        STANDARD_DOOR_SIZE.width - 0.02,
        STANDARD_DOOR_SIZE.height - 0.02,
        0.05,
      ])
    })

    it('frames the opening on all four sides', () => {
      const parts = standardHatch()
      const frame = parts.slice(1, 5)
      for (const member of frame) {
        expect(member.materialSlot).toBe('bulkhead')
      }
      const [top, bottom, left, right] = frame
      expect(top.position[1]).toBeCloseTo(1.025, 9)
      expect(bottom.position[1]).toBeCloseTo(-1.025, 9)
      expect(left.position[0]).toBeCloseTo(-0.475, 9)
      expect(right.position[0]).toBeCloseTo(0.475, 9)
      // Frame is thicker than the leaf so the leaf can't z-fight it.
      expect((top as BoxPart).size[2]).toBeGreaterThan(0.05)
    })

    it('carries a worn hazard stripe inside the leaf', () => {
      const parts = standardHatch()
      const stripe = boxAt(parts, 5)
      expect(stripe.materialSlot).toBe('hazard')
      const leaf = boxAt(parts, 0)
      const leafBottom = leaf.position[1] - leaf.size[1] / 2
      const leafTop = leaf.position[1] + leaf.size[1] / 2
      expect(stripe.position[1] - stripe.size[1] / 2).toBeGreaterThanOrEqual(leafBottom)
      expect(stripe.position[1] + stripe.size[1] / 2).toBeLessThanOrEqual(leafTop)
      // Proud of the leaf face, still inside the frame depth.
      expect(stripe.size[2]).toBeGreaterThan(leaf.size[2])
    })

    it('rejects a clearance that swallows the leaf or a missing frame', () => {
      expect(() =>
        hatchParts({
          door: { width: 0.9, height: 2 },
          leafThickness: 0.05,
          frameWidth: 0.05,
          clearance: 0.5,
        }),
      ).toThrow(/no leaf/)
      expect(() =>
        hatchParts({
          door: { width: 0.9, height: 2 },
          leafThickness: 0.05,
          frameWidth: 0,
          clearance: 0.01,
        }),
      ).toThrow(/must be positive/)
    })
  })

  describe('ladder segment', () => {
    it('is two rails plus rungs derived from the spacing', () => {
      const parts = ladderSegmentParts({
        height: DECK_CLEAR_M,
        width: 0.45,
        railRadius: 0.03,
        rungRadius: 0.025,
        rungSpacing: 0.3,
      })
      // 2 rails + rungs at 0.3 … 2.7 (the last rung must not poke the ceiling).
      expect(partCount(parts)).toBe(2 + 9)
      expect(slotsOf(parts).slice(0, 2)).toEqual(['conduit', 'conduit'])

      const rails = parts.slice(0, 2).map((part) => cylinderAt([part], 0))
      expect(rails.every((rail) => rail.axis === 'y')).toBe(true)
      expectVec(
        rails.map((rail) => rail.position[0]),
        [0.195, -0.195],
      )
      expectVec(
        rails.map((rail) => rail.length),
        [DECK_CLEAR_M, DECK_CLEAR_M],
      )

      const rungs = parts.slice(2).map((p) => cylinderAt([p], 0))
      expect(rungs.every((rung) => rung.axis === 'x')).toBe(true)
      expectVec(
        rungs.map((rung) => rung.position[1]),
        [0.3, 0.6, 0.9, 1.2, 1.5, 1.8, 2.1, 2.4, 2.7],
      )
      // Rungs span between the rails, not through them.
      expectVec(
        rungs.map((rung) => rung.length),
        Array(9).fill(0.39),
      )
    })

    it('keeps every part inside the storey bounds', () => {
      const parts = ladderSegmentParts({
        height: DECK_CLEAR_M,
        width: 0.45,
        railRadius: 0.03,
        rungRadius: 0.025,
        rungSpacing: 0.3,
      })
      const bounds = partsBounds(parts)
      expect(bounds.min[1]).toBe(0)
      expect(bounds.max[1]).toBe(DECK_CLEAR_M)
      expect(bounds.max[0]).toBeCloseTo(0.225, 9)
      expect(bounds.max[2]).toBeCloseTo(0.03, 9)
    })

    it('rejects a first rung above the storey or overlapping rails', () => {
      expect(() =>
        ladderSegmentParts({
          height: 1,
          width: 0.45,
          railRadius: 0.03,
          rungRadius: 0.025,
          rungSpacing: 0.3,
          firstRungY: 1.5,
        }),
      ).toThrow(/does not fit/)
      expect(() =>
        ladderSegmentParts({
          height: 3,
          width: 0.05,
          railRadius: 0.03,
          rungRadius: 0.025,
          rungSpacing: 0.3,
        }),
      ).toThrow(/overlap/)
    })
  })

  describe('locker', () => {
    it('is a body with one door panel and handle per door', () => {
      const parts = lockerParts({
        width: 0.9,
        height: 2,
        depth: 0.45,
        doors: 1,
        doorThickness: 0.03,
        doorGap: 0.02,
      })
      expect(parts).toHaveLength(3)
      expect(slotsOf(parts)).toEqual(['bulkhead', 'bulkhead', 'conduit'])
      const panel = boxAt(parts, 1)
      // Proud of the +Z face, inset from the body edges.
      expectVec(panel.size, [0.88, 1.96, 0.03])
      expect(panel.position[2]).toBeGreaterThan(0.225)
      const handle = boxAt(parts, 2)
      expect(handle.position[2]).toBeGreaterThan(panel.position[2])
    })

    it('splits a bank into evenly spaced doors', () => {
      const parts = lockerParts({
        width: 1.8,
        height: 2,
        depth: 0.45,
        doors: 3,
        doorThickness: 0.03,
        doorGap: 0.02,
      })
      expect(parts).toHaveLength(1 + 3 * 2)
      const doorXs = [1, 3, 5].map((i) => boxAt(parts, i).position[0])
      expectVec(doorXs, [-0.6, 0, 0.6])
    })

    it('rejects zero doors', () => {
      expect(() =>
        lockerParts({
          width: 0.9,
          height: 2,
          depth: 0.45,
          doors: 0,
          doorThickness: 0.03,
          doorGap: 0.02,
        }),
      ).toThrow(/positive integer/)
    })
  })

  describe('screen', () => {
    it('is a bezel with an emissive panel proud of the +Z face', () => {
      const parts = screenParts({ width: 0.7, height: 0.45, depth: 0.06, bezel: 0.03 })
      expect(parts).toHaveLength(2)
      expect(slotsOf(parts)).toEqual(['bulkhead', 'screen'])
      const panel = boxAt(parts, 1)
      expectVec(panel.size, [0.64, 0.39, 0.03])
      expect(panel.position[2]).toBeGreaterThan(0)
    })

    it('rejects a bezel wider than the screen', () => {
      expect(() =>
        screenParts({ width: 0.7, height: 0.45, depth: 0.06, bezel: 0.4 }),
      ).toThrow(/no panel/)
    })
  })

  describe('couch', () => {
    it('is a pedestal, seat, backrest and webbing straps', () => {
      const parts = couchParts({
        width: 0.8,
        depth: 0.9,
        seatHeight: 0.5,
        backHeight: 0.7,
        straps: 3,
      })
      expect(parts).toHaveLength(6)
      expect(slotsOf(parts)).toEqual([
        'bulkhead',
        'bulkhead',
        'bulkhead',
        'webbing',
        'webbing',
        'webbing',
      ])
      const bounds = partsBounds(parts)
      expect(bounds.min[1]).toBe(0)
      expect(bounds.max[1]).toBeCloseTo(1.2, 9)
      // Backrest sits at the −Z end, straps ride on it.
      const back = boxAt(parts, 2)
      expect(back.position[2]).toBeLessThan(0)
      expectVec(
        parts.slice(3).map((part) => part.position[1]),
        [0.675, 0.85, 1.025],
      )
    })

    it('rejects a negative strap count', () => {
      expect(() =>
        couchParts({
          width: 0.8,
          depth: 0.9,
          seatHeight: 0.5,
          backHeight: 0.7,
          straps: -1,
        }),
      ).toThrow(/non-negative integer/)
    })
  })

  describe('table', () => {
    it('is a top on four pipe legs, floor at y = 0', () => {
      const parts = tableParts({
        width: 1.6,
        depth: 0.8,
        height: 0.75,
        topThickness: 0.05,
        legRadius: 0.03,
      })
      expect(parts).toHaveLength(5)
      const top = boxAt(parts, 0)
      expectVec(top.size, [1.6, 0.05, 0.8])
      expectVec(top.position, [0, 0.725, 0])
      const legs = parts.slice(1).map((p) => cylinderAt([p], 0))
      expect(legs.every((leg) => leg.axis === 'y' && leg.length === 0.7)).toBe(true)
      expectVec(
        legs.map((leg) => leg.position[0]),
        [0.74, -0.74, 0.74, -0.74],
      )
      expectVec(
        legs.map((leg) => leg.position[2]),
        [0.34, 0.34, -0.34, -0.34],
      )
      expect(partsBounds(parts).max[1]).toBeCloseTo(0.75, 9)
    })
  })

  describe('coffee station', () => {
    it('carries the reserved warm accent, a glass carafe and a task light', () => {
      const parts = coffeeStationParts({
        width: 1,
        height: 0.95,
        depth: 0.6,
        accentThickness: 0.04,
        carafeRadius: 0.07,
        carafeHeight: 0.22,
      })
      expect(partMaterialSlots(parts)).toEqual([
        'bulkhead',
        'panel-light',
        'screen',
        'coffee-accent',
      ])
      const accent = boxAt(parts, 1)
      expect(accent.materialSlot).toBe('coffee-accent')
      // Backsplash sits proud of the −Z face.
      expect(accent.position[2]).toBeLessThan(-0.3)
      const carafe = cylinderAt(parts, 2)
      expect(carafe.axis).toBe('y')
      expect(carafe.position[1] - carafe.length / 2).toBeCloseTo(0.95, 9)
    })
  })

  describe('heat shield', () => {
    it('is a ceramic plate with a hazard stripe inset from its edges', () => {
      const parts = heatShieldParts({
        width: 1.2,
        height: 0.8,
        thickness: 0.04,
        stripeHeight: 0.1,
      })
      expect(parts).toHaveLength(2)
      expect(slotsOf(parts)).toEqual(['ceramic', 'hazard'])
      const stripe = boxAt(parts, 1)
      expect(stripe.size[2]).toBeGreaterThan(0.04)
      expect(stripe.position[1] - stripe.size[1] / 2).toBeGreaterThan(-0.4)
      expect(stripe.position[1] + stripe.size[1] / 2).toBeLessThan(0.4)
    })

    it('rejects a stripe taller than the plate', () => {
      expect(() =>
        heatShieldParts({
          width: 1.2,
          height: 0.2,
          thickness: 0.04,
          stripeHeight: 0.3,
        }),
      ).toThrow(/does not fit/)
    })
  })

  describe('inspection helpers', () => {
    it('partBounds is rotation-aware for boxes', () => {
      const flat: BoxPart = {
        kind: 'box',
        materialSlot: 'bulkhead',
        size: [2, 1, 0.2],
        position: [0, 0, 0],
      }
      expect(partBounds(flat)).toEqual({
        min: [-1, -0.5, -0.1],
        max: [1, 0.5, 0.1],
      })
      const turned = partBounds({ ...flat, rotation: 1 })
      // A quarter-turn swaps the X and Z extents.
      expect(turned).toEqual({ min: [-0.1, -0.5, -1], max: [0.1, 0.5, 1] })
      expect(partBounds({ ...flat, rotation: 2 })).toEqual(partBounds(flat))
    })

    it('partBounds follows a cylinder axis', () => {
      const base: CylinderPart = {
        kind: 'cylinder',
        materialSlot: 'conduit',
        radius: 0.05,
        length: 2,
        axis: 'x',
        position: [0, 0, 0],
      }
      expect(partBounds(base)).toEqual({
        min: [-1, -0.05, -0.05],
        max: [1, 0.05, 0.05],
      })
      expect(partBounds({ ...base, axis: 'y' })).toEqual({
        min: [-0.05, -1, -0.05],
        max: [0.05, 1, 0.05],
      })
      expect(partBounds({ ...base, axis: 'z' })).toEqual({
        min: [-0.05, -0.05, -1],
        max: [0.05, 0.05, 1],
      })
    })

    it('partsBounds folds every part and refuses an empty list', () => {
      const parts = [
        {
          kind: 'box' as const,
          materialSlot: 'bulkhead' as const,
          size: [1, 1, 1] as const,
          position: [3, 4, 5] as const,
        },
        {
          kind: 'box' as const,
          materialSlot: 'conduit' as const,
          size: [1, 1, 1] as const,
          position: [-3, -4, -5] as const,
        },
      ]
      const bounds: Aabb3 = partsBounds(parts)
      expect(bounds.min).toEqual([-3.5, -4.5, -5.5])
      expect(bounds.max).toEqual([3.5, 4.5, 5.5])
      expect(() => partsBounds([])).toThrow(/no parts/)
    })

    it('partMaterialSlots de-duplicates into canonical slot order', () => {
      const parts = [
        {
          kind: 'box' as const,
          materialSlot: 'hazard' as const,
          size: [1, 1, 1] as const,
          position: [0, 0, 0] as const,
        },
        {
          kind: 'box' as const,
          materialSlot: 'bulkhead' as const,
          size: [1, 1, 1] as const,
          position: [0, 0, 0] as const,
        },
        {
          kind: 'box' as const,
          materialSlot: 'bulkhead' as const,
          size: [1, 1, 1] as const,
          position: [0, 0, 0] as const,
        },
      ]
      expect(partMaterialSlots(parts)).toEqual(['bulkhead', 'hazard'])
    })

    it('partsSize reports the part list extent', () => {
      const parts = tableParts({
        width: 1.6,
        depth: 0.8,
        height: 0.75,
        topThickness: 0.05,
        legRadius: 0.03,
      })
      expectVec(partsSize(parts), [1.6, 0.75, 0.8])
    })

    it('normalizes −0: a centred run through the origin stays +0', () => {
      const parts = deckPlateParts({
        width: 4.8,
        depth: 5,
        thickness: 0.2,
        cableRuns: { count: 1, width: 0.12, height: 0.06, spacing: 1.6 },
      })
      const bounds = partsBounds(parts)
      for (let axis = 0; axis < 3; axis++) {
        expect(Object.is(bounds.min[axis], -0)).toBe(false)
        expect(Object.is(bounds.max[axis], -0)).toBe(false)
      }
    })
  })
})
