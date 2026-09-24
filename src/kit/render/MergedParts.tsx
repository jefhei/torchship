/**
 * M3-T7 — the merged/instanced draw-call components: ONE mesh per merged slot
 * group, ONE `InstancedMesh` per instance batch.
 *
 * These are the render half of the draw-call pass (the measurement is
 * src/assembler/drawCalls.ts, the geometry builders are ./merged.ts). They are
 * deliberately dumb: the geometry is built once by the caller
 * (src/player/deckGeometry.ts `deckDrawPlan`, memoised per deck) and handed in,
 * so a deck's draw calls are exactly the plan's entries — the components can
 * neither add a call nor rebuild geometry per frame. `ShipInterior`
 * (src/player/WalkthroughScene.tsx) mounts one of each per plan entry, named by
 * the scene graph's own ids (`deck-${i}-${slot}`, `deck-${i}-batch-${n}`), so
 * the M6 export walks the same tree the walker walks.
 *
 * The instanced half sets its matrices imperatively (there is no declarative
 * per-instance transform in three): `placementMatrix` (./merged.ts) is the
 * placement math, and it is the same function the headless tests pin against
 * the assembler's own `mould + placement ≡ world part` identity.
 *
 * Callers own the geometry (see `disposeDrawPlan`): R3F does not dispose
 * geometries that were passed in as props.
 */

import { useLayoutEffect, useRef } from 'react'
import type { BufferGeometry, InstancedMesh, Material } from 'three'
import type { MaterialSlot, Transform3 } from '../../types'
import { placementMatrix } from './merged'
import { SlotMaterial } from './SlotMaterial'

/** One merged material group drawn as a single mesh (one draw call). */
export function MergedParts({
  id,
  slot,
  geometry,
}: {
  /** Scene-graph id — the mesh's name (`deck-${i}-${slot}`). */
  id: string
  slot: MaterialSlot
  /** The group's merged world geometry (built by the caller, one per group). */
  geometry: BufferGeometry
}) {
  return (
    <mesh name={id} geometry={geometry}>
      <SlotMaterial slot={slot} />
    </mesh>
  )
}

/**
 * One instance batch drawn as a single `InstancedMesh` (one draw call):
 * `placements.length` copies of the mould geometry, each placed by
 * `placementMatrix`.
 */
export function InstancedParts({
  id,
  slot,
  geometry,
  placements,
}: {
  /** Scene-graph id — the mesh's name (`deck-${i}-batch-${n}`). */
  id: string
  slot: MaterialSlot
  /** The mould geometry, built once in the mould's own frame. */
  geometry: BufferGeometry
  /** One placement per instance (parallel to the batch's parts). */
  placements: readonly Transform3[]
}) {
  const ref = useRef<InstancedMesh<BufferGeometry, Material> | null>(null)

  useLayoutEffect(() => {
    const mesh = ref.current
    if (mesh === null) return
    placements.forEach((transform, index) => {
      mesh.setMatrixAt(index, placementMatrix(transform))
    })
    mesh.instanceMatrix.needsUpdate = true
    mesh.count = placements.length
    mesh.computeBoundingSphere()
  }, [geometry, placements])

  return (
    <instancedMesh
      ref={ref}
      name={id}
      args={[geometry, undefined, placements.length]}
      frustumCulled={false}
    >
      <SlotMaterial slot={slot} />
    </instancedMesh>
  )
}
