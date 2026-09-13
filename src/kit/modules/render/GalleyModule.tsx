/**
 * M2-T3 — the authored galley/bunk module as an R3F component.
 *
 * The composition surface for the M2-T7 standalone harness and (through the
 * M3 assembler) the walkthrough: it renders the module's OWN flattened part
 * list, so what ships is exactly what the tests measure — the geometry comes
 * from `moduleParts(GALLEY_MODULE)` (the M2-T1 builders, rule 8), never from
 * hand-placed meshes.
 *
 * The placement is the module's pose inside a deck (offset + quarter-turn yaw);
 * the M3-T1 assembler supplies it from the spec's ModuleRef.
 *
 * jsdom has no WebGL, so this component is exercised by tsc and by the M2-T7
 * harness inside a real <Canvas> — the maths it renders is tested headless in
 * src/kit/modules/galley.test.ts (see references/testing-r3f-in-jsdom.md).
 */

import type { PrimitivePlacement } from '../../types'
import { GALLEY_MODULE } from '../galley'
import { moduleParts } from '../types'
import { KitParts } from '../../render/KitParts'
import { boxEuler, vec3Tuple } from '../../render/transforms'

/** R3F group props for a module placement (deck-local position + yaw). */
function placementProps({ position, rotation }: PrimitivePlacement) {
  return {
    position: position === undefined ? undefined : vec3Tuple(position),
    rotation: boxEuler(rotation ?? 0),
  }
}

/** The galley/bunk: shell, hatches, berths, mess, pantry, coffee, head. */
export function GalleyModule({ position, rotation }: PrimitivePlacement) {
  return (
    <group {...placementProps({ position, rotation })}>
      <KitParts parts={moduleParts(GALLEY_MODULE)} />
    </group>
  )
}
