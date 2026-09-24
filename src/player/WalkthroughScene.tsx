/**
 * M3-T4 — the walkthrough mount: the assembled ship's geometry plus the
 * first-person rig, as one R3F scene.
 *
 * `ShipInterior` draws what the assembler emitted, deck by deck, straight from
 * the M3-T1 scene-graph contracts: every deck node's merged groups and instanced
 * batches render as ONE mesh each under deck groups named `deck-${deckIndex}` —
 * the export contract's naming (src/types/scene.ts), so the tree the walker
 * walks is already shaped like the tree M6 exports.
 *
 * **M3-T7 (this pass) is the merge/instance swap.** Until M3-T7 the decks were
 * drawn one mesh per part (736 calls on Patrol). Now each deck's geometry is
 * built ONCE per deck by `deckDrawPlan` (src/player/deckGeometry.ts — one
 * merged `BufferGeometry` per slot group, one mould + placements per instance
 * batch) and mounted as exactly `groups + batches` meshes, which is the number
 * `drawCallTally` measures against the §10 ceiling (src/assembler/drawCalls.ts).
 * The plan is memoised on the deck (re-renders — every HUD step — must not
 * re-merge the geometry) and disposed on unmount.
 *
 * `WalkthroughScene` adds the rig (WalkRig.tsx) at the M3-T6 spawn
 * (`spawnPointOf` — the crew deck at the foot of the spine, measured against
 * the same hull the walker is solved against) and the navigation world derived
 * from the assembly (`navigationWorldOf` — deck floors, the M3-T3 hull, the
 * M3-T5 ladder runs and the modules' own hatch leaves, never re-derived). The
 * spawn's yaw comes with it, so the player starts looking where the selection
 * says they should (into the crew room, or at the ladder).
 */

import { useEffect, useMemo } from 'react'
import type { ShipAssembly } from '../assembler'
import type { DeckAssembly } from '../assembler'
import { InstancedParts, MergedParts } from '../kit/render'
import { WalkRig, type WalkReport } from './WalkRig'
import { deckDrawPlan, disposeDrawPlan } from './deckGeometry'
import { navigationWorldOf } from './nav'
import { spawnPointOf } from './spawn'

/**
 * One deck's draw calls: the M3-T7 merge/instance pass (one mesh per merged
 * slot group, one InstancedMesh per instance batch), named by the scene graph's
 * own ids. Nothing is built per frame or per re-render — the plan is memoised
 * on the deck (the assembly is stable) and freed when it goes away.
 */
function DeckGeometry({ deck }: { deck: DeckAssembly }) {
  const plan = useMemo(() => deckDrawPlan(deck), [deck])
  useEffect(() => () => disposeDrawPlan(plan), [plan])

  return (
    <group name={`deck-${deck.deckIndex}`}>
      {plan.map((call) =>
        call.kind === 'merged' ? (
          <MergedParts
            key={call.id}
            id={call.id}
            slot={call.materialSlot}
            geometry={call.geometry}
          />
        ) : (
          <InstancedParts
            key={call.id}
            id={call.id}
            slot={call.materialSlot}
            geometry={call.geometry}
            placements={call.placements}
          />
        ),
      )}
    </group>
  )
}

/** Every deck of the assembled ship, drawn from the scene-graph contracts. */
export function ShipInterior({ assembly }: { assembly: ShipAssembly }) {
  return (
    <group name="ship-interior">
      {assembly.decks.map((deck) => (
        <DeckGeometry key={deck.deckId} deck={deck} />
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
  const world = useMemo(() => navigationWorldOf(assembly), [assembly])
  const spawn = useMemo(() => spawnPointOf(assembly, world), [assembly, world])

  return (
    <>
      <ShipInterior assembly={assembly} />
      {spawn !== null && (
        <WalkRig
          world={world}
          spawn={spawn.feet}
          yaw={spawn.yaw}
          enabled={enabled}
          onStep={onStep}
        />
      )}
    </>
  )
}
