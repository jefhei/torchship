/**
 * M2-T1 — interim per-slot surface tints for the kit primitives.
 *
 * M4-T1 authors the real PBR sets; until then the M2-T7 standalone-render
 * harness needs SOMETHING to draw each §4 slot with, and the modules need to
 * read as the §4 palette while they are being blocked out. Same posture as
 * `MaterialSlotSpec` (src/materials/theme.ts): an explicitly interim payload
 * keyed by slot, in the one place, ready for M4 to replace — nothing else
 * hard-codes a colour.
 *
 * Colours are the §4 palette: worn gunmetal / warm grey, amber-and-white
 * practical light, faded navy, rust + copper, hazard yellow, teal screen
 * glow, ceramic shielding, canvas webbing, and the one warm accent reserved
 * for the coffee station.
 */

import type { MaterialSlot, MaterialSlots } from '../../types'

/** A three.js `meshStandardMaterial`-shaped payload, minus the slot's name. */
export interface SlotSurface {
  /** Base albedo, hex. */
  color: string
  /** Emissive tint, hex ('#000000' = not emissive). */
  emissive: string
  /** Emissive strength (0 for non-emissive slots). */
  emissiveIntensity: number
  metalness: number
  roughness: number
}

/**
 * The interim surface per §4 slot. `MaterialSlots<SlotSurface>` makes a
 * missing slot a COMPILE error (M1-T2 contract), so this table can never ship
 * incomplete.
 */
export const PLACEHOLDER_SLOT_SURFACES: MaterialSlots<SlotSurface> = {
  deckplate: {
    color: '#4a4f55',
    emissive: '#000000',
    emissiveIntensity: 0,
    metalness: 0.75,
    roughness: 0.55,
  },
  bulkhead: {
    color: '#6b6f73',
    emissive: '#000000',
    emissiveIntensity: 0,
    metalness: 0.35,
    roughness: 0.7,
  },
  conduit: {
    color: '#8a5a3b',
    emissive: '#000000',
    emissiveIntensity: 0,
    metalness: 0.6,
    roughness: 0.5,
  },
  'panel-light': {
    color: '#f5e3c0',
    emissive: '#ffd9a0',
    emissiveIntensity: 1.6,
    metalness: 0.0,
    roughness: 0.4,
  },
  screen: {
    color: '#8fe7da',
    emissive: '#4fd6c4',
    emissiveIntensity: 1.2,
    metalness: 0.1,
    roughness: 0.25,
  },
  hazard: {
    color: '#d9b400',
    emissive: '#000000',
    emissiveIntensity: 0,
    metalness: 0.2,
    roughness: 0.6,
  },
  ceramic: {
    color: '#cfd2cc',
    emissive: '#000000',
    emissiveIntensity: 0,
    metalness: 0.1,
    roughness: 0.65,
  },
  webbing: {
    color: '#5b5a4e',
    emissive: '#000000',
    emissiveIntensity: 0,
    metalness: 0.0,
    roughness: 0.9,
  },
  'coffee-accent': {
    color: '#c8763a',
    emissive: '#a85a24',
    emissiveIntensity: 0.35,
    metalness: 0.2,
    roughness: 0.6,
  },
}

/** The interim surface for one slot. */
export function slotSurface(slot: MaterialSlot): SlotSurface {
  return PLACEHOLDER_SLOT_SURFACES[slot]
}
