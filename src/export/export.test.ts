import { describe, expect, it } from 'vitest'
import { assembleShip } from '../assembler'
import type { ShipAssembly } from '../assembler'
import { SHIP_FIXTURES, getShipFixture } from '../fixtures/registry'
import { drawCallTally } from '../assembler/drawCalls'
import { MATERIAL_SLOTS } from '../types'
import {
  assertExportValid,
  deckNodeName,
  exportGltf,
  exportProblems,
  gltfFileName,
  readVec3Accessor,
  toGltfJson,
  type GltfDocument,
} from './index'

const REAL_SHIP_IDS = ['patrol', 'long-haul', 'science'] as const

function assemble(id: (typeof SHIP_FIXTURES)[number]['id']): ShipAssembly {
  const fixture = getShipFixture(id)
  return assembleShip(fixture.spec, { requireValidSpec: fixture.expectValid })
}

describe('M6-T1 export — the pipeline on every canonical ship', () => {
  for (const id of [...REAL_SHIP_IDS, 'stress'] as const) {
    it(`${id}: serialises to a contract-valid glTF document`, async () => {
      const assembly = assemble(id)
      const gltf = await exportGltf(assembly)
      expect(gltf.asset.version).toBe('2.0')
      expect(gltf.asset.generator).toContain('GLTFExporter')
      expect(exportProblems(gltf, assembly)).toEqual([])
      expect(() => assertExportValid(gltf, assembly)).not.toThrow()
    })

    it(`${id}: root scene nodes are the deck groups, nose → aft, descending in Y`, async () => {
      const assembly = assemble(id)
      const gltf = await exportGltf(assembly)
      const nodes = gltf.nodes ?? []
      const rootNames = (gltf.scenes?.[0]?.nodes ?? []).map((i) => nodes[i]?.name)
      expect(rootNames).toEqual(
        assembly.decks.map((deck) => deckNodeName(deck.deckIndex)),
      )
      const ys = (gltf.scenes?.[0]?.nodes ?? []).map(
        (i) => nodes[i]?.translation?.[1] ?? 0,
      )
      for (let i = 1; i < ys.length; i++) expect(ys[i]).toBeLessThan(ys[i - 1])
      assembly.decks.forEach((deck, i) => {
        expect(nodes[gltf.scenes![0].nodes![i]]?.translation?.[1] ?? 0).toBeCloseTo(
          deck.floorY,
          9,
        )
      })
    })

    it(`${id}: materials are the drawn §4 slots, named, unique, every primitive wired`, async () => {
      const assembly = assemble(id)
      const gltf = await exportGltf(assembly)
      const names = (gltf.materials ?? []).map((material) => material.name)
      expect(new Set(names).size).toBe(names.length)
      for (const name of names) expect(MATERIAL_SLOTS).toContain(name)
      const drawn = new Set<string>()
      for (const deck of assembly.decks) {
        for (const plan of deck.groups) drawn.add(plan.group.materialSlot)
        for (const plan of deck.batches) drawn.add(plan.batch.materialSlot)
      }
      expect(new Set(names)).toEqual(drawn)
      for (const mesh of gltf.meshes ?? []) {
        for (const primitive of mesh.primitives) {
          const material = gltf.materials?.[primitive.material ?? -1]
          expect(MATERIAL_SLOTS).toContain(material?.name)
          expect(primitive.attributes.NORMAL).toBeDefined()
        }
      }
    })

    it(`${id}: one mesh node per draw call, named by the scene graph`, async () => {
      const assembly = assemble(id)
      const gltf = await exportGltf(assembly)
      const nodes = gltf.nodes ?? []
      let total = 0
      assembly.decks.forEach((deck, index) => {
        const node = nodes.find((candidate) => candidate.name === deckNodeName(index))!
        const expected = [
          ...deck.groups.map((plan) => plan.group.id),
          ...deck.batches.map((plan) => plan.batch.id),
        ]
        expect((node.children ?? []).map((i) => nodes[i]?.name)).toEqual(expected)
        total += expected.length
      })
      expect(total).toBe(drawCallTally(assembly).total)
    })
  }
})

