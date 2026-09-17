/**
 * M2-T7 — the standalone render surface: one component per authored module.
 *
 * "Each module renders standalone" (BUILD_PLAN M2-T7) means every authored
 * module has exactly one R3F component that draws THAT module and nothing else,
 * and the harness can mount it on its own. The map below is that gate's data:
 * `moduleComponentFor` fails loudly when a module has no component (a module can
 * never join the kit and be unrenderable), and `moduleSceneElement` is the
 * element the harness walks (src/kit/harness/renderTree.ts) and mounts
 * (src/kit/harness/StandaloneModuleScene.tsx).
 *
 * The components come from src/kit/modules/render/ — none of the harness's own
 * geometry, so what the harness measures is exactly what ships.
 */

import { createElement } from 'react'
import type { ReactElement } from 'react'
import type { PrimitivePlacement } from '../types'
import { EngineeringModule } from '../modules/render/EngineeringModule'
import { GalleyModule } from '../modules/render/GalleyModule'
import { HeadModule } from '../modules/render/HeadModule'
import { OpsModule } from '../modules/render/OpsModule'
import { SpineModule } from '../modules/render/SpineModule'
import { StorageModule } from '../modules/render/StorageModule'
import type { AuthoredModule } from '../modules/types'

/** A module's standalone render component (module-local placement in, mesh out). */
export type ModuleComponent = (props: PrimitivePlacement) => ReactElement

/** Module id → the component that renders it alone. One entry per M2-T2..T6 task. */
export const MODULE_COMPONENTS: Readonly<Record<string, ModuleComponent>> = {
  head: HeadModule,
  galley: GalleyModule,
  ops: OpsModule,
  engineering: EngineeringModule,
  storage: StorageModule,
  spine: SpineModule,
}

/** The component for a module; throws when the module cannot render standalone. */
export function moduleComponentFor(
  module: AuthoredModule,
  components: Readonly<Record<string, ModuleComponent>> = MODULE_COMPONENTS,
): ModuleComponent {
  const component = components[module.manifest.id]
  if (component === undefined) {
    const known = Object.keys(components).join(', ')
    throw new Error(
      `kit harness: module "${module.manifest.id}" has no standalone render component ` +
        `(components: ${known})`,
    )
  }
  return component
}

/** The element that renders ONE module alone at a deck-local pose. */
export function moduleSceneElement(
  module: AuthoredModule,
  placement: PrimitivePlacement = {},
  components: Readonly<Record<string, ModuleComponent>> = MODULE_COMPONENTS,
): ReactElement {
  return createElement(moduleComponentFor(module, components), placement)
}
