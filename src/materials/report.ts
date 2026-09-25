/**
 * M4-T1 — the material report: what every part of an assembled ship is shaded with.
 *
 * The M4 machine gate asks for "no material-slot gaps" and the human review
 * walks the mood board; both need the same number: which PBR set each §4 slot
 * resolves to on a real ship, how much geometry draws it, and how much of the
 * frame budget that slot costs. `materialSetReport` answers it from the
 * assembler's own partition (the M3-T1/M3-T7 `DeckAssembly.groups` + `batches`)
 * — nothing is re-derived and nothing is re-assembled, so the report is exactly
 * the material side of the draw calls `drawCallTally` counts.
 *
 * The `ShipAssembly` import is TYPE-ONLY: this module stays clear of the
 * assembler at runtime (and of three.js entirely), so the plain-node build gate
 * can load the whole `src/materials/` barrel.
 */

import { MATERIAL_SLOTS } from '../types/materials.ts'
import type { MaterialSlot } from '../types/materials.ts'
import type { ShipAssembly } from '../assembler'
import { DEFAULT_MATERIAL_THEME } from './themes.ts'
import type { MaterialTheme } from './theme.ts'
import { getPbrSet, pbrSetsProblems, PBR_SETS, slotSetProblems } from './pbr.ts'

/** One §4 slot's material usage on a ship. */
export interface SlotUsageRow {
  slot: MaterialSlot
  /** The PBR set the slot resolves to in the active theme. */
  setId: string
  /** Placed parts (module geometry + generated seams) drawing this slot. */
  parts: number
  /** Draw calls touching this slot (one per merged group + one per batch). */
  calls: number
}

/** A ship's material report: per-slot usage, the totals, and any gap. */
export interface MaterialSetReport {
  ship: string
  themeId: string
  /** §4 slots with at least one part on the ship, in `MATERIAL_SLOTS` order. */
  usedSlots: MaterialSlot[]
  /** Every slot, in `MATERIAL_SLOTS` order (`parts` 0 for an unused slot). */
  partsBySlot: SlotUsageRow[]
  parts: number
  calls: number
  /** Empty = every drawn slot has a well-formed, correctly-declared PBR set. */
  problems: string[]
  /** One-line summary for logs and tracker notes. */
  detail: string
}

/**
 * The material side of an assembled ship: per-slot parts + calls, and the
 * resolution verdict per drawn slot (the `slotSetProblems` rule, read across a
 * real assembly — the theme gate already guarantees this for the registry, this
 * is the "on the actual geometry" half).
 */
export function materialSetReport(
  assembly: ShipAssembly,
  theme: MaterialTheme = DEFAULT_MATERIAL_THEME,
): MaterialSetReport {
  const parts = new Map<MaterialSlot, number>()
  const calls = new Map<MaterialSlot, number>()

  for (const deck of assembly.decks) {
    for (const plan of deck.groups) {
      const slot = plan.group.materialSlot
      parts.set(slot, (parts.get(slot) ?? 0) + plan.parts.length)
      calls.set(slot, (calls.get(slot) ?? 0) + 1)
    }
    for (const plan of deck.batches) {
      const slot = plan.batch.materialSlot
      parts.set(slot, (parts.get(slot) ?? 0) + plan.parts.length)
      calls.set(slot, (calls.get(slot) ?? 0) + 1)
    }
  }

  const partsBySlot: SlotUsageRow[] = MATERIAL_SLOTS.map((slot) => ({
    slot,
    setId: getPbrSet(theme.slots[slot].set).id,
    parts: parts.get(slot) ?? 0,
    calls: calls.get(slot) ?? 0,
  }))
  const usedSlots = partsBySlot.filter((row) => row.parts > 0).map((row) => row.slot)

  const problems = [
    ...pbrSetsProblems(PBR_SETS).map((problem) => `registry: ${problem}`),
    ...MATERIAL_SLOTS.flatMap((slot) =>
      (parts.get(slot) ?? 0) === 0
        ? []
        : slotSetProblems(theme.slots[slot], slot).map(
            (problem) => `draw call material: ${problem}`,
          ),
    ),
  ]

  const totalParts = partsBySlot.reduce((sum, row) => sum + row.parts, 0)
  const totalCalls = partsBySlot.reduce((sum, row) => sum + row.calls, 0)
  const detail =
    `materials: ${usedSlots.length}/${MATERIAL_SLOTS.length} §4 slots drawn, ` +
    `${totalParts} parts / ${totalCalls} calls shaded from theme '${theme.id}'`

  return {
    ship: assembly.spec.name,
    themeId: theme.id,
    usedSlots,
    partsBySlot,
    parts: totalParts,
    calls: totalCalls,
    problems,
    detail,
  }
}
