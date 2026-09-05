import { describe, expect, it } from 'vitest'
import { ROOM_MODULES, nonStandardDoors, spineDeckBand } from './kit'
import { measureJoin, placeModule } from './measure'
import type { SeamSpikeReport } from './stress'
import { OFFSET_SWEEP_MM, ROOM_IDS, runSeamSpike } from './stress'
import { SEAM_TOLERANCES } from './tolerances'
import { ZERO } from './vec'

const FLOAT_MM = 1e-6 // float-precision epsilon in mm

function reportCard(r: SeamSpikeReport): string {
  const e = r.exactness
  const lines = [
    '=== M0-T2 seam spike report card ===',
    `exactness: ${e.joins} joins @ zero offset -> max gap ${e.maxSeamGapMm.toFixed(6)} mm,` +
      ` max lateral ${e.maxLateralMm.toFixed(6)} mm, max vertical ${e.maxVerticalMm.toFixed(6)} mm,` +
      ` max floorStep ${e.maxFloorStepMm.toFixed(6)} mm`,
    `kit scanner flags ${e.flaggedDoors.length} non-standard door(s):` +
      e.flaggedDoors
        .map((d) => ` ${d.moduleId}.${d.socketId}@${d.centerY}m`)
        .join(',') +
      ` (tolerance ${SEAM_TOLERANCES.watertightGapMm} mm watertight / ${SEAM_TOLERANCES.hatchAlignMm} mm hatch)`,
  ]
  for (const axis of ['normal', 'lateral', 'vertical'] as const) {
    for (const policy of ['floorPinned', 'doorSolved'] as const) {
      const rows = r.offsets.filter((o) => o.axis === axis && o.policy === policy)
      const maxOffset = Math.max(...rows.map((o) => o.offsetMm))
      const worst = rows.find((o) => o.offsetMm === maxOffset)!
      const channel =
        axis === 'normal'
          ? `gap=${worst.seamGapMm.toFixed(3)}mm`
          : axis === 'lateral'
            ? `lateral=${worst.lateralMm.toFixed(3)}mm`
            : policy === 'floorPinned'
              ? `vertical=${worst.verticalMm.toFixed(3)}mm (swallowed by floor pin)`
              : `vertical=${worst.verticalMm.toFixed(3)}mm, floorStep=${worst.floorStepMm.toFixed(3)}mm`
      lines.push(
        `offset response ${policy} ${axis} (worst of ${maxOffset}mm across 5 room types): ${channel}`,
      )
    }
  }
  for (const n of r.noise) {
    lines.push(
      `noise ±${n.epsMm}mm: mated-door max gap ${n.maxSeamGapMm.toFixed(3)} mm,` +
        ` max lateral ${n.maxLateralMm.toFixed(3)} mm, max vertical ${n.maxVerticalMm.toFixed(3)} mm,` +
        ` far-face shift ${n.maxFarShiftMm.toFixed(3)} mm (bounds: door ≤ 2ε = ${(2 * n.epsMm).toFixed(3)} mm,` +
        ` watertight cap 2 mm, hatch cap 5 mm)`,
    )
  }
  for (const p of r.pathological) {
    const m = p.measurement
    lines.push(
      `pathological: ${p.label} -> gap ${m.seamGapMm.toFixed(1)} mm, lat ${m.lateralMm.toFixed(1)} mm,` +
        ` vert ${m.verticalMm.toFixed(1)} mm, floorStep ${m.floorStepMm.toFixed(1)} mm` +
        ` [watertight ${p.exceedsWatertight ? 'VIOLATED' : 'ok'}, hatch ${p.exceedsHatchAlign ? 'VIOLATED' : 'ok'}]`,
    )
  }
  lines.push(`fixed tolerances: ${JSON.stringify(SEAM_TOLERANCES)}`)
  lines.push('=== end report card ===')
  return lines.join('\n')
}

describe('M0-T2 seam spike — exactness (all six module types, zero offset)', () => {
  it('socket-solved joins are watertight to float precision across every module pair', () => {
    const r = runSeamSpike()
    expect(r.exactness.maxSeamGapMm).toBeLessThan(FLOAT_MM)
    expect(r.exactness.maxLateralMm).toBeLessThan(FLOAT_MM)
    expect(r.exactness.maxVerticalMm).toBeLessThan(FLOAT_MM)
    expect(r.exactness.maxFloorStepMm).toBeLessThan(FLOAT_MM)
    // Every room type must have participated (5 rooms × spine + room×room + side-door pairs).
    expect(r.exactness.joins).toBeGreaterThanOrEqual(78)
  })

  it("the kit scanner flags exactly engineering's non-standard high-hatch door", () => {
    const flagged = nonStandardDoors()
    expect(flagged).toEqual([
      { moduleId: 'engineering', socketId: 'high-hatch', centerY: 1.2 },
    ])
  })

  it('every room type can oppose the spine face and mate flush', () => {
    const spine = placeModule(spineDeckBand(0), 0, ZERO)
    for (const room of ROOM_MODULES) {
      for (const policy of ['floorPinned', 'doorSolved'] as const) {
        const m = measureJoin(spine, '+z', room, 'spine-door', {
          policy,
          deckFloorY: 0,
        })
        // Mating puts the room's spine face exactly on the spine face plane (z=+0.7).
        expect(Math.abs(m.seamGapMm)).toBeLessThan(FLOAT_MM)
        expect(m.bDoorCenter[2]).toBeCloseTo(0.7, 9)
        expect(m.bFloorY).toBeCloseTo(0, 9)
      }
    }
  })
})

