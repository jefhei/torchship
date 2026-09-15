import { describe, expect, it } from 'vitest'
import {
  MATERIAL_SLOTS,
  STANDARD_DOOR_CENTER_M,
  STANDARD_DOOR_SIZE,
  doorCenterDeckOffsetM,
  doorSizeOf,
  isStandardDoorCenter,
} from '../../types'
import type { Aabb3 } from '../../types'
import { CONTRACT_KIT, contractSocketOrigins } from '../../validation/contractKit'
import { partBounds } from '../parts'
import { ENGINEERING_ASSEMBLIES, ENGINEERING_MODULE } from './engineering'
import {
  assertModuleIntegrity,
  doorwayPrism,
  moduleContractProblems,
  moduleProblems,
} from './integrity'
import {
  assembliesBounds,
  assemblyBounds,
  assemblyParts,
  findAssembly,
  moduleCollisionBoxes,
  moduleMaterialSlots,
  moduleParts,
  moduleSolidParts,
} from './types'
import type { ModuleAssembly } from './types'

/** The contract's non-standard door: 0.8 × 1.6 m, centre 1.2 m (deck offset +0.2). */
const HIGH_HATCH = { width: 0.8, height: 1.6, centerY: 1.2 }
/** Its socket origin along the starboard wall, module-local metres. */
const HIGH_HATCH_Z = 0.6
/** The reactor bulkhead's own interior doorway, metres. */
const ACCESS_DOOR = { width: 0.8, height: 1.6, centerX: -1.2, centerY: 0.8 }
/** The prisms of those interior openings (the door-socket prisms come from integrity). */
const REACTOR_PRISMS: readonly Aabb3[] = [
  {
    min: [ACCESS_DOOR.centerX - ACCESS_DOOR.width / 2, 0, 1.4 - 0.15],
    max: [ACCESS_DOOR.centerX + ACCESS_DOOR.width / 2, ACCESS_DOOR.height, 1.4 + 0.15],
  },
]

/** Box comparison at nm scale — computed sums differ from literals in ulps. */
function expectBoundsClose(actual: Aabb3, expected: Aabb3): void {
  for (let axis = 0; axis < 3; axis++) {
    expect(actual.min[axis]).toBeCloseTo(expected.min[axis], 9)
    expect(actual.max[axis]).toBeCloseTo(expected.max[axis], 9)
  }
}

/** Vec comparison at nm scale (derived positions carry ulp noise). */
function expectVec(actual: readonly number[], expected: readonly number[]): void {
  expect(actual).toHaveLength(expected.length)
  for (let axis = 0; axis < actual.length; axis++) {
    expect(actual[axis]).toBeCloseTo(expected[axis], 9)
  }
}

/** True when two boxes overlap by more than a micron on all three axes. */
function overlaps(a: Aabb3, b: Aabb3): boolean {
  for (let axis = 0; axis < 3; axis++) {
    if (
      Math.min(a.max[axis], b.max[axis]) - Math.max(a.min[axis], b.min[axis]) <=
      1e-6
    ) {
      return false
    }
  }
  return true
}

/** The named assembly, asserted to exist (the tests read it constantly). */
function assembly(id: string): ModuleAssembly {
  const found = findAssembly(ENGINEERING_MODULE, id)
  expect(found, id).toBeDefined()
  return found as ModuleAssembly
}

/** The parts of one named assembly, module-local. */
function partsOf(id: string) {
  return assemblyParts(assembly(id))
}

/** Parts whose vertical extent contains `y` (used to slice a wall's opening). */
function partsSpanningY(id: string, y: number) {
  return partsOf(id).filter((part) => {
    const b = partBounds(part)
    return b.min[1] <= y && b.max[1] >= y
  })
}

/** The module's spine door socket (the standardized −z breach). */
function spineDoor() {
  const door = ENGINEERING_MODULE.manifest.doorSockets.find(
    (socket) => socket.id === 'spine-door',
  )
  if (door === undefined) throw new Error('engineering module: no spine door')
  return door
}

/** The module's non-standard socket (the starboard high-hatch). */
function highHatch() {
  const door = ENGINEERING_MODULE.manifest.doorSockets.find(
    (socket) => socket.id === 'high-hatch',
  )
  if (door === undefined) throw new Error('engineering module: no high-hatch')
  return door
}

