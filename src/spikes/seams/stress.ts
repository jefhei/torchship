/**
 * M0-T2 spike — the seam stress spec and measurement runs.
 *
 * Joins ALL SIX module types (head, galley, ops, engineering, storage,
 * spine) under stress: deliberate spec offsets in three directions, both
 * placement policies, and seeded authoring noise. Produces the measured
 * numbers the spike verdict in docs/spikes.md is built on, and the
 * tolerance constants in tolerances.ts.
 *
 * Runs (see seamStress.test.ts for the assertions that pin them):
 *  - exactness: every module↔module and module↔spine join at zero offset —
 *    expect float-exact seams for standard-height doors.
 *  - offsets: spine↔room joins for each room type at δ ∈ {1, 2, 5, 10, 25}
 *    mm along the normal / lateral / vertical axis, under both policies —
 *    expect a linear, axis-separated response (slope 1.000).
 *  - noise: seeded ±ε per-axis authoring error on both sockets of every
 *    room↔room join, ε ∈ {0.25, 0.5, 1.0} mm — expect worst defect ≤ 2ε.
 *  - pathological: the joins a real spec must never contain (≥ 10 mm
 *    offsets; engineering's non-standard 1.2 m high-hatch mated to a
 *    standard 1.0 m door) — expect every metric beyond both caps.
 */

import type { ModuleDef } from './kit'
import { ROOM_MODULES, nonStandardDoors, spineDeckBand } from './kit'
import { deckFloorY } from './kit'
import type { JoinMeasurement, Policy } from './measure'
import { measureJoin, placeModule } from './measure'
import { SEAM_TOLERANCES } from './tolerances'
import { MM, ZERO } from './vec'

export const ROOM_IDS = ['head', 'galley', 'ops', 'engineering', 'storage'] as const
export type RoomId = (typeof ROOM_IDS)[number]

/** Offset sweep magnitudes, mm. 10/25 are the pathological (reject) cases. */
export const OFFSET_SWEEP_MM = [1, 2, 5, 10, 25] as const
export const NOISE_SWEEP_MM = [0.25, 0.5, 1.0] as const
export const NOISE_SEED = 0x5eed

export interface PathologicalRow {
  label: string
  measurement: JoinMeasurement
  exceedsWatertight: boolean
  exceedsHatchAlign: boolean
}

export interface OffsetRow {
  roomId: string
  policy: Policy
  axis: 'normal' | 'lateral' | 'vertical'
  offsetMm: number
  /** The metric that carries the offset (gap for normal, lateral, vertical/floorStep). */
  seamGapMm: number
  lateralMm: number
  verticalMm: number
  floorStepMm: number
}

export interface NoiseRow {
  epsMm: number
  joins: number
  maxSeamGapMm: number
  maxLateralMm: number
  maxVerticalMm: number
  /**
   * Rigid in-plane shift of the module's far bulkhead face (and any far
   * door) caused by authoring noise at the mated socket — the noise channel
   * that matters for independent bulkhead meets: two noise-perturbed
   * modules meeting edge-to-edge drift apart by ≤ 2ε.
   */
  maxFarShiftMm: number
}

export interface SeamSpikeReport {
  /** 1: exactness — socket-solved joins at zero offset. */
  exactness: {
    joins: number
    maxSeamGapMm: number
    maxLateralMm: number
    maxVerticalMm: number
    maxFloorStepMm: number
    /** Non-standard door centers the kit scanner flags (engineering). */
    flaggedDoors: { moduleId: string; socketId: string; centerY: number }[]
  }
  /** 2: offset response — spine↔each-room joins under both policies. */
  offsets: OffsetRow[]
  /** 3: authoring noise — room↔room joins, both sockets perturbed ±ε. */
  noise: NoiseRow[]
  /** 4: pathological joins a spec must never contain. */
  pathological: PathologicalRow[]
  /** The invariant tolerances fixed from the measurements above. */
  tolerances: typeof SEAM_TOLERANCES
}

function roomById(id: string): ModuleDef {
  const m = ROOM_MODULES.find((r) => r.id === id)
  if (!m) throw new Error(`unknown room ${id}`)
  return m
}

