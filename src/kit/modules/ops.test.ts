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
import {
  assertModuleIntegrity,
  doorwayPrism,
  moduleContractProblems,
  moduleProblems,
} from './integrity'
import { OPS_ASSEMBLIES, OPS_MODULE } from './ops'
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

/** The airlock's interior doorway (module-local metres). */
const AIRLOCK_DOOR = { width: 0.8, height: 1.9, centerX: -1.35, centerY: 0.95 }

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
  const found = findAssembly(OPS_MODULE, id)
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

/** A prism a test wants to prove is kept clear of geometry. */
function prismAt(min: Vec3, max: Vec3): Aabb3 {
  return { min, max }
}

describe('authored ops module (M2-T4)', () => {
  it('is intact: no integrity problems, and the gate passes', () => {
    expect(moduleProblems(OPS_MODULE)).toEqual([])
    expect(() => assertModuleIntegrity(OPS_MODULE)).not.toThrow()
  })

  it('declares the M0-T5 ops footprint with the floor at local y = 0', () => {
    expect(OPS_MODULE.manifest.id).toBe('ops')
    expect(OPS_MODULE.manifest.dimensions).toEqual([3.9, 3, 4.6])
    expect(OPS_MODULE.manifest.label).toMatch(/ops/i)
    expect(OPS_MODULE.manifest.label).toMatch(/airlock/i)
    expect(OPS_MODULE.manifest.label).toMatch(/med bay/i)
  })

  it('reproduces the contract kit’s ops entry (the M2-T7 gate, empty diff)', () => {
    expect(moduleContractProblems(OPS_MODULE, CONTRACT_KIT)).toEqual([])
    const contract = contractSocketOrigins()
    for (const id of ['spine-door', 'side-door'] as const) {
      const expected = contract[`ops.${id}`]
      const authored = OPS_MODULE.manifest.doorSockets.find(
        (socket) => socket.id === id,
      )
      expect(authored, id).toBeDefined()
      expect(authored?.position, id).toEqual(expected.position)
      expect(authored?.facing, id).toBe(expected.facing)
    }
  })

  it('carries exactly one standardized spine door, flush in its −z face', () => {
    const doors = OPS_MODULE.manifest.doorSockets.filter(
      (socket) => socket.id === 'spine-door',
    )
    expect(doors).toHaveLength(1)
    expect(doors[0].position).toEqual([0, STANDARD_DOOR_CENTER_M, -2.3])
    expect(doors[0].facing).toBe('-z')
    expect(isStandardDoorCenter(doors[0])).toBe(true)
    expect(doorSizeOf(doors[0])).toEqual(STANDARD_DOOR_SIZE)
  })

  it('carries the contract side door in the port face, off-centre along the wall', () => {
    const doors = OPS_MODULE.manifest.doorSockets.filter(
      (socket) => socket.id === 'side-door',
    )
    expect(doors).toHaveLength(1)
    // −x face, standard centre, 1.0 m aft of the wall's own centre.
    expect(doors[0].position).toEqual([-1.95, STANDARD_DOOR_CENTER_M, -1.0])
    expect(doors[0].facing).toBe('-x')
    expect(isStandardDoorCenter(doors[0])).toBe(true)
    expect(doorSizeOf(doors[0])).toEqual(STANDARD_DOOR_SIZE)
    expect(OPS_MODULE.manifest.doorSockets).toHaveLength(2)
  })

  it('builds its shell tight to the declared box (dims cannot drift)', () => {
    const shell = OPS_ASSEMBLIES.filter(
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
      min: [-1.95, -0.2, -2.3],
      max: [1.95, 3, 2.3],
    })
  })

  it('cuts the airlock’s outer door into the port wall at the socket origin', () => {
    const wall = assembly('wall-port')
    expect(wall.placement.rotation).toBe(1)
    // At the door-centre height the port wall is two piers only: the opening
    // between them is exactly the 0.9 m the contract socket declares.
    const piers = partsSpanningY('wall-port', STANDARD_DOOR_CENTER_M)
    expect(piers).toHaveLength(2)
    const boxes = piers.map(partBounds).sort((a, b) => a.min[2] - b.min[2])
    expectBoundsClose(boxes[0], { min: [-1.95, 0, -2.3], max: [-1.85, 3, -1.45] })
    expectBoundsClose(boxes[1], { min: [-1.95, 0, -0.55], max: [-1.85, 3, 2.3] })
    expect((boxes[0].max[2] + boxes[1].min[2]) / 2).toBeCloseTo(-1.0, 9)
    expect(boxes[1].min[2] - boxes[0].max[2]).toBeCloseTo(0.9, 9)

    // …and the lintel above it starts exactly at the door's 2.0 m head.
    const lintel = partsOf('wall-port').find(
      (part) => partBounds(part).min[1] > STANDARD_DOOR_CENTER_M,
    )
    expect(lintel).toBeDefined()
    const lintelBounds = partBounds(lintel as NonNullable<typeof lintel>)
    expect(lintelBounds.min[1]).toBeCloseTo(STANDARD_DOOR_SIZE.height, 9)
    expect(lintelBounds.min[2]).toBeCloseTo(-1.45, 9)
    expect(lintelBounds.max[2]).toBeCloseTo(-0.55, 9)
  })

  it('walled off the airlock vestibule in the aft-port corner', () => {
    const fwd = assembly('partition-airlock-fwd')
    const side = assembly('partition-airlock-stbd')
    expect(fwd.solid).toBe(true)
    expect(side.solid).toBe(true)
    // Forward partition: across the room at z = −0.4, from the port wall to
    // the starboard partition.
    expectBoundsClose(assemblyBounds(fwd), {
      min: [-1.85, 0, -0.45],
      max: [-0.85, 3, -0.35],
    })
    // Starboard partition: fore-and-aft, closing the vestibule's inboard side
    // against the aft wall.
    expectBoundsClose(assemblyBounds(side), {
      min: [-0.9, 0, -2.2],
      max: [-0.8, 3, -0.45],
    })
    expect(side.placement.rotation).toBe(1)

    // The vestibule interior: x ∈ [−1.85, −0.9], z ∈ [−2.2, −0.45] — and the
    // port wall's own face is its third, outer, side.
    const wallPort = assemblyBounds(assembly('wall-port'))
    expect(wallPort.min[0]).toBeCloseTo(-1.95, 9)
    expect(wallPort.max[0]).toBeCloseTo(-1.85, 9)
  })

  it('enters the airlock through a 0.8 × 1.9 m interior hatch in its forward partition', () => {
    // Two piers at the door-centre height, with the doorway between them.
    const piers = partsSpanningY('partition-airlock-fwd', AIRLOCK_DOOR.centerY)
      .map(partBounds)
      .sort((a, b) => a.min[0] - b.min[0])
    expect(piers).toHaveLength(2)
    expectBoundsClose(piers[0], { min: [-1.85, 0, -0.45], max: [-1.75, 3, -0.35] })
    expectBoundsClose(piers[1], { min: [-0.95, 0, -0.45], max: [-0.85, 3, -0.35] })
    expect(piers[1].min[0] - piers[0].max[0]).toBeCloseTo(AIRLOCK_DOOR.width, 9)
    expect((piers[0].max[0] + piers[1].min[0]) / 2).toBeCloseTo(AIRLOCK_DOOR.centerX, 9)

    // The hatch is socket-centred ON that doorway: its leaf is the door, its
    // frame straddles the partition and its head is the door's 1.9 m.
    const hatch = assembly('hatch-airlock')
    expect(hatch.fillsSocket).toBeUndefined()
    expect(hatch.placement.position?.[0]).toBeCloseTo(AIRLOCK_DOOR.centerX, 9)
    expect(hatch.placement.position?.[1]).toBeCloseTo(AIRLOCK_DOOR.centerY, 9)
    expect(hatch.placement.position?.[2]).toBeCloseTo(-0.4, 9)
    const hatchBounds = assemblyBounds(hatch)
    expect(hatchBounds.min[0]).toBeCloseTo(-1.8, 9)
    expect(hatchBounds.max[0]).toBeCloseTo(-0.9, 9)
    expect(hatchBounds.max[1]).toBeCloseTo(
      AIRLOCK_DOOR.centerY + AIRLOCK_DOOR.height / 2 + 0.05,
      9,
    )
    // The leaf itself is exactly the doorway (clearance 0.01 all round).
    const leaf = partsOf('hatch-airlock')[0]
    const leafBounds = partBounds(leaf)
    expect(leafBounds.max[0] - leafBounds.min[0]).toBeCloseTo(0.78, 9)
    expect(leafBounds.max[1] - leafBounds.min[1]).toBeCloseTo(1.88, 9)

    // Nothing else may occupy the doorway prism (the airlock stays enterable).
    const prism = prismAt(
      [AIRLOCK_DOOR.centerX - AIRLOCK_DOOR.width / 2, 0, -0.4 - 0.15],
      [AIRLOCK_DOOR.centerX + AIRLOCK_DOOR.width / 2, AIRLOCK_DOOR.height, -0.4 + 0.15],
    )
    for (const candidate of OPS_ASSEMBLIES) {
      if (candidate.id === 'hatch-airlock') continue
      for (const part of assemblyParts(candidate)) {
        expect(
          overlaps(partBounds(part), prism),
          `assembly "${candidate.id}" blocks the airlock's interior doorway`,
        ).toBe(false)
      }
    }
  })

  it('hangs the two vac suits on a rack inside the airlock, facing the entry', () => {
    const rack = assembly('suit-rack')
    expect(rack.solid).toBe(true)
    // Back flush on the vestibule's aft wall, centred on its centreline, so
    // the suits face +z — the interior hatch you walk in through.
    expect(rack.placement.position?.[0]).toBeCloseTo(-1.375, 9)
    expect(rack.placement.position?.[1]).toBeCloseTo(0, 9)
    expect(rack.placement.position?.[2]).toBeCloseTo(-2.16, 9)
    const bounds = assemblyBounds(rack)
    expect(bounds.min[2]).toBeCloseTo(-2.2, 9)
    expect(bounds.max[2]).toBeLessThan(-1.7)

    // Two suits, one bay each: each is a torso (webbing), a helmet (bulkhead
    // barrel) and a proud visor disc (screen).
    const parts = partsOf('suit-rack')
    expect(parts).toHaveLength(7)
    const torsos = parts.filter((part) => part.materialSlot === 'webbing')
    const helmets = parts.filter(
      (part) => part.materialSlot === 'bulkhead' && part.kind === 'cylinder',
    )
    const visors = parts.filter((part) => part.materialSlot === 'screen')
    expect(torsos).toHaveLength(2)
    expect(helmets).toHaveLength(2)
    expect(visors).toHaveLength(2)
    for (const visor of visors) {
      expect(visor.kind).toBe('cylinder')
      if (visor.kind === 'cylinder') expect(visor.axis).toBe('z')
      // The visor sits proud of the wall in front of its helmet.
      expect(partBounds(visor).max[2]).toBeCloseTo(bounds.max[2], 9)
    }
    // The two suits hang side by side, symmetric about the rack centre.
    const xs = torsos.map((part) => part.position[0]).sort((a, b) => a - b)
    expect(xs[0]).toBeCloseTo(-1.375 - 0.225, 9)
    expect(xs[1]).toBeCloseTo(-1.375 + 0.225, 9)

    // The rack is the module's only webbing geometry (the suits stand alone).
    const webbingAssemblies = OPS_ASSEMBLIES.filter((candidate) =>
      assemblyParts(candidate).some((part) => part.materialSlot === 'webbing'),
    )
    expect(webbingAssemblies.map((candidate) => candidate.id)).toEqual(['suit-rack'])
  })

  it('bolts the tool wall to the airlock partition’s room face', () => {
    const toolWall = assembly('tool-wall')
    expect(toolWall.solid).toBe(true)
    expect(toolWall.placement.rotation).toBe(1)
    const bounds = assemblyBounds(toolWall)
    // Back against the partition's room-side face (x = −0.8), doors proud of
    // the body into the room (+x), spanning fore-and-aft alongside the airlock.
    expect(bounds.min[0]).toBeCloseTo(-0.8, 9)
    expect(bounds.max[0]).toBeGreaterThan(-0.5)
    expect(bounds.min[1]).toBeCloseTo(0, 9)
    expect(bounds.max[1]).toBeCloseTo(1.5, 9)
    expect(bounds.min[2]).toBeCloseTo(-2.0, 9)
    expect(bounds.max[2]).toBeCloseTo(-0.8, 9)
    // It hangs on the partition, not beside it.
    const partition = assemblyBounds(assembly('partition-airlock-stbd'))
    expect(bounds.min[2]).toBeGreaterThanOrEqual(partition.min[2] - 1e-9)
    expect(bounds.max[2]).toBeLessThanOrEqual(partition.max[2] + 1e-9)
  })

  it('runs the workbench along the starboard wall with its own task light', () => {
    const bench = assembly('workbench')
    expect(bench.solid).toBe(true)
    expect(bench.placement.rotation).toBe(1)
    expectBoundsClose(assemblyBounds(bench), {
      min: [1.25, 0, -1.05],
      max: [1.85, 0.95, 0.35],
    })

    // The bench's terminal sits on the wall above it, facing into the room.
    const screen = assembly('bench-screen')
    const screenBounds = assemblyBounds(screen)
    expect(screen.placement.rotation).toBe(3)
    expect(screenBounds.min[1]).toBeGreaterThan(0.95)
    // Its 0.7 m span runs along the wall, centred over the bench.
    expect((screenBounds.min[2] + screenBounds.max[2]) / 2).toBeCloseTo(-0.5, 9)

    // The task socket IS the fixture's own emissive lens (placePoint), so
    // M4-T1 lights the real part.
    const task = OPS_MODULE.manifest.lightSockets.find(
      (light) => light.id === 'bench-task-light',
    )
    expect(task).toBeDefined()
    expect(task?.kind).toBe('task')
    const lens = partsOf('bench-task-light').find(
      (part) => part.materialSlot === 'panel-light',
    )
    expect(lens).toBeDefined()
    expect(task?.position).toEqual((lens as NonNullable<typeof lens>).position)
    // …and the lens hangs over the bench surface, not the walkway.
    expect(task?.position[0]).toBeCloseTo(1.8, 9)
    expect(task?.position[1]).toBeCloseTo(1.52, 9)
    expect(task?.position[2]).toBeCloseTo(-0.35, 9)
  })

  it('fits the med bay out in the bow-starboard corner', () => {
    // Exam bed: the couch primitive read as a bed (no straps), headboard on
    // the forward wall, long side against the starboard wall.
    const bed = assembly('exam-bed')
    expect(bed.solid).toBe(true)
    expect(bed.placement.rotation).toBe(2)
    expectBoundsClose(assemblyBounds(bed), {
      min: [1.15, 0, 0.4],
      max: [1.85, 1.1, 2.2],
    })
    const bedParts = partsOf('exam-bed')
    expect(
      bedParts.some((part) => part.materialSlot === 'webbing'),
      'an exam bed is not a crash couch: no webbing straps',
    ).toBe(false)
    // The headboard is the backrest: the part that reaches highest, hard
    // against the forward wall.
    const headboard = bedParts.map(partBounds).sort((a, b) => b.min[1] - a.min[1])[0]
    expectBoundsClose(headboard, { min: [1.15, 0.7, 2.08], max: [1.85, 1.1, 2.2] })

    // Med cabinet on the forward wall, door into the room, above the bed's foot.
    const cabinet = assembly('med-cabinet')
    expect(cabinet.solid).toBe(true)
    expect(cabinet.placement.rotation).toBe(2)
    const cabinetBounds = assemblyBounds(cabinet)
    expect(cabinetBounds.max[2]).toBeCloseTo(2.2, 9)
    expect(cabinetBounds.min[2]).toBeCloseTo(1.8, 9)
    expect(cabinetBounds.max[1]).toBeCloseTo(1.3, 9)

    // Med monitor over the bed: the med bay's screen light source.
    const monitor = assembly('med-screen')
    expect(monitor.placement.rotation).toBe(3)
    const monitorBounds = assemblyBounds(monitor)
    expect(monitorBounds.min[1]).toBeGreaterThan(1.1)
    expect(monitorBounds.min[2]).toBeGreaterThanOrEqual(0.4 - 1e-9)
    expect(monitorBounds.max[2]).toBeLessThanOrEqual(2.2 + 1e-9)

    // The med bay and the bench never interpenetrate.
    expect(assemblyBounds(bed).min[2]).toBeGreaterThanOrEqual(
      assemblyBounds(assembly('workbench')).max[2] - 1e-9,
    )
  })

  it('anchors its §4 landmarks as equipment slots matching the geometry', () => {
    const slots = OPS_MODULE.manifest.equipmentSlots
    expect(slots.map((slot) => slot.id)).toEqual([
      'hatch-spine',
      'hatch-side',
      'hatch-airlock',
      'suit-rack',
      'tool-wall',
      'workbench',
      'bench-screen',
      'bench-task-light',
      'exam-bed',
      'med-cabinet',
      'med-screen',
    ])
    for (const slot of slots) {
      const found = findAssembly(OPS_MODULE, slot.id)
      expect(found, slot.id).toBeDefined()
      expect(slot.position, slot.id).toEqual(found?.placement.position)
      expect(slot.rotation ?? 0, slot.id).toBe(found?.placement.rotation ?? 0)
    }
  })

  it('lights the ops deck from practical fixtures only (room-lit precondition)', () => {
    const lights = OPS_MODULE.manifest.lightSockets
    expect(new Set(lights.map((light) => light.kind))).toEqual(
      new Set(['panel', 'task', 'screen']),
    )

    const panels = lights.filter((light) => light.kind === 'panel')
    expect(panels.map((light) => light.id)).toEqual([
      'panel-light-airlock',
      'panel-light-aft',
      'panel-light-med',
      'panel-light-bench',
    ])
    for (const socket of panels) {
      const fixture = findAssembly(OPS_MODULE, socket.id)
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

    // The airlock has its own lamp: the vestibule is not a spec-dark room.
    const airlockLamp = panels.find((light) => light.id === 'panel-light-airlock')
    expect(airlockLamp?.position[0]).toBeCloseTo(-1.375, 9)

    // Two screens: the bench terminal and the med monitor.
    const screens = lights.filter((light) => light.kind === 'screen')
    expect(screens.map((light) => light.id)).toEqual(['bench-screen', 'med-screen'])
  })

  it('draws only from the ops deck’s §4 slots', () => {
    expect(moduleMaterialSlots(OPS_MODULE)).toEqual([
      'deckplate',
      'bulkhead',
      'conduit',
      'panel-light',
      'screen',
      'hazard',
      'webbing',
    ])
    for (const part of moduleParts(OPS_MODULE)) {
      expect(MATERIAL_SLOTS).toContain(part.materialSlot)
    }
  })

  it('keeps both door sockets clear of solid geometry', () => {
    const spine = spineDoor()
    const side = sideDoor()
    expectBoundsClose(doorwayPrism(spine), {
      min: [-0.45, 0, -2.45],
      max: [0.45, 2, -2.15],
    })
    expectBoundsClose(doorwayPrism(side), {
      min: [-2.1, 0, -1.45],
      max: [-1.8, 2, -0.55],
    })

    for (const candidate of OPS_ASSEMBLIES) {
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

  it('keeps the centreline walk from the spine door to the bow clear', () => {
    // The corridor a walking player uses: the spine door's own width, from the
    // aft wall forward to the bow wall. The deck plate IS the floor, so it and
    // its cable runs (0.06 m high) are exempt.
    const corridor = prismAt([-0.35, 0.1, -2.15], [0.35, 2.0, 2.15])
    for (const candidate of OPS_ASSEMBLIES) {
      if (candidate.id === 'deck-plate') continue
      for (const part of assemblyParts(candidate)) {
        expect(
          overlaps(partBounds(part), corridor),
          `assembly "${candidate.id}" blocks the centreline walk`,
        ).toBe(false)
      }
    }
  })

  it('derives the collision hint from the solid geometry (hatches excluded)', () => {
    const solidParts = moduleSolidParts(OPS_MODULE)
    const boxes = moduleCollisionBoxes(OPS_MODULE)
    expect(boxes.length).toBeGreaterThan(35)
    expect(boxes).toHaveLength(solidParts.length)
    boxes.forEach((box, index) => {
      expectBoundsClose(box, partBounds(solidParts[index]))
    })
    expect(OPS_MODULE.manifest.collisionHint.boxes).toEqual(boxes)
    // The three hatches are not hull: both doorways and the airlock stay
    // traversable.
    for (const id of ['hatch-spine', 'hatch-side', 'hatch-airlock']) {
      expect(findAssembly(OPS_MODULE, id)?.solid, id).toBeUndefined()
    }
  })

  it('keeps every fixture inside the module box', () => {
    // The deck plate IS the floor structure (it hangs below y = 0) and the
    // hatches straddle their opening planes — both are checked by
    // moduleProblems with the documented structural allowances.
    for (const candidate of OPS_ASSEMBLIES) {
      if (candidate.id === 'deck-plate' || candidate.id.startsWith('hatch-')) continue
      const bounds = assemblyBounds(candidate)
      expect(bounds.min[0], candidate.id).toBeGreaterThanOrEqual(-1.95 - 1e-9)
      expect(bounds.max[0], candidate.id).toBeLessThanOrEqual(1.95 + 1e-9)
      expect(bounds.min[1], candidate.id).toBeGreaterThanOrEqual(-1e-9)
      expect(bounds.max[1], candidate.id).toBeLessThanOrEqual(3 + 1e-9)
      expect(bounds.min[2], candidate.id).toBeGreaterThanOrEqual(-2.3 - 1e-9)
      expect(bounds.max[2], candidate.id).toBeLessThanOrEqual(2.3 + 1e-9)
    }
  })
})

/** The module's spine door socket (the standardized −z breach). */
function spineDoor() {
  const door = OPS_MODULE.manifest.doorSockets.find(
    (socket) => socket.id === 'spine-door',
  )
  if (door === undefined) throw new Error('ops module: no spine door')
  return door
}

/** The module's contract side door (the airlock's outer door, −x face). */
function sideDoor() {
  const door = OPS_MODULE.manifest.doorSockets.find(
    (socket) => socket.id === 'side-door',
  )
  if (door === undefined) throw new Error('ops module: no side door')
  return door
}
