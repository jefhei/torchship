/**
 * M2-T2 — the authored-module vocabulary (BUILD_PLAN M2-T2..T6).
 *
 * A room module is authored ONCE as a list of named ASSEMBLIES: each assembly
 * is a kit primitive's parts (from the M2-T1 builders — never hand-placed
 * meshes, BUILD_PLAN rule 8) plus its module-local placement. The module's
 * manifest is the M1-T2 `KitModule` contract the M3 assembler reads; the
 * assemblies are the geometry behind it, in module-local meters on the M1-T2
 * authoring frame (floor at local y = 0, footprint centred on the origin in
 * XZ, the standardized `spine-door` flush in the −z face).
 *
 * One source of truth, no drift:
 *  - `moduleParts(module)` flattens every assembly into module-local space for
 *    rendering (src/kit/modules/render/) and the M3-T1 merge/instance pass;
 *  - `moduleCollisionBoxes(module)` is the M3-T3 hull input: one box per part
 *    of each `solid` assembly, so a doorway stays open (the wall's piers and
 *    lintel are separate parts — a coarse per-assembly box would seal it);
 *  - `moduleMaterialSlots(module)` is what the M2-T7 "slots fully assigned"
 *    harness diffs against the module's parts.
 */

import type { Aabb3, Facing, KitModule, MaterialSlot } from '../../types'
import type { KitPart, PrimitivePlacement } from '../types'
import { partBounds, partMaterialSlots, partsBounds } from '../parts'
import { placeParts } from './placement'

/**
 * The four vertical faces of a ship module, in the canonical order the spine
 * band's doorways are authored and synthesized in (src/validation/sockets.ts
 * `spineBandDoors`, the M0-T2 white-box band). A room presents ONE of these
 * as its `spine-door`; the shaft (M2-T6) presents one doorway per face.
 */
export const SHAFT_FACES: readonly Facing[] = ['+z', '-z', '+x', '-x']

/** True when `id` names one of the shaft's four faces (a shaft doorway id). */
export function isShaftFace(id: string): id is Facing {
  return (SHAFT_FACES as readonly string[]).includes(id)
}

/**
 * One authored piece of a module: a primitive's parts + where the module puts
 * them. `solid` assemblies contribute collision boxes; `fillsSocket` marks the
 * assembly authored ON a door socket (the hatch), which seals the opening and
 * is therefore exempt from doorway-clearance checks.
 */
export interface ModuleAssembly {
  /** Assembly id, unique within its module ('wall-aft-spine', 'couch-pilot', …). */
  id: string
  /** The primitive-local parts this assembly contributes. */
  parts: readonly KitPart[]
  /** Module-local placement of `parts` (position in meters + quarter-turn yaw). */
  placement: PrimitivePlacement
  /** Solid geometry: one collision box per part. Omitted = walk-through fixture. */
  solid?: boolean
  /** Authored on a door socket and fills that opening. Omitted = ordinary part. */
  fillsSocket?: boolean
}

/** An authored room module: its contract entry plus the geometry behind it. */
export interface AuthoredModule {
  /** The M1-T2 kit-manifest entry the assembler reads (dims, sockets, hull). */
  manifest: KitModule
  /** Named assemblies, in build order. */
  assemblies: readonly ModuleAssembly[]
  /**
   * True for the SHIPPING SHAFT module (M2-T6 `spine`): it presents one
   * doorway per shaft face ('+z' / '−z' / '+x' / '−x') instead of the one
   * standardized `spine-door` a room presents, and the assembler instantiates
   * it once per deck rather than from a spec ref (src/types/ship.ts:
   * "the spine shaft is NOT referenced — the assembler synthesizes one spine
   * band per deck"). Omitted = an ordinary room module.
   */
  shaft?: boolean
}

/** An assembly's parts in module-local meters. */
export function assemblyParts(assembly: ModuleAssembly): KitPart[] {
  return placeParts(assembly.parts, assembly.placement)
}

/** Local-frame bounds of one assembly, placement applied. */
export function assemblyBounds(assembly: ModuleAssembly): Aabb3 {
  return partsBounds(assemblyParts(assembly))
}

/** Local-frame bounds of a set of assemblies (throws when the set is empty). */
export function assembliesBounds(assemblies: readonly ModuleAssembly[]): Aabb3 {
  if (assemblies.length === 0) {
    throw new Error('assembliesBounds: no assemblies to measure')
  }
  return partsBounds(assemblies.flatMap(assemblyParts))
}

/** Every part of the module, module-local meters, in build order. */
export function moduleParts(module: AuthoredModule): KitPart[] {
  return module.assemblies.flatMap(assemblyParts)
}

/** The parts of the module's `solid` assemblies, in build order. */
export function moduleSolidParts(module: AuthoredModule): KitPart[] {
  return module.assemblies
    .filter((assembly) => assembly.solid === true)
    .flatMap(assemblyParts)
}

/** One collision box per part of every `solid` assembly — the M3-T3 hull input. */
export function collisionBoxesFor(assemblies: readonly ModuleAssembly[]): Aabb3[] {
  return assemblies
    .filter((assembly) => assembly.solid === true)
    .flatMap((assembly) => assemblyParts(assembly).map(partBounds))
}

/** The module's collision boxes (the manifest hint must equal these). */
export function moduleCollisionBoxes(module: AuthoredModule): Aabb3[] {
  return collisionBoxesFor(module.assemblies)
}

/** The §4 slots the module's geometry actually draws from, canonical order. */
export function moduleMaterialSlots(module: AuthoredModule): MaterialSlot[] {
  return partMaterialSlots(moduleParts(module))
}

/**
 * The module's declared box in module-local meters: `dimensions` centred on
 * the origin in XZ with the floor at y = 0 (the authoring frame).
 */
export function moduleBounds(module: AuthoredModule): Aabb3 {
  const [width, height, depth] = module.manifest.dimensions
  return {
    min: [-width / 2, 0, -depth / 2],
    max: [width / 2, height, depth / 2],
  }
}

/** Look an assembly up by id (undefined when the module has no such assembly). */
export function findAssembly(
  module: AuthoredModule,
  id: string,
): ModuleAssembly | undefined {
  return module.assemblies.find((assembly) => assembly.id === id)
}