describe('M0-T2 seam spike — offset response is linear and axis-separated', () => {
  it('normal offsets become open seams of exactly the offset, under both policies', () => {
    const r = runSeamSpike()
    for (const roomId of ROOM_IDS) {
      for (const policy of ['floorPinned', 'doorSolved'] as const) {
        for (const offsetMm of OFFSET_SWEEP_MM) {
          const row = r.offsets.find(
            (o) =>
              o.roomId === roomId &&
              o.policy === policy &&
              o.axis === 'normal' &&
              o.offsetMm === offsetMm,
          )!
          expect(row.seamGapMm).toBeCloseTo(offsetMm, 9) // slope 1.000, no amplification
          expect(row.lateralMm).toBeCloseTo(0, 6)
          expect(row.verticalMm).toBeCloseTo(0, 6)
        }
      }
    }
  })

  it('lateral offsets become lateral hatch misalignment of exactly the offset', () => {
    const r = runSeamSpike()
    for (const roomId of ROOM_IDS) {
      for (const policy of ['floorPinned', 'doorSolved'] as const) {
        for (const offsetMm of OFFSET_SWEEP_MM) {
          const row = r.offsets.find(
            (o) =>
              o.roomId === roomId &&
              o.policy === policy &&
              o.axis === 'lateral' &&
              o.offsetMm === offsetMm,
          )!
          expect(row.lateralMm).toBeCloseTo(offsetMm, 9)
          expect(row.seamGapMm).toBeCloseTo(0, 6)
          expect(row.verticalMm).toBeCloseTo(0, 6)
        }
      }
    }
  })

  it('vertical offsets: floor-pinned swallows them (door still mates); door-solved converts them to a floor step', () => {
    const r = runSeamSpike()
    for (const roomId of ROOM_IDS) {
      for (const offsetMm of OFFSET_SWEEP_MM) {
        const pinned = r.offsets.find(
          (o) =>
            o.roomId === roomId &&
            o.policy === 'floorPinned' &&
            o.axis === 'vertical' &&
            o.offsetMm === offsetMm,
        )!
        // Floor pinned to the deck plate: the door lands back on the real socket
        // (standard 1.0 m centers) — a pure vertical spec drift self-corrects.
        expect(pinned.verticalMm).toBeCloseTo(0, 6)
        expect(pinned.floorStepMm).toBeCloseTo(0, 6)

        const solved = r.offsets.find(
          (o) =>
            o.roomId === roomId &&
            o.policy === 'doorSolved' &&
            o.axis === 'vertical' &&
            o.offsetMm === offsetMm,
        )!
        // Door-solved: B floats up by the offset — visible at the door AND as a floor step.
        expect(solved.verticalMm).toBeCloseTo(offsetMm, 9)
        expect(solved.floorStepMm).toBeCloseTo(offsetMm, 9)
      }
    }
  })
})

