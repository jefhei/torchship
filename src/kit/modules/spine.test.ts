import { describe, expect, it } from 'vitest'
import {
  DECK_CLEAR_M,
  DECK_PITCH_M,
  MATERIAL_SLOTS,
  STANDARD_DOOR_CENTER_M,
  STANDARD_DOOR_SIZE,
  deckFloorYFor,
  doorSizeOf,
  isStandardDoorCenter,
} from '../../types'
import type { Aabb3, DeckSpec } from '../../types'
import type { BoxPart } from '../types'
import { SPINE_HALF_M, spineAttachOffsetZ } from '../../fixtures/layout'
import { spineBandDoors } from '../../validation/sockets'
import { CONTRACT_KIT } from '../../validation/contractKit'
import { partBounds } from '../parts'
import {
  assertModuleIntegrity,
  doorwayPrism,
  moduleContractProblems,
  moduleProblems,
} from './integrity'
import { AUTHORED_MODULES, authoredKitProblems } from './registry'
import {
  SPINE_ASSEMBLIES,
  SPINE_CRAWL_OPENING,
  SPINE_LADDER_PARAMS,
  SPINE_MODULE,
  SPINE_SHAFT_HALF_M,
  spineRungHeights,
} from './spine'
import {
  SHAFT_FACES,
  assemblyBounds,
  assemblyParts,
  findAssembly,
  isShaftFace,
  moduleBounds,
  moduleCollisionBoxes,
  moduleMaterialSlots,
  moduleSolidParts,
} from './types'
import type { AuthoredModule, ModuleAssembly } from './types'

/** Box comparison at nm scale — computed sums differ from literals in ulps. */
function expectBoundsClose(actual: Aabb3, expected: Aabb3): void {
  for (let axis = 0; axis < 3; axis++) {
    expect(actual.min[axis]).toBeCloseTo(expected.min[axis], 9)
    expect(actual.max[axis]).toBeCloseTo(expected.max[axis], 9)
  }
}