describe('M6-T1 export — instancing + document shape', () => {
  it('declares EXT_mesh_gpu_instancing and every instanced node carries a matrix', async () => {
    const assembly = assemble('patrol')
    const gltf = await exportGltf(assembly)
    expect(gltf.extensionsUsed).toContain('EXT_mesh_gpu_instancing')
    const instanced = (gltf.nodes ?? []).filter(
      (node) => node.extensions?.EXT_mesh_gpu_instancing !== undefined,
    )
    expect(instanced.length).toBe(
      assembly.decks.reduce((n, d) => n + d.batches.length, 0),
    )
    for (const node of instanced) {
      const ext = node.extensions!.EXT_mesh_gpu_instancing as {
        attributes: { TRANSLATION: number }
      }
      expect(readVec3Accessor(gltf, ext.attributes.TRANSLATION).length).toBeGreaterThan(
        0,
      )
    }
  })

  it('a merged group’s POSITION bounds are the localised geometry’s own bounds', async () => {
    const assembly = assemble('patrol')
    const gltf = await exportGltf(assembly)
    const nodes = gltf.nodes ?? []
    const deck = assembly.decks[1] // a non-zero floor (world −3.2) — localisation shows
    const node = nodes.find(
      (candidate) => candidate.name === deckNodeName(deck.deckIndex),
    )!
    const firstGroup = deck.groups[0]
    const child = (node.children ?? [])
      .map((i) => nodes[i])
      .find((candidate) => candidate?.name === firstGroup.group.id)!
    const accessor =
      gltf.accessors?.[
        gltf.meshes?.[child.mesh!]?.primitives[0]?.attributes.POSITION ?? -1
      ]
    expect(accessor?.min).toBeDefined()
    // The deck's plate-bearing merged groups sit inside one storey of the floor.
    expect(accessor!.min![1]).toBeGreaterThan(-1)
    expect(accessor!.max![1]).toBeLessThan(4)
  })

  it('two exports of the same assembly are byte-identical', async () => {
    const assembly = assemble('patrol')
    const a = await exportGltf(assembly)
    const b = await exportGltf(assembly)
    expect(toGltfJson(a)).toBe(toGltfJson(b))
  })

  it('toGltfJson round-trips and gltfFileName slugs the ship name', async () => {
    const assembly = assemble('patrol')
    const gltf = await exportGltf(assembly)
    const round = JSON.parse(toGltfJson(gltf)) as GltfDocument
    expect(round).toEqual(gltf)
    expect(gltfFileName('Firebrand')).toBe('firebrand.gltf')
    expect(gltfFileName('Long-Haul Cargo "Vagabond"')).toBe(
      'long-haul-cargo-vagabond.gltf',
    )
    expect(gltfFileName('   ')).toBe('torchship.gltf')
  })
})

