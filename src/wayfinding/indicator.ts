/**
 * M5-T1 — the optional deck indicator: the whole ship as one vertical stack.
 *
 * The indicator answers "where am I in the ship, and which way is which" in one
 * glance, which is the wayfinding half of PRD §11 risk 1 (metal-on-metal
 * sameness) and the §8 [review] item "deck-order logic is legible: climbing
 * nose-ward from engineering to the bridge feels like going up a ship under
 * burn".
 *
 * The direction is the ship's own, not a UI convention: decks are ordered
 * nose → aft in index and in Y (index 0 = head deck, highest), so under-burn
 * "up" is a LOWER index. Rows are therefore emitted bow-first — the stack reads
 * top = bow, bottom = drive — which is what makes climbing feel like going up.
 *
 * The ladder marks are NOT guessed from the deck list: they come from M3-T5's
 * own run list (`NavigationWorld.runs`), the same records the climb machine
 * mounts. A deck row can only claim a climb the ship can actually make.
 */

import type { ShipAssembly } from '../assembler'
import type { NavigationWorld } from '../player/nav'
import { wayfindingDecksOf, wayfindingDeckAt, type WayfindingDeck } from './decks'

/**
 * The key that toggles the optional deck indicator (`event.code`). `I` is free
 * in the walkthrough: WASD, Shift, Ctrl and E are the movement/interact set, so
 * the indicator's key can never be confused with a locomotion input.
 */
export const INDICATOR_TOGGLE_KEY = 'KeyI'

/** One row of the deck stack. */
export interface DeckIndicatorRow {
  deckIndex: number
  deckId: string
  /** The deck's short name, e.g. 'Crew deck'. */
  name: string
  /** The full spec label. */
  label: string
  /** True for the deck the walker is on. Exactly one row per ship. */
  isCurrent: boolean
  /** True when a ladder run from this deck arrives on the deck ABOVE (bow-ward). */
  climbsBowWard: boolean
  /** True when a ladder run from the deck BELOW arrives on this one. */
  climbsDriveWard: boolean
}

/** The deck stack: every deck, nose → aft, with the current one marked. */
export interface DeckIndicator {
  /** Rows bow-first (deck 0 at the top of the stack). */
  rows: DeckIndicatorRow[]
  currentIndex: number
  current: DeckIndicatorRow
  /** Where the ladder goes from the current deck, if it goes anywhere. */
  bowWard: { deckId: string; name: string } | null
  driveWard: { deckId: string; name: string } | null
}

/**
 * The deck a ladder run from `deckIndex` climbs UP to (a run whose lower deck
 * is this one), or null when the ladder stops here — the head deck. This is the
 * only place "there is a ladder up from here" is decided, and it reads M3-T5's
 * run list rather than inferring a climb from the deck order.
 */
export function ladderToBowWard(
  world: NavigationWorld,
  deckIndex: number,
): number | null {
  const run = world.runs.find((candidate) => candidate.lowerDeckIndex === deckIndex)
  return run === undefined ? null : run.upperDeckIndex
}

/**
 * The deck a ladder run climbs DOWN to `deckIndex` from (a run whose upper deck
 * is this one), or null when the ladder stops here — the aft hold.
 */
export function ladderToDriveWard(
  world: NavigationWorld,
  deckIndex: number,
): number | null {
  const run = world.runs.find((candidate) => candidate.upperDeckIndex === deckIndex)
  return run === undefined ? null : run.lowerDeckIndex
}

/** A deck reference as the indicator names it, or null. */
function reference(
  deck: WayfindingDeck | null | undefined,
): { deckId: string; name: string } | null {
  return deck === null || deck === undefined
    ? null
    : { deckId: deck.deckId, name: deck.name }
}

/**
 * The deck stack of `ship` as the walker on `currentDeckIndex` sees it: every
 * deck (bow at the top), one row flagged current, and every ladder climb the
 * run list really affords marked on the row it starts from.
 *
 * A `currentDeckIndex` the ship does not have is clamped to the nearest deck
 * the way the walker itself clamps (deckLevelAtY): the app only ever passes a
 * deck the walk report produced, but a HUD must never throw on a stale index.
 */
export function deckIndicatorOf(
  ship: ShipAssembly,
  world: NavigationWorld,
  currentDeckIndex: number,
): DeckIndicator {
  const decks = wayfindingDecksOf(ship)
  if (decks.length === 0) {
    throw new Error('deckIndicatorOf: the ship has no decks')
  }
  const resolvedIndex = resolveDeckIndex(decks, currentDeckIndex)
  const rows: DeckIndicatorRow[] = decks.map((deck) => ({
    deckIndex: deck.deckIndex,
    deckId: deck.deckId,
    name: deck.name,
    label: deck.label,
    isCurrent: deck.deckIndex === resolvedIndex,
    climbsBowWard: ladderToBowWard(world, deck.deckIndex) !== null,
    climbsDriveWard: ladderToDriveWard(world, deck.deckIndex) !== null,
  }))
  const current = rows.find((row) => row.isCurrent) as DeckIndicatorRow
  const bowTarget = ladderToBowWard(world, resolvedIndex)
  const driveTarget = ladderToDriveWard(world, resolvedIndex)
  return {
    rows,
    currentIndex: resolvedIndex,
    current,
    bowWard: bowTarget === null ? null : reference(wayfindingDeckAt(decks, bowTarget)),
    driveWard:
      driveTarget === null ? null : reference(wayfindingDeckAt(decks, driveTarget)),
  }
}

/** The nearest real deck index, so a stale report cannot break the HUD. */
function resolveDeckIndex(decks: readonly WayfindingDeck[], deckIndex: number): number {
  if (wayfindingDeckAt(decks, deckIndex) !== undefined) {
    return deckIndex
  }
  let best = decks[0].deckIndex
  let bestDistance = Math.abs(deckIndex - best)
  for (const deck of decks) {
    const distance = Math.abs(deckIndex - deck.deckIndex)
    if (distance < bestDistance) {
      best = deck.deckIndex
      bestDistance = distance
    }
  }
  return best
}

/**
 * The indicator's one-line summary of where the walker is, e.g.
 * `Deck 1 · Crew deck · ladder ▲ Head, ▼ Ops deck`. Deck numbers are the spec's
 * own indices (0 = head deck), the same ones the moment headlines and every
 * milestone uses.
 */
export function deckIndicatorSummary(indicator: DeckIndicator): string {
  const parts = [`Deck ${indicator.currentIndex}`, indicator.current.name]
  const climbs: string[] = []
  if (indicator.bowWard !== null) {
    climbs.push(`▲ ${indicator.bowWard.name}`)
  }
  if (indicator.driveWard !== null) {
    climbs.push(`▼ ${indicator.driveWard.name}`)
  }
  if (climbs.length > 0) {
    parts.push(`ladder ${climbs.join(', ')}`)
  }
  return parts.join(' · ')
}
