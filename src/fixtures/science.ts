/**
 * M0-T5 — canonical fixture (c): Science, the retrofit surveyor.
 *
 * A patrol hull re-purposed for a science mission ("retrofit: med bay
 * expanded, sensor module", PRD §6.1). Five decks nose → aft; the aft
 * cargo hold is replaced by a dedicated science deck. The kit has no
 * separate 'lab' module — the retrofit reuses the ops module (which
 * already carries the med bay) as the expanded med bay / sensor bay,
 * proving the same kit module serves two roles:
 *
 *   deck 0  head         — bridge
 *   deck 1  crew         — galley & bunks (spawn deck)
 *   deck 2  ops          — airlock + suit locker (ops module)
 *   deck 3  science      — expanded med bay & sensor suite (ops module)
 *   deck 4  engineering  — reactor access, drive glow window
 */

import type { ShipSpec } from '../types'
import { deckFloorYFor } from '../types'
import { atSpine } from './layout'

export const SCIENCE_SPEC: ShipSpec = {
  classId: 'hound',
  name: 'Surveyor',
  registry: 'HCS-533',
  seed: 3,
  decks: [
    {
      id: 'head',
      label: 'Head — bridge',
      yPosition: deckFloorYFor(0),
      modules: [atSpine('head')],
    },
    {
      id: 'crew',
      label: 'Crew deck — galley & bunks',
      yPosition: deckFloorYFor(1),
      modules: [atSpine('galley')],
    },
    {
      id: 'ops',
      label: 'Ops deck — airlock & suit locker',
      yPosition: deckFloorYFor(2),
      modules: [atSpine('ops')],
    },
    {
      id: 'science',
      label: 'Science deck — expanded med bay & sensor suite',
      yPosition: deckFloorYFor(3),
      modules: [atSpine('ops')],
    },
    {
      id: 'engineering',
      label: 'Engineering — reactor & drive glow',
      yPosition: deckFloorYFor(4),
      modules: [atSpine('engineering')],
    },
  ],
}