describe('M6-T1 export — the contract checker catches drift', () => {
  async function valid(): Promise<{ gltf: GltfDocument; assembly: ShipAssembly }> {
    const assembly = assemble('patrol')
    return { gltf: await exportGltf(assembly), assembly }
  }

  it('rejects a non-document', () => {
    const assembly = assemble('patrol')
    expect(exportProblems(null, assembly)).toEqual([
      'export: not a glTF document object',
    ])
    expect(exportProblems('nope', assembly).length).toBe(1)
  })

  it('flags a stripped asset.extras (units / up axis / thrust axis)', async () => {
    const { gltf, assembly } = await valid()
    const broken = structuredClone(gltf)
    delete (broken.asset as { extras?: unknown }).extras
    const problems = exportProblems(broken, assembly)
    expect(problems.some((p) => p.includes('asset.extras.units'))).toBe(true)
    expect(problems.some((p) => p.includes('asset.extras.upAxis'))).toBe(true)
    expect(problems.some((p) => p.includes('asset.extras.thrustAxis'))).toBe(true)
  })

  it('flags a missing / renamed / extra deck group', async () => {
    const { gltf, assembly } = await valid()
    const renamed = structuredClone(gltf)
    renamed.nodes![renamed.scenes![0].nodes![3]!].name = 'deprecated-deck'
    const problems = exportProblems(renamed, assembly)
    expect(problems.some((p) => p.includes("missing deck group 'deck-3'"))).toBe(true)
    expect(problems.some((p) => p.includes('unexpected root node'))).toBe(true)
  })

  it('flags a node scale (the export is meters at unit scale)', async () => {
    const { gltf, assembly } = await valid()
    const broken = structuredClone(gltf)
    broken.nodes![broken.scenes![0].nodes![0]!].scale = [2, 2, 2]
    const problems = exportProblems(broken, assembly)
    expect(problems.some((p) => p.includes('carries a scale'))).toBe(true)
  })

  it('flags a deck group off the spine origin or off its floor', async () => {
    const { gltf, assembly } = await valid()
    const shifted = structuredClone(gltf)
    const deck1 = shifted.scenes![0].nodes![1]!
    shifted.nodes![deck1].translation = [0.5, -3.2, 0]
    const problems = exportProblems(shifted, assembly)
    expect(problems.some((p) => p.includes('offset in X/Z'))).toBe(true)
  })

  it('flags non-descending deck floors', async () => {
    const { gltf, assembly } = await valid()
    const broken = structuredClone(gltf)
    broken.nodes![broken.scenes![0].nodes![1]!].translation = [0, 5, 0]
    const problems = exportProblems(broken, assembly)
    expect(problems.some((p) => p.includes('do not descend in Y'))).toBe(true)
  })

  it('flags a dropped material and an unwired primitive', async () => {
    const { gltf, assembly } = await valid()
    const dropped = structuredClone(gltf)
    dropped.materials = dropped.materials!.slice(0, 1)
    let problems = exportProblems(dropped, assembly)
    expect(problems.some((p) => p.includes('material(s) — expected'))).toBe(true)

    const unwired = structuredClone(gltf)
    delete unwired.meshes![0].primitives[0].material
    problems = exportProblems(unwired, assembly)
    expect(problems.some((p) => p.includes('has no material'))).toBe(true)

    const renamed = structuredClone(gltf)
    renamed.materials![0].name = 'chrome'
    problems = exportProblems(renamed, assembly)
    expect(problems.some((p) => p.includes('is not a §4 material slot'))).toBe(true)
  })

  it('flags a primitive without NORMAL', async () => {
    const { gltf, assembly } = await valid()
    const broken = structuredClone(gltf)
    delete broken.meshes![0].primitives[0].attributes.NORMAL
    const problems = exportProblems(broken, assembly)
    expect(problems.some((p) => p.includes('has no NORMAL attribute'))).toBe(true)
  })

  it('flags deck children that are not the draw plan', async () => {
    const { gltf, assembly } = await valid()
    const broken = structuredClone(gltf)
    const deck0 = broken.scenes![0].nodes![0]!
    broken.nodes![deck0].children = broken.nodes![deck0].children!.slice(0, 2)
    const problems = exportProblems(broken, assembly)
    expect(
      problems.some((p) => p.includes('mesh nodes differ from its draw plan')),
    ).toBe(true)
  })

  it('flags a lost instancing extension on an instance batch', async () => {
    const { gltf, assembly } = await valid()
    const broken = structuredClone(gltf)
    const instanced = broken.nodes!.findIndex(
      (node) => node.extensions?.EXT_mesh_gpu_instancing !== undefined,
    )
    delete broken.nodes![instanced].extensions
    const problems = exportProblems(broken, assembly)
    expect(
      problems.some((p) =>
        p.includes('carries no EXT_mesh_gpu_instancing TRANSLATION'),
      ),
    ).toBe(true)
  })

  it('flags a mutated instance translation (fidelity, not just structure)', async () => {
    const { gltf, assembly } = await valid()
    const broken = structuredClone(gltf)
    const instanced = broken.nodes!.find(
      (node) => node.extensions?.EXT_mesh_gpu_instancing !== undefined,
    )!
    const ext = instanced.extensions!.EXT_mesh_gpu_instancing as {
      attributes: { TRANSLATION: number }
    }
    // Point at a different (shorter) accessor so the count/bounds disagree.
    const other = broken.accessors!.findIndex(
      (accessor) =>
        accessor.type === 'VEC3' &&
        accessor !== broken.accessors![ext.attributes.TRANSLATION],
    )
    ext.attributes.TRANSLATION = other
    const problems = exportProblems(broken, assembly)
    expect(
      problems.some((p) => p.includes('placements differ from the assembly')),
    ).toBe(true)
  })
})
