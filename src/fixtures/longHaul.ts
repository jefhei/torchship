/**
 * M0-T5 — canonical fixture (b): Long-Haul, the stretched cargo variant.
 *
 * Patrol + one extra aft cargo deck ("stretched cargo variant, extra
 * storage module", PRD §6.1): six decks nose → aft. A tramp-freighter
 * character, not the hero ship — same Hound class, own name/registry:
 *
 *   deck 0  head      — bridge
 *   deck 1  crew      — galley & bunks (spawn deck)
 *   deck 2  ops       — airlock + suit locker, workbench, med bay
 *   deck 3  engineering — reactor access, drive glow window
 *   deck 4  cargo-a   — container tie-downs (storage)
 *   deck 5  cargo-b   — spares & workshop stores (storage, the stretch)
 *
 * The doubled storage module is the fixture's point: it proves the spec
 * format and the kit support repeated instances of one module type.
 */

import type { ShipSpec } from '../types'
import { deckFloorYFor } from '../types'
import { atSpine } from './layout'

export const LONG_HAUL_SPEC: ShipSpec = {
  classId: 'hound',
  name: 'Vagabond',
  registry: 'HCS-461',
  seed: 2,
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
      label: 'Ops deck — airlock, suit locker, med bay',
      yPosition: deckFloorYFor(2),
      modules: [atSpine('ops')],
    },
    {
      id: 'engineering',
      label: 'Engineering — reactor & drive glow',
      yPosition: deckFloorYFor(3),
      modules: [atSpine('engineering')],
    },
    {
      id: 'cargo-a',
      label: 'Cargo hold A — container tie-downs',
      yPosition: deckFloorYFor(4),
      modules: [atSpine('storage')],
    },
    {
      id: 'cargo-b',
      label: 'Cargo hold B — spares & workshop stores',
      yPosition: deckFloorYFor(5),
      modules: [atSpine('storage')],
    },
  ],
}
