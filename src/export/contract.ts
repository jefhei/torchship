/**
 * M6-T1 — the glTF export contract (PRD §7 "scene → glTF"; §13
 * "the glTF interior loads in Blender with material slots intact and deck groups
 * named per contract").
 *
 * `exportProblems(gltf, assembly)` validates a serialised glTF document against
 * the contract, headlessly and without a renderer:
 *
 *  1. `asset.version` 2.0 and the contract carried in `asset.extras`
 *     (`units`, `upAxis`, `thrustAxis` — the "documented" half);
 *  2. exactly one scene whose root nodes are the deck groups, named `deck-0…N`
 *     in nose → aft order, one per spec deck;
 *  3. each deck group at `[0, floorY, 0]` (the spine is the origin), floors
 *     strictly descending in Y — the thrust axis is −Y;
 *  4. unit scale: no node carries a scale, so the file is meters throughout;
 *  5. every deck's child mesh nodes are the deck's OWN draw-call ids, in plan
 *     order (`groups` then `batches`) — the exported tree is the renderer's;
 *  6. the export materials are exactly the §4 slots the ship draws, each named
 *     by its slot, no duplicates, every mesh primitive pointing at one, and
 *     every primitive carrying NORMAL + POSITION attributes;
 *  7. transform fidelity: every instanced batch's `EXT_mesh_gpu_instancing`
 *     TRANSLATION accessor is the batch's own placements (deck-local, meters),
 *     and every merged group's POSITION accessor bounds are the merged
 *     geometry's own bounds — so the serialised numbers can't drift from the
 *     assembly.
 *
 * The transform-fidelity check rebuilds the deck's draw plan (`deckDrawPlan`,
 * the renderer's own geometry) and disposes it: it is the one place the checker
 * spends real geometry work, and it is what makes "the export is the ship"
 * verifiable rather than asserted.
 */

import type { ShipAssembly } from '../assembler'
import { geometryBounds } from '../kit/render/merged'
import { MATERIAL_SLOTS } from '../types'
import type { MaterialSlot, Transform3, Vec3 } from '../types'
import { deckDrawPlan, disposeDrawPlan } from '../player/deckGeometry'
import { deckNodeName, drawnSlots } from './scene'

/** glTF 2.0 unit (the project is meters end to end). */
export const EXPORT_UNITS = 'meters'
/** glTF's up axis (the spec fixes Y-up; the project matches it). */
export const EXPORT_UP_AXIS = 'Y'
/** Under burn, down is toward the drive: the thrust axis points along −Y. */
export const EXPORT_THRUST_AXIS = '-Y'

/**
 * The export contract as `asset.extras`, so the file documents itself: a
 * consumer (Blender, a viewer) reads units + orientation from here.
 */
export const EXPORT_DOCUMENTATION = {
  units: EXPORT_UNITS,
  upAxis: EXPORT_UP_AXIS,
  thrustAxis: EXPORT_THRUST_AXIS,
  deckGroups: 'one group per deck, named deck-0…deck-N (nose → aft)',
  note: 'Down under burn is toward the drive, so deck floors descend in Y.',
} as const

/** Float component type (glTF). */
const FLOAT = 5126
/** Absolute tolerance for deck-group transforms (exact in practice). */
const TRANSFORM_EPS = 1e-9
/** Absolute tolerance for serialised geometry (float32 positions/translations). */
const GEOMETRY_EPS = 1e-4

/* --------------------------------------------------------- glTF 2.0 shapes */

export interface GltfAsset {
  version: string
  generator?: string
  extras?: Record<string, unknown>
}
export interface GltfScene {
  name?: string
  nodes?: number[]
}
export interface GltfNode {
  name?: string
  children?: number[]
  mesh?: number
  translation?: number[]
  rotation?: number[]
  scale?: number[]
  matrix?: number[]
  extensions?: Record<string, unknown>
}
export interface GltfPrimitive {
  attributes: Record<string, number>
  indices?: number
  material?: number
  mode?: number
}
export interface GltfMesh {
  name?: string
  primitives: GltfPrimitive[]
}
export interface GltfMaterial {
  name?: string
  pbrMetallicRoughness?: {
    baseColorFactor?: number[]
    metallicFactor?: number
    roughnessFactor?: number
  }
  emissiveFactor?: number[]
}
export interface GltfBuffer {
  byteLength: number
  uri?: string
}
export interface GltfBufferView {
  buffer: number
  byteOffset?: number
  byteLength: number
  byteStride?: number
  target?: number
}
export interface GltfAccessor {
  bufferView?: number
  byteOffset?: number
  componentType: number
  count: number
  type: string
  min?: number[]
  max?: number[]
}
export interface GltfDocument {
  asset: GltfAsset
  scene?: number
  scenes?: GltfScene[]
  nodes?: GltfNode[]
  meshes?: GltfMesh[]
  materials?: GltfMaterial[]
  buffers?: GltfBuffer[]
  bufferViews?: GltfBufferView[]
  accessors?: GltfAccessor[]
  extensionsUsed?: string[]
  extensionsRequired?: string[]
}

