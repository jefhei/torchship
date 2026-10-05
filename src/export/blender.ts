/**
 * M6-T2 — the Blender export validation (BUILD_PLAN M6-T2: "Validate export in
 * Blender (materials intact, deck groups present, no flipped normals)"; PRD §13
 * "the glTF interior loads in Blender with material slots intact and deck
 * groups named per contract").
 *
 * Blender is the reference consumer of the M6-T1 glTF export. This module is
 * the headless, deterministic form of what a Blender import confirms: it reads
 * the serialised document the way an importer does — scene → node → mesh →
 * primitive → material/accessor — and reports the three acceptance criteria as
 * data:
 *
 *  1. **deck groups present** — the scene's root nodes are exactly the deck
 *     groups `deck-0…deck-N`, in nose → aft order, each one carrying the deck's
 *     meshes (a group with no children is not a deck that loaded);
 *  2. **materials intact** — every material a primitive references resolves to
 *     a named §4 slot, each drawn slot has exactly one such material, and each
 *     material carries a real PBR payload (base colour + metalness + roughness,
 *     with emission on the slots the theme makes emissive) so nothing is lost
 *     on import;
 *  3. **no flipped normals** — `auditNormals` (src/export/normals.ts) over every
 *     triangles primitive.
 *
 * It also runs the M6-T1 document contract (`exportProblems`) first, so a
 * broken document is reported once in contract terms and once in
 * consumer terms rather than silently passing. Nothing here re-derives the
 * contract rules — it delegates to them and adds the consumer-shaped reads.
 *
 * `scripts/blender-validate.py` is the real-Blender twin of this module: it
 * imports the written `.gltf` with Blender's own glTF importer and asserts the
 * same three claims. The vitest suite pins this module on the four canonical
 * ships; the Python script's measured verdict is recorded in
 * `docs/export-validation.md`.
 */

import type { ShipAssembly } from '../assembler'
import { DEFAULT_MATERIAL_THEME } from '../materials/themes'
import { slotSurface } from '../kit/render/slotSurfaces'
import { MATERIAL_SLOTS } from '../types'
import type { MaterialSlot } from '../types'
import { exportProblems } from './contract'
import type { GltfDocument } from './contract'
import { auditNormals } from './normals'
import type { NormalAudit } from './normals'
import { deckNodeName, drawnSlots } from './scene'

/** Deck-group presence, read from the scene roots. */
export interface DeckGroupCheck {
  ok: boolean
  problems: string[]
  expected: string[]
  found: string[]
  /** True when `found` equals `expected` in order as well as set. */
  orderOk: boolean
}

/** Material integrity, read from the primitives' own references. */
export interface MaterialCheck {
  ok: boolean
  problems: string[]
  /** The §4 slots the assembled ship draws (one material each expected). */
  drawn: string[]
  /** The material names actually present in the document. */
  found: string[]
  /** The drawn slots the theme makes emissive (must carry emission). */
  emissive: string[]
}

