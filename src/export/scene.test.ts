import { describe, expect, it, vi } from 'vitest'
import { InstancedMesh, Matrix4, Mesh } from 'three'
import type { BufferGeometry, Group, Material } from 'three'
import { assembleShip } from '../assembler'
import { PATROL_SPEC } from '../fixtures'
import { SHIP_FIXTURES } from '../fixtures/registry'
import { MATERIAL_SLOTS } from '../types'
import { geometryBounds } from '../kit/render/merged'
import {
  buildExportScene,
  deckNodeName,
  disposeExportScene,
  drawnSlots,
  exportMaterial,
  exportSceneName,
  type ExportScene,
} from './scene'

function patrol() {
  return assembleShip(PATROL_SPEC)
}

describe('M6-T1 export scene — materials', () => {
  it('drawnSlots is the ship’s slots in §4 order, each once', () => {
    for (const id of ['patrol', 'long-haul', 'science'] as const) {
      const fixture = SHIP_FIXTURES.find((f) => f.id === id)!
      const slots = drawnSlots(assembleShip(fixture.spec))
      expect(slots).toEqual([...MATERIAL_SLOTS])
      expect(new Set(slots).size).toBe(slots.length)
    }
  })

  it('exportMaterial names the material by its slot and carries the theme surface', () => {
    for (const slot of MATERIAL_SLOTS) {
      const material = exportMaterial(slot)
      expect(material.name).toBe(slot)
      expect(material.type).toBe('MeshStandardMaterial')
      expect(Number.isFinite(material.roughness)).toBe(true)
    }
    // Distinct slots resolve to distinct surfaces (the M4-T1 palette is not flat).
    const colors = MATERIAL_SLOTS.map((slot) => exportMaterial(slot).color.getHex())
    expect(new Set(colors).size).toBe(MATERIAL_SLOTS.length)
  })

  it('the standard theme’s emissive slots emit and the rest are inert', () => {
    for (const slot of MATERIAL_SLOTS) {
      const material = exportMaterial(slot)
      const emissive = material.emissive.r + material.emissive.g + material.emissive.b
      if (slot === 'panel-light' || slot === 'screen' || slot === 'coffee-accent') {
        expect(material.emissiveIntensity).toBeGreaterThan(0)
        expect(emissive).toBeGreaterThan(0)
      } else {
        expect(material.emissiveIntensity).toBe(0)
        expect(emissive).toBe(0)
      }
    }
  })
})

