/**
 * M5-T2 — the coffee run: the canonical review walk, DERIVED from the ship's
 * own geometry.
 *
 * The M5 Review Loop's one compulsory scripted pass is the coffee run (BUILD_PLAN
 * M5: "crew deck → galley → coffee station → back"). Every piece of it comes off
 * the assembled ship rather than being hand-placed:
 *
 *  - the start is the M3-T6 spawn pose (`spawnPointOf` — the crew deck's spine
 *    doorway, the same selection the app mounts the rig at);
 *  - the turn-around is the galley's own coffee-station anchor, taken from the
 *    module instance's kit manifest (`equipmentSlots`, the M2-T3 authored
 *    landmark) and pushed the walker's standoff straight out of the station's
 *    FRONT — the primitive +z face the carafe and accent backsplash are on
 *    (`coffeeStationParts`, galley.ts) — so the walk stops in front of the
 *    fixture, not inside it;
 *  - every point is transformed into world space through the module instance's
 *    own placement (the same `rotY` a kit part goes through), so a rotated or
 *    re-offset module moves its coffee run with it.
 *
 * There is no authored path: the recorder (`recordWalk`) plans the route across
 * the deck's real walkable grid (route.ts). This module only says WHERE the walk
 * has to go and WHY.
 */

import { rotY } from '../types'
import type { Vec3 } from '../types'
import type { ShipAssembly } from '../assembler'
import type { NavigationWorld } from '../player/nav'
import { CREW_DECK_INDEX, spawnPointOf } from '../player/spawn'
import type { WalkScript, WalkWaypoint } from './types'

/** The script's kind, for reports and the M5-T3 loop. */
export const COFFEE_RUN_KIND = 'coffee-run'

/**
 * How far in front of the coffee station's own anchor the walk stops (m).
 * Measured against the fixture: the station is 0.6 m deep, so its front face is
 * 0.3 m proud of its anchor; standing 0.75 m out puts the walker's 0.25 m
 * capsule ~0.2 m clear of the cabinet, in open floor on the galley's forward
 * walkway (the head partition is port of it, the panel light above it).
 */
export const COFFEE_STANDOFF_M = 0.75

/** The result of planning the coffee run: a script, or the reasons there is none. */
export interface CoffeeRunPlan {
  /** The derived script, or null when the ship cannot run it. */
  script: WalkScript | null
  /** Why there is no script (empty when there is one). */
  problems: string[]
}

/** Normalize −0 → 0 (Object.is-strict comparisons treat signed zeros apart). */
function n0(value: number): number {
  return value === 0 ? 0 : value
}

/**
 * Transform a module-local point into world space through a module instance's
 * placement (rotation about +Y, then translation) — the module-level twin of
 * `placePoint` (src/kit/modules/placement.ts), for anchors read off the
 * manifest rather than a primitive.
 */
function modulePointToWorld(local: Vec3, origin: Vec3, rotation: 0 | 1 | 2 | 3): Vec3 {
  const [rx, ry, rz] = rotY(local, rotation)
  return [n0(origin[0] + rx), n0(origin[1] + ry), n0(origin[2] + rz)]
}

/**
 * Plan the coffee run for an assembled ship: the spawn → the coffee station →
 * back to the spawn. Returns the reasons when the ship offers no run — no crew
 * deck, no galley seated on it, or a galley with no coffee-station anchor — so a
 * caller (the M5-T3 Review Loop) can report the ship rather than guess.
 */
export function planCoffeeRun(
  ship: ShipAssembly,
  world: NavigationWorld,
): CoffeeRunPlan {
  const spawn = spawnPointOf(ship, world)
  if (spawn === null) {
    return {
      script: null,
      problems: [
        `the ship has no legal spawn on its crew deck (index ${CREW_DECK_INDEX}) — there is no coffee run to make`,
      ],
    }
  }

  const crew = ship.decks.find((deck) => deck.deckIndex === CREW_DECK_INDEX)
  if (crew === undefined) {
    return {
      script: null,
      problems: [
        `the assembled ship has no crew deck (index ${CREW_DECK_INDEX}) — the coffee run starts there`,
      ],
    }
  }

  const galley = crew.modules.find(
    (owner) => !owner.band && owner.source.moduleId === 'galley',
  )
  if (galley === undefined) {
    return {
      script: null,
      problems: [
        `the crew deck ("${crew.deckId}") seats no galley — there is no coffee station to run to`,
      ],
    }
  }

  const station = galley.module.manifest.equipmentSlots.find(
    (slot) => slot.id === 'coffee-station',
  )
  if (station === undefined) {
    return {
      script: null,
      problems: [
        `the "galley" module authors no "coffee-station" equipment anchor — the run has no landmark`,
      ],
    }
  }

  // The station's front is its primitive +z face (carafe, accent backsplash,
  // task-light strip); the anchor's own rotation turns that into a module-local
  // direction, and the module instance's placement turns it into world space.
  const front = rotY([0, 0, 1], station.rotation ?? 0)
  const standLocal: Vec3 = [
    station.position[0] + front[0] * COFFEE_STANDOFF_M,
    0,
    station.position[2] + front[2] * COFFEE_STANDOFF_M,
  ]
  const standWorld = modulePointToWorld(standLocal, galley.origin, galley.rotation)

  const waypoints: WalkWaypoint[] = [
    {
      id: 'spawn',
      kind: 'spawn',
      point: spawn.feet,
      deckIndex: crew.deckIndex,
      label: `${crew.label} — the spine foot`,
      note: spawn.note,
    },
    {
      id: 'coffee-station',
      kind: 'landmark',
      point: standWorld,
      deckIndex: crew.deckIndex,
      label: 'The coffee station',
      note: `${COFFEE_STANDOFF_M} m in front of the galley's own "coffee-station" anchor`,
    },
    {
      id: 'return',
      kind: 'return',
      point: spawn.feet,
      deckIndex: crew.deckIndex,
      label: 'Back at the spine foot',
      note: 'the spawn pose again — the coffee run closes its own loop',
    },
  ]

  return {
    script: {
      ship: ship.spec.name,
      kind: COFFEE_RUN_KIND,
      waypoints,
    },
    problems: [],
  }
}

/** The coffee-run script for an assembled ship, or null when it cannot make one. */
export function coffeeRunScript(
  ship: ShipAssembly,
  world: NavigationWorld,
): WalkScript | null {
  return planCoffeeRun(ship, world).script
}
