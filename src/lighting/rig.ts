/**
 * M4-T2 — the practical-light rig: every fixture in an assembled ship, derived
 * from the modules' own light sockets.
 *
 * BUILD_PLAN M4-T2 is "per-module light placement from light sockets", so this
 * module does not place anything itself: a module author (M2) anchored each
 * socket on the emissive geometry it lights — the galley's task socket on the
 * coffee station's own strip lens, engineering's reactor socket on the drive
 * glow's own lens (both via `placePoint`, so an anchor cannot drift from the
 * part it was read off) — and the rig only transforms those anchors into world
 * space with the SAME placement transform the geometry went through
 * (`placePoint(l.position, { position: module.origin, rotation })`, the M2-T2
 * twin of the renderer's `<group>`). Nothing is re-derived and nothing is
 * hand-placed: the light a room gets is the light its author asked for.
 *
 * One `PlacedLight` per light socket, always — including the implicit per-deck
 * shaft bands (M2-T6), so the trunk between decks is lit by the band that owns
 * it. Every fixture's recipe comes from its kind's archetype
 * (src/lighting/archetypes.ts): intensity in candela, reach, decay, whether it
 * may cast a shadow, and the colour its own lens resolves to in the active
 * theme.
 *
 * The rig is also where the M4 frame budget is decided. A forward renderer pays
 * for every active light on every fragment, so the rig is scoped to ONE deck's
 * fixture set at a time — `activeLightsFor(rig, deckIndex)`, the function
 * `ShipLighting` mounts with (`LIGHTS_ACTIVE_MAX` is that budget, and
 * `lightRigProblems` refuses a ship that authors more fixtures on one deck than
 * the budget can mount, because those would be lights that never turn on).
 * Shadows are scarcer still: at most `SHADOW_LIGHTS_PER_DECK_MAX` shadow-casting
 * practical per deck (PRD §11 "small shadow maps only for task lights that
 * matter"), and only the kinds whose archetype asks.
 *
 * The pure-data shape is what makes the whole layer headless-testable: no
 * three.js is imported here (the R3F component is `ShipLighting.tsx`), so the
 * §8 invariant harness and the plain-node gates can read the rig directly.
 */

import type { ShipAssembly } from '../assembler'
import { placePoint } from '../kit/modules/placement.ts'
import type { ModuleSource } from '../types/scene.ts'
import type { LightKind } from '../types/kit.ts'
import type { Vec3 } from '../types/geometry.ts'
import type { MaterialTheme } from '../materials/theme.ts'
import { DEFAULT_MATERIAL_THEME } from '../materials/themes.ts'
import {
  LIGHTS_ACTIVE_MAX,
  LIGHTS_PER_DECK_MAX,
  LIGHT_KINDS,
  SHADOW_LIGHTS_PER_DECK_MAX,
  getLightArchetype,
  lightArchetypesProblems,
  lightColorFor,
  rigAmbient,
  type RigAmbient,
} from './archetypes.ts'

/** One practical fixture in world space: a light socket, lit. */
export interface PlacedLight {
  /**
   * Stable ship-unique id (`deck-<deck>-<moduleId>-<moduleIndex>-<socketId>`;
   * `moduleIndex` is −1 for the synthesized shaft band). The renderer mounts
   * one light per id, and an export can name them.
   */
  id: string
  kind: LightKind
  deckIndex: number
  deckId: string
  /** Which module instance authored the socket. */
  source: ModuleSource
  /** The socket id inside its module ('panel-light-1', 'reactor-glow', …). */
  socketId: string
  /** World position of the fixture's own lens, meters. */
  position: Vec3
  /** The colour its lens glows (the §4 set's emissive tint), hex. */
  color: string
  /** Radiant intensity, candela (the archetype's). */
  intensity: number
  /** Reach, meters (three's `distance`). */
  distanceM: number
  /** three's `decay` (2 = physical). */
  decay: number
  /** True when the rig spent a shadow map on this fixture (see below). */
  castsShadow: boolean
}

/** One deck's fixtures, as the app mounts them. */
export interface DeckLightRow {
  deckIndex: number
  deckId: string
  label: string
  /** Fixtures the deck carries. */
  lights: number
  /** Fixtures the rig mounts at once (`activeLightsFor`). */
  active: number
  /** Shadow casters among them. */
  shadowCasters: number
}

/** The whole ship's practical lighting, derived. */
export interface LightRig {
  ship: string
  themeId: string
  lights: PlacedLight[]
  /** Lights by deck, in deck order (nose → aft). */
  byDeck: PlacedLight[][]
  /** The warm, dim fill the practicals are read against. */
  ambient: RigAmbient
}

