/**
 * M0-T5 — canonical fixture (a): Patrol, the default 5-deck corvette.
 *
 * The hero preset: Hound-class light corvette "Firebrand" (the locked
 * vessel identity, BUILD_PLAN rule 9). Five decks nose → aft, one room per
 * deck, every room module type exercised once:
 *
 *   deck 0  head         — crash couches, sensor wall (bridge)
 *   deck 1  crew         — galley & bunks (coffee-station deck; the M3-T6
 *                          spawn deck — foot of the spine)
 *   deck 2  ops          — airlock + suit locker, workbench, med bay
 *   deck 3  engineering  — reactor access, drive glow window
 *   deck 4  aft          — cargo & spares (storage module)
 *
 * All refs are `atSpine(...)` poses from ./layout: rotation 0 on the spine's
 * +z face, floor-pinned, standard 1.0 m door centers — a spec the M1-T3
 * validator must pass and every [auto] invariant must hold on.
 */

import type { ShipSpec } from '../types'
import { deckFloorYFor } from '../types'
import { atSpine } from './layout'

export const PATROL_SPEC: ShipSpec = {
  classId: 'hound',
  name: 'Firebrand',
  registry: 'HCS-427',
  seed: 1,
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
      id: 'aft',
      label: 'Aft hold — cargo & spares',
      yPosition: deckFloorYFor(4),
      modules: [atSpine('storage')],
    },
  ],
}