/** Numeric-array comparison at nm scale (computed values differ in ulps). */
function expectVecClose(actual: readonly number[], expected: readonly number[]): void {
  expect(actual).toHaveLength(expected.length)
  actual.forEach((value, index) => {
    expect(value, `[${index}]`).toBeCloseTo(expected[index], 9)
  })
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

/** A box shifted by `dy` (a band's local frame → world, given its deck floor). */
function lifted(box: Aabb3, dy: number): Aabb3 {
  return {
    min: [box.min[0], box.min[1] + dy, box.min[2]],
    max: [box.max[0], box.max[1] + dy, box.max[2]],
  }
}

/** The measured box of every assembly of a band, in world meters. */
function bandBoxes(module: AuthoredModule, deckIndex: number) {
  const dy = deckFloorYFor(deckIndex)
  return module.assemblies.map((assembly) => ({
    id: assembly.id,
    assembly,
    bounds: lifted(assemblyBounds(assembly), dy),
    parts: assemblyParts(assembly).map((part) => lifted(partBounds(part), dy)),
  }))
}

/** A deep clone of the band that a test may damage. */
function cloneSpine(): AuthoredModule {
  return JSON.parse(JSON.stringify(SPINE_MODULE)) as AuthoredModule
}

/** The wall assembly for a shaft face (one per face, cut at its own socket). */
function wallOf(face: string): ModuleAssembly {
  const wall = findAssembly(SPINE_MODULE, `wall-${face}`)
  expect(wall, `wall-${face}`).toBeDefined()
  return wall as ModuleAssembly
}

/**
 * The box parts of an assembly in the PRIMITIVE-local frame (walls and plates
 * are boxes by construction; `assembly.parts` is the builder output, before
 * the module placement — which is what the builders' cut geometry is
 * specified in).
 */
function localBoxParts(assembly: ModuleAssembly): BoxPart[] {
  return assembly.parts.filter((part): part is BoxPart => part.kind === 'box')
}

describe('authored spine module (M2-T6)', () => {
  it('is intact: no integrity problems, and the gate passes', () => {
    expect(moduleProblems(SPINE_MODULE)).toEqual([])
    expect(() => assertModuleIntegrity(SPINE_MODULE)).not.toThrow()
    // No fixture-time contract entry exists for the shaft (the band is
    // implicit per deck — src/validation/contractKit.ts), so the contract diff
    // is empty by construction; the band's real contract is the synthesized
    // socket table, pinned below.
    expect(moduleContractProblems(SPINE_MODULE, CONTRACT_KIT)).toEqual([])
    expect(authoredKitProblems(AUTHORED_MODULES, CONTRACT_KIT)).toEqual([])
  })

  it('declares one deck PITCH of trunk, marked as the shaft band', () => {
    expect(SPINE_MODULE.manifest.id).toBe('spine')
    expect(SPINE_MODULE.shaft).toBe(true)
    expect(SPINE_MODULE.manifest.label).toMatch(/spine/i)
    expect(SPINE_MODULE.manifest.label).toMatch(/ladder/i)
    expect(SPINE_MODULE.manifest.dimensions).toEqual([
      SPINE_SHAFT_HALF_M * 2,
      DECK_PITCH_M,
      SPINE_SHAFT_HALF_M * 2,
    ])
  })

  it('tiles the shaft column floor-to-floor (band height = deck pitch)', () => {
    const height = SPINE_MODULE.manifest.dimensions[1]
    expect(height).toBe(DECK_PITCH_M)
    for (let index = 0; index < 4; index++) {
      // Consecutive bands stack with no gap and no overlap: the floor of deck
      // i+1 plus one band height is exactly the floor of deck i.
      expect(deckFloorYFor(index + 1) + height).toBeCloseTo(deckFloorYFor(index), 9)
    }
    // The shaft column is the fixture layout's canonical spine column.
    expect(SPINE_SHAFT_HALF_M).toBe(SPINE_HALF_M)
    expect(spineAttachOffsetZ('galley')).toBe(SPINE_SHAFT_HALF_M + 2.5)
  })

  it('presents one standard doorway per face, on the shaft’s outer faces', () => {
    const sockets = SPINE_MODULE.manifest.doorSockets
    expect(sockets.map((socket) => socket.id)).toEqual(['+z', '-z', '+x', '-x'])
    for (const socket of sockets) {
      expect(isShaftFace(socket.id), socket.id).toBe(true)
      expect(socket.facing, socket.id).toBe(socket.id)
      expect(isStandardDoorCenter(socket), socket.id).toBe(true)
      expect(socket.position[1], socket.id).toBe(STANDARD_DOOR_CENTER_M)
      expect(doorSizeOf(socket), socket.id).toEqual(STANDARD_DOOR_SIZE)
      // Flush in its own face: ±half on that face's axis, 0 on the other.
      const onX = socket.facing === '+x' || socket.facing === '-x'
      const alongX = onX ? 0 : 2
      const acrossX = onX ? 2 : 0
      expect(socket.position[acrossX], socket.id).toBe(0)
      expect(Math.abs(socket.position[alongX]), socket.id).toBe(SPINE_SHAFT_HALF_M)
    }
    // The shaft never presents the room-facing `spine-door`.
    expect(sockets.some((socket) => socket.id === 'spine-door')).toBe(false)
  })

  it('reproduces the validator’s synthesized per-deck band sockets (cross-pin)', () => {
    // The M1-T3 validator resolves every room's spine-door against the band it
    // synthesizes per deck. The authored shaft must present exactly those
    // sockets, in that order, or a spec that passes validation would assemble
    // onto doorways that are not there.
    const deck: DeckSpec = {
      id: 'deck-0',
      label: 'Cross-pin deck',
      yPosition: 0,
      modules: [],
    }
    const synthesized = spineBandDoors(deck, 0)
    const authored = SPINE_MODULE.manifest.doorSockets
    expect(authored).toHaveLength(synthesized.length)
    synthesized.forEach((band, index) => {
      const socket = authored[index]
      expect(socket.id, band.socketId).toBe(band.socketId)
      expect(socket.position, band.socketId).toEqual(band.center)
      expect(socket.facing, band.socketId).toBe(band.facing)
      expect(doorSizeOf(socket).width, band.socketId).toBe(band.width)
      expect(doorSizeOf(socket).height, band.socketId).toBe(band.height)
    })
    // And the synthesized band is the same column the fixtures attach to.
    expect(synthesized.map((band) => band.socketId)).toEqual([...SHAFT_FACES])
  })

  it('builds its shell tight: the plate hangs a deck-plate below, walls reach the ceiling', () => {
    const shell = SPINE_ASSEMBLIES.filter(
      (assembly) => assembly.id === 'deck-plate' || assembly.id.startsWith('wall-'),
    )
    expect(shell.map((assembly) => assembly.id)).toEqual([
      'deck-plate',
      'wall-+z',
      'wall--z',
      'wall-+x',
      'wall--x',
    ])
    expectBoundsClose(bandBoundsOf(shell), {
      min: [-SPINE_SHAFT_HALF_M, -0.2, -SPINE_SHAFT_HALF_M],
      max: [SPINE_SHAFT_HALF_M, DECK_CLEAR_M, SPINE_SHAFT_HALF_M],
    })
  })

  it('seats each face wall flush inside its own face', () => {
    const expected: Record<string, Aabb3> = {
      '+z': { min: [-0.7, 0, 0.6], max: [0.7, 3, 0.7] },
      '-z': { min: [-0.7, 0, -0.7], max: [0.7, 3, -0.6] },
      '+x': { min: [0.6, 0, -0.7], max: [0.7, 3, 0.7] },
      '-x': { min: [-0.7, 0, -0.7], max: [-0.6, 3, 0.7] },
    }
    for (const face of SHAFT_FACES) {
      expectBoundsClose(assemblyBounds(wallOf(face)), expected[face])
    }
  })

  it('cuts every face wall at its own socket (piers + lintel, opening exact)', () => {
    for (const socket of SPINE_MODULE.manifest.doorSockets) {
      const wall = wallOf(socket.id)
      // Two piers + a lintel: the doorway is bottom-edge-on-floor, so no sill.
      const piers = localBoxParts(wall)
      expect(piers, socket.id).toHaveLength(3)
      const [leftPier, rightPier, lintel] = piers
      expectVecClose(leftPier.size, [0.25, DECK_CLEAR_M, 0.1])
      expectVecClose(rightPier.size, [0.25, DECK_CLEAR_M, 0.1])
      expectVecClose(leftPier.position, [-0.575, 1.5, 0])
      expectVecClose(rightPier.position, [0.575, 1.5, 0])
      // Lintel spans exactly the opening width, from the door head to the top.
      expectVecClose(lintel.size, [0.9, 1, 0.1])
      expectVecClose(lintel.position, [0, 2.5, 0])

      // The hole in the wall is exactly the socket's opening.
      const door = doorSizeOf(socket)
      expect(door).toEqual(STANDARD_DOOR_SIZE)
      const openingWidth = Math.abs(rightPier.position[0] - leftPier.position[0]) - 0.25
      expect(openingWidth, socket.id).toBeCloseTo(door.width, 9)
      expect(lintel.position[1] - lintel.size[1] / 2, socket.id).toBeCloseTo(
        door.height,
        9,
      )
    }
  })

  it('keeps all four doorways clear: no geometry blocks a face (no hatch — M2-T2 seam)', () => {
    // The room owns the hatch on its own spine-door socket; the band authors
    // NO socket filler, so every part of the band must stand clear of all four
    // doorway prisms (the traversal contract for the vertical artery).
    expect(SPINE_ASSEMBLIES.every((assembly) => assembly.fillsSocket !== true)).toBe(
      true,
    )
    expect(SPINE_ASSEMBLIES.some((assembly) => assembly.id.includes('hatch'))).toBe(
      false,
    )
    // Proxy for "no hatch": the hatch primitive is the kit's hazard slot, and
    // the band's geometry draws no hazard (see the slot test below).
    expect(moduleMaterialSlots(SPINE_MODULE)).not.toContain('hazard')

    const prisms = SPINE_MODULE.manifest.doorSockets.map((socket) => ({
      id: socket.id,
      box: doorwayPrism(socket),
    }))
    for (const prism of prisms) {
      for (const assembly of SPINE_ASSEMBLIES) {
        for (const part of assemblyParts(assembly)) {
          expect(
            overlaps(partBounds(part), prism.box),
            `assembly "${assembly.id}" blocks the "${prism.id}" doorway`,
          ).toBe(false)
        }
      }
    }

    // The four doorways are independent: no two prisms intersect (the shaft's
    // free core is 0.9 m square and the prisms stand in front of each face).
    for (let a = 0; a < prisms.length; a++) {
      for (let b = a + 1; b < prisms.length; b++) {
        expect(
          overlaps(prisms[a].box, prisms[b].box),
          `${prisms[a].id} overlaps ${prisms[b].id}`,
        ).toBe(false)
      }
    }
  })

  it('runs the ladder a full deck pitch: rails floor → deck above, ten rungs', () => {
    const ladder = findAssembly(SPINE_MODULE, 'ladder') as ModuleAssembly
    expect(ladder.solid).toBe(true)
    const rails = ladder.parts.filter(
      (part) => part.kind === 'cylinder' && part.axis === 'y',
    )
    const rungs = ladder.parts.filter(
      (part) => part.kind === 'cylinder' && part.axis === 'x',
    )
    expect(rails).toHaveLength(2)
    expect(rungs).toHaveLength(10)

    for (const rail of rails) {
      expect(rail.kind === 'cylinder' && rail.length).toBe(DECK_PITCH_M)
      expect(rail.position[2]).toBe(0)
      expect(Math.abs(rail.position[0])).toBe(
        SPINE_LADDER_PARAMS.width / 2 - SPINE_LADDER_PARAMS.railRadius,
      )
      expect(rail.position[1]).toBe(DECK_PITCH_M / 2)
    }

    // Rungs on a constant 0.3 m pitch from 0.3 to 3.0: the last rung sits one
    // rung pitch below the deck above's floor, so the climb never gaps more
    // than one rung (see the stacked pair test).
    expectVecClose(
      spineRungHeights(),
      [0.3, 0.6, 0.9, 1.2, 1.5, 1.8, 2.1, 2.4, 2.7, 3.0],
    )
    for (const rung of rungs) {
      expect(rung.position[2]).toBe(0)
      expect(rung.kind === 'cylinder' && rung.length).toBe(
        SPINE_LADDER_PARAMS.width - 2 * SPINE_LADDER_PARAMS.railRadius,
      )
    }

    // The run is the only geometry in the band's top 0.2 m (the deck above's
    // plate slab) and it reaches exactly the deck above's floor.
    const bounds = assemblyBounds(ladder)
    expectBoundsClose(bounds, {
      min: [-0.225, 0, -SPINE_LADDER_PARAMS.railRadius],
      max: [0.225, DECK_PITCH_M, SPINE_LADDER_PARAMS.railRadius],
    })
    expect(bounds.max[1]).toBe(moduleBounds(SPINE_MODULE).max[1])
  })

  it('climbs without a gap: a stacked pair’s rungs and deck floors stay one pitch apart', () => {
    // Band 0 on deck 0 (floor Y 0) and band 1 on deck 1 (floor Y −3.2): the
    // rung heights of both bands plus both deck floors, in world Y, are the
    // climb's footholds. Consecutive footholds may never gap more than one
    // rung pitch, or the ladder is unclimbable at a deck boundary.
    const footholds = [
      deckFloorYFor(0),
      deckFloorYFor(1),
      ...spineRungHeights().map((y) => deckFloorYFor(0) + y),
      ...spineRungHeights().map((y) => deckFloorYFor(1) + y),
    ].sort((a, b) => a - b)

    for (let index = 1; index < footholds.length; index++) {
      const gap = footholds[index] - footholds[index - 1]
      expect(gap, `gap ${footholds[index - 1]} → ${footholds[index]}`).toBeGreaterThan(
        0,
      )
      expect(
        gap,
        `gap ${footholds[index - 1]} → ${footholds[index]}`,
      ).toBeLessThanOrEqual(SPINE_LADDER_PARAMS.rungSpacing + 1e-9)
    }
  })

  it('passes the run through the crawl opening in the plate above', () => {
    // The band's plate is the CEILING of the band below (the subfloor slab of
    // its own deck), so the hole has to be here: the band below's ladder must
    // reach the deck's floor through it without touching a plate strip.
    const upper = bandBoxes(SPINE_MODULE, 0)
    const lower = bandBoxes(SPINE_MODULE, 1)
    const upperPlate = upper.find((entry) => entry.id === 'deck-plate')
    const lowerLadder = lower.find((entry) => entry.id === 'ladder')
    expect(upperPlate).toBeDefined()
    expect(lowerLadder).toBeDefined()

    for (const rungOrRail of lowerLadder?.parts ?? []) {
      for (const strip of upperPlate?.parts ?? []) {
        expect(
          overlaps(rungOrRail, strip),
          'the ladder run intersects a deck-plate strip instead of the crawl opening',
        ).toBe(false)
      }
    }

    // The run lands on the deck above's floor, and the upper band's plate
    // underside is exactly the lower band's ceiling plane: the trunk is
    // continuous (band 1's walls end where band 0's plate begins).
    expect(lowerLadder?.bounds.max[1]).toBeCloseTo(deckFloorYFor(0), 9)
    const lowerWall = lower.find((entry) => entry.id === 'wall-+z')
    expect(upperPlate?.bounds.min[1]).toBeCloseTo(lowerWall?.bounds.max[1] ?? NaN, 9)
  })

  it('frames the crawl opening: a 0.7 m hole on the axis, ladder-sized and clear', () => {
    const plate = findAssembly(SPINE_MODULE, 'deck-plate') as ModuleAssembly
    const strips = localBoxParts(plate)
    expect(strips).toHaveLength(4)
    expect(SPINE_CRAWL_OPENING).toEqual({ width: 0.7, depth: 0.7 })

    const expected: Aabb3[] = [
      { min: [-0.7, -0.2, -0.7], max: [-0.35, 0, 0.7] },
      { min: [0.35, -0.2, -0.7], max: [0.7, 0, 0.7] },
      { min: [-0.35, -0.2, -0.7], max: [0.35, 0, -0.35] },
      { min: [-0.35, -0.2, 0.35], max: [0.35, 0, 0.7] },
    ]
    strips.forEach((strip, index) => {
      expectBoundsClose(partBounds(strip), expected[index])
    })

    // Solid area = plate − hole (the M3-T2 watertight accounting).
    const area = strips.reduce((sum, strip) => sum + strip.size[0] * strip.size[2], 0)
    expect(area).toBeCloseTo(
      SPINE_SHAFT_HALF_M * 2 * (SPINE_SHAFT_HALF_M * 2) -
        SPINE_CRAWL_OPENING.width * SPINE_CRAWL_OPENING.depth,
      9,
    )

    // The hole is on the shaft axis, big enough for the climb, and the plate
    // never covers it.
    expectBoundsClose(assemblyBounds(plate), {
      min: [-0.7, -0.2, -0.7],
      max: [0.7, 0, 0.7],
    })
    expect(SPINE_CRAWL_OPENING.width).toBeGreaterThan(
      SPINE_LADDER_PARAMS.width - 2 * SPINE_LADDER_PARAMS.railRadius,
    )
    expect(SPINE_CRAWL_OPENING.width).toBeGreaterThan(
      2 * SPINE_LADDER_PARAMS.railRadius + 0.2,
    )
    const crawlColumn: Aabb3 = {
      min: [-0.35, -0.2, -0.35],
      max: [0.35, 0, 0.35],
    }
    for (const part of assemblyParts(plate)) {
      expect(overlaps(partBounds(part), crawlColumn)).toBe(false)
    }
  })

  it('lights the trunk from practical fixtures only, above the doorway heads', () => {
    const lights = SPINE_MODULE.manifest.lightSockets
    expect(lights.map((light) => light.id)).toEqual([
      'panel-light-fwd',
      'panel-light-aft',
    ])
    expect(new Set(lights.map((light) => light.kind))).toEqual(new Set(['panel']))
    for (const light of lights) {
      const assembly = findAssembly(SPINE_MODULE, light.id)
      expect(assembly, light.id).toBeDefined()
      expect(light.position, light.id).toEqual(assembly?.placement.position)
      // Above every doorway head: the trunk's light is not shadowed by, and
      // does not obstruct, a doorway.
      expect(light.position[1] - 0.03, light.id).toBeGreaterThan(
        STANDARD_DOOR_CENTER_M + STANDARD_DOOR_SIZE.height / 2,
      )
    }
    // Both lights hang in the free core, clear of the ladder (the climb space),
    // clear of the wall inner faces and outside every doorway prism.
    const ladder = findAssembly(SPINE_MODULE, 'ladder') as ModuleAssembly
    const ladderBounds = assemblyBounds(ladder)
    for (const light of lights) {
      const bounds = assemblyBounds(
        findAssembly(SPINE_MODULE, light.id) as ModuleAssembly,
      )
      expect(Math.abs(bounds.min[2]), light.id).toBeGreaterThan(ladderBounds.max[2])
      expect(Math.abs(bounds.max[2]), light.id).toBeLessThan(SPINE_SHAFT_HALF_M - 0.1)
      for (const socket of SPINE_MODULE.manifest.doorSockets) {
        expect(
          overlaps(bounds, doorwayPrism(socket)),
          `${light.id} vs ${socket.id} doorway`,
        ).toBe(false)
      }
    }
  })

  it('anchors the vertical-navigation fixtures as equipment slots', () => {
    const slots = SPINE_MODULE.manifest.equipmentSlots
    expect(slots.map((slot) => slot.id)).toEqual([
      'ladder',
      'deck-plate',
      'cable-tree-stbd-fwd',
      'cable-tree-port-aft',
    ])
    for (const slot of slots) {
      const assembly = findAssembly(SPINE_MODULE, slot.id)
      expect(assembly, slot.id).toBeDefined()
      expect(slot.position, slot.id).toEqual(assembly?.placement.position)
      expect(slot.rotation ?? 0, slot.id).toBe(assembly?.placement.rotation ?? 0)
    }
  })

  it('draws only from the trunk’s §4 slots', () => {
    expect(moduleMaterialSlots(SPINE_MODULE)).toEqual([
      'deckplate',
      'bulkhead',
      'conduit',
      'panel-light',
    ])
    for (const slot of moduleMaterialSlots(SPINE_MODULE)) {
      expect(MATERIAL_SLOTS).toContain(slot)
    }
  })

  it('hangs its cable trees in the free diagonal corners, clear of the doorways', () => {
    for (const id of ['cable-tree-stbd-fwd', 'cable-tree-port-aft']) {
      const tree = findAssembly(SPINE_MODULE, id) as ModuleAssembly
      expect(tree.solid, id).toBeUndefined()
      const bounds = assemblyBounds(tree)
      // Vertical run of the band's clear height, hugging a corner: inside the
      // wall inner faces, outside every doorway prism.
      expect(bounds.min[1], id).toBe(0)
      expect(bounds.max[1], id).toBeCloseTo(DECK_CLEAR_M, 9)
      expect(bounds.max[0], id).toBeLessThan(SPINE_SHAFT_HALF_M - 0.1)
      expect(bounds.max[2], id).toBeLessThan(SPINE_SHAFT_HALF_M - 0.1)
      for (const socket of SPINE_MODULE.manifest.doorSockets) {
        expect(overlaps(bounds, doorwayPrism(socket)), `${id} vs ${socket.id}`).toBe(
          false,
        )
      }
    }
  })

  it('keeps every assembly inside the declared box (documented allowances only)', () => {
    const box = moduleBounds(SPINE_MODULE)
    expectBoundsClose(box, {
      min: [-0.7, 0, -0.7],
      max: [0.7, DECK_PITCH_M, 0.7],
    })
    for (const assembly of SPINE_ASSEMBLIES) {
      const bounds = assemblyBounds(assembly)
      expect(bounds.min[0], assembly.id).toBeGreaterThanOrEqual(box.min[0] - 1e-9)
      expect(bounds.max[0], assembly.id).toBeLessThanOrEqual(box.max[0] + 1e-9)
      expect(bounds.min[2], assembly.id).toBeGreaterThanOrEqual(box.min[2] - 1e-9)
      expect(bounds.max[2], assembly.id).toBeLessThanOrEqual(box.max[2] + 1e-9)
      expect(bounds.max[1], assembly.id).toBeLessThanOrEqual(box.max[1] + 1e-9)
      // Subfloor allowance is the deck plate's alone (it IS the floor's
      // structure); the ladder is the only run in the box's top 0.2 m.
      if (assembly.id === 'deck-plate') {
        expect(bounds.min[1], assembly.id).toBeCloseTo(-0.2, 9)
      } else {
        expect(bounds.min[1], assembly.id).toBeGreaterThanOrEqual(-1e-9)
      }
      if (assembly.id !== 'ladder') {
        expect(bounds.max[1], assembly.id).toBeLessThanOrEqual(DECK_CLEAR_M + 1e-9)
      }
    }
  })

  it('derives the collision hint from the solid geometry (the climb surface is real)', () => {
    const solidParts = moduleSolidParts(SPINE_MODULE)
    const boxes = moduleCollisionBoxes(SPINE_MODULE)
    // 4 plate strips + 4 walls × (2 piers + lintel) + 12 ladder parts.
    expect(solidParts).toHaveLength(28)
    expect(boxes).toHaveLength(solidParts.length)
    boxes.forEach((box, index) => {
      expectBoundsClose(box, partBounds(solidParts[index]))
    })
    expect(SPINE_MODULE.manifest.collisionHint.boxes).toEqual(boxes)

    // The cables and lights are not hulls; the ladder is (M3-T5 climbs it).
    const hullHeights = boxes.map((box) => box.max[1] - box.min[1])
    expect(Math.max(...hullHeights)).toBeCloseTo(DECK_PITCH_M, 9)
    expect(findAssembly(SPINE_MODULE, 'cable-tree-stbd-fwd')?.solid).toBeUndefined()
    expect(findAssembly(SPINE_MODULE, 'panel-light-fwd')?.solid).toBeUndefined()
  })

  it('rejects a shaft band with a missing, mis-faced or non-standard doorway', () => {
    const missing = cloneSpine()
    missing.manifest.doorSockets = missing.manifest.doorSockets.filter(
      (socket) => socket.id !== '+x',
    )
    expect(moduleProblems(missing)).toContainEqual(
      expect.stringMatching(/shaft needs exactly one "\+x" doorway, found 0/),
    )

    const doubled = cloneSpine()
    doubled.manifest.doorSockets = [
      ...doubled.manifest.doorSockets,
      { id: '+x', position: [0.7, 1, 0], facing: '+x' },
    ]
    expect(moduleProblems(doubled)).toContainEqual(
      expect.stringMatching(/shaft needs exactly one "\+x" doorway, found 2/),
    )

    const misFaced = cloneSpine()
    misFaced.manifest.doorSockets = misFaced.manifest.doorSockets.map((socket) =>
      socket.id === '+z' ? { ...socket, facing: '-z' as const } : socket,
    )
    expect(moduleProblems(misFaced)).toContainEqual(
      expect.stringMatching(/shaft doorway "\+z" faces -z, expected \+z/),
    )

    const stepped = cloneSpine()
    stepped.manifest.doorSockets = stepped.manifest.doorSockets.map((socket) =>
      socket.id === '+z'
        ? { ...socket, position: [0, STANDARD_DOOR_CENTER_M + 0.2, 0.7] as const }
        : socket,
    )
    expect(moduleProblems(stepped)).toContainEqual(
      expect.stringMatching(/shaft doorway "\+z" sits 200.0 mm off the standard/),
    )

    const oddOpening = cloneSpine()
    oddOpening.manifest.doorSockets = oddOpening.manifest.doorSockets.map((socket) =>
      socket.id === '+z' ? { ...socket, door: { width: 0.8, height: 1.6 } } : socket,
    )
    expect(moduleProblems(oddOpening)).toContainEqual(
      expect.stringMatching(/shaft doorway "\+z" opening is 0.8 × 1.6 m/),
    )

    const roomDoor = cloneSpine()
    roomDoor.manifest.doorSockets = [
      ...roomDoor.manifest.doorSockets,
      { id: 'spine-door', position: [0, 1, -0.7], facing: '-z' },
    ]
    expect(moduleProblems(roomDoor)).toContainEqual(
      expect.stringMatching(
        /declares doorway\(s\) spine-door that are not shaft faces/,
      ),
    )
  })

  it('keeps the room rule for modules that are not the shaft', () => {
    // A band without the shaft flag is judged as a room (one spine-door), so
    // the flag is load-bearing, not decoration.
    const unflagged = cloneSpine()
    unflagged.shaft = false
    expect(moduleProblems(unflagged)).toContainEqual(
      expect.stringMatching(/needs exactly one "spine-door" socket, found 0/),
    )
  })
})

/** Local-frame bounds of a set of assemblies (test-local alias). */
function bandBoundsOf(assemblies: readonly ModuleAssembly[]): Aabb3 {
  const boxes = assemblies.map(assemblyBounds)
  return {
    min: [
      Math.min(...boxes.map((box) => box.min[0])),
      Math.min(...boxes.map((box) => box.min[1])),
      Math.min(...boxes.map((box) => box.min[2])),
    ],
    max: [
      Math.max(...boxes.map((box) => box.max[0])),
      Math.max(...boxes.map((box) => box.max[1])),
      Math.max(...boxes.map((box) => box.max[2])),
    ],
  }
}
