/**
 * M1-T4 — Material theme contract: the runtime side of PRD §7 "theme → surfaces".
 *
 * The M1-T2 type contract (src/types/materials.ts) makes an unassigned slot a
 * COMPILE error for typed themes. This module closes the other two gates the
 * material contract needs:
 *
 *  - a theme data shape an authored theme (and a JSON theme from a preset or an
 *    export payload) can be validated against at RUNTIME, and
 *  - `assertThemesComplete()`, the "unassigned slot = failed build" gate the CI
 *    workflow and `npm run build` call (scripts/check-material-slots.ts).
 *
 * The slot-missing rule itself is NOT re-derived here — it delegates to the
 * M1-T2 `assertMaterialSlotsComplete()` gate and only adds the rules a typed
 * theme can still violate (blank payload, missing id/label, duplicate themes).
 *
 * NOTE ON `.ts` IMPORT EXTENSIONS: this module is loaded by a plain `node`
 * script (the build gate), and Node's native TypeScript type-stripping requires
 * explicit file extensions in relative specifiers. tsconfig sets
 * `allowImportingTsExtensions` + `erasableSyntaxOnly` (no emit, erasable only),
 * so the extension-full imports below work under node, vite and vitest alike.
 */

import { MATERIAL_SLOTS, assertMaterialSlotsComplete } from '../types/materials.ts'
import type { MaterialSlot, MaterialSlots } from '../types/materials.ts'
import { assignedSetId, themeSetProblems } from './pbr.ts'

/**
 * A slot's payload: the id of the PBR set it resolves to. The sets themselves
 * are authored at M4-T1 (`src/materials/pbr.ts`, `PBR_SETS`) and M6 maps them to
 * named export materials. Kept deliberately minimal so a theme stays plain JSON.
 */
export interface MaterialSlotSpec {
  /** Id of the PBR set this slot resolves to (non-blank; authored in pbr.ts). */
  readonly set: string
}

/**
 * A material theme: one named set of surface assignments per §4 slot.
 * `slots` is a `MaterialSlots<...>`, so an omission does not compile — the
 * compile-time half of "unassigned slot = failed build".
 */
export interface MaterialTheme {
  readonly id: string
  readonly label: string
  readonly slots: MaterialSlots<MaterialSlotSpec>
}

/** A theme of unknown shape (parsed JSON, export payload): validate before use. */
export interface UntypedMaterialTheme {
  readonly id?: unknown
  readonly label?: unknown
  readonly slots?: unknown
}

/** The id of a theme of unknown shape, or undefined when unusable. */
export function themeIdOf(theme: unknown): string | undefined {
  if (typeof theme !== 'object' || theme === null) return undefined
  const id = (theme as UntypedMaterialTheme).id
  return typeof id === 'string' && id.trim() !== '' ? id : undefined
}

/**
 * True when a slot payload is a real assignment (a non-blank `set` id). The
 * payload rule itself lives in pbr.ts (`assignedSetId`) so the theme gate, the
 * kit harness and the resolution rule below can never disagree about what
 * "assigned" means.
 */
function isFilledSlot(value: unknown): boolean {
  return assignedSetId(value) !== undefined
}

/**
 * Every way a theme can violate the material contract, as human-readable
 * problems. Empty array = the theme is complete and shippable.
 */
export function themeProblems(theme: unknown): string[] {
  if (typeof theme !== 'object' || theme === null) {
    return ['theme is not an object']
  }
  const candidate = theme as UntypedMaterialTheme
  const id = themeIdOf(theme)
  const where = id ?? '(unnamed theme)'
  const problems: string[] = []

  if (id === undefined) problems.push('theme id is required')
  const label = candidate.label
  if (typeof label !== 'string' || label.trim() === '') {
    problems.push(`${where}: theme label is required`)
  }

  const slots =
    typeof candidate.slots === 'object' && candidate.slots !== null
      ? (candidate.slots as Record<string, unknown>)
      : {}

  // Slot-vocabulary completeness — the M1-T2 runtime gate, never forked.
  try {
    assertMaterialSlotsComplete(slots)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    // Drop the nested gate's own preamble; keep its slot list.
    const missing = message.replace(/^material-slot completeness:\s*/, '')
    problems.push(`${where}: ${missing}`)
  }

  // An assigned-but-blank payload is unassigned in spirit: catch it here.
  for (const slot of MATERIAL_SLOTS) {
    const value = slots[slot]
    if (value !== undefined && !isFilledSlot(value)) {
      problems.push(`${where}: slot '${slot}' is assigned an empty payload`)
    }
  }

  // M4-T1: an assigned slot must RESOLVE — the set id it names must exist in the
  // PBR registry and must be the set declared for that slot. An unresolvable id
  // is a failed build exactly like an unassigned slot (the render bridge
  // src/kit/render/slotSurfaces.ts would otherwise throw at the first draw).
  for (const problem of themeSetProblems(candidate)) {
    problems.push(`${where}: ${problem}`)
  }

  return problems
}

/** Problems across a whole theme registry, including duplicate ids. */
export function themesProblems(themes: readonly unknown[]): string[] {
  const problems = themes.flatMap((theme) => themeProblems(theme))

  const counts = new Map<string, number>()
  for (const theme of themes) {
    const id = themeIdOf(theme)
    if (id === undefined) continue
    counts.set(id, (counts.get(id) ?? 0) + 1)
  }
  for (const [id, count] of counts) {
    if (count > 1) problems.push(`duplicate theme id '${id}' (${count} themes)`)
  }

  return problems
}

/**
 * True when a theme assigns a usable payload to `slot` — the "unassigned slot"
 * rule as a query, for gates that check one slot at a time (the M2-T7 kit
 * harness asks this per slot a module's geometry draws). Delegates to the same
 * payload rule as `themeProblems`; never re-derived.
 */
export function themeAssignsSlot(theme: MaterialTheme, slot: MaterialSlot): boolean {
  const slots = theme.slots as Record<string, unknown>
  return isFilledSlot(slots[slot])
}

/**
 * The build gate: throws (with every problem listed) when any theme leaves a
 * §4 material slot unassigned, so an incomplete theme can never ship.
 */
export function assertThemesComplete(themes: readonly unknown[]): void {
  const problems = themesProblems(themes)
  if (problems.length > 0) {
    throw new Error(
      `material-slot completeness: ${problems.length} problem(s):\n` +
        problems.map((problem) => `  - ${problem}`).join('\n'),
    )
  }
}
