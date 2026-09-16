/**
 * M2-T6 — the authored spine band (vertical ladder / crawl shaft) as an R3F
 * component.
 *
 * The composition surface for the M2-T7 standalone harness and (through the
 * M3 assembler) the walkthrough: it renders the module's OWN flattened part
 * list, so what ships is exactly what the tests measure — the geometry comes
 * from `moduleParts(SPINE_MODULE)` (the M2-T1 builders, rule 8), never from
 * hand-placed meshes.
 *
 * The placement is the band's pose on its deck (deck-local position + yaw).
 * The M3-T1 assembler instantiates one band per deck at the deck origin; the
 * pose is a prop so the harness can also stack bands by hand.
 *
 * jsdom has no WebGL, so this component is exercised by tsc and by the M2-T7
 * harness inside a real <Canvas> — the maths it renders is tested headless in
 * src/kit/modules/spine.test.ts (see references/testing-r3f-in-jsdom.md).
 */

import type { PrimitivePlacement } from '../../types'
import { SPINE_MODULE } from '../spine'
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

/** The spine band: shaft floor + crawl opening, four face walls, ladder, lights. */
export function SpineModule({ position, rotation }: PrimitivePlacement) {
  return (
    <group {...placementProps({ position, rotation })}>
      <KitParts parts={moduleParts(SPINE_MODULE)} />
    </group>
  )
}
