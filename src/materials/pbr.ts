/**
 * M4-T1 — PBR material sets: the authored surface behind every §4 slot.
 *
 * M1-T2 declared the nine-slot vocabulary and the theme payload
 * (`MaterialSlotSpec` = the id of the PBR set a slot resolves to); M1-T4 added
 * the runtime gates that make an unassigned slot a failed build; M2-T1 gave the
 * kit an admittedly INTERIM tint table (`src/kit/render/slotSurfaces.ts`) so the
 * modules could be blocked out with *something*. This module is where those set
 * ids finally resolve.
 *
 * Nine sets are authored — one per §4 slot — carrying the PRD §4 material
 * vocabulary as real shading parameters: diamond-pattern deck plate with cable
 * runs, brushed/scuffed painted steel bulkheads, copper-and-rust pipe runs,
 * recessed practical-light lenses, glass/acrylic screens, worn hazard striping,
 * ceramic heat shielding, canvas webbing, and the single warm accent reserved
 * for the coffee station.
 *
 * What a set carries is deliberately the whole material: base albedo,
 * metalness, roughness and, for the practical-light slots, an emissive tint and
 * strength. There are no texture maps in this project — the kit's geometry is
 * generated procedurally and PRD §10 leans explicitly on "baked-feel via
 * emissives" — so a set is exactly the parameter block `meshStandardMaterial`
 * needs and nothing here is data the renderer cannot spend. Worn-ness lives in
 * `roughness` (PRD §4: worn, scuffed, faded; the anti-goal is "no gloss"), which
 * is why `PBR_MIN_ROUGHNESS` is a gate rather than a comment.
 *
 * The gates:
 *  - `pbrSetProblems` / `pbrSetsProblems` / `assertPbrSetsComplete` — a set must
 *    be well formed, its §4 pattern must be the treatment its slot reads as, ids
 *    must be unique, and the registry must cover every slot exactly once;
 *  - `slotSetProblems` / `themeSetProblems` — a theme's slot payload must
 *    RESOLVE: the set id it names must exist and must be declared for that slot
 *    (you may not paint the deck plate with the screen set). `themeProblems`
 *    (src/materials/theme.ts) delegates to this, so an unresolvable set id fails
 *    the build exactly like an unassigned slot.
 *
 * Relative specifiers carry `.ts` extensions: this module is loaded by the plain
 * `node` build gate (scripts/check-material-slots.ts) as well as vite/vitest.
 */

import { MATERIAL_SLOTS } from '../types/materials.ts'
import type { MaterialSlot, MaterialSlots } from '../types/materials.ts'

/** §4 surface treatments: what a set physically reads as. */
export type PbrPattern =
  | 'diamond-plate'
  | 'painted-steel'
  | 'pipe-run'
  | 'recessed-lens'
  | 'glass-acrylic'
  | 'hazard-stripe'
  | 'heat-shield'
  | 'canvas-webbing'
  | 'warm-accent'

/** Every pattern the vocabulary allows, in §4 slot order. */
export const PBR_PATTERNS: readonly PbrPattern[] = [
  'diamond-plate',
  'painted-steel',
  'pipe-run',
  'recessed-lens',
  'glass-acrylic',
  'hazard-stripe',
  'heat-shield',
  'canvas-webbing',
  'warm-accent',
] as const

/**
 * The treatment each §4 slot reads as (PRD §4 material vocabulary). A set
 * declared for a slot must carry that slot's pattern, so the vocabulary cannot
 * be quietly re-pointed: the deck plate set is the diamond-plate set.
 */
export const SLOT_PATTERNS: MaterialSlots<PbrPattern> = {
  deckplate: 'diamond-plate',
  bulkhead: 'painted-steel',
  conduit: 'pipe-run',
  'panel-light': 'recessed-lens',
  screen: 'glass-acrylic',
  hazard: 'hazard-stripe',
  ceramic: 'heat-shield',
  webbing: 'canvas-webbing',
  'coffee-accent': 'warm-accent',
}

/**
 * One authored PBR set: the surface a §4 slot resolves to when it names this
 * set's id. All values are plain data (JSON-round-trippable), so a theme pulled
 * out of a preset/export payload validates exactly like an authored one.
 */
