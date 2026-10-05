import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { assembleShip } from '../assembler'
import type { ShipAssembly } from '../assembler'
import { getShipFixture } from '../fixtures/registry'
import { MATERIAL_SLOTS } from '../types'
import {
  assertBlenderValid,
  auditNormals,
  blenderValidation,
  blenderValidationProblems,
  deckGroupCheck,
  exportGltf,
  gltfFileName,
  materialCheck,
  readAccessorValues,
  readVec3Accessor,
  toGltfJson,
  type GltfDocument,
} from './index'

const REAL_SHIP_IDS = ['patrol', 'long-haul', 'science'] as const
const ALL_SHIP_IDS = [...REAL_SHIP_IDS, 'stress'] as const

function assemble(id: (typeof ALL_SHIP_IDS)[number]): ShipAssembly {
  const fixture = getShipFixture(id)
  return assembleShip(fixture.spec, { requireValidSpec: fixture.expectValid })
}

const exportCache = new Map<
  string,
  Promise<{ gltf: GltfDocument; assembly: ShipAssembly }>
>()

function exported(
  id: (typeof ALL_SHIP_IDS)[number],
): Promise<{ gltf: GltfDocument; assembly: ShipAssembly }> {
  let cached = exportCache.get(id)
  if (cached === undefined) {
    cached = (async () => {
      const assembly = assemble(id)
      return { gltf: await exportGltf(assembly), assembly }
    })()
    exportCache.set(id, cached)
  }
  return cached
}

/* ---------------------------------------------------------------- buffers */

function decodeUri(uri: string): Uint8Array {
  const base64 = uri.slice(uri.indexOf(',') + 1)
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

function encodeUri(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i])
  return `data:application/octet-stream;base64,${btoa(binary)}`
}

/** Mutate the float values of a VEC3 accessor in the document's buffer. */
function mutateVec3(
  gltf: GltfDocument,
  accessorIndex: number,
  fn: (index: number, value: [number, number, number]) => [number, number, number],
): void {
  const accessor = gltf.accessors![accessorIndex]
  const view = gltf.bufferViews![accessor.bufferView!]
  const buffer = gltf.buffers![view.buffer]
  const bytes = decodeUri(buffer.uri!)
  const data = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const base = (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0)
  const stride = view.byteStride ?? 12
  for (let i = 0; i < accessor.count; i++) {
    const at = base + i * stride
    const next = fn(i, [
      data.getFloat32(at, true),
      data.getFloat32(at + 4, true),
      data.getFloat32(at + 8, true),
    ])
    data.setFloat32(at, next[0], true)
    data.setFloat32(at + 4, next[1], true)
    data.setFloat32(at + 8, next[2], true)
  }
  buffer.uri = encodeUri(bytes)
}

function normalAccessorOf(gltf: GltfDocument, mesh = 0, primitive = 0): number {
  return gltf.meshes![mesh].primitives[primitive].attributes.NORMAL!
}

function positionAccessorOf(gltf: GltfDocument, mesh = 0, primitive = 0): number {
  return gltf.meshes![mesh].primitives[primitive].attributes.POSITION!
}

/* ------------------------------------------------------------------ tests */

