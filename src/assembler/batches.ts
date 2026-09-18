/**
 * M3-T1 — per-deck geometry partition: merged groups + instanced batches.
 *
 * BUILD_PLAN M3-T1 asks the assembler to "emit merged per-deck geometry +
 * instanced kit batches". Those are the two halves of ONE partition of the
 * deck's kit parts, so no part is ever drawn twice and none is dropped:
 *
 *  - a part whose MOULD shape repeats `minInstances` (default 2) or more times
 *    on the deck becomes a placement in an `InstanceBatch` — one instanced
 *    mesh, one draw call, N transforms;
 *  - every other part merges into its material slot's `GeometryGroup` — one
 *    merged mesh per slot, one draw call.
 *
 * The mould is the shape minus its orientation, because a quarter-turn yaw is
 * a legal instance transform:
 *
 *  - boxes are moulded axis-aligned — the box's own yaw (composed with the
 *    module's) rides in `placement.rotation`;
 *  - cylinders are moulded along an axis: 'y' stays 'y' (a yaw about +Y cannot
 *    re-axis it), while the XZ pair is moulded along 'x' and re-axed by a
 *    quarter-turn yaw. That is why the shape key keeps the axis FAMILY
 *    (y vs xz) but not the axis itself, and why `placementFor` computes the
 *    yaw FROM the mould to the world part rather than reusing the module's.
 *
 * `mouldOf(shape)` is the canonical geometry a renderer builds once per batch;
 * `placePart(mouldOf(shape), placementFor(shape, part))` reproduces the world
 * part exactly (pinned by assembler tests) — that identity is the contract
 * between this partition and M3-T7's instancing pass.
 *
 * Key strings use `String(number)`, which is exact and locale-independent, so
 * two shapes that differ in the last ulp can never collide into one batch
 * (the sizes come from the parametric builders, e.g. `(1.4 − 0.9) / 2`).
 */

import { MATERIAL_SLOTS } from '../types'
import type { GeometryGroup, Transform3 } from '../types'
import type { KitPart } from '../kit/types'
import type { BatchPlan, GroupPlan, PieceShape, PlacedPart } from './types'

/** Default minimum occurrences for a mould to be instanced rather than merged. */
export const DEFAULT_MIN_INSTANCES = 2

/** Exact, locale-independent number rendering for the canonical shape keys. */
function num(value: number): string {
  return String(value)
}

/**
 * The mould shape of a part: its geometry minus its orientation (see the
 * header). Two parts share a `PieceShape` iff one is a yawed copy of the other.
 */
export function pieceShapeOf(part: KitPart): PieceShape {
  if (part.kind === 'box') {
    const [x, y, z] = part.size
    return {
      id: `box:${part.materialSlot}:${num(x)}x${num(y)}x${num(z)}`,
      kind: 'box',
      materialSlot: part.materialSlot,
      size: [x, y, z],
    }
  }
  const mouldAxis = part.axis === 'y' ? 'y' : 'x'
  return {
    id: `cyl:${part.materialSlot}:r${num(part.radius)}xl${num(part.length)}:${mouldAxis}`,
    kind: 'cylinder',
    materialSlot: part.materialSlot,
    radius: part.radius,
    length: part.length,
    mouldAxis,
  }
}

/**
 * The canonical geometry of a batch: the mould placed at the origin in its own
 * frame. A renderer builds this mesh once and draws every placement from it.
 */
export function mouldOf(shape: PieceShape): KitPart {
  if (shape.kind === 'box') {
    if (shape.size === undefined) {
      throw new Error(`mouldOf: box shape "${shape.id}" has no size`)
    }
    return {
      kind: 'box',
      materialSlot: shape.materialSlot,
      size: shape.size,
      position: [0, 0, 0],
    }
  }
  if (shape.radius === undefined || shape.length === undefined) {
    throw new Error(`mouldOf: cylinder shape "${shape.id}" has no radius/length`)
  }
  return {
    kind: 'cylinder',
    materialSlot: shape.materialSlot,
    radius: shape.radius,
    length: shape.length,
    axis: shape.mouldAxis ?? 'y',
    position: [0, 0, 0],
  }
}

/** The quarter-turn yaw that turns `from` (the mould axis) onto `to` (the world axis). */
function yawBetweenAxes(from: 'x' | 'y', to: 'x' | 'y' | 'z'): 0 | 1 | 2 | 3 {
  if (from === to) return 0
  if (from === 'y' || to === 'y') {
    // A yaw about +Y keeps +Y fixed: Y ↔ X/Z is not a quarter-turn.
    throw new Error(`yawBetweenAxes: cannot yaw a ${from}-axis cylinder onto ${to}`)
  }
  // XZ pair: one quarter-turn takes X onto Z (sign is irrelevant to a cylinder).
  return 1
}

/**
 * One instance placement: where the mould goes in world space. A box's yaw is
 * the part's own world yaw; a cylinder's is the yaw from its mould axis onto
 * its world axis.
 */
export function placementFor(shape: PieceShape, part: KitPart): Transform3 {
  const position = part.position
  if (part.kind === 'box') {
    return { position, rotation: part.rotation ?? 0 }
  }
  return { position, rotation: yawBetweenAxes(shape.mouldAxis ?? 'y', part.axis) }
}

/**
 * Split a deck's world parts into merged groups and instanced batches.
 *
 * Deterministic: batches come in first-appearance order of their mould, groups
 * in MATERIAL_SLOTS order (§4 canonical), and both are stable across runs.
 * `deckIndex` only names the emitted ids (`deck-${i}-${slot}`,
 * `deck-${i}-batch-${n}`).
 */
export function partitionParts(
  parts: readonly PlacedPart[],
  deckIndex: number,
  minInstances: number = DEFAULT_MIN_INSTANCES,
): { groups: GroupPlan[]; batches: BatchPlan[] } {
  const moulds = new Map<string, PlacedPart[]>()
  for (const entry of parts) {
    const group = moulds.get(entry.pieceId)
    if (group === undefined) {
      moulds.set(entry.pieceId, [entry])
    } else {
      group.push(entry)
    }
  }

  const batches: BatchPlan[] = []
  const instanced = new Set<string>()
  for (const [pieceId, group] of moulds) {
    if (group.length < minInstances) continue
    const shape = pieceShapeOf(group[0].part)
    batches.push({
      batch: {
        id: `deck-${deckIndex}-batch-${batches.length + 1}`,
        pieceId,
        materialSlot: shape.materialSlot,
        placements: group.map((entry) => placementFor(shape, entry.part)),
      },
      shape,
      parts: group,
    })
    instanced.add(pieceId)
  }

  const merged = parts.filter((entry) => !instanced.has(entry.pieceId))
  const groups: GroupPlan[] = []
  for (const slot of MATERIAL_SLOTS) {
    const slotParts = merged.filter((entry) => entry.materialSlot === slot)
    if (slotParts.length === 0) continue
    groups.push({
      group: {
        id: `deck-${deckIndex}-${slot}`,
        materialSlot: slot,
        sources: uniqueSources(slotParts),
      },
      parts: slotParts,
    })
  }

  return { groups, batches }
}

/** The module instances contributing to a set of parts, in first-appearance order. */
function uniqueSources(parts: readonly PlacedPart[]): GeometryGroup['sources'] {
  const seen = new Set<string>()
  const sources: GeometryGroup['sources'] = []
  for (const entry of parts) {
    const key = `${entry.source.deckId}|${entry.source.moduleId}|${entry.source.moduleIndex}`
    if (seen.has(key)) continue
    seen.add(key)
    sources.push(entry.source)
  }
  return sources
}
