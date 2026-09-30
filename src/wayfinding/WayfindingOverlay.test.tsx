/**
 * M5-T1 — the wayfinding overlay, mounted in jsdom.
 *
 * The overlay is DOM (it lives outside the `<Canvas>`, like the rest of the
 * walkthrough UI), so unlike the R3F components it can be rendered for real.
 * These tests pin what the player actually sees: the deck stack bow-at-top with
 * the walker's deck flagged and only the ladders the ship has marked, the label
 * moment that appears on a deck change and clears itself, the optional half
 * (`I`), and the hatch affordance naming what E will do.
 */

import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { assembleShip } from '../assembler'
import { PATROL_SPEC } from '../fixtures'
import { navigationWorldOf } from '../player/nav'
import { MOMENT_HOLD_MS } from './moments'
import { WayfindingOverlay } from './WayfindingOverlay'

const ship = assembleShip(PATROL_SPEC)
const world = navigationWorldOf(ship)
const crewHatch = world.hatches.find(
  (hatch) => hatch.id === 'crew-galley#0-spine-door',
) as (typeof world.hatches)[number]

function renderOverlay(props: Partial<Parameters<typeof WayfindingOverlay>[0]> = {}) {
  return render(
    <WayfindingOverlay ship={ship} world={world} deckIndex={1} {...props} />,
  )
}

afterEach(() => {
  vi.useRealTimers()
})

describe('M5-T1 WayfindingOverlay — the deck indicator', () => {
  it('stacks every deck bow at the top with the walker’s deck flagged', () => {
    renderOverlay()
    const rows = screen.getAllByTestId('deck-row')
    expect(rows).toHaveLength(5)
    expect(
      rows.map(
        (row) =>
          within(row).getByText(/Head|Crew deck|Ops deck|Engineering|Aft hold/)
            .textContent,
      ),
    ).toEqual(['Head', 'Crew deck', 'Ops deck', 'Engineering', 'Aft hold'])
    expect(rows.map((row) => row.getAttribute('data-current'))).toEqual([
      'false',
      'true',
      'false',
      'false',
      'false',
    ])
    expect(rows.map((row) => row.getAttribute('data-deck-id'))).toEqual([
      'head',
      'crew',
      'ops',
      'engineering',
      'aft',
    ])
    // Only the ladders the run list really affords: none up from the head deck,
    // none down from the aft hold.
    expect(within(rows[0]).queryByTestId('deck-row-ladder-up')).toBeNull()
    expect(within(rows[0]).getByTestId('deck-row-ladder-down')).toBeInTheDocument()
    expect(within(rows[4]).getByTestId('deck-row-ladder-up')).toBeInTheDocument()
    expect(within(rows[4]).queryByTestId('deck-row-ladder-down')).toBeNull()
    expect(screen.getByTestId('deck-indicator-caption')).toHaveTextContent(
      'Deck 1 · Crew deck · ladder ▲ Head, ▼ Ops deck',
    )
  })

  it('flags the deck it is handed, wherever the walker is', () => {
    renderOverlay({ deckIndex: 3 })
    const rows = screen.getAllByTestId('deck-row')
    expect(rows[3]).toHaveAttribute('data-current', 'true')
    expect(screen.getByTestId('deck-indicator-caption')).toHaveTextContent(
      'Deck 3 · Engineering',
    )
  })

  it('is optional: I hides it and shows it again', () => {
    renderOverlay()
    expect(screen.getByTestId('deck-indicator')).toBeInTheDocument()
    act(() => {
      fireEvent.keyDown(window, { code: 'KeyI' })
    })
    expect(screen.queryByTestId('deck-indicator')).toBeNull()
    // The rest of the overlay is not the indicator and stays put.
    expect(screen.getByTestId('wayfinding')).toBeInTheDocument()
    act(() => {
      fireEvent.keyDown(window, { code: 'KeyI' })
    })
    expect(screen.getByTestId('deck-indicator')).toBeInTheDocument()
    // A key the walkthrough uses for something else must not toggle it.
    act(() => {
      fireEvent.keyDown(window, { code: 'KeyW' })
    })
    expect(screen.getByTestId('deck-indicator')).toBeInTheDocument()
  })

  it('says nothing about decks before the first walk report', () => {
    renderOverlay({ deckIndex: null })
    expect(screen.getByTestId('wayfinding')).toBeInTheDocument()
    expect(screen.queryByTestId('deck-indicator')).toBeNull()
    expect(screen.queryByTestId('deck-row')).toBeNull()
    expect(screen.queryByTestId('deck-moment')).toBeNull()
    expect(screen.queryByTestId('hatch-affordance')).toBeNull()
  })
})