/** Mulberry32 seeded PRNG — deterministic noise across runs and machines. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Perturb every socket center of `def` by up to ±eps per axis, in place. */
function applyAuthoringNoise(def: ModuleDef, epsMm: number, rand: () => number): void {
  const epsM = epsMm * MM
  for (const s of def.sockets) {
    const p = s.pos
    s.pos = [
      p[0] + (rand() * 2 - 1) * epsM,
      p[1] + (rand() * 2 - 1) * epsM,
      p[2] + (rand() * 2 - 1) * epsM,
    ]
  }
}

const maxOf = (rows: JoinMeasurement[], f: (m: JoinMeasurement) => number): number =>
  rows.length === 0 ? 0 : Math.max(...rows.map(f))

/** All standard-height room↔room and room↔spine joins at zero offset. */
function runExactness(deckFloor: number): JoinMeasurement[] {
  const joins: JoinMeasurement[] = []
  const spine = placeModule(spineDeckBand(0), 0, ZERO)
  for (const room of ROOM_MODULES) {
    const placed = placeModule(room, 0, [0, deckFloor, 0])
    // Room ↔ spine: every room's spine-door against the spine +z face.
    joins.push(measureJoin(spine, '+z', room, 'spine-door', { policy: 'floorPinned' }))
    joins.push(measureJoin(spine, '+z', room, 'spine-door', { policy: 'doorSolved' }))
    // Room ↔ room: every pair of spine-doors and (where both exist) side-doors.
    for (const other of ROOM_MODULES) {
      joins.push(
        measureJoin(placed, 'spine-door', other, 'spine-door', {
          policy: 'floorPinned',
        }),
        measureJoin(placed, 'spine-door', other, 'spine-door', {
          policy: 'doorSolved',
        }),
      )
      const aSide = room.sockets.find((s) => s.id !== 'spine-door')
      const bSide = other.sockets.find((s) => s.id !== 'spine-door')
      if (aSide && bSide && !aSide.nonStandardCenter && !bSide.nonStandardCenter) {
        joins.push(
          measureJoin(placed, aSide.id, other, bSide.id, { policy: 'floorPinned' }),
          measureJoin(placed, aSide.id, other, bSide.id, { policy: 'doorSolved' }),
        )
      }
    }
  }
  return joins
}

/** Spine↔room joins with a deliberate offset along one axis, both policies. */
function runOffsetSweep(): OffsetRow[] {
  const rows: OffsetRow[] = []
  const spine = placeModule(spineDeckBand(0), 0, ZERO)
  for (const roomId of ROOM_IDS) {
    const room = roomById(roomId)
    for (const policy of ['floorPinned', 'doorSolved'] as const) {
      for (const axis of ['normal', 'lateral', 'vertical'] as const) {
        for (const offsetMm of OFFSET_SWEEP_MM) {
          const offset: [number, number, number] = [0, 0, 0]
          if (axis === 'normal') offset[2] = offsetMm * MM // spine +z face: normal = +z
          if (axis === 'lateral') offset[0] = offsetMm * MM
          if (axis === 'vertical') offset[1] = offsetMm * MM
          const m = measureJoin(spine, '+z', room, 'spine-door', {
            policy,
            offset,
            deckFloorY: deckFloorY(0),
          })
          rows.push({
            roomId,
            policy,
            axis,
            offsetMm,
            seamGapMm: m.seamGapMm,
            lateralMm: m.lateralMm,
            verticalMm: m.verticalMm,
            floorStepMm: m.floorStepMm,
          })
        }
      }
    }
  }
  return rows
}

