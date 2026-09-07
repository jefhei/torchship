/**
 * M0-T5 — canonical fixture (d): pathological offset-hatch stress spec.
 *
 * The NEGATIVE fixture: a five-deck rig whose job is to carry every reject
 * case the M1-T3 spec validator must flag (M0-T2 decision 3), so the
 * validator and the M0-T6 invariant stubs have a concrete must-reject
 * spec to assert against. `expectValid: false` in the registry. Every deck
 * deviates from the canonical atSpine layout (./layout) in exactly one
 * declared way — except rig-0, a clean control deck the per-deck checks
 * should pass while the overall spec still fails:
 *
 *   rig-0  control                 — clean atSpine('head') join (control)
 *   rig-1  10 mm normal offset     — door 10 mm proud of the spine +z face
 *                                    → 10 mm open seam (> 2 mm watertight cap)
 *   rig-2  25 mm lateral offset    — door center 25 mm off the spine socket
 *                                    center → 25 mm hatch misalignment
 *                                    (> 5 mm hatch cap)
 *   rig-3  high-hatch height miss  — engineering's non-standard high-hatch
 *                                    (door center 1.2 m) placed
 *                                    xz-coincident with ops' standard
 *                                    side-door (center 1.0 m) → 200 mm
 *                                    door-center step (the M0-T2 measured
 *                                    pathological join)
 *   rig-4  floor-pin + grid        — galley offset.y = 0.2 m (floor-pinned
 *                                    violation) on a deck whose yPosition is
 *                                    50 mm off the canonical −4·3.2 m grid
 *
 * rig-3's placement arithmetic (white-box socket geometry): engineering's
 * high-hatch sits at local [2.25, 1.2, 0.6] on its +x face; ops' side-door
 * at local [−1.95, 1.0, −1.0] on its −x face. Opposing faces coincide in XZ
 * when ops' center is 4.2 m +x and 1.6 m +z of engineering's — so the rig
 * refs below differ by exactly (4.2, 0, 1.6). The 0.8×1.6 hatch opening
 * overlaps the 0.9×2.0 door in plan, so this is a real mating pair whose
 * door-center heights disagree by 200 mm — not a dangling socket.
 */

import type { ShipSpec } from '../types'
import { MM, deckFloorYFor } from '../types'
import { atSpine, spineAttachOffsetZ } from './layout'

/** The validator-reject categories this fixture carries (M0-T2 decision 3). */
export type StressDefectKind =
  'normal-offset' | 'lateral-offset' | 'hatch-height' | 'floor-pin' | 'deck-grid'

/** One declared defect: which deck carries it and what the validator must see. */
export interface StressDefect {
  id: string
  kind: StressDefectKind
  deckId: string
  detail: string
}

export const STRESS_SPEC: ShipSpec = {
  classId: 'hound',
  name: 'Offspec',
  registry: 'QA-RIG-1',
  seed: 0,
  decks: [
    {
      id: 'rig-0',
      label: 'Rig 0 — control (clean spine join)',
      yPosition: deckFloorYFor(0),
      modules: [atSpine('head')],
    },
    {
      id: 'rig-1',
      label: 'Rig 1 — 10 mm normal offset (open seam)',
      yPosition: deckFloorYFor(1),
      // 10 mm proud of the spine face along the join normal → 10 mm open seam.
      modules: [
        {
          moduleId: 'head',
          rotation: 0,
          offset: [0, 0, spineAttachOffsetZ('head') + 10 * MM],
        },
      ],
    },
    {
      id: 'rig-2',
      label: 'Rig 2 — 25 mm lateral offset (hatch misalignment)',
      yPosition: deckFloorYFor(2),
      // 25 mm off the spine socket center along the face → 25 mm misalignment.
      modules: [
        {
          moduleId: 'ops',
          rotation: 0,
          offset: [25 * MM, 0, spineAttachOffsetZ('ops')],
        },
      ],
    },
    {
      id: 'rig-3',
      label: 'Rig 3 — high-hatch 1.2 m ↔ standard door 1.0 m',
      yPosition: deckFloorYFor(3),
      modules: [
        atSpine('engineering'),
        // 4.2 m +x, 1.6 m +z of engineering (see header) → hatch and door
        // coincide in XZ; centers disagree by 0.2 m vertically.
        {
          moduleId: 'ops',
          rotation: 0,
          offset: [4.2, 0, spineAttachOffsetZ('engineering') + 1.6],
        },
      ],
    },
    {
      id: 'rig-4',
      label: 'Rig 4 — floor-pin violation + off-grid deck Y',
      // Off-grid: 50 mm above the canonical deckFloorYFor(4) = −12.8.
      yPosition: -12.75,
      // offset.y = 0.2 m: the module floor floats above the deck plate.
      modules: [
        {
          moduleId: 'galley',
          rotation: 0,
          offset: [0, 200 * MM, spineAttachOffsetZ('galley')],
        },
      ],
    },
  ],
}

/** The declared reject cases, one per defect deck (rig-0 carries none). */
export const STRESS_DEFECTS: readonly StressDefect[] = [
  {
    id: 'd1',
    kind: 'normal-offset',
    deckId: 'rig-1',
    detail:
      'head spine-door 10 mm proud of the spine +z face → 10 mm open seam, exceeds 2 mm watertight cap (M0-T2 measured: normal δ → open seam of exactly δ)',
  },
  {
    id: 'd2',
    kind: 'lateral-offset',
    deckId: 'rig-2',
    detail:
      'ops spine-door 25 mm off the spine socket center → 25 mm hatch misalignment, exceeds 5 mm hatch cap (M0-T2 measured: lateral δ → lateral misalignment of exactly δ)',
  },
  {
    id: 'd3',
    kind: 'hatch-height',
    deckId: 'rig-3',
    detail:
      'engineering high-hatch (door center 1.2 m, 0.8×1.6) xz-coincident with ops standard side-door (center 1.0 m, 0.9×2.0) → 200 mm door-center step (M0-T2 measured pathological join)',
  },
  {
    id: 'd4',
    kind: 'floor-pin',
    deckId: 'rig-4',
    detail:
      'galley offset.y = 0.2 m — floor-pinned assembly violation (ModuleRef.offset.y reserved 0)',
  },
  {
    id: 'd5',
    kind: 'deck-grid',
    deckId: 'rig-4',
    detail:
      'deck yPosition −12.75 instead of the canonical deckFloorYFor(4) = −12.8 — grid-consistency violation',
  },
]
