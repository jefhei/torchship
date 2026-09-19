/**
 * M3-T1 — assembler tests (BUILD_PLAN M3-T1 "Assembler: stack decks from spec,
 * join modules at door sockets, generate spine run; emit merged per-deck
 * geometry + instanced kit batches").
 *
 * The claims pinned here, in order:
 *  - DECK STACKING: one DeckNode per spec deck, in spec order, at the spec's
 *    floors, with every ref instantiated at the offset + yaw the spec authored
 *    (through the M1-T3 resolver, never a second implementation);
 *  - SPINE RUN: one synthesized shaft band per deck at the deck-local origin,
 *    one full pitch tall, tiling floor-to-floor (no step between decks);
 *  - JOINS: every room lands on its deck's band (one spine join, aligned), side
 *    sockets that join nothing are legal blanks, and a misaligned module-to-
 *    module pair on the QA rig is REPORTED as the misaligned join it is;
 *  - GEOMETRY + INSTANCES: the two emitted halves are a PARTITION of the deck's
 *    placed parts (nothing doubled, nothing dropped), groups are one per §4
 *    slot and canonically ordered, batches are repeated moulds, and every batch
 *    instance's placement reproduces its world part from the mould exactly;
 *  - INTERACTIVES: a door per room door socket (at the socket, yawed to its
 *    facing) and a hatch per socket-sealing hatch (at the same socket, facing
 *    into the room — the yaw inverse of the doorway's);
 *  - COLLISION: the modules' own hints, placed — one box per solid part;
 *  - THE GATE: the three real ships assemble clean, the QA rig needs the
 *    explicit opt-in and comes back with its declared defects named.
 *
 * Counts are COMPUTED from the kit (moduleParts / moduleCollisionBoxes) rather
 * than guessed, so a kit change cannot silently invalidate an expectation.
 */

import { describe, expect, it } from 'vitest'
import { DECK_PITCH_M, MATERIAL_SLOTS, deckFloorYFor } from '../types'
import type { DeckSpec, ShipSpec } from '../types'
import {
  LONG_HAUL_SPEC,
  PATROL_SPEC,
  SCIENCE_SPEC,
  SHIP_FIXTURES,
  STRESS_SPEC,
  atSpine,
  spineAttachOffsetZ,
} from '../fixtures'
import { AUTHORED_KIT, getAuthoredModule } from '../kit/modules/registry'
import { moduleCollisionBoxes, moduleParts } from '../kit/modules/types'
import { placePart } from '../kit/modules/placement'
import { partBounds } from '../kit/parts'
import type { Aabb3 } from '../types'
import { isValidShipSpec, moduleOrigin } from '../validation'
import {
  DEFAULT_MIN_INSTANCES,
  assembleDeck,
  assembleScene,
  assembleShip,
  assertAssemblyClean,
  assemblyProblems,
  facingTurns,
  mouldOf,
  partitionParts,
  placementFor,
  placedPartsOf,
  spineJoinOf,
  spineRun,
  spineRunProblems,
  worldOriginOf,
} from './index'

// ── helpers ────────────────────────────────────────────────────────────────

/** A 3-deck spec with TWO rooms on one deck (the band joined on two faces). */
const TWIN_DECK_SPEC: ShipSpec = {
  classId: 'hound',
  name: 'Twintest',
  registry: 'QA-T1',
  seed: 7,
  decks: [
    {
      id: 'head',
      label: 'Head — bridge',
      yPosition: deckFloorYFor(0),
      modules: [atSpine('head')],
    },
    {
      id: 'crew',
      label: 'Crew — twin galleys',
      yPosition: deckFloorYFor(1),
      modules: [
        atSpine('galley'),
        {
          moduleId: 'galley',
          rotation: 2,
          offset: [0, 0, -spineAttachOffsetZ('galley')],
        },
      ],
    },
    {
      id: 'engineering',
      label: 'Engineering',
      yPosition: deckFloorYFor(2),
      modules: [atSpine('engineering')],
    },
  ],
}

/** Parts one deck's placed modules contribute (rooms + the synthesized band). */
function expectedDeckParts(deck: DeckSpec): number {
  const rooms = deck.modules.reduce(
    (sum, ref) => sum + moduleParts(getAuthoredModule(ref.moduleId)).length,
    0,
  )
  const band = getAuthoredModule('spine')
  return rooms + moduleParts(band).length
}

/** Solid collision boxes one deck's placed modules contribute. */
function expectedDeckBoxes(deck: DeckSpec): number {
  const rooms = deck.modules.reduce(
    (sum, ref) => sum + moduleCollisionBoxes(getAuthoredModule(ref.moduleId)).length,
    0,
  )
  return rooms + moduleCollisionBoxes(getAuthoredModule('spine')).length
}

