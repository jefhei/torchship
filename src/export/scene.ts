/**
 * M6-T1 — the glTF export scene builder.
 *
 * BUILD_PLAN M6-T1: "glTF export of full interior per export contract (deck
 * groups, named materials, meters, Y-up)". PRD §7's export contract:
 *
 *   "deck groups named `deck-0..N`, consistent unit scale (meters), Y-up with
 *    thrust axis = −Y (documented), material slots mapped to named export
 *    materials; validated by loading in Blender (§13)."
 *
 * This module turns an assembled ship (src/assembler `ShipAssembly`) into the
 * three.js scene the exporter serialises — WITHOUT re-deriving any geometry.
 * The scene is the M3-T7 draw plan, deck by deck:
 *
 *  - one `Group` per deck, named `deck-${deckIndex}` (the contract's name),
 *    placed at the deck's world floor `[0, floorY, 0]`;
 *  - one `Mesh` per merged material group and one `InstancedMesh` per instance
 *    batch, named by the scene graph's own id (`deck-${i}-…`), carrying the
 *    group's `BufferGeometry` / the batch's mould + placements — exactly what
 *    `deckDrawPlan` gives the live renderer (`src/player/deckGeometry.ts`), so
 *    the exported tree is the tree the walker walks;
 *  - one shared `MeshStandardMaterial` per §4 slot the ship draws, NAMED BY THE
 *    SLOT (`slotSurface` is the single theme → shading path, M4-T1), so the
 *    contract's "material slots mapped to named export materials" is data.
 *
 * UNITS + AXIS. The geometry is in meters (the whole project is), and each
 * deck's geometry is baked into the deck group's LOCAL space (the group carries
 * the floor translation), so the node hierarchy states the axis: deck groups sit
 * at descending Y (deck 0 at 0, the next at −3.2, …) — down under burn is toward
 * the drive, i.e. the thrust axis is −Y. Nothing scales, so the file is unit
 * scale (meters). `src/export/contract.ts` pins all of this on the serialised
 * document; `EXPORT_DOCUMENTATION` writes it into `asset.extras` so the contract
 * travels with the file.
 *
 * The scene is CPU-side only (no WebGL), so it is unit-testable headless; the
 * caller disposes its geometries + materials with `disposeExportScene`.
 */

import { Color, Group, InstancedMesh, Mesh, MeshStandardMaterial, Scene } from 'three'
import type { ShipAssembly } from '../assembler'
import { placementMatrix } from '../kit/render/merged'
import { slotSurface } from '../kit/render/slotSurfaces'
import { DEFAULT_MATERIAL_THEME } from '../materials/themes'
import type { MaterialTheme } from '../materials/theme'
import { MATERIAL_SLOTS } from '../types'
import type { MaterialSlot, Transform3 } from '../types'
import { deckDrawPlan } from '../player/deckGeometry'

/** The scene-graph name of a deck group — the export contract's `deck-0..N`. */
export function deckNodeName(deckIndex: number): string {
  return `deck-${deckIndex}`
}

/** The glTF scene name for a ship (a plain name the file carries). */
export function exportSceneName(shipName: string): string {
  const trimmed = shipName.trim()
  return trimmed === '' ? 'torchship' : trimmed
}

/**
 * The §4 slots an assembled ship actually draws, in the canonical
 * `MATERIAL_SLOTS` order and each once — the set of export materials the
 * contract requires (one named material per drawn slot).
 */
export function drawnSlots(assembly: ShipAssembly): MaterialSlot[] {
  const seen = new Set<MaterialSlot>()
  for (const deck of assembly.decks) {
    for (const plan of deck.groups) seen.add(plan.group.materialSlot)
    for (const plan of deck.batches) seen.add(plan.batch.materialSlot)
  }
  return MATERIAL_SLOTS.filter((slot) => seen.has(slot))
}

/**
 * One §4 slot as a named three material: the theme's surface for that slot
 * (`slotSurface` — the same value the live renderer spends) with `name = slot`.
 * The name IS the export contract's slot → material mapping.
 */
export function exportMaterial(
  slot: MaterialSlot,
  theme: MaterialTheme = DEFAULT_MATERIAL_THEME,
): MeshStandardMaterial {
  const surface = slotSurface(slot, theme)
  const material = new MeshStandardMaterial({
    color: new Color(surface.color),
    emissive: new Color(surface.emissive),
    emissiveIntensity: surface.emissiveIntensity,
    metalness: surface.metalness,
    roughness: surface.roughness,
  })
  material.name = slot
  return material
}

/** A placement translated into a deck group's local space (floor at y = 0). */
function localPlacement(transform: Transform3, floorY: number): Transform3 {
  const [x, y, z] = transform.position
  return { ...transform, position: [x, y - floorY, z] }
}

/** The scene the exporter serialises, plus the materials it owns. */
export interface ExportScene {
  scene: Scene
  /** One named material per drawn §4 slot, in `drawnSlots` order. */
  materials: MeshStandardMaterial[]
}

/**
 * Build the export scene for an assembled ship: the deck groups, their meshes /
 * instanced meshes (from the M3-T7 draw plan, localised to each deck floor) and
 * the shared named materials. Nothing is re-derived from the assembly beyond
 * the plan `deckDrawPlan` already builds for the renderer.
 */
export function buildExportScene(
  assembly: ShipAssembly,
  theme: MaterialTheme = DEFAULT_MATERIAL_THEME,
): ExportScene {
  const scene = new Scene()
  scene.name = exportSceneName(assembly.spec.name)

  const slots = drawnSlots(assembly)
  const materialFor = new Map<MaterialSlot, MeshStandardMaterial>()
  for (const slot of slots) materialFor.set(slot, exportMaterial(slot, theme))
  const materials = slots.map((slot) => materialFor.get(slot)!)

  for (const deck of assembly.decks) {
    const plan = deckDrawPlan(deck)
    const group = new Group()
    group.name = deckNodeName(deck.deckIndex)
    group.position.set(0, deck.floorY, 0)

    for (const call of plan) {
      const material = materialFor.get(call.materialSlot)
      if (material === undefined) continue // unreachable: drawnSlots covers every plan slot

      if (call.kind === 'merged') {
        // Bake the deck-local frame: the group carries the floor translation.
        call.geometry.translate(0, -deck.floorY, 0)
        const mesh = new Mesh(call.geometry, material)
        mesh.name = call.id
        group.add(mesh)
      } else {
        const instanced = new InstancedMesh(
          call.geometry,
          material,
          call.placements.length,
        )
        instanced.name = call.id
        for (let i = 0; i < call.placements.length; i++) {
          instanced.setMatrixAt(
            i,
            placementMatrix(localPlacement(call.placements[i], deck.floorY)),
          )
        }
        instanced.instanceMatrix.needsUpdate = true
        group.add(instanced)
      }
    }

    scene.add(group)
  }

  return { scene, materials }
}

/** Free every geometry + material a built export scene owns. */
export function disposeExportScene(exported: ExportScene): void {
  exported.scene.traverse((object) => {
    const mesh = object as Mesh
    if (mesh.geometry !== undefined) mesh.geometry.dispose()
  })
  for (const material of exported.materials) material.dispose()
}