describe('M5-T1 WayfindingOverlay — the label moment', () => {
  it('raises the spawn sign on the first deck of a session', () => {
    renderOverlay()
    const moment = screen.getByTestId('deck-moment')
    expect(moment).toHaveAttribute('role', 'status')
    expect(screen.getByTestId('deck-moment-title')).toHaveTextContent(
      'DECK 1 · Crew deck',
    )
    expect(screen.getByTestId('deck-moment-detail')).toHaveTextContent(
      'Crew deck — galley & bunks',
    )
    expect(moment).toHaveTextContent('Galley / bunk')
    expect(screen.getByTestId('deck-moment-arrival')).toHaveTextContent(
      'first step aboard',
    )
  })

  it('clears itself after the hold, so the screen does not keep a stale sign', () => {
    vi.useFakeTimers()
    renderOverlay()
    expect(screen.getByTestId('deck-moment')).toBeInTheDocument()
    act(() => {
      vi.advanceTimersByTime(MOMENT_HOLD_MS - 1)
    })
    expect(screen.getByTestId('deck-moment')).toBeInTheDocument()
    act(() => {
      vi.advanceTimersByTime(1)
    })
    expect(screen.queryByTestId('deck-moment')).toBeNull()
  })

  it('reads a deck change in the ship’s own direction', () => {
    const { rerender } = renderOverlay({ deckIndex: 2 })
    expect(screen.getByTestId('deck-moment-title')).toHaveTextContent(
      'DECK 2 · Ops deck',
    )
    rerender(
      <WayfindingOverlay
        ship={ship}
        world={world}
        deckIndex={1}
        arrived
        landed
        phase="walk"
      />,
    )
    expect(screen.getByTestId('deck-moment-title')).toHaveTextContent(
      'DECK 1 · Crew deck',
    )
    expect(screen.getByTestId('deck-moment-arrival')).toHaveTextContent(
      'up the ladder from Ops deck — toward the bow',
    )
    // And the other way: toward the drive.
    rerender(
      <WayfindingOverlay
        ship={ship}
        world={world}
        deckIndex={3}
        arrived
        landed
        phase="walk"
      />,
    )
    expect(screen.getByTestId('deck-moment-title')).toHaveTextContent(
      'DECK 3 · Engineering',
    )
    expect(screen.getByTestId('deck-moment-arrival')).toHaveTextContent(
      'down the ladder from Crew deck — toward the drive',
    )
  })

  it('keeps one sign while the walker stays on the deck', () => {
    const { rerender } = renderOverlay()
    const first = screen.getByTestId('deck-moment')
    expect(first).toHaveTextContent('first step aboard')
    // Same deck, other frame facts change: no second moment, no wording drift.
    rerender(
      <WayfindingOverlay
        ship={ship}
        world={world}
        deckIndex={1}
        phase="walk"
        landed
        arrived={false}
      />,
    )
    expect(screen.getByTestId('deck-moment')).toHaveTextContent('first step aboard')
    expect(screen.getByTestId('deck-moment-title')).toHaveTextContent(
      'DECK 1 · Crew deck',
    )
  })

  it('says the ladder stops here on the head deck and in the aft hold', () => {
    const { rerender } = renderOverlay({ deckIndex: 1 })
    rerender(<WayfindingOverlay ship={ship} world={world} deckIndex={0} arrived />)
    expect(screen.getByTestId('deck-moment-title')).toHaveTextContent('DECK 0 · Head')
    expect(screen.getByTestId('deck-moment-arrival')).toHaveTextContent(
      'up the ladder from Crew deck — toward the bow',
    )
    rerender(
      <WayfindingOverlay
        ship={ship}
        world={world}
        deckIndex={4}
        arrived={false}
        landed
      />,
    )
    expect(screen.getByTestId('deck-moment-title')).toHaveTextContent(
      'DECK 4 · Aft hold',
    )
    expect(screen.getByTestId('deck-moment-arrival')).toHaveTextContent(
      'fell from Head',
    )
  })
})

describe('M5-T1 WayfindingOverlay — the hatch affordance', () => {
  it('names the hatch in reach and says what E will do', () => {
    const { rerender } = renderOverlay({ hatch: crewHatch, hatchOpen: false })
    expect(screen.getByTestId('hatch-affordance-action')).toHaveTextContent(
      'E — open the spine hatch',
    )
    expect(screen.getByTestId('hatch-affordance-detail')).toHaveTextContent(
      'Crew deck · galley#0 · "spine-door"',
    )
    rerender(
      <WayfindingOverlay
        ship={ship}
        world={world}
        deckIndex={1}
        hatch={crewHatch}
        hatchOpen
      />,
    )
    expect(screen.getByTestId('hatch-affordance-action')).toHaveTextContent(
      'E — close the spine hatch',
    )
  })

  it('shows no affordance when no hatch is in reach, and the notice when a close is refused', () => {
    const { rerender } = renderOverlay({ hatch: null })
    expect(screen.queryByTestId('hatch-affordance')).toBeNull()
    expect(screen.queryByTestId('hatch-blocked')).toBeNull()
    rerender(
      <WayfindingOverlay
        ship={ship}
        world={world}
        deckIndex={1}
        hatch={crewHatch}
        hatchOpen
        blocked
      />,
    )
    expect(screen.getByTestId('hatch-blocked')).toHaveTextContent(
      'the hatch will not close on you',
    )
  })
})
