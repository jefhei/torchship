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
import { HEAD_ASSEMBLIES, HEAD_MODULE } from './head'
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

describe('authored head module (M2-T2)', () => {
  it('is intact: no integrity problems, and the gate passes', () => {
    expect(moduleProblems(HEAD_MODULE)).toEqual([])
    expect(() => assertModuleIntegrity(HEAD_MODULE)).not.toThrow()
  })

  it('declares the M0-T5 head footprint with the floor at local y = 0', () => {
    expect(HEAD_MODULE.manifest.id).toBe('head')
    expect(HEAD_MODULE.manifest.dimensions).toEqual([4.8, 3, 3.6])
    expect(HEAD_MODULE.manifest.label).toMatch(/bridge/i)
  })

  it('reproduces the contract kit’s head entry (the M2-T7 gate, empty diff)', () => {
    expect(moduleContractProblems(HEAD_MODULE, CONTRACT_KIT)).toEqual([])
    const contract = contractSocketOrigins()['head.spine-door']
    const authored = HEAD_MODULE.manifest.doorSockets.find(
      (socket) => socket.id === 'spine-door',
    )
    expect(authored).toBeDefined()
    expect(authored?.position).toEqual(contract.position)
    expect(authored?.facing).toBe(contract.facing)
  })

  it('carries exactly one standardized spine door, flush in its −z face', () => {
    const sockets = HEAD_MODULE.manifest.doorSockets
    expect(sockets.map((socket) => socket.id)).toEqual(['spine-door'])
    const door = sockets[0]
    expect(door.position).toEqual([0, STANDARD_DOOR_CENTER_M, -1.8])
    expect(door.facing).toBe('-z')
    expect(isStandardDoorCenter(door)).toBe(true)
    expect(doorSizeOf(door)).toEqual(STANDARD_DOOR_SIZE)
  })

  it('builds its shell tight to the declared box (dims cannot drift)', () => {
    const shell = HEAD_ASSEMBLIES.filter(
      (assembly) => assembly.id === 'deck-plate' || assembly.id.startsWith('wall-'),
    )
    expect(shell.map((assembly) => assembly.id)).toEqual([
      'deck-plate',
      'wall-aft-spine',
      'wall-fwd-sensor',
      'wall-port',
      'wall-stbd',
    ])
    expectBoundsClose(assembliesBounds(shell), {
      min: [-2.4, -0.2, -1.8],
      max: [2.4, 3, 1.8],
    })
  })

  it('keeps every fixture inside the module box', () => {
    // The deck plate IS the floor structure (it hangs below y = 0) and the
    // hatch straddles its socket plane — both are checked by moduleProblems
    // with the documented structural allowances.
    for (const assembly of HEAD_ASSEMBLIES) {
      if (assembly.id === 'deck-plate' || assembly.fillsSocket === true) continue
      const bounds = assemblyBounds(assembly)
      expect(bounds.min[0], assembly.id).toBeGreaterThanOrEqual(-2.4 - 1e-9)
      expect(bounds.max[0], assembly.id).toBeLessThanOrEqual(2.4 + 1e-9)
      expect(bounds.min[1], assembly.id).toBeGreaterThanOrEqual(-1e-9)
      expect(bounds.max[1], assembly.id).toBeLessThanOrEqual(3 + 1e-9)
      expect(bounds.min[2], assembly.id).toBeGreaterThanOrEqual(-1.8 - 1e-9)
      expect(bounds.max[2], assembly.id).toBeLessThanOrEqual(1.8 + 1e-9)
    }
  })

  it('lays out two crash-couch stations facing the bow sensor wall', () => {
    const couches = HEAD_ASSEMBLIES.filter((assembly) =>
      assembly.id.startsWith('couch-'),
    )
    expect(couches.map((assembly) => assembly.id)).toEqual([
      'couch-pilot',
      'couch-gunner',
    ])
    expect(couches.map((assembly) => assembly.placement.position?.[0])).toEqual([
      -1.2, 1.2,
    ])
    for (const couch of couches) {
      expect(couch.solid, couch.id).toBe(true)
      // Rotation 0: the couch faces +z, i.e. at the sensor wall.
      expect(couch.placement.rotation ?? 0, couch.id).toBe(0)
      const bounds = assemblyBounds(couch)
      expect(bounds.min[2], couch.id).toBeGreaterThan(-1.8)
      expect(bounds.max[2], couch.id).toBeLessThan(1.7)
    }
  })

  it('bolts a console desk between each couch and the sensor wall', () => {
    const stations = [
      { couch: 'couch-pilot', console: 'console-pilot', x: -1.2 },
      { couch: 'couch-gunner', console: 'console-gunner', x: 1.2 },
    ]
    for (const station of stations) {
      const couch = findAssembly(HEAD_MODULE, station.couch) as ModuleAssembly
      const console = findAssembly(HEAD_MODULE, station.console) as ModuleAssembly
      expect(couch.placement.position?.[0], station.couch).toBe(station.x)
      expect(console.placement.position?.[0], station.console).toBe(station.x)
      expect(console.solid, station.console).toBe(true)
      // Desk sits ahead of the seat and against the sensor wall.
      expect(assemblyBounds(couch).max[2], station.couch).toBeLessThan(
        assemblyBounds(console).min[2],
      )
      expect(assemblyBounds(console).max[2], station.console).toBeCloseTo(1.7, 9)
    }
  })

  it('mounts the sensor array and both station displays into the room (−z)', () => {
    const array = findAssembly(HEAD_MODULE, 'sensor-array') as ModuleAssembly
    expect(array.placement.rotation).toBe(2)
    const bounds = assemblyBounds(array)
    expect(bounds.min[0]).toBeCloseTo(-0.8, 9)
    expect(bounds.max[0]).toBeCloseTo(0.8, 9)
    expect(bounds.min[2]).toBeCloseTo(1.64, 9)
    expect(bounds.max[2]).toBeCloseTo(1.7, 9) // flush on the wall's inner face

    const stations = HEAD_ASSEMBLIES.filter((assembly) =>
      assembly.id.startsWith('station-screen-'),
    )
    expect(stations).toHaveLength(2)
    for (const station of stations) {
      expect(station.placement.rotation, station.id).toBe(2)
    }
  })

  it('anchors its §4 landmarks as equipment slots matching the geometry', () => {
    const slots = HEAD_MODULE.manifest.equipmentSlots
    expect(slots.map((slot) => slot.id)).toEqual([
      'hatch-spine',
      'couch-pilot',
      'couch-gunner',
      'console-pilot',
      'console-gunner',
      'sensor-array',
      'locker-bank',
    ])
    for (const slot of slots) {
      const assembly = findAssembly(HEAD_MODULE, slot.id)
      expect(assembly, slot.id).toBeDefined()
      expect(slot.position, slot.id).toEqual(assembly?.placement.position)
      expect(slot.rotation ?? 0, slot.id).toBe(assembly?.placement.rotation ?? 0)
    }
  })

  it('lights the bridge from practical fixtures only (room-lit precondition)', () => {
    const lights = HEAD_MODULE.manifest.lightSockets
    expect(lights.length).toBeGreaterThanOrEqual(3)
    expect(new Set(lights.map((light) => light.kind))).toEqual(
      new Set(['panel', 'screen', 'task']),
    )
    const panelLights = HEAD_ASSEMBLIES.filter((assembly) =>
      assembly.id.startsWith('panel-light-'),
    )
    expect(panelLights).toHaveLength(3)
    for (const assembly of panelLights) {
      const socket = lights.find((light) => light.id === assembly.id)
      expect(socket, assembly.id).toBeDefined()
      expect(socket?.kind).toBe('panel')
      expect(socket?.position, assembly.id).toEqual(assembly.placement.position)
    }
  })

  it('draws only from the bridge’s §4 slots', () => {
    expect(moduleMaterialSlots(HEAD_MODULE)).toEqual([
      'deckplate',
      'bulkhead',
      'conduit',
      'panel-light',
      'screen',
      'hazard',
      'webbing',
    ])
    for (const part of moduleParts(HEAD_MODULE)) {
      expect(MATERIAL_SLOTS).toContain(part.materialSlot)
    }
  })

  it('keeps the spine doorway clear of solid geometry', () => {
    const door = HEAD_MODULE.manifest.doorSockets[0]
    const halfWidth = STANDARD_DOOR_SIZE.width / 2
    const plane = { min: [-halfWidth, 0, -1.95], max: [halfWidth, 2, -1.65] } as Aabb3
    // The imported helper sweeps the same prism moduleProblems uses.
    const prism = doorwayPrism(door)
    expectBoundsClose(prism, plane)

    for (const assembly of HEAD_ASSEMBLIES) {
      if (assembly.fillsSocket === true) continue
      for (const part of assemblyParts(assembly)) {
        expect(
          overlaps(partBounds(part), plane),
          `assembly "${assembly.id}" blocks the spine doorway`,
        ).toBe(false)
      }
    }
  })

  it('derives the collision hint from the solid geometry (hatch excluded)', () => {
    const solidParts = moduleSolidParts(HEAD_MODULE)
    const boxes = moduleCollisionBoxes(HEAD_MODULE)
    expect(boxes.length).toBeGreaterThan(20)
    expect(boxes).toHaveLength(solidParts.length)
    boxes.forEach((box, index) => {
      expectBoundsClose(box, partBounds(solidParts[index]))
    })
    expect(HEAD_MODULE.manifest.collisionHint.boxes).toEqual(boxes)
    // The hatch is not a hull: the spine doorway stays traversable.
    expect(findAssembly(HEAD_MODULE, 'hatch-spine')?.solid).toBeUndefined()
  })
})
