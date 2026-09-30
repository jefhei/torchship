/**
 * M5-T1 — the wayfinding overlay: the DOM half of the deck/wayfinding UX.
 *
 * Three pieces, all driven by the pure modules beside it:
 *
 *  - the DECK STACK (`indicator.ts`) — the optional indicator, bow at the top,
 *    the walker's deck flagged, ladder marks on the rows whose runs exist. It
 *    is OPTIONAL by key: `I` toggles it, the same way the HUD is a thing you
 *    can turn off, and it starts on;
 *  - the LABEL MOMENT (`moments.ts`) — the sign raised on a deck transition
 *    (spawn, a climb arrival, a fall) naming the deck, what is aboard it and
 *    which way the ladder continues. It holds for MOMENT_HOLD_MS and clears
 *    itself, so standing still shows one sign rather than a stream;
 *  - the HATCH AFFORDANCE (`affordances.ts`) — the prompt that names what E
 *    will do to the hatch in reach ("E — open the spine hatch"), replacing the
 *    ambiguous "open or close this hatch".
 *
 * The component is a dumb shell: it owns only the two pieces of UI state a
 * screen needs (which deck the last moment was raised for, and whether the
 * indicator is showing) and derives everything it renders from the assembly and
 * world it is handed. It renders OUTSIDE the canvas — the walkthrough UI is
 * DOM, never a three.js object (the M3-T4 split), which is also why it is
 * testable in jsdom.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import type { ShipAssembly } from '../assembler'
import type { Hatch } from '../player/hatch'
import type { NavigationWorld } from '../player/nav'
import { HATCH_BLOCKED_NOTICE, hatchAffordance } from './affordances'
import { wayfindingDecksOf } from './decks'
import {
  INDICATOR_TOGGLE_KEY,
  deckIndicatorOf,
  deckIndicatorSummary,
} from './indicator'
import { MOMENT_HOLD_MS, deckMomentFor, type DeckMoment } from './moments'

export function WayfindingOverlay({
  ship,
  world,
  deckIndex,
  phase = 'walk',
  arrived = false,
  landed = false,
  hatch = null,
  hatchOpen = false,
  blocked = false,
}: {
  /** The assembled ship the labels and stack are read from. */
  ship: ShipAssembly
  /** The navigation world — its run list is where the ladder marks come from. */
  world: NavigationWorld
  /** The deck the walk report last named, or null before the first report. */
  deckIndex: number | null
  /** 'walk' or 'climb' — only the label moment's wording uses it. */
  phase?: 'walk' | 'climb'
  /** True on the frame a climb arrived at a landing. */
  arrived?: boolean
  /** True on the frame the walker touched down after a fall. */
  landed?: boolean
  /** The hatch the interact key would act on right now, or null. */
  hatch?: Hatch | null
  /** True when that hatch is open (so the next press closes it). */
  hatchOpen?: boolean
  /** True when the last press was refused because the walker is in the leaf. */
  blocked?: boolean
}) {
  const decks = useMemo(() => wayfindingDecksOf(ship), [ship])
  const indicator = useMemo(
    () => (deckIndex === null ? null : deckIndicatorOf(ship, world, deckIndex)),
    [ship, world, deckIndex],
  )

  const [moment, setMoment] = useState<DeckMoment | null>(null)
  const [indicatorVisible, setIndicatorVisible] = useState(true)
  const lastMomentDeckRef = useRef<number | null>(null)

  // A deck transition raises a sign; a frame that stays put resolves to null
  // and leaves the one on screen alone (it is cleared by its own timer).
  useEffect(() => {
    if (deckIndex === null) {
      return
    }
    const next = deckMomentFor(
      ship,
      world,
      { deckIndex, arrived, landed, phase },
      lastMomentDeckRef.current,
    )
    if (lastMomentDeckRef.current !== deckIndex) {
      lastMomentDeckRef.current = deckIndex
    }
    if (next !== null) {
      setMoment(next)
    }
  }, [ship, world, deckIndex, arrived, landed, phase])

  // The sign holds for MOMENT_HOLD_MS and then clears itself.
  useEffect(() => {
    if (moment === null) {
      return
    }
    const timer = window.setTimeout(() => setMoment(null), MOMENT_HOLD_MS)
    return () => window.clearTimeout(timer)
  }, [moment])

  // The optional half: `I` shows/hides the deck stack.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.code === INDICATOR_TOGGLE_KEY) {
        setIndicatorVisible((visible) => !visible)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  const affordance = useMemo(() => {
    if (hatch === null) {
      return null
    }
    const deck = decks.find((candidate) => candidate.deckIndex === hatch.deckIndex)
    return hatchAffordance(hatch, hatchOpen, deck ?? null)
  }, [hatch, hatchOpen, decks])

  return (
    <div className="wayfinding" data-testid="wayfinding">
      {indicatorVisible && indicator !== null && (
        <div className="deck-indicator" data-testid="deck-indicator">
          <span className="deck-indicator-caption" data-testid="deck-indicator-caption">
            {deckIndicatorSummary(indicator)}
          </span>
          <ol className="deck-indicator-stack" data-testid="deck-indicator-stack">
            {indicator.rows.map((row) => (
              <li
                key={row.deckId}
                className={row.isCurrent ? 'deck-row deck-row-current' : 'deck-row'}
                data-testid="deck-row"
                data-deck-id={row.deckId}
                data-current={row.isCurrent ? 'true' : 'false'}
                title={row.label}
              >
                <span className="deck-row-name">{row.name}</span>
                {row.climbsBowWard && (
                  <span className="deck-row-ladder" data-testid="deck-row-ladder-up">
                    ▲
                  </span>
                )}
                {row.climbsDriveWard && (
                  <span className="deck-row-ladder" data-testid="deck-row-ladder-down">
                    ▼
                  </span>
                )}
              </li>
            ))}
          </ol>
          <span className="deck-indicator-hint" data-testid="deck-indicator-hint">
            I — hide the deck indicator
          </span>
        </div>
      )}
      {moment !== null && (
        <div className="deck-moment" data-testid="deck-moment" role="status">
          <span className="deck-moment-title" data-testid="deck-moment-title">
            {moment.title}
          </span>
          <span className="deck-moment-detail" data-testid="deck-moment-detail">
            {moment.detail}
          </span>
          {moment.aboard.map((line) => (
            <span key={line} className="deck-moment-aboard">
              {line}
            </span>
          ))}
          <span className="deck-moment-arrival" data-testid="deck-moment-arrival">
            {moment.arrivalLine}
          </span>
        </div>
      )}
      {affordance !== null && (
        <div className="hatch-affordance" data-testid="hatch-affordance">
          <span
            className="hatch-affordance-action"
            data-testid="hatch-affordance-action"
          >
            {affordance.text}
          </span>
          <span
            className="hatch-affordance-detail"
            data-testid="hatch-affordance-detail"
          >
            {affordance.detail}
          </span>
        </div>
      )}
      {blocked && (
        <div className="hatch-blocked" data-testid="hatch-blocked">
          {HATCH_BLOCKED_NOTICE}
        </div>
      )}
    </div>
  )
}
