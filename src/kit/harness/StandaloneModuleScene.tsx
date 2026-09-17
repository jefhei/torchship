/**
 * M2-T7 — the standalone module scene as an R3F component.
 *
 * Mounts exactly ONE authored module (by id) at a deck-local pose — the
 * harness's composition surface, the thing the M2 machine gate means by
 * "renders in harness". It carries no lighting rig, no deck, no sibling
 * modules: what you see is the module alone, which is what makes it useful for
 * reviewing a single room (M4 lighting) and for the harness tests.
 *
 * The M3 assembler does NOT use this: it places modules itself from the spec
 * (src/types/scene.ts). The kit itself stays unmounted in the app (the M1-T1
 * viewport stays empty until M3-T1 — see src/Viewport.tsx).
 */

import type { PrimitivePlacement } from '../types'
import { getAuthoredModule } from '../modules/registry'
import { moduleSceneElement } from './components'

/** One module id + its deck-local placement. */
export interface StandaloneModuleSceneProps extends PrimitivePlacement {
  /** Authored module id ('head', 'galley', …); unknown ids throw loudly. */
  moduleId: string
}

/** The chosen module, alone, at the given deck-local pose. */
export function StandaloneModuleScene({
  moduleId,
  position,
  rotation,
}: StandaloneModuleSceneProps) {
  return moduleSceneElement(getAuthoredModule(moduleId), { position, rotation })
}
