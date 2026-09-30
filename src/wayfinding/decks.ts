/**
 * M5-T1 — the deck model: every deck the wayfinding UX can name.
 *
 * BUILD_PLAN M5-T1 is "deck/wayfinding UX: per-deck label moments, hatch
 * affordances, optional deck indicator". All three say *where am I and what is
 * here* — so all three read the same deck model, derived once from the M3-T1
 * assembly and never re-authored:
 *
 *   label  the spec's own deck label ('Crew deck — galley & bunks'), split into
 *          the short NAME a sign can shout and the full line it can explain;
 *   aboard what the deck's module instances say they hold, read off the kit
 *          manifests the modules were built from (M2's own labels — the UX does
 *          not keep a second copy of "the galley has a coffee station");
 *   ends   which deck is bow-ward (index − 1) and which is drive-ward (index + 1)
 *          of this one, so a moment can point the way under burn: decks descend
 *          nose → aft in index and in Y, so "up" is a LOWER index.
 *
 * Pure data: no React, no three, no DOM. Everything the overlay renders comes
 * out of here.
 */

import type { DeckAssembly, ShipAssembly } from '../assembler'

/**
 * The separator the Ship Spec labels use between the deck's short name and its
 * contents ('Crew deck — galley & bunks'). A label without one is a name.
 */
export const DECK_LABEL_SEPARATOR = '—'

/** One deck of the ship, as the wayfinding UX names it. */
export interface WayfindingDeck {
  deckIndex: number
  deckId: string
  /** The full spec label, e.g. 'Crew deck — galley & bunks'. */
  label: string
  /** The short name before the separator, e.g. 'Crew deck'. */
  name: string
  /**
   * What the deck seats, one line per room module instance, taken from the
   * modules' own kit-manifest labels. Never empty for a real deck (the M5-T1
   * gate says so) and never includes the shaft band: the trunk is not a room.
   */
  aboard: string[]
}

/** The short name of a spec label: the text before the separator, trimmed. */
export function deckNameOf(label: string): string {
  const cut = label.indexOf(DECK_LABEL_SEPARATOR)
  const name = (cut === -1 ? label : label.slice(0, cut)).trim()
  return name.length > 0 ? name : label.trim()
}

/** The room modules a deck seats, in spec order (the shaft band is not a room). */
export function deckRoomsOf(deck: DeckAssembly): DeckAssembly['modules'] {
  return deck.modules.filter((module) => !module.band)
}

/** What a deck seats, read off the modules' own manifest labels. */
export function deckAboardOf(deck: DeckAssembly): string[] {
  return deckRoomsOf(deck).map((module) => module.module.manifest.label)
}

/** Every deck of the assembled ship, nose → aft (index 0 = head deck). */
export function wayfindingDecksOf(ship: ShipAssembly): WayfindingDeck[] {
  return ship.decks.map((deck) => ({
    deckIndex: deck.deckIndex,
    deckId: deck.deckId,
    label: deck.label,
    name: deckNameOf(deck.label),
    aboard: deckAboardOf(deck),
  }))
}

/** The deck with `deckIndex`, or undefined when the ship has no such deck. */
export function wayfindingDeckAt(
  decks: readonly WayfindingDeck[],
  deckIndex: number,
): WayfindingDeck | undefined {
  return decks.find((deck) => deck.deckIndex === deckIndex)
}