/** Per-axis closeness for computed coordinates (helpers differ in the last ulp). */
function expectVecClose(actual: readonly number[], expected: readonly number[]): void {
  expect(actual).toHaveLength(expected.length)
  actual.forEach((value, index) => {
    expect(value, `[${index}]`).toBeCloseTo(expected[index], 9)
  })
}

function boundsOf(boxes: readonly Aabb3[]): Aabb3 {
  return {
    min: [0, 1, 2].map((axis) => Math.min(...boxes.map((box) => box.min[axis]))) as [
      number,
      number,
      number,
    ],
    max: [0, 1, 2].map((axis) => Math.max(...boxes.map((box) => box.max[axis]))) as [
      number,
      number,
      number,
    ],
  }
}

// ── deck stacking ──────────────────────────────────────────────────────────

describe('deck stacking (M3-T1)', () => {
  it('stacks one deck node per spec deck, in spec order, at the spec floors', () => {
    const ship = assembleShip(PATROL_SPEC)
    expect(ship.graph.decks).toHaveLength(PATROL_SPEC.decks.length)
    ship.graph.decks.forEach((node, index) => {
      const deck = PATROL_SPEC.decks[index]
      expect(node.deckId).toBe(deck.id)
      expect(node.deckIndex).toBe(index)
      expect(node.floorY).toBe(deckFloorYFor(index))
      expect(node.floorY).toBe(deck.yPosition)
      expect(ship.decks[index].label).toBe(deck.label)
    })
    expect(ship.graph.decks[0].floorY).toBe(0)
    expect(ship.graph.decks[4].floorY).toBe(-12.8)
  })

  it('echoes the ship identity onto the graph', () => {
    const ship = assembleShip(PATROL_SPEC)
    expect(ship.graph.ship).toEqual({
      classId: 'hound',
      name: 'Firebrand',
      registry: 'HCS-427',
      seed: 1,
    })
    expect(assembleScene(LONG_HAUL_SPEC).ship.name).toBe('Vagabond')
  })

  it('instantiates every spec ref at the authored offset + yaw (shared resolver)', () => {
    for (const spec of [PATROL_SPEC, LONG_HAUL_SPEC, SCIENCE_SPEC]) {
      const ship = assembleShip(spec)
      for (const deck of ship.decks) {
        const deckSpec = spec.decks[deck.deckIndex]
        const rooms = deck.modules.filter((owner) => !owner.band)
        expect(rooms).toHaveLength(deckSpec.modules.length)
        rooms.forEach((owner, index) => {
          const ref = deckSpec.modules[index]
          expect(owner.source).toEqual({
            deckId: deckSpec.id,
            moduleId: ref.moduleId,
            moduleIndex: index,
          })
          expect(owner.module.manifest.id).toBe(ref.moduleId)
          expect(owner.rotation).toBe(ref.rotation)
          expectVecClose(owner.origin, moduleOrigin(ref, deckSpec))
          expectVecClose(owner.origin, worldOriginOf(ref, deckSpec))
          expect(owner.parts).toHaveLength(moduleParts(owner.module).length)
        })
      }
    }
  })

  it('synthesizes exactly one shaft band per deck at the deck-local origin', () => {
    const ship = assembleShip(PATROL_SPEC)
    const runs = spineRun(PATROL_SPEC)
    ship.decks.forEach((deck, index) => {
      const bands = deck.modules.filter((owner) => owner.band)
      expect(bands).toHaveLength(1)
      const band = bands[0]
      expect(band).toBe(deck.band)
      expect(band.module.manifest.id).toBe('spine')
      expect(band.source).toEqual({
        deckId: PATROL_SPEC.decks[index].id,
        moduleId: 'spine',
        moduleIndex: -1,
      })
      expectVecClose(band.origin, [0, deck.floorY, 0])
      expect(band.rotation).toBe(0)
      expectVecClose(runs[index].position, [0, deck.floorY, 0])
      expect(runs[index].deckIndex).toBe(index)
      expect(runs[index].deckId).toBe(deck.deckId)
      // The spec never references the trunk: the band is not a spec ref.
      expect(
        PATROL_SPEC.decks[index].modules.some((ref) => ref.moduleId === 'spine'),
      ).toBe(false)
    })
    expect(ship.spineRun).toHaveLength(PATROL_SPEC.decks.length)
  })

  it('generates a continuous run: bands tile at the deck pitch', () => {
    for (const spec of [PATROL_SPEC, LONG_HAUL_SPEC, SCIENCE_SPEC]) {
      expect(spineRunProblems(spec)).toEqual([])
      const runs = spineRun(spec)
      for (let i = 1; i < runs.length; i++) {
        // Each band's top IS the floor above: the run has no step between decks.
        expect(runs[i].floorY + DECK_PITCH_M).toBeCloseTo(runs[i - 1].floorY, 9)
      }
      // …and a broken pitch is caught.
      const broken: ShipSpec = {
        ...spec,
        decks: spec.decks.map((deck, index) =>
          index === 2 ? { ...deck, yPosition: deck.yPosition + 0.05 } : deck,
        ),
      }
      expect(spineRunProblems(broken).join(' ')).toMatch(/steps 50\.0 mm/)
    }
  })

  it('the band instance is one full pitch tall: it spans floor to next floor', () => {
    const ship = assembleShip(PATROL_SPEC)
    for (const deck of ship.decks) {
      const bounds = boundsOf(deck.band.parts.map((entry) => partBounds(entry.part)))
      // The band's plate slab hangs below its floor plane (it IS the plate the
      // deck above stands on); the band's top is the structure plane.
      expect(bounds.min[1]).toBeCloseTo(deck.floorY - 0.2, 9)
      expect(bounds.max[1]).toBeCloseTo(deck.floorY + DECK_PITCH_M, 9)
      expect(bounds.min[0]).toBeCloseTo(-0.7, 9)
      expect(bounds.max[0]).toBeCloseTo(0.7, 9)
      expect(bounds.min[2]).toBeCloseTo(-0.7, 9)
      expect(bounds.max[2]).toBeCloseTo(0.7, 9)
    }
  })
})