/**
 * Every fixture of an assembled ship, in deck order, module order (rooms then
 * the shaft band), socket order — the determinism the renderer, the report and
 * the tests share. One light per socket, tinted by the slot its lens is drawn
 * with in `theme`.
 */
export function lightRigOf(
  assembly: ShipAssembly,
  theme: MaterialTheme = DEFAULT_MATERIAL_THEME,
): LightRig {
  const byDeck: PlacedLight[][] = []
  const lights: PlacedLight[] = []

  for (const deck of assembly.decks) {
    const deckLights: PlacedLight[] = []
    for (const module of deck.modules) {
      for (const socket of module.module.manifest.lightSockets) {
        const archetype = getLightArchetype(socket.kind)
        deckLights.push({
          id: `deck-${deck.deckIndex}-${module.source.moduleId}-${module.source.moduleIndex}-${socket.id}`,
          kind: socket.kind,
          deckIndex: deck.deckIndex,
          deckId: deck.deckId,
          source: module.source,
          socketId: socket.id,
          position: placePoint(socket.position, {
            position: module.origin,
            rotation: module.rotation,
          }),
          color: lightColorFor(archetype, theme),
          intensity: archetype.intensity,
          distanceM: archetype.distanceM,
          decay: archetype.decay,
          castsShadow: false,
        })
      }
    }
    byDeck.push(deckLights)
    lights.push(...deckLights)
  }

  return {
    ship: assembly.spec.name,
    themeId: theme.id,
    lights,
    byDeck,
    ambient: rigAmbient(),
  }
}

/** The fixtures one deck carries, in authoring order. */
export function lightsOfDeck(rig: LightRig, deckIndex: number): PlacedLight[] {
  return rig.byDeck[deckIndex] ?? []
}

/**
 * How much a kind deserves its slot in the frame budget when a deck carries
 * more fixtures than the rig mounts at once. The ship's LANDMARKS come first
 * (the drive glow is the §4 "reactor room glowing at the aft end"), then the
 * lights people work under, then the ceiling fill that a dropped fixture hurts
 * least.
 */
const KIND_PRIORITY: Record<LightKind, number> = {
  reactor: 0,
  task: 1,
  screen: 2,
  panel: 3,
}

/**
 * The fixtures the renderer mounts for one deck: that deck's whole set when it
 * fits the frame budget, otherwise the budget's worth of the fixtures that
 * matter most (`KIND_PRIORITY`, ties broken by id so the choice is stable).
 * This is the ONLY selection the app uses — `ShipLighting` mounts what this
 * returns, and `lightRigProblems` refuses a ship whose deck overflows it.
 */
export function activeLightsFor(rig: LightRig, deckIndex: number): PlacedLight[] {
  const deck = lightsOfDeck(rig, deckIndex)
  if (deck.length <= LIGHTS_ACTIVE_MAX) return deck
  return [...deck]
    .sort(
      (a, b) =>
        KIND_PRIORITY[a.kind] - KIND_PRIORITY[b.kind] || a.id.localeCompare(b.id),
    )
    .slice(0, LIGHTS_ACTIVE_MAX)
}

/**
 * The rig with its shadow casters marked: at most `SHADOW_LIGHTS_PER_DECK_MAX`
 * per deck, taken from the fixtures whose archetype asks (`wantShadow` — task
 * lights), in the deck's own order. Applied to the rig the app walks with, and
 * the reason `PlacedLight.castsShadow` exists at all.
 */
export function withShadowCasters(rig: LightRig): LightRig {
  const casters = new Set<string>()
  for (const deck of rig.byDeck) {
    let spent = 0
    for (const light of deck) {
      if (spent >= SHADOW_LIGHTS_PER_DECK_MAX) break
      if (!getLightArchetype(light.kind).wantShadow) continue
      casters.add(light.id)
      spent += 1
    }
  }
  return {
    ...rig,
    lights: rig.lights.map((light) => ({
      ...light,
      castsShadow: casters.has(light.id),
    })),
    byDeck: rig.byDeck.map((deck) =>
      deck.map((light) => ({ ...light, castsShadow: casters.has(light.id) })),
    ),
  }
}

/** The fixtures the rig spent a shadow map on (one per deck, at most). */
export function shadowCastersOf(rig: LightRig): PlacedLight[] {
  return rig.lights.filter((light) => light.castsShadow)
}

/** Fixtures per deck, by kind — the rig's shape in one number set. */
export interface LightRigTally {
  lights: number
  decks: number
  byKind: Record<LightKind, number>
  /** Most fixtures any one deck carries. */
  maxPerDeck: number
  shadowCasters: number
}

