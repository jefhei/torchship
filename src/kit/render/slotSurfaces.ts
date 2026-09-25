/**
 * M2-T1 → M4-T1 — the slot → three.js surface bridge.
 *
 * Every kit part carries a §4 slot NAME, never a raw material. This is the one
 * place that name becomes shading parameters:
 *
 *   slot  →  theme.slots[slot].set  →  PBR_SETS entry  →  SlotSurface
 *
 * M2-T1 shipped an explicitly INTERIM tint table here so the modules could be
 * blocked out; M4-T1 replaced it with the authored sets (`src/materials/pbr.ts`)
 * and this file became a pure bridge — no colour lives in the kit any more. The
 * theme is the argument (defaulting to the ship's standard theme), so a future
 * preset/export theme (`M6-T3`: spec + seed in a URL) re-skins the whole ship
 * without touching a single module.
 *
 * Resolution THROWS on a theme whose set id the registry does not know: the M4
 * theme gate (`themeProblems` → `themeSetProblems`) already makes that a failed
 * build, so the loud failure here is the last line of defence, not the first.
 */

import { DEFAULT_MATERIAL_THEME, getPbrSet } from '../../materials/index.ts'
import type { MaterialTheme, PbrSet } from '../../materials/index.ts'
import { MATERIAL_SLOTS } from '../../types'
import type { MaterialSlot, MaterialSlots } from '../../types'

/** The `meshStandardMaterial`-shaped payload a §4 slot resolves to. */
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

/** One PBR set as the shading payload the renderer consumes. */
function surfaceOf(set: PbrSet): SlotSurface {
  return {
    color: set.baseColor,
    emissive: set.emissive,
    emissiveIntensity: set.emissiveIntensity,
    metalness: set.metalness,
    roughness: set.roughness,
  }
}

/**
 * The surface every slot of `theme` resolves to, in `MATERIAL_SLOTS` order.
 * One registry lookup per slot — nothing is interpolated, derived or defaulted.
 */
export function slotSurfacesFor(theme: MaterialTheme): MaterialSlots<SlotSurface> {
  const out = {} as Record<MaterialSlot, SlotSurface>
  for (const slot of MATERIAL_SLOTS)
    out[slot] = surfaceOf(getPbrSet(theme.slots[slot].set))
  return out as MaterialSlots<SlotSurface>
}

/** The standard theme's surface per §4 slot (built once, identity-stable). */
export const SLOT_SURFACES: MaterialSlots<SlotSurface> =
  slotSurfacesFor(DEFAULT_MATERIAL_THEME)

/**
 * The surface for one slot. For the ship's standard theme this returns the
 * pre-built (identity-stable) entry; another theme resolves on the spot.
 */
export function slotSurface(
  slot: MaterialSlot,
  theme: MaterialTheme = DEFAULT_MATERIAL_THEME,
): SlotSurface {
  if (theme === DEFAULT_MATERIAL_THEME) return SLOT_SURFACES[slot]
  return surfaceOf(getPbrSet(theme.slots[slot].set))
}