/** Room↔room joins with seeded ±ε authoring noise on BOTH sockets. */
function runNoiseSweep(): NoiseRow[] {
  const rows: NoiseRow[] = []
  for (const epsMm of NOISE_SWEEP_MM) {
    const measured: JoinMeasurement[] = []
    const farShiftsMm: number[] = []
    for (const a of ROOM_MODULES) {
      for (const b of ROOM_MODULES) {
        // Fresh copies per join so noise never accumulates across runs.
        const aDef: ModuleDef = structuredClone(a)
        const bDef: ModuleDef = structuredClone(b)
        const aClean: ModuleDef = structuredClone(a)
        const bClean: ModuleDef = structuredClone(b)
        applyAuthoringNoise(aDef, epsMm, mulberry32(NOISE_SEED))
        applyAuthoringNoise(bDef, epsMm, mulberry32(NOISE_SEED ^ 0xabc))
        const placed = placeModule(aDef, 0, [0, 0, 0])
        const placedClean = placeModule(aClean, 0, [0, 0, 0])
        measured.push(
          measureJoin(placed, 'spine-door', bDef, 'spine-door', {
            policy: 'floorPinned',
            deckFloorY: 0,
          }),
        )
        const clean = measureJoin(placedClean, 'spine-door', bClean, 'spine-door', {
          policy: 'floorPinned',
          deckFloorY: 0,
        })
        const noised = measured[measured.length - 1]
        const dx = noised.bTranslation[0] - clean.bTranslation[0]
        const dz = noised.bTranslation[2] - clean.bTranslation[2]
        farShiftsMm.push(Math.sqrt(dx * dx + dz * dz) / MM)
      }
    }
    rows.push({
      epsMm,
      joins: measured.length,
      maxSeamGapMm: maxOf(measured, (m) => Math.abs(m.seamGapMm)),
      maxLateralMm: maxOf(measured, (m) => m.lateralMm),
      maxVerticalMm: maxOf(measured, (m) => m.verticalMm),
      maxFarShiftMm: Math.max(...farShiftsMm),
    })
  }
  return rows
}

/** Joins a conforming spec must never contain (the negative fixture set). */
function runPathological(): PathologicalRow[] {
  const rows: PathologicalRow[] = []
  const spine = placeModule(spineDeckBand(0), 0, ZERO)
  const galley = placeModule(roomById('galley'), 0, [0, 0, 0])
  const eng = roomById('engineering')

  const cases: { label: string; m: JoinMeasurement }[] = [
    {
      label: 'spine↔engineering, 10 mm normal offset (floor-pinned)',
      m: measureJoin(spine, '+z', eng, 'spine-door', {
        policy: 'floorPinned',
        offset: [0, 0, 10 * MM],
        deckFloorY: 0,
      }),
    },
    {
      label: 'spine↔head, 25 mm lateral offset (floor-pinned)',
      m: measureJoin(spine, '+z', roomById('head'), 'spine-door', {
        policy: 'floorPinned',
        offset: [25 * MM, 0, 0],
        deckFloorY: 0,
      }),
    },
    {
      label: 'spine↔ops, 25 mm vertical offset (door-solved → floor step)',
      m: measureJoin(spine, '+z', roomById('ops'), 'spine-door', {
        policy: 'doorSolved',
        offset: [0, 25 * MM, 0],
        deckFloorY: 0,
      }),
    },
    {
      label:
        'engineering high-hatch (door center 1.2 m) ↔ galley spine-door (1.0 m), floor-pinned',
      m: measureJoin(galley, 'spine-door', eng, 'high-hatch', {
        policy: 'floorPinned',
        deckFloorY: 0,
      }),
    },
    {
      label: 'engineering high-hatch (1.2 m) ↔ galley spine-door (1.0 m), door-solved',
      m: measureJoin(galley, 'spine-door', eng, 'high-hatch', {
        policy: 'doorSolved',
        deckFloorY: 0,
      }),
    },
  ]

  for (const c of cases) {
    rows.push({
      label: c.label,
      measurement: c.m,
      exceedsWatertight: !(
        Math.abs(c.m.seamGapMm) < 2 &&
        Math.abs(c.m.lateralMm) < 2 &&
        Math.abs(c.m.verticalMm) < 2
      ),
      exceedsHatchAlign: !(
        Math.abs(c.m.lateralMm) <= 5 &&
        Math.abs(c.m.verticalMm) <= 5 &&
        Math.abs(c.m.floorStepMm) <= 5
      ),
    })
  }
  return rows
}

/** Run the full seam spike and return the measured report. */
export function runSeamSpike(): SeamSpikeReport {
  const exactness = runExactness(deckFloorY(0))
  return {
    exactness: {
      joins: exactness.length,
      maxSeamGapMm: maxOf(exactness, (m) => Math.abs(m.seamGapMm)),
      maxLateralMm: maxOf(exactness, (m) => m.lateralMm),
      maxVerticalMm: maxOf(exactness, (m) => m.verticalMm),
      maxFloorStepMm: maxOf(exactness, (m) => m.floorStepMm),
      flaggedDoors: nonStandardDoors(),
    },
    offsets: runOffsetSweep(),
    noise: runNoiseSweep(),
    pathological: runPathological(),
    tolerances: SEAM_TOLERANCES,
  }
}