// ── joins at door sockets ─────────────────────────────────────────────────

describe('joins at door sockets', () => {
  it('every room lands on its deck band: one aligned spine join per room', () => {
    for (const spec of [PATROL_SPEC, LONG_HAUL_SPEC, SCIENCE_SPEC]) {
      const ship = assembleShip(spec)
      for (const deck of ship.decks) {
        const rooms = deck.modules.filter((owner) => !owner.band)
        const spineJoins = deck.joins.filter((join) => join.kind === 'spine')
        expect(spineJoins).toHaveLength(rooms.length)
        for (const room of rooms) {
          const join = spineJoinOf(room, deck.joins)
          expect(join).toBeDefined()
          expect(join?.aligned).toBe(true)
          expect(join?.normalMm).toBe(0)
          expect(join?.lateralMm).toBe(0)
          expect(join?.verticalMm).toBe(0)
          // The band socket is the reference; the room owns the other side.
          expect(join?.a.moduleIndex).toBe(-1)
          expect(join?.a.moduleId).toBe('spine')
          expect(join?.b.moduleIndex).toBe(room.source.moduleIndex)
          expect(join?.b.socketId).toBe('spine-door')
          // The room's spine-door faces the shaft (−z); the band socket it lands
          // on faces the room (+z) and is the join's reference door.
          expect(join?.b.facing).toBe('-z')
          expect(join?.a.facing).toBe('+z')
        }
      }
    }
  })

  it('canonical ships form no module-to-module mates (every side socket is blank)', () => {
    for (const spec of [PATROL_SPEC, LONG_HAUL_SPEC, SCIENCE_SPEC]) {
      const ship = assembleShip(spec)
      for (const deck of ship.decks) {
        expect(deck.joins.filter((join) => join.kind === 'module')).toEqual([])
      }
    }
  })

  it('reports unjoined sockets as legal blanks, never as joins', () => {
    const ship = assembleShip(PATROL_SPEC)
    for (const deck of ship.decks) {
      const allDoors = deck.modules.reduce((sum, owner) => sum + owner.doors.length, 0)
      // Blanks + both sides of every join must account for every socket.
      expect(deck.blanks.length + 2 * deck.joins.length).toBe(allDoors)
      // The band's unjoined faces and each room's side door are blanked.
      const bandBlanks = deck.blanks.filter((door) => door.moduleIndex === -1)
      expect(bandBlanks).toHaveLength(3)
      const roomBlanks = deck.blanks.filter((door) => door.moduleIndex !== -1)
      const sideDoors = deck.modules
        .filter((owner) => !owner.band)
        .flatMap((owner) => owner.doors)
        .filter((door) => door.socketId !== 'spine-door')
      expect(roomBlanks).toHaveLength(sideDoors.length)
      for (const door of deck.blanks) {
        expect(deck.joins.some((join) => join.a === door || join.b === door)).toBe(
          false,
        )
      }
    }
  })

  it('a misaligned module-to-module pair is reported, not repaired (QA rig)', () => {
    const ship = assembleShip(STRESS_SPEC, { requireValidSpec: false })
    const rig3 = ship.decks[3]
    const mates = rig3.joins.filter((join) => join.kind === 'module')
    expect(mates).toHaveLength(1)
    const [mate] = mates
    expect(mate.aligned).toBe(false)
    expect(mate.verticalMm).toBe(200)
    // `a` is the earlier spec ref (engineering's high-hatch), `b` the later one.
    expect(mate.a.socketId).toBe('high-hatch')
    expect(mate.a.moduleId).toBe('engineering')
    expect(mate.b.socketId).toBe('side-door')
    expect(mate.b.moduleId).toBe('ops')
    // The rig breaks this join deliberately: it is REPORTED, never repaired…
    expect(assemblyProblems(ship).join('\n')).toMatch(/module join .* is off by/)
    // …and the off-spine room is reported as off the run, not quietly re-seated.
    expect(rig3.joins.filter((join) => join.kind === 'spine')).toHaveLength(1)
    expect(assemblyProblems(ship).join('\n')).toMatch(
      /"ops"#1 has no spine join — its spine-door does not land on the band/,
    )
  })

  it('a two-room deck lands on two different band faces', () => {
    expect(isValidShipSpec(TWIN_DECK_SPEC, AUTHORED_KIT)).toBe(true)
    const ship = assembleShip(TWIN_DECK_SPEC)
    const crew = ship.decks[1]
    const rooms = crew.modules.filter((owner) => !owner.band)
    expect(rooms).toHaveLength(2)
    const spineJoins = crew.joins.filter((join) => join.kind === 'spine')
    expect(spineJoins).toHaveLength(2)
    expect(spineJoins.map((join) => join.a.socketId).sort()).toEqual(['+z', '-z'])
    expect(spineJoins.every((join) => join.aligned)).toBe(true)
    expect(crew.joins.filter((join) => join.kind === 'module')).toEqual([])
    expect(assemblyProblems(ship)).toEqual([])
  })

  it('an adjacent deck pitch deviation shows up in the run check only', () => {
    // The run check is the assembled-geometry statement: a 50 mm floor step.
    const wrong: ShipSpec = {
      ...PATROL_SPEC,
      decks: PATROL_SPEC.decks.map((deck, index) =>
        index === 3 ? { ...deck, id: 'engineering', yPosition: -9.55 } : deck,
      ),
    }
    expect(spineRunProblems(wrong).join(' ')).toMatch(/shaft run steps 50\.0 mm/)
  })
})

