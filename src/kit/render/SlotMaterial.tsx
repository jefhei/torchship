/**
 * M2-T1 — the slot → surface bridge.
 *
 * Every kit part carries a §4 slot NAME, never a raw material. This is the one
 * place that name becomes a material: M4-T1 swaps the interim tints in
 * slotSurfaces.ts for real PBR sets and nothing else in the kit changes.
 */

import type { MaterialSlot } from '../../types'
import { slotSurface } from './slotSurfaces'

/** A `meshStandardMaterial` for one §4 slot. */
export function SlotMaterial({ slot }: { slot: MaterialSlot }) {
  const surface = slotSurface(slot)
  return (
    <meshStandardMaterial
      color={surface.color}
      emissive={surface.emissive}
      emissiveIntensity={surface.emissiveIntensity}
      metalness={surface.metalness}
      roughness={surface.roughness}
    />
  )
}