describe('authored engineering module (M2-T5)', () => {
  it('is intact: no integrity problems, and the gate passes', () => {
    expect(moduleProblems(ENGINEERING_MODULE)).toEqual([])
    expect(() => assertModuleIntegrity(ENGINEERING_MODULE)).not.toThrow()
  })

  it('declares the M0-T5 engineering footprint with the floor at local y = 0', () => {
    expect(ENGINEERING_MODULE.manifest.id).toBe('engineering')
    expect(ENGINEERING_MODULE.manifest.dimensions).toEqual([4.5, 3, 4.8])
    expect(ENGINEERING_MODULE.manifest.label).toMatch(/engineering/i)
    expect(ENGINEERING_MODULE.manifest.label).toMatch(/reactor/i)
    expect(ENGINEERING_MODULE.manifest.label).toMatch(/drive glow/i)
  })

  it('reproduces the contract kit’s engineering entry (the M2-T7 gate, empty diff)', () => {
    expect(moduleContractProblems(ENGINEERING_MODULE, CONTRACT_KIT)).toEqual([])
    const contract = contractSocketOrigins()
    for (const id of ['spine-door', 'high-hatch'] as const) {
      const expected = contract[`engineering.${id}`]
      const authored = ENGINEERING_MODULE.manifest.doorSockets.find(
        (socket) => socket.id === id,
      )
      expect(authored, id).toBeDefined()
      expect(authored?.position, id).toEqual(expected.position)
      expect(authored?.facing, id).toBe(expected.facing)
    }
    // …including the non-standard opening the contract declares.
    const contractHatch = CONTRACT_KIT.modules
      .find((module) => module.id === 'engineering')
      ?.doorSockets.find((socket) => socket.id === 'high-hatch')
    expect(contractHatch).toBeDefined()
    expect(doorSizeOf(highHatch())).toEqual(
      doorSizeOf(contractHatch as NonNullable<typeof contractHatch>),
    )
    expect(doorSizeOf(highHatch())).toEqual({
      width: HIGH_HATCH.width,
      height: HIGH_HATCH.height,
    })
  })

  it('carries exactly one standardized spine door, flush in its −z face', () => {
    const door = spineDoor()
    expect(door.position).toEqual([0, STANDARD_DOOR_CENTER_M, -2.4])
    expect(door.facing).toBe('-z')
    expect(isStandardDoorCenter(door)).toBe(true)
    expect(doorSizeOf(door)).toEqual(STANDARD_DOOR_SIZE)
    expect(
      ENGINEERING_MODULE.manifest.doorSockets.filter(
        (socket) => socket.id === 'spine-door',
      ),
    ).toHaveLength(1)
  })

  it('carries the contract’s NON-STANDARD high-hatch: +x face, +0.2 m deck offset', () => {
    const door = highHatch()
    expect(door.position).toEqual([2.25, HIGH_HATCH.centerY, 0.6])
    expect(door.facing).toBe('+x')
    // The kit's one declared deck offset (engineering's deliberate high-hatch).
    expect(doorCenterDeckOffsetM(door)).toBeCloseTo(0.2, 9)
    expect(isStandardDoorCenter(door)).toBe(false)
    expect(doorSizeOf(door)).toEqual({
      width: HIGH_HATCH.width,
      height: HIGH_HATCH.height,
    })
    // …and it is the ONLY non-standard door and opening in the module.
    const oddCenters = ENGINEERING_MODULE.manifest.doorSockets.filter(
      (socket) => !isStandardDoorCenter(socket),
    )
    const oddOpenings = ENGINEERING_MODULE.manifest.doorSockets.filter(
      (socket) =>
        doorSizeOf(socket).width !== STANDARD_DOOR_SIZE.width ||
        doorSizeOf(socket).height !== STANDARD_DOOR_SIZE.height,
    )
    expect(oddCenters.map((socket) => socket.id)).toEqual(['high-hatch'])
    expect(oddOpenings.map((socket) => socket.id)).toEqual(['high-hatch'])
  })

  it('builds its shell tight to the declared box (dims cannot drift)', () => {
    const shell = ENGINEERING_ASSEMBLIES.filter(
      (candidate) => candidate.id === 'deck-plate' || candidate.id.startsWith('wall-'),
    )
    expect(shell.map((candidate) => candidate.id)).toEqual([
      'deck-plate',
      'wall-aft-spine',
      'wall-fwd',
      'wall-port',
      'wall-stbd',
    ])
    expectBoundsClose(assembliesBounds(shell), {
      min: [-2.25, -0.2, -2.4],
      max: [2.25, 3, 2.4],
    })
  })

  it('cuts the high-hatch opening into the starboard wall at the socket origin', () => {
    const wall = assembly('wall-stbd')
    expect(wall.placement.rotation).toBe(3)
    // At the door-centre height the starboard wall is two piers: the opening
    // between them is exactly the 0.8 m the contract socket declares, 0.6 m
    // bow-ward of the wall's own centre.
    const piers = partsSpanningY('wall-stbd', HIGH_HATCH.centerY)
    expect(piers).toHaveLength(2)
    const boxes = piers.map(partBounds).sort((a, b) => a.min[2] - b.min[2])
    expectBoundsClose(boxes[0], { min: [2.15, 0, -2.4], max: [2.25, 3, 0.2] })
    expectBoundsClose(boxes[1], { min: [2.15, 0, 1], max: [2.25, 3, 2.4] })
    expect((boxes[0].max[2] + boxes[1].min[2]) / 2).toBeCloseTo(0.6, 9)
    expect(boxes[1].min[2] - boxes[0].max[2]).toBeCloseTo(HIGH_HATCH.width, 9)

    // The opening is a raised one: a sill reaches up to the door's 0.4 m
    // bottom edge and the lintel starts at its 2.0 m head.
    const sill = partsOf('wall-stbd').find((part) => partBounds(part).max[1] <= 0.5)
    expect(sill).toBeDefined()
    expectBoundsClose(partBounds(sill as NonNullable<typeof sill>), {
      min: [2.15, 0, 0.2],
      max: [2.25, 0.4, 1],
    })
    const lintel = partsOf('wall-stbd').find(
      (part) => partBounds(part).min[1] > HIGH_HATCH.centerY,
    )
    expect(lintel).toBeDefined()
    const lintelBounds = partBounds(lintel as NonNullable<typeof lintel>)
    expect(lintelBounds.min[1]).toBeCloseTo(
      HIGH_HATCH.centerY + HIGH_HATCH.height / 2,
      9,
    )
    expect(lintelBounds.min[2]).toBeCloseTo(0.2, 9)
    expect(lintelBounds.max[2]).toBeCloseTo(1, 9)
  })

  it('seats a socket-centred hatch on each door, at that socket’s own opening', () => {
    const spineHatch = assembly('hatch-spine')
    expect(spineHatch.fillsSocket).toBe(true)
    expect(spineHatch.placement.position).toEqual([0, STANDARD_DOOR_CENTER_M, -2.4])
    expect(partBounds(assemblyParts(spineHatch)[0]).max[0]).toBeCloseTo(
      STANDARD_DOOR_SIZE.width / 2 - 0.01,
      9,
    )

    // The high-hatch's hatch is built from the SOCKET's 0.8 × 1.6 m opening —
    // and seated at the socket's own (non-standard) 1.2 m centre.
    const highHatchAssembly = assembly('hatch-high')
    expect(highHatchAssembly.fillsSocket).toBe(true)
    expect(highHatchAssembly.placement.position).toEqual([
      2.25,
      HIGH_HATCH.centerY,
      0.6,
    ])
    expect(highHatchAssembly.placement.rotation).toBe(3)
    const leaf = assemblyParts(highHatchAssembly)[0]
    // Yaw 3: the leaf's own width runs along module Z, its thickness along X.
    expectBoundsClose(partBounds(leaf), {
      min: [2.225, HIGH_HATCH.centerY - 0.79, HIGH_HATCH_Z - 0.39],
      max: [2.275, HIGH_HATCH.centerY + 0.79, HIGH_HATCH_Z + 0.39],
    })
  })

  it('walls the reactor off behind a full-width bulkhead with a walk-through doorway', () => {
    const bulkhead = assembly('reactor-bulkhead')
    expect(bulkhead.solid).toBe(true)
    expectBoundsClose(assemblyBounds(bulkhead), {
      min: [-2.25, 0, 1.35],
      max: [2.25, 3, 1.45],
    })

    // The doorway: 0.8 m wide, off-centre to port, with NO sill — its bottom
    // edge is the deck you walk in over (bulkheadParts omits a zero sill).
    const piers = partsSpanningY('reactor-bulkhead', ACCESS_DOOR.centerY)
      .map(partBounds)
      .sort((a, b) => a.min[0] - b.min[0])
    expect(piers).toHaveLength(2)
    expectBoundsClose(piers[0], { min: [-2.25, 0, 1.35], max: [-1.6, 3, 1.45] })
    expectBoundsClose(piers[1], { min: [-0.8, 0, 1.35], max: [2.25, 3, 1.45] })
    expect(piers[1].min[0] - piers[0].max[0]).toBeCloseTo(ACCESS_DOOR.width, 9)
    expect(partsSpanningY('reactor-bulkhead', 0.2)).toHaveLength(2)

    const lintel = partsOf('reactor-bulkhead').find(
      (part) => partBounds(part).min[1] > 1,
    )
    expect(lintel).toBeDefined()
    expectBoundsClose(partBounds(lintel as NonNullable<typeof lintel>), {
      min: [-1.6, ACCESS_DOOR.height, 1.35],
      max: [-0.8, 3, 1.45],
    })
  })

  it('seals the reactor access with its own hatch and keeps the prism clear', () => {
    const hatch = assembly('hatch-reactor-access')
    // An interior opening rather than a DoorSocket, so it is not `fillsSocket`.
    expect(hatch.fillsSocket).toBeUndefined()
    expect(hatch.placement.position).toEqual([
      ACCESS_DOOR.centerX,
      ACCESS_DOOR.centerY,
      1.4,
    ])
    const leaf = assemblyParts(hatch)[0]
    expectBoundsClose(partBounds(leaf), {
      min: [-1.59, 0.01, 1.375],
      max: [-0.81, 1.59, 1.425],
    })

    // The hatch IS the doorway's filler; nothing else may occupy the prism.
    for (const candidate of ENGINEERING_ASSEMBLIES) {
      if (candidate.id === 'reactor-bulkhead' || candidate.id.startsWith('hatch-')) {
        continue
      }
      for (const part of assemblyParts(candidate)) {
        for (const prism of REACTOR_PRISMS) {
          expect(
            overlaps(partBounds(part), prism),
            `assembly "${candidate.id}" blocks the reactor access doorway`,
          ).toBe(false)
        }
      }
    }
  })

  it('sets the shielded drive glow window into the bulkhead, grating proud into the room', () => {
    const window = assembly('glow-window')
    expectVec(window.placement.position ?? [], [0.9, 1.55, 1.29])
    expect(window.placement.rotation).toBe(2)
    expect(window.solid).toBe(true)
    expectBoundsClose(assemblyBounds(window), {
      min: [0.2, 1.1, 1.2],
      max: [1.6, 2, 1.35],
    })

    // The frame's back lands exactly ON the bulkhead face it is set into.
    expect(assemblyBounds(window).max[2]).toBeCloseTo(
      assemblyBounds(assembly('reactor-bulkhead')).min[2],
      9,
    )

    // The glow is RECESSED between the frame's faces: it is light behind a
    // shield, not a surface proud of the wall.
    const glow = partsOf('glow-window').filter(
      (part) => part.materialSlot === 'panel-light',
    )
    expect(glow).toHaveLength(1)
    const glowBounds = partBounds(glow[0])
    expectBoundsClose(glowBounds, {
      min: [0.3368, 1.2068, 1.266],
      max: [1.4632, 1.8932, 1.314],
    })

    // The grating is the room-side surface: five bars proud of the frame's +Z
    // face, spread evenly across the 1.28 m opening.
    const bars = partsOf('glow-window').filter(
      (part) => part.materialSlot === 'conduit',
    )
    expect(bars).toHaveLength(5)
    const barBounds = bars.map(partBounds)
    for (const box of barBounds) {
      expect(box.min[2]).toBeCloseTo(1.2, 9)
      expect(box.max[2]).toBeCloseTo(1.23, 9)
      expect(box.min[1]).toBeCloseTo(1.16, 9)
      expect(box.max[1]).toBeCloseTo(1.94, 9)
    }
    const centres = barBounds.map((box) => (box.min[0] + box.max[0]) / 2)
    // Yaw 2 mirrors the bar order, so the grating reads right-to-left.
    expectVec(centres, [1.412, 1.156, 0.9, 0.644, 0.388])
    // No bar reaches the doorway it sits beside.
    expect(barBounds[0].min[0]).toBeGreaterThan(
      ACCESS_DOOR.centerX + ACCESS_DOOR.width / 2,
    )
  })

  it('hangs the radiation placard beside the access door, its trefoil proud of the plate', () => {
    const sign = assembly('radiation-sign')
    expectVec(sign.placement.position ?? [], [-0.55, 1.7, 1.34])
    expect(sign.placement.rotation).toBe(2)
    const parts = partsOf('radiation-sign')
    expect(parts.map((part) => part.materialSlot)).toEqual([
      'hazard',
      'bulkhead',
      'bulkhead',
      'bulkhead',
      'bulkhead',
    ])
    const plate = partBounds(parts[0])
    expectBoundsClose(plate, {
      min: [-0.75, 1.45, 1.33],
      max: [-0.35, 1.95, 1.35],
    })
    // The §4 trefoil: hub + three blades, all proud AFT of the plate, so the
    // sign faces the room it warns.
    const mark = parts.slice(1)
    expect(mark).toHaveLength(4)
    for (const part of mark) {
      const box = partBounds(part)
      expect(box.max[2]).toBeLessThanOrEqual(plate.min[2] + 1e-9)
      expect(box.min[2]).toBeCloseTo(1.318, 9)
      expect(box.min[0]).toBeGreaterThan(plate.min[0] - 1e-9)
      expect(box.max[0]).toBeLessThan(plate.max[0] + 1e-9)
    }
    const blades = mark.slice(1)
    const angles = blades
      .map((part) => {
        const degrees =
          (Math.atan2(part.position[1] - 1.7, part.position[0] + 0.55) * 180) / Math.PI
        return ((degrees % 360) + 360) % 360
      })
      .sort((a, b) => a - b)
    expect(angles[0]).toBeCloseTo(90, 6)
    expect(angles[1]).toBeCloseTo(210, 6)
    expect(angles[2]).toBeCloseTo(330, 6)

    // Port of the window, starboard of the doorway — the warning is where you
    // turn to open the reactor, not on the door itself.
    expect(plate.max[0]).toBeLessThan(assemblyBounds(assembly('glow-window')).min[0])
    expect(plate.min[0]).toBeGreaterThanOrEqual(
      ACCESS_DOOR.centerX + ACCESS_DOOR.width / 2,
    )
  })

  it('clads the bulkhead either side of the window in ceramic heat shielding', () => {
    const starboard = assembly('heat-shield-stbd')
    const port = assembly('heat-shield-port')
    for (const shield of [starboard, port]) {
      expect(shield.solid, shield.id).toBe(true)
      expect(shield.placement.rotation, shield.id).toBe(2)
      const slots = assemblyParts(shield).map((part) => part.materialSlot)
      expect(slots, shield.id).toEqual(['ceramic', 'hazard'])
      // The worn stripe is inset from the plate's edges and proud of it.
      const [plate, stripe] = assemblyParts(shield).map(partBounds)
      expect(stripe.min[1], shield.id).toBeGreaterThan(plate.min[1])
      expect(stripe.max[1], shield.id).toBeLessThan(plate.max[1])
    }
    expectBoundsClose(assemblyBounds(starboard), {
      min: [0.1, 0.15, 1.301],
      max: [1.7, 0.85, 1.349],
    })
    expectBoundsClose(assemblyBounds(port), {
      min: [-2.25, 0.15, 1.301],
      max: [-1.65, 0.85, 1.349],
    })
    // Both sit under the window, on the bulkhead face, and clear of the door.
    const windowBounds = assemblyBounds(assembly('glow-window'))
    expect(assemblyBounds(starboard).max[1]).toBeLessThan(windowBounds.min[1])
    for (const shield of [starboard, port]) {
      for (const part of assemblyParts(shield)) {
        for (const prism of REACTOR_PRISMS) {
          expect(overlaps(partBounds(part), prism), shield.id).toBe(false)
        }
      }
    }
  })

  it('fits the machinery bay around a clear centreline lane', () => {
    // Stores: a two-door bank flush on the port wall, doors proud into the room.
    const stores = assembly('stores-locker')
    expect(stores.placement.position).toEqual([-1.9, 0, -0.9])
    expect(stores.placement.rotation).toBe(1)
    expectBoundsClose(assemblyBounds(stores), {
      min: [-2.15, 0, -1.8],
      max: [-1.6, 2, 0],
    })
    expect(assemblyBounds(stores).max[0]).toBeGreaterThan(-1.92)

    // Spares: a single-door bank forward of it, before the reactor bulkhead.
    const spares = assembly('spares-locker')
    expectBoundsClose(assemblyBounds(spares), {
      min: [-2.15, 0, 0.2],
      max: [-1.6, 1.8, 1.2],
    })

    // Machinery: the starboard-wall bank, its door face turned into the room.
    const machinery = assembly('machinery-locker')
    expect(machinery.placement.position).toEqual([1.9, 0, -1.85])
    expect(machinery.placement.rotation).toBe(3)
    expectBoundsClose(assemblyBounds(machinery), {
      min: [1.6, 0, -2.3],
      max: [2.15, 2, -1.4],
    })
    expect(assemblyBounds(machinery).min[0]).toBeLessThan(1.9)

    // The console bench runs along the starboard wall, aft of the high-hatch.
    const bench = assembly('console-bench')
    expect(bench.placement.position).toEqual([1.85, 0, -0.8])
    expectBoundsClose(assemblyBounds(bench), {
      min: [1.55, 0, -1.4],
      max: [2.15, 0.9, -0.2],
    })
    expect(assemblyBounds(machinery).max[2]).toBeLessThanOrEqual(
      assemblyBounds(bench).min[2],
    )

    // Nothing in the bay blocks either doorway.
    const bay = ENGINEERING_ASSEMBLIES.filter((candidate) =>
      ['stores-locker', 'spares-locker', 'machinery-locker', 'console-bench'].includes(
        candidate.id,
      ),
    )
    for (const candidate of bay) {
      for (const part of assemblyParts(candidate)) {
        for (const [id, prism] of [
          ['spine-door', doorwayPrism(spineDoor())],
          ['high-hatch', doorwayPrism(highHatch())],
        ] as const) {
          expect(
            overlaps(partBounds(part), prism),
            `assembly "${candidate.id}" blocks the ${id} doorway`,
          ).toBe(false)
        }
      }
    }
  })

  it('gives the console a display and a task strip whose socket is the real lens', () => {
    const screen = assembly('console-screen')
    expect(screen.placement.position).toEqual([2.12, 1.85, -0.8])
    expect(screen.placement.rotation).toBe(3)
    expectBoundsClose(assemblyBounds(screen), {
      min: [2.09, 1.6, -1.25],
      max: [2.15, 2.1, -0.35],
    })

    const strip = assembly('console-task-light')
    expect(strip.placement.rotation).toBe(3)
    const stripBounds = assemblyBounds(strip)
    // Recessed into the wall over the bench, clear of the display above it.
    expect(stripBounds.min[0]).toBeLessThan(2.15)
    expect(stripBounds.max[1]).toBeLessThan(assemblyBounds(screen).min[1])

    // The task socket IS the fixture's own emissive lens: same transform, so
    // M4-T1 lights the part that is actually drawn.
    const socket = ENGINEERING_MODULE.manifest.lightSockets.find(
      (light) => light.id === 'console-task-light',
    )
    expect(socket).toBeDefined()
    const lens = assemblyParts(strip).filter(
      (part) => part.materialSlot === 'panel-light',
    )
    expect(lens).toHaveLength(1)
    expect(socket?.position).toEqual(lens[0].position)
    expect(socket?.kind).toBe('task')
  })

  it('anchors the drive glow itself as the room’s reactor light', () => {
    const socket = ENGINEERING_MODULE.manifest.lightSockets.find(
      (light) => light.id === 'reactor-glow',
    )
    expect(socket).toBeDefined()
    expect(socket?.kind).toBe('reactor')
    expect(socket?.rotation).toBe(2)
    // The socket is the window's OWN glow lens, not the frame's origin.
    const glow = partsOf('glow-window').filter(
      (part) => part.materialSlot === 'panel-light',
    )
    expect(socket?.position).toEqual(glow[0].position)
    expectVec(socket?.position ?? [], [0.9, 1.55, 1.29])
  })

  it('anchors its §4 landmarks as equipment slots matching the geometry', () => {
    const slots = ENGINEERING_MODULE.manifest.equipmentSlots
    expect(slots.map((slot) => slot.id)).toEqual([
      'hatch-spine',
      'hatch-high',
      'stores-locker',
      'spares-locker',
      'machinery-locker',
      'console-bench',
      'console-screen',
      'console-task-light',
      'hatch-reactor-access',
      'glow-window',
      'radiation-sign',
      'heat-shield-stbd',
      'heat-shield-port',
    ])
    for (const slot of slots) {
      const found = findAssembly(ENGINEERING_MODULE, slot.id)
      expect(found, slot.id).toBeDefined()
      expect(slot.position, slot.id).toEqual(found?.placement.position)
      expect(slot.rotation ?? 0, slot.id).toBe(found?.placement.rotation ?? 0)
    }
  })

  it('lights the reactor room from practical fixtures and the drive glow only', () => {
    const lights = ENGINEERING_MODULE.manifest.lightSockets
    expect(new Set(lights.map((light) => light.kind))).toEqual(
      new Set(['panel', 'task', 'screen', 'reactor']),
    )

    const panels = lights.filter((light) => light.kind === 'panel')
    expect(panels).toHaveLength(3)
    for (const socket of panels) {
      const fixture = findAssembly(ENGINEERING_MODULE, socket.id)
      expect(fixture, socket.id).toBeDefined()
      expect(socket.position, socket.id).toEqual(fixture?.placement.position)
      // Each panel socket sits under the ceiling, over a real light housing.
      expect(socket.position[1], socket.id).toBeCloseTo(2.94, 9)
      const housing = assemblyParts(fixture as ModuleAssembly).some(
        (part) =>
          part.materialSlot === 'panel-light' &&
          partBounds(part).min[1] > 0.8 * socket.position[1],
      )
      expect(housing, socket.id).toBe(true)
    }

    const screens = lights.filter((light) => light.kind === 'screen')
    expect(screens.map((light) => light.id)).toEqual(['console-screen'])
    const reactors = lights.filter((light) => light.kind === 'reactor')
    expect(reactors.map((light) => light.id)).toEqual(['reactor-glow'])
  })

  it('draws only from the engineering §4 slots', () => {
    expect(moduleMaterialSlots(ENGINEERING_MODULE)).toEqual([
      'deckplate',
      'bulkhead',
      'conduit',
      'panel-light',
      'screen',
      'hazard',
      'ceramic',
    ])
    for (const part of moduleParts(ENGINEERING_MODULE)) {
      expect(MATERIAL_SLOTS).toContain(part.materialSlot)
    }
  })

  it('keeps every doorway clear of solid geometry', () => {
    const spine = spineDoor()
    const high = highHatch()
    expectBoundsClose(doorwayPrism(spine), {
      min: [-0.45, 0, -2.55],
      max: [0.45, 2, -2.25],
    })
    // The prism is the 0.8 m opening sweeping the 0.1 m wall, at the socket's
    // own 1.2 m centre.
    expectBoundsClose(doorwayPrism(high), {
      min: [2.1, HIGH_HATCH.centerY - 0.8, 0.2],
      max: [2.4, HIGH_HATCH.centerY + 0.8, 1],
    })

    for (const candidate of ENGINEERING_ASSEMBLIES) {
      if (candidate.fillsSocket === true || candidate.id.startsWith('hatch-')) continue
      for (const part of assemblyParts(candidate)) {
        for (const [id, prism] of [
          ['spine-door', doorwayPrism(spine)],
          ['high-hatch', doorwayPrism(high)],
          ...REACTOR_PRISMS.map(
            (candidatePrism) => ['reactor-access', candidatePrism] as const,
          ),
        ] as const) {
          expect(
            overlaps(partBounds(part), prism),
            `assembly "${candidate.id}" blocks the ${id} doorway`,
          ).toBe(false)
        }
      }
    }
  })

  it('derives the collision hint from the solid geometry (hatches and deck not hull)', () => {
    const solidParts = moduleSolidParts(ENGINEERING_MODULE)
    const boxes = moduleCollisionBoxes(ENGINEERING_MODULE)
    // One box per solid part — 51 of them on the authored room.
    expect(boxes).toHaveLength(51)
    expect(boxes).toHaveLength(solidParts.length)
    boxes.forEach((box, index) => {
      expectBoundsClose(box, partBounds(solidParts[index]))
    })
    expect(ENGINEERING_MODULE.manifest.collisionHint.boxes).toEqual(boxes)
    // The hatches are not hull: both doorways stay traversable.
    expect(findAssembly(ENGINEERING_MODULE, 'hatch-spine')?.solid).toBeUndefined()
    expect(findAssembly(ENGINEERING_MODULE, 'hatch-high')?.solid).toBeUndefined()
    expect(
      findAssembly(ENGINEERING_MODULE, 'hatch-reactor-access')?.solid,
    ).toBeUndefined()
  })

  it('keeps every fixture inside the module box', () => {
    // The deck plate IS the floor structure (it hangs below y = 0) and the
    // hatches straddle their opening planes — both are checked by
    // moduleProblems with the documented structural allowances.
    for (const candidate of ENGINEERING_ASSEMBLIES) {
      if (candidate.id === 'deck-plate' || candidate.id.startsWith('hatch-')) continue
      const bounds = assemblyBounds(candidate)
      expect(bounds.min[0], candidate.id).toBeGreaterThanOrEqual(-2.25 - 1e-9)
      expect(bounds.max[0], candidate.id).toBeLessThanOrEqual(2.25 + 1e-9)
      expect(bounds.min[1], candidate.id).toBeGreaterThanOrEqual(-1e-9)
      expect(bounds.max[1], candidate.id).toBeLessThanOrEqual(3 + 1e-9)
      expect(bounds.min[2], candidate.id).toBeGreaterThanOrEqual(-2.4 - 1e-9)
      expect(bounds.max[2], candidate.id).toBeLessThanOrEqual(2.4 + 1e-9)
    }
  })

  it('has the reactor compartment geometry the walk needs (access door + window)', () => {
    // The two landmark surfaces are both ON the bulkhead plane, one per side
    // of the access doorway, and the compartment behind it is closed off.
    const window = assemblyBounds(assembly('glow-window'))
    const sign = assemblyBounds(assembly('radiation-sign'))
    const doorway: Aabb3 = {
      min: [ACCESS_DOOR.centerX - ACCESS_DOOR.width / 2, 0, 1.25],
      max: [ACCESS_DOOR.centerX + ACCESS_DOOR.width / 2, ACCESS_DOOR.height, 1.55],
    }
    expect(window.min[0]).toBeGreaterThan(doorway.max[0])
    expect(sign.min[0]).toBeGreaterThan(doorway.max[0])
    // …and the door itself is walkable: 1.6 m of headroom over a 0.8 m gap.
    const doorTop = doorTopOfReactorDoor()
    expect(doorTop).toBeCloseTo(ACCESS_DOOR.height, 9)
  })
})

/** Underside of the reactor bulkhead's doorway lintel, module-local metres. */
function doorTopOfReactorDoor(): number {
  const lintel = assemblyParts(assembly('reactor-bulkhead')).find(
    (part) => partBounds(part).min[1] > 1,
  )
  if (lintel === undefined) throw new Error('reactor bulkhead: no lintel')
  return partBounds(lintel).min[1]
}