// ── merged geometry + instanced batches ───────────────────────────────────

describe('merged geometry + instanced batches', () => {
  it('the emitted halves are a partition of every placed part', () => {
    for (const fixture of SHIP_FIXTURES) {
      const ship = assembleShip(fixture.spec, { requireValidSpec: fixture.expectValid })
      for (const deck of ship.decks) {
        // Module geometry (the kit's own parts) plus the seam pass's generated
        // parts: every one of them joins the partition exactly once.
        const modulePartsCount = deck.modules.reduce(
          (sum, owner) => sum + owner.parts.length,
          0,
        )
        expect(modulePartsCount).toBe(
          expectedDeckParts(fixture.spec.decks[deck.deckIndex]),
        )
        const placed = placedPartsOf(deck)
        expect(placed.length).toBe(
          modulePartsCount +
            deck.seams.reduce((sum, plan) => sum + plan.parts.length, 0),
        )
        const grouped = deck.groups.flatMap((plan) => plan.parts)
        const batched = deck.batches.flatMap((plan) => plan.parts)
        expect(grouped.length + batched.length).toBe(placed.length)
        // Exactly once: the two halves are disjoint and cover the part list.
        const seen = new Set([...grouped, ...batched])
        expect(seen.size).toBe(placed.length)
        for (const entry of placed) expect(seen.has(entry)).toBe(true)
        // And the node's plan mirrors the plan's own lists.
        expect(deck.node.geometry).toEqual(deck.groups.map((plan) => plan.group))
        expect(deck.node.instances).toEqual(deck.batches.map((plan) => plan.batch))
      }
    }
  })

  it('groups are one per §4 slot, deck-scoped, canonically ordered, sourced', () => {
    const ship = assembleShip(PATROL_SPEC)
    for (const deck of ship.decks) {
      const slots = deck.groups.map((plan) => plan.group.materialSlot)
      expect(slots).toEqual(MATERIAL_SLOTS.filter((slot) => slots.includes(slot)))
      expect(new Set(slots).size).toBe(slots.length)
      for (const plan of deck.groups) {
        expect(plan.group.id).toBe(`deck-${deck.deckIndex}-${plan.group.materialSlot}`)
        expect(plan.parts.length).toBeGreaterThan(0)
        expect(plan.group.sources.length).toBeGreaterThan(0)
        for (const entry of plan.parts) {
          expect(entry.materialSlot).toBe(plan.group.materialSlot)
        }
        // Sources are the module instances that contributed, rooms then band.
        const owners = plan.parts.map((entry) => entry.source.moduleIndex)
        for (const source of plan.group.sources) {
          expect(owners).toContain(source.moduleIndex)
          expect(source.deckId).toBe(deck.deckId)
        }
      }
    }
  })

  it('batches are repeated moulds: ≥ 2 instances, one shape and slot each', () => {
    const ship = assembleShip(PATROL_SPEC)
    for (const deck of ship.decks) {
      expect(deck.batches.length).toBeGreaterThan(0)
      const ids = new Set<string>()
      deck.batches.forEach((plan, index) => {
        expect(plan.batch.id).toBe(`deck-${deck.deckIndex}-batch-${index + 1}`)
        expect(ids.has(plan.batch.id)).toBe(false)
        ids.add(plan.batch.id)
        expect(plan.parts.length).toBeGreaterThanOrEqual(DEFAULT_MIN_INSTANCES)
        expect(plan.batch.placements).toHaveLength(plan.parts.length)
        expect(plan.batch.materialSlot).toBe(plan.shape.materialSlot)
        expect(plan.batch.pieceId).toBe(plan.shape.id)
        for (const entry of plan.parts) expect(entry.pieceId).toBe(plan.shape.id)
      })
      // A shape drawn once is merged, not instanced.
      const mouldCounts = new Map<string, number>()
      for (const entry of placedPartsOf(deck)) {
        mouldCounts.set(entry.pieceId, (mouldCounts.get(entry.pieceId) ?? 0) + 1)
      }
      for (const plan of deck.batches) {
        expect(mouldCounts.get(plan.batch.pieceId)).toBe(plan.parts.length)
      }
      const grouped = new Set(
        deck.groups.flatMap((plan) => plan.parts.map((entry) => entry.pieceId)),
      )
      for (const pieceId of grouped) {
        expect(mouldCounts.get(pieceId)).toBeLessThan(DEFAULT_MIN_INSTANCES)
      }
    }
  })

  it('every batch instance reconstructs its world part from the mould + placement', () => {
    for (const fixture of SHIP_FIXTURES) {
      const ship = assembleShip(fixture.spec, { requireValidSpec: fixture.expectValid })
      for (const deck of ship.decks) {
        for (const plan of deck.batches) {
          expect(mouldOf(plan.shape).materialSlot).toBe(plan.shape.materialSlot)
          plan.parts.forEach((entry, index) => {
            const placement = plan.batch.placements[index]
            expect(placement).toEqual(placementFor(plan.shape, entry.part))
            const rebuilt = placePart(mouldOf(plan.shape), placement)
            // Exact: the mould + the instance transform ARE the world part.
            expect(rebuilt).toEqual(entry.part)
          })
        }
      }
    }
  })

  it('instances a real repeated shape: the shaft ladder rungs come back as one batch', () => {
    const ship = assembleShip(PATROL_SPEC)
    for (const deck of ship.decks) {
      const rungs = deck.batches.filter(
        (plan) => plan.shape.kind === 'cylinder' && plan.parts.length === 10,
      )
      expect(rungs.length).toBeGreaterThanOrEqual(1)
      const [rungBatch] = rungs
      expect(rungBatch.shape.materialSlot).toBe('bulkhead')
      expect(rungBatch.batch.materialSlot).toBe('bulkhead')
      expect(rungBatch.shape.radius).toBeCloseTo(0.018, 9)
      expect(rungBatch.shape.length).toBeCloseTo(0.39, 9)
      const heights = rungBatch.parts.map((entry) => entry.part.position[1])
      expect(heights[0]).toBeCloseTo(deck.floorY + 0.3, 9)
      expect(heights[9]).toBeCloseTo(deck.floorY + 3.0, 9)
      // The two rails re-axis to Z on this deck… no: the band is unrotated, so
      // its rungs run along X and the mould keeps axis-family 'x'.
      expect(rungBatch.shape.mouldAxis).toBe('x')
      expect(
        rungBatch.batch.placements.every((placement) => placement.rotation === 0),
      ).toBe(true)
    }
  })

  it('a higher minInstances re-partitions without losing or doubling a part', () => {
    const strict = assembleShip(PATROL_SPEC, { minInstances: 6 })
    expect(assemblyProblems(strict, 6)).toEqual([])
    for (const deck of strict.decks) {
      const placed = placedPartsOf(deck).length
      const grouped = deck.groups.flatMap((plan) => plan.parts).length
      const batched = deck.batches.flatMap((plan) => plan.parts).length
      expect(grouped + batched).toBe(placed)
      for (const plan of deck.batches) {
        expect(plan.parts.length).toBeGreaterThanOrEqual(6)
      }
    }
    // Merging the small repeats back into slot groups cuts draw calls further.
    const loose = assembleShip(PATROL_SPEC)
    const calls = (ship: typeof strict): number =>
      ship.decks.reduce(
        (sum, deck) => sum + deck.node.geometry.length + deck.node.instances.length,
        0,
      )
    expect(calls(strict)).toBeLessThan(calls(loose))
  })

  it('is deterministic: two runs produce the same graph and joins', () => {
    const first = assembleShip(PATROL_SPEC)
    const second = assembleShip(PATROL_SPEC)
    expect(second.graph).toEqual(first.graph)
    expect(second.spineRun).toEqual(first.spineRun)
    second.decks.forEach((deck, index) => {
      expect(deck.joins).toEqual(first.decks[index].joins)
      expect(deck.blanks).toEqual(first.decks[index].blanks)
      expect(deck.batches.map((plan) => plan.batch.id)).toEqual(
        first.decks[index].batches.map((plan) => plan.batch.id),
      )
    })
    // …and a single deck assembled alone matches the ship's copy of it.
    const alone = assembleDeck(PATROL_SPEC.decks[1], 1)
    expect(alone.node).toEqual(first.decks[1].node)
  })

  it('partitions a synthetic part list without losing a part', () => {
    const deck = assembleShip(PATROL_SPEC, { minInstances: 3 })
    for (const assembly of deck.decks) {
      const { groups, batches } = partitionParts(
        placedPartsOf(assembly),
        assembly.deckIndex,
        3,
      )
      expect(groups.map((plan) => plan.group.materialSlot)).toEqual(
        assembly.groups.map((plan) => plan.group.materialSlot),
      )
      expect(batches.map((plan) => plan.batch.id)).toEqual(
        assembly.batches.map((plan) => plan.batch.id),
      )
    }
  })
})

