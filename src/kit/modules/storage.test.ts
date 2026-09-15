import { describe, expect, it } from 'vitest'
import {
  MATERIAL_SLOTS,
  STANDARD_DOOR_CENTER_M,
  STANDARD_DOOR_SIZE,
  doorSizeOf,
  isStandardDoorCenter,
} from '../../types'
import type { Aabb3 } from '../../types'
import { CONTRACT_KIT, contractSocketOrigins } from '../../validation/contractKit'
import { partBounds } from '../parts'
import {
  assertModuleIntegrity,
  doorwayPrism,
  moduleContractProblems,
  moduleProblems,
} from './integrity'
import { STORAGE_ASSEMBLIES, STORAGE_MODULE } from './storage'
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

/** The hold's crate stacks, in build order (their two crates each). */
const STACK_IDS = [
  'crate-port-aft',
  'crate-port-mid',
  'crate-stbd-aft',
  'crate-stbd-fwd',
] as const

/** One crate's envelope on the deck, by stack (from the module's own layout). */
const STACK_CENTRES = {
  'crate-port-aft': [-1.45, -1.9],
  'crate-port-mid': [-1.45, 0],
  'crate-stbd-aft': [1.45, -2.0],
  'crate-stbd-fwd': [1.35, 1.6],
} as const

/** Lid-to-skid height of one crate including its tie-down straps, m. */
const CRATE_PITCH = 0.78

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
  const found = findAssembly(STORAGE_MODULE, id)
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
  const door = STORAGE_MODULE.manifest.doorSockets.find(
    (socket) => socket.id === 'spine-door',
  )
  if (door === undefined) throw new Error('storage module: no spine door')
  return door
}

/** The module's contract side door socket (+x face, off-centre in the wall). */
function sideDoor() {
  const door = STORAGE_MODULE.manifest.doorSockets.find(
    (socket) => socket.id === 'side-door',
  )
  if (door === undefined) throw new Error('storage module: no side door')
  return door
}

