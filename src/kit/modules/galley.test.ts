import { describe, expect, it } from 'vitest'
import {
  MATERIAL_SLOTS,
  STANDARD_DOOR_CENTER_M,
  STANDARD_DOOR_SIZE,
  doorSizeOf,
  isStandardDoorCenter,
} from '../../types'
import type { Aabb3, Vec3 } from '../../types'
import { CONTRACT_KIT, contractSocketOrigins } from '../../validation/contractKit'
import { partBounds } from '../parts'
import { GALLEY_ASSEMBLIES, GALLEY_MODULE } from './galley'
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

/** Module-local metres of the door at the head partition's doorway. */
const HEAD_DOOR = { width: 0.7, height: 1.9 }

/** Box comparison at nm scale — computed sums differ from literals in ulps. */
function expectBoundsClose(actual: Aabb3, expected: Aabb3): void {
  for (let axis = 0; axis < 3; axis++) {
    expect(actual.min[axis]).toBeCloseTo(expected.min[axis], 9)
    expect(actual.max[axis]).toBeCloseTo(expected.max[axis], 9)
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
  const found = findAssembly(GALLEY_MODULE, id)
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

describe('authored galley/bunk module (M2-T3)', () => {
  it('is intact: no integrity problems, and the gate passes', () => {
    expect(moduleProblems(GALLEY_MODULE)).toEqual([])
    expect(() => assertModuleIntegrity(GALLEY_MODULE)).not.toThrow()
  })

  it('declares the M0-T5 galley footprint with the floor at local y = 0', () => {
    expect(GALLEY_MODULE.manifest.id).toBe('galley')
    expect(GALLEY_MODULE.manifest.dimensions).toEqual([4.2, 3, 5])
    expect(GALLEY_MODULE.manifest.label).toMatch(/galley/i)
    expect(GALLEY_MODULE.manifest.label).toMatch(/coffee station/i)
  })

  it('reproduces the contract kit’s galley entry (the M2-T7 gate, empty diff)', () => {
    expect(moduleContractProblems(GALLEY_MODULE, CONTRACT_KIT)).toEqual([])
    const contract = contractSocketOrigins()
    for (const id of ['spine-door', 'side-door'] as const) {
      const expected = contract[`galley.${id}`]
      const authored = GALLEY_MODULE.manifest.doorSockets.find(
        (socket) => socket.id === id,
      )
      expect(authored, id).toBeDefined()
      expect(authored?.position, id).toEqual(expected.position)
      expect(authored?.facing, id).toBe(expected.facing)
    }
  })

  it('carries exactly one standardized spine door, flush in its −z face', () => {
    const door = GALLEY_MODULE.manifest.doorSockets.filter(
      (socket) => socket.id === 'spine-door',
    )
    expect(door).toHaveLength(1)
    expect(door[0].position).toEqual([0, STANDARD_DOOR_CENTER_M, -2.5])
    expect(door[0].facing).toBe('-z')
    expect(isStandardDoorCenter(door[0])).toBe(true)
    expect(doorSizeOf(door[0])).toEqual(STANDARD_DOOR_SIZE)
  })

  it('carries the contract side door in the starboard face, off-centre along the wall', () => {
    const door = GALLEY_MODULE.manifest.doorSockets.filter(
      (socket) => socket.id === 'side-door',
    )
    expect(door).toHaveLength(1)
    // +x face, standard centre, 1.2 m bow-ward of the wall's own centre.
    expect(door[0].position).toEqual([2.1, STANDARD_DOOR_CENTER_M, 1.2])
    expect(door[0].facing).toBe('+x')
    expect(isStandardDoorCenter(door[0])).toBe(true)
    expect(doorSizeOf(door[0])).toEqual(STANDARD_DOOR_SIZE)
    expect(GALLEY_MODULE.manifest.doorSockets).toHaveLength(2)
  })

  it('builds its shell tight to the declared box (dims cannot drift)', () => {
    const shell = GALLEY_ASSEMBLIES.filter(
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
      min: [-2.1, -0.2, -2.5],
      max: [2.1, 3, 2.5],
    })
  })

  it('cuts the side-door opening into the starboard wall at the socket origin', () => {
    const wall = assembly('wall-stbd')
    expect(wall.placement.rotation).toBe(3)
    // At the door-centre height the starboard wall is two piers only: the
    // opening between them is exactly the 0.9 m the contract socket declares.
    const piers = partsSpanningY('wall-stbd', STANDARD_DOOR_CENTER_M)
    expect(piers).toHaveLength(2)
    const boxes = piers.map(partBounds).sort((a, b) => a.min[2] - b.min[2])
    expectBoundsClose(boxes[0], { min: [2, 0, -2.5], max: [2.1, 3, 0.75] })
    expectBoundsClose(boxes[1], { min: [2, 0, 1.65], max: [2.1, 3, 2.5] })
    expect((boxes[0].max[2] + boxes[1].min[2]) / 2).toBeCloseTo(1.2, 9)
    expect(boxes[1].min[2] - boxes[0].max[2]).toBeCloseTo(0.9, 9)

    // …and the lintel above it starts exactly at the door's 2.0 m head.
    const lintel = partsOf('wall-stbd').find(
      (part) => partBounds(part).min[1] > STANDARD_DOOR_CENTER_M,
    )
    expect(lintel).toBeDefined()
    const lintelBounds = partBounds(lintel as NonNullable<typeof lintel>)
    expect(lintelBounds.min[1]).toBeCloseTo(STANDARD_DOOR_SIZE.height, 9)
    expect(lintelBounds.min[2]).toBeCloseTo(0.75, 9)
    expect(lintelBounds.max[2]).toBeCloseTo(1.65, 9)
  })

  it('stacks two berths on the port wall, running fore-and-aft', () => {
    const lower = assembly('bunk-lower')
    const upper = assembly('bunk-upper')
    expect(lower.placement.position).toEqual([-1.55, 0, -1.4])
    expect(upper.placement.position).toEqual([-1.55, 0.95, -1.4])
    for (const berth of [lower, upper]) {
      expect(berth.solid, berth.id).toBe(true)
      expect(berth.placement.rotation ?? 0, berth.id).toBe(0)
      const bounds = assemblyBounds(berth)
      // Against the port wall, longer along the wall (Z) than across (X).
      expect(bounds.min[0], berth.id).toBeCloseTo(-1.95, 9)
      expect(bounds.max[0], berth.id).toBeCloseTo(-1.15, 9)
      expect(bounds.min[2], berth.id).toBeCloseTo(-2.35, 9)
      expect(bounds.max[2], berth.id).toBeCloseTo(-0.45, 9)
      expect(bounds.max[2] - bounds.min[2], berth.id).toBeCloseTo(1.9, 9)
    }
    // Mattress tops 0.45 m and 1.40 m; the upper berth clears the lower one.
    expect(assemblyBounds(lower).max[1]).toBeCloseTo(0.9, 9)
    expect(assemblyBounds(upper).min[1]).toBeCloseTo(0.95, 9)
    expect(assemblyBounds(upper).max[1]).toBeCloseTo(1.85, 9)
  })

  it('bolts the mess — table with a bench either side — on the starboard side', () => {
    const table = assembly('mess-table')
    expect(table.placement.position).toEqual([1.2, 0, -0.35])
    expect(table.solid).toBe(true)
    const tableBounds = assemblyBounds(table)
    expectBoundsClose(tableBounds, {
      min: [0.55, 0, -0.7],
      max: [1.85, 0.75, 0],
    })

    const aft = assembly('bench-aft')
    const fwd = assembly('bench-fwd')
    // Bench seats face the table: aft seat faces +z, bow seat faces −z.
    expect(aft.placement.rotation ?? 0).toBe(0)
    expect(fwd.placement.rotation).toBe(2)
    expect(aft.solid).toBe(true)
    expect(fwd.solid).toBe(true)
    // Seat pans top out at 0.45 m with a 0.4 m backrest above them.
    for (const bench of [aft, fwd]) {
      expect(assemblyBounds(bench).max[1], bench.id).toBeCloseTo(0.85, 9)
      expect(assemblyBounds(bench).min[0], bench.id).toBeCloseTo(0.55, 9)
      expect(assemblyBounds(bench).max[0], bench.id).toBeCloseTo(1.85, 9)
    }
    // Aft bench sits behind the table, bow bench in front of it.
    expect(assemblyBounds(aft).max[2]).toBeLessThan(tableBounds.min[2])
    expect(assemblyBounds(fwd).min[2]).toBeGreaterThan(tableBounds.max[2])
    // The whole mess is clear of the spine doorway and the side doorway.
    for (const id of ['mess-table', 'bench-aft', 'bench-fwd']) {
      for (const part of partsOf(id)) {
        expect(overlaps(partBounds(part), doorwayPrism(spineDoor())), id).toBe(false)
        expect(overlaps(partBounds(part), doorwayPrism(sideDoor())), id).toBe(false)
      }
    }
  })

  it('lines the port wall amidships with the pantry locker bank, doors to the room', () => {
    const pantry = assembly('pantry-locker')
    expect(pantry.placement.position).toEqual([-1.775, 0, 0.4])
    expect(pantry.solid).toBe(true)
    const bounds = assemblyBounds(pantry)
    // Body flush on the port wall, 1.6 m along it, doors proud of the body on
    // the room side (+x).
    expect(bounds.min[0]).toBeCloseTo(-2, 9)
    expect(bounds.min[1]).toBeCloseTo(0, 9)
    expect(bounds.max[1]).toBeCloseTo(2, 9)
    expect(bounds.min[2]).toBeCloseTo(-0.4, 9)
    expect(bounds.max[2]).toBeCloseTo(1.2, 9)
    expect(bounds.max[0]).toBeGreaterThan(-1.55)
    // Aft of the head stall, bow-ward of the berths.
    expect(bounds.min[2]).toBeGreaterThan(assemblyBounds(assembly('bunk-lower')).max[2])
    expect(bounds.max[2]).toBeLessThan(
      assemblyBounds(assembly('partition-head-aft')).min[2],
    )
  })

  it('puts the coffee-station landmark on the forward wall, facing the entry', () => {
    const station = assembly('coffee-station')
    expect(station.placement.position).toEqual([0.7, 0, 2.1])
    expect(station.placement.rotation).toBe(2)
    expect(station.solid).toBe(true)

    const bounds = assemblyBounds(station)
    // Against the forward wall: the accent backsplash is embedded 0.04 m into
    // it (its own thickness), so the station reads as built in.
    expect(bounds.max[2]).toBeCloseTo(2.44, 9)
    expect(bounds.max[1]).toBeCloseTo(1.17, 9)

    // It faces the spine door: the station's front — the task-light strip,
    // which is proud of the cabinet body — is on the AFT side, the side the
    // entry arrives from, and the body is hard against the forward wall.
    expect(bounds.min[2]).toBeCloseTo(1.75, 9)
    expect(bounds.min[2]).toBeLessThan(1.8)
    const socket = GALLEY_MODULE.manifest.lightSockets.find(
      (light) => light.id === 'coffee-station-task',
    )
    expect(socket).toBeDefined()
    expect(socket?.kind).toBe('task')
    expect(socket?.position[2]).toBeCloseTo(1.775, 9)
    expect((socket?.position[2] ?? 0) < 1.8).toBe(true)

    // The carafe sits ON the counter (its base == the station's height).
    const carafe = partsOf('coffee-station').filter(
      (part) => part.materialSlot === 'screen',
    )
    expect(carafe).toHaveLength(1)
    expect(carafe[0].kind).toBe('cylinder')
    expect(partBounds(carafe[0]).min[1]).toBeCloseTo(0.95, 9)

    // The warm accent is reserved for the landmark: no other assembly draws it.
    for (const candidate of GALLEY_ASSEMBLIES) {
      const accented = assemblyParts(candidate).filter(
        (part) => part.materialSlot === 'coffee-accent',
      )
      if (candidate.id === 'coffee-station') {
        expect(accented.length).toBeGreaterThan(0)
      } else {
        expect(accented, candidate.id).toHaveLength(0)
      }
    }
  })

  it('walls off the head in the forward-port corner behind a partition doorway', () => {
    const aft = assembly('partition-head-aft')
    const side = assembly('partition-head-stbd')
    expect(aft.solid).toBe(true)
    expect(side.solid).toBe(true)
    expectBoundsClose(assemblyBounds(aft), {
      min: [-2, 0, 1.35],
      max: [-0.6, 3, 1.45],
    })
    expectBoundsClose(assemblyBounds(side), {
      min: [-0.6, 0, 1.35],
      max: [-0.5, 3, 2.45],
    })

    // The stall's doorway: 0.7 m wide at the partition's centre, opening to
    // 1.9 m with the piers either side and the lintel above.
    const piers = partsSpanningY('partition-head-aft', 1.0)
      .map(partBounds)
      .sort((a, b) => a.min[0] - b.min[0])
    expect(piers).toHaveLength(2)
    const leftPier = piers[0]
    const rightPier = piers[1]
    expectBoundsClose(leftPier, {
      min: [-2, 0, 1.35],
      max: [-1.65, 3, 1.45],
    })
    expectBoundsClose(rightPier, {
      min: [-0.95, 0, 1.35],
      max: [-0.6, 3, 1.45],
    })
    expect(HEAD_DOOR.width).toBeCloseTo(rightPier.min[0] - leftPier.max[0], 9)
    const lintel = partsOf('partition-head-aft').find(
      (part) => partBounds(part).min[1] > 1,
    )
    expect(lintel).toBeDefined()
    expect(partBounds(lintel as NonNullable<typeof lintel>).min[1]).toBeCloseTo(1.9, 9)

    // Nothing else may occupy the doorway prism (the stall stays enterable).
    const prism: Aabb3 = {
      min: [-1.3 - HEAD_DOOR.width / 2, 0, 1.4 - 0.15],
      max: [-1.3 + HEAD_DOOR.width / 2, HEAD_DOOR.height, 1.4 + 0.15],
    }
    for (const candidate of GALLEY_ASSEMBLIES) {
      if (candidate.id.startsWith('partition-head')) continue
      for (const part of assemblyParts(candidate)) {
        expect(
          overlaps(partBounds(part), prism),
          `assembly "${candidate.id}" blocks the head doorway`,
        ).toBe(false)
      }
    }
  })

  it('fits the head out — sink counter, cabinet and mirror — inside the stall', () => {
    // The stall interior: port wall to the return partition, aft partition to
    // the forward wall (x ∈ [−2.0, −0.6], z ∈ [1.45, 2.4]).
    const counter = assemblyBounds(assembly('head-counter'))
    const cabinet = assemblyBounds(assembly('head-cabinet'))
    expectBoundsClose(counter, { min: [-2, 0, 1.95], max: [-1.4, 0.85, 2.4] })
    for (const box of [counter, cabinet]) {
      expect(box.min[0]).toBeGreaterThanOrEqual(-2 - 1e-9)
      expect(box.max[0]).toBeLessThanOrEqual(-0.6 + 1e-9)
      expect(box.min[2]).toBeGreaterThanOrEqual(1.45 - 1e-9)
      expect(box.max[2]).toBeLessThanOrEqual(2.4 + 1e-9)
    }
    // The cabinet hangs on the return partition's inner face, opening into the
    // stall (−x), and the mirror hangs on the port wall above the sink.
    expect(assembly('head-cabinet').placement.rotation).toBe(3)
    expect(cabinet.max[0]).toBeCloseTo(-0.6, 9)
    const mirror = assembly('head-mirror')
    expect(mirror.placement.rotation).toBe(1)
    const mirrorBounds = assemblyBounds(mirror)
    expect(mirrorBounds.min[0]).toBeCloseTo(-2, 9)
    expect(mirrorBounds.max[0]).toBeCloseTo(-1.94, 9)
    expect(mirrorBounds.min[1]).toBeCloseTo(1.375, 9)
    expect(mirror.placement.position?.[1]).toBeCloseTo(1.6, 9)
    // Mirror sits above the counter, over the sink.
    expect(mirrorBounds.min[1]).toBeGreaterThan(counter.max[1])
  })

  it('anchors its §4 landmarks as equipment slots matching the geometry', () => {
    const slots = GALLEY_MODULE.manifest.equipmentSlots
    expect(slots.map((slot) => slot.id)).toEqual([
      'hatch-spine',
      'hatch-side',
      'bunk-lower',
      'bunk-upper',
      'mess-table',
      'bench-aft',
      'bench-fwd',
      'pantry-locker',
      'coffee-station',
      'head-counter',
      'head-cabinet',
      'head-mirror',
      'mess-screen',
    ])
    for (const slot of slots) {
      const found = findAssembly(GALLEY_MODULE, slot.id)
      expect(found, slot.id).toBeDefined()
      expect(slot.position, slot.id).toEqual(found?.placement.position)
      expect(slot.rotation ?? 0, slot.id).toBe(found?.placement.rotation ?? 0)
    }
  })

  it('lights the galley from practical fixtures only (room-lit precondition)', () => {
    const lights = GALLEY_MODULE.manifest.lightSockets
    expect(new Set(lights.map((light) => light.kind))).toEqual(
      new Set(['panel', 'task', 'screen']),
    )

    const panels = lights.filter((light) => light.kind === 'panel')
    expect(panels).toHaveLength(4)
    for (const socket of panels) {
      const fixture = findAssembly(GALLEY_MODULE, socket.id)
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

    // The task socket IS the coffee station's own strip light: the socket
    // coincides with the station's `panel-light` part after the same
    // placement transform (placePoint), so M4-T1 lights the real fixture.
    const task = lights.find((light) => light.id === 'coffee-station-task')
    expect(task).toBeDefined()
    const strips = partsOf('coffee-station').filter(
      (part) => part.materialSlot === 'panel-light',
    )
    expect(strips).toHaveLength(1)
    expect(task?.position).toEqual(strips[0].position)
    const stripPosition = (task?.position ?? [0, 0, 0]) as Vec3
    const expectedStrip: Vec3 = [0.7, 0.87, 1.775]
    for (let axis = 0; axis < 3; axis++) {
      expect(stripPosition[axis], `axis ${axis}`).toBeCloseTo(expectedStrip[axis], 9)
    }

    // One screen light in the room, on the mess display.
    const screens = lights.filter((light) => light.kind === 'screen')
    expect(screens.map((light) => light.id)).toEqual(['mess-screen'])
    expect(screens[0].position).toEqual([1.97, 1.8, -0.35])
  })

  it('draws only from the galley’s §4 slots', () => {
    expect(moduleMaterialSlots(GALLEY_MODULE)).toEqual([
      'deckplate',
      'bulkhead',
      'conduit',
      'panel-light',
      'screen',
      'hazard',
      'webbing',
      'coffee-accent',
    ])
    for (const part of moduleParts(GALLEY_MODULE)) {
      expect(MATERIAL_SLOTS).toContain(part.materialSlot)
    }
  })

  it('keeps both doorways (spine + side) clear of solid geometry', () => {
    const spine = spineDoor()
    const side = sideDoor()
    expectBoundsClose(doorwayPrism(spine), {
      min: [-0.45, 0, -2.65],
      max: [0.45, 2, -2.35],
    })
    expectBoundsClose(doorwayPrism(side), {
      min: [1.95, 0, 0.75],
      max: [2.25, 2, 1.65],
    })

    for (const candidate of GALLEY_ASSEMBLIES) {
      if (candidate.fillsSocket === true) continue
      for (const part of assemblyParts(candidate)) {
        for (const [id, prism] of [
          ['spine-door', doorwayPrism(spine)],
          ['side-door', doorwayPrism(side)],
        ] as const) {
          expect(
            overlaps(partBounds(part), prism),
            `assembly "${candidate.id}" blocks the ${id} doorway`,
          ).toBe(false)
        }
      }
    }
  })

  it('derives the collision hint from the solid geometry (hatches excluded)', () => {
    const solidParts = moduleSolidParts(GALLEY_MODULE)
    const boxes = moduleCollisionBoxes(GALLEY_MODULE)
    expect(boxes.length).toBeGreaterThan(40)
    expect(boxes).toHaveLength(solidParts.length)
    boxes.forEach((box, index) => {
      expectBoundsClose(box, partBounds(solidParts[index]))
    })
    expect(GALLEY_MODULE.manifest.collisionHint.boxes).toEqual(boxes)
    // The hatches are not hull: both doorways stay traversable.
    expect(findAssembly(GALLEY_MODULE, 'hatch-spine')?.solid).toBeUndefined()
    expect(findAssembly(GALLEY_MODULE, 'hatch-side')?.solid).toBeUndefined()
  })

  it('keeps every fixture inside the module box', () => {
    // The deck plate IS the floor structure (it hangs below y = 0) and the
    // hatches straddle their socket planes — both are checked by
    // moduleProblems with the documented structural allowances.
    for (const candidate of GALLEY_ASSEMBLIES) {
      if (candidate.id === 'deck-plate' || candidate.fillsSocket === true) continue
      const bounds = assemblyBounds(candidate)
      expect(bounds.min[0], candidate.id).toBeGreaterThanOrEqual(-2.1 - 1e-9)
      expect(bounds.max[0], candidate.id).toBeLessThanOrEqual(2.1 + 1e-9)
      expect(bounds.min[1], candidate.id).toBeGreaterThanOrEqual(-1e-9)
      expect(bounds.max[1], candidate.id).toBeLessThanOrEqual(3 + 1e-9)
      expect(bounds.min[2], candidate.id).toBeGreaterThanOrEqual(-2.5 - 1e-9)
      expect(bounds.max[2], candidate.id).toBeLessThanOrEqual(2.5 + 1e-9)
    }
  })
})

/** The module's spine door socket (the standardized −z breach). */
function spineDoor() {
  const door = GALLEY_MODULE.manifest.doorSockets.find(
    (socket) => socket.id === 'spine-door',
  )
  if (door === undefined) throw new Error('galley module: no spine door')
  return door
}

/** The module's contract side door socket (+x face, off-centre in the wall). */
function sideDoor() {
  const door = GALLEY_MODULE.manifest.doorSockets.find(
    (socket) => socket.id === 'side-door',
  )
  if (door === undefined) throw new Error('galley module: no side door')
  return door
}