// ── interactives ──────────────────────────────────────────────────────────

describe('named interactives', () => {
  it('emits a door per room door socket, at the socket, yawed to its facing', () => {
    const ship = assembleShip(PATROL_SPEC)
    let doors = 0
    for (const deck of ship.decks) {
      const roomDoors = deck.modules
        .filter((owner) => !owner.band)
        .flatMap((owner) => owner.doors)
      const elements = deck.node.interactives.filter(
        (element) => element.kind === 'door',
      )
      expect(elements).toHaveLength(roomDoors.length)
      doors += elements.length
      for (const element of elements) {
        const owner = deck.modules.find(
          (candidate) =>
            candidate.source.moduleId === element.source.moduleId &&
            candidate.source.moduleIndex === element.source.moduleIndex,
        )
        expect(owner).toBeDefined()
        const socket = owner?.doors.find(
          (door) =>
            door.center[0] === element.position[0] &&
            door.center[1] === element.position[1] &&
            door.center[2] === element.position[2],
        )
        expect(socket).toBeDefined()
        expect(element.rotation).toBe(facingTurns(socket?.facing ?? '+z'))
        expect(element.id).toBe(
          `${deck.deckId}-${element.source.moduleIndex}-${element.source.moduleId}-door-${socket?.socketId}`,
        )
      }
    }
    // patrol: head 1 door + galley/ops/engineering/storage 2 each.
    expect(doors).toBe(1 + 2 * 4)
  })

  it('emits a hatch per socket-sealing hatch, at its socket, facing into the room', () => {
    const ship = assembleShip(PATROL_SPEC)
    for (const deck of ship.decks) {
      const hatches = deck.node.interactives.filter(
        (element) => element.kind === 'hatch',
      )
      const fills = deck.modules
        .filter((owner) => !owner.band)
        .flatMap((owner) =>
          owner.module.assemblies
            .filter((assembly) => assembly.fillsSocket === true)
            .map((assembly) => ({ owner, id: assembly.id })),
        )
      expect(hatches).toHaveLength(fills.length)
      for (const element of hatches) {
        // A hatch always sits on a doorway of the same module…
        const door = deck.node.interactives.find(
          (candidate) =>
            candidate.kind === 'door' &&
            candidate.source.moduleIndex === element.source.moduleIndex &&
            candidate.position[0] === element.position[0] &&
            candidate.position[1] === element.position[1] &&
            candidate.position[2] === element.position[2],
        )
        expect(door).toBeDefined()
        // …with the leaf facing INTO the room: the yaw inverse of the doorway's.
        expect(element.rotation).toBe(((door?.rotation ?? 0) + 2) % 4)
        expect(element.id).toMatch(/-hatch-hatch-/)
      }
      // The spine-door doorway always has its hatch (the room seals its own).
      expect(hatches.some((element) => element.id.endsWith('-hatch-hatch-spine'))).toBe(
        true,
      )
    }
  })

  it('keeps interactive ids unique and resolvable, and gives the band no doorway', () => {
    for (const spec of [PATROL_SPEC, LONG_HAUL_SPEC, SCIENCE_SPEC]) {
      const ship = assembleShip(spec)
      const ids = ship.graph.decks.flatMap((node) =>
        node.interactives.map((element) => element.id),
      )
      expect(new Set(ids).size).toBe(ids.length)
      for (const deck of ship.decks) {
        for (const element of deck.node.interactives) {
          // The band never contributes a doorway (the room owns it).
          expect(element.source.moduleIndex).not.toBe(-1)
          const owner = deck.modules.find(
            (candidate) => candidate.source.moduleIndex === element.source.moduleIndex,
          )
          expect(owner?.source.moduleId).toBe(element.source.moduleId)
        }
      }
    }
  })

  it('pins the facing → yaw table the doorway interactives are yawed by', () => {
    expect(
      (['+z', '+x', '-z', '-x'] as const).map((facing) => facingTurns(facing)),
    ).toEqual([0, 1, 2, 3])
  })

  it('names the special case: the engineering high-hatch doorway is non-standard', () => {
    const ship = assembleShip(SCIENCE_SPEC)
    const engineering = ship.decks.find((deck) => deck.deckId === 'engineering')
    const highHatch = engineering?.node.interactives.find(
      (element) => element.kind === 'door' && element.id.includes('high-hatch'),
    )
    expect(highHatch).toBeDefined()
    const socket = engineering?.modules
      .find((owner) => owner.source.moduleId === 'engineering')
      ?.doors.find((door) => door.socketId === 'high-hatch')
    expect(socket).toBeDefined()
    if (socket !== undefined) {
      expect(socket.height).toBe(1.6)
      expect(socket.center[1]).toBe(deckFloorYFor(4) + 1.2)
      expect(highHatch?.position[1]).toBe(socket.center[1])
    }
  })
})

