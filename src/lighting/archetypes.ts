/**
 * M4-T2 — the practical-light archetypes (BUILD_PLAN M4-T2: "Practical light
 * rig: panel/task/screen/reactor light archetypes; per-module light placement
 * from light sockets").
 *
 * PRD §4 is absolute about this layer: **lighting is practical only — no sun,
 * every lumen comes from panels, task lights, screens and the reactor**. So the
 * rig has no key/fill/rim vocabulary at all; it has exactly the four `LightKind`
 * archetypes the M1-T2 contract declares (`src/types/kit.ts`), and every fixture
 * in the ship is an instance of one of them, placed on a socket a module author
 * anchored on real emissive geometry (M2).
 *
 * An archetype is deliberately PHYSICAL rather than artistic. Each one names:
 *
 *  - `lensSlot` — the §4 material slot of the lens the fixture is DRAWN with.
 *    The light's colour is not authored here: it is the emissive TINT that lens
 *    resolves to (`slotSurface(lensSlot, theme).emissive`, the M4-T1 bridge), so
 *    a fixture can never cast a colour its own lens does not glow. That is the
 *    M4-T1 handoff taken literally ("the emissive tints + strengths are the
 *    M4-T2 light-rig calibration input").
 *  - `throwM` — the designed throw: how far the fixture must carry its light
 *    (a ceiling panel to the deck plate, a task strip to its work surface, the
 *    drive glow across the reactor room). This is a MEASURABLE statement about
 *    the authored geometry, not a taste.
 *  - `targetIlluminance` — the illuminance aimed for where that throw lands.
 *  - `intensity` — radiant intensity in candela, DERIVED as
 *    `targetIlluminance × throwM²` (three.js is physically correct: illuminance
 *    falls off as 1/d², so this is the value that puts the target illuminance
 *    exactly at the throw distance). `lightArchetypeProblems` re-derives it, so
 *    the table cannot drift from its own rule.
 *  - `distanceM` — three's `distance`: where the fixture's light stops. It is
 *    budgeted, not arbitrary: at least its own throw (the light must reach where
 *    it was aimed) and never more than `MAX_LIGHT_RANGE_M` (a practical that
 *    reaches across two decks is a bug — decks are enclosed, and an unbounded
 *    point light with no shadow map leaks through the plate).
 *  - `wantShadow` — PRD §11: "small shadow maps only for task lights that
 *    matter". Task strips are the only kind that asks; `rig.ts` gives at most
 *    `SHADOW_LIGHTS_PER_DECK_MAX` of them a map per deck.
 *
 * **Why every fixture is a point light** (and not a spot): three's `SpotLight`
 * aims through a `target` Object3D that must itself be part of the scene graph,
 * which R3F does not attach for you — a spot rig would need a scene-anchored
 * target object per fixture (a hook and a ref per light). Interior rooms here
 * are 3–6 m boxes with one or two practicals in them, so the cone buys almost
 * nothing the range + intensity does not already say, and it would cost a second
 * shader path for every material in the ship. The rig therefore stays one light
 * family. Angular focus is expressed as range: a task strip is a 2 m pool, a
 * ceiling panel a 4.5 m room wash.
 *
 * Two §4 anti-goals are gates rather than prose:
 *
 *  - `LIGHT_TARGET_ILLUMINANCE_MAX` / `LIGHT_INTENSITY_MAX` — "no blown-out
 *    panels": no archetype may aim to flood a surface harder than the room
 *    scale, and none may exceed the absolute intensity ceiling the hottest
 *    fixture in the ship (the drive glow) is blessed with.
 *  - `RIG_AMBIENT_INTENSITY_MAX` — the flat fill must stay DIM. PRD §11's
 *    mitigation for "practical-only lighting comes out flat or murky" is
 *    "warmer ambient fills + emissive panels", so the rig does carry one warm
 *    ambient term — but a fill strong enough to flatten the interior would
 *    undo the whole point of practical-only lighting, so it is capped.
 */