/** The whole validation, in the order Blender would read it. */
export interface BlenderValidation {
  ok: boolean
  /** Every problem, grouped in Blender's read order (contract → deck → materials → normals). */
  problems: string[]
  contract: { ok: boolean; problems: string[] }
  deckGroups: DeckGroupCheck
  materials: MaterialCheck
  normals: NormalAudit
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/**
 * Criterion 1 — the deck groups are present. A consumer walks `scene.nodes`
 * and expects the deck groups `deck-0…deck-N` in order, each with children
 * (the deck's meshes); a group that is missing, renamed, extra, mis-ordered or
 * empty is reported.
 */
export function deckGroupCheck(gltf: unknown, assembly: ShipAssembly): DeckGroupCheck {
  const expected = assembly.decks.map((deck) => deckNodeName(deck.deckIndex))
  const check: DeckGroupCheck = {
    ok: false,
    problems: [],
    expected,
    found: [],
    orderOk: false,
  }
  if (!isRecord(gltf)) {
    check.problems.push('deck groups: not a glTF document object')
    return check
  }
  const doc = gltf as unknown as GltfDocument
  const nodes = doc.nodes ?? []
  const scene = doc.scenes?.[doc.scene ?? 0]
  if (scene === undefined || !Array.isArray(scene.nodes)) {
    check.problems.push('deck groups: the document has no scene to read')
    return check
  }
  check.found = scene.nodes.map((i) => nodes[i]?.name ?? '')
  const missing = expected.filter((name) => !check.found.includes(name))
  for (const name of missing) check.problems.push(`deck groups: '${name}' is missing`)
  const extra = check.found.filter((name) => !expected.includes(name))
  for (const name of extra) {
    check.problems.push(
      `deck groups: unexpected root '${name || '<unnamed>'}' — deck groups are named deck-N`,
    )
  }
  check.orderOk =
    check.found.length === expected.length &&
    check.found.every((name, i) => name === expected[i])
  if (missing.length === 0 && extra.length === 0 && !check.orderOk) {
    check.problems.push(
      `deck groups: roots are not the deck order (found ${check.found.join(', ')})`,
    )
  }
  for (const name of expected) {
    const index = check.found.indexOf(name)
    if (index === -1) continue
    const node = nodes[scene.nodes[index]]
    if ((node?.children ?? []).length === 0) {
      check.problems.push(`deck groups: '${name}' loaded with no meshes`)
    }
  }
  check.ok = check.problems.length === 0
  return check
}

/** Every material index referenced by a primitive reachable from the scene. */
function referencedMaterials(doc: GltfDocument): number[] {
  const nodes = doc.nodes ?? []
  const scene = doc.scenes?.[doc.scene ?? 0]
  const out: number[] = []
  const visitNode = (index: number): void => {
    const node = nodes[index]
    if (node === undefined) return
    const mesh = doc.meshes?.[node.mesh ?? -1]
    for (const primitive of mesh?.primitives ?? []) {
      if (primitive.material !== undefined) out.push(primitive.material)
    }
    for (const child of node.children ?? []) visitNode(child)
  }
  for (const root of scene?.nodes ?? []) visitNode(root)
  return out
}

function inUnitRange(value: unknown): boolean {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1
}

/**
 * Criterion 2 — the materials are intact. Every referenced material resolves
 * to a named §4 slot; each drawn slot has exactly one material; each material
 * carries a usable PBR payload; and the slots the theme makes emissive carry
 * emission (so Blender does not import a dark screen or a dead panel light).
 */
export function materialCheck(
  gltf: unknown,
  assembly: ShipAssembly,
  theme = DEFAULT_MATERIAL_THEME,
): MaterialCheck {
  const drawn = drawnSlots(assembly)
  const emissive = drawn.filter(
    (slot) => slotSurface(slot, theme).emissiveIntensity > 0,
  )
  const check: MaterialCheck = { ok: false, problems: [], drawn, found: [], emissive }
  if (!isRecord(gltf)) {
    check.problems.push('materials: not a glTF document object')
    return check
  }
  const doc = gltf as unknown as GltfDocument
  const materials = doc.materials ?? []
  check.found = materials.map((material) => material.name ?? '')

  const byName = new Map<string, number>()
  materials.forEach((material, index) => {
    if (typeof material.name === 'string') byName.set(material.name, index)
  })
  for (const slot of drawn) {
    const count = check.found.filter((name) => name === slot).length
    if (count === 0) check.problems.push(`materials: no material named '${slot}'`)
    else if (count > 1) {
      check.problems.push(
        `materials: ${count} materials named '${slot}' — one per slot required`,
      )
    }
  }
  for (const name of check.found) {
    if (!(MATERIAL_SLOTS as readonly string[]).includes(name)) {
      check.problems.push(
        `materials: '${name || '<unnamed>'}' is not a §4 material slot`,
      )
    }
  }

  for (const materialIndex of referencedMaterials(doc)) {
    const material = materials[materialIndex]
    if (material === undefined) {
      check.problems.push(
        `materials: a primitive references material ${materialIndex}, which does not exist`,
      )
      continue
    }
    const name = material.name
    if (
      typeof name !== 'string' ||
      !(MATERIAL_SLOTS as readonly string[]).includes(name)
    ) {
      check.problems.push(
        `materials: a primitive references '${name ?? '<unnamed>'}', not a §4 slot`,
      )
      continue
    }
    const pbr = material.pbrMetallicRoughness
    if (pbr === undefined) {
      check.problems.push(`materials: '${name}' has no PBR payload`)
      continue
    }
    const base = pbr.baseColorFactor
    if (
      !Array.isArray(base) ||
      (base.length !== 3 && base.length !== 4) ||
      !base.every(
        (value) =>
          typeof value === 'number' &&
          Number.isFinite(value) &&
          value >= 0 &&
          value <= 1,
      )
    ) {
      check.problems.push(`materials: '${name}' has no usable baseColorFactor`)
    }
    if (!inUnitRange(pbr.metallicFactor)) {
      check.problems.push(`materials: '${name}' has no usable metallicFactor`)
    }
    if (!inUnitRange(pbr.roughnessFactor)) {
      check.problems.push(`materials: '${name}' has no usable roughnessFactor`)
    }
    if (emissive.includes(name as MaterialSlot)) {
      const emissiveFactor = material.emissiveFactor
      const lit =
        Array.isArray(emissiveFactor) &&
        emissiveFactor.some((value) => typeof value === 'number' && value > 0)
      if (!lit)
        check.problems.push(`materials: '${name}' is emissive but carries no emission`)
    }
  }

  check.ok = check.problems.length === 0
  return check
}

/**
 * Validate a serialised glTF document the way Blender would read it: the
 * M6-T1 document contract, then deck groups, materials and normals. Never
 * throws — a malformed document is reported as data (the M0-T6/M2-T7/M3/M6-T1
 * harness posture).
 */
export function blenderValidation(
  gltf: unknown,
  assembly: ShipAssembly,
  theme = DEFAULT_MATERIAL_THEME,
): BlenderValidation {
  const contractProblems = isRecord(gltf) ? exportProblems(gltf, assembly) : []
  const contract = { ok: contractProblems.length === 0, problems: contractProblems }
  const deckGroups = deckGroupCheck(gltf, assembly)
  const materials = materialCheck(gltf, assembly, theme)
  const normals = auditNormals(gltf)
  const problems = [
    ...contract.problems,
    ...deckGroups.problems,
    ...materials.problems,
    ...normals.problems,
  ]
  return {
    ok: problems.length === 0,
    problems,
    contract,
    deckGroups,
    materials,
    normals,
  }
}

/** The validation's problems as data (empty = the export loads clean in Blender). */
export function blenderValidationProblems(
  gltf: unknown,
  assembly: ShipAssembly,
  theme = DEFAULT_MATERIAL_THEME,
): string[] {
  return blenderValidation(gltf, assembly, theme).problems
}

/** A throwing form of `blenderValidation` (listing every problem). */
export function assertBlenderValid(
  gltf: unknown,
  assembly: ShipAssembly,
  theme = DEFAULT_MATERIAL_THEME,
): void {
  const { problems } = blenderValidation(gltf, assembly, theme)
  if (problems.length > 0) {
    throw new Error(
      `Blender export validation: ${problems.length} problem(s):\n` +
        problems.map((problem) => `  - ${problem}`).join('\n'),
    )
  }
}
