/**
 * M3-T4 — the walkthrough mount: the assembled ship's geometry plus the
 * first-person rig, as one R3F scene.
 *
 * `ShipInterior` draws what the assembler emitted, deck by deck, straight from
 * the M3-T1 scene-graph contracts: every deck node's merged groups and instanced
 * batches are rendered through the M2 part renderer (`KitParts`, one mesh per
 * part) under deck groups named `deck-${deckIndex}` — the export contract's
 * naming (src/types/scene.ts), so the tree the walker walks is already shaped
 * like the tree M6 exports. The M3-T7 draw-call pass replaces the per-part
 * meshes with merged geometry + InstancedMesh behind the SAME node ids; this
 * component is the seam that lets that swap happen without touching the rig.
 *
 * `WalkthroughScene` adds the rig (WalkRig.tsx) at the provisional spawn
 * (`defaultSpawnFeet`, spawn.ts — M3-T6 owns the real selection) and the world
 * derived from the assembly (`walkerWorldOf` — deck floors + the M3-T3 hull,
 * never re-derived).
 */

import { useMemo } from 'react'
import type { ShipAssembly } from '../assembler'
import { KitParts } from '../kit/render'
import { WalkRig, type WalkReport } from './WalkRig'
import { defaultSpawnFeet } from './spawn'
import { walkerWorldOf } from './walker'
import type { WalkerWorld } from './walker'

/** Every deck of the assembled ship, drawn from the scene-graph contracts. */
export function ShipInterior({ assembly }: { assembly: ShipAssembly }) {
  return (
    <group name="ship-interior">
      {assembly.decks.map((deck) => (
        <group key={deck.deckId} name={`deck-${deck.deckIndex}`}>
          {deck.groups.map((plan) => (
            <group key={plan.group.id} name={plan.group.id}>
              <KitParts parts={plan.parts.map((placed) => placed.part)} />
            </group>
          ))}
          {deck.batches.map((plan) => (
            <group key={plan.batch.id} name={plan.batch.id}>
              <KitParts parts={plan.parts.map((placed) => placed.part)} />
            </group>
          ))}
        </group>
      ))}
    </group>
  )
}

/** The ship's interior and the walker walking it — the R3F side of the app. */
export function WalkthroughScene({
  assembly,
  enabled = true,
  onStep,
}: {
  assembly: ShipAssembly
  /** When false the rig ignores the keys (gravity keeps running). */
  enabled?: boolean
  onStep?: (report: WalkReport) => void
}) {
  const world: WalkerWorld = useMemo(() => walkerWorldOf(assembly), [assembly])
  const spawn = useMemo(() => defaultSpawnFeet(assembly), [assembly])

  return (
    <>
      <ShipInterior assembly={assembly} />
      {spawn !== null && (
        <WalkRig world={world} spawn={spawn} enabled={enabled} onStep={onStep} />
      )}
    </>
  )
}