describe('M6-T1 export scene — structure', () => {
  it('builds one deck group per deck at its floor, named by the contract', () => {
    const assembly = patrol()
    const { scene, materials } = buildExportScene(assembly)
    try {
      expect(scene.name).toBe('Firebrand')
      expect(scene.children.length).toBe(assembly.decks.length)
      assembly.decks.forEach((deck, index) => {
        const group = scene.children[index] as Group
        expect(group.name).toBe(deckNodeName(index))
        expect(group.name).toBe(`deck-${index}`)
        expect(group.position.x).toBe(0)
        expect(group.position.y).toBe(deck.floorY)
        expect(group.position.z).toBe(0)
      })
      expect(materials.map((material) => material.name)).toEqual([...MATERIAL_SLOTS])
    } finally {
      disposeExportScene({ scene, materials })
    }
  })

  it('each deck group’s children are its draw-call ids in plan order', () => {
    const assembly = patrol()
    const { scene, materials } = buildExportScene(assembly)
    try {
      assembly.decks.forEach((deck, index) => {
        const group = scene.children[index] as Group
        const expectedIds = [
          ...deck.groups.map((plan) => plan.group.id),
          ...deck.batches.map((plan) => plan.batch.id),
        ]
        expect(group.children.map((child) => child.name)).toEqual(expectedIds)
      })
    } finally {
      disposeExportScene({ scene, materials })
    }
  })

  it('every mesh draws its slot’s named material', () => {
    const assembly = patrol()
    const { scene, materials } = buildExportScene(assembly)
    try {
      const byName = new Map(materials.map((material) => [material.name, material]))
      let meshes = 0
      for (const deck of assembly.decks) {
        for (const plan of deck.groups) {
          const child = findChild(scene, deckNodeName(deck.deckIndex), plan.group.id)
          expect((child as Mesh).material).toBe(byName.get(plan.group.materialSlot))
          meshes++
        }
        for (const plan of deck.batches) {
          const child = findChild(scene, deckNodeName(deck.deckIndex), plan.batch.id)
          expect((child as Mesh).material).toBe(byName.get(plan.batch.materialSlot))
          meshes++
        }
      }
      expect(meshes).toBeGreaterThan(0)
    } finally {
      disposeExportScene({ scene, materials })
    }
  })

  it('localises each deck’s merged geometry into its storey (floor at the group)', () => {
    const assembly = patrol()
    const { scene, materials } = buildExportScene(assembly)
    try {
      let checked = 0
      assembly.decks.forEach((deck, index) => {
        // Merged group geometry is baked into the deck group's frame; the
        // instanced moulds are relative to their placements and stay tiny, so
        // only the merged groups state the storey.
        for (const plan of deck.groups) {
          const child = findChild(scene, deckNodeName(index), plan.group.id) as Mesh
          const bounds = geometryBounds(child.geometry)
          expect(bounds.min[1]).toBeGreaterThan(-1)
          expect(bounds.max[1]).toBeLessThan(4)
          checked++
        }
        expect(deck.floorY).toBeCloseTo(-index * 3.2, 9)
      })
      expect(checked).toBeGreaterThan(0)
    } finally {
      disposeExportScene({ scene, materials })
    }
  })

  it('instances carry the deck-local placement (world − floorY)', () => {
    const assembly = patrol()
    const { scene, materials } = buildExportScene(assembly)
    try {
      let checked = 0
      assembly.decks.forEach((deck, index) => {
        for (const plan of deck.batches) {
          const child = findChild(
            scene,
            deckNodeName(index),
            plan.batch.id,
          ) as InstancedMesh
          const matrix = new Matrix4()
          child.getMatrixAt(0, matrix)
          const [x, y, z] = plan.batch.placements[0].position
          expect(matrix.elements[12]).toBeCloseTo(x, 4)
          expect(matrix.elements[13]).toBeCloseTo(y - deck.floorY, 4)
          expect(matrix.elements[14]).toBeCloseTo(z, 4)
          expect(child.count).toBe(plan.batch.placements.length)
          checked++
        }
      })
      expect(checked).toBeGreaterThan(0)
    } finally {
      disposeExportScene({ scene, materials })
    }
  })

  it('disposeExportScene frees every geometry and material it owns', () => {
    const assembly = patrol()
    const exported = buildExportScene(assembly)
    const geometries: BufferGeometry[] = []
    exported.scene.traverse((object) => {
      const mesh = object as Mesh
      if (mesh.geometry !== undefined) geometries.push(mesh.geometry)
    })
    expect(geometries.length).toBeGreaterThan(0)
    const geometrySpies = geometries.map((g) => vi.spyOn(g, 'dispose'))
    const materialSpies = exported.materials.map((m: Material) =>
      vi.spyOn(m, 'dispose'),
    )
    disposeExportScene(exported)
    for (const spy of geometrySpies) expect(spy).toHaveBeenCalled()
    for (const spy of materialSpies) expect(spy).toHaveBeenCalled()
  })

  it('exportSceneName trims and falls back for a blank ship name', () => {
    expect(exportSceneName('Firebrand')).toBe('Firebrand')
    expect(exportSceneName('  Firebrand  ')).toBe('Firebrand')
    expect(exportSceneName('   ')).toBe('torchship')
  })
})

function findChild(scene: ExportScene['scene'], deckName: string, id: string) {
  const group = scene.children.find((child) => child.name === deckName) as Group
  return group.children.find((child) => child.name === id)!
}
