/**
 * M3-T7 — a deck's draw-call plan: the geometry the renderer actually issues.
 *
 * The assembler emits the partition (`DeckAssembly.groups` = merged per-slot
 * groups, `DeckAssembly.batches` = instanced moulds, batches.ts) and
 * `src/assembler/drawCalls.ts` measures it. This module turns that partition
 * into the GL objects, ONE per plan entry:
 *
 *  - a merged group → one merged `BufferGeometry` (`mergedPartsGeometry`);
 *  - an instance batch → one mould `BufferGeometry` (`mouldGeometry(mouldOf(shape))`)
 *    + the batch's placements, which the renderer feeds to one `InstancedMesh`.
 *
 * So `deckDrawPlan(deck).length === deckDrawCalls(deck)` — that identity IS the
 * draw-call ceiling's proof, and it is pinned per deck on all four canonical
 * ships (deckGeometry.test.ts) so a renderer change that adds a mesh fails a
 * test instead of a frame budget.
 *
 * The plan is built ONCE per deck inside `useMemo` (a re-render must not
 * re-merge 700 geometries) and disposed by the caller (`disposeDrawPlan`) —
 * R3F does not own geometries passed in as props. Nothing here is
 * re-derived: the mould comes from the assembler's own `mouldOf(shape)`, so
 * the geometry and the assembler's pure `placePart(mouldOf(shape),
 * placementFor(shape, part)) ≡ world part` identity can never disagree.
 */

import type { BufferGeometry } from 'three'
import type { MaterialSlot, Transform3 } from '../types'
import type { DeckAssembly } from '../assembler'
import { mouldOf } from '../assembler'
import { mergedPartsGeometry, mouldGeometry } from '../kit/render'

/** One merged material group, drawn as a single mesh. */
export interface MergedDrawCall {
  kind: 'merged'
  /** Scene-graph id (`deck-${i}-${slot}`) — the mesh's name. */
  id: string
  materialSlot: MaterialSlot
  /** The group's merged world geometry. */
  geometry: BufferGeometry
}

/** One instance batch, drawn as a single `InstancedMesh`. */
export interface InstancedDrawCall {
  kind: 'instanced'
  /** Scene-graph id (`deck-${i}-batch-${n}`) — the mesh's name. */
  id: string
  materialSlot: MaterialSlot
  /** The mould geometry, in the mould's own frame. */
  geometry: BufferGeometry
  /** One placement per instance (parallel to the batch's parts). */
  placements: readonly Transform3[]
}

/** One draw call: a merged mesh or an instanced mesh. */
export type DeckDrawCall = MergedDrawCall | InstancedDrawCall

/**
 * The deck's draw calls, in the scene graph's own order (merged groups, then
 * instance batches) and named by the scene graph's ids — the `deck-${i}` group
 * the M6 export contract expects, with one mesh per child.
 *
 * A group with no parts yields no call (a phantom draw call): the assembler's
 * own gate reports an empty group as a problem (`checks.ts` rule 5), so this
 * skip is unreachable for a clean assembly and pinned by the sweep test.
 */
export function deckDrawPlan(deck: DeckAssembly): DeckDrawCall[] {
  const calls: DeckDrawCall[] = []

  for (const plan of deck.groups) {
    const geometry = mergedPartsGeometry(plan.parts.map((entry) => entry.part))
    if (geometry === null) continue
    calls.push({
      kind: 'merged',
      id: plan.group.id,
      materialSlot: plan.group.materialSlot,
      geometry,
    })
  }

  for (const plan of deck.batches) {
    calls.push({
      kind: 'instanced',
      id: plan.batch.id,
      materialSlot: plan.batch.materialSlot,
      geometry: mouldGeometry(mouldOf(plan.shape)),
      placements: plan.batch.placements,
    })
  }

  return calls
}

/** Free every geometry a plan owns (call on unmount / when the deck changes). */
export function disposeDrawPlan(plan: readonly DeckDrawCall[]): void {
  for (const call of plan) call.geometry.dispose()
}
