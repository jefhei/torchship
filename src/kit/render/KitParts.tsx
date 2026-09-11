/**
 * M2-T1 — the generic part renderer.
 *
 * `KitParts` maps a builder's part list onto one mesh per part, each shaded by
 * its §4 slot. It is deliberately dumb: it knows boxes and cylinders and
 * nothing else, which is the whole vocabulary the builders emit. The M3-T7
 * merge/instance pass replaces per-part meshes with merged per-deck geometry
 * and instanced batches (src/types/scene.ts) — until then the M2-T7 harness
 * renders modules through exactly this component.
 *
 * Renderers must live inside an R3F <Canvas>; that is why they are never
 * mounted from jsdom tests (no WebGL) — the maths they consume is tested in
 * src/kit/parts.test.ts instead.
 */

import type { KitPart } from '../types'
import { SlotMaterial } from './SlotMaterial'
import { boxEuler, cylinderEuler, vec3Tuple } from './transforms'

/** One generated kit part as a mesh under its §4 material slot. */
export function KitPartMesh({ part }: { part: KitPart }) {
  if (part.kind === 'box') {
    return (
      <mesh position={vec3Tuple(part.position)} rotation={boxEuler(part.rotation ?? 0)}>
        <boxGeometry args={vec3Tuple(part.size)} />
        <SlotMaterial slot={part.materialSlot} />
      </mesh>
    )
  }
  return (
    <mesh position={vec3Tuple(part.position)} rotation={cylinderEuler(part.axis)}>
      <cylinderGeometry args={[part.radius, part.radius, part.length, 16]} />
      <SlotMaterial slot={part.materialSlot} />
    </mesh>
  )
}

/** A whole part list, one mesh per part, in builder order. */
export function KitParts({ parts }: { parts: readonly KitPart[] }) {
  return (
    <>
      {parts.map((part, index) => (
        <KitPartMesh key={`${part.kind}-${part.materialSlot}-${index}`} part={part} />
      ))}
    </>
  )
}