export interface PbrSet {
  /** Registry id — what `MaterialSlotSpec.set` (and the M6 export) names. */
  readonly id: string
  /** The §4 slot this set is the standard surface for (exactly one set each). */
  readonly slot: MaterialSlot
  /** Human label, for logs, QA rows and the review checklist. */
  readonly label: string
  /** §4 treatment this set reads as (must be `SLOT_PATTERNS[slot]`). */
  readonly pattern: PbrPattern
  /** Base albedo, `#rrggbb`. */
  readonly baseColor: string
  /** Metalness, 0…1. */
  readonly metalness: number
  /** Roughness, 0…1 (at least `PBR_MIN_ROUGHNESS`: the ship is never glossy). */
  readonly roughness: number
  /** Emissive tint, `#rrggbb` ('#000000' = inert). */
  readonly emissive: string
  /** Emissive strength, `0…PBR_EMISSIVE_INTENSITY_MAX` (0 for inert sets). */
  readonly emissiveIntensity: number
}

/** What a hex colour looks like in this contract (lower-case, `#rrggbb`). */
export const HEX_COLOR = /^#[0-9a-f]{6}$/

/**
 * The gloss floor. PRD §4's anti-goals: "not pristine sci-fi (no gloss, no
 * white plastic)". A surface rougher than this never reads as a mirror, so the
 * gate keeps a future set from polishing the ship by accident.
 */
export const PBR_MIN_ROUGHNESS = 0.15

/**
 * The emissive ceiling. Practical-only lighting (PRD §4/§5) means the light
 * slots carry the room; the M4 machine gate and the human review both call for
 * "no blown-out panels", so an emissive strength is bounded here (M4-T3's bloom
 * pass reads these values).
 */
export const PBR_EMISSIVE_INTENSITY_MAX = 4

/** Inert emissive tint — a set that emits no light carries this exactly. */
export const NO_EMISSION = '#000000'

/**
 * The nine authored sets: exactly one per §4 slot, ids matching the ship's
 * standard theme (`src/materials/themes.ts`). Order follows `MATERIAL_SLOTS`.
 */
export const PBR_SETS: readonly PbrSet[] = [
  {
    id: 'deckplate-diamond-cable-runs',
    slot: 'deckplate',
    label: 'Diamond-pattern deck plate with cable runs',
    pattern: 'diamond-plate',
    baseColor: '#4a4f55',
    metalness: 0.78,
    roughness: 0.52,
    emissive: NO_EMISSION,
    emissiveIntensity: 0,
  },
  {
    id: 'bulkhead-painted-steel-scuffed',
    slot: 'bulkhead',
    label: 'Painted steel bulkhead, brushed and scuffed',
    pattern: 'painted-steel',
    baseColor: '#6b6f73',
    metalness: 0.35,
    roughness: 0.68,
    emissive: NO_EMISSION,
    emissiveIntensity: 0,
  },
  {
    id: 'conduit-exposed-pipe-run',
    slot: 'conduit',
    label: 'Exposed pipe run, copper and rust',
    pattern: 'pipe-run',
    baseColor: '#8a5a3b',
    metalness: 0.62,
    roughness: 0.46,
    emissive: NO_EMISSION,
    emissiveIntensity: 0,
  },
  {
    id: 'panel-light-recessed',
    slot: 'panel-light',
    label: 'Recessed practical panel lens, amber-white',
    pattern: 'recessed-lens',
    baseColor: '#f5e3c0',
    metalness: 0,
    roughness: 0.38,
    emissive: '#ffd9a0',
    emissiveIntensity: 1.6,
  },
  {
    id: 'screen-glass-emissive',
    slot: 'screen',
    label: 'Glass/acrylic screen, teal glow',
    pattern: 'glass-acrylic',
    baseColor: '#8fe7da',
    metalness: 0.08,
    roughness: 0.2,
    emissive: '#4fd6c4',
    emissiveIntensity: 1.2,
  },
  {
    id: 'hazard-striping-worn',
    slot: 'hazard',
    label: 'Worn hazard striping, old yellow',
    pattern: 'hazard-stripe',
    baseColor: '#d9b400',
    metalness: 0.15,
    roughness: 0.62,
    emissive: NO_EMISSION,
    emissiveIntensity: 0,
  },
  {
    id: 'ceramic-heat-shield-drive',
    slot: 'ceramic',
    label: 'Ceramic heat shielding, matte',
    pattern: 'heat-shield',
    baseColor: '#cfd2cc',
    metalness: 0.05,
    roughness: 0.7,
    emissive: NO_EMISSION,
    emissiveIntensity: 0,
  },
  {
    id: 'webbing-canvas-strap',
    slot: 'webbing',
    label: 'Canvas webbing and straps',
    pattern: 'canvas-webbing',
    baseColor: '#5b5a4e',
    metalness: 0,
    roughness: 0.92,
    emissive: NO_EMISSION,
    emissiveIntensity: 0,
  },
  {
    id: 'coffee-accent-warm',
    slot: 'coffee-accent',
    label: 'Warm accent reserved for the coffee station',
    pattern: 'warm-accent',
    baseColor: '#c8763a',
    metalness: 0.25,
    roughness: 0.55,
    emissive: '#a85a24',
    emissiveIntensity: 0.35,
  },
]

