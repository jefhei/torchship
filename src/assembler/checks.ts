/**
 * M3-T1 — the assembler's own consistency gate.
 *
 * Rules, not shapes (the repo's harness posture, same as the M0-T6 invariant
 * harness, the M1-T3 validator and the M2-T7 kit harness): `assemblyProblems`
 * never throws, it returns human-readable strings so a report can list every
 * finding at once; `assertAssemblyClean` is the throwing form for callers that
 * want a gate.
 *
 * What it checks is the assembler's OWN contract — that its output is a
 * faithful, complete rendering of the spec and the kit:
 *
 *  - the graph is the spec: one deck node per deck (order, id, index, floor),
 *    the ship identity, and every spec ref instantiated at the offset the spec
 *    authored (through the same resolver the validator used);
 *  - the spine run is generated: exactly one shaft band per deck, at the
 *    deck-local origin, tiling at the deck pitch (spineRunProblems), and no
 *    spec ref names the shaft (the trunk is implicit per deck);
 *  - the geometry partition is a partition: every placed part appears exactly
 *    once — in one batch placement or in one slot group — groups are single-slot
 *    and canonically ordered, batch ids are unique and each batch holds at least
 *    the default minimum of instances, and each instance's placement + mould
 *    reproduces its world part;
 *  - the interactives are resolvable: ids unique across the ship, sources point
 *    at real module instances, every 'door' sits at its socket and every 'hatch'
 *    sits at the socket it seals with the hatch's own yaw;
 *  - the hull is the modules' own: one box per solid part of every module
 *    instance (rooms + band), finite, non-degenerate, and inside the module's
 *    world bounds within the same structural allowances the M2 gate uses;
 *  - every room lands on the spine (its `spine-door` is in a spine join), and
 *    every join it forms is within the M0-T2 hatch cap — a misaligned join is
 *    reported, not repaired (the validator is the accept/reject gate; this is
 *    the assembled-ship view M3-T2 needs).
 */

import type { Aabb3, DeckNode, MaterialSlot } from '../types'
import { MATERIAL_SLOTS } from '../types'
import { partBounds } from '../kit/parts'
import { moduleBounds, moduleCollisionBoxes } from '../kit/modules/types'
import { placePart } from '../kit/modules/placement'
import { SEAM_TOLERANCES } from '../spikes/seams/tolerances'
import { DEFAULT_MIN_INSTANCES, mouldOf, placementFor } from './batches'
import { spineJoinOf } from './joins'
import { boxContains, isWellFormedBox, transformAabb, worldOriginOf } from './place'
import { spineRunProblems } from './spineRun'
import type { DeckAssembly, PlacedModule, ShipAssembly } from './types'

/** Deconstructed allowance constants — the M2 gate's two structural exemptions. */
const SUBFLOOR_TOLERANCE_M = 0.2
const SOCKET_STRADDLE_M = 0.05

/** Numeric slack for "do these two numbers agree" checks, meters. */
const MATCH_EPS_M = 1e-6

function sameVec(
  a: readonly number[],
  b: readonly number[],
  eps = MATCH_EPS_M,
): boolean {
  return a.every((value, axis) => Math.abs(value - b[axis]) <= eps)
}

/** The module's world bounds box (its declared box, placed). */
function worldModuleBounds(owner: PlacedModule): Aabb3 {
  return transformAabb(moduleBounds(owner.module), owner.origin, owner.rotation)
}

/** Every part of one deck's placed modules (the assembler's part input). */
function deckParts(assembly: DeckAssembly): number {
  return assembly.modules.reduce((sum, owner) => sum + owner.parts.length, 0)
}

/**
 * Every problem in an assembled ship. Empty = the assembly faithfully renders
 * the spec and the kit. `ship` is the assembler's output (the spec it was
 * built from is `ship.spec`).
 */
