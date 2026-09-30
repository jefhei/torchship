/**
 * M5-T1 — per-deck label MOMENTS: the sign a player meets when they arrive on
 * a deck.
 *
 * The moment is the wayfinding answer to PRD §11 risk 1 (a dense metal interior
 * reads as confusing sameness): every deck transition names the deck the player
 * has just stepped onto, what is aboard it, and which way the ladder continues —
 * so "up" is stated by the ship rather than discovered by bumping into walls.
 *
 * A moment is DERIVED from the same data everything else is: the deck's own spec
 * label and the kit manifest labels of the modules it seats. The only thing this
 * module adds is the reading of a transition — where the player came from, and
 * which way that is on a ship whose decks descend nose → aft (index and Y), so
 * under burn a LOWER index is UP.
 *
 * Transitions come from the walk report (M3-T5/M3-T6): the rig reports a deck
 * change once, on the frame it happens — a climb arrival (`arrived`), a fall
 * touchdown (`landed`), or the first report of a session (spawn).
 */

import type { ShipAssembly } from '../assembler'
import type { NavigationWorld } from '../player/nav'
import { wayfindingDecksOf, wayfindingDeckAt, type WayfindingDeck } from './decks'
import { ladderToBowWard, ladderToDriveWard } from './indicator'

/**
 * How long a moment stays on screen after the deck change that produced it, ms.
 * Long enough to read a sign while walking (a deck pitch is 3.2 m; at the
 * 2.2 m/s walk that is a second and a half of travel), short enough that the
 * screen is clear again by the time the player is doing something else.
 */
export const MOMENT_HOLD_MS = 4000

/** What produced a moment. */
export type DeckMomentKind =
  /** The first moment of a session: the player's first frame on the crew deck. */
  | 'spawn'
  /** A climb arrived at a landing (M3-T5 `arrived`). */
  | 'climb'
  /** A fall touched down on a deck (`landed`). */
  | 'fall'
  /** Any other deck change the frame reported. */
  | 'walk'

/**
 * Which way the player moved on the ship's own axis. `bow-ward` = rose in Y
 * (a lower index: UP under burn); `drive-ward` = dropped toward the drive.
 */
export type DeckMomentDirection = 'bow-ward' | 'drive-ward'

/** The transition a moment is read from — the walk report's deck-relevant fields. */
export interface DeckArrival {
  deckIndex: number
  /** True on the frame a climb arrived at a landing. */
  arrived: boolean
  /** True on the frame the walker touched down after a fall. */
  landed: boolean
  /** 'walk' while walking, 'climb' while on the ladder. */
  phase: 'walk' | 'climb'
}

/** The sign for one deck, as the player meets it. */
export interface DeckMoment {
  deckIndex: number
  deckId: string
  /** The full spec label, e.g. 'Crew deck — galley & bunks'. */
  label: string
  /** The short name, e.g. 'Crew deck'. */
  name: string
  /** What the deck seats (kit-manifest labels). */
  aboard: string[]
  kind: DeckMomentKind
  /** Which way the player moved, or null for the first moment of a session. */
  direction: DeckMomentDirection | null
  /** 'bow' on the head deck, 'drive' in the aft hold, null in between. */
  extent: 'bow' | 'drive' | null
  /** The headline: `DECK 1 · Crew deck`. */
  title: string
  /** The deck's own label line. */
  detail: string
  /** How the player got here, in words: 'first step aboard', 'up from Ops deck'. */
  arrivalLine: string
  /** Where the ladder goes from the arriving deck (the M5 indicator's lookups). */
  bowWard: { deckId: string; name: string } | null
  driveWard: { deckId: string; name: string } | null
}

/** The headline of a deck's moment. */
export function deckMomentTitle(
  deck: Pick<WayfindingDeck, 'deckIndex' | 'name'>,
): string {
  return `DECK ${deck.deckIndex} · ${deck.name}`
}

/** A deck reference as a moment names it, or null. */
function reference(
  deck: WayfindingDeck | null | undefined,
): { deckId: string; name: string } | null {
  return deck === null || deck === undefined
    ? null
    : { deckId: deck.deckId, name: deck.name }
}

/** The bow-/drive-ward end of the ship a deck is, if either. */
function extentOf(
  decks: readonly WayfindingDeck[],
  deckIndex: number,
): 'bow' | 'drive' | null {
  if (deckIndex === decks[0].deckIndex) {
    return 'bow'
  }
  return deckIndex === decks[decks.length - 1].deckIndex ? 'drive' : null
}

/** How the player arrived, in the ship's own words. */
function arrivalLineOf(
  kind: DeckMomentKind,
  direction: DeckMomentDirection | null,
  from: WayfindingDeck | undefined,
): string {
  if (kind === 'spawn' || from === undefined) {
    return 'first step aboard'
  }
  switch (kind) {
    case 'climb':
      return direction === 'bow-ward'
        ? `up the ladder from ${from.name} — toward the bow`
        : `down the ladder from ${from.name} — toward the drive`
    case 'fall':
      return `fell from ${from.name}`
    default:
      return `came from ${from.name}`
  }
}

/**
 * The sign for the deck an arrival stepped onto, or null when nothing changed:
 * a frame that stays on the same deck (or the same deck as the last moment)
 * produces no moment, so a player standing still sees one sign, not a stream.
 *
 * `previousDeckIndex` is the last deck a moment was raised for — null before the
 * first. That is what makes the first frame of a session a 'spawn' moment and
 * every later deck change a directional one.
 */
export function deckMomentFor(
  ship: ShipAssembly,
  world: NavigationWorld,
  arrival: DeckArrival,
  previousDeckIndex: number | null,
): DeckMoment | null {
  const decks = wayfindingDecksOf(ship)
  if (decks.length === 0) {
    return null
  }
  const deck = wayfindingDeckAt(decks, arrival.deckIndex)
  if (deck === undefined) {
    return null
  }
  if (previousDeckIndex === arrival.deckIndex) {
    return null
  }
  const kind: DeckMomentKind =
    previousDeckIndex === null
      ? 'spawn'
      : arrival.arrived
        ? 'climb'
        : arrival.landed
          ? 'fall'
          : 'walk'
  const direction: DeckMomentDirection | null =
    previousDeckIndex === null || previousDeckIndex === arrival.deckIndex
      ? null
      : arrival.deckIndex < previousDeckIndex
        ? 'bow-ward'
        : 'drive-ward'
  const from = wayfindingDeckAt(decks, previousDeckIndex ?? arrival.deckIndex)
  const bowTarget = ladderToBowWard(world, deck.deckIndex)
  const driveTarget = ladderToDriveWard(world, deck.deckIndex)
  return {
    deckIndex: deck.deckIndex,
    deckId: deck.deckId,
    label: deck.label,
    name: deck.name,
    aboard: deck.aboard,
    kind,
    direction,
    extent: extentOf(decks, deck.deckIndex),
    title: deckMomentTitle(deck),
    detail: deck.label,
    arrivalLine: arrivalLineOf(kind, direction, from),
    bowWard: bowTarget === null ? null : reference(wayfindingDeckAt(decks, bowTarget)),
    driveWard:
      driveTarget === null ? null : reference(wayfindingDeckAt(decks, driveTarget)),
  }
}