describe('authored storage module (M2-T5)', () => {
  it('is intact: no integrity problems, and the gate passes', () => {
    expect(moduleProblems(STORAGE_MODULE)).toEqual([])
    expect(() => assertModuleIntegrity(STORAGE_MODULE)).not.toThrow()
  })

  it('declares the M0-T5 storage footprint — the kit’s deepest room', () => {
    expect(STORAGE_MODULE.manifest.id).toBe('storage')
    expect(STORAGE_MODULE.manifest.dimensions).toEqual([4.0, 3, 6.0])
    expect(STORAGE_MODULE.manifest.label).toMatch(/storage/i)
    expect(STORAGE_MODULE.manifest.label).toMatch(/cargo/i)
    expect(STORAGE_MODULE.manifest.label).toMatch(/long-haul/i)
    // The hold is the long-haul variant: 6 m, the deepest footprint of the kit.
    expect(STORAGE_MODULE.manifest.dimensions[2]).toBeGreaterThan(
      STORAGE_MODULE.manifest.dimensions[0] * 1.4,
    )
  })

  it('reproduces the contract kit’s storage entry (the M2-T7 gate, empty diff)', () => {
    expect(moduleContractProblems(STORAGE_MODULE, CONTRACT_KIT)).toEqual([])
    const contract = contractSocketOrigins()
    for (const id of ['spine-door', 'side-door'] as const) {
      const expected = contract[`storage.${id}`]
      const authored = STORAGE_MODULE.manifest.doorSockets.find(
        (socket) => socket.id === id,
      )
      expect(authored, id).toBeDefined()
      expect(authored?.position, id).toEqual(expected.position)
      expect(authored?.facing, id).toBe(expected.facing)
    }
  })

  it('carries exactly one standardized spine door, flush in its −z face', () => {
    const door = spineDoor()
    expect(door.position).toEqual([0, STANDARD_DOOR_CENTER_M, -3])
    expect(door.facing).toBe('-z')
    expect(isStandardDoorCenter(door)).toBe(true)
    expect(doorSizeOf(door)).toEqual(STANDARD_DOOR_SIZE)
    expect(
      STORAGE_MODULE.manifest.doorSockets.filter(
        (socket) => socket.id === 'spine-door',
      ),
    ).toHaveLength(1)
  })

  it('carries the contract side door in the starboard face, off-centre along the wall', () => {
    const door = sideDoor()
    // +x face, standard centre, 1.0 m bow-ward of the wall's own centre.
    expect(door.position).toEqual([2, STANDARD_DOOR_CENTER_M, 1])
    expect(door.facing).toBe('+x')
    expect(isStandardDoorCenter(door)).toBe(true)
    expect(doorSizeOf(door)).toEqual(STANDARD_DOOR_SIZE)
    expect(STORAGE_MODULE.manifest.doorSockets).toHaveLength(2)
  })

  it('builds its shell tight to the declared box (dims cannot drift)', () => {
    const shell = STORAGE_ASSEMBLIES.filter(
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
      min: [-2, -0.2, -3],
      max: [2, 3, 3],
    })
  })

  it('cuts the side-door opening into the starboard wall at the socket origin', () => {
    const wall = assembly('wall-stbd')
    expect(wall.placement.rotation).toBe(3)
    // At the door-centre height the starboard wall is two piers only: the
    // opening between them is exactly the 0.9 m the contract socket declares,
    // 1.0 m bow-ward of the wall's centre.
    const piers = partsSpanningY('wall-stbd', STANDARD_DOOR_CENTER_M)
    expect(piers).toHaveLength(2)
    const boxes = piers.map(partBounds).sort((a, b) => a.min[2] - b.min[2])
    expectBoundsClose(boxes[0], { min: [1.9, 0, -3], max: [2, 3, 0.55] })
    expectBoundsClose(boxes[1], { min: [1.9, 0, 1.45], max: [2, 3, 3] })
    expect((boxes[0].max[2] + boxes[1].min[2]) / 2).toBeCloseTo(1, 9)
    expect(boxes[1].min[2] - boxes[0].max[2]).toBeCloseTo(0.9, 9)

    // …and the lintel above it starts exactly at the door's 2.0 m head.
    const lintel = partsOf('wall-stbd').find(
      (part) => partBounds(part).min[1] > STANDARD_DOOR_CENTER_M,
    )
    expect(lintel).toBeDefined()
    const lintelBounds = partBounds(lintel as NonNullable<typeof lintel>)
    expect(lintelBounds.min[1]).toBeCloseTo(STANDARD_DOOR_SIZE.height, 9)
    expect(lintelBounds.min[2]).toBeCloseTo(0.55, 9)
    expect(lintelBounds.max[2]).toBeCloseTo(1.45, 9)
  })

  it('seats a socket-centred hatch on each door', () => {
    const spineHatch = assembly('hatch-spine')
    expect(spineHatch.fillsSocket).toBe(true)
    expect(spineHatch.placement.position).toEqual([0, STANDARD_DOOR_CENTER_M, -3])
    expect(spineHatch.placement.rotation ?? 0).toBe(0)

    const sideHatch = assembly('hatch-side')
    expect(sideHatch.fillsSocket).toBe(true)
    expect(sideHatch.placement.position).toEqual([2, STANDARD_DOOR_CENTER_M, 1])
    expect(sideHatch.placement.rotation).toBe(3)
    expectBoundsClose(partBounds(assemblyParts(sideHatch)[0]), {
      min: [1.975, 0.01, 0.56],
      max: [2.025, 1.99, 1.44],
    })
  })

  it('lashes four cargo stacks down, two crates high', () => {
    for (const stackId of STACK_IDS) {
      const [x, z] = STACK_CENTRES[stackId]
      const lower = assembly(`${stackId}-lower`)
      const upper = assembly(`${stackId}-upper`)
      for (const [crate, y] of [
        [lower, 0],
        [upper, CRATE_PITCH],
      ] as const) {
        expect(crate.solid, crate.id).toBe(true)
        expect(crate.placement.position, crate.id).toEqual([x, y, z])
        expect(crate.placement.rotation ?? 0, crate.id).toBe(0)
        const parts = assemblyParts(crate)
        // The crate primitive: 2 skids + body + 2 straps × 3 pieces + placard.
        expect(parts, crate.id).toHaveLength(10)
        expect(
          parts.filter((part) => part.materialSlot === 'webbing'),
          crate.id,
        ).toHaveLength(6)
        expectBoundsClose(assemblyBounds(crate), {
          min: [x - 0.45, y, z - 0.62],
          max: [x + 0.45, y + CRATE_PITCH, z + 0.62],
        })
      }
      // The upper crate rests exactly ON the lower one's lid, strap to skid.
      expect(assemblyBounds(upper).min[1]).toBeCloseTo(assemblyBounds(lower).max[1], 9)
    }
    // Two stacks per wall, and each crate's long axis runs fore-and-aft.
    expect(STACK_IDS.filter((id) => STACK_CENTRES[id][0] < 0)).toHaveLength(2)
    for (const stackId of STACK_IDS) {
      const bounds = assemblyBounds(assembly(`${stackId}-lower`))
      expect(bounds.max[2] - bounds.min[2], stackId).toBeGreaterThan(
        bounds.max[0] - bounds.min[0],
      )
    }
  })

  it('keeps the centreline lane clear from the spine door to the bow wall', () => {
    // The corridor the crew moves freight down: 1.2 m wide (PRD §4 "corridors
    // wide enough for two people"), between the two room walls and clear above
    // the deck's cable ducts — through the aft doorway, past every stack, to
    // the bow wall.
    const lane: Aabb3 = {
      min: [-0.6, 0.1, -2.9],
      max: [0.6, 2, 2.9],
    }
    for (const candidate of STORAGE_ASSEMBLIES) {
      if (candidate.id === 'deck-plate') continue
      for (const part of assemblyParts(candidate)) {
        expect(
          overlaps(partBounds(part), lane),
          `assembly "${candidate.id}" blocks the centreline lane`,
        ).toBe(false)
      }
    }
  })

  it('lines the port wall forward with the spares rack, doors out into the hold', () => {
    const rack = assembly('spares-rack')
    expect(rack.placement.position).toEqual([-1.65, 0, 1.7])
    expect(rack.placement.rotation).toBe(1)
    expect(rack.solid).toBe(true)
    const bounds = assemblyBounds(rack)
    // Body flush on the port wall, 1.6 m along it, doors proud into the hold.
    expectBoundsClose(bounds, {
      min: [-1.9, 0, 0.9],
      max: [-1.35, 2.2, 2.5],
    })
    expect(bounds.max[0]).toBeGreaterThan(-1.42)
    // Forward of the amidships crates, and short of the bow wall.
    expect(bounds.min[2]).toBeGreaterThan(
      assemblyBounds(assembly('crate-port-mid-lower')).max[2],
    )
    expect(bounds.max[2]).toBeLessThan(3)
  })

  it('gives the loadmaster a station in the bow-starboard corner', () => {
    const bench = assembly('loadmaster-bench')
    expect(bench.placement.position).toEqual([1.2, 0, 2.55])
    expect(bench.placement.rotation ?? 0).toBe(0)
    expectBoundsClose(assemblyBounds(bench), {
      min: [0.7, 0, 2.25],
      max: [1.7, 0.9, 2.85],
    })

    const screen = assembly('loadmaster-screen')
    expect(screen.placement.rotation).toBe(2)
    const screenBounds = assemblyBounds(screen)
    expectBoundsClose(screenBounds, {
      min: [0.9, 1.775, 2.84],
      max: [1.5, 2.225, 2.9],
    })
    // The terminal hangs ON the bow wall, above the bench.
    expect(screenBounds.min[1]).toBeGreaterThan(assemblyBounds(bench).max[1])
    expect(screenBounds.max[2]).toBeCloseTo(2.9, 9)

    const strip = assembly('loadmaster-task-light')
    expect(strip.placement.rotation).toBe(2)
    const stripBounds = assemblyBounds(strip)
    expect(stripBounds.max[1]).toBeLessThan(screenBounds.min[1])
    // The task socket IS the fixture's own emissive lens (placePoint), so M4-T1
    // lights the part that is actually drawn.
    const socket = STORAGE_MODULE.manifest.lightSockets.find(
      (light) => light.id === 'loadmaster-task-light',
    )
    expect(socket).toBeDefined()
    expect(socket?.kind).toBe('task')
    const lens = assemblyParts(strip).filter(
      (part) => part.materialSlot === 'panel-light',
    )
    expect(lens).toHaveLength(1)
    expect(socket?.position).toEqual(lens[0].position)

    // Nothing in the station blocks the side door it stands beside.
    for (const candidate of [
      'loadmaster-bench',
      'loadmaster-screen',
      'loadmaster-task-light',
    ]) {
      for (const part of partsOf(candidate)) {
        expect(overlaps(partBounds(part), doorwayPrism(sideDoor())), candidate).toBe(
          false,
        )
      }
    }
  })

  it('anchors its hold as equipment slots matching the geometry', () => {
    const slots = STORAGE_MODULE.manifest.equipmentSlots
    expect(slots.map((slot) => slot.id)).toEqual([
      'hatch-spine',
      'hatch-side',
      ...STACK_IDS.flatMap((id) => [`${id}-lower`, `${id}-upper`]),
      'spares-rack',
      'loadmaster-bench',
      'loadmaster-screen',
      'loadmaster-task-light',
    ])
    for (const slot of slots) {
      const found = findAssembly(STORAGE_MODULE, slot.id)
      expect(found, slot.id).toBeDefined()
      expect(slot.position, slot.id).toEqual(found?.placement.position)
      expect(slot.rotation ?? 0, slot.id).toBe(found?.placement.rotation ?? 0)
    }
  })

  it('lights the hold from practical fixtures only', () => {
    const lights = STORAGE_MODULE.manifest.lightSockets
    expect(new Set(lights.map((light) => light.kind))).toEqual(
      new Set(['panel', 'task', 'screen']),
    )

    const panels = lights.filter((light) => light.kind === 'panel')
    expect(panels).toHaveLength(4)
    // The panels run the length of the hold, not bunched at one end.
    const panelZ = panels.map((light) => light.position[2]).sort((a, b) => a - b)
    expect(panelZ[0]).toBeLessThan(-2)
    expect(panelZ[3]).toBeGreaterThan(1.5)
    for (const socket of panels) {
      const fixture = findAssembly(STORAGE_MODULE, socket.id)
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
    expect(screens.map((light) => light.id)).toEqual(['loadmaster-screen'])
    expect(screens[0].position).toEqual([1.2, 2, 2.87])
  })

  it('draws only from the storage §4 slots', () => {
    expect(moduleMaterialSlots(STORAGE_MODULE)).toEqual([
      'deckplate',
      'bulkhead',
      'conduit',
      'panel-light',
      'screen',
      'hazard',
      'webbing',
    ])
    for (const part of moduleParts(STORAGE_MODULE)) {
      expect(MATERIAL_SLOTS).toContain(part.materialSlot)
    }
    // The warm accent is the galley's alone — the hold must not draw it.
    expect(moduleMaterialSlots(STORAGE_MODULE)).not.toContain('coffee-accent')
  })

  it('keeps both doorways clear of solid geometry', () => {
    const spine = spineDoor()
    const side = sideDoor()
    expectBoundsClose(doorwayPrism(spine), {
      min: [-0.45, 0, -3.15],
      max: [0.45, 2, -2.85],
    })
    expectBoundsClose(doorwayPrism(side), {
      min: [1.85, 0, 0.55],
      max: [2.15, 2, 1.45],
    })

    for (const candidate of STORAGE_ASSEMBLIES) {
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
    const solidParts = moduleSolidParts(STORAGE_MODULE)
    const boxes = moduleCollisionBoxes(STORAGE_MODULE)
    // One box per solid part — 102 of them on the loaded hold.
    expect(boxes).toHaveLength(102)
    expect(boxes).toHaveLength(solidParts.length)
    boxes.forEach((box, index) => {
      expectBoundsClose(box, partBounds(solidParts[index]))
    })
    expect(STORAGE_MODULE.manifest.collisionHint.boxes).toEqual(boxes)
    // The hatches are not hull: both doorways stay traversable.
    expect(findAssembly(STORAGE_MODULE, 'hatch-spine')?.solid).toBeUndefined()
    expect(findAssembly(STORAGE_MODULE, 'hatch-side')?.solid).toBeUndefined()
  })

  it('keeps every fixture inside the module box', () => {
    // The deck plate IS the floor structure (it hangs below y = 0) and the
    // hatches straddle their socket planes — both are checked by
    // moduleProblems with the documented structural allowances.
    for (const candidate of STORAGE_ASSEMBLIES) {
      if (candidate.id === 'deck-plate' || candidate.id.startsWith('hatch-')) continue
      const bounds = assemblyBounds(candidate)
      expect(bounds.min[0], candidate.id).toBeGreaterThanOrEqual(-2 - 1e-9)
      expect(bounds.max[0], candidate.id).toBeLessThanOrEqual(2 + 1e-9)
      expect(bounds.min[1], candidate.id).toBeGreaterThanOrEqual(-1e-9)
      expect(bounds.max[1], candidate.id).toBeLessThanOrEqual(3 + 1e-9)
      expect(bounds.min[2], candidate.id).toBeGreaterThanOrEqual(-3 - 1e-9)
      expect(bounds.max[2], candidate.id).toBeLessThanOrEqual(3 + 1e-9)
    }
  })

  it('stows the cargo against both walls, clear of the side-door swing', () => {
    // Port column and starboard column both run the length of the hold…
    const portColumn = STACK_IDS.filter((id) => STACK_CENTRES[id][0] < 0).map((id) =>
      assemblyBounds(assembly(`${id}-lower`)),
    )
    const starboardColumn = STACK_IDS.filter((id) => STACK_CENTRES[id][0] > 0).map(
      (id) => assemblyBounds(assembly(`${id}-lower`)),
    )
    for (const column of [portColumn, starboardColumn]) {
      expect(column).toHaveLength(2)
      for (const bounds of column) {
        expect(bounds.min[0]).toBeGreaterThanOrEqual(-1.9 - 1e-9)
        expect(bounds.max[0]).toBeLessThanOrEqual(1.9 + 1e-9)
      }
    }
    // …flush on their walls, with the crates' placards facing the lane.
    for (const id of ['crate-port-aft', 'crate-port-mid'] as const) {
      expect(assemblyBounds(assembly(`${id}-lower`)).min[0], id).toBeCloseTo(-1.9, 9)
    }
    expect(assemblyBounds(assembly('crate-stbd-aft-lower')).max[0]).toBeCloseTo(1.9, 9)
    // The forward starboard stack is stood inboard so the side door still
    // opens onto clear deck (PRD §8 hatch alignment: no blocked doorways).
    const forward = assemblyBounds(assembly('crate-stbd-fwd-lower'))
    expect(forward.max[0]).toBeLessThan(1.85)
    expect(forward.min[2]).toBeGreaterThan(doorwayPrism(sideDoor()).max[2] - 0.55)
  })
})