// ── collision hull ────────────────────────────────────────────────────────

describe('per-deck collision hull', () => {
  it('emits one box per solid part of every module instance (rooms + band)', () => {
    for (const fixture of SHIP_FIXTURES) {
      const ship = assembleShip(fixture.spec, { requireValidSpec: fixture.expectValid })
      for (const deck of ship.decks) {
        expect(deck.node.collision.boxes).toHaveLength(
          expectedDeckBoxes(fixture.spec.decks[deck.deckIndex]),
        )
        expect(deck.node.collision.boxes).toEqual(
          deck.modules.flatMap((owner) => owner.boxes),
        )
      }
    }
    const patrol = assembleShip(PATROL_SPEC)
    // head 37 solid parts + the band's 28.
    expect(patrol.decks[0].node.collision.boxes).toHaveLength(37 + 28)
    expect(patrol.decks[4].node.collision.boxes).toHaveLength(102 + 28)
  })

  it('places the hull in world space: the band hull spans the shaft column', () => {
    const ship = assembleShip(PATROL_SPEC)
    for (const deck of ship.decks) {
      const bounds = boundsOf(deck.band.boxes)
      expect(bounds.min[0]).toBeCloseTo(-0.7, 9)
      expect(bounds.max[0]).toBeCloseTo(0.7, 9)
      expect(bounds.min[2]).toBeCloseTo(-0.7, 9)
      expect(bounds.max[2]).toBeCloseTo(0.7, 9)
      expect(bounds.min[1]).toBeCloseTo(deck.floorY - 0.2, 9) // the plate slab
      expect(bounds.max[1]).toBeCloseTo(deck.floorY + DECK_PITCH_M, 9)
      // The room hull sits on the deck floor, beyond the shaft's +z face.
      const room = deck.modules.find((owner) => !owner.band)
      const roomBounds = boundsOf(room?.boxes ?? [])
      expect(roomBounds.min[2]).toBeCloseTo(0.7, 9)
      expect(roomBounds.min[1]).toBeCloseTo(deck.floorY - 0.2, 9)
    }
  })
})

