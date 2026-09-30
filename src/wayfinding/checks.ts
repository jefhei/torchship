/**
 * M5-T1 — the wayfinding gate: the machine-checkable half of "deck/wayfinding
 * UX", run over the canonical ships.
 *
 * The M5-T1 UX is data before it is pixels: a deck sign, a deck stack and a
 * hatch sign are all derived, so they can be asserted. The rules below are the
 * ones that would make the UX LIE if they broke — a deck with no name, a stack
 * missing a deck, a ladder mark where the ship has no run, a hatch prompt with
 * nothing to say — and every one of them is checked on every fixture, including
 * the QA rig (whose declared defects are geometry, never wayfinding).
 *
 * This is a PRODUCT gate, not a §8 verdict: nothing here is wired into
 * src/invariants/ (the M4-T2/M4-T3 precedent). It reports defect lines; empty
 * means the ship can be signed.
 */

import type { ShipAssembly } from '../assembler'
import type { NavigationWorld } from '../player/nav'
import { hatchAffordance, hatchShortName } from './affordances'
import { wayfindingDecksOf, wayfindingDeckAt, type WayfindingDeck } from './decks'
import { deckIndicatorOf, ladderToBowWard, ladderToDriveWard } from './indicator'
import { deckMomentFor, deckMomentTitle } from './moments'

/** Every wayfinding defect of an assembled ship. Empty = the UX can sign it. */
export function wayfindingProblems(
  ship: ShipAssembly,
  world: NavigationWorld,
): string[] {
  const decks = wayfindingDecksOf(ship)
  if (decks.length === 0) {
    return ['the ship has no decks — there is nothing to sign']
  }
  return [
    ...deckProblems(ship, world, decks),
    ...indicatorProblems(ship, world, decks),
    ...hatchProblems(world, decks),
  ]
}

/** The deck signs: a name, something aboard, and a moment that reads the right way. */
function deckProblems(
  ship: ShipAssembly,
  world: NavigationWorld,
  decks: readonly WayfindingDeck[],
): string[] {
  const problems: string[] = []
  for (const deck of decks) {
    const where = `deck ${deck.deckIndex} ("${deck.deckId}")`
    if (deck.label.trim().length === 0) {
      problems.push(`${where} has no label to sign`)
    }
    if (deck.name.trim().length === 0) {
      problems.push(`${where} has a label with no name in it ("${deck.label}")`)
    }
    if (deck.aboard.length === 0) {
      problems.push(`${where} seats no room — its sign has nothing to name`)
    }
    if (deck.aboard.some((line) => line.trim().length === 0)) {
      problems.push(
        `${where}'s sign names an unnamed room (a kit manifest with no label)`,
      )
    }

    // The moment the player meets on arriving from the neighbouring deck (the
    // deck above where there is one, the deck below otherwise).
    const fromIndex = deck.deckIndex === 0 ? deck.deckIndex + 1 : deck.deckIndex - 1
    const moment = deckMomentFor(
      ship,
      world,
      { deckIndex: deck.deckIndex, arrived: true, landed: true, phase: 'walk' },
      fromIndex,
    )
    if (moment === null) {
      problems.push(`${where} raises no label moment on arrival from deck ${fromIndex}`)
      continue
    }
    if (moment.title !== deckMomentTitle(deck)) {
      problems.push(
        `${where}'s label moment is headlined "${moment.title}" instead of "${deckMomentTitle(deck)}"`,
      )
    }
    if (moment.detail !== deck.label) {
      problems.push(
        `${where}'s label moment says "${moment.detail}" instead of its own label "${deck.label}"`,
      )
    }
    const direction = deck.deckIndex < fromIndex ? 'bow-ward' : 'drive-ward'
    if (moment.direction !== direction) {
      problems.push(
        `${where}'s label moment reads "${String(moment.direction)}" arriving from deck ${fromIndex} (expected ${direction})`,
      )
    }
  }
  return problems
}

/**
 * The deck stack: full coverage in bow → drive order, exactly one current row
 * naming the walker's own deck, and ladder marks that agree with M3-T5's run
 * list (a row may not promise a climb the ship cannot make, nor hide one).
 */