/** The set with this id; throws (naming the registry) when the id is unknown. */
export function getPbrSet(id: string, sets: readonly PbrSet[] = PBR_SETS): PbrSet {
  const set = sets.find((candidate) => candidate.id === id)
  if (set === undefined) {
    const known = sets.map((candidate) => candidate.id).join(', ')
    throw new Error(`unknown PBR set '${id}' (known sets: ${known})`)
  }
  return set
}

/** The standard set for a §4 slot; throws when the registry covers no such slot. */
export function pbrSetForSlot(
  slot: MaterialSlot,
  sets: readonly PbrSet[] = PBR_SETS,
): PbrSet {
  const set = sets.find((candidate) => candidate.slot === slot)
  if (set === undefined) {
    throw new Error(
      `no PBR set is authored for §4 slot '${slot}' (one set per slot is required)`,
    )
  }
  return set
}

/** True when `value` is a finite number inside `[min, max]`. */
function inRange(value: unknown, min: number, max: number): boolean {
  return (
    typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max
  )
}

/** Every way one set can violate the material contract (empty = shippable). */
export function pbrSetProblems(set: unknown): string[] {
  if (typeof set !== 'object' || set === null) return ['PBR set is not an object']
  const candidate = set as Partial<PbrSet>
  const id =
    typeof candidate.id === 'string' && candidate.id.trim() !== ''
      ? candidate.id
      : undefined
  const where = id ?? '(unnamed set)'
  const problems: string[] = []

  if (id === undefined) problems.push('PBR set id is required')

  const slot = candidate.slot
  const knownSlot =
    typeof slot === 'string' && (MATERIAL_SLOTS as readonly string[]).includes(slot)
  if (!knownSlot) {
    problems.push(`${where}: slot '${String(slot)}' is not a §4 material slot`)
  }

  if (typeof candidate.label !== 'string' || candidate.label.trim() === '') {
    problems.push(`${where}: label is required`)
  }

  if (typeof candidate.baseColor !== 'string' || !HEX_COLOR.test(candidate.baseColor)) {
    problems.push(
      `${where}: baseColor '${String(candidate.baseColor)}' is not a #rrggbb colour`,
    )
  }

  if (!inRange(candidate.metalness, 0, 1)) {
    problems.push(`${where}: metalness ${String(candidate.metalness)} is outside 0…1`)
  }

  if (!inRange(candidate.roughness, 0, 1)) {
    problems.push(`${where}: roughness ${String(candidate.roughness)} is outside 0…1`)
  } else if ((candidate.roughness as number) < PBR_MIN_ROUGHNESS) {
    problems.push(
      `${where}: roughness ${candidate.roughness} is below the ${PBR_MIN_ROUGHNESS} gloss floor ` +
        `(PRD §4: no gloss)`,
    )
  }

  const emissive = candidate.emissive
  const validEmissive = typeof emissive === 'string' && HEX_COLOR.test(emissive)
  if (!validEmissive) {
    problems.push(`${where}: emissive '${String(emissive)}' is not a #rrggbb colour`)
  }

  const intensity = candidate.emissiveIntensity
  if (!inRange(intensity, 0, PBR_EMISSIVE_INTENSITY_MAX)) {
    problems.push(
      `${where}: emissiveIntensity ${String(intensity)} is outside ` +
        `0…${PBR_EMISSIVE_INTENSITY_MAX} (no blown-out panels)`,
    )
  } else if ((intensity as number) > 0 && validEmissive && emissive === NO_EMISSION) {
    problems.push(
      `${where}: emissiveIntensity ${intensity} on an inert '${NO_EMISSION}' tint emits nothing`,
    )
  } else if (intensity === 0 && validEmissive && emissive !== NO_EMISSION) {
    problems.push(
      `${where}: emissive '${emissive}' at intensity 0 emits nothing (use '${NO_EMISSION}')`,
    )
  }

  const pattern = candidate.pattern
  if (!PBR_PATTERNS.includes(pattern as PbrPattern)) {
    problems.push(
      `${where}: pattern '${String(pattern)}' is not a §4 surface treatment`,
    )
  } else if (knownSlot && pattern !== SLOT_PATTERNS[slot as MaterialSlot]) {
    problems.push(
      `${where}: pattern '${pattern}' is not the treatment slot '${String(slot)}' reads as ` +
        `('${SLOT_PATTERNS[slot as MaterialSlot]}')`,
    )
  }

  return problems
}