import { NO_EMISSION } from '../materials/pbr.ts'
import type { MaterialTheme } from '../materials/theme.ts'
import { DEFAULT_MATERIAL_THEME } from '../materials/themes.ts'
import { slotSurface } from '../kit/render/slotSurfaces.ts'
import type { LightKind } from '../types/kit.ts'
import type { MaterialSlot } from '../types/materials.ts'

/**
 * The four practical light kinds, in PRD §4 order ("every lumen comes from
 * panels, task lights, screens, and the reactor"). The archetype table is keyed
 * by these, so a new `LightKind` in the contract is a compile error here.
 */
export const LIGHT_KINDS: readonly LightKind[] = ['panel', 'task', 'screen', 'reactor']

/** How hard an archetype may aim to flood a surface (§4 "no blown-out panels"). */
export const LIGHT_TARGET_ILLUMINANCE_MAX = 4

/** Absolute radiant-intensity ceiling, candela (§4 "no blown-out panels"). */
export const LIGHT_INTENSITY_MAX = 24

/** Longest reach any practical may have, meters (a deck is 3.2 m away, at most). */
export const MAX_LIGHT_RANGE_M = 8

/** Most practicals the rig mounts at once, per deck (the frame budget). */
export const LIGHTS_ACTIVE_MAX = 12

/**
 * Most fixtures one deck may carry, meters-of-frame-budget style: a deck that
 * authors more fixtures than the rig can mount at once would carry lights that
 * never turn on, so the gate refuses it. Equal to `LIGHTS_ACTIVE_MAX` because
 * the rig mounts a deck's whole fixture set when it fits.
 */
export const LIGHTS_PER_DECK_MAX = LIGHTS_ACTIVE_MAX

/** Task lights one deck may spend a shadow map on (PRD §11 shadow budget). */
export const SHADOW_LIGHTS_PER_DECK_MAX = 1

/** Shadow map edge, pixels — PRD §11: small maps, task lights that matter. */
export const SHADOW_MAP_SIZE = 512

/**
 * The rig's ambient fill: warm grey, dim. Not a sun and not a sky (both are
 * forbidden by §4) — this is the "warmer ambient fill" mitigation PRD §11 names,
 * and it is what keeps the shadowed side of a fitting from going to pure black.
 */
export const RIG_AMBIENT_COLOR = '#4a443c'

/** Fill strength. Dim by design: the practicals must carry the contrast. */
export const RIG_AMBIENT_INTENSITY = 0.28

/** A fill stronger than this flattens the interior — that is a failed rig. */
export const RIG_AMBIENT_INTENSITY_MAX = 0.5

/** One kind's lighting recipe. */
export interface LightArchetype {
  kind: LightKind
  /** Human label for logs, reports and the QA rig. */
  label: string
  /** §4 slot of the lens the fixture is drawn with — the light's tint source. */
  lensSlot: MaterialSlot
  /** Designed throw, meters: how far this fixture must carry its light. */
  throwM: number
  /** Illuminance aimed for where the throw lands (relative units). */
  targetIlluminance: number
  /** Radiant intensity, candela: `targetIlluminance × throwM²`. */
  intensity: number
  /** three's `distance`: where the light stops, meters. */
  distanceM: number
  /** three's `decay` (2 = physical inverse-square falloff). */
  decay: number
  /** True for the kinds PRD §11 budgets a shadow map for. */
  wantShadow: boolean
}

/**
 * The four authored archetypes. Illuminance targets are room-scale numbers:
 * a panel washes a 3 m room's deck plate at ~1.0, a task strip pools ~3.6 on
 * the surface it was aimed at, a screen glows onto its console at 0.8, and the
 * drive glow carries 1.2 across a 4 m reactor room — the hottest fixture in the
 * ship, still under the §4 ceiling (19.2 < 24).
 */