describe('M6-T2 Blender validation — clean on the canonical ships', () => {
  for (const id of ALL_SHIP_IDS) {
    it(`${id}: loads clean (deck groups present, materials intact, no flipped normals)`, async () => {
      const { gltf, assembly } = await exported(id)
      const report = blenderValidation(gltf, assembly)
      expect(report.problems).toEqual([])
      expect(report.ok).toBe(true)
      expect(() => assertBlenderValid(gltf, assembly)).not.toThrow()

      // Deck groups: exactly the deck names, in order, each with meshes.
      expect(report.deckGroups.orderOk).toBe(true)
      expect(report.deckGroups.found).toEqual(assembly.decks.map((_, i) => `deck-${i}`))

      // Materials intact: one named material per drawn §4 slot.
      expect(new Set(report.materials.found)).toEqual(new Set(report.materials.drawn))
      expect(report.materials.drawn).toEqual([...MATERIAL_SLOTS])
      expect(report.materials.emissive).toEqual([
        'panel-light',
        'screen',
        'coffee-accent',
      ])

      // No flipped normals: every triangle winds with its vertex normals.
      expect(report.normals.primitives).toBeGreaterThan(0)
      expect(report.normals.triangles).toBeGreaterThan(0)
      expect(report.normals.flipped).toBe(0)
      expect(report.normals.nonUnit).toBe(0)
    })
  }

  it('the audit is deterministic (same document, same numbers)', async () => {
    const { gltf } = await exported('patrol')
    expect(auditNormals(gltf)).toEqual(auditNormals(gltf))
    expect(readAccessorValues(gltf, normalAccessorOf(gltf)).length).toBeGreaterThan(0)
  })
})

describe('M6-T2 Blender validation — the written .gltf round-trips through disk', () => {
  it('writes each ship to dist/export and re-validates the parsed file', async () => {
    const dir = resolve(process.cwd(), 'dist/export')
    mkdirSync(dir, { recursive: true })
    for (const id of ALL_SHIP_IDS) {
      const { gltf, assembly } = await exported(id)
      const text = toGltfJson(gltf)
      const file = resolve(dir, gltfFileName(assembly.spec.name))
      writeFileSync(file, text)
      // The written file is what Blender opens — parse it back and validate.
      const parsed = JSON.parse(readFileSync(file, 'utf8')) as GltfDocument
      expect(blenderValidationProblems(parsed, assembly)).toEqual([])
    }
  }, 30_000)
})

describe('M6-T2 Blender validation — deck groups present', () => {
  it('flags a missing / renamed / empty / extra deck group', async () => {
    const { gltf, assembly } = await exported('patrol')

    const renamed = structuredClone(gltf)
    renamed.nodes![renamed.scenes![0].nodes![2]!].name = 'module-bay'
    const renamedProblems = deckGroupCheck(renamed, assembly).problems
    expect(renamedProblems.some((p) => p.includes("'deck-2' is missing"))).toBe(true)
    expect(renamedProblems.some((p) => p.includes('unexpected root'))).toBe(true)

    const emptied = structuredClone(gltf)
    delete emptied.nodes![emptied.scenes![0].nodes![1]!].children
    expect(
      deckGroupCheck(emptied, assembly).problems.some((p) =>
        p.includes("'deck-1' loaded with no meshes"),
      ),
    ).toBe(true)

    const shifted = structuredClone(gltf)
    shifted.scenes![0].nodes = [...shifted.scenes![0].nodes!].reverse()
    expect(
      deckGroupCheck(shifted, assembly).problems.some((p) =>
        p.includes('not the deck order'),
      ),
    ).toBe(true)

    expect(deckGroupCheck(null, assembly).problems).toEqual([
      'deck groups: not a glTF document object',
    ])
  })
})