/** Count the rig: fixtures by kind, the worst deck, shadow spend. */
export function lightRigTally(rig: LightRig): LightRigTally {
  const byKind = Object.fromEntries(LIGHT_KINDS.map((kind) => [kind, 0])) as Record<
    LightKind,
    number
  >
  for (const light of rig.lights) byKind[light.kind] += 1
  return {
    lights: rig.lights.length,
    decks: rig.byDeck.length,
    byKind,
    maxPerDeck: rig.byDeck.reduce((max, deck) => Math.max(max, deck.length), 0),
    shadowCasters: shadowCastersOf(rig).length,
  }
}

/** Sockets an assembly authored — the number of fixtures the rig must mount. */
export function socketCountOf(assembly: ShipAssembly): number {
  return assembly.decks.reduce(
    (total, deck) =>
      total +
      deck.modules.reduce(
        (deckTotal, module) => deckTotal + module.module.manifest.lightSockets.length,
        0,
      ),
    0,
  )
}

/** Module instances an assembly placed — every one of them must be lit. */
export function moduleInstanceCountOf(assembly: ShipAssembly): number {
  return assembly.decks.reduce((total, deck) => total + deck.modules.length, 0)
}

/**
 * What is wrong with a ship's practical lighting (empty = a legal rig):
 *
 *  1. the archetype registry / ambient fill (`lightArchetypesProblems`);
 *  2. **one fixture per socket** — the rig mounts exactly what the kit
 *     authored, so a mismatch means a socket was dropped or double-mounted;
 *  3. **unique fixture ids** — the renderer keys on them;
 *  4. **no dark instance** — every module instance (rooms AND the per-deck
 *     shaft band) contributes at least one fixture: the ASSEMBLED half of §8
 *     bullet 6, the same rule `checkRoomLit` measures on the spec;
 *  5. **the frame budget** — no deck may author more fixtures than the rig
 *     mounts at once (a `LIGHTS_PER_DECK_MAX` overflow is a light that never
 *     turns on).
 *
 * Rules 2–4 are `lightRigCoverageProblems` — they say the ship is LIT — and
 * rule 5 is the M4 machine gate (`BUILD_PLAN` M4: "frame budget met on
 * Patrol"), which is a product budget rather than a §8 lighting invariant: the
 * QA rig's rig-3 hosts two rooms on one deck and overflows it while being
 * perfectly lit, so `checkRoomLit` runs the coverage rules only. The registry
 * gate runs FIRST and short-circuits: a rig whose archetypes are not well-formed
 * cannot be derived at all (`lightRigOf` would throw on an inert lens, exactly
 * as `slotSurface` does), so the problem list is returned instead of an
 * exception.
 */
export function lightRigProblems(
  assembly: ShipAssembly,
  theme: MaterialTheme = DEFAULT_MATERIAL_THEME,
): string[] {
  const registry = lightArchetypesProblems(undefined, theme)
  if (registry.length > 0) return registry

  const rig = withShadowCasters(lightRigOf(assembly, theme))
  return [...rigCoverageProblems(rig, assembly), ...budgetProblemsOf(rig, assembly)]
}

/**
 * Rules 2–4 alone: the ship is LIT — one fixture per authored socket, unique
 * fixture ids, and no module instance left dark. This is the assembled half of
 * §8 bullet 6, read by `checkRoomLit` (the frame budget is a separate rule: see
 * `lightRigProblems`).
 */
export function lightRigCoverageProblems(
  assembly: ShipAssembly,
  theme: MaterialTheme = DEFAULT_MATERIAL_THEME,
): string[] {
  const registry = lightArchetypesProblems(undefined, theme)
  if (registry.length > 0) return registry

  return rigCoverageProblems(withShadowCasters(lightRigOf(assembly, theme)), assembly)
}

/**
 * Rules 2–4 on an already-derived rig, given the ship it was derived from: the
 * rig must be COMPLETE — one fixture per socket the ship's modules authored,
 * unique ids, and no instance left dark. Exported (rather than only used
 * internally) so the rules can be measured against a deliberately incomplete
 * rig: on a real assembly they hold by construction, which is exactly what
 * makes a dropped fixture worth reporting when they do not.
 */