export const LIGHT_ARCHETYPES: readonly LightArchetype[] = [
  {
    kind: 'panel',
    label: 'overhead panel lens',
    lensSlot: 'panel-light',
    throwM: 3,
    targetIlluminance: 1,
    intensity: 9,
    distanceM: 4.5,
    decay: 2,
    wantShadow: false,
  },
  {
    kind: 'task',
    label: 'recessed task strip',
    lensSlot: 'panel-light',
    throwM: 1,
    targetIlluminance: 3.6,
    intensity: 3.6,
    distanceM: 2,
    decay: 2,
    wantShadow: true,
  },
  {
    kind: 'screen',
    label: 'screen glow',
    lensSlot: 'screen',
    throwM: 1.5,
    targetIlluminance: 0.8,
    intensity: 1.8,
    distanceM: 2.5,
    decay: 2,
    wantShadow: false,
  },
  {
    kind: 'reactor',
    label: 'drive glow',
    lensSlot: 'panel-light',
    throwM: 4,
    targetIlluminance: 1.2,
    intensity: 19.2,
    distanceM: 7,
    decay: 2,
    wantShadow: false,
  },
]

/** Look up an archetype by kind; throws on unknown kinds (typos surface early). */
export function getLightArchetype(kind: LightKind): LightArchetype {
  const archetype = LIGHT_ARCHETYPES.find((entry) => entry.kind === kind)
  if (archetype === undefined) {
    throw new Error(
      `light archetypes: no archetype for kind '${kind}' ` +
        `(known: ${LIGHT_KINDS.join(', ')})`,
    )
  }
  return archetype
}

/**
 * The colour a fixture of this kind lights the room with: the emissive TINT its
 * own lens is drawn with, resolved through the M4-T1 slot → set → surface
 * bridge. Never authored twice — a theme that re-skins the panel lens re-lights
 * the ship with it.
 *
 * Throws when the lens slot is inert in the given theme (a colourless fixture
 * would light the room with `#000000`): the theme gate makes that a failed
 * build, so this is the last line of defence, not the first.
 */
export function lightColorFor(
  archetype: LightArchetype,
  theme: MaterialTheme = DEFAULT_MATERIAL_THEME,
): string {
  const surface = slotSurface(archetype.lensSlot, theme)
  if (surface.emissive === NO_EMISSION || surface.emissiveIntensity <= 0) {
    throw new Error(
      `light archetypes: the ${archetype.kind} fixture uses the ` +
        `'${archetype.lensSlot}' lens, which emits nothing in theme '${theme.id}' ` +
        `(the fixture would light the room with '${NO_EMISSION}')`,
    )
  }
  return surface.emissive
}

/** The rig's ambient fill: warm grey, dim, and gated (`rigAmbientProblems`). */
export interface RigAmbient {
  color: string
  intensity: number
}

/** The rig's ambient fill as the renderer consumes it. */
export function rigAmbient(): RigAmbient {
  return { color: RIG_AMBIENT_COLOR, intensity: RIG_AMBIENT_INTENSITY }
}

/** Numeric slack when re-deriving an intensity from its own rule. */
const DERIVATION_EPS = 1e-9

/**
 * What is wrong with one archetype. Empty = it is a well-formed physical recipe:
 * a known §4 lens slot that actually emits, a positive throw and target at or
 * under the §4 ceilings, an intensity that IS `target × throw²`, a reach that
 * covers its own throw without crossing a deck boundary, physical decay, and a
 * shadow request only where §11 budgets one (task lights).
 */