describe('M0-T2 seam spike — authoring noise fixes the kit error budget', () => {
  it('worst measured mated-door defect stays at or under 2ε for every noise level', () => {
    const r = runSeamSpike()
    for (const row of r.noise) {
      const bound = 2 * row.epsMm + FLOAT_MM
      expect(row.maxSeamGapMm).toBeLessThanOrEqual(bound)
      expect(row.maxLateralMm).toBeLessThanOrEqual(bound)
      expect(row.maxVerticalMm).toBeLessThanOrEqual(bound)
      // Mated-door seams are immune to in-plane noise (placement snaps the
      // socket onto the target); the gap/lateral channels measure ~0 while
      // the door-height (vertical) channel carries the ≤ 2ε noise.
      expect(row.maxSeamGapMm).toBeLessThan(0.01)
      expect(row.maxLateralMm).toBeLessThan(0.01)
    }
  })

  it('in-plane noise propagates as a rigid far-face shift ≤ 2ε (independent bulkhead meets)', () => {
    const r = runSeamSpike()
    for (const row of r.noise) {
      expect(row.maxFarShiftMm).toBeLessThanOrEqual(2 * row.epsMm + FLOAT_MM)
      // Far-face shift is the watertight channel for edge-to-edge bulkhead
      // meets between independently-placed modules — it must clear 2 mm.
      if (row.epsMm === 0.5) {
        expect(row.maxFarShiftMm).toBeLessThan(SEAM_TOLERANCES.watertightGapMm)
        expect(row.maxFarShiftMm).toBeGreaterThan(0.1) // noise actually moved modules
      }
    }
  })

  it('±0.5 mm authoring noise: every channel clears its cap with ≥2× margin', () => {
    const r = runSeamSpike()
    const row = r.noise.find((n) => n.epsMm === 0.5)!
    // Vertical door-center noise is a hatch-alignment channel (5 mm cap).
    expect(row.maxVerticalMm).toBeLessThan(SEAM_TOLERANCES.hatchAlignMm)
    expect(SEAM_TOLERANCES.hatchAlignMm / row.maxVerticalMm).toBeGreaterThanOrEqual(5)
    // Far-face shift stays ≤ 1.0 mm — ≥2× margin under the 2 mm watertight cap.
    expect(row.maxFarShiftMm).toBeLessThanOrEqual(1.0 + FLOAT_MM)
    expect(SEAM_TOLERANCES.watertightGapMm / row.maxFarShiftMm).toBeGreaterThanOrEqual(
      2,
    )
    // Mated-door seams: zero margin consumption at all.
    expect(row.maxSeamGapMm).toBeLessThan(FLOAT_MM)
  })

  it('±1.0 mm noise consumes the entire watertight margin (zero headroom — the ceiling)', () => {
    const r = runSeamSpike()
    const row = r.noise.find((n) => n.epsMm === 1.0)!
    // 2ε = 2.0 mm equals the watertight cap exactly: no margin left.
    expect(row.maxFarShiftMm).toBeLessThanOrEqual(2 * row.epsMm + FLOAT_MM)
    expect(SEAM_TOLERANCES.maxSocketAuthoringErrorMm).toBe(0.5)
    expect(SEAM_TOLERANCES.watertightGapMm / (2 * row.epsMm)).toBeLessThanOrEqual(1)
  })
})

describe('M0-T2 seam spike — pathological joins define the validator reject set', () => {
  it('≥10 mm spec offsets and authored height mismatches exceed both caps', () => {
    const r = runSeamSpike()
    const p = r.pathological
    expect(p).toHaveLength(5)

    // 10 mm normal offset -> 10 mm open seam: watertight VIOLATED (hatch still fine).
    expect(p[0].measurement.seamGapMm).toBeCloseTo(10, 6)
    expect(p[0].exceedsWatertight).toBe(true)
    expect(p[0].exceedsHatchAlign).toBe(false)

    // 25 mm lateral offset -> 25 mm lateral misalignment: both caps blown.
    expect(p[1].measurement.lateralMm).toBeCloseTo(25, 6)
    expect(p[1].exceedsWatertight).toBe(true)
    expect(p[1].exceedsHatchAlign).toBe(true)

    // 25 mm vertical offset, door-solved -> 25 mm door miss + 25 mm floor step.
    expect(p[2].measurement.verticalMm).toBeCloseTo(25, 6)
    expect(p[2].measurement.floorStepMm).toBeCloseTo(25, 6)
    expect(p[2].exceedsHatchAlign).toBe(true)

    // Authored deck offset: engineering's 1.2 m high-hatch vs a standard 1.0 m door.
    // Floor-pinned: a 200 mm step AT THE DOOR (stuck hatch, sev-1 class).
    expect(p[3].measurement.verticalMm).toBeCloseTo(200, 6)
    expect(p[3].measurement.floorStepMm).toBeCloseTo(0, 6)
    expect(p[3].exceedsHatchAlign).toBe(true)

    // Same mismatch door-solved: door mates, but the module floor steps 200 mm off the deck.
    expect(p[4].measurement.verticalMm).toBeCloseTo(0, 6)
    expect(p[4].measurement.floorStepMm).toBeCloseTo(200, 6)
    expect(p[4].exceedsHatchAlign).toBe(true)
  })
})

describe('M0-T2 seam spike — tolerances fixed from the measurements', () => {
  it('report carries the fixed [auto] tolerance constants', () => {
    const r = runSeamSpike()
    expect(r.tolerances).toBe(SEAM_TOLERANCES)
    expect(r.tolerances.watertightGapMm).toBe(2)
    expect(r.tolerances.hatchAlignMm).toBe(5)
    expect(r.tolerances.maxSocketAuthoringErrorMm).toBe(0.5)
    expect(r.tolerances.standardDoorCenterM).toBe(1.0)
  })

  it('report card (for docs/spikes.md)', () => {
    console.log(reportCard(runSeamSpike()))
    expect(true).toBe(true)
  })
})
