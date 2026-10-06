/**
 * M6-T3 — the shareable authoring state (PRD §6.1 "autosave of the selected
 * spec + seed to localStorage; shareable URL encodes spec + seed").
 *
 * A `ShareState` is exactly what a link (or an autosave entry) has to carry to
 * reproduce the ship the author was looking at:
 *
 *  - `spec`        — the Ship Spec (§7): decks, module refs, identity;
 *  - `seed`        — the variation seed for the M4-T4 worn-detail pass. It is
 *                    a FIRST-CLASS control, not just `spec.seed`: the preset
 *                    picker loads a spec whose `seed` field is the fixture's
 *                    canonical seed, and the seed stepper overrides it — the
 *                    effective spec is `{ ...spec, seed }` (see
 *                    `effectiveSpec` in ./resolve). PRD §6.1 "seed control for
 *                    minor kit variation";
 *  - `wearDensity` — the worn-detail rung the ship was assembled at (PRD §10
 *                    rung 4). Carried so a shared link reproduces the EXACT
 *                    assembled ship (a rung change changes the geometry).
 */

import type { WearDensity } from '../assembler'
import type { ShipSpec } from '../types'

/** The complete shareable state: the selected spec + seed (+ wear rung). */
export interface ShareState {
  /** The selected Ship Spec (its own `seed` field is the preset's canonical seed). */
  spec: ShipSpec
  /** The selected variation seed (overrides `spec.seed` when assembled). */
  seed: number
  /** The worn-detail density the ship is assembled with. */
  wearDensity: WearDensity
}