/**
 * Every problem across a whole set registry: the per-set rules, unique ids, and
 * the §4 coverage rule (every slot has exactly one standard set).
 */
export function pbrSetsProblems(sets: readonly unknown[]): string[] {
  const problems = sets.flatMap((set) => pbrSetProblems(set))

  const ids = new Map<string, number>()
  for (const set of sets) {
    if (typeof set !== 'object' || set === null) continue
    const id = (set as Partial<PbrSet>).id
    if (typeof id !== 'string' || id.trim() === '') continue
    ids.set(id, (ids.get(id) ?? 0) + 1)
  }
  for (const [id, count] of ids) {
    if (count > 1) problems.push(`duplicate PBR set id '${id}' (${count} sets)`)
  }

  for (const slot of MATERIAL_SLOTS) {
    const owners = sets.filter(
      (set) =>
        typeof set === 'object' &&
        set !== null &&
        (set as Partial<PbrSet>).slot === slot,
    )
    if (owners.length === 0) {
      problems.push(`no PBR set is authored for §4 slot '${slot}'`)
    } else if (owners.length > 1) {
      const named = owners.map((set) => String((set as Partial<PbrSet>).id)).join(', ')
      problems.push(
        `§4 slot '${slot}' has ${owners.length} PBR sets (one standard set per slot): ${named}`,
      )
    }
  }

  return problems
}

/**
 * The build gate: throws (listing every problem) unless the registry is
 * well-formed and covers every §4 slot exactly once, so an incomplete or
 * mis-declared set table can never ship.
 */
export function assertPbrSetsComplete(sets: readonly unknown[] = PBR_SETS): void {
  const problems = pbrSetsProblems(sets)
  if (problems.length > 0) {
    throw new Error(
      `pbr-set completeness: ${problems.length} problem(s):\n` +
        problems.map((problem) => `  - ${problem}`).join('\n'),
    )
  }
}

/**
 * The set id a theme slot payload names, or undefined when the payload assigns
 * nothing usable (`{}`, a blank/absent string, a non-object). This is the one
 * payload rule: `themeProblems`'s "assigned but empty" check and the resolution
 * rule below both read it, so they cannot disagree.
 */
export function assignedSetId(payload: unknown): string | undefined {
  if (typeof payload !== 'object' || payload === null) return undefined
  const set = (payload as { set?: unknown }).set
  return typeof set === 'string' && set.trim() !== '' ? set : undefined
}

/**
 * Resolution problems for ONE theme slot: an assigned slot must resolve to a
 * registered set, and to a set declared for that very slot. An unassigned
 * (missing/blank) payload yields no problems here — the completeness gate owns
 * that case and reports it in its own words.
 */
export function slotSetProblems(
  payload: unknown,
  slot: MaterialSlot,
  sets: readonly PbrSet[] = PBR_SETS,
): string[] {
  const id = assignedSetId(payload)
  if (id === undefined) return []

  const set = sets.find((candidate) => candidate.id === id)
  if (set === undefined) {
    return [`slot '${slot}' names PBR set '${id}', which the registry does not know`]
  }
  if (set.slot !== slot) {
    return [
      `slot '${slot}' names PBR set '${id}', which is declared for slot '${set.slot}'`,
    ]
  }
  return []
}

/** Resolution problems for every slot of a theme of unknown shape. */
export function themeSetProblems(
  theme: unknown,
  sets: readonly PbrSet[] = PBR_SETS,
): string[] {
  if (typeof theme !== 'object' || theme === null) return []
  const slots = (theme as { slots?: unknown }).slots
  if (typeof slots !== 'object' || slots === null) return []
  const record = slots as Record<string, unknown>
  return MATERIAL_SLOTS.flatMap((slot) => slotSetProblems(record[slot], slot, sets))
}