export function rigCoverageProblems(rig: LightRig, assembly: ShipAssembly): string[] {
  const problems: string[] = []

  const sockets = socketCountOf(assembly)
  if (rig.lights.length !== sockets) {
    problems.push(
      `coverage: ${sockets} light socket${sockets === 1 ? '' : 's'} in the ship ` +
        `but ${rig.lights.length} fixture${rig.lights.length === 1 ? '' : 's'} mounted ` +
        `— every socket lights exactly one fixture`,
    )
  }

  const ids = new Set<string>()
  for (const light of rig.lights) {
    if (ids.has(light.id)) problems.push(`coverage: duplicate fixture id '${light.id}'`)
    ids.add(light.id)
  }

  for (const deck of assembly.decks) {
    for (const module of deck.modules) {
      if (module.module.manifest.lightSockets.length > 0) continue
      problems.push(
        `dark instance: deck ${deck.deckIndex} (${deck.deckId}) builds ` +
          `"${module.source.moduleId}#${module.source.moduleIndex}" with no light ` +
          `socket — a legally-dark room on the assembled ship`,
      )
    }
  }

  return problems
}

/** Rule 5: no deck over the frame budget on an already-derived rig. */
function budgetProblemsOf(rig: LightRig, assembly: ShipAssembly): string[] {
  const problems: string[] = []
  for (const deck of assembly.decks) {
    const count = lightsOfDeck(rig, deck.deckIndex).length
    if (count > LIGHTS_PER_DECK_MAX) {
      problems.push(
        `frame budget: deck ${deck.deckIndex} (${deck.deckId}) carries ${count} ` +
          `fixtures over the ${LIGHTS_PER_DECK_MAX} the rig mounts at once — ` +
          `${count - LIGHTS_PER_DECK_MAX} would never turn on`,
      )
    }
  }
  return problems
}

/** One ship's lighting report: the rig, its shape, and its verdict. */
export interface LightRigReport {
  ship: string
  themeId: string
  tally: LightRigTally
  decks: DeckLightRow[]
  ambient: RigAmbient
  /** Fixtures mounted at once, worst deck (the frame-budget number). */
  activeMax: number
  problems: string[]
  detail: string
}

/**
 * The light side of an assembled ship: per-deck fixtures, budget, verdict. The
 * M4 machine gate ("frame budget met on Patrol") reads `activeMax` — the most
 * fixtures mounted at once — against `LIGHTS_ACTIVE_MAX`.
 *
 * Deriving the rig THROWS on an unlightable theme (an inert lens), exactly as
 * `slotSurface` does when a material is asked for a colour it cannot resolve;
 * `lightRigProblems` is the non-throwing verdict surface (it returns the
 * registry problems instead of building the rig), and the M4 theme gate makes
 * such a theme a failed build before either is reached.
 */
export function lightRigReport(
  assembly: ShipAssembly,
  theme: MaterialTheme = DEFAULT_MATERIAL_THEME,
): LightRigReport {
  const rig = withShadowCasters(lightRigOf(assembly, theme))
  const tally = lightRigTally(rig)

  const decks: DeckLightRow[] = rig.byDeck.map((deckLights, index) => {
    const deck = assembly.decks[index]
    return {
      deckIndex: deck.deckIndex,
      deckId: deck.deckId,
      label: deck.label,
      lights: deckLights.length,
      active: activeLightsFor(rig, deck.deckIndex).length,
      shadowCasters: deckLights.filter((light) => light.castsShadow).length,
    }
  })

  const activeMax = decks.reduce((max, row) => Math.max(max, row.active), 0)
  const problems = lightRigProblems(assembly, theme)
  const kinds = LIGHT_KINDS.filter((kind) => tally.byKind[kind] > 0)
    .map((kind) => `${tally.byKind[kind]} ${kind}`)
    .join(' + ')

  const detail =
    `practical lighting: ${tally.lights} fixture${tally.lights === 1 ? '' : 's'} ` +
    `(${kinds}) over ${tally.decks} deck${tally.decks === 1 ? '' : 's'}, ` +
    `${activeMax} mounted at once (budget ${LIGHTS_ACTIVE_MAX}), ` +
    `${tally.shadowCasters} shadow-casting, ` +
    `ambient ${rig.ambient.color} @ ${rig.ambient.intensity}`

  return {
    ship: rig.ship,
    themeId: rig.themeId,
    tally,
    decks,
    ambient: rig.ambient,
    activeMax,
    problems,
    detail,
  }
}

/** Readable one-line description of a fixture (reports and failure messages). */
export function lightLabel(light: PlacedLight): string {
  return (
    `${light.kind} light '${light.socketId}' of ${light.source.moduleId}#` +
    `${light.source.moduleIndex} on deck ${light.deckIndex} (${light.deckId}) ` +
    `at ${light.position.map((n) => n.toFixed(3)).join(', ')} m`
  )
}