export function assemblyProblems(
  ship: ShipAssembly,
  minInstances: number = DEFAULT_MIN_INSTANCES,
): string[] {
  const problems: string[] = []
  const { spec, graph } = ship

  // 1. Identity echoes the spec (the exporter's self-describing output).
  if (
    graph.ship.classId !== spec.classId ||
    graph.ship.name !== spec.name ||
    graph.ship.registry !== spec.registry ||
    graph.ship.seed !== spec.seed
  ) {
    problems.push(
      `graph ship identity {${graph.ship.classId}/${graph.ship.name}/${graph.ship.registry}/seed ${graph.ship.seed}} ` +
        `does not echo the spec {${spec.classId}/${spec.name}/${spec.registry}/seed ${spec.seed}}`,
    )
  }

  // 2. Deck stacking.
  if (graph.decks.length !== spec.decks.length) {
    problems.push(
      `graph has ${graph.decks.length} deck node(s) for ${spec.decks.length} spec deck(s)`,
    )
  }
  if (graph.decks.length !== ship.decks.length) {
    problems.push('graph deck nodes and deck assemblies are out of step')
  }

  for (const assembly of ship.decks) {
    const { node, deckIndex, deckId } = assembly
    const deck = spec.decks[deckIndex]
    const where = `deck ${deckIndex} ("${deckId}")`
    if (deck === undefined) {
      problems.push(`${where}: deck assembly has no spec deck`)
      continue
    }
    if (node.deckId !== deck.id) {
      problems.push(`${where}: node.deckId is "${node.deckId}", spec says "${deck.id}"`)
    }
    if (node.deckIndex !== deckIndex) {
      problems.push(
        `${where}: node.deckIndex is ${node.deckIndex}, expected ${deckIndex}`,
      )
    }
    if (graph.decks[deckIndex] !== node) {
      problems.push(`${where}: the deck node is not the graph's deck ${deckIndex}`)
    }
    if (Math.abs(node.floorY - deck.yPosition) > MATCH_EPS_M) {
      problems.push(
        `${where}: floorY ${node.floorY} m does not match the spec floor ${deck.yPosition} m`,
      )
    }

    // 3. The spine run: one band per deck, at the deck-local origin.
    const bands = assembly.modules.filter((owner) => owner.band)
    if (bands.length !== 1) {
      problems.push(
        `${where}: ${bands.length} shaft band(s) — the run needs exactly one per deck`,
      )
    }
    const run = ship.spineRun[deckIndex]
    if (run === undefined) {
      problems.push(`${where}: the spine run has no band for this deck`)
    } else if (!sameVec(run.position, [0, deck.yPosition, 0]) || run.rotation !== 0) {
      problems.push(
        `${where}: the spine band is placed at [${run.position.join(', ')}] rot ${run.rotation}, ` +
          `expected the deck-local origin [0, ${deck.yPosition}, 0] rot 0`,
      )
    }

    // 4. Every spec ref is instantiated as authored, and the refs do not name a band.
    const rooms = assembly.modules.filter((owner) => !owner.band)
    if (rooms.length !== deck.modules.length) {
      problems.push(
        `${where}: ${rooms.length} room instance(s) for ${deck.modules.length} spec ref(s)`,
      )
    }
    deck.modules.forEach((ref, index) => {
      const owner = rooms[index]
      if (owner === undefined) return
      if (
        owner.source.moduleId !== ref.moduleId ||
        owner.source.moduleIndex !== index
      ) {
        problems.push(
          `${where}: ref ${index} is "${ref.moduleId}" but the instance is ` +
            `"${owner.source.moduleId}"#${owner.source.moduleIndex}`,
        )
      }
      if (owner.rotation !== ref.rotation) {
        problems.push(
          `${where}: ref ${index} ("${ref.moduleId}") is yawed ${owner.rotation}, spec says ${ref.rotation}`,
        )
      }
      const expectedOrigin = worldOriginOf(ref, deck)
      if (!sameVec(owner.origin, expectedOrigin)) {
        problems.push(
          `${where}: ref ${index} ("${ref.moduleId}") sits at [${owner.origin.join(', ')}], ` +
            `spec offset resolves to [${expectedOrigin.join(', ')}]`,
        )
      }
    })
    if (deck.modules.some((ref) => ref.moduleId === assembly.band.source.moduleId)) {
      problems.push(
        `${where}: the spec references the shaft module "${assembly.band.source.moduleId}" — ` +
          `the trunk is implicit per deck (the assembler synthesizes it)`,
      )
    }

    // 5. The geometry partition is a partition.
    const placedCount = deckParts(assembly)
    const groupedCount = assembly.groups.reduce(
      (sum, plan) => sum + plan.parts.length,
      0,
    )
    const batchedCount = assembly.batches.reduce(
      (sum, plan) => sum + plan.parts.length,
      0,
    )
    if (groupedCount + batchedCount !== placedCount) {
      problems.push(
        `${where}: ${groupedCount} merged + ${batchedCount} instanced part(s) account for ` +
          `${groupedCount + batchedCount} of the ${placedCount} placed part(s)`,
      )
    }
    if (node.geometry.length !== assembly.groups.length) {
      problems.push(
        `${where}: node.geometry has ${node.geometry.length} group(s), plan has ${assembly.groups.length}`,
      )
    }
    if (node.instances.length !== assembly.batches.length) {
      problems.push(
        `${where}: node.instances has ${node.instances.length} batch(es), plan has ${assembly.batches.length}`,
      )
    }
    node.geometry.forEach((group, index) => {
      const plan = assembly.groups[index]
      if (plan === undefined || group !== plan.group) {
        problems.push(`${where}: geometry group ${index} is not the plan's group`)
        return
      }
      if (!(MATERIAL_SLOTS as readonly MaterialSlot[]).includes(group.materialSlot)) {
        problems.push(
          `${where}: geometry group "${group.id}" uses unknown slot "${group.materialSlot}"`,
        )
      }
      if (group.id !== `deck-${deckIndex}-${group.materialSlot}`) {
        problems.push(`${where}: geometry group id "${group.id}" is not deck-scoped`)
      }
      if (group.sources.length === 0) {
        problems.push(`${where}: geometry group "${group.id}" names no source module`)
      }
      if (plan.parts.length === 0) {
        problems.push(`${where}: geometry group "${group.id}" merges no parts`)
      }
      for (const entry of plan.parts) {
        if (entry.materialSlot !== group.materialSlot) {
          problems.push(
            `${where}: geometry group "${group.id}" merges a ${entry.materialSlot} part`,
          )
        }
      }
    })
    const groupSlots = assembly.groups.map((plan) => plan.group.materialSlot)
    const canonical = MATERIAL_SLOTS.filter((slot) => groupSlots.includes(slot))
    if (groupSlots.join(',') !== canonical.join(',')) {
      problems.push(
        `${where}: geometry groups are not in §4 slot order (${groupSlots.join(', ')})`,
      )
    }
    const batchIds = new Set<string>()
    assembly.batches.forEach((plan, index) => {
      const { batch } = plan
      if (batchIds.has(batch.id)) {
        problems.push(`${where}: batch id "${batch.id}" is duplicated`)
      }
      batchIds.add(batch.id)
      if (node.instances[index] !== batch) {
        problems.push(`${where}: instance batch ${index} is not the plan's batch`)
      }
      if (batch.placements.length !== plan.parts.length) {
        problems.push(
          `${where}: batch "${batch.id}" has ${batch.placements.length} placement(s) for ` +
            `${plan.parts.length} part(s)`,
        )
      }
      if (batch.placements.length < minInstances) {
        problems.push(
          `${where}: batch "${batch.id}" instances ${batch.placements.length} part(s) — ` +
            `below the ${minInstances} needed to beat merging`,
        )
      }
      if (batch.pieceId !== plan.shape.id) {
        problems.push(
          `${where}: batch "${batch.id}" names piece "${batch.pieceId}", mould is "${plan.shape.id}"`,
        )
      }
      if (batch.materialSlot !== plan.shape.materialSlot) {
        problems.push(
          `${where}: batch "${batch.id}" slot "${batch.materialSlot}" is not its mould's "${plan.shape.materialSlot}"`,
        )
      }
      plan.parts.forEach((entry, placement) => {
        if (entry.part.materialSlot !== plan.shape.materialSlot) {
          problems.push(
            `${where}: batch "${batch.id}" instances a ${entry.part.materialSlot} part`,
          )
        }
        const transform = placementFor(plan.shape, entry.part)
        const rebuilt = placePart(mouldOf(plan.shape), transform)
        const bounds = partBounds(rebuilt)
        const expected = partBounds(entry.part)
        if (
          !sameVec(bounds.min, expected.min, 1e-9) ||
          !sameVec(bounds.max, expected.max, 1e-9)
        ) {
          problems.push(
            `${where}: batch "${batch.id}" placement ${placement} does not reproduce its part ` +
              `(mould + transform ≠ world part)`,
          )
        }
      })
    })

    // 6. Interactives.
    const interactiveIds = new Set<string>()
    for (const element of node.interactives) {
      if (interactiveIds.has(element.id)) {
        problems.push(`${where}: interactive id "${element.id}" is duplicated`)
      }
      interactiveIds.add(element.id)
      const owner = assembly.modules.find(
        (candidate) =>
          candidate.source.moduleId === element.source.moduleId &&
          candidate.source.moduleIndex === element.source.moduleIndex,
      )
      if (owner === undefined) {
        problems.push(
          `${where}: interactive "${element.id}" names module "${element.source.moduleId}"#${element.source.moduleIndex}, which is not on this deck`,
        )
        continue
      }
      if (element.kind === 'door') {
        if (!owner.doors.some((door) => sameVec(door.center, element.position, 1e-9))) {
          problems.push(
            `${where}: door interactive "${element.id}" is not at one of its module's door sockets`,
          )
        }
      } else if (element.kind === 'hatch') {
        const socket = owner.doors.find((door) =>
          sameVec(door.center, element.position, 1e-9),
        )
        if (socket === undefined) {
          problems.push(
            `${where}: hatch interactive "${element.id}" is not on a door socket of its module`,
          )
        }
      }
    }
    const roomDoors = assembly.modules
      .filter((owner) => !owner.band)
      .reduce((sum, owner) => sum + owner.doors.length, 0)
    const doorInteractives = node.interactives.filter(
      (element) => element.kind === 'door',
    ).length
    if (doorInteractives !== roomDoors) {
      problems.push(
        `${where}: ${doorInteractives} door interactive(s) for ${roomDoors} room door socket(s)`,
      )
    }
    const hatchFills = assembly.modules
      .filter((owner) => !owner.band)
      .reduce(
        (sum, owner) =>
          sum +
          owner.module.assemblies.filter((assembly) => assembly.fillsSocket === true)
            .length,
        0,
      )
    const hatchInteractives = node.interactives.filter(
      (element) => element.kind === 'hatch',
    ).length
    if (hatchInteractives !== hatchFills) {
      problems.push(
        `${where}: ${hatchInteractives} hatch interactive(s) for ${hatchFills} socket-sealing hatch(es) ` +
          `— a hatch that does not pair with a socket is unauthored geometry`,
      )
    }

    // 7. The collision hull is the modules' own hints, placed.
    const expectedBoxes = assembly.modules.reduce(
      (sum, owner) => sum + moduleCollisionBoxes(owner.module).length,
      0,
    )
    if (node.collision.boxes.length !== expectedBoxes) {
      problems.push(
        `${where}: collision hull has ${node.collision.boxes.length} box(es) for ${expectedBoxes} ` +
          `solid part(s) across its modules`,
      )
    }
    for (const owner of assembly.modules) {
      const bounds = worldModuleBounds(owner)
      for (const box of owner.boxes) {
        if (!isWellFormedBox(box)) {
          problems.push(
            `${where}: module "${owner.source.moduleId}"#${owner.source.moduleIndex} has a degenerate collision box`,
          )
          break
        }
        if (!boxContains(bounds, box, SOCKET_STRADDLE_M)) {
          // The deck plate hangs below the floor plane and hatch hardware
          // straddles its socket plane — the M2 gate's own allowances.
          const relaxed: Aabb3 = {
            min: [bounds.min[0], bounds.min[1] - SUBFLOOR_TOLERANCE_M, bounds.min[2]],
            max: [
              bounds.max[0] + SOCKET_STRADDLE_M,
              bounds.max[1] + SOCKET_STRADDLE_M,
              bounds.max[2] + SOCKET_STRADDLE_M,
            ],
          }
          if (!boxContains(relaxed, box, SOCKET_STRADDLE_M)) {
            problems.push(
              `${where}: module "${owner.source.moduleId}"#${owner.source.moduleIndex} has a ` +
                `collision box outside its own world bounds`,
            )
            break
          }
        }
      }
    }

    // 8. Joins: every room lands on the spine; every join is aligned.
    for (const owner of assembly.modules) {
      if (owner.band) continue
      const join = spineJoinOf(owner, assembly.joins)
      if (join === undefined) {
        problems.push(
          `${where}: module "${owner.source.moduleId}"#${owner.source.moduleIndex} has no spine ` +
            `join — its spine-door does not land on the band (the deck is off the run)`,
        )
      } else if (!join.aligned) {
        problems.push(
          `${where}: "${owner.source.moduleId}#${owner.source.moduleIndex}" spine join is off by ` +
            `normal ${join.normalMm.toFixed(1)} / lateral ${join.lateralMm.toFixed(1)} / ` +
            `vertical ${join.verticalMm.toFixed(1)} mm; cap ${SEAM_TOLERANCES.hatchAlignMm} mm`,
        )
      }
    }
    for (const join of assembly.joins) {
      if (join.aligned || join.kind === 'spine') continue
      problems.push(
        `${where}: module join ${join.a.moduleId}#${join.a.moduleIndex} "${join.a.socketId}" ↔ ` +
          `${join.b.moduleId}#${join.b.moduleIndex} "${join.b.socketId}" is off by normal ` +
          `${join.normalMm.toFixed(1)} / lateral ${join.lateralMm.toFixed(1)} / vertical ` +
          `${join.verticalMm.toFixed(1)} mm; cap ${SEAM_TOLERANCES.hatchAlignMm} mm`,
      )
    }
  }

  // 9. The generated run tiles (the vertical half of §8 bullet 3).
  problems.push(...spineRunProblems(spec))

  return problems
}

/** Deck node ids for a ship, deck order (export/QA helper). */
export function deckNodeIds(graph: { decks: DeckNode[] }): string[] {
  return graph.decks.map((node) => node.deckId)
}

/** The assembly gate: throws (listing every problem) on an unfaithful assembly. */
export function assertAssemblyClean(
  ship: ShipAssembly,
  minInstances: number = DEFAULT_MIN_INSTANCES,
): void {
  const problems = assemblyProblems(ship, minInstances)
  if (problems.length > 0) {
    throw new Error(
      `assembly "${ship.spec.name}" is not clean:\n- ${problems.join('\n- ')}`,
    )
  }
}