describe('M6-T2 Blender validation — materials intact', () => {
  it('flags a dropped, duplicated, renamed or non-slot material', async () => {
    const { gltf, assembly } = await exported('patrol')

    const dropped = structuredClone(gltf)
    dropped.materials = dropped.materials!.slice(0, 4)
    expect(
      materialCheck(dropped, assembly).problems.some((p) =>
        p.includes('no material named'),
      ),
    ).toBe(true)

    const renamed = structuredClone(gltf)
    renamed.materials![0].name = 'chrome'
    expect(
      materialCheck(renamed, assembly).problems.some((p) =>
        p.includes("'chrome' is not a §4 material slot"),
      ),
    ).toBe(true)

    const duplicated = structuredClone(gltf)
    duplicated.materials!.push(structuredClone(duplicated.materials![0]))
    expect(
      materialCheck(duplicated, assembly).problems.some((p) =>
        p.includes('materials named'),
      ),
    ).toBe(true)
  })

  it('flags a material without a usable PBR payload', async () => {
    const { gltf, assembly } = await exported('patrol')
    const broken = structuredClone(gltf)
    delete broken.materials![0].pbrMetallicRoughness
    expect(
      materialCheck(broken, assembly).problems.some((p) =>
        p.includes('has no PBR payload'),
      ),
    ).toBe(true)

    const badMetal = structuredClone(gltf)
    badMetal.materials![0].pbrMetallicRoughness!.metallicFactor = 5
    expect(
      materialCheck(badMetal, assembly).problems.some((p) =>
        p.includes('no usable metallicFactor'),
      ),
    ).toBe(true)
  })

  it('flags an emissive slot whose emission was lost', async () => {
    const { gltf, assembly } = await exported('patrol')
    const broken = structuredClone(gltf)
    const screen = broken.materials!.find((material) => material.name === 'screen')!
    screen.emissiveFactor = [0, 0, 0]
    expect(
      materialCheck(broken, assembly).problems.some((p) =>
        p.includes("'screen' is emissive but carries no emission"),
      ),
    ).toBe(true)
  })

  it('flags a primitive wired to a missing material', async () => {
    const { gltf, assembly } = await exported('patrol')
    const broken = structuredClone(gltf)
    broken.meshes![0].primitives[0].material = 999
    expect(
      materialCheck(broken, assembly).problems.some((p) =>
        p.includes('references material 999'),
      ),
    ).toBe(true)
  })
})

describe('M6-T2 Blender validation — no flipped normals', () => {
  it('detects inverted normals on a real export', async () => {
    const { gltf, assembly } = await exported('patrol')
    expect(auditNormals(gltf).flipped).toBe(0)
    const broken = structuredClone(gltf)
    mutateVec3(broken, normalAccessorOf(broken), (_i, v) => [-v[0], -v[1], -v[2]])
    const audit = auditNormals(broken)
    expect(audit.flipped).toBeGreaterThan(0)
    expect(audit.problems.some((p) => p.includes('flipped normals'))).toBe(true)
    // The structural contract is untouched — this is a normals-only injection.
    expect(deckGroupCheck(broken, assembly).ok).toBe(true)
    expect(materialCheck(broken, assembly).ok).toBe(true)
  })

  it('detects non-unit normals', async () => {
    const { gltf } = await exported('patrol')
    const broken = structuredClone(gltf)
    mutateVec3(broken, normalAccessorOf(broken), (_i, v) => [
      v[0] * 3,
      v[1] * 3,
      v[2] * 3,
    ])
    const audit = auditNormals(broken)
    expect(audit.nonUnit).toBeGreaterThan(0)
    expect(audit.problems.some((p) => p.includes('not unit length'))).toBe(true)
  })

  it('counts (but never judges) a degenerate triangle', async () => {
    const { gltf } = await exported('patrol')
    const broken = structuredClone(gltf)
    const positions = readVec3Accessor(broken, positionAccessorOf(broken))
    const second: [number, number, number] = [positions[3], positions[4], positions[5]]
    mutateVec3(broken, positionAccessorOf(broken), (i, v) => (i === 0 ? second : v))
    const audit = auditNormals(broken)
    expect(audit.degenerate).toBeGreaterThan(0)
    expect(audit.flipped).toBe(0)
  })

  it('reports a NORMAL/POSITION count mismatch and a missing triangles attribute', async () => {
    const { gltf } = await exported('patrol')
    const mismatch = structuredClone(gltf)
    // Point NORMAL at the SCALAR index accessor: one value per vertex, not three.
    mismatch.meshes![0].primitives[0].attributes.NORMAL =
      mismatch.meshes![0].primitives[0].indices!
    expect(
      auditNormals(mismatch).problems.some((p) => p.includes('NORMAL count')),
    ).toBe(true)

    const missing = structuredClone(gltf)
    delete missing.meshes![0].primitives[0].attributes.NORMAL
    expect(
      auditNormals(missing).problems.some((p) => p.includes('without POSITION/NORMAL')),
    ).toBe(true)
  })
})
