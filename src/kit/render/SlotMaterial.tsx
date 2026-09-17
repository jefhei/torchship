/**
 * M2-T1 — the slot → surface bridge.
 *
 * Every kit part carries a §4 slot NAME, never a raw material. This is the one
 * place that name becomes a material: M4-T1 swaps the interim tints in
 * slotSurfaces.ts for real PBR sets and nothing else in the kit changes.
 *
 * The material carries the slot name as its three.js `name` (M2-T7): the kit
 * harness reads it back off the render tree to prove every drawn mesh resolves
 * its slot (src/kit/harness/renderTree.ts), and the M6 export needs named
 * materials per the export contract. It is a plain string, so nothing about the
 * shading changes.
 */

import type { MaterialSlot } from '../../types'
import { slotSurface } from './slotSurfaces'

/** A `meshStandardMaterial` for one §4 slot. */
export function SlotMaterial({ slot }: { slot: MaterialSlot }) {
  const surface = slotSurface(slot)
  return (
    <meshStandardMaterial
      name={slot}
      color={surface.color}
      emissive={surface.emissive}
      emissiveIntensity={surface.emissiveIntensity}
      metalness={surface.metalness}
      roughness={surface.roughness}
    />
  )
}
