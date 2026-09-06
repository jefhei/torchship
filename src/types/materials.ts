/**
 * M1-T2 — Material contract (PRD §7, "theme → surfaces").
 *
 * Named slots the theme must fill: one slot = one PBR set. The vocabulary
 * comes from the §4 material list — deckplates, bulkheads, conduit, panel
 * lights, screens, hazard striping, ceramic heat shielding, webbing, and the
 * single warm accent reserved for the coffee station.
 *
 * Completeness is enforced twice:
 *  - at compile time, MaterialSlots<T> is a mapped type that REQUIRES every
 *    slot — a theme declared as MaterialSlots<PbrSet> cannot omit one; and
 *  - at runtime, assertMaterialSlotsComplete() checks untyped (JSON) themes
 *    and throws listing the unassigned slots. The M1-T4 CI material-slot
 *    completeness check and M2-T7's "all material slots assigned" harness
 *    build on this: an unassigned slot fails the build, never ships.
 *
 * PbrSet itself is M4-T1 territory; MaterialSlots<PbrSet> resolves then. Until
 * then MaterialSlots<T> stays generic so the completeness machinery is in
 * place and testable.
 */

/** The named material slots of the §4 vocabulary. */
export type MaterialSlot =
  | 'deckplate'
  | 'bulkhead'
  | 'conduit'
  | 'panel-light'
  | 'screen'
  | 'hazard'
  | 'ceramic'
  | 'webbing'
  | 'coffee-accent'

/** Every slot the theme must fill, in a stable order (for checks/CI/reporting). */
export const MATERIAL_SLOTS: readonly MaterialSlot[] = [
  'deckplate',
  'bulkhead',
  'conduit',
  'panel-light',
  'screen',
  'hazard',
  'ceramic',
  'webbing',
  'coffee-accent',
] as const

/**
 * A complete slot assignment: T is the per-slot payload (PbrSet at M4-T1).
 * The mapped type makes an omission a compile error — "unassigned slot =
 * failed build" is expressible in the type system.
 */
export type MaterialSlots<T> = { readonly [K in MaterialSlot]: T }

/**
 * Runtime completeness gate for untyped themes (preset JSON, export payloads):
 * throws listing every unassigned slot (missing or undefined). Unknown extra
 * keys are allowed — a newer theme may carry slots this build doesn't know.
 */
export function assertMaterialSlotsComplete(theme: Record<string, unknown>): void {
  const missing = MATERIAL_SLOTS.filter((slot) => theme[slot] === undefined)
  if (missing.length > 0) {
    throw new Error(
      `material-slot completeness: unassigned slot(s): ${missing.join(', ')}` +
        ` — one PBR set per slot is required (PRD §7 material contract)`,
    )
  }
}