function indicatorProblems(
  ship: ShipAssembly,
  world: NavigationWorld,
  decks: readonly WayfindingDeck[],
): string[] {
  const problems: string[] = []
  const expected = decks.map((deck) => deck.deckIndex)
  for (const deck of decks) {
    const indicator = deckIndicatorOf(ship, world, deck.deckIndex)
    const where = `the deck indicator at deck ${deck.deckIndex}`
    if (indicator.rows.length !== decks.length) {
      problems.push(
        `${where} shows ${indicator.rows.length} decks for a ${decks.length}-deck ship`,
      )
    }
    const order = indicator.rows.map((row) => row.deckIndex)
    if (order.join(',') !== expected.join(',')) {
      problems.push(
        `${where}'s rows are ${order.join(', ')} — the ship's decks (bow → drive) are ${expected.join(', ')}`,
      )
    }
    const currentRows = indicator.rows.filter((row) => row.isCurrent)
    if (currentRows.length !== 1) {
      problems.push(
        `${currentRows.length} deck rows are flagged current — exactly one deck is the walker's`,
      )
    } else if (currentRows[0].deckIndex !== deck.deckIndex) {
      problems.push(
        `${where} flags deck ${currentRows[0].deckIndex} current instead of ${deck.deckIndex}`,
      )
    }

    const up = ladderToBowWard(world, deck.deckIndex)
    const down = ladderToDriveWard(world, deck.deckIndex)
    const row = indicator.current
    if (row.climbsBowWard !== (up !== null)) {
      problems.push(
        `deck ${deck.deckIndex}'s row ${row.climbsBowWard ? 'claims a ladder up' : 'hides the ladder up'} the run list ${up === null ? 'does not have' : 'has'}`,
      )
    }
    if (row.climbsDriveWard !== (down !== null)) {
      problems.push(
        `deck ${deck.deckIndex}'s row ${row.climbsDriveWard ? 'claims a ladder down' : 'hides the ladder down'} the run list ${down === null ? 'does not have' : 'has'}`,
      )
    }
    if (up !== null && wayfindingDeckAt(decks, up) === undefined) {
      problems.push(
        `the ladder up from deck ${deck.deckIndex} lands on deck ${up}, which the deck stack does not know`,
      )
    }
    if (down !== null && wayfindingDeckAt(decks, down) === undefined) {
      problems.push(
        `the ladder down from deck ${deck.deckIndex} starts on deck ${down}, which the deck stack does not know`,
      )
    }
  }
  return problems
}

/** The hatch signs: unique ids, a deck to name, and the right verb for each state. */
function hatchProblems(
  world: NavigationWorld,
  decks: readonly WayfindingDeck[],
): string[] {
  const problems: string[] = []
  const seen = new Set<string>()
  for (const hatch of world.hatches) {
    if (seen.has(hatch.id)) {
      problems.push(
        `two hatches share the id "${hatch.id}" — the prompt cannot name one of them`,
      )
    }
    seen.add(hatch.id)
    const deck = wayfindingDeckAt(decks, hatch.deckIndex)
    if (deck === undefined) {
      problems.push(
        `hatch "${hatch.id}" is on deck ${hatch.deckIndex}, which the deck stack does not know`,
      )
    }
    const shut = hatchAffordance(hatch, false, deck ?? null)
    const open = hatchAffordance(hatch, true, deck ?? null)
    if (shut.text !== `E — open the ${hatchShortName(hatch)}`) {
      problems.push(
        `hatch "${hatch.id}" signs the wrong prompt when shut ("${shut.text}")`,
      )
    }
    if (open.text !== `E — close the ${hatchShortName(hatch)}`) {
      problems.push(
        `hatch "${hatch.id}" signs the wrong prompt when open ("${open.text}")`,
      )
    }
    if (shut.action !== 'open' || open.action !== 'close') {
      problems.push(
        `hatch "${hatch.id}" signs the wrong action (shut → "${shut.action}", open → "${open.action}")`,
      )
    }
  }
  return problems
}