// ── the seam pass (M3-T2) ─────────────────────────────────────────────────

describe('the seam pass rides the assembly (M3-T2)', () => {
  it('gives every deck one seam plan per socket and a clean gate on real ships', () => {
    for (const spec of [PATROL_SPEC, LONG_HAUL_SPEC, SCIENCE_SPEC]) {
      const ship = assembleShip(spec)
      for (const deck of ship.decks) {
        const sockets = deck.modules.reduce((sum, owner) => sum + owner.doors.length, 0)
        expect(deck.seams.length).toBeGreaterThan(0)
        // One plan per socket: joins contribute one plan for their two
        // sockets, blanks one each.
        expect(deck.seams.length).toBe(deck.blanks.length + deck.joins.length)
        expect(deck.seams.length).toBeLessThanOrEqual(sockets)
        for (const plan of deck.seams) {
          expect(plan.deckId).toBe(deck.deckId)
          expect(plan.deckIndex).toBe(deck.deckIndex)
          expect(plan.watertight).toBe(true)
          expect(plan.problems).toEqual([])
          expect(plan.sealedBy).not.toBe('none')
        }
        // The generated parts join the deck's geometry partition.
        const seamParts = deck.seams.reduce((sum, plan) => sum + plan.parts.length, 0)
        expect(placedPartsOf(deck).length).toBe(
          deck.modules.reduce((sum, owner) => sum + owner.parts.length, 0) + seamParts,
        )
      }
      expect(assemblyProblems(ship)).toEqual([])
    }
  })

  it('reports the rig\u2019s open seam from the assembled geometry', () => {
    const rig = assembleShip(STRESS_SPEC, { requireValidSpec: false })
    const rig1 = rig.decks[1]
    const plan = rig1.seams.find((candidate) => candidate.kind === 'spine')
    expect(plan?.gapMm).toBe(10)
    expect(plan?.watertight).toBe(false)
    const report = assemblyProblems(rig).join('\n')
    expect(report).toMatch(/open seam of 10\.0 mm between the mating wall faces/)
    expect(report).toMatch(/the watertight cap is < 2 mm/)
  })
})

