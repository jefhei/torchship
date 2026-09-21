/**
 * M3-T4 — where the walkthrough puts the walker. PROVISIONAL plumbing.
 *
 * M3-T6 owns spawn selection proper: "crew deck at the foot of the spine" plus
 * the PRD §8 `[auto]` spawn-inside invariant (spawn point inside the crew deck,
 * not intersecting geometry) and the validator-backed claim that a spec even
 * has a crew deck. What the rig needs today is simply a legal place to put the
 * eye so the walkthrough can be driven at all, and the one every canonical
 * fixture has is the CREW DECK'S FIRST ROOM (deck index 1 — `src/fixtures/
 * patrol.ts`, `longHaul.ts` and `science.ts` all put the galley there).
 *
 * Spawning at that module instance's own origin is inside the room, on the deck
 * plate, clear of the spine's crawl opening and of the ladder that occupies the
 * trunk's mid-line — a walkable spot, which `src/player/walker.test.ts` pins for
 * all three canonical ships. Ships with a single deck spawn on deck 0.
 *
 * This module exists separately from the R3F components (WalkthroughScene.tsx)
 * so the selection stays three-agnostic and unit-testable, and so M3-T6 can
 * replace it with the real algorithm without touching the render layer.
 */

import type { ShipAssembly } from '../assembler'
import type { Vec3 } from '../types'

/** The deck index the provisional spawn prefers (the crew deck on every fixture). */
export const PROVISIONAL_SPAWN_DECK_INDEX = 1

/**
 * The walker's feet at spawn: the crew deck's first room instance origin, or
 * deck 0's on a one-deck ship. `null` when the assembly has no room instances
 * at all (a spine-only spec), which the caller treats as "no walkthrough".
 */
export function defaultSpawnFeet(assembly: ShipAssembly): Vec3 | null {
  const crew =
    assembly.decks.find((deck) => deck.deckIndex === PROVISIONAL_SPAWN_DECK_INDEX) ??
    assembly.decks[0]
  if (crew === undefined) {
    return null
  }
  const room = crew.modules.find((owner) => !owner.band)
  if (room === undefined) {
    return null
  }
  return [room.origin[0], room.origin[1], room.origin[2]]
}