export function lightArchetypeProblems(
  archetype: LightArchetype,
  theme: MaterialTheme = DEFAULT_MATERIAL_THEME,
): string[] {
  const problems: string[] = []
  const where = `archetype '${archetype.kind}'`

  // The light is tinted by the lens it is drawn with — an inert lens is a bug.
  try {
    lightColorFor(archetype, theme)
  } catch (error) {
    problems.push(`${where}: ${error instanceof Error ? error.message : String(error)}`)
  }

  if (!(archetype.throwM > 0)) {
    problems.push(`${where}: throw ${archetype.throwM} m must be positive`)
  }
  if (!(archetype.targetIlluminance > 0)) {
    problems.push(
      `${where}: target illuminance ${archetype.targetIlluminance} must be positive`,
    )
  }
  if (archetype.targetIlluminance > LIGHT_TARGET_ILLUMINANCE_MAX) {
    problems.push(
      `${where}: target illuminance ${archetype.targetIlluminance} is over the ` +
        `§4 ceiling of ${LIGHT_TARGET_ILLUMINANCE_MAX} (a blown-out room, not a lit one)`,
    )
  }

  const derived = archetype.targetIlluminance * archetype.throwM * archetype.throwM
  if (Math.abs(archetype.intensity - derived) > DERIVATION_EPS * Math.max(1, derived)) {
    problems.push(
      `${where}: intensity ${archetype.intensity} cd is not ` +
        `target × throw² (${archetype.targetIlluminance} × ${archetype.throwM}² = ${derived})`,
    )
  }
  if (archetype.intensity > LIGHT_INTENSITY_MAX) {
    problems.push(
      `${where}: intensity ${archetype.intensity} cd is over the §4 ceiling of ` +
        `${LIGHT_INTENSITY_MAX} cd (no blown-out panels)`,
    )
  }
  if (archetype.distanceM < archetype.throwM) {
    problems.push(
      `${where}: range ${archetype.distanceM} m does not reach its own ` +
        `${archetype.throwM} m throw (the light stops short of what it was aimed at)`,
    )
  }
  if (archetype.distanceM > MAX_LIGHT_RANGE_M) {
    problems.push(
      `${where}: range ${archetype.distanceM} m is over the ${MAX_LIGHT_RANGE_M} m cap ` +
        `(a practical that reaches across decks leaks through the plate)`,
    )
  }
  if (!(archetype.decay > 0)) {
    problems.push(
      `${where}: decay ${archetype.decay} is not physical (2 = inverse-square)`,
    )
  }
  if (archetype.wantShadow && archetype.kind !== 'task') {
    problems.push(
      `${where}: only task lights may ask for a shadow map (PRD §11: small maps ` +
        `only for task lights that matter)`,
    )
  }

  return problems
}

/** What is wrong with the rig's ambient fill (empty = a legal, dim, warm fill). */
export function rigAmbientProblems(ambient: RigAmbient = rigAmbient()): string[] {
  const problems: string[] = []
  if (!/^#[0-9a-f]{6}$/.test(ambient.color)) {
    problems.push(`ambient fill colour '${ambient.color}' is not a #rrggbb hex`)
  }
  if (!(ambient.intensity > 0)) {
    problems.push(
      `ambient fill intensity ${ambient.intensity} must be positive (shadowed ` +
        `surfaces would go to pure black)`,
    )
  }
  if (ambient.intensity > RIG_AMBIENT_INTENSITY_MAX) {
    problems.push(
      `ambient fill intensity ${ambient.intensity} is over the ` +
        `${RIG_AMBIENT_INTENSITY_MAX} cap — a fill that strong flattens the ` +
        `interior and undoes practical-only lighting (PRD §4)`,
    )
  }
  return problems
}

/**
 * The registry verdict: exactly one archetype per `LightKind`, each well-formed,
 * plus a legal ambient fill. Prefixes say which family failed so a build-gate
 * message names its home.
 */
export function lightArchetypesProblems(
  archetypes: readonly LightArchetype[] = LIGHT_ARCHETYPES,
  theme: MaterialTheme = DEFAULT_MATERIAL_THEME,
): string[] {
  const problems: string[] = []
  const seen = new Set<LightKind>()

  for (const archetype of archetypes) {
    if (seen.has(archetype.kind)) {
      problems.push(`registry: duplicate archetype for kind '${archetype.kind}'`)
    }
    seen.add(archetype.kind)
    problems.push(
      ...lightArchetypeProblems(archetype, theme).map((p) => `registry: ${p}`),
    )
  }
  for (const kind of LIGHT_KINDS) {
    if (!seen.has(kind)) {
      problems.push(`registry: no archetype for kind '${kind}'`)
    }
  }

  problems.push(...rigAmbientProblems().map((p) => `rig: ${p}`))
  return problems
}

/** Throw when the archetype registry or the ambient fill is not complete. */
export function assertLightArchetypesComplete(
  archetypes: readonly LightArchetype[] = LIGHT_ARCHETYPES,
  theme: MaterialTheme = DEFAULT_MATERIAL_THEME,
): void {
  const problems = lightArchetypesProblems(archetypes, theme)
  if (problems.length > 0) {
    throw new Error(
      `light archetypes: the practical-light rig is not complete:\n  ${problems.join('\n  ')}`,
    )
  }
}