// ── the assembly gate ─────────────────────────────────────────────────────

describe('the assembly gate', () => {
  it('the three real ships assemble clean (and assertAssemblyClean agrees)', () => {
    for (const spec of [PATROL_SPEC, LONG_HAUL_SPEC, SCIENCE_SPEC]) {
      const ship = assembleShip(spec)
      expect(assemblyProblems(ship)).toEqual([])
      expect(() => assertAssemblyClean(ship)).not.toThrow()
    }
  })

  it('every canonical fixture assembles; the QA rig needs an explicit opt-in', () => {
    for (const fixture of SHIP_FIXTURES) {
      if (fixture.expectValid) {
        expect(() => assembleShip(fixture.spec)).not.toThrow()
        continue
      }
      expect(() => assembleShip(fixture.spec)).toThrow(/is invalid/)
      const rig = assembleShip(fixture.spec, { requireValidSpec: false })
      const problems = assemblyProblems(rig)
      expect(problems.length).toBeGreaterThan(0)
      const report = problems.join('\n')
      // Every declared STRESS_DEFECTS category is visible in the assembly view:
      // rig-1's 10 mm normal offset, rig-2's 25 mm lateral offset, rig-3's 200 mm
      // door-center step (a module join; its off-spine room is off the run),
      // rig-4's 200 mm floor-pin drift and the 50 mm off-grid floor.
      expect(report).toMatch(
        /deck 1 .*spine join is off by normal 10\.0 \/ lateral 0\.0 \/ vertical 0\.0/,
      )
      expect(report).toMatch(
        /deck 2 .*spine join is off by normal 0\.0 \/ lateral 25\.0 \/ vertical 0\.0/,
      )
      expect(report).toMatch(
        /deck 3 .*module join engineering#0 "high-hatch" ↔ ops#1 "side-door" is off by normal 0\.0 \/ lateral 0\.0 \/ vertical 200\.0/,
      )
      expect(report).toMatch(
        /deck 4 .*spine join is off by normal 0\.0 \/ lateral 0\.0 \/ vertical 200\.0/,
      )
      expect(report).toMatch(/shaft run steps 50\.0 mm/)
      // The rig still assembles: 5 decks, every deck with its band.
      expect(rig.decks).toHaveLength(5)
      expect(rig.decks.every((deck) => deck.band !== undefined)).toBe(true)
    }
  })

  it('a bad module ref, a band ref and a pitch break are all reported or refused', () => {
    const unknown: ShipSpec = {
      ...PATROL_SPEC,
      decks: [
        {
          ...PATROL_SPEC.decks[0],
          modules: [{ moduleId: 'airlock', rotation: 0, offset: [0, 0, 1] }],
        },
      ],
    }
    expect(() => assembleShip(unknown, { requireValidSpec: false })).toThrow(
      /references unknown kit module "airlock"/,
    )
    // A spec that names the shaft is refused by the validator…
    const bandRef: ShipSpec = {
      ...PATROL_SPEC,
      decks: [
        {
          ...PATROL_SPEC.decks[0],
          modules: [
            atSpine('head'),
            { moduleId: 'spine', rotation: 0, offset: [0, 0, 0] },
          ],
        },
        ...PATROL_SPEC.decks.slice(1),
      ],
    }
    // …and, with the gate off, the assembler reports it instead of doubling the band.
    const doubled = assembleShip(bandRef, { requireValidSpec: false })
    expect(assemblyProblems(doubled).join('\n')).toMatch(
      /references the shaft module "spine"/,
    )
    expect(doubled.decks[0].modules.filter((owner) => owner.band)).toHaveLength(1)
  })

  it('refuses to generate a run when the kit has no shaft band', () => {
    const headOnly = [getAuthoredModule('head')]
    expect(() =>
      assembleDeck(PATROL_SPEC.decks[0], 0, {
        modules: headOnly,
        requireValidSpec: false,
      }),
    ).toThrow(/no shaft module/)
    // With the kit derived from the module list, the spec's unknown refs are the
    // validator's finding; the missing run is what the assembler refuses.
    expect(() => assembleShip(PATROL_SPEC, { modules: headOnly })).toThrow(
      /references unknown kit module "galley"/,
    )
  })

  it('carries a JSON-round-trippable scene graph (the exporter walks it)', () => {
    const graph = assembleScene(PATROL_SPEC)
    const roundTripped = JSON.parse(JSON.stringify(graph)) as typeof graph
    expect(roundTripped).toEqual(graph)
    expect(Object.keys(roundTripped.decks[0])).toEqual([
      'deckId',
      'deckIndex',
      'floorY',
      'geometry',
      'instances',
      'interactives',
      'collision',
    ])
  })
})
