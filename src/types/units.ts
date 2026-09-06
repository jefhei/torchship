/**
 * M1-T2 — canonical units & dimension conventions for the data contracts.
 *
 * Scale constraints come from PRD §4/§6: deck clear height 3.0 m, deck pitch
 * 3.2 m (3.0 clear + 0.2 m plate), standard hatch 0.9 × 2.0 m centered 1.0 m
 * above the floor. The white-box kit of the M0-T2 seam spike (kit.ts) and the
 * spike's measured [auto] tolerances (tolerances.ts) use these same numbers;
 * this module is the canonical home the M2 kit and M3 assembler import.
 *
 * Frame: deck 0 is the head deck (nose, highest Y); floors descend with deck
 * index along the thrust axis (−Y): deckFloorYFor(i) = −i · DECK_PITCH_M.
 */

/** Meters per millimeter — convert invariant reports from m to mm: mm = m / MM. */
export const MM = 1e-3

/** Deck clear height (floor to ceiling), meters. */
export const DECK_CLEAR_M = 3.0

/** Deck pitch (floor-to-floor), meters: 3.0 clear + 0.2 plate. */
export const DECK_PITCH_M = 3.2

/**
 * Standard door-center height above the deck floor, meters. A standard
 * 2.0 m door centered here sits its bottom edge exactly on the floor
 * (1.0 − 2.0/2 = 0). Kit rule from the M0-T2 spike: door sockets default to
 * this height; non-standard centers are declared via the door's position and
 * flagged as deck offsets (see doorCenterDeckOffsetM in kit.ts).
 */
export const STANDARD_DOOR_CENTER_M = 1.0

/** Standard hatch/door opening, meters (cramped ship: walk-through doors). */
export const STANDARD_DOOR_SIZE = { width: 0.9, height: 2.0 } as const

/** World Y of deck `deckIndex`'s floor. Deck 0 (head) is at Y = 0; −Y is aft/drive. */
export function deckFloorYFor(deckIndex: number): number {
  const y = -deckIndex * DECK_PITCH_M
  // Normalize −0 → 0 (deck 0's floor is world Y 0; Object.is equality would
  // otherwise see the signed zero).
  return y === 0 ? 0 : y
}