/* --------------------------------------------------------------- decoding */

/** Decode a base64 glTF buffer URI (`data:…;base64,…`) into bytes. */
function decodeBufferUri(uri: string): Uint8Array {
  const comma = uri.indexOf(',')
  const base64 = uri.startsWith('data:') && comma >= 0 ? uri.slice(comma + 1) : uri
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

/** The float values of a VEC3 accessor, in order. Throws on a malformed doc. */
export function readVec3Accessor(gltf: GltfDocument, index: number): number[] {
  const accessor = gltf.accessors?.[index]
  if (accessor === undefined) throw new Error(`no accessor ${index}`)
  if (accessor.componentType !== FLOAT || accessor.type !== 'VEC3') {
    throw new Error(`accessor ${index} is not a FLOAT VEC3`)
  }
  const viewDef = gltf.bufferViews?.[accessor.bufferView ?? -1]
  if (viewDef === undefined) throw new Error(`accessor ${index} has no bufferView`)
  const bufferDef = gltf.buffers?.[viewDef.buffer]
  if (bufferDef?.uri === undefined)
    throw new Error(`buffer ${viewDef.buffer} has no uri`)
  const bytes = decodeBufferUri(bufferDef.uri)
  const data = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const base = (viewDef.byteOffset ?? 0) + (accessor.byteOffset ?? 0)
  const stride = viewDef.byteStride ?? 3 * 4
  const out: number[] = []
  for (let i = 0; i < accessor.count; i++) {
    const at = base + i * stride
    out.push(
      data.getFloat32(at, true),
      data.getFloat32(at + 4, true),
      data.getFloat32(at + 8, true),
    )
  }
  return out
}

/* ------------------------------------------------------------- validation */

function rootNodeOf(
  doc: GltfDocument,
  scene: GltfScene,
  name: string,
): GltfNode | undefined {
  const nodes = doc.nodes ?? []
  return (scene.nodes ?? []).map((i) => nodes[i]).find((node) => node?.name === name)
}

/**
 * Every way a serialised glTF document can violate the M6 export contract
 * (empty = a valid export of `assembly`). Never throws: a malformed document is
 * reported as data, the same posture as the M0-T6/M2-T7/M3 harnesses.
 */
export function exportProblems(gltf: unknown, assembly: ShipAssembly): string[] {
  if (typeof gltf !== 'object' || gltf === null) {
    return ['export: not a glTF document object']
  }
  const doc = gltf as GltfDocument
  const problems: string[] = []
  const nodes = doc.nodes ?? []
  const meshes = doc.meshes ?? []
  const materials = doc.materials ?? []

  /* 1. asset + self-documentation. */
  if (doc.asset?.version !== '2.0') {
    problems.push(
      `asset.version is '${String(doc.asset?.version)}' — glTF 2.0 expected`,
    )
  }
  const extras = doc.asset?.extras ?? {}
  if (extras.units !== EXPORT_UNITS) {
    problems.push(
      `asset.extras.units is '${String(extras.units)}' — '${EXPORT_UNITS}' expected`,
    )
  }
  if (extras.upAxis !== EXPORT_UP_AXIS) {
    problems.push(
      `asset.extras.upAxis is '${String(extras.upAxis)}' — '${EXPORT_UP_AXIS}' expected`,
    )
  }
  if (extras.thrustAxis !== EXPORT_THRUST_AXIS) {
    problems.push(
      `asset.extras.thrustAxis is '${String(extras.thrustAxis)}' — '${EXPORT_THRUST_AXIS}' expected`,
    )
  }

  /* 2. one scene, whose roots are the deck groups. */
  if (!Array.isArray(doc.scenes) || doc.scenes.length !== 1) {
    problems.push(`expected exactly one glTF scene, found ${doc.scenes?.length ?? 0}`)
  }
  const scene = doc.scenes?.[doc.scene ?? 0]
  if (scene === undefined) {
    problems.push('no scene to inspect')
    return problems
  }

  const expectedDeckNames = assembly.decks.map((deck) => deckNodeName(deck.deckIndex))
  const rootNames = (scene.nodes ?? []).map((i) => nodes[i]?.name)
  if (rootNames.length !== expectedDeckNames.length) {
    problems.push(
      `scene has ${rootNames.length} root group(s) — expected ${expectedDeckNames.length} deck groups`,
    )
  }
  for (const name of expectedDeckNames) {
    if (!rootNames.includes(name)) problems.push(`missing deck group '${name}'`)
  }
  for (const name of rootNames) {
    if (typeof name !== 'string' || !/^deck-\d+$/.test(name)) {
      problems.push(
        `unexpected root node '${String(name)}' — deck groups must be named deck-N`,
      )
    }
  }
  if (JSON.stringify(rootNames) !== JSON.stringify(expectedDeckNames)) {
    problems.push(
      `deck groups are not the deck order (found ${rootNames.join(', ') || 'none'})`,
    )
  }

  /* 3+4. deck transforms: [0, floorY, 0], descending Y, unit scale. */
  const floors: number[] = []
  for (const deck of assembly.decks) {
    const node = rootNodeOf(doc, scene, deckNodeName(deck.deckIndex))
    if (node === undefined) continue
    // An identity translation is omitted by the exporter (glTF: identity = absent).
    const t = node.translation ?? [0, 0, 0]
    if (!Array.isArray(t) || t.length !== 3) {
      problems.push(
        `deck group '${deckNodeName(deck.deckIndex)}' has no [x, y, z] translation`,
      )
    } else {
      if (Math.abs(t[0]) > TRANSFORM_EPS || Math.abs(t[2]) > TRANSFORM_EPS) {
        problems.push(
          `deck group '${deckNodeName(deck.deckIndex)}' is offset in X/Z (${t[0]}, ${t[2]}) — the spine is the origin`,
        )
      }
      if (Math.abs(t[1] - deck.floorY) > TRANSFORM_EPS) {
        problems.push(
          `deck group '${deckNodeName(deck.deckIndex)}' sits at Y ${t[1]} — expected the deck floor ${deck.floorY}`,
        )
      }
      floors.push(t[1])
    }
  }
  for (let i = 1; i < floors.length; i++) {
    if (!(floors[i] < floors[i - 1])) {
      problems.push(
        `deck floors do not descend in Y (deck ${i - 1} at ${floors[i - 1]}, deck ${i} at ${floors[i]}) — thrust axis is ${EXPORT_THRUST_AXIS}`,
      )
    }
  }
  nodes.forEach((node, index) => {
    if (Array.isArray(node.scale)) {
      const [sx, sy, sz] = node.scale
      if (sx !== 1 || sy !== 1 || sz !== 1) {
        problems.push(
          `node ${index} '${String(node.name)}' carries a scale (${node.scale}) — the export is meters at unit scale`,
        )
      }
    }
  })

  /* 5. each deck's children ARE its draw-call ids, in plan order. */
  for (const deck of assembly.decks) {
    const node = rootNodeOf(doc, scene, deckNodeName(deck.deckIndex))
    if (node === undefined) continue
    const childNames = (node.children ?? []).map((i) => nodes[i]?.name)
    const expectedIds = [
      ...deck.groups.map((plan) => plan.group.id),
      ...deck.batches.map((plan) => plan.batch.id),
    ]
    if (JSON.stringify(childNames) !== JSON.stringify(expectedIds)) {
      problems.push(
        `deck ${deck.deckIndex} (${deck.deckId}) mesh nodes differ from its draw plan ` +
          `(found ${childNames.length}, expected ${expectedIds.length})`,
      )
    }
  }

  /* 6. named slot materials + primitive wiring. */
  const slots: MaterialSlot[] = drawnSlots(assembly)
  const materialNames = materials.map((material) => material.name)
  if (materialNames.length !== slots.length) {
    problems.push(
      `export has ${materialNames.length} material(s) — expected ${slots.length} (one per drawn §4 slot)`,
    )
  }
  const uniqueNames = new Set(materialNames)
  if (uniqueNames.size !== materialNames.length) {
    problems.push(
      'export materials have duplicate names — one named material per slot is required',
    )
  }
  for (const slot of slots) {
    if (!uniqueNames.has(slot))
      problems.push(`no named export material for slot '${slot}'`)
  }
  for (const name of materialNames) {
    if (
      typeof name !== 'string' ||
      !(MATERIAL_SLOTS as readonly string[]).includes(name)
    ) {
      problems.push(`export material '${String(name)}' is not a §4 material slot`)
    }
  }
  meshes.forEach((mesh, meshIndex) => {
    mesh.primitives.forEach((primitive, primIndex) => {
      if (primitive.attributes.POSITION === undefined) {
        problems.push(`mesh ${meshIndex} prim ${primIndex} has no POSITION attribute`)
      }
      if (primitive.attributes.NORMAL === undefined) {
        problems.push(`mesh ${meshIndex} prim ${primIndex} has no NORMAL attribute`)
      }
      if (primitive.material === undefined) {
        problems.push(`mesh ${meshIndex} prim ${primIndex} has no material`)
        return
      }
      const name = materials[primitive.material]?.name
      if (
        typeof name !== 'string' ||
        !(MATERIAL_SLOTS as readonly string[]).includes(name)
      ) {
        problems.push(
          `mesh ${meshIndex} prim ${primIndex} references material '${String(name)}' — not a §4 slot`,
        )
      }
    })
  })

  /* 7. transform fidelity: the serialised numbers ARE the assembly's. */
  for (const deck of assembly.decks) {
    const node = rootNodeOf(doc, scene, deckNodeName(deck.deckIndex))
    if (node === undefined) continue
    const plan = deckDrawPlan(deck)
    const children = (node.children ?? []).map((i) => nodes[i])
    try {
      for (const call of plan) {
        const child = children.find((candidate) => candidate?.name === call.id)
        if (child === undefined) continue // the name diff above already reports it
        if (call.kind === 'merged') {
          const meshDef = meshes[child.mesh ?? -1]
          const accessorIndex = meshDef?.primitives[0]?.attributes.POSITION
          if (accessorIndex === undefined) continue
          const accessor = doc.accessors?.[accessorIndex]
          call.geometry.translate(0, -deck.floorY, 0)
          const bounds = geometryBounds(call.geometry)
          if (
            accessor?.min === undefined ||
            accessor.max === undefined ||
            !vecClose(accessor.min, bounds.min) ||
            !vecClose(accessor.max, bounds.max)
          ) {
            problems.push(
              `merged group '${call.id}' POSITION bounds ${formatVec(accessor?.min)}..${formatVec(accessor?.max)} differ from the geometry's ${formatVec(bounds.min)}..${formatVec(bounds.max)}`,
            )
          }
        } else {
          const translationIndex = instanceTranslationAccessor(child)
          if (translationIndex === undefined) {
            problems.push(
              `instanced batch '${call.id}' carries no EXT_mesh_gpu_instancing TRANSLATION`,
            )
            continue
          }
          const decoded = readVec3Accessor(doc, translationIndex)
          const expected = call.placements.flatMap((placement) =>
            localPosition(placement, deck.floorY),
          )
          if (
            decoded.length !== expected.length ||
            !allClose(decoded, expected, GEOMETRY_EPS)
          ) {
            problems.push(
              `instanced batch '${call.id}' placements differ from the assembly's (${decoded.length / 3} exported vs ${expected.length / 3} expected)`,
            )
          }
        }
      }
    } finally {
      disposeDrawPlan(plan)
    }
  }

  /* The instancing extension, when used, must be declared. */
  const usesInstancing = nodes.some(
    (node) => instanceTranslationAccessor(node) !== undefined,
  )
  if (
    usesInstancing &&
    !(doc.extensionsUsed ?? []).includes('EXT_mesh_gpu_instancing')
  ) {
    problems.push(
      'instanced nodes are present but EXT_mesh_gpu_instancing is not declared',
    )
  }

  return problems
}

/** The TRANSLATION accessor of a node's EXT_mesh_gpu_instancing extension. */
function instanceTranslationAccessor(node: GltfNode | undefined): number | undefined {
  const ext = node?.extensions?.EXT_mesh_gpu_instancing as
    { attributes?: Record<string, number> } | undefined
  return ext?.attributes?.TRANSLATION
}

function localPosition(transform: Transform3, floorY: number): Vec3 {
  const [x, y, z] = transform.position
  return [x, y - floorY, z]
}

function vecClose(
  a: readonly number[],
  b: readonly number[],
  eps = GEOMETRY_EPS,
): boolean {
  return (
    a.length === b.length &&
    a.every((value, index) => Math.abs(value - b[index]) <= eps)
  )
}

function allClose(a: readonly number[], b: readonly number[], eps: number): boolean {
  return a.length === b.length && a.every((value, i) => Math.abs(value - b[i]) <= eps)
}

function formatVec(value: readonly number[] | undefined): string {
  return value === undefined ? 'none' : `[${value.map((n) => n.toFixed(3)).join(', ')}]`
}

/** A throwing form of `exportProblems` (listing every problem). */
export function assertExportValid(gltf: unknown, assembly: ShipAssembly): void {
  const problems = exportProblems(gltf, assembly)
  if (problems.length > 0) {
    throw new Error(
      `glTF export contract: ${problems.length} problem(s):\n` +
        problems.map((problem) => `  - ${problem}`).join('\n'),
    )
  }
}
